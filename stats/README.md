# Session Stats Archive

This folder holds exported snapshots of past sessions — player names, career/team win counts, and the full game history — so they aren't lost when you reset the app for a new session.

## Workflow

1. Play a session in the app.
2. When you're done, tap **Export Session** (next to Share Standings / Reset All Stats). This downloads a JSON file named like `pool-session-2026-08-31.json`.
3. Add that file to this folder — either drag it into `stats/` on GitHub's website (Add file → Upload files) and commit, or hand it to Claude to commit for you.
4. Tap **Reset All Stats** in the app to start the next session with a clean slate.

## File format

Each exported file is a self-contained JSON snapshot:

```json
{
  "exportedAt": "2026-08-31T21:00:00.000Z",
  "raceToWinsTarget": 5,
  "currentGame": { "gameType": "8ball", "target": 1, "mode": "teams" },
  "players": [{ "id": "...", "name": "Bob" }],
  "playerWins": [{ "name": "Bob", "wins": 4 }],
  "teamWins": [{ "members": "Bob & Suresh", "wins": 2 }],
  "gameHistory": ["Bob won 8-Ball (target 1)", "..."]
}
```

Player names are resolved inline (not just IDs), so each file reads standalone — no need to cross-reference against the live app.
