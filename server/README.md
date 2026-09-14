# Group Session server

Lets a second phone on the same WiFi join and control a live Pool Master
Counter scoring session - no internet, no App Store, nothing installed on
the joining device beyond a browser.

## Run it

```
cd server
npm install
npm start
```

### Prefer not to use the command line?

Download a portable desktop build instead - no git, no Node.js, no
terminal. It starts this same server and opens your browser to it; no
admin rights, no registry changes, nothing to uninstall beyond dragging
one file to the trash. Get it from the app's own Group Session page (it
shows a download link once it detects you're not currently running the
relay), or directly from
[the latest release](https://github.com/lucas1313-git/Pool-master-counter/releases/tag/desktop-latest).

It isn't code-signed (no paid developer certificate), so your OS will show
one security warning the first time you run it - that's expected for a
free, independent app:
- **Mac:** a real `.dmg` disk image - open it and drag Pool Master
  Counter into Applications. First launch only, macOS will say it can't
  verify the app is free of malware (ad-hoc signed, no paid Apple
  developer certificate) - on macOS 15 (Sequoia) and later, right-click →
  Open no longer bypasses this the way it used to; instead open Terminal
  and run `xattr -d com.apple.quarantine /Applications/PoolMasterCounter.app`,
  then open it normally. (Older macOS: right-click the app → Open → Open
  still works.) Launching it opens a Terminal window to run the server in
  - keep that window open while hosting, close it to stop.
- **Windows:** click "More info" → "Run anyway" on the SmartScreen prompt.
- **Linux:** mark the file executable first (`chmod +x`, or via your file
  manager's Properties → Permissions) if it doesn't run directly.

These builds are produced by `installer/` (a separate self-contained
subdirectory, same pattern as this one) via
`.github/workflows/build-desktop.yml`, rebuilt automatically whenever the
app changes on `main`.

The console prints the LAN URL to open on the host device, and the join
URL/QR for everyone else. Both are also shown on the host's own "Group
Session" page in the app once you open it through this server (not a
plain `file://` or other static server - hosting only works when the app
is being served by this relay).

LAN-only, no login, no encryption - meant for a trusted local network
(e.g. the WiFi at a pool hall), not the public internet. Don't port-forward
this.
