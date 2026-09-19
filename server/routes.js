var lan = require("./lan");

// The host's browser needs to know its own LAN-reachable address to build
// a join URL/QR that a *different* device can actually use. It can't infer
// this from location.host - if the host opened the app via
// http://localhost:4173/ (the natural thing to type on the machine running
// this server), a join link built from that would tell every guest's phone
// to connect to its own localhost, which silently fails with no useful
// error. So the app fetches this instead of trusting its own origin.
function attachApiRoutes(app, port, QRCode) {
  app.get("/api/lan-info", function (req, res) {
    res.json({ addresses: lan.lanAddresses(), port: port });
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
