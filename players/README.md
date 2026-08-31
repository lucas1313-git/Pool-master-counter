# Players Archive

This folder holds saved player rosters and per-player stat history — like `stats/`, these are downloaded by the app and committed manually (a static site can't write to the repo on its own).

## Saved rosters (`rosters.json`)

`rosters.json` is a single file listing every roster you've saved, e.g.:

```json
[
  { "id": "roster-2026-08-31T20-00-00", "label": "Aug 31, 2026 — Bob, Luc, Suresh, Luigi, Bill", "players": ["Bob", "Luc", "Suresh", "Luigi", "Bill"], "savedAt": "2026-08-31T20:00:00.000Z" }
]
```

**When it's offered:** whenever you tap "Reset All Stats" to start a new session, the app compares the current roster to the last saved one. If it's the same group of players, nothing happens — no redundant save. If it's different, it downloads an updated `rosters.json` (your existing entries plus the new one) for you to commit here, replacing the old file.

**Loading a roster:** the "Load Player List" dropdown in the Players panel reads from this file and lets you add a saved group's names back into your current roster in one tap.

## Per-player stats (`<Name>.json`)

Tap the 📊 button next to any player to open their stats popup — it shows this session's numbers plus whatever's in `players/<Name>.json`, if that file exists. Use **Export Stats** in that popup to download an updated file (e.g. `Bob.json`) and commit it here to build up that player's history over time.

```json
{
  "name": "Bob",
  "updatedAt": "2026-08-31T20:00:00.000Z",
  "totalWins": 12,
  "sessionsRecorded": 3
}
```
