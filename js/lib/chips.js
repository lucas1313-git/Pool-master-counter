// js/lib/chips.js
// The chip tournament (P34): chips by rating band, one waiting line, the loser of each game gives
// up a chip and is out at 0, the last player with chips wins.
// Pure: no page, no storage, no app state - js/app.js calls it through PMCLib.chips (loaded
// before it), and the unit tests (tests/unit/) load it in Node. A chip tournament's state is
// plain data on the tournament: chips { name: n }, startChips, line [names waiting, first in
// front], bustOrder [names, first out first], lastOpponent { name: name }.
(function (root) {
  "use strict";

  // Chips by rating band, lowest band first: the first row whose upTo
  // covers the rating (upTo null: everyone else). Weaker players get
  // more chips - more lives - so a strong player has to beat them more
  // often. Editable in the tournament wizard; this is where it starts.
  var DEFAULT_CHIP_CHART = [
    { upTo: 399, chips: 4 },
    { upTo: 549, chips: 3 },
    { upTo: null, chips: 2 }
  ];

  function chipsForRating(chart, rating) {
    var rows = chart && chart.length ? chart : DEFAULT_CHIP_CHART;
    var r = Number(rating) || 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].upTo === null || rows[i].upTo === undefined || r <= rows[i].upTo) return Math.max(1, rows[i].chips | 0);
    }
    return Math.max(1, rows[rows.length - 1].chips | 0);
  }

  // A chart as typed: rows sorted by upTo (the open row last), chips 1-20,
  // and always exactly one open row at the end.
  function cleanChipChart(rows) {
    var banded = [], open = null;
    (rows || []).forEach(function (r) {
      var chips = Math.min(20, Math.max(1, parseInt(r && r.chips, 10) || 0));
      if (!(chips >= 1)) return;
      var upTo = r.upTo === null || r.upTo === "" || r.upTo === undefined ? null : parseInt(r.upTo, 10);
      if (upTo === null || isNaN(upTo)) open = { upTo: null, chips: chips };
      else banded.push({ upTo: upTo, chips: chips });
    });
    banded.sort(function (a, b) { return a.upTo - b.upTo; });
    banded = banded.filter(function (r, i) { return i === 0 || r.upTo !== banded[i - 1].upTo; });
    return banded.concat([open || { upTo: null, chips: banded.length ? banded[banded.length - 1].chips : 2 }]);
  }

  // The state a chip tournament starts with: everyone's chips from their
  // rating, the line in the order given.
  function startChipState(names, ratingOf, chart) {
    var chips = {};
    names.forEach(function (n) { chips[n] = chipsForRating(chart, ratingOf(n)); });
    return { chips: chips, startChips: JSON.parse(JSON.stringify(chips)), line: names.slice(), bustOrder: [], lastOpponent: {} };
  }

  // Who plays next from the line: the first two waiting, except that the
  // one in front doesn't play the player they just played while anyone
  // else is waiting. -> [a, b] or null (fewer than two waiting).
  function nextChipPair(state) {
    var line = state.line || [];
    if (line.length < 2) return null;
    var first = line[0], last = (state.lastOpponent || {})[first];
    for (var i = 1; i < line.length; i++) {
      if (line[i] !== last && (state.lastOpponent || {})[line[i]] !== first) return [first, line[i]];
    }
    return [first, line[1]];
  }
  // ...and out of the line
  function takeChipPair(state, pair) {
    state.line = state.line.filter(function (n) { return n !== pair[0] && n !== pair[1]; });
  }

  // A game played: the loser gives up a chip (all of them: lose = their
  // chips, a withdrawal) and is out at 0; whoever still has chips goes to
  // the back of the line, the winner first. -> { out: loser or null,
  // champion: the last one with chips, or null }
  function recordChipGame(state, winner, loser, lose) {
    state.lastOpponent = state.lastOpponent || {};
    state.lastOpponent[winner] = loser;
    state.lastOpponent[loser] = winner;
    state.chips[loser] = Math.max(0, (state.chips[loser] || 0) - (lose === undefined ? 1 : lose));
    var out = null;
    state.line = state.line.filter(function (n) { return n !== winner && n !== loser; });
    state.line.push(winner);
    if (state.chips[loser] > 0) state.line.push(loser);
    else {
      out = loser;
      if (state.bustOrder.indexOf(loser) === -1) state.bustOrder.push(loser);
    }
    return { out: out, champion: chipChampion(state) };
  }

  // Out without a game (a withdrawal while waiting): every chip gone.
  function chipKnockOut(state, name) {
    state.chips[name] = 0;
    state.line = state.line.filter(function (n) { return n !== name; });
    if (state.bustOrder.indexOf(name) === -1) state.bustOrder.push(name);
    return { out: name, champion: chipChampion(state) };
  }
  // Late in: chips from the chart, to the back of the line.
  function addChipPlayer(state, name, chips) {
    state.chips[name] = chips;
    state.startChips[name] = chips;
    state.line.push(name);
  }

  function chipsAlive(state) {
    return Object.keys(state.chips).filter(function (n) { return state.chips[n] > 0; });
  }
  function chipChampion(state) {
    var left = chipsAlive(state);
    return left.length === 1 ? left[0] : null;
  }

  // Final chipPlacings, best first: the champion, then the last one out, ...
  // [{ place, names }] (one name a place - one player goes out a game).
  function chipPlacings(state, champion) {
    var out = [];
    if (champion) out.push({ place: 1, names: [champion] });
    state.bustOrder.slice().reverse().forEach(function (n) {
      out.push({ place: out.length + 1, names: [n] });
    });
    return out;
  }

  // Everyone, most chips first (then the line's order, then who went out
  // last): [{ name, chips, start, waiting: place in line (1-) or 0 }]
  function chipStandings(state) {
    var names = Object.keys(state.chips);
    var outRank = {};
    state.bustOrder.forEach(function (n, i) { outRank[n] = i; });
    return names.map(function (n) {
      return { name: n, chips: state.chips[n], start: (state.startChips || {})[n] || state.chips[n], waiting: state.line.indexOf(n) + 1 };
    }).sort(function (a, b) {
      if (b.chips !== a.chips) return b.chips - a.chips;
      if (!a.chips) return (outRank[b.name] || 0) - (outRank[a.name] || 0);
      return a.name.localeCompare(b.name);
    });
  }

  var api = {
    DEFAULT_CHIP_CHART: DEFAULT_CHIP_CHART,
    chipsForRating: chipsForRating,
    cleanChipChart: cleanChipChart,
    startChipState: startChipState,
    nextChipPair: nextChipPair,
    takeChipPair: takeChipPair,
    recordChipGame: recordChipGame,
    chipKnockOut: chipKnockOut,
    addChipPlayer: addChipPlayer,
    chipsAlive: chipsAlive,
    chipChampion: chipChampion,
    chipPlacings: chipPlacings,
    chipStandings: chipStandings
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.chips = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
