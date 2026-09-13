// The one place express/ws/qrcode get required from. relay.js and
// routes.js take these as parameters instead of requiring them directly,
// for two reasons: (1) server.js's own require/try-catch stays the only
// place a "run npm install" message can fire - if relay.js/routes.js
// required these themselves, an un-caught MODULE_NOT_FOUND there would
// print a raw stack trace instead; (2) esbuild's node-style module
// resolution walks up from the *requiring file's own directory* - since
// installer/standalone-entry.js lives outside server/, a require("express")
// placed there would never find server/node_modules. Because this file
// lives inside server/, esbuild bundling it resolves correctly, and both
// server.js and the standalone bundle get their deps from one spot.
module.exports = {
  express: require("express"),
  WebSocket: require("ws"),
  QRCode: require("qrcode"),
};
