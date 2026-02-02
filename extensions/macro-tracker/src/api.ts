import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb } from "./db.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function errorResponse(res: ServerResponse, status: number, message: string): void {
  jsonResponse(res, status, { error: message });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk) => {
      body += chunk;
      // Limit body size to 1MB
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

// ── Route handlers ──────────────────────────────────────────────────────────

async function handleGetSummary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = parseUrl(req);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);

  try {
    const db = getDb();
    const summary = db.getDailySummary(date);
    jsonResponse(res, 200, summary);
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
}

async function handleGetEntries(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = parseUrl(req);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) {
    errorResponse(res, 400, "Both 'from' and 'to' query parameters are required");
    return;
  }

  try {
    const db = getDb();
    const entries = db.getEntriesByDateRange(from, to);
    jsonResponse(res, 200, { entries });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
}

async function handleGetGoals(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const db = getDb();
    const goals = db.getGoals();
    jsonResponse(res, 200, { goals });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
}

async function handleUpdateGoals(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      errorResponse(res, 400, "Invalid JSON body");
      return;
    }

    const updates: Record<string, number> = {};
    for (const key of ["calories", "protein", "carbs", "fat", "fiber"]) {
      if (typeof parsed[key] === "number" && Number.isFinite(parsed[key] as number)) {
        updates[key] = parsed[key] as number;
      }
    }

    if (Object.keys(updates).length === 0) {
      errorResponse(res, 400, "At least one goal value must be provided");
      return;
    }

    const db = getDb();
    const goals = db.updateGoals(updates);
    jsonResponse(res, 200, { goals });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
}

async function handleDeleteEntry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = parseUrl(req);
  // Extract entry ID from path: /macro-tracker/api/entries/:id
  const pathParts = url.pathname.split("/");
  const entryId = pathParts[pathParts.length - 1];

  if (!entryId) {
    errorResponse(res, 400, "Entry ID required");
    return;
  }

  try {
    const db = getDb();
    const entry = db.getEntry(entryId);
    if (!entry) {
      errorResponse(res, 404, "Entry not found");
      return;
    }

    db.deleteEntry(entryId);
    jsonResponse(res, 200, { deleted: true, entry });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
}

// ── Route registration ──────────────────────────────────────────────────────

export function createApiRoutes() {
  return [
    {
      path: "/macro-tracker/api/summary",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "GET") {
          errorResponse(res, 405, "Method not allowed");
          return;
        }
        await handleGetSummary(req, res);
      },
    },
    {
      path: "/macro-tracker/api/entries",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "GET") {
          errorResponse(res, 405, "Method not allowed");
          return;
        }
        await handleGetEntries(req, res);
      },
    },
    {
      path: "/macro-tracker/api/goals",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === "GET") {
          await handleGetGoals(req, res);
        } else if (req.method === "PUT") {
          await handleUpdateGoals(req, res);
        } else {
          errorResponse(res, 405, "Method not allowed");
        }
      },
    },
  ];
}

// Export the delete handler separately — it needs path-param matching
// which is handled via the generic HTTP handler in index.ts
export { handleDeleteEntry };
