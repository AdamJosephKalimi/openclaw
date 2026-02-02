import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module to use a temp database
let tmpDir: string;
let dbPath: string;

vi.mock("./db.js", async () => {
  const actual = await vi.importActual<typeof import("./db.js")>("./db.js");
  let instance: InstanceType<typeof actual.MacroTrackerDb> | null = null;
  return {
    ...actual,
    getDb: () => {
      if (!instance) {
        instance = new actual.MacroTrackerDb(dbPath);
      }
      return instance;
    },
    _cleanup: () => {
      if (instance) {
        instance.close();
        instance = null;
      }
    },
  };
});

import { MacroTrackerDb } from "./db.js";
import { createApiRoutes, handleDeleteEntry } from "./api.js";

// Helpers for HTTP testing
function createMockRequest(
  method: string,
  url: string,
  body?: string,
): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;
  if (body) {
    process.nextTick(() => {
      req.emit("data", body);
      req.emit("end");
    });
  } else {
    process.nextTick(() => {
      req.emit("end");
    });
  }
  return req;
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  ended = false;

  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value;
  }

  end(data?: string | Buffer) {
    if (data) {
      this.body += typeof data === "string" ? data : data.toString("utf-8");
    }
    this.ended = true;
  }

  json(): unknown {
    return JSON.parse(this.body);
  }
}

describe("API routes", () => {
  let db: MacroTrackerDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macro-tracker-api-test-"));
    dbPath = path.join(tmpDir, "test.db");
    db = new MacroTrackerDb(dbPath);
  });

  afterEach(async () => {
    db.close();
    const mod = await import("./db.js");
    (mod as any)._cleanup?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GET /macro-tracker/api/summary", () => {
    it("returns daily summary for a date", async () => {
      db.insertEntry({
        date: "2026-01-15",
        source: "test",
        rawInput: "eggs",
        items: [
          {
            name: "Eggs",
            quantity: "2",
            calories: 140,
            protein: 12,
            carbs: 1,
            fat: 10,
            fiber: 0,
            confidence: "high",
          },
        ],
      });

      const routes = createApiRoutes();
      const summaryRoute = routes.find((r) => r.path === "/macro-tracker/api/summary")!;

      const req = createMockRequest("GET", "/macro-tracker/api/summary?date=2026-01-15");
      const res = new MockResponse();

      await summaryRoute.handler(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.date).toBe("2026-01-15");
      expect(body.total_calories).toBe(140);
      expect(body.entry_count).toBe(1);
    });

    it("returns empty summary for date with no entries", async () => {
      const routes = createApiRoutes();
      const summaryRoute = routes.find((r) => r.path === "/macro-tracker/api/summary")!;

      const req = createMockRequest("GET", "/macro-tracker/api/summary?date=2099-12-31");
      const res = new MockResponse();

      await summaryRoute.handler(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.total_calories).toBe(0);
      expect(body.entry_count).toBe(0);
    });
  });

  describe("GET /macro-tracker/api/entries", () => {
    it("returns entries for date range", async () => {
      db.insertEntry({
        date: "2026-01-15",
        source: "test",
        rawInput: "lunch",
        items: [
          {
            name: "Rice",
            quantity: "200g",
            calories: 260,
            protein: 5,
            carbs: 58,
            fat: 0.5,
            fiber: 0.6,
            confidence: "medium",
          },
        ],
      });

      const routes = createApiRoutes();
      const entriesRoute = routes.find((r) => r.path === "/macro-tracker/api/entries")!;

      const req = createMockRequest(
        "GET",
        "/macro-tracker/api/entries?from=2026-01-15&to=2026-01-15",
      );
      const res = new MockResponse();

      await entriesRoute.handler(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.entries).toHaveLength(1);
    });

    it("returns 400 when missing params", async () => {
      const routes = createApiRoutes();
      const entriesRoute = routes.find((r) => r.path === "/macro-tracker/api/entries")!;

      const req = createMockRequest("GET", "/macro-tracker/api/entries?from=2026-01-15");
      const res = new MockResponse();

      await entriesRoute.handler(req, res as any);

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET/PUT /macro-tracker/api/goals", () => {
    it("returns null goals when none set", async () => {
      const routes = createApiRoutes();
      const goalsRoute = routes.find((r) => r.path === "/macro-tracker/api/goals")!;

      const req = createMockRequest("GET", "/macro-tracker/api/goals");
      const res = new MockResponse();

      await goalsRoute.handler(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.goals).toBeNull();
    });

    it("creates/updates goals via PUT", async () => {
      const routes = createApiRoutes();
      const goalsRoute = routes.find((r) => r.path === "/macro-tracker/api/goals")!;

      const req = createMockRequest(
        "PUT",
        "/macro-tracker/api/goals",
        JSON.stringify({ calories: 2200, protein: 180 }),
      );
      const res = new MockResponse();

      await goalsRoute.handler(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.goals.calories).toBe(2200);
      expect(body.goals.protein).toBe(180);
    });
  });

  describe("DELETE /macro-tracker/api/entries/:id", () => {
    it("deletes an entry", async () => {
      const entry = db.insertEntry({
        date: "2026-01-15",
        source: "test",
        rawInput: "toast",
        items: [
          {
            name: "Toast",
            quantity: "1 slice",
            calories: 80,
            protein: 3,
            carbs: 15,
            fat: 1,
            fiber: 1,
            confidence: "high",
          },
        ],
      });

      const req = createMockRequest(
        "DELETE",
        `/macro-tracker/api/entries/${entry.id}`,
      );
      const res = new MockResponse();

      await handleDeleteEntry(req, res as any);

      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.deleted).toBe(true);
    });

    it("returns 404 for non-existent entry", async () => {
      const req = createMockRequest(
        "DELETE",
        "/macro-tracker/api/entries/non-existent-id",
      );
      const res = new MockResponse();

      await handleDeleteEntry(req, res as any);

      expect(res.statusCode).toBe(404);
    });
  });
});
