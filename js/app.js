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

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var toastTimer = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return {
      players: [],
      playerWins: {},
      teamWins: {},
      raceToWinsTarget: 5,
      currentGame: { gameType: "8ball", target: 1, mode: "individual", startedAt: new Date().toISOString() },
      gameHistory: [],
      rotation: { enabled: false, order: [], every: 1 },
      gamesPlayedCount: 0
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
          if (typeof parsed.raceToWinsTarget !== "number") parsed.raceToWinsTarget = 5;
          if (!parsed.currentGame) parsed.currentGame = { gameType: "8ball", target: 1, mode: "individual" };
          if (!parsed.currentGame.startedAt) parsed.currentGame.startedAt = new Date().toISOString();
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

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save state.", e);
    }
  }

  function getPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function activePlayers() {
    return state.players.filter(function (p) {
      return p.playing;
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
    return (teamId === "A" ? "Team A" : "Team B") + (names ? " (" + names + ")" : "");
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
  function getAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function tone(freq, startTime, duration, type, peakGain) {
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
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function voicePitch(voice) {
    if (typeof voice !== "number") return 1;
    return VOICE_PITCHES[voice % VOICE_PITCHES.length];
  }

  function playPositiveSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(660 * mult, now, 0.09, "triangle", 0.22);
    tone(990 * mult, now + 0.07, 0.14, "triangle", 0.2);
  }

  function playNegativeSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(220 * mult, now, 0.18, "sawtooth", 0.18);
    tone(160 * mult, now + 0.05, 0.22, "sawtooth", 0.16);
  }

  function playWinSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(523 * mult, now, 0.12, "triangle", 0.22);
    tone(659 * mult, now + 0.1, 0.12, "triangle", 0.22);
    tone(784 * mult, now + 0.2, 0.28, "triangle", 0.24);
  }

  function playVictorySound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var run = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0];
    run.forEach(function (freq, i) {
      tone(freq, now + i * 0.09, 0.16, "triangle", 0.2);
    });
    var chordStart = now + run.length * 0.09 + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach(function (freq) {
      tone(freq, chordStart, 0.7, "triangle", 0.18);
    });
  }

  function playOnHillSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(880, now, 0.09, "square", 0.14);
    tone(880, now + 0.14, 0.09, "square", 0.14);
    tone(1108.73, now + 0.28, 0.2, "square", 0.16);
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var btnExportAllData = document.getElementById("btn-export-all-data");
  var btnImportAllData = document.getElementById("btn-import-all-data");
  var importFileInput = document.getElementById("import-file-input");
  var btnResetAllPlayerStats = document.getElementById("btn-reset-all-player-stats");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var rosterList = document.getElementById("roster-list");
  var rosterLoadSelect = document.getElementById("roster-load-select");
  var btnRosterLoad = document.getElementById("btn-roster-load");

  var btnToggleFocus = document.getElementById("btn-toggle-focus");
  var appRoot = document.getElementById("app");
  var playerPageView = document.getElementById("view-player-page");
  var playerPageName = document.getElementById("player-page-name");
  var playerPageCurrentBody = document.getElementById("player-page-current-body");
  var playerPageHistoryList = document.getElementById("player-page-history-list");
  var btnPlayerPageBack = document.getElementById("btn-player-page-back");
  var btnPlayerPageExport = document.getElementById("btn-player-page-export");
  var btnPlayerPageReset = document.getElementById("btn-player-page-reset");

  var gameTypeSelect = document.getElementById("game-type");
  var gameTargetInput = document.getElementById("game-target");
  var gameTargetUnit = document.getElementById("game-target-unit");
  var modeRadios = document.getElementsByName("game-mode");
  var raceToWinsInput = document.getElementById("race-to-wins");

  var btnResetGame = document.getElementById("btn-reset-game");
  var btnUndoWin = document.getElementById("btn-undo-win");
  var btnShare = document.getElementById("btn-share");
  var btnExportSession = document.getElementById("btn-export-session");
  var btnResetStats = document.getElementById("btn-reset-stats");

  var rotationEnabledCheckbox = document.getElementById("rotation-enabled");
  var rotationAddType = document.getElementById("rotation-add-type");
  var btnRotationAdd = document.getElementById("btn-rotation-add");
  var rotationList = document.getElementById("rotation-list");
  var rotationEveryInput = document.getElementById("rotation-every");
  var rotationStatus = document.getElementById("rotation-status");

  var winToast = document.getElementById("win-toast");
  var scoreboard = document.getElementById("scoreboard");
  var historyList = document.getElementById("history-list");
  var standingsTitle = document.getElementById("standings-title");
  var teamStandingsList = document.getElementById("team-standings-list");
  var playerStandingsList = document.getElementById("player-standings-list");

  var milestoneOverlay = document.getElementById("milestone-overlay");
  var milestoneMessage = document.getElementById("milestone-message");
  var btnMilestoneClose = document.getElementById("btn-milestone-close");

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

  function populateGameTypeSelects() {
    [gameTypeSelect, rotationAddType].forEach(function (select) {
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
    btnToggleFocus.textContent = on ? "Show All" : "Focus Mode";
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
  }

  function renderRotation() {
    rotationEnabledCheckbox.checked = state.rotation.enabled;
    rotationEveryInput.value = state.rotation.every;

    rotationList.innerHTML = "";
    if (state.rotation.order.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No game types added yet.";
      rotationList.appendChild(hint);
    } else {
      state.rotation.order.forEach(function (typeId, i) {
        var li = document.createElement("li");
        li.className = "rotation-row";

        var pos = document.createElement("span");
        pos.className = "rotation-position";
        pos.textContent = i + 1 + ".";

        var name = document.createElement("span");
        name.className = "rotation-name";
        name.textContent = GAME_TYPES[typeId] ? GAME_TYPES[typeId].label : typeId;

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
        downBtn.disabled = i === state.rotation.order.length - 1;
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
        li.appendChild(controls);
        rotationList.appendChild(li);
      });
    }

    rotationStatus.classList.remove("is-warning");
    if (state.rotation.enabled && state.rotation.order.length >= 2) {
      var every = Math.max(1, state.rotation.every || 1);
      var playedInLeg = state.gamesPlayedCount % every;
      var untilSwitch = every - playedInLeg;
      var currentIndex = Math.floor(state.gamesPlayedCount / every) % state.rotation.order.length;
      var nextIndex = (currentIndex + 1) % state.rotation.order.length;
      rotationStatus.innerHTML = "";
      rotationStatus.appendChild(document.createTextNode("Now: "));
      var nowStrong = document.createElement("strong");
      nowStrong.textContent = GAME_TYPES[state.rotation.order[currentIndex]].label;
      rotationStatus.appendChild(nowStrong);
      rotationStatus.appendChild(
        document.createTextNode(
          " — switches to " + GAME_TYPES[state.rotation.order[nextIndex]].label + " in " + untilSwitch + " game" + (untilSwitch === 1 ? "" : "s") + "."
        )
      );
    } else if (state.rotation.enabled && state.rotation.order.length === 1) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = "⚠️ Only one game type in the order — add at least one more or nothing will switch.";
    } else if (state.rotation.enabled) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = "⚠️ Rotation is on but empty — add game types above for it to take effect.";
    } else {
      rotationStatus.textContent = "";
    }
  }

  function addRotationItem(typeId) {
    state.rotation.order.push(typeId);
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  }

  function removeRotationItem(index) {
    state.rotation.order.splice(index, 1);
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  }

  function moveRotationItem(index, delta) {
    var newIndex = index + delta;
    if (newIndex < 0 || newIndex >= state.rotation.order.length) return;
    var arr = state.rotation.order;
    var tmp = arr[index];
    arr[index] = arr[newIndex];
    arr[newIndex] = tmp;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  }

  function syncGameTypeUI() {
    gameTypeSelect.value = state.currentGame.gameType;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnit.textContent = GAME_TYPES[state.currentGame.gameType].unit;
  }

  function applyRotationIfDue() {
    if (!state.rotation.enabled || state.rotation.order.length === 0) return;
    var every = Math.max(1, state.rotation.every || 1);
    var index = Math.floor(state.gamesPlayedCount / every) % state.rotation.order.length;
    var newType = state.rotation.order[index];
    if (GAME_TYPES[newType] && newType !== state.currentGame.gameType) {
      state.currentGame.gameType = newType;
      state.currentGame.target = GAME_TYPES[newType].defaultTarget;
      syncGameTypeUI();
    }
  }

  function buildStandingsRow(name, wins) {
    var target = state.raceToWinsTarget;
    var reached = wins >= target;
    var li = document.createElement("li");
    li.className = "standings-row" + (reached ? " is-reached" : "");

    var top = document.createElement("div");
    top.className = "standings-row-top";
    var nameEl = document.createElement("span");
    nameEl.className = "standings-name";
    nameEl.textContent = name;
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
    standingsTitle.textContent = "Race to " + state.raceToWinsTarget + " Wins — Teams";

    var comboKeys = Object.keys(state.teamWins);
    ["A", "B"].forEach(function (teamId) {
      var key = teamComboKey(teamId);
      if (key && comboKeys.indexOf(key) === -1) comboKeys.push(key);
    });

    teamStandingsList.innerHTML = "";
    if (comboKeys.length === 0) {
      var teamHint = document.createElement("li");
      teamHint.className = "empty-hint";
      teamHint.textContent = "No team pairings yet — switch to Teams mode and assign players.";
      teamStandingsList.appendChild(teamHint);
    } else {
      comboKeys
        .map(function (key) {
          var names = key
            .split("|")
            .map(function (id) {
              var p = getPlayer(id);
              return p ? p.name : "?";
            })
            .join(" & ");
          return { key: key, names: names, wins: state.teamWins[key] || 0 };
        })
        .sort(function (a, b) {
          return b.wins - a.wins || a.names.localeCompare(b.names);
        })
        .forEach(function (row) {
          teamStandingsList.appendChild(buildStandingsRow(row.names, row.wins));
        });
    }

    playerStandingsList.innerHTML = "";
    if (state.players.length === 0) {
      var playerHint = document.createElement("li");
      playerHint.className = "empty-hint";
      playerHint.textContent = "No players yet.";
      playerStandingsList.appendChild(playerHint);
    } else {
      state.players
        .slice()
        .sort(function (a, b) {
          return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
        })
        .forEach(function (p) {
          playerStandingsList.appendChild(buildStandingsRow(p.name, state.playerWins[p.id] || 0));
        });
    }
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players to get started.";
      rosterList.appendChild(hint);
      return;
    }
    var showTeamToggle = state.currentGame.mode === "teams";

    state.players.forEach(function (p) {
      var row = document.createElement("li");
      row.className = "roster-row" + (p.playing ? " is-playing" : "");

      var name = document.createElement("span");
      name.className = "roster-name";
      name.textContent = p.name;
      row.appendChild(name);

      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
      playBtn.textContent = p.playing ? "Playing" : "Standby";
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
        openPlayerStatsPage(p.id);
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
  }

  function buildStatMini(label, value, milestoneReached) {
    var el = document.createElement("div");
    el.className = "stat-mini";
    var strong = document.createElement("strong");
    strong.textContent = value;
    el.appendChild(document.createTextNode(label + ": "));
    el.appendChild(strong);
    if (milestoneReached) {
      var flag = document.createElement("span");
      flag.className = "flag";
      flag.textContent = "🏁";
      el.appendChild(flag);
    }
    return el;
  }

  function buildBallControls(player, disabled) {
    var controls = document.createElement("div");
    controls.className = "ball-controls";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove point for " + player.name);
    var minusUnit = GAME_TYPES[state.currentGame.gameType].unit;
    var minusAllowNegative = minusUnit !== "rack";
    minusBtn.disabled = disabled || (!minusAllowNegative && (player.balls || 0) <= 0);
    minusBtn.addEventListener("click", function () {
      adjustScore(player.id, -1);
    });

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

  function buildIndividualPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;
    panel.appendChild(name);

    var wins = state.playerWins[player.id] || 0;
    panel.appendChild(buildStatMini("Session win", wins, wins >= state.raceToWinsTarget));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = GAME_TYPES[state.currentGame.gameType].label + " · Target " + state.currentGame.target;
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = player.balls || 0;
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    panel.appendChild(buildBallControls(player, false));

    return panel;
  }

  function buildMemberCard(player) {
    var card = document.createElement("div");
    card.className = "member-card";

    var name = document.createElement("div");
    name.className = "member-name";
    name.textContent = player.name;
    card.appendChild(name);

    var wins = state.playerWins[player.id] || 0;
    card.appendChild(buildStatMini("Session win", wins, wins >= state.raceToWinsTarget));

    var value = document.createElement("div");
    value.className = "stat-value small";
    value.textContent = player.balls || 0;
    card.appendChild(value);

    card.appendChild(buildBallControls(player, false));

    return card;
  }

  function buildTeamPanel(teamId, members) {
    var panel = document.createElement("div");
    panel.className = "team-panel";

    var name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamLabelLive(teamId);
    panel.appendChild(name);

    var wins = state.teamWins[teamComboKey(teamId)] || 0;
    panel.appendChild(buildStatMini("Paired session win", wins, wins >= state.raceToWinsTarget));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = GAME_TYPES[state.currentGame.gameType].label + " · Target " + state.currentGame.target;
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = sumTeamBalls(teamId);
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    var memberWrap = document.createElement("div");
    memberWrap.className = "team-members";
    members.forEach(function (p) {
      memberWrap.appendChild(buildMemberCard(p));
    });
    panel.appendChild(memberWrap);

    return panel;
  }

  function renderNowPlayingBanner() {
    var type = GAME_TYPES[state.currentGame.gameType];
    nowPlayingBanner.innerHTML = "";
    nowPlayingBanner.appendChild(document.createTextNode("🎱 Now Playing: " + type.label));
    var note = document.createElement("span");
    note.className = "target-note";
    note.textContent = "Target " + state.currentGame.target + " " + type.unit;
    nowPlayingBanner.appendChild(note);
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
    el.textContent = "⏱ Duration: " + formatDuration(Date.now() - startedAt);
  }

  function renderScoreboard() {
    renderNowPlayingBanner();
    scoreboard.innerHTML = "";
    var active = activePlayers();

    if (active.length === 0) {
      scoreboard.className = "scoreboard";
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Mark players as Playing above to start scoring.";
      scoreboard.appendChild(hint);
      return;
    }

    if (state.currentGame.mode === "teams") {
      scoreboard.className = "scoreboard scoreboard-teams";
      ["A", "B"].forEach(function (teamId) {
        var members = teamMembersLive(teamId);
        if (!members.length) return;
        scoreboard.appendChild(buildTeamPanel(teamId, members));
      });
    } else {
      scoreboard.className = "scoreboard";
      active.forEach(function (p) {
        scoreboard.appendChild(buildIndividualPanel(p));
      });
    }
  }

  function formatTimestamp(ts, includeDate) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return "";
    var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (!includeDate) return timePart;
    var datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return datePart + " · " + timePart;
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || isNaN(ms)) return "";
    var totalSec = Math.round(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function renderHistory() {
    historyList.innerHTML = "";
    if (state.gameHistory.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No games finished yet.";
      historyList.appendChild(hint);
      return;
    }
    state.gameHistory.forEach(function (entry) {
      var li = document.createElement("li");
      if (typeof entry === "string" || !entry.winnerNames) {
        li.textContent = typeof entry === "string" ? entry : entry.summary;
        historyList.appendChild(li);
        return;
      }
      var timeSpan = document.createElement("span");
      timeSpan.className = "history-date";
      timeSpan.textContent = formatTimestamp(entry.ts, true);
      li.appendChild(timeSpan);
      var durationText = formatDuration(entry.durationMs);
      if (durationText) {
        var durationSpan = document.createElement("span");
        durationSpan.className = "history-duration";
        durationSpan.textContent = "Duration: " + durationText;
        li.appendChild(durationSpan);
      }
      var winner = document.createElement("strong");
      winner.className = "history-winner";
      winner.textContent = "🏆 " + entry.winnerNames.join(" & ");
      li.appendChild(winner);
      li.appendChild(document.createTextNode(" won " + entry.gameLabel + " (target " + entry.target + ")"));
      if (entry.isTeam && entry.mvpName) {
        li.appendChild(document.createTextNode(" · 🎯 " + entry.mvpName + " potted it"));
      }
      historyList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Player management
  // ---------------------------------------------------------------------

  function addPlayer(name) {
    name = (name || "").trim();
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
    return player;
  }

  function removePlayer(id) {
    if (!confirm("Remove this player? Their career win totals will also be cleared.")) return;
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    delete state.playerWins[id];
    saveState();
    renderAll();
  }

  function togglePlaying(id) {
    var p = getPlayer(id);
    if (!p) return;
    p.playing = !p.playing;
    p.balls = 0;
    if (p.playing && !p.teamId) p.teamId = "A";
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

  function showToast(message) {
    winToast.textContent = "🏆 " + message;
    winToast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      winToast.classList.add("hidden");
    }, 4500);
  }

  function creditWin(isTeam, key) {
    var typeLabel = GAME_TYPES[state.currentGame.gameType].label;
    var summary;
    var winnerNames;
    var winnerIds;
    var opponentNames;
    var teamComboKeyValue = null;
    var milestoneNames = null;
    var milestoneCount = 0;
    var onHillNames = null;
    var target = state.raceToWinsTarget;
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
      var comboKey = teamComboKey(key);
      teamComboKeyValue = comboKey;
      var newTeamWins = (state.teamWins[comboKey] || 0) + 1;
      state.teamWins[comboKey] = newTeamWins;
      members.forEach(function (p) {
        state.playerWins[p.id] = (state.playerWins[p.id] || 0) + 1;
      });
      var mvp = members.reduce(function (best, p) {
        return !best || (p.balls || 0) > (best.balls || 0) ? p : best;
      }, null);
      if (mvp) {
        mvpId = mvp.id;
        mvpName = mvp.name;
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
    }
    var startedAt = state.currentGame.startedAt ? new Date(state.currentGame.startedAt).getTime() : null;
    var durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
    state.gameHistory.unshift({
      ts: new Date().toISOString(),
      gameType: state.currentGame.gameType,
      gameLabel: typeLabel,
      target: state.currentGame.target,
      winnerNames: winnerNames,
      winnerIds: winnerIds,
      isTeam: isTeam,
      teamComboKey: teamComboKeyValue,
      opponentNames: opponentNames,
      mvpId: mvpId,
      mvpName: mvpName,
      durationMs: durationMs,
      summary: summary
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    state.gamesPlayedCount += 1;
    var previousGameType = state.currentGame.gameType;
    applyRotationIfDue();
    var gameTypeChanged = state.currentGame.gameType !== previousGameType;
    showToast(summary);
    if (milestoneNames) {
      celebrateMilestone(milestoneNames, milestoneCount);
    } else if (onHillNames) {
      announceOnHill(onHillNames);
    } else if (gameTypeChanged) {
      announceGameChange(GAME_TYPES[state.currentGame.gameType].label);
    }
    return summary;
  }

  function undoLastWin() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) {
      showToast("No recorded win to undo.");
      return;
    }
    if (
      !confirm(
        "Undo the most recent win — " + entry.summary + "? " +
        "This removes it from the history and reverses the win count. The current game's score isn't affected."
      )
    ) {
      return;
    }
    entry.winnerIds.forEach(function (id) {
      state.playerWins[id] = Math.max(0, (state.playerWins[id] || 0) - 1);
    });
    if (entry.isTeam && entry.teamComboKey) {
      state.teamWins[entry.teamComboKey] = Math.max(0, (state.teamWins[entry.teamComboKey] || 0) - 1);
    }
    state.gameHistory.shift();
    state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount - 1);
    applyRotationIfDue();
    saveState();
    showToast("Undid: " + entry.summary);
    renderAll();
  }

  function announceOnHill(names) {
    onHillMessage.textContent = names + " is ON THE HILL — one more win takes the race to " + state.raceToWinsTarget + "! Better step up. 👀";
    onHillOverlay.classList.remove("hidden");
    playOnHillSound();
  }

  function closeOnHill() {
    onHillOverlay.classList.add("hidden");
  }

  function announceGameChange(label) {
    gameChangeMessage.textContent = "Now playing: " + label + "!";
    gameChangeOverlay.classList.remove("hidden");
    playPositiveSound(null);
  }

  function closeGameChange() {
    gameChangeOverlay.classList.add("hidden");
  }

  function celebrateMilestone(names, count) {
    milestoneMessage.textContent = names + " reached " + count + " wins! (race-to " + state.raceToWinsTarget + ")";
    milestoneOverlay.classList.remove("hidden");
    playVictorySound();
  }

  function closeMilestone() {
    milestoneOverlay.classList.add("hidden");
  }

  function resetGameBalls() {
    state.players.forEach(function (p) {
      p.balls = 0;
    });
    state.currentGame.startedAt = new Date().toISOString();
  }

  function adjustScore(playerId, delta) {
    var player = getPlayer(playerId);
    if (!player || !player.playing) return;
    var unit = GAME_TYPES[state.currentGame.gameType].unit;
    var allowNegative = unit !== "rack";
    var next = (player.balls || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    player.balls = next;

    if (delta > 0) {
      var target = state.currentGame.target;
      var isTeamMode = state.currentGame.mode === "teams" && player.teamId;
      var reached = isTeamMode ? sumTeamBalls(player.teamId) >= target : next >= target;

      if (reached) {
        var winnerVoice = isTeamMode ? null : player.voice;
        creditWin(isTeamMode, isTeamMode ? player.teamId : playerId);
        resetGameBalls();
        saveState();
        playWinSound(winnerVoice);
        renderAll();
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
    if (!confirm("Reset the current game's score to zero? (No win will be credited.)")) return;
    resetGameBalls();
    saveState();
    renderAll();
  }

  function resetAllStats() {
    if (state.gameHistory.length === 0) {
      if (!confirm("Start a new session? This clears session wins, team wins, and restarts the game rotation from the top.")) return;
      startNewSession(false);
      return;
    }
    var count = state.gameHistory.length;
    saveSessionMessage.textContent =
      "You've recorded " + count + " game" + (count === 1 ? "" : "s") + " this session. " +
      "Save it before starting a new one? This cannot be undone.";
    saveSessionOverlay.classList.remove("hidden");
  }

  function closeSaveSessionPopup() {
    saveSessionOverlay.classList.add("hidden");
  }

  function startNewSession(saveRoster) {
    if (saveRoster) maybeSaveRosterOnNewSession();
    state.playerWins = {};
    state.teamWins = {};
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

  function shareStandings() {
    var lines = ["Pool Master Counter — Standings", ""];
    lines.push("Player session wins:");
    state.players.forEach(function (p) {
      lines.push("  " + p.name + ": " + (state.playerWins[p.id] || 0));
    });
    var teamKeys = Object.keys(state.teamWins);
    if (teamKeys.length) {
      lines.push("");
      lines.push("Team pairing wins:");
      teamKeys.forEach(function (key) {
        var names = key
          .split("|")
          .map(function (id) {
            var p = getPlayer(id);
            return p ? p.name : "?";
          })
          .join(" & ");
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

    var teamWins = Object.keys(state.teamWins)
      .map(function (key) {
        var members = key
          .split("|")
          .map(function (id) {
            var p = getPlayer(id);
            return p ? p.name : "?";
          })
          .join(" & ");
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
  var PLAYER_STATS_KEY = "poolMasterCounter.playerStats.v1";

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
    try {
      localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosters));
    } catch (e) {
      console.warn("Could not save rosters.", e);
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
    try {
      localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(allStats));
    } catch (e) {
      console.warn("Could not save player stats.", e);
    }
  }

  var PLAYER_STATS = loadPlayerStatsFromStorage();

  function getPlayerSessions(name) {
    var entry = PLAYER_STATS[name];
    return entry && Array.isArray(entry.sessions) ? entry.sessions.slice() : [];
  }

  function setPlayerSessions(name, sessions) {
    PLAYER_STATS[name] = { name: name, sessions: sessions };
    savePlayerStatsToStorage(PLAYER_STATS);
  }

  function resetAllPlayerStats() {
    if (
      !confirm(
        "This clears EVERY player's saved stat history on this device — all sessions, for all players, not just the current live session. This cannot be undone. Continue?"
      )
    ) {
      return;
    }
    PLAYER_STATS = {};
    savePlayerStatsToStorage(PLAYER_STATS);
    if (currentStatsPlayerId) {
      currentStatsSessions = [];
      renderPlayerHistoryList([]);
    }
    showToast("Cleared all players' saved stat history.");
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

  function exportAllData() {
    var payload = {
      exportedAt: new Date().toISOString(),
      state: state,
      rosters: SAVED_ROSTERS,
      playerStats: PLAYER_STATS
    };
    downloadJSON("pool-master-counter-backup-" + payload.exportedAt.slice(0, 10) + ".json", payload);
  }

  function importAllData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alert("That file isn't valid JSON.");
        return;
      }
      if (!data || typeof data !== "object" || !data.state) {
        alert("That doesn't look like a Pool Master Counter backup file.");
        return;
      }
      if (
        !confirm(
          "This replaces ALL data on this device (current session, rosters, and player stats) " +
          "with the contents of this file. This cannot be undone. Continue?"
        )
      ) {
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.state));
        localStorage.setItem(ROSTERS_KEY, JSON.stringify(Array.isArray(data.rosters) ? data.rosters : []));
        localStorage.setItem(
          PLAYER_STATS_KEY,
          JSON.stringify(data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {})
        );
      } catch (e) {
        alert("Could not import: " + e.message);
        return;
      }
      location.reload();
    };
    reader.onerror = function () {
      alert("Could not read that file.");
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Player rosters
  // ---------------------------------------------------------------------

  var SAVED_ROSTERS = loadRostersFromStorage();

  function populateRosterLoadSelect() {
    rosterLoadSelect.innerHTML = "";
    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No saved lists yet";
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

  function loadSelectedRoster() {
    var idx = parseInt(rosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var existingNames = state.players.map(function (p) {
      return p.name.toLowerCase();
    });
    var added = 0;
    roster.players.forEach(function (name) {
      if (existingNames.indexOf(name.toLowerCase()) === -1) {
        addPlayer(name);
        added += 1;
      }
    });
    renderAll();
    if (added === 0) {
      showToast("Everyone from that saved list is already in your roster.");
    } else {
      showToast("Added " + added + " player" + (added === 1 ? "" : "s") + " from \"" + roster.label + "\".");
    }
  }

  function currentRosterNames() {
    return state.players
      .map(function (p) {
        return p.name;
      })
      .sort();
  }

  function maybeSaveRosterOnNewSession() {
    var names = currentRosterNames();
    if (names.length === 0) return;
    var last = SAVED_ROSTERS[SAVED_ROSTERS.length - 1];
    var lastNames = last ? last.players.slice().sort() : null;
    var sameAsLast = lastNames && lastNames.length === names.length && lastNames.every(function (n, i) {
      return n === names[i];
    });
    if (sameAsLast) {
      showToast("Same player list as last session — no need to re-save.");
      return;
    }
    var now = new Date().toISOString();
    var entry = {
      id: "roster-" + now.replace(/[:.]/g, "-"),
      label: now.slice(0, 10) + " — " + names.join(", "),
      players: names,
      savedAt: now
    };
    var updated = SAVED_ROSTERS.concat([entry]);
    SAVED_ROSTERS = updated;
    saveRostersToStorage(updated);
    showToast("Saved roster: " + entry.label);
  }

  // ---------------------------------------------------------------------
  // Per-player stats page (players/<Name>.json)
  // ---------------------------------------------------------------------

  var currentStatsPlayerId = null;
  var currentStatsSessions = null;

  function playerStatsFilename(name) {
    return name.replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-") + ".json";
  }

  function computeLiveSessionForPlayer(playerId) {
    var player = getPlayer(playerId);
    if (!player) return null;
    var gamesWon = [];
    var opponentSet = {};
    var games = [];
    state.gameHistory.forEach(function (entry) {
      if (typeof entry === "string" || !entry.winnerNames) return;
      var won = entry.winnerNames.indexOf(player.name) !== -1;
      var lost = !won && (entry.opponentNames || []).indexOf(player.name) !== -1;
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
      games.push({
        ts: entry.ts,
        gameLabel: entry.gameLabel,
        target: entry.target,
        result: won ? "won" : "lost",
        winnerNames: entry.winnerNames,
        isTeam: entry.isTeam,
        mvpName: entry.mvpName,
        durationMs: entry.durationMs
      });
    });
    var wins = state.playerWins[playerId] || 0;
    return {
      date: new Date().toISOString().slice(0, 10),
      wins: wins,
      gamesWon: gamesWon,
      opponents: Object.keys(opponentSet),
      games: games,
      wonTournament: wins > 0 && wins >= state.raceToWinsTarget
    };
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

  function playerStatsListRow(label, items) {
    var row = document.createElement("div");
    row.className = "player-stats-row player-stats-row-wrap";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value value-list";
    v.textContent = items.length ? items.join(", ") : "—";
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
    winner.textContent = "🏆 " + (g.winnerNames || []).join(" & ");
    div.appendChild(time);
    div.appendChild(label);
    var durationText = formatDuration(g.durationMs);
    if (durationText) {
      var durationSpan = document.createElement("span");
      durationSpan.className = "player-game-log-duration";
      durationSpan.textContent = "Duration: " + durationText;
      div.appendChild(durationSpan);
    }
    div.appendChild(document.createTextNode(" — won by "));
    div.appendChild(winner);
    if (g.isTeam && g.mvpName) {
      div.appendChild(document.createTextNode(" · 🎯 " + g.mvpName + " potted it"));
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

  function renderLiveSessionForPlayer(playerId) {
    var player = getPlayer(playerId);
    var live = computeLiveSessionForPlayer(playerId);
    playerPageCurrentBody.innerHTML = "";
    playerPageCurrentBody.appendChild(playerStatsRow("Wins today", live.wins));
    playerPageCurrentBody.appendChild(playerGamesLogRow("Games", live.games));
    playerPageCurrentBody.appendChild(playerStatsListRow("Opponents", live.opponents));
    if (live.wonTournament) {
      var trophy = document.createElement("div");
      trophy.className = "tournament-winner-banner";
      trophy.textContent = "🏆 " + (player ? player.name : "") + " Won the Tournament Today!";
      playerPageCurrentBody.appendChild(trophy);
    }
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
      hint.textContent = "No saved sessions yet for this player — use Export Stats to start tracking.";
      playerPageHistoryList.appendChild(hint);
      return;
    }
    var player = getPlayer(currentStatsPlayerId);
    var playerName = player ? player.name : "";
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
          banner.textContent = "🏆 " + playerName + " Won the Tournament!";
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

  function openPlayerStatsPage(playerId) {
    var player = getPlayer(playerId);
    if (!player) return;
    currentStatsPlayerId = playerId;
    currentStatsSessions = null;
    playerPageName.textContent = player.name;
    renderLiveSessionForPlayer(playerId);
    playerPageHistoryList.innerHTML = "";
    var loading = document.createElement("li");
    loading.className = "empty-hint";
    loading.textContent = "Loading saved history…";
    playerPageHistoryList.appendChild(loading);

    appRoot.classList.add("hidden");
    playerPageView.classList.remove("hidden");
    window.scrollTo(0, 0);

    currentStatsSessions = getPlayerSessions(player.name);
    renderPlayerHistoryList(currentStatsSessions);
  }

  function closePlayerStatsPage() {
    playerPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
    currentStatsPlayerId = null;
    currentStatsSessions = null;
  }

  function mergeSessionIntoList(sessions, live) {
    sessions = sessions.slice();
    var idx = -1;
    sessions.forEach(function (s, i) {
      if (s.date === live.date) idx = i;
    });
    if (idx !== -1) {
      sessions[idx] = live;
    } else {
      sessions.push(live);
    }
    return sessions;
  }

  function exportAllPlayerStats() {
    state.players.forEach(function (p) {
      var live = computeLiveSessionForPlayer(p.id);
      if (!live || !live.games || live.games.length === 0) return;
      var sessions = mergeSessionIntoList(getPlayerSessions(p.name), live);
      setPlayerSessions(p.name, sessions);
      if (p.id === currentStatsPlayerId) currentStatsSessions = sessions;
    });
  }

  function exportCurrentPlayerStats() {
    var player = getPlayer(currentStatsPlayerId);
    if (!player) return;
    var live = computeLiveSessionForPlayer(currentStatsPlayerId);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    currentStatsSessions = sessions;
    setPlayerSessions(player.name, sessions);
    renderPlayerHistoryList(sessions);
    showToast("Saved " + player.name + "'s stats.");
  }

  function resetPlayerHistoricalStats() {
    var player = getPlayer(currentStatsPlayerId);
    if (!player) return;
    if (
      !confirm(
        "This clears " + player.name + "'s saved session history on this device. " +
        "This session's live stats are not affected. Continue?"
      )
    ) {
      return;
    }
    currentStatsSessions = [];
    setPlayerSessions(player.name, []);
    renderPlayerHistoryList([]);
  }

  // ---------------------------------------------------------------------
  // Events + Init (deferred until settings/game-types.json has loaded)
  // ---------------------------------------------------------------------

  function boot() {
  btnExportAllData.addEventListener("click", exportAllData);

  btnImportAllData.addEventListener("click", function () {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", function () {
    var file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (!file) return;
    importAllData(file);
  });

  btnResetAllPlayerStats.addEventListener("click", resetAllPlayerStats);

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var player = addPlayer(newPlayerName.value);
    if (!player) return;
    newPlayerName.value = "";
    renderAll();
  });

  gameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[gameTypeSelect.value];
    state.currentGame.gameType = gameTypeSelect.value;
    state.currentGame.target = type.defaultTarget;
    gameTargetInput.value = type.defaultTarget;
    gameTargetUnit.textContent = type.unit;
    saveState();
    renderScoreboard();
  });

  gameTargetInput.addEventListener("input", function () {
    var target = parseInt(gameTargetInput.value, 10);
    if (!target || target < 1) return;
    state.currentGame.target = target;
    saveState();
    renderScoreboard();
  });

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      state.currentGame.mode = radio.value;
      saveState();
      renderAll();
    });
  });

  raceToWinsInput.addEventListener("input", function () {
    var target = parseInt(raceToWinsInput.value, 10);
    if (!target || target < 1) return;
    state.raceToWinsTarget = target;
    saveState();
    renderScoreboard();
    renderStandings();
  });

  btnResetGame.addEventListener("click", resetCurrentGame);
  btnUndoWin.addEventListener("click", undoLastWin);
  btnShare.addEventListener("click", shareStandings);
  btnExportSession.addEventListener("click", function () {
    exportSession();
    exportAllPlayerStats();
  });
  btnResetStats.addEventListener("click", resetAllStats);

  rotationEnabledCheckbox.addEventListener("change", function () {
    state.rotation.enabled = rotationEnabledCheckbox.checked;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  });

  btnRotationAdd.addEventListener("click", function () {
    addRotationItem(rotationAddType.value);
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
  milestoneOverlay.addEventListener("click", function (e) {
    if (e.target === milestoneOverlay) closeMilestone();
  });

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
  });
  btnSaveSessionSkip.addEventListener("click", function () {
    closeSaveSessionPopup();
    startNewSession(false);
  });
  btnSaveSessionCancel.addEventListener("click", closeSaveSessionPopup);
  saveSessionOverlay.addEventListener("click", function (e) {
    if (e.target === saveSessionOverlay) closeSaveSessionPopup();
  });

  btnRosterLoad.addEventListener("click", loadSelectedRoster);

  btnPlayerPageExport.addEventListener("click", exportCurrentPlayerStats);
  btnPlayerPageReset.addEventListener("click", resetPlayerHistoricalStats);
  btnPlayerPageBack.addEventListener("click", closePlayerStatsPage);

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  gameTypeSelect.value = state.currentGame.gameType;
  gameTargetInput.value = state.currentGame.target;
  gameTargetUnit.textContent = GAME_TYPES[state.currentGame.gameType].unit;
  raceToWinsInput.value = state.raceToWinsTarget;
  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.checked = radio.value === state.currentGame.mode;
  });

  if (state.rotation.enabled && state.rotation.order.length > 0) {
    state.gamesPlayedCount = 0;
    applyRotationIfDue();
    gameTargetInput.value = state.currentGame.target;
    saveState();
  }

  populateRosterLoadSelect();
  renderAll();

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

  Promise.all([gameTypesPromise, migrateFromRepoIfNeeded()]).then(function (results) {
    GAME_TYPE_LIST = results[0];
    GAME_TYPE_LIST.forEach(function (t) {
      GAME_TYPES[t.id] = { label: t.label, defaultTarget: t.defaultTarget, unit: t.unit };
    });
    populateGameTypeSelects();
    boot();
  });
})();
