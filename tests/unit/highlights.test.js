// Tonight's highlights - which cues make the reel (js/lib/highlights.js, P35).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../js/lib/highlights.js");

const T0 = Date.parse("2026-10-29T20:00:00Z");
const at = (s) => T0 + s * 1000;
const cue = (id, from, to, player, opponent, source) => ({ id, startedAt: at(from), endedAt: at(to), player, opponent, source: source || "auto (key)" });
const yes = (n) => ["Kim", "Jo", "Sam"].indexOf(n) !== -1;

test("a cue is matched to the game won during it (or just after) - by time", () => {
  const games = [{ ts: new Date(at(130)).toISOString(), winnerNames: ["Kim"], opponentNames: ["Jo"] }, { ts: new Date(at(400)).toISOString(), winnerNames: ["Jo"], opponentNames: ["Kim"] }];
  assert.equal(H.highlightGameForCue(cue("a", 100, 120, "Kim", "Jo"), games), games[0]);
  assert.equal(H.highlightGameForCue(cue("b", 200, 220, "Kim", "Jo"), games), null);
});

test("why it's worth it: a race won beats a rack won; a break-and-run, a long run; marked by hand counts a little", () => {
  const race = H.highlightReasons(cue("a", 0, 10, "Kim", "Jo", "button"), { winnerNames: ["Kim"], wonRace: true, tags: ["breakAndRun"] }, []);
  assert.deepEqual(race.map((r) => r.kind), ["raceWin", "breakAndRun", "marked"]);
  const run = H.highlightReasons(cue("b", 0, 10, "Kim", "Jo"), null, [{ name: "Kim", value: 12, ts: at(20) }, { name: "Jo", value: 3, ts: at(5) }]);
  assert.deepEqual(run, [{ kind: "longRun", name: "Kim", value: 12 }]);
});

test("only players who said yes: a cue with anyone else on it is left out - and they're named", () => {
  const r = H.pickHighlights([cue("a", 0, 8, "Kim", "Jo"), cue("b", 50, 58, "Kim", "Lee"), cue("c", 90, 98, "Ann", "Jo")], [], [], { optedIn: yes });
  assert.deepEqual(r.clips.map((c) => c.cue.id), ["a"]);
  assert.deepEqual(r.left.notOptedIn, ["Ann", "Lee"]);
});

test("the best first, about a minute, then in the order they happened", () => {
  const games = [
    { ts: new Date(at(25)).toISOString(), winnerNames: ["Kim"], opponentNames: ["Jo"], wonRace: true },
    { ts: new Date(at(210)).toISOString(), winnerNames: ["Jo"], opponentNames: ["Kim"], tags: ["breakAndRun"] },
    { ts: new Date(at(330)).toISOString(), winnerNames: ["Kim"], opponentNames: ["Jo"] }
  ];
  const cues = [cue("rack", 300, 325, "Kim", "Jo"), cue("bnr", 190, 205, "Jo", "Kim"), cue("race", 10, 22, "Kim", "Jo"), cue("dull", 500, 512, "Kim", "Jo")];
  const r = H.pickHighlights(cues, games, [], { optedIn: yes, maxSeconds: 30, clipMax: 12 });
  // race (8) + break-and-run (10) + rack (3) > dull (0): 12 + 12 = 24 s, a third would pass 30
  assert.deepEqual(r.clips.map((c) => c.cue.id), ["race", "bnr"]);
  assert.ok(r.clips.every((c) => c.seconds <= 12));
  assert.equal(r.left.dropped, 2);
});

test("one player's reel: only cues they're on, their own moments first", () => {
  const games = [{ ts: new Date(at(20)).toISOString(), winnerNames: ["Jo"], opponentNames: ["Sam"] }, { ts: new Date(at(120)).toISOString(), winnerNames: ["Kim"], opponentNames: ["Jo"] }];
  const r = H.pickHighlights([cue("a", 10, 18, "Jo", "Sam"), cue("b", 110, 118, "Kim", "Jo")], games, [], { optedIn: yes, player: "Kim" });
  assert.deepEqual(r.clips.map((c) => c.cue.id), ["b"]);
});

test("a long cue: the end (where the ball dropped), or around the camera's shot", () => {
  assert.deepEqual(H.highlightSpan({ startedAt: at(0), endedAt: at(40) }, 12), { from: at(28), to: at(40) });
  const s = H.highlightSpan({ startedAt: at(0), endedAt: at(40), shotAt: at(10) }, 12);
  assert.equal(s.to - s.from, 12000);
  assert.ok(s.from <= at(10) && s.to > at(10));
});

test("the score bug's numbers: the race as it stood after the game", () => {
  assert.deepEqual(H.highlightBugScore({ winnerNames: ["Kim"], opponentNames: ["Jo"], raceTally: { Kim: 5, Jo: 3 } }), [{ name: "Kim", value: 5 }, { name: "Jo", value: 3 }]);
  assert.equal(H.highlightBugScore(null), null);
});
