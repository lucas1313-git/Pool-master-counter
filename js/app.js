(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v1";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var currentMatchId = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.matches)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Could not read saved state, starting fresh.", e);
    }
    return { players: [], matches: [] };
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

  function getMatch(id) {
    for (var i = 0; i < state.matches.length; i++) {
      if (state.matches[i].id === id) return state.matches[i];
    }
    return null;
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

  function playPositiveSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(660, now, 0.09, "triangle", 0.22);
    tone(990, now + 0.07, 0.14, "triangle", 0.2);
  }

  function playNegativeSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(220, now, 0.18, "sawtooth", 0.18);
    tone(160, now + 0.05, 0.22, "sawtooth", 0.16);
  }

  function playWinSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(523, now, 0.12, "triangle", 0.22);
    tone(659, now + 0.1, 0.12, "triangle", 0.22);
    tone(784, now + 0.2, 0.28, "triangle", 0.24);
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var viewHome = document.getElementById("view-home");
  var viewMatch = document.getElementById("view-match");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var playerList = document.getElementById("player-list");

  var btnNewMatch = document.getElementById("btn-new-match");
  var newMatchForm = document.getElementById("new-match-form");
  var matchPlayer1 = document.getElementById("match-player1");
  var matchPlayer2 = document.getElementById("match-player2");
  var matchRaceTo = document.getElementById("match-race-to");
  var btnCancelMatch = document.getElementById("btn-cancel-match");
  var matchList = document.getElementById("match-list");
  var btnShareAll = document.getElementById("btn-share-all");

  var btnBack = document.getElementById("btn-back");
  var matchRaceLabel = document.getElementById("match-race-label");
  var btnShareMatch = document.getElementById("btn-share-match");
  var btnDeleteMatch = document.getElementById("btn-delete-match");
  var winnerBanner = document.getElementById("winner-banner");
  var scoreboard = document.getElementById("scoreboard");

  // ---------------------------------------------------------------------
  // Rendering: Home view
  // ---------------------------------------------------------------------

  function renderPlayers() {
    playerList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players to get started.";
      playerList.appendChild(hint);
    }
    state.players.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "chip";
      var span = document.createElement("span");
      span.textContent = p.name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove " + p.name);
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      li.appendChild(span);
      li.appendChild(btn);
      playerList.appendChild(li);
    });
    populatePlayerSelects();
  }

  function populatePlayerSelects() {
    [matchPlayer1, matchPlayer2].forEach(function (sel) {
      var prev = sel.value;
      sel.innerHTML = "";
      state.players.forEach(function (p) {
        var opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
      });
      if (prev) sel.value = prev;
    });
    if (state.players.length > 1 && matchPlayer1.value === matchPlayer2.value) {
      matchPlayer2.selectedIndex = 1;
    }
  }

  function removePlayer(id) {
    var inUse = state.matches.some(function (m) {
      return m.player1Id === id || m.player2Id === id;
    });
    if (inUse) {
      if (!confirm("This player has matches. Remove player and their matches?")) {
        return;
      }
      state.matches = state.matches.filter(function (m) {
        return m.player1Id !== id && m.player2Id !== id;
      });
    }
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    saveState();
    renderPlayers();
    renderMatches();
  }

  function renderMatches() {
    matchList.innerHTML = "";
    if (state.matches.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No matches yet. Start one above.";
      matchList.appendChild(hint);
      return;
    }
    var sorted = state.matches.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    sorted.forEach(function (m) {
      var p1 = getPlayer(m.player1Id);
      var p2 = getPlayer(m.player2Id);
      if (!p1 || !p2) return;

      var li = document.createElement("li");
      li.className = "match-card" + (m.status === "completed" ? " completed" : "");
      li.addEventListener("click", function () {
        openMatch(m.id);
      });

      var left = document.createElement("div");
      var names = document.createElement("div");
      names.className = "names";
      names.textContent = p1.name + " vs " + p2.name;
      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = "Race to " + m.raceTo;
      if (m.status === "completed") {
        var badge = document.createElement("span");
        badge.className = "badge-done";
        var winner = getPlayer(m.winnerId);
        badge.textContent = winner ? winner.name + " won" : "Done";
        sub.appendChild(badge);
      }
      left.appendChild(names);
      left.appendChild(sub);

      var score = document.createElement("div");
      score.className = "score";
      score.textContent = m.games[m.player1Id] + " – " + m.games[m.player2Id];

      li.appendChild(left);
      li.appendChild(score);
      matchList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Match creation / deletion
  // ---------------------------------------------------------------------

  function createMatch(player1Id, player2Id, raceTo) {
    var match = {
      id: uid(),
      player1Id: player1Id,
      player2Id: player2Id,
      raceTo: raceTo,
      status: "in_progress",
      winnerId: null,
      games: {},
      balls: {},
      createdAt: Date.now()
    };
    match.games[player1Id] = 0;
    match.games[player2Id] = 0;
    match.balls[player1Id] = 0;
    match.balls[player2Id] = 0;
    state.matches.push(match);
    saveState();
    renderMatches();
    return match;
  }

  function deleteMatch(id) {
    if (!confirm("Delete this match? This cannot be undone.")) return;
    state.matches = state.matches.filter(function (m) {
      return m.id !== id;
    });
    saveState();
    goHome();
    renderMatches();
  }

  // ---------------------------------------------------------------------
  // Match view
  // ---------------------------------------------------------------------

  function openMatch(id) {
    currentMatchId = id;
    viewHome.classList.add("hidden");
    viewMatch.classList.remove("hidden");
    renderMatchView();
  }

  function goHome() {
    currentMatchId = null;
    viewMatch.classList.add("hidden");
    viewHome.classList.remove("hidden");
    renderMatches();
  }

  function renderMatchView() {
    var m = getMatch(currentMatchId);
    if (!m) {
      goHome();
      return;
    }
    var p1 = getPlayer(m.player1Id);
    var p2 = getPlayer(m.player2Id);

    matchRaceLabel.textContent = p1.name + " vs " + p2.name + " · Race to " + m.raceTo;

    if (m.status === "completed") {
      var winner = getPlayer(m.winnerId);
      winnerBanner.textContent = "🏆 " + (winner ? winner.name : "") + " wins the match!";
      winnerBanner.classList.remove("hidden");
    } else {
      winnerBanner.classList.add("hidden");
    }

    scoreboard.innerHTML = "";
    scoreboard.appendChild(buildPlayerPanel(m, p1));
    scoreboard.appendChild(buildPlayerPanel(m, p2));
  }

  function buildPlayerPanel(match, player) {
    var isWinner = match.winnerId === player.id;
    var matchOver = match.status === "completed";

    var panel = document.createElement("div");
    panel.className = "player-panel" + (isWinner ? " is-winner" : "");

    var name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;
    panel.appendChild(name);

    var gamesBlock = document.createElement("div");
    gamesBlock.className = "stat-block";
    var gamesLabel = document.createElement("div");
    gamesLabel.className = "stat-label";
    gamesLabel.textContent = "Games";
    var gamesValue = document.createElement("div");
    gamesValue.className = "stat-value";
    gamesValue.textContent = match.games[player.id];
    gamesBlock.appendChild(gamesLabel);
    gamesBlock.appendChild(gamesValue);
    panel.appendChild(gamesBlock);

    var winBtn = document.createElement("button");
    winBtn.type = "button";
    winBtn.className = "btn-win";
    winBtn.textContent = "Win Game";
    winBtn.disabled = matchOver;
    winBtn.addEventListener("click", function () {
      winGame(match.id, player.id);
    });
    panel.appendChild(winBtn);

    var ballsBlock = document.createElement("div");
    ballsBlock.className = "stat-block";
    var ballsLabel = document.createElement("div");
    ballsLabel.className = "stat-label";
    ballsLabel.textContent = "Balls this game";
    var ballsValue = document.createElement("div");
    ballsValue.className = "stat-value balls";
    ballsValue.textContent = match.balls[player.id];
    ballsBlock.appendChild(ballsLabel);
    ballsBlock.appendChild(ballsValue);
    panel.appendChild(ballsBlock);

    var controls = document.createElement("div");
    controls.className = "ball-controls";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove ball for " + player.name);
    minusBtn.disabled = matchOver || match.balls[player.id] <= 0;
    minusBtn.addEventListener("click", function () {
      adjustBalls(match.id, player.id, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add ball for " + player.name);
    plusBtn.disabled = matchOver;
    plusBtn.addEventListener("click", function () {
      adjustBalls(match.id, player.id, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    panel.appendChild(controls);

    return panel;
  }

  function adjustBalls(matchId, playerId, delta) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed") return;
    var next = (m.balls[playerId] || 0) + delta;
    if (next < 0) next = 0;
    m.balls[playerId] = next;
    saveState();
    if (delta > 0) {
      playPositiveSound();
    } else {
      playNegativeSound();
    }
    renderMatchView();
  }

  function winGame(matchId, playerId) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed") return;
    m.games[playerId] = (m.games[playerId] || 0) + 1;
    // reset balls for the new game
    var otherId = m.player1Id === playerId ? m.player2Id : m.player1Id;
    m.balls[playerId] = 0;
    m.balls[otherId] = 0;

    if (m.games[playerId] >= m.raceTo) {
      m.status = "completed";
      m.winnerId = playerId;
      saveState();
      playWinSound();
    } else {
      saveState();
      playPositiveSound();
    }
    renderMatchView();
    renderMatches();
  }

  // ---------------------------------------------------------------------
  // Sharing by email
  // ---------------------------------------------------------------------

  function matchSummaryLine(m) {
    var p1 = getPlayer(m.player1Id);
    var p2 = getPlayer(m.player2Id);
    if (!p1 || !p2) return "";
    var line = p1.name + " " + m.games[p1.id] + " - " + m.games[p2.id] + " " + p2.name;
    line += " (race to " + m.raceTo + ")";
    if (m.status === "completed") {
      var w = getPlayer(m.winnerId);
      line += " — winner: " + (w ? w.name : "?");
    } else {
      line += " — in progress (balls this game: " + p1.name + " " + m.balls[p1.id] + ", " + p2.name + " " + m.balls[p2.id] + ")";
    }
    return line;
  }

  function shareByEmail(subject, bodyLines) {
    var body = bodyLines.join("\n");
    var href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  function shareMatch(matchId) {
    var m = getMatch(matchId);
    if (!m) return;
    var p1 = getPlayer(m.player1Id);
    var p2 = getPlayer(m.player2Id);
    var subject = "Pool Match: " + p1.name + " vs " + p2.name;
    var lines = ["Pool Master Counter", "", matchSummaryLine(m)];
    shareByEmail(subject, lines);
  }

  function shareAllMatches() {
    if (state.matches.length === 0) {
      alert("No matches to share yet.");
      return;
    }
    var sorted = state.matches.slice().sort(function (a, b) {
      return a.createdAt - b.createdAt;
    });
    var lines = ["Pool Master Counter — Match Summary", ""];
    sorted.forEach(function (m) {
      lines.push(matchSummaryLine(m));
    });
    shareByEmail("Pool Master Counter — Match Summary", lines);
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = newPlayerName.value.trim();
    if (!name) return;
    state.players.push({ id: uid(), name: name });
    saveState();
    newPlayerName.value = "";
    renderPlayers();
  });

  btnNewMatch.addEventListener("click", function () {
    if (state.players.length < 2) {
      alert("Add at least two players first.");
      return;
    }
    populatePlayerSelects();
    newMatchForm.classList.remove("hidden");
  });

  btnCancelMatch.addEventListener("click", function () {
    newMatchForm.classList.add("hidden");
  });

  newMatchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var p1 = matchPlayer1.value;
    var p2 = matchPlayer2.value;
    var raceTo = parseInt(matchRaceTo.value, 10) || 5;
    if (!p1 || !p2 || p1 === p2) {
      alert("Choose two different players.");
      return;
    }
    var match = createMatch(p1, p2, raceTo);
    newMatchForm.classList.add("hidden");
    openMatch(match.id);
  });

  btnShareAll.addEventListener("click", shareAllMatches);

  btnBack.addEventListener("click", goHome);

  btnShareMatch.addEventListener("click", function () {
    if (currentMatchId) shareMatch(currentMatchId);
  });

  btnDeleteMatch.addEventListener("click", function () {
    if (currentMatchId) deleteMatch(currentMatchId);
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  renderPlayers();
  renderMatches();
})();
