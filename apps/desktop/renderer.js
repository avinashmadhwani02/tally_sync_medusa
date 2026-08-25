const ipEl = document.getElementById("ip");
const portEl = document.getElementById("port");
const banner = document.getElementById("banner");
const needOpen = document.getElementById("needOpen");
const companyCard = document.getElementById("companyCard");
const stockCard = document.getElementById("stockCard");
const companyEl = document.getElementById("company");
const btnTest = document.getElementById("btnTest");
const btnStock = document.getElementById("btnStock");
const stockStatus = document.getElementById("stockStatus");
const preview = document.getElementById("preview");

function setBanner(text, kind) {
  banner.textContent = text;
  banner.className = "banner " + (kind || "idle");
}

function hideReady() {
  companyCard.hidden = true;
  stockCard.hidden = true;
  companyEl.innerHTML = "";
}

function showReady(names) {
  needOpen.hidden = true;
  companyCard.hidden = false;
  stockCard.hidden = false;
  companyEl.innerHTML = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    companyEl.appendChild(opt);
  }
}

btnTest.addEventListener("click", async () => {
  btnTest.disabled = true;
  setBanner("Checking Tally…", "idle");
  needOpen.hidden = true;
  hideReady();
  preview.hidden = true;
  stockStatus.textContent = "";

  const res = await window.tally.testConnection(ipEl.value.trim(), portEl.value.trim());
  btnTest.disabled = false;

  if (!res.ok) {
    setBanner(res.error, "err");
    return;
  }

  if (res.state === "company_not_open") {
    setBanner("Connected to Tally. No company is open.", "warn");
    needOpen.hidden = false;
    return;
  }

  setBanner("Connected. A company is open in Tally.", "ok");
  showReady(res.companies);
});

btnStock.addEventListener("click", async () => {
  const company = companyEl.value;
  if (!company) return;
  btnStock.disabled = true;
  stockStatus.textContent = "";
  preview.hidden = true;

  // Reset + show progress UI
  progressCard.hidden = false;
  setProgress(0, `Preparing sync for “${company}”…`, "start");
  for (const el of [stepFetch, stepPush]) {
    el.className = "";
    const dot = el.querySelector(".dot");
    if (dot) dot.remove();
  }

  const offProgress = window.tally.onSyncProgress(({ stage, pct, message }) => {
    setProgress(pct, message, stage);
  });

  let res;
  try {
    res = await window.tally.fetchStock(ipEl.value.trim(), portEl.value.trim(), company);
  } finally {
    offProgress();
  }
  btnStock.disabled = false;

  if (!res.ok) {
    failReachedStep(res.error);
    return;
  }
  markStep("fetch", "done");
  const failed = Number(res.failed ?? res.unmatched?.length ?? 0);
  const updated = Number(res.report?.updated ?? res.updated ?? 0);
  const allFailed = failed > 0 && updated === 0;
  const partial = failed > 0 && updated > 0;

  if (allFailed) {
    markStep("push", "failed");
    setProgress(100, `Nothing updated in Medusa — ${failed} item(s) had no matching SKU.`, "error");
    stockStatus.textContent =
      `❌ 0 updated, ${failed} failed. Create those variants in Medusa Admin and set SKU = Tally Part Number.`;
  } else if (partial) {
    markStep("push", "failed");
    progressBar.className = "progress-bar warn";
    progressBar.style.width = "100%";
    progressLabel.textContent = `Partial — ${updated} updated, ${failed} failed.`;
    progressPct.textContent = "100%";
    stockStatus.textContent = `⚠️ ${updated} updated in Medusa, ${failed} failed (no matching SKU).`;
  } else {
    markStep("push", "done");
    setProgress(100, `Done — ${updated} updated in Medusa.`, "done");
    stockStatus.textContent = `✅ ${updated} updated in Medusa.`;
  }
  if (res.unmatched?.length) {
    preview.hidden = false;
    preview.textContent = JSON.stringify(res.unmatched, null, 2);
  } else if (res.items?.length) {
    preview.hidden = false;
    preview.textContent = JSON.stringify(res.items.slice(0, 20), null, 2);
  }
  loadSyncHistory(); // refresh history so the new run appears immediately
});

// ---- Sync history ----
const btnRefreshHistory = document.getElementById("btnRefreshHistory");
const historyMsg = document.getElementById("historyMsg");
const historyTableWrap = document.getElementById("historyTableWrap");
const historyBody = document.getElementById("historyBody");

async function loadSyncHistory() {
  historyMsg.textContent = "Loading sync history…";
  historyMsg.className = "hint";
  historyTableWrap.hidden = true;
  btnRefreshHistory.disabled = true;

  const res = await window.tally.getSyncRuns();
  btnRefreshHistory.disabled = false;

  if (!res.ok) {
    historyMsg.textContent = "⚠️ " + res.error;
    return;
  }

  if (res.runs.length === 0) {
    historyMsg.textContent = "No syncs yet — run a sync and it will show up here.";
    return;
  }

  historyMsg.textContent = "";
  historyTableWrap.hidden = false;
  historyBody.innerHTML = "";

  for (const run of res.runs) {
    const tr = document.createElement("tr");

    const when = new Date(run.syncedAt).toLocaleString(undefined, {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

    const tdWhen = document.createElement("td");
    tdWhen.textContent = when;
    tdWhen.className = "mono";
    tr.appendChild(tdWhen);

    const tdCompany = document.createElement("td");
    tdCompany.textContent = run.company;
    tr.appendChild(tdCompany);

    const tdTrigger = document.createElement("td");
    const triggerBadge = document.createElement("span");
    triggerBadge.className = "badge " + (run.trigger === "auto" ? "badge-auto" : "badge-manual");
    triggerBadge.textContent = run.trigger.toUpperCase();
    tdTrigger.appendChild(triggerBadge);
    tr.appendChild(tdTrigger);

    const tdStatus = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className =
      "badge " +
      (run.status === "success" ? "badge-ok" : run.status === "partial" ? "badge-auto" : "badge-err");
    statusBadge.textContent =
      run.status === "success" ? "OK" : run.status === "partial" ? "PARTIAL" : "FAILED";
    tdStatus.appendChild(statusBadge);
    tr.appendChild(tdStatus);

    const tdItems = document.createElement("td");
    tdItems.className = "mono";
    tdItems.textContent = run.itemCount;
    tr.appendChild(tdItems);

    const tdCounts = document.createElement("td");
    tdCounts.className = "mono";
    tdCounts.textContent = `${run.updated ?? 0} / ${run.failed ?? 0}`;
    tr.appendChild(tdCounts);

    const reportBits = [];
    if (run.error) reportBits.push(run.error);
    const unmatched = run.report?.unmatched;
    if (Array.isArray(unmatched) && unmatched.length) {
      reportBits.push(
        unmatched
          .slice(0, 15)
          .map((u) => `${u.name || u.sku}: ${u.reason}`)
          .join("\n")
      );
      if (unmatched.length > 15) reportBits.push(`…and ${unmatched.length - 15} more`);
    }
    if (run.status === "failed") {
      tr.classList.add("has-error");
    } else if (run.status === "partial") {
      tr.classList.add("has-partial");
    }
    if (reportBits.length) {
      tr.title = reportBits.join("\n");
    }

    historyBody.appendChild(tr);
  }
}

btnRefreshHistory.addEventListener("click", loadSyncHistory);
loadSyncHistory();

// ---- Progress UI helpers ----
const progressCard = document.getElementById("progressCard");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const progressPct = document.getElementById("progressPct");
const stepFetch = document.getElementById("step-fetch");
const stepPush = document.getElementById("step-push");

function setProgress(pct, label, stage) {
  progressBar.style.width = pct + "%";
  progressBar.className =
    "progress-bar" + (stage === "error" ? " error" : stage === "done" ? " done" : " active");
  progressLabel.textContent = label;
  progressPct.textContent = pct + "%";
  progressCard.dataset.kind = stage || "";

  // highlight the currently-running step
  const map = { fetch: stepFetch, push: stepPush };
  const current = map[stage];
  if (current && current.className !== "done") markStep(current, "active");
}

function markStep(stepElOrName, state) {
  const el = typeof stepElOrName === "string" ? document.getElementById("step-" + stepElOrName) : stepElOrName;
  if (!el) return;
  el.className = state;
  ensureDot(el, state);
}

function ensureDot(el, state) {
  let dot = el.querySelector(".dot");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "dot";
    el.prepend(dot);
  }
  dot.className = "dot " + (state || "");
}

function failReachedStep(error) {
  progressBar.className = "progress-bar error";
  progressBar.style.width = "100%";
  progressLabel.textContent = error;
  progressPct.textContent = "!";
  // mark all not-done steps as failed-ish: first pending becomes error
  for (const el of [stepFetch, stepPush]) {
    if (el.className !== "done") {
      markStep(el, "failed");
      break;
    }
  }
  stockStatus.textContent = "❌ " + error;
}
