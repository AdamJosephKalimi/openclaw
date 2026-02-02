import { Type } from "@sinclair/typebox";
import { getDb } from "./db.js";

export function createUpdateGoalsTool() {
  return {
    name: "update_nutrition_goals",
    description:
      "Set or update daily nutrition goals (calories, protein, carbs, fat, fiber). Only provided values are updated; others are preserved.",
    parameters: Type.Object({
      calories: Type.Optional(
        Type.Number({ description: "Daily calorie target (kcal)." }),
      ),
      protein: Type.Optional(
        Type.Number({ description: "Daily protein target (grams)." }),
      ),
      carbs: Type.Optional(
        Type.Number({ description: "Daily carbohydrate target (grams)." }),
      ),
      fat: Type.Optional(
        Type.Number({ description: "Daily fat target (grams)." }),
      ),
      fiber: Type.Optional(
        Type.Number({ description: "Daily fiber target (grams)." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const updates: Record<string, number> = {};

      for (const key of ["calories", "protein", "carbs", "fat", "fiber"] as const) {
        if (typeof params[key] === "number" && Number.isFinite(params[key] as number)) {
          const val = params[key] as number;
          if (val < 0) {
            throw new Error(`${key} must be non-negative`);
          }
          updates[key] = val;
        }
      }

      if (Object.keys(updates).length === 0) {
        throw new Error("At least one goal value must be provided");
      }

      const db = getDb();
      const goals = db.updateGoals(updates);

      const responseText = [
        "✅ Nutrition goals updated:",
        `  Calories: ${goals.calories} kcal`,
        `  Protein:  ${goals.protein}g`,
        `  Carbs:    ${goals.carbs}g`,
        `  Fat:      ${goals.fat}g`,
        `  Fiber:    ${goals.fiber}g`,
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        details: { goals },
      };
    },
  };
}
