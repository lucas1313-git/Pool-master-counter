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

**The easiest way to set this up is the in-app wizards, not the manual
steps below** - once the relay is running, tap "🧙 Set Up Camera" in the
tablet's Settings → Players panel for a guided link/QR code to the second
phone, and that phone's own `camera.html` walks through the rest (camera
permission, table calibration, enrollment, mounting) on its own first
visit, or anytime via "🧙 Re-run Setup Wizard" in its Settings panel. The
rest of this section is the manual/reference version of the same steps,
useful if you want to understand what the wizards are actually doing or
need to do one of them outside the guided flow.

**This identifies players by clothing/body appearance and a "bent over the
table" stance, not faces** - at a real table, a player's face usually
isn't visible to a camera mounted to watch the table, even on approach.
Pose detection runs entirely in the phone's browser via
[`@tensorflow-models/pose-detection`](https://github.com/tensorflow/tfjs-models/tree/master/pose-detection)
(MoveNet) and [`@tensorflow/tfjs`](https://github.com/tensorflow/tfjs)
(Apache 2.0, vendored under `camera/` - see `camera/tfjs.LICENSE.txt`),
loading its own model weights from `camera/models/`. Nothing leaves the
LAN - the relay only ever sees small arrays of numbers (color-histogram
"descriptors"), never images.

**Be realistic about what this is**: a coarse heuristic, not a precise
system. It confuses two players in very similar clothing, it only
recognizes *today's* outfit (clothing isn't a stable identity signal the
way a face would be - re-enrollment is a normal start-of-session step, not
a bug), and several thresholds need tuning on-site against the debug
overlay before it's reliable at your actual table and lighting. It will
never be as reliable as face recognition would have been if that had
been usable here.

### HTTPS setup (required for the camera page)

iOS Safari refuses `getUserMedia()` (camera access) entirely over plain
HTTP, except on `localhost` - and the phone running the camera page is a
*different device* from the one running this server, so `localhost`
doesn't apply. There are two ways to get HTTPS, depending on which way
you're running the relay:

**Using the desktop app** (see "Prefer not to use the command line?"
above): nothing to do. It generates its own self-signed certificate
automatically on first launch and serves the camera page over HTTPS on
its own port (one more than the port it prints for everything else - the
startup log prints the exact URL to use). The one unavoidable step: the
first time a phone visits that URL, Safari shows a "This Connection Is
Not Private" warning, since nobody vouches for a self-signed cert - tap
"Show Details" → "visit this website" once, and from then on it behaves
like any other HTTPS page. No mkcert, no terminal, no root CA to export.
Local/LAN use of everything else (Group Session, just scoring on this
machine) is completely unaffected - still plain HTTP on the original port,
exactly as before.

**Using `server/server.js` from a terminal**: since you're already past
needing a GUI-only path, use a real CA-backed cert via
[mkcert](https://github.com/FiloSottile/mkcert) instead - no "untrusted
certificate" warning on the phone at all, at the cost of a bit more setup:

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

### Calibrating the table (optional, do this first)

Tap the "Table" tab, pick your table size (7/8/9/10-foot, snooker, or
custom inches), then tap "Detect table automatically" with the **whole
table visible and empty** - no balls, rack, or cue on it. It finds the
felt by color and works out the 4 corners itself; no tapping needed.

This is the most fragile part of the whole feature - it's looking for the
largest region of a plausible felt color (green, blue, burgundy/red, or
grey) filling a sensible but not overwhelming portion of the frame.
Expect it to fail outright on an unusual felt color, bad lighting, glare,
or anything left sitting on the table, rather than silently calibrating
against the wrong thing - if it can't find a clear match, or the match
looks suspiciously like it ate the whole frame (a wall, say), it says so
instead of guessing. If it won't cooperate, tap "Calibrate manually
instead" and tap the table's 4 playing-surface corners on the live feed
yourself, in order around the rectangle, after confirming whether your
first-to-second tap traces the short end or the long side.

Either way, this gives the camera real measurements, so "is this person
close enough to the table to be shooting" becomes an actual calibrated
distance from the rails rather than a guessed pixel threshold - and it
works correctly from every side of the table, not just whichever one is
closest to the camera. Saved to this phone's own storage; survives
"Clear all enrollments" below. Skipping this entirely is fine too -
recognition still runs, just without that distance check (it always
passes) and without side-coverage tracking (see below).

### Enrolling and recognizing players

Once HTTPS is running, open `https://<lan-ip>:<port>/camera.html` in
Safari **on the phone that will watch the table** (not the tablet
running the scoreboard). It needs camera permission the first time.

- **Enroll a player, at the start of each session**: either tap the
  "Enroll" tab, type the player's name **exactly as it appears on the
  tablet** (matched case-insensitively, so "Alice"/"alice" are the same
  person - but two *different* players sharing one name will collide,
  and two players in very similar clothing may be confused for each
  other, since this identifies clothing, not faces), then tap "Capture 8
  samples" and stand normally facing the camera for a few seconds - *or
  just skip straight to playing*, see the next point. Re-running capture
  for the same name replaces their enrollment from scratch; deleting is a
  tap-twice-to-confirm button next to their name in the same list.
- **Or let normal play enroll players for you**: every time the operator
  scores a real point on the tablet (not a foul/undo/correction - only a
  genuine +1 counts), that confirms who the camera's current candidate
  appearance belongs to, automatically - no separate enrollment ritual
  needed at all. This only works for individual/teams games, not
  tournament mode, in this version. **Have each player take their first
  few shots from a different side of the table** - the Enroll tab shows
  "N/4 sides" per player (once the Table tab is calibrated) and an overall
  "still bootstrapping" vs. "ready" status, so you can see when everyone
  has enough coverage to rely on. This supplements manual enrollment, it
  doesn't replace it - do either, or both.
- **Start a new session**: tap "Clear all (new session)" at the bottom of
  the Enroll tab before re-enrolling everyone (manually or by play). Do
  this every time players' clothes have changed since the last time this
  was set up - typically every day - since a color-based appearance match
  from yesterday's outfit won't match today's.
- **Recognize**: switch to the "Recognize" tab (the default) and mount
  the phone - see below. It identifies a player while they're upright and
  approaching, then confirms the actual event only once they're also bent
  over in a shooting stance (not just standing nearby) - both signals
  come from the same on-device pose detection. Every confident recognition
  also quietly adds that frame to the player's stored samples, so accuracy
  keeps improving over the course of a session; nothing further to do.
- **Settings** (gear panel at the bottom): appearance match distance, the
  bent-over angle thresholds (two values, for stability - stance has to
  clearly commit to bending before it counts, and clearly commit back to
  upright before it resets), consecutive-frame and debounce timing, and
  the max distance from the rail (needs the Table tab calibrated to mean
  anything). All of this needs **on-site tuning** - watch the debug
  overlay (draws the detected body box, stance, angle, and best-guess
  match/distance) while adjusting, don't trust the shipped defaults as
  final. These live in *this phone's own browser storage* - first launch
  pre-fills match distance/debounce from whatever the tablet has
  configured in its own camera settings (fetched once over the relay),
  but any change you make here afterwards takes over.
- **Known rough edges**: with only one person tracked at a time, the
  moment players swap turns (the outgoing player still near the table
  while the incoming one approaches) is the single most likely time for a
  mismatch - there's no fix for this short of tracking multiple people at
  once, which this doesn't do yet. If the camera never gets a confident
  upright identification before someone bends over (bad lighting, standing
  side-on), it falls back to matching the bent-over frame itself at a
  stricter threshold rather than guessing wildly - expect this fallback
  path to be the least reliable one. Auto-enrollment-from-scoring never
  fires during tournament mode (it hooks the regular scoring function,
  which tournament mode doesn't use) - enroll those players manually.
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
