// js/lib/league.js
// League standings as the sum of the match list, seasons and teams, and merging two copies of a 
// league (another device's) into one.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.league (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // ---- League standings from the match list (P23) ----
  // A member's played / won / points are the sum of the league's matches,
  // so an edit, a delete, a merged import or the relay just recomputes.
  // A league saved before every match was kept may count more than its
  // list: that difference is taken once as a baseline (season 1) and
  // kept, so nobody loses what they had.
  function leagueMatchSums(league, season) {
    var sums = {};
    (league.members || []).forEach(function (mem) { sums[mem.name] = { played: 0, won: 0, points: 0 }; });
    (league.matches || []).forEach(function (m) {
      if (season && (m.season || 1) !== season) return;
      [["playerA", "leaguePointsA"], ["playerB", "leaguePointsB"]].forEach(function (side) {
        var s = sums[m[side[0]]];
        if (!s) return;
        s.played += 1;
        if (m.winner === m[side[0]]) s.won += 1;
        s.points += m[side[1]] || 0;
      });
    });
    return sums;
  }

  function takeLeagueStandingsBaseline(league) {
    var sums = leagueMatchSums(league);
    var base = {};
    (league.members || []).forEach(function (mem) {
      var s = sums[mem.name];
      var extra = { played: Math.max(0, (mem.matchesPlayed || 0) - s.played), won: Math.max(0, (mem.matchesWon || 0) - s.won), points: Math.max(0, (mem.leaguePoints || 0) - s.points) };
      if (extra.played || extra.won || extra.points) base[mem.name] = extra;
    });
    league.standingsBaseline = base;
    league.standingsFromMatches = true;
  }

  function recomputeLeagueStandings(league) {
    var sums = leagueMatchSums(league);
    var base = league.standingsBaseline || {};
    (league.members || []).forEach(function (mem) {
      var s = sums[mem.name], b = base[mem.name] || {};
      mem.matchesPlayed = (b.played || 0) + s.played;
      mem.matchesWon = (b.won || 0) + s.won;
      mem.leaguePoints = (b.points || 0) + s.points;
    });
  }

  // One season's standings rows (members with that season's counts only)
  function leagueSeasonRows(league, season) {
    var sums = leagueMatchSums(league, season);
    var base = season === 1 ? league.standingsBaseline || {} : {};
    return (league.members || []).map(function (mem) {
      var s = sums[mem.name], b = base[mem.name] || {};
      return Object.assign({}, mem, { matchesPlayed: (b.played || 0) + s.played, matchesWon: (b.won || 0) + s.won, leaguePoints: (b.points || 0) + s.points });
    });
  }

  // Teams' standings: their members' totals (the rows given)
  function leagueTeamRows(league, rows) {
    return (league.teams || []).map(function (team) {
      var mine = rows.filter(function (r) { var t = leagueTeamForMember(league, r.name); return t && t.id === team.id; });
      return {
        name: team.name,
        played: mine.reduce(function (a, r) { return a + r.matchesPlayed; }, 0),
        won: mine.reduce(function (a, r) { return a + r.matchesWon; }, 0),
        points: mine.reduce(function (a, r) { return a + r.leaguePoints; }, 0)
      };
    }).sort(function (a, b) { return b.points - a.points || b.won - a.won || a.name.localeCompare(b.name); });
  }

  // Merges a league file into this device's copy of the same league (P23):
  // matches by id (an id on both: the later edit wins), deleted matches
  // stay deleted (either side's), members, teams and the latest
  // season/week added; then the standings recomputed. Returns the matches
  // this device didn't have (for their rating changes).
  function mergeLeagueInto(local, incoming) {
    var deleted = {};
    (local.deletedMatchIds || []).concat(incoming.deletedMatchIds || []).forEach(function (id) { deleted[id] = true; });
    var byId = {};
    var added = [];
    (local.matches || []).forEach(function (m) { byId[m.id] = m; });
    (incoming.matches || []).forEach(function (m) {
      var mine = byId[m.id];
      if (!mine) {
        byId[m.id] = m;
        if (!deleted[m.id]) added.push(m);
      } else if ((m.editedAt || m.ts || "") > (mine.editedAt || mine.ts || "")) {
        byId[m.id] = m;
      }
    });
    local.matches = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (m) { return !deleted[m.id]; }).sort(function (a, b) { return (a.ts || "").localeCompare(b.ts || ""); });
    local.deletedMatchIds = Object.keys(deleted);
    (incoming.members || []).forEach(function (mem) {
      if (!local.members.some(function (x) { return x.name === mem.name; })) local.members.push(Object.assign({}, mem, { matchesPlayed: 0, matchesWon: 0, leaguePoints: 0 }));
    });
    (incoming.teams || []).forEach(function (team) {
      if (!(local.teams || []).some(function (x) { return x.id === team.id; })) (local.teams = local.teams || []).push(team);
    });
    var base = local.standingsBaseline || {};
    Object.keys(incoming.standingsBaseline || {}).forEach(function (n) { if (!base[n]) base[n] = incoming.standingsBaseline[n]; });
    local.standingsBaseline = base;
    if ((incoming.season || 1) > (local.season || 1) || ((incoming.season || 1) === (local.season || 1) && (incoming.week || 1) > (local.week || 1))) {
      local.season = incoming.season || 1;
      local.week = incoming.week || 1;
    }
    recomputeLeagueStandings(local);
    return added;
  }

  // A member belongs to at most one team per league - "assign a team to a
  // table" seeds that table's queue with the whole roster, so a name on
  // two teams at once would make that seed ambiguous. Returns the team
  // they're already on, or null.
  function leagueTeamForMember(league, name) {
    var match = (league.teams || []).filter(function (t) {
      return t.memberNames.indexOf(name) !== -1;
    });
    return match.length ? match[0] : null;
  }

  var api = {
    leagueMatchSums: leagueMatchSums,
    takeLeagueStandingsBaseline: takeLeagueStandingsBaseline,
    recomputeLeagueStandings: recomputeLeagueStandings,
    leagueSeasonRows: leagueSeasonRows,
    leagueTeamRows: leagueTeamRows,
    leagueTeamForMember: leagueTeamForMember,
    mergeLeagueInto: mergeLeagueInto
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.league = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
