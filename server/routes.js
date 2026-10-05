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
// attachApiRoutes() call time would be permanently stale. Returns the
// HTTPS port number, or null/undefined if HTTPS isn't available (or not
// up yet).
function attachApiRoutes(app, port, QRCode, getHttpsInfo) {
  app.get("/api/lan-info", function (req, res) {
    var httpsPort = getHttpsInfo ? getHttpsInfo() : null;
    res.json({ addresses: lan.lanAddresses(), port: port, httpsPort: httpsPort || null });
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
