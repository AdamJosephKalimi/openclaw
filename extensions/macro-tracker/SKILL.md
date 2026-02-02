# Macro Tracker

Track nutrition and macros from natural language food descriptions. Log meals via voice or text, view daily progress toward goals, and manage entries through a web dashboard.

## When to use

| User intent | Action |
|---|---|
| "I had two eggs and toast for breakfast" | Call `log_nutrition` with the description |
| "Log a chicken breast with rice" | Call `log_nutrition` |
| "What did I eat today?" | Call `get_nutrition_summary` |
| "Show my macros for this week" | Call `get_nutrition_summary` with from/to dates |
| "Set my calorie goal to 2000" | Call `update_nutrition_goals` |
| "Delete that last entry" | Call `get_nutrition_summary` first to find the ID, then `delete_nutrition_entry` |
| "Open my macro dashboard" | Share the link: `http://localhost:18789/macro-tracker/` |

## Tools

### log_nutrition
Log food from natural language. Extracts structured macro data (calories, protein, carbs, fat, fiber) using LLM analysis.

```json
{
  "description": "Two scrambled eggs with a slice of sourdough toast and butter",
  "date": "2026-01-15",
  "source": "voice"
}
```

- `description` (required): Natural language food description
- `date` (optional): YYYY-MM-DD format, defaults to today
- `source` (optional): "voice", "text", or "manual", defaults to "text"

### get_nutrition_summary
Get nutrition totals and entries for a day or date range.

Single day:
```json
{ "date": "2026-01-15" }
```

Date range:
```json
{ "from": "2026-01-13", "to": "2026-01-19" }
```

### update_nutrition_goals
Set daily nutrition targets. Only provided values are updated.

```json
{
  "calories": 2200,
  "protein": 180,
  "carbs": 250,
  "fat": 70,
  "fiber": 35
}
```

### delete_nutrition_entry
Delete a specific entry by ID. Use `get_nutrition_summary` first to find the ID.

```json
{ "entry_id": "uuid-here" }
```

## Dashboard
Web dashboard at `http://localhost:18789/macro-tracker/` showing:
- Daily macro progress bars with goal tracking
- Doughnut chart for macro breakdown
- Bar chart for calorie trends (day/week/month views)
- Entry list with delete capability
- Goals editor

## Tips
- When a user describes food in a message (especially voice transcriptions), proactively offer to log it
- After logging, show the daily progress summary
- If no goals are set, suggest setting them after the first log
- For vague descriptions ("I had lunch"), ask for more details before logging
- Voice messages often come through as transcriptions — treat them as food descriptions when contextually appropriate
