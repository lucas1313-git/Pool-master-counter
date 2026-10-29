// Writes docs/tagalog-review.md (P19): the Tagalog strings that are still
// English, for a Tagalog speaker to review - the ones identical to English
// (leaving out names, brands, numbers and emoji, which stay as they are),
// then the ones mostly in English words.
// usage: node tests/tagalog_review.js   (rewrites docs/tagalog-review.md)
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const en = JSON.parse(fs.readFileSync(path.join(REPO, "languages/english.json"), "utf8"));
const tl = JSON.parse(fs.readFileSync(path.join(REPO, "languages/tagalog.json"), "utf8"));

// words that stay as they are in any language
const KEEP = new Set(("MVP Pool Master Counter Fargo FargoRate Challonge APA BCA VNBA TAP Ball OK Siri iPad iPhone Mac " +
  "Android Google Drive iCloud OBS YouTube Facebook PDF CSV JSON vCard Swiss Elo Wi Fi QR Brio USB Rotation Straight One " +
  "Pocket Snooker Bank Punishment Chicago Cutthroat Rack Logo").split(" "));
const bare = (s) => s.replace(/\{\{\w+\}\}|<[^>]+>|&\w+;/g, "");
const neutral = (s) => bare(s).replace(/[\W\d_]+/g, " ").trim().split(/\s+/).filter(Boolean).every((w) => KEEP.has(w));
const words = (s) => (bare(s).toLowerCase().match(/[a-z']+/g) || []);
const cell = (s) => bare(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const same = Object.keys(en).filter((k) => tl[k] === en[k] && !neutral(en[k]));
const mostly = Object.keys(en).filter((k) => {
  if (tl[k] === en[k] || !tl[k]) return false;
  const tw = words(tl[k]);
  const ew = new Set(words(en[k]));
  return tw.length >= 4 && tw.filter((w) => ew.has(w)).length / tw.length >= 0.7;
});

const lines = [
  "# Tagalog strings still in English",
  "",
  "For a Tagalog speaker to review: the strings in `languages/tagalog.json` that are still English.",
  "Some are English on purpose - the app's Taglish keeps a few pool and app words as they are",
  "(see `docs/glossary.md`: rating, leaderboard, standings, race to, rack, session, backup,",
  "practice, Winner stays, bracket). Keep those where they read naturally; translate the rest.",
  "Written by `node tests/tagalog_review.js` - run it again after changes.",
  "",
  "## Identical to English (" + same.length + ")",
  "",
  "| Key | English (= Tagalog now) |",
  "|---|---|",
  ...same.map((k) => "| `" + k + "` | " + cell(en[k]) + " |"),
  "",
  "## Mostly English words (" + mostly.length + ")",
  "",
  "| Key | English | Tagalog now |",
  "|---|---|---|",
  ...mostly.map((k) => "| `" + k + "` | " + cell(en[k]) + " | " + cell(tl[k]) + " |"),
  ""
];
fs.writeFileSync(path.join(REPO, "docs/tagalog-review.md"), lines.join("\n"));
console.log("docs/tagalog-review.md: " + same.length + " identical, " + mostly.length + " mostly English");
