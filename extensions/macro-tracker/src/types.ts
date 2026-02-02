// ── Nutrition item (individual food within an entry) ────────────────────────
export type NutritionItem = {
  id: string;
  entry_id: string;
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  confidence: "high" | "medium" | "low";
};

// ── Nutrition entry (one logged meal / food description) ────────────────────
export type NutritionEntry = {
  id: string;
  created_at: string;
  date: string; // YYYY-MM-DD
  source: string;
  raw_input: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  total_fiber: number;
  items: NutritionItem[];
};

// ── Daily macro goals ───────────────────────────────────────────────────────
export type Goals = {
  id: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  updated_at: string;
};

// ── LLM extraction output (before DB insertion) ─────────────────────────────
export type ExtractedItem = {
  name: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  confidence: "high" | "medium" | "low";
};

export type ExtractionResult = {
  items: ExtractedItem[];
};

// ── Daily summary ───────────────────────────────────────────────────────────
export type DailySummary = {
  date: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  total_fiber: number;
  entry_count: number;
  entries: NutritionEntry[];
  goals: Goals | null;
};
