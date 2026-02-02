import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MacroTrackerDb } from "./db.js";

let db: MacroTrackerDb;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macro-tracker-test-"));
  db = new MacroTrackerDb(path.join(tmpDir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MacroTrackerDb", () => {
  describe("insertEntry + getEntry", () => {
    it("inserts an entry with items and retrieves it", () => {
      const entry = db.insertEntry({
        date: "2026-01-15",
        source: "voice",
        rawInput: "I had two eggs and toast",
        items: [
          {
            name: "Eggs",
            quantity: "2 large",
            calories: 140,
            protein: 12,
            carbs: 1,
            fat: 10,
            fiber: 0,
            confidence: "high",
          },
          {
            name: "Toast",
            quantity: "1 slice",
            calories: 80,
            protein: 3,
            carbs: 15,
            fat: 1,
            fiber: 1,
            confidence: "medium",
          },
        ],
      });

      expect(entry.id).toBeTruthy();
      expect(entry.date).toBe("2026-01-15");
      expect(entry.total_calories).toBe(220);
      expect(entry.total_protein).toBe(15);
      expect(entry.total_carbs).toBe(16);
      expect(entry.total_fat).toBe(11);
      expect(entry.total_fiber).toBe(1);
      expect(entry.items).toHaveLength(2);
      expect(entry.items[0]!.name).toBe("Eggs");
      expect(entry.items[1]!.name).toBe("Toast");

      const retrieved = db.getEntry(entry.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(entry.id);
      expect(retrieved!.items).toHaveLength(2);
    });

    it("returns null for non-existent entry", () => {
      expect(db.getEntry("non-existent")).toBeNull();
    });
  });

  describe("deleteEntry", () => {
    it("deletes an existing entry and its items", () => {
      const entry = db.insertEntry({
        date: "2026-01-15",
        source: "manual",
        rawInput: "chicken breast",
        items: [
          {
            name: "Chicken Breast",
            quantity: "200g",
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7,
            fiber: 0,
            confidence: "high",
          },
        ],
      });

      expect(db.deleteEntry(entry.id)).toBe(true);
      expect(db.getEntry(entry.id)).toBeNull();
    });

    it("returns false for non-existent entry", () => {
      expect(db.deleteEntry("non-existent")).toBe(false);
    });
  });

  describe("getEntriesByDateRange", () => {
    it("returns entries within date range", () => {
      db.insertEntry({
        date: "2026-01-14",
        source: "manual",
        rawInput: "day before",
        items: [
          {
            name: "Oats",
            quantity: "100g",
            calories: 389,
            protein: 17,
            carbs: 66,
            fat: 7,
            fiber: 11,
            confidence: "high",
          },
        ],
      });
      db.insertEntry({
        date: "2026-01-15",
        source: "manual",
        rawInput: "target day",
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
      db.insertEntry({
        date: "2026-01-16",
        source: "manual",
        rawInput: "day after",
        items: [
          {
            name: "Pasta",
            quantity: "150g",
            calories: 220,
            protein: 8,
            carbs: 43,
            fat: 1.3,
            fiber: 2.5,
            confidence: "medium",
          },
        ],
      });

      const entries = db.getEntriesByDateRange("2026-01-14", "2026-01-15");
      expect(entries).toHaveLength(2);
      expect(entries[0]!.date).toBe("2026-01-14");
      expect(entries[1]!.date).toBe("2026-01-15");
    });
  });

  describe("getDailySummary", () => {
    it("aggregates daily totals", () => {
      db.insertEntry({
        date: "2026-01-15",
        source: "voice",
        rawInput: "breakfast",
        items: [
          {
            name: "Eggs",
            quantity: "3",
            calories: 210,
            protein: 18,
            carbs: 1.5,
            fat: 15,
            fiber: 0,
            confidence: "high",
          },
        ],
      });
      db.insertEntry({
        date: "2026-01-15",
        source: "voice",
        rawInput: "lunch",
        items: [
          {
            name: "Chicken Salad",
            quantity: "1 bowl",
            calories: 350,
            protein: 40,
            carbs: 10,
            fat: 15,
            fiber: 5,
            confidence: "medium",
          },
        ],
      });

      const summary = db.getDailySummary("2026-01-15");
      expect(summary.date).toBe("2026-01-15");
      expect(summary.total_calories).toBe(560);
      expect(summary.total_protein).toBe(58);
      expect(summary.entry_count).toBe(2);
      expect(summary.entries).toHaveLength(2);
    });

    it("returns zero totals for day with no entries", () => {
      const summary = db.getDailySummary("2099-12-31");
      expect(summary.total_calories).toBe(0);
      expect(summary.entry_count).toBe(0);
      expect(summary.entries).toHaveLength(0);
    });
  });

  describe("goals", () => {
    it("returns null when no goals set", () => {
      expect(db.getGoals()).toBeNull();
    });

    it("creates goals with defaults", () => {
      const goals = db.updateGoals({ calories: 2500 });
      expect(goals.calories).toBe(2500);
      expect(goals.protein).toBe(150); // default
      expect(goals.carbs).toBe(250); // default
      expect(goals.fat).toBe(65); // default
      expect(goals.fiber).toBe(30); // default
      expect(goals.updated_at).toBeTruthy();
    });

    it("updates existing goals partially", () => {
      db.updateGoals({ calories: 2500, protein: 180 });
      const updated = db.updateGoals({ protein: 200 });
      expect(updated.calories).toBe(2500); // preserved
      expect(updated.protein).toBe(200); // updated
    });

    it("retrieves goals after setting", () => {
      db.updateGoals({ calories: 1800, protein: 130 });
      const goals = db.getGoals();
      expect(goals).not.toBeNull();
      expect(goals!.calories).toBe(1800);
      expect(goals!.protein).toBe(130);
    });
  });
});
