// Elimination brackets (js/lib/brackets.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../../js/lib/brackets.js");
const names = (n) => Array.from({ length: n }, (_, i) => "P" + (i + 1));

test("nextPow2: the bracket size for a field", () => {
  assert.deepEqual([1, 2, 3, 5, 8, 9, 16, 17].map(B.nextPow2), [1, 2, 4, 8, 8, 16, 16, 32]);
});
test("seed order for 8: 1 v 8, 4 v 5, 2 v 7, 3 v 6 - the standard draw", () => {
  assert.deepEqual(B.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});
test("seed order: every first-round pair adds up to the size + 1", () => {
  for (const size of [2, 4, 8, 16, 32]) {
    const o = B.seedOrder(size);
    for (let i = 0; i < o.length; i += 2) assert.equal(o[i] + o[i + 1], size + 1, size + ": " + o);
  }
});
test("seeds 1 and 2 can only meet in the final", () => {
  const o = B.seedOrder(16);
  assert.ok(o.indexOf(1) < 8 && o.indexOf(2) >= 8);
});
test("8 players: 3 winners' rounds of 4, 2, 1 matches", () => {
  const { wb, size } = B.buildWinnersBracketRounds(names(8), names(8));
  assert.equal(size, 8);
  assert.deepEqual(wb.map((r) => r.length), [4, 2, 1]);
});
test("5 players: 3 byes, all to the top seeds, decided at once", () => {
  const { wb } = B.buildWinnersBracketRounds(names(5), names(5));
  const byes = wb[0].filter((m) => (m.a === null) !== (m.b === null));
  assert.equal(byes.length, 3);
  assert.deepEqual(byes.map((m) => m.winner).sort(), ["P1", "P2", "P3"]);
});
test("a bye match has no loser", () => {
  const { wb } = B.buildWinnersBracketRounds(names(6), names(6));
  wb[0].filter((m) => m.winner).forEach((m) => assert.equal(m.loser, null));
});
test("the field in the order given: nobody left out, nobody twice", () => {
  const { wb } = B.buildWinnersBracketRounds(names(12), names(12));
  const seen = wb[0].flatMap((m) => [m.a, m.b]).filter(Boolean).sort();
  assert.deepEqual(seen, names(12).sort());
});
test("matches get their own ids and their round's tag", () => {
  const { wb } = B.buildWinnersBracketRounds(names(4), names(4));
  const ids = wb.flat().map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(wb[1][0].tag, "Winners R2");
});
test("double elimination for 8: the standard 2 x (rounds - 1) = 4 losers' rounds", () => {
  const { wb } = B.buildWinnersBracketRounds(names(8), names(8));
  assert.equal(B.buildLosersBracketRounds(wb).length, 4);
});
test("losers' bracket for 8: 2, 2, 1, 1 matches", () => {
  const { wb } = B.buildWinnersBracketRounds(names(8), names(8));
  assert.deepEqual(B.buildLosersBracketRounds(wb).map((r) => r.length), [2, 2, 1, 1]);
});
test("every losers' match knows where both its sides come from", () => {
  const { wb } = B.buildWinnersBracketRounds(names(16), names(16));
  B.buildLosersBracketRounds(wb).flat().forEach((m) => assert.ok(m.srcA && m.srcB && m.srcA.id && m.srcB.id));
});
test("with byes, empty losers' matches are taken out (6 players)", () => {
  const { wb } = B.buildWinnersBracketRounds(names(6), names(6));
  const lb = B.buildLosersBracketRounds(wb);
  lb.flat().forEach((m) => assert.ok(m.srcA && m.srcB));
  assert.ok(lb.flat().length < 6);
});
test("pairUpNames: two by two, the odd one out left over for the next round", () => {
  const r = B.pairUpNames(names(5).map((name) => ({ name, feeder: null })), "R2");
  assert.equal(r.matches.length, 2);
  assert.deepEqual(r.leftover.map((e) => e.name), ["P5"]);
  assert.deepEqual(r.matches.map((m) => m.a + "-" + m.b), ["P1-P2", "P3-P4"]);
});
