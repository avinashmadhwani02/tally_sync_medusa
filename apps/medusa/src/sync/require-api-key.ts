import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { ApiKey } from "../generated/prisma"
import { verifyApiKey } from "./auth"

export type TallySyncRequest = MedusaRequest & { tallyApiKey?: ApiKey }

export async function requireTallyApiKey(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const header = req.headers["x-api-key"]
  const raw = Array.isArray(header) ? header[0] : header
  const keyRow = await verifyApiKey(raw)
  if (!keyRow) {
    res.status(401).json({ ok: false, error: "Invalid or missing API key." })
    return
  }
  ;(req as TallySyncRequest).tallyApiKey = keyRow
  next()
}
