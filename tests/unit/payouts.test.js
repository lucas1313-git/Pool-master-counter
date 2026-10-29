// Tournament money (js/lib/payouts.js, P33): the prize pool, the payout table by field size,
// shares in whole currency units (8, 16 and 32 players), shared places, side pots, a Calcutta.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/lib/payouts.js");
const sum = (rows) => rows.reduce((s, r) => s + r.each.reduce((a, b) => a + b, 0), 0);
const amounts = (rows) => rows.map((r) => r.each.join("+")).join(" ");
// single elimination placings for a field of n (1, 2, 3-4, 5-8, 9-16, ...), names p1..pn
function singleElim(n) {
  const out = [{ place: 1, names: ["p1"] }, { place: 2, names: ["p2"] }];
  for (let size = 2; size * 2 <= n; size *= 2) out.push({ place: size + 1, names: Array.from({ length: size }, (_, i) => "p" + (size + 1 + i)) });
  return out;
}
// one name a place (double elimination's top places, round robin without ties)
const eachPlace = (n) => Array.from({ length: n }, (_, i) => ({ place: i + 1, names: ["p" + (i + 1)] }));

test("the payout table by field size: 3 places for 16 or fewer, 2 for 8 or fewer, the last row past 64", () => {
  assert.deepEqual(P.presetForField(null, 8).pcts, [70, 30]);
  assert.deepEqual(P.presetForField(null, 9).pcts, [50, 30, 20]);
  assert.deepEqual(P.presetForField(null, 16).pcts, [50, 30, 20]);
  assert.equal(P.presetForField(null, 32).pcts.length, 8);
  assert.equal(P.presetForField(null, 100).upTo, 64);
  P.DEFAULT_PAYOUT_PRESETS.forEach((row) => assert.equal(row.pcts.reduce((a, b) => a + b, 0), 100, "up to " + row.upTo));
});

test("the prize pool: entries less the house's cut (rounded down), plus added money; green fees apart", () => {
  const p = P.prizePool({ entryFee: 15, greenFee: 5, addedMoney: 50, houseCutPct: 10 }, 16);
  assert.deepEqual(p, { entries: 240, greenFees: 80, houseCut: 24, added: 50, pool: 266, perPlayer: 20 });
  assert.equal(P.prizePool({ entryFee: 17, houseCutPct: 12.5 }, 9).houseCut, 19); // (19.125)
  assert.equal(P.prizePool({}, 12).pool, 0);
  assert.equal(P.prizePool({ entryFee: "20", addedMoney: "-30" }, 4).pool, 80);
});

test("8 players, $20 each: $160 - 70/30 -> $112 and $48", () => {
  const pay = P.tournamentPayouts({ entryFee: 20 }, 8, singleElim(8));
  assert.equal(pay.pool.pool, 160);
  assert.equal(amounts(pay.places), "112 48");
  assert.equal(sum(pay.places), 160);
});

test("8 players, $15 each, $5 added: $125 - 87.5 and 37.5 rounded to whole dollars, the odd dollar to the winner", () => {
  const pay = P.tournamentPayouts({ entryFee: 15, addedMoney: 5 }, 8, singleElim(8));
  assert.equal(amounts(pay.places), "88 37");
  assert.equal(sum(pay.places), 125);
});

test("16 players, $15 each, $50 added, 10% house cut: $266 - 50/30/20 -> $134, $79, $53 (adds up to $266)", () => {
  const pay = P.tournamentPayouts({ entryFee: 15, addedMoney: 50, houseCutPct: 10 }, 16, eachPlace(16));
  assert.equal(amounts(pay.places), "134 79 53");
  assert.equal(sum(pay.places), 266);
  assert.ok(pay.places.every((r) => r.each.every(Number.isInteger)));
});

test("16 players, single elimination: 3rd-4th share the 3rd place's 20% - $27 each of $266... rounded, adds up", () => {
  const pay = P.tournamentPayouts({ entryFee: 15, addedMoney: 50, houseCutPct: 10 }, 16, singleElim(16));
  // 133, 79.8, 53.2 / 2 = 26.6 each
  assert.equal(amounts(pay.places), "135 79 26+26");
  assert.equal(sum(pay.places), 266);
});

test("32 players, $17 each: $544 - 8 places, one a place (double elimination's top 8)", () => {
  const pay = P.tournamentPayouts({ entryFee: 17 }, 32, eachPlace(32));
  // 163.2 108.8 65.28 54.4 38.08 x4 -> rounded down (542), the 2 left over to the winner
  assert.equal(amounts(pay.places), "165 108 65 54 38 38 38 38");
  assert.equal(sum(pay.places), 544);
});

test("32 players, single elimination: 3rd-4th share 22%, 5th-8th share 28%, nobody past 8th", () => {
  const pay = P.tournamentPayouts({ entryFee: 25 }, 32, singleElim(32));
  // $800: 240, 160, 3rd-4th 176 -> 88 each, 5th-8th 224 -> 56 each
  assert.equal(amounts(pay.places), "240 160 88+88 56+56+56+56");
  assert.equal(sum(pay.places), 800);
  assert.equal(pay.places.length, 4);
});

test("32 players, $10 each, 5% cut: $304 - every share whole, adding up to the pool", () => {
  const pay = P.tournamentPayouts({ entryFee: 10, houseCutPct: 5 }, 32, singleElim(32));
  assert.equal(pay.pool.pool, 304);
  assert.ok(pay.places.every((r) => r.each.every(Number.isInteger)));
  assert.equal(sum(pay.places), 304);
  // 91.2, 60.8, 66.88/2 = 33.44, 85.12/4 = 21.28 -> rounded down (301), the 3 left over to the winner
  assert.equal(amounts(pay.places), "94 60 33+33 21+21+21+21");
});

test("before it's over: the table's amounts by place", () => {
  const pay = P.tournamentPayouts({ entryFee: 20 }, 16, null);
  assert.equal(amounts(pay.places), "160 96 64");
});

test("a tie for first (round robin): the two share 1st and 2nd; the odd unit to the first named", () => {
  const rows = P.splitByPlacings(101, [70, 30], [{ place: 1, names: ["a", "b"] }, { place: 3, names: ["c"] }]);
  assert.equal(amounts(rows), "51+50");
  assert.equal(sum(rows), 101);
});

test("edited percents that don't add up to 100 are scaled - the whole pool is paid", () => {
  const rows = P.splitByPlacings(200, [60, 30], eachPlace(4));
  assert.equal(amounts(rows), "134 66");
  assert.deepEqual(P.parsePcts("50, 30 / 20%"), [50, 30, 20]);
  assert.deepEqual(P.parsePcts("abc"), []);
});

test("a side pot: buy-in x entries, split between its winners in whole units", () => {
  assert.deepEqual(P.sidePotPayout({ name: "Break and run", buyIn: 5, entries: 11, winners: ["Kim", "Jo"] }), { name: "Break and run", pot: 55, winners: ["Kim", "Jo"], each: [28, 27] });
  assert.deepEqual(P.sidePotPayout({ name: "8 on the snap", buyIn: 2, entries: 8, winners: [] }).pot, 16);
});

test("a Calcutta: bids less the cut, split by where each player finished, paid to their buyer", () => {
  const calcutta = { enabled: true, houseCutPct: 10, bids: { p1: { buyer: "Sam", amount: 120 }, p2: { buyer: "Lee", amount: 80 }, p3: { buyer: "Sam", amount: 60 }, p4: { buyer: "Ali", amount: 40 } } };
  const c = P.calcuttaPayouts(calcutta, [70, 30], eachPlace(8));
  assert.equal(c.bids, 300);
  assert.equal(c.houseCut, 30);
  assert.equal(c.pot, 270);
  assert.equal(amounts(c.places), "189 81");
  assert.deepEqual(c.places.map((r) => r.buyers[0]), ["Sam", "Lee"]);
  assert.deepEqual(c.byBuyer, { Sam: 189, Lee: 81 });
  // in the whole tournament's payouts too, with the prize table for the field
  const pay = P.tournamentPayouts({ entryFee: 20, calcutta }, 8, eachPlace(8));
  assert.equal(pay.calcutta.pot, 270);
});
