// Voice commands: the sentence parser on its own, in Node (no browser,
// no microphone). Run: node tests/test_voice_parser.js
"use strict";
var path = require("path");
var fs = require("fs");
var P = require(path.join(__dirname, "..", "js", "voice.js"));

var gameTypes = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "settings", "game-types.json"), "utf8"))
  .map(function (t) { return { id: t.id, label: t.label }; });
var ctx = {
  gameTypes: gameTypes,
  sessionNames: ["Luc", "Luigi", "Bob", "Chris", "Kim"],
  playingNames: ["Luc", "Luigi"],
  knownNames: ["Luc", "Luigi", "Bob", "Chris", "Kim", "Samantha", "Mario", "Bob Smith Jr"],
  nicknames: [{ nick: "Sammy", name: "Samantha" }, { nick: "Big Mike", name: "Mario" }],
  ratedNames: ["Luc", "Luigi", "Bob", "Chris", "Mario"]
};

var failures = 0, count = 0;
function check(text, expect) {
  count++;
  var u = P.understand([text], ctx);
  var got = u.cmd || (u.error ? { error: u.error.error, options: u.error.options } : { none: true });
  var ok = Object.keys(expect).every(function (k) { return JSON.stringify(got[k]) === JSON.stringify(expect[k]); });
  if (!ok) {
    failures++;
    console.log("FAIL  " + JSON.stringify(text) + "\n      heard " + JSON.stringify(P.normalize(text, gameTypes)) +
      "\n      got " + JSON.stringify(got) + "\n      want " + JSON.stringify(expect));
  }
}

// --- the game, race, target ---
check("Play 8-ball", { type: "game", game: "8ball" });
check("play eight ball", { type: "game", game: "8ball" });
check("Now playing straight pool", { type: "game", game: "straight" });
check("let's play 9 ball race to 5", { type: "game", game: "9ball", n: 5, kind: "race" });
check("switch to one pocket", { type: "game", game: "onepocket" });
check("The game is 10-ball", { type: "game", game: "10ball" });
check("straight pool to 100 points", { type: "game", game: "straight", n: 100, kind: "target", unit: "points" });
check("15 ball rotation", { type: "game", game: "15ballrotation" });
check("8 ball rotation", { type: "game", game: "8ballrotation" });
check("Race to 7", { type: "race", n: 7 });
check("race to seven", { type: "race", n: 7 });
check("race 2 7", { type: "race", n: 7 });
check("Target 100 points", { type: "target", n: 100, unit: "points" });
check("target one hundred and fifty", { type: "target", n: 150 });
check("play to 100", { type: "raceOrTarget", n: 100 });
check("play to 5 games", { type: "race", n: 5 });

// --- rotation ---
check("Rotation 8-ball and 9-ball", { type: "rotationSet", games: ["8ball", "9ball"] });
check("set the rotation to 8 ball, 9 ball and 10 ball", { type: "rotationSet", games: ["8ball", "9ball", "10ball"] });
check("rotation eight ball nine ball", { type: "rotationSet", games: ["8ball", "9ball"] });
check("Add 10-ball to the rotation", { type: "rotationAdd", games: ["10ball"] });
check("Remove 9-ball from the rotation", { type: "rotationRemove", games: ["9ball"] });
check("take 9 ball out of the rotation", { type: "rotationRemove", games: ["9ball"] });
check("Change game every 2 games", { type: "rotationEvery", n: 2 });
check("every three games", { type: "rotationEvery", n: 3 });
check("Rotation on", { type: "rotationMode", on: true });
check("Single game", { type: "rotationMode", on: false });
check("turn off the rotation", { type: "rotationMode", on: false });
check("Clear the rotation", { type: "rotationClear" });

// --- players ---
check("Add Luigi to the session", { type: "addPlayers", names: ["Luigi"] });
check("add Mario", { type: "addPlayers", names: ["Mario"] });
check("add Zelda to the session", { type: "addPlayers", names: ["Zelda"] });
check("add Luigi and Mario", { type: "addPlayers", names: ["Luigi", "Mario"] });
check("Luigi is playing", { type: "setPlaying", names: ["Luigi"], playing: true });
check("Bob and Chris are playing", { type: "setPlaying", names: ["Bob", "Chris"], playing: true });
check("Luigi is standby", { type: "setPlaying", names: ["Luigi"], playing: false });
check("Luigi is on standby", { type: "setPlaying", names: ["Luigi"], playing: false });
check("luigi sits out", { type: "setPlaying", names: ["Luigi"], playing: false });
check("Luigi plays against Luc", { type: "versus", sides: [["Luigi"], ["Luc"]] });
check("Luigi versus Luke", { type: "versus", sides: [["Luigi"], ["Luc"]] });
check("luigi vs bob", { type: "versus", sides: [["Luigi"], ["Bob"]] });
check("Luigi plays Luc", { type: "versus", sides: [["Luigi"], ["Luc"]] });

// --- teams ---
check("Luigi and Luc against Bob and Chris", { type: "versus", sides: [["Luigi", "Luc"], ["Bob", "Chris"]] });
check("Luigi and luc are team against bob and Chris as team b", { type: "versus", sides: [["Luigi", "Luc"], ["Bob", "Chris"]] });
check("Luigi and Luc are team A against Bob and Chris as team B", { type: "versus", sides: [["Luigi", "Luc"], ["Bob", "Chris"]] });
check("team A Luigi and Luc team B Bob and Chris", { type: "versus", sides: [["Luigi", "Luc"], ["Bob", "Chris"]] });

// --- scoring ---
check("Add one point to Luc", { type: "points", n: 1, name: "Luc" });
check("add 1 point to Luke", { type: "points", n: 1, name: "Luc" });
check("add a point to Luigi", { type: "points", n: 1, name: "Luigi" });
check("Add 3 points to Luigi", { type: "points", n: 3, name: "Luigi" });
check("at one point to Luc", { type: "points", n: 1, name: "Luc" });
check("one point for Luigi", { type: "points", n: 1, name: "Luigi" });
check("give Luc two points", { type: "points", n: 2, name: "Luc" });
check("Take one point from Luc", { type: "points", n: -1, name: "Luc" });
check("Add one point", { type: "points", n: 1, name: null });
check("Luc plus 2", { type: "points", n: 2, name: "Luc" });
check("Luigi wins the game with 5 balls left on the table", { type: "win", name: "Luigi", ballsLeft: 5 });
check("Luigi win the game with 5 ball left in the table", { type: "win", name: "Luigi", ballsLeft: 5 });
check("Luigi won the game with five balls left", { type: "win", name: "Luigi", ballsLeft: 5 });
check("Luc wins the rack", { type: "win", name: "Luc", ballsLeft: null });
check("Luigi wins with no balls left", { type: "win", name: "Luigi", ballsLeft: 0 });
check("5 balls left", { type: "ballsLeft", n: 5 });
check("seven balls left on the table", { type: "ballsLeft", n: 7 });
check("Nice game", { type: "confirmWin" });
check("ok", { type: "confirmWin" });
check("Undo", { type: "undoWin" });
check("yes", { type: "answer", yes: true });

// --- questions ---
check("What is Luigi's Q-score today?", { type: "qscore", name: "Luigi", today: true });
check("what is luigi q score today", { type: "qscore", name: "Luigi", today: true });
check("what's Mario's queue score", { type: "qscore", name: "Mario" });
check("Q score of Bob", { type: "qscore", name: "Bob" });
check("What's the score?", { type: "score" });
check("Help", { type: "help" });

// --- names that shouldn't pass ---
check("Add one point to Zelda", { error: "unknown" });
check("Zelda is standby", { error: "unknown" });
check("Luigi and Luigi against Bob", { error: "twice" });
check("the weather is nice", { none: true });
check("Zelda and Luc are the team against Bob", { type: "versus", sides: [["Zelda", "Luc"], ["Bob"]] });
check("Luigi and Luc are a team against Bob and Chris", { type: "versus", sides: [["Luigi", "Luc"], ["Bob", "Chris"]] });
check("add Luc plays to the session", { error: "unknown" });

// --- a whole session in one sentence ---
check("Set session, race to 5, rotate every 2, players are Luigi, Luc, Bob and Chris, Luigi and Luc are playing",
  { type: "session", race: 5, every: 2, players: ["Luigi", "Luc", "Bob", "Chris"], playing: ["Luigi", "Luc"] });
check("set session race to five rotate every two players are luigi luke bob and chris luigi and luke are playing",
  { type: "session", race: 5, every: 2, players: ["Luigi", "Luc", "Bob", "Chris"], playing: ["Luigi", "Luc"] });
check("set the session race to 7 players are Sammy and Big Mike", { type: "session", race: 7, players: ["Samantha", "Mario"], playing: null });
check("set session players are Luigi Luc Kim, Kim and Luc are playing", { type: "session", players: ["Luigi", "Luc", "Kim"], playing: ["Kim", "Luc"] });
check("set session race to 3 rotation 8-ball and 9-ball every 2 games players are Luigi and Luc", { type: "session", race: 3, every: 2, rotation: ["8ball", "9ball"], players: ["Luigi", "Luc"] });
check("new session play straight pool race to 2 players are Bob Smith Jr and Luigi", { type: "session", race: 2, game: "straight", players: ["Bob Smith Jr", "Luigi"] });
check("set session Luigi and Luc are playing", { type: "session", players: null, playing: ["Luigi", "Luc"] });
check("set session race to 5 players are Luigi Zelda and Luc", { error: "unknown" });
check("add one point to Sammy", { type: "points", n: 1, name: "Samantha" });
check("what is Big Mike's q score", { type: "qscore", name: "Mario" });

console.log((count - failures) + " / " + count + " sentences understood as expected");
process.exit(failures ? 1 : 0);
