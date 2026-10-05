"use strict";

const AUTH_TOKEN_KEY = "pharmacyOsIdToken";
const AUTH_EMAIL_KEY = "pharmacyOsAuthEmail";

// 期限のこの秒数前になったら、静かに（画面を出さず）トークンの更新を試みます。
const AUTH_REFRESH_MARGIN_SECONDS = 300;

// 入館証（GASが発行する署名つきの長持ちログイン。14日間有効）。
// Googleのログイン証明は約1時間で切れるため、ログイン直後にGASから入館証をもらって端末に保存します。
// 保存先は localStorage なので、タブを閉じても残ります。管理画面で利用停止にされた場合などは、
// GASが拒否して再ログイン画面になります（入館証を持っていても権限の確認は毎回サーバーで行われます）。
const AUTH_SESSION_KEY = "pharmacyOsSession";

function getSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    if (!saved || !saved.token || !saved.exp || saved.exp <= Math.floor(Date.now() / 1000)) {
      if (saved) localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return saved;
  } catch (e) {
    return null;
  }
}

function saveSession(result, email) {
  if (!result || !result.success || !result.pharmacySession) return;
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      token: result.pharmacySession,
      exp: result.expiresAt,
      renewBefore: result.renewBefore,
      email: email || ""
    }));
  } catch (e) {
    // 保存できなくても、従来どおりGoogleのログインで動きます。
  }
}

/** GASへ送る本人確認の情報を返します。入館証があればそれを、なければGoogleのログイン証明を使います。 */
function authCredentials() {
  const session = getSession();
  return session ? { pharmacySession: session.token } : { idToken: getIdToken() };
}

function getIdToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function getAuthEmail() {
  const own = sessionStorage.getItem(AUTH_EMAIL_KEY);
  if (own) return own;
  const session = getSession();
  return session && session.email ? session.email : "";
}

function clearAuth() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_EMAIL_KEY);
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (e) { /* 何もしない */ }
}

/** ログインしているか（有効な入館証、または有効なGoogleログイン証明がある）。 */
function isLoggedIn() {
  return !!getSession() || isTokenValid(getIdToken());
}

let sessionRequestInFlight = false;
/**
 * 入館証を新しくもらいます（本人確認の情報は authCredentials() が選びます）。
 * 失敗しても何もしません。入館証が無いだけで、従来どおりGoogleのログインで動きます。
 */
async function requestSession() {
  if (sessionRequestInFlight) return;
  sessionRequestInFlight = true;
  try {
    const response = await fetch(PHARMACY_CONFIG.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "createSession", ...authCredentials() })
    });
    const result = await response.json();
    const payload = decodeJwtPayload(getIdToken());
    const email = (payload && payload.email) || getAuthEmail();
    if (result && result.success) saveSession(result, email);
  } catch (e) {
    logClientError("入館証の取得に失敗", e && e.message);
  } finally {
    sessionRequestInFlight = false;
  }
}

/** 入館証が無い、または更新時期（残り7日）を過ぎていれば、静かに取り直します。 */
function ensureSession() {
  const session = getSession();
  const now = Math.floor(Date.now() / 1000);
  if (!session || (session.renewBefore && session.renewBefore <= now)) {
    if (session || isTokenValid(getIdToken())) requestSession();
  }
}

function decodeJwtPayload(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function isTokenValid(token) {
  const payload = token ? decodeJwtPayload(token) : null;
  const now = Math.floor(Date.now() / 1000);
  return !!(token && payload && payload.exp && payload.exp > now);
}

function showAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.hidden = false;
  document.body.style.overflow = "hidden";
  applyLineWarningIfNeeded();
}

/** LINE内ブラウザで開かれている場合、ログイン画面に警告を表示します（表示は初回ログイン時、つまりログイン画面が実際に出る時だけです）。 */
function applyLineWarningIfNeeded() {
  const warning = document.getElementById("auth-line-warning");
  if (!warning) return;
  warning.hidden = !/Line/i.test(navigator.userAgent);
}

function hideAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (gate) gate.hidden = true;
  document.body.style.overflow = "";
}

// ログイン待ちのコールバックは、同時に複数箇所から呼ばれる可能性があるため配列で管理します。
let authReadyCallbacks = [];
let refreshTimer = null;
let silentRefreshInFlight = false;

function handleCredentialResponse(response) {
  const payload = decodeJwtPayload(response.credential);
  sessionStorage.setItem(AUTH_TOKEN_KEY, response.credential);
  if (payload && payload.email) sessionStorage.setItem(AUTH_EMAIL_KEY, payload.email);
  // 新しくログインした人の入館証を取り直すため、古い入館証は先に捨てます。
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (e) { /* 何もしない */ }
  hideAuthGate();
  silentRefreshInFlight = false;
  scheduleTokenRefresh();
  applyEditNavVisibility();
  requestSession();

  const callbacks = authReadyCallbacks;
  authReadyCallbacks = [];
  callbacks.forEach((cb) => {
    try {
      cb();
    } catch (e) {
      console.error(e);
    }
  });
}

/**
 * ページの初期化前に必ず呼び出します。
 * すでに有効なログイン状態ならすぐにonReadyを呼び、そうでなければログイン画面を出し、
 * ログイン成功後にonReadyを呼びます。
 */
function requireAuth(onReady) {
  // URLに ?logout=1 が付いている場合、テストのために強制的にログアウトさせます。
  if (new URLSearchParams(location.search).get("logout") === "1") {
    clearAuth();
  }
  if (isLoggedIn()) {
    scheduleTokenRefresh();
    applyEditNavVisibility();
    ensureSession();
    onReady();
    return;
  }
  clearAuth();
  authReadyCallbacks.push(onReady);
  showAuthGate();
  renderGoogleButton();
}

/**
 * 編集専用ページを開く前に、指定された編集権限をGAS側の最新情報で確認します。
 * 権限がない場合は編集トップへ戻し、編集データの読み込みや操作ボタンの利用を防ぎます。
 */
function requireEditPermission(permissionName, onReady) {
  requireAuth(async () => {
    try {
      const result = await fetchWhoAmIShared();
      const permissions = result && result.permissions ? result.permissions : {};
      if (!result.success || !permissions[permissionName]) {
        location.replace("edit.html");
        return;
      }
      onReady(result);
    } catch (e) {
      console.error("編集権限の確認に失敗しました。", e);
      location.replace("edit.html");
    }
  });
}

/**
 * ログイン中の利用者の編集権限を確認し、下部ナビの「編集」リンクを
 * 権限が1つもない場合は非表示にします。失敗しても他の処理には影響しません。
 */
async function applyEditNavVisibility() {
  const navLinks = [
    document.getElementById("nav-edit-link"),
    document.getElementById("side-edit-link")
  ].filter(Boolean);
  if (!navLinks.length) return;
  try {
    const result = await fetchWhoAmIShared();
    if (!result.success) return;
    const permissions = result.permissions || {};
    const hasAnyEditPermission = permissions.canEditDaily || permissions.canEditMonthly || permissions.canEditOther;
    navLinks.forEach((navLink) => {
      navLink.style.display = hasAnyEditPermission ? "" : "none";
    });
  } catch (e) {
    // 取得に失敗した場合は、リンクの表示状態を変更せずそのままにします。
  }
}

function renderGoogleButton() {
  if (!(window.google && google.accounts && google.accounts.id)) {
    // GISライブラリの読み込みが間に合っていない場合、少し待って再試行します。
    setTimeout(renderGoogleButton, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: PHARMACY_CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse
  });
  const target = document.getElementById("google-signin-button");
  if (target && !target.dataset.rendered) {
    google.accounts.id.renderButton(target, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      locale: "ja",
      width: 280
    });
    target.dataset.rendered = "1";
  }
}

/**
 * トークンの期限が近づいたら、画面を出さずに静かな更新を1回だけ試みるようタイマーを設定します。
 * 更新に成功すればログイン継続、失敗しても何もしません（次のGAS呼び出し時に
 * authFetchが検知して、その時初めてログイン画面を出します）。無限ループや
 * 連続表示を避けるため、更新の試行は毎回1回きりです。
 */
function scheduleTokenRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  // 入館証があれば、Googleの証明の期限切れを気にする必要はありません。
  if (getSession()) return;
  const token = getIdToken();
  const payload = token ? decodeJwtPayload(token) : null;
  if (!payload || !payload.exp) return;

  const now = Math.floor(Date.now() / 1000);
  const secondsUntilExpiry = payload.exp - now;
  const refreshInSeconds = Math.max(5, secondsUntilExpiry - AUTH_REFRESH_MARGIN_SECONDS);

  refreshTimer = setTimeout(attemptSilentRefresh, refreshInSeconds * 1000);
}

function attemptSilentRefresh() {
  if (silentRefreshInFlight) return;
  if (!(window.google && google.accounts && google.accounts.id)) return;

  silentRefreshInFlight = true;
  try {
    google.accounts.id.initialize({
      client_id: PHARMACY_CONFIG.GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse
    });
    // Googleのログイン状態が有効であれば、画面を出さずに新しい資格情報を受け取れます。
    // ブラウザの制限（FedCM無効化やサードパーティCookieブロック等）で
    // 表示できない場合は、静かに諦めます（無理に突破しません）。
    google.accounts.id.prompt(() => {
      // 成功時はhandleCredentialResponseが呼ばれてsilentRefreshInFlightがリセットされます。
      // 失敗・非表示時は、次にGASへアクセスした時にauthFetchがログイン画面を出します。
      silentRefreshInFlight = false;
    });
  } catch (e) {
    silentRefreshInFlight = false;
  }
}

/**
 * GASへ認証付きでリクエストします。読み取り・書き込みどちらも、
 * ログイントークンをURLに含めず、POSTのJSON本文で送ります。
 * 認証エラー(authError)が返ってきた場合は、入力内容（extraBody）を保持したまま
 * ログイン画面を出し、ログイン成功後に同じリクエストを自動的にやり直します。
 * これにより、保存中にトークンが切れても入力内容を失いません。
 */
/**
 * whoAmI（本人の権限確認）を、同じ画面の読み込み中に何度も呼ばないための共有呼び出しです。
 * 10秒以内の再呼び出しは、同じ結果（または実行中の通信）を使い回します。
 * 10秒を過ぎると、あらためてサーバーに最新を聞きます（権限変更の反映を遅らせないため）。
 */
let whoAmIShared = null;
let whoAmISharedAt = 0;
function fetchWhoAmIShared() {
  if (whoAmIShared && Date.now() - whoAmISharedAt < 10000) return whoAmIShared;
  whoAmISharedAt = Date.now();
  const promise = authFetch("whoAmI");
  whoAmIShared = promise;
  // 失敗した結果（エラー・success:false）は使い回さず、次回あらためて取得します。
  promise.then((result) => { if (!result || !result.success) { if (whoAmIShared === promise) whoAmIShared = null; } },
    () => { if (whoAmIShared === promise) whoAmIShared = null; });
  return promise;
}

// GASは、しばらく使っていないあとの最初の通信などで、JSONではなくGoogleのエラー画面(HTML)を
// 返すことがあります。その場合は1秒待って1回だけやり直し、それでもだめなら記録を残して失敗にします。
async function fetchGasJson(action, extraBody, attempt) {
  const tries = attempt || 1;
  const response = await fetch(PHARMACY_CONFIG.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...authCredentials(), ...(extraBody || {}) })
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const snippet = String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (tries < 2) {
      logClientError("GASがHTMLを返したため再試行 " + action, "HTTP " + response.status + " / " + snippet);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return fetchGasJson(action, extraBody, tries + 1);
    }
    throw new Error("GASの応答がJSONではありません（HTTP " + response.status + "）" + (snippet ? "：" + snippet : ""));
  }
}

async function authFetch(action, extraBody) {
  const startedAt = performance.now();
  let result;
  try {
    result = await fetchGasJson(action, extraBody);
  } catch (e) {
    logClientError("通信失敗 " + action, e && e.message);
    throw e;
  }
  recordPerf(action, performance.now() - startedAt);
  if (result && result.success === false && !result.authError) {
    logClientError("サーバーが失敗を返しました " + action, result.message);
  }

  if (result.authError) {
    clearAuth();
    return new Promise((resolve, reject) => {
      requireAuth(async () => {
        try {
          const retryResult = await authFetch(action, extraBody);
          resolve(retryResult);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  return result;
}

/**
 * 「見るだけの画面」用の読み込みです。
 * 同じタブで前回取得できた結果があれば、すぐ onCached に渡して先に表示させ、
 * そのあと最新を取得して返します（成功したら次回用に保存します）。
 * 保存先はログイン情報と同じ sessionStorage（このタブを閉じると消えます）で、
 * 利用者のメールアドレスごとに分け、60分より古いものは使いません。
 * 保存・削除など書き込みの操作では使いません。
 */
const VIEW_CACHE_PREFIX = "pharmacyOsViewCache:";
const VIEW_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

function viewCacheKey(action, extraBody) {
  return VIEW_CACHE_PREFIX + getAuthEmail() + ":" + action + ":" + JSON.stringify(extraBody || {});
}

function readViewCache(action, extraBody) {
  try {
    const raw = sessionStorage.getItem(viewCacheKey(action, extraBody));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.result || Date.now() - saved.savedAt > VIEW_CACHE_MAX_AGE_MS) return null;
    return saved.result;
  } catch (e) {
    return null;
  }
}

function writeViewCache(action, extraBody, result) {
  try {
    sessionStorage.setItem(viewCacheKey(action, extraBody), JSON.stringify({ savedAt: Date.now(), result }));
  } catch (e) {
    // 容量オーバーなどで保存できなくても、画面の動作には影響させません。
  }
}

async function authFetchWithCache(action, extraBody, onCached) {
  const cached = getAuthEmail() ? readViewCache(action, extraBody) : null;
  if (cached && cached.success && typeof onCached === "function") {
    try {
      onCached(cached);
    } catch (e) {
      console.error(e);
    }
  }
  const result = await authFetch(action, extraBody);
  if (result && result.success && getAuthEmail()) writeViewCache(action, extraBody, result);
  return result;
}

/**
 * GASからの応答が認証エラー(authError:true)だった場合、ログイン状態をクリアして
 * ログイン画面を出し直します。処理した場合はtrueを返します。
 * （authFetchを使わない一部の呼び出し箇所との互換のために残しています。）
 */
function handleAuthErrorIfNeeded(result, retryCallback) {
  if (result && result.authError) {
    clearAuth();
    requireAuth(retryCallback || (() => location.reload()));
    return true;
  }
  return false;
}


/**
 * 速度の計測用（普通は何も表示しません）。
 * URLに ?perf=1 を付けて開くと、画面の右下に「GASの待ち時間」と「画面の読み込み時間」を表示します。
 * 表示の有無はこのタブの中だけで覚えます。?perf=0 で消えます。
 */
const PERF_FLAG_KEY = "pharmacyOsPerf";
const perfLog = [];
(function initPerfFlag() {
  try {
    const q = new URLSearchParams(location.search).get("perf");
    if (q === "1") sessionStorage.setItem(PERF_FLAG_KEY, "1");
    if (q === "0") sessionStorage.removeItem(PERF_FLAG_KEY);
  } catch (e) { /* 何もしない */ }
})();

function perfEnabled() {
  try { return sessionStorage.getItem(PERF_FLAG_KEY) === "1"; } catch (e) { return false; }
}

function recordPerf(action, ms) {
  if (!perfEnabled()) return;
  perfLog.push(action + " " + Math.round(ms) + "ms");
  renderPerf();
}

function renderPerf() {
  if (!perfEnabled()) return;
  let box = document.getElementById("perf-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "perf-box";
    box.style.cssText = "position:fixed;right:4px;bottom:70px;z-index:99999;background:rgba(0,0,0,.8);color:#fff;font:11px/1.4 monospace;padding:6px 8px;border-radius:6px;max-width:60vw;pointer-events:none;white-space:pre-wrap;max-height:50vh;overflow:hidden";
    document.body.appendChild(box);
  }
  const nav = typeof performance.getEntriesByType === "function" ? performance.getEntriesByType("navigation")[0] : null;
  const head = nav ? "画面 DOM完了 " + Math.round(nav.domContentLoadedEventEnd) + "ms / 読込完了 " + Math.round(nav.loadEventEnd || 0) + "ms\n" : "";
  const errors = readClientErrors();
  const errText = errors.length
    ? "\n--- エラー記録 " + errors.length + "件（新しい順に最大5件） ---\n" + errors.slice(-5).reverse().map((x) => x.t.slice(5, 16).replace("T", " ") + " " + x.page + " " + x.kind + (x.detail ? "：" + x.detail : "")).join("\n")
    : "\nエラー記録なし";
  const sess = getSession();
  const sessText = sess ? "入館証あり（残り" + Math.round((sess.exp - Date.now() / 1000) / 3600) + "時間）\n" : "入館証なし\n";
  box.textContent = head + sessText + perfLog.join("\n") + errText;
}
window.addEventListener("load", () => setTimeout(renderPerf, 0));


/**
 * 異常の見張り（画面側）。
 * 画面で起きたエラー、サーバーとの通信の失敗、「失敗しました」という返事を、
 * この端末の中（localStorage）に最新50件まで記録します。個人情報や入力内容は記録しません。
 * URLに ?perf=1 を付けて開くと、右下の表示に記録が出ます。ふだんは何も表示しません。
 * 記録を消すには、URLに ?clearlog=1 を付けて開きます。
 */
const ERROR_LOG_KEY = "pharmacyOsErrorLog";
const ERROR_LOG_MAX = 50;

function readClientErrors() {
  try {
    const list = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function logClientError(kind, detail) {
  try {
    const list = readClientErrors();
    list.push({
      t: new Date().toISOString(),
      page: location.pathname.split("/").pop() || "index.html",
      kind: String(kind || "").slice(0, 80),
      detail: String(detail || "").slice(0, 200)
    });
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(list.slice(-ERROR_LOG_MAX)));
  } catch (e) {
    // 記録できなくても、画面の動作には影響させません。
  }
  renderPerf();
}

function clearClientErrors() {
  try { localStorage.removeItem(ERROR_LOG_KEY); } catch (e) { /* 何もしない */ }
  renderPerf();
}

window.addEventListener("error", (event) => {
  logClientError("画面のエラー", (event.message || "") + (event.filename ? " @" + String(event.filename).split("/").pop() + ":" + event.lineno : ""));
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  logClientError("処理の失敗", reason && reason.message ? reason.message : reason);
});
(function initClearLog() {
  try {
    if (new URLSearchParams(location.search).get("clearlog") === "1") localStorage.removeItem(ERROR_LOG_KEY);
  } catch (e) { /* 何もしない */ }
})();
