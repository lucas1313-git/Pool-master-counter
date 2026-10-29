// The Node-only checks (no browser, nothing to install) one after the other -
// what `npm test` runs after the unit tests (tests/unit/), here and in CI
// (.github/workflows/unit-tests.yml). A check that needs ffmpeg is skipped
// where there's none (said so). Exits non-zero if any check fails.
// usage: node tests/run_node_checks.js
"use strict";
const { spawnSync, execFileSync } = require("child_process");
const path = require("path");

const CHECKS = [
  "test_brackets", "test_tiebreaks", "test_swiss", "test_chip_tournament", "test_handicaps", "test_league_merge", "test_events",
  "test_strings", "test_voice_parser", "test_rail_distance", "test_camera_learning", "test_challonge",
  "test_recorder_retention", "test_camera_light",
  { name: "test_mp4_clip", needs: "ffmpeg" },
  { name: "test_highlight_reel", needs: "ffmpeg" }
];

function has(bin) {
  for (const dir of ["/opt/homebrew/bin/", "/usr/local/bin/", "/usr/bin/"]) {
    try { execFileSync(dir + bin, ["-version"], { stdio: "ignore" }); return true; } catch (e) {}
  }
  return false;
}

let failed = 0, ran = 0;
CHECKS.forEach((c) => {
  const name = typeof c === "string" ? c : c.name, needs = typeof c === "string" ? null : c.needs;
  if (needs && !has(needs)) { console.log("SKIP " + name + " (needs " + needs + ")"); return; }
  const r = spawnSync(process.execPath, [path.join(__dirname, name + ".js")], { encoding: "utf8", timeout: 300000 });
  ran++;
  const out = (r.stdout || "") + (r.stderr || "");
  const last = out.trim().split("\n").pop();
  if (r.status === 0) console.log("ok   " + name + " - " + last);
  else { failed++; console.log("FAIL " + name + " (exit " + r.status + ")\n" + out.split("\n").filter((l) => /^FAIL|Error/.test(l)).slice(0, 8).join("\n")); }
});
console.log(failed ? failed + " of " + ran + " checks FAILED" : "all " + ran + " checks passed");
process.exit(failed ? 1 : 0);
