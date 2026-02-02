import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  DailySummary,
  ExtractedItem,
  Goals,
  NutritionEntry,
  NutritionItem,
} from "./types.js";

// ── Resolve database path ───────────────────────────────────────────────────

function resolveDbDir(): string {
  const stateDir =
    process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "macro-tracker");
}

function resolveDbPath(): string {
  return path.join(resolveDbDir(), "macros.db");
}

// ── Schema ──────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  date        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual',
  raw_input   TEXT NOT NULL DEFAULT '',
  total_calories REAL NOT NULL DEFAULT 0,
  total_protein  REAL NOT NULL DEFAULT 0,
  total_carbs    REAL NOT NULL DEFAULT 0,
  total_fat      REAL NOT NULL DEFAULT 0,
  total_fiber    REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  quantity   TEXT NOT NULL DEFAULT '',
  calories   REAL NOT NULL DEFAULT 0,
  protein    REAL NOT NULL DEFAULT 0,
  carbs      REAL NOT NULL DEFAULT 0,
  fat        REAL NOT NULL DEFAULT 0,
  fiber      REAL NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'medium'
);

CREATE INDEX IF NOT EXISTS idx_items_entry_id ON items(entry_id);

CREATE TABLE IF NOT EXISTS goals (
  id         TEXT PRIMARY KEY DEFAULT 'default',
  calories   REAL NOT NULL DEFAULT 2000,
  protein    REAL NOT NULL DEFAULT 150,
  carbs      REAL NOT NULL DEFAULT 250,
  fat        REAL NOT NULL DEFAULT 65,
  fiber      REAL NOT NULL DEFAULT 30,
  updated_at TEXT NOT NULL
);
`;

// ── Database class ──────────────────────────────────────────────────────────

export class MacroTrackerDb {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? resolveDbPath();
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
  }

  // ── Entry CRUD ──────────────────────────────────────────────────────────

  insertEntry(params: {
    date: string;
    source: string;
    rawInput: string;
    items: ExtractedItem[];
  }): NutritionEntry {
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalFiber = 0;

    for (const item of params.items) {
      totalCalories += item.calories;
      totalProtein += item.protein;
      totalCarbs += item.carbs;
      totalFat += item.fat;
      totalFiber += item.fiber;
    }

    const insertEntryStmt = this.db.prepare(`
      INSERT INTO entries (id, created_at, date, source, raw_input,
        total_calories, total_protein, total_carbs, total_fat, total_fiber)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItemStmt = this.db.prepare(`
      INSERT INTO items (id, entry_id, name, quantity, calories, protein, carbs, fat, fiber, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const nutritionItems: NutritionItem[] = [];

    const txn = this.db.transaction(() => {
      insertEntryStmt.run(
        entryId,
        now,
        params.date,
        params.source,
        params.rawInput,
        totalCalories,
        totalProtein,
        totalCarbs,
        totalFat,
        totalFiber,
      );

      for (const item of params.items) {
        const itemId = crypto.randomUUID();
        insertItemStmt.run(
          itemId,
          entryId,
          item.name,
          item.quantity,
          item.calories,
          item.protein,
          item.carbs,
          item.fat,
          item.fiber,
          item.confidence,
        );
        nutritionItems.push({ id: itemId, entry_id: entryId, ...item });
      }
    });

    txn();

    return {
      id: entryId,
      created_at: now,
      date: params.date,
      source: params.source,
      raw_input: params.rawInput,
      total_calories: totalCalories,
      total_protein: totalProtein,
      total_carbs: totalCarbs,
      total_fat: totalFat,
      total_fiber: totalFiber,
      items: nutritionItems,
    };
  }

  getEntry(id: string): NutritionEntry | null {
    const row = this.db
      .prepare("SELECT * FROM entries WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const items = this.db
      .prepare("SELECT * FROM items WHERE entry_id = ?")
      .all(id) as NutritionItem[];
    return { ...(row as unknown as Omit<NutritionEntry, "items">), items };
  }

  deleteEntry(id: string): boolean {
    const result = this.db.prepare("DELETE FROM entries WHERE id = ?").run(id);
    return result.changes > 0;
  }

  getEntriesByDateRange(from: string, to: string): NutritionEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM entries WHERE date >= ? AND date <= ? ORDER BY created_at ASC")
      .all(from, to) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const items = this.db
        .prepare("SELECT * FROM items WHERE entry_id = ?")
        .all(row.id as string) as NutritionItem[];
      return { ...(row as unknown as Omit<NutritionEntry, "items">), items };
    });
  }

  // ── Daily summary ─────────────────────────────────────────────────────

  getDailySummary(date: string): DailySummary {
    const entries = this.getEntriesByDateRange(date, date);
    const goals = this.getGoals();

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let totalFiber = 0;

    for (const entry of entries) {
      totalCalories += entry.total_calories;
      totalProtein += entry.total_protein;
      totalCarbs += entry.total_carbs;
      totalFat += entry.total_fat;
      totalFiber += entry.total_fiber;
    }

    return {
      date,
      total_calories: totalCalories,
      total_protein: totalProtein,
      total_carbs: totalCarbs,
      total_fat: totalFat,
      total_fiber: totalFiber,
      entry_count: entries.length,
      entries,
      goals,
    };
  }

  // ── Goals CRUD ────────────────────────────────────────────────────────

  getGoals(): Goals | null {
    const row = this.db
      .prepare("SELECT * FROM goals WHERE id = 'default'")
      .get() as Goals | undefined;
    return row ?? null;
  }

  updateGoals(params: Partial<Omit<Goals, "id" | "updated_at">>): Goals {
    const now = new Date().toISOString();
    const existing = this.getGoals();

    const goals: Goals = {
      id: "default",
      calories: params.calories ?? existing?.calories ?? 2000,
      protein: params.protein ?? existing?.protein ?? 150,
      carbs: params.carbs ?? existing?.carbs ?? 250,
      fat: params.fat ?? existing?.fat ?? 65,
      fiber: params.fiber ?? existing?.fiber ?? 30,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO goals (id, calories, protein, carbs, fat, fiber, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           calories = excluded.calories,
           protein = excluded.protein,
           carbs = excluded.carbs,
           fat = excluded.fat,
           fiber = excluded.fiber,
           updated_at = excluded.updated_at`,
      )
      .run(goals.id, goals.calories, goals.protein, goals.carbs, goals.fat, goals.fiber, now);

    return goals;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _instance: MacroTrackerDb | null = null;

export function getDb(): MacroTrackerDb {
  if (!_instance) {
    _instance = new MacroTrackerDb();
  }
  return _instance;
}

export function getDbForTest(dbPath: string): MacroTrackerDb {
  return new MacroTrackerDb(dbPath);
}
