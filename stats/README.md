# Session Stats Archive (legacy)

This folder used to hold exported session snapshots synced through GitHub. That workflow is retired — the app no longer reads or writes anything here. Everything (current session, rosters, per-player history) now lives in the browser's local storage on whichever device you're using; see `players/README.md` for how data moves between devices via the app's **Backup & Transfer** panel.

The `pool-session-*.json` files already in this folder are a historical record only, kept for reference.

## File format (historical)

Each exported file was a self-contained JSON snapshot:

```json
{
  "exportedAt": "2026-08-31T21:00:00.000Z",
  "raceToWinsTarget": 5,
  "currentGame": { "gameType": "8ball", "target": 1, "mode": "teams" },
  "players": [{ "id": "...", "name": "Bob" }],
  "playerWins": [{ "name": "Bob", "wins": 4 }],
  "teamWins": [{ "members": "Bob & Suresh", "wins": 2 }],
  "gameHistory": [{ "ts": "...", "gameLabel": "8-Ball", "winnerNames": ["Bob"], "summary": "Bob won 8-Ball (target 1)" }]
}
```

The app's **Export Session** button still downloads a snapshot like this for your own reference (e.g. to email standings) — it just no longer gets committed anywhere automatically.
