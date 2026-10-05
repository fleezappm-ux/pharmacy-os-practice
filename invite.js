"use strict";

const statusMessage = document.getElementById("status-message");
const lineWarning = document.getElementById("line-warning");
const introText = document.getElementById("intro-text");
const signinButtonEl = document.getElementById("google-signin-button");
const profileForm = document.getElementById("profile-form");

let googleCredential = null;

function getInviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || "";
}

function isLineInAppBrowser() {
  return /Line/i.test(navigator.userAgent);
}

function setStatus(message, className) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${className || ""}`;
}

const inviteToken = getInviteTokenFromUrl();

if (isLineInAppBrowser()) {
  lineWarning.classList.add("show");
}

if (!inviteToken) {
  introText.textContent = "招待コードが見つかりません。招待してくれた方に、正しいURLをもう一度共有してもらってください。";
  signinButtonEl.hidden = true;
} else {
  initGoogleSignin();
}

function initGoogleSignin() {
  if (!(window.google && google.accounts && google.accounts.id)) {
    setTimeout(initGoogleSignin, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: PHARMACY_CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse
  });
  google.accounts.id.renderButton(signinButtonEl, {
    theme: "outline",
    size: "large",
    text: "signin_with",
    locale: "ja",
    width: 280
  });
}

function handleCredentialResponse(response) {
  googleCredential = response.credential;
  signinButtonEl.hidden = true;
  introText.textContent = "お名前・役職・所属店舗を入力してください。管理者が内容を確認したうえで、利用できる範囲が設定されます。";
  profileForm.classList.add("show");
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("profile-name").value.trim();
  const role = document.getElementById("profile-role").value;
  const store = document.getElementById("profile-store").value.trim();

  if (!name || !role || !store) {
    setStatus("すべての項目を入力してください。", "error");
    return;
  }

  const submitButton = profileForm.querySelector(".profile-submit");
  submitButton.disabled = true;
  setStatus("登録処理をしています…", "");

  try {
    const result = await fetch(PHARMACY_CONFIG.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "registerViaInvite",
        idToken: googleCredential,
        inviteToken: inviteToken,
        name: name,
        role: role,
        store: store
      })
    });
    const data = await result.json();
    if (data.success) {
      profileForm.hidden = true;
      setStatus(data.message || "登録が完了しました。", "success");
      introText.textContent = "登録が完了しました。管理者が内容を確認するまで、閲覧のみの利用となります。下のリンクからPharmacy OSを開いてください。";
      const link = document.createElement("a");
      link.href = "home.html";
      link.textContent = "Pharmacy OSを開く";
      link.style.display = "inline-block";
      link.style.marginTop = "8px";
      link.style.fontWeight = "800";
      link.style.color = "var(--green)";
      statusMessage.after(link);
    } else {
      setStatus(data.message || "登録に失敗しました。", "error");
      submitButton.disabled = false;
    }
  } catch (e) {
    console.error(e);
    setStatus("通信エラーが発生しました。しばらくしてから再度お試しください。", "error");
    submitButton.disabled = false;
  }
});
