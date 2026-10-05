"use strict";

const AUTH_TOKEN_KEY = "pharmacyOsIdToken";
const AUTH_EMAIL_KEY = "pharmacyOsAuthEmail";

// 期限のこの秒数前になったら、静かに（画面を出さず）トークンの更新を試みます。
const AUTH_REFRESH_MARGIN_SECONDS = 300;

function getIdToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function getAuthEmail() {
  return sessionStorage.getItem(AUTH_EMAIL_KEY) || "";
}

function clearAuth() {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_EMAIL_KEY);
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
  hideAuthGate();
  silentRefreshInFlight = false;
  scheduleTokenRefresh();
  applyEditNavVisibility();

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
  if (isTokenValid(getIdToken())) {
    scheduleTokenRefresh();
    applyEditNavVisibility();
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

async function authFetch(action, extraBody) {
  const response = await fetch(PHARMACY_CONFIG.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, idToken: getIdToken(), ...(extraBody || {}) })
  });
  const result = await response.json();

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
