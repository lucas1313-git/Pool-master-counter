// js/lib/payouts.js
// Tournament money (P33), bookkeeping only - nothing is paid or charged: the prize pool from the
// entry fee, added money and the house cut; the payout table by field size; each final placing's
// share in whole currency units; side pots; a Calcutta auction's pot split by where each player
// finished.
// Pure: no page, no storage, no app state - js/app.js calls it through PMCLib.payouts (loaded
// before it), and the unit tests (tests/unit/) load it in Node.
(function (root) {
  "use strict";

  // The payout table by field size, best place first, in percent of the
  // prize pool: the first row whose upTo covers the field (the last row
  // past that). Editable in the app (☰ Tournament › 💰 Payouts) - these
  // are where it starts.
  var DEFAULT_PAYOUT_PRESETS = [
    { upTo: 8, pcts: [70, 30] },
    { upTo: 16, pcts: [50, 30, 20] },
    { upTo: 24, pcts: [40, 25, 15, 10, 5, 5] },
    { upTo: 32, pcts: [30, 20, 12, 10, 7, 7, 7, 7] },
    { upTo: 64, pcts: [25, 16, 11, 8, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5] }
  ];

  // a whole number of currency units, never negative ("12.6" -> 13, "" -> 0)
  function units(v) {
    var n = Math.round(Number(v));
    return isFinite(n) && n > 0 ? n : 0;
  }

  function presetForField(presets, fieldSize) {
    var list = (presets && presets.length ? presets : DEFAULT_PAYOUT_PRESETS).slice().sort(function (a, b) {
      return a.upTo - b.upTo;
    });
    for (var i = 0; i < list.length; i++) if (fieldSize <= list[i].upTo) return list[i];
    return list[list.length - 1];
  }

  // money: { entryFee, greenFee, addedMoney, houseCutPct } (whole units;
  // the cut a percent of the entry fees, rounded down - in the players'
  // favour). The green fees are the house's (table time) and never in
  // the pool. -> { entries, greenFees, houseCut, added, pool, perPlayer }
  function prizePool(money, fieldSize) {
    money = money || {};
    var n = Math.max(0, fieldSize | 0);
    var entries = units(money.entryFee) * n;
    var cutPct = Math.min(100, Math.max(0, Number(money.houseCutPct) || 0));
    var houseCut = Math.floor((entries * cutPct) / 100 + 1e-9);
    var added = units(money.addedMoney);
    return {
      entries: entries,
      greenFees: units(money.greenFee) * n,
      houseCut: houseCut,
      added: added,
      pool: entries - houseCut + added,
      perPlayer: units(money.entryFee) + units(money.greenFee)
    };
  }

  // Splits a whole-unit pot by final placings: placings [{ place, names }]
  // best first (a shared place - "3rd-4th" - is one group of two), pcts
  // the table's percents, best place first. A shared place splits the
  // places it covers (3rd-4th: the 3rd and 4th percents, halved). The
  // percents are scaled to add up to 100 (the whole pot is paid), each
  // share is rounded down to a whole unit and what that leaves over goes
  // to the winner - so the shares always add up to the pot exactly.
  // -> [{ place, names, each, pct }] (only the places that get something)
  function splitByPlacings(pot, pcts, placings) {
    pot = units(pot);
    var clean = (pcts || []).map(Number).filter(function (p) { return isFinite(p) && p > 0; });
    var total = clean.reduce(function (a, b) { return a + b; }, 0);
    if (!pot || !total || !placings || !placings.length) return [];
    var out = [];
    placings.forEach(function (g) {
      var first = g.place - 1, n = g.names.length;
      var pct = 0;
      for (var i = first; i < first + n; i++) pct += clean[i] || 0;
      if (!pct) return;
      var share = (pot * pct) / total;
      out.push({ place: g.place, names: g.names.slice(), pct: pct / n, each: g.names.map(function () { return Math.floor(share / n + 1e-9); }) });
    });
    var paid = out.reduce(function (sum, row) {
      return sum + row.each.reduce(function (a, b) { return a + b; }, 0);
    }, 0);
    // what the rounding left over goes to the winner (shared first place:
    // split between them, a unit at a time from the first named)
    var left = pot - paid;
    if (out.length) for (var k = 0; left > 0; k = (k + 1) % out[0].each.length, left--) out[0].each[k] += 1;
    return out;
  }

  // The whole tournament's money: t.money and the field size; placings
  // once it's over (before that, the payout table's amounts by place).
  // -> { pool: prizePool(...), pcts, places: [{ place, names, each, pct }],
  //      sidePots: [{ name, pot, winners, each }], calcutta: {...} | null }
  function tournamentPayouts(money, fieldSize, placings, presets) {
    money = money || {};
    var pool = prizePool(money, fieldSize);
    var pcts = presetForField(presets, fieldSize).pcts;
    var byPlace = placings && placings.length ? placings : pcts.map(function (p, i) { return { place: i + 1, names: [""] }; });
    return {
      pool: pool,
      pcts: pcts,
      places: splitByPlacings(pool.pool, pcts, byPlace),
      sidePots: (money.sidePots || []).map(sidePotPayout),
      calcutta: money.calcutta && money.calcutta.enabled ? calcuttaPayouts(money.calcutta, pcts, placings) : null
    };
  }

  // A side pot: { name, buyIn, entries, winners: [names] } - buy-in times
  // entries, split evenly between its winners (whole units, the first
  // winner gets what's left over).
  function sidePotPayout(sp) {
    var pot = units(sp.buyIn) * Math.max(0, sp.entries | 0);
    var winners = (sp.winners || []).filter(Boolean);
    var each = winners.map(function () { return winners.length ? Math.floor(pot / winners.length) : 0; });
    if (winners.length) each[0] += pot - each.reduce(function (a, b) { return a + b; }, 0);
    return { name: sp.name || "", pot: pot, winners: winners, each: each };
  }

  // A Calcutta: { houseCutPct, bids: { player: { buyer, amount } } } - the
  // pot is every bid less the house's cut (rounded down), split by where
  // each player finished, with the same table as the prize money; a
  // player's share goes to whoever bought them.
  // -> { bids, houseCut, pot, places: [{ place, names, buyers, each }], byBuyer: { buyer: amount } }
  function calcuttaPayouts(calcutta, pcts, placings) {
    var bids = calcutta.bids || {};
    var total = Object.keys(bids).reduce(function (sum, name) { return sum + units(bids[name] && bids[name].amount); }, 0);
    var cutPct = Math.min(100, Math.max(0, Number(calcutta.houseCutPct) || 0));
    var houseCut = Math.floor((total * cutPct) / 100 + 1e-9);
    var pot = total - houseCut;
    var places = placings && placings.length ? splitByPlacings(pot, pcts, placings) : [];
    var byBuyer = {};
    places.forEach(function (row) {
      row.buyers = row.names.map(function (name, i) {
        var buyer = (bids[name] && bids[name].buyer) || "";
        if (buyer) byBuyer[buyer] = (byBuyer[buyer] || 0) + row.each[i];
        return buyer;
      });
    });
    return { bids: total, houseCut: houseCut, pot: pot, places: places, byBuyer: byBuyer };
  }

  // "50, 30, 20" -> [50, 30, 20] (anything that isn't a positive number dropped)
  function parsePcts(text) {
    return String(text || "")
      .split(/[,;\/\s]+/)
      .map(function (x) { return Number(x.replace("%", "")); })
      .filter(function (n) { return isFinite(n) && n > 0; });
  }

  var api = {
    DEFAULT_PAYOUT_PRESETS: DEFAULT_PAYOUT_PRESETS,
    units: units,
    presetForField: presetForField,
    prizePool: prizePool,
    splitByPlacings: splitByPlacings,
    tournamentPayouts: tournamentPayouts,
    sidePotPayout: sidePotPayout,
    calcuttaPayouts: calcuttaPayouts,
    parsePcts: parsePcts
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.payouts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
