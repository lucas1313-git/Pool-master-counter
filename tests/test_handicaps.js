// League handicaps and points that match the leagues - the real functions, pulled out of js/app.js:
// - APA 8-Ball races from BOTH players' Skill Levels: all 36 cells of APA's "Games Must Win" chart
//   (typed below from APA's own chart, rules.poolplayers.com), in the code and in
//   data/handicap-charts.json; an 8 or 9 entered for 8-Ball reads as a 7;
// - APA 9-Ball points to win per player (14 ... 75); handicap off = the base for both; a per-player
//   chart (VNBA/TAP as entered) still per player, the base for anyone it doesn't cover;
// - BCA races from win probability: gaps 0, 50, 100, 200 (and more) give the higher-rated player a
//   race no longer than twice the base, growing with the gap, and closer to an even match than an
//   equal race;
// - APA 8-Ball league points 3-0 (shutout), 2-1 (loser on the hill), 2-0; APA 9-Ball's 20 points
//   split by the Score of Match chart (every row, every score - typed from APA's 9-Ball
//   scorekeeping sheet), including APA's own example (an SL3 who lost with 21 points: 13-7);
//   other systems keep 2 to the winner, 1 to a loser who reached half.
// usage: node tests/test_handicaps.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }"; // (an older app.js)
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
function extractVar(name) {
  const start = src.findIndex((l) => l.startsWith("  var " + name + " ="));
  if (start < 0) return "var " + name + ";";
  let end = start;
  while (!/;\s*$/.test(src[end])) end++;
  return src.slice(start, end + 1).join("\n");
}
const VARS = ["APA_8BALL_RACE_CHART", "APA_8BALL_MIN_SL", "APA_8BALL_MAX_SL", "APA_9BALL_POINTS_TARGET", "APA_9BALL_LOSER_POINT_STEPS", "HANDICAP_CHARTS", "BCA_MAX_RACE_FACTOR"];
const NAMES = ["leagueChartSkillLevel", "handicapChartRaces", "leagueMatchTargets", "leagueEffectiveHandicapChart", "bcaRaceForRatingGap",
  "leagueBcaMatchTargets", "eloExpectedScore", "raceWinProbability", "leaguePointsForResult", "apa9BallLoserMatchPoints"];
const RATINGS = {};
const F = new Function("RATINGS", "function getPlayerRating(n) { return RATINGS[n] || 400; }\n" + VARS.map(extractVar).join("\n") + "\n" + NAMES.map(extract).join("\n") +
  "\nreturn {" + NAMES.join(",") + "};")(RATINGS);

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }
const league = (system, format, extra) => Object.assign({ useHandicap: true, handicapSystem: system, format, handicapBaseGames: format === "apa9ball" ? 38 : 5,
  customHandicapCharts: { apa: { "8ball": {}, "9ball": {} }, bca: { "8ball": {}, "9ball": {} }, vnba: { "8ball": {}, "9ball": {} }, tap: { "8ball": {}, "9ball": {} } } }, extra || {});
const race = (lg, slA, slB) => { const r = F.leagueMatchTargets(lg, { name: "A", skillLevel: slA }, { name: "B", skillLevel: slB }); return r.targetA + "-" + r.targetB; };

// ---- APA 8-Ball: "Games Must Win", you (rows) v opponent (columns), Skill Levels 2-7 ----
const APA8 = {
  2: ["2/2", "2/3", "2/4", "2/5", "2/6", "2/7"],
  3: ["3/2", "2/2", "2/3", "2/4", "2/5", "2/6"],
  4: ["4/2", "3/2", "3/3", "3/4", "3/5", "2/5"],
  5: ["5/2", "4/2", "4/3", "4/4", "4/5", "3/5"],
  6: ["6/2", "5/2", "5/3", "5/4", "5/5", "4/5"],
  7: ["7/2", "6/2", "5/2", "5/3", "5/4", "5/5"]
};
const apa8 = league("apa", "apa8ball");
const wrong = [];
for (let you = 2; you <= 7; you++) for (let opp = 2; opp <= 7; opp++) {
  const want = APA8[you][opp - 2].replace("/", "-");
  if (race(apa8, you, opp) !== want) wrong.push({ you, opp, want, got: race(apa8, you, opp) });
}
check("APA 8-Ball: all 36 cells of APA's Games Must Win chart, from both players' Skill Levels", wrong.length === 0, wrong);
check("...samples: 7 v 7 is 5-5, 7 v 6 is 5-4, 6 v 7 is 4-5, 3 v 3 is 2-2, 6 v 3 is 5-2 (APA's own example)",
  race(apa8, 7, 7) === "5-5" && race(apa8, 7, 6) === "5-4" && race(apa8, 6, 7) === "4-5" && race(apa8, 3, 3) === "2-2" && race(apa8, 6, 3) === "5-2");
check("...an 8 or 9 entered for 8-Ball reads as a 7 (9 v 6 is 5-4)", race(apa8, 9, 6) === "5-4" && race(apa8, 8, 8) === "5-5");
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "handicap-charts.json"), "utf8"));
const fileWrong = [];
for (let you = 2; you <= 7; you++) for (let opp = 2; opp <= 7; opp++) {
  const cell = ((file.apa["8ball"] || {})[you] || {})[opp];
  if (!Array.isArray(cell) || cell.join("/") !== APA8[you][opp - 2]) fileWrong.push({ you, opp, cell });
}
check("data/handicap-charts.json: the same 36 cells, with its source cited", fileWrong.length === 0 && /rules\.poolplayers\.com/.test(JSON.stringify(file._sources || "")), fileWrong);
const APA9 = { 1: 14, 2: 19, 3: 25, 4: 31, 5: 38, 6: 46, 7: 55, 8: 65, 9: 75 };
check("APA 9-Ball points to win (14 ... 75) in the code and the file", JSON.stringify(Object.keys(APA9).map((sl) => race(league("apa", "apa9ball"), +sl, +sl).split("-")[0] * 1)) === JSON.stringify(Object.values(APA9)) &&
  Object.keys(APA9).every((sl) => file.apa["9ball"][sl] === APA9[sl]));
check("...each player's own: an SL2 v an SL6 is 19-46", race(league("apa", "apa9ball"), 2, 6) === "19-46");
check("handicap off: both race to the base", race(league("apa", "apa8ball", { useHandicap: false, handicapBaseGames: 4 }), 7, 2) === "4-4");
const vnba = league("vnba", "apa8ball");
vnba.customHandicapCharts.vnba["8ball"] = { 3: 4, 5: 6 };
check("a per-player chart (VNBA as entered): each one's own number (4-6), the base (5) for a Skill Level it doesn't cover", race(vnba, 3, 5) === "4-6" && race(vnba, 3, 9) === "4-5");

// ---- BCA: from win probability, at most twice the base ----
const bcaRaces = {};
let bcaOk = true;
const bcaBad = [];
for (const base of [3, 5, 7]) {
  let prev = 0;
  for (const gap of [0, 25, 50, 100, 150, 200, 300, 500]) {
    const r = F.bcaRaceForRatingGap(base, gap);
    if (base === 5) bcaRaces[gap] = r;
    const p = F.eloExpectedScore(gap, 0);
    const fairer = Math.abs(F.raceWinProbability(p, r, base) - 0.5) <= Math.abs(F.raceWinProbability(p, base, base) - 0.5) + 1e-12;
    if (r < base || r > 2 * base || r < prev || !fairer) bcaBad.push({ base, gap, r });
    prev = r;
  }
}
check("BCA, base 5: a race of 5 at no gap; " + JSON.stringify(bcaRaces), bcaRaces[0] === 5 && bcaRaces[50] > 5 && bcaRaces[100] > bcaRaces[50] && bcaRaces[200] <= 10);
check("...bases 3, 5, 7 and gaps 0-500: never shorter than the base, never more than twice it, growing with the gap, always fairer than an equal race", bcaBad.length === 0, bcaBad);
check("...the old rule's 25 extra games for a 100-point gap is gone (a race of " + bcaRaces[100] + " to 5)", bcaRaces[100] <= 10);
RATINGS.Hi = 600; RATINGS.Lo = 500;
const bca = league("bca", "apa8ball");
const t1 = F.leagueBcaMatchTargets(bca, { name: "Hi" }, { name: "Lo" }), t2 = F.leagueBcaMatchTargets(bca, { name: "Lo" }, { name: "Hi" });
check("...the higher-rated player gets the longer race, whichever side they're on", t1.targetA === bcaRaces[100] && t1.targetB === 5 && t2.targetA === 5 && t2.targetB === bcaRaces[100], { t1, t2 });
check("...through leagueMatchTargets too", F.leagueMatchTargets(bca, { name: "Hi", skillLevel: 3 }, { name: "Lo", skillLevel: 3 }).targetA === bcaRaces[100]);
check("...9-Ball points (base 38), a 100-point gap: at most 76", F.bcaRaceForRatingGap(38, 100) <= 76 && F.bcaRaceForRatingGap(38, 100) > 38);

// ---- league points ----
const pts = (lg, w, wt, l, lt, lsl) => { const r = F.leaguePointsForResult(lg, w, wt, l, lt, lsl); return r.winnerPoints + "-" + r.loserPoints; };
check("APA 8-Ball points: a shutout 5-0 is 3-0", pts(apa8, 5, 5, 0, 4) === "3-0");
check("...the loser on the hill (3 of 4) is 2-1; a race to 2 lost 2-1 is 2-1 too", pts(apa8, 5, 5, 3, 4) === "2-1" && pts(apa8, 2, 2, 1, 2) === "2-1");
check("...anything else (2 of 4) is 2-0", pts(apa8, 5, 5, 2, 4) === "2-0");
// APA 9-Ball Score of Match: the loser's points for 20-0, 19-1, ... 12-8, by the loser's Skill Level
const SCORE_OF_MATCH = {
  1: ["<3", "3", "4", "5-6", "7", "8", "9-10", "11", "12-13"],
  2: ["<4", "4-5", "6-7", "8", "9-10", "11-12", "13-14", "15-16", "17-18"],
  3: ["<5", "5-6", "7-9", "10-11", "12-14", "15-16", "17-19", "20-21", "22-24"],
  4: ["<6", "6-8", "9-11", "12-14", "15-18", "19-21", "22-24", "25-27", "28-30"],
  5: ["<7", "7-10", "11-14", "15-18", "19-22", "23-26", "27-29", "30-33", "34-37"],
  6: ["<9", "9-12", "13-17", "18-22", "23-27", "28-31", "32-36", "37-40", "41-45"],
  7: ["<11", "11-15", "16-21", "22-26", "27-32", "33-37", "38-43", "44-49", "50-54"],
  8: ["<14", "14-19", "20-26", "27-32", "33-39", "40-45", "46-52", "53-58", "59-64"],
  9: ["<18", "18-24", "25-31", "32-38", "39-46", "47-53", "54-60", "61-67", "68-74"]
};
const apa9 = league("apa", "apa9ball");
const somWrong = [];
Object.keys(SCORE_OF_MATCH).forEach((sl) => {
  SCORE_OF_MATCH[sl].forEach((band, loserPts) => {
    const [lo, hi] = band.startsWith("<") ? [0, +band.slice(1) - 1] : band.split("-").length === 2 ? band.split("-").map(Number) : [+band, +band];
    for (let made = lo; made <= hi; made++) {
      const got = pts(apa9, APA9[6], APA9[6], made, APA9[sl], +sl);
      if (got !== (20 - loserPts) + "-" + loserPts) somWrong.push({ sl, made, want: (20 - loserPts) + "-" + loserPts, got });
    }
  });
});
check("APA 9-Ball points: every row and score of APA's Score of Match chart (20-0 ... 12-8)", somWrong.length === 0, somWrong.slice(0, 5));
check("...APA's own example: an SL3 who lost with 21 points - 13-7", pts(apa9, 38, 38, 21, 25, 3) === "13-7");
check("...an SL5 who made 6 - 20-0; an SL9 one short (74) - 12-8", pts(apa9, 25, 25, 6, 38, 5) === "20-0" && pts(apa9, 25, 25, 74, 75, 9) === "12-8");
check("...handicap off (everyone to 38): an SL3 loser with 20 reads the 38-point row - 16-4", pts(league("apa", "apa9ball", { useHandicap: false }), 38, 38, 20, 38, 3) === "16-4");
check("BCA/VNBA/TAP keep 2 to the winner, 1 to a loser who reached half", pts(bca, 5, 5, 3, 5) === "2-1" && pts(vnba, 5, 5, 2, 5) === "2-0" && pts(league("tap", "apa9ball"), 38, 38, 0, 38) === "2-0");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
