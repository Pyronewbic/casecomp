# Casecomp — Chrome Extension

Queue auto-join and drop intelligence for Pokemon TCG product releases across Pokemon Center, Walmart, and Costco.

## Install

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**, press `Cmd+Shift+G`, paste the path to this `extension/` directory
4. Click the extension icon to open the popup

## How it works

**Paste a product URL** in the popup or dashboard Targets tab. The extension:

1. Opens the page in a background tab
2. Monitors for queue activation (Incapsula, Queue-it, PerimeterX)
3. Auto-joins the queue when detected
4. Sends desktop notifications on status changes (joined, through, captcha, ATC)

Sites are auto-armed based on your target URLs — no manual site toggles needed.

## Popup

Single-view layout:
- **Header** — master on/off toggle, live stats (best position, next ETA, today's events, target count)
- **Targets** — paste URLs, each shows site icon + live status pill (armed/through/waiting/captcha)
- **Recent Activity** — grouped log with source codes and product slugs
- **Settings** (gear icon) — auto-join, auto-ATC, sound alerts, notifications

## Dashboard

Full-page view opened from the popup. Tabbed layout:

| Tab | Purpose |
|---|---|
| **Workers** | Live site feed with KPI bar, site groups with expandable entries |
| **Targets** | Add/remove/pause target URLs with status and site icons |
| **News Monitor** | Intel from Discord, X.com, and Reddit with per-source cards |
| **History** | Archived log entries from removed targets |
| **Logs** | Raw log table (live + archived) with tab IDs and timestamps |

### News Monitor sources

- **Discord** — content script watches configured channels for keyword matches
- **X.com** — content script scans tweets on your feed for keyword matches
- **Reddit** — background poller hits configured subreddits every 3 minutes (default: `r/PKMNTCGDeals`, `r/PokemonTCG`)

All three sources share the same **Keywords** list configured in the News Monitor tab.

## Supported sites

| Site | Detection | Content script |
|---|---|---|
| Pokemon Center US | Incapsula iframe + `#ttw` countdown | `pokemon-center.js` |
| Pokemon Center JP | Incapsula + lottery (抽選) detection | `pokemon-center-jp.js` |
| Walmart | Queue-it `?qpdata=` + `validateTickets` | `walmart.js` |
| Costco | Incapsula iframe + `#ttw` | `costco.js` |
| Discord | MutationObserver on chat messages | `discord.js` |
| X.com | Tweet scanning via `data-testid` selectors | `x.js` |

## Testing

```bash
node extension/test/server.js
```

Serves simulated queue pages at `http://localhost:3099` — Pokemon Center, Walmart, Costco, Queue-it, and PerimeterX captcha scenarios.

## Theme

"Trading Floor" dark theme with foil-gold and holographic accents:

- **Fonts** — Space Grotesk (display), Inter Tight (body), JetBrains Mono (mono), Fraunces (serif accents)
- **Colors** — ink black backgrounds, warm paper text, foil gold accents, holo gradients for emphasis
- **Status palette** — through (green), waiting (cyan), detected (amber), captcha (red pulse), intel (purple)

## File structure

```
extension/
  manifest.json
  background.js
  popup/          — popup.html, popup.js, popup.css
  dashboard/      — dashboard.html, dashboard.js, dashboard.css
  content/
    queue-monitor.js
    sites/        — pokemon-center.js, pokemon-center-jp.js, walmart.js,
                    walmart-inject.js, costco.js, discord.js, x.js,
                    pokemon-center-listings.js
  icons/          — icon16.png, icon48.png, icon128.png
  test/           — server.js, harness.html, simulated queue pages
```
