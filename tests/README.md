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
