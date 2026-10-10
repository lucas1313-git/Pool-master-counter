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
