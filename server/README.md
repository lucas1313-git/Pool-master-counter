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

The console prints the LAN URL to open on the host device, and the join
URL/QR for everyone else. Both are also shown on the host's own "Group
Session" page in the app once you open it through this server (not a
plain `file://` or other static server - hosting only works when the app
is being served by this relay).

LAN-only, no login, no encryption - meant for a trusted local network
(e.g. the WiFi at a pool hall), not the public internet. Don't port-forward
this.
