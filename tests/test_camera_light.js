// A lighter camera (P27), no browser:
// - capture is capped at 1080p: zoomed in to 3x it asks for 1920 x 1080, not 4K (camera.html's
//   own tierOf / resolutionFor); not zoomed, 1280 x 720;
// - the camera page's defaults: DINOv2 off, Labs off, Simple mode off;
// - a paid build (PMC_PAID_BUILD=1) leaves OSNet out - its weights and its loader (only its
//   licence note kept); a free build has them;
// - the About pages (all five languages) say what OSNet's weights may be used for.
// usage: node tests/test_camera_light.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const REPO = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(REPO, "camera.html"), "utf8");
const src = html.split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  if (/\}\s*$/.test(src[start]) && (src[start].match(/\{/g) || []).length === (src[start].match(/\}/g) || []).length) return src[start];
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const F = new Function(["tierOf", "resolutionFor"].map(extract).join("\n") + "\nreturn { tierOf, resolutionFor };")();
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }

const at3 = F.resolutionFor({ zoom: 3 }), at1 = F.resolutionFor({ zoom: 1 }), at2 = F.resolutionFor({ zoom: 2 });
check("capture capped at 1080p: 3x zoom asks for 1920 x 1080 (2x too), no zoom 1280 x 720", at3.width.ideal === 1920 && at3.height.ideal === 1080 && at2.width.ideal === 1920 && at1.width.ideal === 1280, { at1, at2, at3 });

const defaults = html.slice(html.indexOf("  var settings = {"), html.indexOf("  var hasLocalSettingsOverride"));
check("the camera page's defaults: DINOv2 off, Labs off, Simple mode off", /useDino: false/.test(defaults) && /labsEnabled: false/.test(defaults) && /simpleMode: false/.test(defaults) && /useOsnet: true/.test(defaults));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-paid-"));
const build = (dir, paid) => spawnSync(process.execPath, [path.join(REPO, "tests", "publicbuild", "build-public.js"), REPO, dir], { env: Object.assign({}, process.env, { PMC_PAID_BUILD: paid ? "1" : "" }), encoding: "utf8" });
const paid = build(path.join(tmp, "paid"), true), free = build(path.join(tmp, "free"), false);
const has = (dir, rel) => fs.existsSync(path.join(tmp, dir, rel));
check("a paid build leaves OSNet out (its weights and its loader; the licence note kept)", paid.status === 0 && !has("paid", "camera/models/osnet/osnet.bin") && !has("paid", "camera/osnet.js") && has("paid", "camera/models/osnet/README.md") && has("paid", "camera/models/movenet-multipose-lightning/model.json"), paid.stderr);
check("...a free build has it", free.status === 0 && has("free", "camera/models/osnet/osnet.bin") && has("free", "camera/osnet.js"), free.stderr);
fs.rmSync(tmp, { recursive: true, force: true });

const about = ["about.html", "about.fr.html", "about.es.html", "about.tl.html", "about.zh-yue.html"].map((f) => fs.readFileSync(path.join(REPO, f), "utf8"));
check("the About pages (5 languages) say OSNet's weights come from Market-1501, research / non-commercial only, kept out of any paid version", about.every((a) => /id="model-licences"[^>]*>[^<]*Market-1501/.test(a) && /OSNet/.test(a)));

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
