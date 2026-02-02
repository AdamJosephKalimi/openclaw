import { Type } from "@sinclair/typebox";
import { getDb } from "./db.js";

export function createDeleteEntryTool() {
  return {
    name: "delete_nutrition_entry",
    description:
      "Delete a specific nutrition entry by its ID. Use get_nutrition_summary first to find entry IDs.",
    parameters: Type.Object({
      entry_id: Type.String({
        description: "The UUID of the nutrition entry to delete.",
      }),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const entryId = typeof params.entry_id === "string" ? params.entry_id.trim() : "";
      if (!entryId) {
        throw new Error("entry_id required");
      }

      const db = getDb();

      // Get entry details before deleting (for the response)
      const entry = db.getEntry(entryId);
      if (!entry) {
        throw new Error(`Entry not found: ${entryId}`);
      }

      const deleted = db.deleteEntry(entryId);
      if (!deleted) {
        throw new Error(`Failed to delete entry: ${entryId}`);
      }

      const itemNames = entry.items.map((item) => item.name).join(", ");

      const responseText = [
        `🗑️ Deleted nutrition entry:`,
        `  Date: ${entry.date}`,
        `  Items: ${itemNames}`,
        `  Total: ${entry.total_calories} cal, ${entry.total_protein}g protein`,
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        details: { deleted: true, entry },
      };
    },
  };
}
