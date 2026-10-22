# Camera protocol - the contract between a recognition app and the scoreboard

**Version 1** - 2026-10-22. Written down from what `camera.html`, `server/camera-relay.js` and
`js/camera-client.js` actually do today, so that **any** recognition app - the camera page, a
native iPad app with an external Brio, a program on the Mac - can drive the scoreboard by speaking
it. The scoreboard can't tell which one it's talking to.

The rule behind it: **only processed information crosses** - names, events, counts, colours. The
video stays inside the recognition app (the two optional exceptions are listed under
[Privacy](#privacy)).

---

## 1. Who talks to whom

```
 recognition app ──(role "camera")──┐
                                     ├──  local server: /ws-camera  ──(role "listener")── scoreboard
 remote view (optional) ─(role "viewer")─┘
```

- **The local server** (`server/camera-relay.js`, inside the desktop app) is a relay: it forwards
  messages between the three roles and keeps one shared store of enrollment samples. It has no
  login and works on the local network only.
- **Same device** - the camera page running inside the scoreboard (an iframe) - uses the very same
  message objects through `window.postMessage` instead of the server (no `hello`; the enrollment
  messages are handled locally). A native module inside the iOS app would do the same through the
  app's JavaScript bridge.

## 2. Connecting

| | |
|---|---|
| URL | `ws://<computer>:4173/ws-camera`, or `wss://<computer>:4174/ws-camera` (the desktop app serves http on 4173 and https on 4174) |
| Frames | JSON text, one message per frame, every message has a `type` |
| First message | `{ "type": "hello", "role": "camera" }` |
| Lost connection | reconnect every few seconds; say `hello` again |

On iOS/iPadOS a native app needs `NSAllowsLocalNetworking` (App Transport Security) for `ws://` to a
local address, and `NSLocalNetworkUsageDescription`; for `wss://` it has to accept the server's own
certificate.

### Names, not ids

Players are always identified by **name** - the scoreboard's internal ids never leave it. Names are
matched **case-insensitively, trimmed**. Only use names the scoreboard sent (see `roster`). A shot
for someone who isn't marked **Playing** is ignored (and the scoreboard says so in its camera log).

---

## 3. What a recognition app MUST send

### `player_up` - a shot, and who took it
```json
{ "type": "player_up", "player_name": "Alex", "confidence": 0.82, "certainty": 0.91, "ts": 1792200000000 }
```
- `certainty` (0-1): how sure the app is who it is. `confidence` (0-1): how close the look was
  (older field, still sent). `ts`: milliseconds since 1970.
- **The scoreboard** selects that player (as if their number had been pressed), starts the game's
  clock if it hasn't started, and plays the switch sound. It **speaks** "Alex shooting" only while
  a camera debug box is ticked, or in Straight Pool when `certainty` is at least 0.8. If it can't
  select (recognition off, a window open, no such name, not Playing) it notes why.
- Send once per shot. Repeats for the same player are expected no sooner than the scoreboard's
  "re-announce after" setting (`debounceSec`, default 10 s) unless someone else shot in between.

### `player-states` - each player's camera icon on the score cards
```json
{ "type": "player-states", "states": { "Alex": "recognized", "Sam": "suspected", "Kim": "located" } }
```
- `recognized` (green) - known by how they look; `suspected` (yellow) - someone in view is taken
  for them by extrapolation (followed along their path, a near match, a guess); `located` (blue) -
  out of view, but the app has an idea where. Anyone not listed: light grey.
- Send **the whole set** whenever it changes, **and at least every 3 s anyway**: the scoreboard
  greys every icon when it hears nothing for 10 s (that's how it knows the camera stopped).
- Since 2026-10-16 a colour doesn't fade with time: it holds while recognition is on for that
  player, and starts over when they're benched or their samples are cleared.

### `camera-status` - the three status lights
```json
{ "type": "camera-status", "status": { "link": "connected", "models": "ready", "camera": "active" } }
```
| light | codes |
|---|---|
| `link` | `connecting`, `connected`, `disconnected`, `same-device` |
| `models` | `loading`, `ready`, `failed` |
| `camera` | `starting`, `active`, `stopped`, `error` |

Send on connect and on every change.

---

## 4. What it SHOULD send

| message | fields | what the scoreboard does with it |
|---|---|---|
| `candidate` | `player_name` (or null), `stance` (`upright`/`bent`), `angle`, `closestName`, `closestDistance`, `matchThreshold`, `rawPoseConfidence`, `keypointConfFloor`, `tooFarFromRail`, `flashingName`, `needsConfirmationName` | "who the camera sees right now", every frame (3-4 a second). Drives the camera line in Visual Scoring, the debug log, and - when someone is bent over with no name - the **"Select player from keypad"** banner and the red **?** on `needsConfirmationName`'s card (both shown once the situation has held 1 s, kept at least 3 s). |
| `ball_pocketed` | `count`, `scratch` (bool), `objectRemaining`, `ts` | **Straight Pool with ball tracking on:** credits the selected player `+count` (a scratch: `-1`) and says so. Send only once the table has been still for the confirmation passes after a shot. |
| `ball_rerack`, `ball_reappeared` | `count`, `objectRemaining`, `ts` | a notice only - never a credit. |
| `cue_event` | `event` (`detected`/`gone`/`fewer`/`shooter`/`no-shooter`), `lengthIn`, `count`, `player_name`, `via`, `resent`, `ts` | the Cue debug mode's log and voice. |
| `enroll-result` | `ok`, `reason`, `undone`, `player_name`, `kind`, `total` | the answer to a number-pad press (see `enroll-press`): a sound and a short notice. |
| `enroll-pressed` | `player_name`, `kind` (`identify`/`shooting`) | any Identify / Shooting sample however it was taken: that player's score card border flashes (once for seen, twice for shooting). |
| `enrollment-updated` | `player_name` | a "+" by that player's camera icon for 4 s - fresh samples just landed. |
| `camera-settings-state` | `settings: { key: value }` | what the app is using, shown in Visual Scoring > Capture Settings. Keys the scoreboard knows: `matchThreshold`, `debounceSec`, `consecutiveFrames`, `bendEnterAngle`, `bendExitAngle`, `railDistanceInches`, `ballConfirmPasses`, `cueDetectionEnabled`, `walkingPathsEnabled`. Send what applies. |
| `remote-camera-list` | `devices: [{ deviceId, label }]`, `currentDeviceId` | the camera picker in Visual Scoring > Select Camera. Send when the camera starts. |
| `idle-states` | `idle: [names]` | older: who's seated and recognized - only used when no `player-states` arrive. |

## 5. What it must LISTEN for

| message (from the scoreboard) | fields | expected |
|---|---|---|
| `roster` | `names` (the score cards), `playing` (in the game - recognize only these), `known` (the contact sheet - forget samples of anyone not in it) | keep it; ask for it with `{ "type": "roster-request" }` after connecting. |
| `turn_confirmed` | `player_name` | a person just confirmed a score for this player - stronger truth than the app's own guess (a good moment to learn their look). |
| `enroll-press` | `player_name`, `kind` (`identify` = seen, `shooting`) | the number pad (7 / 8 during play): take a sample of that player now; answer with `enroll-result` (+ `enroll-pressed`). |
| `enroll-undo` | - | the number pad's 0: take back the last sample; answer with `enroll-result` (`undone: true`). |
| `enrollments` | `data` (the server's whole sample store) | sent to every camera after the scoreboard removes a player (graveyard): forget anyone no longer in it. An app with its own samples can rely on `roster.known` instead - forget anyone not in it. |
| `ball_feedback` | `kind` (`false_positive`/`missed`), `delta`, `ts` | a person corrected an automatic ball credit - learn from it. |
| `camera-settings` | `settings: { key: value }` | a change made on the scoreboard - apply what applies, then send `camera-settings-state`. |
| `camera-settings-request` | - | send `camera-settings-state`. |
| `remote-camera-list-request`, `remote-camera-select` (`deviceId`) | | send the list / switch to that camera. |
| `settings` | `matchThreshold`, `debounceSec` | older form of `camera-settings` (after a `settings-request`). |

The camera page also answers `remote-calib-start` / `-tap` / `-cancel` (table calibration from the
scoreboard) and the remote view's `viewer-*` messages; an external app may ignore them and offer
its own setup instead.

## 6. Enrollment samples

The server keeps one shared store of samples per player (`~/.pool-master-counter/camera-enrollments.json`)
for the camera page: `enroll-get` (answered with `enrollments`), `enroll-add`, `enroll-save`,
`enroll-delete`. From it, the server tells the scoreboard who has samples (`enrollment-names` -
"N of M players enrolled").

**An external app should keep its own samples** - face and appearance data then never leave it.
What's missing today (see below): a way for it to tell the scoreboard who it has samples for.

## 7. Limits of version 1 (what an external app needs changed)

- **The server forwards only the message types and fields listed above** - each field is copied
  by name (`server/camera-relay.js`). A new message, or a new field on an existing one, is dropped
  until the server is taught it.
- **`enrollment-names` can only come from the server's own store.** An app with its own samples
  needs the server to accept `{ "type": "enrollment-names", "names": [...] }` from a camera too.
- **No version or app name in `hello`.** Proposed for version 2:
  `{ "type": "hello", "role": "camera", "protocol": 2, "app": "PMC Vision", "appVersion": "1.0" }`,
  passed on to the scoreboard in `camera-presence`, so it can show which recognition app is
  connected.
- **Several cameras at once** are relayed, but the scoreboard treats their `player_up`s alike - a
  second camera would need its own id on every message.

## Privacy

Nothing visual leaves a recognition app except, and only on request:
- `calib-frame` - one small still per tap while the table is calibrated from the scoreboard;
- `viewer-frame` - a small still every 1.5 s, only while someone has the remote view open.

An external app can leave both out; everything else is names, numbers and states.

## A minimal session

```
→ { "type": "hello", "role": "camera" }
→ { "type": "camera-status", "status": { "link": "connected", "models": "loading", "camera": "starting" } }
→ { "type": "roster-request" }
← { "type": "roster", "names": ["Alex", "Sam"], "playing": ["Alex", "Sam"], "known": ["Alex", "Sam", "Kim"] }
→ { "type": "camera-status", "status": { "link": "connected", "models": "ready", "camera": "active" } }
→ { "type": "player-states", "states": { "Alex": "recognized" } }            (then every ≤3 s)
→ { "type": "candidate", "player_name": "Alex", "stance": "bent", "angle": 52 } (3-4 a second)
→ { "type": "player_up", "player_name": "Alex", "confidence": 0.8, "certainty": 0.93, "ts": 1792200000000 }
← { "type": "turn_confirmed", "player_name": "Alex" }                          (a person scored for Alex)
← { "type": "enroll-press", "player_name": "Sam", "kind": "identify" }         (number pad 7)
→ { "type": "enroll-result", "ok": true, "player_name": "Sam", "kind": "identify", "total": 12 }
→ { "type": "enroll-pressed", "player_name": "Sam", "kind": "identify" }
```
(→ app to scoreboard, ← scoreboard to app)
