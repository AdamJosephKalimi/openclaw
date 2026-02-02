import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the embedded runner before importing the tool
vi.mock("../../../src/agents/pi-embedded-runner.js", () => {
  return {
    runEmbeddedPiAgent: vi.fn(async () => ({
      meta: { startedAt: Date.now() },
      payloads: [{ text: "{}" }],
    })),
  };
});

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

import { runEmbeddedPiAgent } from "../../../src/agents/pi-embedded-runner.js";
import { createLogNutritionTool } from "./log-nutrition-tool.js";

function fakeApi(overrides: any = {}) {
  return {
    id: "macro-tracker",
    name: "macro-tracker",
    source: "test",
    config: {
      agents: { defaults: { workspace: "/tmp", model: { primary: "openai-codex/gpt-5.2" } } },
    },
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    registerHttpHandler() {},
    registerHttpRoute() {},
    ...overrides,
  };
}

describe("log_nutrition tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macro-tracker-tool-test-"));
    dbPath = path.join(tmpDir, "test.db");
  });

  afterEach(async () => {
    const mod = await import("./db.js");
    (mod as any)._cleanup?.();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts nutrition and stores entry", async () => {
    const mockResponse = {
      items: [
        {
          name: "Scrambled Eggs",
          quantity: "2 large",
          calories: 140,
          protein: 12,
          carbs: 1,
          fat: 10,
          fiber: 0,
          confidence: "high",
        },
        {
          name: "Toast with Butter",
          quantity: "1 slice",
          calories: 120,
          protein: 3,
          carbs: 15,
          fat: 5,
          fiber: 1,
          confidence: "medium",
        },
      ],
    };

    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: JSON.stringify(mockResponse) }],
    });

    const tool = createLogNutritionTool(fakeApi());
    const res = await tool.execute("test-id", {
      description: "Two scrambled eggs and toast with butter",
      date: "2026-01-15",
    });

    expect(res.content[0]!.text).toContain("Logged 2 item(s)");
    expect(res.content[0]!.text).toContain("Scrambled Eggs");
    expect(res.content[0]!.text).toContain("Toast with Butter");
    expect((res.details as any).entry.total_calories).toBe(260);
    expect((res.details as any).entry.total_protein).toBe(15);
    expect((res.details as any).entry.items).toHaveLength(2);
  });

  it("throws on empty description", async () => {
    const tool = createLogNutritionTool(fakeApi());
    await expect(tool.execute("test-id", { description: "" })).rejects.toThrow(
      /description required/i,
    );
  });

  it("throws on invalid LLM JSON", async () => {
    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: "not valid json at all" }],
    });

    const tool = createLogNutritionTool(fakeApi());
    await expect(
      tool.execute("test-id", { description: "some food" }),
    ).rejects.toThrow(/invalid json/i);
  });

  it("throws on schema validation failure", async () => {
    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: JSON.stringify({ items: [{ name: "X" }] }) }],
    });

    const tool = createLogNutritionTool(fakeApi());
    await expect(
      tool.execute("test-id", { description: "some food" }),
    ).rejects.toThrow(/validation/i);
  });

  it("strips code fences from LLM response", async () => {
    const mockResponse = {
      items: [
        {
          name: "Apple",
          quantity: "1 medium",
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
          fiber: 4.4,
          confidence: "high",
        },
      ],
    };

    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: `\`\`\`json\n${JSON.stringify(mockResponse)}\n\`\`\`` }],
    });

    const tool = createLogNutritionTool(fakeApi());
    const res = await tool.execute("test-id", {
      description: "an apple",
      date: "2026-01-15",
    });

    expect(res.content[0]!.text).toContain("Apple");
    expect((res.details as any).entry.total_calories).toBe(95);
  });

  it("defaults date to today if not provided", async () => {
    const mockResponse = {
      items: [
        {
          name: "Banana",
          quantity: "1 medium",
          calories: 105,
          protein: 1.3,
          carbs: 27,
          fat: 0.4,
          fiber: 3.1,
          confidence: "high",
        },
      ],
    };

    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: JSON.stringify(mockResponse) }],
    });

    const tool = createLogNutritionTool(fakeApi());
    const res = await tool.execute("test-id", { description: "a banana" });

    const today = new Date().toISOString().slice(0, 10);
    expect((res.details as any).entry.date).toBe(today);
  });

  it("passes disableTools to embedded runner", async () => {
    const mockResponse = {
      items: [
        {
          name: "Water",
          quantity: "1 glass",
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          confidence: "high",
        },
      ],
    };

    (runEmbeddedPiAgent as any).mockResolvedValueOnce({
      meta: {},
      payloads: [{ text: JSON.stringify(mockResponse) }],
    });

    const tool = createLogNutritionTool(fakeApi());
    await tool.execute("test-id", { description: "a glass of water" });

    const call = (runEmbeddedPiAgent as any).mock.calls[0]?.[0];
    expect(call.disableTools).toBe(true);
  });
});
