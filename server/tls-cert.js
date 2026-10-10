// Generates (and persists) a self-signed TLS certificate for the
// standalone desktop build, so the camera-recognition page can be served
// over HTTPS with zero setup - no mkcert, no terminal, matching the
// desktop app's whole "no git, no Node, no terminal" design goal.
// server/server.js's own SSL_CERT_PATH/SSL_KEY_PATH env vars remain the
// right approach for the dev/LAN flow, where a terminal is already in
// use anyway - this file is specifically for the entry point that has
// none.
//
// A self-signed cert isn't vouched for by any CA the OS already trusts,
// so the first time a phone visits this over HTTPS, Safari shows a "This
// Connection Is Not Private" warning - tapping through it once ("Show
// Details" > "visit this website") is unavoidable with this approach,
// but it's a single tap, not mkcert's multi-step root-CA export/AirDrop/
// install/trust dance. The cert is saved to disk and reused across
// launches (whenever it already covers every currently-reachable
// address) so that tap only has to happen once per phone, not every
// time the app starts.
//
// Takes `selfsigned` as a parameter rather than require()-ing it
// directly - see deps.js's own comment on why (esbuild's bundling for
// the standalone build needs the actual require() call to live inside
// server/, not here).
//
// Uses the `selfsigned` package (native WebCrypto-backed, zero known
// vulnerabilities as of writing) rather than node-forge - node-forge has
// an unpatched high-severity advisory in its RSA signature-verification
// path (GHSA-86w9-cpqp-85rv). This code never verifies a signature (only
// generates and self-signs), so that specific bug wouldn't have been
// reachable through this file either way, but there's no reason to ship
// a flagged dependency when an equally capable, clean one exists.

var fs = require("fs");
var os = require("os");
var path = require("path");

var CERT_DIR = path.join(os.homedir(), ".pool-master-counter");
var CERT_PATH = path.join(CERT_DIR, "tls-cert.json");
var VALIDITY_YEARS = 10; // long enough that expiry is never the reason to regenerate

function loadPersisted() {
  try {
    return JSON.parse(fs.readFileSync(CERT_PATH, "utf8"));
  } catch (e) {
    return null;
  }
}

function savePersisted(data) {
  try {
    fs.mkdirSync(CERT_DIR, { recursive: true });
    fs.writeFileSync(CERT_PATH, JSON.stringify(data));
  } catch (e) {
    console.error("[tls-cert] Could not save certificate:", e.message);
  }
}

function isIp(host) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function generateCert(selfsigned, hosts) {
  var notBefore = new Date();
  var notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + VALIDITY_YEARS);

  var altNames = hosts.map(function (host) {
    // X.509 SAN type codes: 2 = dNSName, 7 = iPAddress.
    return isIp(host) ? { type: 7, ip: host } : { type: 2, value: host };
  });

  return selfsigned.generate([{ name: "commonName", value: "Pool Master Counter (local)" }], {
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: altNames }
    ]
  }).then(function (pems) {
    return { cert: pems.cert, key: pems.private, hosts: hosts };
  });
}

// Returns a Promise of { cert, key } PEM strings, generating (or
// extending) a persisted self-signed certificate so it covers every
// currently-reachable address (localhost/127.0.0.1 plus every given LAN
// address).
function getOrCreateCert(selfsigned, lanAddresses) {
  var required = ["localhost", "127.0.0.1"].concat(lanAddresses);
  var existing = loadPersisted();
  var alreadyCovered = existing && existing.hosts && required.every(function (h) {
    return existing.hosts.indexOf(h) !== -1;
  });
  if (alreadyCovered) return Promise.resolve({ cert: existing.cert, key: existing.key });

  // Union with whatever the previous cert already covered, not just the
  // current addresses - if this machine moves between networks and later
  // returns to one it's seen before, that address may already be
  // covered, sparing a repeat "trust this" tap on whichever phone
  // visited it back then.
  var hosts = required.slice();
  if (existing && existing.hosts) {
    existing.hosts.forEach(function (h) {
      if (hosts.indexOf(h) === -1) hosts.push(h);
    });
  }
  return generateCert(selfsigned, hosts).then(function (generated) {
    savePersisted(generated);
    return { cert: generated.cert, key: generated.key };
  });
}

module.exports = { getOrCreateCert: getOrCreateCert };
