# Casecomp Extension Theme

Drop-in replacements for the existing Chrome extension styles. **No HTML or JS changes required** — every original class name is preserved.

## Files

- `popup/popup.css` → replace `extension/popup/popup.css`
- `dashboard/dashboard.css` → replace `extension/dashboard/dashboard.css`

## What changed

Dark "graded slab" aesthetic — premium collector meets drop hunter:

- **Ink** background `#0c0d1a` with subtle holo glow at top
- **Slab** card surfaces (`#16182a` / `#1c1e33` / `#25273f`) with hairline borders
- **Holo purple** primary `#a374ff → #c79bff` (matches existing logo)
- **Foil gold** accent `#d6b25a` — used as hairline highlights on cards (the "graded slab" line)
- **Bone** text `#f1ecdc` — warmer than pure white, like a card label

Status colors are tuned for the Pokémon-card-on-velvet vibe rather than UI default red/green:
- waiting `#d6b25a` · detected `#8db4ff` · through `#5cd99a`
- joined `#e89c4d` · captcha `#e35b5b` · atc-success `#5cd99a`
- discord-intel `#c79bff` · new-listing `#d6b25a`

Typography: **Space Grotesk** (display) / **Inter Tight** (body) / **JetBrains Mono** (timestamps, badges, status pills) — load via system font fallbacks already, but for best results add to the popup/dashboard `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

(Optional — falls back gracefully to system fonts. Loading remote fonts in an extension popup adds a small first-paint flicker; if you don't want that, ship the .woff2 files locally and reference via `chrome.runtime.getURL`.)

## Install

```bash
cp -r popup/popup.css     /Users/knambiar/Code/Personal/casecomp/extension/popup/popup.css
cp -r dashboard/dashboard.css /Users/knambiar/Code/Personal/casecomp/extension/dashboard/dashboard.css
```

Then reload the unpacked extension at `chrome://extensions`.
