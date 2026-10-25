# Local test and build tools

Not part of the app - helpers for testing and for running this machine's own copy of it.

- `publicbuild/build-public.js` - makes the minified copy of the site (`publicbuild/site/`, not
  committed): inline and separate scripts and styles minified, comments and indentation stripped,
  the camera's vendor files and models copied as they are.
- `publicbuild/rebuild_server_min.sh` - rebuilds the local server app (ports 4173 http / 4174
  https) to serve that minified copy; `publicbuild/rebuild_server.sh` puts the plain one back.
  Both use machine-specific paths (the signing-free test server binary, its certificates and
  Node 24) set at the top of each script.
- `publicbuild/noopen/open` - a stand-in `open` so the rebuilt server doesn't open a browser.
- `probe_debug_collapse.js` - browser check of Visual Scoring's collapsible "Debugging visual
  matching" section: `node tests/probe_debug_collapse.js http://localhost:4235/ <screenshot dir>`
  against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_walking_paths.js` - walks synthetic people through the camera page's real detection loop
  (`PMCCueDebug.posesOverride`) to check walking paths: a player out of view for a moment comes back
  on their path with the same track id and name; nobody off the path, nobody two lost players could
  be, and nobody after 12 s does; crossing walkers keep their ids; a returning player bent over a
  shot is credited to them. `node tests/probe_walking_paths.js http://localhost:4236/ [--calibrated]`
  against a test server (`HOME=tests/tmphome PORT=4236 node server/server.js`).
- `probe_new_day_shirts.js` - seeds the camera page's same-device sample store with yesterday's
  samples (synthetic colour counts) and checks a new day: a player in a new shirt - even another
  player's colour from yesterday - is still recognized by trousers, cap and build; a stranger in a
  player's old shirt isn't; the appearance models and the "plenty pressed" count use only today's
  samples; a day runs 5 a.m. to 5 a.m. `node tests/probe_new_day_shirts.js http://localhost:4237/`
  against a test server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `probe_room_map.js` - the camera page's room map against a synthetic camera and room: the
  camera's lens, position and height from the table calibration (also with the corners tapped the
  other way round, with tapping errors, and looking nearly straight down); the room's shape from a
  ray-traced depth map (the table's size, the floor, a cabinet, the walls, the camera); synthetic
  walkers projected through the camera into the real detection loop - their spots, who they are,
  where one who walked out of view could be, back on their path; every debugging id in the SVG.
  `node tests/probe_room_map.js http://localhost:4237/ [screenshot.png]` against a test server
  (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `probe_camera_icon_states.js` - the scoreboard with two players and the same-device camera in its
  iframe (fake video, a synthetic calibrated camera, synthetic people): each score card's camera
  icon through its states - light grey (nothing known), yellow (someone in view carrying the
  player's walking path), green (a sure look), blue (out of view, placed by the walking path, then
  by the room map), grey again once the camera stops talking - its size (60px) with the name left
  where it was, no flashing, and the colour kept across a redraw of the cards.
  `node tests/probe_camera_icon_states.js http://localhost:4237/ [screenshot dir]` against a test
  server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
- `test_voice_parser.js` - the voice commands' sentence parser on its own, in Node: every sentence
  on the "Voice commands" sheet and the usual mishearings ("Luke" for Luc, "at one point", "race 2
  7", "Luigi's", "queue score") into the right command and players; unknown and doubled names
  refused. `node tests/test_voice_parser.js`
- `probe_voice.js` - voice commands in the page with the microphone replaced by a fake that "hears"
  a given sentence when the hold ends: the number pad's "." key and the 🎤 Talk button held (a tap
  shows the sentences), game / race / rotation / players / teams / points (with the keypad's beep)
  / an 8-ball win with balls left (the "." key not typed into the focused field) / "Nice game" /
  spoken Q-score and score; unknown names, the sheet, phone width.
  `node tests/probe_voice.js http://localhost:4235/ [screenshot dir]` against a test server
  (`HOME=tests/tmphome PORT=4235 node server/server.js`).
- `probe_voice_siri.js` - voice commands from a Siri Shortcut: sentences sent to the server's
  `/voice` (JSON, form, plain text, `?text=`) are done on the open scoreboard and the answer comes
  back as plain text for Siri to speak ("Luc plus 1, now 1"); the page doesn't speak them itself;
  "Help" opens the sheet with the Shortcut's steps and this computer's address; with two
  scoreboards open only the one used last acts; none open: 503.
  `node tests/probe_voice_siri.js http://localhost:4235/` against a test server
  (`HOME=tests/tmphome PORT=4235 node server/server.js`) started after the change.
- `probe_camera_zoom.js` - the camera page's zoom and upside-down turn, with a fake camera playing
  a still test picture (generated into `tmphome/`): the picture zoomed / turned pixel by pixel, the
  camera asked for 4K when zooming, the table calibration and the furniture snapshot converted
  exactly and back to the original when undone, and Zoom / "Camera mounted upside down" set in
  the scoreboard's Capture Settings reaching the camera page. `node tests/probe_camera_zoom.js
  http://localhost:4235/` against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
