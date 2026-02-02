import { Type } from "@sinclair/typebox";
import Ajv from "ajv";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { getDb } from "./db.js";
import { NUTRITION_EXTRACTION_SCHEMA, NUTRITION_SYSTEM_PROMPT } from "./extraction.js";
import type { ExtractionResult } from "./types.js";

// ── Dynamic import for embedded LLM runner (same pattern as llm-task) ───────

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<unknown>;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  // Source checkout (tests/dev)
  try {
    const mod = await import("../../../src/agents/pi-embedded-runner.js");
    if (typeof (mod as any).runEmbeddedPiAgent === "function") {
      return (mod as any).runEmbeddedPiAgent;
    }
  } catch {
    // ignore
  }

  // Bundled install (built)
  const mod = await import("../../../agents/pi-embedded-runner.js");
  if (typeof mod.runEmbeddedPiAgent !== "function") {
    throw new Error("Internal error: runEmbeddedPiAgent not available");
  }
  return mod.runEmbeddedPiAgent;
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) {
    return (m[1] ?? "").trim();
  }
  return trimmed;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  const texts = (payloads ?? [])
    .filter((p) => !p.isError && typeof p.text === "string")
    .map((p) => p.text ?? "");
  return texts.join("\n").trim();
}

// ── Tool factory ────────────────────────────────────────────────────────────

export function createLogNutritionTool(api: OpenClawPluginApi) {
  return {
    name: "log_nutrition",
    description:
      "Log food/nutrition from a natural language description. Uses LLM to extract structured macro data (calories, protein, carbs, fat, fiber) and stores it in the tracker database. Returns a summary of what was logged plus daily progress toward goals.",
    parameters: Type.Object({
      description: Type.String({
        description:
          "Natural language description of food eaten (e.g. 'I had two eggs and a slice of toast with butter for breakfast')",
      }),
      date: Type.Optional(
        Type.String({
          description: "Date in YYYY-MM-DD format. Defaults to today.",
        }),
      ),
      source: Type.Optional(
        Type.String({
          description: "Source of the entry (e.g. 'voice', 'text', 'manual'). Defaults to 'text'.",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const description = typeof params.description === "string" ? params.description.trim() : "";
      if (!description) {
        throw new Error("description required");
      }

      const date =
        typeof params.date === "string" && params.date.trim()
          ? params.date.trim()
          : new Date().toISOString().slice(0, 10);

      const source =
        typeof params.source === "string" && params.source.trim()
          ? params.source.trim()
          : "text";

      // ── Resolve model (same pattern as llm-task) ────────────────────────
      const primary = api.config?.agents?.defaults?.model?.primary;
      const primaryProvider = typeof primary === "string" ? primary.split("/")[0] : undefined;
      const primaryModel =
        typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined;

      const provider = primaryProvider;
      const model = primaryModel;

      if (!provider || !model) {
        throw new Error("No model configured — cannot extract nutrition data");
      }

      // ── Run embedded LLM ────────────────────────────────────────────────
      const fullPrompt = `${NUTRITION_SYSTEM_PROMPT}\n\nFOOD DESCRIPTION:\n${description}\n`;

      let tmpDir: string | null = null;
      try {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-macro-tracker-"));
        const sessionId = `macro-tracker-${Date.now()}`;
        const sessionFile = path.join(tmpDir, "session.json");

        const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

        const result = await runEmbeddedPiAgent({
          sessionId,
          sessionFile,
          workspaceDir: api.config?.agents?.defaults?.workspace ?? process.cwd(),
          config: api.config,
          prompt: fullPrompt,
          timeoutMs: 30_000,
          runId: `macro-tracker-${Date.now()}`,
          provider,
          model,
          disableTools: true,
        });

        const text = collectText((result as any).payloads);
        if (!text) {
          throw new Error("LLM returned empty output for nutrition extraction");
        }

        // ── Parse + validate ────────────────────────────────────────────
        const raw = stripCodeFences(text);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error("LLM returned invalid JSON for nutrition extraction");
        }

        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(NUTRITION_EXTRACTION_SCHEMA);
        const ok = validate(parsed);
        if (!ok) {
          const msg =
            validate.errors
              ?.map((e) => `${e.instancePath || "<root>"} ${e.message || "invalid"}`)
              .join("; ") ?? "invalid";
          throw new Error(`Nutrition extraction failed validation: ${msg}`);
        }

        const extraction = parsed as ExtractionResult;

        // ── Insert into DB ──────────────────────────────────────────────
        const db = getDb();
        const entry = db.insertEntry({
          date,
          source,
          rawInput: description,
          items: extraction.items,
        });

        // ── Build summary response ──────────────────────────────────────
        const summary = db.getDailySummary(date);

        const itemLines = entry.items
          .map(
            (item) =>
              `  • ${item.name} (${item.quantity}): ${item.calories} cal, ${item.protein}g protein, ${item.carbs}g carbs, ${item.fat}g fat, ${item.fiber}g fiber [${item.confidence}]`,
          )
          .join("\n");

        const goalProgress = summary.goals
          ? [
              `\nDaily Progress (${date}):`,
              `  Calories: ${summary.total_calories}/${summary.goals.calories} kcal (${Math.round((summary.total_calories / summary.goals.calories) * 100)}%)`,
              `  Protein:  ${summary.total_protein}/${summary.goals.protein}g (${Math.round((summary.total_protein / summary.goals.protein) * 100)}%)`,
              `  Carbs:    ${summary.total_carbs}/${summary.goals.carbs}g (${Math.round((summary.total_carbs / summary.goals.carbs) * 100)}%)`,
              `  Fat:      ${summary.total_fat}/${summary.goals.fat}g (${Math.round((summary.total_fat / summary.goals.fat) * 100)}%)`,
              `  Fiber:    ${summary.total_fiber}/${summary.goals.fiber}g (${Math.round((summary.total_fiber / summary.goals.fiber) * 100)}%)`,
            ].join("\n")
          : `\nDaily Totals (${date}): ${summary.total_calories} cal, ${summary.total_protein}g protein, ${summary.total_carbs}g carbs, ${summary.total_fat}g fat, ${summary.total_fiber}g fiber`;

        const responseText = [
          `✅ Logged ${entry.items.length} item(s):`,
          itemLines,
          `\nEntry total: ${entry.total_calories} cal, ${entry.total_protein}g protein, ${entry.total_carbs}g carbs, ${entry.total_fat}g fat`,
          goalProgress,
        ].join("\n");

        return {
          content: [{ type: "text", text: responseText }],
          details: { entry, dailySummary: summary },
        };
      } finally {
        if (tmpDir) {
          try {
            await fs.rm(tmpDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      }
    },
  };
}
