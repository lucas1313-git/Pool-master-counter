// Breaks, fouls, safeties and innings (js/lib/events.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../../js/lib/events.js");

test("a run ends on a miss: A runs 10, misses, runs 5 - high run 10", () => {
  const tr = E.newTurnTracker("A");
  E.turnPot(tr, "A", 10); E.turnEnd(tr, "miss", "B"); E.turnEnd(tr, "miss", "A"); E.turnPot(tr, "A", 5);
  assert.equal(tr.best.A, 10);
  assert.equal(tr.run, 5);
});
test("innings: one per visit to the table", () => {
  const tr = E.newTurnTracker("A");
  E.turnEnd(tr, "miss", "B"); E.turnEnd(tr, "safety", "A"); E.turnEnd(tr, "miss", "B");
  assert.equal(tr.innings.A, 2);
  assert.equal(tr.innings.B, 2);
});
test("a safety is counted for the one who played it", () => {
  const tr = E.newTurnTracker("A");
  E.turnEnd(tr, "safety", "B");
  assert.equal(tr.safeties.A, 1);
});
test("fouls in a row: counted across the opponent's turns, cleared by a ball", () => {
  const tr = E.newTurnTracker("A");
  assert.equal(E.turnEnd(tr, "foul", "B"), 1); E.turnEnd(tr, "miss", "A");
  assert.equal(E.turnEnd(tr, "foul", "B"), 2); E.turnEnd(tr, "miss", "A");
  E.turnPot(tr, "A", 1);
  assert.equal(E.turnEnd(tr, "foul", "B"), 1);
});
test("14.1: a foul -1, a break foul -2", () => {
  assert.equal(E.foulRule("straight", 1).points, -1);
  assert.equal(E.foulRule("straight", 1, true).points, -2);
});
test("14.1: the third foul in a row is -16 and a re-rack", () => {
  const r = E.foulRule("straight", 3);
  assert.equal(r.points, -16);
  assert.equal(r.third, "rerack");
});
test("9-ball and 10-ball: the third foul in a row loses the rack; 8-ball has no such rule", () => {
  assert.equal(E.foulRule("9ball", 3).third, "lose");
  assert.equal(E.foulRule("10ball", 3).third, "lose");
  assert.ok(!E.foulRule("8ball", 3).third);
});
test("the two-foul warning only where a third foul costs", () => {
  assert.ok(E.foulRule("straight", 2).warns && E.foulRule("9ball", 2).warns);
  assert.ok(!E.foulRule("8ball", 2).warns);
});
test("who breaks next: the winner, the loser, or in turn", () => {
  assert.equal(E.nextBreaker("winner", ["A", "B"], "A", "B"), "B");
  assert.equal(E.nextBreaker("loser", ["A", "B"], "A", "B"), "A");
  assert.equal(E.nextBreaker("alternate", ["A", "B", "C"], "B", "A"), "C");
});
test("15-ball rotation: two players - 61 of the 120 wins", () => {
  const sc = (...xs) => xs.map((score, i) => ({ id: "p" + i, score }));
  assert.equal(E.rotationFrameWinner(sc(61, 20)), "p0");
  assert.equal(E.rotationFrameWinner(sc(60, 59)), null);
});
test("15-ball rotation: three players - the leader wins once nobody can catch them", () => {
  const sc = (...xs) => xs.map((score, i) => ({ id: "p" + i, score }));
  assert.equal(E.rotationFrameWinner(sc(50, 40, 30)), "p0");
  assert.equal(E.rotationFrameWinner(sc(50, 40, 20)), null);
});
