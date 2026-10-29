// Breaks, fouls, safeties and innings (P24), the real functions pulled out of js/app.js:
// - a run ends on a Miss and on a Safety: A runs 10, misses; B plays safe without scoring; A runs
//   5 - A's high run is 10, not 15; innings and safeties counted;
// - 14.1 fouls: −1, −2 on the break; three in a row (with the opponent's turns between them) -
//   −16 (the foul and 15 more) and a re-rack; a legal shot clears the streak; the two-foul warning
//   is for 14.1, 9-ball and 10-ball only; a third foul in 9-ball loses the rack;
// - who breaks next: the winner, the loser, or in turn;
// - 15-ball rotation: two players - the first to 61; three players at 50-40-30 - the 50 has won
//   (nobody can catch them), where a fixed 61 would never end; 50-40-20 isn't over (10 left).
// usage: node tests/test_events.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["newTurnTracker", "turnStart", "turnPot", "turnEnd", "foulRule", "nextBreaker", "rotationFrameWinner"];
const F = new Function(
  'var THREE_FOUL_GAMES = { straight: "rerack", "9ball": "lose", "10ball": "lose" }; var ROTATION_FRAME_POINTS = 120;\n' +
  NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }

// runs end on Miss and Safety
let tr = F.newTurnTracker("A");
F.turnPot(tr, "A", 10);
F.turnEnd(tr, "miss", "B");
F.turnEnd(tr, "safety", "A");
F.turnPot(tr, "A", 5);
check("A runs 10, misses; B plays safe without scoring; A runs 5: A's high run is 10, not 15", tr.best.A === 10 && tr.run === 5 && !tr.best.B, tr);
check("...innings A 2, B 1; B's safety counted", tr.innings.A === 2 && tr.innings.B === 1 && tr.safeties.B === 1 && !tr.safeties.A, tr);
F.turnPot(tr, "B", 3);
check("a player scoring out of turn takes the table (their run, their inning)", tr.shooter === "B" && tr.run === 3 && tr.innings.B === 2 && tr.best.A === 10);

// 14.1 fouls
check("14.1: a foul −1, a break foul −2", F.foulRule("straight", 1).points === -1 && F.foulRule("straight", 1, true).points === -2 && !F.foulRule("straight", 2).third);
tr = F.newTurnTracker("A");
const rows = [];
for (let i = 0; i < 3; i++) {
  rows.push(F.turnEnd(tr, "foul", "B"));
  F.turnEnd(tr, "miss", "A");
}
const third = F.foulRule("straight", rows[2]);
check("14.1: three fouls in a row (B's turns between them) - the third is −16 (−1 and 15 more) and a re-rack", rows.join() === "1,2,3" && third.points === -16 && third.third === "rerack", { rows, third });
tr = F.newTurnTracker("A");
F.turnEnd(tr, "foul", "B");
F.turnEnd(tr, "miss", "A");
F.turnEnd(tr, "foul", "B");
F.turnEnd(tr, "miss", "A");
F.turnPot(tr, "A", 1);
const after = F.turnEnd(tr, "foul", "B");
check("...a legal shot between them clears the streak (foul, foul, a ball, foul: 1 in a row)", after === 1 && tr.fouls.A === 3, { after, tr });
check("the two-foul warning: 14.1, 9-ball, 10-ball - not 8-ball", F.foulRule("straight", 2).warns && F.foulRule("9ball", 2).warns && F.foulRule("10ball", 2).warns && !F.foulRule("8ball", 2).warns);
check("9-ball: a third foul in a row loses the rack (no points)", F.foulRule("9ball", 3).third === "lose" && F.foulRule("9ball", 3).points === 0 && !F.foulRule("8ball", 3).third);

// who breaks
check("who breaks next: the winner / the loser / in turn", F.nextBreaker("winner", ["A", "B"], "A", "B") === "B" && F.nextBreaker("loser", ["A", "B"], "A", "B") === "A" && F.nextBreaker("alternate", ["A", "B"], "A", "A") === "B" && F.nextBreaker("alternate", ["A", "B", "C"], "C", "A") === "A");

// 15-ball rotation
const sc = (...xs) => xs.map((score, i) => ({ id: "p" + i, score }));
check("15-ball, two players: 61 wins, 60-59 doesn't", F.rotationFrameWinner(sc(61, 30)) === "p0" && F.rotationFrameWinner(sc(60, 59)) === null);
check("15-ball, three players at 50-40-30: the 50 has won (nobody can catch them) - a fixed 61 never ends", F.rotationFrameWinner(sc(30, 50, 40)) === "p1");
check("...50-40-20 isn't over (10 points still on the table)", F.rotationFrameWinner(sc(50, 40, 20)) === null && F.rotationFrameWinner(sc(52, 40, 20)) === "p0");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
