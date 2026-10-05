/*
 * Pharmacy OS - 日次業務入力
 * GASのURLを変更する場合はGAS_ENDPOINTだけを書き換えてください。
 */

"use strict";

const GAS_ENDPOINT = PHARMACY_CONFIG.GAS_URL;

const DEFAULT_HOURS = {
  0: "休局",
  1: "08:45～18:00",
  2: "08:45～18:00",
  3: "08:45～18:00",
  4: "08:30～16:30",
  5: "08:45～18:00",
  6: "08:30～13:00",
};

const form = document.querySelector("#daily-form");
const dateInput = document.querySelector("#date");
const openingType = document.querySelector("#opening-type");
const openingSummary = document.querySelector("#opening-summary");
const submitButton = document.querySelector("#submit-button");
const statusMessage = document.querySelector("#status-message");

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayOfWeek(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function getDefaultOpeningHours() {
  return DEFAULT_HOURS[getDayOfWeek(dateInput.value)] || "";
}

function updateOpeningFields() {
  const isCustom = openingType.value === "custom";
  const isClosed = openingType.value === "closed";
  const panel = document.querySelector("#custom-opening-fields");
  const start = document.querySelector("#opening-start");
  const end = document.querySelector("#opening-end");
  const prescriptionCount = document.querySelector("#prescription-count");

  panel.hidden = !isCustom;
  start.required = isCustom;
  end.required = isCustom;
  prescriptionCount.required = !isClosed;
  if (isClosed) prescriptionCount.value = prescriptionCount.value || "0";

  if (isClosed) {
    openingSummary.textContent = "この日は休業日として記録されます。";
  } else if (isCustom) {
    openingSummary.textContent = "開始・終了時刻を入力してください。";
  } else {
    openingSummary.textContent = `選択日の通常営業時間：${getDefaultOpeningHours()}`;
  }
}

let openingTypeTouched = false;
openingType.addEventListener("change", () => { openingTypeTouched = true; });

async function applyDefaultClosedState() {
  if (openingTypeTouched || !dateInput.value) return;
  try {
    const data = await authFetch("dayType", { date: dateInput.value });
    if (data.success && data.isDefaultClosed && openingType.value === "normal") {
      openingType.value = "closed";
      updateOpeningFields();
    }
  } catch (_) {
    // 判定できない場合は何もしない（通常営業時間のまま）。
  }
}

function setupConditionalSelect(selectId, panelId, requiredIds = []) {
  const select = document.querySelector(selectId);
  const panel = document.querySelector(panelId);

  function update() {
    const enabled = select.value === "yes";
    panel.hidden = !enabled;
    requiredIds.forEach((id) => {
      document.querySelector(id).required = enabled;
    });
  }

  select.addEventListener("change", update);
  update();
}

function showStatus(message, type = "") {
  statusMessage.textContent = message;
  statusMessage.className = "status-message";
  if (type) statusMessage.classList.add(`is-${type}`);
}

/** 過去日付の重複エラー時、はっきりした確認モーダルを表示します。 */
function showDuplicateDateStatus(message, workDate) {
  showStatus("");
  const modal = document.getElementById("duplicate-modal");
  const editButton = document.getElementById("duplicate-modal-edit");
  const cancelButton = document.getElementById("duplicate-modal-cancel");

  modal.hidden = false;
  document.body.style.overflow = "hidden";

  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = "";
    editButton.removeEventListener("click", goToEdit);
    cancelButton.removeEventListener("click", closeModal);
  };
  const goToEdit = () => {
    window.location.href = `edit-daily.html?date=${encodeURIComponent(workDate)}`;
  };

  editButton.addEventListener("click", goToEdit);
  cancelButton.addEventListener("click", closeModal);
}

function setSubmitting(isSubmitting) {
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? "送信中…" : "Notionへ保存";
}

function formatRange(start, end) {
  return start && end ? `${start}～${end}` : "";
}

function createPayload(formData) {
  const isClosed = formData.get("openingType") === "closed";
  const openingHours = isClosed
    ? "休業日"
    : formData.get("openingType") === "custom"
      ? formatRange(formData.get("openingStart"), formData.get("openingEnd"))
      : getDefaultOpeningHours();

  const managerAbsence =
    formData.get("managerAbsenceEnabled") === "yes"
      ? formatRange(formData.get("managerStart"), formData.get("managerEnd"))
      : "";
  const managerResponder =
    formData.get("managerAbsenceEnabled") === "yes"
      ? formData.get("managerResponder").trim()
      : "";

  const pharmacistAbsence =
    formData.get("pharmacistAbsenceEnabled") === "yes"
      ? formatRange(
          formData.get("pharmacistStart"),
          formData.get("pharmacistEnd"),
        )
      : "";
  const pharmacistResponder =
    formData.get("pharmacistAbsenceEnabled") === "yes"
      ? formData.get("pharmacistResponder").trim()
      : "";

  return {
    workDate: formData.get("date"),
    idToken: getIdToken(),
    openingHours,
    isClosed,
    prescriptionCount: Number(formData.get("prescriptionCount") || 0),
    managerAbsence,
    pharmacistAbsence,
    managerResponder,
    pharmacistResponder,
    inquiryOccurred: formData.get("inquiryOccurred") === "yes",
    inquiryDetails: formData.get("inquiryDetails").trim(),
    specialNotes: formData.get("specialNotes").trim(),
    handover: formData.get("handover").trim(),
    confirmedBy: formData.get("confirmedBy") || "",
  };
}

async function sendDailyRecord(payload) {
  // まずはno-corsを使わず、GASの成功・失敗レスポンスを実機で確認します。
  const response = await fetch(GAS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`通信エラー（HTTP ${response.status}）`);
  }

  const result = await response.json();

  if (result.authError) {
    clearAuth();
    // 入力内容(payload)を保持したままログイン画面を出し、
    // ログイン成功後に新しいトークンで自動的に再送します。
    return new Promise((resolve, reject) => {
      requireAuth(async () => {
        try {
          const retryPayload = { ...payload, idToken: getIdToken() };
          const retryResult = await sendDailyRecord(retryPayload);
          resolve(retryResult);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  if (!result.success) {
    if (result.duplicateDate) {
      const duplicateError = new Error(result.message || "この日の日次記録は既に入力されています。");
      duplicateError.duplicateDate = true;
      throw duplicateError;
    }
    throw new Error(result.message || "Notionへの保存に失敗しました。");
  }

  return result;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus("");

  if (!form.checkValidity()) {
    form.reportValidity();
    showStatus("未入力または入力内容に誤りがあります。", "error");
    return;
  }

  setSubmitting(true);

  try {
    const payload = createPayload(new FormData(form));
    const result = await sendDailyRecord(payload);
    showStatus(result.message || "保存しました。", "success");
  } catch (error) {
    console.error("Pharmacy OS send error:", error);
    if (error.duplicateDate) {
      showDuplicateDateStatus(error.message, dateInput.value);
    } else {
      showStatus(`送信できませんでした：${error.message}`, "error");
    }
  } finally {
    setSubmitting(false);
  }
});

let pharmacistNamesPromise = null;
requireAuth(() => {
  // 薬剤師名簿は、本人確認（whoAmI）の結果を待たずに先に取りに行きます（管理者の場合だけ使います）。
  pharmacistNamesPromise = authFetch("pharmacistNames").catch(() => null);
  // ホームのリマインドから開いたときは、その日付を最初から入れておきます（形式が正しい場合だけ）。
  const dateParam = new URLSearchParams(location.search).get("date");
  dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(dateParam || "") ? dateParam : getLocalDateString();
  dateInput.addEventListener("change", () => {
    openingTypeTouched = false;
    openingType.value = "normal";
    updateOpeningFields();
    applyDefaultClosedState();
  });
  openingType.addEventListener("change", updateOpeningFields);
  updateOpeningFields();
  applyDefaultClosedState();

  setupConditionalSelect("#manager-absence", "#manager-absence-fields", [
    "#manager-start",
    "#manager-end",
  ]);
  setupConditionalSelect("#pharmacist-absence", "#pharmacist-absence-fields", [
    "#pharmacist-start",
    "#pharmacist-end",
  ]);
  setupConditionalSelect("#inquiry", "#inquiry-fields", ["#inquiry-details"]);

  loadOwnName();
});

async function loadOwnName() {
  const confirmedByInput = document.querySelector("#confirmed-by");
  const confirmedBySelect = document.querySelector("#confirmed-by-select");
  try {
    const result = await fetchWhoAmIShared();
    const isSystemAdmin = result.success && (result.role === "system_admin" || result.role === "admin");
    if (isSystemAdmin) {
      confirmedByInput.hidden = true;
      confirmedByInput.name = "";
      confirmedBySelect.hidden = false;
      confirmedBySelect.name = "confirmedBy";
      await loadPharmacistNamesForAdmin(confirmedBySelect);
    } else {
      confirmedByInput.value = (result.success && result.name) ? result.name : "（氏名未登録）";
    }
  } catch (e) {
    console.error("氏名の取得に失敗しました。", e);
    confirmedByInput.value = "（取得できませんでした）";
  }
}

async function loadPharmacistNamesForAdmin(selectEl) {
  try {
    const result = await (pharmacistNamesPromise || authFetch("pharmacistNames"));
    if (!result || !result.success) return;
    (result.names || []).forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      selectEl.appendChild(option);
    });
  } catch (e) {
    console.error("薬剤師名簿の取得に失敗しました。", e);
  }
}
