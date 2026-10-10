// Builds the public, minified copy of the web app from the source repo.
// usage: node build-public.js <repo root> <out dir>
// - JS (app, camera client, camera page, osnet loader, inline <script>s) and
//   CSS (stylesheet, inline <style>s) minified with esbuild; no source maps.
// - HTML comments and indentation dropped (not inside <pre>/<textarea>).
// - Language/data JSON compacted.
// - Vendor files (TensorFlow.js, pose detection, models) copied as they are.
// - Source-only things (server, installer, iOS, tooling, READMEs) left out.
const fs = require("fs");
const path = require("path");

const repo = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const esbuild = require(path.join(repo, "installer/node_modules/esbuild"));

const ROOT_FILES = ["index.html", "camera.html", "manifest.json",
  "about.html", "about.fr.html", "about.es.html", "about.tl.html", "about.zh-yue.html"];
const DIRS = ["css", "js", "languages", "icons", "camera", "data", "settings", "players", "rules", "docs/screenshots"];
// source-only files inside the copied folders
const SKIP = [/(^|\/)README\.md$/, /^camera\/models\/(osnet|dinov2)\/convert\.py$/, /(^|\/)\.DS_Store$/];
const KEEP = [/^camera\/models\/(osnet|dinov2)\/README\.md$/]; // model licence notes
const VENDOR = [/^camera\/tfjs\.js$/, /^camera\/pose-detection\.js$/, /^camera\/models\//];

function minJs(code, label) {
  // no "format": esbuild then keeps top-level names (other scripts and
  // inline handlers use them) and renames everything inside functions
  return esbuild.transformSync(code, { loader: "js", minify: true, legalComments: "inline", sourcefile: label }).code;
}
function minCss(code, label) {
  return esbuild.transformSync(code, { loader: "css", minify: true, sourcefile: label }).code;
}
function minHtml(html, label) {
  const parts = [];
  // keep script/style/pre/textarea bodies out of the text clean-up
  const re = /<(script|style|pre|textarea)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let last = 0, m, n = 0;
  while ((m = re.exec(html))) {
    parts.push({ text: html.slice(last, m.index) });
    const tag = m[1].toLowerCase(), attrs = m[2], body = m[3];
    let newBody = body;
    if (tag === "script" && body.trim() && !/\btype\s*=\s*["']?(?!text\/javascript|module)/i.test(attrs)) {
      newBody = minJs(body, label + "#script" + (++n)).trim();
    } else if (tag === "style" && body.trim()) {
      newBody = minCss(body, label + "#style" + (++n)).trim();
    }
    parts.push({ raw: "<" + m[1] + attrs + ">" + newBody + "</" + m[1] + ">" });
    last = re.lastIndex;
  }
  parts.push({ text: html.slice(last) });
  return parts.map((p) => p.raw !== undefined ? p.raw
    : p.text.replace(/<!--(?!\[if)[\s\S]*?-->/g, "").replace(/\n[ \t]+/g, "\n").replace(/\n{2,}/g, "\n")).join("");
}

function listFiles(rel) {
  const abs = path.join(repo, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => listFiles(rel + "/" + name));
}

fs.rmSync(out, { recursive: true, force: true });
const files = ROOT_FILES.concat(DIRS.flatMap(listFiles))
  .filter((f) => KEEP.some((r) => r.test(f)) || !SKIP.some((r) => r.test(f)));
let before = 0, after = 0;
for (const rel of files) {
  const src = path.join(repo, rel), dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const ext = path.extname(rel);
  if (VENDOR.some((r) => r.test(rel)) || ![".js", ".css", ".html", ".json"].includes(ext)) {
    fs.copyFileSync(src, dst);
    continue;
  }
  const code = fs.readFileSync(src, "utf8");
  let min;
  if (ext === ".js") min = minJs(code, rel);
  else if (ext === ".css") min = minCss(code, rel);
  else if (ext === ".html") min = minHtml(code, rel);
  else min = rel === "manifest.json" ? code : JSON.stringify(JSON.parse(code));
  fs.writeFileSync(dst, min);
  before += Buffer.byteLength(code); after += Buffer.byteLength(min);
}
// GitHub Pages: serve files as they are (no Jekyll processing)
fs.writeFileSync(path.join(out, ".nojekyll"), "");
console.log("public build: " + files.length + " files, code " + (before / 1024 / 1024).toFixed(2) + " MB -> " + (after / 1024 / 1024).toFixed(2) + " MB, in " + out);
