// The Leaderboard's 3 other ways to pick the leader (js/lib/leaderboard-methods.js) - for the
// players who don't come as often: 📈 performance, 🔟 last 10 games, 🌙 best 3 nights.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/lib/leaderboard-methods.js");
const P = require("../../js/lib/pool-day.js");

// n games won then m lost against opponents rated opp, from 8 p.m. on 2026-11-(day), 10 min apart
function night(day, won, lost, opp) {
  const out = [];
  for (let i = 0; i < won + lost; i++) out.push({ ts: new Date(2026, 10, day, 20, i * 10).toISOString(), won: i < won, opp: opp === undefined ? 400 : opp });
  return out;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.05, a + " is not " + b);

test("performance: the opponents' average + 100 × log2((won + 2) ÷ (lost + 2))", () => {
  const p = M.performance(night(10, 3, 0, 400));
  near(p.score, 400 + 100 * Math.log2(5 / 2));
  assert.deepEqual([p.won, p.lost, p.games], [3, 0, 3]);
  near(M.performance(night(10, 5, 5, 520)).score, 520);
  near(M.performance(night(10, 0, 4, 400)).score, 400 + 100 * Math.log2(2 / 6));
});

test("performance: who you beat counts, not how much you play - 6 of 7 against strong players beats 40 of 50", () => {
  const rare = M.performance(night(10, 6, 1, 560));
  const regular = M.performance([].concat(night(1, 10, 3, 420), night(3, 10, 2, 420), night(5, 10, 3, 420), night(7, 10, 2, 420)));
  assert.equal(regular.games, 50);
  assert.ok(rare.score > regular.score, rare.score + " v " + regular.score);
  // (and a lucky 3-0 doesn't beat that 40-10 at the same table)
  assert.ok(M.performance(night(12, 3, 0, 420)).score < regular.score);
});

test("performance: ranked from 3 games with an opponent; games with none don't count", () => {
  assert.equal(M.performance(night(10, 2, 0)), null);
  const solo = night(10, 3, 0).map((g, i) => (i === 0 ? Object.assign({}, g, { opp: null }) : g));
  assert.equal(M.performance(solo), null);
  assert.equal(M.score("performance", night(10, 3, 0), 400).games, 3);
});

test("last 10: the wins in the last 10 games, newest first; fewer than 10, a missing game is half a win", () => {
  const old = night(1, 10, 0);
  const recent = night(9, 3, 7);
  const l = M.last10([].concat(recent, old)); // (any order in)
  assert.deepEqual([l.score, l.won, l.played, l.missing], [3, 3, 10, 0]);
  const rare = M.last10(night(9, 4, 2));
  assert.deepEqual([rare.score, rare.won, rare.played, rare.missing], [6, 4, 6, 4]);
  assert.equal(M.last10(night(9, 2, 0)), null);
  assert.equal(M.halves(6.5), "6½");
  assert.equal(M.halves(0.5), "½");
  assert.equal(M.halves(7), "7");
});

test("last 10: a tie goes to the one who really played more of the 10, then the rating", () => {
  const a = { rating: 380, result: M.last10(night(9, 7, 3)) }; // 7 of 10
  const b = { rating: 500, result: M.last10(night(9, 5, 1)) }; // 5 + 4 × ½ = 7
  assert.equal(b.result.score, 7);
  assert.deepEqual([b, a].sort((x, y) => M.compare("last10", x, y)), [a, b]);
  const c = { rating: 450, result: M.last10(night(9, 7, 3)) };
  assert.deepEqual([a, c].sort((x, y) => M.compare("last10", x, y)), [c, a]);
});

test("best nights: the 3 best nights' average; a night not had counts at the rating", () => {
  const dayOf = P.localDateStrFromTs;
  const one = M.bestNights(night(9, 6, 1, 550), 450, dayOf);
  const perf = 550 + 100 * Math.log2(8 / 3);
  near(one.score, (perf + 450 + 450) / 3);
  assert.deepEqual([one.filled, one.nights.length, one.nights[0].day], [2, 1, "2026-11-09"]);
  const three = M.bestNights([].concat(night(1, 6, 1, 550), night(3, 6, 1, 550), night(9, 6, 1, 550)), 450, dayOf);
  near(three.score, perf);
  assert.equal(three.filled, 0);
});

test("best nights: a bad night never costs anything, a short night (under 3 games) doesn't count", () => {
  const dayOf = P.localDateStrFromTs;
  const good = [].concat(night(1, 6, 1), night(3, 5, 1), night(5, 6, 2));
  const before = M.bestNights(good, 400, dayOf).score;
  const after = M.bestNights([].concat(good, night(7, 0, 6), night(8, 1, 1)), 400, dayOf);
  near(after.score, before);
  assert.equal(after.nightsPlayed, 4); // (the 2-game night not one)
  assert.equal(M.bestNights(night(8, 2, 0), 400, dayOf), null);
});

test("best nights: a night past midnight is one night (the pool day, 5 a.m. to 5 a.m.)", () => {
  const late = [22, 23, 24, 25, 26].map((h, i) => ({ ts: new Date(2026, 10, 9, h, 30).toISOString(), won: i !== 2, opp: 400 }));
  const n = M.bestNights(late, 400, P.localDateStrFromTs);
  assert.deepEqual([n.nights.length, n.nights[0].day, n.nights[0].games], [1, "2026-11-09", 5]);
});

test("the methods: mvp is the app's own (none here); an unknown one isn't a method", () => {
  assert.deepEqual(M.METHODS, ["mvp", "performance", "last10", "bestNights"]);
  assert.equal(M.score("mvp", night(1, 9, 1), 400), null);
  assert.equal(M.isMethod("bestNights"), true);
  assert.equal(M.isMethod("q"), false);
});

test("🧗 climbing: the fewest wins in a row that pass, null past the most tried", () => {
  // 3-3 against players rated 400 is 400: wins in a row against 400 until past 480
  const me = night(10, 3, 3, 400);
  const k = M.fewest((k) => M.performance(me.concat(M.streak(k, true, 400, ["Reg"], "2026-11-20T20:00:00Z"))).score > 480, 50);
  near(M.performance(me.concat(M.streak(k, true, 400, ["Reg"], "2026-11-20T20:00:00Z"))).score, 400 + 100 * Math.log2((3 + k + 2) / 5));
  assert.ok(M.performance(me.concat(M.streak(k - 1, true, 400, [], "2026-11-20T20:00:00Z"))).score <= 480);
  assert.equal(M.fewest(() => false, 10), null);
  assert.equal(M.fewest((k) => k >= 1, 10), 1);
  const s = M.streak(2, false, 450, ["Ann"], "2026-11-20T20:00:00Z");
  assert.deepEqual(s.map((g) => [g.ts, g.won, g.opp, g.names[0]]), [["2026-11-20T20:00:00.000Z", false, 450, "Ann"], ["2026-11-20T20:00:01.000Z", false, 450, "Ann"]]);
});

test("🧗 what put them there: the games by opponent; the last 10 and the nights carry their games", () => {
  const games = [].concat(
    M.streak(3, true, 420, ["Reg"], "2026-11-10T20:00:00Z"),
    M.streak(1, false, 420, ["Reg"], "2026-11-10T21:00:00Z"),
    M.streak(2, true, 380, ["Bo", "Ann"], "2026-11-10T22:00:00Z"),
    M.streak(1, true, null, [], "2026-11-10T23:00:00Z")
  );
  const by = M.byOpponent(games);
  assert.deepEqual(by.map((o) => [o.names.join("&"), o.won, o.lost, o.opp]), [["Reg", 3, 1, 420], ["Ann&Bo", 2, 0, 380], ["", 1, 0, null]]);
  assert.equal(M.last10(games).results.length, 7);
  const n = M.bestNights(night(9, 6, 1), 400, P.localDateStrFromTs);
  assert.equal(n.nights[0].results.length, 7);
});
