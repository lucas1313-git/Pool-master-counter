// The chip tournament's rules (js/lib/chips.js, P34): chips by rating band, the waiting line,
// a chip lost a game, out at 0, the last one with chips wins.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/lib/chips.js");

test("chips by rating band: weaker players get more - 4 up to 399, 3 up to 549, 2 above", () => {
  assert.equal(C.chipsForRating(null, 320), 4);
  assert.equal(C.chipsForRating(null, 399), 4);
  assert.equal(C.chipsForRating(null, 400), 3);
  assert.equal(C.chipsForRating(null, 549), 3);
  assert.equal(C.chipsForRating(null, 550), 2);
  assert.equal(C.chipsForRating(null, 820), 2);
});

test("a chart as typed: sorted, one open row last, chips 1-20", () => {
  assert.deepEqual(C.cleanChipChart([{ upTo: "600", chips: "2" }, { upTo: "", chips: "1" }, { upTo: "450", chips: "3" }, { upTo: 300, chips: 99 }]), [{ upTo: 300, chips: 20 }, { upTo: 450, chips: 3 }, { upTo: 600, chips: 2 }, { upTo: null, chips: 1 }]);
  assert.deepEqual(C.cleanChipChart([{ upTo: 500, chips: 3 }]), [{ upTo: 500, chips: 3 }, { upTo: null, chips: 3 }]);
  assert.equal(C.chipsForRating([{ upTo: 450, chips: 5 }, { upTo: null, chips: 1 }], 700), 1);
});

test("the start: everyone's chips from their rating, the line as given", () => {
  const r = { Ann: 350, Ben: 480, Cat: 600 };
  const s = C.startChipState(["Ann", "Ben", "Cat"], (n) => r[n], null);
  assert.deepEqual(s.chips, { Ann: 4, Ben: 3, Cat: 2 });
  assert.deepEqual(s.line, ["Ann", "Ben", "Cat"]);
});

test("the next two from the line - but not the same two again while someone else waits", () => {
  const s = { line: ["Ann", "Ben", "Cat"], lastOpponent: { Ann: "Ben", Ben: "Ann" } };
  assert.deepEqual(C.nextChipPair(s), ["Ann", "Cat"]);
  assert.deepEqual(C.nextChipPair({ line: ["Ann", "Ben"], lastOpponent: { Ann: "Ben", Ben: "Ann" } }), ["Ann", "Ben"]);
  assert.equal(C.nextChipPair({ line: ["Ann"], lastOpponent: {} }), null);
});

test("a game: the loser gives up a chip; both to the back of the line, the winner first; out at 0", () => {
  const s = { chips: { Ann: 2, Ben: 1, Cat: 2 }, startChips: {}, line: ["Cat"], bustOrder: [], lastOpponent: {} };
  let r = C.recordChipGame(s, "Ann", "Cat");
  assert.deepEqual([s.chips.Cat, s.line], [1, ["Ann", "Cat"]]);
  assert.deepEqual(r, { out: null, champion: null });
  r = C.recordChipGame(s, "Ann", "Ben");
  assert.deepEqual(r, { out: "Ben", champion: null });
  assert.deepEqual(s.line, ["Cat", "Ann"]);
  assert.deepEqual(s.bustOrder, ["Ben"]);
  r = C.recordChipGame(s, "Ann", "Cat");
  assert.deepEqual(r, { out: "Cat", champion: "Ann" });
  assert.deepEqual(C.chipPlacings(s, "Ann"), [{ place: 1, names: ["Ann"] }, { place: 2, names: ["Cat"] }, { place: 3, names: ["Ben"] }]);
});

test("a withdrawal: every chip gone, out of the line; late in: to the back with chart chips", () => {
  const s = { chips: { Ann: 2, Ben: 3, Cat: 2 }, startChips: { Ann: 2, Ben: 3, Cat: 2 }, line: ["Ann", "Ben", "Cat"], bustOrder: [], lastOpponent: {} };
  C.chipKnockOut(s, "Ben");
  assert.deepEqual([s.chips.Ben, s.line, s.bustOrder], [0, ["Ann", "Cat"], ["Ben"]]);
  C.addChipPlayer(s, "Dan", 4);
  assert.deepEqual(s.line, ["Ann", "Cat", "Dan"]);
  assert.deepEqual(C.chipStandings(s).map((x) => x.name + x.chips), ["Dan4", "Ann2", "Cat2", "Ben0"]);
});

test("12 players to one: every game costs exactly one chip, until one player has chips", () => {
  const names = Array.from({ length: 12 }, (_, i) => "P" + (i + 1));
  const s = C.startChipState(names, (n) => 300 + names.indexOf(n) * 40, null);
  const total = () => Object.values(s.chips).reduce((a, b) => a + b, 0);
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let games = 0, champion = null;
  const start = total();
  while (!champion && games < 500) {
    const pair = C.nextChipPair(s);
    C.takeChipPair(s, pair);
    const before = total();
    const r = rnd() < 0.5 ? C.recordChipGame(s, pair[0], pair[1]) : C.recordChipGame(s, pair[1], pair[0]);
    assert.equal(total(), before - 1);
    champion = r.champion;
    games++;
  }
  assert.ok(champion, "a champion");
  assert.equal(games, start - total());
  assert.equal(C.chipPlacings(s, champion).length, 12);
});
