"use strict";
/**
 * Pharmacy OS 画面側の自動テスト。
 * 実行: cd tests && npm install && npm test   （またはリポジトリ直下で node tests/run.js）
 * 公開前に必ず全部通ること。1つでも失敗したら公開しない。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (e) {
  try { ({ JSDOM } = require(path.join(__dirname, "node_modules", "jsdom"))); } catch (e2) {
    console.error("jsdom が見つかりません。tests フォルダで npm install を実行してください。");
    process.exit(2);
  }
}

let passed = 0;
const failures = [];
const queue = [];
// 非同期のテスト(async)も最後まで待って判定するため、順番に実行します。
function test(name, fn) { queue.push({ name, fn }); }
async function runAll() {
  for (const { name, fn } of queue) {
    if (name === null) { fn(); continue; }
    try { await fn(); passed += 1; console.log("  ok   " + name); }
    catch (e) { failures.push(name + " → " + (e && e.message)); console.log("  FAIL " + name + " → " + (e && e.message)); }
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const jsFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".js"));

queue.push({ name: null, fn: () => console.log("1. ファイルの形") });
jsFiles.forEach((f) => test("構文が正しい: " + f, () => {
  new vm.Script(read(f), { filename: f });
}));

test("config.js に必要な3項目がある", () => {
  const sandbox = {};
  vm.runInNewContext(read("config.js") + "\nthis.C = PHARMACY_CONFIG;", sandbox);
  ["GAS_URL", "PHARMACY_NAME", "GOOGLE_CLIENT_ID"].forEach((k) => assert(sandbox.C[k] && String(sandbox.C[k]).length > 3, k + " が空"));
  assert(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(sandbox.C.GAS_URL), "GAS_URL の形が違う");
  assert(/\.apps\.googleusercontent\.com$/.test(sandbox.C.GOOGLE_CLIENT_ID), "GOOGLE_CLIENT_ID の形が違う");
});

queue.push({ name: null, fn: () => console.log("2. HTMLの読み込み") });
const authVersions = new Set();
htmlFiles.forEach((f) => {
  const html = read(f);
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const local = scripts.filter((s) => !/^https?:/.test(s));
  test(f + ": 読み込むJS/CSSが全部存在する", () => {
    const links = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|webmanifest))(?:\?[^"]*)?"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
    links.forEach((l) => assert(fs.existsSync(path.join(ROOT, l)), l + " がない"));
  });
  if (local.length) {
    test(f + ": config.js が他のJSより先に読み込まれる", () => {
      const i = local.findIndex((s) => s.startsWith("config.js"));
      assert(i === 0, "config.js が最初ではない");
    });
  }
  const authSrc = local.find((s) => s.startsWith("auth.js"));
  if (authSrc) authVersions.add(authSrc);
  test(f + ": 画面JSの ?v= が付いている", () => {
    local.filter((s) => s.endsWith(".js") || /\.js\?/.test(s)).filter((s) => !s.startsWith("config.js")).forEach((s) => assert(/\?v=\d+/.test(s), s + " に ?v= がない"));
  });
});
test("全画面で auth.js のバージョンが同じ", () => assert(authVersions.size === 1, [...authVersions].join(", ")));

queue.push({ name: null, fn: () => console.log("3. auth.js の動き") });
function loadAuth(search) {
  const dom = new JSDOM("<!doctype html><body><div id='auth-gate' hidden></div></body>", { url: "https://x.test/home.html" + (search || ""), runScripts: "outside-only" });
  const w = dom.window;
  w.PHARMACY_CONFIG = { GAS_URL: "https://script.google.com/macros/s/AAA/exec", PHARMACY_NAME: "t", GOOGLE_CLIENT_ID: "x.apps.googleusercontent.com" };
  w.eval(read("auth.js") + "\n;window.__t={decodeJwtPayload,isTokenValid,logClientError,readClientErrors,readViewCache,writeViewCache,authFetch,perfLog};");
  return w;
}
function jwt(payload) { return "h." + Buffer.from(JSON.stringify(payload)).toString("base64").replace(/=/g, "") + ".s"; }

test("期限内のトークンは有効、切れたものは無効", () => {
  const w = loadAuth();
  const now = Math.floor(Date.now() / 1000);
  assert(w.__t.isTokenValid(jwt({ exp: now + 600 })) === true, "有効のはずが無効");
  assert(w.__t.isTokenValid(jwt({ exp: now - 10 })) === false, "切れているのに有効");
  assert(w.__t.isTokenValid("") === false && w.__t.isTokenValid("abc") === false, "壊れたトークンが有効");
});
test("日本語を含むトークンも読める", () => {
  const w = loadAuth();
  const b64 = Buffer.from(JSON.stringify({ name: "降旗", exp: 9999999999 })).toString("base64");
  assert(w.__t.decodeJwtPayload("h." + b64 + ".s").name === "降旗");
});
test("見るだけ画面のキャッシュは書いて読める", () => {
  const w = loadAuth();
  w.sessionStorage.setItem("pharmacyOsAuthEmail", "a@b.c");
  w.__t.writeViewCache("home", undefined, { success: true, v: 1 });
  assert(w.__t.readViewCache("home", undefined).v === 1);
  assert(w.__t.readViewCache("status", undefined) === null, "別actionのキャッシュを返した");
});
test("エラー記録は最新50件までで、中身は短く切られる", () => {
  const w = loadAuth();
  for (let i = 0; i < 60; i++) w.__t.logClientError("k" + i, "x".repeat(500));
  const list = w.__t.readClientErrors();
  assert(list.length === 50, "件数 " + list.length);
  assert(list[49].kind === "k59", "最新が末尾にない");
  assert(list[0].detail.length <= 200, "detail が長すぎる");
});
test("通信が失敗したらエラー記録に残り、例外はそのまま上に伝わる", async () => {
  const w = loadAuth();
  w.fetch = () => Promise.reject(new Error("network down"));
  let thrown = false;
  await w.__t.authFetch("home").catch(() => { thrown = true; });
  assert(thrown, "例外が握りつぶされた");
  assert(w.__t.readClientErrors().some((e) => e.kind.includes("通信失敗") && e.detail.includes("network down")), "記録がない");
});
test("サーバーが success:false を返したら記録される（認証エラーは除く）", async () => {
  const w = loadAuth();
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: false, message: "boom" }) });
  await w.__t.authFetch("home");
  assert(w.__t.readClientErrors().some((e) => e.detail === "boom"), "記録がない");
  const w2 = loadAuth();
  w2.fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: false, authError: true }) });
  w2.requireAuth = () => {};
  w2.__t.authFetch("home");
  assert(w2.__t.readClientErrors().length === 0, "認証切れまで記録した");
});
test("記録に入力内容(idToken)が入らない", async () => {
  const w = loadAuth();
  w.sessionStorage.setItem("pharmacyOsIdToken", "SECRET-TOKEN");
  w.fetch = () => Promise.reject(new Error("x"));
  await w.__t.authFetch("saveDaily", { note: "患者A" }).catch(() => {});
  const raw = w.localStorage.getItem("pharmacyOsErrorLog") || "";
  assert(!raw.includes("SECRET-TOKEN") && !raw.includes("患者A"), "秘密情報が記録に入っている");
});
test("?perf=1 を付けない限り、計測表示は出ない", () => {
  const w = loadAuth();
  w.__t.logClientError("a", "b");
  assert(!w.document.getElementById("perf-box"), "勝手に表示された");
  const w2 = loadAuth("?perf=1");
  w2.__t.logClientError("a", "b");
  assert(w2.document.getElementById("perf-box"), "?perf=1 でも表示されない");
});

queue.push({ name: null, fn: () => console.log("4. ホーム画面「今日やること」") });
function loadHome() {
  const html = read("home.html").replace(/<script[^>]*>.*?<\/script>/gs, "");
  const dom = new JSDOM(html, { url: "https://x.test/home.html", runScripts: "outside-only" });
  const w = dom.window;
  w.PHARMACY_CONFIG = { GAS_URL: "x", PHARMACY_NAME: "t" };
  w.requireAuth = () => {}; w.authFetch = async () => ({ success: true }); w.authFetchWithCache = async () => ({ success: true }); w.writeViewCache = () => {};
  w.eval(read("home.js").replace('"use strict";', ""));
  return w;
}
const taskText = (w, d) => { w.eval("renderTasks(" + JSON.stringify(d) + ")"); return [w.document.querySelector("#task-chip").textContent, w.document.querySelector("#task-list").textContent]; };
test("未入力があれば件数と、日次は3件＋残り件数が出る", () => {
  const w = loadHome();
  const [chip, text] = taskText(w, { dailyMissingDates: ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-08", "2026-09-09"], monthlyMissing: [{ label: "後発品", href: "monthly.html" }], previousMonthLabel: "2026年9月" });
  assert(chip === "6件", chip);
  assert(text.includes("ほか2日") && text.includes("9月3日(木)") && !text.includes("9月8日"), text);
  assert(w.document.querySelectorAll("#task-list a").length === 4, "リンク数");
});
test("未入力が0件なら「未入力の業務はありません」", () => {
  const w = loadHome();
  const [chip, text] = taskText(w, { dailyMissingDates: [], monthlyMissing: [] });
  assert(chip === "完了" && text.includes("未入力の業務はありません"));
});
test("日次のリンクは index.html?date=YYYY-MM-DD", () => {
  const w = loadHome();
  taskText(w, { dailyMissingDates: ["2026-09-03"], monthlyMissing: [] });
  assert(w.document.querySelector("#task-list a").getAttribute("href") === "index.html?date=2026-09-03");
});

(async () => {
  await runAll();
  console.log("\n" + passed + " 件OK / " + failures.length + " 件NG");
  if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
  process.exit(0);
})();
