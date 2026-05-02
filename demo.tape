# VHS demo — /casecomp multi-card parallel search
# Run: vhs demo.tape

Output demo1.gif

Set Shell zsh
Set FontSize 14
Set Width 1750
Set Height 1000
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set PlaybackSpeed 2.25

# Start Claude Code
Type "claude --dangerously-skip-permissions"
Enter
Sleep 5s

# Type the /casecomp command in natural language
Type "/casecomp Team magma's groudon ex, Team aqua's kyogre ex and Terastal festival Umbreon Ex 217/187 - all japanese, PSA 10 & TAG 10, on ebay and magi"
Sleep 500ms
Enter

# Wait for Claude to finish: parses intent, runs node --parallel,
# reads results.json, renders tables (~60-90s typical + table rendering).
Sleep 120s

# Exit Claude Code
Type "/exit"
Enter
Sleep 1s
