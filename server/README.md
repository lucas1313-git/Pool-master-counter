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
[the latest release](https://github.com/lucas1313-git/Pool-master-counter-releases/releases/tag/desktop-latest).

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

## Camera-based player recognition

An optional add-on: a phone mounted over the table watches for players
approaching and tells the scoreboard who's up, via the same relay server.
Group Session works fine without any of this.

Face detection/recognition runs entirely in the phone's browser via
[`@vladmandic/face-api`](https://github.com/vladmandic/face-api) (MIT
license, vendored under `camera/` - see `camera/face-api.LICENSE.txt`),
loading its own model weights from `camera/models/`. Nothing about a
player's face ever leaves the LAN - the relay only ever sees 128-number
face descriptors, not images.

### HTTPS setup (required for the camera page)

iOS Safari refuses `getUserMedia()` (camera access) entirely over plain
HTTP, except on `localhost` - and the phone running the camera page is a
*different device* from the one running this server, so `localhost`
doesn't apply. You need a real TLS cert for the LAN address the camera
phone will use, via [mkcert](https://github.com/FiloSottile/mkcert):

```
brew install mkcert          # macOS; see mkcert's own README for other OSes
mkcert -install              # trusts mkcert's root CA on THIS machine
mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 <your-LAN-IP>
```

Find `<your-LAN-IP>` from this server's own startup log (it's printed
every time), or `ipconfig getifaddr en0` on Mac. Then run the server
pointed at that cert/key:

```
SSL_CERT_PATH=./cert.pem SSL_KEY_PATH=./key.pem PORT=4173 npm start
```

The startup log switches to `https://` URLs (and adds a camera page
link) once it picks up a valid cert/key pair; without them it still
runs, over plain HTTP, with a warning that the camera page won't work.

Two gotchas worth knowing before you rely on this at a real table:

- **A LAN-IP cert breaks the moment DHCP reassigns that address** - most
  home/venue routers keep a device's IP stable for a long time, but it's
  not guaranteed. An mDNS hostname (e.g. `pool-master.local`, via
  `mkcert ... pool-master.local`) is more durable, but depends on
  multicast DNS actually working on that WiFi - some venues run an
  AP-isolated "guest" network that silently breaks mDNS discovery
  between devices. If joining by hostname doesn't work, fall back to the
  IP and re-issue the cert if/when the IP changes.
- **Trusting the cert on the iPhone is a separate, manual, one-time
  step** - `mkcert -install` only trusts the CA on the machine you ran it
  on. To get the *same* CA trusted on the iPhone: AirDrop or email
  yourself the CA file (`mkcert -CAROOT` prints its folder; the file is
  `rootCA.pem`), open it on the iPhone to install it as a profile
  (Settings → Profile Downloaded → Install), **then** go to Settings →
  General → About → Certificate Trust Settings and manually enable full
  trust for it - installing the profile alone isn't enough for Safari to
  accept it. Needed once per iPhone; re-do it only if you regenerate the
  CA itself (not needed when you just re-issue a cert for a new IP).

### Enrolling and recognizing players

Once HTTPS is running, open `https://<lan-ip>:<port>/camera.html` in
Safari **on the phone that will watch the table** (not the tablet
running the scoreboard). It needs camera permission the first time.

- **Enroll a player**: tap the "Enroll players" tab, type the player's
  name **exactly as it appears on the tablet** (matched case-
  insensitively, so "Alice"/"alice" are the same person - but two
  *different* players sharing one name will collide, since this feature
  identifies everyone by name, not the tablet's internal player id),
  then tap "Capture 8 frames" and look at the camera for a few seconds.
  Re-running capture for the same name replaces their enrollment from
  scratch; deleting is a tap-twice-to-confirm button next to their name
  in the same list.
- **Recognize**: switch to the "Recognize" tab (the default) and mount
  the phone - see below. Every confident recognition also quietly adds
  that frame to the player's stored samples, so accuracy keeps improving
  the more the table gets used; nothing further to do.
- **Settings** (gear panel at the bottom): match sensitivity, how many
  consecutive frames must agree before announcing someone, and how long
  to wait before re-announcing the same player. These live in *this
  phone's own browser storage* - first launch pre-fills sensitivity/
  debounce from whatever the tablet has configured in its own Group
  Session/camera settings (fetched once over the relay), but any change
  you make here afterwards takes over and the tablet's value is no
  longer consulted. The debug overlay toggle draws the detected face box,
  matched name, and distance on screen - useful for aiming/adjusting the
  phone, noisy to leave on otherwise.
- Nothing recognized here ever auto-confirms blindly on the tablet: a
  camera match only switches the keypad's selected player (same
  feedback as pressing their number on the physical keypad) when no
  overlay - a win celebration, a settings dialog, etc. - is currently
  open on the tablet, and the tablet's own "📷 Camera player recognition"
  toggle (Settings → Players) has to be on.

### Mounting the phone

- **Power**: plug it in. Continuously running the camera and a
  detection model drains the battery fast - treat this as a fixture, not
  a phone someone might also want to check messages on.
- **Keep Safari in front**: enable Guided Access (Settings →
  Accessibility → Guided Access, then triple-click the side/home button
  once it's mounted) so an accidental tap can't background the page or
  put the phone to sleep mid-session; at minimum, turn off Auto-Lock
  (Settings → Display & Brightness → Auto-Lock → Never) - the page's own
  Wake Lock request helps but isn't supported on every iOS version.
- **Framing**: aim for a roughly front-on view of a player's face as
  they approach the table, not a view of the table itself - the
  detector needs a face, not balls. Test with the debug overlay on
  before leaving it unattended.
