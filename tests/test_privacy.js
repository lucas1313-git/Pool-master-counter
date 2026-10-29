// Privacy pieces without a screen:
// - appearance samples not refreshed in 90 days are forgotten - the server's copy
//   (server/camera-relay.js) and the camera page's own (camera.html) the same: someone seen 100
//   days ago goes, someone seen 5 days ago stays, samples without a date start their 90 days now
//   (and go 91 days later);
// - the Challonge proxy (challonge-proxy/worker.js) forwards only the five calls the app makes:
//   create a tournament, start/close it, add players, read its matches, report a match - anything
//   else (listing tournaments, deleting one, reading players, /me) is 404.
// usage: node tests/test_privacy.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 600) : "")); if (!ok) fails++; }

(async () => {
  // ---- 90-day expiry, both copies ----
  const relay = require(path.join(ROOT, "server", "camera-relay.js"));
  const html = fs.readFileSync(path.join(ROOT, "camera.html"), "utf8");
  const a = html.indexOf("  var SAMPLE_KEEP_DAYS"), b = html.indexOf("  var LOCAL_ENROLLMENTS_REV_KEY");
  const pageExpire = a > 0 && b > a ? new Function(html.slice(a, b) + "\nreturn expireStaleSamples;")() : null;
  const now = Date.now(), day = 86400000;
  const store = () => ({
    old: { displayName: "Old", descriptors: [[1]], info: [{ kind: "identify", at: now - 100 * day }] },
    recent: { displayName: "Recent", descriptors: [[1], [2]], info: [{ kind: "identify", at: now - 200 * day }, { kind: "recognized", at: now - 5 * day }] },
    undated: { displayName: "Undated", descriptors: [[1]], info: [null] }
  });
  [["the server's copy", relay.expireStaleSamples], ["the camera page's own", pageExpire]].forEach(([name, expire]) => {
    if (typeof expire !== "function") { check(name + ": expireStaleSamples exists", false); return; }
    const s = store();
    const gone = expire(s, now);
    check(name + ": seen 100 days ago - forgotten; 5 days ago - kept (its older samples too); no date - kept, its 90 days start now",
      JSON.stringify(gone) === JSON.stringify(["Old"]) && Object.keys(s).join(",") === "recent,undated" && s.recent.descriptors.length === 2 && s.undated.refreshedAt === now, { gone, keys: Object.keys(s) });
    const later = expire(s, now + 91 * day);
    check(name + ": 91 days later, nobody refreshed - the rest are forgotten too", later.length === 2 && Object.keys(s).length === 0, later);
  });

  // ---- the Challonge proxy ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-proxy-"));
  const copy = path.join(tmp, "worker.mjs");
  fs.copyFileSync(path.join(ROOT, "challonge-proxy", "worker.js"), copy);
  const worker = (await import("file://" + copy)).default;
  const forwarded = [];
  globalThis.fetch = async (url, init) => { forwarded.push(init.method + " " + new URL(url).pathname); return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }); };
  const call = async (m, p) => (await worker.fetch(new Request("https://proxy.example" + p, { method: m, body: m === "GET" || m === "OPTIONS" ? undefined : "{}" }))).status;
  const used = [["POST", "/v2.1/tournaments.json"], ["PUT", "/v2.1/tournaments/abc123/change_state.json"], ["POST", "/v2.1/tournaments/abc123/participants/bulk_add.json"],
    ["GET", "/v2.1/tournaments/abc123/matches.json?page=2&per_page=100"], ["PUT", "/v2.1/tournaments/abc123/matches/9988.json"]];
  const other = [["GET", "/v2.1/tournaments.json"], ["DELETE", "/v2.1/tournaments/abc123.json"], ["GET", "/v2.1/tournaments/abc123/participants.json"], ["GET", "/v2.1/me.json"],
    ["PUT", "/v2.1/tournaments/abc123.json"], ["POST", "/v2.1/tournaments/abc123/matches/9988/attachments.json"], ["GET", "/v1/tournaments.json"]];
  const usedStatus = [];
  for (const [m, p] of used) usedStatus.push(await call(m, p));
  const otherStatus = [];
  for (const [m, p] of other) otherStatus.push(await call(m, p));
  check("the Challonge proxy forwards the app's five calls", usedStatus.every((s) => s === 200) && forwarded.length === 5, { usedStatus, forwarded });
  check("...and nothing else (404, never forwarded): list or delete tournaments, read players, /me, edit a tournament, attachments, v1", otherStatus.every((s) => s === 404) && forwarded.length === 5, { otherStatus, forwarded });

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
