var lan = require("./lan");

// The host's browser needs to know its own LAN-reachable address to build
// a join URL/QR that a *different* device can actually use. It can't infer
// this from location.host - if the host opened the app via
// http://localhost:4173/ (the natural thing to type on the machine running
// this server), a join link built from that would tell every guest's phone
// to connect to its own localhost, which silently fails with no useful
// error. So the app fetches this instead of trusting its own origin.
//
// getHttpsInfo is optional and, when given, is called fresh on every
// request rather than read once at startup - the camera setup wizard needs
// to know whether HTTPS is *currently* up and on which port, and on the
// standalone build that only becomes true sometime after this route is
// registered (cert generation is async) - a value captured once at
// attachApiRoutes() call time would be permanently stale. Returns either
// the HTTPS port number directly (server.js's simple case - HTTPS is
// either configured at startup or not, nothing to diagnose), or
// { port, error } (the standalone build's case - cert generation and the
// listener's own listen() are both async and can fail after this route is
// already registered, so there's a real "why" worth reporting once that
// happens - see standalone-entry.js's own httpsError). Returns
// null/undefined (or { port: null }) if HTTPS isn't up yet with nothing to
// report wrong, just still starting.
function attachApiRoutes(app, port, QRCode, getHttpsInfo) {
  app.get("/api/lan-info", function (req, res) {
    var httpsInfo = getHttpsInfo ? getHttpsInfo() : null;
    var httpsPort = null;
    var httpsError = null;
    if (httpsInfo && typeof httpsInfo === "object") {
      httpsPort = httpsInfo.port || null;
      httpsError = httpsInfo.error || null;
    } else {
      httpsPort = httpsInfo || null;
    }
    res.json({ addresses: lan.lanAddresses(), port: port, httpsPort: httpsPort, httpsError: httpsError });
  });

  app.get("/api/qr.png", function (req, res) {
    var url = req.query.url;
    if (!url) {
      res.status(400).send("Missing ?url=");
      return;
    }
    res.type("png");
    QRCode.toFileStream(res, url, { width: 320, margin: 1 });
  });
}

module.exports = { attachApiRoutes: attachApiRoutes };
