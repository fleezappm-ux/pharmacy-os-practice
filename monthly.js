"use strict";

const GAS_ENDPOINT = PHARMACY_CONFIG.GAS_URL;

const controls = {
  generic: {
    file: document.querySelector("#generic-file"),
    fileName: document.querySelector("#generic-file-name"),
    button: document.querySelector("#generic-upload-button"),
    badge: document.querySelector("#generic-badge"),
    result: document.querySelector("#generic-result"),
    action: "importGenericCsv",
  },
  concentration: {
    file: document.querySelector("#concentration-file"),
    fileName: document.querySelector("#concentration-file-name"),
    button: document.querySelector("#concentration-upload-button"),
    badge: document.querySelector("#concentration-badge"),
    result: document.querySelector("#concentration-result"),
    action: "importConcentrationCsv",
  },
};

const refreshButton = document.querySelector("#refresh-button");
const monthlyStatus = document.querySelector("#monthly-status");
const summaryHeading = document.querySelector("#summary-heading");
const genericSummaryLabel = document.querySelector("#generic-summary-label");
const genericSummaryValue = document.querySelector("#generic-summary-value");
const genericSummaryUnit = document.querySelector("#generic-summary-unit");
const genericSummaryLink = document.querySelector("#generic-summary-link");
const concentrationSummaryLabel = document.querySelector("#concentration-summary-label");
const concentrationSummaryList = document.querySelector("#concentration-summary-list");
const concentrationSummaryLink = document.querySelector("#concentration-summary-link");

Object.values(controls).forEach((control) => {
  control.file.addEventListener("change", () => {
    const selectedFile = control.file.files[0];
    control.fileName.textContent = selectedFile
      ? `${selectedFile.name}（${formatFileSize(selectedFile.size)}）`
      : "ファイルが選択されていません。";
    control.button.disabled = !selectedFile;
    setBadge(control, selectedFile ? "取込可能" : "未選択", selectedFile ? "ready" : "");
    setResult(control, "");
  });

  control.button.addEventListener("click", () => uploadCsv(control));
});

async function uploadCsv(control) {
  const selectedFile = control.file.files[0];
  if (!selectedFile) return;

  setBusy(control, true);
  setResult(control, "CSVを読み込んでいます…");
  try {
    const csvBase64 = await fileToBase64(selectedFile);
    setResult(control, "Notionへ保存しています。画面を閉じずにお待ちください…");
    const data = await authFetch(control.action, {
      fileName: selectedFile.name,
      csvBase64,
    });
    if (!data.success) throw new Error(data.message || "取込に失敗しました。");

    setBadge(control, "取込済み", "success");
    setResult(control, `${data.message}（新規${data.created}件・更新${data.updated}件）`);
    await loadMonthlyData();
  } catch (error) {
    console.error(error);
    setBadge(control, "エラー", "error");
    setResult(control, error.message, true);
  } finally {
    setBusy(control, false);
  }
}

async function loadMonthlyData() {
  refreshButton.disabled = true;
  refreshButton.textContent = "…";
  monthlyStatus.textContent = "";
  try {
    const data = await authFetch("monthly");
    if (!data.success) throw new Error(data.message || "取得に失敗しました。");
    renderSummary(data);
  } catch (error) {
    console.error(error);
    monthlyStatus.textContent = `最新情報を取得できませんでした：${error.message}`;
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "↻";
  }
}

function renderSummary(data) {
  const monthLabel = data.summaryMonthLabel || "前月";
  const hasGeneric = data.genericRate !== null && data.genericRate !== undefined;
  summaryHeading.textContent = `${monthLabel}のまとめ`;
  genericSummaryLabel.textContent = `${monthLabel} 後発品使用率`;
  genericSummaryValue.textContent = hasGeneric ? data.genericRate : "未入力";
  genericSummaryUnit.hidden = !hasGeneric;
  genericSummaryLink.hidden = hasGeneric;

  concentrationSummaryLabel.textContent = `${monthLabel} 処方箋集中率 上位4医療機関`;
  concentrationSummaryList.replaceChildren();
  const ranking = data.concentrationTop4 || [];
  concentrationSummaryLink.hidden = ranking.length > 0;
  if (!ranking.length) {
    const item = document.createElement("li");
    item.textContent = "未入力";
    concentrationSummaryList.append(item);
    return;
  }
  ranking.forEach((entry) => {
    const item = document.createElement("li");
    item.append(document.createTextNode(entry.medicalInstitution));
    const rate = document.createElement("span");
    rate.textContent = `${entry.percentage}%`;
    item.append(rate);
    concentrationSummaryList.append(item);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error("ファイルを読み込めませんでした。"));
    reader.readAsArrayBuffer(file);
  });
}

function setBusy(control, busy) {
  control.button.disabled = busy;
  control.file.disabled = busy;
  control.button.textContent = busy ? "取込中…" : control.action === "importGenericCsv"
    ? "後発品CSVを取り込む"
    : "集中率CSVを取り込む";
}

function setBadge(control, text, className) {
  control.badge.textContent = text;
  control.badge.className = `status-chip${className ? ` ${className}` : ""}`;
}

function setResult(control, message, isError = false) {
  control.result.textContent = message;
  control.result.className = `result-message${isError ? " error" : ""}`;
}

function formatFileSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

refreshButton.addEventListener("click", loadMonthlyData);
requireAuth(loadMonthlyData);

/* ===== 処方箋枚数・受付回数等調べ ===== */
(function () {
  const monthPicker = document.querySelector("#survey-month-picker");
  const fields = ["survey-count", "survey-dental", "survey-ophthalmology", "survey-ent", "survey-other"];
  const totalPreview = document.querySelector("#survey-total-preview");
  const saveButton = document.querySelector("#survey-save-button");
  const resultEl = document.querySelector("#survey-result");

  // 入力するのは、たいてい先月分なので、初期値は先月にします。
  const now = new Date();
  const defaultMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  monthPicker.value = `${defaultMonth.getFullYear()}-${String(defaultMonth.getMonth() + 1).padStart(2, "0")}`;

  function updateTotalPreview() {
    const v = (id) => Number(document.getElementById(id).value) || 0;
    const total = v("survey-dental") + v("survey-ophthalmology") + v("survey-ent") + v("survey-other");
    totalPreview.textContent = total;
  }
  fields.slice(1).forEach((id) => document.getElementById(id).addEventListener("input", updateTotalPreview));

  saveButton.addEventListener("click", async () => {
    if (!monthPicker.value) {
      resultEl.textContent = "対象月を選択してください。";
      resultEl.className = "result-message error";
      return;
    }
    const [year, month] = monthPicker.value.split("-").map(Number);
    const monthLabel = `${year}年${month}月`;
    const numOrEmpty = (id) => {
      const v = document.getElementById(id).value;
      return v === "" ? "" : Number(v);
    };
    const payload = {
      id: "",
      row: {
        "年月": monthLabel,
        "処方箋受付回数": numOrEmpty("survey-count"),
        "歯科（処方箋受付枚数）": numOrEmpty("survey-dental"),
        "眼科（処方箋受付枚数）": numOrEmpty("survey-ophthalmology"),
        "耳鼻咽喉科（処方箋受付枚数）": numOrEmpty("survey-ent"),
        "その他（処方箋受付枚数）": numOrEmpty("survey-other")
      }
    };
    saveButton.disabled = true;
    resultEl.textContent = "保存しています…";
    resultEl.className = "result-message";
    try {
      const result = await authFetch("saveStatusSurveyRow", payload);
      if (!result.success) throw new Error(result.message || "保存に失敗しました。");
      resultEl.textContent = `${monthLabel}分を保存しました。`;
      resultEl.className = "result-message";
    } catch (error) {
      resultEl.textContent = `保存できません：${error.message}`;
      resultEl.className = "result-message error";
    } finally {
      saveButton.disabled = false;
    }
  });
})();
