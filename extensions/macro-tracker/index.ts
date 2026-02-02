import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createApiRoutes, handleDeleteEntry } from "./src/api.js";
import { createDeleteEntryTool } from "./src/delete-entry-tool.js";
import { createGetSummaryTool } from "./src/get-summary-tool.js";
import { createLogNutritionTool } from "./src/log-nutrition-tool.js";
import { createUpdateGoalsTool } from "./src/update-goals-tool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function register(api: OpenClawPluginApi) {
  // ── Tools ───────────────────────────────────────────────────────────────
  api.registerTool(createLogNutritionTool(api), { optional: true });
  api.registerTool(createGetSummaryTool(), { optional: true });
  api.registerTool(createUpdateGoalsTool(), { optional: true });
  api.registerTool(createDeleteEntryTool(), { optional: true });

  // ── HTTP API routes ─────────────────────────────────────────────────────
  const routes = createApiRoutes();
  for (const route of routes) {
    api.registerHttpRoute(route);
  }

  // ── HTTP handler for DELETE /macro-tracker/api/entries/:id ───────────────
  // (needs path-param matching, so uses registerHttpHandler instead of route)
  api.registerHttpHandler(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/macro-tracker\/api\/entries\/([^/]+)$/);
    if (!match || req.method !== "DELETE") {
      return false;
    }
    await handleDeleteEntry(req, res);
    return true;
  });

  // ── Static file handler for dashboard ───────────────────────────────────
  const dashboardDir = path.join(__dirname, "src", "dashboard");

  api.registerHttpHandler(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (!pathname.startsWith("/macro-tracker")) {
      return false;
    }

    // Strip prefix: /macro-tracker → /, /macro-tracker/app.js → /app.js
    let filePath = pathname.replace(/^\/macro-tracker/, "") || "/";
    if (filePath === "/") {
      filePath = "/index.html";
    }

    // Prevent directory traversal
    const resolved = path.resolve(dashboardDir, filePath.slice(1));
    if (!resolved.startsWith(dashboardDir)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return true;
    }

    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        // SPA fallback — serve index.html for non-API routes
        const indexPath = path.join(dashboardDir, "index.html");
        if (fs.existsSync(indexPath)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(indexPath, "utf-8"));
          return true;
        }
        return false;
      }

      const ext = path.extname(resolved).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      };
      res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
      res.end(fs.readFileSync(resolved));
      return true;
    } catch {
      // SPA fallback for not-found files (let app.js handle routing)
      if (!pathname.startsWith("/macro-tracker/api/")) {
        const indexPath = path.join(dashboardDir, "index.html");
        if (fs.existsSync(indexPath)) {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(fs.readFileSync(indexPath, "utf-8"));
          return true;
        }
      }
      return false;
    }
  });
}
