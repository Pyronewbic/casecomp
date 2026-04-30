# VHS demo — /casecomp multi-card parallel search
# Run: vhs demo.tape

Output demo.gif

Set Shell zsh
Set FontSize 14
Set Width 1400
Set Height 800
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set PlaybackSpeed 2

# Start Claude Code
Type "claude --dangerously-skip-permissions"
Enter
Sleep 5s

# Type the /casecomp command in natural language
Type "/casecomp refresh cache and show me the last 5 results each for Team magma's groudon ex, Team aqua's kyogre ex and Terastal festival Umbreon Ex 217/187 - all japanese and PSA 10, as well as last 5 sold results for each"
Sleep 500ms
Enter

# Claude parses intent, shows confirmation, runs a single node process
# with --parallel. Real eBay API calls + Playwright scraping happen here.
# One process, 3 concurrent Playwright browsers (~30s total).
# Then Claude reads results.json and renders summary tables.
Sleep 150s

# Scroll slowly through the full output:
# - confirmation lines (what Claude understood)
# - Bash tool call showing live node logs (OAuth, Browse, Playwright scrape)
# - 3 active-listing tables (one per card)
# - 3 sold tables
# - eBay usage counter


# Exit Claude Code
Type "/exit"
Enter
Sleep 1s
