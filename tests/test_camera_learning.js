// What a score teaches the camera (P25), camera.html's real handleTurnConfirmed:
// - a score for the player the camera itself picked ("camera") teaches it nothing unless the
//   player in view already matched that name beyond doubt - it used to label whoever stood at the
//   table with the scored name, so a wrong pick that got scored taught it the mistake;
// - a player picked by hand ("hand": a number key, their card, a voice command) is learned -
//   their first sample, or one more - unless the player in view clearly looks like someone else;
// - an older scoreboard that doesn't say who picked: only a sure match is learned;
// - nobody at the table in the last 12 s: nothing.
// usage: node tests/test_camera_learning.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "camera.html"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["handleTurnConfirmed", "isConfidentMatch", "isSureMatch", "normalizeNameKey"];
const F = new Function(
  "var TURN_CONFIRM_GRACE_MS = 12000, SURE_MATCH_FRACTION = 0.7, candidate = null, enrollments = {}, sent = [];\n" +
  "function send(m) { sent.push(m); } function logActivity() {} function addEmbeddingsToInfo() {} function notifyEnrollmentUpdated() {} function hasPlentyPressedSamples() { return false; }\n" +
  NAMES.map(extract).join("\n") +
  "\nreturn { set: function (c, e) { candidate = c; enrollments = e || {}; sent = []; }, sent: function () { return sent.map(function (m) { return m.type + ':' + m.player_name; }); }, " + NAMES.join(",") + " };")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const now = Date.now();
const someone = (sureName) => ({ name: sureName || null, sureName: sureName || null, descriptor: [1, 2, 3], emb: null, lastSeenAt: now - 1000 });
const ANN = { ann: { displayName: "Ann", descriptors: [[1]] } };

F.set(someone(null), ANN);
F.handleTurnConfirmed("Ann", "camera");
check("the camera's own pick scored, the player in view not recognized: nothing learned", F.sent().length === 0, F.sent());
F.set(someone("Bob"), ANN);
F.handleTurnConfirmed("Ann", "camera");
check("...the player in view sure to be Bob, Ann scored: nothing learned (no Bob sample labelled Ann)", F.sent().length === 0, F.sent());
F.set(someone("Ann"), ANN);
F.handleTurnConfirmed("Ann", "camera");
check("...the player in view sure to be Ann: one more sample of Ann", F.sent().join() === "enroll-add:Ann", F.sent());

F.set(someone(null), ANN);
F.handleTurnConfirmed("Ann", "hand");
check("picked by hand, the player in view not recognized: one more sample of Ann", F.sent().join() === "enroll-add:Ann", F.sent());
F.set(someone(null), {});
F.handleTurnConfirmed("Cat", "hand");
check("...a new player picked by hand: their first sample", F.sent().join() === "enroll-save:Cat", F.sent());
F.set(someone("Bob"), ANN);
F.handleTurnConfirmed("Ann", "hand");
check("...but not when the player in view is clearly Bob", F.sent().length === 0, F.sent());

F.set(someone(null), ANN);
F.handleTurnConfirmed("Ann");
check("an older scoreboard (doesn't say who picked): nothing learned unless sure", F.sent().length === 0, F.sent());
F.set(Object.assign(someone(null), { lastSeenAt: now - 20000 }), ANN);
F.handleTurnConfirmed("Ann", "hand");
check("nobody at the table for 20 s: nothing", F.sent().length === 0, F.sent());

check("sure = a clear match well inside the threshold (0.6 of 1: yes; 0.9: no; unclear: no)",
  F.isSureMatch({ distance: 0.6, threshold: 1, clear: true }) && !F.isSureMatch({ distance: 0.9, threshold: 1, clear: true }) && !F.isSureMatch({ distance: 0.5, threshold: 1, clear: false }));

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
