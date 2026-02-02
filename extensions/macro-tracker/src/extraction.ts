// ── System prompt for LLM nutrition extraction ─────────────────────────────

export const NUTRITION_SYSTEM_PROMPT = [
  "You are a nutrition analysis function.",
  "Given a description of food someone ate, return ONLY a valid JSON object.",
  "Do not wrap in markdown fences. Do not include commentary.",
  "",
  "The JSON must have this exact structure:",
  '{',
  '  "items": [',
  '    {',
  '      "name": "Food name",',
  '      "quantity": "amount and unit (e.g. 2 large, 200g, 1 cup)",',
  '      "calories": <number>,',
  '      "protein": <number in grams>,',
  '      "carbs": <number in grams>,',
  '      "fat": <number in grams>,',
  '      "fiber": <number in grams>,',
  '      "confidence": "high" | "medium" | "low"',
  '    }',
  '  ]',
  '}',
  "",
  "Guidelines:",
  "- Break compound meals into individual items (e.g. burger → bun + patty + cheese + lettuce)",
  "- Use reasonable estimates for home-cooked food",
  "- Set confidence to 'high' for well-known foods with clear quantities",
  "- Set confidence to 'medium' for reasonable estimates",
  "- Set confidence to 'low' for vague descriptions",
  "- All macro values should be in grams (except calories in kcal)",
  "- If quantity is unclear, assume a typical single serving",
  "- Round to reasonable precision (1 decimal place max)",
].join("\n");

// ── Ajv JSON Schema for validation ──────────────────────────────────────────

export const NUTRITION_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1 },
          quantity: { type: "string" },
          calories: { type: "number", minimum: 0 },
          protein: { type: "number", minimum: 0 },
          carbs: { type: "number", minimum: 0 },
          fat: { type: "number", minimum: 0 },
          fiber: { type: "number", minimum: 0 },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "quantity", "calories", "protein", "carbs", "fat", "fiber", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;
