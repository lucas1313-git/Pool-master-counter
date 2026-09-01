# Players Archive

This folder holds saved player rosters and per-player stat history.

**Saving to this folder:** if you connect a GitHub token in the app's **GitHub Sync** panel (top of the page), rosters and player stats are written straight here via the GitHub API — no manual step needed. Without a token (or if the API write fails), the app falls back to downloading the file for you to commit manually. See `stats/README.md` for full details on connecting a token.

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

Tap the 📊 button next to any player to open their **stats page** — it shows today's live session (wins, which games they won, who they played) plus their full saved session history from `players/<Name>.json`, if that file exists.

```json
{
  "name": "Bob",
  "sessions": [
    {
      "date": "2026-08-31",
      "wins": 4,
      "gamesWon": ["8-Ball", "9-Ball", "8-Ball", "Straight Pool"],
      "opponents": ["Luc", "Suresh"],
      "wonTournament": true
    }
  ]
}
```

- **wonTournament** is true if that day's win count reached the race-to milestone at least once.
- **Export Stats** on the page adds/updates today's entry (keyed by date — exporting again the same day overwrites that day's row rather than duplicating it) and downloads the updated file for you to commit.
- **Reset Stats** downloads an emptied `sessions: []` file — it only clears saved history, never today's live session.
