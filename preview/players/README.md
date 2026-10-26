# Players (legacy)

As of the "Backup & Transfer" update, the app no longer reads or writes files in this folder. Saved rosters and per-player stat history now live entirely in the browser's local storage on whichever device you're using.

The files still sitting here (`rosters.json`, individual `<Name>.json` files) are a historical snapshot from when the app synced through this repo. The first time a device loads the updated app, it does a one-time migration: it fetches whatever's in this folder and seeds local storage with it, then never touches the repo again. After that, this folder is inert — new games, rosters, and stats don't get written back here.

## Moving data between devices

Use the **Backup & Transfer** panel at the top of the app:

- **Export All Data** downloads a single JSON file with your current session, saved rosters, and every player's full stat history.
- **Import Data** on another device (or after clearing this one) loads that file back in, replacing whatever's currently stored locally.

There's no automatic sync between devices — moving the exported file over (AirDrop, email, cloud drive, whatever's convenient) is what keeps them in sync.
