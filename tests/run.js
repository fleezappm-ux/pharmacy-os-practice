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

test("config.js の営業時間は日〜土の7日分で、形が正しい", () => {
  const sandbox = {};
  vm.runInNewContext(read("config.js") + "\nthis.C = PHARMACY_CONFIG;", sandbox);
  const h = sandbox.C.OPENING_HOURS;
  assert(h, "OPENING_HOURS がない");
  for (let d = 0; d < 7; d++) {
    assert(d in h, d + " 日目がない");
    if (h[d] !== null) {
      assert(Array.isArray(h[d]) && h[d].length === 2, d + " の形が違う");
      h[d].forEach((t) => assert(/^\d{2}:\d{2}$/.test(t), d + " の時刻の形が違う: " + t));
      assert(h[d][0] < h[d][1], d + " の開始が終了より後");
    }
  }
});

test("営業時間: config.js に無い古い設定でも従来の時間で動く（本番の古いconfig.js対策）", () => {
  const src = read("script.js");
  const start = src.indexOf("const FALLBACK_OPENING_HOURS");
  const end = src.indexOf("const form = ");
  const sandbox = { PHARMACY_CONFIG: { GAS_URL: "x" } };
  vm.runInNewContext(src.slice(start, end) + "\nthis.H = DEFAULT_HOURS;", sandbox);
  assert(sandbox.H[1] === "08:45～18:00" && sandbox.H[4] === "08:30～16:30" && sandbox.H[0] === "休局", "既定値が違う: " + JSON.stringify(sandbox.H));
});

test("営業時間: config.js の値が反映される（日曜も営業にできる）", () => {
  const src = read("script.js");
  const start = src.indexOf("const FALLBACK_OPENING_HOURS");
  const end = src.indexOf("const form = ");
  const sandbox = { PHARMACY_CONFIG: { OPENING_HOURS: { 0: ["10:00", "12:00"], 1: null, 2: null, 3: null, 4: null, 5: null, 6: null } } };
  vm.runInNewContext(src.slice(start, end) + "\nthis.H = DEFAULT_HOURS;", sandbox);
  assert(sandbox.H[0] === "10:00～12:00" && sandbox.H[1] === "休局", JSON.stringify(sandbox.H));
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
  w.eval(read("auth.js") + "\n;window.__t={decodeJwtPayload,isTokenValid,logClientError,readClientErrors,readViewCache,writeViewCache,authFetch,perfLog,getSession,saveSession,authCredentials,isLoggedIn,requestSession,ensureSession,clearAuth,requireAuth,handleCredentialResponse,getAuthEmail};");
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


queue.push({ name: null, fn: () => console.log("3b. 入館証（長持ちログイン）") });
const FUTURE = () => Math.floor(Date.now() / 1000) + 14 * 86400;
const sessionResult = (extra) => ({ success: true, pharmacySession: "s1.AAA.BBB", expiresAt: FUTURE(), renewBefore: FUTURE() - 7 * 86400, ...(extra || {}) });
test("入館証があれば、GASへ入館証を送りGoogleの証明は送らない", async () => {
  const w = loadAuth();
  w.__t.saveSession(sessionResult(), "a@b.c");
  let body;
  w.fetch = (u, o) => { body = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); };
  await w.__t.authFetch("home");
  assert(body.pharmacySession === "s1.AAA.BBB" && body.idToken === undefined, JSON.stringify(body));
});
test("入館証がなければ、従来どおりGoogleの証明を送る", async () => {
  const w = loadAuth();
  w.sessionStorage.setItem("pharmacyOsIdToken", "GTOKEN");
  let body;
  w.fetch = (u, o) => { body = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve({ success: true }) }); };
  await w.__t.authFetch("home");
  assert(body.idToken === "GTOKEN" && body.pharmacySession === undefined, JSON.stringify(body));
});
test("期限切れの入館証は使われず、削除される", () => {
  const w = loadAuth();
  w.localStorage.setItem("pharmacyOsSession", JSON.stringify({ token: "x", exp: Math.floor(Date.now() / 1000) - 5 }));
  assert(w.__t.getSession() === null, "期限切れが有効扱い");
  assert(w.localStorage.getItem("pharmacyOsSession") === null, "削除されていない");
});
test("入館証が有効なら、Googleの証明が切れていてもログイン済み（ログイン画面を出さない）", () => {
  const w = loadAuth();
  w.__t.saveSession(sessionResult(), "a@b.c");
  let ready = false;
  w.__t.requireAuth(() => { ready = true; });
  assert(ready, "onReadyが呼ばれない");
  assert(w.document.getElementById("auth-gate").hidden === true, "ログイン画面が出た");
  assert(w.__t.getAuthEmail() === "a@b.c", "メールが引き継がれない");
});
test("入館証もGoogleの証明もなければ、ログイン画面を出す", () => {
  const w = loadAuth();
  let ready = false;
  w.__t.requireAuth(() => { ready = true; });
  assert(!ready && w.document.getElementById("auth-gate").hidden === false);
});
test("Googleでログインした直後に、入館証を取りに行って保存する", async () => {
  const w = loadAuth();
  const idToken = jwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 });
  let sent;
  w.fetch = (u, o) => { sent = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve(sessionResult()) }); };
  w.__t.handleCredentialResponse({ credential: idToken });
  await new Promise((r) => setTimeout(r, 20));
  assert(sent.action === "createSession" && sent.idToken === idToken, JSON.stringify(sent));
  assert(w.__t.getSession() && w.__t.getSession().email === "a@b.c", "保存されていない");
});
test("入館証の取得に失敗しても、Googleのログインのまま使える", async () => {
  const w = loadAuth();
  const idToken = jwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 });
  w.fetch = () => Promise.reject(new Error("offline"));
  w.__t.handleCredentialResponse({ credential: idToken });
  await new Promise((r) => setTimeout(r, 20));
  assert(w.__t.getSession() === null && w.__t.isLoggedIn() === true, "ログインが壊れた");
  assert(w.__t.authCredentials().idToken === idToken, "Googleの証明が使われない");
});
test("入館証が無いまま有効なGoogleログインで画面を開くと、静かに入館証を取りに行く", async () => {
  const w = loadAuth();
  w.sessionStorage.setItem("pharmacyOsIdToken", jwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 }));
  let sent = null;
  w.fetch = (u, o) => { sent = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve(sessionResult()) }); };
  w.__t.requireAuth(() => {});
  await new Promise((r) => setTimeout(r, 20));
  assert(sent && sent.action === "createSession", "取りに行かない");
  assert(w.__t.getSession(), "保存されない");
});
test("更新時期（残り7日）を過ぎた入館証は、入館証で更新を依頼する", async () => {
  const w = loadAuth();
  const now = Math.floor(Date.now() / 1000);
  w.localStorage.setItem("pharmacyOsSession", JSON.stringify({ token: "s1.OLD.SIG", exp: now + 3 * 86400, renewBefore: now - 4 * 86400, email: "a@b.c" }));
  let sent = null;
  w.fetch = (u, o) => { sent = JSON.parse(o.body); return Promise.resolve({ json: () => Promise.resolve(sessionResult({ pharmacySession: "s1.NEW.SIG" })) }); };
  w.__t.requireAuth(() => {});
  await new Promise((r) => setTimeout(r, 20));
  assert(sent && sent.action === "createSession" && sent.pharmacySession === "s1.OLD.SIG", JSON.stringify(sent));
  assert(w.__t.getSession().token === "s1.NEW.SIG", "更新されていない");
});
test("まだ新しい入館証は、更新の通信をしない", async () => {
  const w = loadAuth();
  w.__t.saveSession(sessionResult(), "a@b.c");
  let called = false;
  w.fetch = () => { called = true; return Promise.resolve({ json: () => Promise.resolve({}) }); };
  w.__t.requireAuth(() => {});
  await new Promise((r) => setTimeout(r, 20));
  assert(!called, "無駄な通信をした");
});
test("サーバーが入館証を拒否（authError）したら、入館証を捨ててログイン画面へ戻る", async () => {
  const w = loadAuth();
  w.__t.saveSession(sessionResult(), "a@b.c");
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: false, authError: true }) });
  w.__t.authFetch("home");
  await new Promise((r) => setTimeout(r, 20));
  assert(w.__t.getSession() === null, "入館証が残っている");
  assert(w.document.getElementById("auth-gate").hidden === false, "ログイン画面が出ない");
});
test("clearAuth は入館証も消す", () => {
  const w = loadAuth();
  w.__t.saveSession(sessionResult(), "a@b.c");
  w.__t.clearAuth();
  assert(w.__t.getSession() === null);
});
test("入館証の取得に失敗した記録に、入館証やGoogleの証明は入らない", async () => {
  const w = loadAuth();
  w.sessionStorage.setItem("pharmacyOsIdToken", jwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 }));
  w.fetch = () => Promise.reject(new Error("offline"));
  await w.__t.requestSession();
  const raw = w.localStorage.getItem("pharmacyOsErrorLog") || "";
  assert(raw.includes("入館証") && !raw.includes("eyJ") && !raw.includes("s1."), raw);
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
