import { defineMiddlewares } from "@medusajs/framework/http"
import { requireTallyApiKey } from "../sync/require-api-key"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/sync*",
      middlewares: [requireTallyApiKey],
    },
    {
      matcher: "/export*",
      middlewares: [requireTallyApiKey],
    },
    {
      matcher: "/sync/stock",
      method: "POST",
      bodyParser: { sizeLimit: "5mb" },
    },
  ],
})
