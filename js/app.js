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
  function wireCollapsiblePanel(panelElId, buttonElId) {
    var panel = document.getElementById(panelElId);
    var btn = document.getElementById(buttonElId);
    btn.addEventListener("click", function () {
      var willExpand = panel.classList.contains("collapsed");
      panel.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", willExpand ? "true" : "false");
    });
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
      raceToWinsTarget: 5,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", startedAt: new Date().toISOString() },
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
          if (typeof parsed.currentGame.unit !== "string" || !parsed.currentGame.unit) parsed.currentGame.unit = null;
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
  var btnResetRosterLists = document.getElementById("btn-reset-roster-lists");
  var backupPanel = document.getElementById("backup-panel");
  var btnToggleBackupPanel = document.getElementById("btn-toggle-backup-panel");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var newPlayerRatingInput = document.getElementById("new-player-rating");
  var newPlayerNameRequirement = document.getElementById("new-player-name-requirement");
  var btnAddPlayer = document.getElementById("btn-add-player");
  var rosterList = document.getElementById("roster-list");
  var rosterLoadSelect = document.getElementById("roster-load-select");
  var btnRosterLoad = document.getElementById("btn-roster-load");
  var btnExportRosterLists = document.getElementById("btn-export-roster-lists");
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

  var btnToggleFocus = document.getElementById("btn-toggle-focus");
  var focusPlayersWrap = document.getElementById("focus-players-wrap");
  var btnToggleFocusPlayers = document.getElementById("btn-toggle-focus-players");
  var focusPlayersSummary = document.getElementById("focus-players-summary");
  var focusPlayersList = document.getElementById("focus-players-list");
  var appRoot = document.getElementById("app");
  var playerPageView = document.getElementById("view-player-page");
  var playerPageName = document.getElementById("player-page-name");
  var playerPageCurrentBody = document.getElementById("player-page-current-body");
  var playerPageHistoryList = document.getElementById("player-page-history-list");
  var btnPlayerPageBack = document.getElementById("btn-player-page-back");
  var btnPlayerPageExport = document.getElementById("btn-player-page-export");
  var btnPlayerPageReset = document.getElementById("btn-player-page-reset");
  var playerPagePeriodFilter = document.getElementById("player-page-period-filter");
  var playerPageGraphBody = document.getElementById("player-page-graph-body");
  var playerPagePeriodButtons = playerPagePeriodFilter.querySelectorAll(".period-btn");
  var playerPageSynopsisBody = document.getElementById("player-page-synopsis-body");
  var playerPageH2hList = document.getElementById("player-page-h2h-list");
  var btnReturnToGlobalStats = document.getElementById("btn-return-to-global-stats");

  var btnOpenAllPlayers = document.getElementById("btn-open-all-players");
  var allPlayersPageView = document.getElementById("view-all-players-page");
  var btnAllPlayersBack = document.getElementById("btn-all-players-back");
  var allPlayersSortSelect = document.getElementById("all-players-sort");
  var allPlayersPeriodSelect = document.getElementById("all-players-period");
  var btnToggleAllPlayersView = document.getElementById("btn-toggle-all-players-view");
  var btnToggleRosterFilter = document.getElementById("btn-toggle-roster-filter");
  var allPlayersList = document.getElementById("all-players-list");
  var allPlayersViewMode = "bars";
  var allPlayersRosterOnly = false;

  var btnOpenTournament = document.getElementById("btn-open-tournament");
  var tournamentPageView = document.getElementById("view-tournament-page");
  var btnTournamentBack = document.getElementById("btn-tournament-back");
  var tournamentSetupPanel = document.getElementById("tournament-setup-panel");
  var tournamentActivePanel = document.getElementById("tournament-active-panel");
  var tournamentFormatRadios = document.getElementsByName("tournament-format");
  var tournamentLbSection = document.getElementById("tournament-lb-section");
  var tournamentGfSection = document.getElementById("tournament-gf-section");
  var tournamentGameTypeSelect = document.getElementById("tournament-game-type");
  var tournamentTargetInput = document.getElementById("tournament-target");
  var tournamentTargetUnit = document.getElementById("tournament-target-unit");
  var tournamentRaceToInput = document.getElementById("tournament-race-to");
  var tournamentPlayerChecklist = document.getElementById("tournament-player-checklist");
  var btnTournamentStart = document.getElementById("btn-tournament-start");
  var btnTournamentAbandon = document.getElementById("btn-tournament-abandon");
  var tournamentChampionBanner = document.getElementById("tournament-champion-banner");
  var tournamentCurrentMatchPanel = document.getElementById("tournament-current-match-panel");
  var tournamentReadyList = document.getElementById("tournament-ready-list");
  var tournamentWbEl = document.getElementById("tournament-wb");
  var tournamentLbEl = document.getElementById("tournament-lb");
  var tournamentGfEl = document.getElementById("tournament-gf");

  var gameTypeSelect = document.getElementById("game-type");
  var gameTargetInput = document.getElementById("game-target");
  var gameTargetUnitSelect = document.getElementById("game-target-unit-select");
  var modeRadios = document.getElementsByName("game-mode");
  var raceToWinsInput = document.getElementById("race-to-wins");

  var btnResetGame = document.getElementById("btn-reset-game");
  var btnUndoWin = document.getElementById("btn-undo-win");
  var btnShare = document.getElementById("btn-share");
  var btnExportSession = document.getElementById("btn-export-session");
  var btnResetStats = document.getElementById("btn-reset-stats");

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

  var winToast = document.getElementById("win-toast");
  var scoreboard = document.getElementById("scoreboard");
  var historyList = document.getElementById("history-list");
  var standingsTitle = document.getElementById("standings-title");
  var teamStandingsList = document.getElementById("team-standings-list");
  var playerStandingsList = document.getElementById("player-standings-list");

  var dayNotesTextarea = document.getElementById("day-notes-textarea");
  var btnDayReportCopy = document.getElementById("btn-day-report-copy");
  var btnDayReportEmail = document.getElementById("btn-day-report-email");
  var btnDayReportSms = document.getElementById("btn-day-report-sms");

  var milestoneOverlay = document.getElementById("milestone-overlay");
  var milestoneHeadline = document.getElementById("milestone-headline");
  var milestoneDetails = document.getElementById("milestone-details");
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
    renderWizardIfOpen();
    updateDayNotesSummary();
  }

  // A rotation entry is { gameType, target, unit } — its own rule, not
  // just a game type — so the same game type can appear more than once in
  // an order with different rules (e.g. "8-Ball — 1 rack" and "8-Ball — 3
  // racks" as distinct steps).
  function rotationEntryLabel(entry) {
    var type = GAME_TYPES[entry.gameType];
    var label = type ? type.label : entry.gameType;
    var unit = entry.unit || (type ? type.unit : "rack");
    if (unit === "rack" && entry.target !== 1) unit = "racks";
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

  // Builds one rotation-order <li> (position, label, up/down/remove
  // controls). Shared by the main Game Order panel and the wizard's
  // rotation step so both stay visually and behaviorally identical.
  function buildRotationRow(entry, i, total) {
    var li = document.createElement("li");
    li.className = "rotation-row";

    var pos = document.createElement("span");
    pos.className = "rotation-position";
    pos.textContent = i + 1 + ".";

    var name = document.createElement("span");
    name.className = "rotation-name";
    name.textContent = rotationEntryLabel(entry);

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
    li.appendChild(controls);
    return li;
  }

  function renderRotationListInto(listEl) {
    listEl.innerHTML = "";
    if (state.rotation.order.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No game types added yet.";
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
      rotationStatus.appendChild(document.createTextNode("Now: "));
      var nowStrong = document.createElement("strong");
      nowStrong.textContent = info.currentLabel;
      rotationStatus.appendChild(nowStrong);
      rotationStatus.appendChild(
        document.createTextNode(
          " — switches to " + info.nextLabel + " in " + info.untilSwitch + " game" + (info.untilSwitch === 1 ? "" : "s") + "."
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

    setPanelSummary("rotation-panel", computeRotationSummary());
  }

  function computeRotationSummary() {
    if (!state.rotation.enabled) {
      var currentType = GAME_TYPES[state.currentGame.gameType];
      return "Rotation off — playing " + (currentType ? currentType.label : state.currentGame.gameType) + " only.";
    }
    if (state.rotation.order.length < 2) {
      return "Rotation on, but not set up yet — add at least two game types.";
    }
    return "Rotating " + rotationLabelFor(state.rotation.order) +
      ", switching every " + state.rotation.every + " game" + (state.rotation.every === 1 ? "" : "s") + ".";
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

  function syncGameTypeUI() {
    gameTypeSelect.value = state.currentGame.gameType;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnitSelect.value = state.currentGame.unit;
    updateCurrentGameSummary();
  }

  function updateCurrentGameSummary() {
    var type = GAME_TYPES[state.currentGame.gameType];
    var modeLabel = state.currentGame.mode === "teams" ? "Teams" : "Individual";
    setPanelSummary(
      "game-setup-panel",
      (type ? type.label : state.currentGame.gameType) + " (" + state.currentGame.target + " " + state.currentGame.unit + ") · " +
        modeLabel + " · Race to " + state.raceToWinsTarget + " wins"
    );
  }

  function rotationStatusInfo() {
    if (!(state.rotation.enabled && state.rotation.order.length >= 2)) return null;
    var every = Math.max(1, state.rotation.every || 1);
    var playedInLeg = state.gamesPlayedCount % every;
    var untilSwitch = every - playedInLeg;
    var currentIndex = Math.floor(state.gamesPlayedCount / every) % state.rotation.order.length;
    var nextIndex = (currentIndex + 1) % state.rotation.order.length;
    return {
      currentLabel: rotationEntryLabel(state.rotation.order[currentIndex]),
      nextLabel: rotationEntryLabel(state.rotation.order[nextIndex]),
      untilSwitch: untilSwitch
    };
  }

  function applyRotationIfDue() {
    if (!state.rotation.enabled || state.rotation.order.length === 0) return;
    var every = Math.max(1, state.rotation.every || 1);
    var index = Math.floor(state.gamesPlayedCount / every) % state.rotation.order.length;
    var entry = state.rotation.order[index];
    if (GAME_TYPES[entry.gameType] && (entry.gameType !== state.currentGame.gameType || entry.target !== state.currentGame.target || entry.unit !== state.currentGame.unit)) {
      state.currentGame.gameType = entry.gameType;
      state.currentGame.target = entry.target;
      state.currentGame.unit = entry.unit;
      syncGameTypeUI();
    }
  }

  function buildStandingsRow(name, wins, memberNames) {
    var target = state.raceToWinsTarget;
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
          var namesList = key.split("|").map(function (id) {
            var p = getPlayer(id);
            return p ? p.name : "?";
          });
          return { key: key, names: namesList.join(" & "), namesList: namesList, wins: state.teamWins[key] || 0 };
        })
        .sort(function (a, b) {
          return b.wins - a.wins || a.names.localeCompare(b.names);
        })
        .forEach(function (row) {
          teamStandingsList.appendChild(buildStandingsRow(row.names, row.wins, row.namesList));
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
          playerStandingsList.appendChild(buildStandingsRow(p.name, state.playerWins[p.id] || 0, [p.name]));
        });
    }

    setPanelSummary("standings-panel", computeStandingsSummary());
  }

  function computeStandingsSummary() {
    if (state.players.length === 0) return "No players yet.";
    var sorted = state.players.slice().sort(function (a, b) {
      return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
    });
    var leader = sorted[0];
    var leaderWins = state.playerWins[leader.id] || 0;
    if (leaderWins === 0) return "No games won yet this session.";
    return leader.name + " leads with " + leaderWins + " win" + (leaderWins === 1 ? "" : "s") +
      " (race to " + state.raceToWinsTarget + ").";
  }

  function computePlayersSummary() {
    if (state.players.length === 0) return "No players yet — add some below.";
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    var names = state.players
      .map(function (p) {
        return p.name;
      })
      .join(", ");
    return state.players.length + " player" + (state.players.length === 1 ? "" : "s") +
      " (" + playingCount + " playing): " + names;
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players to get started.";
      rosterList.appendChild(hint);
      setPanelSummary("players-panel", computePlayersSummary());
      renderPlayingToggleListInto(focusPlayersList, "No players yet — add some in the Players panel.");
      focusPlayersSummary.textContent = "Players";
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
      row.appendChild(buildRatingBadge(p.name));

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
    renderPlayingToggleListInto(focusPlayersList, "No players yet — add some in the Players panel.");
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    focusPlayersSummary.textContent = playingCount + " of " + state.players.length + " playing";
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
    var minusAllowNegative = state.currentGame.unit !== "rack";
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
    name.appendChild(buildRatingBadge(player.name));
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
    note.textContent = "Target " + state.currentGame.target + " " + state.currentGame.unit;
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

  // Today's games, most-recent first — spans however many races/sessions
  // have already been completed (and auto-saved) today, not just the
  // still-open live one, so this list doesn't go back to empty every time
  // someone reaches the race target and startNewSession() clears
  // state.gameHistory for the next race.
  function todaysHistoryGames() {
    return computeDayReportData(todayDateStr()).games.slice().reverse();
  }

  function computeHistorySummary() {
    var n = todaysHistoryGames().length;
    return n === 0 ? "No games played yet today." : n + " game" + (n === 1 ? "" : "s") + " played today.";
  }

  function renderHistory() {
    historyList.innerHTML = "";
    var games = todaysHistoryGames();
    setPanelSummary("history-panel", computeHistorySummary());
    if (games.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No games finished yet today.";
      historyList.appendChild(hint);
      return;
    }
    games.forEach(function (entry) {
      var li = document.createElement("li");
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
      winner.appendChild(document.createTextNode("🏆 "));
      entry.winnerNames.forEach(function (n, i) {
        if (i > 0) winner.appendChild(document.createTextNode(" & "));
        winner.appendChild(document.createTextNode(n));
        winner.appendChild(buildRatingBadge(n));
      });
      li.appendChild(winner);
      li.appendChild(document.createTextNode(" won " + entry.gameLabel + " (target " + entry.target + ")"));
      if (entry.isTeam && entry.mvpName) {
        li.appendChild(document.createTextNode(" · 🎯 " + entry.mvpName + " potted it"));
        li.appendChild(buildRatingBadge(entry.mvpName));
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
  // capitalizes the typed name to become the new canonical form.
  function resolvePlayerName(name) {
    var trimmed = capitalizeName((name || "").trim());
    if (!trimmed) return trimmed;
    var known = buildNameCasingMap()[normalizeNameKey(trimmed)];
    return known || trimmed;
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
        "\"" + capitalizeName(trimmed) + "\" is already in your roster — use a different name, or add a last name/initial.";
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
    if (typeof startingRating === "number" && !isNaN(startingRating) && !findRatingKey(name)) {
      var entry = ensureRatingEntry(name);
      entry.rating = startingRating;
      saveRatingsToStorage(PLAYER_RATINGS);
    }
    return player;
  }

  function removePlayer(id) {
    if (
      !confirm(
        "Remove this player from the current roster? This only takes them off today's active list — " +
        "their saved career stats and game history stay on this device and will still show up on the " +
        "All Players page."
      )
    ) {
      return;
    }
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    delete state.playerWins[id];
    saveState();
    saveRosterSnapshotIfNew(true);
    validateNewPlayerNameInput();
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
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
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
    if (isTeam) {
      applyTeamRatingResult(winnerNames, opponentNames, ts);
    } else {
      opponentNames.forEach(function (opponentName) {
        applyPairwiseRatingResult(winnerNames[0], opponentName, ts);
      });
    }
    saveRatingsToStorage(PLAYER_RATINGS);
    state.gamesPlayedCount += 1;
    saveRosterSnapshotIfNew(true);
    saveRotationSnapshotIfNew(true);
    var previousGameType = state.currentGame.gameType;
    var previousTarget = state.currentGame.target;
    var previousUnit = state.currentGame.unit;
    applyRotationIfDue();
    var gameTypeChanged = state.currentGame.gameType !== previousGameType ||
      state.currentGame.target !== previousTarget || state.currentGame.unit !== previousUnit;
    showToast(summary);
    if (milestoneNames) {
      celebrateTournamentWin(milestoneNames, milestoneCount);
    } else if (onHillNames) {
      announceOnHill(onHillNames);
    } else if (gameTypeChanged) {
      announceGameChange(
        GAME_TYPES[state.currentGame.gameType].label + " (" + state.currentGame.target + " " + state.currentGame.unit + ")"
      );
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

  function celebrateTournamentWin(names, count) {
    var target = state.raceToWinsTarget;

    // Save this tournament's game history to per-player stats before the
    // reset below wipes state.gameHistory, then start the next one fresh.
    exportAllPlayerStats();
    startNewSession(true);

    var playerNames = activePlayers().map(function (p) {
      return p.name;
    });
    var info = rotationStatusInfo();

    milestoneHeadline.textContent = names + " won the tournament with " + count + " wins! (race-to " + target + ")";

    milestoneDetails.innerHTML = "";
    milestoneDetails.appendChild(playerStatsListRow("Players", playerNames, true));
    milestoneDetails.appendChild(playerStatsRow("Tournament goal", "Race to " + target + " wins"));
    if (state.rotation.enabled && state.rotation.order.length > 0) {
      var rotationLabels = state.rotation.order.map(rotationEntryLabel);
      milestoneDetails.appendChild(playerStatsListRow("Game rotation", rotationLabels));
      if (info) {
        milestoneDetails.appendChild(
          playerStatsRow(
            "Next switch",
            info.currentLabel + " → " + info.nextLabel + " in " + info.untilSwitch + " game" + (info.untilSwitch === 1 ? "" : "s")
          )
        );
      }
    }

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
    var allowNegative = state.currentGame.unit !== "rack";
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
  // Today's Notes & Day Report — free-text notes about today's live play,
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

  function todayDateStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function getDayNotes(dateStr) {
    return DAY_NOTES[dateStr] || "";
  }

  function setDayNotes(dateStr, text) {
    if (text) DAY_NOTES[dateStr] = text;
    else delete DAY_NOTES[dateStr];
    saveDayNotesToStorage(DAY_NOTES);
  }

  // Every distinct game played on dateStr (deduped by timestamp across
  // however many players' individual game lists it shows up in — live
  // session plus any earlier session saved today) and each player's
  // win/loss/rating tally for the day. Each game is kept from its
  // *winning* side's perspective (result === "won") so winnerNames /
  // opponentNames are neutral (winning side / losing side) rather than
  // relative to whichever player happened to be iterated last. Also
  // flagged with isLive: true when it's part of the still-open current
  // session (state.gameHistory), false when it only exists in a session
  // already saved earlier today — the closest the data model can get to
  // distinguishing "earlier today" from "this session" as separate groups.
  function computeDayReportData(dateStr) {
    var names = getAllKnownPlayerNames();
    var liveTsSet = {};
    (state.gameHistory || []).forEach(function (entry) {
      if (entry && entry.ts) liveTsSet[entry.ts] = true;
    });
    var gamesByTs = {};
    var players = [];
    names.forEach(function (name) {
      var games = allGamesForPlayerName(name).filter(function (g) {
        return g.ts && g.ts.slice(0, 10) === dateStr;
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
    return { date: dateStr, games: games, players: players };
  }

  function joinNamesForReport(names) {
    names = names || [];
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
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
        byKey[key] = { winnerNames: g.winnerNames, opponentNames: g.opponentNames, gameLabel: g.gameLabel, ts: g.ts, count: 0 };
        order.push(key);
      }
      byKey[key].count += 1;
    });
    return order.map(function (k) {
      return byKey[k];
    });
  }

  function formatReportGameGroupLine(group) {
    var winners = joinNamesForReport(group.winnerNames || []);
    var losers = joinNamesForReport(group.opponentNames || []);
    if (group.count === 1) {
      var time = formatReportGameTime(group.ts);
      var text = winners + " won " + group.gameLabel;
      if (losers) text += " against " + losers;
      return (time ? time + " — " : "") + text;
    }
    var text2 = winners + " won " + group.count + " games of " + group.gameLabel;
    if (losers) text2 += " against " + losers;
    return text2;
  }

  function formatReportDateHeading(dateStr) {
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function buildDayReportText(dateStr) {
    var data = computeDayReportData(dateStr);
    var lines = ["🎱 Pool Master Counter — Day Report", formatReportDateHeading(dateStr), ""];
    if (data.players.length === 0) {
      lines.push("No games recorded today.");
    } else {
      lines.push("Players today:");
      data.players.forEach(function (p) {
        var deltaText = p.ratingDelta === null
          ? ""
          : p.ratingDelta > 0
          ? " (▲" + p.ratingDelta + ")"
          : p.ratingDelta < 0
          ? " (▼" + p.ratingDelta + ")"
          : " (—)";
        var winWord = p.wins === 1 ? "win" : "wins";
        var lossWord = p.losses === 1 ? "loss" : "losses";
        lines.push("• " + p.name + " — " + p.wins + " " + winWord + ", " + p.losses + " " + lossWord + ", rating " + p.rating + deltaText);
      });
      lines.push("");
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

      var earlierGames = data.games.filter(function (g) {
        return !g.isLive;
      });
      var liveGames = data.games.filter(function (g) {
        return g.isLive;
      });
      var hasBothGroups = earlierGames.length > 0 && liveGames.length > 0;
      var divider = "──────────";

      if (data.games.length > 0) {
        lines.push("");
        lines.push(divider);
        lines.push("Game details:");
        if (hasBothGroups) {
          lines.push("");
          lines.push("Earlier session:");
          groupReportGames(earlierGames).forEach(function (g) {
            lines.push(formatReportGameGroupLine(g));
          });
          lines.push("");
          lines.push(divider);
          lines.push("Current session:");
          groupReportGames(liveGames).forEach(function (g) {
            lines.push(formatReportGameGroupLine(g));
          });
        } else {
          groupReportGames(data.games).forEach(function (g) {
            lines.push(formatReportGameGroupLine(g));
          });
        }
      }
    }
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("");
      lines.push("Notes:");
      lines.push(notes);
    }
    return lines.join("\n");
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
  var ROTATIONS_KEY = "poolMasterCounter.rotations.v1";
  var PLAYER_STATS_KEY = "poolMasterCounter.playerStats.v1";
  var RATINGS_KEY = "poolMasterCounter.ratings.v1";

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
    try {
      localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
    } catch (e) {
      console.warn("Could not save ratings.", e);
    }
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

  function ensureRatingEntry(name) {
    var key = findRatingKey(name) || name;
    if (!PLAYER_RATINGS[key]) {
      PLAYER_RATINGS[key] = { name: key, rating: DEFAULT_RATING, gamesPlayed: 0, history: [] };
    }
    return PLAYER_RATINGS[key];
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
    entry.history.push({ ts: ts, rating: entry.rating, delta: delta });
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
    badge.title = "Rating (Elo-style, FargoRate-inspired scale)";
    return badge;
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

  function resetAllPlayerStats() {
    if (
      !confirm(
        "This clears EVERY player's saved stat history on this device — all sessions, for all players, not just the current live session. " +
        "A backup file of all your data will be downloaded first, and can be restored later from Import Data. This cannot be undone. Continue?"
      )
    ) {
      return;
    }
    exportAllData();
    PLAYER_STATS = {};
    savePlayerStatsToStorage(PLAYER_STATS);
    if (currentStatsPlayerName) {
      currentStatsSessions = [];
      renderPlayerHistoryList([]);
    }
    showToast("Backed up your data and cleared all players' saved stat history.");
  }

  function resetAllRosterLists() {
    if (SAVED_ROSTERS.length === 0) {
      showToast("No saved player lists to reset.");
      return;
    }
    if (
      !confirm(
        "This clears every saved player list on this device (everything in the \"Load Player List\" dropdown). " +
        "A backup file of your player lists will be downloaded first, and can be restored later from Import Player Lists. This cannot be undone. Continue?"
      )
    ) {
      return;
    }
    exportRosterLists();
    SAVED_ROSTERS = [];
    saveRostersToStorage(SAVED_ROSTERS);
    populateRosterLoadSelect();
    showToast("Backed up and cleared all saved player lists.");
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
      playerStats: PLAYER_STATS,
      ratings: PLAYER_RATINGS
    };
    downloadJSON("pool-master-counter-backup-" + payload.exportedAt.slice(0, 10) + ".json", payload);
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
        alert("That file isn't valid JSON.");
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
        alert("That doesn't look like a player list file.");
        return;
      }
      var normalized = rawList.map(normalizeImportedRosterEntry).filter(Boolean);
      if (!normalized.length) {
        alert("No valid player lists found in that file.");
        return;
      }
      var merge = mergeRosterLists(SAVED_ROSTERS, normalized);
      SAVED_ROSTERS = merge.rosters;
      saveRostersToStorage(SAVED_ROSTERS);
      populateRosterLoadSelect();
      showToast(
        "Imported " + merge.added + " player list" + (merge.added === 1 ? "" : "s") +
        (merge.added < normalized.length ? " (some were already saved)." : ".")
      );
    };
    reader.onerror = function () {
      alert("Could not read that file.");
    };
    reader.readAsText(file);
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

      // A device with no players yet has nothing to lose — treat this like
      // setting up a new device from a backup and adopt it as-is. Otherwise,
      // merge: keep the in-progress game running here, and fold the
      // backup's history in without double-counting anything already known.
      var localIsFresh = state.players.length === 0;

      if (
        !confirm(
          localIsFresh
            ? "Import this backup? This device has no players set up yet, so the backup's current game and roster will be loaded as-is."
            : "Merge this backup into your existing data? Player stats and saved rosters will be combined — games already known on both sides (same player, same time) won't be counted twice. Your current in-progress game stays as-is; any new players from the backup are added to your roster."
        )
      ) {
        return;
      }

      try {
        var importedState = data.state && typeof data.state === "object" ? data.state : defaultState();
        var importedRosters = Array.isArray(data.rosters) ? data.rosters : [];
        var importedPlayerStats = data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {};

        var extraSessions = summarizeGameHistoryByPlayer(importedState.gameHistory || []);
        var mergedPlayerStats = mergePlayerStatsData(PLAYER_STATS, importedPlayerStats, extraSessions);
        var rosterMerge = mergeRosterLists(SAVED_ROSTERS, importedRosters);
        var importedRatings = data.ratings && typeof data.ratings === "object" ? data.ratings : {};
        var mergedRatings = mergeRatingsData(PLAYER_RATINGS, importedRatings);

        var importedRosterPlayerNames = [];
        importedRosters.forEach(function (r) {
          (r.players || []).forEach(function (n) {
            importedRosterPlayerNames.push(n);
          });
        });

        var finalState;
        var newPlayerCount = 0;
        if (localIsFresh) {
          finalState = importedState;
          var freshKnownNames = {};
          (finalState.players || []).forEach(function (p) {
            freshKnownNames[normalizeNameKey(p.name)] = true;
          });
          importedRosterPlayerNames.forEach(function (name) {
            if (!name || freshKnownNames[normalizeNameKey(name)]) return;
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

        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalState));
        localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosterMerge.rosters));
        localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(mergedPlayerStats));
        localStorage.setItem(RATINGS_KEY, JSON.stringify(mergedRatings));

        if (!localIsFresh) {
          alert(
            "Merged. Added " + newPlayerCount + " new player" + (newPlayerCount === 1 ? "" : "s") +
            " and " + rosterMerge.added + " saved roster list" + (rosterMerge.added === 1 ? "" : "s") +
            " from the backup. Your current game wasn't touched."
          );
        }
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
    saveRosterSnapshotIfNew(true);
    return added;
  }

  function loadSelectedRoster() {
    var idx = parseInt(rosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var added = loadRosterEntry(roster);
    validateNewPlayerNameInput();
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

  // Checks the live roster against every saved list (exact same players,
  // no more, no fewer) and, if it's genuinely new, saves it and downloads
  // a fresh player-lists backup file. Runs on every game — not just the
  // first of a session — so adding/removing a player mid-session gets
  // captured as soon as the next game is credited, not just at session
  // boundaries. Dedup against every existing list keeps this from ever
  // firing twice for the same composition.
  function saveRosterSnapshotIfNew(silent) {
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
      if (!silent) showToast("This exact player list is already saved.");
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
    if (!silent) showToast("Saved roster: " + entry.label);
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
      opt.textContent = "No saved rotations yet";
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
    showToast("Loaded rotation: \"" + rotation.label + "\".");
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
    var order = state.rotation.order;
    if (!order || order.length === 0) return false;
    var alreadySaved = SAVED_ROTATIONS.some(function (r) {
      return r.order.length === order.length && r.order.every(function (e, i) {
        return rotationEntriesEqual(e, order[i]);
      });
    });
    if (alreadySaved) {
      if (!silent) showToast("This exact rotation is already saved.");
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
    if (!silent) showToast("Saved rotation: " + entry.label);
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
      opt.textContent = "No saved lists yet";
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
      opt.textContent = "No saved rotations yet";
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
        ? "Everyone from that saved list is already in your roster."
        : "Added " + added + " player" + (added === 1 ? "" : "s") + " from \"" + roster.label + "\"."
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
    showToast("Loaded rotation: \"" + rotation.label + "\".");
  }

  function validateWizardNewPlayerNameInput() {
    var trimmed = wizardNewPlayerName.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnWizardAddPlayer.disabled = !trimmed || duplicate;
    if (duplicate) {
      wizardNewPlayerNameRequirement.textContent =
        "\"" + capitalizeName(trimmed) + "\" is already in your roster — use a different name, or add a last name/initial.";
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
      hint.textContent = "No players yet — add some above.";
      wizardPlayerChips.appendChild(hint);
      return;
    }
    state.players.forEach(function (p) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = p.name;
      name.appendChild(buildRatingBadge(p.name));
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wizard-player-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "Remove " + p.name);
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
    name.textContent = p.name;
    row.appendChild(name);
    row.appendChild(buildRatingBadge(p.name));

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
    playBtn.textContent = p.playing ? "Playing" : "Standby";
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
          showToast("Enter how many wins to race to.");
          return false;
        }
      }
      return true;
    }
    if (wizardStep === 2) {
      if (state.players.length === 0) {
        showToast("Add at least one player before continuing.");
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
        showToast("Add at least two game types to the rotation, or choose \"No\".");
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

    wizardProgress.textContent = "Step " + (idx + 1) + " of " + seq.length;

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
      btnWizardStart.textContent = wizardFormat === "tournament" ? "🏆 Go to Tournament Setup" : "🎱 Start Game";
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
      summaryRow("Format", "Tournament Elimination");
      summaryRow("Game", gameLabel);
      summaryRow("Players on roster", String(state.players.length));
      return;
    }
    summaryRow("Game", gameLabel);
    summaryRow(
      "Format",
      wizardFormat === "raceto" ? "Race to " + (parseInt(wizardRaceToInput.value, 10) || 5) + " wins" : "Individual (casual)"
    );
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    summaryRow("Players playing", playingCount + " of " + state.players.length);
    var rotationOn = Array.prototype.filter.call(wizardRotationEnabledRadios, function (r) {
      return r.checked;
    })[0].value === "yes";
    var every = state.rotation.every || 1;
    summaryRow(
      "Rotation",
      rotationOn && state.rotation.order.length
        ? rotationLabelFor(state.rotation.order) + " (every " + every + " game" + (every === 1 ? "" : "s") + ")"
        : "Off"
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
    closeWizard();
    setFocusMode(true);
    showToast("Let's play! 🎱");
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
      if (entry.ts.slice(0, 10) !== dateStr) return;
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
        durationMs: entry.durationMs
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
    var today = new Date().toISOString().slice(0, 10);
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
      session.wonTournament = wins > 0 && wins >= state.raceToWinsTarget;
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
      durationSpan.textContent = "Duration: " + durationText;
      div.appendChild(durationSpan);
    }
    div.appendChild(document.createTextNode(" — won by "));
    div.appendChild(winner);
    if (g.isTeam && g.mvpName) {
      div.appendChild(document.createTextNode(" · 🎯 " + g.mvpName + " potted it"));
      div.appendChild(buildRatingBadge(g.mvpName));
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
    playerPageCurrentBody.appendChild(playerStatsRow("Wins today", live.wins));
    playerPageCurrentBody.appendChild(playerGamesLogRow("Games", live.games));
    playerPageCurrentBody.appendChild(playerStatsListRow("Opponents", live.opponents, true));
    if (live.wonTournament) {
      var trophy = document.createElement("div");
      trophy.className = "tournament-winner-banner";
      trophy.textContent = "🏆 " + name + " Won the Tournament Today!";
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
    games.forEach(function (g) {
      if (g.result === "won") wins += 1;
      else losses += 1;
    });
    var total = wins + losses;
    return {
      wins: wins,
      losses: losses,
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
    playerPageSynopsisBody.appendChild(synopsisStatRow("Rating", getPlayerRating(currentStatsPlayerName)));
    var ratingDeltaText = formatRatingPeriodDelta(currentStatsPlayerName, currentStatsPeriod);
    if (ratingDeltaText !== null) {
      playerPageSynopsisBody.appendChild(
        synopsisStatRow(
          "Rating this period",
          ratingDeltaText,
          ratingDeltaText.charAt(0) === "▲" ? "win" : ratingDeltaText.charAt(0) === "▼" ? "loss" : null
        )
      );
    }
    playerPageSynopsisBody.appendChild(synopsisStatRow("Wins", synopsis.wins, "win"));
    playerPageSynopsisBody.appendChild(synopsisStatRow("Losses", synopsis.losses, "loss"));
    playerPageSynopsisBody.appendChild(
      synopsisStatRow("Win %", synopsis.pct === null ? "—" : synopsis.pct + "%")
    );

    var h2h = computeHeadToHead(filtered);
    playerPageH2hList.innerHTML = "";
    if (h2h.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No games against opponents in this period yet.";
      playerPageH2hList.appendChild(hint);
      return;
    }
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
      hint.textContent = "No saved sessions yet for this player — use Export Stats to start tracking.";
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
          banner.textContent = "🏆 " + playerName + " Won the Tournament!";
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

  // name: the player's name — works whether or not they're currently on
  // the roster, since saved stats are keyed by name, not id.
  function openPlayerStatsPage(name) {
    if (!name) return;
    currentStatsPlayerName = name;
    currentStatsSessions = null;
    playerPageName.textContent = name;
    playerPageName.appendChild(buildRatingBadge(name));
    renderLiveSessionForPlayer(name);
    playerPageHistoryList.innerHTML = "";
    var loading = document.createElement("li");
    loading.className = "empty-hint";
    loading.textContent = "Loading saved history…";
    playerPageHistoryList.appendChild(loading);

    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    playerPageView.classList.remove("hidden");
    window.scrollTo(0, 0);

    currentStatsSessions = getPlayerSessions(name);
    renderPlayerHistoryList(currentStatsSessions);
    setStatsPeriod("all");
  }

  function closePlayerStatsPage() {
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
    var today = new Date().toISOString().slice(0, 10);
    var live = computeSessionFromGameHistory(state.gameHistory, name, today);
    var merged = live ? mergeSessionIntoList(sessions, live) : sessions;
    var games = [];
    merged.forEach(function (s) {
      (s.games || []).forEach(function (g) {
        games.push(g);
      });
    });
    return games;
  }

  function computePlayerCareerStats(name, period) {
    var games = filterGamesByPeriod(allGamesForPlayerName(name), period);
    var wins = 0;
    var losses = 0;
    games.forEach(function (g) {
      if (g.result === "won") wins += 1;
      else losses += 1;
    });
    return {
      name: name,
      games: games,
      played: games.length,
      wins: wins,
      losses: losses,
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
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "scale-row-value";
    v.textContent = value;
    top.appendChild(l);
    top.appendChild(v);
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
    title.textContent = "Timeline";
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
  // plotting a dot per game.
  function pushBucketedPoint(arr, ts, count, period) {
    var key = bucketKeyFor(ts, period);
    var last = arr.length ? arr[arr.length - 1] : null;
    if (last && last.bucketKey === key) {
      last.ts = ts;
      last.count = count;
    } else {
      arr.push({ ts: ts, count: count, bucketKey: key });
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
      if (!g.isTeam) {
        indPlayedCount += 1;
        pushBucketedPoint(individualPlayed, g.ts, indPlayedCount, period);
        if (g.result === "won") {
          indWonCount += 1;
          pushBucketedPoint(individualWon, g.ts, indWonCount, period);
        } else {
          indLostCount += 1;
          pushBucketedPoint(individualLost, g.ts, indLostCount, period);
        }
        return;
      }
      var key = teamComboLabel(g.teammateNames) || "(teammates unknown)";
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
      pushBucketedPoint(combo.played, g.ts, combo.playedCount, period);
      if (g.result === "won") {
        combo.wonCount += 1;
        pushBucketedPoint(combo.won, g.ts, combo.wonCount, period);
      } else {
        combo.lostCount += 1;
        pushBucketedPoint(combo.lost, g.ts, combo.lostCount, period);
      }
    });

    return {
      individualPlayed: individualPlayed,
      individualWon: individualWon,
      individualLost: individualLost,
      teamCombos: teamCombos
    };
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
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.count) };
    });
    var lastCount = points.length ? points[points.length - 1].count : 0;
    var allPts = [{ x: xFor(minMs), y: yFor(0) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastCount) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  // Draws one series as a smooth path plus a dot at every real data point.
  // color is only needed for team-combo lines, which use an inline stroke/
  // fill instead of a CSS class (their color is picked at render time).
  // Returns the <g> the series was drawn into, so the legend can toggle its
  // visibility (show/hide) as one unit.
  function appendGraphSeries(svg, points, minMs, maxMs, width, height, axisMax, lineClass, dotClass, color, startHidden) {
    var geo = buildSeriesGeometry(points, minMs, maxMs, width, height, axisMax);
    var group = svgEl("g", { class: "player-graph-series" + (startHidden ? " is-hidden" : "") });
    var pathAttrs = { d: geo.path, fill: "none", class: lineClass };
    if (color) pathAttrs.stroke = color;
    group.appendChild(svgEl("path", pathAttrs));
    geo.dots.forEach(function (pt) {
      var circleAttrs = { cx: pt.x, cy: pt.y, r: 3.2, class: dotClass };
      if (color) circleAttrs.fill = color;
      group.appendChild(svgEl("circle", circleAttrs));
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
    // Guarantee "Now" is the final label, then drop whichever regular tick
    // landed right next to it — including one that happened to already be
    // in the evenly-spaced selection — so the (usually much longer) "Now"
    // text never overlaps its neighbor.
    if (finalIdxs[finalIdxs.length - 1] !== lastIdx) finalIdxs.push(lastIdx);
    while (
      finalIdxs.length > 1 &&
      (allTicks[lastIdx] - allTicks[finalIdxs[finalIdxs.length - 2]]) / span < 0.14
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
      label.textContent = isNow
        ? "Now · " +
          d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " " +
          d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
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
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.rating) };
    });
    var firstRating = points.length ? points[0].rating : axisMin;
    var lastRating = points.length ? points[points.length - 1].rating : axisMin;
    var allPts = [{ x: xFor(minMs), y: yFor(firstRating) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastRating) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  function appendRatingGraphSeries(svg, points, minMs, maxMs, width, height, axisMin, axisMax) {
    var geo = buildRatingSeriesGeometry(points, minMs, maxMs, width, height, axisMin, axisMax);
    var group = svgEl("g", { class: "player-graph-series" });
    group.appendChild(svgEl("path", { d: geo.path, fill: "none", class: "player-rating-graph-line" }));
    geo.dots.forEach(function (pt) {
      group.appendChild(svgEl("circle", { cx: pt.x, cy: pt.y, r: 3.2, class: "player-rating-graph-dot" }));
    });
    svg.appendChild(group);
    return group;
  }

  // A small standalone "rating over time" chart, appended after the main
  // played/won/lost graph — kept separate because ratings (roughly 0-900,
  // no meaningful zero baseline) can't share a Y-axis with game counts.
  function buildRatingGraphSection(name, minMs, maxMs, period) {
    var section = document.createElement("div");
    section.className = "player-rating-graph-wrap";

    var heading = document.createElement("h3");
    heading.className = "player-rating-graph-heading";
    heading.textContent = "Rating";
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
      hint.textContent = "No rating changes in this period (currently " + getPlayerRating(name) + ").";
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
    appendRatingGraphSeries(svg, pointsInWindow, minMs, maxMs, width, height, axisMin, axisMax);

    chart.appendChild(svg);
    section.appendChild(chart);
    section.appendChild(buildGraphTimeAxis(minMs, maxMs, period));
    return section;
  }

  function buildPlayerGraph(stats, minMs, maxMs, period) {
    var wrap = document.createElement("div");
    wrap.className = "player-graph-wrap";

    var series = buildCumulativeSeries(stats.games, period);
    var comboKeys = Object.keys(series.teamCombos).sort();

    var maxCount = 0;
    [series.individualPlayed, series.individualWon, series.individualLost].forEach(function (arr) {
      if (arr.length) maxCount = Math.max(maxCount, arr[arr.length - 1].count);
    });
    comboKeys.forEach(function (key) {
      var c = series.teamCombos[key];
      if (c.playedCount) maxCount = Math.max(maxCount, c.playedCount);
    });

    if (maxCount === 0) {
      var emptyHint = document.createElement("p");
      emptyHint.className = "player-graph-empty";
      emptyHint.textContent = "No games in this period yet.";
      wrap.appendChild(emptyHint);
      wrap.appendChild(buildRatingGraphSection(stats.name, minMs, maxMs, period));
      return wrap;
    }

    var axisMax = axisMaxFor(maxCount);
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
        null
      );
      legendItems.push({ color: "var(--info)", style: "solid", label: "Individual — Played", group: gIndPlayed });
    }
    if (series.individualWon.length) {
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
        null
      );
      legendItems.push({ color: "var(--accent)", style: "dotted", label: "Individual — Won", group: gIndWon });
    }
    if (series.individualLost.length) {
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
        true
      );
      legendItems.push({
        color: "var(--danger)",
        style: "dashed",
        label: "Individual — Lost",
        group: gIndLost,
        startHidden: true
      });
    }

    comboKeys.forEach(function (key, idx) {
      var combo = series.teamCombos[key];
      var color = TEAM_COMBO_PALETTE[idx % TEAM_COMBO_PALETTE.length];
      if (combo.played.length) {
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
          color
        );
        legendItems.push({ color: color, style: "solid", label: "w/ " + key + " — Played", group: gComboPlayed });
      }
      if (combo.won.length) {
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
          color
        );
        legendItems.push({ color: color, style: "dotted", label: "w/ " + key + " — Won", group: gComboWon });
      }
      if (combo.lost.length) {
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
          true
        );
        legendItems.push({
          color: color,
          style: "dashed",
          label: "w/ " + key + " — Lost",
          group: gComboLost,
          startHidden: true
        });
      }
    });

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
      toggleBtn.textContent = item.startHidden ? "Show" : "Hide";
      toggleBtn.setAttribute("aria-pressed", item.startHidden ? "false" : "true");
      toggleBtn.addEventListener("click", function () {
        var nowHidden = item.group.classList.toggle("is-hidden");
        row.classList.toggle("is-off", nowHidden);
        toggleBtn.textContent = nowHidden ? "Show" : "Hide";
        toggleBtn.setAttribute("aria-pressed", nowHidden ? "false" : "true");
      });
      row.appendChild(swatch);
      row.appendChild(toggleBtn);
      row.appendChild(text);
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    wrap.appendChild(buildRatingGraphSection(stats.name, minMs, maxMs, period));

    return wrap;
  }

  function buildAllPlayerCard(stats, maxPlayed, maxWins, maxLosses, minMs, maxMs, period, isInLiveRoster) {
    var li = document.createElement("li");
    li.className = "all-player-card";

    var top = document.createElement("div");
    top.className = "all-player-card-top";
    var name = document.createElement("button");
    name.type = "button";
    name.className = "all-player-name";
    name.textContent = stats.name;
    name.appendChild(buildRatingBadge(stats.name));
    name.setAttribute("aria-label", "View stats for " + stats.name);
    name.addEventListener("click", function () {
      openPlayerStatsPage(stats.name);
    });
    var summary = document.createElement("span");
    summary.className = "all-player-summary";
    summary.textContent = stats.winPct === null ? "No games yet" : Math.round(stats.winPct * 100) + "% win rate";
    top.appendChild(name);
    top.appendChild(summary);
    li.appendChild(top);

    var ratingDeltaText = formatRatingPeriodDelta(stats.name, period);
    if (ratingDeltaText !== null) {
      var ratingStatus = document.createElement("div");
      ratingStatus.className = "all-player-rating-status";
      if (ratingDeltaText.charAt(0) === "▲") ratingStatus.classList.add("is-up");
      else if (ratingDeltaText.charAt(0) === "▼") ratingStatus.classList.add("is-down");
      ratingStatus.textContent = "Rating this period: " + ratingDeltaText;
      li.appendChild(ratingStatus);
    }

    if (allPlayersViewMode === "graph") {
      if (isInLiveRoster) {
        li.appendChild(buildPlayerGraph(stats, minMs, maxMs, period));
      } else {
        var graphHolder = document.createElement("div");
        graphHolder.className = "all-player-graph-holder hidden";
        var showGraphBtn = document.createElement("button");
        showGraphBtn.type = "button";
        showGraphBtn.className = "btn btn-ghost all-player-show-graph-btn";
        showGraphBtn.textContent = "Show Graph";
        showGraphBtn.addEventListener("click", function () {
          if (!graphHolder.hasChildNodes()) {
            graphHolder.appendChild(buildPlayerGraph(stats, minMs, maxMs, period));
          }
          var nowHidden = graphHolder.classList.toggle("hidden");
          showGraphBtn.textContent = nowHidden ? "Show Graph" : "Hide Graph";
        });
        li.appendChild(showGraphBtn);
        li.appendChild(graphHolder);
      }
    } else {
      li.appendChild(buildScaleRow("Games Played", stats.played, maxPlayed, "scale-fill-played"));
      li.appendChild(buildScaleRow("Games Won", stats.wins, maxWins, "scale-fill-won"));
      li.appendChild(buildScaleRow("Games Lost", stats.losses, maxLosses, "scale-fill-lost"));

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

    var maxPlayed = 0;
    var maxWins = 0;
    var maxLosses = 0;
    var minTs = null;
    stats.forEach(function (s) {
      maxPlayed = Math.max(maxPlayed, s.played);
      maxWins = Math.max(maxWins, s.wins);
      maxLosses = Math.max(maxLosses, s.losses);
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
    var winsAxisMax = axisMaxFor(maxWins);
    var lossesAxisMax = axisMaxFor(maxLosses);

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
        ? "No players in the current roster. Turn off \"Current Roster Only\" to see everyone."
        : "No players yet — add players and play a few games first.";
      allPlayersList.appendChild(hint);
      return;
    }
    sorted.forEach(function (s) {
      allPlayersList.appendChild(
        buildAllPlayerCard(s, playedAxisMax, winsAxisMax, lossesAxisMax, minMs, maxMs, period, !!liveRosterNames[s.name])
      );
    });
  }

  function openAllPlayersPage() {
    renderAllPlayersPage();
    appRoot.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    allPlayersPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeAllPlayersPage() {
    allPlayersPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
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

  function loadTournamentFromStorage() {
    try {
      var raw = localStorage.getItem(TOURNAMENT_KEY);
      return raw ? JSON.parse(raw) : null;
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

  function createBracketMatch(a, b, tag) {
    return { id: uid(), a: a || null, b: b || null, winner: null, loser: null, tag: tag, collected: false };
  }

  function pairUpNames(names, tag) {
    var matches = [];
    var i = 0;
    while (i + 1 < names.length) {
      matches.push(createBracketMatch(names[i], names[i + 1], tag));
      i += 2;
    }
    var leftover = i < names.length ? [names[i]] : [];
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

  function pendingBracketMatches(t) {
    return pendingWbMatches(t).concat(pendingLbMatches(t), pendingGfMatches(t));
  }

  function findBracketMatchById(t, id) {
    var all = [];
    t.wb.forEach(function (r) {
      all = all.concat(r);
    });
    t.lbRounds.forEach(function (r) {
      all = all.concat(r);
    });
    all = all.concat(t.grandFinal);
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
            } else {
              t.wbChampion = m.winner;
            }
          }
        });
      });

      while (t.lbNextWbRoundToDrop < t.wb.length && wbRoundComplete(t, t.lbNextWbRoundToDrop)) {
        var ri2 = t.lbNextWbRoundToDrop;
        var losers = t.wb[ri2]
          .map(function (m) {
            return m.loser;
          })
          .filter(function (x) {
            return x !== null;
          });
        t.lbNextWbRoundToDrop += 1;
        changed = true;
        if (ri2 === 0) {
          var res = pairUpNames(losers, "Losers R1");
          if (res.matches.length) t.lbRounds.push(res.matches);
          t.lbWaiting = t.lbWaiting.concat(res.leftover);
        } else {
          var matches2 = [];
          var newWaiting = [];
          var li = 0;
          var wi = 0;
          var waiting = t.lbWaiting;
          while (li < losers.length || wi < waiting.length) {
            if (wi < waiting.length && li < losers.length) {
              matches2.push(createBracketMatch(waiting[wi], losers[li], "Losers"));
              wi += 1;
              li += 1;
            } else if (wi < waiting.length) {
              newWaiting.push(waiting[wi]);
              wi += 1;
            } else {
              newWaiting.push(losers[li]);
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
            t.lbWaiting.push(m.winner);
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
        t.lbChampion = t.lbWaiting[0];
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
  // (1v4/2v3, etc.) so byes land spread across the draw, every later round
  // starting empty until winners advance into it.
  function buildWinnersBracketRounds(playerNames) {
    var shuffled = playerNames.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var n = shuffled.length;
    var size = nextPow2(n);
    var order = seedOrder(size);
    var slots = order.map(function (s) {
      return s <= n ? shuffled[s - 1] : null;
    });

    var wb = [];
    var r1 = [];
    for (var k = 0; k < size; k += 2) {
      r1.push(createBracketMatch(slots[k], slots[k + 1], "Winners R1"));
    }
    wb.push(r1);
    var nrounds = Math.round(Math.log(size) / Math.log(2));
    for (var r = 1; r < nrounds; r++) {
      var prev = wb[wb.length - 1];
      var cur = [];
      for (var m = 0; m < prev.length / 2; m++) {
        cur.push(createBracketMatch(null, null, "Winners R" + (r + 1)));
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

    return { shuffled: shuffled, size: size, wb: wb };
  }

  function buildDoubleEliminationBracket(playerNames, gameType, target, raceTo) {
    var built = buildWinnersBracketRounds(playerNames);
    var t = {
      format: "double",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
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
      active: null
    };
    advanceBracket(t);
    return t;
  }

  // Single elimination: same winners-bracket shape as double elimination,
  // but there's no losers bracket to drop into (lbNextWbRoundToDrop starts
  // past the last round, so the losers-bracket logic in advanceBracket
  // never fires) and no grand final — the winners-bracket champion is the
  // tournament champion outright.
  function buildSingleEliminationBracket(playerNames, gameType, target, raceTo) {
    var built = buildWinnersBracketRounds(playerNames);
    var t = {
      format: "single",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
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
      active: null
    };
    advanceBracket(t);
    return t;
  }

  function isGrandFinalMatch(t, match) {
    return t.grandFinal.indexOf(match) !== -1;
  }

  function reportBracketResult(t, match, winnerName) {
    if (match.a !== winnerName && match.b !== winnerName) return;
    match.winner = winnerName;
    match.loser = match.a === winnerName ? match.b : match.a;
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

  function recordTournamentRackWin(winnerName, loserName, durationMs) {
    var typeLabel = GAME_TYPES[TOURNAMENT.gameType] ? GAME_TYPES[TOURNAMENT.gameType].label : TOURNAMENT.gameType;
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
      gameType: TOURNAMENT.gameType,
      gameLabel: typeLabel,
      target: TOURNAMENT.target,
      winnerNames: [winnerName],
      opponentNames: [loserName],
      isTeam: false,
      mvpId: null,
      mvpName: null,
      durationMs: durationMs,
      summary: winnerName + " won " + typeLabel + " (tournament vs " + loserName + ")"
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    applyPairwiseRatingResult(winnerName, loserName, ts);
    saveRatingsToStorage(PLAYER_RATINGS);
    saveState();
  }

  function renderTournamentPlayerChecklist() {
    var names = getAllKnownPlayerNames().sort(function (a, b) {
      return a.localeCompare(b);
    });
    var activeNames = {};
    activePlayers().forEach(function (p) {
      activeNames[p.name] = true;
    });
    tournamentPlayerChecklist.innerHTML = "";
    if (names.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players first.";
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
      tournamentPlayerChecklist.appendChild(li);
    });
  }

  function getCheckedTournamentPlayers() {
    return Array.prototype.slice
      .call(tournamentPlayerChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });
  }

  function startTournament() {
    var names = getCheckedTournamentPlayers();
    if (names.length < 2) {
      alert("Pick at least 2 players to start a tournament.");
      return;
    }
    var gameType = tournamentGameTypeSelect.value;
    var target = parseInt(tournamentTargetInput.value, 10) || GAME_TYPES[gameType].defaultTarget;
    var raceTo = parseInt(tournamentRaceToInput.value, 10) || 1;
    var format = Array.prototype.filter.call(tournamentFormatRadios, function (r) {
      return r.checked;
    })[0].value;
    TOURNAMENT = format === "single"
      ? buildSingleEliminationBracket(names, gameType, target, raceTo)
      : buildDoubleEliminationBracket(names, gameType, target, raceTo);
    saveTournamentToStorage(TOURNAMENT);
    renderTournamentPage();
  }

  function abandonTournament() {
    var isDone = TOURNAMENT && TOURNAMENT.champion;
    if (
      !isDone &&
      !confirm(
        "Abandon this tournament? The bracket will be cleared, but every match already played stays saved in each player's stats."
      )
    ) {
      return;
    }
    TOURNAMENT = null;
    saveTournamentToStorage(null);
    renderTournamentPage();
  }

  function tournamentMatchCard(match, activeMatchId) {
    var div = document.createElement("div");
    var isActive = activeMatchId === match.id;
    var stateClass = match.winner ? "is-done" : isActive ? "is-active" : match.a && match.b ? "is-ready" : "is-pending";
    div.className = "tournament-match-card " + stateClass;

    [match.a, match.b].forEach(function (name) {
      var row = document.createElement("div");
      row.className = "tournament-match-side";
      var isWinner = match.winner && name === match.winner;
      if (isWinner) row.classList.add("is-winner");
      if (match.winner && name === match.loser) row.classList.add("is-loser");
      row.textContent = (isWinner ? "👑 " : "") + (name || "—");
      if (name) row.appendChild(buildRatingBadge(name));
      div.appendChild(row);
    });

    if (isActive) {
      var playingNote = document.createElement("div");
      playingNote.className = "tournament-playing-note";
      playingNote.textContent = "▶ Playing now";
      div.appendChild(playingNote);
    } else if (match.a && match.b && !match.winner) {
      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn-primary tournament-play-btn";
      playBtn.textContent = "Play";
      playBtn.addEventListener("click", function () {
        startTournamentMatch(match.id);
      });
      div.appendChild(playBtn);
    }

    return div;
  }

  // Renders the winners bracket as a real horizontal tree: round 1 on the
  // left, each pair of matches converging into the match they feed, all the
  // way to the final on the right. Built as nested "children + this round's
  // match" wrappers rather than flat columns — the connector lines are then
  // pure CSS (percentages against each pair's own wrapper), needing no
  // pixel measurement, because a 2-item "space-around" column always places
  // its items at exactly 25%/75% of the wrapper's height regardless of the
  // wrapper's actual size.
  function renderWbTreeNode(t, ri, mi, activeMatchId) {
    var match = t.wb[ri][mi];
    var card = tournamentMatchCard(match, activeMatchId);
    if (ri === 0) {
      card.classList.add("wb-tree-leaf");
      return card;
    }
    var childrenWrap = document.createElement("div");
    childrenWrap.className = "wb-tree-children";
    childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2, activeMatchId));
    childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2 + 1, activeMatchId));

    var node = document.createElement("div");
    node.className = "wb-tree-node";
    node.appendChild(childrenWrap);
    node.appendChild(card);
    return node;
  }

  function renderWbTree(container, t, activeMatchId) {
    container.innerHTML = "";
    var lastRound = t.wb.length - 1;
    var root = renderWbTreeNode(t, lastRound, 0, activeMatchId);
    root.classList.add("wb-tree-root");
    container.appendChild(root);
  }

  function renderBracketColumns(container, rounds, activeMatchId) {
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
        col.appendChild(tournamentMatchCard(m, activeMatchId));
      });
      container.appendChild(col);
    });
  }

  function startTournamentMatch(matchId) {
    var match = findBracketMatchById(TOURNAMENT, matchId);
    if (!match || match.winner) return;
    TOURNAMENT.active = {
      matchId: matchId,
      aBalls: 0,
      bBalls: 0,
      aWins: 0,
      bWins: 0,
      startedAt: new Date().toISOString()
    };
    saveTournamentToStorage(TOURNAMENT);
    renderTournamentActive();
  }

  function tournamentAdjustScore(side, delta) {
    var t = TOURNAMENT;
    if (!t || !t.active) return;
    var match = findBracketMatchById(t, t.active.matchId);
    if (!match) return;
    var gameType = GAME_TYPES[t.gameType];
    var allowNegative = gameType.unit !== "rack";
    var ballsKey = side === "a" ? "aBalls" : "bBalls";
    var winsKey = side === "a" ? "aWins" : "bWins";
    var next = (t.active[ballsKey] || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    t.active[ballsKey] = next;

    var name = side === "a" ? match.a : match.b;
    var otherName = side === "a" ? match.b : match.a;
    var player = getPlayer(getPlayerIdByName(name));
    var voice = player ? player.voice : undefined;

    if (delta > 0 && next >= t.target) {
      t.active[winsKey] += 1;
      var startedMs = t.active.startedAt ? new Date(t.active.startedAt).getTime() : null;
      var durationMs = startedMs ? Math.max(0, Date.now() - startedMs) : null;
      recordTournamentRackWin(name, otherName, durationMs);
      t.active.aBalls = 0;
      t.active.bBalls = 0;
      t.active.startedAt = new Date().toISOString();
      playWinSound(voice);
      if (t.active[winsKey] >= t.raceTo) {
        reportBracketResult(t, match, name);
        t.active = null;
        saveTournamentToStorage(t);
        renderTournamentPage();
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

  function buildTournamentSidePanel(name, side, balls, wins, t) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = name;
    nameEl.appendChild(buildRatingBadge(name));
    panel.appendChild(nameEl);

    panel.appendChild(buildStatMini("Match wins", wins, wins >= t.raceTo));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = GAME_TYPES[t.gameType].label + " · Target " + t.target;
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = balls;
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

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
      tournamentAdjustScore(side, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + name);
    plusBtn.addEventListener("click", function () {
      tournamentAdjustScore(side, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    panel.appendChild(controls);

    return panel;
  }

  function renderTournamentActiveMatch() {
    var t = TOURNAMENT;
    tournamentCurrentMatchPanel.innerHTML = "";
    if (!t || !t.active) return;
    var match = findBracketMatchById(t, t.active.matchId);
    if (!match) {
      t.active = null;
      return;
    }
    var gameType = GAME_TYPES[t.gameType];

    var banner = document.createElement("div");
    banner.className = "now-playing-banner tournament-now-playing";
    banner.textContent = gameType.label + " — " + match.tag;
    tournamentCurrentMatchPanel.appendChild(banner);

    var board = document.createElement("div");
    board.className = "scoreboard";
    board.appendChild(buildTournamentSidePanel(match.a, "a", t.active.aBalls, t.active.aWins, t));
    board.appendChild(buildTournamentSidePanel(match.b, "b", t.active.bBalls, t.active.bWins, t));
    tournamentCurrentMatchPanel.appendChild(board);
  }

  function renderTournamentActive() {
    var t = TOURNAMENT;
    var activeMatchId = t.active ? t.active.matchId : null;
    var isSingle = t.format === "single";
    tournamentLbSection.classList.toggle("hidden", isSingle);
    tournamentGfSection.classList.toggle("hidden", isSingle);
    renderWbTree(tournamentWbEl, t, activeMatchId);
    if (!isSingle) {
      renderBracketColumns(tournamentLbEl, t.lbRounds, activeMatchId);
      renderBracketColumns(tournamentGfEl, t.grandFinal.length ? [t.grandFinal] : [], activeMatchId);
    }

    btnTournamentAbandon.textContent = t.champion ? "Start New Tournament" : "Abandon Tournament";

    if (t.champion) {
      tournamentChampionBanner.classList.remove("hidden");
      tournamentChampionBanner.textContent = "🏆 " + t.champion + " won the tournament!";
      tournamentChampionBanner.appendChild(buildRatingBadge(t.champion));
    } else {
      tournamentChampionBanner.classList.add("hidden");
      tournamentChampionBanner.textContent = "";
    }

    tournamentReadyList.innerHTML = "";
    tournamentCurrentMatchPanel.innerHTML = "";

    if (t.active) {
      renderTournamentActiveMatch();
      return;
    }
    if (t.champion) return;

    var ready = pendingBracketMatches(t);
    if (ready.length === 0) return;
    if (ready.length === 1) {
      startTournamentMatch(ready[0].id);
      return;
    }
    var heading = document.createElement("li");
    heading.className = "tournament-ready-heading";
    heading.textContent = "Ready to play (" + ready.length + ")";
    tournamentReadyList.appendChild(heading);
    ready.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "tournament-ready-row";
      var text = document.createElement("span");
      text.appendChild(document.createTextNode(m.a));
      text.appendChild(buildRatingBadge(m.a));
      text.appendChild(document.createTextNode(" vs " + m.b));
      text.appendChild(buildRatingBadge(m.b));
      text.appendChild(document.createTextNode(" (" + m.tag + ")"));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "Play";
      btn.addEventListener("click", function () {
        startTournamentMatch(m.id);
      });
      li.appendChild(text);
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

  function openTournamentPage() {
    renderTournamentPage();
    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    tournamentPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeTournamentPage() {
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
    var live = computeLiveSessionForPlayer(name);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    currentStatsSessions = sessions;
    setPlayerSessions(name, sessions);
    renderPlayerHistoryList(sessions);
    renderPlayerSynopsis();
    showToast("Saved " + name + "'s stats.");
  }

  function resetPlayerHistoricalStats() {
    var name = currentStatsPlayerName;
    if (!name) return;
    if (
      !confirm(
        "This clears " + name + "'s saved session history on this device. " +
        "This session's live stats are not affected. Continue?"
      )
    ) {
      return;
    }
    currentStatsSessions = [];
    setPlayerSessions(name, []);
    renderPlayerHistoryList([]);
    renderPlayerSynopsis();
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
  btnResetRosterLists.addEventListener("click", resetAllRosterLists);

  btnExportRosterLists.addEventListener("click", exportRosterLists);

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
    var alreadyRated = starting !== null && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(newPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    newPlayerName.value = "";
    newPlayerRatingInput.value = "";
    validateNewPlayerNameInput();
    saveRosterSnapshotIfNew(true);
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
  });

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      state.currentGame.mode = radio.value;
      saveState();
      renderAll();
      updateCurrentGameSummary();
    });
  });

  raceToWinsInput.addEventListener("input", function () {
    var target = parseInt(raceToWinsInput.value, 10);
    if (!target || target < 1) return;
    state.raceToWinsTarget = target;
    saveState();
    renderScoreboard();
    renderStandings();
    updateCurrentGameSummary();
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
  btnRotationLoad.addEventListener("click", loadSelectedRotation);

  btnOpenHelpButtons.forEach(function (btn) {
    if (btn) btn.addEventListener("click", openHelp);
  });
  btnHelpClose.addEventListener("click", closeHelp);
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

  btnOpenWizard.addEventListener("click", openWizard);
  btnWizardClose.addEventListener("click", closeWizard);
  btnWizardCancel.addEventListener("click", closeWizard);
  wizardOverlay.addEventListener("click", function (e) {
    if (e.target === wizardOverlay) closeWizard();
  });
  btnWizardBack.addEventListener("click", wizardBack);
  btnWizardNext.addEventListener("click", wizardNext);
  btnWizardStart.addEventListener("click", finalizeWizardAndStart);

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
    var alreadyRated = starting !== null && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(wizardNewPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    wizardNewPlayerName.value = "";
    wizardNewPlayerRatingInput.value = "";
    validateWizardNewPlayerNameInput();
    saveRosterSnapshotIfNew(true);
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
  wireCollapsiblePanel("focus-players-wrap", "btn-toggle-focus-players");

  var dayNotesSaveTimer = null;
  dayNotesTextarea.addEventListener("input", function () {
    clearTimeout(dayNotesSaveTimer);
    dayNotesSaveTimer = setTimeout(function () {
      setDayNotes(todayDateStr(), dayNotesTextarea.value);
      updateDayNotesSummary();
    }, 500);
  });

  btnDayReportCopy.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast("Day report copied.");
        },
        function () {
          alert(text);
        }
      );
    } else {
      alert(text);
    }
  });

  btnDayReportEmail.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    window.location.href = "mailto:?subject=" + encodeURIComponent("Pool Master Counter — Day Report") + "&body=" + encodeURIComponent(text);
  });

  btnDayReportSms.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    window.location.href = "sms:&body=" + encodeURIComponent(text);
  });

  btnPlayerPageExport.addEventListener("click", exportCurrentPlayerStats);
  btnPlayerPageReset.addEventListener("click", resetPlayerHistoricalStats);
  btnPlayerPageBack.addEventListener("click", closePlayerStatsPage);
  btnReturnToGlobalStats.addEventListener("click", returnToGlobalStats);

  btnOpenAllPlayers.addEventListener("click", openAllPlayersPage);
  btnAllPlayersBack.addEventListener("click", closeAllPlayersPage);
  allPlayersSortSelect.addEventListener("change", renderAllPlayersPage);
  allPlayersPeriodSelect.addEventListener("change", renderAllPlayersPage);
  btnToggleAllPlayersView.addEventListener("click", function () {
    allPlayersViewMode = allPlayersViewMode === "bars" ? "graph" : "bars";
    btnToggleAllPlayersView.textContent = allPlayersViewMode === "graph" ? "📊 See as Bars" : "📈 See as Graph";
    renderAllPlayersPage();
  });
  btnToggleRosterFilter.addEventListener("click", function () {
    allPlayersRosterOnly = !allPlayersRosterOnly;
    btnToggleRosterFilter.classList.toggle("is-active", allPlayersRosterOnly);
    btnToggleRosterFilter.textContent = allPlayersRosterOnly ? "👥 Showing Roster Only" : "👥 Current Roster Only";
    renderAllPlayersPage();
  });

  btnOpenTournament.addEventListener("click", openTournamentPage);
  btnTournamentBack.addEventListener("click", closeTournamentPage);
  btnTournamentStart.addEventListener("click", startTournament);
  btnTournamentAbandon.addEventListener("click", abandonTournament);
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
  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.checked = radio.value === state.currentGame.mode;
  });
  updateCurrentGameSummary();

  dayNotesTextarea.value = getDayNotes(todayDateStr());
  updateDayNotesSummary();

  if (state.rotation.enabled && state.rotation.order.length > 0) {
    state.gamesPlayedCount = 0;
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
    boot();
  });
})();
