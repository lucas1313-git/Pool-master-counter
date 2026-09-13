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
terminal. It's a single file that starts this same server and opens your
browser to it; nothing gets installed on your computer (no admin rights,
no registry/launchd changes, nothing to uninstall later). Get it from the
app's own Group Session page (it shows a download link once it detects
you're not currently running the relay), or directly from
[the latest release](https://github.com/lucas1313-git/Pool-master-counter/releases/tag/desktop-latest).

It isn't code-signed (no paid developer certificate), so your OS will show
one security warning the first time you run it - that's expected for a
free, independent app:
- **Mac:** right-click the app → Open → Open.
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
