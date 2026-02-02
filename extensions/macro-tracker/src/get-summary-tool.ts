import { Type } from "@sinclair/typebox";
import { getDb } from "./db.js";

export function createGetSummaryTool() {
  return {
    name: "get_nutrition_summary",
    description:
      "Get a nutrition summary for a specific date or date range. Shows total macros, entries, and progress toward goals.",
    parameters: Type.Object({
      date: Type.Optional(
        Type.String({
          description: "Date in YYYY-MM-DD format. Defaults to today.",
        }),
      ),
      from: Type.Optional(
        Type.String({
          description: "Start date for range query (YYYY-MM-DD). If provided, 'to' is also required.",
        }),
      ),
      to: Type.Optional(
        Type.String({
          description: "End date for range query (YYYY-MM-DD).",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const db = getDb();

      const from = typeof params.from === "string" ? params.from.trim() : "";
      const to = typeof params.to === "string" ? params.to.trim() : "";

      // ── Range query ─────────────────────────────────────────────────────
      if (from && to) {
        const entries = db.getEntriesByDateRange(from, to);
        const goals = db.getGoals();

        // Aggregate by date
        const byDate: Record<
          string,
          { calories: number; protein: number; carbs: number; fat: number; fiber: number; count: number }
        > = {};

        for (const entry of entries) {
          if (!byDate[entry.date]) {
            byDate[entry.date] = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, count: 0 };
          }
          const d = byDate[entry.date]!;
          d.calories += entry.total_calories;
          d.protein += entry.total_protein;
          d.carbs += entry.total_carbs;
          d.fat += entry.total_fat;
          d.fiber += entry.total_fiber;
          d.count += 1;
        }

        const days = Object.entries(byDate)
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([date, totals]) => ({ date, ...totals }));

        let totalCalories = 0;
        let totalProtein = 0;
        let totalCarbs = 0;
        let totalFat = 0;
        let totalFiber = 0;

        for (const day of days) {
          totalCalories += day.calories;
          totalProtein += day.protein;
          totalCarbs += day.carbs;
          totalFat += day.fat;
          totalFiber += day.fiber;
        }

        const numDays = days.length || 1;

        const responseText = [
          `📊 Nutrition Summary (${from} to ${to})`,
          `Total entries: ${entries.length} across ${days.length} day(s)`,
          "",
          "Period Totals:",
          `  Calories: ${Math.round(totalCalories)} kcal`,
          `  Protein:  ${Math.round(totalProtein)}g`,
          `  Carbs:    ${Math.round(totalCarbs)}g`,
          `  Fat:      ${Math.round(totalFat)}g`,
          `  Fiber:    ${Math.round(totalFiber)}g`,
          "",
          "Daily Averages:",
          `  Calories: ${Math.round(totalCalories / numDays)} kcal`,
          `  Protein:  ${Math.round(totalProtein / numDays)}g`,
          `  Carbs:    ${Math.round(totalCarbs / numDays)}g`,
          `  Fat:      ${Math.round(totalFat / numDays)}g`,
          `  Fiber:    ${Math.round(totalFiber / numDays)}g`,
        ].join("\n");

        return {
          content: [{ type: "text", text: responseText }],
          details: {
            from,
            to,
            days,
            totals: {
              calories: totalCalories,
              protein: totalProtein,
              carbs: totalCarbs,
              fat: totalFat,
              fiber: totalFiber,
            },
            averages: {
              calories: Math.round(totalCalories / numDays),
              protein: Math.round(totalProtein / numDays),
              carbs: Math.round(totalCarbs / numDays),
              fat: Math.round(totalFat / numDays),
              fiber: Math.round(totalFiber / numDays),
            },
            goals,
          },
        };
      }

      // ── Single day query ────────────────────────────────────────────────
      const date =
        typeof params.date === "string" && params.date.trim()
          ? params.date.trim()
          : new Date().toISOString().slice(0, 10);

      const summary = db.getDailySummary(date);

      const entryLines = summary.entries
        .map((entry, i) => {
          const itemNames = entry.items.map((item) => item.name).join(", ");
          return `  ${i + 1}. ${itemNames} — ${entry.total_calories} cal (${entry.source})`;
        })
        .join("\n");

      const goalLines = summary.goals
        ? [
            "\nGoal Progress:",
            `  Calories: ${summary.total_calories}/${summary.goals.calories} kcal (${Math.round((summary.total_calories / summary.goals.calories) * 100)}%)`,
            `  Protein:  ${summary.total_protein}/${summary.goals.protein}g (${Math.round((summary.total_protein / summary.goals.protein) * 100)}%)`,
            `  Carbs:    ${summary.total_carbs}/${summary.goals.carbs}g (${Math.round((summary.total_carbs / summary.goals.carbs) * 100)}%)`,
            `  Fat:      ${summary.total_fat}/${summary.goals.fat}g (${Math.round((summary.total_fat / summary.goals.fat) * 100)}%)`,
            `  Fiber:    ${summary.total_fiber}/${summary.goals.fiber}g (${Math.round((summary.total_fiber / summary.goals.fiber) * 100)}%)`,
          ].join("\n")
        : "\n(No goals set — use update_nutrition_goals to set targets)";

      const responseText = [
        `📊 Nutrition Summary for ${date}`,
        `Entries: ${summary.entry_count}`,
        "",
        "Daily Totals:",
        `  Calories: ${summary.total_calories} kcal`,
        `  Protein:  ${summary.total_protein}g`,
        `  Carbs:    ${summary.total_carbs}g`,
        `  Fat:      ${summary.total_fat}g`,
        `  Fiber:    ${summary.total_fiber}g`,
        ...(summary.entries.length > 0 ? ["\nEntries:", entryLines] : []),
        goalLines,
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        details: summary,
      };
    },
  };
}
