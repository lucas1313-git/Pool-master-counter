// The app's words (P18), checked without a browser:
// - every key in all five language files, none empty;
// - no English UI string with "(target 1)" or "1 wins", no "game(s)"-style plurals in any language,
//   no "Q-Score" (the rating is "Rating"; Fargo only for real FargoRate numbers);
// - every key the code, index.html and camera.html name literally (T("…"), TP("…"), CT("…"),
//   data-i18n="…") exists;
// - every sentence the code counts with TP("…", n) that has a plural noun after its count has its
//   singular ("…One") too, in every language.
// usage: node tests/test_strings.js
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const LANGS = ["english", "french", "spanish", "tagalog", "cantonese"];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1500) : "")); if (!ok) fails++; }

const dict = {};
LANGS.forEach((l) => { dict[l] = JSON.parse(fs.readFileSync(path.join(REPO, "languages", l + ".json"), "utf8")); });
const en = dict.english;

// parity
const missing = [];
LANGS.forEach((l) => {
  Object.keys(en).forEach((k) => { if (!(k in dict[l])) missing.push(l + ": " + k); });
  Object.keys(dict[l]).forEach((k) => { if (!(k in en)) missing.push("english lacks " + k + " (in " + l + ")"); });
});
check("every key is in all five languages (" + Object.keys(en).length + " keys)", missing.length === 0, missing);
const empty = [];
LANGS.forEach((l) => Object.keys(dict[l]).forEach((k) => { if (typeof dict[l][k] !== "string" || !dict[l][k].trim()) empty.push(l + ": " + k); }));
check("...and none is empty", empty.length === 0, empty);

// words
const target1 = Object.keys(en).filter((k) => /\(target 1\)/.test(en[k]));
check("no English string says \"(target 1)\"", target1.length === 0, target1);
const oneWins = Object.keys(en).filter((k) => /\b1 wins\b|\b1 games\b|\b1 players\b|\b1 tournament wins\b/.test(en[k]));
check("no English string says \"1 wins\" (or 1 games, 1 players...)", oneWins.length === 0, oneWins);
const parens = [];
LANGS.forEach((l) => Object.keys(dict[l]).forEach((k) => { if (/[a-zà-ÿ]\((s|es|x)\)/i.test(dict[l][k])) parens.push(l + ": " + k + " = " + dict[l][k].slice(0, 60)); }));
check("no \"game(s)\"-style plurals, in any language", parens.length === 0, parens);
const qscore = [];
LANGS.forEach((l) => Object.keys(dict[l]).forEach((k) => { if (/Q-Score/i.test(dict[l][k])) qscore.push(l + ": " + k); }));
check("no \"Q-Score\" left (the word is Rating)", qscore.length === 0, qscore);

// the glossary (docs/glossary.md): one name per idea
const oldNames = Object.keys(en).filter((k) => /Global Stats|Export Stats|Tournament Type|\bSingle [Gg]ame\b|Tourney Victories|FargoRate-inspired/.test(en[k]));
check("no English string uses an old name (Global Stats, Export Stats, Tournament Type, Single game...)", oldNames.length === 0, oldNames);
const aboutRating = Object.keys(en).filter((k) => /\b(rating|ratings|rated|unrated)\b/i.test(en[k]) && !/leaderboard|standings|\brank/i.test(en[k]));
const frRating = aboutRating.filter((k) => /classement/i.test(dict.french[k]));
check("French: the rating is \"cote\" - \"classement\" is the leaderboard (" + aboutRating.length + " rating strings)", frRating.length === 0, frRating);
const esRating = aboutRating.filter((k) => /clasificaci/i.test(dict.spanish[k]));
check("Spanish: the rating is \"puntuación\" - \"clasificación\" is the leaderboard", esRating.length === 0, esRating);
const yueRace = Object.keys(en).filter((k) => /連勝(到|目標)|評級/.test(dict.cantonese[k]));
check("Cantonese: a race is 搶 N (連勝 is a streak), the rating 評分", yueRace.length === 0, yueRace);

// help in short sentences (about 20 words; the MVP formula is one long "sentence" and isn't help)
const helpSentences = Object.keys(en).filter((k) => k.startsWith("help.")).flatMap((k) => en[k].replace(/<br\s*\/?>/g, ". ").replace(/<[^>]+>/g, " ").split(/(?<=[.!?;:])\s+/)).map((x) => x.trim().split(/\s+/).filter(Boolean).length).filter((n) => n > 0);
const avgHelp = helpSentences.reduce((a, b) => a + b, 0) / helpSentences.length;
const longHelp = helpSentences.filter((n) => n > 30);
check("help sentences are short: " + helpSentences.length + " average " + avgHelp.toFixed(1) + " words (at most 15), none over 30", avgHelp <= 15 && longHelp.length === 0, longHelp);

// keys the code names
const sources = ["js/app.js", "js/voice.js", "js/pairing.js", "js/recording-consent.js", "js/local-recorder.js", "js/camera-client.js", "js/camera-i18n.js"].map((f) => fs.readFileSync(path.join(REPO, f), "utf8")).join("\n");
const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const used = new Set();
// (a literal that's the whole key - "storage.group." + id is built, not named)
for (const m of sources.matchAll(/\bTP?\("([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]*[a-zA-Z0-9_])"\s*[,)]/g)) used.add(m[1]);
for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
// camera.html's own words (P19): data-i18n there, CT("…") in its script
const camera = fs.readFileSync(path.join(REPO, "camera.html"), "utf8");
for (const m of camera.matchAll(/data-i18n(?:-[a-z-]+)?="([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
for (const m of camera.matchAll(/\bCT\("([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]*[a-zA-Z0-9_])"/g)) used.add(m[1]);
const unknown = [...used].filter((k) => !(k in en));
check("every key named in the code, index.html and camera.html exists (" + used.size + " named)", unknown.length === 0, unknown);

// TP's singulars
const tpKeys = new Set();
for (const m of sources.matchAll(/\bTP\((?:[^"()]*\?\s*)?"([a-zA-Z0-9_.]+)"(?:\s*:\s*"([a-zA-Z0-9_.]+)")?/g)) { tpKeys.add(m[1]); if (m[2]) tpKeys.add(m[2]); }
for (const m of sources.matchAll(/countPhrase\("([a-zA-Z]+)"/g)) tpKeys.add("count." + m[1]);
const PLURAL_NOUN = /\{\{[a-zA-Z]+\}\}\s*(?:[a-z-]+\s+)?(wins|games|players|racks|points|balls|scores|partidas|parties|victoires|victorias|joueurs|jugadores|billes|bolas|puntos)\b/;
const noOne = [];
tpKeys.forEach((k) => {
  if (!(k in en)) return;
  if (PLURAL_NOUN.test(en[k]) && !LANGS.every((l) => (k + "One") in dict[l])) noOne.push(k);
});
check("every count sentence TP picks has its singular in every language (" + tpKeys.size + " counted)", noOne.length === 0, noOne);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
