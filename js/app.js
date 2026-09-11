(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v2";
  var OLD_STORAGE_KEY = "poolMasterCounter.state.v1";
  var VOICE_PITCHES = [1.0, 1.26, 1.5, 0.79, 1.89, 0.63];

  var GAME_TYPES = {};
  var GAME_TYPE_LIST = [];
  var DEFAULT_GAME_TYPES = [
    { id: "8ball", label: "8-Ball", defaultTarget: 1, unit: "rack" },
    { id: "8ballrotation", label: "8 Ball Rotation", defaultTarget: 1, unit: "rack" },
    { id: "8ballpunishment", label: "8 Ball Punishment", defaultTarget: 1, unit: "rack" },
    { id: "9ball", label: "9-Ball", defaultTarget: 1, unit: "rack" },
    { id: "straight", label: "Straight Pool", defaultTarget: 100, unit: "points" },
    { id: "onepocket", label: "One Pocket", defaultTarget: 8, unit: "balls" },
    { id: "custom", label: "Custom", defaultTarget: 1, unit: "points" }
  ];

  // "Rack" games (target 1, one click = one whole win) have no per-ball
  // tracking within a rack at all, so a skunk there (loser potted zero
  // of their own group) can only come from the manually-entered "Balls
  // left on the table" count - 7 left means all of the loser's 7
  // object balls are still up, i.e. a skunk. 9-Ball isn't included -
  // no skunk concept there (confirmed by the user).
  var SKUNK_RACK_GAME_TYPES = ["8ball", "8ballrotation", "8ballpunishment"];

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var toastTimer = null;

  // "No Statistic will be recorded" mode — a purely in-memory session with
  // nothing written to localStorage: no state, no PLAYER_STATS, no
  // PLAYER_RATINGS. Never persisted itself (always starts off on reload),
  // toggled from the scoreboard checkbox or preset by the wizard's "Only a
  // temporary counter" checkbox. The live scoreboard/session win-tracking/
  // Recent Games still work normally in memory for the current tab — only
  // the underlying save calls become no-ops.
  var noStatsMode = false;

  // Quick Counter mode — the scoreboard becomes a bare point tally: no
  // game type, no target, no rotation, no win/loss detection. Entered via
  // the wizard's "Start Game Now" button (Step 1, only shown once No
  // Statistic is checked). Player names are edited inline and players can
  // be added/removed right from the scoreboard cards. Always implies
  // noStatsMode, since there's nothing meaningful to save in this mode
  // anyway (no completed games, ever).
  var quickCounterMode = false;

  // Paywall/IAP scaffolding — Apple requires purchasable digital content
  // to go through StoreKit, which only exists inside a real native app
  // container (Capacitor injects `Capacitor` into the page only when
  // running natively, e.g. wrapped for the App Store — it's simply
  // undefined on the plain web/PWA version). So the gate below only ever
  // activates on native; the free web app is completely unaffected.
  // `proUnlocked`/`adUnlockedThisSession` start false and are only ever
  // set true after a real (StoreKit Testing, for now) purchase/restore or
  // a completed fake-ad view — see requireProOrShowPaywall.
  // No bundler here (plain <script> tags), so the @capacitor/core npm
  // helpers (registerPlugin, etc.) were never loaded onto the page - only
  // the native-injected window.Capacitor bridge object itself is
  // available, which exposes registered plugins directly as
  // Capacitor.Plugins.<jsName> (each method already returns a Promise).
  var IS_NATIVE = typeof Capacitor !== "undefined" && !!(Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  var Purchases = IS_NATIVE && Capacitor.Plugins ? Capacitor.Plugins.Purchases : null;
  var proUnlocked = false;
  var adUnlockedThisSession = false;

  // Self-healing pass for names saved before capitalization was enforced
  // everywhere (or from a device/import that predates it): fixes casing in
  // place on state.players and every gameHistory entry's winner/opponent/
  // MVP names, so a bad casing saved once doesn't keep resurfacing forever
  // (buildNameCasingMap would otherwise treat it as the "known" casing and
  // keep reusing it — see resolvePlayerName). Runs before any rendering.
  (function migrateNameCapitalizationOnBoot() {
    var changed = false;
    function fixName(n) {
      var fixed = capitalizeName(n);
      if (fixed !== n) changed = true;
      return fixed;
    }
    function fixList(list) {
      return (list || []).map(fixName);
    }
    (state.players || []).forEach(function (p) {
      if (p && p.name) p.name = fixName(p.name);
    });
    (state.gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string") return;
      if (entry.winnerNames) entry.winnerNames = fixList(entry.winnerNames);
      if (entry.opponentNames) entry.opponentNames = fixList(entry.opponentNames);
      if (entry.mvpName) entry.mvpName = fixName(entry.mvpName);
    });
    if (changed) saveState();
  })();

  // yyyy-mm-dd-<unix seconds>-<short random> - readable creation date
  // baked right into the id, plus enough uniqueness (the random suffix)
  // that adding several players in the same second - loading a saved
  // roster list, for instance - can never produce two identical ids.
  // Only ever used to key session-local bookkeeping (state.playerWins,
  // state.teamMvpWins, gameHistory winnerIds/mvpId) - every durable,
  // cross-device store (ratings, contacts, stats, added-date) is keyed
  // by name instead, so this format change never touches those.
  function uid() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, "0");
    var d = String(now.getDate()).padStart(2, "0");
    var unixSec = Math.floor(now.getTime() / 1000);
    return y + "-" + m + "-" + d + "-" + unixSec + "-" + Math.random().toString(36).slice(2, 6);
  }

  // One-time migration for players created before uid() moved to the
  // date-based format - they'd otherwise keep an old opaque id forever
  // (loadState only ever runs this once per boot, on whatever's already
  // in storage). Every place an id is used as a KEY has to be remapped
  // together with player.id itself, or a player's win tally/game-history
  // entries would silently detach from them the moment their id changes.
  // The date pattern is inlined (not a module-level var) because
  // loadState() - and this, transitively - runs at var state = loadState()
  // near the very top of the file, before a var declared further down
  // would have its assignment executed yet.
  function migratePlayerIdsToDateFormat(parsedState) {
    var idPattern = /^\d{4}-\d{2}-\d{2}-\d+-/;
    var remap = {};
    (parsedState.players || []).forEach(function (p) {
      if (!p || !p.id || idPattern.test(p.id)) return;
      var newId = uid();
      remap[p.id] = newId;
      p.id = newId;
    });
    if (!Object.keys(remap).length) return;
    ["playerWins", "teamMvpWins"].forEach(function (storeKey) {
      var remapped = {};
      Object.keys(parsedState[storeKey] || {}).forEach(function (oldId) {
        remapped[remap[oldId] || oldId] = parsedState[storeKey][oldId];
      });
      parsedState[storeKey] = remapped;
    });
    (parsedState.gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      if (Array.isArray(entry.winnerIds)) {
        entry.winnerIds = entry.winnerIds.map(function (id) {
          return remap[id] || id;
        });
      }
      if (entry.mvpId && remap[entry.mvpId]) entry.mvpId = remap[entry.mvpId];
    });
  }

  // Player names are treated as case-insensitive everywhere: "Bob" and
  // "bob" are the same person. This is the single normalization key used
  // to compare/group names; the actual display casing is decided by
  // resolvePlayerName / consolidateCaseVariantPlayerStats below.
  function normalizeNameKey(name) {
    return (name || "").trim().toLowerCase();
  }

  // Generic chevron collapse/expand for any element carrying the
  // .collapsible-panel class — a panel, or (for Focus Mode) a smaller
  // in-scoreboard block. Reused by every collapsible section on the page.
  // The one-line summary (id="<panelElId>-summary") sits outside the
  // toggle <button> as a plain sibling <p> - a <p> isn't valid inside a
  // <button>, so it can't just be moved in - but while collapsed it's
  // the only other visible part of the panel, so it gets the same click
  // handler too: together the button and the summary line are the
  // entire folded area, and both now toggle it, not just the heading row.
  function wireCollapsiblePanel(panelElId, buttonElId) {
    var panel = document.getElementById(panelElId);
    var btn = document.getElementById(buttonElId);
    var summary = document.getElementById(panelElId + "-summary");
    function toggle() {
      var willExpand = panel.classList.contains("collapsed");
      panel.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", willExpand ? "true" : "false");
    }
    btn.addEventListener("click", toggle);
    if (summary && summary.tagName === "P") summary.addEventListener("click", toggle);
  }

  // Updates the one-line "what's inside" sentence shown only while a
  // collapsible panel is collapsed (id="<panelElId>-summary").
  function setPanelSummary(panelElId, text) {
    var el = document.getElementById(panelElId + "-summary");
    if (el) el.textContent = text;
  }

  function defaultState() {
    return {
      players: [],
      playerWins: {},
      teamWins: {},
      teamMvpWins: {},
      raceToWinsTarget: 5,
      fairRaceEnabled: false,
      fairRaceTargets: null,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", startedAt: new Date().toISOString(), shotCounterEnabled: false, shotCounterBeepSec: 30, shotCounterHidden: false, queueEnabled: false },
      gameHistory: [],
      rotation: { enabled: false, order: [], every: 1 },
      gamesPlayedCount: 0,
      queue: []
    };
  }

  function migrateFromOldMatches(oldState) {
    var next = defaultState();
    next.players = (oldState.players || []).map(function (p, i) {
      return {
        id: p.id,
        name: p.name,
        voice: typeof p.voice === "number" ? p.voice : i % VOICE_PITCHES.length,
        playing: false,
        teamId: null,
        balls: 0
      };
    });

    (oldState.matches || []).forEach(function (m) {
      var participants = m.participants || [];
      if (m.teamsEnabled) {
        ["A", "B"].forEach(function (teamId) {
          var members = participants.filter(function (pt) {
            return pt.teamId === teamId;
          });
          if (!members.length) return;
          var wins = m.mode === "games" ? m.games && m.games[teamId] : m.status === "completed" && m.winnerId === teamId ? 1 : 0;
          wins = wins || 0;
          if (!wins) return;
          var key = members
            .map(function (pt) {
              return pt.playerId;
            })
            .sort()
            .join("|");
          next.teamWins[key] = (next.teamWins[key] || 0) + wins;
          members.forEach(function (pt) {
            next.playerWins[pt.playerId] = (next.playerWins[pt.playerId] || 0) + wins;
          });
        });
      } else {
        participants.forEach(function (pt) {
          var wins = m.mode === "games" ? (m.games && m.games[pt.playerId]) || 0 : m.status === "completed" && m.winnerId === pt.playerId ? 1 : 0;
          if (!wins) return;
          next.playerWins[pt.playerId] = (next.playerWins[pt.playerId] || 0) + wins;
        });
      }
    });

    return next;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.players)) {
          parsed.players.forEach(function (p, i) {
            if (typeof p.voice !== "number") p.voice = i % VOICE_PITCHES.length;
            if (typeof p.playing !== "boolean") p.playing = false;
            if (typeof p.teamId === "undefined") p.teamId = null;
            if (typeof p.balls !== "number") p.balls = 0;
          });
          if (!parsed.playerWins) parsed.playerWins = {};
          if (!parsed.teamWins) parsed.teamWins = {};
          if (!parsed.teamMvpWins) parsed.teamMvpWins = {};
          if (typeof parsed.raceToWinsTarget !== "number") parsed.raceToWinsTarget = 5;
          if (typeof parsed.fairRaceEnabled !== "boolean") parsed.fairRaceEnabled = false;
          if (typeof parsed.fairRaceTargets !== "object") parsed.fairRaceTargets = null;
          if (!parsed.currentGame) parsed.currentGame = { gameType: "8ball", target: 1, mode: "individual" };
          if (!parsed.currentGame.startedAt) parsed.currentGame.startedAt = new Date().toISOString();
          if (typeof parsed.currentGame.unit !== "string" || !parsed.currentGame.unit) parsed.currentGame.unit = null;
          if (typeof parsed.currentGame.shotCounterEnabled !== "boolean") parsed.currentGame.shotCounterEnabled = false;
          if (typeof parsed.currentGame.shotCounterBeepSec !== "number") parsed.currentGame.shotCounterBeepSec = 30;
          if (typeof parsed.currentGame.shotCounterHidden !== "boolean") parsed.currentGame.shotCounterHidden = false;
          if (typeof parsed.currentGame.queueEnabled !== "boolean") parsed.currentGame.queueEnabled = false;
          if (!Array.isArray(parsed.queue)) parsed.queue = [];
          var EIGHTBALL_FAMILY = ["8ball", "8ballrotation", "8ballpunishment"];
          if (parsed.currentGame.target === 8 && EIGHTBALL_FAMILY.indexOf(parsed.currentGame.gameType) !== -1) {
            parsed.currentGame.target = 1;
          } else if (parsed.currentGame.target === 9 && parsed.currentGame.gameType === "9ball") {
            parsed.currentGame.target = 1;
          }
          if (!Array.isArray(parsed.gameHistory)) parsed.gameHistory = [];
          if (!parsed.rotation) parsed.rotation = { enabled: false, order: [], every: 1 };
          if (!Array.isArray(parsed.rotation.order)) parsed.rotation.order = [];
          if (typeof parsed.rotation.every !== "number") parsed.rotation.every = 1;
          if (typeof parsed.rotation.enabled !== "boolean") parsed.rotation.enabled = false;
          if (typeof parsed.gamesPlayedCount !== "number") parsed.gamesPlayedCount = 0;
          migratePlayerIdsToDateFormat(parsed);
          return parsed;
        }
      }
      var oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldRaw) {
        var oldParsed = JSON.parse(oldRaw);
        if (oldParsed && Array.isArray(oldParsed.players)) {
          return migrateFromOldMatches(oldParsed);
        }
      }
    } catch (e) {
      console.warn("Could not read saved state, starting fresh.", e);
    }
    return defaultState();
  }

  // Auto-archives the Colorful Report (see computeReportImageData, which
  // already archives its result as a side effect) once the app has sat
  // idle for an hour after the last real action. A debounced one-shot
  // timer rather than a periodic poll - rescheduled on every saveState()
  // call - fires as close as possible to exactly one hour after the LAST
  // save, which needs no extra "last activity" bookkeeping and minimizes
  // (though can't fully eliminate, since computeDayReportData always
  // reads "today" regardless of what date string it's given) the case
  // where that hour crosses midnight.
  var idleReportTimer = null;
  function scheduleIdleReportAutoSave() {
    if (idleReportTimer) clearTimeout(idleReportTimer);
    idleReportTimer = setTimeout(function () {
      if (state.gameHistory.length > 0) computeReportImageData(todayDateStr());
    }, 60 * 60 * 1000);
  }

  function saveState() {
    if (noStatsMode) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save state.", e);
    }
    scheduleIdleReportAutoSave();
  }

  function getPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function getPlayerIdByName(name) {
    var key = normalizeNameKey(name);
    for (var i = 0; i < state.players.length; i++) {
      if (normalizeNameKey(state.players[i].name) === key) return state.players[i].id;
    }
    return null;
  }

  function activePlayers() {
    return state.players.filter(function (p) {
      return p.playing;
    });
  }

  // "Winner stays" queue mode (state.currentGame.queueEnabled, individual
  // mode only) - reconciles state.queue (an ordered list of player ids)
  // against reality instead of requiring every place `playing` can turn
  // false (togglePlaying, addPlayer's default, roster-list loading, the
  // wizard, Recover Data restore) to remember to keep it in sync. Anyone
  // currently standby but not yet tracked lands at the back automatically,
  // so nobody can silently fall out of the line. Callers that change the
  // order persist the result back with saveQueue(effectiveQueue()).
  function effectiveQueue() {
    var known = {};
    var ordered = (state.queue || [])
      .map(function (id) {
        return getPlayer(id);
      })
      .filter(function (p) {
        return p && !p.playing;
      });
    ordered.forEach(function (p) {
      known[p.id] = true;
    });
    state.players.forEach(function (p) {
      if (!p.playing && !known[p.id]) ordered.push(p);
    });
    return ordered;
  }

  function saveQueue(orderedPlayers) {
    state.queue = orderedPlayers.map(function (p) {
      return p.id;
    });
  }

  // Same reconciliation idea as effectiveQueue() above - a self-healing
  // cache instead of hooking every place the active roster can change.
  // Fair race targets (state.fairRaceEnabled) are frozen for as long as
  // the same set of players/teams stays active: recomputed only when
  // the roster key actually changes, not on every rating tick from a
  // win within the race, so nobody's number moves mid-race.
  function ensureFairRaceTargets() {
    var isTeamMode = !quickCounterMode && state.currentGame.mode === "teams";
    var sides = isTeamMode
      ? ["A", "B"]
          .filter(function (t) {
            return teamMembersLive(t).length > 0;
          })
          .map(function (t) {
            return {
              key: t,
              rating: averageRating(
                teamMembersLive(t).map(function (p) {
                  return p.name;
                })
              )
            };
          })
      : activePlayers().map(function (p) {
          return { key: p.id, rating: getPlayerRating(p.name) };
        });
    var rosterKey = sides
      .map(function (s) {
        return s.key;
      })
      .sort()
      .join(",");
    if (!state.fairRaceTargets || state.fairRaceTargets.rosterKey !== rosterKey) {
      state.fairRaceTargets = { rosterKey: rosterKey, targets: computeFairRaceTargets(sides, state.raceToWinsTarget) };
    }
    return state.fairRaceTargets.targets;
  }

  // The one function every win-target comparison/check should call
  // instead of reading state.raceToWinsTarget directly - returns the
  // plain global target when fair race is off (today's behavior,
  // unchanged), or this specific player's/team's own fair target when
  // it's on.
  function effectiveRaceTarget(key) {
    if (!state.fairRaceEnabled) return state.raceToWinsTarget;
    var targets = ensureFairRaceTargets();
    return targets[key] || state.raceToWinsTarget;
  }

  // Mirrors buildRotationRow/renderRotationListInto/moveRotationItem
  // (the Games Rotation list) - same ordered-list-with-up/down-arrows
  // interaction, just for standby players instead of game types. No
  // remove button: leaving the queue means becoming an active player or
  // being removed from the roster entirely, both already handled by the
  // existing roster row controls.
  function buildQueueRow(player, i, total) {
    var li = document.createElement("li");
    li.className = "rotation-row";

    var pos = document.createElement("span");
    pos.className = "rotation-position";
    pos.textContent = i + 1 + ".";

    var name = document.createElement("span");
    name.className = "rotation-name";
    name.textContent = player.name;

    var controls = document.createElement("div");
    controls.className = "rotation-controls";

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.setAttribute("aria-label", "Move " + player.name + " up in the queue");
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", function () {
      moveQueueItem(i, -1);
    });

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.setAttribute("aria-label", "Move " + player.name + " down in the queue");
    downBtn.disabled = i === total - 1;
    downBtn.addEventListener("click", function () {
      moveQueueItem(i, 1);
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);

    li.appendChild(pos);
    li.appendChild(name);
    li.appendChild(controls);
    return li;
  }

  // Shows/hides the checkbox (Individual mode only) and the queue list
  // itself (checkbox on + Individual + not Quick Counter), then rebuilds
  // the list from effectiveQueue() when visible. Called from renderRoster
  // so it always reflects the latest playing/standby state.
  function renderQueueList() {
    var individualMode = !quickCounterMode && state.currentGame.mode === "individual";
    queueModeRow.classList.toggle("hidden", !individualMode);
    queueModeCheckbox.checked = state.currentGame.queueEnabled;
    var queueActive = individualMode && state.currentGame.queueEnabled;
    queueSection.classList.toggle("hidden", !queueActive);
    if (!queueActive) return;
    var queue = effectiveQueue();
    queueList.innerHTML = "";
    if (queue.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("players.queueEmpty");
      queueList.appendChild(hint);
      return;
    }
    queue.forEach(function (p, i) {
      queueList.appendChild(buildQueueRow(p, i, queue.length));
    });
  }

  function moveQueueItem(index, delta) {
    var queue = effectiveQueue();
    var newIndex = index + delta;
    if (newIndex < 0 || newIndex >= queue.length) return;
    var tmp = queue[index];
    queue[index] = queue[newIndex];
    queue[newIndex] = tmp;
    saveQueue(queue);
    saveState();
    renderQueueList();
  }

  // The player currently targeted by the 1-9 keypad shortcut - see
  // handleKeypadShortcut. Not persisted; always starts cleared on reload.
  var keypadSelectedPlayerId = null;

  // Shot counter (see handleKeypadShortcut's "/"/*/Clear branches and
  // tickShotCounter) - live-only, like keypadSelectedPlayerId above; only
  // the enabled flag and beep interval on state.currentGame are saved.
  // accumulatedMs is the frozen total from prior running segments;
  // runningSince (a Date.now() timestamp, or null while paused) covers
  // the segment in progress. lastBeepMs is the accumulated-elapsed value
  // at which the beep last fired, so it fires again beepSec later.
  // lastTickCountdown tracks which of the final 5 countdown seconds (5,
  // 4, 3, 2, 1) before the next beep already got its warning tick, so a
  // 1s-interval tick doesn't replay the same second's warning twice.
  var shotCounterAccumulatedMs = 0;
  var shotCounterRunningSince = null;
  var shotCounterHidden = !!state.currentGame.shotCounterHidden;
  var shotCounterLastBeepMs = 0;
  var shotCounterLastTickCountdown = null;

  // Player ids in keypad-number order (index 0 = number 1, etc.) - filled
  // in by refreshKeypadNumbering() after every scoreboard render, since
  // numbering follows the ON-SCREEN grid position rather than roster
  // order (see that function), and that depends on how many columns the
  // responsive grid actually rendered at the current viewport width.
  var keypadOrderedPlayerIds = [];

  // Appended to a player's card/panel by every builder that has one
  // (buildIndividualPanel, buildMemberCard, buildQuickCounterPanel): a
  // marker plus an (initially empty) number badge - refreshKeypadNumbering
  // fills in the actual number and highlight state once every card for
  // this render is in the DOM and laid out.
  function markAsKeypadTarget(el, player) {
    el.dataset.keypadPlayerId = player.id;
    var badge = document.createElement("span");
    badge.className = "keypad-number-badge";
    el.appendChild(badge);
  }

  // Recomputes which number (1-9) each currently-playing player's card
  // shows, and refreshes every card's highlight state. Individual mode's
  // grid can wrap into any number of columns depending on viewport width,
  // so numbering follows actual rendered position, boustrophedon-style -
  // row 1 left to right, row 2 right to left, row 3 left to right, and
  // so on - so the reading direction always continues smoothly into the
  // next row instead of jumping back across the screen. Team mode's
  // two-column-of-vertically-stacked-members layout doesn't break into
  // "rows" the same way, so it just keeps DOM order there (team A top to
  // bottom, then team B top to bottom).
  function refreshKeypadNumbering() {
    var cards = Array.prototype.slice.call(scoreboard.querySelectorAll("[data-keypad-player-id]"));
    var ordered;
    if (state.currentGame.mode === "teams" || cards.length === 0) {
      ordered = cards;
    } else {
      var withRects = cards.map(function (el) {
        var r = el.getBoundingClientRect();
        return { el: el, top: r.top, left: r.left };
      });
      var rows = [];
      withRects.forEach(function (item) {
        var row = rows.filter(function (r) {
          return Math.abs(r.top - item.top) < 10;
        })[0];
        if (!row) {
          row = { top: item.top, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      });
      rows.sort(function (a, b) {
        return a.top - b.top;
      });
      ordered = [];
      rows.forEach(function (row, i) {
        row.items.sort(function (a, b) {
          return i % 2 === 0 ? a.left - b.left : b.left - a.left;
        });
        row.items.forEach(function (item) {
          ordered.push(item.el);
        });
      });
    }

    keypadOrderedPlayerIds = [];
    ordered.forEach(function (el, i) {
      var num = i < 9 ? i + 1 : null;
      var badge = el.querySelector(".keypad-number-badge");
      if (num) keypadOrderedPlayerIds.push(el.dataset.keypadPlayerId);
      if (badge) badge.textContent = num || "";
      el.classList.toggle("is-keypad-selected", el.dataset.keypadPlayerId === keypadSelectedPlayerId);
    });
  }

  function teamMembersLive(teamId) {
    return activePlayers().filter(function (p) {
      return p.teamId === teamId;
    });
  }

  function teamComboKey(teamId) {
    return teamMembersLive(teamId)
      .map(function (p) {
        return p.id;
      })
      .sort()
      .join("|");
  }

  function teamLabelLive(teamId) {
    var names = teamMembersLive(teamId)
      .map(function (p) {
        return p.name;
      })
      .join(" & ");
    return T(teamId === "A" ? "gameSetup.teamA" : "gameSetup.teamB") + (names ? " (" + names + ")" : "");
  }

  function sumTeamBalls(teamId) {
    return teamMembersLive(teamId).reduce(function (sum, p) {
      return sum + (p.balls || 0);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // Sound (synthesized via Web Audio API — no external files needed)
  // ---------------------------------------------------------------------

  var audioCtx = null;
  var echoSend = null;

  // A short slapback-style delay with damped feedback, shared by every
  // sound in the app — gives each tone a natural little tail instead of
  // cutting off flat. echoSend is the node every tone's gain also patches
  // into; the wet path loops back through a lowpass so repeats get
  // progressively warmer/duller rather than just quieter copies.
  function setupEchoBus(ctx) {
    echoSend = ctx.createGain();
    echoSend.gain.value = 1;
    var delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.15;
    var feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    var damping = ctx.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 2200;
    var wet = ctx.createGain();
    wet.gain.value = 0.32;

    echoSend.connect(delay);
    delay.connect(damping);
    damping.connect(feedback);
    feedback.connect(delay);
    damping.connect(wet);
    wet.connect(ctx.destination);
  }

  function getAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      setupEchoBus(audioCtx);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // iOS Safari can silently drop the very first sound of a page load if
  // the AudioContext hasn't finished unlocking by the time a tone actually
  // needs to play - most noticeable in games like 8-Ball, where the very
  // first "+" tap already IS the win fanfare (target is 1 rack), so
  // there's no earlier, lower-stakes tap that would have already unlocked
  // it. Warm the context up (and play a silent buffer, which is what
  // actually flips iOS's audio-unlock flag) on the very first tap
  // anywhere on the page, well before any score button gets pressed.
  function unlockAudioOnFirstInteraction() {
    var unlock = function () {
      document.removeEventListener("pointerdown", unlock);
      var ctx = getAudioCtx();
      var buffer = ctx.createBuffer(1, 1, 22050);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    };
    document.addEventListener("pointerdown", unlock);
  }

  // Every tone is two voices: the requested pitch/waveform, plus a quiet
  // octave-up triangle partner that decays faster — that second voice is
  // what turns a flat single-frequency beep into something with a bit of
  // body/shimmer, and it's always a soft waveform even when the main tone
  // uses a harsher one (sawtooth/square), which rounds off the edge
  // without losing that tone's identity. Both voices feed the shared echo
  // bus alongside the dry signal, unless noEcho opts a specific sound out
  // of that (repeated pips - see playPlayerSwitchSound - blur together
  // once the echo bus's own tail is still ringing under the next one).
  function tone(freq, startTime, duration, type, peakGain, noEcho) {
    var ctx = getAudioCtx();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (echoSend && !noEcho) gain.connect(echoSend);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);

    var overtoneDuration = duration * 0.7;
    var osc2 = ctx.createOscillator();
    var gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.value = freq * 2;
    osc2.detune.value = 6;
    gain2.gain.setValueAtTime(0, startTime);
    gain2.gain.linearRampToValueAtTime(peakGain * 0.18, startTime + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0008, startTime + overtoneDuration);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    if (echoSend && !noEcho) gain2.connect(echoSend);
    osc2.start(startTime);
    osc2.stop(startTime + overtoneDuration + 0.02);
  }

  function voicePitch(voice) {
    if (typeof voice !== "number") return 1;
    return VOICE_PITCHES[voice % VOICE_PITCHES.length];
  }

  // A plain pace-reminder beep for the shot counter - two short identical
  // pips, deliberately simpler than the win/on-hill fanfares since this
  // one repeats on a timer during play rather than marking a one-off event.
  function playShotCounterBeep() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(880, now, 0.12, "sine", 0.4);
    tone(880, now + 0.18, 0.12, "sine", 0.4);
  }

  // A quiet single tick - the countdown warning in the final 5 seconds
  // before playShotCounterBeep fires, deliberately much smaller/shorter
  // than the beep it's leading up to so the two stay easy to tell apart.
  function playShotCounterTick() {
    var ctx = getAudioCtx();
    tone(1200, ctx.currentTime, 0.05, "sine", 0.12);
  }

  // A low "you're now scoring for this player" cue for the keypad
  // shortcut's player-switch (pressing 1-9 during a points/ball game) -
  // low sine pips rather than the brighter triangle used for an actual
  // point, so it still reads as a mellow "got it" rather than competing
  // with the real scoring sounds. count is the keypad number just
  // pressed (player 1's shortcut pips once, player 2's twice, and so
  // on) so the number itself is audible, not just which card lit up -
  // useful without having to look at the screen at all. Dry (no echo
  // bus, see tone's noEcho) - the shared slapback tail was still
  // ringing under the next pip, blurring the count together.
  function playPlayerSwitchSound(voice, count) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var pips = Math.max(1, count || 1);
    for (var i = 0; i < pips; i++) {
      tone(165 * mult, now + i * 0.45, 0.12, "sine", 0.5, true);
    }
  }

  function playPositiveSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(660 * mult, now, 0.09, "triangle", 0.22);
    tone(990 * mult, now + 0.07, 0.14, "triangle", 0.2);
  }

  // A single droopy "sad trombone" note: pitch bends downward over its
  // whole duration (osc.frequency.exponentialRampToValueAtTime) instead of
  // holding steady, plus a quiet sub-octave sine underneath for a low,
  // mournful groan. Shares the echo bus with everything else.
  function sadTone(freq, startTime, duration, bendTo) {
    var ctx = getAudioCtx();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * bendTo, startTime + duration);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.2, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (echoSend) gain.connect(echoSend);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    var subOsc = ctx.createOscillator();
    var subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq / 2, startTime);
    subOsc.frequency.exponentialRampToValueAtTime((freq * bendTo) / 2, startTime + duration);
    subGain.gain.setValueAtTime(0, startTime);
    subGain.gain.linearRampToValueAtTime(0.12, startTime + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    if (echoSend) subGain.connect(echoSend);
    subOsc.start(startTime);
    subOsc.stop(startTime + duration + 0.05);
  }

  // "Sad trombone": a single note that droops all the way down over its
  // own length instead of a multi-note descending motif — still very
  // sad on purpose, just one long downward glide rather than several
  // short ones.
  function playNegativeSound(voice) {
    var mult = voicePitch(voice);
    var now = getAudioCtx().currentTime;
    sadTone(392.0 * mult, now, 1.5, 0.55);
  }

  // Two alternate victory fanfares, picked at random on each win so a run
  // of single-rack games doesn't hear the same thing every time — Queen's
  // "We Are the Champions" (from published easy-piano letter notes for the
  // "we are the champions, my friend" hook) and "Another One Bites the
  // Dust" (from published bass tab for the main riff), both dropped into
  // a low register per request, and both drenched in the shared slapback
  // echo bus AND their own dedicated reverb send (like
  // playTournamentChampionSound's, just shorter) for a big, low, anthemic
  // wash. Plays on every game win. voice picks the per-player pitch
  // multiplier (VOICE_PITCHES) so different winners land at different
  // pitches, same as before.
  function playWinSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 2.4, 2.2);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.6;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    function anthemTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (echoSend) gain.connect(echoSend);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.08);

      var sub = ctx.createOscillator();
      var subGain = ctx.createGain();
      sub.type = "triangle";
      sub.frequency.value = freq / 2;
      subGain.gain.setValueAtTime(0, t);
      subGain.gain.linearRampToValueAtTime(peakGain * 0.4, t + 0.02);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      if (echoSend) subGain.connect(echoSend);
      subGain.connect(reverbSend);
      sub.start(t);
      sub.stop(t + duration + 0.08);
    }

    // The "We are the champions... of the world" refrain specifically
    // (not the shorter "my friend" line) - transcribed from published
    // easy-piano letter notes: "We are the champions!" (G F# G F#-E) then
    // dropping a register for "Of the world...!" (D B D). A 9th note (a
    // low G tonic) added at the end for a full cadence, since the source
    // phrase itself only runs 8. Raised an octave from an earlier pass
    // that was too low to recognize - still sits a step below the
    // original vocal register, but this is the floor for staying
    // recognizable.
    function playChampionsSong() {
      var freqs = { G4: 392.0, Fs4: 369.99, E4: 329.63, D3: 146.83, B3: 246.94, G3: 196.0 };
      var run = [
        { n: "G4", t: 0.0, d: 0.2 },
        { n: "Fs4", t: 0.18, d: 0.2 },
        { n: "G4", t: 0.36, d: 0.2 },
        { n: "Fs4", t: 0.54, d: 0.16 },
        { n: "E4", t: 0.68, d: 0.24 },
        { n: "D3", t: 0.94, d: 0.26 },
        { n: "B3", t: 1.22, d: 0.24 },
        { n: "D3", t: 1.48, d: 0.26 },
        { n: "G3", t: 1.76, d: 0.9 }
      ];
      run.forEach(function (note) {
        anthemTone(freqs[note.n] * mult, now + note.t, note.d, 0.22);
      });
    }

    // The famous bass riff, transcribed from published bass tab (E minor,
    // all on the low E string: frets 0-0-0-0-0-3-0-5, i.e. E E E E E G E A)
    // - a 9th note (E, the loop point) added at the end since the source
    // riff is 8 notes and repeats from there. Raised an octave from an
    // earlier pass that was too low to recognize - still sits below the
    // Champions melody's register (it's the bass line, after all).
    function playBitesTheDustSong() {
      var freqs = { E3: 164.81, G3: 196.0, A3: 220.0 };
      var run = [
        { n: "E3", t: 0.0, d: 0.13 },
        { n: "E3", t: 0.16, d: 0.13 },
        { n: "E3", t: 0.32, d: 0.13 },
        { n: "E3", t: 0.48, d: 0.13 },
        { n: "E3", t: 0.64, d: 0.13 },
        { n: "G3", t: 0.8, d: 0.15 },
        { n: "E3", t: 0.98, d: 0.13 },
        { n: "A3", t: 1.14, d: 0.3 },
        { n: "E3", t: 1.46, d: 0.7 }
      ];
      run.forEach(function (note) {
        anthemTone(freqs[note.n] * mult, now + note.t, note.d, 0.24);
      });
    }

    [playChampionsSong, playBitesTheDustSong][Math.floor(Math.random() * 2)]();
  }

  // A gentle 14-note pastoral phrase evoking the Beatles' recorder
  // introduction to "Fool on the Hill" (an homage rather than a literal
  // transcription) — a soft sine "recorder" timbre with both the shared
  // slapback echo bus AND its own dedicated reverb send, for a spacious,
  // dreamy feel fitting a quiet warning rather than a fanfare.
  function playOnHillSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 2.8, 2.8);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.55;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    function recorderTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (echoSend) gain.connect(echoSend);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.06);
    }

    var freqs = { D4: 293.66, E4: 329.63, Fs4: 369.99, G4: 392.0, A4: 440.0, Cs5: 554.37, D5: 587.33 };
    var melody = ["D4", "E4", "Fs4", "G4", "Fs4", "E4", "D4", "A4", "G4", "Fs4", "E4", "D4", "Cs5", "D5"];
    var noteDur = 0.27;
    melody.forEach(function (name, i) {
      var duration = i === melody.length - 1 ? noteDur * 2.4 : noteDur * 0.95;
      recorderTone(freqs[name], now + i * noteDur, duration, 0.16);
    });
  }

  // Builds a synthetic reverb impulse response — exponentially decaying
  // stereo noise, no external audio file needed — used only by
  // playTournamentChampionSound for a big, cathedral-like tail. Much
  // wetter/longer than the shared slapback echo bus (setupEchoBus)
  // every other sound uses, on purpose: this fanfare should feel like
  // it's ringing out in a huge hall.
  function buildReverbImpulse(ctx, duration, decay) {
    var rate = ctx.sampleRate;
    var length = Math.max(1, Math.floor(rate * duration));
    var impulse = ctx.createBuffer(2, length, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = impulse.getChannelData(ch);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  // Winning a whole Tournament — a bracket Tournament's champion, or a
  // main-scoreboard "race to N wins" session — gets its own fanfare: the
  // full main theme of Beethoven's 9th Symphony ("Ode to Joy"), played
  // low and drenched in reverb for a deep, triumphant, slightly ominous
  // feel — deliberately different from playWinSound's bright single-rack
  // fanfare. Every note is scheduled a full second after this is called
  // (ctx.currentTime + 1) so it lands just after the champion banner/
  // milestone overlay appears, not on top of it.
  function playTournamentChampionSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var start = now + 1;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 3.2, 2.4);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.9;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    // A low sawtooth note plus a sub-octave sine underneath for weight —
    // both fed into the big reverb send above (not the shared echo bus).
    function lowReverbTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.1);

      var sub = ctx.createOscillator();
      var subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.value = freq / 2;
      subGain.gain.setValueAtTime(0, t);
      subGain.gain.linearRampToValueAtTime(peakGain * 0.65, t + 0.025);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      subGain.connect(reverbSend);
      sub.start(t);
      sub.stop(t + duration + 0.1);
    }

    // C3-rooted "Ode to Joy" main theme, all 30 notes of its full 8-bar
    // form (the complete "Freude, schöner Götterfunken..." melody, both
    // 4-bar halves): mi mi fa sol / sol fa mi re / do do re mi / mi re re
    // // mi mi fa sol / sol fa mi re / do do re mi / re do do.
    var freqs = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196.0 };
    var melody = [
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "E", "D", "D",
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "D", "C", "C"
    ];
    var step = 0.24;
    melody.forEach(function (deg, i) {
      var isLast = i === melody.length - 1;
      lowReverbTone(freqs[deg], start + i * step, isLast ? 1.0 : 0.21, isLast ? 0.24 : 0.2);
    });
  }

  // ---------------------------------------------------------------------
  // Theme — twenty color/font palettes, applied as a data-theme attribute
  // on <html> so every CSS custom property cascades from there. The
  // choice persists to localStorage; a tiny inline script in <head>
  // applies it synchronously on load (before the stylesheet paints) so
  // there's no flash of the default theme first.
  // ---------------------------------------------------------------------

  var THEME_KEY = "poolMasterCounter.theme.v1";
  var THEME_STATUS_COLORS = {
    "crimson-felt": "#1a0a0a",
    "emerald-rail": "#071a10",
    "neon-arcade": "#0a0a12",
    "midnight-ivory": "#0e1218",
    "sunset-chalk": "#1a0f08",
    "obsidian-break": "#08090a",
    "sunset-blaze": "#1a0e1f",
    "red-and-pink": "#1c0510",
    "gold-mine": "#140d06",
    "rock-and-roll": "#0a0a0a",
    "copper-shine": "#2a1408",
    "daybreak-chalk": "#f5f1e8",
    "pearl-lounge": "#f4f2f6",
    "sunrise-glow": "#fff3ea",
    "stainless-steel": "#c7ced3",
    "opal-shimmer": "#f3f0f5",
    "flowery-forest": "#f6f8f0",
    "bamboo": "#f2edd9",
    "blackout-contrast": "#000000",
    "paper-contrast": "#ffffff"
  };

  var themeSelect = document.getElementById("theme-select");

  function applyTheme(id, persist) {
    document.documentElement.setAttribute("data-theme", id);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && THEME_STATUS_COLORS[id]) meta.setAttribute("content", THEME_STATUS_COLORS[id]);
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, id);
      } catch (e) {
        console.warn("Could not save theme.", e);
      }
    }
  }

  applyTheme(document.documentElement.getAttribute("data-theme") || "crimson-felt", false);
  themeSelect.value = document.documentElement.getAttribute("data-theme") || "crimson-felt";
  themeSelect.addEventListener("change", function () {
    applyTheme(themeSelect.value, true);
  });

  // ---------------------------------------------------------------------
  // Language / i18n
  //
  // Every user-facing string lives in languages/<name>.json, keyed by a
  // dotted name (e.g. "backup.exportAll"). languages/manifest.json is the
  // list the selector reads - a plain static site can't ask the server
  // "what files exist in this folder" over HTTP, so the manifest IS the
  // directory listing; adding a language means adding both its JSON file
  // and a manifest entry (see languages/README.md). English is always
  // loaded as a fallback dictionary, so a key missing from a
  // partially-translated language falls back to English instead of
  // showing a raw key. Switching languages persists the choice and
  // reloads the page - simplest way to guarantee every screen (including
  // ones not currently visible) re-renders in the new language, and since
  // all real app state already lives in localStorage, nothing is lost.
  // ---------------------------------------------------------------------

  var LANGUAGE_KEY = "poolMasterCounter.language.v1";
  var DEFAULT_LANGUAGE_CODE = "english";
  var activeLanguageCode = DEFAULT_LANGUAGE_CODE;
  var LANG_MANIFEST = [{ code: "english", file: "english.json", label: "English", flag: "🇬🇧" }];
  var LANG_DICT_EN = {};
  var LANG_DICT_ACTIVE = {};
  var missingTranslationKeysWarned = {};

  var languageSelect = document.getElementById("language-select");

  function loadLanguageCodeFromStorage() {
    try {
      return localStorage.getItem(LANGUAGE_KEY) || DEFAULT_LANGUAGE_CODE;
    } catch (e) {
      return DEFAULT_LANGUAGE_CODE;
    }
  }

  function saveLanguageCodeToStorage(code) {
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch (e) {
      console.warn("Could not save language.", e);
    }
  }

  // Looks up key in the active language, falling back to English, then to
  // the key itself (warning once, not on every call, so a genuinely
  // missing key can't spam the console or look like a real JS error).
  // vars supports {{name}} interpolation, e.g. T("wonGame", {name: "Bob"}).
  function T(key, vars) {
    var str = LANG_DICT_ACTIVE[key];
    if (str === undefined) str = LANG_DICT_EN[key];
    if (str === undefined) {
      if (!missingTranslationKeysWarned[key]) {
        missingTranslationKeysWarned[key] = true;
        console.warn("Missing translation key:", key);
      }
      return key;
    }
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        str = str.split("{{" + name + "}}").join(vars[name]);
      });
    }
    return str;
  }

  // Translates a raw unit value ("rack"/"balls"/"points", as stored on
  // state.currentGame/rotation entries) for display - the value itself
  // stays an untranslated internal identifier, only the shown label
  // changes with the active language.
  function unitLabel(unit) {
    if (unit === "rack") return T("units.rack");
    if (unit === "balls") return T("units.balls");
    if (unit === "points") return T("units.points");
    return unit;
  }

  // Applies the active dictionary to every static data-i18n[-*] element
  // under root - called once after boot, and whenever DOM is rebuilt by a
  // template that predates a language switch (rare, since switching
  // reloads the page; kept general so it also works for content injected
  // before boot() runs, e.g. nothing today, but safe for future use).
  function applyDomTranslations(root) {
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = T(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = T(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", T(el.getAttribute("data-i18n-placeholder")));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) {
      el.setAttribute("aria-label", T(el.getAttribute("data-i18n-aria-label")));
    });
    root.querySelectorAll("[data-i18n-label]").forEach(function (el) {
      el.setAttribute("label", T(el.getAttribute("data-i18n-label")));
    });
  }

  function fetchLanguageJSON(file) {
    return fetchFresh("languages/" + file)
      .then(function (res) {
        return res.ok ? res.json() : {};
      })
      .catch(function () {
        return {};
      });
  }

  function loadLanguageManifest() {
    return fetchFresh("languages/manifest.json")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      });
  }

  function populateLanguageSelect() {
    languageSelect.innerHTML = "";
    LANG_MANIFEST.forEach(function (entry) {
      var opt = document.createElement("option");
      opt.value = entry.code;
      opt.textContent = entry.flag + " " + entry.label;
      languageSelect.appendChild(opt);
    });
    languageSelect.value = activeLanguageCode;
  }

  // Loads the manifest, then English (always, as the fallback dict) and
  // the active language (if different) in parallel. Resolves once both
  // dictionaries and the selector are ready - awaited alongside
  // gameTypesPromise/migrateFromRepoIfNeeded() below, before boot().
  var languagePromise = loadLanguageManifest().then(function (manifest) {
    if (Array.isArray(manifest) && manifest.length) LANG_MANIFEST = manifest;
    activeLanguageCode = loadLanguageCodeFromStorage();
    if (
      !LANG_MANIFEST.some(function (e) {
        return e.code === activeLanguageCode;
      })
    ) {
      activeLanguageCode = DEFAULT_LANGUAGE_CODE;
    }
    var englishEntry =
      LANG_MANIFEST.filter(function (e) {
        return e.code === DEFAULT_LANGUAGE_CODE;
      })[0] || { file: "english.json" };
    var activeEntry =
      LANG_MANIFEST.filter(function (e) {
        return e.code === activeLanguageCode;
      })[0] || englishEntry;
    return Promise.all([
      fetchLanguageJSON(englishEntry.file),
      activeLanguageCode === DEFAULT_LANGUAGE_CODE ? Promise.resolve(null) : fetchLanguageJSON(activeEntry.file)
    ]).then(function (dicts) {
      LANG_DICT_EN = dicts[0] || {};
      LANG_DICT_ACTIVE = dicts[1] || LANG_DICT_EN;
      populateLanguageSelect();
    });
  });

  languageSelect.addEventListener("change", function () {
    saveLanguageCodeToStorage(languageSelect.value);
    location.reload();
  });

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var btnExportAllData = document.getElementById("btn-export-all-data");
  var btnImportAllData = document.getElementById("btn-import-all-data");
  var btnExportSync = document.getElementById("btn-export-sync");
  var syncStatusLine = document.getElementById("sync-status-line");
  var importFileInput = document.getElementById("import-file-input");
  var btnResetAllPlayerStats = document.getElementById("btn-reset-all-player-stats");
  var btnResetRosterLists = document.getElementById("btn-reset-roster-lists");
  var btnFullReset = document.getElementById("btn-full-reset");
  var fullResetStep2Overlay = document.getElementById("full-reset-step2-overlay");
  var btnFullResetStep2Yes = document.getElementById("btn-full-reset-step2-yes");
  var btnFullResetStep2ByDates = document.getElementById("btn-full-reset-step2-by-dates");
  var btnFullResetStep2Cancel = document.getElementById("btn-full-reset-step2-cancel");
  var deleteByDateOverlay = document.getElementById("delete-by-date-modal-overlay");
  var deleteByDateGrid = document.getElementById("delete-by-date-calendar-grid");
  var deleteByDateMonthLabel = document.getElementById("delete-by-date-month-label");
  var btnDeleteByDatePrevMonth = document.getElementById("btn-delete-by-date-prev-month");
  var btnDeleteByDateNextMonth = document.getElementById("btn-delete-by-date-next-month");
  var deleteByDateSelectedSummary = document.getElementById("delete-by-date-selected-summary");
  var btnDeleteByDateConfirm = document.getElementById("btn-delete-by-date-confirm");
  var btnDeleteByDateCancel = document.getElementById("btn-delete-by-date-cancel");
  var backupPanel = document.getElementById("backup-panel");
  var btnToggleBackupPanel = document.getElementById("btn-toggle-backup-panel");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var newPlayerRatingInput = document.getElementById("new-player-rating");
  var newPlayerNameRequirement = document.getElementById("new-player-name-requirement");
  var btnAddPlayer = document.getElementById("btn-add-player");
  var rosterList = document.getElementById("roster-list");
  var queueModeRow = document.getElementById("queue-mode-row");
  var queueModeCheckbox = document.getElementById("queue-mode-checkbox");
  var queueSection = document.getElementById("queue-section");
  var queueList = document.getElementById("queue-list");
  var rosterLoadSelect = document.getElementById("roster-load-select");
  var btnRosterLoad = document.getElementById("btn-roster-load");
  var btnExportRosterLists = document.getElementById("btn-export-roster-lists");
  var btnExportRosterListsCsv = document.getElementById("btn-export-roster-lists-csv");
  var btnImportRosterLists = document.getElementById("btn-import-roster-lists");
  var importRosterListsFileInput = document.getElementById("import-roster-lists-file-input");

  var helpOverlay = document.getElementById("help-overlay");
  var btnHelpClose = document.getElementById("btn-help-close");
  var helpNavLinks = document.querySelectorAll(".help-nav-link");
  var btnOpenHelpButtons = [
    document.getElementById("btn-open-help"),
    document.getElementById("btn-open-help-all-players"),
    document.getElementById("btn-open-help-tournament"),
    document.getElementById("btn-open-help-player-page"),
    document.getElementById("btn-open-help-wizard")
  ];

  var btnTestOnboarding = document.getElementById("btn-test-onboarding");
  var btnOpenWizard = document.getElementById("btn-open-wizard");
  var wizardOverlay = document.getElementById("wizard-overlay");
  var btnWizardClose = document.getElementById("btn-wizard-close");
  var wizardProgress = document.getElementById("wizard-progress");
  var wizardProgressDots = document.getElementById("wizard-progress-dots");
  var wizardGameTypeSelect = document.getElementById("wizard-game-type");
  var wizardFormatRadios = document.getElementsByName("wizard-format");
  var wizardRaceToRow = document.getElementById("wizard-raceto-row");
  var wizardRaceToInput = document.getElementById("wizard-race-to");
  var wizardRosterLoadSelect = document.getElementById("wizard-roster-load-select");
  var btnWizardRosterLoad = document.getElementById("wizard-btn-roster-load");
  var wizardNewPlayerNameRequirement = document.getElementById("wizard-new-player-name-requirement");
  var wizardAddPlayerForm = document.getElementById("wizard-add-player-form");
  var wizardNewPlayerName = document.getElementById("wizard-new-player-name");
  var wizardNewPlayerRatingInput = document.getElementById("wizard-new-player-rating");
  var btnWizardAddPlayer = document.getElementById("wizard-btn-add-player");
  var wizardPlayerChips = document.getElementById("wizard-player-chips");
  var wizardPlayingList = document.getElementById("wizard-playing-list");
  var wizardPlayingWarning = document.getElementById("wizard-playing-warning");
  var wizardRotationEnabledRadios = document.getElementsByName("wizard-rotation-enabled");
  var wizardRotationDetail = document.getElementById("wizard-rotation-detail");
  var wizardRotationLoadSelect = document.getElementById("wizard-rotation-load-select");
  var btnWizardRotationLoad = document.getElementById("wizard-btn-rotation-load");
  var wizardRotationAddType = document.getElementById("wizard-rotation-add-type");
  var wizardRotationAddTarget = document.getElementById("wizard-rotation-add-target");
  var wizardRotationAddUnit = document.getElementById("wizard-rotation-add-unit");
  var btnWizardRotationAdd = document.getElementById("wizard-btn-rotation-add");
  var wizardRotationList = document.getElementById("wizard-rotation-list");
  var wizardRotationEveryInput = document.getElementById("wizard-rotation-every");
  var wizardSummary = document.getElementById("wizard-summary");
  var btnWizardBack = document.getElementById("wizard-btn-back");
  var btnWizardCancel = document.getElementById("wizard-btn-cancel");
  var btnWizardNext = document.getElementById("wizard-btn-next");
  var btnWizardStart = document.getElementById("wizard-btn-start");
  var wizardTempCounterCheckbox = document.getElementById("wizard-temp-counter-checkbox");
  var btnWizardStartQuickCounter = document.getElementById("btn-wizard-start-quick-counter");

  var onboardingOverlay = document.getElementById("onboarding-overlay");
  var onboardingHeading = document.getElementById("onboarding-heading");
  var onboardingProgress = document.getElementById("onboarding-progress");
  var onboardingProgressDots = document.getElementById("onboarding-progress-dots");
  var onboardingNameRequirement = document.getElementById("onboarding-name-requirement");
  var onboardingNameInput = document.getElementById("onboarding-name-input");
  var onboardingRatingInput = document.getElementById("onboarding-rating-input");
  var onboardingEmailInput = document.getElementById("onboarding-email-input");
  var onboardingPhoneInput = document.getElementById("onboarding-phone-input");
  var checkOnboardingEmailValidity = null;
  var checkOnboardingPhoneValidity = null;
  var onboardingContactRequirement = document.getElementById("onboarding-contact-requirement");
  var onboardingReportOptInCheckbox = document.getElementById("onboarding-report-optin-checkbox");
  var onboardingNotifyMethodRow = document.getElementById("onboarding-notify-method-row");
  var onboardingNotifyMethodRadios = document.getElementsByName("onboarding-notify-method");
  var onboardingPlayChoiceRadios = document.getElementsByName("onboarding-play-choice");
  var onboardingStandardFooter = document.getElementById("onboarding-standard-footer");
  var btnOnboardingCancel = document.getElementById("btn-onboarding-cancel");
  var btnOnboardingGo = document.getElementById("btn-onboarding-go");
  var btnOnboardingRunWizard = document.getElementById("btn-onboarding-run-wizard");
  var btnOnboardingManual = document.getElementById("btn-onboarding-manual");
  var onboardingStep = 1;

  var btnToggleFocus = document.getElementById("btn-toggle-focus");
  var focusPlayersWrap = document.getElementById("focus-players-wrap");
  var btnToggleFocusPlayers = document.getElementById("btn-toggle-focus-players");
  var focusPlayersSummary = document.getElementById("focus-players-summary");
  var focusPlayersList = document.getElementById("focus-players-list");
  var appRoot = document.getElementById("app");
  var playerPageView = document.getElementById("view-player-page");
  var playerPageName = document.getElementById("player-page-name");
  var playerPageAdded = document.getElementById("player-page-added");
  var playerPageCurrentBody = document.getElementById("player-page-current-body");
  var playerPageHistoryList = document.getElementById("player-page-history-list");
  var btnPlayerPageBack = document.getElementById("btn-player-page-back");
  var btnPlayerPageExport = document.getElementById("btn-player-page-export");
  var btnPlayerPageCsv = document.getElementById("btn-player-page-csv");
  var btnPlayerPageReset = document.getElementById("btn-player-page-reset");
  var playerPagePeriodFilter = document.getElementById("player-page-period-filter");
  var playerPageGraphBody = document.getElementById("player-page-graph-body");
  var playerPagePeriodButtons = playerPagePeriodFilter.querySelectorAll(".period-btn");
  var playerPageSynopsisBody = document.getElementById("player-page-synopsis-body");
  var playerPageH2hList = document.getElementById("player-page-h2h-list");
  var playerPageTeamsList = document.getElementById("player-page-teams-list");
  var playerPageAchievementsList = document.getElementById("player-page-achievements-list");
  var btnReturnToGlobalStats = document.getElementById("btn-return-to-global-stats");
  var playerPageSwitcher = document.getElementById("player-page-switcher");

  var btnOpenAllPlayers = document.getElementById("btn-open-all-players");
  var allPlayersPageView = document.getElementById("view-all-players-page");
  var btnAllPlayersBack = document.getElementById("btn-all-players-back");
  var allPlayersSortSelect = document.getElementById("all-players-sort");
  var allPlayersPeriodSelect = document.getElementById("all-players-period");
  var btnToggleAllPlayersView = document.getElementById("btn-toggle-all-players-view");
  var btnToggleRosterFilter = document.getElementById("btn-toggle-roster-filter");
  var btnAllPlayersCsv = document.getElementById("btn-all-players-csv");
  var allPlayersList = document.getElementById("all-players-list");
  var allPlayersViewMode = "bars";
  var allPlayersRosterOnly = false;

  var btnOpenGlobalStats = document.getElementById("btn-open-global-stats");

  var btnOpenLeaderboard = document.getElementById("btn-open-leaderboard");
  var leaderboardPageView = document.getElementById("view-leaderboard-page");
  var btnLeaderboardBack = document.getElementById("btn-leaderboard-back");
  var btnLeaderboardPlay = document.getElementById("btn-leaderboard-play");
  var leaderboardList = document.getElementById("leaderboard-list");
  var leaderboardEmptyHint = document.getElementById("leaderboard-empty-hint");
  var leaderboardFormulaNote = document.getElementById("leaderboard-formula-note");

  var btnOpenContactSheet = document.getElementById("btn-open-contact-sheet");
  var contactSheetPageView = document.getElementById("view-contact-sheet-page");
  var btnContactSheetBack = document.getElementById("btn-contact-sheet-back");
  var btnContactSheetSelectAll = document.getElementById("btn-contact-sheet-select-all");
  var btnContactSheetImportRosters = document.getElementById("btn-contact-sheet-import-rosters");
  var btnContactSheetImportJson = document.getElementById("btn-contact-sheet-import-json");
  var contactSheetImportJsonFileInput = document.getElementById("contact-sheet-import-json-file-input");
  var btnContactSheetExportJson = document.getElementById("btn-contact-sheet-export-json");
  var btnContactSheetVcard = document.getElementById("btn-contact-sheet-vcard");
  var btnContactSheetEmail = document.getElementById("btn-contact-sheet-email");
  var btnContactSheetSms = document.getElementById("btn-contact-sheet-sms");
  var contactSheetSelectedSummary = document.getElementById("contact-sheet-selected-summary");
  var contactSheetList = document.getElementById("contact-sheet-list");
  var contactSheetSelected = {};

  var btnOpenTournament = document.getElementById("btn-open-tournament");
  var tournamentPageView = document.getElementById("view-tournament-page");
  var btnTournamentBack = document.getElementById("btn-tournament-back");
  var tournamentSetupPanel = document.getElementById("tournament-setup-panel");
  var tournamentActivePanel = document.getElementById("tournament-active-panel");
  var tournamentFormatRadios = document.getElementsByName("tournament-format");
  var tournamentWbSection = document.getElementById("tournament-wb-section");
  var tournamentLbSection = document.getElementById("tournament-lb-section");
  var tournamentTimelineEl = document.getElementById("tournament-timeline");
  var tournamentRrSection = document.getElementById("tournament-rr-section");
  var tournamentSwissSection = document.getElementById("tournament-swiss-section");
  var tournamentGameTypeSelect = document.getElementById("tournament-game-type");
  var tournamentTargetInput = document.getElementById("tournament-target");
  var tournamentTargetUnit = document.getElementById("tournament-target-unit");
  var tournamentRaceToInput = document.getElementById("tournament-race-to");
  var tournamentFairRaceCheckbox = document.getElementById("tournament-fair-race-checkbox");
  var btnFairRaceInfo = document.getElementById("btn-fair-race-info");
  var tournamentTableCountInput = document.getElementById("tournament-table-count");
  var tournamentSeedModeRadios = document.getElementsByName("tournament-seed-mode");
  var tournamentFormatInfoOverlay = document.getElementById("tournament-format-info-overlay");
  var tournamentFormatInfoTitle = document.getElementById("tournament-format-info-title");
  var tournamentFormatInfoBody = document.getElementById("tournament-format-info-body");
  var btnTournamentFormatInfoSelect = document.getElementById("btn-tournament-format-info-select");
  var btnTournamentFormatInfoCancel = document.getElementById("btn-tournament-format-info-cancel");
  var tournamentFormatInfoPendingRadio = null;
  var tournamentTeamsEnabledCheckbox = document.getElementById("tournament-teams-enabled-checkbox");
  var tournamentSelectAllCheckbox = document.getElementById("tournament-select-all-checkbox");
  // Remembers exactly who was checked right before "Select All" was
  // turned on, so turning it back off restores that instead of just
  // clearing everyone - null whenever Select All isn't active. Declared
  // here (not down by the rest of the Select All wiring) because
  // renderTournamentPlayerChecklist, which also reads/resets this, is
  // defined outside boot() - a variable declared inside boot() would be
  // invisible to it regardless of call order, since closures resolve by
  // where a function is lexically defined, not when it happens to run.
  var tournamentSelectAllSnapshot = null;
  var tournamentPlayerChecklist = document.getElementById("tournament-player-checklist");
  var tournamentTeamOptionsDatalist = document.getElementById("tournament-team-options");
  var tournamentTeamPreview = document.getElementById("tournament-team-preview");
  var btnTournamentStart = document.getElementById("btn-tournament-start");
  var btnTournamentAbandon = document.getElementById("btn-tournament-abandon");
  var btnTournamentPrint = document.getElementById("btn-tournament-print");
  var tournamentChampionBanner = document.getElementById("tournament-champion-banner");
  var tournamentCurrentMatchPanel = document.getElementById("tournament-current-match-panel");
  var tournamentReadyList = document.getElementById("tournament-ready-list");
  var tournamentWbEl = document.getElementById("tournament-wb");
  var tournamentLbEl = document.getElementById("tournament-lb");
  var tournamentGfEl = document.getElementById("tournament-gf");
  var tournamentRrStandingsEl = document.getElementById("tournament-rr-standings");
  var tournamentRrMatchesEl = document.getElementById("tournament-rr-matches");
  var tournamentSwissStandingsEl = document.getElementById("tournament-swiss-standings");
  var tournamentSwissMatchesEl = document.getElementById("tournament-swiss-matches");

  var gameTypeSelect = document.getElementById("game-type");
  var gameTargetInput = document.getElementById("game-target");
  var gameTargetUnitSelect = document.getElementById("game-target-unit-select");
  var modeRadios = document.getElementsByName("game-mode");
  var raceToWinsInput = document.getElementById("race-to-wins");
  var fairRaceEnabledCheckbox = document.getElementById("fair-race-enabled-checkbox");
  var noStatsCheckbox = document.getElementById("no-stats-checkbox");
  var shotCounterEnabledCheckbox = document.getElementById("shot-counter-enabled-checkbox");
  var shotCounterBeepRow = document.getElementById("shot-counter-beep-row");
  var shotCounterBeepInput = document.getElementById("shot-counter-beep-input");
  var btnShotCounterToggleVisibility = document.getElementById("btn-shot-counter-toggle-visibility");

  var btnResetGame = document.getElementById("btn-reset-game");
  var btnUndoWin = document.getElementById("btn-undo-win");
  var btnShare = document.getElementById("btn-share");
  var btnExportSession = document.getElementById("btn-export-session");

  var rotationEnabledCheckbox = document.getElementById("rotation-enabled");
  var rotationLoadSelect = document.getElementById("rotation-load-select");
  var btnRotationLoad = document.getElementById("btn-rotation-load");
  var rotationAddType = document.getElementById("rotation-add-type");
  var rotationAddTarget = document.getElementById("rotation-add-target");
  var rotationAddUnit = document.getElementById("rotation-add-unit");
  var btnRotationAdd = document.getElementById("btn-rotation-add");
  var rotationList = document.getElementById("rotation-list");
  var rotationEveryInput = document.getElementById("rotation-every");
  var rotationStatus = document.getElementById("rotation-status");
  var rotationPositionRow = document.getElementById("rotation-position-row");
  var rotationPositionTrack = document.getElementById("rotation-position-track");
  var rotationPositionText = document.getElementById("rotation-position-text");
  var btnRotationPositionPrev = document.getElementById("btn-rotation-position-prev");
  var btnRotationPositionNext = document.getElementById("btn-rotation-position-next");

  var winToast = document.getElementById("win-toast");
  var pageToast = document.getElementById("page-toast");
  var scoreboard = document.getElementById("scoreboard");
  var historyList = document.getElementById("history-list");
  var standingsTitle = document.getElementById("standings-title");
  var teamStandingsList = document.getElementById("team-standings-list");
  var playerStandingsList = document.getElementById("player-standings-list");

  var dayNotesTextarea = document.getElementById("day-notes-textarea");
  var runRecordsSummary = document.getElementById("run-records-summary");
  var dayReportFormatSelect = document.getElementById("day-report-format-select");
  var btnDayReportCopy = document.getElementById("btn-day-report-copy");
  var btnDayReportEmail = document.getElementById("btn-day-report-email");
  var btnDayReportSms = document.getElementById("btn-day-report-sms");
  var btnDayReportShareBackup = document.getElementById("btn-day-report-share-backup");
  var btnDayReportCsv = document.getElementById("btn-day-report-csv");
  var btnDayReportPrint = document.getElementById("btn-day-report-print");
  var dayReportPrintView = document.getElementById("day-report-print-view");
  var btnDayReportColorful = document.getElementById("btn-day-report-colorful");
  var dayReportAttachBackupCheckbox = document.getElementById("day-report-attach-backup-checkbox");
  var dayReportAttachColorfulCheckbox = document.getElementById("day-report-attach-colorful-checkbox");
  var dayReportRecipientsLine = document.getElementById("day-report-recipients-line");

  var milestoneOverlay = document.getElementById("milestone-overlay");
  var milestoneHeadline = document.getElementById("milestone-headline");
  var milestoneDetails = document.getElementById("milestone-details");
  var btnMilestoneClose = document.getElementById("btn-milestone-close");
  var btnMilestoneUndo = document.getElementById("btn-milestone-undo");
  var tournamentMatchWinOverlay = document.getElementById("tournament-match-win-overlay");
  var tournamentMatchWinEmoji = document.getElementById("tournament-match-win-emoji");
  var tournamentMatchWinHeadline = document.getElementById("tournament-match-win-headline");
  var tournamentMatchWinSubtext = document.getElementById("tournament-match-win-subtext");
  var btnTournamentMatchWinClose = document.getElementById("btn-tournament-match-win-close");

  var gamewinOverlay = document.getElementById("gamewin-overlay");
  var gamewinMessage = document.getElementById("gamewin-message");
  var gamewinDetails = document.getElementById("gamewin-details");
  var btnGamewinClose = document.getElementById("btn-gamewin-close");
  var btnGamewinUndo = document.getElementById("btn-gamewin-undo");

  var forceResetOverlay = document.getElementById("force-reset-overlay");
  var forceResetMessage = document.getElementById("force-reset-message");
  var btnForceResetClose = document.getElementById("btn-force-reset-close");

  var btnResetTodayStats = document.getElementById("btn-reset-today-stats");

  // Optional "balls left on the table" marker for whichever game the
  // gamewin overlay is currently showing — unset (null) unless the +/-
  // counter is used. Tracks which game record to patch once the dialog
  // closes (see showGameWinOverlay/closeGameWinOverlay below).
  var gamewinBallsLeftValue = null;
  var gamewinPendingTs = null;
  var gamewinPendingOnClose = null;

  var onHillOverlay = document.getElementById("onhill-overlay");
  var onHillMessage = document.getElementById("onhill-message");
  var btnOnHillClose = document.getElementById("btn-onhill-close");

  var gameChangeOverlay = document.getElementById("gamechange-overlay");
  var gameChangeMessage = document.getElementById("gamechange-message");
  var btnGameChangeClose = document.getElementById("btn-gamechange-close");
  var nowPlayingBanner = document.getElementById("now-playing-banner");

  var saveSessionOverlay = document.getElementById("save-session-overlay");
  var saveSessionMessage = document.getElementById("save-session-message");
  var btnSaveSessionSave = document.getElementById("btn-save-session-save");
  var btnSaveSessionSkip = document.getElementById("btn-save-session-skip");
  var btnSaveSessionCancel = document.getElementById("btn-save-session-cancel");

  var ratingEditOverlay = document.getElementById("rating-edit-overlay");
  var ratingEditPlayerName = document.getElementById("rating-edit-player-name");
  var ratingEditInput = document.getElementById("rating-edit-input");
  var ratingEditEmailInput = document.getElementById("rating-edit-email-input");
  var ratingEditPhoneInput = document.getElementById("rating-edit-phone-input");
  var checkRatingEditEmailValidity = null;
  var checkRatingEditPhoneValidity = null;
  var ratingEditNotifyCheckbox = document.getElementById("rating-edit-notify-checkbox");
  var ratingEditNotifyMethodRow = document.getElementById("rating-edit-notify-method-row");
  var ratingEditNotifyMethodRadios = document.getElementsByName("rating-edit-notify-method");
  var btnRatingEditSave = document.getElementById("btn-rating-edit-save");
  var btnRatingEditCancel = document.getElementById("btn-rating-edit-cancel");
  var btnResetAllRatings = document.getElementById("btn-reset-all-ratings");

  var removedPlayersOverlay = document.getElementById("removed-players-overlay");
  var removedPlayersChecklist = document.getElementById("removed-players-checklist");
  var btnRemovedPlayersContinue = document.getElementById("btn-removed-players-continue");

  var playerConflictOverlay = document.getElementById("player-conflict-overlay");
  var playerConflictList = document.getElementById("player-conflict-list");
  var btnPlayerConflictContinue = document.getElementById("btn-player-conflict-continue");

  var reportArchiveList = document.getElementById("report-archive-list");

  var recoverDataList = document.getElementById("recover-data-list");
  var btnRecoverImportFile = document.getElementById("btn-recover-import-file");
  var recoverImportFileInput = document.getElementById("recover-import-file-input");
  var recoverDetailOverlay = document.getElementById("recover-detail-overlay");
  var recoverDetailTitle = document.getElementById("recover-detail-title");
  var recoverDetailExplain = document.getElementById("recover-detail-explain");
  var recoverPlayersSection = document.getElementById("recover-players-section");
  var recoverPlayersChecklist = document.getElementById("recover-players-checklist");
  var recoverGamesSection = document.getElementById("recover-games-section");
  var recoverGamesChecklist = document.getElementById("recover-games-checklist");
  var recoverRostersSection = document.getElementById("recover-rosters-section");
  var recoverRostersChecklist = document.getElementById("recover-rosters-checklist");
  var btnRecoverRestore = document.getElementById("btn-recover-restore");
  var btnRecoverCancel = document.getElementById("btn-recover-cancel");
  var btnResetSessionTournament = document.getElementById("btn-reset-session-tournament");
  var ratingEditTargetName = null;

  var confirmModalOverlay = document.getElementById("confirm-modal-overlay");
  var confirmModalMessage = document.getElementById("confirm-modal-message");
  var confirmModalInputRow = document.getElementById("confirm-modal-input-row");
  var confirmModalInput = document.getElementById("confirm-modal-input");
  var btnConfirmModalOk = document.getElementById("btn-confirm-modal-ok");
  var btnConfirmModalCancel = document.getElementById("btn-confirm-modal-cancel");

  // ---------------------------------------------------------------------
  // Generic modal alert/confirm/prompt - replaces native alert()/
  // confirm()/prompt(), which freeze the whole page behind browser
  // chrome instead of feeling like part of the app. One shared overlay,
  // reconfigured per call; only one is ever open at a time.
  // ---------------------------------------------------------------------

  var confirmModalOnConfirm = null;
  var confirmModalOnCancel = null;

  var paywallModalOverlay = document.getElementById("paywall-modal-overlay");
  var btnPaywallUnlock = document.getElementById("btn-paywall-unlock");
  var btnPaywallWatchAd = document.getElementById("btn-paywall-watch-ad");
  var btnPaywallRestore = document.getElementById("btn-paywall-restore");
  var btnPaywallCancel = document.getElementById("btn-paywall-cancel");
  var fakeAdModalOverlay = document.getElementById("fake-ad-modal-overlay");
  var fakeAdModalMessage = document.getElementById("fake-ad-modal-message");

  function closeConfirmModal() {
    confirmModalOverlay.classList.add("hidden");
    confirmModalOnConfirm = null;
    confirmModalOnCancel = null;
  }

  function openConfirmModal(message, showCancel, showInput, inputValue) {
    confirmModalMessage.textContent = message;
    confirmModalMessage.classList.toggle("is-long-text", message.length > 200 || message.indexOf("\n") !== -1);
    confirmModalInputRow.classList.toggle("hidden", !showInput);
    confirmModalInput.value = showInput ? inputValue || "" : "";
    btnConfirmModalCancel.classList.toggle("hidden", !showCancel);
    confirmModalOverlay.classList.remove("hidden");
    // preventScroll: true - this overlay is position:fixed and already
    // covers the whole viewport, so there's nothing for the browser's
    // default focus-scroll-into-view behavior to usefully do here; left
    // on, it was yanking the page underneath back to the focused
    // element's old scroll position (see the same fix on
    // showGameWinOverlay's balls-left input).
    if (showInput) {
      confirmModalInput.focus({ preventScroll: true });
      confirmModalInput.select();
    } else {
      btnConfirmModalOk.focus({ preventScroll: true });
    }
  }

  // Replaces `alert(msg)`. onClose (optional) runs once the user
  // dismisses it, whether via OK or the backdrop - there's no
  // "cancelled" state for a single-button alert.
  function alertModal(message, onClose) {
    var cb = onClose || null;
    confirmModalOnConfirm = cb;
    confirmModalOnCancel = cb;
    openConfirmModal(message, false, false);
  }

  // Replaces `if (!confirm(msg)) return; ...rest`. Move ...rest into
  // onYes; onNo (optional) runs on Cancel/backdrop-dismiss.
  function confirmModal(message, onYes, onNo) {
    confirmModalOnConfirm = onYes;
    confirmModalOnCancel = onNo || null;
    openConfirmModal(message, true, false);
  }

  // Replaces `prompt(msg, defaultValue)`. onSubmit receives the entered
  // string; onCancel (optional) runs on Cancel/backdrop-dismiss instead
  // (there's no null-return case here the way native prompt() has one).
  function promptModal(message, defaultValue, onSubmit, onCancel) {
    confirmModalOnConfirm = function () {
      onSubmit(confirmModalInput.value);
    };
    confirmModalOnCancel = onCancel || null;
    openConfirmModal(message, true, true, defaultValue);
  }

  btnConfirmModalOk.addEventListener("click", function () {
    var cb = confirmModalOnConfirm;
    closeConfirmModal();
    if (cb) cb();
  });
  btnConfirmModalCancel.addEventListener("click", function () {
    var cb = confirmModalOnCancel;
    closeConfirmModal();
    if (cb) cb();
  });
  confirmModalOverlay.addEventListener("click", function (e) {
    if (e.target !== confirmModalOverlay) return;
    var cb = confirmModalOnCancel;
    closeConfirmModal();
    if (cb) cb();
  });
  document.addEventListener("keydown", function (e) {
    if (confirmModalOverlay.classList.contains("hidden")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      btnConfirmModalOk.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      (btnConfirmModalCancel.classList.contains("hidden") ? btnConfirmModalOk : btnConfirmModalCancel).click();
    }
  });

  // ---------------------------------------------------------------------
  // Paywall scaffolding — native-only (see IS_NATIVE above). Gates a
  // feature behind either a real (StoreKit Testing, for now) purchase or
  // a fake rewarded-ad view, so the purchase/restore/ad mechanics can be
  // tested end to end before any real pricing/feature decisions are made.
  // ---------------------------------------------------------------------

  var proPriceDisplay = null;
  var paywallPendingCallback = null;

  // Gate a feature behind Pro: runs onUnlocked immediately when there's
  // nothing to gate (web) or it's already unlocked (purchased, restored,
  // or this session's one fake-ad view already redeemed); otherwise shows
  // the paywall and holds onUnlocked until the user unlocks one way or
  // another (or just cancels, in which case nothing runs).
  function requireProOrShowPaywall(onUnlocked) {
    if (!IS_NATIVE || proUnlocked || adUnlockedThisSession) {
      onUnlocked();
      return;
    }
    openPaywallModal(onUnlocked);
  }

  function openPaywallModal(onUnlocked) {
    paywallPendingCallback = onUnlocked;
    btnPaywallUnlock.textContent = T("paywall.unlockButton", { price: proPriceDisplay || "…" });
    paywallModalOverlay.classList.remove("hidden");
  }

  function closePaywallModal() {
    paywallModalOverlay.classList.add("hidden");
  }

  function runPaywallPendingCallback() {
    var cb = paywallPendingCallback;
    paywallPendingCallback = null;
    if (cb) cb();
  }

  btnPaywallUnlock.addEventListener("click", function () {
    if (!Purchases) return;
    Purchases.purchasePro()
      .then(function (result) {
        if (result && result.unlocked) {
          proUnlocked = true;
          closePaywallModal();
          showToast(T("paywall.unlockedToast"));
          runPaywallPendingCallback();
        }
        // Cancelled/pending: leave the paywall open so the user can pick
        // a different option instead of silently doing nothing.
      })
      .catch(function () {
        showToast(T("paywall.purchaseFailed"));
      });
  });

  btnPaywallRestore.addEventListener("click", function () {
    if (!Purchases) return;
    Purchases.restorePurchases()
      .then(function (result) {
        if (result && result.unlocked) {
          proUnlocked = true;
          closePaywallModal();
          showToast(T("paywall.unlockedToast"));
          runPaywallPendingCallback();
        } else {
          showToast(T("paywall.purchaseFailed"));
        }
      })
      .catch(function () {
        showToast(T("paywall.purchaseFailed"));
      });
  });

  btnPaywallWatchAd.addEventListener("click", function () {
    closePaywallModal();
    playFakeRewardedAd(function () {
      adUnlockedThisSession = true;
      runPaywallPendingCallback();
    });
  });

  btnPaywallCancel.addEventListener("click", function () {
    paywallPendingCallback = null;
    closePaywallModal();
  });

  paywallModalOverlay.addEventListener("click", function (e) {
    if (e.target !== paywallModalOverlay) return;
    paywallPendingCallback = null;
    closePaywallModal();
  });

  // A scripted "ad" with no real ad network involved - a countdown, then
  // a completion message, then onDone. Standing in for a real rewarded-ad
  // SDK (choosing one, App Tracking Transparency, privacy manifest
  // updates) until that's a separate, deliberate decision.
  function playFakeRewardedAd(onDone) {
    fakeAdModalMessage.textContent = T("paywall.adPlaying");
    fakeAdModalOverlay.classList.remove("hidden");
    var remaining = 3;
    var tick = function () {
      if (remaining <= 0) {
        fakeAdModalMessage.textContent = T("paywall.adCompleteToast");
        setTimeout(function () {
          fakeAdModalOverlay.classList.add("hidden");
          onDone();
        }, 900);
        return;
      }
      fakeAdModalMessage.textContent = T("paywall.adPlaying") + " " + remaining + "…";
      remaining -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function isTypingIntoField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function isAnyOverlayOpen() {
    return [
      helpOverlay,
      wizardOverlay,
      onboardingOverlay,
      milestoneOverlay,
      gamewinOverlay,
      forceResetOverlay,
      onHillOverlay,
      gameChangeOverlay,
      saveSessionOverlay,
      ratingEditOverlay,
      confirmModalOverlay,
      playerConflictOverlay
    ].some(function (el) {
      return el && !el.classList.contains("hidden");
    });
  }

  // Lets a keyboard (or a numeric keypad) drive scoring without touching
  // the screen: a digit 1-9 selects (and highlights) the Nth currently-
  // playing player's card, top to bottom - individual panels and team
  // member cards numbered in one shared sequence; +/- then adjusts that
  // selected player's score exactly as tapping their own +/- buttons
  // would (same adjustScore call, so wins, team mode, and Quick Counter
  // all just work as normal). Selection persists across repeated +/-
  // presses until a different digit is pressed, Escape is pressed, the
  // selected player stops playing, or the scoreboard isn't the visible
  // screen (an overlay is open, a text field has focus, or a different
  // page like Tournament/All Players/Player Stats is showing).
  function handleKeypadShortcut(e) {
    if (isTypingIntoField(document.activeElement)) return;
    if (isAnyOverlayOpen()) return;
    if (appRoot.classList.contains("hidden")) return;

    if (e.key === "Escape") {
      if (keypadSelectedPlayerId) {
        keypadSelectedPlayerId = null;
        renderScoreboard();
      }
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      var keypadNum = parseInt(e.key, 10);
      var targetId = keypadOrderedPlayerIds[keypadNum - 1];
      if (!targetId) return;
      e.preventDefault();
      // "The counter should stop when we select the next player" - an
      // explicit keypad switch away from whoever's on a run stops it
      // right here, even before the newly-selected player has scored
      // anything yet (bumpRunForPlayer would only catch it once they do).
      if (runTrackingApplies() && currentRunPlayerId && currentRunPlayerId !== targetId) {
        resetCurrentRun();
      }
      keypadSelectedPlayerId = targetId;
      renderScoreboard();
      // Only during an actual points/ball game - Quick Counter is a
      // plain running tally with no target/win to track, so there's no
      // "who am I scoring for right now" state this cue needs to confirm.
      if (!quickCounterMode) {
        var switchedTo = getPlayer(targetId);
        if (switchedTo) playPlayerSwitchSound(switchedTo.voice, keypadNum);
      }
      // Focus Mode's across-the-room card sizes mean a big roster (team
      // play especially) can run well past one screen - the shortcut
      // just picked a specific player's card by number, not necessarily
      // one already in view, so jump to the bottom of the page to bring
      // whichever card that was into view instead of leaving whoever
      // used the shortcut staring at wherever they happened to be
      // scrolled to.
      if (appRoot.classList.contains("focus-mode")) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
      return;
    }

    if (e.key === "+" || e.key === "-") {
      if (!keypadSelectedPlayerId) return;
      var stillActive = activePlayers().some(function (p) {
        return p.id === keypadSelectedPlayerId;
      });
      if (!stillActive) {
        keypadSelectedPlayerId = null;
        return;
      }
      e.preventDefault();
      var isSingleRackGame = !quickCounterMode && state.currentGame.unit === "rack" && state.currentGame.target === 1;
      if (e.key === "-" && isSingleRackGame) {
        undoLastWin(keypadSelectedPlayerId);
      } else {
        adjustScore(keypadSelectedPlayerId, e.key === "+" ? 1 : -1);
      }
      return;
    }

    // Shot counter: "/" toggles pause/unpause, "*" toggles hide/show, the
    // numeric keypad's dedicated Clear key zeroes it. Only live when
    // there's actually a counter running (see shotCounterActive), so
    // these keys are inert the rest of the time.
    if (shotCounterActive() && (e.key === "/" || e.key === "*" || e.key === "Clear")) {
      e.preventDefault();
      if (e.key === "/") {
        toggleShotCounterPause();
        return;
      } else if (e.key === "*") {
        toggleShotCounterVisibility();
        return;
      } else if (e.key === "Clear") {
        shotCounterAccumulatedMs = 0;
        shotCounterLastBeepMs = 0;
        shotCounterLastTickCountdown = null;
        // While running, elapsed is entirely (now - runningSince) - has
        // to move that reference point up to now too, or a Clear during
        // an unbroken run (the common case: never paused) would do
        // nothing, since accumulatedMs was already 0.
        if (shotCounterRunningSince) shotCounterRunningSince = Date.now();
      }
      tickShotCounter();
    }
  }

  document.addEventListener("keydown", handleKeypadShortcut);

  // Enter/Escape for every other overlay in the app (the generic
  // confirm/alert/prompt modal already handles its own, right above -
  // this skips whenever that one's open so it's never double-handled).
  // Each entry is [overlay, primaryButton, cancelButton] - Enter clicks
  // the primary button, Escape clicks the cancel button (falling back to
  // the primary one for overlays that only have a single dismiss
  // button). The wizard is the one special case: it has its own text
  // inputs (add-player, etc.) with their own Enter-submits-the-form
  // behavior, which must win over advancing the wizard step.
  var OVERLAY_KEY_TARGETS = [
    [saveSessionOverlay, btnSaveSessionSave, btnSaveSessionCancel],
    [ratingEditOverlay, btnRatingEditSave, btnRatingEditCancel],
    [removedPlayersOverlay, btnRemovedPlayersContinue, btnRemovedPlayersContinue],
    [recoverDetailOverlay, btnRecoverRestore, btnRecoverCancel],
    [onboardingOverlay, btnOnboardingGo, btnOnboardingCancel],
    [milestoneOverlay, btnMilestoneClose, btnMilestoneClose],
    [gamewinOverlay, btnGamewinClose, btnGamewinClose],
    [forceResetOverlay, btnForceResetClose, btnForceResetClose],
    [onHillOverlay, btnOnHillClose, btnOnHillClose],
    [gameChangeOverlay, btnGameChangeClose, btnGameChangeClose],
    [helpOverlay, btnHelpClose, btnHelpClose]
  ];

  function handleOverlayEnterEscape(e) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    if (confirmModalOverlay && !confirmModalOverlay.classList.contains("hidden")) return;

    if (!wizardOverlay.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        btnWizardClose.click();
        return;
      }
      if (isTypingIntoField(document.activeElement)) return;
      e.preventDefault();
      (btnWizardStart.classList.contains("hidden") ? btnWizardNext : btnWizardStart).click();
      return;
    }

    for (var i = 0; i < OVERLAY_KEY_TARGETS.length; i++) {
      var overlay = OVERLAY_KEY_TARGETS[i][0];
      if (!overlay || overlay.classList.contains("hidden")) continue;
      e.preventDefault();
      (e.key === "Enter" ? OVERLAY_KEY_TARGETS[i][1] : OVERLAY_KEY_TARGETS[i][2]).click();
      return;
    }
  }

  document.addEventListener("keydown", handleOverlayEnterEscape);

  function populateGameTypeSelects() {
    [gameTypeSelect, rotationAddType, tournamentGameTypeSelect, wizardGameTypeSelect, wizardRotationAddType].forEach(function (select) {
      select.innerHTML = "";
      GAME_TYPE_LIST.forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.label;
        select.appendChild(opt);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Focus mode (hide settings/statistics panels, show only the scoreboard)
  // ---------------------------------------------------------------------

  var FOCUS_MODE_KEY = "poolMasterCounter.focusMode";

  function setFocusMode(on) {
    appRoot.classList.toggle("focus-mode", on);
    btnToggleFocus.textContent = T(on ? "scoreboard.showAll" : "scoreboard.focusMode");
    try {
      localStorage.setItem(FOCUS_MODE_KEY, on ? "1" : "0");
    } catch (e) {
      console.warn("Could not save focus mode preference.", e);
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderAll() {
    renderRoster();
    renderScoreboard();
    renderHistory();
    renderStandings();
    renderRotation();
    renderWizardIfOpen();
    updateDayNotesSummary();
    updateRunRecordsSummary();
    updateDayReportRecipientsLine();
    renderRecoverDataList();
    renderReportArchiveList();
  }

  // A rotation entry is { gameType, target, unit } — its own rule, not
  // just a game type — so the same game type can appear more than once in
  // an order with different rules (e.g. "8-Ball — 1 rack" and "8-Ball — 3
  // racks" as distinct steps).
  function rotationEntryLabel(entry) {
    var type = GAME_TYPES[entry.gameType];
    var label = type ? type.label : entry.gameType;
    var rawUnit = entry.unit || (type ? type.unit : "rack");
    var unit = rawUnit === "rack" && entry.target !== 1 ? T("units.racks") : unitLabel(rawUnit);
    return label + " — " + entry.target + " " + unit;
  }

  // Normalizes one rotation-order entry to the { gameType, target, unit }
  // shape, filling in a game type's defaults for anything missing —
  // handles both brand-new entries and legacy ones saved as a bare game
  // type string before per-entry rules existed. Requires GAME_TYPES to
  // already be populated.
  function normalizeRotationEntry(entry) {
    var gameType = typeof entry === "string" ? entry : entry && entry.gameType;
    if (!gameType) return null;
    var type = GAME_TYPES[gameType];
    var target = entry && typeof entry === "object" && typeof entry.target === "number" && entry.target > 0
      ? entry.target
      : type ? type.defaultTarget : 1;
    var unit = entry && typeof entry === "object" && typeof entry.unit === "string" && entry.unit
      ? entry.unit
      : type ? type.unit : "rack";
    return { gameType: gameType, target: target, unit: unit };
  }

  // Fills in state.currentGame.unit and normalizes every rotation entry
  // (live and saved) into the { gameType, target, unit } shape. Runs once
  // at boot, after GAME_TYPES is loaded — rotation entries can't be
  // normalized any earlier since GAME_TYPES isn't populated yet when
  // loadState() runs.
  function normalizeGameTypeDependentData() {
    if (!state.currentGame.unit) {
      var currentType = GAME_TYPES[state.currentGame.gameType];
      state.currentGame.unit = currentType ? currentType.unit : "rack";
    }
    state.rotation.order = state.rotation.order.map(normalizeRotationEntry).filter(Boolean);
    saveState();

    var rostersChanged = false;
    SAVED_ROTATIONS.forEach(function (r) {
      if ((r.order || []).some(function (e) { return typeof e === "string"; })) rostersChanged = true;
      r.order = (r.order || []).map(normalizeRotationEntry).filter(Boolean);
    });
    if (rostersChanged) saveRotationsToStorage(SAVED_ROTATIONS);
  }

  // Builds one rotation-order <li> (position, game type, editable target +
  // unit, up/down/remove controls). Shared by the main Games Rotations panel
  // and the wizard's rotation step so both stay visually and behaviorally
  // identical. The target/unit are edited in place instead of needing to
  // remove and re-add the entry to change its goal.
  function buildRotationRow(entry, i, total) {
    var li = document.createElement("li");
    li.className = "rotation-row";

    var pos = document.createElement("span");
    pos.className = "rotation-position";
    pos.textContent = i + 1 + ".";

    var type = GAME_TYPES[entry.gameType];
    var name = document.createElement("span");
    name.className = "rotation-name";
    name.textContent = type ? type.label : entry.gameType;

    var targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.className = "rotation-target-input";
    targetInput.min = "1";
    targetInput.max = "500";
    targetInput.value = entry.target;
    targetInput.setAttribute("aria-label", "Target for " + name.textContent);
    targetInput.addEventListener("change", function () {
      var val = parseInt(targetInput.value, 10);
      if (val > 0) updateRotationItem(i, { target: val });
      else targetInput.value = entry.target;
    });

    var unitSelect = document.createElement("select");
    unitSelect.className = "rotation-unit-select";
    unitSelect.setAttribute("aria-label", "Unit for " + name.textContent);
    ["rack", "balls", "points"].forEach(function (u) {
      var opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      unitSelect.appendChild(opt);
    });
    unitSelect.value = entry.unit;
    unitSelect.addEventListener("change", function () {
      updateRotationItem(i, { unit: unitSelect.value });
    });

    var controls = document.createElement("div");
    controls.className = "rotation-controls";

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", function () {
      moveRotationItem(i, -1);
    });

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = i === total - 1;
    downBtn.addEventListener("click", function () {
      moveRotationItem(i, 1);
    });

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "Remove from rotation");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", function () {
      removeRotationItem(i);
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(removeBtn);

    li.appendChild(pos);
    li.appendChild(name);
    li.appendChild(targetInput);
    li.appendChild(unitSelect);
    li.appendChild(controls);
    return li;
  }

  function renderRotationListInto(listEl) {
    listEl.innerHTML = "";
    if (state.rotation.order.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("rotation.noGameTypesYet");
      listEl.appendChild(hint);
      return;
    }
    state.rotation.order.forEach(function (entry, i) {
      listEl.appendChild(buildRotationRow(entry, i, state.rotation.order.length));
    });
  }

  function renderRotation() {
    rotationEnabledCheckbox.checked = state.rotation.enabled;
    rotationEveryInput.value = state.rotation.every;

    renderRotationListInto(rotationList);

    rotationStatus.classList.remove("is-warning");
    var info = rotationStatusInfo();
    if (info) {
      rotationStatus.innerHTML = "";
      rotationStatus.appendChild(document.createTextNode(T("rotation.statusNowLabel")));
      var nowStrong = document.createElement("strong");
      nowStrong.textContent = info.currentLabel;
      rotationStatus.appendChild(nowStrong);
      rotationStatus.appendChild(
        document.createTextNode(
          T(info.untilSwitch === 1 ? "rotation.statusSwitchesInOne" : "rotation.statusSwitchesInMany", {
            next: info.nextLabel,
            count: info.untilSwitch
          })
        )
      );
    } else if (state.rotation.enabled && state.rotation.order.length === 1) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = T("rotation.warningOneType");
    } else if (state.rotation.enabled) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = T("rotation.warningEmpty");
    } else {
      rotationStatus.textContent = "";
    }

    setPanelSummary("rotation-panel", computeRotationSummary());
  }

  function computeRotationSummary() {
    if (!state.rotation.enabled) {
      var currentType = GAME_TYPES[state.currentGame.gameType];
      return T("rotation.summaryOff", { game: currentType ? currentType.label : state.currentGame.gameType });
    }
    if (state.rotation.order.length < 2) {
      return T("rotation.summaryNotSetUp");
    }
    return T(state.rotation.every === 1 ? "rotation.summaryRotatingOne" : "rotation.summaryRotatingMany", {
      label: rotationLabelFor(state.rotation.order),
      count: state.rotation.every
    });
  }

  function addRotationItem(gameType, target, unit) {
    var type = GAME_TYPES[gameType];
    state.rotation.order.push({
      gameType: gameType,
      target: target > 0 ? target : (type ? type.defaultTarget : 1),
      unit: unit || (type ? type.unit : "rack")
    });
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function removeRotationItem(index) {
    state.rotation.order.splice(index, 1);
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function moveRotationItem(index, delta) {
    var newIndex = index + delta;
    if (newIndex < 0 || newIndex >= state.rotation.order.length) return;
    var arr = state.rotation.order;
    var tmp = arr[index];
    arr[index] = arr[newIndex];
    arr[newIndex] = tmp;
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  // Edits an existing rotation entry's target and/or unit in place — the
  // list-row equivalent of addRotationItem, so changing a game's goal
  // doesn't require removing and re-adding it.
  function updateRotationItem(index, changes) {
    var entry = state.rotation.order[index];
    if (!entry) return;
    if (typeof changes.target === "number") entry.target = changes.target;
    if (typeof changes.unit === "string") entry.unit = changes.unit;
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function syncGameTypeUI() {
    gameTypeSelect.value = state.currentGame.gameType;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnitSelect.value = state.currentGame.unit;
    updateCurrentGameSummary();
  }

  function updateCurrentGameSummary() {
    var type = GAME_TYPES[state.currentGame.gameType];
    var modeLabel = state.currentGame.mode === "teams" ? T("gameSetup.teams") : T("gameSetup.individual");
    setPanelSummary(
      "game-setup-panel",
      T("gameSetup.summaryLine", {
        game: type ? type.label : state.currentGame.gameType,
        target: state.currentGame.target,
        unit: unitLabel(state.currentGame.unit),
        mode: modeLabel,
        raceTo: state.raceToWinsTarget
      })
    );
  }

  // The rotation's current step is purely a function of how many games
  // have been played: floor(gamesPlayedCount / every), wrapped to the
  // order's length. moveRotationPosition (the ◀/▶ control) hand-drives
  // that same counter one game at a time - it doesn't jump straight to
  // a different game type, it just ticks gamesPlayedCount by ±1, same
  // as a real win/undo would, and lets this formula do what it already
  // does. So within a leg, a click or two just moves the countdown
  // toward the next switch; only crossing an `every` boundary actually
  // changes the active game type.
  function rotationCurrentIndex() {
    var len = state.rotation.order.length;
    if (len === 0) return 0;
    var every = Math.max(1, state.rotation.every || 1);
    return Math.floor(state.gamesPlayedCount / every) % len;
  }

  function rotationStatusInfo() {
    if (!(state.rotation.enabled && state.rotation.order.length >= 2)) return null;
    var every = Math.max(1, state.rotation.every || 1);
    var playedInLeg = state.gamesPlayedCount % every;
    var untilSwitch = every - playedInLeg;
    var currentIndex = rotationCurrentIndex();
    var nextIndex = (currentIndex + 1) % state.rotation.order.length;
    return {
      currentLabel: rotationEntryLabel(state.rotation.order[currentIndex]),
      nextLabel: rotationEntryLabel(state.rotation.order[nextIndex]),
      playedInLeg: playedInLeg,
      every: every,
      untilSwitch: untilSwitch
    };
  }

  function applyRotationIfDue() {
    if (!state.rotation.enabled || state.rotation.order.length === 0) return;
    var entry = state.rotation.order[rotationCurrentIndex()];
    if (GAME_TYPES[entry.gameType] && (entry.gameType !== state.currentGame.gameType || entry.target !== state.currentGame.target || entry.unit !== state.currentGame.unit)) {
      state.currentGame.gameType = entry.gameType;
      state.currentGame.target = entry.target;
      state.currentGame.unit = entry.unit;
      syncGameTypeUI();
    }
  }

  // The ◀/▶ control: hand-drives gamesPlayedCount by ±1, exactly as if
  // one more (or one fewer) game had been played toward the rotation's
  // switch-every countdown - no win/loss is credited to anyone, no
  // score changes, only the rotation's own counter moves. Reuses
  // applyRotationIfDue so a click that crosses an `every` boundary
  // switches the active game type immediately, same as a real win
  // would.
  function moveRotationPosition(direction) {
    if (!state.rotation.enabled || state.rotation.order.length < 2) return;
    state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount + direction);
    applyRotationIfDue();
    saveState();
    renderAll();
  }

  function buildStandingsRow(name, wins, memberNames, key) {
    var target = effectiveRaceTarget(key);
    var reached = wins >= target;
    var li = document.createElement("li");
    li.className = "standings-row" + (reached ? " is-reached" : "");

    var top = document.createElement("div");
    top.className = "standings-row-top";
    var nameEl = document.createElement("span");
    nameEl.className = "standings-name";
    nameEl.textContent = name;
    (memberNames || []).forEach(function (n) {
      nameEl.appendChild(buildRatingBadge(n));
      nameEl.appendChild(buildPlayerLinkIcon(n));
      var member = state.players.filter(function (p) {
        return p.name === n;
      })[0];
      if (member) {
        var status = document.createElement("span");
        status.className = "standings-status" + (member.playing ? " is-playing" : "");
        status.textContent = T(member.playing ? "players.playing" : "players.standby");
        nameEl.appendChild(status);
      }
    });
    var countEl = document.createElement("span");
    countEl.className = "standings-count";
    countEl.textContent = wins + " / " + target + (reached ? " 🏁" : "");
    top.appendChild(nameEl);
    top.appendChild(countEl);
    li.appendChild(top);

    var track = document.createElement("div");
    track.className = "standings-bar-track";
    var fill = document.createElement("div");
    fill.className = "standings-bar-fill";
    fill.style.width = Math.min(100, (wins / target) * 100) + "%";
    track.appendChild(fill);
    li.appendChild(track);

    return li;
  }

  function renderStandings() {
    // The team section only makes sense in Teams mode - a player keeps
    // their teamId after switching back to Individual (nothing clears it,
    // since a later switch back to Teams should remember it), so without
    // this gate teamMembersLive() would keep surfacing them under "Team
    // A"/"Team B" even while actually playing individually.
    var isTeamsMode = state.currentGame.mode === "teams";
    standingsTitle.classList.toggle("hidden", !isTeamsMode);
    teamStandingsList.classList.toggle("hidden", !isTeamsMode);

    if (isTeamsMode) {
      standingsTitle.textContent = T("standings.raceToTeams", { target: state.raceToWinsTarget });

      // Teams are tracked per slot ("A"/"B"), not per exact roster combo, so
      // this always shows exactly the two live team slots - a sub joining or
      // leaving mid-race just relabels the row, it doesn't spawn a new one.
      var teamRows = ["A", "B"].filter(function (teamId) {
        return (state.teamWins[teamId] || 0) > 0 || teamMembersLive(teamId).length > 0;
      });

      teamStandingsList.innerHTML = "";
      if (teamRows.length === 0) {
        var teamHint = document.createElement("li");
        teamHint.className = "empty-hint";
        teamHint.textContent = T("standings.noTeamPairings");
        teamStandingsList.appendChild(teamHint);
      } else {
        teamRows
          .map(function (teamId) {
            var namesList = teamMembersLive(teamId).map(function (p) {
              return p.name;
            });
            var names = namesList.length ? namesList.join(" & ") : T(teamId === "A" ? "gameSetup.teamA" : "gameSetup.teamB");
            return { teamId: teamId, names: names, namesList: namesList, wins: state.teamWins[teamId] || 0 };
          })
          .sort(function (a, b) {
            return b.wins - a.wins || a.teamId.localeCompare(b.teamId);
          })
          .forEach(function (row) {
            teamStandingsList.appendChild(buildStandingsRow(row.names, row.wins, row.namesList, row.teamId));
          });
      }
    }

    playerStandingsList.innerHTML = "";
    if (state.players.length === 0) {
      var playerHint = document.createElement("li");
      playerHint.className = "empty-hint";
      playerHint.textContent = T("standings.noPlayersYet");
      playerStandingsList.appendChild(playerHint);
    } else {
      state.players
        .slice()
        .sort(function (a, b) {
          return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
        })
        .forEach(function (p) {
          playerStandingsList.appendChild(buildStandingsRow(p.name, state.playerWins[p.id] || 0, [p.name], p.id));
        });
    }

    setPanelSummary("standings-panel", computeStandingsSummary());
  }

  function computeStandingsSummary() {
    if (state.players.length === 0) return T("standings.noPlayersYet");
    var sorted = state.players.slice().sort(function (a, b) {
      return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
    });
    var leader = sorted[0];
    var leaderWins = state.playerWins[leader.id] || 0;
    if (leaderWins === 0) return T("standings.noGamesWonYet");
    return T(leaderWins === 1 ? "standings.leaderSummaryOne" : "standings.leaderSummaryMany", {
      name: leader.name,
      wins: leaderWins,
      target: effectiveRaceTarget(leader.id)
    });
  }

  function computePlayersSummary() {
    if (state.players.length === 0) return T("players.noPlayersYetSummary");
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    var names = state.players
      .map(function (p) {
        return p.name;
      })
      .join(", ");
    return T(state.players.length === 1 ? "players.summaryOne" : "players.summaryMany", {
      count: state.players.length,
      playing: playingCount,
      names: names
    });
  }

  // Above ~20 games per leg, individual nodes stop being useful (too
  // cramped to read) - the track falls back to a plain proportional fill
  // instead of one node per game.
  var ROTATION_TRACK_MAX_NODES = 20;

  // A little dot-and-line track between the ◀/▶ buttons: one node per
  // game in the current leg, with the game just played (playedInLeg)
  // shown as a bigger, accent-colored node so a glance shows exactly
  // where the countdown to the next switch stands.
  function renderRotationPositionTrack(info) {
    rotationPositionTrack.innerHTML = "";
    if (info.every > ROTATION_TRACK_MAX_NODES) {
      var fill = document.createElement("div");
      fill.className = "rotation-position-fill-track";
      var bar = document.createElement("div");
      bar.className = "rotation-position-fill-bar";
      bar.style.width = (info.playedInLeg / info.every) * 100 + "%";
      fill.appendChild(bar);
      rotationPositionTrack.appendChild(fill);
      return;
    }
    for (var i = 0; i < info.every; i++) {
      if (i > 0) {
        var connector = document.createElement("span");
        connector.className = "rotation-position-connector";
        rotationPositionTrack.appendChild(connector);
      }
      var node = document.createElement("span");
      node.className = "rotation-position-node" + (i === info.playedInLeg ? " is-current" : "");
      rotationPositionTrack.appendChild(node);
    }
  }

  // Shows the current rotation step (with ◀/▶ hand-correction buttons)
  // right under the "Now Playing" banner - see moveRotationPosition.
  // Hidden whenever rotation isn't actually running (off, or fewer
  // than 2 game types to rotate through).
  function renderRotationPositionControl() {
    var info = rotationStatusInfo();
    rotationPositionRow.classList.toggle("hidden", !info);
    if (!info) return;
    renderRotationPositionTrack(info);
    rotationPositionText.textContent = T("players.rotationPosition", {
      label: info.currentLabel,
      played: info.playedInLeg,
      every: info.every
    });
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("players.addToGetStarted");
      rosterList.appendChild(hint);
      setPanelSummary("players-panel", computePlayersSummary());
      renderPlayingToggleListInto(focusPlayersList, T("players.noPlayersYetPanel"));
      focusPlayersSummary.textContent = T("players.heading");
      renderQueueList();
      return;
    }
    var showTeamToggle = state.currentGame.mode === "teams";

    state.players.forEach(function (p) {
      var row = document.createElement("li");
      row.className = "roster-row" + (p.playing ? " is-playing" : "");

      var name = document.createElement("span");
      name.className = "roster-name";
      buildPlayerNameLabel(name, p.name, false);
      row.appendChild(name);
      row.appendChild(buildRatingBadge(p.name));

      var editRatingBtn = document.createElement("button");
      editRatingBtn.type = "button";
      editRatingBtn.className = "roster-edit-rating-btn";
      editRatingBtn.setAttribute("aria-label", T("common.editRatingFor", { name: p.name }));
      editRatingBtn.textContent = "✏️";
      editRatingBtn.addEventListener("click", function () {
        openRatingEditPopup(p.name);
      });
      row.appendChild(editRatingBtn);

      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
      playBtn.textContent = T(p.playing ? "players.playing" : "players.standby");
      playBtn.addEventListener("click", function () {
        togglePlaying(p.id);
      });
      row.appendChild(playBtn);

      if (showTeamToggle && p.playing) {
        var toggle = document.createElement("div");
        toggle.className = "team-toggle";
        ["A", "B"].forEach(function (teamId) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = teamId;
          if (p.teamId === teamId) btn.classList.add("is-selected");
          btn.addEventListener("click", function () {
            setPlayerTeam(p.id, teamId);
          });
          toggle.appendChild(btn);
        });
        row.appendChild(toggle);
      }

      var statsBtn = document.createElement("button");
      statsBtn.type = "button";
      statsBtn.className = "roster-stats-btn";
      statsBtn.setAttribute("aria-label", "View stats for " + p.name);
      statsBtn.textContent = "📊";
      statsBtn.addEventListener("click", function () {
        openPlayerStatsPage(p.name);
      });
      row.appendChild(statsBtn);

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "roster-remove";
      removeBtn.setAttribute("aria-label", "Remove " + p.name);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      row.appendChild(removeBtn);

      rosterList.appendChild(row);
    });

    setPanelSummary("players-panel", computePlayersSummary());
    renderPlayingToggleListInto(focusPlayersList, T("players.noPlayersYetPanel"));
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    focusPlayersSummary.textContent = T("players.playingOfTotal", { playing: playingCount, total: state.players.length });
    renderQueueList();
  }

  function buildFlagSpan() {
    var flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = "🏁";
    return flag;
  }

  function buildStatMini(label, value, milestoneReached, extraClass) {
    var el = document.createElement("div");
    el.className = "stat-mini" + (extraClass ? " " + extraClass : "");
    var strong = document.createElement("strong");
    strong.textContent = value;
    el.appendChild(document.createTextNode(label + ": "));
    el.appendChild(strong);
    if (milestoneReached) el.appendChild(buildFlagSpan());
    return el;
  }

  // Only worth showing once fair race is on, since that's the only
  // time this side's own target can actually differ from the plain
  // "Race-to milestone" setting everyone already sees summarized
  // elsewhere.
  function buildFairRaceNote(target) {
    var el = document.createElement("div");
    el.className = "fair-race-note";
    el.textContent = T("scoreboard.fairRaceTarget", { target: target });
    return el;
  }

  // undoOnMinus: single-rack games (see isSingleRackGame) show the
  // session win count as the "running score" instead of an in-progress
  // ball count, so there's nothing for "-" to decrement there - it undoes
  // this player's last win instead (only enabled when they're actually
  // part of the most recent recorded game, so it can't fire against the
  // wrong player's win by mistake).
  function buildBallControls(player, disabled, undoOnMinus) {
    var controls = document.createElement("div");
    controls.className = "ball-controls";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    if (undoOnMinus) {
      minusBtn.setAttribute("aria-label", "Undo last win for " + player.name);
      var lastGame = state.gameHistory[0];
      var canUndo = !!(lastGame && typeof lastGame !== "string" && lastGame.winnerIds && lastGame.winnerIds.indexOf(player.id) !== -1);
      minusBtn.disabled = disabled || !canUndo;
      minusBtn.addEventListener("click", function () {
        undoLastWin(player.id);
      });
    } else {
      minusBtn.setAttribute("aria-label", "Remove point for " + player.name);
      var minusAllowNegative = quickCounterMode || state.currentGame.unit !== "rack";
      minusBtn.disabled = disabled || (!minusAllowNegative && (player.balls || 0) <= 0);
      minusBtn.addEventListener("click", function () {
        adjustScore(player.id, -1);
      });
    }

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + player.name);
    plusBtn.disabled = disabled;
    plusBtn.addEventListener("click", function () {
      adjustScore(player.id, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    return controls;
  }

  // Commits an inline rename from a Quick Counter name field. Routes
  // through the same resolvePlayerName/duplicate-check path as adding a
  // player normally, so casing and uniqueness rules stay identical.
  function renamePlayerInline(id, newName) {
    var player = getPlayer(id);
    if (!player) return;
    var resolved = resolvePlayerName(newName);
    if (!resolved || resolved === player.name) {
      renderAll();
      return;
    }
    if (normalizeNameKey(resolved) !== normalizeNameKey(player.name) && isDuplicatePlayerName(resolved)) {
      showToast(T("toast.alreadyInRoster", { name: resolved }));
      renderAll();
      return;
    }
    player.name = resolved;
    saveState();
    renderAll();
  }

  // Quick Counter's version of a player card: editable name, a plain
  // running tally (no target, no win detection — see adjustScore), and a
  // dedicated remove-this-player control distinct from the −/+ tally
  // buttons. Reuses buildBallControls since adjustScore already branches
  // on quickCounterMode.
  function buildQuickCounterPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel quick-counter-panel";

    var nameRow = document.createElement("div");
    nameRow.className = "quick-counter-name-row";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "quick-counter-name-input";
    nameInput.value = player.name;
    nameInput.autocomplete = "off";
    nameInput.setAttribute("aria-label", "Rename " + player.name);
    nameInput.addEventListener("change", function () {
      renamePlayerInline(player.id, nameInput.value);
    });
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
    });
    nameRow.appendChild(nameInput);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "quick-counter-remove-player";
    removeBtn.textContent = "−";
    removeBtn.setAttribute("aria-label", "Remove " + player.name);
    removeBtn.addEventListener("click", function () {
      removePlayer(player.id);
    });
    nameRow.appendChild(removeBtn);

    panel.appendChild(nameRow);

    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = player.balls || 0;
    panel.appendChild(value);

    panel.appendChild(buildBallControls(player, false));
    markAsKeypadTarget(panel, player);

    return panel;
  }

  // The "+" side of Quick Counter: a name field plus an Add button, always
  // rendered at the end of the scoreboard grid so a new player can be
  // dropped in without leaving the focus view. Added players start
  // "Playing" immediately — there's no separate roster panel in this mode.
  function buildQuickCounterAddRow() {
    var row = document.createElement("div");
    row.className = "quick-counter-add-row";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "quick-counter-add-input";
    input.placeholder = T("players.namePlaceholder");
    input.autocomplete = "off";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary quick-counter-add-btn";
    btn.textContent = T("players.addPlayerBtn");

    function submit() {
      var name = input.value.trim();
      if (!name) return;
      // A name that matches someone already on standby (e.g. dropped by a
      // list load) reactivates them instead of being rejected as a
      // duplicate — otherwise there'd be no way to bring them back from
      // this minimal view.
      var key = normalizeNameKey(resolvePlayerName(name));
      var existing = state.players.filter(function (p) {
        return normalizeNameKey(p.name) === key;
      })[0];
      if (existing) {
        if (existing.playing) {
          showToast(T("toast.alreadyInRoster", { name: existing.name }));
          return;
        }
        existing.playing = true;
        saveState();
        renderAll();
        return;
      }
      var player = addPlayer(name);
      if (!player) return;
      player.playing = true;
      saveState();
      renderAll();
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  // Quick Counter's "Load Player List": picks a saved list and makes the
  // active set match it exactly (see loadPlayerListForQuickCounter) — the
  // fast way to swap in a known group instead of adding everyone by hand.
  // Always renders (disabled with an explanatory option when there's
  // nothing saved yet) rather than disappearing outright, so the control
  // doesn't look missing — mirrors the main page's roster-load row.
  function buildQuickCounterLoadRow() {
    var row = document.createElement("div");
    row.className = "quick-counter-load-row";

    var select = document.createElement("select");
    select.className = "quick-counter-load-select";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost quick-counter-load-btn";
    btn.textContent = T("players.loadPlayerListBtn");

    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      select.appendChild(opt);
      select.disabled = true;
      btn.disabled = true;
    } else {
      SAVED_ROSTERS.forEach(function (r, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = r.label;
        select.appendChild(o);
      });
      btn.addEventListener("click", function () {
        loadPlayerListForQuickCounter(select.value);
      });
    }

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn btn-ghost quick-counter-reset-btn";
    resetBtn.textContent = T("players.resetAllToZero");
    resetBtn.addEventListener("click", function () {
      resetGameBalls();
      saveState();
      renderAll();
    });

    row.appendChild(select);
    row.appendChild(btn);
    row.appendChild(resetBtn);
    return row;
  }

  // A little "🔥 N in a row" badge for whichever player currently has an
  // active run (see bumpRunForPlayer) - only during a balls/points game,
  // and only ever shown for the one player it's tracking right now.
  function buildRunStreakBadge(player) {
    if (!runTrackingApplies()) return null;
    if (currentRunPlayerId !== player.id || currentRunCount < 1) return null;
    var badge = document.createElement("div");
    badge.className = "run-streak-badge";
    badge.textContent = T("scoreboard.runStreak", { count: currentRunCount });
    return badge;
  }

  function buildIndividualPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var name = document.createElement("div");
    name.className = "player-name";
    buildPlayerNameLabel(name, player.name, false);
    name.appendChild(buildRatingBadge(player.name));
    name.appendChild(buildPlayerLinkIcon(player.name));
    panel.appendChild(name);

    var wins = state.playerWins[player.id] || 0;

    // A single-rack game (the common case - standard 8-Ball etc.) has no
    // meaningful "current rack progress" number to show (it's just 0
    // until the rack is won, then resets) - show the session win count
    // big and prominent instead. Anything else (multiple racks to win
    // one game, or a balls/points game) still shows the ball/point
    // count toward this game's target, with the win count as a small
    // badge above it.
    var isSingleRackGame = state.currentGame.unit === "rack" && state.currentGame.target === 1;

    if (!isSingleRackGame) {
      panel.appendChild(buildStatMini(T("scoreboard.tourneyWin"), wins, wins >= effectiveRaceTarget(player.id), "stat-mini-tourney"));
    }

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    var value = document.createElement("div");
    value.className = "stat-value";
    if (isSingleRackGame) {
      label.textContent = T("scoreboard.tourneyWin");
      value.textContent = wins;
      if (wins >= effectiveRaceTarget(player.id)) value.appendChild(buildFlagSpan());
    } else {
      label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[state.currentGame.gameType].label, target: state.currentGame.target });
      value.textContent = player.balls || 0;
    }
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    var runBadge = buildRunStreakBadge(player);
    if (runBadge) panel.appendChild(runBadge);

    if (state.fairRaceEnabled) panel.appendChild(buildFairRaceNote(effectiveRaceTarget(player.id)));

    panel.appendChild(buildBallControls(player, false, isSingleRackGame));
    markAsKeypadTarget(panel, player);

    return panel;
  }

  function buildMemberCard(player, disabled, undoOnMinus) {
    var card = document.createElement("div");
    card.className = "member-card";

    var name = document.createElement("div");
    name.className = "member-name";
    buildPlayerNameLabel(name, player.name, false);
    name.appendChild(buildPlayerLinkIcon(player.name));
    card.appendChild(name);

    // Not the team's win count (that's the team panel's own badge) - this
    // tracks how many times THIS member specifically potted the winning
    // ball for the team (see the mvp selection in creditWin).
    var mvpWins = state.teamMvpWins[player.id] || 0;
    card.appendChild(buildStatMini(T("scoreboard.tourneyWin"), mvpWins, mvpWins >= effectiveRaceTarget(player.teamId), "stat-mini-tourney"));

    var value = document.createElement("div");
    value.className = "stat-value small";
    value.textContent = player.balls || 0;
    card.appendChild(value);

    var runBadge = buildRunStreakBadge(player);
    if (runBadge) card.appendChild(runBadge);

    card.appendChild(buildBallControls(player, disabled, undoOnMinus));
    markAsKeypadTarget(card, player);

    return card;
  }

  // opponentEmpty: the other team ("A"/"B") currently has nobody on it -
  // a team can't play (or score) alone, so this shows a warning instead of
  // the usual win-progress stat and disables every member's +/- (the real
  // enforcement is adjustScore's own check; this is just the matching UI).
  function buildTeamPanel(teamId, members, opponentEmpty) {
    var panel = document.createElement("div");
    panel.className = "team-panel";

    var name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamLabelLive(teamId);
    panel.appendChild(name);

    if (opponentEmpty) {
      var warning = document.createElement("div");
      warning.className = "team-needs-opponent-warning";
      warning.textContent = T("scoreboard.teamNeedsOpponent");
      panel.appendChild(warning);
    }

    var wins = state.teamWins[teamId] || 0;

    // A single-rack game (the common case - standard 8-Ball etc.) has no
    // meaningful "current rack progress" number to show (it's just 0 until
    // the rack is won, then resets) - show the session win count big and
    // prominent instead. Anything else (multiple racks to win one game, or
    // a balls/points game) still shows the team's current-game total.
    var isSingleRackGame = state.currentGame.unit === "rack" && state.currentGame.target === 1;

    if (!isSingleRackGame) {
      panel.appendChild(buildStatMini(T("scoreboard.pairedSessionWin"), wins, wins >= effectiveRaceTarget(teamId)));
    }

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    var value = document.createElement("div");
    value.className = "stat-value";
    if (isSingleRackGame) {
      label.textContent = T("scoreboard.pairedSessionWinScore");
      value.textContent = wins;
      if (wins >= effectiveRaceTarget(teamId)) value.appendChild(buildFlagSpan());
    } else {
      label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[state.currentGame.gameType].label, target: state.currentGame.target });
      value.textContent = sumTeamBalls(teamId);
    }
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    if (state.fairRaceEnabled) panel.appendChild(buildFairRaceNote(effectiveRaceTarget(teamId)));

    var memberWrap = document.createElement("div");
    memberWrap.className = "team-members";
    members.forEach(function (p) {
      memberWrap.appendChild(buildMemberCard(p, opponentEmpty, isSingleRackGame));
    });
    panel.appendChild(memberWrap);

    return panel;
  }

  function renderNowPlayingBanner() {
    var type = GAME_TYPES[state.currentGame.gameType];
    nowPlayingBanner.innerHTML = "";
    nowPlayingBanner.appendChild(document.createTextNode(T("scoreboard.nowPlayingBanner", { label: type.label })));
    var note = document.createElement("span");
    note.className = "target-note";
    note.textContent = T("gameSetup.targetNote", { target: state.currentGame.target, unit: state.currentGame.unit });
    nowPlayingBanner.appendChild(note);

    var rotationInfo = rotationStatusInfo();
    if (rotationInfo) {
      var rotationNote = document.createElement("span");
      rotationNote.className = "rotation-note";
      rotationNote.textContent = T(rotationInfo.untilSwitch === 1 ? "rotation.statusSwitchesInOne" : "rotation.statusSwitchesInMany", {
        next: rotationInfo.nextLabel,
        count: rotationInfo.untilSwitch
      });
      nowPlayingBanner.appendChild(rotationNote);
    }
    renderRotationPositionControl();

    var duration = document.createElement("span");
    duration.className = "game-duration-live";
    duration.id = "game-duration-live";
    nowPlayingBanner.appendChild(duration);
    updateGameDurationDisplay();
  }

  function updateGameDurationDisplay() {
    var el = document.getElementById("game-duration-live");
    if (!el || !state.currentGame.startedAt) return;
    var startedAt = new Date(state.currentGame.startedAt).getTime();
    if (isNaN(startedAt)) return;
    el.textContent = T("scoreboard.durationLive", { time: formatDuration(Date.now() - startedAt) });
  }

  // Shot counter (see handleKeypadShortcut and the shotCounter* module
  // vars). Works for every unit (rack/balls/points) as long as the Game
  // Setup checkbox is on - Quick Counter has no notion of a game unit at
  // all, so it's excluded outright.
  function shotCounterActive() {
    return !quickCounterMode && !!state.currentGame.shotCounterEnabled;
  }

  function shotCounterElapsedMs() {
    return shotCounterAccumulatedMs + (shotCounterRunningSince ? Date.now() - shotCounterRunningSince : 0);
  }

  // Called when the Game Setup checkbox is checked (or a "balls" game
  // with it already checked is freshly set up), on boot to restore an
  // already-enabled counter, and on every new game/rack (see
  // resetGameBalls) - always resets to a clean, paused 0:00 rather than
  // auto-running: the player starts it themselves (tap the widget or
  // "/") once they're actually at the table and ready to shoot, instead
  // of the clock silently running during rack-up/setup time. Doesn't
  // touch shotCounterHidden: that's persisted separately
  // (state.currentGame.shotCounterHidden) so a hidden counter reloads
  // still hidden instead of popping back up on every page load.
  function startShotCounter() {
    shotCounterAccumulatedMs = 0;
    shotCounterLastBeepMs = 0;
    shotCounterLastTickCountdown = null;
    shotCounterRunningSince = null;
    tickShotCounter();
  }

  // Called when the checkbox is unchecked - progress isn't kept (there's
  // nowhere meaningful to keep it once the feature's off), so re-enabling
  // later is the same as starting fresh via startShotCounter.
  function stopShotCounter() {
    shotCounterAccumulatedMs = 0;
    shotCounterLastBeepMs = 0;
    shotCounterLastTickCountdown = null;
    shotCounterRunningSince = null;
    tickShotCounter();
  }

  // Flips pause/unpause - shared by the "/" keypad shortcut and a tap on
  // the widget itself (see its click listener near boot).
  function toggleShotCounterPause() {
    if (!shotCounterActive()) return;
    if (shotCounterRunningSince) {
      shotCounterAccumulatedMs += Date.now() - shotCounterRunningSince;
      shotCounterRunningSince = null;
    } else {
      shotCounterRunningSince = Date.now();
    }
    tickShotCounter();
  }

  // Flips show/hide - shared by the "*" keypad shortcut and the Game
  // Setup panel's Show/Hide Timer button. Persisted so the widget stays
  // hidden across a reload instead of popping back up (see startShotCounter).
  function toggleShotCounterVisibility() {
    if (!shotCounterActive()) return;
    shotCounterHidden = !shotCounterHidden;
    state.currentGame.shotCounterHidden = shotCounterHidden;
    saveState();
    tickShotCounter();
  }

  // Runs every second (see the setInterval near boot) and also called
  // directly after every keypad action, so the widget and beep schedule
  // react immediately instead of waiting up to a second.
  function tickShotCounter() {
    var widget = document.getElementById("shot-counter-widget");
    if (!widget) return;
    var active = shotCounterActive();
    var overlayOrAppHidden = isAnyOverlayOpen() || appRoot.classList.contains("hidden");
    var visible = active && !shotCounterHidden && !overlayOrAppHidden;
    widget.classList.toggle("hidden", !visible);
    // Stays visible whenever the counter is active at all, regardless
    // of shotCounterHidden - the whole point is a way back once the
    // widget itself is hidden, so it can't be gated by that same flag.
    var toggleBtn = document.getElementById("shot-counter-visibility-toggle");
    if (toggleBtn) toggleBtn.classList.toggle("hidden", !(active && !overlayOrAppHidden));
    if (!active) return;

    var elapsed = shotCounterElapsedMs();
    var timeEl = document.getElementById("shot-counter-time");
    if (timeEl) timeEl.textContent = formatDuration(elapsed);

    // Beeps (and the countdown ticks leading up to one) while running
    // regardless of hidden/visible (explicitly requested), but pause
    // along with the counter - runningSince is null while paused, so
    // this whole block is skipped then.
    if (shotCounterRunningSince) {
      var beepMs = Math.max(5, state.currentGame.shotCounterBeepSec || 30) * 1000;
      var remainingMs = beepMs - (elapsed - shotCounterLastBeepMs);
      if (remainingMs <= 0) {
        shotCounterLastBeepMs = elapsed;
        shotCounterLastTickCountdown = null;
        playShotCounterBeep();
      } else if (remainingMs <= 5000) {
        var countdown = Math.ceil(remainingMs / 1000);
        if (countdown !== shotCounterLastTickCountdown) {
          shotCounterLastTickCountdown = countdown;
          playShotCounterTick();
        }
      }
    }
  }

  function renderScoreboard() {
    var active = activePlayers();

    if (quickCounterMode) {
      nowPlayingBanner.innerHTML = "";
      rotationPositionRow.classList.add("hidden");
      scoreboard.innerHTML = "";
      scoreboard.className = "scoreboard scoreboard-quick";
      var loadRow = buildQuickCounterLoadRow();
      if (loadRow) scoreboard.appendChild(loadRow);
      active.forEach(function (p) {
        scoreboard.appendChild(buildQuickCounterPanel(p));
      });
      scoreboard.appendChild(buildQuickCounterAddRow());
      refreshKeypadNumbering();
      return;
    }

    renderNowPlayingBanner();
    scoreboard.innerHTML = "";

    if (active.length === 0) {
      scoreboard.className = "scoreboard";
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = T("scoreboard.markPlayingHint");
      scoreboard.appendChild(hint);
      refreshKeypadNumbering();
      return;
    }

    if (state.currentGame.mode === "teams") {
      scoreboard.className = "scoreboard scoreboard-teams";
      var teamAMembers = teamMembersLive("A");
      var teamBMembers = teamMembersLive("B");
      [
        { id: "A", members: teamAMembers, opponentEmpty: teamBMembers.length === 0 },
        { id: "B", members: teamBMembers, opponentEmpty: teamAMembers.length === 0 }
      ].forEach(function (team) {
        if (!team.members.length) return;
        scoreboard.appendChild(buildTeamPanel(team.id, team.members, team.opponentEmpty));
      });
    } else {
      scoreboard.className = "scoreboard";
      active.forEach(function (p) {
        scoreboard.appendChild(buildIndividualPanel(p));
      });
    }
    refreshKeypadNumbering();
  }

  function formatTimestamp(ts, includeDate) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return "";
    var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (!includeDate) return timePart;
    return formatDateISO(d) + " · " + timePart;
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || isNaN(ms)) return "";
    var totalSec = Math.round(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Today's games, most-recent first — spans however many races/sessions
  // have already been completed (and auto-saved) today, not just the
  // still-open live one, so this list doesn't go back to empty every time
  // someone reaches the race target and startNewSession() clears
  // state.gameHistory for the next race.
  function recentHistoryGames() {
    return computeDayReportData(todayDateStr()).games.slice().reverse();
  }

  function computeHistorySummary() {
    var n = recentHistoryGames().length;
    return n === 0 ? "No games in the last 24 hours." : n + " game" + (n === 1 ? "" : "s") + " in the last 24 hours.";
  }

  function renderHistory() {
    historyList.innerHTML = "";
    var games = recentHistoryGames();
    setPanelSummary("history-panel", computeHistorySummary());
    if (games.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("history.noGamesToday");
      historyList.appendChild(hint);
      return;
    }
    games.forEach(function (entry) {
      var li = document.createElement("li");
      if (entry.wonRace) li.classList.add("history-race-win-item");
      var timeSpan = document.createElement("span");
      timeSpan.className = "history-date";
      timeSpan.textContent = formatTimestamp(entry.ts, true);
      li.appendChild(timeSpan);
      var durationText = formatDuration(entry.durationMs);
      if (durationText) {
        var durationSpan = document.createElement("span");
        durationSpan.className = "history-duration";
        durationSpan.textContent = T("common.duration", { time: durationText });
        li.appendChild(durationSpan);
      }
      var winner = document.createElement("strong");
      winner.className = "history-winner";
      winner.appendChild(document.createTextNode("🏆 "));
      entry.winnerNames.forEach(function (n, i) {
        if (i > 0) winner.appendChild(document.createTextNode(" & "));
        winner.appendChild(document.createTextNode(n));
        winner.appendChild(buildRatingBadge(n));
        var delta = getPlayerRatingDeltaForGame(n, entry.ts);
        if (delta !== null) {
          var deltaSpan = document.createElement("span");
          deltaSpan.className = "history-rating-delta " + (delta > 0 ? "is-up" : delta < 0 ? "is-down" : "");
          deltaSpan.textContent = delta > 0 ? " (▲" + delta + ")" : delta < 0 ? " (▼" + delta + ")" : " (—)";
          winner.appendChild(deltaSpan);
        }
      });
      li.appendChild(winner);
      li.appendChild(document.createTextNode(" " + T("history.wonGameTarget", { game: entry.gameLabel, target: entry.target })));
      if (entry.isTeam && entry.mvpName) {
        li.appendChild(document.createTextNode(" · " + T("history.pottedIt", { name: entry.mvpName })));
        li.appendChild(buildRatingBadge(entry.mvpName));
      }
      if (entry.skunk) {
        li.appendChild(document.createTextNode(" · "));
        var skunkSpan = document.createElement("span");
        skunkSpan.className = "history-skunk";
        skunkSpan.textContent = T("history.skunkWin");
        li.appendChild(skunkSpan);
      }
      if (entry.wonRace) {
        var raceBanner = document.createElement("div");
        raceBanner.className = "history-race-banner";
        raceBanner.textContent = T("history.wonRaceSession", { names: entry.winnerNames.join(" & "), target: entry.raceTarget });
        li.appendChild(raceBanner);
      }
      historyList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Player management
  // ---------------------------------------------------------------------

  // Maps every name we've ever seen (any case) to one canonical display
  // casing, so "Bob" and "bob" always resolve to the same person. The
  // live roster's casing wins ties (checked last), since that's what's
  // currently on screen; PLAYER_STATS and unsaved game history fill in
  // anyone not currently on the roster.
  function buildNameCasingMap() {
    var map = {};
    Object.keys(PLAYER_STATS).forEach(function (n) {
      map[normalizeNameKey(n)] = n;
    });
    (state.gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string") return;
      (entry.winnerNames || []).concat(entry.opponentNames || []).forEach(function (n) {
        map[normalizeNameKey(n)] = n;
      });
    });
    state.players.forEach(function (p) {
      map[normalizeNameKey(p.name)] = p.name;
    });
    return map;
  }

  // Capitalizes the first letter of every word without touching the rest
  // ("bob smith" -> "Bob Smith"), so intentional casing elsewhere in a
  // name (e.g. "McDonald") is left alone.
  function capitalizeName(name) {
    return (name || "").replace(/\S+/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  }

  // Reuses an existing name's casing if this is the same person under a
  // different case ("bob" typed when "Bob" is already known), otherwise
  // capitalizes the typed name to become the new canonical form. The known
  // casing is still run through capitalizeName — old data saved before
  // capitalization was enforced everywhere could have a lowercase "known"
  // entry, and matching on identity should never resurrect that casing.
  function resolvePlayerName(name) {
    var trimmed = capitalizeName((name || "").trim());
    if (!trimmed) return trimmed;
    var known = buildNameCasingMap()[normalizeNameKey(trimmed)];
    return known ? capitalizeName(known) : trimmed;
  }

  // True if this name (any case) already belongs to someone on the live
  // roster — used to block adding a second player under the same nickname.
  function isDuplicatePlayerName(name) {
    var key = normalizeNameKey(name);
    if (!key) return false;
    return state.players.some(function (p) {
      return normalizeNameKey(p.name) === key;
    });
  }

  // Live-updates the Add button + the red requirement note as the name
  // field changes, so a duplicate (or empty) name can never be submitted.
  // The note only shows when there's an actual conflict to report.
  function validateNewPlayerNameInput() {
    var trimmed = newPlayerName.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnAddPlayer.disabled = !trimmed || duplicate;
    if (duplicate) {
      newPlayerNameRequirement.textContent =
        T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      newPlayerNameRequirement.classList.remove("hidden");
    } else {
      newPlayerNameRequirement.classList.add("hidden");
    }
  }

  // startingRating (optional): a known rating from outside this device
  // (another league, another tournament) — applied only if this exact
  // name has never been automatically rated here before, so it can never
  // overwrite a rating this app has already been tracking.
  function addPlayer(name, startingRating) {
    name = resolvePlayerName(name);
    if (!name) return null;
    var player = {
      id: uid(),
      name: name,
      voice: state.players.length % VOICE_PITCHES.length,
      playing: false,
      teamId: null,
      balls: 0
    };
    state.players.push(player);
    saveState();
    recordPlayerAddedIfNew(name);
    clearPlayerRemoved(name);
    if (typeof startingRating === "number" && !isNaN(startingRating) && !findRatingKey(name)) {
      var entry = ensureRatingEntry(name);
      entry.rating = startingRating;
      saveRatingsToStorage(PLAYER_RATINGS);
    }
    return player;
  }

  // Just takes them off today's active list — their saved career stats
  // and game history stay on this device and still show up on the All
  // Players page, so there's nothing here worth confirming. Doesn't touch
  // the saved player lists (see saveRosterSnapshotIfNew) - that only
  // happens when a new game/session actually starts, not on every roster
  // edit. Does record the removal (see markPlayerRemoved) so a later
  // import of an old backup that still lists this name won't silently
  // re-add them.
  function removePlayer(id) {
    var player = getPlayer(id);
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    delete state.playerWins[id];
    delete state.teamMvpWins[id];
    saveState();
    if (player) markPlayerRemoved(player.name);
    validateNewPlayerNameInput();
    renderAll();
  }

  // Queue mode (see effectiveQueue) caps individual play at exactly 2
  // seated whenever anyone's waiting: benching an active player pulls
  // the queue's front player in the same way a loss would (see
  // creditWin), and seating a standby player is only allowed when a
  // seat is actually open - there's no well-defined "who do they
  // replace" otherwise.
  function togglePlaying(id) {
    var p = getPlayer(id);
    if (!p) return;
    var queueActive = !quickCounterMode && state.currentGame.mode === "individual" && state.currentGame.queueEnabled;

    if (p.playing) {
      p.playing = false;
      p.balls = 0;
      if (queueActive) {
        var queue = effectiveQueue();
        if (queue.length > 1) {
          var front = queue.shift();
          front.playing = true;
          front.balls = 0;
        }
        saveQueue(queue);
      }
    } else {
      if (queueActive && activePlayers().length >= 2) {
        showToast(T("toast.queueTableFull"));
        return;
      }
      p.playing = true;
      p.balls = 0;
      if (!p.teamId) p.teamId = "A";
      if (queueActive) saveQueue(effectiveQueue());
    }
    saveState();
    renderAll();
  }

  function setPlayerTeam(id, teamId) {
    var p = getPlayer(id);
    if (!p) return;
    p.teamId = teamId;
    saveState();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------

  // .win-toast lives inline inside #app (between the rotation/queue
  // section and Standings, by design - it's meant to be seen while
  // scrolling the main page), so it's invisible whenever a full-screen
  // page (All Players, Tournament, Player, Contact Sheet) hides #app
  // itself. Route to .page-toast, a fixed overlay, instead whenever
  // that's the case, so every showToast() call stays visible no matter
  // which screen is open.
  function showToast(message) {
    var onMain = !appRoot.classList.contains("hidden");
    var target = onMain ? winToast : pageToast;
    var other = onMain ? pageToast : winToast;
    other.classList.add("hidden");
    target.textContent = "🏆 " + message;
    target.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      target.classList.add("hidden");
    }, 4500);
  }

  function creditWin(isTeam, key, winnerVoice) {
    var typeLabel = GAME_TYPES[state.currentGame.gameType].label;
    var summary;
    var winnerNames;
    var winnerIds;
    var opponentNames;
    var teamComboKeyValue = null;
    var milestoneNames = null;
    var milestoneCount = 0;
    var onHillNames = null;
    var target = effectiveRaceTarget(key);
    var mvpId = null;
    var mvpName = null;
    if (isTeam) {
      var members = teamMembersLive(key);
      var otherTeamId = key === "A" ? "B" : "A";
      opponentNames = teamMembersLive(otherTeamId).map(function (p) {
        return p.name;
      });
      winnerNames = members.map(function (p) {
        return p.name;
      });
      winnerIds = members.map(function (p) {
        return p.id;
      });
      // Tallied by team slot ("A"/"B"), not by the exact roster combo, so a
      // sub joining/leaving mid-race (add player, standby toggle, team
      // reassignment) doesn't fragment the running win count into a "new"
      // pairing starting at 0 - see the session-reset bug this fixed.
      teamComboKeyValue = teamComboKey(key);
      var newTeamWins = (state.teamWins[key] || 0) + 1;
      state.teamWins[key] = newTeamWins;
      members.forEach(function (p) {
        state.playerWins[p.id] = (state.playerWins[p.id] || 0) + 1;
      });
      var mvp = members.reduce(function (best, p) {
        return !best || (p.balls || 0) > (best.balls || 0) ? p : best;
      }, null);
      if (mvp) {
        mvpId = mvp.id;
        mvpName = mvp.name;
        state.teamMvpWins[mvp.id] = (state.teamMvpWins[mvp.id] || 0) + 1;
      }
      summary = teamLabelLive(key) + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (target > 0 && newTeamWins % target === 0) {
        milestoneNames = winnerNames.join(" & ");
        milestoneCount = newTeamWins;
      } else if (target > 1 && newTeamWins % target === target - 1) {
        onHillNames = teamLabelLive(key);
      }
    } else {
      winnerNames = [getPlayer(key).name];
      winnerIds = [key];
      mvpId = key;
      mvpName = getPlayer(key).name;
      opponentNames = activePlayers()
        .filter(function (p) {
          return p.id !== key;
        })
        .map(function (p) {
          return p.name;
        });
      var newPlayerWins = (state.playerWins[key] || 0) + 1;
      state.playerWins[key] = newPlayerWins;
      summary = getPlayer(key).name + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (target > 0 && newPlayerWins % target === 0) {
        milestoneNames = getPlayer(key).name;
        milestoneCount = newPlayerWins;
      } else if (target > 1 && newPlayerWins % target === target - 1) {
        onHillNames = getPlayer(key).name;
      }

      // Captured now, before the queue-mode block below can zero the
      // loser's balls (and before resetGameBalls() does the same for
      // everyone a few lines down) - the last moment this game's real
      // opponent score still exists. Only meaningful for a single
      // opponent; a free-for-all win has no one "the" opponent to
      // check, so skunk detection is skipped for those (see skunk
      // determination below).
      var skunkOpponentBalls = null;
      var winnerBallsAtWin = getPlayer(key).balls || 0;
      if (opponentNames.length === 1) {
        var skunkOpponent = activePlayers().filter(function (p) {
          return p.id !== key;
        })[0];
        skunkOpponentBalls = skunkOpponent ? (skunkOpponent.balls || 0) : null;
      }

      // "Winner stays" queue mode: send the loser to the back of the
      // line and bring the next person in - but only if someone's
      // actually waiting (computed before benching the loser, so an
      // empty queue leaves them seated, degrading gracefully to plain
      // 1v1 when there are only 2 individual players total). Queue mode
      // always keeps exactly 2 seated whenever anyone's waiting (see
      // togglePlaying and the enable-checkbox logic), so opponentNames
      // above is already just the one real opponent - no change needed
      // to the win-crediting/rating math itself.
      if (state.currentGame.mode === "individual" && state.currentGame.queueEnabled) {
        var loser = activePlayers().filter(function (p) {
          return p.id !== key;
        })[0];
        if (loser) {
          var waitingQueue = effectiveQueue();
          if (waitingQueue.length > 0) {
            loser.playing = false;
            loser.balls = 0;
            var nextUp = waitingQueue.shift();
            nextUp.playing = true;
            nextUp.balls = 0;
            waitingQueue.push(loser);
            saveQueue(waitingQueue);
          }
        }
      }
    }

    // Skunk (opponent scored/pocketed zero): only auto-derivable for
    // "points"/"balls" units, where .balls is a real live-tracked
    // score right up to this point - "rack" games (the 8-ball family)
    // have no per-ball tracking within a rack at all (see
    // adjustScore), so those stay false here and get their real value
    // later from the "Balls left on the table" entry instead (see
    // persistBallsLeftLive).
    var skunk = false;
    // One Pocket plays a standard 15-ball rack - whatever wasn't
    // pocketed by either side is what's left on the table, so this
    // prefills the win popup's manual field instead of leaving it
    // "Not Set" every time (still editable/overridable there). Same
    // single-opponent scoping as skunk above - no well-defined "the
    // other side" to subtract for a free-for-all win.
    var ballsLeftPrefill = null;
    if (state.currentGame.unit !== "rack") {
      if (isTeam) {
        var opponentTeamBalls = sumTeamBalls(otherTeamId);
        skunk = opponentTeamBalls === 0;
        if (state.currentGame.gameType === "onepocket") {
          ballsLeftPrefill = Math.max(0, 15 - sumTeamBalls(key) - opponentTeamBalls);
        }
      } else if (skunkOpponentBalls !== null) {
        skunk = skunkOpponentBalls === 0;
        if (state.currentGame.gameType === "onepocket") {
          ballsLeftPrefill = Math.max(0, 15 - winnerBallsAtWin - skunkOpponentBalls);
        }
      }
    }

    var startedAt = state.currentGame.startedAt ? new Date(state.currentGame.startedAt).getTime() : null;
    var durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
      gameType: state.currentGame.gameType,
      gameLabel: typeLabel,
      target: state.currentGame.target,
      winnerNames: winnerNames,
      winnerIds: winnerIds,
      isTeam: isTeam,
      teamId: isTeam ? key : null,
      teamComboKey: teamComboKeyValue,
      opponentNames: opponentNames,
      mvpId: mvpId,
      mvpName: mvpName,
      durationMs: durationMs,
      summary: summary,
      wonRace: !!milestoneNames,
      raceTarget: target,
      skunk: skunk,
      raceCount: milestoneCount,
      ballsLeftOnTable: ballsLeftPrefill
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    if (!noStatsMode) {
      if (isTeam) {
        applyTeamRatingResult(winnerNames, opponentNames, ts);
      } else {
        opponentNames.forEach(function (opponentName) {
          applyPairwiseRatingResult(winnerNames[0], opponentName, ts);
        });
      }
      saveRatingsToStorage(PLAYER_RATINGS);
    }
    state.gamesPlayedCount += 1;
    saveRotationSnapshotIfNew(true);
    var previousGameType = state.currentGame.gameType;
    var previousTarget = state.currentGame.target;
    var previousUnit = state.currentGame.unit;
    applyRotationIfDue();
    var gameTypeChanged = state.currentGame.gameType !== previousGameType ||
      state.currentGame.target !== previousTarget || state.currentGame.unit !== previousUnit;

    resetGameBalls();
    saveState();
    playWinSound(winnerVoice);
    renderAll();

    showToast(summary);
    // The balls-left counter needs to be set (or skipped) before any of
    // these run, since celebrateTournamentWin archives this exact game
    // and resets the session — deferred to showGameWinOverlay's onClose.
    showGameWinOverlay(summary, ts, function () {
      if (milestoneNames) {
        celebrateTournamentWin(milestoneNames, milestoneCount);
      } else if (onHillNames) {
        announceOnHill(onHillNames, target);
      } else if (gameTypeChanged) {
        announceGameChange(
          GAME_TYPES[state.currentGame.gameType].label + " (" + state.currentGame.target + " " + unitLabel(state.currentGame.unit) + ")"
        );
      }
    });
    return summary;
  }

  // Reverses every rating-history entry stamped with this exact game's ts,
  // for everyone whose rating it touched (winner(s) and opponent(s)) - the
  // exact inverse of bumpPlayerRating. A free-for-all win against N
  // opponents stamps the winner with N separate pairwise entries at the
  // same ts (one per applyPairwiseRatingResult call in recordWin), so this
  // pops all of them for that player, not just one.
  function retrogradeRatingsForGame(entry) {
    var names = (entry.winnerNames || []).concat(entry.opponentNames || []);
    var seen = {};
    var changed = false;
    names.forEach(function (name) {
      if (seen[name]) return;
      seen[name] = true;
      var key = findRatingKey(name);
      if (!key) return;
      var ratingEntry = PLAYER_RATINGS[key];
      var history = ratingEntry.history || [];
      while (history.length && history[history.length - 1].ts === entry.ts) {
        var popped = history.pop();
        ratingEntry.rating -= popped.delta;
        if (popped.fromGame) ratingEntry.gamesPlayed = Math.max(0, ratingEntry.gamesPlayed - 1);
        changed = true;
      }
    });
    if (changed) saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Undoes every rating change (from a game or a hand-entered override)
  // stamped at or after this instant, for every rated player - used by
  // "reset today's stats" so a day restarted from scratch also restarts
  // today's rating movement, not just the win/loss counts.
  // Returns name -> popped history entries (newest first), so callers
  // that need a recovery snapshot (see resetTodayStats) know exactly what
  // was reverted, instead of having to diff PLAYER_RATINGS before/after.
  function revertRatingsChangedSince(startMs) {
    var changed = false;
    var popped = {};
    Object.keys(PLAYER_RATINGS).forEach(function (key) {
      var entry = PLAYER_RATINGS[key];
      var history = entry.history || [];
      while (history.length) {
        var last = history[history.length - 1];
        var t = last.ts ? new Date(last.ts).getTime() : NaN;
        if (isNaN(t) || t < startMs) break;
        history.pop();
        entry.rating -= last.delta;
        if (last.fromGame) entry.gamesPlayed = Math.max(0, entry.gamesPlayed - 1);
        changed = true;
        if (!popped[key]) popped[key] = [];
        popped[key].push(last);
      }
    });
    if (changed) saveRatingsToStorage(PLAYER_RATINGS);
    return popped;
  }

  // Reverses the win-count, rating, rotation-position and history
  // bookkeeping for state.gameHistory[0] and removes it - the shared core
  // behind every "undo the last game" entry point (the standalone button,
  // the win popup's, and the tournament popup's) so ratings and
  // gamesPlayedCount stay correct no matter which one was clicked. No
  // confirm dialog or UI feedback of its own - callers own that. Returns
  // the undone entry, or null if there was nothing to undo.
  function retrogradeLastGame() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) return null;
    entry.winnerIds.forEach(function (id) {
      state.playerWins[id] = Math.max(0, (state.playerWins[id] || 0) - 1);
    });
    if (entry.isTeam && entry.teamId) {
      state.teamWins[entry.teamId] = Math.max(0, (state.teamWins[entry.teamId] || 0) - 1);
      if (entry.mvpId) {
        state.teamMvpWins[entry.mvpId] = Math.max(0, (state.teamMvpWins[entry.mvpId] || 0) - 1);
      }
    }
    retrogradeRatingsForGame(entry);
    state.gameHistory.shift();
    state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount - 1);
    applyRotationIfDue();
    return entry;
  }

  // playerId, when given, restricts this to "undo the last game, but only
  // if this specific player was part of it" - used by the per-player "-"
  // button in single-rack games (see buildBallControls), where there's no
  // in-progress ball count to decrement and "-" means undo their win
  // instead. Omitted entirely, this is the standalone "Undo Win" button's
  // unconditional behavior.
  function undoLastWin(playerId) {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds || (playerId && entry.winnerIds.indexOf(playerId) === -1)) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    confirmModal(T("confirm.undoWin", { summary: entry.summary }), function () {
      var undone = retrogradeLastGame();
      saveState();
      showToast(T("toast.undidGame", { summary: undone.summary }));
      renderAll();
    });
  }

  // Auto-dismisses on its own after 5s if nobody closes it by hand first -
  // cleared and restarted on every fresh announcement, and cleared on any
  // manual close (the button, the backdrop, Enter/Escape, or another
  // overlay force-closing it) so it never fires late against whatever's
  // showing by then.
  var onHillAutoCloseTimer = null;

  function announceOnHill(names, target) {
    onHillMessage.textContent = names + " is ON THE HILL — one more win takes the race to " + target + "! Better step up. 👀";
    onHillOverlay.classList.remove("hidden");
    playOnHillSound();
    if (onHillAutoCloseTimer) clearTimeout(onHillAutoCloseTimer);
    onHillAutoCloseTimer = setTimeout(function () {
      onHillAutoCloseTimer = null;
      closeOnHill();
    }, 5000);
  }

  function closeOnHill() {
    if (onHillAutoCloseTimer) {
      clearTimeout(onHillAutoCloseTimer);
      onHillAutoCloseTimer = null;
    }
    onHillOverlay.classList.add("hidden");
  }

  function announceGameChange(label) {
    gameChangeMessage.textContent = T("gamechange.nowPlaying", { label: label });
    gameChangeOverlay.classList.remove("hidden");
    playPositiveSound(null);
  }

  function closeGameChange() {
    gameChangeOverlay.classList.add("hidden");
  }

  // Reflects the current counter value into the dialog and disables "-"
  // once it can't go any lower than unset.
  function renderBallsLeftValue(valueInput, minusBtn) {
    valueInput.value = gamewinBallsLeftValue === null ? "" : String(gamewinBallsLeftValue);
    minusBtn.disabled = gamewinBallsLeftValue === null;
  }

  // Writes the current balls-left value straight onto the game it belongs
  // to and refreshes any player-stats view already open behind the
  // overlay, the instant it changes - rather than waiting for the dialog
  // to close (closeGameWinOverlay's own patch-back stays as a harmless,
  // redundant safety net for it).
  function persistBallsLeftLive() {
    if (state.gameHistory[0] && state.gameHistory[0].ts === gamewinPendingTs) {
      state.gameHistory[0].ballsLeftOnTable = gamewinBallsLeftValue;
      // Rack-mode skunk only has one source of truth: this field. 7
      // left means the loser potted none of their 7 object balls.
      if (SKUNK_RACK_GAME_TYPES.indexOf(state.gameHistory[0].gameType) !== -1) {
        state.gameHistory[0].skunk = gamewinBallsLeftValue === 7;
      }
      saveState();
      updateGamewinSkunkIndicator();
      if (currentStatsPlayerName) {
        currentStatsSessions = getPlayerSessions(currentStatsPlayerName);
        renderPlayerHistoryList(currentStatsSessions);
      }
    }
  }

  // Read-only badge, not an input - nothing to toggle by hand. Shown
  // immediately for the auto-detected points/balls-unit case (see
  // creditWin), and appears live the moment the balls-left stepper
  // below hits 7 for a rack-mode game (see persistBallsLeftLive).
  function buildSkunkIndicator() {
    var el = document.createElement("div");
    el.className = "gamewin-skunk-indicator hidden";
    el.textContent = T("skunk.indicator");
    return el;
  }

  function updateGamewinSkunkIndicator() {
    var el = gamewinDetails.querySelector(".gamewin-skunk-indicator");
    if (!el) return;
    var isSkunk = !!(state.gameHistory[0] && state.gameHistory[0].ts === gamewinPendingTs && state.gameHistory[0].skunk);
    el.classList.toggle("hidden", !isSkunk);
  }

  // Optional +/- counter (also directly typeable on a real keyboard) for
  // how many balls were left on the table when this game ended. Starts
  // unset (null) - "+" from unset goes to 0, "-" from 0 goes back to
  // unset, and clearing the field by hand does the same, so leaving it
  // alone never records a value. Lives in the per-game win overlay
  // (showGameWinOverlay), not the tournament/milestone one - it's a
  // property of the specific game just played, not the race as a whole.
  function buildBallsLeftRow() {
    var row = document.createElement("div");
    row.className = "player-stats-row balls-left-row";
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = T("ballsLeft.label");

    var stepper = document.createElement("div");
    stepper.className = "balls-left-stepper";
    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "balls-left-btn minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", T("ballsLeft.decrease"));

    var valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.inputMode = "numeric";
    valueInput.min = "0";
    valueInput.placeholder = T("ballsLeft.unset");
    valueInput.className = "balls-left-value balls-left-input";
    valueInput.setAttribute("aria-label", T("ballsLeft.label"));

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "balls-left-btn plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", T("ballsLeft.increase"));

    minusBtn.addEventListener("click", function () {
      if (gamewinBallsLeftValue === null) return;
      gamewinBallsLeftValue = gamewinBallsLeftValue === 0 ? null : gamewinBallsLeftValue - 1;
      renderBallsLeftValue(valueInput, minusBtn);
      persistBallsLeftLive();
    });
    plusBtn.addEventListener("click", function () {
      gamewinBallsLeftValue = gamewinBallsLeftValue === null ? 0 : gamewinBallsLeftValue + 1;
      renderBallsLeftValue(valueInput, minusBtn);
      persistBallsLeftLive();
    });
    valueInput.addEventListener("input", function () {
      if (valueInput.value === "") {
        gamewinBallsLeftValue = null;
      } else {
        var n = parseInt(valueInput.value, 10);
        gamewinBallsLeftValue = isNaN(n) ? null : Math.max(0, n);
      }
      minusBtn.disabled = gamewinBallsLeftValue === null;
      persistBallsLeftLive();
    });

    stepper.appendChild(minusBtn);
    stepper.appendChild(valueInput);
    stepper.appendChild(plusBtn);
    row.appendChild(label);
    row.appendChild(stepper);
    renderBallsLeftValue(valueInput, minusBtn);
    return row;
  }

  // Shown for every credited win (not just a race-ending one) so the
  // balls-left marker can be set for that specific game before anything
  // else happens - in particular, before a race-ending win archives the
  // game and resets the session in celebrateTournamentWin. onClose runs
  // whatever should happen next (milestone/on-hill/game-change), deferred
  // until this dialog is dismissed.
  function showGameWinOverlay(summary, ts, onClose) {
    // One Pocket wins arrive with a computed prefill already sitting on
    // the fresh gameHistory entry (see creditWin's ballsLeftPrefill) -
    // pick it up here instead of always starting blank; still just a
    // starting point, editable/clearable the same as a manually typed
    // value.
    var freshEntry = state.gameHistory[0] && state.gameHistory[0].ts === ts ? state.gameHistory[0] : null;
    gamewinBallsLeftValue = freshEntry && freshEntry.ballsLeftOnTable !== null && freshEntry.ballsLeftOnTable !== undefined ? freshEntry.ballsLeftOnTable : null;
    gamewinPendingTs = ts;
    gamewinPendingOnClose = onClose;
    gamewinMessage.textContent = summary;
    gamewinDetails.innerHTML = "";
    gamewinDetails.appendChild(buildBallsLeftRow());
    gamewinDetails.appendChild(buildSkunkIndicator());
    updateGamewinSkunkIndicator();
    gamewinOverlay.classList.remove("hidden");
    // Focus the balls-left field so a number key works right away, with
    // no click needed first - can only happen once the overlay is no
    // longer .hidden (an element can't take focus while display:none).
    // preventScroll: true - this overlay is position:fixed and already
    // covers the whole viewport, so the browser's default focus-scroll
    // behavior only ever yanked the page underneath (particularly
    // noticeable with many players on screen, crediting a win from far
    // down the list) back toward this input's old scroll position -
    // there's nothing useful for it to scroll to.
    var ballsLeftInput = gamewinDetails.querySelector(".balls-left-input");
    if (ballsLeftInput) ballsLeftInput.focus({ preventScroll: true });
  }

  function closeGameWinOverlay() {
    // The just-credited game is still the front of gameHistory at this
    // point (nothing else can run while this dialog is up) - patch the
    // marker directly onto it so it's already there by the time any
    // archiving (celebrateTournamentWin's exportAllPlayerStats) reads it.
    if (gamewinBallsLeftValue !== null && state.gameHistory[0] && state.gameHistory[0].ts === gamewinPendingTs) {
      state.gameHistory[0].ballsLeftOnTable = gamewinBallsLeftValue;
      if (SKUNK_RACK_GAME_TYPES.indexOf(state.gameHistory[0].gameType) !== -1) {
        state.gameHistory[0].skunk = gamewinBallsLeftValue === 7;
      }
      saveState();
    }
    gamewinOverlay.classList.add("hidden");
    var onClose = gamewinPendingOnClose;
    gamewinBallsLeftValue = null;
    gamewinPendingTs = null;
    gamewinPendingOnClose = null;
    if (onClose) onClose();
  }

  // Dismisses the win overlay after a quick-action (undo) has already
  // changed the game it was celebrating out from under it - skips both the
  // balls-left patch-back and the queued onClose chain (milestone/on-hill/
  // game-change), since neither still applies.
  function dismissGameWinOverlaySilently() {
    gamewinOverlay.classList.add("hidden");
    gamewinBallsLeftValue = null;
    gamewinPendingTs = null;
    gamewinPendingOnClose = null;
  }

  // A large, unmissable confirmation that a forced correction actually
  // happened - shown after the win popup's or tournament popup's "Undo
  // this win" instead of just a toast, since these fire mid-dispute in
  // front of a table of people who all need to see it landed.
  function showForceResetNotice(message) {
    forceResetMessage.textContent = message;
    forceResetOverlay.classList.remove("hidden");
  }

  function closeForceResetNotice() {
    forceResetOverlay.classList.add("hidden");
  }

  // Lets a misclick be corrected right from the win popup instead of
  // hunting for "Undo Last Win" elsewhere - undoes the exact win this
  // dialog is celebrating (still the front of gameHistory at this point,
  // same as undoLastWin's own precondition) and closes the dialog without
  // running its queued follow-up.
  function undoWinFromGameWinOverlay() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    confirmModal(T("confirm.undoWin", { summary: entry.summary }), function () {
      var undone = retrogradeLastGame();
      saveState();
      dismissGameWinOverlaySilently();
      renderAll();
      showForceResetNotice(T("forceReset.gameMessage", { summary: undone.summary }));
    });
  }

  // Wipes every game recorded today - both the still-live session and any
  // tournaments already archived into PLAYER_STATS earlier today - and
  // rewinds every player's rating to what it was before today's play,
  // leaving every earlier day untouched. Lives in the Reset section
  // (Backup & Transfer), for when the whole day's session needs a do-over.
  // Rebuilds the live session win tallies from state.gameHistory as it
  // currently stands, rather than adjusting counters by hand - used both
  // by resetTodayStats (after pruning today's entries) and by the Recover
  // Data restore flow (after merging archived games back in), so both
  // stay self-consistent with whatever's actually in the game log.
  function recomputeLiveWinsFromGameHistory() {
    state.playerWins = {};
    state.teamWins = {};
    state.teamMvpWins = {};
    state.gameHistory.forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerIds) return;
      entry.winnerIds.forEach(function (id) {
        state.playerWins[id] = (state.playerWins[id] || 0) + 1;
      });
      if (entry.isTeam && entry.teamId) {
        state.teamWins[entry.teamId] = (state.teamWins[entry.teamId] || 0) + 1;
        if (entry.mvpId) {
          state.teamMvpWins[entry.mvpId] = (state.teamMvpWins[entry.mvpId] || 0) + 1;
        }
      }
    });
    state.gamesPlayedCount = state.gameHistory.length;
  }

  function resetTodayStats() {
    confirmModal(T("confirm.resetTodayStats"), function () {
      exportAllData();
      var today = todayDateStr();
      var todayStartMs = periodStartDate("today").getTime();

      var prunedSessions = {};
      Object.keys(PLAYER_STATS).forEach(function (key) {
        var entry = PLAYER_STATS[key];
        if (!entry || !Array.isArray(entry.sessions)) return;
        var todaysSessions = entry.sessions.filter(function (s) {
          return s.date === today;
        });
        if (todaysSessions.length) prunedSessions[key] = todaysSessions;
        entry.sessions = entry.sessions.filter(function (s) {
          return s.date !== today;
        });
      });
      savePlayerStatsToStorage(PLAYER_STATS);

      // Keeps any stray earlier-day entries from a session left open across
      // midnight, then rebuilds the live win counters from what's left
      // instead of just zeroing them, so that carryover isn't lost.
      var todaysGameHistory = (state.gameHistory || []).filter(function (entry) {
        return entry && entry.ts && localDateStrFromTs(entry.ts) === today;
      });
      state.gameHistory = (state.gameHistory || []).filter(function (entry) {
        return !(entry && entry.ts && localDateStrFromTs(entry.ts) === today);
      });
      var prevPlayerWins = JSON.parse(JSON.stringify(state.playerWins));
      var prevTeamWins = JSON.parse(JSON.stringify(state.teamWins));
      var prevTeamMvpWins = JSON.parse(JSON.stringify(state.teamMvpWins));
      recomputeLiveWinsFromGameHistory();
      resetGameBalls();
      saveState();

      var poppedRatingHistory = revertRatingsChangedSince(todayStartMs);

      saveResetSnapshot("todayStats", T("resetSnapshot.todayStatsLabel", { date: today }), {
        date: today,
        prunedSessions: prunedSessions,
        gameHistory: todaysGameHistory,
        playerWins: prevPlayerWins,
        teamWins: prevTeamWins,
        teamMvpWins: prevTeamMvpWins,
        ratingHistory: poppedRatingHistory
      });

      if (currentStatsPlayerName) {
        currentStatsSessions = getPlayerSessions(currentStatsPlayerName);
        renderPlayerHistoryList(currentStatsSessions);
      }

      renderAll();
      showToast(T("toast.todayStatsCleared"));
    });
  }

  // In-memory only (never persisted, same as gamewinPendingOnClose) -
  // captured fresh at the top of every celebrateTournamentWin call, and
  // only ever reachable through the "Undo this win" button living inside
  // the milestone overlay it was captured for, so a stale snapshot can
  // never be applied after that overlay has closed.
  var lastTournamentWinSnapshot = null;

  function celebrateTournamentWin(names, count) {
    // count is the win tally that just triggered this exact milestone,
    // so it already *is* whatever target (global or fair) was hit -
    // no separate lookup needed, and this stays correct even when a
    // fair-race target differs from state.raceToWinsTarget.
    var target = count;

    // A win one game earlier can leave the on-hill overlay open (it has no
    // reason to auto-close on its own) — without this it stacks visually
    // behind the milestone overlay that's about to show.
    closeOnHill();

    // Everything below this line rewrites state.gameHistory/PLAYER_STATS -
    // snapshot first so "Undo this win" can restore the tournament exactly
    // as it stood right after the winning game was credited, then retrograde
    // that one game on top of the restored state to land one game earlier.
    lastTournamentWinSnapshot = {
      gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
      playerWins: JSON.parse(JSON.stringify(state.playerWins)),
      teamWins: JSON.parse(JSON.stringify(state.teamWins)),
      teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins)),
      gamesPlayedCount: state.gamesPlayedCount,
      currentGame: JSON.parse(JSON.stringify(state.currentGame)),
      playerStats: JSON.parse(JSON.stringify(PLAYER_STATS))
    };

    // Save this tournament's game history to per-player stats before the
    // reset below wipes state.gameHistory, then start the next one fresh.
    exportAllPlayerStats();
    startNewSession(true);

    var playerNames = activePlayers().map(function (p) {
      return p.name;
    });
    var info = rotationStatusInfo();

    milestoneHeadline.textContent = T("milestone.headline", { names: names, count: count, target: target });

    milestoneDetails.innerHTML = "";
    milestoneDetails.appendChild(playerStatsListRow(T("milestone.players"), playerNames, true));
    milestoneDetails.appendChild(playerStatsRow(T("milestone.tournamentGoal"), T("milestone.raceToWins", { target: target })));
    if (state.rotation.enabled && state.rotation.order.length > 0) {
      var rotationLabels = state.rotation.order.map(rotationEntryLabel);
      milestoneDetails.appendChild(playerStatsListRow(T("milestone.gameRotation"), rotationLabels));
      if (info) {
        milestoneDetails.appendChild(
          playerStatsRow(
            T("milestone.nextSwitch"),
            T(info.untilSwitch === 1 ? "milestone.nextSwitchDetailOne" : "milestone.nextSwitchDetailMany", {
              current: info.currentLabel,
              next: info.nextLabel,
              count: info.untilSwitch
            })
          )
        );
      }
    }

    milestoneOverlay.classList.remove("hidden");
    playTournamentChampionSound();
  }

  function closeMilestone() {
    milestoneOverlay.classList.add("hidden");
    lastTournamentWinSnapshot = null;
  }

  // Undoes the entire just-finished tournament's archiving/new-session
  // reset (via the pre-celebration snapshot) and then retrogrades the
  // winning game on top of that restored state, landing exactly one game
  // before the win - as if the celebration never happened.
  function undoTournamentWinFromMilestoneOverlay() {
    if (!lastTournamentWinSnapshot) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    var snapshot = lastTournamentWinSnapshot;
    confirmModal(T("confirm.undoTournamentWin"), function () {
      state.gameHistory = snapshot.gameHistory;
      state.playerWins = snapshot.playerWins;
      state.teamWins = snapshot.teamWins;
      state.teamMvpWins = snapshot.teamMvpWins;
      state.gamesPlayedCount = snapshot.gamesPlayedCount;
      state.currentGame = snapshot.currentGame;
      PLAYER_STATS = snapshot.playerStats;
      savePlayerStatsToStorage(PLAYER_STATS);

      var undone = retrogradeLastGame();
      saveState();
      lastTournamentWinSnapshot = null;
      milestoneOverlay.classList.add("hidden");
      syncGameTypeUI();
      renderAll();
      showForceResetNotice(T("forceReset.tournamentMessage", { summary: undone.summary }));
    });
  }

  function resetGameBalls() {
    state.players.forEach(function (p) {
      p.balls = 0;
    });
    state.currentGame.startedAt = new Date().toISOString();
    // A new game/rack means a fresh shot clock too - startShotCounter()
    // already zeroes elapsed/beep/tick and starts it running without
    // touching the persisted hidden flag.
    if (shotCounterActive()) startShotCounter();
    resetCurrentRun();
  }

  // ---------------------------------------------------------------------
  // "Balls in a row" run tracking - only meaningful for games scored
  // ball-by-ball or point-by-point (unit "balls"/"points"; see
  // GAME_TYPES). A rack-unit game's "+1" already means "won the whole
  // rack," not "potted one more ball," so there's no run to track there.
  // Session-only state (not persisted, like keypadSelectedPlayerId) - the
  // two records below are what actually survive a reload.
  // ---------------------------------------------------------------------

  var RUN_RECORDS_KEY = "poolMasterCounter.runRecords.v1";
  // A single ball isn't a "run" worth immortalizing as a record.
  var RUN_RECORD_MIN_TO_TRACK = 2;

  function loadRunRecordsFromStorage() {
    try {
      var raw = localStorage.getItem(RUN_RECORDS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return {
        allTimeBest: parsed && parsed.allTimeBest ? parsed.allTimeBest : null,
        dailyBest: parsed && parsed.dailyBest ? parsed.dailyBest : null
      };
    } catch (e) {
      return { allTimeBest: null, dailyBest: null };
    }
  }

  function saveRunRecordsToStorage(data) {
    try {
      localStorage.setItem(RUN_RECORDS_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save run records.", e);
    }
  }

  var RUN_RECORDS = loadRunRecordsFromStorage();

  // dailyBest is stored as a single ongoing value, not one entry per day
  // - this is what makes "is it actually today's record" a read-side
  // question: a value left over from a previous day (nobody's beaten it
  // yet today) reads as "no record yet today," not yesterday's number.
  function getTodaysBestRun() {
    if (!RUN_RECORDS.dailyBest) return null;
    return localDateStrFromTs(RUN_RECORDS.dailyBest.ts) === todayDateStr() ? RUN_RECORDS.dailyBest : null;
  }

  function getAllTimeBestRun() {
    return RUN_RECORDS.allTimeBest;
  }

  // Checked continuously as a run grows (see bumpRunForPlayer), not just
  // once when it "ends" - a run's final length is its peak, so comparing
  // on every extra ball is exactly equivalent and means there's no
  // separate "finalize" step that could miss it.
  function checkRunRecords(playerName, value) {
    if (value < RUN_RECORD_MIN_TO_TRACK) return;
    var changed = false;
    var nowTs = new Date().toISOString();
    if (!RUN_RECORDS.allTimeBest || value > RUN_RECORDS.allTimeBest.value) {
      RUN_RECORDS.allTimeBest = { name: playerName, value: value, ts: nowTs };
      changed = true;
    }
    var dailyStale = !RUN_RECORDS.dailyBest || localDateStrFromTs(RUN_RECORDS.dailyBest.ts) !== todayDateStr();
    if (dailyStale || value > RUN_RECORDS.dailyBest.value) {
      RUN_RECORDS.dailyBest = { name: playerName, value: value, ts: nowTs };
      changed = true;
    }
    if (changed) saveRunRecordsToStorage(RUN_RECORDS);
  }

  var currentRunPlayerId = null;
  var currentRunPlayerName = null;
  var currentRunCount = 0;

  function resetCurrentRun() {
    currentRunPlayerId = null;
    currentRunPlayerName = null;
    currentRunCount = 0;
  }

  function runTrackingApplies() {
    return !quickCounterMode && state.currentGame.unit !== "rack";
  }

  // Called from adjustScore for every +/- - a run switches (and the old
  // one simply stops growing, already checked against the records on
  // every ball it gained) the instant a DIFFERENT player scores, and an
  // explicit keypad switch to someone else (see handleKeypadShortcut)
  // stops it even before they've scored anything yet, per "the counter
  // should stop when we select the next player."
  function bumpRunForPlayer(playerId, delta) {
    if (!runTrackingApplies()) return;
    if (delta > 0) {
      if (currentRunPlayerId !== playerId) {
        currentRunPlayerId = playerId;
        var p = getPlayer(playerId);
        currentRunPlayerName = p ? p.name : null;
        currentRunCount = 0;
      }
      currentRunCount += 1;
      if (currentRunPlayerName) checkRunRecords(currentRunPlayerName, currentRunCount);
    } else if (delta < 0 && currentRunPlayerId === playerId) {
      currentRunCount = Math.max(0, currentRunCount - 1);
    }
  }

  function adjustScore(playerId, delta) {
    var player = getPlayer(playerId);
    if (!player || !player.playing) return;

    // A team can't play (or score) against nobody - blocks both +/- here,
    // not just the win-credit at target, and is the authoritative check
    // (buildBallControls also disables the buttons for this, but this is
    // what actually stops the keypad shortcut too).
    if (!quickCounterMode && state.currentGame.mode === "teams" && player.teamId) {
      var otherTeamId = player.teamId === "A" ? "B" : "A";
      if (teamMembersLive(otherTeamId).length === 0) {
        showToast(T("toast.teamNeedsOpponent"));
        return;
      }
    }

    // Same idea for queue mode: with the seat cap normally enforced
    // elsewhere (togglePlaying, the enable checkbox, creditWin's
    // rotation), this only fires for the edge case of a solo player
    // left seated with nobody waiting to fill the second seat.
    if (!quickCounterMode && state.currentGame.mode === "individual" && state.currentGame.queueEnabled && activePlayers().length < 2) {
      showToast(T("toast.queueNeedsPlayer"));
      return;
    }

    // Quick Counter: just tally, never check a target or credit a win.
    // Free-form point counter — negative scores are allowed (e.g. golf-
    // style games, point penalties), so no clamping to 0 here.
    if (quickCounterMode) {
      player.balls = (player.balls || 0) + delta;
      saveState();
      if (delta > 0) playPositiveSound(player.voice);
      else playNegativeSound(player.voice);
      renderAll();
      return;
    }

    var allowNegative = state.currentGame.unit !== "rack";
    var next = (player.balls || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    player.balls = next;
    bumpRunForPlayer(playerId, delta);

    if (delta > 0) {
      var target = state.currentGame.target;
      var isTeamMode = state.currentGame.mode === "teams" && player.teamId;
      var reached = isTeamMode ? sumTeamBalls(player.teamId) >= target : next >= target;

      if (reached) {
        var winnerVoice = isTeamMode ? null : player.voice;
        creditWin(isTeamMode, isTeamMode ? player.teamId : playerId, winnerVoice);
        return;
      }

      saveState();
      playPositiveSound(player.voice);
    } else {
      saveState();
      playNegativeSound(player.voice);
    }
    renderAll();
  }

  function resetCurrentGame() {
    confirmModal(T("confirm.resetGame"), function () {
      resetGameBalls();
      saveState();
      renderAll();
    });
  }

  function resetSessionAndTournament() {
    var hasTournament = !!TOURNAMENT;
    if (state.gameHistory.length === 0) {
      var msg = hasTournament ? T("confirm.resetSessionAndTournament") : T("confirm.startNewSession");
      confirmModal(msg, function () {
        startNewSession(false);
        endTournamentSilently();
      });
      return;
    }
    var count = state.gameHistory.length;
    var message = T(count === 1 ? "saveSession.messageOne" : "saveSession.messageMany", { count: count });
    if (hasTournament) message += " " + T("confirm.alsoEndsTournamentNote");
    saveSessionMessage.textContent = message;
    saveSessionOverlay.classList.remove("hidden");
  }

  function endTournamentSilently() {
    TOURNAMENT = null;
    saveTournamentToStorage(null);
    renderTournamentPage();
  }

  function closeSaveSessionPopup() {
    saveSessionOverlay.classList.add("hidden");
  }

  function startNewSession(saveRoster) {
    if (saveRoster) maybeSaveRosterOnNewSession();
    state.playerWins = {};
    state.teamWins = {};
    state.teamMvpWins = {};
    state.gameHistory = [];
    state.gamesPlayedCount = 0;
    resetGameBalls();
    saveState();
    applyRotationIfDue();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Sharing by email
  // ---------------------------------------------------------------------

  // Deliberately NOT run through T() - this is shared out of the app as a
  // message to other people (email/SMS), same as the day report and every
  // export, so it stays in a consistent language (English) regardless of
  // the sender's UI language. See buildDayReportText below for the same
  // rule applied to the day report.
  function shareStandings() {
    var lines = ["Pool Master Counter — Standings", ""];
    lines.push("Player session wins:");
    state.players.forEach(function (p) {
      lines.push("  " + p.name + ": " + (state.playerWins[p.id] || 0));
    });
    var teamKeys = ["A", "B"].filter(function (teamId) {
      return (state.teamWins[teamId] || 0) > 0;
    });
    if (teamKeys.length) {
      lines.push("");
      lines.push("Team pairing wins:");
      teamKeys.forEach(function (key) {
        var namesList = teamMembersLive(key).map(function (p) {
          return p.name;
        });
        var names = namesList.length ? namesList.join(" & ") : "Team " + key;
        lines.push("  " + names + ": " + state.teamWins[key]);
      });
    }
    if (state.gameHistory.length) {
      lines.push("");
      lines.push("Recent games:");
      state.gameHistory.slice(0, 15).forEach(function (entry) {
        lines.push("  " + (typeof entry === "string" ? entry : entry.summary));
      });
    }
    var body = lines.join("\n");
    var href = "mailto:?subject=" + encodeURIComponent("Pool Master Counter — Standings") + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  // ---------------------------------------------------------------------
  // Publish Daily Report — free-text notes about today's live play,
  // saved per calendar date, plus a plain-text end-of-day synopsis (who
  // played, results, rating movement, and the notes) ready to copy, email,
  // or text.
  // ---------------------------------------------------------------------

  var DAY_NOTES_KEY = "poolMasterCounter.dayNotes.v1";

  function loadDayNotesFromStorage() {
    try {
      var raw = localStorage.getItem(DAY_NOTES_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveDayNotesToStorage(notes) {
    try {
      localStorage.setItem(DAY_NOTES_KEY, JSON.stringify(notes));
    } catch (e) {
      console.warn("Could not save day notes.", e);
    }
  }

  var DAY_NOTES = loadDayNotesFromStorage();

  // Local calendar day (not UTC) - a UTC slice reads as "tomorrow" for
  // anyone west of UTC once local evening crosses into UTC's next day,
  // which silently mis-buckets that session's "today" stats. Matches
  // periodStartDate("today")'s local-midnight boundary below.
  function todayDateStr() {
    return localDateStrFromTs(new Date());
  }

  function localDateStrFromTs(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function getDayNotes(dateStr) {
    return DAY_NOTES[dateStr] || "";
  }

  function setDayNotes(dateStr, text) {
    if (text) DAY_NOTES[dateStr] = text;
    else delete DAY_NOTES[dateStr];
    saveDayNotesToStorage(DAY_NOTES);
  }

  // Every distinct game played in the last 24 hours (deduped by timestamp
  // across however many players' individual game lists it shows up in —
  // live session plus any earlier session saved recently) and each
  // player's win/loss/rating tally for that window. Deliberately a
  // rolling 24h window rather than a UTC-calendar-day match: the latter
  // silently drops evening games in any timezone behind UTC, since
  // ts.slice(0, 10) would already read as "tomorrow". Each game is kept
  // from its *winning* side's perspective (result === "won") so
  // winnerNames / opponentNames are neutral (winning side / losing side)
  // rather than relative to whichever player happened to be iterated
  // last. Also flagged with isLive: true when it's part of the
  // still-open current session (state.gameHistory), false when it only
  // exists in a session already saved within the window.
  function computeDayReportData(dateStr) {
    var names = getAllKnownPlayerNames();
    var cutoffTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var liveTsSet = {};
    (state.gameHistory || []).forEach(function (entry) {
      if (entry && entry.ts) liveTsSet[entry.ts] = true;
    });
    var gamesByTs = {};
    var players = [];
    names.forEach(function (name) {
      var games = allGamesForPlayerName(name).filter(function (g) {
        return g.ts && g.ts >= cutoffTs;
      });
      if (!games.length) return;
      var wins = 0;
      games.forEach(function (g) {
        if (g.result === "won") wins += 1;
        var existing = gamesByTs[g.ts];
        if (!existing || (existing.result !== "won" && g.result === "won")) {
          gamesByTs[g.ts] = g;
        }
      });
      players.push({
        name: name,
        played: games.length,
        wins: wins,
        losses: games.length - wins,
        rating: getPlayerRating(name),
        ratingDelta: computeRatingPeriodDelta(name, "today")
      });
    });
    players.sort(function (a, b) {
      return b.wins - a.wins || a.name.localeCompare(b.name);
    });
    var games = Object.keys(gamesByTs)
      .sort()
      .map(function (ts) {
        var g = gamesByTs[ts];
        g.isLive = !!liveTsSet[ts];
        return g;
      });
    // Bracket tournaments (single/double elim, round robin) are tracked
    // entirely separately from state.gameHistory/PLAYER_STATS - without
    // this they'd never show up in the day report at all, no matter how
    // recently one finished.
    var tournaments = TOURNAMENT_RESULTS.filter(function (r) {
      return r.format !== "session-race" && r.ts && r.ts >= cutoffTs;
    }).sort(function (a, b) {
      return a.ts.localeCompare(b.ts);
    });
    // The main scoreboard's own "Race to N" milestone (what the in-app
    // popup itself calls winning "the tournament", and the history list
    // calls "the session") - a flag on the one game that pushed someone
    // over the target, already present in `games` above.
    var raceWins = games.filter(function (g) {
      return g.wonRace;
    });
    // Only the live "today" record is tracked (see checkRunRecords) -
    // there's no historical per-day archive, so a report for a past
    // date has nothing to show here.
    var bestRunToday = dateStr === todayDateStr() ? getTodaysBestRun() : null;
    return { date: dateStr, games: games, players: players, tournaments: tournaments, raceWins: raceWins, bestRunToday: bestRunToday };
  }

  function tournamentFormatLabel(format) {
    if (format === "single") return "Single Elimination";
    if (format === "double") return "Double Elimination";
    if (format === "roundrobin") return "Round Robin";
    if (format === "swiss") return "Swiss";
    return "Tournament";
  }

  function formatReportRaceWinLine(g) {
    var time = formatReportGameTime(g.ts);
    var names = joinNamesForReport((g.winnerNames || []).length ? g.winnerNames : (g.teammateNames || []));
    return "🏆 " + (time ? time + " — " : "") + names + " won the Race to " + g.raceTarget + " session!";
  }

  function formatReportTournamentLine(t) {
    var time = formatReportGameTime(t.ts);
    var champions = joinNamesForReport(t.championNames || []);
    var text = champions + " won the " + tournamentFormatLabel(t.format) + " tournament (" + (t.players || []).length + " players)";
    return "👑 " + (time ? time + " — " : "") + text;
  }

  function formatReportBestRunLine(run) {
    return "🔥 Best run of the day: " + run.value + " in a row (" + run.name + ")";
  }

  function joinNamesForReport(names) {
    names = names || [];
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  // Same idea as joinNamesForReport, but bounded - an individual-mode
  // game credits a win against every other active player as "opponents",
  // so a 5+ player free-for-all can otherwise blow a single table cell
  // (and the whole column) out to 60+ characters. Table cells stay
  // readable; prose sentences (Detailed) can afford the full list.
  function joinNamesCapped(names, cap) {
    names = names || [];
    if (names.length <= cap) return joinNamesForReport(names);
    return names.slice(0, cap).join(", ") + " +" + (names.length - cap) + " more";
  }

  function formatReportGameTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  // Collapses repeat matchups (same winning side, same losing side, same
  // game type) into one grouped entry with a count, so a lopsided session
  // where one pair plays the same game a dozen times doesn't repeat the
  // same sentence a dozen times in the report. winnerNames/opponentNames
  // are kept as full arrays (both members of a team on each side) so
  // grouping and display both cover team games correctly.
  function groupReportGames(games) {
    var order = [];
    var byKey = {};
    (games || []).forEach(function (g) {
      var key =
        (g.winnerNames || []).slice().sort().join(",") + "|" + (g.opponentNames || []).slice().sort().join(",") + "|" + g.gameLabel;
      if (!byKey[key]) {
        byKey[key] = { winnerNames: g.winnerNames, opponentNames: g.opponentNames, gameLabel: g.gameLabel, ts: g.ts, count: 0, skunkCount: 0 };
        order.push(key);
      }
      byKey[key].count += 1;
      if (g.skunk) byKey[key].skunkCount += 1;
    });
    return order.map(function (k) {
      return byKey[k];
    });
  }

  // Shared by all 4 day-report formats - a grouped matchup line can mix
  // skunk and non-skunk games against the same opponent (e.g. a race-
  // to-5 where only some racks were skunks), so this is a count, not a
  // boolean, and blank whenever none of the group's games were skunks.
  // Plain hardcoded text, not T() - like every other string in these
  // report builders, this is a plain-text export meant to be pasted/
  // shared as-is, not part of the localized UI.
  function formatSkunkSuffix(skunkCount) {
    return skunkCount > 0 ? " 🦨×" + skunkCount : "";
  }

  // Always leads with a time, even for a grouped repeat-matchup line
  // (using the first game's time in that group) - dropping it there was
  // inconsistent with every other line in the report showing one.
  function formatReportGameGroupLine(group) {
    var winners = joinNamesForReport(group.winnerNames || []);
    var losers = joinNamesForReport(group.opponentNames || []);
    var time = formatReportGameTime(group.ts);
    var text = group.count === 1 ? winners + " won " + group.gameLabel : winners + " won " + group.count + " games of " + group.gameLabel;
    if (losers) text += " against " + losers;
    text += formatSkunkSuffix(group.skunkCount);
    return (time ? time + " — " : "") + text;
  }

  function formatReportRatingDelta(delta) {
    if (delta === null) return "—";
    if (delta > 0) return "▲" + delta;
    if (delta < 0) return "▼" + Math.abs(delta);
    return "—";
  }

  function repeatChar(ch, count) {
    var s = "";
    for (var i = 0; i < count; i++) s += ch;
    return s;
  }

  // Pads by UTF-16 length, so CJK text (double-width in a monospace font)
  // won't line up as precisely as Latin text - an accepted limitation of
  // a plain-text-only report with no real table rendering.
  function padTableCell(text, width, alignRight) {
    text = String(text);
    var pad = repeatChar(" ", Math.max(0, width - text.length));
    return alignRight ? pad + text : text + pad;
  }

  function textTableColumnWidths(headers, rows) {
    return headers.map(function (h, i) {
      var width = String(h).length;
      rows.forEach(function (r) {
        width = Math.max(width, String(r[i]).length);
      });
      return width;
    });
  }

  function textTableRow(cells, widths, alignRight) {
    return (
      "| " +
      cells
        .map(function (c, i) {
          return padTableCell(c, widths[i], alignRight && alignRight[i]);
        })
        .join(" | ") +
      " |"
    );
  }

  function textTableBorder(widths) {
    return (
      "+" +
      widths
        .map(function (w) {
          return repeatChar("-", w + 2);
        })
        .join("+") +
      "+"
    );
  }

  // A real fixed-width box table, plain ASCII (+ - |) rather than Unicode
  // box-drawing characters - iMessage/SMS on iPad rendered the Unicode
  // border set as broken/missing glyphs ("open cells, no horizontal
  // lines"), which plain ASCII can't do since every font on earth has it.
  function buildTextTable(headers, rows, alignRight) {
    var widths = textTableColumnWidths(headers, rows);
    var border = textTableBorder(widths);
    var lines = [border, textTableRow(headers, widths), border];
    rows.forEach(function (r) {
      lines.push(textTableRow(r, widths, alignRight));
    });
    lines.push(border);
    return lines;
  }

  // Winner/"def."/loser collapsed into one capped "Result" cell instead
  // of three separate columns - keeps the table's width bounded no
  // matter how many players were on either side of the game.
  function gameLogTableRow(group) {
    var winners = joinNamesCapped(group.winnerNames || [], 2);
    var losers = joinNamesCapped(group.opponentNames || [], 2);
    var label = group.gameLabel + (group.count > 1 ? " ×" + group.count : "") + formatSkunkSuffix(group.skunkCount);
    var result = losers ? winners + " def. " + losers : winners + " won";
    return [formatReportGameTime(group.ts), result, label];
  }

  // Always YYYY-MM-DD, regardless of the active language - dates are a
  // global format standardization, not a per-language style. Accepts a
  // Date, an ISO timestamp string, or a bare YYYY-MM-DD date string.
  function formatDateISO(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function formatReportDateHeading(dateStr) {
    return formatDateISO(dateStr + "T00:00:00");
  }

  function buildDayReportTextTable(dateStr) {
    var data = computeDayReportData(dateStr);
    var lines = ["🎱 POOL MASTER COUNTER — DAY REPORT", formatReportDateHeading(dateStr), ""];
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("Notes");
      lines.push(notes);
      lines.push("");
    }
    if (data.players.length === 0 && data.tournaments.length === 0) {
      lines.push("No games recorded today.");
    } else {
      if (data.players.length) {
        var statHeaders = ["Player", "W", "L", "Rating", "Δ"];
        var statRows = data.players.map(function (p) {
          return [p.name, String(p.wins), String(p.losses), String(p.rating), formatReportRatingDelta(p.ratingDelta)];
        });
        buildTextTable(statHeaders, statRows, [false, true, true, true, true]).forEach(function (l) {
          lines.push(l);
        });
        lines.push("");
        var gameTypeCounts = {};
        data.games.forEach(function (g) {
          gameTypeCounts[g.gameLabel] = (gameTypeCounts[g.gameLabel] || 0) + 1;
        });
        var typesSummary = Object.keys(gameTypeCounts)
          .map(function (label) {
            return label + " ×" + gameTypeCounts[label];
          })
          .join(", ");
        lines.push("Total games: " + data.games.length + (typesSummary ? "   |   " + typesSummary : ""));
      }

      if (data.raceWins.length || data.tournaments.length || data.bestRunToday) {
        lines.push("");
        data.raceWins.forEach(function (g) {
          lines.push(formatReportRaceWinLine(g));
        });
        data.tournaments.forEach(function (t) {
          lines.push(formatReportTournamentLine(t));
        });
        if (data.bestRunToday) lines.push(formatReportBestRunLine(data.bestRunToday));
      }

      var earlierGames = data.games.filter(function (g) {
        return !g.isLive;
      });
      var liveGames = data.games.filter(function (g) {
        return g.isLive;
      });
      var hasBothGroups = earlierGames.length > 0 && liveGames.length > 0;
      var gameLogHeaders = ["Time", "Result", "Game"];

      if (data.games.length > 0) {
        lines.push("");
        lines.push("Game Log");
        if (hasBothGroups) {
          lines.push("");
          lines.push("Earlier session:");
          buildTextTable(gameLogHeaders, groupReportGames(earlierGames).map(gameLogTableRow)).forEach(function (l) {
            lines.push(l);
          });
          lines.push("");
          lines.push("Current session:");
          buildTextTable(gameLogHeaders, groupReportGames(liveGames).map(gameLogTableRow)).forEach(function (l) {
            lines.push(l);
          });
        } else {
          buildTextTable(gameLogHeaders, groupReportGames(data.games).map(gameLogTableRow)).forEach(function (l) {
            lines.push(l);
          });
        }
      }
    }
    return lines.join("\n");
  }

  // Leaderboard table only - no game-type breakdown, no game log at all,
  // the shortest of the three formats regardless of how many games were
  // played today.
  function buildDayReportTextCompact(dateStr) {
    var data = computeDayReportData(dateStr);
    var lines = ["🎱 " + formatReportDateHeading(dateStr) + " — Day Report", ""];
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("Notes: " + notes);
      lines.push("");
    }
    if (data.players.length === 0 && data.tournaments.length === 0) {
      lines.push("No games recorded today.");
    } else {
      if (data.players.length) {
        var statHeaders = ["Player", "W", "L", "Rating", "Δ"];
        var statRows = data.players.map(function (p) {
          return [p.name, String(p.wins), String(p.losses), String(p.rating), formatReportRatingDelta(p.ratingDelta)];
        });
        buildTextTable(statHeaders, statRows, [false, true, true, true, true]).forEach(function (l) {
          lines.push(l);
        });
        lines.push("");
        var skunkTotal = data.games.filter(function (g) {
          return g.skunk;
        }).length;
        var gamesLine = data.games.length + " game" + (data.games.length === 1 ? "" : "s") + " played today.";
        // No per-game log in this format to attach a marker to (see the
        // other 3 builders' formatSkunkSuffix calls) - a same-line total
        // instead.
        if (skunkTotal > 0) {
          gamesLine += " 🦨 " + skunkTotal + " skunk win" + (skunkTotal === 1 ? "" : "s") + ".";
        }
        lines.push(gamesLine);
      }
      if (data.raceWins.length || data.tournaments.length || data.bestRunToday) {
        lines.push("");
        data.raceWins.forEach(function (g) {
          lines.push(formatReportRaceWinLine(g));
        });
        data.tournaments.forEach(function (t) {
          lines.push(formatReportTournamentLine(t));
        });
        if (data.bestRunToday) lines.push(formatReportBestRunLine(data.bestRunToday));
      }
    }
    return lines.join("\n");
  }

  // Closest to the original report layout: full player list + a
  // checkmarked line per game, under section headers.
  function buildDayReportTextDetailed(dateStr) {
    var data = computeDayReportData(dateStr);
    var longDate;
    try {
      longDate = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    } catch (e) {
      longDate = formatReportDateHeading(dateStr);
    }
    var lines = ["🎱 Pool Master Counter — Day Report", longDate, "══════════════════════════", ""];
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("NOTES");
      lines.push(notes);
      lines.push("");
    }
    if (data.players.length === 0 && data.tournaments.length === 0) {
      lines.push("No games recorded today.");
    } else {
      if (data.players.length) {
        lines.push("PLAYERS TODAY");
        data.players.forEach(function (p) {
          var winWord = p.wins === 1 ? "win" : "wins";
          var lossWord = p.losses === 1 ? "loss" : "losses";
          lines.push("• " + p.name + " — " + p.wins + " " + winWord + ", " + p.losses + " " + lossWord + ", rating " + p.rating + " (" + formatReportRatingDelta(p.ratingDelta) + ")");
        });
        lines.push("");
        lines.push("SUMMARY");
        lines.push("Total games played: " + data.games.length);
        var gameTypeCounts = {};
        data.games.forEach(function (g) {
          gameTypeCounts[g.gameLabel] = (gameTypeCounts[g.gameLabel] || 0) + 1;
        });
        var typesSummary = Object.keys(gameTypeCounts)
          .map(function (label) {
            return label + " (" + gameTypeCounts[label] + ")";
          })
          .join(", ");
        if (typesSummary) lines.push("Games played: " + typesSummary);
      }

      if (data.raceWins.length || data.tournaments.length || data.bestRunToday) {
        lines.push("");
        lines.push("TOURNAMENTS");
        data.raceWins.forEach(function (g) {
          lines.push(formatReportRaceWinLine(g));
        });
        data.tournaments.forEach(function (t) {
          lines.push(formatReportTournamentLine(t));
        });
        if (data.bestRunToday) lines.push(formatReportBestRunLine(data.bestRunToday));
      }

      if (data.games.length > 0) {
        lines.push("");
        lines.push("GAME DETAILS");
        groupReportGames(data.games).forEach(function (g) {
          lines.push("✅ " + formatReportGameGroupLine(g));
        });
      }
    }
    return lines.join("\n");
  }

  // No columns to misalign, because there's nowhere for them to align to:
  // Mail and Messages compose boxes both render plain text in the
  // system's proportional font, so no character-grid table (any
  // character set) can ever line up there - that's a platform
  // constraint, not something fixable by picking different border
  // characters. One clean line per player/game reads fine regardless of
  // font. Used by Email Report and Text Report - Copy Report keeps
  // whichever of the three table formats is selected above, since
  // wherever it gets pasted is more likely to preserve a monospace font.
  function buildDayReportTextPlain(dateStr) {
    var data = computeDayReportData(dateStr);
    var lines = ["🎱 POOL MASTER COUNTER — DAY REPORT", formatReportDateHeading(dateStr), ""];
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("Notes: " + notes);
      lines.push("");
    }
    if (data.players.length === 0 && data.tournaments.length === 0) {
      lines.push("No games recorded today.");
    } else {
      if (data.players.length) {
        data.players.forEach(function (p) {
          lines.push(p.name + " — " + p.wins + "W-" + p.losses + "L, " + p.rating + " (" + formatReportRatingDelta(p.ratingDelta) + ")");
        });
        lines.push("");
        var gameTypeCounts = {};
        data.games.forEach(function (g) {
          gameTypeCounts[g.gameLabel] = (gameTypeCounts[g.gameLabel] || 0) + 1;
        });
        var typesSummary = Object.keys(gameTypeCounts)
          .map(function (label) {
            return label + " ×" + gameTypeCounts[label];
          })
          .join(", ");
        lines.push("Total games: " + data.games.length + (typesSummary ? " · " + typesSummary : ""));
      }

      if (data.raceWins.length || data.tournaments.length || data.bestRunToday) {
        lines.push("");
        data.raceWins.forEach(function (g) {
          lines.push(formatReportRaceWinLine(g));
        });
        data.tournaments.forEach(function (t) {
          lines.push(formatReportTournamentLine(t));
        });
        if (data.bestRunToday) lines.push(formatReportBestRunLine(data.bestRunToday));
      }

      if (data.games.length > 0) {
        lines.push("");
        lines.push("Game Log");
        groupReportGames(data.games).forEach(function (g) {
          var winners = joinNamesCapped(g.winnerNames || [], 2);
          var losers = joinNamesCapped(g.opponentNames || [], 2);
          var label = g.gameLabel + (g.count > 1 ? " ×" + g.count : "") + formatSkunkSuffix(g.skunkCount);
          var result = losers ? winners + " def. " + losers : winners + " won";
          lines.push(formatReportGameTime(g.ts) + " · " + result + " · " + label);
        });
      }
    }
    return lines.join("\n");
  }

  function printReportSectionHeading(text) {
    var h = document.createElement("h2");
    h.textContent = text;
    return h;
  }

  // A genuinely new render path, not a retrofit of the plain-text builders
  // above - the day report has no on-screen DOM anywhere else in the app
  // (buildDayReportText* only ever produce strings for clipboard/email/sms),
  // so this is the one place a printed page has real HTML - a real <table>
  // for the leaderboard instead of the monospace ASCII grid the "Table"
  // text format uses, since a browser's print layout doesn't need a
  // fixed-width font to keep columns aligned.
  function renderDayReportPrintView(dateStr) {
    var data = computeDayReportData(dateStr);
    dayReportPrintView.innerHTML = "";

    var title = document.createElement("h1");
    title.textContent = "🎱 Pool Master Counter — Day Report";
    dayReportPrintView.appendChild(title);

    var dateHeading = document.createElement("p");
    dateHeading.className = "print-report-date";
    dateHeading.textContent = formatReportDateHeading(dateStr);
    dayReportPrintView.appendChild(dateHeading);

    if (data.players.length === 0 && data.tournaments.length === 0) {
      var empty = document.createElement("p");
      empty.textContent = "No games recorded today.";
      dayReportPrintView.appendChild(empty);
    } else {
      if (data.players.length) {
        dayReportPrintView.appendChild(printReportSectionHeading("Players Today"));
        var table = document.createElement("table");
        table.className = "print-report-table";
        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        ["Player", "Wins", "Losses", "Rating", "Rating Change"].forEach(function (h) {
          var th = document.createElement("th");
          th.textContent = h;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = document.createElement("tbody");
        data.players.forEach(function (p) {
          var row = document.createElement("tr");
          [p.name, p.wins, p.losses, p.rating, formatReportRatingDelta(p.ratingDelta)].forEach(function (value) {
            var td = document.createElement("td");
            td.textContent = value;
            row.appendChild(td);
          });
          tbody.appendChild(row);
        });
        table.appendChild(tbody);
        dayReportPrintView.appendChild(table);
      }

      if (data.raceWins.length || data.tournaments.length || data.bestRunToday) {
        dayReportPrintView.appendChild(printReportSectionHeading("Tournaments"));
        var tournList = document.createElement("ul");
        data.raceWins.forEach(function (g) {
          var li = document.createElement("li");
          li.textContent = formatReportRaceWinLine(g);
          tournList.appendChild(li);
        });
        data.tournaments.forEach(function (t) {
          var li = document.createElement("li");
          li.textContent = formatReportTournamentLine(t);
          tournList.appendChild(li);
        });
        if (data.bestRunToday) {
          var runLi = document.createElement("li");
          runLi.textContent = formatReportBestRunLine(data.bestRunToday);
          tournList.appendChild(runLi);
        }
        dayReportPrintView.appendChild(tournList);
      }

      if (data.games.length > 0) {
        dayReportPrintView.appendChild(printReportSectionHeading("Game Details"));
        var gamesList = document.createElement("ul");
        groupReportGames(data.games).forEach(function (g) {
          var li = document.createElement("li");
          li.textContent = formatReportGameGroupLine(g);
          gamesList.appendChild(li);
        });
        dayReportPrintView.appendChild(gamesList);
      }
    }

    var notes = dayNotesTextarea.value;
    if (notes) {
      dayReportPrintView.appendChild(printReportSectionHeading("Notes"));
      var notesP = document.createElement("p");
      notesP.className = "print-report-notes";
      notesP.textContent = notes;
      dayReportPrintView.appendChild(notesP);
    }
  }

  function escapeHtmlForReport(value) {
    var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (ch) {
      return map[ch];
    });
  }

  // Reads this device's own currently-active theme (one of the 10 in
  // css/style.css) straight off :root's computed custom properties, so
  // the standalone colorful report always matches whatever look the app
  // itself has right now - no separate palette to keep in sync by hand.
  function readReportThemeTokens() {
    var style = getComputedStyle(document.documentElement);
    var names = [
      "--bg", "--bg-panel", "--bg-card", "--felt", "--felt-light", "--accent", "--accent-dark",
      "--danger", "--danger-dark", "--info", "--info-dark", "--text", "--text-dim", "--border",
      "--bg-glow", "--on-accent", "--on-felt-light", "--font-family"
    ];
    var tokens = {};
    names.forEach(function (name) {
      tokens[name] = style.getPropertyValue(name).trim();
    });
    return tokens;
  }

  // A genuinely designed, colorful standalone report - a real HTML
  // document (self-contained, no external fonts/scripts, so it still
  // opens correctly saved to disk or emailed with no connection) meant
  // to be viewed and shared, not printed. Built entirely separately from
  // renderDayReportPrintView above (which is deliberately plain/ink-
  // conscious for paper) and buildDayReportCsv (bare data, no styling
  // possible in a spreadsheet) - three different jobs, three different
  // builders, all sharing the same computeDayReportData source.
  // Single source of truth for the colorful report's content, consumed by
  // both buildDayReportColorfulHtml (the viewable page) and
  // buildDayReportImageBlob (the native PNG used when sharing straight
  // from the main app) - one pass over computeDayReportData, plain data
  // only, no HTML/canvas concerns here.
  function computeReportImageData(dateStr) {
    var data = computeDayReportData(dateStr);
    var tokens = readReportThemeTokens();

    var longDate;
    try {
      longDate = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
    } catch (e) {
      longDate = formatReportDateHeading(dateStr);
    }

    var maxWins =
      data.players.reduce(function (m, p) {
        return Math.max(m, p.wins);
      }, 0) || 1;
    var rankMedals = ["🥇", "🥈", "🥉"];

    var players = data.players.map(function (p, i) {
      var barPct = Math.round((p.wins / maxWins) * 100);
      var deltaClass = p.ratingDelta > 0 ? "up" : p.ratingDelta < 0 ? "down" : "flat";
      return {
        medal: rankMedals[i] || i + 1 + ".",
        name: p.name,
        rating: p.rating,
        deltaText: formatReportRatingDelta(p.ratingDelta),
        deltaClass: deltaClass,
        wins: p.wins,
        losses: p.losses,
        barPct: barPct
      };
    });

    var highlights = [];
    data.raceWins.forEach(function (g) {
      var names = joinNamesForReport(((g.winnerNames && g.winnerNames.length ? g.winnerNames : g.teammateNames) || []));
      highlights.push("🏆 " + names + " won the Race to " + g.raceTarget + " session!");
    });
    data.tournaments.forEach(function (t) {
      var champs = joinNamesForReport(t.championNames || []);
      highlights.push("👑 " + champs + " won the " + tournamentFormatLabel(t.format) + " tournament (" + (t.players || []).length + " players)");
    });

    var games = groupReportGames(data.games).map(function (g) {
      var winners = joinNamesForReport(g.winnerNames || []);
      var losers = joinNamesForReport(g.opponentNames || []);
      var countText = g.count > 1 ? " ×" + g.count : "";
      var label = g.gameLabel + countText;
      var plainResult = losers ? winners + " def. " + losers : winners + " won";
      var skunkText = g.skunkCount > 0 ? " 🦨×" + g.skunkCount : "";
      return {
        time: formatReportGameTime(g.ts),
        winners: winners,
        losers: losers,
        label: label,
        skunkCount: g.skunkCount,
        // Flat plain-text form for the canvas renderer, which can't draw
        // the HTML view's bolded-winner markup - built once here so both
        // consumers agree on the exact wording.
        desc: plainResult + " · " + label + skunkText
      };
    });

    var result = {
      dateStr: dateStr,
      longDate: longDate,
      generatedAt: formatTimestamp(new Date().toISOString(), true),
      tokens: tokens,
      players: players,
      highlights: highlights,
      games: games,
      notes: dayNotesTextarea.value || null
    };
    archiveDayReport(result);
    return result;
  }

  function buildDayReportColorfulHtml(dateStr) {
    return buildDayReportColorfulHtmlFromData(computeReportImageData(dateStr));
  }

  function buildDayReportColorfulHtmlFromData(reportImageData) {
    var tokens = reportImageData.tokens;
    var rootVars = Object.keys(tokens)
      .map(function (k) {
        return k + ": " + (tokens[k] || "") + ";";
      })
      .join(" ");

    var leaderboardHtml = reportImageData.players
      .map(function (p) {
        return (
          '<div class="player-card">' +
          '<div class="rank">' + p.medal + "</div>" +
          '<div class="card-main">' +
          '<div class="card-top">' +
          '<span class="name">' + escapeHtmlForReport(p.name) + "</span>" +
          '<span class="rating">' + p.rating + ' <span class="delta ' + p.deltaClass + '">' + escapeHtmlForReport(p.deltaText) + "</span></span>" +
          "</div>" +
          '<div class="record"><span class="win">' + p.wins + 'W</span> · <span class="loss">' + p.losses + "L</span></div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + p.barPct + '%"></div></div>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    var highlightsHtml = reportImageData.highlights
      .map(function (line) {
        return '<div class="highlight-card">' + escapeHtmlForReport(line) + "</div>";
      })
      .join("");

    var gamesHtml = reportImageData.games
      .map(function (g) {
        var resultHtml = g.losers
          ? "<strong>" + escapeHtmlForReport(g.winners) + "</strong> def. " + escapeHtmlForReport(g.losers)
          : "<strong>" + escapeHtmlForReport(g.winners) + "</strong> won";
        var skunkHtml = g.skunkCount > 0 ? ' <span class="skunk-badge">🦨×' + g.skunkCount + "</span>" : "";
        return (
          '<div class="game-row">' +
          '<span class="time">' + escapeHtmlForReport(g.time) + "</span>" +
          '<span class="desc">' + resultHtml + " · " + escapeHtmlForReport(g.label) + skunkHtml + "</span>" +
          "</div>"
        );
      })
      .join("");

    var notesHtml = reportImageData.notes
      ? '<div class="section"><h2>Notes</h2><div class="notes-card">' + escapeHtmlForReport(reportImageData.notes) + "</div></div>"
      : "";

    return (
      "<!DOCTYPE html>\n" +
      '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>Pool Master Counter — " + escapeHtmlForReport(formatReportDateHeading(reportImageData.dateStr)) + "</title>" +
      "<style>" +
      ":root { " + rootVars + " }" +
      "* { box-sizing: border-box; }" +
      "body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-family); }" +
      ".wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }" +
      ".hero { background: linear-gradient(135deg, var(--felt), var(--felt-light)); border-radius: 20px; padding: 32px 28px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,.35); }" +
      ".hero h1 { margin: 0; font-size: 1.7rem; }" +
      ".hero .date { margin-top: 8px; font-size: 1.05rem; opacity: .9; }" +
      ".hero .tagline { margin-top: 14px; font-style: italic; opacity: .65; font-size: .9rem; }" +
      ".section { margin-top: 32px; }" +
      ".section h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); margin: 0 0 14px; }" +
      ".leaderboard { display: flex; flex-direction: column; gap: 10px; }" +
      ".player-card { display: flex; align-items: center; gap: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; }" +
      ".player-card .rank { font-size: 1.3rem; width: 30px; flex-shrink: 0; text-align: center; }" +
      ".player-card .card-main { flex: 1; min-width: 0; }" +
      ".player-card .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }" +
      ".player-card .name { font-weight: 700; font-size: 1.02rem; }" +
      ".player-card .rating { font-variant-numeric: tabular-nums; font-size: .85rem; background: var(--bg-panel); padding: 2px 9px; border-radius: 999px; flex-shrink: 0; }" +
      ".player-card .delta.up { color: var(--accent); }" +
      ".player-card .delta.down { color: var(--danger); }" +
      ".player-card .delta.flat { color: var(--text-dim); }" +
      ".player-card .record { margin-top: 4px; font-size: .88rem; font-variant-numeric: tabular-nums; color: var(--text-dim); }" +
      ".player-card .win { color: var(--accent); font-weight: 700; }" +
      ".player-card .loss { color: var(--danger); font-weight: 700; }" +
      ".bar-track { margin-top: 8px; height: 6px; background: var(--bg-panel); border-radius: 4px; overflow: hidden; }" +
      ".bar-fill { height: 100%; background: var(--accent); }" +
      ".highlight-card { background: linear-gradient(135deg, var(--accent-dark), var(--accent)); color: var(--on-accent); border-radius: 14px; padding: 14px 18px; margin-bottom: 10px; font-weight: 600; }" +
      ".highlight-card:last-child { margin-bottom: 0; }" +
      ".game-log { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }" +
      ".game-row { display: flex; gap: 14px; padding: 11px 16px; border-bottom: 1px solid var(--border); font-size: .9rem; }" +
      ".game-row:last-child { border-bottom: none; }" +
      ".game-row .time { color: var(--text-dim); font-variant-numeric: tabular-nums; width: 66px; flex-shrink: 0; }" +
      ".skunk-badge { color: var(--info); }" +
      ".notes-card { background: var(--bg-card); border-left: 4px solid var(--accent); border-radius: 8px; padding: 16px 18px; font-style: italic; white-space: pre-wrap; }" +
      ".empty-note { color: var(--text-dim); font-style: italic; }" +
      "footer { margin-top: 40px; text-align: center; color: var(--text-dim); font-size: .78rem; }" +
      ".toolbar { display: flex; justify-content: flex-end; margin-bottom: 14px; }" +
      ".share-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 8px 18px; font-size: .85rem; font-family: inherit; cursor: pointer; }" +
      ".share-btn:hover { border-color: var(--accent); color: var(--accent); }" +
      "@media print { .toolbar { display: none; } }" +
      "</style></head><body><div class=\"wrap\">" +
      '<div class="toolbar"><button type="button" class="share-btn" id="shareReportBtn">📤 Share</button></div>' +
      '<div class="hero"><h1>🎱 Pool Master Counter</h1><div class="date">' +
      escapeHtmlForReport(reportImageData.longDate) +
      '</div><div class="tagline">Don\'t get cocky!</div></div>' +
      (reportImageData.players.length
        ? '<div class="section"><h2>Leaderboard</h2><div class="leaderboard">' + leaderboardHtml + "</div></div>"
        : '<div class="section"><p class="empty-note">No games recorded today.</p></div>') +
      (highlightsHtml ? '<div class="section"><h2>Highlights</h2>' + highlightsHtml + "</div>" : "") +
      (gamesHtml ? '<div class="section"><h2>Game Log</h2><div class="game-log">' + gamesHtml + "</div></div>" : "") +
      notesHtml +
      "<footer>Generated " + escapeHtmlForReport(reportImageData.generatedAt) + " · Pool Master Counter</footer>" +
      "</div>" +
      buildColorfulReportShareScript(reportImageData) +
      "</body></html>"
    );
  }

  function reportCanvasRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function reportCanvasWrapText(ctx, text, maxWidth) {
    var words = text.split(/\s+/);
    var lines = [];
    var current = "";
    words.forEach(function (word) {
      var test = current ? current + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function reportCanvasTruncate(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + "…";
  }

  // The native counterpart to buildColorfulReportShareScript's embedded
  // canvas renderer below - same layout/drawing logic, written as real JS
  // instead of a string, since this one runs directly in the main app
  // (used when the "Attach colorful report image" checkbox is on) rather
  // than inside the standalone report tab, which has no access back here.
  function buildReportCanvasFromData(reportData) {
    var tokens = reportData.tokens;
    function tok(name, fallback) {
      return tokens[name] || fallback;
    }
    var font = tok("--font-family", "sans-serif");
    var W = 680,
      PAD = 28,
      CW = W - PAD * 2,
      SCALE = 2;
    var HERO_H = 128,
      SECTION_GAP = 30,
      LABEL_H = 26,
      PLAYER_ROW_H = 78,
      PLAYER_GAP = 10;
    var HIGHLIGHT_ROW_H = 40,
      HIGHLIGHT_GAP = 8,
      GAME_ROW_H = 30,
      NOTES_LINE_H = 20,
      NOTES_PAD = 18,
      FOOTER_H = 56;

    var measureCanvas = document.createElement("canvas");
    var mctx = measureCanvas.getContext("2d");
    var notesLines = [];
    if (reportData.notes) {
      mctx.font = "italic 14px " + font;
      notesLines = reportCanvasWrapText(mctx, reportData.notes, CW - 36);
    }

    var hasPlayers = reportData.players.length > 0;
    var y = HERO_H;
    if (hasPlayers) {
      y += SECTION_GAP + LABEL_H + reportData.players.length * PLAYER_ROW_H;
    } else {
      y += SECTION_GAP + 30;
    }
    if (reportData.highlights.length) {
      y += SECTION_GAP + LABEL_H + reportData.highlights.length * HIGHLIGHT_ROW_H;
    }
    var logH = 0;
    if (reportData.games.length) {
      logH = reportData.games.length * GAME_ROW_H + 16;
      y += SECTION_GAP + LABEL_H + logH;
    }
    var notesCardH = 0;
    if (reportData.notes) {
      notesCardH = NOTES_PAD * 2 + notesLines.length * NOTES_LINE_H;
      y += SECTION_GAP + LABEL_H + notesCardH;
    }
    y += FOOTER_H;

    var canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = y * SCALE;
    var ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = tok("--bg", "#1a0a0a");
    ctx.fillRect(0, 0, W, y);

    var grad = ctx.createLinearGradient(0, 0, W, HERO_H);
    grad.addColorStop(0, tok("--felt", "#5c0f14"));
    grad.addColorStop(1, tok("--felt-light", "#8a1a1f"));
    ctx.fillStyle = grad;
    reportCanvasRoundRect(ctx, PAD, 0, CW, HERO_H, 18);
    ctx.fill();
    ctx.fillStyle = tok("--text", "#f6efe9");
    ctx.textAlign = "center";
    ctx.font = "bold 24px " + font;
    ctx.fillText("🎱 Pool Master Counter", W / 2, 48);
    ctx.font = "16px " + font;
    ctx.globalAlpha = 0.9;
    ctx.fillText(reportData.longDate, W / 2, 76);
    ctx.globalAlpha = 0.65;
    ctx.font = "italic 13px " + font;
    ctx.fillText("Don’t get cocky!", W / 2, 100);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    var cy = HERO_H + SECTION_GAP;

    function drawLabel(text) {
      ctx.fillStyle = tok("--text-dim", "#c9a2a2");
      ctx.font = "bold 12px " + font;
      ctx.fillText(text.toUpperCase(), PAD, cy + 12);
      cy += LABEL_H;
    }

    if (hasPlayers) {
      drawLabel("Leaderboard");
      reportData.players.forEach(function (p) {
        var cardY = cy,
          cardH = PLAYER_ROW_H - PLAYER_GAP;
        ctx.fillStyle = tok("--bg-card", "#2e1414");
        reportCanvasRoundRect(ctx, PAD, cardY, CW, cardH, 12);
        ctx.fill();
        ctx.strokeStyle = tok("--border", "#4a1e1e");
        ctx.lineWidth = 1;
        reportCanvasRoundRect(ctx, PAD, cardY, CW, cardH, 12);
        ctx.stroke();

        ctx.fillStyle = tok("--text", "#f6efe9");
        ctx.font = "20px " + font;
        ctx.textAlign = "center";
        ctx.fillText(p.medal, PAD + 26, cardY + 34);
        ctx.textAlign = "left";

        var contentX = PAD + 54,
          contentW = CW - 54 - 18;
        ctx.font = "bold 15px " + font;
        ctx.fillStyle = tok("--text", "#f6efe9");
        ctx.fillText(reportCanvasTruncate(ctx, p.name, contentW - 90), contentX, cardY + 22);

        ctx.font = "13px " + font;
        ctx.textAlign = "right";
        var deltaColor = p.deltaClass === "up" ? tok("--accent", "#e8b923") : p.deltaClass === "down" ? tok("--danger", "#ff5252") : tok("--text-dim", "#c9a2a2");
        ctx.fillStyle = deltaColor;
        ctx.fillText(p.deltaText, PAD + CW - 18, cardY + 22);
        var deltaW = ctx.measureText(p.deltaText).width;
        ctx.fillStyle = tok("--text-dim", "#c9a2a2");
        ctx.fillText(p.rating + "  ", PAD + CW - 18 - deltaW, cardY + 22);
        ctx.textAlign = "left";

        ctx.font = "13px " + font;
        ctx.fillStyle = tok("--accent", "#e8b923");
        var winsText = p.wins + "W";
        ctx.fillText(winsText, contentX, cardY + 42);
        var winsW = ctx.measureText(winsText).width;
        ctx.fillStyle = tok("--text-dim", "#c9a2a2");
        ctx.fillText(" · ", contentX + winsW, cardY + 42);
        var sepW = ctx.measureText(" · ").width;
        ctx.fillStyle = tok("--danger", "#ff5252");
        ctx.fillText(p.losses + "L", contentX + winsW + sepW, cardY + 42);

        var barY = cardY + 54,
          barW = contentW;
        ctx.fillStyle = tok("--bg-panel", "#241010");
        reportCanvasRoundRect(ctx, contentX, barY, barW, 5, 3);
        ctx.fill();
        ctx.fillStyle = tok("--accent", "#e8b923");
        var fillW = Math.max(4, (barW * p.barPct) / 100);
        reportCanvasRoundRect(ctx, contentX, barY, fillW, 5, 3);
        ctx.fill();

        cy += PLAYER_ROW_H;
      });
    } else {
      ctx.fillStyle = tok("--text-dim", "#c9a2a2");
      ctx.font = "italic 14px " + font;
      ctx.fillText("No games recorded today.", PAD, cy + 14);
      cy += 30;
    }

    if (reportData.highlights.length) {
      cy += SECTION_GAP - PLAYER_GAP;
      drawLabel("Highlights");
      reportData.highlights.forEach(function (line) {
        var g = ctx.createLinearGradient(PAD, cy, PAD + CW, cy);
        g.addColorStop(0, tok("--accent-dark", "#b8890f"));
        g.addColorStop(1, tok("--accent", "#e8b923"));
        ctx.fillStyle = g;
        reportCanvasRoundRect(ctx, PAD, cy, CW, HIGHLIGHT_ROW_H - HIGHLIGHT_GAP, 12);
        ctx.fill();
        ctx.fillStyle = tok("--on-accent", "#241a00");
        ctx.font = "bold 13px " + font;
        ctx.fillText(reportCanvasTruncate(ctx, line, CW - 32), PAD + 16, cy + 21);
        cy += HIGHLIGHT_ROW_H;
      });
    }

    if (reportData.games.length) {
      cy += SECTION_GAP - HIGHLIGHT_GAP;
      drawLabel("Game Log");
      ctx.fillStyle = tok("--bg-card", "#2e1414");
      reportCanvasRoundRect(ctx, PAD, cy, CW, logH, 12);
      ctx.fill();
      ctx.strokeStyle = tok("--border", "#4a1e1e");
      reportCanvasRoundRect(ctx, PAD, cy, CW, logH, 12);
      ctx.stroke();
      var rowY = cy + 8;
      reportData.games.forEach(function (g, i) {
        ctx.font = "12px " + font;
        ctx.fillStyle = tok("--text-dim", "#c9a2a2");
        ctx.fillText(g.time, PAD + 16, rowY + 20);
        ctx.font = "13px " + font;
        ctx.fillStyle = g.skunkCount > 0 ? tok("--info", "#5aa9e6") : tok("--text", "#f6efe9");
        ctx.fillText(reportCanvasTruncate(ctx, g.desc, CW - 100), PAD + 78, rowY + 20);
        if (i < reportData.games.length - 1) {
          ctx.strokeStyle = tok("--border", "#4a1e1e");
          ctx.beginPath();
          ctx.moveTo(PAD + 16, rowY + GAME_ROW_H - 4);
          ctx.lineTo(PAD + CW - 16, rowY + GAME_ROW_H - 4);
          ctx.stroke();
        }
        rowY += GAME_ROW_H;
      });
      cy += logH;
    }

    if (reportData.notes) {
      cy += SECTION_GAP;
      drawLabel("Notes");
      ctx.fillStyle = tok("--bg-card", "#2e1414");
      reportCanvasRoundRect(ctx, PAD, cy, CW, notesCardH, 8);
      ctx.fill();
      ctx.fillStyle = tok("--accent", "#e8b923");
      ctx.fillRect(PAD, cy, 4, notesCardH);
      ctx.fillStyle = tok("--text", "#f6efe9");
      ctx.font = "italic 14px " + font;
      var ny = cy + NOTES_PAD + 12;
      notesLines.forEach(function (line) {
        ctx.fillText(line, PAD + 18, ny);
        ny += NOTES_LINE_H;
      });
      cy += notesCardH;
    }

    ctx.textAlign = "center";
    ctx.font = "11px " + font;
    ctx.fillStyle = tok("--text-dim", "#c9a2a2");
    ctx.fillText("Generated " + reportData.generatedAt + " · Pool Master Counter", W / 2, cy + 32);
    ctx.textAlign = "left";

    return canvas;
  }

  // Promise<Blob|null> - resolves null (rather than rejecting) on any
  // drawing failure, so a caller building a share-attachment list can
  // just skip a null entry instead of needing its own try/catch.
  function buildDayReportImageBlob(dateStr) {
    return buildDayReportImageBlobFromData(computeReportImageData(dateStr));
  }

  function buildDayReportImageBlobFromData(reportImageData) {
    return new Promise(function (resolve) {
      try {
        var canvas = buildReportCanvasFromData(reportImageData);
        canvas.toBlob(function (blob) {
          resolve(blob || null);
        }, "image/png");
      } catch (e) {
        console.warn("Could not build colorful report image.", e);
        resolve(null);
      }
    });
  }

  // The report is a fully separate document once opened (its own tab, its
  // own JS context) - it has no access back to this app's functions, so it
  // needs its own copy of the canShare({files})-first, download-fallback
  // pattern shareReportWithAttachments uses above. Sharing the raw
  // .html file turned out to be a dead end in practice: Messages on Mac has
  // no preview for an .html attachment, so it just shows a generic gray
  // file box - not useful to the person receiving it. This instead draws
  // the same leaderboard/highlights/game-log/notes as a real PNG image on
  // an offscreen <canvas> (plain 2D drawing, not a DOM screenshot, so it
  // renders identically everywhere with no html2canvas-style dependency)
  // and shares/downloads THAT - something every messaging app already
  // knows how to preview inline as a photo. reportData is the same plain
  // player/highlight/game/notes arrays buildDayReportColorfulHtml already
  // builds for the HTML view, embedded here as JSON so this canvas
  // renderer needs no access back to the app's own data functions.
  function buildColorfulReportShareScript(reportData) {
    var filename = "pool-master-counter-report-" + reportData.dateStr + ".png";
    // Escaping "<" (not just "</script>") is the standard safe way to embed
    // JSON inside a <script> block - covers a player name that happens to
    // contain "</script>" verbatim, and any other "<..." sequence an HTML
    // parser could misread while scanning for the tag's end.
    var dataJson = JSON.stringify(reportData).replace(/</g, "\\u003c");
    var lines = [
      "<" + "script>",
      "(function(){",
      "var DATA=" + dataJson + ";",
      'var filename=' + JSON.stringify(filename) + ";",
      "var W=680,PAD=28,CW=W-PAD*2,SCALE=2;",
      "var HERO_H=128,SECTION_GAP=30,LABEL_H=26,PLAYER_ROW_H=78,PLAYER_GAP=10;",
      "var HIGHLIGHT_ROW_H=40,HIGHLIGHT_GAP=8,GAME_ROW_H=30,NOTES_LINE_H=20,NOTES_PAD=18,FOOTER_H=56;",
      "function tok(name,fallback){return DATA.tokens[name]||fallback;}",
      "function roundRect(ctx,x,y,w,h,r){",
      "ctx.beginPath();",
      "ctx.moveTo(x+r,y);",
      "ctx.arcTo(x+w,y,x+w,y+h,r);",
      "ctx.arcTo(x+w,y+h,x,y+h,r);",
      "ctx.arcTo(x,y+h,x,y,r);",
      "ctx.arcTo(x,y,x+w,y,r);",
      "ctx.closePath();",
      "}",
      "function wrapText(ctx,text,maxWidth){",
      'var words=text.split(/\\s+/);',
      'var lines=[],current="";',
      "for(var i=0;i<words.length;i++){",
      "var word=words[i];",
      'var test=current?current+" "+word:word;',
      "if(ctx.measureText(test).width>maxWidth&&current){lines.push(current);current=word;}",
      "else{current=test;}",
      "}",
      "if(current)lines.push(current);",
      "return lines;",
      "}",
      "function truncate(ctx,text,maxWidth){",
      "if(ctx.measureText(text).width<=maxWidth)return text;",
      "var t=text;",
      'while(t.length>1&&ctx.measureText(t+"…").width>maxWidth){t=t.slice(0,-1);}',
      'return t+"…";',
      "}",
      "function renderReportPNG(){",
      'var font=DATA.tokens["--font-family"]||"sans-serif";',
      'var measureCanvas=document.createElement("canvas");',
      'var mctx=measureCanvas.getContext("2d");',
      "var notesLines=[];",
      "if(DATA.notes){",
      'mctx.font="italic 14px "+font;',
      "notesLines=wrapText(mctx,DATA.notes,CW-36);",
      "}",
      "var hasPlayers=DATA.players.length>0;",
      "var y=HERO_H;",
      "if(hasPlayers){y+=SECTION_GAP+LABEL_H+DATA.players.length*PLAYER_ROW_H;}",
      "else{y+=SECTION_GAP+30;}",
      "if(DATA.highlights.length){y+=SECTION_GAP+LABEL_H+DATA.highlights.length*HIGHLIGHT_ROW_H;}",
      "var logH=0;",
      "if(DATA.games.length){logH=DATA.games.length*GAME_ROW_H+16;y+=SECTION_GAP+LABEL_H+logH;}",
      "var notesCardH=0;",
      "if(DATA.notes){notesCardH=NOTES_PAD*2+notesLines.length*NOTES_LINE_H;y+=SECTION_GAP+LABEL_H+notesCardH;}",
      "y+=FOOTER_H;",
      'var canvas=document.createElement("canvas");',
      "canvas.width=W*SCALE;canvas.height=y*SCALE;",
      'var ctx=canvas.getContext("2d");',
      "ctx.scale(SCALE,SCALE);",
      'ctx.fillStyle=tok("--bg","#1a0a0a");',
      "ctx.fillRect(0,0,W,y);",
      "var grad=ctx.createLinearGradient(0,0,W,HERO_H);",
      'grad.addColorStop(0,tok("--felt","#5c0f14"));',
      'grad.addColorStop(1,tok("--felt-light","#8a1a1f"));',
      "ctx.fillStyle=grad;",
      "roundRect(ctx,PAD,0,CW,HERO_H,18);ctx.fill();",
      'ctx.fillStyle=tok("--text","#f6efe9");',
      'ctx.textAlign="center";',
      'ctx.font="bold 24px "+font;',
      'ctx.fillText("🎱 Pool Master Counter",W/2,48);',
      'ctx.font="16px "+font;',
      "ctx.globalAlpha=0.9;",
      "ctx.fillText(DATA.longDate,W/2,76);",
      "ctx.globalAlpha=0.65;",
      'ctx.font="italic 13px "+font;',
      'ctx.fillText("Don’t get cocky!",W/2,100);',
      "ctx.globalAlpha=1;",
      'ctx.textAlign="left";',
      "var cy=HERO_H+SECTION_GAP;",
      "function drawLabel(text){",
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      'ctx.font="bold 12px "+font;',
      "ctx.fillText(text.toUpperCase(),PAD,cy+12);",
      "cy+=LABEL_H;",
      "}",
      "if(hasPlayers){",
      'drawLabel("Leaderboard");',
      "DATA.players.forEach(function(p){",
      "var cardY=cy,cardH=PLAYER_ROW_H-PLAYER_GAP;",
      'ctx.fillStyle=tok("--bg-card","#2e1414");',
      "roundRect(ctx,PAD,cardY,CW,cardH,12);ctx.fill();",
      'ctx.strokeStyle=tok("--border","#4a1e1e");ctx.lineWidth=1;',
      "roundRect(ctx,PAD,cardY,CW,cardH,12);ctx.stroke();",
      'ctx.fillStyle=tok("--text","#f6efe9");',
      'ctx.font="20px "+font;ctx.textAlign="center";',
      "ctx.fillText(p.medal,PAD+26,cardY+34);",
      'ctx.textAlign="left";',
      "var contentX=PAD+54,contentW=CW-54-18;",
      'ctx.font="bold 15px "+font;',
      'ctx.fillStyle=tok("--text","#f6efe9");',
      "ctx.fillText(truncate(ctx,p.name,contentW-90),contentX,cardY+22);",
      'ctx.font="13px "+font;ctx.textAlign="right";',
      'var deltaColor=p.deltaClass==="up"?tok("--accent","#e8b923"):p.deltaClass==="down"?tok("--danger","#ff5252"):tok("--text-dim","#c9a2a2");',
      "ctx.fillStyle=deltaColor;",
      "ctx.fillText(p.deltaText,PAD+CW-18,cardY+22);",
      "var deltaW=ctx.measureText(p.deltaText).width;",
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      'ctx.fillText(p.rating+"  ",PAD+CW-18-deltaW,cardY+22);',
      'ctx.textAlign="left";',
      'ctx.font="13px "+font;',
      'ctx.fillStyle=tok("--accent","#e8b923");',
      'var winsText=p.wins+"W";',
      "ctx.fillText(winsText,contentX,cardY+42);",
      "var winsW=ctx.measureText(winsText).width;",
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      'ctx.fillText(" · ",contentX+winsW,cardY+42);',
      'var sepW=ctx.measureText(" · ").width;',
      'ctx.fillStyle=tok("--danger","#ff5252");',
      'ctx.fillText(p.losses+"L",contentX+winsW+sepW,cardY+42);',
      "var barY=cardY+54,barW=contentW;",
      'ctx.fillStyle=tok("--bg-panel","#241010");',
      "roundRect(ctx,contentX,barY,barW,5,3);ctx.fill();",
      'ctx.fillStyle=tok("--accent","#e8b923");',
      "var fillW=Math.max(4,barW*p.barPct/100);",
      "roundRect(ctx,contentX,barY,fillW,5,3);ctx.fill();",
      "cy+=PLAYER_ROW_H;",
      "});",
      "}else{",
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      'ctx.font="italic 14px "+font;',
      'ctx.fillText("No games recorded today.",PAD,cy+14);',
      "cy+=30;",
      "}",
      "if(DATA.highlights.length){",
      "cy+=SECTION_GAP-PLAYER_GAP;",
      'drawLabel("Highlights");',
      "DATA.highlights.forEach(function(line){",
      "var g=ctx.createLinearGradient(PAD,cy,PAD+CW,cy);",
      'g.addColorStop(0,tok("--accent-dark","#b8890f"));',
      'g.addColorStop(1,tok("--accent","#e8b923"));',
      "ctx.fillStyle=g;",
      "roundRect(ctx,PAD,cy,CW,HIGHLIGHT_ROW_H-HIGHLIGHT_GAP,12);ctx.fill();",
      'ctx.fillStyle=tok("--on-accent","#241a00");',
      'ctx.font="bold 13px "+font;',
      "ctx.fillText(truncate(ctx,line,CW-32),PAD+16,cy+21);",
      "cy+=HIGHLIGHT_ROW_H;",
      "});",
      "}",
      "if(DATA.games.length){",
      "cy+=SECTION_GAP-HIGHLIGHT_GAP;",
      'drawLabel("Game Log");',
      'ctx.fillStyle=tok("--bg-card","#2e1414");',
      "roundRect(ctx,PAD,cy,CW,logH,12);ctx.fill();",
      'ctx.strokeStyle=tok("--border","#4a1e1e");',
      "roundRect(ctx,PAD,cy,CW,logH,12);ctx.stroke();",
      "var rowY=cy+8;",
      "DATA.games.forEach(function(g,i){",
      'ctx.font="12px "+font;',
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      "ctx.fillText(g.time,PAD+16,rowY+20);",
      'ctx.font="13px "+font;',
      'ctx.fillStyle=g.skunkCount>0?tok("--info","#5aa9e6"):tok("--text","#f6efe9");',
      "ctx.fillText(truncate(ctx,g.desc,CW-100),PAD+78,rowY+20);",
      "if(i<DATA.games.length-1){",
      'ctx.strokeStyle=tok("--border","#4a1e1e");',
      "ctx.beginPath();",
      "ctx.moveTo(PAD+16,rowY+GAME_ROW_H-4);",
      "ctx.lineTo(PAD+CW-16,rowY+GAME_ROW_H-4);",
      "ctx.stroke();",
      "}",
      "rowY+=GAME_ROW_H;",
      "});",
      "cy+=logH;",
      "}",
      "if(DATA.notes){",
      "cy+=SECTION_GAP;",
      'drawLabel("Notes");',
      'ctx.fillStyle=tok("--bg-card","#2e1414");',
      "roundRect(ctx,PAD,cy,CW,notesCardH,8);ctx.fill();",
      'ctx.fillStyle=tok("--accent","#e8b923");',
      "ctx.fillRect(PAD,cy,4,notesCardH);",
      'ctx.fillStyle=tok("--text","#f6efe9");',
      'ctx.font="italic 14px "+font;',
      "var ny=cy+NOTES_PAD+12;",
      "notesLines.forEach(function(line){ctx.fillText(line,PAD+18,ny);ny+=NOTES_LINE_H;});",
      "cy+=notesCardH;",
      "}",
      'ctx.textAlign="center";',
      'ctx.font="11px "+font;',
      'ctx.fillStyle=tok("--text-dim","#c9a2a2");',
      'ctx.fillText("Generated "+DATA.generatedAt+" · Pool Master Counter",W/2,cy+32);',
      'ctx.textAlign="left";',
      "return canvas;",
      "}",
      "function fallbackDownload(blob){",
      "var url=URL.createObjectURL(blob);",
      'var a=document.createElement("a");',
      "a.href=url;a.download=filename;",
      "document.body.appendChild(a);a.click();",
      "setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1000);",
      "}",
      "function shareIt(){",
      'var btn=document.getElementById("shareReportBtn");',
      "var originalLabel=btn.textContent;",
      'btn.textContent="⏳ Preparing…";',
      "btn.disabled=true;",
      "setTimeout(function(){",
      "try{",
      "var canvas=renderReportPNG();",
      "canvas.toBlob(function(blob){",
      "btn.textContent=originalLabel;btn.disabled=false;",
      "if(!blob)return;",
      'var file=new File([blob],filename,{type:"image/png"});',
      "if(navigator.canShare&&navigator.canShare({files:[file]})){",
      'navigator.share({files:[file],title:document.title}).catch(function(err){',
      'if(err&&err.name==="AbortError")return;',
      "fallbackDownload(blob);",
      "});",
      "}else{fallbackDownload(blob);}",
      '},"image/png");',
      "}catch(e){btn.textContent=originalLabel;btn.disabled=false;}",
      "},10);",
      "}",
      'document.getElementById("shareReportBtn").addEventListener("click",shareIt);',
      "})();",
      "</" + "script>"
    ];
    return lines.join("\n");
  }

  // Opened in a new tab rather than downloaded outright - the point is to
  // view it first; from there the browser's own Save/Print/Share affords
  // everything "share" needs, on a real self-contained HTML document.
  function openDayReportColorful() {
    openDayReportColorfulFromData(computeReportImageData(todayDateStr()));
  }

  // Shared by the live "today" button and the Report Archive's View
  // action - the archive path passes in already-saved data (re-tokenized
  // with the current theme by hydrateArchivedReportImageData) instead of
  // computeReportImageData, since the latter can only ever see the last
  // 24 hours of live game history and would return nothing for a past day.
  function openDayReportColorfulFromData(reportImageData) {
    var html = buildDayReportColorfulHtmlFromData(reportImageData);
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  var DAY_REPORT_FORMAT_KEY = "poolMasterCounter.dayReportFormat.v1";

  function loadDayReportFormat() {
    try {
      var v = localStorage.getItem(DAY_REPORT_FORMAT_KEY);
      return v === "compact" || v === "detailed" || v === "table" ? v : "table";
    } catch (e) {
      return "table";
    }
  }

  function saveDayReportFormat(format) {
    try {
      localStorage.setItem(DAY_REPORT_FORMAT_KEY, format);
    } catch (e) {
      console.warn("Could not save day report format.", e);
    }
  }

  var dayReportFormat = loadDayReportFormat();

  var DAY_REPORT_ATTACH_BACKUP_KEY = "poolMasterCounter.dayReportAttachBackup.v1";

  function loadDayReportAttachBackup() {
    try {
      var v = localStorage.getItem(DAY_REPORT_ATTACH_BACKUP_KEY);
      return v === null ? true : v === "true";
    } catch (e) {
      return true;
    }
  }

  function saveDayReportAttachBackup(value) {
    try {
      localStorage.setItem(DAY_REPORT_ATTACH_BACKUP_KEY, value ? "true" : "false");
    } catch (e) {
      console.warn("Could not save day report attach-backup preference.", e);
    }
  }

  // Opt-in (default off, unlike the backup checkbox's default-on) - this
  // changes what Email/Text/Share Report do only once someone deliberately
  // turns it on, so today's behavior stays exactly as it was for everyone
  // who doesn't.
  var DAY_REPORT_ATTACH_COLORFUL_KEY = "poolMasterCounter.dayReportAttachColorful.v1";

  function loadDayReportAttachColorful() {
    try {
      return localStorage.getItem(DAY_REPORT_ATTACH_COLORFUL_KEY) === "true";
    } catch (e) {
      return false;
    }
  }

  function saveDayReportAttachColorful(value) {
    try {
      localStorage.setItem(DAY_REPORT_ATTACH_COLORFUL_KEY, value ? "true" : "false");
    } catch (e) {
      console.warn("Could not save day report attach-colorful preference.", e);
    }
  }

  function buildDayReportText(dateStr) {
    if (dayReportFormat === "compact") return buildDayReportTextCompact(dateStr);
    if (dayReportFormat === "detailed") return buildDayReportTextDetailed(dateStr);
    return buildDayReportTextTable(dateStr);
  }

  // Email Report/Text Report/Share Report used to ignore the "Report
  // format" selector entirely and always send buildDayReportTextPlain
  // - which reads as "the dropdown doesn't work" from the report-
  // sharing side, even though Copy Report (buildDayReportText above)
  // always did respect it. The selector now applies here too, with one
  // real constraint: Table AND Compact both render a monospace ASCII
  // grid (buildTextTable) for the leaderboard, which only lines up in
  // a monospace font - Mail/Messages compose boxes are proportional,
  // so either selection would arrive visibly broken there. Only
  // Detailed has no grid at all (bullet points/sections), so it's the
  // one format that can actually change what gets shared; Table/
  // Compact still fall back to the alignment-free Plain layout.
  function buildDayReportTextForSharing(dateStr) {
    if (dayReportFormat === "detailed") return buildDayReportTextDetailed(dateStr);
    return buildDayReportTextPlain(dateStr);
  }

  // The Player Stats page and the All Players page filter by the same
  // period codes but label them with two different i18n key sets (the
  // former's buttons say "This Week"/"This Year", the latter's dropdown
  // says "1 Week"/"1 Year" and adds "6month") - two small maps so a CSV
  // title line always matches what that page actually has on screen.
  var PLAYER_PAGE_PERIOD_LABEL_KEYS = {
    today: "period.today",
    week: "period.thisWeek",
    month: "period.thisMonth",
    year: "period.thisYear",
    all: "period.allTime"
  };
  var ALL_PLAYERS_PERIOD_LABEL_KEYS = {
    today: "period.today",
    week: "period.oneWeek",
    month: "period.oneMonth",
    "6month": "period.sixMonths",
    year: "period.oneYear",
    all: "period.allTime"
  };

  // RFC 4180-ish: only quotes a field when it actually needs it (holds
  // a comma, quote, or newline), doubling any interior quotes - so
  // plain names/numbers stay unquoted and readable if this file is
  // ever opened in a plain text editor instead of a spreadsheet.
  function csvField(value) {
    var s = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvRow(fields) {
    return fields.map(csvField).join(",") + "\r\n";
  }

  // A real spreadsheet table - actual comma-separated cells, not the
  // ASCII-art pipes-and-dashes grid the "Table" text format draws
  // (which never was a real table to Excel/Numbers/Sheets, just text
  // shaped like one). Two sections - the player leaderboard, then one
  // row per individual game rather than grouping repeat matchups the
  // way the text formats do, since a spreadsheet is exactly the place
  // someone would want every game visible to filter/sum themselves.
  function buildDayReportCsv(dateStr) {
    var data = computeDayReportData(dateStr);
    var lines = [];
    lines.push(csvRow(["Pool Master Counter — Day Report", formatReportDateHeading(dateStr)]));
    lines.push("\r\n");

    lines.push(csvRow(["Player", "Wins", "Losses", "Rating", "Rating Change"]));
    data.players.forEach(function (p) {
      lines.push(csvRow([p.name, p.wins, p.losses, p.rating, formatReportRatingDelta(p.ratingDelta)]));
    });
    lines.push("\r\n");

    lines.push(csvRow(["Time", "Winner(s)", "Opponent(s)", "Game", "Duration", "Race Milestone", "Skunk"]));
    data.games.forEach(function (g) {
      lines.push(
        csvRow([
          formatReportGameTime(g.ts),
          joinNamesForReport(g.winnerNames || []),
          joinNamesForReport(g.opponentNames || []),
          g.gameLabel,
          formatDuration(g.durationMs),
          g.wonRace ? "Race to " + g.raceTarget : "",
          g.skunk ? "Yes" : ""
        ])
      );
    });

    if (data.tournaments.length) {
      lines.push("\r\n");
      lines.push(csvRow(["Time", "Tournament", "Champion(s)", "Players"]));
      data.tournaments.forEach(function (t) {
        lines.push(csvRow([formatReportGameTime(t.ts), tournamentFormatLabel(t.format), joinNamesForReport(t.championNames || []), (t.players || []).length]));
      });
    }

    if (data.bestRunToday) {
      lines.push("\r\n");
      lines.push(csvRow(["Best Run Today", "Player"]));
      lines.push(csvRow([data.bestRunToday.value, data.bestRunToday.name]));
    }

    // A leading BOM isn't needed for the delimiters/structure, but
    // without it Excel (Windows especially, sometimes Mac too) guesses
    // the wrong encoding for anything outside plain ASCII - accented
    // or non-Latin player names, the ▲/▼ rating-change marks - and
    // shows mojibake instead. Harmless elsewhere; every real CSV
    // reader (including Excel/Numbers/Sheets) strips it silently.
    return "\uFEFF" + lines.join("");
  }

  function downloadTextFile(filename, text, mimeType) {
    var blob = new Blob([text], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function updateDayNotesSummary() {
    var data = computeDayReportData(todayDateStr());
    var notes = getDayNotes(todayDateStr());
    var parts = [];
    parts.push(data.games.length + " game" + (data.games.length === 1 ? "" : "s") + " today");
    parts.push(data.players.length + " player" + (data.players.length === 1 ? "" : "s"));
    parts.push(notes ? notes.length + " character note" : "no notes yet");
    setPanelSummary("day-notes-panel", parts.join(" · "));
  }

  // Live "🔥 best run today / 🏆 all-time record" line in the Publish
  // Daily Report panel - hidden entirely until the feature actually has
  // data (nobody's ever run 2+ balls in a row on this device yet).
  function updateRunRecordsSummary() {
    var allTimeRun = getAllTimeBestRun();
    if (!allTimeRun) {
      runRecordsSummary.classList.add("hidden");
      return;
    }
    var todaysRun = getTodaysBestRun();
    // "No run yet today" is its own sentence rather than trying to
    // template an optional player name away inside one i18n string.
    var todayLine = todaysRun
      ? T("dayNotes.bestRunToday", { value: todaysRun.value, name: todaysRun.name })
      : T("dayNotes.noRunYetToday");
    var allTimeLine = T("dayNotes.bestRunAllTime", { value: allTimeRun.value, name: allTimeRun.name });
    runRecordsSummary.textContent = todayLine + "   ·   " + allTimeLine;
    runRecordsSummary.classList.remove("hidden");
  }

  function updateDayReportRecipientsLine() {
    // With either attachment on, Email/Text Report route through the OS
    // share sheet (see shareReportWithAttachments) exactly like Share
    // Report does, instead of a distinct mailto:/sms: link - so with an
    // attachment on, all three buttons genuinely do the same thing (open
    // the same share sheet) and showing three of them is just confusing.
    // Hide Email/Text and leave only Share Report, which is the one whose
    // label actually describes what's about to happen; both come back the
    // moment every attach checkbox is off again and Email/Text return to
    // composing a real, distinct email/text message.
    var hasAttachment = dayReportAttachBackupCheckbox.checked || dayReportAttachColorfulCheckbox.checked;
    btnDayReportEmail.classList.toggle("hidden", hasAttachment);
    btnDayReportSms.classList.toggle("hidden", hasAttachment);
    if (hasAttachment) {
      dayReportRecipientsLine.textContent = T("dayNotes.recipientsAttachOverride");
      return;
    }
    var emailContacts = reportOptedInContacts("email");
    var smsContacts = reportOptedInContacts("sms");
    var parts = [];
    if (emailContacts.length) {
      parts.push(T("dayNotes.recipientsEmail", { names: emailContacts.map(function (c) { return c.name; }).join(", ") }));
    }
    if (smsContacts.length) {
      parts.push(T("dayNotes.recipientsSms", { names: smsContacts.map(function (c) { return c.name; }).join(", ") }));
    }
    dayReportRecipientsLine.textContent = parts.length ? parts.join(" · ") : T("dayNotes.recipientsNone");
  }

  // ---------------------------------------------------------------------
  // Export session snapshot
  // ---------------------------------------------------------------------

  function exportSession() {
    var playerWins = state.players
      .map(function (p) {
        return { name: p.name, wins: state.playerWins[p.id] || 0 };
      })
      .sort(function (a, b) {
        return b.wins - a.wins;
      });

    var teamWins = ["A", "B"]
      .filter(function (teamId) {
        return (state.teamWins[teamId] || 0) > 0;
      })
      .map(function (key) {
        var namesList = teamMembersLive(key).map(function (p) {
          return p.name;
        });
        var members = namesList.length ? namesList.join(" & ") : "Team " + key;
        return { members: members, wins: state.teamWins[key] };
      })
      .sort(function (a, b) {
        return b.wins - a.wins;
      });

    var snapshot = {
      exportedAt: new Date().toISOString(),
      raceToWinsTarget: state.raceToWinsTarget,
      currentGame: state.currentGame,
      players: state.players.map(function (p) {
        return { id: p.id, name: p.name };
      }),
      playerWins: playerWins,
      teamWins: teamWins,
      gameHistory: state.gameHistory
    };

    var filename = "pool-session-" + snapshot.exportedAt.slice(0, 10) + ".json";
    downloadJSON(filename, snapshot);
  }

  function downloadJSON(filename, data) {
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    // Revoking the blob URL immediately can race with the browser's save
    // step on some mobile browsers (notably iOS Safari), producing an empty
    // or missing download. Give it a moment before cleaning up.
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // A dropped-in file that parses as JSON but has no `.state` isn't
  // necessarily garbage - it's often one of this app's OTHER export
  // shapes (Export Session, Export Player Lists), picked by mistake
  // because they're both also just called "export" from the buttons.
  // Naming the actual shape beats a flat "not a backup file".
  function describeUnrecognizedBackupFile(data) {
    if (data && Array.isArray(data.rosterLists)) return T("alert.notABackupFileIsRosterLists");
    if (data && data.currentGame && Array.isArray(data.gameHistory) && data.raceToWinsTarget !== undefined) {
      return T("alert.notABackupFileIsSession");
    }
    return T("alert.notABackupFile");
  }

  function fetchFresh(url) {
    var buster = (url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
    return fetch(url + buster, { cache: "no-store" });
  }

  // ---------------------------------------------------------------------
  // Local storage-backed persistence (rosters + player stats)
  // Everything lives on this device only. Use Export All Data / Import
  // Data (see below) to move it to another device.
  // ---------------------------------------------------------------------

  var ROSTERS_KEY = "poolMasterCounter.rosters.v1";
  var ROTATIONS_KEY = "poolMasterCounter.rotations.v1";
  var PLAYER_STATS_KEY = "poolMasterCounter.playerStats.v1";
  var RATINGS_KEY = "poolMasterCounter.ratings.v1";
  var PLAYER_ADDED_KEY = "poolMasterCounter.playerAdded.v1";
  var TEAMS_KEY = "poolMasterCounter.teams.v1";

  function loadRostersFromStorage() {
    try {
      var raw = localStorage.getItem(ROSTERS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRostersToStorage(rosters) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosters));
    } catch (e) {
      console.warn("Could not save rosters.", e);
    }
  }

  // Named, persisted tournament teams - {id, name, members:[playerName,...],
  // createdAt}. Kept separate from the main scoreboard's ad-hoc, session-
  // only "Team A/B" mode (state.teamWins etc.) - these are reusable across
  // tournaments, the way a saved roster is reusable across sessions.
  function loadTeamsFromStorage() {
    try {
      var raw = localStorage.getItem(TEAMS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveTeamsToStorage(teams) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
    } catch (e) {
      console.warn("Could not save teams.", e);
    }
  }

  var SAVED_TEAMS = loadTeamsFromStorage();

  function findTeamByName(name) {
    var key = normalizeNameKey(name);
    var match = SAVED_TEAMS.filter(function (t) {
      return normalizeNameKey(t.name) === key;
    });
    return match.length ? match[0] : null;
  }

  function normalizedMemberSetKey(members) {
    return (members || [])
      .map(normalizeNameKey)
      .sort()
      .join("|");
  }

  function findTeamByMembers(members) {
    var key = normalizedMemberSetKey(members);
    var match = SAVED_TEAMS.filter(function (t) {
      return normalizedMemberSetKey(t.members) === key;
    });
    return match.length ? match[0] : null;
  }

  // Creates a new saved team, or - if this exact name is already saved -
  // redefines its membership to the current lineup. "Current lineup wins"
  // is a deliberate simplification (this is a casual home-game tool, not a
  // tournament-director product, same philosophy as the seeding fallback
  // below) rather than blocking on a mismatch.
  function upsertTeamFromTournamentEntry(name, members) {
    var existing = findTeamByName(name);
    if (existing) {
      existing.members = members.slice();
    } else {
      SAVED_TEAMS = SAVED_TEAMS.concat([
        { id: "team-" + uid(), name: name, members: members.slice(), createdAt: new Date().toISOString() }
      ]);
    }
    saveTeamsToStorage(SAVED_TEAMS);
  }

  function loadRotationsFromStorage() {
    try {
      var raw = localStorage.getItem(ROTATIONS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRotationsToStorage(rotations) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(ROTATIONS_KEY, JSON.stringify(rotations));
    } catch (e) {
      console.warn("Could not save rotations.", e);
    }
  }

  function loadPlayerStatsFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_STATS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerStatsToStorage(allStats) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(allStats));
    } catch (e) {
      console.warn("Could not save player stats.", e);
    }
  }

  function loadRatingsFromStorage() {
    try {
      var raw = localStorage.getItem(RATINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveRatingsToStorage(ratings) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
    } catch (e) {
      console.warn("Could not save ratings.", e);
    }
  }

  // Name -> ISO timestamp of the first time that name was ever added to
  // this device (see addPlayer / backfillMissingAddedDates below).
  function loadPlayerAddedFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_ADDED_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerAddedToStorage(added) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_ADDED_KEY, JSON.stringify(added));
    } catch (e) {
      console.warn("Could not save player added dates.", e);
    }
  }

  // Name -> { languageCode: "translated name" }. Names don't machine-
  // translate (they're not phrases with a canonical target-language
  // equivalent), so this is a manually-entered per-player, per-language
  // nickname rather than anything automatic - see buildPlayerNameLabel.
  var PLAYER_NAME_TRANSLATIONS_KEY = "poolMasterCounter.playerNameTranslations.v1";

  function loadPlayerNameTranslationsFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_NAME_TRANSLATIONS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerNameTranslationsToStorage(translations) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_NAME_TRANSLATIONS_KEY, JSON.stringify(translations));
    } catch (e) {
      console.warn("Could not save player name translations.", e);
    }
  }

  // Name -> { email, reportOptIn }. Collected (optionally) once, in the
  // onboarding wizard - not exposed on the regular Add Player form.
  var CONTACTS_KEY = "poolMasterCounter.contacts.v1";

  function loadContactsFromStorage() {
    try {
      var raw = localStorage.getItem(CONTACTS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveContactsToStorage(contacts) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    } catch (e) {
      console.warn("Could not save player contacts.", e);
    }
  }

  // Name -> { removedAt }. removePlayer only drops someone from the live
  // roster (their PLAYER_STATS/PLAYER_RATINGS stay put), so this isn't
  // about protecting data - it's about remembering the removal was
  // deliberate, so importAllData doesn't silently re-add them just
  // because an older backup still lists them.
  var REMOVED_PLAYERS_KEY = "poolMasterCounter.removedPlayers.v1";

  function loadRemovedPlayersFromStorage() {
    try {
      var raw = localStorage.getItem(REMOVED_PLAYERS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveRemovedPlayersToStorage(removed) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(REMOVED_PLAYERS_KEY, JSON.stringify(removed));
    } catch (e) {
      console.warn("Could not save removed players.", e);
    }
  }

  // Capped local history of what each reset button just wiped, so it can
  // be recovered from the Recover Data panel without hunting for a
  // downloaded backup file. Newest first, oldest dropped once full.
  var RESET_SNAPSHOTS_KEY = "poolMasterCounter.resetSnapshots.v1";
  var RESET_SNAPSHOTS_CAP = 12;

  function loadResetSnapshotsFromStorage() {
    try {
      var raw = localStorage.getItem(RESET_SNAPSHOTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveResetSnapshotsToStorage(snapshots) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(RESET_SNAPSHOTS_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.warn("Could not save reset snapshots.", e);
    }
  }

  // Capped local archive of every colorful report ever generated, one
  // entry per day (regenerating the same day overwrites its entry).
  // computeDayReportData only ever sees the last 24 hours of live game
  // history no matter what dateStr it's given, so without this a report
  // becomes permanently unrecoverable the moment that window rolls past
  // it - this is the only place "yesterday's report" lives at all. Only
  // the already-computed numbers are kept, never theme tokens or a PNG,
  // so re-viewing an old entry (hydrateArchivedReportImageData) always
  // re-draws with whichever theme is active right now.
  var REPORT_ARCHIVE_KEY = "poolMasterCounter.reportArchive.v1";
  var REPORT_ARCHIVE_CAP = 90;

  function loadReportArchiveFromStorage() {
    try {
      var raw = localStorage.getItem(REPORT_ARCHIVE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveReportArchiveToStorage(entries) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(REPORT_ARCHIVE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.warn("Could not save report archive.", e);
    }
  }

  var REPORT_ARCHIVE = loadReportArchiveFromStorage();

  function archiveDayReport(reportImageData) {
    if (noStatsMode) return;
    var snapshot = {
      dateStr: reportImageData.dateStr,
      longDate: reportImageData.longDate,
      generatedAt: reportImageData.generatedAt,
      players: reportImageData.players,
      highlights: reportImageData.highlights,
      games: reportImageData.games,
      notes: reportImageData.notes
    };
    REPORT_ARCHIVE = REPORT_ARCHIVE.filter(function (entry) {
      return entry.dateStr !== snapshot.dateStr;
    });
    REPORT_ARCHIVE.unshift(snapshot);
    REPORT_ARCHIVE = REPORT_ARCHIVE.slice(0, REPORT_ARCHIVE_CAP);
    saveReportArchiveToStorage(REPORT_ARCHIVE);
    renderReportArchiveList();
  }

  function findReportArchiveEntry(dateStr) {
    var match = REPORT_ARCHIVE.filter(function (entry) {
      return entry.dateStr === dateStr;
    });
    return match.length ? match[0] : null;
  }

  function deleteArchivedReport(dateStr) {
    REPORT_ARCHIVE = REPORT_ARCHIVE.filter(function (entry) {
      return entry.dateStr !== dateStr;
    });
    saveReportArchiveToStorage(REPORT_ARCHIVE);
    renderReportArchiveList();
  }

  // Re-attaches a fresh read of the CURRENT theme's colors to a saved
  // snapshot - the deliberate tradeoff behind storing data instead of a
  // rendered image: an old report always looks right for today's theme,
  // at the cost of not being a pixel-exact record of how it looked when
  // it was first generated.
  function hydrateArchivedReportImageData(entry) {
    return {
      dateStr: entry.dateStr,
      longDate: entry.longDate,
      generatedAt: entry.generatedAt,
      tokens: readReportThemeTokens(),
      players: entry.players,
      highlights: entry.highlights,
      games: entry.games,
      notes: entry.notes
    };
  }

  function openArchivedReport(dateStr) {
    var entry = findReportArchiveEntry(dateStr);
    if (!entry) return;
    openDayReportColorfulFromData(hydrateArchivedReportImageData(entry));
  }

  function reportArchiveRowMeta(entry) {
    return T("reportArchive.rowMeta", {
      players: (entry.players || []).length,
      games: (entry.games || []).length,
      generatedAt: entry.generatedAt
    });
  }

  function renderReportArchiveList() {
    if (!reportArchiveList) return;
    reportArchiveList.innerHTML = "";
    if (REPORT_ARCHIVE.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("reportArchive.none");
      reportArchiveList.appendChild(hint);
      return;
    }
    REPORT_ARCHIVE.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "recover-data-row";
      var info = document.createElement("div");
      info.className = "recover-data-row-info";
      var label = document.createElement("span");
      label.className = "recover-data-row-label";
      label.textContent = entry.longDate || entry.dateStr;
      var meta = document.createElement("span");
      meta.className = "recover-data-row-meta";
      meta.textContent = reportArchiveRowMeta(entry);
      info.appendChild(label);
      info.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "report-archive-row-actions";
      var viewBtn = document.createElement("button");
      viewBtn.type = "button";
      viewBtn.className = "btn btn-ghost";
      viewBtn.textContent = T("reportArchive.view");
      viewBtn.addEventListener("click", function () {
        openArchivedReport(entry.dateStr);
      });
      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-ghost";
      deleteBtn.textContent = T("reportArchive.delete");
      deleteBtn.addEventListener("click", function () {
        confirmModal(T("reportArchive.confirmDelete", { date: entry.longDate || entry.dateStr }), function () {
          deleteArchivedReport(entry.dateStr);
        });
      });
      actions.appendChild(viewBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(info);
      li.appendChild(actions);
      reportArchiveList.appendChild(li);
    });
  }

  // One-time-per-load cleanup: if PLAYER_STATS already has separate entries
  // for the same person under different casing (e.g. "Bob" and "bob" from
  // before names were treated as case-insensitive), merge their sessions
  // into a single canonical entry so career stats and the All Players page
  // never split one person into two rows. Canonical casing is whichever
  // variant has the most recorded wins; ties go alphabetically.
  function consolidateCaseVariantPlayerStats(stats) {
    var groups = {};
    Object.keys(stats).forEach(function (name) {
      var key = normalizeNameKey(name);
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    });
    var changed = false;
    var result = {};
    Object.keys(groups).forEach(function (key) {
      var names = groups[key];
      if (names.length === 1) {
        var soloName = capitalizeName(names[0]);
        if (soloName !== names[0]) {
          changed = true;
          result[soloName] = { name: soloName, sessions: stats[names[0]].sessions };
        } else {
          result[soloName] = stats[names[0]];
        }
        return;
      }
      changed = true;
      var mergedSessions = [];
      var totalWins = {};
      names.forEach(function (n) {
        var sessions = stats[n] && Array.isArray(stats[n].sessions) ? stats[n].sessions : [];
        mergedSessions = mergeSessionLists(mergedSessions, sessions);
        totalWins[n] = sessions.reduce(function (sum, s) {
          return sum + (s.wins || 0);
        }, 0);
      });
      // Whichever variant wins the vote, run it through capitalizeName so
      // an all-lowercase import (e.g. "bob") never becomes the stored
      // canonical casing just by having more recorded wins.
      var canonical = capitalizeName(
        names.slice().sort(function (a, b) {
          return totalWins[b] - totalWins[a] || a.localeCompare(b);
        })[0]
      );
      result[canonical] = { name: canonical, sessions: mergedSessions };
    });
    return { stats: result, changed: changed };
  }

  var PLAYER_STATS = loadPlayerStatsFromStorage();
  (function consolidatePlayerStatsCasingOnBoot() {
    var result = consolidateCaseVariantPlayerStats(PLAYER_STATS);
    PLAYER_STATS = result.stats;
    if (result.changed) savePlayerStatsToStorage(PLAYER_STATS);
  })();

  // ---------------------------------------------------------------------
  // Player ratings — an Elo-style rating inspired by the publicly
  // documented behavior of FargoRate (the rating system behind USA Pool
  // League and most competitive USA pool leagues): a roughly 0-900 scale
  // where each 100-point gap between two players corresponds to about a
  // 2:1 expected win ratio, doubling every 100 points. This is NOT a
  // reverse-engineered clone of Fargo's proprietary global-optimization
  // algorithm (which considers every player's games together and is
  // recomputed from scratch daily) — that's neither public nor practical
  // to replicate client-side. It's a standard, well-understood per-game
  // update rule tuned to land on the same scale and odds Fargo publishes.
  //
  // Ratings are entirely automatic: every credited game updates both
  // players' ratings immediately, and there is no UI to edit a rating by
  // hand. New players start at DEFAULT_RATING, the middle of the range
  // FargoRate describes as where most league/tournament players fall.
  // Ratings live in their own name-keyed store (like PLAYER_STATS), so
  // they persist for a player even after they're removed from the roster.
  // ---------------------------------------------------------------------

  var DEFAULT_RATING = 400;
  var RATING_PROVISIONAL_GAMES = 20;
  var RATING_K_PROVISIONAL = 24;
  var RATING_K_ESTABLISHED = 8;
  var RATING_HISTORY_CAP = 500;

  // Same case-variant cleanup as consolidateCaseVariantPlayerStats, applied
  // to the ratings store — merges any "bob"/"Bob" split, dedupes their
  // history by timestamp, and recomputes the current rating from the
  // merged, time-sorted history so an old lowercase import never leaves a
  // player with two separate rating tracks or an un-capitalized name.
  function consolidateCaseVariantRatings(ratings) {
    var groups = {};
    Object.keys(ratings).forEach(function (name) {
      var key = normalizeNameKey(name);
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    });
    var changed = false;
    var result = {};
    Object.keys(groups).forEach(function (key) {
      var names = groups[key];
      if (names.length === 1) {
        var soloName = capitalizeName(names[0]);
        if (soloName !== names[0]) {
          changed = true;
          var solo = ratings[names[0]];
          result[soloName] = { name: soloName, rating: solo.rating, gamesPlayed: solo.gamesPlayed, history: solo.history };
        } else {
          result[soloName] = ratings[names[0]];
        }
        return;
      }
      changed = true;
      var seen = {};
      var mergedHistory = [];
      names.forEach(function (n) {
        (ratings[n].history || []).forEach(function (h) {
          if (seen[h.ts]) return;
          seen[h.ts] = true;
          mergedHistory.push(h);
        });
      });
      mergedHistory.sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
      var canonical = capitalizeName(names[0]);
      result[canonical] = {
        name: canonical,
        rating: mergedHistory.length ? mergedHistory[mergedHistory.length - 1].rating : DEFAULT_RATING,
        gamesPlayed: mergedHistory.length,
        history: mergedHistory
      };
    });
    return { ratings: result, changed: changed };
  }

  var PLAYER_RATINGS = loadRatingsFromStorage();
  (function consolidateRatingsCasingOnBoot() {
    var result = consolidateCaseVariantRatings(PLAYER_RATINGS);
    PLAYER_RATINGS = result.ratings;
    if (result.changed) saveRatingsToStorage(PLAYER_RATINGS);
  })();

  // Finds an existing PLAYER_RATINGS key matching this name regardless of
  // case, mirroring findPlayerStatsKey.
  function findRatingKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_RATINGS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  // The rating to use for someone who hasn't played a rated game yet —
  // shows DEFAULT_RATING without creating a stored entry for them.
  function getPlayerRating(name) {
    var key = findRatingKey(name);
    return key ? PLAYER_RATINGS[key].rating : DEFAULT_RATING;
  }

  function getPlayerRatingEntry(name) {
    var key = findRatingKey(name);
    return key ? PLAYER_RATINGS[key] : null;
  }

  var PLAYER_ADDED = loadPlayerAddedFromStorage();

  function findPlayerAddedKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_ADDED).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  // The ISO timestamp this name was first added to the app, or null if
  // unknown (never recorded and no game history to infer it from).
  function getPlayerAddedAt(name) {
    var key = findPlayerAddedKey(name);
    return key ? PLAYER_ADDED[key] : null;
  }

  // Records "now" as name's added date, but only the first time this
  // exact name is ever seen — re-adding an existing player (e.g. after
  // removing them from today's roster) must not reset it.
  function recordPlayerAddedIfNew(name) {
    if (findPlayerAddedKey(name)) return;
    PLAYER_ADDED[name] = new Date().toISOString();
    savePlayerAddedToStorage(PLAYER_ADDED);
  }

  var PLAYER_CONTACTS = loadContactsFromStorage();

  function findContactKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_CONTACTS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  // Merges rather than overwrites, because onboarding and the edit-rating
  // popup can each save a partial patch (e.g. edit-rating changing just
  // the phone number) for the same player without erasing what the other
  // one already stored.
  function setPlayerContact(name, patch) {
    var key = findContactKey(name) || name;
    var existing = PLAYER_CONTACTS[key] || {};
    PLAYER_CONTACTS[key] = {
      email: patch.email !== undefined ? patch.email : existing.email || "",
      phone: patch.phone !== undefined ? patch.phone : existing.phone || "",
      nickname: patch.nickname !== undefined ? patch.nickname : existing.nickname || "",
      reportOptIn: patch.reportOptIn !== undefined ? !!patch.reportOptIn : !!existing.reportOptIn,
      notifyMethod: patch.notifyMethod !== undefined ? patch.notifyMethod : existing.notifyMethod || "email",
      // Stamped on every write (even one that only touches a single
      // field) so mergeContactsData can tell, per name, which side of an
      // import was actually edited more recently - see its own comment.
      updatedAt: Date.now()
    };
    saveContactsToStorage(PLAYER_CONTACTS);
  }

  function getPlayerContact(name) {
    var key = findContactKey(name);
    return key ? PLAYER_CONTACTS[key] : { email: "", phone: "", nickname: "", reportOptIn: false, notifyMethod: "email" };
  }

  // Renames a player everywhere their identity is a record key - stats,
  // ratings, contacts, and any saved per-language display name - plus
  // their entry on the live roster if they're currently on it, so their
  // whole history stays attached to the new name instead of quietly
  // starting over under it. Deliberately leaves state.gameHistory (and
  // saved rosters) alone: a finished game is a record of what happened
  // at the time, not a live reference, so past entries keep showing the
  // name as it was then - the same reasoning mergeRosterLists follows
  // for saved player lists. Returns "" on success, or a translated error
  // string (empty/duplicate name) the Contact Sheet can show directly.
  function renamePlayerEverywhere(oldName, newRawName) {
    var newName = resolvePlayerName(newRawName);
    if (!newName) return T("contactSheet.nameRequired");
    if (normalizeNameKey(newName) === normalizeNameKey(oldName)) return "";
    var newKey = normalizeNameKey(newName);
    var oldKey = normalizeNameKey(oldName);
    var alreadyUsed = contactSheetAllNames().some(function (n) {
      return normalizeNameKey(n) === newKey && normalizeNameKey(n) !== oldKey;
    });
    if (alreadyUsed) return T("contactSheet.nameAlreadyUsed", { name: newName });

    var statsKey = findPlayerStatsKey(oldName);
    if (statsKey) {
      PLAYER_STATS[newName] = PLAYER_STATS[statsKey];
      PLAYER_STATS[newName].name = newName;
      if (statsKey !== newName) delete PLAYER_STATS[statsKey];
      savePlayerStatsToStorage(PLAYER_STATS);
    }

    var ratingKey = findRatingKey(oldName);
    if (ratingKey) {
      PLAYER_RATINGS[newName] = PLAYER_RATINGS[ratingKey];
      PLAYER_RATINGS[newName].name = newName;
      if (ratingKey !== newName) delete PLAYER_RATINGS[ratingKey];
      saveRatingsToStorage(PLAYER_RATINGS);
    }

    var contactKey = findContactKey(oldName);
    if (contactKey) {
      PLAYER_CONTACTS[newName] = PLAYER_CONTACTS[contactKey];
      if (contactKey !== newName) delete PLAYER_CONTACTS[contactKey];
      saveContactsToStorage(PLAYER_CONTACTS);
    }

    var translationKey = findPlayerNameTranslationKey(oldName);
    if (translationKey) {
      PLAYER_NAME_TRANSLATIONS[newName] = PLAYER_NAME_TRANSLATIONS[translationKey];
      if (translationKey !== newName) delete PLAYER_NAME_TRANSLATIONS[translationKey];
      savePlayerNameTranslationsToStorage(PLAYER_NAME_TRANSLATIONS);
    }

    state.players.forEach(function (p) {
      if (normalizeNameKey(p.name) === oldKey) p.name = newName;
    });
    saveState();

    return "";
  }

  // Formats digits-as-typed to match the phone convention of the
  // currently active app language (same country each language's flag in
  // languages/manifest.json already implies - UK for English, since
  // that's the manifest's own flag choice, not a US assumption). Purely
  // a typing aid: the formatted string (with its spaces) is what gets
  // saved, same as the raw input always was.
  function formatPhoneNumberForActiveLanguage(rawValue) {
    var digits = (rawValue || "").replace(/\D/g, "");
    if (activeLanguageCode === "french") {
      // France: 0X XX XX XX XX
      digits = digits.slice(0, 10);
      return digits.replace(/(\d{1,2})(\d{1,2})?(\d{1,2})?(\d{1,2})?(\d{1,2})?/, function (m, a, b, c, d, e) {
        return [a, b, c, d, e].filter(Boolean).join(" ");
      });
    }
    if (activeLanguageCode === "spanish") {
      // Spain: XXX XXX XXX
      digits = digits.slice(0, 9);
      return digits.replace(/(\d{1,3})(\d{1,3})?(\d{1,3})?/, function (m, a, b, c) {
        return [a, b, c].filter(Boolean).join(" ");
      });
    }
    if (activeLanguageCode === "cantonese") {
      // Hong Kong: XXXX XXXX
      digits = digits.slice(0, 8);
      return digits.replace(/(\d{1,4})(\d{1,4})?/, function (m, a, b) {
        return [a, b].filter(Boolean).join(" ");
      });
    }
    // English -> UK mobile: 07XXX XXXXXX
    digits = digits.slice(0, 11);
    if (digits.length <= 5) return digits;
    return digits.slice(0, 5) + " " + digits.slice(5);
  }

  // Reformats on every keystroke, always placing the cursor at the end -
  // simplest behavior for a short, mostly-typed-left-to-right field like
  // this, at the cost of mid-string editing not being caret-perfect.
  function wirePhoneFormatting(input) {
    input.addEventListener("input", function () {
      input.value = formatPhoneNumberForActiveLanguage(input.value);
    });
  }

  // The same per-language digit count formatPhoneNumberForActiveLanguage
  // already formats toward (and truncates at) - a real number for the
  // active language's convention has to actually reach that count, not
  // just stop short of it partway through.
  var PHONE_DIGIT_LENGTH_BY_LANGUAGE = { french: 10, spanish: 9, cantonese: 8 };
  function expectedPhoneDigitLength() {
    return PHONE_DIGIT_LENGTH_BY_LANGUAGE[activeLanguageCode] || 11;
  }

  // Email/phone are optional everywhere they appear - an empty field is
  // always valid, only a non-empty one that isn't actually a usable
  // phone number/email is rejected.
  function isValidPhoneNumber(rawValue) {
    var digits = (rawValue || "").replace(/\D/g, "");
    if (!digits) return true;
    return digits.length === expectedPhoneDigitLength();
  }

  function isValidEmail(rawValue) {
    var trimmed = (rawValue || "").trim();
    if (!trimmed) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  // Live red-outline feedback the moment a phone/email field stops
  // being valid, not just when something tries to save it - returns a
  // checkValidity() a caller can also run synchronously right before
  // actually saving, so a value that was never blurred (typed, then
  // straight to tapping Save) still gets caught.
  function wireFieldValidity(input, validatorFn) {
    function check() {
      var ok = validatorFn(input.value);
      input.classList.toggle("field-invalid", !ok);
      return ok;
    }
    input.addEventListener("input", check);
    input.addEventListener("blur", check);
    return check;
  }

  // Shared by onboarding and the edit-rating popup: the "receive the
  // day's report" checkbox only makes sense once there's somewhere to
  // send it, and the email/SMS choice only matters once it's checked.
  function wireNotifyCheckbox(emailInput, phoneInput, checkbox, methodRow) {
    function refreshEnabled() {
      var hasContactInfo = !!(emailInput.value.trim() || phoneInput.value.trim());
      checkbox.disabled = !hasContactInfo;
      if (!hasContactInfo) {
        checkbox.checked = false;
        methodRow.classList.add("hidden");
      }
    }
    emailInput.addEventListener("input", refreshEnabled);
    phoneInput.addEventListener("input", refreshEnabled);
    checkbox.addEventListener("change", function () {
      methodRow.classList.toggle("hidden", !checkbox.checked);
    });
  }

  // Every stored contact opted in to the day report, deduped, split by
  // delivery method - used to pre-fill the report's mailto "to" and the
  // SMS compose recipient.
  function reportOptedInContacts(method) {
    return Object.keys(PLAYER_CONTACTS)
      .map(function (name) {
        return { name: name, contact: PLAYER_CONTACTS[name] };
      })
      .filter(function (entry) {
        if (!entry.contact || !entry.contact.reportOptIn) return false;
        var entryMethod = entry.contact.notifyMethod || "email";
        if (method === "sms") return entryMethod === "sms" && entry.contact.phone;
        return entryMethod !== "sms" && entry.contact.email;
      });
  }

  // Local settings win on conflict (this device's own opt-in choice is
  // more current than whatever an older backup says); anything imported
  // for a name this device has never heard of gets added.
  // Whichever side was actually edited more recently wins, per name -
  // not "local always wins" like every other merge* helper here, since
  // contacts (email/phone/nickname) are exactly the kind of record that
  // gets corrected on whichever device someone happens to be using, and
  // a blanket "local wins" would silently discard a newer edit made
  // elsewhere just because this device's copy is older. A record saved
  // before `updatedAt` existed counts as timestamp 0, so any genuinely
  // timestamped record - local or imported - always outranks it.
  function mergeContactsData(localContacts, importedContacts) {
    var merged = {};
    Object.keys(importedContacts || {}).forEach(function (name) {
      merged[name] = importedContacts[name];
    });
    Object.keys(localContacts || {}).forEach(function (name) {
      var local = localContacts[name];
      var imported = merged[name];
      if (!imported) {
        merged[name] = local;
        return;
      }
      merged[name] = (local.updatedAt || 0) >= (imported.updatedAt || 0) ? local : imported;
    });
    return merged;
  }

  var REMOVED_PLAYERS = loadRemovedPlayersFromStorage();

  function findRemovedPlayerKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(REMOVED_PLAYERS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function markPlayerRemoved(name) {
    var key = findRemovedPlayerKey(name) || name;
    REMOVED_PLAYERS[key] = { removedAt: new Date().toISOString() };
    saveRemovedPlayersToStorage(REMOVED_PLAYERS);
  }

  function isPlayerRemoved(name) {
    return !!findRemovedPlayerKey(name);
  }

  // Called whenever a name becomes an active player again - a deliberate
  // manual re-add (typed into Add Player, or restored from an import
  // conflict prompt) means the removal no longer applies.
  function clearPlayerRemoved(name) {
    var key = findRemovedPlayerKey(name);
    if (!key) return;
    delete REMOVED_PLAYERS[key];
    saveRemovedPlayersToStorage(REMOVED_PLAYERS);
  }

  var RESET_SNAPSHOTS = loadResetSnapshotsFromStorage();

  // `data` should already be a plain deep-cloned object (JSON.parse(
  // JSON.stringify(...)), same pattern celebrateTournamentWin's undo
  // snapshot uses) holding only the slice that reset is about to wipe.
  function saveResetSnapshot(type, label, data) {
    RESET_SNAPSHOTS.unshift({ id: uid(), type: type, ts: new Date().toISOString(), label: label, data: data });
    RESET_SNAPSHOTS = RESET_SNAPSHOTS.slice(0, RESET_SNAPSHOTS_CAP);
    saveResetSnapshotsToStorage(RESET_SNAPSHOTS);
  }

  var PLAYER_NAME_TRANSLATIONS = loadPlayerNameTranslationsFromStorage();

  function findPlayerNameTranslationKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_NAME_TRANSLATIONS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function getPlayerNameTranslation(name, languageCode) {
    var key = findPlayerNameTranslationKey(name);
    if (!key) return null;
    return PLAYER_NAME_TRANSLATIONS[key][languageCode] || null;
  }

  function setPlayerNameTranslation(name, languageCode, translatedName) {
    var key = findPlayerNameTranslationKey(name) || name;
    if (!PLAYER_NAME_TRANSLATIONS[key]) PLAYER_NAME_TRANSLATIONS[key] = {};
    if (translatedName) PLAYER_NAME_TRANSLATIONS[key][languageCode] = translatedName;
    else delete PLAYER_NAME_TRANSLATIONS[key][languageCode];
    savePlayerNameTranslationsToStorage(PLAYER_NAME_TRANSLATIONS);
  }

  // Builds "Bob (Bobby)" - the plain name, plus a smaller/dimmer
  // parenthesized translation if one exists for the active language (never
  // fabricated; English shows just the plain name). Appends directly to
  // container so call sites can keep using it like a plain name element.
  // When editable is true (only meaningful on the Player Stats page, where
  // there's room), also appends a small ✏️ button to set/change the
  // translation for the active language - names don't machine-translate,
  // so this is the "if possible" path: a manually-entered nickname per
  // language rather than anything automatic.
  function buildPlayerNameLabel(container, name, editable) {
    // A nickname (set on the Contact Sheet) takes over as the name shown
    // everywhere this helper is used - the scoreboard included, since
    // that's the whole point of one - with the real name kept visible in
    // parens right after it. The real name (`name`) still drives every
    // lookup below (translation, stats, rename) - the nickname is purely
    // a display overlay, never a second identity.
    var nickname = getPlayerContact(name).nickname;
    if (nickname) {
      container.appendChild(document.createTextNode(nickname));
      var realNameSpan = document.createElement("span");
      realNameSpan.className = "player-name-real";
      realNameSpan.textContent = "(" + name + ")";
      container.appendChild(realNameSpan);
    } else {
      container.appendChild(document.createTextNode(name));
    }
    if (activeLanguageCode === DEFAULT_LANGUAGE_CODE) return;
    var translated = getPlayerNameTranslation(name, activeLanguageCode);
    if (translated) {
      var span = document.createElement("span");
      span.className = "player-name-translated";
      span.textContent = "(" + translated + ")";
      container.appendChild(span);
    }
    if (editable) {
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "player-name-edit-btn";
      editBtn.textContent = "✏️";
      editBtn.title = T("playerPage.editTranslatedName");
      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        promptModal(T("playerPage.editTranslatedNamePrompt", { name: name }), translated || "", function (entered) {
          setPlayerNameTranslation(name, activeLanguageCode, entered.trim());
          renderAll();
          if (typeof renderPlayerSynopsis === "function" && currentStatsPlayerName === name) {
            openPlayerStatsPage(name, true);
          }
        });
      });
      container.appendChild(editBtn);
    }
  }

  // The exact rating change this one player got from one specific game —
  // bumpPlayerRating stamps every history entry with the same ts as the
  // gameHistory entry that caused it, so this is just a lookup. Returns
  // null if there's no matching entry (e.g. the game was played with No
  // Statistic mode on, so no rating history was ever recorded for it).
  function getPlayerRatingDeltaForGame(name, ts) {
    var key = findRatingKey(name);
    if (!key || !ts) return null;
    var history = PLAYER_RATINGS[key].history || [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].ts === ts) return history[i].delta;
    }
    return null;
  }

  function ensureRatingEntry(name) {
    var key = findRatingKey(name) || name;
    if (!PLAYER_RATINGS[key]) {
      PLAYER_RATINGS[key] = { name: key, rating: DEFAULT_RATING, gamesPlayed: 0, history: [] };
    }
    return PLAYER_RATINGS[key];
  }

  // A hand-entered override, not a game result - recorded as its own
  // history point (so the rating graph reflects it) but doesn't count
  // toward gamesPlayed, since no game was actually played.
  function setPlayerRatingManually(name, newRating) {
    var entry = ensureRatingEntry(name);
    var ts = new Date().toISOString();
    var delta = newRating - entry.rating;
    entry.rating = newRating;
    entry.history.push({ ts: ts, rating: newRating, delta: delta });
    if (entry.history.length > RATING_HISTORY_CAP) entry.history.shift();
    saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Resets every player currently on the roster back to the default
  // starting rating (see the "Player ratings" comment above DEFAULT_RATING
  // for why 400 on this 0-900 scale) - as if they were freshly added,
  // with no rating history at all.
  function resetAllPlayersOfficialRating() {
    confirmModal(T("confirm.resetAllRatingsExplain", { rating: DEFAULT_RATING }), function () {
      confirmModal(T("confirm.areYouSure"), function () {
        saveResetSnapshot("allRatings", T("resetSnapshot.allRatingsLabel"), {
          ratings: JSON.parse(JSON.stringify(PLAYER_RATINGS))
        });
        state.players.forEach(function (p) {
          var key = findRatingKey(p.name) || p.name;
          PLAYER_RATINGS[key] = { name: key, rating: DEFAULT_RATING, gamesPlayed: 0, history: [] };
        });
        saveRatingsToStorage(PLAYER_RATINGS);
        renderAll();
        showToast(T("toast.allRatingsReset"));
      });
    });
  }

  function openRatingEditPopup(name) {
    ratingEditTargetName = name;
    ratingEditPlayerName.textContent = name;
    ratingEditInput.value = getPlayerRating(name);
    var contact = getPlayerContact(name);
    ratingEditEmailInput.value = contact.email || "";
    ratingEditPhoneInput.value = formatPhoneNumberForActiveLanguage(contact.phone || "");
    ratingEditNotifyCheckbox.disabled = !(contact.email || contact.phone);
    ratingEditNotifyCheckbox.checked = !ratingEditNotifyCheckbox.disabled && !!contact.reportOptIn;
    ratingEditNotifyMethodRow.classList.toggle("hidden", !ratingEditNotifyCheckbox.checked);
    Array.prototype.forEach.call(ratingEditNotifyMethodRadios, function (r) {
      r.checked = r.value === (contact.notifyMethod || "email");
    });
    ratingEditOverlay.classList.remove("hidden");
  }

  function closeRatingEditPopup() {
    ratingEditTargetName = null;
    ratingEditOverlay.classList.add("hidden");
  }

  function saveRatingEditPopup() {
    if (!ratingEditTargetName) return;
    var emailOk = checkRatingEditEmailValidity();
    var phoneOk = checkRatingEditPhoneValidity();
    if (!emailOk || !phoneOk) {
      showToast(T(!emailOk ? "contactSheet.invalidEmail" : "contactSheet.invalidPhone"));
      return;
    }
    var value = parseInt(ratingEditInput.value, 10);
    if (!isNaN(value)) setPlayerRatingManually(ratingEditTargetName, value);
    setPlayerContact(ratingEditTargetName, {
      email: ratingEditEmailInput.value.trim(),
      phone: ratingEditPhoneInput.value.trim(),
      reportOptIn: ratingEditNotifyCheckbox.checked,
      notifyMethod: Array.prototype.filter.call(ratingEditNotifyMethodRadios, function (r) {
        return r.checked;
      })[0].value
    });
    updateDayReportRecipientsLine();
    closeRatingEditPopup();
    renderAll();
  }

  // Reads the optional "starting rating" field on an add-player form —
  // null if left blank or not a usable number.
  function parseStartingRatingInput(inputEl) {
    var raw = inputEl.value.trim();
    if (!raw) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  // Win probability for A over B given the two ratings — a 100-point gap
  // is a 2:1 expected win ratio, matching FargoRate's published scale.
  function eloExpectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(2, (ratingB - ratingA) / 100));
  }

  // P(a player racing to needA wins reaches that before an opponent
  // racing to needB does), given the first player's per-game win
  // probability p. Plain DP over "wins still needed" from each side -
  // numerically stable for any race length this app would ever use
  // (races top out well under 100), no factorials/overflow risk.
  function raceWinProbability(p, needA, needB) {
    var memo = {};
    function f(i, j) {
      if (i === 0) return 1;
      if (j === 0) return 0;
      var k = i + "," + j;
      if (memo[k] !== undefined) return memo[k];
      var v = p * f(i - 1, j) + (1 - p) * f(i, j - 1);
      memo[k] = v;
      return v;
    }
    return f(needA, needB);
  }

  // The weaker side's fair race length against an anchor racing to
  // anchorRace, given the anchor's per-game win probability p over this
  // specific opponent (see eloExpectedScore) - the same underlying
  // win-probability model FargoRate's Fair Match Calculator uses,
  // applied here via an exact race-outcome search instead of their
  // Monte Carlo/lookup-table approach. Tries every candidate length and
  // keeps whichever lands the match closest to 50/50.
  function fairRaceTarget(p, anchorRace) {
    if (p <= 0.5) return anchorRace;
    var best = anchorRace;
    var bestDiff = Infinity;
    for (var n = 1; n <= anchorRace; n++) {
      var diff = Math.abs(raceWinProbability(p, anchorRace, n) - 0.5);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = n;
      }
    }
    return best;
  }

  // ratedSides: [{key, rating}] for whoever's active right now (player
  // ids in individual mode, "A"/"B" in teams, or a bracket match's two
  // named sides). Returns {key: target}, anchored on the highest
  // rating - that side races to anchorRace unchanged, everyone else
  // gets their own fair (equal-or-shorter) race.
  function computeFairRaceTargets(ratedSides, anchorRace) {
    var targets = {};
    if (ratedSides.length === 0) return targets;
    var anchor = ratedSides.reduce(function (best, s) {
      return s.rating > best.rating ? s : best;
    });
    ratedSides.forEach(function (s) {
      targets[s.key] = s.key === anchor.key ? anchorRace : fairRaceTarget(eloExpectedScore(anchor.rating, s.rating), anchorRace);
    });
    return targets;
  }

  // New/lightly-rated players move faster (a "provisional" period) so a
  // handful of games can correct a bad starting estimate quickly; once
  // established, ratings move more slowly and stay stable session to
  // session — the same shape FargoRate describes (a starter estimate
  // that's blended out as real games accumulate), simplified to a
  // two-step K-factor instead of a continuous blend.
  function ratingKFor(gamesPlayed) {
    return gamesPlayed < RATING_PROVISIONAL_GAMES ? RATING_K_PROVISIONAL : RATING_K_ESTABLISHED;
  }

  function bumpPlayerRating(name, delta, ts) {
    var entry = ensureRatingEntry(name);
    entry.rating += delta;
    entry.gamesPlayed += 1;
    // fromGame distinguishes this from a hand-entered override (see
    // setPlayerRatingManually) so a revert (retrogradeRatingsForGame /
    // revertRatingsChangedSince) knows whether to also undo the
    // gamesPlayed bump - a manual edit never touched it, so undoing one
    // must not decrement it either.
    entry.history.push({ ts: ts, rating: entry.rating, delta: delta, fromGame: true });
    if (entry.history.length > RATING_HISTORY_CAP) entry.history.shift();
    return entry;
  }

  // One pairwise result: winnerName beat loserName. Both ratings update
  // from their pre-game values (the expected score is computed once,
  // before either is touched).
  function applyPairwiseRatingResult(winnerName, loserName, ts) {
    var winnerEntry = ensureRatingEntry(winnerName);
    var loserEntry = ensureRatingEntry(loserName);
    var expectedWinner = eloExpectedScore(winnerEntry.rating, loserEntry.rating);
    var winnerDelta = Math.round(ratingKFor(winnerEntry.gamesPlayed) * (1 - expectedWinner));
    var loserDelta = Math.round(ratingKFor(loserEntry.gamesPlayed) * -(1 - expectedWinner));
    bumpPlayerRating(winnerName, winnerDelta, ts);
    bumpPlayerRating(loserName, loserDelta, ts);
  }

  function averageRating(names) {
    if (!names.length) return DEFAULT_RATING;
    var sum = names.reduce(function (total, n) {
      return total + getPlayerRating(n);
    }, 0);
    return sum / names.length;
  }

  // Team result: treats each side's average rating as a single "player"
  // for the win-probability calculation, then applies that same delta to
  // every member of each side — a common, simple approximation for team
  // Elo (not as rigorous as e.g. TrueSkill, but transparent and fair).
  function applyTeamRatingResult(winnerNames, loserNames, ts) {
    var winnerAvg = averageRating(winnerNames);
    var loserAvg = averageRating(loserNames);
    var expectedWinner = eloExpectedScore(winnerAvg, loserAvg);
    var winnerDelta = Math.round(RATING_K_PROVISIONAL * (1 - expectedWinner));
    var loserDelta = Math.round(RATING_K_PROVISIONAL * -(1 - expectedWinner));
    winnerNames.forEach(function (n) {
      bumpPlayerRating(n, winnerDelta, ts);
    });
    loserNames.forEach(function (n) {
      bumpPlayerRating(n, loserDelta, ts);
    });
  }

  // Ratings only ever update live, at the moment a game is credited — a
  // player restored from the bundled players/*.json backup (or an
  // imported backup) arrives with full game history but no rating
  // history, so their badge shows the flat DEFAULT_RATING no matter their
  // actual record. This replays every game that's missing from the
  // ratings' timestamp record (found via each winning side's own game
  // entry, which always carries the complete winnerNames/opponentNames
  // for that game) in chronological order, so the rating ends up exactly
  // where it would have if the game had been rated live. Already-rated
  // games are skipped by ts, so this is safe to run on every boot.
  function backfillMissingRatingsFromHistory() {
    var alreadyRated = {};
    Object.keys(PLAYER_RATINGS).forEach(function (key) {
      (PLAYER_RATINGS[key].history || []).forEach(function (h) {
        alreadyRated[h.ts] = true;
      });
    });

    var byTs = {};
    getAllKnownPlayerNames().forEach(function (name) {
      allGamesForPlayerName(name).forEach(function (g) {
        if (g.result !== "won" || !g.ts || alreadyRated[g.ts] || byTs[g.ts]) return;
        byTs[g.ts] = { ts: g.ts, isTeam: !!g.isTeam, winnerNames: g.winnerNames || [], loserNames: g.opponentNames || [] };
      });
    });

    var toApply = Object.keys(byTs)
      .map(function (ts) {
        return byTs[ts];
      })
      .sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
    if (!toApply.length) return;

    toApply.forEach(function (g) {
      if (!g.winnerNames.length || !g.loserNames.length) return;
      if (g.isTeam) {
        applyTeamRatingResult(g.winnerNames, g.loserNames, g.ts);
      } else {
        g.loserNames.forEach(function (loserName) {
          applyPairwiseRatingResult(g.winnerNames[0], loserName, g.ts);
        });
      }
    });
    saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Fills in an "added" date for any known player who doesn't have one —
  // players restored from the bundled backup or an imported one were never
  // routed through addPlayer, so there's no true "first added" moment on
  // record. The earliest game on file is the closest honest estimate;
  // players with neither an added date nor any games are left alone (no
  // date is shown for them until they actually play or get re-added).
  function backfillMissingAddedDates() {
    var changed = false;
    getAllKnownPlayerNames().forEach(function (name) {
      if (findPlayerAddedKey(name)) return;
      var earliest = null;
      allGamesForPlayerName(name).forEach(function (g) {
        if (g.ts && (earliest === null || g.ts < earliest)) earliest = g.ts;
      });
      if (earliest) {
        PLAYER_ADDED[name] = earliest;
        changed = true;
      }
    });
    if (changed) savePlayerAddedToStorage(PLAYER_ADDED);
  }

  // Net rating change within a period, e.g. for the All Players page. null
  // means "no rating history at all" (never played a rated game).
  function computeRatingPeriodDelta(name, period) {
    var entry = getPlayerRatingEntry(name);
    if (!entry || entry.history.length === 0) return null;
    var periodStart = periodStartDate(period);
    var startRating = DEFAULT_RATING;
    if (periodStart) {
      var startMs = periodStart.getTime();
      for (var i = entry.history.length - 1; i >= 0; i--) {
        if (new Date(entry.history[i].ts).getTime() < startMs) {
          startRating = entry.history[i].rating;
          break;
        }
      }
    }
    return entry.rating - startRating;
  }

  // A small "412" badge next to a player's name, used everywhere a name
  // is shown (roster, scoreboard, All Players, player stats page).
  function buildRatingBadge(name) {
    var badge = document.createElement("span");
    badge.className = "rating-badge";
    badge.textContent = getPlayerRating(name);
    badge.title = T("common.ratingBadgeTitle");
    return badge;
  }

  // A small icon-only button that jumps straight to a player's single-
  // stat page — dropped in next to a player's name wherever one appears
  // (scoreboard cards, standings, tournament bracket cards, All Players),
  // alongside (not instead of) whatever else that name already does.
  function buildPlayerLinkIcon(name) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost player-link-icon";
    btn.setAttribute("aria-label", "View " + name + "'s single-player stats");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openPlayerStatsPage(name);
    });
    return btn;
  }

  // Formats a period rating change as "▲ +18", "▼ −9", "— no change", or
  // null (never rated) for the All Players page.
  function formatRatingPeriodDelta(name, period) {
    var delta = computeRatingPeriodDelta(name, period);
    if (delta === null) return null;
    if (delta > 0) return "▲ +" + delta;
    if (delta < 0) return "▼ " + delta;
    return "— no change";
  }

  // Finds an existing PLAYER_STATS key matching this name regardless of
  // case, so a lookup for "bob" still finds stats saved under "Bob".
  function findPlayerStatsKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_STATS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function getPlayerSessions(name) {
    var entry = PLAYER_STATS[findPlayerStatsKey(name) || name];
    return entry && Array.isArray(entry.sessions) ? entry.sessions.slice() : [];
  }

  function setPlayerSessions(name, sessions) {
    var key = findPlayerStatsKey(name) || name;
    PLAYER_STATS[key] = { name: key, sessions: sessions };
    savePlayerStatsToStorage(PLAYER_STATS);
  }

  // Clears every player's win/game history on this device - both the
  // archived PLAYER_STATS store and whatever's still live in the current
  // session (state.gameHistory/playerWins/teamWins), since a player's
  // stats page reads both together (see allGamesForPlayerName) and
  // leaving the live half untouched made this look like it did nothing.
  // Ratings are a separate, intentionally-preserved store - see
  // resetAllPlayersOfficialRating for that one.
  function resetAllPlayerStats() {
    confirmModal(T("confirm.resetAllPlayerStats"), function () {
      exportAllData();
      saveResetSnapshot("allPlayerStats", T("resetSnapshot.allPlayerStatsLabel"), {
        playerStats: JSON.parse(JSON.stringify(PLAYER_STATS)),
        gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins))
      });
      PLAYER_STATS = {};
      savePlayerStatsToStorage(PLAYER_STATS);
      state.playerWins = {};
      state.teamWins = {};
      state.teamMvpWins = {};
      state.gameHistory = [];
      resetGameBalls();
      saveState();
      if (currentStatsPlayerName) {
        currentStatsSessions = [];
        renderPlayerHistoryList([]);
      }
      renderAll();
      showToast(T("toast.playerStatsCleared"));
    });
  }

  // Clears every saved player list AND the live roster itself, so the app
  // starts completely clean with nobody listed - not just the saved
  // presets in the "Load Player List" dropdown, which is all this used to
  // touch.
  function resetAllRosterLists() {
    if (SAVED_ROSTERS.length === 0 && state.players.length === 0) {
      showToast(T("toast.noSavedListsToReset"));
      return;
    }
    confirmModal(T("confirm.resetRosterLists"), function () {
      exportRosterLists();
      saveResetSnapshot("rosterLists", T("resetSnapshot.rosterListsLabel"), {
        rosters: JSON.parse(JSON.stringify(SAVED_ROSTERS)),
        players: JSON.parse(JSON.stringify(state.players)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins))
      });
      SAVED_ROSTERS = [];
      saveRostersToStorage(SAVED_ROSTERS);
      populateRosterLoadSelect();
      state.players = [];
      state.playerWins = {};
      state.teamWins = {};
      state.teamMvpWins = {};
      saveState();
      validateNewPlayerNameInput();
      renderAll();
      showToast(T("toast.rosterListsCleared"));
    });
  }

  // The single most destructive action in the app - wipes every
  // poolMasterCounter.* key out of localStorage (every player, rating,
  // roster, game, tournament, and setting) and reloads, so the device
  // comes back up exactly as it would on a brand new install, migration
  // path and all. A full data backup downloads automatically first;
  // unlike every reset above, recovery from here is only ever that
  // downloaded file via Import Data - the in-app Recover Data list
  // restores individual slices, not a whole wiped device, so this
  // intentionally doesn't add an entry there.
  // The second warning step offers three ways out, not two - see
  // openDeleteByDatePicker below for why "wipe one specific day" got
  // pulled out of the all-or-nothing Full Reset flow.
  function openFullResetStep2() {
    fullResetStep2Overlay.classList.remove("hidden");
  }

  function closeFullResetStep2() {
    fullResetStep2Overlay.classList.add("hidden");
  }

  function performFullFactoryReset() {
    confirmModal(T("confirm.fullResetExplain"), function () {
      openFullResetStep2();
    });
  }

  // ---------------------------------------------------------------------
  // Delete by Dates - offered as an alternative to Full Reset's all-or-
  // nothing "wipe everything" step, for surgically removing every trace
  // of one or more specific days: player session history, any of today's
  // not-yet-archived live games, rating history (backing the rating
  // value itself out by the same amount), tournament results, day notes,
  // and the day-report archive. Deliberately literal about "wipe
  // everything from that date" - nothing recorded on a wiped day
  // survives anywhere in the app.
  // ---------------------------------------------------------------------

  // Every local calendar date (YYYY-MM-DD) with ANY data recorded
  // anywhere - drives which days the calendar lets you pick at all.
  function collectRecordedDates() {
    var dates = {};
    Object.keys(PLAYER_STATS).forEach(function (key) {
      (PLAYER_STATS[key].sessions || []).forEach(function (s) {
        if (s.date) dates[s.date] = true;
      });
    });
    state.gameHistory.forEach(function (g) {
      if (g && g.ts) dates[localDateStrFromTs(g.ts)] = true;
    });
    TOURNAMENT_RESULTS.forEach(function (r) {
      if (r.ts) dates[localDateStrFromTs(r.ts)] = true;
    });
    Object.keys(DAY_NOTES).forEach(function (d) {
      if (DAY_NOTES[d]) dates[d] = true;
    });
    return dates;
  }

  // Removes every trace of one local calendar date across every store the
  // app keeps. Returns what was actually removed from player sessions and
  // live game history so the caller can offer it back through the
  // existing Recover Data list - a partial safety net (ratings and
  // tournament results aren't restorable that way, same limitation the
  // "allPlayerStats" reset above already has) on top of the full JSON
  // backup already downloaded before this ever runs.
  function wipeAllDataForDate(dateStr) {
    var removedSessionsByName = {};
    Object.keys(PLAYER_STATS).forEach(function (key) {
      var entry = PLAYER_STATS[key];
      var sessions = entry.sessions || [];
      var kept = [];
      sessions.forEach(function (s) {
        if (s.date === dateStr) {
          if (!removedSessionsByName[entry.name]) removedSessionsByName[entry.name] = [];
          removedSessionsByName[entry.name].push(s);
        } else {
          kept.push(s);
        }
      });
      entry.sessions = kept;
    });
    savePlayerStatsToStorage(PLAYER_STATS);

    var removedGameHistory = [];
    var keptGameHistory = [];
    state.gameHistory.forEach(function (g) {
      if (g && g.ts && localDateStrFromTs(g.ts) === dateStr) {
        removedGameHistory.push(g);
        (g.winnerIds || []).forEach(function (id) {
          state.playerWins[id] = Math.max(0, (state.playerWins[id] || 0) - 1);
        });
        if (g.isTeam && g.teamId) {
          state.teamWins[g.teamId] = Math.max(0, (state.teamWins[g.teamId] || 0) - 1);
          if (g.mvpId) {
            state.teamMvpWins[g.mvpId] = Math.max(0, (state.teamMvpWins[g.mvpId] || 0) - 1);
          }
        }
        state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount - 1);
      } else {
        keptGameHistory.push(g);
      }
    });
    state.gameHistory = keptGameHistory;

    Object.keys(PLAYER_RATINGS).forEach(function (key) {
      var entry = PLAYER_RATINGS[key];
      var history = entry.history || [];
      var kept = [];
      history.forEach(function (h) {
        if (h.ts && localDateStrFromTs(h.ts) === dateStr) {
          entry.rating -= h.delta;
          if (h.fromGame) entry.gamesPlayed = Math.max(0, entry.gamesPlayed - 1);
        } else {
          kept.push(h);
        }
      });
      entry.history = kept;
    });
    saveRatingsToStorage(PLAYER_RATINGS);

    TOURNAMENT_RESULTS = TOURNAMENT_RESULTS.filter(function (r) {
      return !(r.ts && localDateStrFromTs(r.ts) === dateStr);
    });
    saveTournamentResultsToStorage(TOURNAMENT_RESULTS);

    if (DAY_NOTES[dateStr]) {
      delete DAY_NOTES[dateStr];
      saveDayNotesToStorage(DAY_NOTES);
    }

    var reportArchiveBefore = REPORT_ARCHIVE.length;
    REPORT_ARCHIVE = REPORT_ARCHIVE.filter(function (entry) {
      return entry.dateStr !== dateStr;
    });
    if (REPORT_ARCHIVE.length !== reportArchiveBefore) saveReportArchiveToStorage(REPORT_ARCHIVE);

    saveState();
    return { removedSessionsByName: removedSessionsByName, removedGameHistory: removedGameHistory };
  }

  var deleteByDateSelected = {};
  var deleteByDateViewMonth = new Date();

  function deleteByDateCellClicked(dateStr) {
    if (deleteByDateSelected[dateStr]) delete deleteByDateSelected[dateStr];
    else deleteByDateSelected[dateStr] = true;
    renderDeleteByDateCalendar();
  }

  function updateDeleteByDateSummary() {
    var dates = Object.keys(deleteByDateSelected).sort();
    btnDeleteByDateConfirm.disabled = dates.length === 0;
    deleteByDateSelectedSummary.textContent = dates.length
      ? T("resets.deleteByDatesSelectedCount", { count: dates.length, dates: dates.join(", ") })
      : T("resets.deleteByDatesNoneSelected");
  }

  function buildDeleteByDateDayCell(dateStr, dayNum, hasData, isSelected, isToday) {
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "delete-by-date-day";
    cell.textContent = String(dayNum);
    if (isToday) cell.classList.add("is-today");
    if (!hasData) {
      cell.disabled = true;
      return cell;
    }
    cell.classList.add("has-data");
    if (isSelected) cell.classList.add("is-selected");
    cell.setAttribute("aria-pressed", isSelected ? "true" : "false");
    cell.addEventListener("click", function () {
      deleteByDateCellClicked(dateStr);
    });
    return cell;
  }

  // No custom i18n for weekday initials - deferred to the browser's own
  // locale via toLocaleDateString, same approach already used for the
  // day-report's weekday name and the All Players weekly graph labels.
  function deleteByDateWeekdayLabels() {
    var labels = [];
    for (var i = 0; i < 7; i++) {
      labels.push(new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: "narrow" }));
    }
    return labels;
  }

  function renderDeleteByDateCalendar() {
    var recorded = collectRecordedDates();
    var year = deleteByDateViewMonth.getFullYear();
    var month = deleteByDateViewMonth.getMonth();
    deleteByDateMonthLabel.textContent = deleteByDateViewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    deleteByDateGrid.innerHTML = "";

    deleteByDateWeekdayLabels().forEach(function (label) {
      var h = document.createElement("div");
      h.className = "delete-by-date-weekday";
      h.textContent = label;
      deleteByDateGrid.appendChild(h);
    });

    var startOffset = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = todayDateStr();

    for (var i = 0; i < startOffset; i++) {
      var blank = document.createElement("div");
      blank.className = "delete-by-date-day is-blank";
      deleteByDateGrid.appendChild(blank);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      deleteByDateGrid.appendChild(
        buildDeleteByDateDayCell(dateStr, day, !!recorded[dateStr], !!deleteByDateSelected[dateStr], dateStr === today)
      );
    }

    updateDeleteByDateSummary();
  }

  // Opens on whichever month the most recent recorded data actually
  // falls in, rather than always the real-world current month - most of
  // the time that's the same thing, but it means a device that hasn't
  // been used this calendar month still lands somewhere with selectable
  // days instead of an empty grid the user has to page back from.
  function openDeleteByDatePicker() {
    deleteByDateSelected = {};
    var recorded = Object.keys(collectRecordedDates()).sort();
    var anchor = recorded.length ? new Date(recorded[recorded.length - 1] + "T00:00:00") : new Date();
    deleteByDateViewMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    renderDeleteByDateCalendar();
    deleteByDateOverlay.classList.remove("hidden");
  }

  function closeDeleteByDatePicker() {
    deleteByDateOverlay.classList.add("hidden");
  }

  function confirmDeleteByDateSelection() {
    var dates = Object.keys(deleteByDateSelected).sort();
    if (!dates.length) return;
    confirmModal(T("resets.deleteByDatesConfirm", { count: dates.length, dates: dates.join(", ") }), function () {
      exportAllData();
      var combinedSessionsByName = {};
      var combinedGameHistory = [];
      dates.forEach(function (dateStr) {
        var result = wipeAllDataForDate(dateStr);
        Object.keys(result.removedSessionsByName).forEach(function (name) {
          if (!combinedSessionsByName[name]) combinedSessionsByName[name] = [];
          combinedSessionsByName[name] = combinedSessionsByName[name].concat(result.removedSessionsByName[name]);
        });
        combinedGameHistory = combinedGameHistory.concat(result.removedGameHistory);
      });

      var playerStatsSnapshot = {};
      Object.keys(combinedSessionsByName).forEach(function (name) {
        playerStatsSnapshot[name] = { name: name, sessions: combinedSessionsByName[name] };
      });
      saveResetSnapshot("allPlayerStats", T("resetSnapshot.deleteByDatesLabel", { dates: dates.join(", ") }), {
        playerStats: playerStatsSnapshot,
        gameHistory: combinedGameHistory
      });

      closeDeleteByDatePicker();
      if (currentStatsPlayerName) {
        currentStatsSessions = getPlayerSessions(currentStatsPlayerName);
        renderPlayerHistoryList(currentStatsSessions);
        renderPlayerSynopsis();
      }
      renderRecoverDataList();
      renderAll();
      showToast(T("toast.deleteByDatesDone", { count: dates.length }));
    });
  }

  // One-time migration: the app used to store rosters/player stats as JSON
  // files committed to this GitHub repo. The first time this version boots,
  // pull in whatever's still out there so history isn't lost, then never
  // touch the repo again.
  function migrateFromRepoIfNeeded() {
    var alreadyMigrated;
    try {
      alreadyMigrated = localStorage.getItem(ROSTERS_KEY) !== null || localStorage.getItem(PLAYER_STATS_KEY) !== null;
    } catch (e) {
      alreadyMigrated = false;
    }
    if (alreadyMigrated) return Promise.resolve();

    return fetchFresh("players/rosters.json")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      })
      .then(function (rosters) {
        rosters = Array.isArray(rosters) ? rosters : [];
        var nameSet = {};
        rosters.forEach(function (r) {
          (r.players || []).forEach(function (n) {
            nameSet[n] = true;
          });
        });
        state.players.forEach(function (p) {
          nameSet[p.name] = true;
        });
        var names = Object.keys(nameSet);
        return Promise.all(
          names.map(function (name) {
            return fetchFresh("players/" + playerStatsFilename(name))
              .then(function (res) {
                return res.ok ? res.json() : null;
              })
              .catch(function () {
                return null;
              })
              .then(function (data) {
                if (data && Array.isArray(data.sessions) && data.sessions.length) {
                  PLAYER_STATS[name] = { name: name, sessions: data.sessions };
                }
              });
          })
        ).then(function () {
          SAVED_ROSTERS = rosters;
          saveRostersToStorage(rosters);
          savePlayerStatsToStorage(PLAYER_STATS);
        });
      });
  }

  var LAST_SYNC_EXPORT_KEY = "poolMasterCounter.lastSyncExportedAt";
  var LAST_SYNC_IMPORT_KEY = "poolMasterCounter.lastSyncImportedAt";
  var LAST_SYNC_EXPORTER_NAME_KEY = "poolMasterCounter.lastSyncExporterName";
  var LAST_SYNC_IMPORT_NAME_KEY = "poolMasterCounter.lastSyncImportedFromName";

  function loadLastSyncExporterName() {
    try {
      return localStorage.getItem(LAST_SYNC_EXPORTER_NAME_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function saveLastSyncExporterName(name) {
    try {
      localStorage.setItem(LAST_SYNC_EXPORTER_NAME_KEY, name || "");
    } catch (e) {
      console.warn("Could not save sync exporter name.", e);
    }
  }

  function defaultBackupFilename() {
    return "pool-master-counter-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  }

  // Date + day-of-week (e.g. "2026-09-08-Tuesday") plus, when given, the
  // exporting person's name - so several people syncing the same iCloud
  // Drive folder each land a distinct, dated file instead of everyone
  // colliding on one filename or overwriting each other's export.
  // Both halves must come from the same local calendar day - toISOString()
  // is UTC, so pairing it with a locale (local-time) weekday name could
  // silently mismatch near midnight (e.g. a UTC-behind timezone rolling
  // into a new UTC date while it's still evening locally): formatDateISO
  // and toLocaleDateString both read local getFullYear/getMonth/getDate
  // under the hood, so they always agree.
  function defaultSyncFilename(exporterName) {
    var now = new Date();
    var dayName = now.toLocaleDateString(undefined, { weekday: "long" });
    var base = formatDateISO(now) + "-" + dayName;
    var trimmedName = (exporterName || "").trim();
    if (trimmedName) base += "-" + trimmedName;
    return sanitizeBackupFilename(base);
  }

  // Strips characters a filesystem would reject and appends .json if the
  // caller's name doesn't already end with it - used for a user-typed
  // backup name, not the auto-generated default (which is already safe).
  function sanitizeBackupFilename(name) {
    var trimmed = (name || "").trim().replace(/[\\/:*?"<>|]/g, "");
    if (!trimmed) return defaultBackupFilename();
    return /\.json$/i.test(trimmed) ? trimmed : trimmed + ".json";
  }

  // Shared by exportAllData and shareReport - the exact same full-app
  // snapshot either way, just delivered differently (a plain download
  // vs a Web Share attachment).
  function buildBackupPayload() {
    return {
      exportedAt: new Date().toISOString(),
      state: state,
      rosters: SAVED_ROSTERS,
      teams: SAVED_TEAMS,
      playerStats: PLAYER_STATS,
      ratings: PLAYER_RATINGS,
      contacts: PLAYER_CONTACTS,
      playerAdded: PLAYER_ADDED
    };
  }

  // filename (optional): only the manual "Export All Data" button passes
  // one, via the promptModal that lets the user name the file - the
  // automatic safety-backup call sites (resetTodayStats,
  // resetAllPlayerStats) call this with no argument on purpose, since
  // those are silent safety nets and shouldn't interrupt the reset flow
  // with a prompt.
  function exportAllData(filename) {
    downloadJSON(filename ? sanitizeBackupFilename(filename) : defaultBackupFilename(), buildBackupPayload());
  }

  // Not a new storage mechanism - Safari has no programmatic access to a
  // real iCloud Drive folder (no showSaveFilePicker/showOpenFilePicker
  // support), so this is the same <a download> flow as exportAllData, just
  // dated + named (see defaultSyncFilename) so several people syncing the
  // same iCloud Drive folder each land their own distinct file, and a
  // "last synced" timestamp/exporter name so the habit is visible.
  function exportForSync() {
    promptModal(T("backup.syncExportNamePrompt"), loadLastSyncExporterName(), function (nameInput) {
      var exporterName = (nameInput || "").trim();
      saveLastSyncExporterName(exporterName);
      var payload = buildBackupPayload();
      payload.exportedBy = exporterName || null;
      downloadJSON(defaultSyncFilename(exporterName), payload);
      try {
        localStorage.setItem(LAST_SYNC_EXPORT_KEY, payload.exportedAt);
      } catch (e) {
        console.warn("Could not save last-sync-export timestamp.", e);
      }
      renderSyncStatusLine();
    });
  }

  function renderSyncStatusLine() {
    var exportedAt, importedAt, exporterName, importedFromName;
    try {
      exportedAt = localStorage.getItem(LAST_SYNC_EXPORT_KEY);
      importedAt = localStorage.getItem(LAST_SYNC_IMPORT_KEY);
      exporterName = localStorage.getItem(LAST_SYNC_EXPORTER_NAME_KEY);
      importedFromName = localStorage.getItem(LAST_SYNC_IMPORT_NAME_KEY);
    } catch (e) {
      exportedAt = null;
      importedAt = null;
      exporterName = null;
      importedFromName = null;
    }
    var exportedText = exportedAt ? formatTimestamp(exportedAt, true) : T("backup.syncStatusNever");
    var importedText = importedAt ? formatTimestamp(importedAt, true) : T("backup.syncStatusNever");
    var exportedLine =
      exportedAt && exporterName
        ? T("backup.syncStatusExportedByName", { when: exportedText, name: exporterName })
        : T("backup.syncStatusExported", { when: exportedText });
    var importedLine =
      importedAt && importedFromName
        ? T("backup.syncStatusImportedFromName", { when: importedText, name: importedFromName })
        : T("backup.syncStatusImported", { when: importedText });
    syncStatusLine.textContent = exportedLine + " · " + importedLine;
  }

  // Shared by the Copy Report button and shareReport()'s no-native-share
  // text-only fallback below.
  function copyReportToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast(T("toast.dayReportCopied"));
        },
        function () {
          alertModal(text);
        }
      );
    } else {
      alertModal(text);
    }
  }

  // Builds whichever File attachments the two "Attach ... when sharing"
  // checkboxes call for, in parallel - the backup JSON is synchronous
  // (built from data already in memory), the colorful report PNG isn't
  // (a canvas draw + toBlob), so this always returns a Promise even
  // though the common case (only the backup checkbox, or neither) never
  // actually waits on anything.
  function collectDayReportAttachments() {
    var files = [];
    var tasks = [];
    if (dayReportAttachBackupCheckbox.checked) {
      // Reuses the same full-backup payload as exportAllData, minus
      // contacts (email/phone), which have no business leaving the
      // device in a file meant to be handed to whoever's on the other
      // end of Mail/Messages/AirDrop. Sending an empty object rather
      // than omitting the key entirely still round-trips cleanly
      // through mergeContactsData if this file is ever imported
      // elsewhere: local contact info always wins on a name conflict
      // there, and an empty import adds nothing.
      var payload = buildBackupPayload();
      payload.contacts = {};
      files.push(new File([JSON.stringify(payload, null, 2)], defaultBackupFilename(), { type: "application/json" }));
    }
    if (dayReportAttachColorfulCheckbox.checked) {
      tasks.push(
        buildDayReportImageBlob(todayDateStr()).then(function (blob) {
          if (blob) files.push(new File([blob], "pool-master-counter-report-" + todayDateStr() + ".png", { type: "image/png" }));
        })
      );
    }
    return Promise.all(tasks).then(function () {
      return files;
    });
  }

  function downloadFileObject(file) {
    var url = URL.createObjectURL(file);
    var a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // mailto:/sms: links (what Email/Text Report use when nothing's being
  // attached) can't carry file attachments - that's a platform
  // restriction, not something fixable here. The Web Share API is the
  // actual way to hand a file to Mail, Messages, AirDrop, etc. with it
  // genuinely attached, so whenever either "Attach ... when sharing"
  // checkbox is on, Email Report, Text Report and Share Report all try
  // this first instead of going straight to a mailto:/sms: link - which
  // does mean giving up the auto-filled opted-in recipient for a manual
  // pick in the OS share sheet, but there's no API that offers both a
  // pre-filled recipient and a real attachment.
  //
  // onFallback (optional): called whenever the file-attach path fails
  // for ANY reason - no navigator.share/canShare support at all, or
  // the harder case some desktop Chrome/macOS combos hit, where
  // canShare({files}) reports true but share() then rejects every
  // call anyway (confirmed live). Without this, that failure left
  // the caller with nothing but a silently downloaded file - no email
  // composed, no text message started, nothing - which is worse than
  // what Email/Text Report did before file attachment existed at all.
  // Callers pass their own normal fallback (open the mailto:/sms:
  // link, or a text-only share) so a broken share sheet degrades back
  // to "everything except the actual attachment" instead of "nothing".
  function shareReportWithAttachments(text, onFallback) {
    collectDayReportAttachments().then(function (files) {
      if (!files.length) {
        if (onFallback) onFallback();
        return;
      }

      function fallback() {
        files.forEach(downloadFileObject);
        showToast(T("toast.shareFallback"));
        if (onFallback) onFallback();
      }

      // canShare() saying yes doesn't guarantee share() actually works -
      // some desktop Chrome/macOS combos report file-sharing support but
      // then reject every call with NotAllowedError (canShare with a
      // files array is still the correct feature test up front; share()
      // alone doesn't imply file support).
      if (navigator.canShare && navigator.canShare({ files: files })) {
        navigator.share({
          files: files,
          title: "Pool Master Counter — Day Report",
          text: text
        }).catch(function (err) {
          if (err && err.name === "AbortError") return;
          fallback();
        });
      } else {
        fallback();
      }
    });
  }

  // Neither attach checkbox is on: a plain text share of the day report
  // and nothing more, same as any other native share sheet - falls back
  // to the same clipboard copy Copy Report uses on a browser/device with
  // no navigator.share at all.
  function shareReportTextOnly(text) {
    if (navigator.share) {
      navigator.share({ title: "Pool Master Counter — Day Report", text: text }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        copyReportToClipboard(text);
      });
    } else {
      copyReportToClipboard(text);
    }
  }

  function shareReport() {
    var text = buildDayReportTextForSharing(todayDateStr());
    if (dayReportAttachBackupCheckbox.checked || dayReportAttachColorfulCheckbox.checked) {
      shareReportWithAttachments(text, function () {
        shareReportTextOnly(text);
      });
    } else {
      shareReportTextOnly(text);
    }
  }

  // Pulls every (player, calendar date) pair referenced in an imported
  // backup's in-progress gameHistory into proper session records, so those
  // not-yet-exported games aren't silently dropped when we merge instead of
  // adopting that backup's live state wholesale.
  function summarizeGameHistoryByPlayer(gameHistory) {
    var byPlayerDates = {};
    (gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerNames || !entry.ts) return;
      var date = entry.ts.slice(0, 10);
      (entry.winnerNames || []).concat(entry.opponentNames || []).forEach(function (name) {
        if (!byPlayerDates[name]) byPlayerDates[name] = {};
        byPlayerDates[name][date] = true;
      });
    });
    var sessionsByPlayer = {};
    Object.keys(byPlayerDates).forEach(function (name) {
      var sessions = Object.keys(byPlayerDates[name])
        .map(function (date) {
          return computeSessionFromGameHistory(gameHistory, name, date);
        })
        .filter(Boolean);
      if (sessions.length) sessionsByPlayer[name] = sessions;
    });
    return sessionsByPlayer;
  }

  // Merges an imported PLAYER_STATS object, plus any extra sessions pulled
  // from the imported backup's live gameHistory, into the local one.
  function mergePlayerStatsData(localStats, importedStats, extraSessionsByPlayer) {
    var merged = {};
    Object.keys(localStats || {}).forEach(function (name) {
      merged[name] = { name: name, sessions: (localStats[name].sessions || []).slice() };
    });
    function foldIn(name, sessions) {
      if (!merged[name]) merged[name] = { name: name, sessions: [] };
      merged[name].sessions = mergeSessionLists(merged[name].sessions, sessions);
    }
    Object.keys(importedStats || {}).forEach(function (name) {
      var entry = importedStats[name];
      foldIn(name, entry && Array.isArray(entry.sessions) ? entry.sessions : []);
    });
    Object.keys(extraSessionsByPlayer || {}).forEach(function (name) {
      foldIn(name, extraSessionsByPlayer[name]);
    });
    return merged;
  }

  // Unions two rating stores by combining each player's history (deduped
  // by timestamp) and recomputing the current rating/games-played from
  // the merged, time-sorted history — rather than picking one side's
  // number — so importing a backup from another device never overwrites
  // a rating with a stale one or double-counts a game both sides know.
  function mergeRatingsData(localRatings, importedRatings) {
    var merged = {};
    Object.keys(localRatings || {}).forEach(function (name) {
      merged[name] = (localRatings[name].history || []).slice();
    });
    Object.keys(importedRatings || {}).forEach(function (name) {
      var history = importedRatings[name] && Array.isArray(importedRatings[name].history) ? importedRatings[name].history : [];
      merged[name] = (merged[name] || []).concat(history);
    });
    var result = {};
    Object.keys(merged).forEach(function (name) {
      var seen = {};
      var deduped = [];
      merged[name]
        .slice()
        .sort(function (a, b) {
          return a.ts.localeCompare(b.ts);
        })
        .forEach(function (h) {
          if (seen[h.ts]) return;
          seen[h.ts] = true;
          deduped.push(h);
        });
      result[name] = {
        name: name,
        rating: deduped.length ? deduped[deduped.length - 1].rating : DEFAULT_RATING,
        gamesPlayed: deduped.length,
        history: deduped
      };
    });
    return result;
  }

  // Earliest date wins on a name match - "added" should reflect when a
  // name was truly first seen, on whichever device saw it first, not
  // whichever side of the import happens to be read last.
  function mergePlayerAddedData(localAdded, importedAdded) {
    var merged = {};
    Object.keys(importedAdded || {}).forEach(function (name) {
      merged[name] = importedAdded[name];
    });
    Object.keys(localAdded || {}).forEach(function (name) {
      var existing = merged[name];
      merged[name] = existing && existing < localAdded[name] ? existing : localAdded[name];
    });
    return merged;
  }

  // Unions two saved-roster-list arrays, skipping entries whose player set
  // already exists locally. Keyed purely by sorted players (not id/savedAt)
  // so re-importing the same hand-edited file — or the same backup twice —
  // never duplicates a list just because a fresh id/timestamp got assigned.
  function mergeRosterLists(localRosters, importedRosters) {
    var seen = {};
    var merged = [];
    function rosterKey(r) {
      return (r.players || []).map(normalizeNameKey).sort().join(",");
    }
    (localRosters || []).forEach(function (r) {
      var key = rosterKey(r);
      if (seen[key]) return;
      seen[key] = true;
      merged.push(r);
    });
    var added = 0;
    (importedRosters || []).forEach(function (r) {
      var key = rosterKey(r);
      if (seen[key]) return;
      seen[key] = true;
      merged.push(r);
      added += 1;
    });
    merged.sort(function (a, b) {
      return (a.savedAt || "").localeCompare(b.savedAt || "");
    });
    return { rosters: merged, added: added };
  }

  // Same "union, skip what's already known" shape as mergeRosterLists, but
  // keyed by name (a team's whole point is being a named, reusable entity)
  // rather than by member set - on a name collision the local team wins
  // and the imported one is simply skipped, rather than silently
  // overwriting a locally-redefined lineup.
  function mergeTeamLists(localTeams, importedTeams) {
    var seen = {};
    var merged = [];
    (localTeams || []).forEach(function (t) {
      var key = normalizeNameKey(t.name);
      if (seen[key]) return;
      seen[key] = true;
      merged.push(t);
    });
    var added = 0;
    (importedTeams || []).forEach(function (t) {
      var key = normalizeNameKey(t.name);
      if (!t.name || seen[key]) return;
      seen[key] = true;
      merged.push(t);
      added += 1;
    });
    merged.sort(function (a, b) {
      return (a.createdAt || "").localeCompare(b.createdAt || "");
    });
    return { teams: merged, added: added };
  }

  // A friendly, hand-editable export: just label + players per list, no
  // internal id/savedAt bookkeeping to get wrong when writing one by hand.
  function exportRosterLists() {
    var payload = {
      exportedAt: new Date().toISOString(),
      rosterLists: SAVED_ROSTERS.map(function (r) {
        return { label: r.label, players: r.players };
      })
    };
    downloadJSON("pool-master-counter-player-lists-" + payload.exportedAt.slice(0, 10) + ".json", payload);
  }

  // A real spreadsheet table of every saved player list - one row per
  // list, players joined into a single readable cell (a list's whole
  // point is the group, not one row per member).
  function buildRosterListsCsv() {
    var lines = [];
    lines.push(csvRow(["Pool Master Counter — Player Lists"]));
    lines.push("\r\n");
    lines.push(csvRow(["List", "Player Count", "Players", "Saved"]));
    SAVED_ROSTERS.forEach(function (r) {
      lines.push(csvRow([r.label, (r.players || []).length, (r.players || []).join(", "), r.savedAt ? formatTimestamp(r.savedAt, true) : ""]));
    });
    return "\uFEFF" + lines.join("");
  }

  // Accepts a bare array of names, a {label, players} object (the hand-
  // editable export shape), or a full saved-roster entry with id/savedAt —
  // whatever's easiest to write by hand or came from a previous export.
  function normalizeImportedRosterEntry(entry, idx) {
    var players;
    if (Array.isArray(entry)) {
      players = entry;
    } else if (entry && typeof entry === "object") {
      players = entry.players;
    } else {
      return null;
    }
    players = (Array.isArray(players) ? players : [])
      .filter(function (n) {
        return typeof n === "string" && n.trim();
      })
      .map(function (n) {
        return capitalizeName(n.trim());
      });
    if (!players.length) return null;
    var savedAt = (entry && !Array.isArray(entry) && entry.savedAt) || new Date().toISOString();
    var label = (entry && !Array.isArray(entry) && entry.label) || (savedAt.slice(0, 10) + " — " + players.join(", "));
    var id = (entry && !Array.isArray(entry) && entry.id) || ("roster-import-" + savedAt.replace(/[:.]/g, "-") + "-" + idx);
    return { id: id, label: label, players: players, savedAt: savedAt };
  }

  function importRosterListsFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      var rawList = Array.isArray(data)
        ? data
        : Array.isArray(data.rosterLists)
        ? data.rosterLists
        : Array.isArray(data.rosters)
        ? data.rosters
        : null;
      if (!rawList) {
        alertModal(T("alert.notAPlayerListFile"));
        return;
      }
      var normalized = rawList.map(normalizeImportedRosterEntry).filter(Boolean);
      if (!normalized.length) {
        alertModal(T("alert.noValidPlayerLists"));
        return;
      }
      var merge = mergeRosterLists(SAVED_ROSTERS, normalized);
      SAVED_ROSTERS = merge.rosters;
      saveRostersToStorage(SAVED_ROSTERS);
      populateRosterLoadSelect();
      showToast(
        T(
          merge.added === 1
            ? (merge.added < normalized.length ? "toast.importedPlayerListsOne" : "toast.importedPlayerListsOneAll")
            : (merge.added < normalized.length ? "toast.importedPlayerListsMany" : "toast.importedPlayerListsManyAll"),
          { count: merge.added }
        )
      );
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // Lists `names` in the removed-players conflict overlay, each defaulting
  // to unchecked (keep removed - the local device's own choice wins by
  // default). Calls onContinue with just the names the user checked to
  // restore; importAllData handles actually re-adding them.
  function showRemovedPlayersConflict(names, onContinue) {
    removedPlayersChecklist.innerHTML = "";
    names.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "tournament-player-check-row";
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      var span = document.createElement("span");
      span.textContent = name;
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      removedPlayersChecklist.appendChild(li);
    });
    removedPlayersOverlay.classList.remove("hidden");
    function handleContinue() {
      var restored = Array.prototype.slice
        .call(removedPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (cb) {
          return cb.value;
        });
      removedPlayersOverlay.classList.add("hidden");
      btnRemovedPlayersContinue.removeEventListener("click", handleContinue);
      onContinue(restored);
    }
    btnRemovedPlayersContinue.addEventListener("click", handleContinue);
  }

  function formatConflictFacts(facts) {
    var parts = [];
    parts.push(T(facts.sessions === 1 ? "playerConflict.oneSession" : "playerConflict.manySessions", { count: facts.sessions }));
    parts.push(T("playerConflict.ratingFact", { rating: facts.rating }));
    parts.push(T(facts.addedAt ? "playerConflict.addedFact" : "playerConflict.addedUnknownFact", { date: facts.addedAt || "" }));
    return parts.join(" · ");
  }

  // Same-name-on-both-sides conflicts found by importAllData's merge
  // branch (see there for how `conflicts` - [{name, local, imported}],
  // each side {rating, sessions, addedAt} - gets built). Each row
  // defaults to "sync" (today's existing merge-by-name behavior);
  // picking "keep separate" is what's new. onContinue receives a plain
  // {name: "sync"|"separate"} map.
  function showPlayerConflictOverlay(conflicts, onContinue) {
    playerConflictList.innerHTML = "";
    conflicts.forEach(function (conflict, i) {
      var li = document.createElement("li");
      li.className = "player-conflict-row";

      var nameEl = document.createElement("div");
      nameEl.className = "player-conflict-row-name";
      nameEl.textContent = conflict.name;
      li.appendChild(nameEl);

      var factsEl = document.createElement("div");
      factsEl.className = "player-conflict-row-facts";
      factsEl.textContent =
        T("playerConflict.hereLabel") + " " + formatConflictFacts(conflict.local) + " — " +
        T("playerConflict.backupLabel") + " " + formatConflictFacts(conflict.imported);
      li.appendChild(factsEl);

      var choices = document.createElement("div");
      choices.className = "wizard-format-options";
      var radioName = "player-conflict-choice-" + i;

      var syncLabel = document.createElement("label");
      syncLabel.className = "wizard-format-option";
      var syncRadio = document.createElement("input");
      syncRadio.type = "radio";
      syncRadio.name = radioName;
      syncRadio.value = "sync";
      syncRadio.checked = true;
      var syncSpan = document.createElement("span");
      syncSpan.textContent = T("playerConflict.sync");
      syncLabel.appendChild(syncRadio);
      syncLabel.appendChild(syncSpan);
      choices.appendChild(syncLabel);

      var separateLabel = document.createElement("label");
      separateLabel.className = "wizard-format-option";
      var separateRadio = document.createElement("input");
      separateRadio.type = "radio";
      separateRadio.name = radioName;
      separateRadio.value = "separate";
      var separateSpan = document.createElement("span");
      separateSpan.textContent = T("playerConflict.keepSeparate");
      separateLabel.appendChild(separateRadio);
      separateLabel.appendChild(separateSpan);
      choices.appendChild(separateLabel);

      li.appendChild(choices);
      li.dataset.conflictName = conflict.name;
      playerConflictList.appendChild(li);
    });
    playerConflictOverlay.classList.remove("hidden");
    function handleContinue() {
      var choices = {};
      conflicts.forEach(function (conflict, i) {
        var checked = playerConflictList.querySelector('input[name="player-conflict-choice-' + i + '"]:checked');
        choices[conflict.name] = checked ? checked.value : "sync";
      });
      playerConflictOverlay.classList.add("hidden");
      btnPlayerConflictContinue.removeEventListener("click", handleContinue);
      onContinue(choices);
    }
    btnPlayerConflictContinue.addEventListener("click", handleContinue);
  }

  function importAllData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      if (!data || typeof data !== "object" || !data.state) {
        alertModal(describeUnrecognizedBackupFile(data));
        return;
      }

      // A device with no players yet has nothing to lose — treat this like
      // setting up a new device from a backup and adopt it as-is. Otherwise,
      // merge: keep the in-progress game running here, and fold the
      // backup's history in without double-counting anything already known.
      var localIsFresh = state.players.length === 0;

      // Informational only, never a blocking gate - the merge logic below
      // already handles conflicts safely regardless of which side is
      // newer. exportedAt is written into every backup payload but was,
      // until now, never read back on import; comparing it against this
      // device's own last sync-export (if any) just tells the user what
      // they're about to bring in.
      var lastSyncExportedAt;
      try {
        lastSyncExportedAt = localStorage.getItem(LAST_SYNC_EXPORT_KEY);
      } catch (e) {
        lastSyncExportedAt = null;
      }
      var syncHint = data.exportedAt
        ? T(data.exportedBy ? "confirm.importBackupSyncHintByName" : "confirm.importBackupSyncHint", {
            imported: formatTimestamp(data.exportedAt, true),
            name: data.exportedBy,
            lastExport: lastSyncExportedAt ? formatTimestamp(lastSyncExportedAt, true) : T("backup.syncStatusNever")
          }) + " "
        : "";

      confirmModal(syncHint + T(localIsFresh ? "confirm.importBackupFresh" : "confirm.importBackupMerge"), function () {
        try {
          var importedState = data.state && typeof data.state === "object" ? data.state : defaultState();
          var importedRosters = Array.isArray(data.rosters) ? data.rosters : [];
          var importedTeams = Array.isArray(data.teams) ? data.teams : [];
          var importedPlayerStats = data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {};
          var extraSessions = summarizeGameHistoryByPlayer(importedState.gameHistory || []);
          var importedRatings = data.ratings && typeof data.ratings === "object" ? data.ratings : {};
          var importedContacts = data.contacts && typeof data.contacts === "object" ? data.contacts : {};
          var importedPlayerAdded = data.playerAdded && typeof data.playerAdded === "object" ? data.playerAdded : {};

          var importedRosterPlayerNames = [];
          importedRosters.forEach(function (r) {
            (r.players || []).forEach(function (n) {
              importedRosterPlayerNames.push(n);
            });
          });

          // Finds the actual key in an imported (not-yet-local) store
          // matching `name`, case-insensitively - the imported side's
          // own casing may not match what candidateNames used to spot it.
          function findImportedKey(obj, name) {
            var key = normalizeNameKey(name);
            var match = Object.keys(obj || {}).filter(function (k) {
              return normalizeNameKey(k) === key;
            });
            return match.length ? match[0] : null;
          }

          // Renames `oldName` to `newName` everywhere it appears on the
          // imported side only - used for a "keep separate" choice below,
          // so every merge/add step that follows treats it as a brand-new,
          // distinct name instead of colliding with the local player.
          function renameImportedName(oldName, newName) {
            (importedState.players || []).forEach(function (p) {
              if (p && normalizeNameKey(p.name) === normalizeNameKey(oldName)) p.name = newName;
            });
            [importedPlayerStats, extraSessions, importedRatings, importedContacts, importedPlayerAdded].forEach(function (store) {
              var key = findImportedKey(store, oldName);
              if (!key) return;
              var value = store[key];
              delete store[key];
              store[newName] = value;
              if (value && typeof value === "object" && "name" in value) value.name = newName;
            });
            importedRosterPlayerNames = importedRosterPlayerNames.map(function (n) {
              return normalizeNameKey(n) === normalizeNameKey(oldName) ? newName : n;
            });
            importedRosters.forEach(function (r) {
              if (!Array.isArray(r.players)) return;
              r.players = r.players.map(function (n) {
                return normalizeNameKey(n) === normalizeNameKey(oldName) ? newName : n;
              });
            });
          }

          // Names skipped because they're in REMOVED_PLAYERS - this
          // device deliberately removed them, so the import shouldn't
          // silently re-add them. Collected here and resolved after the
          // merge via the removed-players conflict overlay.
          var conflictedNames = [];
          var conflictSeen = {};
          function collectConflict(name) {
            var key = normalizeNameKey(name);
            if (conflictSeen[key]) return;
            conflictSeen[key] = true;
            conflictedNames.push(name);
          }

          // Runs everything that used to run unconditionally - now after
          // any same-name choices (see below) have already been applied
          // as renames on the imported side, so these merges only ever
          // see one imported name per real local name matched: exactly
          // one it should combine with (sync) or one that's now distinct
          // (keep separate).
          function proceedWithMerge() {
            var mergedPlayerStats = mergePlayerStatsData(PLAYER_STATS, importedPlayerStats, extraSessions);
            var rosterMerge = mergeRosterLists(SAVED_ROSTERS, importedRosters);
            var teamMerge = mergeTeamLists(SAVED_TEAMS, importedTeams);
            var mergedRatings = mergeRatingsData(PLAYER_RATINGS, importedRatings);
            var mergedContacts = mergeContactsData(PLAYER_CONTACTS, importedContacts);
            var mergedPlayerAdded = mergePlayerAddedData(PLAYER_ADDED, importedPlayerAdded);

            var finalState;
            var newPlayerCount = 0;
            if (localIsFresh) {
              finalState = importedState;
              finalState.players = (finalState.players || []).filter(function (p) {
                if (p && p.name && isPlayerRemoved(p.name)) {
                  collectConflict(p.name);
                  return false;
                }
                return true;
              });
              var freshKnownNames = {};
              finalState.players.forEach(function (p) {
                freshKnownNames[normalizeNameKey(p.name)] = true;
              });
              importedRosterPlayerNames.forEach(function (name) {
                if (!name || freshKnownNames[normalizeNameKey(name)]) return;
                if (isPlayerRemoved(name)) {
                  collectConflict(name);
                  return;
                }
                freshKnownNames[normalizeNameKey(name)] = true;
                finalState.players.push({
                  id: uid(),
                  name: name,
                  voice: finalState.players.length % VOICE_PITCHES.length,
                  playing: false,
                  teamId: null,
                  balls: 0
                });
              });
            } else {
              finalState = state;
              var knownNames = {};
              finalState.players.forEach(function (p) {
                knownNames[normalizeNameKey(p.name)] = true;
              });
              var candidateNames = (Array.isArray(importedState.players) ? importedState.players : [])
                .map(function (p) {
                  return p && p.name;
                })
                .concat(Object.keys(importedPlayerStats))
                .concat(Object.keys(extraSessions))
                .concat(importedRosterPlayerNames);
              candidateNames.forEach(function (name) {
                if (!name || knownNames[normalizeNameKey(name)]) return;
                if (isPlayerRemoved(name)) {
                  knownNames[normalizeNameKey(name)] = true;
                  collectConflict(name);
                  return;
                }
                knownNames[normalizeNameKey(name)] = true;
                finalState.players.push({
                  id: uid(),
                  name: name,
                  voice: finalState.players.length % VOICE_PITCHES.length,
                  playing: false,
                  teamId: null,
                  balls: 0
                });
                newPlayerCount += 1;
              });
            }

            // Capitalizes every roster name at once, covering both freshly-
            // adopted importedState.players (never passed through addPlayer)
            // and any newly-pushed candidates above, so an imported backup
            // with lowercase names can't leave the roster inconsistently cased.
            finalState.players.forEach(function (p) {
              if (p && p.name) p.name = capitalizeName(p.name);
            });

            localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosterMerge.rosters));
            localStorage.setItem(TEAMS_KEY, JSON.stringify(teamMerge.teams));
            localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(mergedPlayerStats));
            localStorage.setItem(RATINGS_KEY, JSON.stringify(mergedRatings));
            localStorage.setItem(CONTACTS_KEY, JSON.stringify(mergedContacts));
            localStorage.setItem(PLAYER_ADDED_KEY, JSON.stringify(mergedPlayerAdded));

            function finishImport() {
              if (data.exportedAt) {
                try {
                  localStorage.setItem(LAST_SYNC_IMPORT_KEY, data.exportedAt);
                  if (data.exportedBy) localStorage.setItem(LAST_SYNC_IMPORT_NAME_KEY, data.exportedBy);
                } catch (e) {
                  console.warn("Could not save last-sync-import timestamp.", e);
                }
              }
              localStorage.setItem(STORAGE_KEY, JSON.stringify(finalState));
              if (!localIsFresh) {
                alertModal(T("alert.mergedImport", { players: newPlayerCount, lists: rosterMerge.added }), function () {
                  location.reload();
                });
              } else {
                location.reload();
              }
            }

            if (conflictedNames.length) {
              showRemovedPlayersConflict(conflictedNames, function (restoredNames) {
                restoredNames.forEach(function (name) {
                  clearPlayerRemoved(name);
                  finalState.players.push({
                    id: uid(),
                    name: capitalizeName(name),
                    voice: finalState.players.length % VOICE_PITCHES.length,
                    playing: false,
                    teamId: null,
                    balls: 0
                  });
                  if (!localIsFresh) newPlayerCount += 1;
                });
                finishImport();
              });
            } else {
              finishImport();
            }
          }

          // Same-name-on-both-sides check: only possible in the merge
          // case (a fresh local roster has nobody to collide with). Every
          // existing merge below already treats a name match as "same
          // person" automatically - this is what makes that a choice
          // instead, without changing anything about how sync itself works.
          if (!localIsFresh) {
            var existingNames = {};
            state.players.forEach(function (p) {
              existingNames[normalizeNameKey(p.name)] = p.name;
            });
            var seenCandidate = {};
            var conflicts = [];
            (Array.isArray(importedState.players) ? importedState.players : [])
              .map(function (p) {
                return p && p.name;
              })
              .concat(Object.keys(importedPlayerStats))
              .concat(Object.keys(extraSessions))
              .concat(importedRosterPlayerNames)
              .forEach(function (name) {
                if (!name) return;
                var key = normalizeNameKey(name);
                if (seenCandidate[key] || !existingNames[key]) return;
                seenCandidate[key] = true;
                var localName = existingNames[key];
                var localRatingEntry = getPlayerRatingEntry(localName);
                var localStatsKey = findPlayerStatsKey(localName);
                var importedRatingKey = findImportedKey(importedRatings, name);
                var importedStatsKey = findImportedKey(importedPlayerStats, name);
                var importedAddedKey = findImportedKey(importedPlayerAdded, name);
                conflicts.push({
                  name: localName,
                  local: {
                    rating: localRatingEntry ? localRatingEntry.rating : DEFAULT_RATING,
                    sessions: localStatsKey ? (PLAYER_STATS[localStatsKey].sessions || []).length : 0,
                    addedAt: getPlayerAddedAt(localName) ? getPlayerAddedAt(localName).slice(0, 10) : null
                  },
                  imported: {
                    rating: importedRatingKey ? importedRatings[importedRatingKey].rating : DEFAULT_RATING,
                    sessions: importedStatsKey ? (importedPlayerStats[importedStatsKey].sessions || []).length : 0,
                    addedAt: importedAddedKey ? String(importedPlayerAdded[importedAddedKey]).slice(0, 10) : null
                  }
                });
              });
            if (conflicts.length) {
              showPlayerConflictOverlay(conflicts, function (choices) {
                var todayStr = todayDateStr();
                var usedSeparateNames = {};
                conflicts.forEach(function (conflict) {
                  if (choices[conflict.name] !== "separate") return;
                  var base = conflict.name + " (" + todayStr + ")";
                  var candidate = base;
                  var n = 2;
                  while (existingNames[normalizeNameKey(candidate)] || usedSeparateNames[normalizeNameKey(candidate)]) {
                    candidate = base + " #" + n;
                    n += 1;
                  }
                  usedSeparateNames[normalizeNameKey(candidate)] = true;
                  renameImportedName(conflict.name, candidate);
                });
                proceedWithMerge();
              });
              return;
            }
          }
          proceedWithMerge();
        } catch (e) {
          alertModal(T("alert.couldNotImport", { message: e.message }));
        }
      });
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Recover Data (reset snapshots + comparison/recovery)
  // ---------------------------------------------------------------------

  // The player names a snapshot has data for, plus anyone appearing in its
  // game log (covers a name that shows up in games but has no separate
  // stats entry for some reason).
  function namesInSnapshot(type, data) {
    var names = {};
    if (type === "todayStats") {
      Object.keys(data.prunedSessions || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "allPlayerStats") {
      Object.keys(data.playerStats || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "allRatings") {
      Object.keys(data.ratings || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "playerStats") {
      if (data.name) names[data.name] = true;
    } else if (type === "rosterLists") {
      (data.players || []).forEach(function (p) {
        if (p && p.name) names[p.name] = true;
      });
    }
    (data.gameHistory || []).forEach(function (g) {
      (g.winnerNames || []).concat(g.opponentNames || []).forEach(function (n) {
        names[n] = true;
      });
    });
    return Object.keys(names).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  // A player's sessions as recorded in this snapshot - same shape
  // mergeSessionLists already knows how to combine, whatever the type.
  function sessionsInSnapshotForPlayer(type, data, name) {
    if (type === "todayStats") return data.prunedSessions[name] || [];
    if (type === "allPlayerStats") return (data.playerStats[name] && data.playerStats[name].sessions) || [];
    if (type === "playerStats") return data.sessions || [];
    return [];
  }

  function summarizeSnapshotPlayer(type, data, name) {
    if (type === "allRatings") {
      var r = data.ratings[name];
      return r ? T("recoverData.ratingSummary", { rating: r.rating, games: r.gamesPlayed || 0 }) : "";
    }
    if (type === "rosterLists") return "";
    var sessions = sessionsInSnapshotForPlayer(type, data, name);
    var games = 0;
    var wins = 0;
    sessions.forEach(function (s) {
      games += (s.games || []).length;
      wins += s.wins || 0;
    });
    return T("recoverData.gamesSummary", { games: games, wins: wins });
  }

  function snapshotOverallSummary(type, data) {
    if (type === "tournament") return T("recoverData.tournamentSummary");
    var names = namesInSnapshot(type, data);
    if (type === "rosterLists") {
      return T("recoverData.rosterListsSummary", { players: names.length, lists: (data.rosters || []).length });
    }
    var gameCount = (data.gameHistory || []).length;
    return gameCount
      ? T("recoverData.playersAndGamesSummary", { players: names.length, games: gameCount })
      : T("recoverData.playersSummary", { players: names.length });
  }

  function renderRecoverDataList() {
    recoverDataList.innerHTML = "";
    if (RESET_SNAPSHOTS.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("recoverData.none");
      recoverDataList.appendChild(hint);
      return;
    }
    RESET_SNAPSHOTS.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "recover-data-row";
      var info = document.createElement("div");
      info.className = "recover-data-row-info";
      var label = document.createElement("span");
      label.className = "recover-data-row-label";
      label.textContent = entry.label;
      var meta = document.createElement("span");
      meta.className = "recover-data-row-meta";
      var when;
      try {
        when = new Date(entry.ts).toLocaleString();
      } catch (e) {
        when = entry.ts;
      }
      meta.textContent = when + " · " + snapshotOverallSummary(entry.type, entry.data);
      info.appendChild(label);
      info.appendChild(meta);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = T("recoverData.recover");
      btn.addEventListener("click", function () {
        openRecoverDetail(entry.type, entry.label, entry.data);
      });
      li.appendChild(info);
      li.appendChild(btn);
      recoverDataList.appendChild(li);
    });
  }

  var recoverDetailCurrent = null; // { type, data }

  function renderRecoverGamesChecklist(type, data) {
    if (type !== "todayStats" && type !== "allPlayerStats") {
      recoverGamesChecklist.innerHTML = "";
      return;
    }
    var checkedNames = {};
    Array.prototype.forEach.call(recoverPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'), function (cb) {
      checkedNames[cb.value] = true;
    });
    var relevantGames = (data.gameHistory || []).filter(function (g) {
      return (g.winnerNames || []).concat(g.opponentNames || []).some(function (n) {
        return checkedNames[n];
      });
    });
    recoverGamesChecklist.innerHTML = "";
    relevantGames.forEach(function (g) {
      var li = document.createElement("li");
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = g.ts;
      checkbox.checked = true;
      var span = document.createElement("span");
      var winners = joinNamesForReport(g.winnerNames || []);
      var losers = joinNamesForReport(g.opponentNames || []);
      var time = formatReportGameTime(g.ts);
      span.textContent = (time ? time + " — " : "") + winners + " won " + g.gameLabel + (losers ? " against " + losers : "");
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      recoverGamesChecklist.appendChild(li);
    });
  }

  function openRecoverDetail(type, label, data) {
    recoverDetailCurrent = { type: type, data: data };
    recoverDetailTitle.textContent = label;
    recoverDetailExplain.textContent = T("recoverData.detailExplain");

    var isTournament = type === "tournament";
    var isRosterLists = type === "rosterLists";
    var hasGames = type === "todayStats" || type === "allPlayerStats";
    recoverPlayersSection.classList.toggle("hidden", isTournament);
    recoverGamesSection.classList.toggle("hidden", !hasGames);
    recoverRostersSection.classList.toggle("hidden", !isRosterLists);

    recoverPlayersChecklist.innerHTML = "";
    if (!isTournament) {
      namesInSnapshot(type, data).forEach(function (name) {
        var li = document.createElement("li");
        li.className = "tournament-player-check-row";
        var rowLabel = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.addEventListener("change", function () {
          renderRecoverGamesChecklist(type, data);
        });
        var span = document.createElement("span");
        var summary = summarizeSnapshotPlayer(type, data, name);
        span.textContent = summary ? name + " — " + summary : name;
        rowLabel.appendChild(checkbox);
        rowLabel.appendChild(span);
        li.appendChild(rowLabel);
        recoverPlayersChecklist.appendChild(li);
      });
    }
    renderRecoverGamesChecklist(type, data);

    recoverRostersChecklist.innerHTML = "";
    if (isRosterLists) {
      (data.rosters || []).forEach(function (r) {
        var li = document.createElement("li");
        li.className = "tournament-player-check-row";
        var rowLabel = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = r.id;
        var span = document.createElement("span");
        span.textContent = r.label;
        rowLabel.appendChild(checkbox);
        rowLabel.appendChild(span);
        li.appendChild(rowLabel);
        recoverRostersChecklist.appendChild(li);
      });
    }

    recoverDetailOverlay.classList.remove("hidden");
  }

  function closeRecoverDetail() {
    recoverDetailOverlay.classList.add("hidden");
    recoverDetailCurrent = null;
  }

  // Dedupes by ts (same convention mergeRatingsData uses for rating
  // history entries), newest first, capped the same way live play caps
  // state.gameHistory in creditWin.
  function mergeGameHistoryEntries(local, restored) {
    var seen = {};
    (local || []).forEach(function (e) {
      if (e && e.ts) seen[e.ts] = true;
    });
    var merged = (local || []).slice();
    (restored || []).forEach(function (e) {
      if (!e || !e.ts || seen[e.ts]) return;
      seen[e.ts] = true;
      merged.push(e);
    });
    merged.sort(function (a, b) {
      return (b.ts || "").localeCompare(a.ts || "");
    });
    if (merged.length > 200) merged.length = 200;
    return merged;
  }

  function restoreCheckedFromSnapshot() {
    if (!recoverDetailCurrent) return;
    var type = recoverDetailCurrent.type;
    var data = recoverDetailCurrent.data;

    if (type === "tournament") {
      if (TOURNAMENT) {
        showToast(T("toast.recoverTournamentBlocked"));
        return;
      }
      TOURNAMENT = JSON.parse(JSON.stringify(data.tournament));
      saveTournamentToStorage(TOURNAMENT);
      renderTournamentPage();
      closeRecoverDetail();
      showToast(T("toast.recoverRestored"));
      return;
    }

    var checkedPlayers = Array.prototype.slice
      .call(recoverPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });

    if (type === "rosterLists") {
      var checkedRosterIds = Array.prototype.slice
        .call(recoverRostersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (cb) {
          return cb.value;
        });
      checkedPlayers.forEach(function (name) {
        var alreadyThere = state.players.some(function (p) {
          return normalizeNameKey(p.name) === normalizeNameKey(name);
        });
        if (!alreadyThere) addPlayer(name);
      });
      if (checkedRosterIds.length) {
        var toRestore = (data.rosters || []).filter(function (r) {
          return checkedRosterIds.indexOf(r.id) !== -1;
        });
        var merge = mergeRosterLists(SAVED_ROSTERS, toRestore);
        SAVED_ROSTERS = merge.rosters;
        saveRostersToStorage(SAVED_ROSTERS);
        populateRosterLoadSelect();
      }
      saveState();
      renderAll();
      closeRecoverDetail();
      showToast(T("toast.recoverRestored"));
      return;
    }

    var restoredStats = false;
    checkedPlayers.forEach(function (name) {
      var sessions = sessionsInSnapshotForPlayer(type, data, name);
      if (sessions.length) {
        var key = findPlayerStatsKey(name) || name;
        var existing = (PLAYER_STATS[key] && PLAYER_STATS[key].sessions) || [];
        PLAYER_STATS[key] = { name: key, sessions: mergeSessionLists(existing, sessions) };
        restoredStats = true;
      }
      var historyToRestore =
        type === "todayStats" && data.ratingHistory
          ? data.ratingHistory[name]
          : type === "allRatings" && data.ratings && data.ratings[name]
          ? data.ratings[name].history
          : null;
      if (historyToRestore && historyToRestore.length) {
        var importedRatingsObj = {};
        importedRatingsObj[name] = { history: historyToRestore };
        var mergedR = mergeRatingsData(PLAYER_RATINGS, importedRatingsObj);
        PLAYER_RATINGS[name] = mergedR[name];
        restoredStats = true;
      }
    });
    if (restoredStats) {
      savePlayerStatsToStorage(PLAYER_STATS);
      saveRatingsToStorage(PLAYER_RATINGS);
    }

    var checkedGameTs = Array.prototype.slice
      .call(recoverGamesChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });
    if (checkedGameTs.length) {
      var gamesToRestore = (data.gameHistory || []).filter(function (g) {
        return checkedGameTs.indexOf(g.ts) !== -1;
      });
      state.gameHistory = mergeGameHistoryEntries(state.gameHistory, gamesToRestore);
      recomputeLiveWinsFromGameHistory();
      saveState();
    }

    renderAll();
    closeRecoverDetail();
    showToast(T("toast.recoverRestored"));
  }

  // A re-imported full backup file doesn't carry a reset "type" of its
  // own - treat it like an allPlayerStats snapshot (same player+game
  // checklist shape) so it flows through the identical recovery UI.
  function normalizeImportedBackupAsSnapshot(data) {
    var importedState = data.state && typeof data.state === "object" ? data.state : {};
    return {
      type: "allPlayerStats",
      data: {
        playerStats: data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {},
        gameHistory: Array.isArray(importedState.gameHistory) ? importedState.gameHistory : []
      }
    };
  }

  function importFileForRecovery(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      if (!data || typeof data !== "object" || !data.state) {
        alertModal(describeUnrecognizedBackupFile(data));
        return;
      }
      var normalized = normalizeImportedBackupAsSnapshot(data);
      openRecoverDetail(normalized.type, T("recoverData.importedFileLabel"), normalized.data);
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Player rosters
  // ---------------------------------------------------------------------

  var SAVED_ROSTERS = loadRostersFromStorage();
  (function migrateRosterCapitalizationOnBoot() {
    var changed = false;
    SAVED_ROSTERS.forEach(function (r) {
      if (!r || !Array.isArray(r.players)) return;
      r.players = r.players.map(function (n) {
        var fixed = capitalizeName(n);
        if (fixed !== n) changed = true;
        return fixed;
      });
    });
    if (changed) saveRostersToStorage(SAVED_ROSTERS);
  })();

  function populateRosterLoadSelect() {
    rosterLoadSelect.innerHTML = "";
    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      rosterLoadSelect.appendChild(opt);
      rosterLoadSelect.disabled = true;
      btnRosterLoad.disabled = true;
      return;
    }
    rosterLoadSelect.disabled = false;
    btnRosterLoad.disabled = false;
    SAVED_ROSTERS.forEach(function (r, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = r.label;
      rosterLoadSelect.appendChild(opt);
    });
  }

  // Adds every player from a saved roster entry who isn't already on the
  // live roster (case-insensitive), leaving everything else untouched.
  // Shared by the main "Load Player List" button and the wizard.
  function loadRosterEntry(roster) {
    if (!roster) return 0;
    var existingNames = state.players.map(function (p) {
      return normalizeNameKey(p.name);
    });
    var added = 0;
    roster.players.forEach(function (name) {
      var key = normalizeNameKey(name);
      if (existingNames.indexOf(key) === -1) {
        addPlayer(name);
        existingNames.push(key);
        added += 1;
      }
    });
    return added;
  }

  // Quick Counter's own "Load Player List": unlike loadRosterEntry (which
  // only ever adds), this makes the active set match the loaded list
  // exactly — anyone active but not on the list drops to standby (not
  // deleted, so their data stays put and typing their name back in just
  // reactivates them — see buildQuickCounterAddRow), and everyone on the
  // list is added/reactivated and marked playing.
  function loadPlayerListForQuickCounter(idx) {
    var roster = SAVED_ROSTERS[parseInt(idx, 10)];
    if (!roster || !roster.players || !roster.players.length) return;
    var listKeys = {};
    roster.players.forEach(function (name) {
      listKeys[normalizeNameKey(name)] = true;
    });
    state.players.forEach(function (p) {
      if (p.playing && !listKeys[normalizeNameKey(p.name)]) p.playing = false;
    });
    roster.players.forEach(function (name) {
      var key = normalizeNameKey(name);
      var existing = state.players.filter(function (p) {
        return normalizeNameKey(p.name) === key;
      })[0];
      if (existing) {
        existing.playing = true;
      } else {
        var player = addPlayer(name);
        if (player) player.playing = true;
      }
    });
    saveState();
    renderAll();
    showToast(
      "Loaded \"" + roster.label + "\" — " + roster.players.length + " player" + (roster.players.length === 1 ? "" : "s") + "."
    );
  }

  function loadSelectedRoster() {
    var idx = parseInt(rosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var added = loadRosterEntry(roster);
    validateNewPlayerNameInput();
    renderAll();
    if (added === 0) {
      showToast(T("toast.allFromListAlreadyInRoster"));
    } else {
      showToast(T(added === 1 ? "toast.addedFromListOne" : "toast.addedFromListMany", { count: added, label: roster.label }));
    }
  }

  function currentRosterNames() {
    return state.players
      .map(function (p) {
        return p.name;
      })
      .sort();
  }

  // Checks the live roster against every saved list (exact same players,
  // no more, no fewer) and, if it's genuinely new, saves it and downloads
  // a fresh player-lists backup file. Runs on every game — not just the
  // first of a session — so adding/removing a player mid-session gets
  // captured as soon as the next game is credited, not just at session
  // boundaries. Dedup against every existing list keeps this from ever
  // firing twice for the same composition.
  function saveRosterSnapshotIfNew(silent) {
    if (noStatsMode) return false;
    var names = currentRosterNames();
    if (names.length === 0) return false;
    var normalizedNames = names.map(normalizeNameKey).sort();
    var alreadySaved = SAVED_ROSTERS.some(function (r) {
      var rNames = (r.players || []).map(normalizeNameKey).sort();
      return rNames.length === normalizedNames.length && rNames.every(function (n, i) {
        return n === normalizedNames[i];
      });
    });
    if (alreadySaved) {
      if (!silent) showToast(T("toast.playerListAlreadySaved"));
      return false;
    }
    var now = new Date().toISOString();
    var entry = {
      id: "roster-" + now.replace(/[:.]/g, "-"),
      label: now.slice(0, 10) + " — " + names.join(", "),
      players: names,
      savedAt: now
    };
    SAVED_ROSTERS = SAVED_ROSTERS.concat([entry]);
    saveRostersToStorage(SAVED_ROSTERS);
    populateRosterLoadSelect();
    populateWizardRosterLoadSelect();
    exportRosterLists();
    if (!silent) showToast(T("toast.savedRoster", { label: entry.label }));
    return true;
  }

  function maybeSaveRosterOnNewSession() {
    saveRosterSnapshotIfNew(false);
  }

  // ---------------------------------------------------------------------
  // Game order (rotation) setups — same save/load pattern as player
  // rosters, but the *sequence* is what defines a setup (order matters),
  // so loading one replaces the current order instead of merging it.
  // ---------------------------------------------------------------------

  var SAVED_ROTATIONS = loadRotationsFromStorage();

  function populateRotationLoadSelect() {
    rotationLoadSelect.innerHTML = "";
    if (SAVED_ROTATIONS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("rotation.noSavedRotationsYet");
      rotationLoadSelect.appendChild(opt);
      rotationLoadSelect.disabled = true;
      btnRotationLoad.disabled = true;
      return;
    }
    rotationLoadSelect.disabled = false;
    btnRotationLoad.disabled = false;
    SAVED_ROTATIONS.forEach(function (r, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = r.label;
      rotationLoadSelect.appendChild(opt);
    });
  }

  // Replaces the current game order outright with a saved rotation's
  // sequence — a sequence isn't something to merge like a player roster.
  // Shared by the main "Load Rotation" button and the wizard.
  function loadRotationEntry(rotation) {
    if (!rotation) return;
    state.rotation = {
      enabled: !!rotation.enabled,
      order: rotation.order.map(function (e) {
        return { gameType: e.gameType, target: e.target, unit: e.unit };
      }),
      every: rotation.every || 1
    };
    saveState();
    applyRotationIfDue();
  }

  function loadSelectedRotation() {
    var idx = parseInt(rotationLoadSelect.value, 10);
    var rotation = SAVED_ROTATIONS[idx];
    if (!rotation) return;
    loadRotationEntry(rotation);
    renderRotation();
    renderWizardIfOpen();
    showToast(T("toast.loadedRotation", { label: rotation.label }));
  }

  function rotationLabelFor(order) {
    return order.map(rotationEntryLabel).join(" → ");
  }

  function rotationEntriesEqual(a, b) {
    return a.gameType === b.gameType && a.target === b.target && a.unit === b.unit;
  }

  // Checks the current game order against every saved rotation (same
  // sequence of rules, not just same game types) and, if it's genuinely
  // new, saves it as a loadable entry. Runs whenever the order changes and
  // on every credited game, mirroring the player-list snapshot behavior.
  function saveRotationSnapshotIfNew(silent) {
    if (noStatsMode) return false;
    var order = state.rotation.order;
    if (!order || order.length === 0) return false;
    var alreadySaved = SAVED_ROTATIONS.some(function (r) {
      return r.order.length === order.length && r.order.every(function (e, i) {
        return rotationEntriesEqual(e, order[i]);
      });
    });
    if (alreadySaved) {
      if (!silent) showToast(T("toast.rotationAlreadySaved"));
      return false;
    }
    var now = new Date().toISOString();
    var entry = {
      id: "rotation-" + now.replace(/[:.]/g, "-"),
      label: rotationLabelFor(order),
      order: order.slice(),
      every: state.rotation.every,
      enabled: state.rotation.enabled,
      savedAt: now
    };
    SAVED_ROTATIONS = SAVED_ROTATIONS.concat([entry]);
    saveRotationsToStorage(SAVED_ROTATIONS);
    populateRotationLoadSelect();
    populateWizardRotationLoadSelect();
    if (!silent) showToast(T("toast.savedRotation", { label: entry.label }));
    return true;
  }

  // ---------------------------------------------------------------------
  // Setup Wizard — a step-by-step flow that walks through the same
  // controls already on the main page (game type/format, players, who's
  // playing, rotation) and applies them all when "Start Game" is hit.
  // Player and rotation changes made in the wizard are applied live via
  // the same functions the main page uses, so canceling never needs to
  // roll anything back; only the format choice from step 1 is a draft
  // until Start is pressed.
  // ---------------------------------------------------------------------

  var WIZARD_STEP_SEQUENCE_DEFAULT = [1, 2, 3, 4, 5];
  var WIZARD_STEP_SEQUENCE_TOURNAMENT = [1, 5];
  var wizardStep = 1;
  var wizardFormat = "individual";

  function wizardStepSequence() {
    return wizardFormat === "tournament" ? WIZARD_STEP_SEQUENCE_TOURNAMENT : WIZARD_STEP_SEQUENCE_DEFAULT;
  }

  function populateWizardRosterLoadSelect() {
    wizardRosterLoadSelect.innerHTML = "";
    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      wizardRosterLoadSelect.appendChild(opt);
      wizardRosterLoadSelect.disabled = true;
      btnWizardRosterLoad.disabled = true;
      return;
    }
    wizardRosterLoadSelect.disabled = false;
    btnWizardRosterLoad.disabled = false;
    SAVED_ROSTERS.forEach(function (r, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.label;
      wizardRosterLoadSelect.appendChild(o);
    });
  }

  function populateWizardRotationLoadSelect() {
    wizardRotationLoadSelect.innerHTML = "";
    if (SAVED_ROTATIONS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("rotation.noSavedRotationsYet");
      wizardRotationLoadSelect.appendChild(opt);
      wizardRotationLoadSelect.disabled = true;
      btnWizardRotationLoad.disabled = true;
      return;
    }
    wizardRotationLoadSelect.disabled = false;
    btnWizardRotationLoad.disabled = false;
    SAVED_ROTATIONS.forEach(function (r, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.label;
      wizardRotationLoadSelect.appendChild(o);
    });
  }

  function loadSelectedWizardRoster() {
    var idx = parseInt(wizardRosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var added = loadRosterEntry(roster);
    validateWizardNewPlayerNameInput();
    renderAll();
    showToast(
      added === 0
        ? T("toast.allFromListAlreadyInRoster")
        : T(added === 1 ? "toast.addedFromListOne" : "toast.addedFromListMany", { count: added, label: roster.label })
    );
  }

  function syncWizardRotationEnabledRadios() {
    Array.prototype.forEach.call(wizardRotationEnabledRadios, function (r) {
      r.checked = (r.value === "yes") === !!state.rotation.enabled;
    });
    wizardRotationDetail.classList.toggle("hidden", !state.rotation.enabled);
  }

  function loadSelectedWizardRotation() {
    var idx = parseInt(wizardRotationLoadSelect.value, 10);
    var rotation = SAVED_ROTATIONS[idx];
    if (!rotation) return;
    loadRotationEntry(rotation);
    syncWizardRotationEnabledRadios();
    wizardRotationEveryInput.value = state.rotation.every;
    renderRotation();
    renderWizardIfOpen();
    showToast(T("toast.loadedRotation", { label: rotation.label }));
  }

  function validateWizardNewPlayerNameInput() {
    var trimmed = wizardNewPlayerName.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnWizardAddPlayer.disabled = !trimmed || duplicate;
    if (duplicate) {
      wizardNewPlayerNameRequirement.textContent =
        T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      wizardNewPlayerNameRequirement.classList.remove("hidden");
    } else {
      wizardNewPlayerNameRequirement.classList.add("hidden");
    }
  }

  function renderWizardPlayerChips() {
    wizardPlayerChips.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("wizard.noPlayersYetAddAbove");
      wizardPlayerChips.appendChild(hint);
      return;
    }
    state.players.forEach(function (p) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      buildPlayerNameLabel(name, p.name, false);
      name.appendChild(buildRatingBadge(p.name));
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wizard-player-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", T("common.removeName", { name: p.name }));
      removeBtn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      li.appendChild(name);
      li.appendChild(removeBtn);
      wizardPlayerChips.appendChild(li);
    });
  }

  // A single "name + Standby/Playing toggle" row — shared by the wizard's
  // step 3 and the Focus Mode players list, so both stay identical.
  function buildPlayingToggleRow(p) {
    var row = document.createElement("li");
    row.className = "roster-row" + (p.playing ? " is-playing" : "");

    var name = document.createElement("span");
    name.className = "roster-name";
    buildPlayerNameLabel(name, p.name, false);
    row.appendChild(name);
    row.appendChild(buildRatingBadge(p.name));

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
    playBtn.textContent = T(p.playing ? "players.playing" : "players.standby");
    playBtn.addEventListener("click", function () {
      togglePlaying(p.id);
    });
    row.appendChild(playBtn);

    return row;
  }

  function renderPlayingToggleListInto(listEl, emptyText) {
    listEl.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = emptyText;
      listEl.appendChild(hint);
      return;
    }
    state.players.forEach(function (p) {
      listEl.appendChild(buildPlayingToggleRow(p));
    });
  }

  function renderWizardPlayingList() {
    renderPlayingToggleListInto(wizardPlayingList, "No players yet — go back and add some.");
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    wizardPlayingWarning.classList.toggle("hidden", playingCount >= 2);
  }

  // Silently keeps the wizard's own step-2/3/4 content in sync whenever
  // players or the rotation change elsewhere (add/remove/toggle/load),
  // regardless of which step is currently showing.
  function renderWizardIfOpen() {
    if (!wizardOverlay || wizardOverlay.classList.contains("hidden")) return;
    renderWizardPlayerChips();
    renderWizardPlayingList();
    renderRotationListInto(wizardRotationList);
  }

  function validateWizardStepBeforeNext() {
    if (wizardStep === 1) {
      if (wizardFormat === "raceto") {
        var raceTo = parseInt(wizardRaceToInput.value, 10);
        if (!raceTo || raceTo < 1) {
          showToast(T("toast.enterRaceToWins"));
          return false;
        }
      }
      return true;
    }
    if (wizardStep === 2) {
      if (state.players.length === 0) {
        showToast(T("toast.addAtLeastOnePlayer"));
        return false;
      }
      return true;
    }
    if (wizardStep === 3) {
      var playingCount = state.players.filter(function (p) {
        return p.playing;
      }).length;
      if (playingCount < 2) {
        wizardPlayingWarning.classList.remove("hidden");
        return false;
      }
      return true;
    }
    if (wizardStep === 4) {
      var rotationOn = Array.prototype.filter.call(wizardRotationEnabledRadios, function (r) {
        return r.checked;
      })[0].value === "yes";
      if (rotationOn && state.rotation.order.length < 2) {
        showToast(T("toast.addAtLeastTwoGameTypes"));
        return false;
      }
      return true;
    }
    return true;
  }

  function renderWizardStep() {
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);

    [1, 2, 3, 4, 5].forEach(function (n) {
      document.getElementById("wizard-step-" + n).classList.toggle("hidden", n !== wizardStep);
    });

    wizardProgress.textContent = T("wizard.stepOf", { step: idx + 1, total: seq.length });

    wizardProgressDots.innerHTML = "";
    seq.forEach(function (stepNum, i) {
      var dot = document.createElement("span");
      dot.className = "wizard-dot" + (i < idx ? " is-done" : i === idx ? " is-active" : "");
      wizardProgressDots.appendChild(dot);
    });

    btnWizardBack.classList.toggle("hidden", idx === 0);
    var isLast = idx === seq.length - 1;
    btnWizardNext.classList.toggle("hidden", isLast);
    btnWizardStart.classList.toggle("hidden", !isLast);
    if (isLast) {
      btnWizardStart.textContent = T(wizardFormat === "tournament" ? "wizard.goToTournamentSetup" : "wizard.startGame");
    }

    if (wizardStep === 2) renderWizardPlayerChips();
    if (wizardStep === 3) renderWizardPlayingList();
    if (wizardStep === 4) renderRotationListInto(wizardRotationList);
    if (wizardStep === 5) renderWizardSummary();
  }

  function renderWizardSummary() {
    wizardSummary.innerHTML = "";
    function summaryRow(label, value) {
      var r = document.createElement("div");
      r.className = "wizard-summary-row";
      var l = document.createElement("span");
      l.className = "label";
      l.textContent = label;
      var v = document.createElement("span");
      v.className = "value";
      v.textContent = value;
      r.appendChild(l);
      r.appendChild(v);
      wizardSummary.appendChild(r);
    }
    var gameLabel = GAME_TYPES[wizardGameTypeSelect.value] ? GAME_TYPES[wizardGameTypeSelect.value].label : wizardGameTypeSelect.value;
    if (wizardFormat === "tournament") {
      summaryRow(T("wizard.summaryFormat"), T("wizard.summaryTournamentElimination"));
      summaryRow(T("wizard.summaryGame"), gameLabel);
      summaryRow(T("wizard.summaryPlayersOnRoster"), String(state.players.length));
      return;
    }
    summaryRow(T("wizard.summaryGame"), gameLabel);
    summaryRow(
      T("wizard.summaryFormat"),
      wizardFormat === "raceto"
        ? T("milestone.raceToWins", { target: parseInt(wizardRaceToInput.value, 10) || 5 })
        : T("wizard.summaryIndividualCasual")
    );
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    summaryRow(T("wizard.summaryPlayersPlaying"), T("wizard.summaryOfTotal", { playing: playingCount, total: state.players.length }));
    var rotationOn = Array.prototype.filter.call(wizardRotationEnabledRadios, function (r) {
      return r.checked;
    })[0].value === "yes";
    var every = state.rotation.every || 1;
    summaryRow(
      T("wizard.summaryRotation"),
      rotationOn && state.rotation.order.length
        ? T(every === 1 ? "wizard.summaryRotationOnOne" : "wizard.summaryRotationOnMany", {
            label: rotationLabelFor(state.rotation.order),
            count: every
          })
        : T("wizard.summaryRotationOff")
    );
  }

  function wizardNext() {
    if (!validateWizardStepBeforeNext()) return;
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);
    if (idx < seq.length - 1) {
      wizardStep = seq[idx + 1];
      renderWizardStep();
    }
  }

  function wizardBack() {
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);
    if (idx > 0) {
      wizardStep = seq[idx - 1];
      renderWizardStep();
    }
  }

  function openWizard() {
    wizardStep = 1;
    wizardFormat = "individual";
    Array.prototype.forEach.call(wizardFormatRadios, function (r) {
      r.checked = r.value === "individual";
    });
    wizardRaceToRow.classList.add("hidden");
    wizardRaceToInput.value = state.raceToWinsTarget || 5;
    wizardTempCounterCheckbox.checked = false;
    btnWizardStartQuickCounter.classList.add("hidden");
    wizardGameTypeSelect.value = state.currentGame.gameType;
    syncWizardRotationEnabledRadios();
    wizardRotationEveryInput.value = state.rotation.every || 1;
    wizardNewPlayerName.value = "";
    validateWizardNewPlayerNameInput();
    populateWizardRosterLoadSelect();
    populateWizardRotationLoadSelect();
    renderWizardStep();
    wizardOverlay.classList.remove("hidden");
  }

  function closeWizard() {
    wizardOverlay.classList.add("hidden");
  }

  // ---------------------------------------------------------------------
  // First-time user flow — a short 4-step welcome shown once, only when
  // this device has no players and no history at all (see
  // isFirstTimeUser). Every step but the last has a plain Cancel/Go
  // footer; the last step's own two buttons ARE the terminal actions, so
  // it has no separate Go. Cancelling (at any step) or finishing both
  // mark it seen so it never shows again.
  // ---------------------------------------------------------------------

  var ONBOARDING_SEEN_KEY = "poolMasterCounter.onboardingSeen.v1";

  function hasSeenOnboarding() {
    try {
      return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
    } catch (e) {
      return true;
    }
  }

  function markOnboardingSeen() {
    try {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    } catch (e) {
      console.warn("Could not save onboarding-seen flag.", e);
    }
  }

  // Just the live roster - PLAYER_STATS/SAVED_ROSTERS are pre-seeded with
  // bundled example data on every device's very first boot
  // (migrateFromRepoIfNeeded), before this ever runs, so they're never a
  // reliable signal of whether a real person has set anything up yet.
  function isFirstTimeUser() {
    return state.players.length === 0;
  }

  function onboardingPlayChoice() {
    for (var i = 0; i < onboardingPlayChoiceRadios.length; i++) {
      if (onboardingPlayChoiceRadios[i].checked) return onboardingPlayChoiceRadios[i].value;
    }
    return "now";
  }

  function validateOnboardingNameInput() {
    var trimmed = onboardingNameInput.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnOnboardingGo.disabled = onboardingStep === 2 && (!trimmed || duplicate);
    if (duplicate) {
      onboardingNameRequirement.textContent = T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      onboardingNameRequirement.classList.remove("hidden");
    } else {
      onboardingNameRequirement.classList.add("hidden");
    }
  }

  function renderOnboardingStep() {
    [1, 2, 3, 4].forEach(function (n) {
      document.getElementById("onboarding-step-" + n).classList.toggle("hidden", n !== onboardingStep);
    });
    onboardingHeading.textContent = T("onboarding.step" + onboardingStep + "Heading");
    onboardingProgress.textContent = T("wizard.stepOf", { step: onboardingStep, total: 4 });

    onboardingProgressDots.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var dot = document.createElement("span");
      dot.className = "wizard-dot" + (i < onboardingStep - 1 ? " is-done" : i === onboardingStep - 1 ? " is-active" : "");
      onboardingProgressDots.appendChild(dot);
    }

    onboardingStandardFooter.classList.toggle("hidden", onboardingStep === 4);
    if (onboardingStep === 2) validateOnboardingNameInput();
    else btnOnboardingGo.disabled = false;
  }

  function openOnboarding() {
    onboardingStep = 1;
    onboardingNameInput.value = "";
    onboardingRatingInput.value = String(DEFAULT_RATING);
    onboardingEmailInput.value = "";
    onboardingPhoneInput.value = "";
    onboardingReportOptInCheckbox.checked = false;
    onboardingReportOptInCheckbox.disabled = true;
    onboardingNotifyMethodRow.classList.add("hidden");
    Array.prototype.forEach.call(onboardingNotifyMethodRadios, function (r) {
      r.checked = r.value === "email";
    });
    onboardingNameRequirement.classList.add("hidden");
    Array.prototype.forEach.call(onboardingPlayChoiceRadios, function (r) {
      r.checked = r.value === "now";
    });
    renderOnboardingStep();
    onboardingOverlay.classList.remove("hidden");
  }

  function closeOnboarding() {
    onboardingOverlay.classList.add("hidden");
    markOnboardingSeen();
  }

  // Go only ever moves forward (there's no Back on this short flow) -
  // each step does whatever work it owns (adding the player on step 2,
  // reading the now/later choice on step 3) before advancing.
  function advanceOnboarding() {
    if (onboardingStep === 1) {
      onboardingStep = 2;
      renderOnboardingStep();
      onboardingNameInput.focus({ preventScroll: true });
      return;
    }
    if (onboardingStep === 2) {
      var trimmed = onboardingNameInput.value.trim();
      if (!trimmed || isDuplicatePlayerName(trimmed)) {
        validateOnboardingNameInput();
        return;
      }
      var emailOk = checkOnboardingEmailValidity();
      var phoneOk = checkOnboardingPhoneValidity();
      if (!emailOk || !phoneOk) {
        onboardingContactRequirement.textContent = T(!emailOk ? "contactSheet.invalidEmail" : "contactSheet.invalidPhone");
        onboardingContactRequirement.classList.remove("hidden");
        return;
      }
      onboardingContactRequirement.classList.add("hidden");
      var starting = parseStartingRatingInput(onboardingRatingInput);
      var player = addPlayer(onboardingNameInput.value, starting === null ? undefined : starting);
      if (player) {
        player.playing = true;
        saveState();
        var email = onboardingEmailInput.value.trim();
        var phone = onboardingPhoneInput.value.trim();
        if (email || phone) {
          setPlayerContact(player.name, {
            email: email,
            phone: phone,
            reportOptIn: onboardingReportOptInCheckbox.checked,
            notifyMethod: Array.prototype.filter.call(onboardingNotifyMethodRadios, function (r) {
              return r.checked;
            })[0].value
          });
          updateDayReportRecipientsLine();
        }
        renderAll();
      }
      onboardingStep = 3;
      renderOnboardingStep();
      return;
    }
    if (onboardingStep === 3) {
      if (onboardingPlayChoice() === "later") {
        closeOnboarding();
        return;
      }
      onboardingStep = 4;
      renderOnboardingStep();
    }
  }

  // Picks which Help section to jump to based on whichever page/overlay is
  // currently showing, so the same Help button is contextual everywhere.
  function currentHelpSectionId() {
    if (!wizardOverlay.classList.contains("hidden")) return "help-section-wizard";
    if (!tournamentPageView.classList.contains("hidden")) return "help-section-tournament";
    if (!allPlayersPageView.classList.contains("hidden")) return "help-section-all-players";
    if (!playerPageView.classList.contains("hidden")) return "help-section-player-page";
    return "help-section-main";
  }

  // .help-header is position:sticky and floats on top of whatever
  // scrolled to the top of .help-card, so scrollIntoView({block:"start"})
  // lands a section's title right underneath it (hidden until you scroll
  // up). Scroll the card manually instead, offset by the header's actual
  // rendered height so the target lands just below it.
  function scrollHelpToSection(targetId) {
    var target = document.getElementById(targetId);
    var card = helpOverlay.querySelector(".help-card");
    var header = helpOverlay.querySelector(".help-header");
    if (!target || !card || !header) return;
    card.scrollTop = target.offsetTop - header.offsetHeight - 8;
  }

  function openHelp() {
    var targetId = currentHelpSectionId();
    Array.prototype.forEach.call(helpNavLinks, function (a) {
      a.classList.toggle("is-active", a.getAttribute("href") === "#" + targetId);
    });
    helpOverlay.classList.remove("hidden");
    scrollHelpToSection(targetId);
  }

  function closeHelp() {
    helpOverlay.classList.add("hidden");
  }

  function finalizeWizardAndStart() {
    // Quick Counter's tally is free-form (can be negative, has no
    // relation to any target) — never carry it into a real game or a
    // tournament, regardless of which format is picked next. Also undo
    // the noStatsMode it forces on — otherwise saving stays silently
    // disabled (checkbox still checked) even though the UI now shows a
    // completely normal game.
    var leavingQuickCounter = quickCounterMode;
    quickCounterMode = false;
    if (leavingQuickCounter) {
      resetGameBalls();
      noStatsMode = false;
      noStatsCheckbox.checked = false;
    }
    if (wizardFormat === "tournament") {
      closeWizard();
      openTournamentPage();
      return;
    }
    var typeId = wizardGameTypeSelect.value;
    var type = GAME_TYPES[typeId];
    var typeChanged = state.currentGame.gameType !== typeId;
    state.currentGame.gameType = typeId;
    if (typeChanged) state.currentGame.target = type.defaultTarget;
    state.currentGame.mode = "individual";
    if (wizardFormat === "raceto") {
      var raceTo = parseInt(wizardRaceToInput.value, 10);
      if (raceTo >= 1) state.raceToWinsTarget = raceTo;
    }
    saveState();

    if (typeChanged) state.currentGame.unit = type.unit;
    gameTypeSelect.value = typeId;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnitSelect.value = state.currentGame.unit;
    raceToWinsInput.value = state.raceToWinsTarget;
    Array.prototype.forEach.call(modeRadios, function (r) {
      r.checked = r.value === "individual";
    });

    applyRotationIfDue();
    renderAll();
    updateCurrentGameSummary();
    tickShotCounter();
    closeWizard();
    setFocusMode(true);
    showToast(T("toast.letsPlay"));
  }

  // Skips the rest of the wizard entirely and drops straight into the
  // bare-bones Quick Counter scoreboard — no game type, no target, no
  // rotation, no win/loss detection, just a per-player tally that can be
  // renamed/added/removed right from the cards. Implies noStatsMode, since
  // saveState/savePlayerStatsToStorage/saveRatingsToStorage/
  // saveRostersToStorage/saveRotationsToStorage guards make that a no-op
  // anyway and there's never a "completed game" to record here.
  function startQuickCounter() {
    noStatsMode = true;
    noStatsCheckbox.checked = true;
    quickCounterMode = true;
    resetGameBalls();
    closeWizard();
    setFocusMode(true);
    renderAll();
    showToast(T("toast.quickCounterTip"));
  }

  // ---------------------------------------------------------------------
  // Per-player stats page (players/<Name>.json)
  // ---------------------------------------------------------------------

  var currentStatsPlayerName = null;
  var currentStatsSessions = null;

  function playerStatsFilename(name) {
    return name.replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-") + ".json";
  }

  // Builds a session record (same shape as one saved to PLAYER_STATS) for
  // one player on one calendar date, from any gameHistory array — the
  // live in-progress one, or one pulled out of an imported backup file.
  function computeSessionFromGameHistory(gameHistory, playerName, dateStr) {
    var gamesWon = [];
    var opponentSet = {};
    var games = [];
    (gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerNames || !entry.ts) return;
      if (localDateStrFromTs(entry.ts) !== dateStr) return;
      var won = entry.winnerNames.indexOf(playerName) !== -1;
      var lost = !won && (entry.opponentNames || []).indexOf(playerName) !== -1;
      if (!won && !lost) return;
      if (won) {
        gamesWon.push(entry.gameLabel);
        (entry.opponentNames || []).forEach(function (n) {
          opponentSet[n] = true;
        });
      } else {
        entry.winnerNames.forEach(function (n) {
          opponentSet[n] = true;
        });
      }
      // Raw entry.winnerNames/opponentNames always mean "winning side" /
      // "losing side" (unlike the renamed opponentNames below, which is
      // relative to playerName). My own team's roster for this game is
      // whichever raw side I'm on — needed to tell team combos apart.
      var myRawSide = won ? entry.winnerNames : entry.opponentNames || [];
      games.push({
        ts: entry.ts,
        gameLabel: entry.gameLabel,
        target: entry.target,
        result: won ? "won" : "lost",
        winnerNames: entry.winnerNames,
        opponentNames: won ? (entry.opponentNames || []) : entry.winnerNames.slice(),
        teammateNames: entry.isTeam
          ? myRawSide.filter(function (n) {
              return n !== playerName;
            })
          : [],
        isTeam: entry.isTeam,
        mvpName: entry.mvpName,
        durationMs: entry.durationMs,
        wonRace: entry.wonRace,
        raceTarget: entry.raceTarget,
        raceCount: entry.raceCount,
        ballsLeftOnTable: entry.ballsLeftOnTable === undefined ? null : entry.ballsLeftOnTable,
        skunk: entry.skunk === undefined ? false : entry.skunk
      });
    });
    if (games.length === 0) return null;
    return {
      date: dateStr,
      wins: games.filter(function (g) {
        return g.result === "won";
      }).length,
      gamesWon: gamesWon,
      opponents: Object.keys(opponentSet),
      games: games,
      wonTournament: false
    };
  }

  // Accepts a player NAME (not id) so it works for players still on the
  // roster and for historical players who aren't (e.g. removed since, or
  // only known from an imported backup). When the name matches a current
  // roster entry, wins/wonTournament come from the live id-based counters;
  // otherwise they're derived from the games themselves.
  function computeLiveSessionForPlayer(name) {
    var today = todayDateStr();
    var session = computeSessionFromGameHistory(state.gameHistory, name, today) || {
      date: today,
      wins: 0,
      gamesWon: [],
      opponents: [],
      games: []
    };
    var playerId = getPlayerIdByName(name);
    if (playerId) {
      var wins = state.playerWins[playerId] || 0;
      session.wins = wins;
      // This player's win count mirrors their team's shared total in
      // Teams mode (creditWin bumps every member's playerWins on a
      // team win), so the target to compare against is the team's,
      // not an individual fair-race target keyed by this player's id.
      var livePlayer = getPlayer(playerId);
      var raceKey = state.currentGame.mode === "teams" && livePlayer && livePlayer.teamId ? livePlayer.teamId : playerId;
      session.wonTournament = wins > 0 && wins >= effectiveRaceTarget(raceKey);
    } else {
      session.wonTournament = false;
    }
    return session;
  }

  function playerStatsRow(label, value) {
    var row = document.createElement("div");
    row.className = "player-stats-row";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value";
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function playerStatsListRow(label, items, isPlayerNames) {
    var row = document.createElement("div");
    row.className = "player-stats-row player-stats-row-wrap";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value value-list";
    if (isPlayerNames && items.length) {
      items.forEach(function (n, i) {
        if (i > 0) v.appendChild(document.createTextNode(", "));
        v.appendChild(document.createTextNode(n));
        v.appendChild(buildRatingBadge(n));
      });
    } else {
      v.textContent = items.length ? items.join(", ") : "—";
    }
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function playerGameLogRow(g) {
    var div = document.createElement("div");
    div.className = "player-game-log-row " + (g.result === "won" ? "is-win" : "is-loss");
    var time = document.createElement("span");
    time.className = "player-game-log-time";
    time.textContent = formatTimestamp(g.ts, false);
    var label = document.createElement("span");
    label.className = "player-game-log-label";
    label.textContent = g.gameLabel;
    var winner = document.createElement("strong");
    winner.className = "player-game-log-winner";
    winner.appendChild(document.createTextNode("🏆 "));
    (g.winnerNames || []).forEach(function (n, i) {
      if (i > 0) winner.appendChild(document.createTextNode(" & "));
      winner.appendChild(document.createTextNode(n));
      winner.appendChild(buildRatingBadge(n));
    });
    div.appendChild(time);
    div.appendChild(label);
    var durationText = formatDuration(g.durationMs);
    if (durationText) {
      var durationSpan = document.createElement("span");
      durationSpan.className = "player-game-log-duration";
      durationSpan.textContent = T("common.duration", { time: durationText });
      div.appendChild(durationSpan);
    }
    div.appendChild(document.createTextNode(" — won by "));
    div.appendChild(winner);
    if (g.isTeam && g.mvpName) {
      div.appendChild(document.createTextNode(" · 🎯 " + g.mvpName + " potted it"));
      div.appendChild(buildRatingBadge(g.mvpName));
    }
    if (g.ballsLeftOnTable !== null && g.ballsLeftOnTable !== undefined) {
      var ballsLeftSpan = document.createElement("span");
      ballsLeftSpan.className = "player-game-log-balls-left";
      ballsLeftSpan.textContent = T("history.ballsLeftOnTable", { count: g.ballsLeftOnTable });
      div.appendChild(document.createTextNode(" · "));
      div.appendChild(ballsLeftSpan);
    }
    return div;
  }

  function playerGamesLogRow(label, games) {
    var row = document.createElement("div");
    row.className = "player-stats-row player-stats-row-wrap";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    row.appendChild(l);
    if (!games || games.length === 0) {
      var v = document.createElement("span");
      v.className = "value value-list";
      v.textContent = "—";
      row.appendChild(v);
      return row;
    }
    var list = document.createElement("div");
    list.className = "player-game-log";
    games.forEach(function (g) {
      list.appendChild(playerGameLogRow(g));
    });
    row.appendChild(list);
    return row;
  }

  function renderLiveSessionForPlayer(name) {
    var live = computeLiveSessionForPlayer(name);
    playerPageCurrentBody.innerHTML = "";
    playerPageCurrentBody.appendChild(playerStatsRow(T("playerPage.winsToday"), live.wins));
    playerPageCurrentBody.appendChild(playerGamesLogRow("Games", live.games));
    playerPageCurrentBody.appendChild(playerStatsListRow(T("playerPage.opponents"), live.opponents, true));
    if (live.wonTournament) {
      var trophy = document.createElement("div");
      trophy.className = "tournament-winner-banner";
      trophy.textContent = T("history.wonTournamentToday", { name: name });
      trophy.appendChild(buildRatingBadge(name));
      playerPageCurrentBody.appendChild(trophy);
    }
  }

  // ---------------------------------------------------------------------
  // Player stats synopsis (period filter + head-to-head)
  // ---------------------------------------------------------------------

  var currentStatsPeriod = "all";

  function periodStartDate(period) {
    var now = new Date();
    if (period === "today") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (period === "week") {
      var day = now.getDay();
      var diffToMonday = day === 0 ? 6 : day - 1;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    }
    if (period === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (period === "6month") {
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    }
    if (period === "year") {
      return new Date(now.getFullYear(), 0, 1);
    }
    return null;
  }

  function collectAllGamesForPlayer(name) {
    var live = computeLiveSessionForPlayer(name);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    var games = [];
    sessions.forEach(function (s) {
      (s.games || []).forEach(function (g) {
        games.push(g);
      });
    });
    return games;
  }

  function filterGamesByPeriod(games, period) {
    var start = periodStartDate(period);
    if (!start) return games;
    var startMs = start.getTime();
    return games.filter(function (g) {
      var t = g.ts ? new Date(g.ts).getTime() : NaN;
      return !isNaN(t) && t >= startMs;
    });
  }

  function computeWinLossSynopsis(games) {
    var wins = 0;
    var losses = 0;
    var skunkWins = 0;
    var skunkLosses = 0;
    games.forEach(function (g) {
      if (g.result === "won") {
        wins += 1;
        if (g.skunk) skunkWins += 1;
      } else {
        losses += 1;
        if (g.skunk) skunkLosses += 1;
      }
    });
    var total = wins + losses;
    return {
      wins: wins,
      losses: losses,
      skunkWins: skunkWins,
      skunkLosses: skunkLosses,
      total: total,
      pct: total ? Math.round((wins / total) * 100) : null
    };
  }

  function computeHeadToHead(games) {
    var map = {};
    var order = [];
    games.forEach(function (g) {
      (g.opponentNames || []).forEach(function (name) {
        if (!map[name]) {
          map[name] = { name: name, wins: 0, losses: 0 };
          order.push(name);
        }
        if (g.result === "won") map[name].wins += 1;
        else map[name].losses += 1;
      });
    });
    return order
      .map(function (name) {
        var rec = map[name];
        var total = rec.wins + rec.losses;
        return {
          name: rec.name,
          wins: rec.wins,
          losses: rec.losses,
          total: total,
          pct: total ? Math.round((rec.wins / total) * 100) : null
        };
      })
      .sort(function (a, b) {
        return b.total - a.total || a.name.localeCompare(b.name);
      });
  }

  // Same shape as computeHeadToHead, but grouped by teammate combo
  // (teamComboLabel(g.teammateNames), already used by the graph's team-
  // combo series) instead of by opponent - one row per distinct group of
  // people this player has been teamed up with (tournament teams and the
  // main scoreboard's ad-hoc Team A/B mode both write isTeam/teammateNames
  // the same way, so both show up here). Each combo is decorated with its
  // saved team name (findTeamByMembers, matched on the FULL roster -
  // teammateNames excludes the viewed player themself, so it's added back
  // in) when one exists, falling back to just the partner names.
  function computeTeamRecords(games, viewedPlayerName) {
    var map = {};
    var order = [];
    games.forEach(function (g) {
      if (!g.isTeam || !(g.teammateNames || []).length) return;
      var key = teamComboLabel(g.teammateNames);
      if (!map[key]) {
        map[key] = { partners: g.teammateNames.slice(), wins: 0, losses: 0 };
        order.push(key);
      }
      if (g.result === "won") map[key].wins += 1;
      else map[key].losses += 1;
    });
    return order
      .map(function (key) {
        var rec = map[key];
        var total = rec.wins + rec.losses;
        var saved = findTeamByMembers(rec.partners.concat([viewedPlayerName]));
        return {
          teamName: saved ? saved.name : null,
          partners: rec.partners,
          wins: rec.wins,
          losses: rec.losses,
          total: total,
          pct: total ? Math.round((rec.wins / total) * 100) : null
        };
      })
      .sort(function (a, b) {
        return b.total - a.total || a.partners.join(",").localeCompare(b.partners.join(","));
      });
  }

  // Player achievements - pure functions of data already tracked (game
  // history, ratings, tournament results), computed fresh on every render
  // exactly like computeHeadToHead/computeTeamRecords above: no new
  // persisted storage, no migration risk. Lifetime totals, not period-
  // scoped - these shouldn't change just because the Synopsis period
  // dropdown does. Adding a future achievement is a one-line table entry
  // here, not new plumbing.
  var ACHIEVEMENT_DEFS = [
    { id: "gamesPlayed", icon: "🎮", tiers: [10, 50, 200], compute: function (ctx) { return ctx.allGames.length; } },
    { id: "wins", icon: "🏅", tiers: [1, 25, 100], compute: function (ctx) { return ctx.synopsis.wins; } },
    { id: "winStreak", icon: "🔥", tiers: [3, 5, 10], compute: function (ctx) { return ctx.longestStreak; } },
    // "MVP" = the existing team-MVP data (whoever potted the winning ball
    // on a team win, already shown as "Team wins potted (MVP)" below) -
    // turned into a badge, not a new tournament-MVP computation.
    { id: "mvpPots", icon: "🌟", tiers: [1, 10, 30], compute: function (ctx) { return ctx.mvpPots; } },
    { id: "tournamentTitles", icon: "🏆", tiers: [1, 3, 10], compute: function (ctx) { return ctx.tournamentWins; } }
  ];

  var SPECIAL_ACHIEVEMENT_DEFS = [
    { id: "skunkMaster", icon: "🦨", compute: function (ctx) { return ctx.synopsis.skunkWins > 0; } }
  ];

  function computeAchievements(name) {
    var allGames = collectAllGamesForPlayer(name);
    var synopsis = computeWinLossSynopsis(allGames);
    var sorted = allGames.slice().sort(function (a, b) {
      return (a.ts || "").localeCompare(b.ts || "");
    });
    var longestStreak = 0;
    var current = 0;
    sorted.forEach(function (g) {
      if (g.result === "won") {
        current += 1;
        if (current > longestStreak) longestStreak = current;
      } else {
        current = 0;
      }
    });
    var mvpPots = allGames.filter(function (g) {
      return g.result === "won" && g.mvpName === name;
    }).length;
    var tournamentGames = tournamentGamesForPlayerName(name).concat(sessionRaceTournamentGames(allGames));
    var tournamentWins = computeWinLossSynopsis(tournamentGames).wins;
    var ctx = {
      allGames: allGames,
      synopsis: synopsis,
      longestStreak: longestStreak,
      mvpPots: mvpPots,
      tournamentWins: tournamentWins
    };

    var ladders = ACHIEVEMENT_DEFS.map(function (def) {
      var value = def.compute(ctx);
      var tier = 0;
      def.tiers.forEach(function (threshold) {
        if (value >= threshold) tier += 1;
      });
      return {
        id: def.id,
        icon: def.icon,
        tier: tier,
        value: value,
        nextGoal: tier < def.tiers.length ? def.tiers[tier] : null
      };
    });
    var specials = SPECIAL_ACHIEVEMENT_DEFS.map(function (def) {
      return { id: def.id, icon: def.icon, unlocked: !!def.compute(ctx) };
    });
    return { ladders: ladders, specials: specials };
  }

  function achievementTierMedal(tier) {
    return tier >= 3 ? "🥇" : tier >= 2 ? "🥈" : tier >= 1 ? "🥉" : "";
  }

  function buildAchievementBadge(icon, labelText, unlocked, progressText) {
    var chip = document.createElement("div");
    chip.className = "achievement-badge" + (unlocked ? " is-unlocked" : "");
    var iconEl = document.createElement("div");
    iconEl.className = "achievement-badge-icon";
    iconEl.textContent = icon;
    var labelEl = document.createElement("div");
    labelEl.className = "achievement-badge-label";
    labelEl.textContent = labelText;
    chip.appendChild(iconEl);
    chip.appendChild(labelEl);
    if (progressText) {
      var progressEl = document.createElement("div");
      progressEl.className = "achievement-badge-progress";
      progressEl.textContent = progressText;
      chip.appendChild(progressEl);
    }
    return chip;
  }

  function renderPlayerAchievements() {
    if (!currentStatsPlayerName) return;
    var data = computeAchievements(currentStatsPlayerName);
    var unlockedCount =
      data.ladders.filter(function (a) {
        return a.tier > 0;
      }).length +
      data.specials.filter(function (a) {
        return a.unlocked;
      }).length;
    var totalCount = data.ladders.length + data.specials.length;
    setPanelSummary(
      "player-page-achievements-panel",
      T("playerPage.achievementsSummary", { unlocked: unlockedCount, total: totalCount })
    );
    playerPageAchievementsList.innerHTML = "";
    data.ladders.forEach(function (a) {
      var medal = achievementTierMedal(a.tier);
      var label = (medal ? medal + " " : "") + T("achievements." + a.id);
      var progress = a.nextGoal === null ? T("achievements.maxed") : a.value + "/" + a.nextGoal;
      var chip = buildAchievementBadge(a.icon, label, a.tier > 0, progress);
      var desc = document.createElement("div");
      desc.className = "achievement-badge-desc";
      desc.textContent = T("achievements." + a.id + "Desc");
      chip.appendChild(desc);
      playerPageAchievementsList.appendChild(chip);
    });
    data.specials.forEach(function (a) {
      var chip = buildAchievementBadge(a.icon, T("achievements." + a.id), a.unlocked, null);
      var desc = document.createElement("div");
      desc.className = "achievement-badge-desc";
      desc.textContent = T("achievements." + a.id + "Desc");
      chip.appendChild(desc);
      playerPageAchievementsList.appendChild(chip);
    });
  }

  function synopsisStatRow(label, value, variant) {
    var row = document.createElement("div");
    row.className = "player-stats-row";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value" + (variant ? " value-" + variant : "");
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderPlayerSynopsis() {
    if (!currentStatsPlayerName) return;
    var allGames = collectAllGamesForPlayer(currentStatsPlayerName);
    var filtered = filterGamesByPeriod(allGames, currentStatsPeriod);
    var synopsis = computeWinLossSynopsis(filtered);

    playerPageSynopsisBody.innerHTML = "";
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("common.rating"), getPlayerRating(currentStatsPlayerName)));
    var ratingDeltaText = formatRatingPeriodDelta(currentStatsPlayerName, currentStatsPeriod);
    if (ratingDeltaText !== null) {
      playerPageSynopsisBody.appendChild(
        synopsisStatRow(
          T("playerPage.ratingThisPeriod"),
          ratingDeltaText,
          ratingDeltaText.charAt(0) === "▲" ? "win" : ratingDeltaText.charAt(0) === "▼" ? "loss" : null
        )
      );
    }
    playerPageSynopsisBody.appendChild(
      synopsisStatRow(
        T("playerPage.gamesWon"),
        synopsis.skunkWins ? T("playerPage.winsWithSkunk", { wins: synopsis.wins, skunks: synopsis.skunkWins }) : synopsis.wins,
        "win"
      )
    );
    playerPageSynopsisBody.appendChild(
      synopsisStatRow(
        T("playerPage.gamesLost"),
        synopsis.skunkLosses ? T("playerPage.lossesWithSkunk", { losses: synopsis.losses, skunks: synopsis.skunkLosses }) : synopsis.losses,
        "loss"
      )
    );
    playerPageSynopsisBody.appendChild(
      synopsisStatRow(T("playerPage.winPct"), synopsis.pct === null ? "—" : synopsis.pct + "%")
    );

    // Only shown once the feature actually has data - a device where
    // nobody's ever run 2+ balls in a row yet has nothing worth showing.
    var allTimeRun = getAllTimeBestRun();
    if (allTimeRun) {
      playerPageSynopsisBody.appendChild(
        synopsisStatRow(
          T("playerPage.allTimeBestRun"),
          T("playerPage.bestRunValue", { value: allTimeRun.value, name: allTimeRun.name }),
          allTimeRun.name === currentStatsPlayerName ? "win" : null
        )
      );
      var todaysRun = getTodaysBestRun();
      playerPageSynopsisBody.appendChild(
        synopsisStatRow(
          T("playerPage.todaysBestRun"),
          todaysRun ? T("playerPage.bestRunValue", { value: todaysRun.value, name: todaysRun.name }) : T("playerPage.noRunYetToday"),
          todaysRun && todaysRun.name === currentStatsPlayerName ? "win" : null
        )
      );
    }

    // How many of this player's TEAM wins they personally potted the
    // winning ball for (see the mvp selection in creditWin) - their
    // individual contribution within the team's overall win count.
    var teamMvpWinCount = filtered.filter(function (g) {
      return g.result === "won" && g.mvpName === currentStatsPlayerName;
    }).length;
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.teamMvpWins"), teamMvpWinCount, "win"));

    var tournamentFiltered = filterGamesByPeriod(
      tournamentGamesForPlayerName(currentStatsPlayerName).concat(sessionRaceTournamentGames(allGames)),
      currentStatsPeriod
    );
    var tournamentSynopsis = computeWinLossSynopsis(tournamentFiltered);
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsPlayed"), tournamentSynopsis.total));
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsWon"), tournamentSynopsis.wins, "win"));
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsLost"), tournamentSynopsis.losses, "loss"));

    var h2h = computeHeadToHead(filtered);
    setPanelSummary(
      "player-page-h2h-panel",
      h2h.length === 0
        ? "No opponents yet this period."
        : h2h.length + " opponent" + (h2h.length === 1 ? "" : "s") + " faced: " + h2h.map(function (o) { return o.name; }).join(", ")
    );
    playerPageH2hList.innerHTML = "";
    if (h2h.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("playerPage.noOpponentGamesThisPeriod");
      playerPageH2hList.appendChild(hint);
    } else {
      h2h.forEach(function (opp) {
        var li = document.createElement("li");
        li.className = "player-h2h-row";
        var name = document.createElement("span");
        name.className = "player-h2h-name";
        name.textContent = opp.name;
        name.appendChild(buildRatingBadge(opp.name));
        var record = document.createElement("span");
        record.className = "player-h2h-record";
        record.textContent = opp.wins + "–" + opp.losses;
        var pct = document.createElement("span");
        pct.className = "player-h2h-pct";
        pct.textContent = opp.pct === null ? "—" : opp.pct + "%";
        li.appendChild(name);
        li.appendChild(record);
        li.appendChild(pct);
        playerPageH2hList.appendChild(li);
      });
    }

    var teamRecords = computeTeamRecords(filtered, currentStatsPlayerName);
    setPanelSummary(
      "player-page-teams-panel",
      teamRecords.length === 0
        ? "No teams yet this period."
        : teamRecords.length + " team" + (teamRecords.length === 1 ? "" : "s") + " played on"
    );
    playerPageTeamsList.innerHTML = "";
    if (teamRecords.length === 0) {
      var teamHint = document.createElement("li");
      teamHint.className = "empty-hint";
      teamHint.textContent = T("playerPage.noTeamGamesThisPeriod");
      playerPageTeamsList.appendChild(teamHint);
    } else {
      teamRecords.forEach(function (rec) {
        var li = document.createElement("li");
        li.className = "player-h2h-row";
        var name = document.createElement("span");
        name.className = "player-h2h-name";
        var partnerNames = joinNamesForReport(rec.partners);
        name.textContent = rec.teamName ? rec.teamName + " — " + partnerNames : partnerNames;
        rec.partners.forEach(function (partnerName) {
          name.appendChild(buildRatingBadge(partnerName));
        });
        var record = document.createElement("span");
        record.className = "player-h2h-record";
        record.textContent = rec.wins + "–" + rec.losses;
        var pct = document.createElement("span");
        pct.className = "player-h2h-pct";
        pct.textContent = rec.pct === null ? "—" : rec.pct + "%";
        li.appendChild(name);
        li.appendChild(record);
        li.appendChild(pct);
        playerPageTeamsList.appendChild(li);
      });
    }

    renderPlayerAchievements();
  }

  // Mirrors exactly what the Player Stats page currently shows (same
  // period filter, same synopsis/H2H/game-log data) as a real
  // spreadsheet table instead of a JSON export.
  function buildPlayerStatsCsv() {
    var name = currentStatsPlayerName;
    if (!name) return "";
    var allGames = collectAllGamesForPlayer(name);
    var filtered = filterGamesByPeriod(allGames, currentStatsPeriod);
    var synopsis = computeWinLossSynopsis(filtered);
    var tournamentFiltered = filterGamesByPeriod(
      tournamentGamesForPlayerName(name).concat(sessionRaceTournamentGames(allGames)),
      currentStatsPeriod
    );
    var tournamentSynopsis = computeWinLossSynopsis(tournamentFiltered);
    var h2h = computeHeadToHead(filtered);

    var lines = [];
    lines.push(csvRow(["Pool Master Counter — Player Stats", name, T(PLAYER_PAGE_PERIOD_LABEL_KEYS[currentStatsPeriod] || "period.allTime")]));
    lines.push("\r\n");

    lines.push(csvRow(["Rating", "Games Won", "Skunk Wins", "Games Lost", "Skunk Losses", "Win %", "Tournaments Played", "Tournaments Won", "Tournaments Lost"]));
    lines.push(
      csvRow([
        getPlayerRating(name),
        synopsis.wins,
        synopsis.skunkWins,
        synopsis.losses,
        synopsis.skunkLosses,
        synopsis.pct === null ? "" : synopsis.pct + "%",
        tournamentSynopsis.total,
        tournamentSynopsis.wins,
        tournamentSynopsis.losses
      ])
    );
    lines.push("\r\n");

    lines.push(csvRow(["Opponent", "Wins", "Losses", "Win %"]));
    h2h.forEach(function (o) {
      lines.push(csvRow([o.name, o.wins, o.losses, o.pct === null ? "" : o.pct + "%"]));
    });
    lines.push("\r\n");

    lines.push(csvRow(["Time", "Game", "Result", "Winner(s)", "Opponent(s)", "Duration", "Race Milestone", "Skunk", "Balls Left"]));
    filtered
      .slice()
      .sort(function (a, b) {
        return (a.ts || "").localeCompare(b.ts || "");
      })
      .forEach(function (g) {
        lines.push(
          csvRow([
            formatTimestamp(g.ts, true),
            g.gameLabel,
            g.result === "won" ? "Won" : "Lost",
            joinNamesForReport(g.winnerNames || []),
            joinNamesForReport(g.opponentNames || []),
            formatDuration(g.durationMs),
            g.wonRace ? "Race to " + g.raceTarget : "",
            g.skunk ? "Yes" : "",
            g.ballsLeftOnTable !== null && g.ballsLeftOnTable !== undefined ? g.ballsLeftOnTable : ""
          ])
        );
      });

    return "\uFEFF" + lines.join("");
  }

  function renderPlayerPageGraph() {
    if (!currentStatsPlayerName) return;
    var period = currentStatsPeriod;
    var stats = computePlayerCareerStats(currentStatsPlayerName, period);

    var periodStart = periodStartDate(period);
    var minMs, maxMs;
    if (periodStart) {
      minMs = periodStart.getTime();
    } else {
      var minTs = null;
      stats.games.forEach(function (g) {
        if (!g.ts) return;
        if (minTs === null || g.ts < minTs) minTs = g.ts;
      });
      minMs = minTs === null ? Date.now() : new Date(minTs).getTime();
    }
    maxMs = Date.now();
    if (maxMs <= minMs) maxMs = minMs + 1;

    playerPageGraphBody.innerHTML = "";
    playerPageGraphBody.appendChild(buildPlayerGraph(stats, minMs, maxMs, period));
  }

  function setStatsPeriod(period) {
    currentStatsPeriod = period;
    for (var i = 0; i < playerPagePeriodButtons.length; i++) {
      var btn = playerPagePeriodButtons[i];
      btn.classList.toggle("is-active", btn.getAttribute("data-period") === period);
    }
    renderPlayerSynopsis();
    renderPlayerPageGraph();
  }

  function formatSessionDateTime(session) {
    var text = session.date;
    if (session.games && session.games.length) {
      var sorted = session.games.slice().sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
      var first = formatTimestamp(sorted[0].ts, false);
      var last = formatTimestamp(sorted[sorted.length - 1].ts, false);
      if (first || last) {
        text += " · " + (first === last ? first : first + " – " + last);
      }
    }
    return text;
  }

  function renderPlayerHistoryList(sessions) {
    playerPageHistoryList.innerHTML = "";
    if (!sessions || sessions.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("playerPage.noSavedSessionsYet");
      playerPageHistoryList.appendChild(hint);
      return;
    }
    var playerName = currentStatsPlayerName || "";
    sessions
      .slice()
      .sort(function (a, b) {
        return b.date.localeCompare(a.date);
      })
      .forEach(function (session) {
        var li = document.createElement("li");
        li.className = "player-history-row" + (session.wonTournament ? " won-tournament" : "");

        var top = document.createElement("div");
        top.className = "player-history-top";
        var date = document.createElement("span");
        date.className = "player-history-date";
        date.textContent = formatSessionDateTime(session);
        var wins = document.createElement("span");
        wins.className = "player-history-wins";
        wins.textContent = session.wins + " win" + (session.wins === 1 ? "" : "s");
        top.appendChild(date);
        top.appendChild(wins);
        li.appendChild(top);

        if (session.wonTournament) {
          var banner = document.createElement("div");
          banner.className = "tournament-winner-banner";
          banner.textContent = T("playerPage.wonTournamentBanner", { name: playerName });
          banner.appendChild(buildRatingBadge(playerName));
          li.appendChild(banner);
        }

        var detail = document.createElement("div");
        detail.className = "player-history-detail";
        if (session.games && session.games.length) {
          var log = document.createElement("div");
          log.className = "player-game-log";
          session.games.forEach(function (g) {
            log.appendChild(playerGameLogRow(g));
          });
          detail.appendChild(log);
        } else {
          var gamesText = session.gamesWon && session.gamesWon.length ? session.gamesWon.join(", ") : "—";
          detail.appendChild(document.createTextNode("Games: " + gamesText));
          detail.appendChild(document.createElement("br"));
        }
        var opponentsText = session.opponents && session.opponents.length ? session.opponents.join(", ") : "—";
        detail.appendChild(document.createTextNode("Opponents: " + opponentsText));
        li.appendChild(detail);

        playerPageHistoryList.appendChild(li);
      });
  }

  // ---------------------------------------------------------------------
  // Screen navigation / browser history — makes the physical browser back
  // button do exactly what the in-app "← Back" buttons do: no reload, no
  // leaving the app, just the same screen transition. main -> subscreen
  // pushes a new entry (so one physical Back returns to main); moving
  // sideways between two subscreens (e.g. Player Stats -> All Players via
  // "Global Stats") replaces the current entry instead, so depth never
  // exceeds one level — Back always means "back to main," matching how
  // the in-app Back buttons already behaved before this existed.
  // ---------------------------------------------------------------------

  function pushScreenHistory(screen, extra) {
    var onMain = !appRoot.classList.contains("hidden");
    var state = { screen: screen };
    var hash = "#" + screen;
    if (extra && extra.name) {
      state.name = extra.name;
      hash += "/" + encodeURIComponent(extra.name);
    }
    if (onMain) {
      history.pushState(state, "", hash);
    } else {
      history.replaceState(state, "", hash);
    }
  }

  function navigateBack() {
    history.back();
  }

  window.addEventListener("popstate", function (e) {
    var state = e.state;
    if (!state || !state.screen || state.screen === "main") {
      if (!playerPageView.classList.contains("hidden")) closePlayerStatsPage(true);
      else if (!allPlayersPageView.classList.contains("hidden")) closeAllPlayersPage(true);
      else if (!tournamentPageView.classList.contains("hidden")) closeTournamentPage(true);
      else if (!contactSheetPageView.classList.contains("hidden")) closeContactSheetPage(true);
      else if (!leaderboardPageView.classList.contains("hidden")) closeLeaderboardPage(true);
      return;
    }
    if (state.screen === "all-players") openAllPlayersPage(true);
    else if (state.screen === "tournament") openTournamentPage(true);
    else if (state.screen === "player") openPlayerStatsPage(state.name, true);
    else if (state.screen === "contact-sheet") openContactSheetPage(true);
    else if (state.screen === "leaderboard") openLeaderboardPage(true);
  });

  history.replaceState({ screen: "main" }, "", location.pathname + location.search);

  // Fills the Player Stats page's player-switcher dropdown with every
  // known player name (alphabetical) and selects the one currently being
  // viewed, so switching players is a single dropdown pick instead of a
  // trip back to All Stats. Re-run on every openPlayerStatsPage call so a
  // player added since the page last opened shows up too.
  function populatePlayerPageSwitcher(currentName) {
    var names = getAllKnownPlayerNames();
    // Belt-and-suspenders: whatever page we're viewing should always be
    // selectable, even in an edge case where this name isn't found by
    // getAllKnownPlayerNames (e.g. reached via a stale link after that
    // player's data was reset).
    if (names.indexOf(currentName) === -1) names.push(currentName);
    names.sort(function (a, b) {
      return a.localeCompare(b);
    });
    playerPageSwitcher.innerHTML = "";
    names.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      playerPageSwitcher.appendChild(opt);
    });
    playerPageSwitcher.value = currentName;
  }

  // name: the player's name — works whether or not they're currently on
  // the roster, since saved stats are keyed by name, not id. skipHistory
  // is true only when called from the popstate handler above (restoring
  // a screen the browser already navigated to) — it must never push or
  // replace history again in that case.
  function openPlayerStatsPage(name, skipHistory) {
    if (!name) return;
    if (!skipHistory) pushScreenHistory("player", { name: name });
    currentStatsPlayerName = name;
    currentStatsSessions = null;
    playerPageName.innerHTML = "";
    buildPlayerNameLabel(playerPageName, name, true);
    playerPageName.appendChild(buildRatingBadge(name));
    var addedAt = getPlayerAddedAt(name);
    if (addedAt) {
      playerPageAdded.textContent = T("playerPage.added", { date: formatDateISO(addedAt) });
      playerPageAdded.classList.remove("hidden");
    } else {
      playerPageAdded.textContent = "";
      playerPageAdded.classList.add("hidden");
    }
    populatePlayerPageSwitcher(name);
    renderLiveSessionForPlayer(name);
    playerPageHistoryList.innerHTML = "";
    var loading = document.createElement("li");
    loading.className = "empty-hint";
    loading.textContent = T("playerPage.loadingSavedHistory");
    playerPageHistoryList.appendChild(loading);

    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    contactSheetPageView.classList.add("hidden");
    leaderboardPageView.classList.add("hidden");
    playerPageView.classList.remove("hidden");
    window.scrollTo(0, 0);

    currentStatsSessions = getPlayerSessions(name);
    renderPlayerHistoryList(currentStatsSessions);
    setStatsPeriod("all");
  }

  function closePlayerStatsPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    playerPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
    currentStatsPlayerName = null;
    currentStatsSessions = null;
  }

  function returnToGlobalStats() {
    playerPageView.classList.add("hidden");
    currentStatsPlayerName = null;
    currentStatsSessions = null;
    openAllPlayersPage();
  }

  // ---------------------------------------------------------------------
  // All Players page — every player who has ever played, with a career
  // played/won/lost scale each and a timeline of when they played.
  // ---------------------------------------------------------------------

  // Every player name known to this device: anyone with saved stats, anyone
  // currently on the roster (even before their first save), and anyone who
  // shows up in this session's still-unsaved game history (e.g. removed
  // from the roster mid-session, or before "New Game" folds it into
  // PLAYER_STATS) — so nobody who's actually played drops off the list.
  // Case variants of the same name (built via buildNameCasingMap) collapse
  // into one canonical entry.
  function getAllKnownPlayerNames() {
    var map = buildNameCasingMap();
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  // All of one player's games — saved history plus whatever's still live
  // in the current in-progress session — deduped the same way the stats
  // synopsis page does.
  function allGamesForPlayerName(name) {
    var sessions = getPlayerSessions(name);
    var today = todayDateStr();
    var live = computeSessionFromGameHistory(state.gameHistory, name, today);
    var merged = live ? mergeSessionIntoList(sessions, live) : sessions;
    var games = [];
    merged.forEach(function (s) {
      (s.games || []).forEach(function (g) {
        games.push(fillLegacyGameOpponents(g, s));
      });
    });
    return games;
  }

  // Sessions saved before per-game opponentNames/teammateNames/isTeam
  // existed (e.g. the bundled players/*.json backups) only have those
  // fields at the session level ("opponents"). Backfilling them from
  // there keeps head-to-head, tooltips, and rating backfill all working
  // for that older data instead of silently treating it as opponent-less.
  function fillLegacyGameOpponents(g, session) {
    if (g.opponentNames) return g;
    var opponentNames = (session && session.opponents) || [];
    var isTeam = (g.winnerNames || []).length > 1 || opponentNames.length > 1;
    return {
      ts: g.ts,
      gameLabel: g.gameLabel,
      target: g.target,
      result: g.result,
      winnerNames: g.winnerNames,
      opponentNames: opponentNames,
      teammateNames: g.teammateNames || [],
      isTeam: isTeam,
      mvpName: g.mvpName,
      durationMs: g.durationMs,
      wonRace: g.wonRace,
      raceTarget: g.raceTarget,
      raceCount: g.raceCount,
      skunk: g.skunk || false
    };
  }

  function computePlayerCareerStats(name, period) {
    var allGames = allGamesForPlayerName(name);
    var games = filterGamesByPeriod(allGames, period);
    var tournamentGames = filterGamesByPeriod(
      tournamentGamesForPlayerName(name).concat(sessionRaceTournamentGames(allGames)),
      period
    );
    var wins = 0;
    var losses = 0;
    games.forEach(function (g) {
      if (g.result === "won") wins += 1;
      else losses += 1;
    });
    var tournamentWins = 0;
    var tournamentLosses = 0;
    tournamentGames.forEach(function (g) {
      if (g.result === "won") tournamentWins += 1;
      else tournamentLosses += 1;
    });
    return {
      name: name,
      games: games,
      tournamentGames: tournamentGames,
      played: games.length,
      wins: wins,
      losses: losses,
      tournamentPlayed: tournamentGames.length,
      tournamentWins: tournamentWins,
      tournamentLosses: tournamentLosses,
      winPct: games.length ? wins / games.length : null
    };
  }

  function sortAllPlayerStats(list, mode) {
    var sorted = list.slice();
    if (mode === "alpha") {
      sorted.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    } else if (mode === "wins") {
      sorted.sort(function (a, b) {
        return b.wins - a.wins || a.name.localeCompare(b.name);
      });
    } else {
      sorted.sort(function (a, b) {
        var ap = a.winPct === null ? -1 : a.winPct;
        var bp = b.winPct === null ? -1 : b.winPct;
        return bp - ap || b.played - a.played || a.name.localeCompare(b.name);
      });
    }
    return sorted;
  }

  // Rounds a raw max game-count up to the nearest multiple of 4 (minimum 4)
  // so the 4 axis graduations below always land on whole numbers.
  function axisMaxFor(rawMax) {
    return Math.max(4, Math.ceil(rawMax / 4) * 4);
  }

  function buildScaleRow(label, value, axisMax, variantClass) {
    var row = document.createElement("div");
    row.className = "scale-row";

    var top = document.createElement("div");
    top.className = "scale-row-top";
    var l = document.createElement("span");
    l.className = "scale-row-label";
    l.textContent = T("allPlayers.statWithCount", { label: label, count: value });
    top.appendChild(l);
    row.appendChild(top);

    var track = document.createElement("div");
    track.className = "scale-track";
    var pct = axisMax > 0 ? (value / axisMax) * 100 : 0;
    var fill = document.createElement("div");
    fill.className = "scale-fill " + variantClass;
    fill.style.width = pct + "%";
    track.appendChild(fill);

    var ticks = document.createElement("div");
    ticks.className = "scale-ticks";
    var tickCount = 4;
    for (var i = 0; i <= tickCount; i++) {
      var tick = document.createElement("span");
      tick.className = "scale-tick";
      tick.style.left = (i * 100) / tickCount + "%";
      tick.setAttribute("data-value", Math.round((axisMax * i) / tickCount));
      ticks.appendChild(tick);
    }
    track.appendChild(ticks);
    row.appendChild(track);
    return row;
  }

  function buildTimelineRow(games, minMs, maxMs) {
    var wrap = document.createElement("div");

    var title = document.createElement("div");
    title.className = "timeline-title";
    title.textContent = T("common.timeline");
    wrap.appendChild(title);

    var track = document.createElement("div");
    track.className = "timeline-track";

    var sameDay = maxMs - minMs < 24 * 60 * 60 * 1000;
    var tickCount = 4;
    for (var i = 0; i <= tickCount; i++) {
      var frac = i / tickCount;
      var tick = document.createElement("span");
      tick.className = "timeline-tick";
      tick.style.left = frac * 100 + "%";
      var tickDate = new Date(minMs + frac * (maxMs - minMs));
      var label = sameDay
        ? tickDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : tickDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      tick.setAttribute("data-label", label);
      track.appendChild(tick);
    }

    games.forEach(function (g) {
      if (!g.ts) return;
      var t = new Date(g.ts).getTime();
      if (isNaN(t)) return;
      var frac = maxMs > minMs ? (t - minMs) / (maxMs - minMs) : 0.5;
      var dot = document.createElement("span");
      dot.className = "timeline-dot " + (g.result === "won" ? "timeline-dot-won" : "timeline-dot-lost");
      dot.style.left = frac * 100 + "%";
      dot.title = formatTimestamp(g.ts, true) + " — " + (g.result === "won" ? "Won" : "Lost") + " " + g.gameLabel;
      track.appendChild(dot);
    });

    wrap.appendChild(track);
    return wrap;
  }

  // ---------------------------------------------------------------------
  // All Players page — graph view (cumulative played/lost over time,
  // individual and per-team-combo lines)
  // ---------------------------------------------------------------------

  var SVG_NS = "http://www.w3.org/2000/svg";
  var TEAM_COMBO_PALETTE = ["#c77dff", "#4fb0a5", "#e08e45", "#8ecae6", "#f2a6c9", "#9fd35c", "#d4a24c", "#6a8caf"];
  // Fixed (theme-independent) colors for the whole-Tournament played/won/
  // lost series — deliberately blue/violet, nowhere near the gold/amber
  // family several themes use for --accent (which Single games won/lost
  // follows instead) or the red family every theme uses for --danger, so
  // the two "won" lines (and the two "lost" lines) stay visually distinct
  // no matter the active theme.
  var TOURNAMENT_PLAYED_COLOR = "#00b4d8";
  var TOURNAMENT_WON_COLOR = "#3a86ff";
  var TOURNAMENT_LOST_COLOR = "#8338ec";
  // Leaves this fraction of the chart's width blank at the right edge, so
  // the most recent line segment and "Now" tick aren't flush against the
  // card border — otherwise the latest data reads as cut off.
  var GRAPH_END_BUFFER = 0.05;

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, attrs[key]);
    });
    return el;
  }

  function teamComboLabel(teammateNames) {
    return (teammateNames || []).slice().sort().join(", ");
  }

  // Turns a chronological game list into cumulative played/lost counts over
  // time — one line for individual games, and one played/lost pair per
  // distinct team combination this player has been part of.
  // Groups a timestamp into the bucket the graph should show one data point
  // per, matching the selected period's natural resolution: minute-by-
  // minute for a single day (otherwise several games in the same session
  // would each get their own dot), day-by-day for everything from a week
  // up to a year, since "which minute" stops being meaningful at that
  // range.
  function bucketKeyFor(ts, period) {
    var d = new Date(ts);
    if (period === "today") {
      return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate() + "-" + d.getHours() + "-" + d.getMinutes();
    }
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  // Adds one game's result to a cumulative series, collapsing consecutive
  // games that land in the same bucket into a single point (the bucket's
  // last timestamp, with the running total as of that point) instead of
  // plotting a dot per game. gameInfo ({gameLabel, opponentNames, result})
  // is kept per point (not just the count) so a dot can show exactly
  // which opponents were played and the win/loss against each — see
  // summarizeGraphDotGames / the graph's click-to-reveal tooltip.
  function pushBucketedPoint(arr, ts, count, period, gameInfo) {
    var key = bucketKeyFor(ts, period);
    var last = arr.length ? arr[arr.length - 1] : null;
    if (last && last.bucketKey === key) {
      last.ts = ts;
      last.count = count;
      if (gameInfo) last.games.push(gameInfo);
    } else {
      arr.push({ ts: ts, count: count, bucketKey: key, games: gameInfo ? [gameInfo] : [] });
    }
  }

  function buildCumulativeSeries(games, period) {
    var sorted = games.slice().sort(function (a, b) {
      return a.ts.localeCompare(b.ts);
    });
    var individualPlayed = [];
    var individualWon = [];
    var individualLost = [];
    var indPlayedCount = 0;
    var indWonCount = 0;
    var indLostCount = 0;
    var teamCombos = {};

    sorted.forEach(function (g) {
      var gameInfo = { gameLabel: g.gameLabel, opponentNames: g.opponentNames || [], result: g.result };
      if (!g.isTeam) {
        indPlayedCount += 1;
        pushBucketedPoint(individualPlayed, g.ts, indPlayedCount, period, gameInfo);
        if (g.result === "won") {
          indWonCount += 1;
          pushBucketedPoint(individualWon, g.ts, indWonCount, period, gameInfo);
        } else {
          indLostCount += 1;
          pushBucketedPoint(individualLost, g.ts, indLostCount, period, gameInfo);
        }
        return;
      }
      var key = teamComboLabel(g.teammateNames) || T("graph.teammatesUnknown");
      if (!teamCombos[key]) {
        teamCombos[key] = {
          label: key,
          played: [],
          won: [],
          lost: [],
          playedCount: 0,
          wonCount: 0,
          lostCount: 0
        };
      }
      var combo = teamCombos[key];
      combo.playedCount += 1;
      pushBucketedPoint(combo.played, g.ts, combo.playedCount, period, gameInfo);
      if (g.result === "won") {
        combo.wonCount += 1;
        pushBucketedPoint(combo.won, g.ts, combo.wonCount, period, gameInfo);
      } else {
        combo.lostCount += 1;
        pushBucketedPoint(combo.lost, g.ts, combo.lostCount, period, gameInfo);
      }
    });

    return {
      individualPlayed: individualPlayed,
      individualWon: individualWon,
      individualLost: individualLost,
      teamCombos: teamCombos
    };
  }

  // Same bucketing idea as buildCumulativeSeries, but for whole completed
  // bracket Tournaments (won = became champion, lost = eliminated at any
  // point) rather than individual rack results — see
  // tournamentGamesForPlayerName. Kept as its own (much simpler) function
  // since there's no "played"/team-combo split to track here.
  function buildTournamentCumulativeSeries(games, period) {
    var sorted = games.slice().sort(function (a, b) {
      return a.ts.localeCompare(b.ts);
    });
    var played = [];
    var won = [];
    var lost = [];
    var playedCount = 0;
    var wonCount = 0;
    var lostCount = 0;
    sorted.forEach(function (g) {
      var gameInfo = { gameLabel: g.gameLabel, opponentNames: g.opponentNames || [], result: g.result };
      playedCount += 1;
      pushBucketedPoint(played, g.ts, playedCount, period, gameInfo);
      if (g.result === "won") {
        wonCount += 1;
        pushBucketedPoint(won, g.ts, wonCount, period, gameInfo);
      } else {
        lostCount += 1;
        pushBucketedPoint(lost, g.ts, lostCount, period, gameInfo);
      }
    });
    return { played: played, won: won, lost: lost };
  }

  // Monotone cubic Hermite spline (Fritsch–Carlson) through a point list —
  // smooth, no sharp corners, and — unlike a plain Catmull-Rom spline —
  // never overshoots past a point's value, which matters here because the
  // data is a cumulative count that only ever holds or rises.
  function monotoneLinePath(rawPts) {
    if (rawPts.length === 0) return "";
    // A monotone spline needs strictly increasing x; merge any points that
    // land on (almost) the same x — e.g. two events a fraction of a second
    // apart — keeping the later one, since a vertical jump has no slope.
    var pts = [rawPts[0]];
    for (var i = 1; i < rawPts.length; i++) {
      if (rawPts[i].x - pts[pts.length - 1].x < 0.01) {
        pts[pts.length - 1] = rawPts[i];
      } else {
        pts.push(rawPts[i]);
      }
    }
    var n = pts.length;
    if (n === 1) return "M " + pts[0].x + " " + pts[0].y;

    var dx = [];
    var delta = [];
    for (i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      delta[i] = (pts[i + 1].y - pts[i].y) / dx[i];
    }

    var m = [delta[0]];
    for (i = 1; i < n - 1; i++) {
      if (delta[i - 1] === 0 || delta[i] === 0 || delta[i - 1] < 0 !== delta[i] < 0) {
        m[i] = 0;
      } else {
        m[i] = (delta[i - 1] + delta[i]) / 2;
      }
    }
    m[n - 1] = delta[n - 2];

    for (i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      var a = m[i] / delta[i];
      var b = m[i + 1] / delta[i];
      if (a < 0) m[i] = 0;
      if (b < 0) m[i + 1] = 0;
      var s = a * a + b * b;
      if (s > 9) {
        var tau = 3 / Math.sqrt(s);
        m[i] = tau * a * delta[i];
        m[i + 1] = tau * b * delta[i];
      }
    }

    var d = "M " + pts[0].x + " " + pts[0].y;
    for (i = 0; i < n - 1; i++) {
      var cp1x = pts[i].x + dx[i] / 3;
      var cp1y = pts[i].y + (m[i] * dx[i]) / 3;
      var cp2x = pts[i + 1].x - dx[i] / 3;
      var cp2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
      d += " C " + cp1x + " " + cp1y + " " + cp2x + " " + cp2y + " " + pts[i + 1].x + " " + pts[i + 1].y;
    }
    return d;
  }

  // Maps a cumulative (ts, count) series onto chart coordinates and builds
  // a smooth path through it (anchored flat at the chart's time edges), plus
  // the screen position of every real data point for dot markers.
  function buildSeriesGeometry(points, minMs, maxMs, width, height, axisMax) {
    var usableWidth = width * (1 - GRAPH_END_BUFFER);
    function xFor(ms) {
      return maxMs > minMs ? ((ms - minMs) / (maxMs - minMs)) * usableWidth : 0;
    }
    function yFor(count) {
      return axisMax > 0 ? height - (count / axisMax) * height : height;
    }
    var dots = points.map(function (p) {
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.count), games: p.games || [] };
    });
    var lastCount = points.length ? points[points.length - 1].count : 0;
    var allPts = [{ x: xFor(minMs), y: yFor(0) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastCount) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  // Collapses a graph dot's underlying games into one win/loss tally per
  // opponent (a bucketed dot can represent several games against several
  // people), in first-seen order.
  function summarizeGraphDotGames(games) {
    var byOpponent = {};
    var order = [];
    games.forEach(function (g) {
      (g.opponentNames || []).forEach(function (name) {
        if (!byOpponent[name]) {
          byOpponent[name] = { name: name, wins: 0, losses: 0 };
          order.push(name);
        }
        if (g.result === "won") byOpponent[name].wins += 1;
        else byOpponent[name].losses += 1;
      });
    });
    return order.map(function (name) {
      return byOpponent[name];
    });
  }

  var graphTooltipEl = null;

  function getGraphTooltipEl() {
    if (!graphTooltipEl) {
      graphTooltipEl = document.createElement("div");
      graphTooltipEl.className = "player-graph-tooltip hidden";
      document.body.appendChild(graphTooltipEl);
    }
    return graphTooltipEl;
  }

  // Shows (or moves, if already open) a small fixed-position tooltip near
  // wherever a graph dot was clicked, listing every opponent behind that
  // point and the win/loss record against each. One shared tooltip node
  // for the whole app — only one is ever open at a time.
  function showGraphDotTooltip(clientX, clientY, games, seriesLabel) {
    var el = getGraphTooltipEl();
    var perOpponent = summarizeGraphDotGames(games);
    el.innerHTML = "";
    var title = document.createElement("div");
    title.className = "player-graph-tooltip-title";
    title.textContent = T("playerPage.graphDotTitle", { series: seriesLabel, count: games.length });
    el.appendChild(title);
    perOpponent.forEach(function (opp) {
      var row = document.createElement("div");
      row.className = "player-graph-tooltip-row";
      var name = document.createElement("span");
      name.className = "player-graph-tooltip-name";
      // "vs " prefix (matching the rating-dot tooltip's convention)
      // instead of the bare opponent name — otherwise "Suresh 2 wins,
      // 0 losses" reads as Suresh's own record, when it's actually
      // this player's record against Suresh.
      name.textContent = T("common.vsName", { name: opp.name });
      var record = document.createElement("span");
      record.className = "player-graph-tooltip-record";
      var winWord = opp.wins === 1 ? "win" : "wins";
      var lossWord = opp.losses === 1 ? "loss" : "losses";
      record.textContent = opp.wins + " " + winWord + ", " + opp.losses + " " + lossWord;
      row.appendChild(name);
      row.appendChild(record);
      el.appendChild(row);
    });
    el.classList.remove("hidden");
    positionGraphTooltip(el, clientX, clientY);
  }

  // Places an already-populated, already-unhidden tooltip just beside
  // wherever it was triggered from — above the click point by default,
  // flipping below if that would run off the top, and clamped left/right
  // so it never runs off either edge. Shared by every graph tooltip
  // (win/loss dots, rating dots) so they all behave identically.
  function positionGraphTooltip(el, clientX, clientY) {
    var margin = 8;
    var left = Math.min(Math.max(clientX - el.offsetWidth / 2, margin), window.innerWidth - el.offsetWidth - margin);
    var top = clientY - el.offsetHeight - 14;
    if (top < margin) top = clientY + 14;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function hideGraphTooltip() {
    if (graphTooltipEl) graphTooltipEl.classList.add("hidden");
  }

  // Finds this player's own game record with a given ts (exact match —
  // every rating-history point is stamped with the same ts as the game
  // that caused it) so a rating dot's tooltip can show who it was against.
  function findGameByTs(games, ts) {
    for (var i = 0; i < games.length; i++) {
      if (games[i].ts === ts) return games[i];
    }
    return null;
  }

  function formatSignedDelta(delta) {
    if (delta > 0) return "▲ +" + delta;
    if (delta < 0) return "▼ " + delta;
    return "— no change";
  }

  // Click-to-reveal tooltip for one rating-history dot: the resulting
  // rating at that exact point, this player's own change from that
  // game, plus — by cross-referencing the matching game record's
  // opponentNames and each opponent's own rating history at the same ts
  // (getPlayerRatingDeltaForGame) — exactly who it was against and what
  // happened to their rating too, so it's clear who gained and lost.
  function showRatingDotTooltip(clientX, clientY, point, game) {
    var el = getGraphTooltipEl();
    el.innerHTML = "";
    var title = document.createElement("div");
    title.className = "player-graph-tooltip-title";
    title.textContent = formatTimestamp(point.ts, true);
    el.appendChild(title);

    var previousRating = point.rating - point.delta;
    var ratingRow = document.createElement("div");
    ratingRow.className = "player-graph-tooltip-row";
    var ratingLabel = document.createElement("span");
    ratingLabel.className = "player-graph-tooltip-name";
    ratingLabel.textContent = T("common.rating");
    var ratingValue = document.createElement("span");
    ratingValue.className = "player-graph-tooltip-record";
    ratingValue.textContent = T("playerPage.ratingWasNow", { was: previousRating, now: point.rating });
    ratingRow.appendChild(ratingLabel);
    ratingRow.appendChild(ratingValue);
    el.appendChild(ratingRow);

    var youRow = document.createElement("div");
    youRow.className = "player-graph-tooltip-row";
    var youName = document.createElement("span");
    youName.className = "player-graph-tooltip-name";
    youName.textContent = T("common.you");
    var youRecord = document.createElement("span");
    youRecord.className = "player-graph-tooltip-record";
    youRecord.textContent = formatSignedDelta(point.delta);
    youRow.appendChild(youName);
    youRow.appendChild(youRecord);
    el.appendChild(youRow);

    var opponentNames = game ? game.opponentNames || [] : [];
    if (opponentNames.length === 0) {
      var noGame = document.createElement("div");
      noGame.className = "player-graph-tooltip-row";
      var hint = document.createElement("span");
      hint.className = "player-graph-tooltip-record";
      hint.textContent = T("playerPage.opponentDetailsUnavailable");
      noGame.appendChild(hint);
      el.appendChild(noGame);
    } else {
      opponentNames.forEach(function (oppName) {
        var oppDelta = getPlayerRatingDeltaForGame(oppName, point.ts);
        var row = document.createElement("div");
        row.className = "player-graph-tooltip-row";
        var name = document.createElement("span");
        name.className = "player-graph-tooltip-name";
        name.textContent = T("common.vsName", { name: oppName });
        var record = document.createElement("span");
        record.className = "player-graph-tooltip-record";
        record.textContent = oppDelta === null ? "—" : formatSignedDelta(oppDelta);
        row.appendChild(name);
        row.appendChild(record);
        el.appendChild(row);
      });
    }

    el.classList.remove("hidden");
    positionGraphTooltip(el, clientX, clientY);
  }

  // Draws one series as a smooth path plus a dot at every real data point.
  // color is only needed for team-combo lines, which use an inline stroke/
  // fill instead of a CSS class (their color is picked at render time).
  // Returns the <g> the series was drawn into, so the legend can toggle its
  // visibility (show/hide) as one unit. Every dot that has games behind it
  // gets an invisible, larger "hit" circle on top (small dots are hard to
  // tap precisely) that reveals a tooltip with the opponent(s) and win/
  // loss for every game bucketed into that point — see
  // showGraphDotTooltip/summarizeGraphDotGames.
  function appendGraphSeries(svg, points, minMs, maxMs, width, height, axisMax, lineClass, dotClass, color, startHidden, seriesLabel) {
    var geo = buildSeriesGeometry(points, minMs, maxMs, width, height, axisMax);
    var group = svgEl("g", { class: "player-graph-series" + (startHidden ? " is-hidden" : "") });
    var pathAttrs = { d: geo.path, fill: "none", class: lineClass };
    if (color) pathAttrs.stroke = color;
    group.appendChild(svgEl("path", pathAttrs));
    geo.dots.forEach(function (pt) {
      var circleAttrs = { cx: pt.x, cy: pt.y, r: 3.2, class: dotClass };
      if (color) circleAttrs.fill = color;
      group.appendChild(svgEl("circle", circleAttrs));
      if (pt.games && pt.games.length) {
        var hit = svgEl("circle", { cx: pt.x, cy: pt.y, r: 9, class: "player-graph-dot-hit" });
        hit.addEventListener("click", function (e) {
          e.stopPropagation();
          showGraphDotTooltip(e.clientX, e.clientY, pt.games, seriesLabel);
        });
        group.appendChild(hit);
      }
    });
    svg.appendChild(group);
    return group;
  }

  // Dense graduation points for the graph's time axis, matching the
  // selected period's natural calendar unit: hours through a day, days
  // through a week or month, months through 6 months or a year. Always
  // ends with maxMs itself — "now", the moment the graph was requested —
  // even though that rarely lands exactly on one of those boundaries.
  function periodAxisTicks(period, minMs, maxMs) {
    var start = new Date(minMs);
    var ticks = [];
    function add(d) {
      var ms = d.getTime();
      if (ms <= maxMs) ticks.push(ms);
    }
    if (period === "today") {
      for (var h = 0; h <= 24; h++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 0, 0, 0));
      }
    } else if (period === "week") {
      for (var d1 = 0; d1 <= 7; d1++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d1));
      }
    } else if (period === "month") {
      var daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      for (var d2 = 0; d2 <= daysInMonth; d2++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d2));
      }
    } else if (period === "6month" || period === "year") {
      var monthCount = period === "year" ? 12 : 6;
      for (var m = 0; m <= monthCount; m++) {
        add(new Date(start.getFullYear(), start.getMonth() + m, start.getDate()));
      }
    } else {
      var evenCount = 4;
      for (var i = 0; i <= evenCount; i++) {
        ticks.push(minMs + (i / evenCount) * (maxMs - minMs));
      }
    }
    if (ticks.length === 0 || ticks[ticks.length - 1] !== maxMs) {
      ticks.push(maxMs);
    }
    return ticks;
  }

  function formatAxisTickLabel(d, period) {
    if (period === "today") return d.toLocaleTimeString(undefined, { hour: "numeric" });
    if (period === "week") return d.toLocaleDateString(undefined, { weekday: "short" });
    if (period === "month") return String(d.getDate());
    if (period === "6month" || period === "year") return d.toLocaleDateString(undefined, { month: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function buildGraphTimeAxis(minMs, maxMs, period) {
    var axis = document.createElement("div");
    axis.className = "player-graph-time-axis";

    var allTicks = periodAxisTicks(period, minMs, maxMs);
    var span = maxMs - minMs || 1;
    function pctFor(ms) {
      return ((ms - minMs) / span) * 100 * (1 - GRAPH_END_BUFFER);
    }

    // Dense, unlabeled graduation marks — one per hour/day/month depending
    // on the selected period, like a ruler.
    allTicks.forEach(function (ms) {
      var mark = document.createElement("span");
      mark.className = "player-graph-time-tick";
      mark.style.left = pctFor(ms) + "%";
      axis.appendChild(mark);
    });

    // A sparser labeled subset so the text stays legible; the last label
    // is always "Now" — exactly maxMs, the moment this graph was requested.
    var maxLabels = 6;
    var labelIdxs = [];
    if (allTicks.length <= maxLabels) {
      for (var i = 0; i < allTicks.length; i++) labelIdxs.push(i);
    } else {
      var step = (allTicks.length - 1) / (maxLabels - 1);
      for (var j = 0; j < maxLabels; j++) labelIdxs.push(Math.round(j * step));
    }
    var seen = {};
    var finalIdxs = [];
    labelIdxs.forEach(function (idx) {
      if (!seen[idx]) {
        seen[idx] = true;
        finalIdxs.push(idx);
      }
    });
    var lastIdx = allTicks.length - 1;
    // A narrow (phone-portrait) viewport gives the same-length "Now" text
    // a much bigger share of the available width than on a wide screen, so
    // a threshold tuned for desktop isn't enough clearance there — and
    // since a slightly sparser axis costs nothing on a wide screen either,
    // just use the wide clearance unconditionally rather than guess a
    // width breakpoint that has to match every real device.
    var nowCollisionThreshold = 0.32;

    // Guarantee "Now" is the final label, then drop whichever regular tick
    // landed right next to it — including one that happened to already be
    // in the evenly-spaced selection — so the (usually much longer) "Now"
    // text never overlaps its neighbor.
    if (finalIdxs[finalIdxs.length - 1] !== lastIdx) finalIdxs.push(lastIdx);
    while (
      finalIdxs.length > 1 &&
      (allTicks[lastIdx] - allTicks[finalIdxs[finalIdxs.length - 2]]) / span < nowCollisionThreshold
    ) {
      finalIdxs.splice(finalIdxs.length - 2, 1);
    }

    finalIdxs.forEach(function (idx, pos) {
      var ms = allTicks[idx];
      var isNow = idx === lastIdx;
      var d = new Date(ms);
      var label = document.createElement("span");
      label.className = "player-graph-time-label";
      if (pos === 0) label.classList.add("is-first");
      if (isNow) label.classList.add("is-last", "is-now");
      label.style.left = pctFor(ms) + "%";
      // No time-of-day - "Now · Sep 3", not "Now · Sep 3 1:21 PM" - the
      // extra precision isn't worth how much wider it makes the one label
      // that always has to fit without overlapping its neighbor.
      label.textContent = isNow
        ? T("graph.nowPrefix") + d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : formatAxisTickLabel(d, period);
      axis.appendChild(label);
    });

    return axis;
  }

  // Rating points use their own value scale (roughly 0-900, no natural
  // zero baseline worth showing) instead of the games chart's 0-based
  // count scale, so this pads the start/end of the line with the first/
  // last known rating rather than 0.
  function buildRatingSeriesGeometry(points, minMs, maxMs, width, height, axisMin, axisMax) {
    var usableWidth = width * (1 - GRAPH_END_BUFFER);
    function xFor(ms) {
      return maxMs > minMs ? ((ms - minMs) / (maxMs - minMs)) * usableWidth : 0;
    }
    var range = axisMax - axisMin || 1;
    function yFor(rating) {
      return height - ((rating - axisMin) / range) * height;
    }
    var dots = points.map(function (p) {
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.rating), ts: p.ts, delta: p.delta, rating: p.rating };
    });
    var firstRating = points.length ? points[0].rating : axisMin;
    var lastRating = points.length ? points[points.length - 1].rating : axisMin;
    var allPts = [{ x: xFor(minMs), y: yFor(firstRating) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastRating) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  function appendRatingGraphSeries(svg, points, minMs, maxMs, width, height, axisMin, axisMax, games) {
    var geo = buildRatingSeriesGeometry(points, minMs, maxMs, width, height, axisMin, axisMax);
    var group = svgEl("g", { class: "player-graph-series" });
    group.appendChild(svgEl("path", { d: geo.path, fill: "none", class: "player-rating-graph-line" }));
    geo.dots.forEach(function (pt) {
      group.appendChild(svgEl("circle", { cx: pt.x, cy: pt.y, r: 3.2, class: "player-rating-graph-dot" }));
      var hit = svgEl("circle", { cx: pt.x, cy: pt.y, r: 9, class: "player-graph-dot-hit" });
      hit.addEventListener("click", function (e) {
        e.stopPropagation();
        showRatingDotTooltip(e.clientX, e.clientY, pt, findGameByTs(games, pt.ts));
      });
      group.appendChild(hit);
    });
    svg.appendChild(group);
    return group;
  }

  // A small standalone "rating over time" chart, appended after the main
  // played/won/lost graph — kept separate because ratings (roughly 0-900,
  // no meaningful zero baseline) can't share a Y-axis with game counts.
  function buildRatingGraphSection(name, games, minMs, maxMs, period) {
    var section = document.createElement("div");
    section.className = "player-rating-graph-wrap";

    var heading = document.createElement("h3");
    heading.className = "player-rating-graph-heading";
    heading.textContent = T("common.rating");
    section.appendChild(heading);

    var entry = getPlayerRatingEntry(name);
    var pointsInWindow = entry
      ? entry.history.filter(function (h) {
          var t = new Date(h.ts).getTime();
          return t >= minMs && t <= maxMs;
        })
      : [];

    if (pointsInWindow.length === 0) {
      var hint = document.createElement("p");
      hint.className = "player-graph-empty";
      hint.textContent = T("playerPage.noRatingChangesThisPeriod", { rating: getPlayerRating(name) });
      section.appendChild(hint);
      return section;
    }

    var ratings = pointsInWindow.map(function (h) {
      return h.rating;
    });
    var minRating = Math.min.apply(null, ratings);
    var maxRating = Math.max.apply(null, ratings);
    var pad = Math.max(10, Math.round((maxRating - minRating) * 0.15));
    var axisMin = Math.max(0, Math.floor((minRating - pad) / 10) * 10);
    var axisMax = Math.ceil((maxRating + pad) / 10) * 10;
    if (axisMax <= axisMin) axisMax = axisMin + 20;

    var width = 600;
    var height = 140;

    var chart = document.createElement("div");
    chart.className = "player-graph-chart";

    var yAxis = document.createElement("div");
    yAxis.className = "player-graph-yaxis";
    for (var i = 4; i >= 0; i--) {
      var label = document.createElement("span");
      label.textContent = Math.round(axisMin + ((axisMax - axisMin) * i) / 4);
      yAxis.appendChild(label);
    }
    chart.appendChild(yAxis);

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, class: "player-graph-svg" });
    for (var g = 0; g <= 4; g++) {
      var gy = height - (g / 4) * height;
      svg.appendChild(svgEl("line", { x1: 0, x2: width, y1: gy, y2: gy, class: "player-graph-gridline" }));
    }
    appendRatingGraphSeries(svg, pointsInWindow, minMs, maxMs, width, height, axisMin, axisMax, games);

    chart.appendChild(svg);
    section.appendChild(chart);
    section.appendChild(buildGraphTimeAxis(minMs, maxMs, period));
    return section;
  }

  // sharedAxisMax (optional): when set (the All Players comparison view
  // passes the axis for whichever player there has played the most
  // games), every player's chart uses that SAME y-axis instead of its own
  // - so the line's climb rate is directly comparable card to card.
  // Falls back to this player's own axis (the original behavior) for the
  // single-player stats page, where there's nothing to compare against.
  function buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax) {
    var wrap = document.createElement("div");
    wrap.className = "player-graph-wrap";

    var series = buildCumulativeSeries(stats.games, period);
    var tournamentSeries = buildTournamentCumulativeSeries(stats.tournamentGames || [], period);
    var comboKeys = Object.keys(series.teamCombos).sort();

    var maxCount = 0;
    [
      series.individualPlayed,
      series.individualWon,
      series.individualLost,
      tournamentSeries.played,
      tournamentSeries.won,
      tournamentSeries.lost
    ].forEach(function (arr) {
      if (arr.length) maxCount = Math.max(maxCount, arr[arr.length - 1].count);
    });
    comboKeys.forEach(function (key) {
      var c = series.teamCombos[key];
      if (c.playedCount) maxCount = Math.max(maxCount, c.playedCount);
    });

    if (maxCount === 0) {
      var emptyHint = document.createElement("p");
      emptyHint.className = "player-graph-empty";
      emptyHint.textContent = T("playerPage.noGamesThisPeriod");
      wrap.appendChild(emptyHint);
      wrap.appendChild(buildRatingGraphSection(stats.name, stats.games, minMs, maxMs, period));
      return wrap;
    }

    var axisMax = sharedAxisMax || axisMaxFor(maxCount);
    var width = 600;
    var height = 200;

    var chart = document.createElement("div");
    chart.className = "player-graph-chart";

    var yAxis = document.createElement("div");
    yAxis.className = "player-graph-yaxis";
    for (var i = 4; i >= 0; i--) {
      var label = document.createElement("span");
      label.textContent = Math.round((axisMax * i) / 4);
      yAxis.appendChild(label);
    }
    chart.appendChild(yAxis);

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      class: "player-graph-svg"
    });
    for (var g = 0; g <= 4; g++) {
      var gy = height - (g / 4) * height;
      svg.appendChild(svgEl("line", { x1: 0, x2: width, y1: gy, y2: gy, class: "player-graph-gridline" }));
    }

    var legendItems = [];

    if (series.individualPlayed.length) {
      var indPlayedLabel = T("graph.singleGamesPlayed");
      var gIndPlayed = appendGraphSeries(
        svg,
        series.individualPlayed,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-ind-played",
        "player-graph-dot player-graph-dot-ind-played",
        null,
        false,
        indPlayedLabel
      );
      legendItems.push({ color: "var(--info)", style: "solid", label: indPlayedLabel, group: gIndPlayed });
    }
    if (series.individualWon.length) {
      var indWonLabel = T("graph.singleGamesWon");
      var gIndWon = appendGraphSeries(
        svg,
        series.individualWon,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dotted player-graph-line-ind-won",
        "player-graph-dot player-graph-dot-ind-won",
        null,
        false,
        indWonLabel
      );
      legendItems.push({ color: "var(--accent)", style: "dotted", label: indWonLabel, group: gIndWon });
    }
    if (series.individualLost.length) {
      var indLostLabel = T("graph.singleGamesLost");
      var gIndLost = appendGraphSeries(
        svg,
        series.individualLost,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dashed player-graph-line-ind-lost",
        "player-graph-dot player-graph-dot-ind-lost",
        null,
        true,
        indLostLabel
      );
      legendItems.push({
        color: "var(--danger)",
        style: "dashed",
        label: indLostLabel,
        group: gIndLost,
        startHidden: true
      });
    }

    comboKeys.forEach(function (key, idx) {
      var combo = series.teamCombos[key];
      var color = TEAM_COMBO_PALETTE[idx % TEAM_COMBO_PALETTE.length];
      if (combo.played.length) {
        var comboPlayedLabel = T("graph.comboPlayed", { key: key });
        var gComboPlayed = appendGraphSeries(
          svg,
          combo.played,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line",
          "player-graph-dot",
          color,
          false,
          comboPlayedLabel
        );
        legendItems.push({ color: color, style: "solid", label: comboPlayedLabel, group: gComboPlayed });
      }
      if (combo.won.length) {
        var comboWonLabel = T("graph.comboWon", { key: key });
        var gComboWon = appendGraphSeries(
          svg,
          combo.won,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line player-graph-line-dotted",
          "player-graph-dot",
          color,
          false,
          comboWonLabel
        );
        legendItems.push({ color: color, style: "dotted", label: comboWonLabel, group: gComboWon });
      }
      if (combo.lost.length) {
        var comboLostLabel = T("graph.comboLost", { key: key });
        var gComboLost = appendGraphSeries(
          svg,
          combo.lost,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line player-graph-line-dashed",
          "player-graph-dot",
          color,
          true,
          comboLostLabel
        );
        legendItems.push({
          color: color,
          style: "dashed",
          label: comboLostLabel,
          group: gComboLost,
          startHidden: true
        });
      }
    });

    if (tournamentSeries.played.length) {
      var tournPlayedLabel = T("graph.tournamentsPlayed");
      var gTournPlayed = appendGraphSeries(
        svg,
        tournamentSeries.played,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line",
        "player-graph-dot",
        TOURNAMENT_PLAYED_COLOR,
        false,
        tournPlayedLabel
      );
      legendItems.push({ color: TOURNAMENT_PLAYED_COLOR, style: "solid", label: tournPlayedLabel, group: gTournPlayed });
    }
    if (tournamentSeries.won.length) {
      var tournWonLabel = T("graph.tournamentWins");
      var gTournWon = appendGraphSeries(
        svg,
        tournamentSeries.won,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dotted",
        "player-graph-dot",
        TOURNAMENT_WON_COLOR,
        false,
        tournWonLabel
      );
      legendItems.push({ color: TOURNAMENT_WON_COLOR, style: "dotted", label: tournWonLabel, group: gTournWon });
    }
    if (tournamentSeries.lost.length) {
      var tournLostLabel = T("graph.tournamentLosses");
      var gTournLost = appendGraphSeries(
        svg,
        tournamentSeries.lost,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dashed",
        "player-graph-dot",
        TOURNAMENT_LOST_COLOR,
        false,
        tournLostLabel
      );
      legendItems.push({ color: TOURNAMENT_LOST_COLOR, style: "dashed", label: tournLostLabel, group: gTournLost });
    }

    chart.appendChild(svg);
    wrap.appendChild(chart);
    wrap.appendChild(buildGraphTimeAxis(minMs, maxMs, period));

    var legend = document.createElement("div");
    legend.className = "player-graph-legend";
    legendItems.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "player-graph-legend-row" + (item.startHidden ? " is-off" : "");
      var swatch = document.createElement("span");
      swatch.className = "player-graph-legend-swatch" + (item.style === "solid" ? "" : " is-" + item.style);
      swatch.style.setProperty("--swatch-color", item.color);
      var text = document.createElement("span");
      text.className = "player-graph-legend-label";
      text.textContent = item.label;
      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "player-graph-legend-toggle";
      toggleBtn.textContent = T(item.startHidden ? "common.show" : "common.hide");
      toggleBtn.setAttribute("aria-pressed", item.startHidden ? "false" : "true");
      toggleBtn.addEventListener("click", function () {
        var nowHidden = item.group.classList.toggle("is-hidden");
        row.classList.toggle("is-off", nowHidden);
        toggleBtn.textContent = T(nowHidden ? "common.show" : "common.hide");
        toggleBtn.setAttribute("aria-pressed", nowHidden ? "false" : "true");
      });
      row.appendChild(swatch);
      row.appendChild(toggleBtn);
      row.appendChild(text);
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    wrap.appendChild(buildRatingGraphSection(stats.name, stats.games, minMs, maxMs, period));

    return wrap;
  }

  function buildAllPlayerCard(
    stats,
    sharedAxisMax,
    tournSharedAxisMax,
    minMs,
    maxMs,
    period,
    isInLiveRoster
  ) {
    var li = document.createElement("li");
    li.className = "all-player-card";

    var top = document.createElement("div");
    top.className = "all-player-card-top";
    var name = document.createElement("button");
    name.type = "button";
    name.className = "all-player-name";
    buildPlayerNameLabel(name, stats.name, false);
    name.appendChild(buildRatingBadge(stats.name));
    name.setAttribute("aria-label", "View stats for " + stats.name);
    name.addEventListener("click", function () {
      openPlayerStatsPage(stats.name);
    });
    var nameGroup = document.createElement("div");
    nameGroup.className = "all-player-name-group";
    nameGroup.appendChild(name);
    nameGroup.appendChild(buildPlayerLinkIcon(stats.name));
    var summary = document.createElement("span");
    summary.className = "all-player-summary";
    summary.textContent = stats.winPct === null ? T("allPlayers.noGamesYet") : T("allPlayers.winRate", { pct: Math.round(stats.winPct * 100) });
    top.appendChild(nameGroup);
    top.appendChild(summary);
    li.appendChild(top);

    var ratingDeltaText = formatRatingPeriodDelta(stats.name, period);
    if (ratingDeltaText !== null) {
      var ratingStatus = document.createElement("div");
      ratingStatus.className = "all-player-rating-status";
      if (ratingDeltaText.charAt(0) === "▲") ratingStatus.classList.add("is-up");
      else if (ratingDeltaText.charAt(0) === "▼") ratingStatus.classList.add("is-down");
      ratingStatus.textContent = T("allPlayers.ratingThisPeriod", { delta: ratingDeltaText });
      li.appendChild(ratingStatus);
    }

    if (allPlayersViewMode === "graph") {
      if (isInLiveRoster) {
        li.appendChild(buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax));
      } else {
        var graphHolder = document.createElement("div");
        graphHolder.className = "all-player-graph-holder hidden";
        var showGraphBtn = document.createElement("button");
        showGraphBtn.type = "button";
        showGraphBtn.className = "btn btn-ghost all-player-show-graph-btn";
        showGraphBtn.textContent = T("allPlayers.showGraph");
        showGraphBtn.addEventListener("click", function () {
          if (!graphHolder.hasChildNodes()) {
            graphHolder.appendChild(buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax));
          }
          var nowHidden = graphHolder.classList.toggle("hidden");
          showGraphBtn.textContent = T(nowHidden ? "allPlayers.showGraph" : "allPlayers.hideGraph");
        });
        li.appendChild(showGraphBtn);
        li.appendChild(graphHolder);
      }
    } else {
      // Played/won/lost share one scale (played's, since played >= won +
      // lost for any one player) so equal counts always draw equal bar
      // lengths and different players' bars stay directly comparable -
      // same for the tournament trio below.
      li.appendChild(buildScaleRow(T("allPlayers.gamesPlayed"), stats.played, sharedAxisMax, "scale-fill-played"));
      li.appendChild(buildScaleRow(T("allPlayers.gamesWon"), stats.wins, sharedAxisMax, "scale-fill-won"));
      li.appendChild(buildScaleRow(T("allPlayers.gamesLost"), stats.losses, sharedAxisMax, "scale-fill-lost"));
      if (stats.tournamentPlayed > 0) {
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsPlayed"), stats.tournamentPlayed, tournSharedAxisMax, "scale-fill-tourn-played"));
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsWon"), stats.tournamentWins, tournSharedAxisMax, "scale-fill-tourn-won"));
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsLost"), stats.tournamentLosses, tournSharedAxisMax, "scale-fill-tourn-lost"));
      }

      if (stats.games.length) {
        li.appendChild(buildTimelineRow(stats.games, minMs, maxMs));
      }
    }

    return li;
  }

  function renderAllPlayersPage() {
    var period = allPlayersPeriodSelect.value;
    var names = getAllKnownPlayerNames();
    if (allPlayersRosterOnly) {
      var rosterNames = {};
      state.players.forEach(function (p) {
        rosterNames[p.name] = true;
      });
      names = names.filter(function (n) {
        return rosterNames[n];
      });
    }
    var stats = names.map(function (name) {
      return computePlayerCareerStats(name, period);
    });

    // The player with the most games played (maxPlayed) sets the shared
    // scale for every played/won/lost bar AND every graph's y-axis, for
    // every player shown - so equal counts always look equal and one
    // player's chart can be read against another's, instead of each
    // player silently rescaling to their own numbers. Same idea for the
    // tournament trio, off tournaments played.
    var maxPlayed = 0;
    var maxTournPlayed = 0;
    var minTs = null;
    stats.forEach(function (s) {
      maxPlayed = Math.max(maxPlayed, s.played);
      maxTournPlayed = Math.max(maxTournPlayed, s.tournamentPlayed);
      s.games.forEach(function (g) {
        if (!g.ts) return;
        if (minTs === null || g.ts < minTs) minTs = g.ts;
      });
    });

    // For a fixed period (today/week/month/6month/year), anchor the timeline
    // to that period's actual calendar span — start of the period through
    // right now — rather than just the span of games that happen to exist,
    // so "This Month" always shows the whole month, not just wherever the
    // first and last game happened to fall. "All Time" has no natural fixed
    // span, so it keeps following the actual data.
    var periodStart = periodStartDate(period);
    var minMs, maxMs;
    if (periodStart) {
      minMs = periodStart.getTime();
    } else {
      // "All Time" has no natural fixed start, so it keeps following the
      // earliest actual game.
      minMs = minTs === null ? Date.now() : new Date(minTs).getTime();
    }
    // The end of the axis is always "right now" — the moment the graph was
    // requested — for every period, All Time included, so the "Now" tick
    // and label are never stale.
    maxMs = Date.now();
    if (maxMs <= minMs) maxMs = minMs + 1;

    var playedAxisMax = axisMaxFor(maxPlayed);
    var tournPlayedAxisMax = axisMaxFor(maxTournPlayed);

    var sorted = sortAllPlayerStats(stats, allPlayersSortSelect.value);

    var liveRosterNames = {};
    state.players.forEach(function (p) {
      liveRosterNames[p.name] = true;
    });

    allPlayersList.innerHTML = "";
    if (sorted.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = allPlayersRosterOnly
        ? T("allPlayers.noPlayersRosterOnly")
        : T("allPlayers.noPlayersYet");
      allPlayersList.appendChild(hint);
      return;
    }
    sorted.forEach(function (s) {
      allPlayersList.appendChild(
        buildAllPlayerCard(
          s,
          playedAxisMax,
          tournPlayedAxisMax,
          minMs,
          maxMs,
          period,
          !!liveRosterNames[s.name]
        )
      );
    });
  }

  // Mirrors exactly what's currently on screen (same sort, period, and
  // roster-only filter as renderAllPlayersPage) as a real spreadsheet
  // table - one row per player, career totals rather than the graph view.
  function buildAllPlayersCsv() {
    var period = allPlayersPeriodSelect.value;
    var names = getAllKnownPlayerNames();
    if (allPlayersRosterOnly) {
      var rosterNames = {};
      state.players.forEach(function (p) {
        rosterNames[p.name] = true;
      });
      names = names.filter(function (n) {
        return rosterNames[n];
      });
    }
    var stats = names.map(function (name) {
      return computePlayerCareerStats(name, period);
    });
    var sorted = sortAllPlayerStats(stats, allPlayersSortSelect.value);

    var lines = [];
    lines.push(csvRow(["Pool Master Counter — All Players", T(ALL_PLAYERS_PERIOD_LABEL_KEYS[period] || "period.allTime")]));
    lines.push("\r\n");

    lines.push(
      csvRow([
        "Player",
        "Rating",
        "Played",
        "Wins",
        "Losses",
        "Win %",
        "Tournaments Played",
        "Tournaments Won",
        "Tournaments Lost"
      ])
    );
    sorted.forEach(function (s) {
      lines.push(
        csvRow([
          s.name,
          getPlayerRating(s.name),
          s.played,
          s.wins,
          s.losses,
          s.winPct === null ? "" : Math.round(s.winPct * 100) + "%",
          s.tournamentPlayed,
          s.tournamentWins,
          s.tournamentLosses
        ])
      );
    });

    return "\uFEFF" + lines.join("");
  }

  function openAllPlayersPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("all-players");
    renderAllPlayersPage();
    appRoot.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    contactSheetPageView.classList.add("hidden");
    leaderboardPageView.classList.add("hidden");
    allPlayersPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeAllPlayersPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    allPlayersPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  // ---------------------------------------------------------------------
  // Contact Sheet — every known player's real name, nickname, email and
  // phone in one editable list, with per-row checkboxes for firing off a
  // single group email or text to whichever subset is selected.
  // ---------------------------------------------------------------------

  // Real names only (a nickname is a display-time overlay, not a second
  // identity) - anyone with saved stats/ratings, anyone on the live
  // roster, and anyone with contact info already on file, so removing a
  // player from the roster doesn't drop their contact details off this
  // page.
  function contactSheetAllNames() {
    var map = {};
    getAllKnownPlayerNames().forEach(function (n) {
      map[normalizeNameKey(n)] = n;
    });
    Object.keys(PLAYER_CONTACTS).forEach(function (n) {
      var key = normalizeNameKey(n);
      if (!map[key]) map[key] = n;
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return a.localeCompare(b);
      });
  }

  // Adds a blank contact record for anyone who only ever shows up in an
  // old saved player list (never actually got a game logged, and nobody
  // has entered contact info for them yet) - so they show up here to
  // fill in. Never touches a name that already has a contact record,
  // whatever its age, since a roster carries nothing (just a name) that
  // could ever be "newer" than real contact info already on file.
  function importRosterNamesIntoContacts() {
    var added = 0;
    SAVED_ROSTERS.forEach(function (r) {
      (r.players || []).forEach(function (n) {
        if (!findContactKey(n)) {
          setPlayerContact(n, {});
          added += 1;
        }
      });
    });
    renderContactSheetPage();
    showToast(T("contactSheet.importedToast", { count: added }));
  }

  function updateContactSheetSelectedSummary() {
    var names = Object.keys(contactSheetSelected).filter(function (n) {
      return contactSheetSelected[n];
    });
    contactSheetSelectedSummary.textContent = T("contactSheet.selectedCount", { count: names.length });
  }

  function contactSheetFieldWrap(labelKey, input) {
    var label = document.createElement("label");
    var span = document.createElement("span");
    span.textContent = T(labelKey);
    label.appendChild(span);
    label.appendChild(input);
    return label;
  }

  function contactSheetRow(name) {
    var li = document.createElement("li");
    li.className = "contact-sheet-row";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!contactSheetSelected[name];
    checkbox.setAttribute("aria-label", T("contactSheet.selectPlayer", { name: name }));
    checkbox.addEventListener("change", function () {
      if (checkbox.checked) contactSheetSelected[name] = true;
      else delete contactSheetSelected[name];
      updateContactSheetSelectedSummary();
    });
    li.appendChild(checkbox);

    var fields = document.createElement("div");
    fields.className = "contact-sheet-fields";
    var contact = getPlayerContact(name);

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = name;
    nameInput.addEventListener("change", function () {
      var newName = nameInput.value;
      var error = renamePlayerEverywhere(name, newName);
      if (error) {
        showToast(error);
        nameInput.value = name;
        return;
      }
      if (contactSheetSelected[name]) {
        delete contactSheetSelected[name];
        contactSheetSelected[resolvePlayerName(newName)] = true;
      }
      renderContactSheetPage();
      renderAll();
    });
    fields.appendChild(contactSheetFieldWrap("contactSheet.name", nameInput));

    var nicknameInput = document.createElement("input");
    nicknameInput.type = "text";
    nicknameInput.value = contact.nickname || "";
    nicknameInput.placeholder = T("contactSheet.nicknamePlaceholder");
    nicknameInput.addEventListener("change", function () {
      setPlayerContact(name, { nickname: nicknameInput.value.trim() });
      renderAll();
    });
    fields.appendChild(contactSheetFieldWrap("contactSheet.nickname", nicknameInput));

    var emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.value = contact.email || "";
    emailInput.placeholder = T("onboarding.emailPlaceholder");
    var checkEmailValidity = wireFieldValidity(emailInput, isValidEmail);
    emailInput.addEventListener("change", function () {
      if (!checkEmailValidity()) {
        showToast(T("contactSheet.invalidEmail"));
        emailInput.value = contact.email || "";
        checkEmailValidity();
        return;
      }
      setPlayerContact(name, { email: emailInput.value.trim() });
    });
    fields.appendChild(contactSheetFieldWrap("contactSheet.email", emailInput));

    var phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.value = formatPhoneNumberForActiveLanguage(contact.phone || "");
    phoneInput.placeholder = T("onboarding.phonePlaceholder");
    wirePhoneFormatting(phoneInput);
    var checkPhoneValidity = wireFieldValidity(phoneInput, isValidPhoneNumber);
    phoneInput.addEventListener("change", function () {
      if (!checkPhoneValidity()) {
        showToast(T("contactSheet.invalidPhone"));
        phoneInput.value = formatPhoneNumberForActiveLanguage(contact.phone || "");
        checkPhoneValidity();
        return;
      }
      setPlayerContact(name, { phone: phoneInput.value.trim() });
    });
    fields.appendChild(contactSheetFieldWrap("contactSheet.phone", phoneInput));

    li.appendChild(fields);
    li.appendChild(buildPlayerLinkIcon(name));
    return li;
  }

  function renderContactSheetPage() {
    var names = contactSheetAllNames();
    // Drop selections for anyone no longer in the list (e.g. after a
    // rename folds two rows into one).
    Object.keys(contactSheetSelected).forEach(function (n) {
      if (names.indexOf(n) === -1) delete contactSheetSelected[n];
    });
    contactSheetList.innerHTML = "";
    if (names.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("contactSheet.noPlayersYet");
      contactSheetList.appendChild(hint);
    } else {
      names.forEach(function (n) {
        contactSheetList.appendChild(contactSheetRow(n));
      });
    }
    updateContactSheetSelectedSummary();
  }

  function openContactSheetPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("contact-sheet");
    renderContactSheetPage();
    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    leaderboardPageView.classList.add("hidden");
    contactSheetPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeContactSheetPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    contactSheetPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  var LEADERBOARD_MIN_GAMES = 10;
  var LEADERBOARD_LAST_SHOWN_KEY = "poolMasterCounter.leaderboardLastShown.v1";
  var LEADERBOARD_AUTO_SHOW_MS = 12 * 60 * 60 * 1000;
  // Points per tournament win - deliberately large relative to the other
  // terms (a rating swing of a full 100 points is only +5) so tournament
  // success is a genuinely heavy factor, not a tiebreaker.
  var LEADERBOARD_TOURNAMENT_WIN_WEIGHT = 6;
  // Points per average ball left on the table across a player's wins -
  // rewards winning by a wide margin (opponent barely got started), not
  // just winning. Games where this was never recorded don't count for
  // or against anyone (see averageBallsLeftOnWins).
  var LEADERBOARD_DOMINANCE_WEIGHT = 1.5;

  // Only wins where the balls-left-on-table stepper (see
  // persistBallsLeftLive) was actually used contribute - most win
  // objects won't have it set, and treating an unset value as 0 would
  // wrongly punish players (or games/eras) that never touched that
  // control instead of just excluding them from this factor.
  function averageBallsLeftOnWins(games) {
    var vals = [];
    games.forEach(function (g) {
      if (g.result === "won" && typeof g.ballsLeftOnTable === "number") {
        vals.push(g.ballsLeftOnTable);
      }
    });
    if (!vals.length) return 0;
    var sum = vals.reduce(function (a, b) {
      return a + b;
    }, 0);
    return sum / vals.length;
  }

  // A regularized win rate (so a 2-0 newcomer can't outrank a proven
  // 40-10 veteran - the +LEADERBOARD_MIN_GAMES in the denominator acts
  // like assuming everyone starts with that many "neutral" games), a
  // heavily-weighted tournament-win bonus, a rating component, a bonus
  // for winning by wide margins, and a log-scaled activity bonus that
  // rewards playing more without letting raw volume alone swamp the win
  // rate. Returns every term separately (not just the total) so
  // explainLeaderboardRanking can point at exactly which ones decided a
  // given pair's order.
  function computeLeaderboardScoreBreakdown(entry) {
    var winRateTerm = (entry.wins / (entry.gamesPlayed + LEADERBOARD_MIN_GAMES)) * 100;
    var tournamentTerm = entry.tournamentWins * LEADERBOARD_TOURNAMENT_WIN_WEIGHT;
    var ratingTerm = entry.rating / 20;
    var dominanceTerm = entry.avgBallsLeftOnWins * LEADERBOARD_DOMINANCE_WEIGHT;
    var activityTerm = Math.log2(entry.gamesPlayed) * 2;
    return {
      winRateTerm: winRateTerm,
      tournamentTerm: tournamentTerm,
      ratingTerm: ratingTerm,
      dominanceTerm: dominanceTerm,
      activityTerm: activityTerm,
      total: winRateTerm + tournamentTerm + ratingTerm + dominanceTerm + activityTerm
    };
  }

  function computeLeaderboardEntries() {
    var entries = getAllKnownPlayerNames()
      .map(function (name) {
        var stats = computePlayerCareerStats(name, "all");
        var gamesPlayed = stats.played + stats.tournamentPlayed;
        var wins = stats.wins + stats.tournamentWins;
        return {
          name: name,
          gamesPlayed: gamesPlayed,
          wins: wins,
          winPct: gamesPlayed ? wins / gamesPlayed : 0,
          rating: getPlayerRating(name),
          tournamentWins: stats.tournamentWins,
          avgBallsLeftOnWins: averageBallsLeftOnWins(stats.games.concat(stats.tournamentGames))
        };
      })
      .filter(function (e) {
        return e.gamesPlayed >= LEADERBOARD_MIN_GAMES;
      });
    entries.forEach(function (e) {
      e.scoreBreakdown = computeLeaderboardScoreBreakdown(e);
      e.mvpScore = e.scoreBreakdown.total;
    });
    entries.sort(function (a, b) {
      return b.mvpScore - a.mvpScore;
    });
    return entries;
  }

  // Which of {a, b} the given score-breakdown term favors, and by how
  // much - the raw building block explainLeaderboardRanking sorts on to
  // decide which reasons are worth mentioning at all.
  function leaderboardReasonCategories(a, b) {
    return [
      {
        delta: a.scoreBreakdown.winRateTerm - b.scoreBreakdown.winRateTerm,
        describe: function (leader, other) {
          return T("leaderboard.reasonWinRate", {
            leader: leader.name,
            leaderVal: Math.round(leader.winPct * 100) + "%",
            otherVal: Math.round(other.winPct * 100) + "%"
          });
        }
      },
      {
        delta: a.scoreBreakdown.tournamentTerm - b.scoreBreakdown.tournamentTerm,
        describe: function (leader, other) {
          return T("leaderboard.reasonTournament", {
            leader: leader.name,
            leaderVal: leader.tournamentWins,
            otherVal: other.tournamentWins
          });
        }
      },
      {
        delta: a.scoreBreakdown.ratingTerm - b.scoreBreakdown.ratingTerm,
        describe: function (leader, other) {
          return T("leaderboard.reasonRating", {
            leader: leader.name,
            leaderVal: leader.rating,
            otherVal: other.rating
          });
        }
      },
      {
        delta: a.scoreBreakdown.dominanceTerm - b.scoreBreakdown.dominanceTerm,
        describe: function (leader, other) {
          return T("leaderboard.reasonDominance", {
            leader: leader.name,
            leaderVal: leader.avgBallsLeftOnWins.toFixed(1),
            otherVal: other.avgBallsLeftOnWins.toFixed(1)
          });
        }
      },
      {
        delta: a.scoreBreakdown.activityTerm - b.scoreBreakdown.activityTerm,
        describe: function (leader, other) {
          return T("leaderboard.reasonActivity", {
            leader: leader.name,
            leaderVal: leader.gamesPlayed,
            otherVal: other.gamesPlayed
          });
        }
      }
    ];
  }

  // Plain-language explanation of why `a` (the higher-ranked of the
  // pair) outranks `b` overall, e.g. explaining rank 1 vs rank 2. Opens
  // with the actual point totals so the winner is never in doubt, then
  // every factor that moved the needle either way - each with its own
  // point value - so it's obvious not just THAT the reasons favoring
  // `a` outweigh the ones favoring `b`, but by how much. A tiny
  // per-category threshold (not 0 outright) only filters out true
  // floating-point noise from an exact tie, never a real difference.
  function explainLeaderboardRanking(a, b) {
    var categories = leaderboardReasonCategories(a, b);
    var supporting = [];
    var against = [];
    categories.forEach(function (cat) {
      if (Math.abs(cat.delta) < 0.01) return;
      var favorsA = cat.delta > 0;
      var leader = favorsA ? a : b;
      var other = favorsA ? b : a;
      var line = cat.describe(leader, other) + " " + T("leaderboard.reasonPoints", { points: Math.abs(cat.delta).toFixed(1) });
      (favorsA ? supporting : against).push({ weight: Math.abs(cat.delta), line: line });
    });
    supporting.sort(function (x, y) {
      return y.weight - x.weight;
    });
    against.sort(function (x, y) {
      return y.weight - x.weight;
    });

    var lines = [
      T("leaderboard.explainVerdict", {
        a: a.name,
        scoreA: a.mvpScore.toFixed(1),
        b: b.name,
        scoreB: b.mvpScore.toFixed(1)
      })
    ];

    if (supporting.length === 0 && against.length === 0) {
      lines.push("");
      lines.push(T("leaderboard.explainClose", { a: a.name, b: b.name }));
      return lines.join("\n");
    }

    lines.push("");
    lines.push(T("leaderboard.explainIntro", { a: a.name, b: b.name }));
    supporting.forEach(function (s) {
      lines.push("• " + s.line);
    });
    if (supporting.length === 0) {
      lines.push(T("leaderboard.explainNoSingleReason"));
    }

    if (against.length > 0) {
      lines.push("");
      lines.push(T("leaderboard.explainDespite", { a: a.name, b: b.name }));
      against.forEach(function (s) {
        lines.push("• " + s.line);
      });
    }
    return lines.join("\n");
  }

  var LEADERBOARD_RANK_MEDALS = ["🥇", "🥈", "🥉"];

  function leaderboardRow(entry, rank, entries) {
    var li = document.createElement("li");
    li.className = "leaderboard-row leaderboard-rank-" + rank;
    if (rank <= 2) li.classList.add("leaderboard-row-top");

    var rankEl = document.createElement("div");
    rankEl.className = "leaderboard-rank";
    rankEl.textContent = LEADERBOARD_RANK_MEDALS[rank - 1] || "#" + rank;
    li.appendChild(rankEl);

    var body = document.createElement("div");
    body.className = "leaderboard-row-body";

    var nameRow = document.createElement("div");
    nameRow.className = "leaderboard-name-row";

    var nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "leaderboard-name-btn";
    nameBtn.textContent = entry.name;
    if (rank === 1) {
      var mvpTag = document.createElement("span");
      mvpTag.className = "leaderboard-mvp-tag";
      mvpTag.textContent = T("leaderboard.mvp");
      nameBtn.appendChild(mvpTag);
    }
    nameBtn.addEventListener("click", function () {
      openPlayerStatsPage(entry.name);
    });
    nameRow.appendChild(nameBtn);

    // Rank 1 explains itself against rank 2 (the concrete "why did #1
    // beat #2" case); everyone else explains themselves against whoever
    // is directly above them in the list.
    var comparisonOther = rank === 1 ? entries[1] : entries[rank - 2];
    if (comparisonOther) {
      var explainBtn = document.createElement("button");
      explainBtn.type = "button";
      explainBtn.className = "leaderboard-explain-btn";
      explainBtn.textContent = "❓";
      explainBtn.setAttribute("aria-label", T("leaderboard.explainAria", { name: entry.name }));
      explainBtn.addEventListener("click", function () {
        var higher = rank === 1 ? entry : comparisonOther;
        var lower = rank === 1 ? comparisonOther : entry;
        alertModal(explainLeaderboardRanking(higher, lower));
      });
      nameRow.appendChild(explainBtn);
    }
    body.appendChild(nameRow);

    var stats = document.createElement("div");
    stats.className = "leaderboard-row-stats";
    var statParts = [
      T("leaderboard.statWins", { wins: entry.wins }),
      T("leaderboard.statGames", { games: entry.gamesPlayed }),
      T("leaderboard.statWinPct", { pct: Math.round(entry.winPct * 100) })
    ];
    if (entry.tournamentWins > 0) {
      statParts.push(T("leaderboard.statTournamentWins", { wins: entry.tournamentWins }));
    }
    if (entry.avgBallsLeftOnWins > 0) {
      statParts.push(T("leaderboard.statDominance", { balls: entry.avgBallsLeftOnWins.toFixed(1) }));
    }
    statParts.push(T("leaderboard.statRating", { rating: entry.rating }));
    stats.textContent = statParts.join(" • ");
    body.appendChild(stats);

    li.appendChild(body);
    return li;
  }

  function renderLeaderboardPage() {
    var entries = computeLeaderboardEntries();
    leaderboardList.innerHTML = "";
    if (entries.length === 0) {
      leaderboardList.classList.add("hidden");
      leaderboardEmptyHint.classList.remove("hidden");
    } else {
      leaderboardList.classList.remove("hidden");
      leaderboardEmptyHint.classList.add("hidden");
      entries.forEach(function (entry, i) {
        leaderboardList.appendChild(leaderboardRow(entry, i + 1, entries));
      });
    }
    leaderboardFormulaNote.textContent = T("leaderboard.formulaNote", {
      minGames: LEADERBOARD_MIN_GAMES,
      tournamentWeight: LEADERBOARD_TOURNAMENT_WIN_WEIGHT,
      dominanceWeight: LEADERBOARD_DOMINANCE_WEIGHT
    });
  }

  function openLeaderboardPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("leaderboard");
    renderLeaderboardPage();
    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    contactSheetPageView.classList.add("hidden");
    leaderboardPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
    localStorage.setItem(LEADERBOARD_LAST_SHOWN_KEY, String(Date.now()));
  }

  function closeLeaderboardPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    leaderboardPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  function maybeAutoShowLeaderboard() {
    // Only interrupt the main screen - never pop the leaderboard over a
    // page the player is already actively using (mid-tournament, editing
    // contacts, etc.).
    if (appRoot.classList.contains("hidden")) return;
    var lastShown = parseInt(localStorage.getItem(LEADERBOARD_LAST_SHOWN_KEY) || "0", 10);
    if (Date.now() - lastShown < LEADERBOARD_AUTO_SHOW_MS) return;
    if (computeLeaderboardEntries().length === 0) return;
    openLeaderboardPage();
  }

  // Builds a mailto:/sms: compose link for whichever selected contacts
  // actually have that channel filled in - not blocking on anyone
  // selected who doesn't, since some of the group missing a phone
  // number shouldn't stop texting the ones who have one, but naming
  // exactly who got left out instead of silently dropping them, so a
  // shorter-than-expected group is never a surprise.
  //
  // SMS specifically also copies the full number list to the clipboard
  // before opening Messages: `sms:` with several comma-separated
  // recipients is genuinely unreliable handed off from a WKWebView (an
  // iOS/WKWebView quirk, not something fixable in the URL itself) - it
  // often only pre-fills the first one or two. The copied list is the
  // fallback for pasting in the rest by hand when that happens. mailto:
  // doesn't have this problem (every mail client handles a real
  // comma-separated recipient list correctly), so email skips it.
  function composeToSelectedContacts(method) {
    var names = Object.keys(contactSheetSelected).filter(function (n) {
      return contactSheetSelected[n];
    });
    var withChannel = names.filter(function (n) {
      var c = getPlayerContact(n);
      return method === "sms" ? !!c.phone : !!c.email;
    });
    var skipped = names.filter(function (n) {
      return withChannel.indexOf(n) === -1;
    });
    if (!withChannel.length) {
      showToast(T(method === "sms" ? "contactSheet.noPhonesSelected" : "contactSheet.noEmailsSelected"));
      return;
    }
    var toastParts = [];
    if (skipped.length) {
      toastParts.push(T(method === "sms" ? "contactSheet.skippedNoPhone" : "contactSheet.skippedNoEmail", { names: skipped.join(", ") }));
    }
    if (method === "sms") {
      var rawNumbers = withChannel
        .map(function (n) {
          return getPlayerContact(n).phone;
        })
        .join(", ");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(rawNumbers);
      }
      toastParts.push(T("contactSheet.smsNumbersCopied"));
    }
    if (toastParts.length) showToast(toastParts.join(" "));
    var to = withChannel
      .map(function (n) {
        var c = getPlayerContact(n);
        return encodeURIComponent(method === "sms" ? c.phone : c.email);
      })
      .join(",");
    window.location.href = (method === "sms" ? "sms:" : "mailto:") + to;
  }

  // Flexible parser for a contacts JSON import: accepts our own export
  // shape (name -> {email, phone, nickname, ...}, as produced by
  // exportContactsToJson) or a plain array of {name, email, phone,
  // nickname} objects (easier to hand-write or produce from another
  // source) - whichever one a given file turns out to be.
  function normalizeImportedContactsPayload(data) {
    var result = {};
    if (Array.isArray(data)) {
      data.forEach(function (entry) {
        if (!entry || typeof entry !== "object" || !entry.name) return;
        var name = capitalizeName(String(entry.name).trim());
        if (!name) return;
        result[name] = {
          email: entry.email || "",
          phone: entry.phone || "",
          nickname: entry.nickname || "",
          reportOptIn: !!entry.reportOptIn,
          notifyMethod: entry.notifyMethod || "email",
          updatedAt: entry.updatedAt || 0
        };
      });
    } else if (data && typeof data === "object") {
      Object.keys(data).forEach(function (rawName) {
        var entry = data[rawName];
        if (!entry || typeof entry !== "object") return;
        var name = capitalizeName(String(rawName).trim());
        if (!name) return;
        result[name] = {
          email: entry.email || "",
          phone: entry.phone || "",
          nickname: entry.nickname || "",
          reportOptIn: !!entry.reportOptIn,
          notifyMethod: entry.notifyMethod || "email",
          updatedAt: entry.updatedAt || 0
        };
      });
    }
    return result;
  }

  // Reads a user-picked JSON file and merges it into PLAYER_CONTACTS via
  // the same recency-aware mergeContactsData used for a full-backup
  // restore, so an import from a file follows the exact same "whichever
  // side was actually edited more recently wins" rule - an imported
  // record with no updatedAt of its own (e.g. hand-written) counts as
  // timestamp 0, so it only fills in names this device doesn't already
  // have real contact info for.
  function importContactsJsonFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      var imported = normalizeImportedContactsPayload(data);
      var importedCount = Object.keys(imported).length;
      if (!importedCount) {
        alertModal(T("contactSheet.noValidContactsInFile"));
        return;
      }
      var before = Object.keys(PLAYER_CONTACTS).length;
      PLAYER_CONTACTS = mergeContactsData(PLAYER_CONTACTS, imported);
      saveContactsToStorage(PLAYER_CONTACTS);
      var added = Object.keys(PLAYER_CONTACTS).length - before;
      renderContactSheetPage();
      showToast(T("contactSheet.importedJsonToast", { count: importedCount, added: added }));
    };
    reader.onerror = function () {
      alertModal(T("alert.notValidJson"));
    };
    reader.readAsText(file);
  }

  // A friendly, hand-editable export mirroring exportRosterLists - the
  // exact shape normalizeImportedContactsPayload reads back in, so
  // exporting from one device and importing on another round-trips
  // losslessly (recency stamps included, so a re-import later resolves
  // conflicts exactly like a real merge would).
  function exportContactsToJson() {
    downloadJSON("pool-master-counter-contacts-" + todayDateStr() + ".json", PLAYER_CONTACTS);
  }

  // Escapes the characters vCard (RFC 6350) requires escaped inside a
  // field value - backslash first, so it doesn't double-escape the ones
  // added right after it.
  function vCardEscape(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  // Builds one multi-contact .vcf (vCard 3.0) file from every given
  // name that has at least an email or phone - the standard format
  // iOS/macOS Contacts, Google Contacts, Outlook, etc. all know how to
  // import directly, either via the "Add to Contacts" option in the
  // share sheet this gets handed to, or by opening the saved file.
  function buildVCard(names) {
    return names
      .map(function (name) {
        var c = getPlayerContact(name);
        var lines = ["BEGIN:VCARD", "VERSION:3.0", "FN:" + vCardEscape(name), "N:" + vCardEscape(name) + ";;;;"];
        if (c.nickname) lines.push("NICKNAME:" + vCardEscape(c.nickname));
        if (c.email) lines.push("EMAIL;TYPE=INTERNET:" + vCardEscape(c.email));
        if (c.phone) lines.push("TEL;TYPE=CELL:" + vCardEscape(c.phone));
        lines.push("NOTE:Pool Master Counter player");
        lines.push("END:VCARD");
        return lines.join("\r\n");
      })
      .join("\r\n");
  }

  // Exports the selected players (or, with nothing checked, every known
  // player who has an email or phone on file) as a vCard, handed to the
  // OS share sheet so "Add to Contacts" is one tap away - falls back to
  // a plain file download (still a real, importable .vcf) wherever the
  // Web Share API file support isn't there.
  function exportSelectedToAddressBook() {
    var selected = Object.keys(contactSheetSelected).filter(function (n) {
      return contactSheetSelected[n];
    });
    var names = (selected.length ? selected : contactSheetAllNames()).filter(function (n) {
      var c = getPlayerContact(n);
      return !!(c.email || c.phone);
    });
    if (!names.length) {
      showToast(T("contactSheet.noContactsToExport"));
      return;
    }
    var file = new File([buildVCard(names)], "pool-master-counter-contacts.vcf", { type: "text/vcard" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: T("contactSheet.exportAddressBook") }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        downloadFileObject(file);
      });
    } else {
      downloadFileObject(file);
    }
  }

  // ---------------------------------------------------------------------
  // Elimination Tournament — double-elimination bracket.
  //
  // Reuses the same game type / target / "race to N wins" idea as the main
  // scoreboard for each individual match, and records every rack win into
  // the shared state.gameHistory (so it counts toward player stats and the
  // All Players graphs) — but keeps its own bracket state completely
  // separate from the main session. state.playerWins, rotation, teams and
  // milestone overlays are all main-session-only and untouched here.
  // ---------------------------------------------------------------------

  var TOURNAMENT_KEY = "poolMasterCounter.tournament.v1";

  // lbWaiting used to be a plain array of names; it's now { name, feeder }
  // entries so the losers bracket can carry feeder-match links through a
  // save/reload. A tournament already in progress from before that change
  // would otherwise resume with plain strings and break every .name/
  // .feeder access below - normalized back into shape here, feeder-less
  // (same as any entry that's always had no feeder to speak of).
  function normalizeLoadedTournament(t) {
    if (t && Array.isArray(t.lbWaiting)) {
      t.lbWaiting = t.lbWaiting.map(function (entry) {
        return typeof entry === "string" ? { name: entry, feeder: null } : entry;
      });
    }
    if (t && typeof t.tableCount !== "number") t.tableCount = 1;
    // Pre-multi-table saves have a single t.active object instead of
    // t.activeMatches - fold it in as table 1's entry rather than
    // losing an in-progress match's live score on the first load after
    // this update.
    if (t && t.active && !Array.isArray(t.activeMatches)) {
      t.active.table = t.active.table || 1;
      t.activeMatches = [t.active];
    }
    if (t && !Array.isArray(t.activeMatches)) t.activeMatches = [];
    if (t && t.active !== undefined) delete t.active;
    if (t && typeof t.focusedTable !== "number" && t.activeMatches.length) t.focusedTable = t.activeMatches[0].table;
    return t;
  }

  function loadTournamentFromStorage() {
    try {
      var raw = localStorage.getItem(TOURNAMENT_KEY);
      return raw ? normalizeLoadedTournament(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  function saveTournamentToStorage(t) {
    try {
      if (t) localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOURNAMENT_KEY);
    } catch (e) {
      console.warn("Could not save tournament.", e);
    }
  }

  var TOURNAMENT = loadTournamentFromStorage();

  // History of finished brackets — separate from TOURNAMENT (the single
  // live/in-progress bracket, overwritten on every "Start New Tournament")
  // so a player's graph can show whole-tournament wins/losses over time,
  // distinct from the individual rack wins/losses already recorded via
  // recordTournamentRackWin into state.gameHistory.
  var TOURNAMENT_RESULTS_KEY = "poolMasterCounter.tournamentResults.v1";

  function loadTournamentResultsFromStorage() {
    try {
      var raw = localStorage.getItem(TOURNAMENT_RESULTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveTournamentResultsToStorage(list) {
    try {
      localStorage.setItem(TOURNAMENT_RESULTS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Could not save tournament results.", e);
    }
  }

  var TOURNAMENT_RESULTS = loadTournamentResultsFromStorage();

  // Called once, right when a bracket's champion is first decided — records
  // a win for the champion and a loss for every other entrant. Skipped
  // under noStatsMode, same as every other persistence path.
  // t.players/t.championNames hold bracket ENTRANT labels (a team's label
  // for a team entrant) - flattened here into real member names via
  // entrantMembers before storing, so a player who only ever entered via
  // a team still shows up (and shows the right won/lost result) in their
  // own tournamentGamesForPlayerName history below. entrantMembers itself
  // is also stored, so that function can tell a player's own teammates
  // apart from real opponents.
  function recordTournamentCompletion(t) {
    if (noStatsMode) return;
    var entrantMembers = t.entrantMembers || {};
    function flattenEntrants(labels) {
      var out = [];
      (labels || []).forEach(function (label) {
        (entrantMembers[label] || [label]).forEach(function (name) {
          out.push(name);
        });
      });
      return out;
    }
    var ts = new Date().toISOString();
    TOURNAMENT_RESULTS.unshift({
      ts: ts,
      // Round Robin can end in a tie shared by more than one champion;
      // t.championNames already holds all of them there. Bracket formats
      // only ever have a single winner.
      championNames: flattenEntrants(t.championNames || [t.champion]),
      format: t.format,
      players: flattenEntrants(t.players),
      entrantMembers: entrantMembers
    });
    if (TOURNAMENT_RESULTS.length > 200) TOURNAMENT_RESULTS.length = 200;
    saveTournamentResultsToStorage(TOURNAMENT_RESULTS);
  }

  // A "race to N wins" main-scoreboard session counts as a Tournament too
  // (per how this app's players use the term). Rather than a separate
  // store (which would only start counting from whenever this shipped),
  // this derives it straight from the player's own game log: every game
  // already carries wonRace (true on exactly the rack that pushed
  // someone's count over the race target) plus winnerNames/opponentNames/
  // teammateNames, which together already tell us who else was in that
  // race — so this surfaces every race ever completed, including ones
  // from long before this feature existed. `games` is one player's own
  // games (as produced by allGamesForPlayerName/computeSessionFromGameHistory),
  // already relative to that player: g.result is "won" only when this
  // player's own side reached the target on this exact rack.
  function sessionRaceTournamentGames(games) {
    var results = [];
    games.forEach(function (g) {
      if (!g.wonRace) return;
      results.push({
        ts: g.ts,
        result: g.result,
        opponentNames: (g.teammateNames || []).concat(g.opponentNames || []),
        gameLabel: "Race-to Session"
      });
    });
    return results;
  }

  // One pseudo-"game" per completed bracket Tournament this player
  // entered, shaped enough like a real game (ts/result/opponentNames/
  // gameLabel) to reuse filterGamesByPeriod and the graph's bucketing
  // helpers, but plotted as its own series in buildPlayerGraph rather
  // than mixed into single-game counts. Race-to-N session results are
  // handled separately by sessionRaceTournamentGames above — a stray
  // "session-race" entry can exist here from an earlier version of this
  // feature that wrote both to the same store; skipped to avoid double-
  // counting anyone who already triggered that code path.
  function tournamentGamesForPlayerName(name) {
    var games = [];
    TOURNAMENT_RESULTS.forEach(function (r) {
      if (r.format === "session-race") return;
      if ((r.players || []).indexOf(name) === -1) return;
      // r.entrantMembers is absent on older records (or solo-only
      // tournaments saved before teams existed) - in that case every
      // other player counts as an opponent, same as always. When present,
      // exclude this player's own teammates (found by scanning for the
      // entrant whose members include `name`) so a team win/loss doesn't
      // also list a teammate as something this player "played against."
      var ownTeammates = {};
      if (r.entrantMembers) {
        Object.keys(r.entrantMembers).forEach(function (label) {
          var members = r.entrantMembers[label];
          if (members.indexOf(name) !== -1) {
            members.forEach(function (n) {
              ownTeammates[n] = true;
            });
          }
        });
      }
      games.push({
        ts: r.ts,
        result: (r.championNames || []).indexOf(name) !== -1 ? "won" : "lost",
        opponentNames: r.players.filter(function (n) {
          return n !== name && !ownTeammates[n];
        }),
        gameLabel: "Tournament"
      });
    });
    return games;
  }

  function nextPow2(n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  }

  // Standard tournament seeding order (1v4/2v3 for a 4-bracket, 1v8/4v5/
  // 2v7/3v6 for an 8-bracket, etc.) — used so byes land spread across the
  // draw instead of clustered together.
  function seedOrder(size) {
    if (size === 1) return [1];
    var prev = seedOrder(size / 2);
    var result = [];
    prev.forEach(function (s) {
      result.push(s);
      result.push(size + 1 - s);
    });
    return result;
  }

  // feederA/feederB (optional) are the specific match objects whose
  // winner became this match's .a/.b - only ever set for losers-bracket
  // matches (see pairUpNames), so the losers bracket can be drawn as a
  // real connected tree instead of flat labeled columns. Winners-bracket
  // matches don't need this: their feeders are always computable from
  // position alone, t.wb[ri-1][mi*2] and [mi*2+1] - the second one just
  // won't exist for a pendingBye match (see buildWinnersBracketRounds),
  // which only ever has the one.
  function createBracketMatch(a, b, tag, feederA, feederB) {
    return {
      id: uid(),
      a: a || null,
      b: b || null,
      winner: null,
      loser: null,
      tag: tag,
      collected: false,
      feederA: feederA || null,
      feederB: feederB || null,
      table: null
    };
  }

  // Pairs up consecutive { name, feeder } entries (feeder is the match
  // that produced that name, or null if it has none - e.g. round robin
  // never uses this) into new matches, stamping each with where its two
  // sides actually came from. leftover carries its own feeder through
  // too, so it's never lost if this name has to wait another round
  // before finally getting paired.
  function pairUpNames(entries, tag) {
    var matches = [];
    var i = 0;
    while (i + 1 < entries.length) {
      matches.push(createBracketMatch(entries[i].name, entries[i + 1].name, tag, entries[i].feeder, entries[i + 1].feeder));
      i += 2;
    }
    var leftover = i < entries.length ? [entries[i]] : [];
    return { matches: matches, leftover: leftover };
  }

  function wbRoundComplete(t, ri) {
    return t.wb[ri].every(function (m) {
      return m.winner !== null;
    });
  }

  function pendingWbMatches(t) {
    var out = [];
    t.wb.forEach(function (rnd) {
      rnd.forEach(function (m) {
        if (m.a !== null && m.b !== null && m.winner === null) out.push(m);
      });
    });
    return out;
  }

  function pendingLbMatches(t) {
    var out = [];
    t.lbRounds.forEach(function (rnd) {
      rnd.forEach(function (m) {
        if (m.a !== null && m.b !== null && m.winner === null) out.push(m);
      });
    });
    return out;
  }

  function pendingGfMatches(t) {
    return t.grandFinal.filter(function (m) {
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  function pendingRrMatches(t) {
    return t.matches.filter(function (m) {
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  // Only the latest round can ever have a pending match - earlier rounds
  // are, by construction, always fully decided before the next one is
  // generated (see finalizeSwissRoundIfComplete).
  function pendingSwissMatches(t) {
    var latest = t.rounds[t.rounds.length - 1] || [];
    return latest.filter(function (m) {
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  function pendingBracketMatches(t) {
    if (t.format === "roundrobin") return pendingRrMatches(t);
    if (t.format === "swiss") return pendingSwissMatches(t);
    return pendingWbMatches(t).concat(pendingLbMatches(t), pendingGfMatches(t));
  }

  function findBracketMatchById(t, id) {
    var all = [];
    if (t.format === "roundrobin") {
      all = t.matches;
    } else if (t.format === "swiss") {
      t.rounds.forEach(function (r) {
        all = all.concat(r);
      });
    } else {
      t.wb.forEach(function (r) {
        all = all.concat(r);
      });
      t.lbRounds.forEach(function (r) {
        all = all.concat(r);
      });
      all = all.concat(t.grandFinal);
    }
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  // Propagates every decided result through the bracket: winners advance to
  // their next winners-bracket slot, losers drop into the losers bracket in
  // the standard alternating pattern (a round pairing fresh drop-ins against
  // losers-bracket survivors, then a round consolidating those survivors
  // among themselves before the next winners-bracket round's losers arrive),
  // and sets up the grand final once both bracket champions are known.
  function advanceBracket(t) {
    var changed = true;
    while (changed) {
      changed = false;

      t.wb.forEach(function (rnd, ri) {
        rnd.forEach(function (m, mi) {
          if (m.winner !== null && !m.collected) {
            m.collected = true;
            changed = true;
            if (ri + 1 < t.wb.length) {
              var nxt = t.wb[ri + 1][Math.floor(mi / 2)];
              if (mi % 2 === 0) nxt.a = m.winner;
              else nxt.b = m.winner;
              // pendingBye matches (see buildWinnersBracketRounds) only
              // ever get ONE feeder by construction - the moment it
              // arrives, that's the whole match, exactly like a round-1
              // bye already resolves the instant it's built, just now
              // possibly happening in any later round too.
              if (nxt.pendingBye && nxt.winner === null) {
                nxt.winner = nxt.a !== null ? nxt.a : nxt.b;
                nxt.loser = null;
              }
            } else {
              t.wbChampion = m.winner;
            }
          }
        });
      });

      while (t.lbNextWbRoundToDrop < t.wb.length && wbRoundComplete(t, t.lbNextWbRoundToDrop)) {
        var ri2 = t.lbNextWbRoundToDrop;
        // Each drop-in's feeder is the exact WB match it lost - so a
        // fresh drop always knows where it came from, same as anyone
        // already sitting in lbWaiting (see the two spots below that
        // push onto it, both of which carry a feeder along too).
        var dropped = t.wb[ri2]
          .filter(function (m) {
            return m.loser !== null;
          })
          .map(function (m) {
            return { name: m.loser, feeder: m };
          });
        t.lbNextWbRoundToDrop += 1;
        changed = true;
        if (ri2 === 0) {
          var res = pairUpNames(dropped, "Losers R1");
          if (res.matches.length) t.lbRounds.push(res.matches);
          t.lbWaiting = t.lbWaiting.concat(res.leftover);
        } else {
          var matches2 = [];
          var newWaiting = [];
          var li = 0;
          var wi = 0;
          var waiting = t.lbWaiting;
          while (li < dropped.length || wi < waiting.length) {
            if (wi < waiting.length && li < dropped.length) {
              matches2.push(createBracketMatch(waiting[wi].name, dropped[li].name, "Losers", waiting[wi].feeder, dropped[li].feeder));
              wi += 1;
              li += 1;
            } else if (wi < waiting.length) {
              newWaiting.push(waiting[wi]);
              wi += 1;
            } else {
              newWaiting.push(dropped[li]);
              li += 1;
            }
          }
          if (matches2.length) t.lbRounds.push(matches2);
          t.lbWaiting = newWaiting;
        }
      }

      t.lbRounds.forEach(function (rnd) {
        rnd.forEach(function (m) {
          if (m.winner !== null && !m.collected) {
            m.collected = true;
            t.lbWaiting.push({ name: m.winner, feeder: m });
            changed = true;
          }
        });
      });

      if (t.lbWaiting.length >= 2) {
        var moreWbPending = t.lbNextWbRoundToDrop < t.wb.length;
        if (!moreWbPending || !wbRoundComplete(t, t.lbNextWbRoundToDrop)) {
          var res2 = pairUpNames(t.lbWaiting, "Losers");
          if (res2.matches.length) {
            t.lbRounds.push(res2.matches);
            t.lbWaiting = res2.leftover;
            changed = true;
          }
        }
      }

      if (
        t.lbChampion === null &&
        t.lbNextWbRoundToDrop >= t.wb.length &&
        pendingLbMatches(t).length === 0 &&
        t.lbWaiting.length === 1
      ) {
        t.lbChampion = t.lbWaiting[0].name;
        changed = true;
      }

      if (t.wbChampion && t.lbChampion && t.grandFinal.length === 0) {
        t.grandFinal.push(createBracketMatch(t.wbChampion, t.lbChampion, "Grand Final"));
        changed = true;
      }
    }

    // Single elimination has no losers bracket or grand final — the
    // winners-bracket champion is the tournament champion outright.
    if (t.format === "single" && t.wbChampion && !t.champion) {
      t.champion = t.wbChampion;
    }
  }

  // Shuffles the field and builds the empty winners-bracket rounds shared
  // by both tournament formats — round 1 seeded with the standard spread
  // (1v4/2v3, etc.) so any bye lands away from the strongest seeds,
  // every later round starting empty until winners advance into it.
  // Unlike a classic "pad straight to the next power of two" bracket,
  // rounds here are only ever sized to fit however many real entrants
  // (or, from round 2 on, real winners) actually exist - at most one
  // match anywhere ever needs a bye (see the pendingBye rounds below),
  // instead of a small or awkward field (9 players, or even 10) dumping
  // most of the round-1 byes needed to reach a power of two all at
  // once and letting several of them land on each other as an
  // apparently-already-decided later round.
  // seededOrder (optional): a real 1..N ranking supplied by the organizer
  // (see getTournamentSeeds) instead of the default random draw. Either
  // way, seedOrder below is what actually spreads seed 1/2/3/4... onto
  // opposite halves of the bracket so they can't meet early - that spread
  // happens the same way whether the ranking behind it is random or real.
  // pairAdjacent (optional): the opposite of that spread - used for
  // "Match Similar Ratings" seeding, where seededOrder is already
  // strongest-to-weakest and the whole point is for adjacent ranks to
  // play each other round 1 instead of being kept apart. Byes in this
  // mode go to the weakest players (paired against nobody) rather than
  // the standard convention of rewarding the strongest with a bye - a
  // bye here would let a top player dodge the very round-1 gauntlet this
  // mode exists to create.
  function buildWinnersBracketRounds(playerNames, seededOrder, pairAdjacent) {
    var shuffled;
    if (seededOrder) {
      shuffled = seededOrder.slice();
    } else {
      shuffled = playerNames.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
    }
    var n = shuffled.length;
    var slots;
    if (pairAdjacent) {
      // Adjacent-rated players pair off in order; the single weakest
      // (last, since shuffled/seededOrder is already strongest-to-
      // weakest here) gets the bye when n is odd - same principle as
      // byes always going to the weakest player in this mode, just
      // needing at most one now instead of however many it used to take
      // to pad all the way to a power of two.
      var byeCount = n % 2;
      slots = shuffled.slice(0, n - byeCount);
      if (byeCount) slots.push(shuffled[n - 1], null);
    } else {
      // Same spread seedOrder already used to keep strong seeds apart
      // across the draw (1 vs the bottom seed, 2 vs the next-from-
      // bottom, etc.) - computed against the next power of two as
      // always, but now only to DERIVE that spread order, not to size
      // the round: the phantom seed numbers beyond n are dropped
      // instead of becoming real bye slots, so pairing what's left two
      // at a time needs at most one true bye (whoever's odd one out),
      // not "however many seeds it takes to reach a power of two".
      var spread = seedOrder(nextPow2(n))
        .filter(function (s) {
          return s <= n;
        })
        .map(function (s) {
          return shuffled[s - 1];
        });
      slots = spread.slice();
      if (n % 2 === 1) slots.push(null);
    }

    var wb = [];
    var r1 = [];
    for (var k = 0; k < slots.length; k += 2) {
      r1.push(createBracketMatch(slots[k], slots[k + 1], "Winners R1"));
    }
    wb.push(r1);

    // Every later round is sized to fit however many winners the round
    // before it can actually produce - ceil(), not an exact half, since
    // an odd match count (itself possible whenever the round before IT
    // had an odd number of real entrants) leaves one winner with nobody
    // to pair against yet. That leftover match is flagged pendingBye
    // (instead of resolved immediately the way round 1's bye already is
    // above) because - unlike round 1 - who actually lands in it isn't
    // known until its one real feeder match has been played;
    // advanceBracket resolves it the instant that happens. This is the
    // whole reason a small or awkwardly-sized field no longer needs to
    // be padded out to the next power of two up front: at most one
    // match anywhere ever needs a bye, rather than dumping every
    // "missing" slot into round 1 alone.
    while (wb[wb.length - 1].length > 1) {
      var prev = wb[wb.length - 1];
      var cur = [];
      for (var m = 0; m < prev.length; m += 2) {
        var match = createBracketMatch(null, null, "Winners R" + (wb.length + 1));
        if (m + 1 >= prev.length) match.pendingBye = true;
        cur.push(match);
      }
      wb.push(cur);
    }

    // Round-1 byes are structural (a slot was never filled because there
    // weren't enough real players) — resolve them once, explicitly, here.
    // Every other empty slot elsewhere in the bracket just means "not
    // decided yet" and must never be treated as a bye.
    wb[0].forEach(function (m) {
      if ((m.a === null) !== (m.b === null)) {
        m.winner = m.a !== null ? m.a : m.b;
        m.loser = null;
      }
    });

    return { shuffled: shuffled, size: nextPow2(n), wb: wb };
  }

  function buildDoubleEliminationBracket(playerNames, gameType, target, raceTo, fairRace, seededOrder, pairAdjacent) {
    var built = buildWinnersBracketRounds(playerNames, seededOrder, pairAdjacent);
    var t = {
      format: "double",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      fairRace: !!fairRace,
      players: built.shuffled,
      size: built.size,
      wb: built.wb,
      lbRounds: [],
      lbWaiting: [],
      lbNextWbRoundToDrop: 0,
      wbChampion: null,
      lbChampion: null,
      grandFinal: [],
      champion: null,
      activeMatches: [],
      focusedTable: "all"
    };
    advanceBracket(t);
    return t;
  }

  // Single elimination: same winners-bracket shape as double elimination,
  // but there's no losers bracket to drop into (lbNextWbRoundToDrop starts
  // past the last round, so the losers-bracket logic in advanceBracket
  // never fires) and no grand final — the winners-bracket champion is the
  // tournament champion outright.
  function buildSingleEliminationBracket(playerNames, gameType, target, raceTo, fairRace, seededOrder, pairAdjacent) {
    var built = buildWinnersBracketRounds(playerNames, seededOrder, pairAdjacent);
    var t = {
      format: "single",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      fairRace: !!fairRace,
      players: built.shuffled,
      size: built.size,
      wb: built.wb,
      lbRounds: [],
      lbWaiting: [],
      lbNextWbRoundToDrop: built.wb.length,
      wbChampion: null,
      lbChampion: null,
      grandFinal: [],
      champion: null,
      activeMatches: [],
      focusedTable: "all"
    };
    advanceBracket(t);
    return t;
  }

  // Round Robin: no bracket tree at all — every player plays every other
  // player exactly once (shuffled match order only, since there's no
  // seeding to speak of), and the champion is decided once every match
  // has a result — see finalizeRoundRobinIfComplete.
  function buildRoundRobinTournament(playerNames, gameType, target, raceTo, fairRace) {
    var shuffled = playerNames.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var matches = [];
    for (var a = 0; a < shuffled.length; a++) {
      for (var b = a + 1; b < shuffled.length; b++) {
        matches.push(createBracketMatch(shuffled[a], shuffled[b], "Round Robin"));
      }
    }
    return {
      format: "roundrobin",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      fairRace: !!fairRace,
      players: shuffled,
      matches: matches,
      champion: null,
      championNames: null,
      activeMatches: [],
      focusedTable: "all"
    };
  }

  // Swiss: no elimination, and not every possible pairing either — each
  // round pairs players against others with a similar record so far
  // (never a repeat pairing), for a fixed number of rounds sized to the
  // field (ceil(log2(n)), the standard convention — enough rounds to
  // separate a field this size without playing every pairing the way
  // round robin does). Built round-by-round: only round 1 is created
  // here, via pairSwissRound below; later rounds are appended as each
  // one finishes (see finalizeSwissRoundIfComplete).
  function buildSwissTournament(playerNames, gameType, target, raceTo, fairRace, seededOrder) {
    var ordered;
    if (seededOrder) {
      ordered = seededOrder.slice();
    } else {
      ordered = playerNames.slice();
      for (var i = ordered.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = ordered[i];
        ordered[i] = ordered[j];
        ordered[j] = tmp;
      }
    }
    var t = {
      format: "swiss",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      fairRace: !!fairRace,
      players: ordered,
      totalRounds: Math.max(1, Math.ceil(Math.log(ordered.length) / Math.log(2))),
      rounds: [],
      byeHistory: {},
      pairHistory: {},
      champion: null,
      championNames: null,
      activeMatches: [],
      focusedTable: "all"
    };
    t.rounds.push(pairSwissRound(t));
    return t;
  }

  // Ranks every entrant by match wins (most first, name as a stable
  // tiebreaker for display order only — a true tie in wins is reflected
  // by championNames holding more than one name, not by this ordering).
  function roundRobinStandings(t) {
    var wins = {};
    var played = {};
    t.players.forEach(function (name) {
      wins[name] = 0;
      played[name] = 0;
    });
    t.matches.forEach(function (m) {
      if (m.winner === null) return;
      wins[m.winner] = (wins[m.winner] || 0) + 1;
      played[m.a] = (played[m.a] || 0) + 1;
      played[m.b] = (played[m.b] || 0) + 1;
    });
    return t.players
      .slice()
      .sort(function (x, y) {
        return (wins[y] || 0) - (wins[x] || 0) || x.localeCompare(y);
      })
      .map(function (name) {
        return { name: name, wins: wins[name] || 0, played: played[name] || 0 };
      });
  }

  // Shared by swissPairingOrder and swissStandings below - just a plain
  // win count per player from every decided match across every round
  // played so far (byes included, since a bye already counts as a win).
  function swissWinsMap(t) {
    var wins = {};
    t.players.forEach(function (name) {
      wins[name] = 0;
    });
    t.rounds.forEach(function (round) {
      round.forEach(function (m) {
        if (m.winner !== null) wins[m.winner] = (wins[m.winner] || 0) + 1;
      });
    });
    return wins;
  }

  // Ranks the field by wins for PAIRING purposes - ties broken by each
  // player's original seed/shuffle position (t.players order), not by
  // name. Round 1 needs this for the standard seed-1-vs-middle-seed
  // opening spread; later rounds stay deterministic relative to strength
  // instead of re-sorting alphabetically on every tie. Contrast with
  // swissStandings below, which is for DISPLAY and ties by name instead.
  function swissPairingOrder(t) {
    var wins = swissWinsMap(t);
    return t.players.slice().sort(function (a, b) {
      return (wins[b] || 0) - (wins[a] || 0) || t.players.indexOf(a) - t.players.indexOf(b);
    });
  }

  // Wins/played, plus a simplified Buchholz score (sum of each opponent's
  // own win total) as a tiebreak for DISPLAY only - it never decides the
  // champion (see finalizeSwissRoundIfComplete), matching how a tied
  // finish is handled everywhere else in this app (Round Robin shares the
  // win rather than picking a tiebreaker winner).
  function swissStandings(t) {
    var wins = swissWinsMap(t);
    var played = {};
    var opponentsOf = {};
    t.players.forEach(function (name) {
      played[name] = 0;
      opponentsOf[name] = [];
    });
    t.rounds.forEach(function (round) {
      round.forEach(function (m) {
        if (m.winner === null || m.b === null) return; // a bye has no real opponent
        played[m.a] = (played[m.a] || 0) + 1;
        played[m.b] = (played[m.b] || 0) + 1;
        opponentsOf[m.a].push(m.b);
        opponentsOf[m.b].push(m.a);
      });
    });
    return t.players
      .map(function (name) {
        var buchholz = opponentsOf[name].reduce(function (sum, opp) {
          return sum + (wins[opp] || 0);
        }, 0);
        return { name: name, wins: wins[name] || 0, played: played[name] || 0, buchholz: buchholz };
      })
      .sort(function (x, y) {
        return y.wins - x.wins || y.buchholz - x.buchholz || x.name.localeCompare(y.name);
      });
  }

  function swissPairKey(a, b) {
    return [a, b].sort().join("|");
  }

  // Greedy pairing: walk the field ranked by current record, pairing each
  // still-unpaired player with the next unpaired player below them they
  // haven't already played. Simple and good enough for the small fields
  // this app is built for, not a formal Swiss pairing engine — if every
  // remaining candidate has already been played (only realistic in a very
  // small field over many rounds), pairs with the closest-ranked available
  // opponent anyway rather than erroring.
  function pairSwissRound(t) {
    var ranked = swissPairingOrder(t);
    var roundNum = t.rounds.length + 1;
    var unpaired = ranked.slice();
    var matches = [];

    // Odd field: the bye goes to the lowest-ranked player who hasn't had
    // one yet, falling back to lowest-ranked overall if everyone has -
    // resolved immediately, the same way a structural round-1 bye is
    // resolved in buildWinnersBracketRounds, rather than left pending.
    if (unpaired.length % 2 === 1) {
      var byeIndex = -1;
      for (var i = unpaired.length - 1; i >= 0; i--) {
        if (!t.byeHistory[unpaired[i]]) {
          byeIndex = i;
          break;
        }
      }
      if (byeIndex === -1) byeIndex = unpaired.length - 1;
      var byeName = unpaired.splice(byeIndex, 1)[0];
      var byeMatch = createBracketMatch(byeName, null, "Swiss R" + roundNum);
      byeMatch.winner = byeName;
      matches.push(byeMatch);
      t.byeHistory[byeName] = (t.byeHistory[byeName] || 0) + 1;
    }

    while (unpaired.length) {
      var name = unpaired.shift();
      var opponentIndex = -1;
      for (var k = 0; k < unpaired.length; k++) {
        if (!t.pairHistory[swissPairKey(name, unpaired[k])]) {
          opponentIndex = k;
          break;
        }
      }
      if (opponentIndex === -1) opponentIndex = 0;
      var opponent = unpaired.splice(opponentIndex, 1)[0];
      matches.push(createBracketMatch(name, opponent, "Swiss R" + roundNum));
      t.pairHistory[swissPairKey(name, opponent)] = true;
    }

    return matches;
  }

  // Once every round-robin match has a result, the champion is whoever
  // has the most match wins — a tie at the top makes every tied player a
  // champion (championNames holds all of them; TOURNAMENT_RESULTS
  // already supports multiple simultaneous winners for team wins, so
  // this reuses that instead of picking an arbitrary tiebreaker).
  function finalizeRoundRobinIfComplete(t) {
    var allDecided = t.matches.every(function (m) {
      return m.winner !== null;
    });
    if (!allDecided) return;
    var standings = roundRobinStandings(t);
    var topWins = standings[0].wins;
    var champions = standings
      .filter(function (s) {
        return s.wins === topWins;
      })
      .map(function (s) {
        return s.name;
      });
    t.championNames = champions;
    t.champion = champions.join(" & ");
  }

  // Once every match in the latest Swiss round has a result: either the
  // whole tournament is done (totalRounds reached — champion decided by
  // most wins, ties shared exactly like Round Robin's tied finish, never
  // broken by Buchholz) or the next round's pairings are generated and
  // appended.
  function finalizeSwissRoundIfComplete(t) {
    var latest = t.rounds[t.rounds.length - 1];
    var allDecided = latest.every(function (m) {
      return m.winner !== null;
    });
    if (!allDecided) return;
    if (t.rounds.length >= t.totalRounds) {
      var standings = swissStandings(t);
      var topWins = standings[0].wins;
      var champions = standings
        .filter(function (s) {
          return s.wins === topWins;
        })
        .map(function (s) {
          return s.name;
        });
      t.championNames = champions;
      t.champion = champions.join(" & ");
      return;
    }
    t.rounds.push(pairSwissRound(t));
  }

  function isGrandFinalMatch(t, match) {
    return t.grandFinal.indexOf(match) !== -1;
  }

  function reportBracketResult(t, match, winnerName) {
    if (match.a !== winnerName && match.b !== winnerName) return;
    match.winner = winnerName;
    match.loser = match.a === winnerName ? match.b : match.a;
    if (t.format === "roundrobin") {
      finalizeRoundRobinIfComplete(t);
      return;
    }
    if (t.format === "swiss") {
      finalizeSwissRoundIfComplete(t);
      return;
    }
    if (isGrandFinalMatch(t, match)) {
      if (winnerName === t.wbChampion) {
        t.champion = winnerName;
      } else if (t.grandFinal.length === 1) {
        // The losers-bracket champion beat the winners-bracket champion,
        // who has only lost once — double elimination means they get a
        // second grand final to decide it.
        t.grandFinal.push(createBracketMatch(t.grandFinal[0].a, t.grandFinal[0].b, "Grand Final (bracket reset)"));
      } else {
        t.champion = winnerName;
      }
      return;
    }
    advanceBracket(t);
  }

  // A semifinal or final (WB final, or anything in the Grand Final) gets
  // a little extra visual weight in the ready-to-play list - it's a
  // bigger moment than an early round, so it should feel like one.
  function isMarqueeTournamentMatch(t, match) {
    if (isGrandFinalMatch(t, match)) return true;
    if (!t.wb.length) return false;
    var lastRound = t.wb[t.wb.length - 1];
    var semiRound = t.wb.length >= 2 ? t.wb[t.wb.length - 2] : null;
    return lastRound.indexOf(match) !== -1 || (!!semiRound && semiRound.indexOf(match) !== -1);
  }

  function findWbPosition(t, match) {
    for (var ri = 0; ri < t.wb.length; ri++) {
      var mi = t.wb[ri].indexOf(match);
      if (mi !== -1) return { ri: ri, mi: mi };
    }
    return null;
  }

  // A winners-bracket match's internal tag is just "Winners R3" - not
  // wrong, but not what a player actually calls that round out loud.
  // Swaps in the same Final/Semifinal/Quarterfinal/Round-of-N label the
  // bracket tree itself shows above each card (wbRoundLabel) wherever a
  // WB match's round gets named back to the player; Grand Final and
  // losers-bracket tags are already plain-language as-is.
  function matchRoundLabel(t, match) {
    if (isGrandFinalMatch(t, match)) return match.tag;
    var pos = findWbPosition(t, match);
    if (pos) return wbRoundLabel(t.wb[pos.ri].length);
    return match.tag;
  }

  // Figures out what to tell a just-crowned match winner about what's
  // next: the next match they've already been placed into (by the
  // advanceBracket call that already ran before this is called) and who
  // they'll face, or - if that slot isn't filled yet - the specific
  // still-pending match that will decide it, when that's computable (the
  // winners bracket's round/index math makes this exact; the losers
  // bracket's matches aren't linked that way, so it falls back to a
  // generic "the bracket's still catching up" line there). Returns null
  // when the tournament itself is already over - the caller shows a
  // champion headline instead in that case.
  function describeWhatsNextForWinner(t, justPlayedMatch, winnerName) {
    if (t.champion) return null;
    function findOpenMatchIn(list) {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m.winner && (m.a === winnerName || m.b === winnerName)) return m;
      }
      return null;
    }
    var flatWb = [].concat.apply([], t.wb);
    var flatLb = [].concat.apply([], t.lbRounds);
    var next = findOpenMatchIn(t.grandFinal) || findOpenMatchIn(flatWb) || findOpenMatchIn(flatLb);
    if (!next) {
      if (t.wbChampion === winnerName && t.grandFinal.length === 0) {
        return T("tournament.nextWaitingForLosersChampion");
      }
      return T("tournament.nextWaitingGeneric");
    }
    var nextRoundLabel = matchRoundLabel(t, next);
    var opponent = next.a === winnerName ? next.b : next.a;
    if (opponent) {
      return T("tournament.nextAdvance", { round: nextRoundLabel, opponent: opponent });
    }
    var pos = findWbPosition(t, justPlayedMatch);
    if (pos) {
      var siblingIdx = pos.mi % 2 === 0 ? pos.mi + 1 : pos.mi - 1;
      var sibling = t.wb[pos.ri][siblingIdx];
      if (sibling && sibling.a && sibling.b && !sibling.winner) {
        return T("tournament.nextWaitingForMatch", { round: nextRoundLabel, a: sibling.a, b: sibling.b });
      }
    }
    return T("tournament.nextWaitingGenericRound", { round: nextRoundLabel });
  }

  function closeTournamentMatchWinPopup() {
    tournamentMatchWinOverlay.classList.add("hidden");
  }

  // The gratifying "you won that match" moment the live scoreboard's own
  // win popup never covers for bracket play (tournamentAdjustScore scores
  // a match with its own +/- steppers, not creditWin) - shown right after
  // reportBracketResult/advanceBracket have already placed the winner
  // into whatever comes next, so describeWhatsNextForWinner can just read
  // that placement back out rather than recompute it.
  function showTournamentMatchWinPopup(t, justPlayedMatch, winnerName) {
    if (t.format !== "single" && t.format !== "double") return;
    if (t.champion) {
      tournamentMatchWinEmoji.textContent = "🏆🎉";
      tournamentMatchWinHeadline.textContent = T("tournament.matchWinChampionHeadline", { winner: t.champion });
      tournamentMatchWinSubtext.textContent = "";
    } else {
      tournamentMatchWinEmoji.textContent = "🏆";
      tournamentMatchWinHeadline.textContent = T("tournament.matchWinHeadline", { winner: winnerName });
      tournamentMatchWinSubtext.textContent = describeWhatsNextForWinner(t, justPlayedMatch, winnerName) || "";
    }
    tournamentMatchWinOverlay.classList.remove("hidden");
  }

  function recordTournamentRackWin(winnerLabel, loserLabel, durationMs) {
    var entrantMembers = TOURNAMENT.entrantMembers || {};
    var winnerMembers = entrantMembers[winnerLabel] || [winnerLabel];
    var loserMembers = entrantMembers[loserLabel] || [loserLabel];
    var isTeam = winnerMembers.length > 1 || loserMembers.length > 1;
    var typeLabel = GAME_TYPES[TOURNAMENT.gameType] ? GAME_TYPES[TOURNAMENT.gameType].label : TOURNAMENT.gameType;
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
      gameType: TOURNAMENT.gameType,
      gameLabel: typeLabel,
      target: TOURNAMENT.target,
      winnerNames: winnerMembers,
      opponentNames: loserMembers,
      isTeam: isTeam,
      mvpId: null,
      mvpName: null,
      durationMs: durationMs,
      summary: winnerLabel + " won " + typeLabel + " (tournament vs " + loserLabel + ")"
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    if (isTeam) {
      applyTeamRatingResult(winnerMembers, loserMembers, ts);
    } else {
      applyPairwiseRatingResult(winnerMembers[0], loserMembers[0], ts);
    }
    saveRatingsToStorage(PLAYER_RATINGS);
    saveState();
  }

  // Offers every previously-saved team name PLUS whatever's currently
  // typed into any other row right now - so a brand-new team name shows
  // up as a pickable option for the next row immediately, without having
  // to wait for a tournament to actually start (which is the only point
  // SAVED_TEAMS itself gets updated).
  function renderTournamentTeamOptions() {
    var seen = {};
    var names = [];
    function addName(n) {
      if (!n) return;
      var key = normalizeNameKey(n);
      if (seen[key]) return;
      seen[key] = true;
      names.push(n);
    }
    SAVED_TEAMS.forEach(function (t) {
      addName(t.name);
    });
    Array.prototype.forEach.call(tournamentPlayerChecklist.querySelectorAll(".tournament-team-input"), function (input) {
      addName(input.value.trim());
    });
    tournamentTeamOptionsDatalist.innerHTML = "";
    names.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      tournamentTeamOptionsDatalist.appendChild(opt);
    });
  }

  // Re-renders both the team-options datalist and the team preview line -
  // wired to every checkbox/team-input change on the checklist.
  function refreshTournamentTeamUi() {
    renderTournamentTeamOptions();
    renderTournamentTeamPreview();
  }

  function tournamentSeedMode() {
    var checked = Array.prototype.filter.call(tournamentSeedModeRadios, function (r) {
      return r.checked;
    })[0];
    return checked ? checked.value : "random";
  }

  function isTournamentSeededManually() {
    var checked = Array.prototype.filter.call(tournamentSeedModeRadios, function (r) {
      return r.checked;
    })[0];
    return !!checked && checked.value === "manual";
  }

  function renderTournamentPlayerChecklist() {
    var names = getAllKnownPlayerNames().sort(function (a, b) {
      return a.localeCompare(b);
    });
    var activeNames = {};
    activePlayers().forEach(function (p) {
      activeNames[p.name] = true;
    });
    // A fresh render means a fresh checklist DOM - any earlier Select All
    // snapshot no longer refers to anything real.
    tournamentSelectAllCheckbox.checked = false;
    tournamentSelectAllSnapshot = null;
    tournamentPlayerChecklist.innerHTML = "";
    renderTournamentTeamOptions();
    if (names.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("tournament.addPlayersFirst");
      tournamentPlayerChecklist.appendChild(hint);
      return;
    }
    names.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "tournament-player-check-row";
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = !!activeNames[name];
      var span = document.createElement("span");
      span.textContent = name;
      span.appendChild(buildRatingBadge(name));
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      var seedInput = document.createElement("input");
      seedInput.type = "number";
      seedInput.min = "1";
      seedInput.className = "tournament-seed-input" + (isTournamentSeededManually() ? "" : " hidden");
      seedInput.setAttribute("aria-label", T("tournament.seedLabel"));
      li.appendChild(seedInput);
      var teamInput = document.createElement("input");
      teamInput.type = "text";
      teamInput.className = "tournament-team-input";
      teamInput.setAttribute("list", "tournament-team-options");
      teamInput.setAttribute("aria-label", T("tournament.teamLabel"));
      teamInput.setAttribute("placeholder", T("tournament.teamLabel"));
      li.appendChild(teamInput);
      tournamentPlayerChecklist.appendChild(li);
    });
    renderTournamentTeamPreview();
  }

  // Groups the checked checklist rows into bracket entrants. Grouping two
  // or more rows into one shared entrant only happens when "Play as
  // teams" is on AND they share the same (trimmed, case-insensitive) Team
  // value - otherwise every row is always its own solo entrant, matches
  // stay one-on-one. Either way, a non-blank Team value is kept on the
  // entrant as `teamName` - purely informational when it didn't result in
  // grouping (teams off, or nobody else typed the same value), so
  // "who plays with whom" is still visible even when it isn't driving the
  // bracket. A team value that collides with an existing player's name is
  // rejected (treated as blank) and reported back via collidedTeamNames,
  // since team and player names share one lookup namespace everywhere
  // downstream (getPlayerIdByName, rating lookups).
  function getTournamentEntrants() {
    var teamsEnabled = tournamentTeamsEnabledCheckbox.checked;
    var rows = Array.prototype.slice.call(tournamentPlayerChecklist.querySelectorAll(".tournament-player-check-row"));
    var knownPlayerKeys = {};
    getAllKnownPlayerNames().forEach(function (n) {
      knownPlayerKeys[normalizeNameKey(n)] = true;
    });
    var groupsByKey = {};
    var order = [];
    var collidedTeamNames = [];
    rows.forEach(function (li) {
      var cb = li.querySelector('input[type="checkbox"]');
      if (!cb || !cb.checked) return;
      var name = cb.value;
      var teamInput = li.querySelector(".tournament-team-input");
      var rawTeam = teamInput ? teamInput.value.trim() : "";
      var isCollision = !!rawTeam && knownPlayerKeys[normalizeNameKey(rawTeam)];
      if (isCollision) collidedTeamNames.push(rawTeam);
      var teamValue = isCollision ? "" : rawTeam;
      var groupKey = teamsEnabled && teamValue ? "team:" + normalizeNameKey(teamValue) : "solo:" + normalizeNameKey(name);
      if (!groupsByKey[groupKey]) {
        groupsByKey[groupKey] = { teamLabel: teamValue, members: [] };
        order.push(groupKey);
      }
      groupsByKey[groupKey].members.push({ name: name, teamName: teamValue || null });
    });
    var entrants = order.map(function (key) {
      var g = groupsByKey[key];
      var isRealTeam = g.members.length > 1;
      return {
        label: isRealTeam ? g.teamLabel : g.members[0].name,
        members: g.members.map(function (m) {
          return m.name;
        }),
        teamName: g.members[0].teamName
      };
    });
    return { entrants: entrants, collidedTeamNames: collidedTeamNames };
  }

  // Live "who's on this team" hint under the checklist, recomputed on
  // every checkbox/team-input change - satisfies knowing your teammates
  // before the tournament starts, not just after. Shows a grouped line
  // for real (2+ member) team entrants, and a shorter solo-tag line for
  // any player whose typed Team value didn't result in grouping (teams
  // off, or nobody else typed the same value) - covers both "playing as
  // teams" and "just want the team noted" cases.
  function renderTournamentTeamPreview() {
    var entrants = getTournamentEntrants().entrants;
    var lines = [];
    entrants.forEach(function (e) {
      if (e.members.length > 1) {
        lines.push(T("tournament.teamPreviewLine", { team: e.label, members: e.members.join(", ") }));
      } else if (e.teamName) {
        lines.push(T("tournament.teamPreviewSoloLine", { player: e.label, team: e.teamName }));
      }
    });
    if (lines.length === 0) {
      tournamentTeamPreview.textContent = "";
      tournamentTeamPreview.classList.add("hidden");
      return;
    }
    tournamentTeamPreview.classList.remove("hidden");
    tournamentTeamPreview.textContent = lines.join("  ·  ");
  }

  // Ranks entrants strongest-to-weakest by average rating (team-aware -
  // an entrant's members' ratings are averaged the same way Fair Race
  // treats a team as a single combined strength). Ties keep checklist
  // order, so it's still deterministic rather than depending on object
  // iteration order.
  function tournamentEntrantsByRatingDesc(entrants) {
    return entrants
      .map(function (entrant, idx) {
        return { name: entrant.label, rating: averageRating(entrant.members), idx: idx };
      })
      .sort(function (a, b) {
        return b.rating - a.rating || a.idx - b.idx;
      })
      .map(function (entry) {
        return entry.name;
      });
  }

  // Returns null when seeding is off (today's exact random-draw behavior).
  // For "rating" mode, resolves straight to a strongest-to-weakest order
  // (seed 1 = highest rated) - buildWinnersBracketRounds is told to pair
  // that order adjacently (see pairAdjacent) instead of spreading it
  // apart the way a real seed number normally would, so the closest-
  // rated players meet in round 1 instead of being kept apart.
  // For "manual" mode, resolves one seed per ENTRANT (not per row): the
  // lowest explicit seed number typed among that entrant's member rows,
  // else its first member's checklist position - left blank, duplicated,
  // or invalid entries all fall back this way, nudged past any number a
  // real seed already claimed, rather than erroring - this is a casual
  // home-game tool, not a tournament-director product.
  function getTournamentSeeds(entrants) {
    var mode = tournamentSeedMode();
    if (mode === "rating") {
      return tournamentEntrantsByRatingDesc(entrants).map(function (name, i) {
        return { name: name, seed: i + 1 };
      });
    }
    if (mode !== "manual") return null;
    var rows = Array.prototype.slice.call(tournamentPlayerChecklist.querySelectorAll(".tournament-player-check-row"));
    var checklistPositionByName = {};
    var seedValueByName = {};
    rows.forEach(function (li, idx) {
      var cb = li.querySelector('input[type="checkbox"]');
      if (!cb) return;
      checklistPositionByName[cb.value] = idx + 1;
      var seedInput = li.querySelector(".tournament-seed-input");
      seedValueByName[cb.value] = seedInput ? parseInt(seedInput.value, 10) : NaN;
    });
    var claimedSeeds = {};
    var entries = entrants.map(function (entrant) {
      var explicit = null;
      entrant.members.forEach(function (name) {
        var v = seedValueByName[name];
        if (v >= 1 && (explicit === null || v < explicit)) explicit = v;
      });
      var firstPosition = entrant.members.reduce(function (min, name) {
        var pos = checklistPositionByName[name] || Infinity;
        return pos < min ? pos : min;
      }, Infinity);
      return { name: entrant.label, seed: explicit, checklistPosition: firstPosition };
    });
    entries.forEach(function (entry) {
      if (entry.seed >= 1 && !claimedSeeds[entry.seed]) {
        claimedSeeds[entry.seed] = true;
      } else {
        entry.seed = null;
      }
    });
    entries.forEach(function (entry) {
      if (entry.seed !== null) return;
      var candidate = entry.checklistPosition;
      while (claimedSeeds[candidate]) candidate += 1;
      entry.seed = candidate;
      claimedSeeds[candidate] = true;
    });
    return entries
      .map(function (entry) {
        return { name: entry.name, seed: entry.seed };
      })
      .sort(function (a, b) {
        return a.seed - b.seed;
      });
  }

  function startTournament() {
    lbTreeExpandedNodes = {};
    var grouped = getTournamentEntrants();
    var entrants = grouped.entrants;
    if (grouped.collidedTeamNames.length) {
      showToast(T("tournament.teamNameConflictsWithPlayer", { names: grouped.collidedTeamNames.join(", ") }));
    }
    if (entrants.length < 2) {
      alertModal(T("alert.pickAtLeast2Players"));
      return;
    }
    var entrantMembers = {};
    var entrantTeamNames = {};
    entrants.forEach(function (e) {
      entrantMembers[e.label] = e.members;
      if (e.members.length > 1) {
        upsertTeamFromTournamentEntry(e.label, e.members);
      } else if (e.teamName) {
        entrantTeamNames[e.label] = e.teamName;
      }
    });
    var names = entrants.map(function (e) {
      return e.label;
    });
    var gameType = tournamentGameTypeSelect.value;
    var target = parseInt(tournamentTargetInput.value, 10) || GAME_TYPES[gameType].defaultTarget;
    var raceTo = parseInt(tournamentRaceToInput.value, 10) || 1;
    var fairRace = tournamentFairRaceCheckbox.checked;
    var format = Array.prototype.filter.call(tournamentFormatRadios, function (r) {
      return r.checked;
    })[0].value;
    var seedInfo = getTournamentSeeds(entrants);
    var seededOrder = seedInfo
      ? seedInfo.map(function (s) {
          return s.name;
        })
      : null;
    // Only meaningful for the two bracket formats - Swiss already pairs
    // adjacent-in-order players round to round on its own (see
    // pairSwissRound), and round robin has no concept of seeding at all.
    var pairAdjacent = tournamentSeedMode() === "rating";
    if (format === "roundrobin") {
      TOURNAMENT = buildRoundRobinTournament(names, gameType, target, raceTo, fairRace);
    } else if (format === "swiss") {
      TOURNAMENT = buildSwissTournament(names, gameType, target, raceTo, fairRace, seededOrder);
    } else if (format === "single") {
      TOURNAMENT = buildSingleEliminationBracket(names, gameType, target, raceTo, fairRace, seededOrder, pairAdjacent);
    } else {
      TOURNAMENT = buildDoubleEliminationBracket(names, gameType, target, raceTo, fairRace, seededOrder, pairAdjacent);
    }
    TOURNAMENT.entrantMembers = entrantMembers;
    TOURNAMENT.entrantTeamNames = entrantTeamNames;
    TOURNAMENT.tableCount = Math.max(1, parseInt(tournamentTableCountInput.value, 10) || 1);
    saveTournamentToStorage(TOURNAMENT);
    renderTournamentPage();
  }

  function abandonTournament() {
    var isDone = TOURNAMENT && TOURNAMENT.champion;
    var clear = function () {
      if (TOURNAMENT) {
        saveResetSnapshot("tournament", T("resetSnapshot.tournamentLabel"), {
          tournament: JSON.parse(JSON.stringify(TOURNAMENT))
        });
      }
      TOURNAMENT = null;
      saveTournamentToStorage(null);
      renderTournamentPage();
      renderRecoverDataList();
    };
    if (isDone) {
      clear();
    } else {
      confirmModal(T("confirm.abandonTournament"), clear);
    }
  }

  // Appends either a single name + rating badge + link icon (a solo
  // entrant - plus a small "(Team Name)" tag when this tournament isn't
  // playing as teams but the player's team was still noted at setup) or
  // the team label plus a compact member sub-list (each real member with
  // its own badge + link) - shared by every place a bracket entrant name
  // is shown, so ratings/links/"who's on this team" stay correct wherever
  // a team entrant appears.
  function appendEntrantIdentity(container, name, t) {
    var members = (t && t.entrantMembers && t.entrantMembers[name]) || [name];
    if (members.length <= 1) {
      container.appendChild(buildRatingBadge(name));
      container.appendChild(buildPlayerLinkIcon(name));
      var teamName = t && t.entrantTeamNames && t.entrantTeamNames[name];
      if (teamName) {
        var tag = document.createElement("span");
        tag.className = "tournament-match-team-tag";
        tag.textContent = "(" + teamName + ")";
        container.appendChild(tag);
      }
      return;
    }
    var sub = document.createElement("div");
    sub.className = "tournament-match-team-members";
    members.forEach(function (memberName, i) {
      if (i > 0) sub.appendChild(document.createTextNode(", "));
      sub.appendChild(document.createTextNode(memberName));
      sub.appendChild(buildRatingBadge(memberName));
      sub.appendChild(buildPlayerLinkIcon(memberName));
    });
    container.appendChild(sub);
  }

  // activeMatchId: either a single match id (string) or a set of them
  // ({id: true, ...}, one per table currently live) - a multi-table
  // event can have several matches "active" (is-active styling, no Play
  // button) at once, not just the one match ID this used to be.
  function tournamentMatchCard(match, activeMatchId, t) {
    var div = document.createElement("div");
    var isActive =
      typeof activeMatchId === "string" ? activeMatchId === match.id : !!(activeMatchId && activeMatchId[match.id]);
    var stateClass = match.winner ? "is-done" : isActive ? "is-active" : match.a && match.b ? "is-ready" : "is-pending";
    div.className = "tournament-match-card " + stateClass;

    // In the Grand Final, the two sides aren't symmetric the way every
    // other match is - one came in with zero losses (the winners-bracket
    // champion), the other already has one (the losers-bracket champion,
    // who has to beat them twice to take it). That's invisible from the
    // card alone, so it's called out directly on their name.
    var isGf = isGrandFinalMatch(t, match);
    // A structural bye (not enough real entrants to fill every round-1
    // slot, see buildWinnersBracketRounds) resolves with a winner but
    // only one real side - without calling that out explicitly, it
    // reads exactly like a phantom "already won without playing", which
    // is confusing on its own and especially so when several byes land
    // at once. Every OTHER empty side just means "not decided yet" and
    // still shows the plain em dash.
    var isByeMatch = !!match.winner && (match.a === null) !== (match.b === null);
    [match.a, match.b].forEach(function (name) {
      var row = document.createElement("div");
      row.className = "tournament-match-side";
      var isWinner = match.winner && name === match.winner;
      if (isWinner) row.classList.add("is-winner");
      if (match.winner && name === match.loser) row.classList.add("is-loser");
      row.textContent = (isWinner ? "👑 " : "") + (name || (isByeMatch ? T("tournament.byeLabel") : "—"));
      if (name) {
        appendEntrantIdentity(row, name, t);
        if (isGf && name === t.lbChampion) {
          var lbTag = document.createElement("span");
          lbTag.className = "tournament-match-lb-tag";
          lbTag.textContent = T("tournament.fromLosersBracket");
          row.appendChild(lbTag);
        }
      }
      div.appendChild(row);
    });

    // A multi-table event needs to tell players where to actually go
    // play, not just that they're up - only worth showing at all once
    // there's more than one table to choose between, and only for a
    // real, still-undecided match (a finished one just shows which
    // table it was on, if any, instead of a picker there's nothing left
    // to pick).
    if (t.tableCount > 1 && match.a && match.b) {
      if (match.winner) {
        if (match.table) {
          var tableDoneLabel = document.createElement("div");
          tableDoneLabel.className = "tournament-match-table-played";
          tableDoneLabel.textContent = T("tournament.tablePlayedOn", { table: match.table });
          div.appendChild(tableDoneLabel);
        }
      } else if (isActive) {
        // Locked once the game's actually underway - reassigning a
        // table mid-match is exactly the "wait, which table is this
        // again" confusion a table picker exists to prevent, not
        // something it should ever let happen.
        var tableLockedLabel = document.createElement("div");
        tableLockedLabel.className = "tournament-match-table-played";
        tableLockedLabel.textContent = T("tournament.tableOption", { table: match.table });
        div.appendChild(tableLockedLabel);
      } else {
        var tableRow = document.createElement("label");
        tableRow.className = "tournament-match-table-row";
        var tableRowSpan = document.createElement("span");
        tableRowSpan.textContent = T("tournament.tableLabel");
        var tableSelect = document.createElement("select");
        tableSelect.className = "tournament-match-table-select";
        var unassignedOpt = document.createElement("option");
        unassignedOpt.value = "";
        unassignedOpt.textContent = T("tournament.tableUnassigned");
        tableSelect.appendChild(unassignedOpt);
        for (var tableNum = 1; tableNum <= t.tableCount; tableNum++) {
          var tableOpt = document.createElement("option");
          tableOpt.value = String(tableNum);
          tableOpt.textContent = T("tournament.tableOption", { table: tableNum });
          if (match.table === tableNum) tableOpt.selected = true;
          tableSelect.appendChild(tableOpt);
        }
        tableSelect.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        tableSelect.addEventListener("change", function () {
          match.table = tableSelect.value ? parseInt(tableSelect.value, 10) : null;
          saveTournamentToStorage(t);
        });
        tableRow.appendChild(tableRowSpan);
        tableRow.appendChild(tableSelect);
        div.appendChild(tableRow);
      }
    }

    if (isByeMatch) {
      var byeNote = document.createElement("div");
      byeNote.className = "tournament-bye-note";
      byeNote.textContent = T("tournament.byeNote");
      div.appendChild(byeNote);
    } else if (isActive) {
      var playingNote = document.createElement("div");
      playingNote.className = "tournament-playing-note";
      playingNote.textContent = T("tournament.playingNow");
      div.appendChild(playingNote);
    } else if (match.a && match.b && !match.winner) {
      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn-primary tournament-play-btn";
      playBtn.textContent = T("tournament.play");
      playBtn.addEventListener("click", function () {
        startTournamentMatch(match.id);
      });
      div.appendChild(playBtn);
    }

    return div;
  }

  // "Final" for a 1-match round, "Semifinal" for 2, "Quarterfinal" for 4,
  // else "Round of N" (N = players entering that round) - derived purely
  // from how many matches are in the round, so it's automatically right
  // whether the bracket only ever has a Final, or goes all the way down
  // to a Quarterfinal (or further) when there are enough entrants.
  function wbRoundLabel(matchCount) {
    if (matchCount === 1) return T("tournament.roundFinal");
    if (matchCount === 2) return T("tournament.roundSemifinal");
    if (matchCount === 4) return T("tournament.roundQuarterfinal");
    return T("tournament.roundOfN", { n: matchCount * 2 });
  }

  // Renders the winners bracket as a real horizontal tree: round 1 on the
  // left, each pair of matches converging into the match they feed, all the
  // way to the final on the right. Built as nested "children + this round's
  // match" wrappers rather than flat columns — the connector lines are then
  // pure CSS (percentages against each pair's own wrapper), needing no
  // pixel measurement, because a 2-item "space-around" column always places
  // its items at exactly 25%/75% of the wrapper's height regardless of the
  // wrapper's actual size. Each card gets its own round-name label right
  // above it (see wbRoundLabel) since there's no single stable column to
  // hang one shared header off of in a nested-tree layout.
  function renderWbTreeNode(t, ri, mi, activeMatchId) {
    var match = t.wb[ri][mi];
    var card = tournamentMatchCard(match, activeMatchId, t);
    var wrap = document.createElement("div");
    wrap.className = "wb-tree-card-wrap";
    var heading = document.createElement("div");
    heading.className = "tournament-round-heading";
    heading.textContent = wbRoundLabel(t.wb[ri].length);
    wrap.appendChild(heading);
    wrap.appendChild(card);
    // A round-1 match is always a real leaf (two real players, no WB
    // history behind it). A pendingBye slot in a later round (see
    // buildWinnersBracketRounds) only ever has ONE real feeder, not
    // zero - t.wb[ri-1] simply has no SECOND match to recurse into for
    // it, so only that one side renders a child instead of two. Losing
    // that first feeder too (treating the whole node as a leaf the
    // moment either side is missing) would silently drop a real match -
    // and everything behind it - from the tree entirely.
    if (ri === 0) {
      wrap.classList.add("wb-tree-leaf");
      return wrap;
    }
    var hasLeftFeeder = mi * 2 < t.wb[ri - 1].length;
    var hasRightFeeder = mi * 2 + 1 < t.wb[ri - 1].length;
    if (!hasLeftFeeder && !hasRightFeeder) {
      wrap.classList.add("wb-tree-leaf");
      return wrap;
    }
    var childrenWrap = document.createElement("div");
    childrenWrap.className = "wb-tree-children";
    if (hasLeftFeeder) childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2, activeMatchId));
    if (hasRightFeeder) childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2 + 1, activeMatchId));

    var node = document.createElement("div");
    node.className = "wb-tree-node";
    node.appendChild(childrenWrap);
    node.appendChild(wrap);
    return node;
  }

  function renderWbTree(container, t, activeMatchId) {
    container.innerHTML = "";
    var lastRound = t.wb.length - 1;
    var root = renderWbTreeNode(t, lastRound, 0, activeMatchId);
    root.classList.add("wb-tree-root");
    container.appendChild(root);
  }

  function renderBracketColumns(container, rounds, activeMatchId, t) {
    container.innerHTML = "";
    if (!rounds.length) {
      var hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "—";
      container.appendChild(hint);
      return;
    }
    rounds.forEach(function (round, i) {
      var col = document.createElement("div");
      col.className = "tournament-round-col";
      var heading = document.createElement("div");
      heading.className = "tournament-round-heading";
      heading.textContent = round.length ? round[0].tag : "Round " + (i + 1);
      col.appendChild(heading);
      round.forEach(function (m) {
        col.appendChild(tournamentMatchCard(m, activeMatchId, t));
      });
      container.appendChild(col);
    });
  }

  // ---------- Losers bracket tree ----------
  // Unlike the winners bracket, a losers-bracket match's two feeders
  // aren't at a fixed position computable from round/index math - one
  // side is often a fresh winners-bracket drop-in, the other a survivor
  // from the previous losers round, and those two ages don't line up
  // into a clean symmetric tree. So every LB match is stamped at
  // creation time with the *actual* match objects that produced its two
  // sides (see createBracketMatch/pairUpNames in advanceBracket) and the
  // tree below is built by following those links directly, reusing the
  // exact same connector-line CSS as the winners tree (still always
  // exactly 2 children per node - a losers match never exists until both
  // of its feeders are known).

  // How many LB-match levels deep (from whichever frontier match is
  // currently the tree's root) stay expanded by default before folding
  // into a "+" stub - since the root itself is always whatever match
  // hasn't been consumed yet, this naturally slides forward as the
  // bracket plays out: each new round becomes the new depth-0 root, so
  // the round that used to be visible at the deepest level is exactly
  // the one that now falls past the threshold and collapses. Keyed by
  // match id so a manual expand survives this same match staying just
  // past the threshold on the next render, but forgets once that match
  // is no longer part of the tree at all (a fresh id per tournament, so
  // nothing carries over to the next one).
  var LB_TREE_VISIBLE_DEPTH = 3;
  var lbTreeExpandedNodes = {};

  function isLosersMatch(match) {
    return typeof match.tag === "string" && match.tag.indexOf("Losers") === 0;
  }

  // How many further LB-only levels exist below this match (0 if none of
  // its feeders are themselves LB matches) - used purely to word the
  // collapsed stub ("2 earlier rounds" vs "1 earlier round").
  function lbSubtreeDepth(match) {
    var a = match.feederA && isLosersMatch(match.feederA) ? lbSubtreeDepth(match.feederA) + 1 : 0;
    var b = match.feederB && isLosersMatch(match.feederB) ? lbSubtreeDepth(match.feederB) + 1 : 0;
    return Math.max(a, b);
  }

  function renderLbCollapsedStub(match, extraRounds) {
    var stub = document.createElement("button");
    stub.type = "button";
    stub.className = "wb-tree-card-wrap lb-tree-collapsed-stub wb-tree-leaf";
    var plus = document.createElement("div");
    plus.className = "lb-tree-collapsed-plus";
    plus.textContent = "➕";
    var label = document.createElement("div");
    label.className = "lb-tree-collapsed-label";
    label.textContent = T("tournament.lbTreeShowEarlier", { count: extraRounds + 1 });
    stub.appendChild(plus);
    stub.appendChild(label);
    stub.addEventListener("click", function () {
      lbTreeExpandedNodes[match.id] = true;
      renderTournamentActive();
    });
    return stub;
  }

  // A losers-bracket match is still "in progress" (not yet the frontier)
  // once some later match has consumed its winner as a feeder. What's
  // left after removing every match that's referenced as somebody else's
  // feeder is the current set of independent branches - there can be
  // several at once early on, only merging into one (the eventual LB
  // final) as the bracket plays out, so this can return more than one
  // match.
  function lbFrontierMatches(t) {
    var consumedIds = {};
    var all = [];
    t.lbRounds.forEach(function (rnd) {
      rnd.forEach(function (m) {
        all.push(m);
        if (m.feederA) consumedIds[m.feederA.id] = true;
        if (m.feederB) consumedIds[m.feederB.id] = true;
      });
    });
    return all.filter(function (m) {
      return !consumedIds[m.id];
    });
  }

  // A feeder is either another losers-bracket match (recurse into its
  // own tree) or the winners-bracket match this side just dropped out
  // of - shown as a compact stub naming who dropped and from where,
  // rather than a full duplicate of a card the winners tree already
  // shows in full elsewhere on the page. depth counts LB-match levels
  // from the current root, passed through to renderLbTreeNode so it can
  // decide whether this feeder is still past the visible window.
  function renderLbFeederNode(feeder, activeMatchId, t, depth) {
    if (isLosersMatch(feeder)) return renderLbTreeNode(feeder, activeMatchId, t, depth);
    var stub = document.createElement("div");
    stub.className = "wb-tree-card-wrap lb-tree-wb-stub";
    var heading = document.createElement("div");
    heading.className = "tournament-round-heading";
    heading.textContent = matchRoundLabel(t, feeder);
    var name = document.createElement("div");
    name.className = "lb-tree-wb-stub-name";
    name.textContent = "⬇ " + feeder.loser;
    stub.appendChild(heading);
    stub.appendChild(name);
    stub.classList.add("wb-tree-leaf");
    return stub;
  }

  function renderLbTreeNode(match, activeMatchId, t, depth) {
    if (depth >= LB_TREE_VISIBLE_DEPTH && !lbTreeExpandedNodes[match.id]) {
      return renderLbCollapsedStub(match, lbSubtreeDepth(match));
    }
    var card = tournamentMatchCard(match, activeMatchId, t);
    var wrap = document.createElement("div");
    wrap.className = "wb-tree-card-wrap";
    var heading = document.createElement("div");
    heading.className = "tournament-round-heading";
    heading.textContent = matchRoundLabel(t, match);
    wrap.appendChild(heading);
    wrap.appendChild(card);
    if (!match.feederA && !match.feederB) {
      wrap.classList.add("wb-tree-leaf");
      return wrap;
    }
    var childrenWrap = document.createElement("div");
    childrenWrap.className = "wb-tree-children";
    if (match.feederA) childrenWrap.appendChild(renderLbFeederNode(match.feederA, activeMatchId, t, depth + 1));
    if (match.feederB) childrenWrap.appendChild(renderLbFeederNode(match.feederB, activeMatchId, t, depth + 1));
    var node = document.createElement("div");
    node.className = "wb-tree-node";
    node.appendChild(childrenWrap);
    node.appendChild(wrap);
    return node;
  }

  function renderLbTree(container, t, activeMatchId) {
    container.innerHTML = "";
    var roots = lbFrontierMatches(t);
    if (!roots.length) {
      var hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "—";
      container.appendChild(hint);
      return;
    }
    roots.forEach(function (rootMatch) {
      var root = renderLbTreeNode(rootMatch, activeMatchId, t, 0);
      root.classList.add("wb-tree-root", "lb-tree-root");
      container.appendChild(root);
    });
  }

  // Which physical table a just-started match should occupy: its own
  // assigned table (see the per-match Table picker) when there's more
  // than one to choose from, otherwise always table 1 - a single-table
  // event never needed that picker in the first place, so it shouldn't
  // need one here either.
  function tournamentMatchTableOrDefault(match, t) {
    if (t.tableCount <= 1) return 1;
    return match.table || null;
  }

  function startTournamentMatch(matchId) {
    var t = TOURNAMENT;
    var match = findBracketMatchById(t, matchId);
    if (!match || match.winner) return;
    var table = tournamentMatchTableOrDefault(match, t);
    if (!table) {
      showToast(T("tournament.assignTableFirst"));
      return;
    }
    if (t.activeMatches.some(function (a) { return a.table === table; })) {
      showToast(T("tournament.tableAlreadyInUse", { table: table }));
      return;
    }
    var active = {
      matchId: matchId,
      table: table,
      aBalls: 0,
      bBalls: 0,
      aWins: 0,
      bWins: 0,
      startedAt: new Date().toISOString()
    };
    // Frozen for the life of this one match - a bracket match always
    // has a clean start (unlike the session's ongoing roster), so
    // there's no self-healing cache to maintain here, just a one-time
    // computation at the moment the two sides are actually known.
    if (t.fairRace) {
      var entrantMembersForRace = t.entrantMembers || {};
      var targets = computeFairRaceTargets(
        [
          { key: "a", rating: averageRating(entrantMembersForRace[match.a] || [match.a]) },
          { key: "b", rating: averageRating(entrantMembersForRace[match.b] || [match.b]) }
        ],
        t.raceTo
      );
      active.raceToA = targets.a;
      active.raceToB = targets.b;
    }
    t.activeMatches.push(active);
    // "All Tables" by default - the whole point of seeing every live
    // table is that starting one more of them shouldn't quietly narrow
    // the view down to just it.
    t.focusedTable = "all";
    saveTournamentToStorage(t);
    renderTournamentActive();
    // Tapping Play can happen from anywhere on a long bracket page (the
    // Ready to Play list, or a match card deep in the tree) - the score
    // itself renders into tournamentCurrentMatchPanel regardless of
    // where that tap came from, so jump there directly instead of
    // leaving whoever just started the match staring at wherever they
    // happened to be scrolled to.
    tournamentCurrentMatchPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // active: the specific t.activeMatches entry this board's +/- buttons
  // belong to (passed straight through from buildTournamentSidePanel,
  // which itself only ever renders for one particular table's board at
  // a time) - never inferred from "whichever table is focused right
  // now", so a stray tap can't land on the wrong table's score even if
  // focus changed a beat earlier.
  function tournamentAdjustScore(active, side, delta) {
    var t = TOURNAMENT;
    if (!t || !active) return;
    var match = findBracketMatchById(t, active.matchId);
    if (!match) return;
    var gameType = GAME_TYPES[t.gameType];
    var allowNegative = gameType.unit !== "rack";
    var ballsKey = side === "a" ? "aBalls" : "bBalls";
    var winsKey = side === "a" ? "aWins" : "bWins";
    var next = (active[ballsKey] || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    active[ballsKey] = next;

    var name = side === "a" ? match.a : match.b;
    var otherName = side === "a" ? match.b : match.a;
    var members = (t.entrantMembers && t.entrantMembers[name]) || [name];
    var player = getPlayer(getPlayerIdByName(members[0]));
    var voice = player ? player.voice : undefined;

    if (delta > 0 && next >= t.target) {
      active[winsKey] += 1;
      var startedMs = active.startedAt ? new Date(active.startedAt).getTime() : null;
      var durationMs = startedMs ? Math.max(0, Date.now() - startedMs) : null;
      recordTournamentRackWin(name, otherName, durationMs);
      active.aBalls = 0;
      active.bBalls = 0;
      active.startedAt = new Date().toISOString();
      playWinSound(voice);
      var raceToKey = side === "a" ? "raceToA" : "raceToB";
      var effectiveMatchRaceTo = t.fairRace && active[raceToKey] ? active[raceToKey] : t.raceTo;
      if (active[winsKey] >= effectiveMatchRaceTo) {
        var championAlreadyDecided = !!t.champion;
        reportBracketResult(t, match, name);
        if (!championAlreadyDecided && t.champion) {
          recordTournamentCompletion(t);
          playTournamentChampionSound();
        }
        var finishedIdx = t.activeMatches.indexOf(active);
        if (finishedIdx !== -1) t.activeMatches.splice(finishedIdx, 1);
        // Back to seeing every table once one of them just wrapped up -
        // never leave focus silently pointed at a table that no longer
        // has a game running.
        if (t.focusedTable === active.table) t.focusedTable = "all";
        saveTournamentToStorage(t);
        renderTournamentPage();
        showTournamentMatchWinPopup(t, match, name);
        return;
      }
    } else if (delta > 0) {
      playPositiveSound(voice);
    } else {
      playNegativeSound(voice);
    }
    saveTournamentToStorage(t);
    renderTournamentActiveMatch();
  }

  function buildTournamentSidePanel(name, side, balls, wins, t, active) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = name;
    appendEntrantIdentity(nameEl, name, t);
    panel.appendChild(nameEl);

    var raceToKey = side === "a" ? "raceToA" : "raceToB";
    var sideRaceTo = t.fairRace && active && active[raceToKey] ? active[raceToKey] : t.raceTo;
    panel.appendChild(buildStatMini(T("tournament.matchWins"), wins, wins >= sideRaceTo));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[t.gameType].label, target: t.target });
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = balls;
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    if (t.fairRace) panel.appendChild(buildFairRaceNote(sideRaceTo));

    var controls = document.createElement("div");
    controls.className = "ball-controls";
    var unit = GAME_TYPES[t.gameType].unit;
    var allowNegative = unit !== "rack";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove point for " + name);
    minusBtn.disabled = !allowNegative && balls <= 0;
    minusBtn.addEventListener("click", function () {
      tournamentAdjustScore(active, side, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + name);
    plusBtn.addEventListener("click", function () {
      tournamentAdjustScore(active, side, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    panel.appendChild(controls);

    return panel;
  }

  // A multi-table event can have one live match per table at once -
  // rendered as a stack of floating boards (see .tournament-floating-
  // board), only the focused one showing a real interactive scoreboard.
  // The others peek out from behind it as thin, tappable strips (their
  // own current score, but no +/- controls) purely so a table's game
  // can't be scored by mistake while looking at a different table's
  // board - tapping a peek (or picking it from the focus dropdown, once
  // there's more than one table live) is what brings it to the front.
  // Single-table events never have more than one entry in
  // t.activeMatches, so this collapses back to exactly the old
  // one-board-only behavior for them.
  // t.focusedTable now holds either a table number or the literal
  // string "all" - "all" is the default the moment there's more than
  // one table live (so a newly-started second match doesn't silently
  // vanish behind whichever table happened to be focused already), and
  // it's what a table's own game finishing falls back to as well.
  // There's deliberately no way to switch which board you're looking
  // at except this dropdown - not by tapping a board, since a stray tap
  // switching away mid-game was exactly the confusion this was meant to
  // avoid.
  function renderTournamentActiveMatch() {
    var t = TOURNAMENT;
    tournamentCurrentMatchPanel.innerHTML = "";
    if (!t || !t.activeMatches.length) return;
    var sorted = t.activeMatches.slice().sort(function (a, b) {
      return a.table - b.table;
    });
    if (t.focusedTable !== "all" && !sorted.some(function (a) { return a.table === t.focusedTable; })) {
      t.focusedTable = "all";
    }

    if (sorted.length > 1) {
      var focusRow = document.createElement("div");
      focusRow.className = "row tournament-table-focus-row";
      var focusLabel = document.createElement("label");
      focusLabel.setAttribute("for", "tournament-table-focus-select");
      focusLabel.textContent = T("tournament.selectTableLabel");
      var focusSelect = document.createElement("select");
      focusSelect.id = "tournament-table-focus-select";
      var allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = T("tournament.seeAllTables");
      if (t.focusedTable === "all") allOpt.selected = true;
      focusSelect.appendChild(allOpt);
      sorted.forEach(function (active) {
        var m = findBracketMatchById(t, active.matchId);
        var opt = document.createElement("option");
        opt.value = String(active.table);
        opt.textContent = T("tournament.tableOption", { table: active.table }) + (m ? " — " + m.a + " vs " + m.b : "");
        if (active.table === t.focusedTable) opt.selected = true;
        focusSelect.appendChild(opt);
      });
      focusSelect.addEventListener("change", function () {
        t.focusedTable = focusSelect.value === "all" ? "all" : parseInt(focusSelect.value, 10);
        saveTournamentToStorage(t);
        renderTournamentActiveMatch();
      });
      focusRow.appendChild(focusLabel);
      focusRow.appendChild(focusSelect);
      tournamentCurrentMatchPanel.appendChild(focusRow);
    }

    var toShow = t.focusedTable === "all" ? sorted : sorted.filter(function (a) {
      return a.table === t.focusedTable;
    });
    var stack = document.createElement("div");
    stack.className = "tournament-live-boards-stack" + (toShow.length > 1 ? " is-stacked" : "");
    toShow.forEach(function (active, idx) {
      stack.appendChild(buildTournamentFloatingBoard(active, t, idx));
    });
    tournamentCurrentMatchPanel.appendChild(stack);
  }

  function buildTournamentFloatingBoard(active, t, stackIndex) {
    var match = findBracketMatchById(t, active.matchId);
    var cardWrap = document.createElement("div");
    cardWrap.className = "tournament-floating-board";
    if (!match) return cardWrap;
    cardWrap.style.setProperty("--stack-index", String(stackIndex));

    var gameType = GAME_TYPES[t.gameType];
    var banner = document.createElement("div");
    banner.className = "now-playing-banner tournament-now-playing";
    // [Table number] [player vs player] [round] [game type], in that
    // order - table number only shown at all once there's more than
    // one to distinguish.
    var headerParts = [];
    if (t.tableCount > 1) headerParts.push(T("tournament.tableOption", { table: active.table }));
    headerParts.push(match.a + " vs " + match.b);
    headerParts.push(matchRoundLabel(t, match));
    headerParts.push(gameType.label);
    banner.textContent = headerParts.join(" — ");
    cardWrap.appendChild(banner);

    var board = document.createElement("div");
    board.className = "scoreboard";
    board.appendChild(buildTournamentSidePanel(match.a, "a", active.aBalls, active.aWins, t, active));
    board.appendChild(buildTournamentSidePanel(match.b, "b", active.bBalls, active.bWins, t, active));
    cardWrap.appendChild(board);
    return cardWrap;
  }

  // Standings ranked by match wins (most first); the name is only a
  // stable sort key for display order — a genuine tie in wins is
  // reflected by t.championNames holding more than one name once the
  // round robin is complete, not by anything in this ordering.
  function roundRobinStandingsRow(s, t) {
    var li = document.createElement("li");
    var isChampion = t.championNames && t.championNames.indexOf(s.name) !== -1;
    li.className = "tournament-rr-standings-row" + (isChampion ? " is-champion" : "");
    var name = document.createElement("span");
    name.className = "tournament-rr-standings-name";
    name.textContent = (isChampion ? "👑 " : "") + s.name;
    appendEntrantIdentity(name, s.name, t);
    var record = document.createElement("span");
    record.className = "tournament-rr-standings-record";
    record.textContent = s.wins + " win" + (s.wins === 1 ? "" : "s") + " / " + s.played + " played";
    li.appendChild(name);
    li.appendChild(record);
    return li;
  }

  // Same shape as roundRobinStandingsRow, plus a Buchholz figure - the
  // strength-of-schedule tiebreak that's meaningful in Swiss (where not
  // everyone plays everyone) but has no equivalent in Round Robin.
  function swissStandingsRow(s, t) {
    var li = document.createElement("li");
    var isChampion = t.championNames && t.championNames.indexOf(s.name) !== -1;
    li.className = "tournament-rr-standings-row" + (isChampion ? " is-champion" : "");
    var name = document.createElement("span");
    name.className = "tournament-rr-standings-name";
    name.textContent = (isChampion ? "👑 " : "") + s.name;
    appendEntrantIdentity(name, s.name, t);
    var record = document.createElement("span");
    record.className = "tournament-rr-standings-record";
    record.textContent =
      s.wins + " win" + (s.wins === 1 ? "" : "s") + " / " + s.played + " played · " + T("standings.buchholz", { count: s.buchholz });
    li.appendChild(name);
    li.appendChild(record);
    return li;
  }

  // Swiss has no bracket tree either, so like Round Robin it gets its own
  // board: a live standings list (wins/played/Buchholz) plus every round
  // played so far as its own labeled group of match cards - only the
  // latest round can ever have anything still pending (see
  // pendingSwissMatches), but every earlier round stays visible as a
  // record of what's already been played.
  function renderSwissBoard(t, activeMatchId) {
    tournamentSwissStandingsEl.innerHTML = "";
    swissStandings(t).forEach(function (s) {
      tournamentSwissStandingsEl.appendChild(swissStandingsRow(s, t));
    });

    tournamentSwissMatchesEl.innerHTML = "";
    t.rounds.forEach(function (round, i) {
      var col = document.createElement("div");
      col.className = "tournament-round-col";
      var heading = document.createElement("div");
      heading.className = "tournament-round-heading";
      heading.textContent = round.length ? round[0].tag : "Round " + (i + 1);
      col.appendChild(heading);
      round.forEach(function (m) {
        col.appendChild(tournamentMatchCard(m, activeMatchId, t));
      });
      tournamentSwissMatchesEl.appendChild(col);
    });
  }

  // Round Robin has no bracket tree to render, so it gets its own board:
  // a live standings list (ranked by match wins) plus every match as a
  // card (reusing tournamentMatchCard, which already renders pending/
  // active/done states generically) — unlike the bracket formats, this
  // shows every match at once since round robin has no round-by-round
  // progression gating which ones are "ready."
  function renderRoundRobinBoard(t, activeMatchId) {
    tournamentRrStandingsEl.innerHTML = "";
    roundRobinStandings(t).forEach(function (s) {
      tournamentRrStandingsEl.appendChild(roundRobinStandingsRow(s, t));
    });

    tournamentRrMatchesEl.innerHTML = "";
    t.matches.forEach(function (m) {
      tournamentRrMatchesEl.appendChild(tournamentMatchCard(m, activeMatchId, t));
    });
  }

  // A quick "you are here" stage tracker across the top of the bracket -
  // only shown once there's actually more than one stage to track (a
  // 2-3 entrant field is just a Final, nothing to get lost in). Stages
  // done so far are struck through, the current one is bold/accented,
  // everything after is dim.
  function renderTournamentTimeline(t) {
    tournamentTimelineEl.innerHTML = "";
    var isEliminationFormat = t.format === "single" || t.format === "double";
    if (!isEliminationFormat || t.wb.length < 2) {
      tournamentTimelineEl.classList.add("hidden");
      return;
    }
    tournamentTimelineEl.classList.remove("hidden");
    var stages = t.wb.map(function (round) {
      return wbRoundLabel(round.length);
    });
    if (t.format === "double") stages.push(T("tournament.grandFinal"));
    var currentIdx = stages.length - 1;
    for (var ri = 0; ri < t.wb.length; ri++) {
      var roundDone = t.wb[ri].every(function (m) {
        return !!m.winner;
      });
      if (!roundDone) {
        currentIdx = ri;
        break;
      }
    }
    if (t.champion) currentIdx = stages.length - 1;
    stages.forEach(function (label, i) {
      if (i > 0) {
        var arrow = document.createElement("span");
        arrow.className = "tournament-timeline-arrow";
        arrow.textContent = "→";
        tournamentTimelineEl.appendChild(arrow);
      }
      var stage = document.createElement("span");
      stage.className = "tournament-timeline-stage" + (i === currentIdx ? " is-current" : i < currentIdx ? " is-done" : "");
      stage.textContent = label;
      tournamentTimelineEl.appendChild(stage);
    });
  }

  function renderTournamentActive() {
    var t = TOURNAMENT;
    var activeMatchId = {};
    t.activeMatches.forEach(function (a) {
      activeMatchId[a.matchId] = true;
    });
    var isSingle = t.format === "single";
    var isRoundRobin = t.format === "roundrobin";
    var isSwiss = t.format === "swiss";

    tournamentWbSection.classList.toggle("hidden", isRoundRobin || isSwiss);
    tournamentLbSection.classList.toggle("hidden", isRoundRobin || isSingle || isSwiss);
    tournamentGfEl.classList.toggle("hidden", isRoundRobin || isSingle || isSwiss);
    tournamentRrSection.classList.toggle("hidden", !isRoundRobin);
    tournamentSwissSection.classList.toggle("hidden", !isSwiss);

    if (isRoundRobin) {
      renderRoundRobinBoard(t, activeMatchId);
    } else if (isSwiss) {
      renderSwissBoard(t, activeMatchId);
    } else {
      renderWbTree(tournamentWbEl, t, activeMatchId);
      if (!isSingle) {
        renderLbTree(tournamentLbEl, t, activeMatchId);
        renderBracketColumns(tournamentGfEl, t.grandFinal.length ? [t.grandFinal] : [], activeMatchId, t);
      }
    }

    renderTournamentTimeline(t);

    btnTournamentAbandon.textContent = T(t.champion ? "tournament.startNew" : "tournament.abandon");

    if (t.champion) {
      tournamentChampionBanner.classList.remove("hidden");
      var multipleChampions = !!(t.championNames && t.championNames.length > 1);
      tournamentChampionBanner.textContent =
        T(multipleChampions ? "tournament.tiedForTheWin" : "tournament.wonTheTournament", { champion: t.champion });
      (t.championNames || [t.champion]).forEach(function (name) {
        appendEntrantIdentity(tournamentChampionBanner, name, t);
      });
    } else {
      tournamentChampionBanner.classList.add("hidden");
      tournamentChampionBanner.textContent = "";
    }

    tournamentReadyList.innerHTML = "";
    tournamentCurrentMatchPanel.innerHTML = "";

    // A single-table event still shows only ONE live board and nothing
    // else once it's up, exactly like before. A multi-table event can
    // have several tables live at once, so a busy table (or several)
    // doesn't stop the Ready to Play list from also showing whatever's
    // still free to start on another one.
    renderTournamentActiveMatch();
    if (t.tableCount <= 1 && t.activeMatches.length) return;
    if (t.champion) return;

    var ready = pendingBracketMatches(t);
    if (t.activeMatches.length) {
      var busyMatchIds = {};
      t.activeMatches.forEach(function (a) {
        busyMatchIds[a.matchId] = true;
      });
      ready = ready.filter(function (m) {
        return !busyMatchIds[m.id];
      });
    }
    if (ready.length === 0) return;
    // Only a single-table event gets the "just start it" shortcut -
    // with one table there's never a real choice about where a match
    // should be played, so there's no reason to make someone tap Play
    // for it. A multi-table event always needs an explicit tap (it
    // picks up the match's assigned table, or asks for one).
    if (t.tableCount <= 1 && ready.length === 1) {
      startTournamentMatch(ready[0].id);
      return;
    }
    // Round Robin's and Swiss's Matches grids above already show every
    // pending match with its own Play button — no need for a second
    // "ready" list too.
    if (isRoundRobin || isSwiss) return;
    var heading = document.createElement("li");
    heading.className = "tournament-ready-heading";
    heading.textContent = T("tournament.readyToPlay", { count: ready.length });
    tournamentReadyList.appendChild(heading);
    ready.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "tournament-ready-row" + (isMarqueeTournamentMatch(t, m) ? " is-marquee" : "");
      var tag = document.createElement("span");
      tag.className = "tournament-ready-tag";
      tag.textContent = m.tag;
      var text = document.createElement("span");
      text.className = "tournament-ready-names";
      text.appendChild(document.createTextNode(m.a));
      appendEntrantIdentity(text, m.a, t);
      text.appendChild(document.createTextNode(" vs " + m.b));
      appendEntrantIdentity(text, m.b, t);
      li.appendChild(tag);
      li.appendChild(text);
      if (t.tableCount > 1) {
        var readyTableSelect = document.createElement("select");
        readyTableSelect.className = "tournament-match-table-select";
        var readyUnassignedOpt = document.createElement("option");
        readyUnassignedOpt.value = "";
        readyUnassignedOpt.textContent = T("tournament.tableUnassigned");
        readyTableSelect.appendChild(readyUnassignedOpt);
        for (var readyTableNum = 1; readyTableNum <= t.tableCount; readyTableNum++) {
          var readyTableOpt = document.createElement("option");
          readyTableOpt.value = String(readyTableNum);
          readyTableOpt.textContent = T("tournament.tableOption", { table: readyTableNum });
          if (m.table === readyTableNum) readyTableOpt.selected = true;
          readyTableSelect.appendChild(readyTableOpt);
        }
        readyTableSelect.addEventListener("change", function () {
          m.table = readyTableSelect.value ? parseInt(readyTableSelect.value, 10) : null;
          saveTournamentToStorage(t);
        });
        li.appendChild(readyTableSelect);
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = T("tournament.play");
      btn.addEventListener("click", function () {
        startTournamentMatch(m.id);
      });
      li.appendChild(btn);
      tournamentReadyList.appendChild(li);
    });
  }

  function renderTournamentPage() {
    if (TOURNAMENT) {
      tournamentSetupPanel.classList.add("hidden");
      tournamentActivePanel.classList.remove("hidden");
      renderTournamentActive();
    } else {
      tournamentActivePanel.classList.add("hidden");
      tournamentSetupPanel.classList.remove("hidden");
      renderTournamentPlayerChecklist();
      tournamentTargetUnit.textContent = GAME_TYPES[tournamentGameTypeSelect.value].unit;
    }
  }

  function openTournamentPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("tournament");
    renderTournamentPage();
    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    contactSheetPageView.classList.add("hidden");
    leaderboardPageView.classList.add("hidden");
    tournamentPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeTournamentPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    tournamentPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  // Combines two session records for the SAME calendar date. Games are
  // unioned by timestamp (so a game saved in both — e.g. by two separate
  // exports, or two devices' backups — counts once, not twice), and the
  // summary fields are rebuilt from that merged list so they stay accurate.
  function mergeTwoSessionsForSameDate(a, b) {
    var seen = {};
    var mergedGames = [];
    (a.games || []).concat(b.games || []).forEach(function (g) {
      if (!g || !g.ts || seen[g.ts]) return;
      seen[g.ts] = true;
      mergedGames.push(g);
    });
    mergedGames.sort(function (x, y) {
      return x.ts.localeCompare(y.ts);
    });
    var gamesWon = [];
    var opponentSet = {};
    var wins = 0;
    mergedGames.forEach(function (g) {
      if (g.result === "won") {
        wins += 1;
        gamesWon.push(g.gameLabel);
      }
      (g.opponentNames || []).forEach(function (n) {
        opponentSet[n] = true;
      });
    });
    return {
      date: a.date,
      wins: wins,
      gamesWon: gamesWon,
      opponents: Object.keys(opponentSet),
      games: mergedGames,
      wonTournament: !!(a.wonTournament || b.wonTournament)
    };
  }

  // Merges two full session lists (e.g. one player's locally-saved history
  // with the same player's history from an imported backup), combining any
  // sessions that land on the same date instead of one replacing the other.
  function mergeSessionLists(listA, listB) {
    var byDate = {};
    var order = [];
    (listA || []).concat(listB || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (byDate[s.date]) {
        byDate[s.date] = mergeTwoSessionsForSameDate(byDate[s.date], s);
      } else {
        byDate[s.date] = s;
        order.push(s.date);
      }
    });
    return order.map(function (d) {
      return byDate[d];
    });
  }

  function mergeSessionIntoList(sessions, live) {
    return mergeSessionLists(sessions, [live]);
  }

  function exportAllPlayerStats() {
    if (noStatsMode) return;
    state.players.forEach(function (p) {
      var live = computeLiveSessionForPlayer(p.name);
      if (!live || !live.games || live.games.length === 0) return;
      var sessions = mergeSessionIntoList(getPlayerSessions(p.name), live);
      setPlayerSessions(p.name, sessions);
      if (p.name === currentStatsPlayerName) currentStatsSessions = sessions;
    });
  }

  function exportCurrentPlayerStats() {
    var name = currentStatsPlayerName;
    if (!name) return;
    if (noStatsMode) {
      showToast(T("toast.noStatsModeNothingSaved"));
      return;
    }
    var live = computeLiveSessionForPlayer(name);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    currentStatsSessions = sessions;
    setPlayerSessions(name, sessions);
    renderPlayerHistoryList(sessions);
    renderPlayerSynopsis();
    showToast(T("toast.statsSaved", { name: name }));
  }

  function resetPlayerHistoricalStats() {
    var name = currentStatsPlayerName;
    if (!name) return;
    confirmModal(T("confirm.resetPlayerStats", { name: name }), function () {
      saveResetSnapshot("playerStats", T("resetSnapshot.playerStatsLabel", { name: name }), {
        name: name,
        sessions: JSON.parse(JSON.stringify(getPlayerSessions(name)))
      });
      currentStatsSessions = [];
      setPlayerSessions(name, []);
      renderPlayerHistoryList([]);
      renderPlayerSynopsis();
      renderRecoverDataList();
    });
  }

  // ---------------------------------------------------------------------
  // Events + Init (deferred until settings/game-types.json has loaded)
  // ---------------------------------------------------------------------

  function boot() {
  backfillMissingRatingsFromHistory();
  backfillMissingAddedDates();

  if (Purchases) {
    Purchases.isProUnlocked()
      .then(function (result) {
        if (!result) return;
        proUnlocked = !!result.unlocked;
        if (result.price) proPriceDisplay = result.price;
      })
      .catch(function () {
        console.warn("Could not check Pro entitlement.");
      });
  }

  btnExportAllData.addEventListener("click", function () {
    promptModal(T("backup.exportFilenamePrompt"), defaultBackupFilename(), function (name) {
      exportAllData(name);
    });
  });

  btnImportAllData.addEventListener("click", function () {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", function () {
    var file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (!file) return;
    importAllData(file);
  });

  btnExportSync.addEventListener("click", exportForSync);
  renderSyncStatusLine();

  btnResetAllPlayerStats.addEventListener("click", resetAllPlayerStats);
  btnResetRosterLists.addEventListener("click", resetAllRosterLists);
  btnResetAllRatings.addEventListener("click", resetAllPlayersOfficialRating);
  btnFullReset.addEventListener("click", performFullFactoryReset);

  btnFullResetStep2Yes.addEventListener("click", function () {
    closeFullResetStep2();
    exportAllData();
    var keysToRemove = [];
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf("poolMasterCounter.") === 0) keysToRemove.push(key);
    }
    keysToRemove.forEach(function (key) {
      localStorage.removeItem(key);
    });
    // The backup download is a same-tick <a>.click(), which some
    // browsers need a beat to actually start before navigation - see
    // downloadJSON/exportAllData above.
    setTimeout(function () {
      location.reload();
    }, 400);
  });
  btnFullResetStep2ByDates.addEventListener("click", function () {
    closeFullResetStep2();
    openDeleteByDatePicker();
  });
  btnFullResetStep2Cancel.addEventListener("click", closeFullResetStep2);
  fullResetStep2Overlay.addEventListener("click", function (e) {
    if (e.target === fullResetStep2Overlay) closeFullResetStep2();
  });

  btnDeleteByDatePrevMonth.addEventListener("click", function () {
    deleteByDateViewMonth = new Date(deleteByDateViewMonth.getFullYear(), deleteByDateViewMonth.getMonth() - 1, 1);
    renderDeleteByDateCalendar();
  });
  btnDeleteByDateNextMonth.addEventListener("click", function () {
    deleteByDateViewMonth = new Date(deleteByDateViewMonth.getFullYear(), deleteByDateViewMonth.getMonth() + 1, 1);
    renderDeleteByDateCalendar();
  });
  btnDeleteByDateConfirm.addEventListener("click", confirmDeleteByDateSelection);
  btnDeleteByDateCancel.addEventListener("click", closeDeleteByDatePicker);
  deleteByDateOverlay.addEventListener("click", function (e) {
    if (e.target === deleteByDateOverlay) closeDeleteByDatePicker();
  });
  btnResetSessionTournament.addEventListener("click", resetSessionAndTournament);

  btnRecoverImportFile.addEventListener("click", function () {
    recoverImportFileInput.click();
  });
  recoverImportFileInput.addEventListener("change", function () {
    var file = recoverImportFileInput.files && recoverImportFileInput.files[0];
    recoverImportFileInput.value = "";
    if (!file) return;
    importFileForRecovery(file);
  });
  btnRecoverRestore.addEventListener("click", restoreCheckedFromSnapshot);
  btnRecoverCancel.addEventListener("click", closeRecoverDetail);
  recoverDetailOverlay.addEventListener("click", function (e) {
    if (e.target === recoverDetailOverlay) closeRecoverDetail();
  });

  btnRatingEditSave.addEventListener("click", saveRatingEditPopup);
  btnRatingEditCancel.addEventListener("click", closeRatingEditPopup);
  ratingEditOverlay.addEventListener("click", function (e) {
    if (e.target === ratingEditOverlay) closeRatingEditPopup();
  });
  wireNotifyCheckbox(ratingEditEmailInput, ratingEditPhoneInput, ratingEditNotifyCheckbox, ratingEditNotifyMethodRow);
  wirePhoneFormatting(ratingEditPhoneInput);
  checkRatingEditEmailValidity = wireFieldValidity(ratingEditEmailInput, isValidEmail);
  checkRatingEditPhoneValidity = wireFieldValidity(ratingEditPhoneInput, isValidPhoneNumber);

  btnExportRosterLists.addEventListener("click", exportRosterLists);
  btnExportRosterListsCsv.addEventListener("click", function () {
    var filename = "pool-master-counter-player-lists-" + todayDateStr() + ".csv";
    downloadTextFile(filename, buildRosterListsCsv(), "text/csv;charset=utf-8");
  });

  btnImportRosterLists.addEventListener("click", function () {
    importRosterListsFileInput.click();
  });

  importRosterListsFileInput.addEventListener("change", function () {
    var file = importRosterListsFileInput.files && importRosterListsFileInput.files[0];
    importRosterListsFileInput.value = "";
    if (!file) return;
    importRosterListsFile(file);
  });

  newPlayerName.addEventListener("input", validateNewPlayerNameInput);

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var trimmed = newPlayerName.value.trim();
    if (!trimmed || isDuplicatePlayerName(trimmed)) {
      validateNewPlayerNameInput();
      return;
    }
    var starting = parseStartingRatingInput(newPlayerRatingInput);
    // Only worth a heads-up if they typed something other than the
    // prefilled default - leaving it at 400 is indistinguishable from
    // not touching it, so it shouldn't warn on every re-add of an
    // already-rated name the way an explicit custom number should.
    var alreadyRated = starting !== null && starting !== DEFAULT_RATING && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(newPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    newPlayerName.value = "";
    newPlayerRatingInput.value = String(DEFAULT_RATING);
    validateNewPlayerNameInput();
    renderAll();
    if (alreadyRated) showToast(player.name + " already has a tracked rating — starting rating not applied.");
  });

  gameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[gameTypeSelect.value];
    state.currentGame.gameType = gameTypeSelect.value;
    state.currentGame.target = type.defaultTarget;
    state.currentGame.unit = type.unit;
    gameTargetInput.value = type.defaultTarget;
    gameTargetUnitSelect.value = type.unit;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
    tickShotCounter();
  });

  gameTargetInput.addEventListener("input", function () {
    var target = parseInt(gameTargetInput.value, 10);
    if (!target || target < 1) return;
    state.currentGame.target = target;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
  });

  gameTargetUnitSelect.addEventListener("change", function () {
    state.currentGame.unit = gameTargetUnitSelect.value;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
    tickShotCounter();
  });

  shotCounterEnabledCheckbox.addEventListener("change", function () {
    state.currentGame.shotCounterEnabled = shotCounterEnabledCheckbox.checked;
    if (shotCounterEnabledCheckbox.checked) {
      shotCounterHidden = false;
      state.currentGame.shotCounterHidden = false;
    }
    saveState();
    shotCounterBeepRow.classList.toggle("hidden", !shotCounterEnabledCheckbox.checked);
    if (shotCounterEnabledCheckbox.checked) startShotCounter();
    else stopShotCounter();
  });

  shotCounterBeepInput.addEventListener("input", function () {
    var sec = parseInt(shotCounterBeepInput.value, 10);
    if (!sec || sec < 5) return;
    state.currentGame.shotCounterBeepSec = Math.min(600, sec);
    saveState();
  });

  document.getElementById("shot-counter-widget").addEventListener("click", toggleShotCounterPause);

  btnShotCounterToggleVisibility.addEventListener("click", toggleShotCounterVisibility);
  document.getElementById("shot-counter-visibility-toggle").addEventListener("click", toggleShotCounterVisibility);

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      state.currentGame.mode = radio.value;
      saveState();
      renderAll();
      updateCurrentGameSummary();
    });
  });

  // Turning queue mode on caps individual play at exactly 2 seated: keep
  // the first 2 currently-playing players as-is, bench any extras onto
  // the back of the queue, then (if fewer than 2 ended up seated - e.g.
  // only 0 or 1 were playing to begin with) pull straight from the
  // queue's front to fill the empty seat(s), so the table is never left
  // short a player just from checking the box. Turning it back off
  // leaves state.queue alone (harmless while unused) so the order is
  // remembered if it's re-enabled later.
  queueModeCheckbox.addEventListener("change", function () {
    state.currentGame.queueEnabled = queueModeCheckbox.checked;
    if (queueModeCheckbox.checked) {
      var seated = activePlayers();
      seated.slice(2).forEach(function (p) {
        p.playing = false;
        p.balls = 0;
      });
      var queue = effectiveQueue();
      while (activePlayers().length < 2 && queue.length > 0) {
        var nextUp = queue.shift();
        nextUp.playing = true;
        nextUp.balls = 0;
      }
      saveQueue(queue);
    }
    saveState();
    renderAll();
  });

  noStatsCheckbox.addEventListener("change", function () {
    noStatsMode = noStatsCheckbox.checked;

    // Unchecking it is the only way out of Quick Counter once you're in
    // Focus Mode (every other control is hidden there) — without this,
    // the scoreboard kept the bare point tally while the rest of the app
    // (Games Rotations, Current Game) still showed the real rotation/target as
    // if it were in effect, which is exactly the mismatch this fixes.
    if (!noStatsCheckbox.checked && quickCounterMode) {
      quickCounterMode = false;
      resetGameBalls();
      applyRotationIfDue();
      saveState();
      renderAll();
      updateCurrentGameSummary();
      showToast(T("toast.backToNormalGame"));
      return;
    }

    showToast(
      noStatsMode
        ? "No Statistic mode is on — nothing from here on will be saved."
        : "No Statistic mode is off — games will be tracked normally again."
    );
  });

  raceToWinsInput.addEventListener("input", function () {
    var target = parseInt(raceToWinsInput.value, 10);
    if (!target || target < 1) return;
    state.raceToWinsTarget = target;
    // The anchor value just changed - drop the cached fair targets so
    // they're recomputed against it immediately instead of waiting for
    // the active roster to also happen to change.
    state.fairRaceTargets = null;
    saveState();
    renderScoreboard();
    renderStandings();
    updateCurrentGameSummary();
  });

  fairRaceEnabledCheckbox.addEventListener("change", function () {
    state.fairRaceEnabled = fairRaceEnabledCheckbox.checked;
    state.fairRaceTargets = null;
    saveState();
    renderScoreboard();
    renderStandings();
    updateCurrentGameSummary();
  });

  btnResetGame.addEventListener("click", resetCurrentGame);
  btnUndoWin.addEventListener("click", function () {
    undoLastWin();
  });
  btnShare.addEventListener("click", shareStandings);
  btnExportSession.addEventListener("click", function () {
    exportSession();
    exportAllPlayerStats();
  });

  rotationEnabledCheckbox.addEventListener("change", function () {
    state.rotation.enabled = rotationEnabledCheckbox.checked;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  });

  btnRotationPositionPrev.addEventListener("click", function () {
    moveRotationPosition(-1);
  });
  btnRotationPositionNext.addEventListener("click", function () {
    moveRotationPosition(1);
  });

  rotationAddType.addEventListener("change", function () {
    var type = GAME_TYPES[rotationAddType.value];
    if (!type) return;
    rotationAddTarget.value = type.defaultTarget;
    rotationAddUnit.value = type.unit;
  });

  btnRotationAdd.addEventListener("click", function () {
    var target = parseInt(rotationAddTarget.value, 10) || 1;
    addRotationItem(rotationAddType.value, target, rotationAddUnit.value);
  });

  rotationEveryInput.addEventListener("input", function () {
    var v = parseInt(rotationEveryInput.value, 10);
    if (!v || v < 1) return;
    state.rotation.every = v;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  });

  btnMilestoneClose.addEventListener("click", closeMilestone);
  btnMilestoneUndo.addEventListener("click", undoTournamentWinFromMilestoneOverlay);
  milestoneOverlay.addEventListener("click", function (e) {
    if (e.target === milestoneOverlay) closeMilestone();
  });

  btnTournamentMatchWinClose.addEventListener("click", closeTournamentMatchWinPopup);
  tournamentMatchWinOverlay.addEventListener("click", function (e) {
    if (e.target === tournamentMatchWinOverlay) closeTournamentMatchWinPopup();
  });

  btnGamewinClose.addEventListener("click", closeGameWinOverlay);
  btnGamewinUndo.addEventListener("click", undoWinFromGameWinOverlay);
  gamewinOverlay.addEventListener("click", function (e) {
    if (e.target === gamewinOverlay) closeGameWinOverlay();
  });

  btnForceResetClose.addEventListener("click", closeForceResetNotice);
  forceResetOverlay.addEventListener("click", function (e) {
    if (e.target === forceResetOverlay) closeForceResetNotice();
  });

  btnResetTodayStats.addEventListener("click", resetTodayStats);

  btnOnHillClose.addEventListener("click", closeOnHill);
  onHillOverlay.addEventListener("click", function (e) {
    if (e.target === onHillOverlay) closeOnHill();
  });

  btnGameChangeClose.addEventListener("click", closeGameChange);
  gameChangeOverlay.addEventListener("click", function (e) {
    if (e.target === gameChangeOverlay) closeGameChange();
  });

  btnSaveSessionSave.addEventListener("click", function () {
    exportSession();
    exportAllPlayerStats();
    closeSaveSessionPopup();
    startNewSession(true);
    endTournamentSilently();
  });
  btnSaveSessionSkip.addEventListener("click", function () {
    // "Skip" never folded this session into PLAYER_STATS (that's what
    // "Save" does via exportAllPlayerStats) - the only thing about to be
    // lost is the live gameHistory/win tallies, so snapshot just those.
    if (state.gameHistory.length) {
      saveResetSnapshot("todayStats", T("resetSnapshot.sessionSkipLabel", { date: todayDateStr() }), {
        date: todayDateStr(),
        prunedSessions: {},
        gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins)),
        ratingHistory: {}
      });
    }
    closeSaveSessionPopup();
    startNewSession(false);
    endTournamentSilently();
  });
  btnSaveSessionCancel.addEventListener("click", closeSaveSessionPopup);
  saveSessionOverlay.addEventListener("click", function (e) {
    if (e.target === saveSessionOverlay) closeSaveSessionPopup();
  });

  btnRosterLoad.addEventListener("click", loadSelectedRoster);
  btnRotationLoad.addEventListener("click", loadSelectedRotation);

  btnOpenHelpButtons.forEach(function (btn) {
    if (btn) btn.addEventListener("click", openHelp);
  });
  btnHelpClose.addEventListener("click", closeHelp);
  document.addEventListener("click", hideGraphTooltip);
  document.addEventListener("scroll", hideGraphTooltip, true);
  unlockAudioOnFirstInteraction();
  helpOverlay.addEventListener("click", function (e) {
    if (e.target === helpOverlay) closeHelp();
  });
  Array.prototype.forEach.call(helpNavLinks, function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var targetId = a.getAttribute("href").slice(1);
      Array.prototype.forEach.call(helpNavLinks, function (link) {
        link.classList.toggle("is-active", link === a);
      });
      scrollHelpToSection(targetId);
    });
  });

  btnTestOnboarding.addEventListener("click", openOnboarding);
  btnOpenWizard.addEventListener("click", openWizard);
  btnWizardClose.addEventListener("click", closeWizard);
  btnWizardCancel.addEventListener("click", closeWizard);
  wizardOverlay.addEventListener("click", function (e) {
    if (e.target === wizardOverlay) closeWizard();
  });
  btnWizardBack.addEventListener("click", wizardBack);
  btnWizardNext.addEventListener("click", wizardNext);
  btnWizardStart.addEventListener("click", finalizeWizardAndStart);
  wizardTempCounterCheckbox.addEventListener("change", function () {
    btnWizardStartQuickCounter.classList.toggle("hidden", !wizardTempCounterCheckbox.checked);
  });
  btnWizardStartQuickCounter.addEventListener("click", startQuickCounter);

  btnOnboardingCancel.addEventListener("click", closeOnboarding);
  btnOnboardingGo.addEventListener("click", advanceOnboarding);
  onboardingNameInput.addEventListener("input", validateOnboardingNameInput);
  wireNotifyCheckbox(onboardingEmailInput, onboardingPhoneInput, onboardingReportOptInCheckbox, onboardingNotifyMethodRow);
  wirePhoneFormatting(onboardingPhoneInput);
  checkOnboardingEmailValidity = wireFieldValidity(onboardingEmailInput, isValidEmail);
  checkOnboardingPhoneValidity = wireFieldValidity(onboardingPhoneInput, isValidPhoneNumber);
  btnOnboardingRunWizard.addEventListener("click", function () {
    closeOnboarding();
    openWizard();
  });
  btnOnboardingManual.addEventListener("click", closeOnboarding);

  Array.prototype.forEach.call(wizardFormatRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      wizardFormat = radio.value;
      wizardRaceToRow.classList.toggle("hidden", wizardFormat !== "raceto");
    });
  });

  wizardNewPlayerName.addEventListener("input", validateWizardNewPlayerNameInput);

  wizardAddPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var trimmed = wizardNewPlayerName.value.trim();
    if (!trimmed || isDuplicatePlayerName(trimmed)) {
      validateWizardNewPlayerNameInput();
      return;
    }
    var starting = parseStartingRatingInput(wizardNewPlayerRatingInput);
    var alreadyRated = starting !== null && starting !== DEFAULT_RATING && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(wizardNewPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    wizardNewPlayerName.value = "";
    wizardNewPlayerRatingInput.value = String(DEFAULT_RATING);
    validateWizardNewPlayerNameInput();
    renderAll();
    if (alreadyRated) showToast(player.name + " already has a tracked rating — starting rating not applied.");
  });

  btnWizardRosterLoad.addEventListener("click", loadSelectedWizardRoster);

  Array.prototype.forEach.call(wizardRotationEnabledRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      var on = radio.value === "yes";
      state.rotation.enabled = on;
      saveState();
      wizardRotationDetail.classList.toggle("hidden", !on);
      applyRotationIfDue();
      renderRotation();
      renderWizardIfOpen();
    });
  });

  btnWizardRotationLoad.addEventListener("click", loadSelectedWizardRotation);

  wizardRotationAddType.addEventListener("change", function () {
    var type = GAME_TYPES[wizardRotationAddType.value];
    if (!type) return;
    wizardRotationAddTarget.value = type.defaultTarget;
    wizardRotationAddUnit.value = type.unit;
  });

  btnWizardRotationAdd.addEventListener("click", function () {
    var target = parseInt(wizardRotationAddTarget.value, 10) || 1;
    addRotationItem(wizardRotationAddType.value, target, wizardRotationAddUnit.value);
  });

  wizardRotationEveryInput.addEventListener("input", function () {
    var v = parseInt(wizardRotationEveryInput.value, 10);
    if (!v || v < 1) return;
    state.rotation.every = v;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderWizardIfOpen();
  });

  wireCollapsiblePanel("backup-panel", "btn-toggle-backup-panel");
  wireCollapsiblePanel("rotation-panel", "btn-toggle-rotation-panel");
  wireCollapsiblePanel("game-setup-panel", "btn-toggle-game-setup-panel");
  wireCollapsiblePanel("players-panel", "btn-toggle-players-panel");
  wireCollapsiblePanel("standings-panel", "btn-toggle-standings-panel");
  wireCollapsiblePanel("history-panel", "btn-toggle-history-panel");
  wireCollapsiblePanel("day-notes-panel", "btn-toggle-day-notes-panel");
  wireCollapsiblePanel("report-archive-panel", "btn-toggle-report-archive-panel");
  wireCollapsiblePanel("resets-panel", "btn-toggle-resets-panel");
  wireCollapsiblePanel("focus-players-wrap", "btn-toggle-focus-players");
  wireCollapsiblePanel("player-page-h2h-panel", "btn-toggle-player-page-h2h-panel");
  wireCollapsiblePanel("player-page-teams-panel", "btn-toggle-player-page-teams-panel");
  wireCollapsiblePanel("player-page-achievements-panel", "btn-toggle-player-page-achievements-panel");

  var dayNotesSaveTimer = null;
  dayNotesTextarea.addEventListener("input", function () {
    clearTimeout(dayNotesSaveTimer);
    dayNotesSaveTimer = setTimeout(function () {
      setDayNotes(todayDateStr(), dayNotesTextarea.value);
      updateDayNotesSummary();
    }, 500);
  });

  dayReportFormatSelect.value = dayReportFormat;
  dayReportFormatSelect.addEventListener("change", function () {
    dayReportFormat = dayReportFormatSelect.value;
    saveDayReportFormat(dayReportFormat);
  });

  btnDayReportCopy.addEventListener("click", function () {
    copyReportToClipboard(buildDayReportText(todayDateStr()));
  });

  btnDayReportEmail.addEventListener("click", function () {
    var text = buildDayReportTextForSharing(todayDateStr());
    function openEmailCompose() {
      var to = reportOptedInContacts("email")
        .map(function (c) {
          return encodeURIComponent(c.contact.email);
        })
        .join(",");
      window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent("Pool Master Counter — Day Report") + "&body=" + encodeURIComponent(text);
    }
    if (dayReportAttachBackupCheckbox.checked || dayReportAttachColorfulCheckbox.checked) {
      // If the share sheet can't actually deliver the attachment(s) (see
      // shareReportWithAttachments' onFallback), still compose the email
      // exactly like the unchecked path would - a broken share sheet on
      // this device shouldn't mean Email Report does literally nothing.
      shareReportWithAttachments(text, openEmailCompose);
      return;
    }
    openEmailCompose();
  });

  btnDayReportSms.addEventListener("click", function () {
    var text = buildDayReportTextForSharing(todayDateStr());
    function openSmsCompose() {
      var to = reportOptedInContacts("sms")
        .map(function (c) {
          return encodeURIComponent(c.contact.phone);
        })
        .join(",");
      window.location.href = "sms:" + to + "&body=" + encodeURIComponent(text);
    }
    if (dayReportAttachBackupCheckbox.checked || dayReportAttachColorfulCheckbox.checked) {
      shareReportWithAttachments(text, openSmsCompose);
      return;
    }
    openSmsCompose();
  });

  dayReportAttachBackupCheckbox.checked = loadDayReportAttachBackup();
  dayReportAttachBackupCheckbox.addEventListener("change", function () {
    saveDayReportAttachBackup(dayReportAttachBackupCheckbox.checked);
    updateDayReportRecipientsLine();
  });

  dayReportAttachColorfulCheckbox.checked = loadDayReportAttachColorful();
  dayReportAttachColorfulCheckbox.addEventListener("change", function () {
    if (dayReportAttachColorfulCheckbox.checked) {
      dayReportAttachColorfulCheckbox.checked = false;
      requireProOrShowPaywall(function () {
        dayReportAttachColorfulCheckbox.checked = true;
        saveDayReportAttachColorful(true);
        updateDayReportRecipientsLine();
      });
      return;
    }
    saveDayReportAttachColorful(false);
    updateDayReportRecipientsLine();
  });

  btnDayReportShareBackup.addEventListener("click", shareReport);

  btnDayReportCsv.addEventListener("click", function () {
    var filename = "pool-master-counter-day-report-" + todayDateStr() + ".csv";
    downloadTextFile(filename, buildDayReportCsv(todayDateStr()), "text/csv;charset=utf-8");
  });

  btnDayReportPrint.addEventListener("click", function () {
    renderDayReportPrintView(todayDateStr());
    dayReportPrintView.classList.remove("hidden");
    window.print();
  });
  window.addEventListener("afterprint", function () {
    dayReportPrintView.classList.add("hidden");
  });

  btnDayReportColorful.addEventListener("click", function () {
    requireProOrShowPaywall(openDayReportColorful);
  });

  btnPlayerPageExport.addEventListener("click", exportCurrentPlayerStats);
  btnPlayerPageCsv.addEventListener("click", function () {
    if (!currentStatsPlayerName) return;
    var filename = "pool-master-counter-player-stats-" + currentStatsPlayerName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + todayDateStr() + ".csv";
    downloadTextFile(filename, buildPlayerStatsCsv(), "text/csv;charset=utf-8");
  });
  btnPlayerPageReset.addEventListener("click", resetPlayerHistoricalStats);
  btnPlayerPageBack.addEventListener("click", function () {
    closePlayerStatsPage();
  });
  btnReturnToGlobalStats.addEventListener("click", returnToGlobalStats);
  playerPageSwitcher.addEventListener("change", function () {
    if (playerPageSwitcher.value && playerPageSwitcher.value !== currentStatsPlayerName) {
      openPlayerStatsPage(playerPageSwitcher.value);
    }
  });

  btnOpenAllPlayers.addEventListener("click", function () {
    openAllPlayersPage();
  });
  btnAllPlayersBack.addEventListener("click", function () {
    closeAllPlayersPage();
  });
  allPlayersSortSelect.addEventListener("change", renderAllPlayersPage);
  allPlayersPeriodSelect.addEventListener("change", renderAllPlayersPage);
  btnToggleAllPlayersView.addEventListener("click", function () {
    allPlayersViewMode = allPlayersViewMode === "bars" ? "graph" : "bars";
    btnToggleAllPlayersView.textContent = T(allPlayersViewMode === "graph" ? "allPlayers.seeAsBars" : "allPlayers.seeAsGraph");
    renderAllPlayersPage();
  });
  btnToggleRosterFilter.addEventListener("click", function () {
    allPlayersRosterOnly = !allPlayersRosterOnly;
    btnToggleRosterFilter.classList.toggle("is-active", allPlayersRosterOnly);
    btnToggleRosterFilter.textContent = T(allPlayersRosterOnly ? "allPlayers.showingRosterOnly" : "allPlayers.rosterOnly");
    renderAllPlayersPage();
  });
  btnAllPlayersCsv.addEventListener("click", function () {
    var filename = "pool-master-counter-all-players-" + todayDateStr() + ".csv";
    downloadTextFile(filename, buildAllPlayersCsv(), "text/csv;charset=utf-8");
  });

  btnOpenGlobalStats.addEventListener("click", function () {
    openAllPlayersPage();
  });

  btnOpenContactSheet.addEventListener("click", function () {
    openContactSheetPage();
  });
  btnContactSheetBack.addEventListener("click", function () {
    closeContactSheetPage();
  });

  btnOpenLeaderboard.addEventListener("click", function () {
    openLeaderboardPage();
  });
  btnLeaderboardBack.addEventListener("click", function () {
    closeLeaderboardPage();
  });
  btnLeaderboardPlay.addEventListener("click", function () {
    closeLeaderboardPage();
  });
  btnContactSheetSelectAll.addEventListener("click", function () {
    var names = contactSheetAllNames();
    var allSelected = names.length > 0 && names.every(function (n) {
      return !!contactSheetSelected[n];
    });
    contactSheetSelected = {};
    if (!allSelected) {
      names.forEach(function (n) {
        contactSheetSelected[n] = true;
      });
    }
    renderContactSheetPage();
  });
  btnContactSheetImportRosters.addEventListener("click", importRosterNamesIntoContacts);
  btnContactSheetImportJson.addEventListener("click", function () {
    contactSheetImportJsonFileInput.click();
  });
  contactSheetImportJsonFileInput.addEventListener("change", function () {
    var file = contactSheetImportJsonFileInput.files && contactSheetImportJsonFileInput.files[0];
    contactSheetImportJsonFileInput.value = "";
    if (file) importContactsJsonFile(file);
  });
  btnContactSheetExportJson.addEventListener("click", exportContactsToJson);
  btnContactSheetVcard.addEventListener("click", exportSelectedToAddressBook);
  btnContactSheetEmail.addEventListener("click", function () {
    composeToSelectedContacts("email");
  });
  btnContactSheetSms.addEventListener("click", function () {
    composeToSelectedContacts("sms");
  });

  btnOpenTournament.addEventListener("click", function () {
    openTournamentPage();
  });
  btnTournamentBack.addEventListener("click", function () {
    closeTournamentPage();
  });
  btnTournamentStart.addEventListener("click", startTournament);
  Array.prototype.forEach.call(tournamentSeedModeRadios, function (radio) {
    radio.addEventListener("change", function () {
      var show = isTournamentSeededManually();
      Array.prototype.forEach.call(tournamentPlayerChecklist.querySelectorAll(".tournament-seed-input"), function (input) {
        input.classList.toggle("hidden", !show);
      });
    });
  });

  // The long per-format explanation lives in a hidden sibling <span>
  // (data-info-target) so it stays in the normal i18n flow while the
  // visible radio row itself only shows a short name - "?" pops it into
  // this shared little popup instead. Picking "Yes, this format" just
  // checks the radio the popup was opened from; nothing else reads a
  // "change" event off these radios (see startTournament), so no event
  // needs dispatching.
  Array.prototype.forEach.call(document.querySelectorAll(".format-info-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.closest("label");
      var radio = label ? label.querySelector('input[type="radio"]') : null;
      var textEl = document.getElementById(btn.getAttribute("data-info-target"));
      var titleEl = document.getElementById(btn.getAttribute("data-info-title"));
      if (!radio || !textEl) return;
      tournamentFormatInfoPendingRadio = radio;
      tournamentFormatInfoTitle.textContent = titleEl ? titleEl.textContent : "";
      tournamentFormatInfoBody.textContent = textEl.textContent;
      tournamentFormatInfoOverlay.classList.remove("hidden");
    });
  });
  btnTournamentFormatInfoSelect.addEventListener("click", function () {
    if (tournamentFormatInfoPendingRadio) tournamentFormatInfoPendingRadio.checked = true;
    tournamentFormatInfoPendingRadio = null;
    tournamentFormatInfoOverlay.classList.add("hidden");
  });
  btnTournamentFormatInfoCancel.addEventListener("click", function () {
    tournamentFormatInfoPendingRadio = null;
    tournamentFormatInfoOverlay.classList.add("hidden");
  });
  tournamentFormatInfoOverlay.addEventListener("click", function (e) {
    if (e.target !== tournamentFormatInfoOverlay) return;
    tournamentFormatInfoPendingRadio = null;
    tournamentFormatInfoOverlay.classList.add("hidden");
  });
  tournamentPlayerChecklist.addEventListener("change", refreshTournamentTeamUi);
  tournamentPlayerChecklist.addEventListener("input", refreshTournamentTeamUi);
  tournamentTeamsEnabledCheckbox.addEventListener("change", renderTournamentTeamPreview);
  btnFairRaceInfo.addEventListener("click", function () {
    alertModal(T("tournament.fairRaceExplain"));
  });

  function tournamentPlayerCheckboxes() {
    return Array.prototype.slice.call(tournamentPlayerChecklist.querySelectorAll('input[type="checkbox"]'));
  }

  // tournamentSelectAllSnapshot itself is declared up with the other
  // top-level DOM refs, not here - see the comment there for why.
  tournamentSelectAllCheckbox.addEventListener("change", function () {
    var boxes = tournamentPlayerCheckboxes();
    if (tournamentSelectAllCheckbox.checked) {
      tournamentSelectAllSnapshot = {};
      boxes.forEach(function (cb) {
        tournamentSelectAllSnapshot[cb.value] = cb.checked;
        cb.checked = true;
      });
    } else {
      var snapshot = tournamentSelectAllSnapshot || {};
      boxes.forEach(function (cb) {
        cb.checked = !!snapshot[cb.value];
      });
      tournamentSelectAllSnapshot = null;
    }
    refreshTournamentTeamUi();
  });

  // If the user unchecks one player by hand while Select All is on, the
  // checkbox no longer honestly describes the state - un-tick it too
  // (without touching the snapshot; that only ever changes when Select
  // All itself is toggled, not from incidental individual clicks).
  tournamentPlayerChecklist.addEventListener("change", function (e) {
    if (e.target.type !== "checkbox" || !tournamentSelectAllCheckbox.checked) return;
    var stillAllChecked = tournamentPlayerCheckboxes().every(function (cb) {
      return cb.checked;
    });
    if (!stillAllChecked) tournamentSelectAllCheckbox.checked = false;
  });
  btnTournamentAbandon.addEventListener("click", abandonTournament);
  btnTournamentPrint.addEventListener("click", function () { window.print(); });
  tournamentGameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[tournamentGameTypeSelect.value];
    tournamentTargetInput.value = type.defaultTarget;
    tournamentTargetUnit.textContent = type.unit;
  });

  Array.prototype.forEach.call(playerPagePeriodButtons, function (btn) {
    btn.addEventListener("click", function () {
      setStatsPeriod(btn.getAttribute("data-period"));
    });
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  gameTypeSelect.value = state.currentGame.gameType;
  gameTargetInput.value = state.currentGame.target;
  gameTargetUnitSelect.value = state.currentGame.unit;
  raceToWinsInput.value = state.raceToWinsTarget;
  fairRaceEnabledCheckbox.checked = state.fairRaceEnabled;
  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.checked = radio.value === state.currentGame.mode;
  });
  shotCounterEnabledCheckbox.checked = state.currentGame.shotCounterEnabled;
  shotCounterBeepRow.classList.toggle("hidden", !state.currentGame.shotCounterEnabled);
  shotCounterBeepInput.value = state.currentGame.shotCounterBeepSec;
  // Live count is never restored across a reload (see the shotCounter*
  // module vars) - only the setting is; a "balls" game reloaded with the
  // checkbox already on starts a fresh running 0:00 rather than staying
  // enabled-but-frozen.
  if (state.currentGame.shotCounterEnabled) startShotCounter();
  updateCurrentGameSummary();

  dayNotesTextarea.value = getDayNotes(todayDateStr());
  updateDayNotesSummary();
  updateDayReportRecipientsLine();

  // Syncs currentGame to whatever rotation entry the persisted
  // gamesPlayedCount derives (see rotationCurrentIndex) - not a reset:
  // gamesPlayedCount itself is left exactly as loadState() restored it,
  // so a reload lands back on the same rotation position instead of
  // snapping to the first entry every time the page opens.
  if (state.rotation.enabled && state.rotation.order.length > 0) {
    applyRotationIfDue();
    gameTargetInput.value = state.currentGame.target;
    saveState();
  }

  populateRosterLoadSelect();
  populateRotationLoadSelect();
  populateWizardRosterLoadSelect();
  populateWizardRotationLoadSelect();
  validateNewPlayerNameInput();
  validateWizardNewPlayerNameInput();
  renderAll();

  if (!hasSeenOnboarding() && isFirstTimeUser()) {
    openOnboarding();
  }

  var storedFocusMode = "0";
  try {
    storedFocusMode = localStorage.getItem(FOCUS_MODE_KEY) || "0";
  } catch (e) {
    storedFocusMode = "0";
  }
  setFocusMode(storedFocusMode === "1");
  btnToggleFocus.addEventListener("click", function () {
    setFocusMode(!appRoot.classList.contains("focus-mode"));
  });

  setInterval(updateGameDurationDisplay, 1000);
  setInterval(tickShotCounter, 1000);

  maybeAutoShowLeaderboard();
  // Also re-check periodically so a session left open continuously for
  // 12+ hours still gets the pop-up, not just a fresh app launch.
  setInterval(maybeAutoShowLeaderboard, 5 * 60 * 1000);
  }

  // ---------------------------------------------------------------------
  // Load settings/game-types.json (app config) and run the one-time
  // repo-to-localStorage migration, then boot
  // ---------------------------------------------------------------------

  var gameTypesPromise = fetchFresh("settings/game-types.json")
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.warn("Could not load settings/game-types.json, using built-in defaults.", err);
      return DEFAULT_GAME_TYPES;
    });

  Promise.all([gameTypesPromise, migrateFromRepoIfNeeded(), languagePromise]).then(function (results) {
    GAME_TYPE_LIST = results[0];
    GAME_TYPE_LIST.forEach(function (t) {
      GAME_TYPES[t.id] = { label: t.label, defaultTarget: t.defaultTarget, unit: t.unit };
    });
    populateGameTypeSelects();
    normalizeGameTypeDependentData();
    [
      [rotationAddType, rotationAddTarget, rotationAddUnit],
      [wizardRotationAddType, wizardRotationAddTarget, wizardRotationAddUnit]
    ].forEach(function (trio) {
      var type = GAME_TYPES[trio[0].value];
      if (!type) return;
      trio[1].value = type.defaultTarget;
      trio[2].value = type.unit;
    });
    applyDomTranslations(document);
    boot();
  });
})();
