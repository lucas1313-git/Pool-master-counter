// Challonge pushes that tell the truth - the real push code, pulled out of js/app.js, against a
// fake Challonge (round robin and single elimination drawn the standard way, results checked the
// way Challonge does: an elimination match takes a result only once it's open):
// - a day's games, pushed mid-day: only the pairs that played go (no 1-1 ties for the rest);
//   pushed again after more games: the new pair and the changed totals go, nothing else; a score
//   that changes is sent again; "Bob beat Ann" and "Ann beat Bob" are one pair, and an older
//   record that noted a tie in roster order ("Dan|Cat") still counts for Cat|Dan;
// - 🔒 Close: only then do never-played pairs go, as 1-1 ties, and the tournament closes;
// - a round robin tournament: mid-event push, a later push after more results, a corrected score;
// - every page of Challonge's match list is read (66 matches, 25 a page), and a Challonge that
//   ignores the page number doesn't loop;
// - single elimination: our seeds go with the roster, Challonge draws the same round 1, and every
//   result lands, pushed in two goes - Challonge's champion is ours; a draw it can't copy, and
//   Swiss, send the roster only;
// - double elimination against a Challonge whose losers bracket differs: the push stops at the
//   first losers match and sends nothing after it;
// - new tournaments are private and named "<venue> - <date> - <format>".
// usage: node tests/test_challonge.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8").split("\n");
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "languages", "english.json"), "utf8"));
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
  if (start < 0) return "";
  let end = start;
  while (!/;\s*$/.test(src[end])) end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["challongeErrorTextFromBody", "createChallongeTournament", "startChallongeTournament", "finalizeChallongeTournament",
  "bulkAddChallongeParticipants", "fetchChallongeMatches", "reportChallongeMatchScore", "findChallongeMatchForPair",
  "challongePairKey", "challongeResultText", "challongeMatchState", "challongeSeedsForBracket", "planTournamentChallongePush",
  "challongeStartOnce", "challongeCloseOnce", "sendChallongeLines", "runTournamentChallongePush", "aggregateGamesByPair",
  "emptyChallongePushRecord", "normalizeChallongePushRecord", "planChallongePairPush", "pushGamesToChallongeRoundRobin",
  "challongePushResultText", "challongeRosterReasonKey", "challongeTournamentName", "challongeFormatText", "tournamentFormatLabel",
  "cleanNameText", "localDateStrFromTs",
  "nextPow2", "seedOrder", "createBracketMatch", "buildWinnersBracketRounds", "buildLosersBracketRounds", "advanceBracket",
  "advanceBracketV2", "pairUpNames", "wbRoundComplete", "pendingLbMatches", "buildSingleEliminationBracket",
  "buildDoubleEliminationBracket", "isGrandFinalMatch", "reportBracketResult"];
const VARS = ["CHALLONGE_TOURNAMENT_TYPE", "CHALLONGE_PAGE_SIZE", "CHALLONGE_MAX_PAGES", "POOL_DAY_START_HOUR"];
const prelude = `
var __n = 0; function uid() { return 'm' + ++__n; }
var lastChallongePushError = null;
var VENUE = ""; function loadChallongeVenue() { return VENUE; } function loadChallongePrivate() { return true; }
function saveTournamentToStorage() {}
function challongePushApiFailedText() { return "PUSH FAILED"; }
function finalizeRoundRobinIfComplete() {} function finalizeSwissRoundIfComplete() {}
function T(key, vars) { var s = EN[key] !== undefined ? EN[key] : key; Object.keys(vars || {}).forEach(function (k) { s = s.split("{{" + k + "}}").join(vars[k]); }); return s; }
function TP(key, n, vars) { return T(n === 1 && EN[key + "One"] !== undefined ? key + "One" : key, vars); }
function countPhrase(kind, n) { return TP("count." + kind, n, { n: n }); }
`;
const F = new Function("EN", "challongeAuthedRequest", prelude + VARS.map(extractVar).join("\n") + "\n" + NAMES.map(extract).join("\n") +
  "\nreturn {" + NAMES.join(",") + ", setVenue: function (v) { VENUE = v; }};")(EN, (m, p, b) => C.api(m, p, b));
console.warn = () => {};

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }

const { createFakeChallonge } = require("./challonge_mock");
let C; // the fake Challonge of the moment
function resetChallonge(paging) { C = createFakeChallonge(paging); }
const startTournament = (t) => C.start(t);
const nameOf = (t, id) => C.nameOf(t, id);
const challongeResults = (t) => C.results(t);
const onlyTournament = () => C.latest();
let ts = 1000;
const game = (w, l) => ({ ts: ts++, winnerNames: [w], opponentNames: [l], isTeam: false });

(async () => {
  // ================= a day's games =================
  resetChallonge("jsonapi");
  F.setVenue("Joe's Bar");
  const record = F.emptyChallongePushRecord();
  const save = () => {};
  let games = [game("Ann", "Bob"), game("Bob", "Ann"), game("Ann", "Bob"), game("Cat", "Dan")];
  let plan = F.planChallongePairPush(F.aggregateGamesByPair(games), JSON.parse(JSON.stringify(record)));
  check("day plan, mid-day: Ann|Bob 2-1 and Cat|Dan 1-0 to send, the 4 pairs that never played held back (not sent)",
    plan.send.map((l) => l.id + " " + l.now).join(", ") === "Ann|Bob 2-1/a, Cat|Dan 1-0/a" && plan.placeholders.length === 4, plan);
  let r = await F.pushGamesToChallongeRoundRobin(games, F.challongeTournamentName("Open play", "2026-10-28"), record, save, false);
  let ct = onlyTournament();
  check("...pushed: a private round robin named \"Joe's Bar — 2026-10-28 — Open play\"", ct.private === true && ct.type === "round robin" && ct.name === "Joe's Bar — 2026-10-28 — Open play", { name: ct.name, private: ct.private });
  check("...Challonge has exactly the 2 real results, no 1-1 ties for the pairs that didn't play", JSON.stringify(challongeResults(ct)) === JSON.stringify(["Ann 2-1 Bob", "Cat 1-0 Dan"]) && r.pushed === 2 && !r.filled, { results: challongeResults(ct), r });
  // later: a new pair, and Ann|Bob's totals change (named the other way round: Bob beat Ann)
  games = games.concat([game("Ann", "Cat"), game("Bob", "Ann")]);
  const sentBefore = C.log.length;
  r = await F.pushGamesToChallongeRoundRobin(games, "x", record, save, false);
  const sentNow = C.log.slice(sentBefore).map((e) => e.match);
  check("pushed again after more games: the new pair and the changed pair go (2 sends), Cat|Dan isn't sent again",
    r.pushed === 2 && sentNow.length === 2 && JSON.stringify(challongeResults(ct)) === JSON.stringify(["Ann 1-0 Cat", "Ann 2-2 Bob tie", "Cat 1-0 Dan"]), { r, results: challongeResults(ct) });
  // a changed score: one more win for Ann against Bob
  games = games.concat([game("Ann", "Bob")]);
  plan = F.planChallongePairPush(F.aggregateGamesByPair(games), JSON.parse(JSON.stringify(record)));
  const upd = plan.send.find((l) => l.id === "Ann|Bob");
  check("a changed score shows as an update (was 2-2 tie, now 3-2) and only it is to send", plan.send.length === 1 && upd && upd.kind === "update" && upd.was === "2-2/tie" && upd.now === "3-2/a", plan.send);
  await F.pushGamesToChallongeRoundRobin(games, "x", record, save, false);
  check("...and Challonge gets 3-2", challongeResults(ct).includes("Ann 3-2 Bob"), challongeResults(ct));
  check("both name orders are one pair: one Challonge match for Ann and Bob", ct.matches.filter((m) => m.players.map((id) => nameOf(ct, id)).sort().join("|") === "Ann|Bob").length === 1);
  // 🔒 Close: the never-played pairs go now, as 1-1 ties - only them - and it closes
  plan = F.planChallongePairPush(F.aggregateGamesByPair(games), JSON.parse(JSON.stringify(record)));
  check("close plan: the 3 never-played pairs (Ann|Dan, Bob|Cat, Bob|Dan) and nothing else", plan.placeholders.map((p) => p.id).join(", ") === "Ann|Dan, Bob|Cat, Bob|Dan" && !plan.send.length, plan);
  r = await F.pushGamesToChallongeRoundRobin(games, "x", record, save, true);
  check("...Close sends them as 1-1 ties and Challonge closes", r.filled === 3 && r.closed === true && ct.state === "complete" && challongeResults(ct).filter((s) => / 1-1 .* tie$/.test(s)).length === 3, { r, results: challongeResults(ct) });
  check("...the result says so", /3 never-played pairs sent as 1–1 ties/.test(F.challongePushResultText(r)) && /closed/i.test(F.challongePushResultText(r)), F.challongePushResultText(r));

  // an older record: a tie noted in roster order ("Dan|Cat"), real results without totals
  const old = { challongeTournamentId: "x", challongeParticipantIds: { Cat: "1", Dan: "2", Eve: "3" }, challongePushedPairKeys: { "Dan|Cat": true, "Cat|Eve": true } };
  plan = F.planChallongePairPush(F.aggregateGamesByPair([game("Eve", "Cat")]), old);
  check("an older record's \"Dan|Cat\" counts for Cat|Dan (no second tie); Cat|Eve, sent before without its score, is sent again",
    plan.placeholders.map((p) => p.id).join(",") === "Dan|Eve" && plan.send.length === 1 && plan.send[0].id === "Cat|Eve" && plan.send[0].was === "?", plan);

  // ================= every page of the match list =================
  for (const paging of ["jsonapi", "nolinks", "ignore"]) {
    resetChallonge(paging);
    const twelve = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "B1", "B2", "B3"];
    const g = [];
    for (let i = 0; i < twelve.length; i++) for (let j = i + 1; j < twelve.length; j++) g.push(game(twelve[i], twelve[j]));
    const rec = F.emptyChallongePushRecord();
    r = await F.pushGamesToChallongeRoundRobin(g, "x", rec, save, true);
    ct = onlyTournament();
    check("12 players, 66 matches, Challonge " + { jsonapi: "paging 25 at a time with links", nolinks: "paging 25 at a time, no links", ignore: "ignoring the page number" }[paging] + ": all 66 results land, it closes",
      r.pushed === 66 && !r.failed && ct.state === "complete", { pushed: r.pushed, failed: r.failed, state: ct.state });
  }

  // ================= a round robin tournament =================
  resetChallonge("jsonapi");
  F.setVenue("");
  const rrNames = ["Ann", "Bob", "Cat", "Dan", "Eve"];
  const rr = { format: "roundrobin", createdAt: "2026-10-28T20:00:00", players: rrNames.slice(), matches: [] };
  for (let i = 0; i < rrNames.length; i++) for (let j = i + 1; j < rrNames.length; j++) rr.matches.push({ id: "rr" + i + j, a: rrNames[i], b: rrNames[j], winner: null, scoreA: null, scoreB: null, tag: "Round Robin" });
  const play = (m, aWins, bWins) => { m.scoreA = aWins; m.scoreB = bWins; m.winner = aWins > bWins ? m.a : m.b; };
  play(rr.matches[0], 3, 1); play(rr.matches[1], 0, 3); play(rr.matches[4], 3, 2);
  r = await F.runTournamentChallongePush(rr, false);
  ct = onlyTournament();
  check("round robin, mid-event (3 of 10 played): 3 results sent, the 7 unplayed left alone (no 1-1 ties)",
    r.pushed === 3 && challongeResults(ct).length === 3 && ct.matches.filter((m) => m.state === "open").length === 7, { r, results: challongeResults(ct) });
  check("...named \"Pool Master Counter — 2026-10-28 — Round Robin\", private", ct.name === "Pool Master Counter — 2026-10-28 — Round Robin" && ct.private === true, ct.name);
  play(rr.matches[2], 3, 0); play(rr.matches[3], 1, 3); play(rr.matches[5], 3, 1); play(rr.matches[6], 2, 3);
  r = await F.runTournamentChallongePush(rr, false);
  check("a later push after 4 more results: those 4 go, 7 on Challonge now", r.pushed === 4 && challongeResults(ct).length === 7, { r, results: challongeResults(ct) });
  play(rr.matches[0], 3, 2); // a corrected score: Ann-Bob was 3-1
  plan = F.planTournamentChallongePush(rr);
  check("a corrected score (Ann-Bob 3-1 -> 3-2): the one update, nothing else", plan.send.length === 1 && plan.send[0].kind === "update" && plan.send[0].was === "3-1/a", plan.send);
  r = await F.runTournamentChallongePush(rr, false);
  check("...Challonge has 3-2", r.pushed === 1 && challongeResults(ct).includes("Ann 3-2 Bob"), challongeResults(ct));
  plan = F.planTournamentChallongePush(rr);
  check("close plan: the 3 matches not played, as placeholders", plan.placeholders.length === 3 && !plan.send.length, plan);
  r = await F.runTournamentChallongePush(rr, true);
  check("...Close: 3 ties, closed", r.filled === 3 && r.closed === true && ct.state === "complete", r);
  // pushed by an older version (pushedMatchIds, no scores): sent again to be sure
  const legacy = { format: "roundrobin", players: ["Ann", "Bob"], matches: [{ id: "x1", a: "Ann", b: "Bob", winner: "Bob", scoreA: 1, scoreB: 3 }], challongePushedMatchIds: { x1: true }, challongeTournamentId: "old" };
  plan = F.planTournamentChallongePush(legacy);
  check("a match an older version pushed (no score noted) is sent again", plan.send.length === 1 && plan.send[0].was === "?", plan);

  // ================= single elimination =================
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  function playOut(t, upTo) {
    for (let guard = 0; guard < 500 && !t.champion; guard++) {
      const open = [].concat(...t.wb, ...(t.lbRounds || []), t.grandFinal || []).filter((m) => m.a && m.b && !m.winner);
      if (!open.length || (upTo && upTo-- <= 0)) return;
      const m = open[Math.floor(rng() * open.length)];
      const aWon = rng() < 0.5;
      F.reportBracketResult(t, m, aWon ? m.a : m.b, aWon ? 3 : Math.floor(rng() * 3), aWon ? Math.floor(rng() * 3) : 3);
    }
  }
  for (const n of [6, 8, 11]) {
    resetChallonge("jsonapi");
    const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
    const t = F.buildSingleEliminationBracket(names, "8ball", 1, 3, false, null, false);
    r = await F.runTournamentChallongePush(t, false); // the roster with seeds, before anything's played
    ct = onlyTournament();
    // (every match ready to play, round 2 too: two bye players can meet there straight away)
    const ours = [].concat(...t.wb).filter((m) => m.a && m.b && !m.winner).map((m) => [m.a, m.b].sort().join("-")).sort();
    const theirs = ct.state === "pending" ? (startTournament(ct), ct.matches.filter((m) => m.state === "open").map((m) => m.players.map((id) => nameOf(ct, id)).sort().join("-")).sort()) : [];
    ct.state = "pending"; ct.matches = []; // (back as it was: the push starts it itself)
    check(n + " players, single elimination: seeds sent with the roster, Challonge draws our round 1", r.mode === "elimination" && JSON.stringify(ours) === JSON.stringify(theirs), { ours, theirs });
    playOut(t, Math.ceil(n / 2));
    const r1 = await F.runTournamentChallongePush(t, false);
    playOut(t);
    const r2 = await F.runTournamentChallongePush(t, false);
    const played = [].concat(...t.wb).filter((m) => m.a && m.b && m.winner).length;
    check("...pushed mid-event and again at the end: all " + played + " results land, Challonge's champion is ours (" + t.champion + ")",
      !r1.failed && !r2.failed && r1.pushed + r2.pushed === played && nameOf(ct, ct.champion) === t.champion, { r1, r2, champion: nameOf(ct, ct.champion), ours: t.champion });
  }
  // a draw Challonge can't copy (Match Similar Ratings with byes), Swiss: the roster only
  const sim = F.buildSingleEliminationBracket(["S1", "S2", "S3", "S4", "S5", "S6"], "8ball", 1, 3, false, ["S1", "S2", "S3", "S4", "S5", "S6"], true);
  plan = F.planTournamentChallongePush(sim);
  check("Match Similar Ratings with byes (6 players): can't be copied, the roster only", plan.mode === "roster" && plan.reason === "draw", plan.mode + " " + plan.reason);
  const sim8 = F.buildSingleEliminationBracket(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"], "8ball", 1, 3, false, ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"], true);
  check("...with no byes (8 players) it can: seeds that give S1-S2, S3-S4, ...", F.planTournamentChallongePush(sim8).mode === "elimination");
  plan = F.planTournamentChallongePush({ format: "swiss", players: ["A", "B"], rounds: [] });
  check("Swiss: the roster only", plan.mode === "roster" && plan.reason === "swiss");
  check("an elimination bracket pushed by an older version (no seeds): the roster only", F.planTournamentChallongePush({ format: "single", bracketVersion: 2, wb: [[]], challongeTournamentId: "old" }).reason === "unseeded");

  // ================= double elimination, Challonge's losers bracket differs =================
  resetChallonge("jsonapi");
  const de = F.buildDoubleEliminationBracket(["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"], "8ball", 1, 3, false, null, false);
  playOut(de);
  r = await F.runTournamentChallongePush(de, false);
  ct = onlyTournament();
  const lbPlayed = [].concat(...de.lbRounds).filter((m) => m.a && m.b && m.winner).length;
  const wbPlayed = [].concat(...de.wb).filter((m) => m.a && m.b && m.winner).length;
  check("double elimination vs a Challonge whose losers bracket differs: the winners bracket lands (" + wbPlayed + "), it stops at the first losers match, nothing after",
    r.pushed === wbPlayed && r.failed === 1 && r.stoppedAt && /^Losers/.test(r.stoppedAt.tag) && C.log.length === wbPlayed && lbPlayed > 0, { r, log: C.log.length, wbPlayed });
  check("...and says where it stopped", F.challongePushResultText(r).includes("Stopped at " + r.stoppedAt.tag), F.challongePushResultText(r));

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
