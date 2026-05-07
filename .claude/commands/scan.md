# /scan — Pokemon TCG event & release scanner

Search public sources for upcoming events, release dates, pre-orders, and restocks.

## Input

The user writes a **set name or card name** after `/scan`.

### Example inputs → CLI mapping

| User says | You run |
|-----------|---------|
| `Terastal Festival` | `node scan.js "Terastal Festival"` |
| `Ninja Spinner` | `node scan.js "Ninja Spinner"` |
| `Charizard ex, only pokebeach` | `node scan.js --source pokebeach "Charizard ex"` |
| `Prismatic Evolutions restocks` | `node scan.js "Prismatic Evolutions"` |
| `Surging Sparks and Twilight Masquerade` | `node scan.js "Surging Sparks" "Twilight Masquerade"` |

### How to extract fields

| What to detect | CLI flag | Default | Signals |
|----------------|----------|---------|---------|
| Set/card name(s) | positional `"..."` args | *(required — ask if missing)* | The main noun phrase. Comma-separated = multiple queries. |
| Source filter | `--source` | all | "only pokebeach", "api only", "pokemon.com only" → `api`, `pokebeach`, or `pokemon` |
| Result limit | `--limit` | `10` | "top 5", "3 results", "show 20" |

### Ambiguity rules

- If the user says "events" or "releases" without a specific name, ask which set or card they mean.
- Strip filler words like "restocks for", "when does", "any news about" — just extract the set/card name.
- Multiple set names separated by commas or "and" → pass each as a separate positional arg.

## Execution

1. **Show what you understood.** Before running, print:
   `Scanning: "<query>" | source: all | limit: 10`

2. **Run the command** from the repo root via Bash. Timeout 120000ms.

3. **Relay stdout directly.** The script prints formatted markdown tables. Relay verbatim.

ARGUMENTS: $ARGUMENTS
