const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Load .env from the desktop app directory (SYNC_SERVICE_URL, SYNC_SERVICE_KEY, …)
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { getTallySource } = require("./tally/getSource");
const { testConnection, fetchStock } = getTallySource();

let win;
let inFlight = false;

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 780,
    title: "Tally Sync",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("sync:runs", async () => {
  const syncUrl = process.env.SYNC_SERVICE_URL;
  const syncKey = process.env.SYNC_SERVICE_KEY;
  if (!syncUrl || !syncKey) {
    return { ok: false, error: "Sync target not configured. Set SYNC_SERVICE_URL (Medusa, e.g. http://localhost:9000) and SYNC_SERVICE_KEY." };
  }
  try {
    const res = await fetch(`${syncUrl.replace(/\/$/, "")}/sync/runs?limit=50`, {
      headers: { "x-api-key": syncKey },
    });
    if (res.status === 401) return { ok: false, error: "Invalid API key — check SYNC_SERVICE_KEY." };
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return { ok: true, runs: body.runs };
  } catch (err) {
    const msg = err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed")
      ? "Cannot reach Medusa — is `npm run medusa` running?"
      : err.message;
    return { ok: false, error: msg };
  }
});

ipcMain.handle("tally:test", async (_e, { ip, port }) => {
  if (inFlight) return { ok: false, error: "Another request is already running." };
  inFlight = true;
  try {
    return await testConnection(ip, port);
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    inFlight = false;
  }
});

ipcMain.handle("tally:stock", async (e, { ip, port, company }) => {
  if (inFlight) return { ok: false, error: "Another request is already running." };
  inFlight = true;
  const send = (stage, pct, message) => {
    if (!e.sender.isDestroyed()) e.sender.send("sync:progress", { stage, pct, message });
  };
  try {
    send("fetch", 5, `Connecting to Tally and fetching stock for “${company}”…`);
    const result = await fetchStock(ip, port, company);
    send("fetch", 45, `Fetched ${result.items.length} stock items from Tally.`);

    const payload = {
      company,
      tallyHost: `${ip}:${port}`,
      syncedAt: new Date().toISOString(),
      cmpInfo: result.cmpInfo,
      items: result.items,
    };

    // Push to Medusa Tally sync routes (Postgres)
    const syncUrl = process.env.SYNC_SERVICE_URL;
    const syncKey = process.env.SYNC_SERVICE_KEY;
    const syncTrigger = process.env.SYNC_TRIGGER === "auto" ? "auto" : "manual";
    if (!syncUrl || !syncKey) {
      const msg = "Sync target not configured. Set SYNC_SERVICE_URL (http://localhost:9000) and SYNC_SERVICE_KEY.";
      send("error", 100, msg);
      return { ok: false, error: msg };
    }
    send("push", 65, `Pushing ${result.items.length} items to the database…`);
    let body;
    try {
      const res = await fetch(`${syncUrl.replace(/\/$/, "")}/sync/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": syncKey },
        body: JSON.stringify({ ...payload, trigger: syncTrigger }),
      });
      try {
        body = await res.json();
      } catch {
        throw new Error(`backend returned a non-JSON response (HTTP ${res.status})`);
      }
      if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
    } catch (err) {
      const msg = `Database sync failed: ${err.message}`;
      send("error", 100, msg);
      return { ok: false, error: msg };
    }

    // Dry-run aware status line
    const pushedTo = body.mode === "dry-run"
      ? `DRY-RUN — would create ${body.wouldCreateProducts ?? "?"} products / ${body.wouldCreateVariants ?? "?"} variants, ${body.inventoryUpdates ?? 0} stock updates, ${body.outOfStockCount ?? 0} out-of-stock skipped`
      : `${body.updated} updated in Medusa, ${body.failed} failed`;
    send("push", 95, `Database updated: ${pushedTo}.`);
    send("done", 100, `Sync complete — ${pushedTo}.`);
    return {
      ...result,
      ok: true,
      pushedTo,
      itemCount: result.items.length,
      unmatched: body.unmatched,
      report: body.report,
      status: body.status,
      updated: body.updated,
      failed: body.failed,
    };
  } catch (err) {
    send("error", 100, err.message);
    return { ok: false, error: err.message };
  } finally {
    inFlight = false;
  }
});
