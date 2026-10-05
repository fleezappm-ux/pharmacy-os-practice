"use strict";

let allPatients = [];
let filterState = "all";
let filterCategory = "all";
let searchText = "";
let currentPatientId = null; // 各モーダルで、どの患者に対する操作かを覚えておくため

const patientList = document.getElementById("patient-list");
const oneppoLoading = document.getElementById("oneppo-loading");

document.addEventListener("DOMContentLoaded", () => {
  requireAuth(() => loadStoreSettingsAndPatients());

  document.getElementById("reload-button").addEventListener("click", loadPatients);
  document.getElementById("oneppo-toggle-button").addEventListener("click", () => handleToggleOneppo(true));
  document.getElementById("oneppo-toggle-off-button").addEventListener("click", () => {
    if (confirm("一包化サポートをOFFにします。よろしいですか？")) handleToggleOneppo(false);
  });
  document.getElementById("search-input").addEventListener("input", (e) => {
    searchText = e.target.value.trim();
    renderList();
  });
  document.querySelectorAll("[data-filter-state]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-filter-state]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      filterState = chip.dataset.filterState;
      renderList();
    });
  });
  document.querySelectorAll("[data-filter-category]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-filter-category]").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      filterCategory = chip.dataset.filterCategory;
      renderList();
    });
  });

  document.getElementById("add-patient-button").addEventListener("click", () => openPatientModal(null));
  document.getElementById("save-patient-button").addEventListener("click", handleSavePatient);
  document.getElementById("confirm-done-button").addEventListener("click", handleConfirmDone);
  document.getElementById("confirm-changed-button").addEventListener("click", handleConfirmChanged);

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", (e) => { e.currentTarget.closest(".modal").hidden = true; });
  });
});

/** 店舗設定の一包化サポートON/OFFを確認してから、患者一覧を読み込みます。 */
async function loadStoreSettingsAndPatients() {
  let canManageOneppoToggle = false;
  try {
    const who = await fetchWhoAmIShared();
    canManageOneppoToggle = !!(who.success && (who.role === "system_admin" || who.role === "admin" || who.role === "managing_pharmacist"));
  } catch (e) {
    console.error(e);
  }

  try {
    const result = await authFetch("getStoreSettings");
    if (!result.success) throw new Error(result.message || "取得に失敗しました。");
    const enabled = !!result.oneppoEnabled;
    document.getElementById("oneppo-main-content").hidden = !enabled;
    document.getElementById("oneppo-disabled-message").hidden = enabled;
    document.getElementById("oneppo-disabled-message").classList.remove("error");
    document.getElementById("oneppo-toggle-admin").hidden = !(canManageOneppoToggle && !enabled);
    document.getElementById("oneppo-toggle-off-button").hidden = !(canManageOneppoToggle && enabled);
    if (!enabled) {
      oneppoLoading.hidden = true;
      return;
    }
  } catch (e) {
    console.error(e);
    // ★店舗設定の取得に失敗しても、画面が何も表示されないままにはせず、エラーであることを伝えます。
    oneppoLoading.hidden = true;
    const msg = document.getElementById("oneppo-disabled-message");
    msg.hidden = false;
    msg.classList.add("error");
    msg.textContent = "店舗設定の確認に失敗しました。しばらくしてから再読み込みしてください。";
    document.getElementById("oneppo-main-content").hidden = true;
    return;
  }
  await loadPatients();
}

async function handleToggleOneppo(enabled) {
  try {
    const result = await authFetch("setOneppoEnabled", { enabled });
    if (!result.success) { alert(result.message || "切り替えに失敗しました。"); return; }
    await loadStoreSettingsAndPatients();
  } catch (e) {
    console.error(e);
    alert("通信エラーが発生しました。");
  }
}

async function loadPatients() {
  oneppoLoading.hidden = false;
  oneppoLoading.classList.remove("error");
  oneppoLoading.textContent = "読み込んでいます…";
  try {
    const result = await authFetch("getOneppoPatients");
    if (!result.success) throw new Error(result.message || "取得に失敗しました。");
    allPatients = result.patients || [];
    oneppoLoading.hidden = true;
    renderList();
  } catch (e) {
    console.error(e);
    oneppoLoading.hidden = false;
    oneppoLoading.classList.add("error");
    oneppoLoading.textContent = "読み込みに失敗しました。しばらくしてから再読み込みしてください。";
  }
}

function dateOnly(dateValue) {
  return dateValue && dateValue.start ? String(dateValue.start).slice(0, 10) : "";
}

function effectiveNextDate(p) {
  if (p["手動指定優先フラグ"] && dateOnly(p["手動指定の次回来局予定日"])) return dateOnly(p["手動指定の次回来局予定日"]);
  return dateOnly(p["自動計算した次回来局予定日"]);
}

function overdueDays(p) {
  const next = effectiveNextDate(p);
  if (!next || p["現在の予定状態"] !== "未完了") return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = next.split("-").map(Number);
  const nextDate = new Date(y, m - 1, d);
  const diff = Math.floor((today - nextDate) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function printSummary(p) {
  const labels = [];
  if (p["用法印字"]) labels.push("用法");
  if (p["氏名印字"]) labels.push("氏名");
  if (p["日付印字"]) labels.push("日付");
  if (p["医療機関名印字"]) labels.push("医療機関名");
  if (p["薬品名印字"]) labels.push("薬品名");
  return labels.length ? labels.join("・") : "なし";
}

function stateBadgeClass(state) {
  if (state === "継続中") return "green";
  if (state === "一時停止") return "orange";
  return "gray";
}

function renderList() {
  patientList.innerHTML = "";
  const filtered = allPatients.filter((p) => {
    if (filterState !== "all" && p["状態"] !== filterState) return false;
    if (filterCategory !== "all" && p["区分"] !== filterCategory) return false;
    if (searchText) {
      const haystack = `${p["氏名（フルネーム）"] || ""}${p["カレンダー表示名"] || ""}`;
      if (!haystack.includes(searchText)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "該当する患者がいません。";
    patientList.appendChild(empty);
    return;
  }

  filtered.forEach((p) => {
    const card = document.createElement("div");
    card.className = "patient-card";

    const head = document.createElement("div");
    head.className = "patient-head";
    const name = document.createElement("span");
    name.className = "patient-name";
    name.textContent = p["カレンダー表示名"] || p["氏名（フルネーム）"] || "(氏名未設定)";
    head.appendChild(name);
    card.appendChild(head);

    const badges = document.createElement("div");
    badges.className = "patient-badges";
    badges.appendChild(makeBadge(p["区分"] || "区分未設定", "blue"));
    badges.appendChild(makeBadge(p["状態"] || "状態未設定", stateBadgeClass(p["状態"])));
    badges.appendChild(makeBadge(p["現在の予定状態"] || "-", p["現在の予定状態"] === "変更・中止" ? "red" : "gray"));
    const overdue = overdueDays(p);
    if (overdue > 0) badges.appendChild(makeBadge(`${overdue}日超過`, overdue >= 14 ? "red" : "orange"));
    card.appendChild(badges);

    const info = document.createElement("dl");
    info.className = "patient-info-grid";
    info.appendChild(infoItem("次回来局予定日", effectiveNextDate(p) || "未設定"));
    info.appendChild(infoItem("処方日数", p["今回の処方日数"] != null ? `${p["今回の処方日数"]}日分` : "未設定"));
    info.appendChild(infoItem("印字設定", printSummary(p)));
    info.appendChild(infoItem("備考", p["備考"] || "―"));
    card.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "patient-actions";

    const editBtn = makeActionButton("編集", () => openPatientModal(p));
    actions.appendChild(editBtn);

    const doneBtn = makeActionButton("済", () => openDoneModal(p), "primary");
    actions.appendChild(doneBtn);

    if (p["直前の状態（取消用）"]) {
      actions.appendChild(makeActionButton("済を取消", () => handleUndo(p)));
    }

    actions.appendChild(makeActionButton("変更・中止", () => openChangedModal(p), "warn"));

    card.appendChild(actions);
    patientList.appendChild(card);
  });
}

function makeBadge(text, colorClass) {
  const span = document.createElement("span");
  span.className = "badge " + colorClass;
  span.textContent = text;
  return span;
}
function infoItem(label, value) {
  const wrap = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  wrap.appendChild(dt);
  wrap.appendChild(dd);
  return wrap;
}
function makeActionButton(text, onClick, variant) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action-button" + (variant ? " " + variant : "");
  btn.textContent = text;
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/* ============================================================
 * 患者の追加・編集
 * ============================================================ */

function openPatientModal(patient) {
  currentPatientId = patient ? patient.id : null;
  document.getElementById("patient-modal-title").textContent = patient ? "患者情報を編集" : "患者を追加";
  document.getElementById("patient-form-status").textContent = "";

  document.getElementById("patient-name").value = (patient && patient["氏名（フルネーム）"]) || "";
  document.getElementById("patient-display-name").value = (patient && patient["カレンダー表示名"]) || "";
  document.getElementById("patient-category").value = (patient && patient["区分"]) || "外来";
  document.getElementById("patient-status").value = (patient && patient["状態"]) || "継続中";
  document.getElementById("patient-print-usage").checked = !!(patient && patient["用法印字"]);
  document.getElementById("patient-print-name").checked = !!(patient && patient["氏名印字"]);
  document.getElementById("patient-print-date").checked = !!(patient && patient["日付印字"]);
  document.getElementById("patient-print-institution").checked = !!(patient && patient["医療機関名印字"]);
  document.getElementById("patient-print-drug").checked = !!(patient && patient["薬品名印字"]);
  document.getElementById("patient-note").value = (patient && patient["作り方・注意点メモ"]) || "";
  document.getElementById("patient-manual-next").value = (patient && dateOnly(patient["手動指定の次回来局予定日"])) || "";
  document.getElementById("patient-manual-priority").checked = !!(patient && patient["手動指定優先フラグ"]);

  document.getElementById("patient-modal").hidden = false;
}

async function handleSavePatient() {
  const statusEl = document.getElementById("patient-form-status");
  const name = document.getElementById("patient-name").value.trim();
  if (!name) { statusEl.textContent = "氏名を入力してください。"; return; }

  const patientData = {
    "氏名（フルネーム）": name,
    "カレンダー表示名": document.getElementById("patient-display-name").value.trim(),
    "区分": document.getElementById("patient-category").value,
    "状態": document.getElementById("patient-status").value,
    "用法印字": document.getElementById("patient-print-usage").checked,
    "氏名印字": document.getElementById("patient-print-name").checked,
    "日付印字": document.getElementById("patient-print-date").checked,
    "医療機関名印字": document.getElementById("patient-print-institution").checked,
    "薬品名印字": document.getElementById("patient-print-drug").checked,
    "作り方・注意点メモ": document.getElementById("patient-note").value.trim(),
    "手動指定の次回来局予定日": document.getElementById("patient-manual-next").value,
    "手動指定優先フラグ": document.getElementById("patient-manual-priority").checked
  };

  statusEl.textContent = "保存しています…";
  try {
    const payload = { patient: patientData };
    if (currentPatientId) payload.id = currentPatientId;
    const result = await authFetch("saveOneppoPatient", payload);
    if (!result.success) { statusEl.textContent = result.message || "保存に失敗しました。"; return; }
    document.getElementById("patient-modal").hidden = true;
    await loadPatients();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}

/* ============================================================
 * 済・取消・変更中止
 * ============================================================ */

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function openDoneModal(patient) {
  currentPatientId = patient.id;
  document.getElementById("done-form-status").textContent = "";
  document.getElementById("done-actual-date").value = todayStr();
  document.getElementById("done-prescription-date").value = "";
  document.getElementById("done-actual-days").value = patient["今回の処方日数"] || "";
  document.getElementById("done-print-start").value = "";
  document.getElementById("done-print-end").value = "";
  document.getElementById("done-manual-next").value = "";
  document.getElementById("done-manual-priority").checked = false;
  document.getElementById("done-modal").hidden = false;
}

async function handleConfirmDone() {
  const statusEl = document.getElementById("done-form-status");
  const actualDate = document.getElementById("done-actual-date").value;
  const prescriptionDate = document.getElementById("done-prescription-date").value;
  const actualDays = document.getElementById("done-actual-days").value;
  const printStartOverride = document.getElementById("done-print-start").value;
  const printEndOverride = document.getElementById("done-print-end").value;
  const manualNextDate = document.getElementById("done-manual-next").value;
  const manualPriority = document.getElementById("done-manual-priority").checked;
  if (!actualDate) { statusEl.textContent = "対応日を入力してください。"; return; }
  if (!actualDays) { statusEl.textContent = "処方日数を入力してください。"; return; }
  if (manualPriority && !manualNextDate) { statusEl.textContent = "優先する場合は、次回来局予定日を入力してください。"; return; }

  statusEl.textContent = "記録しています…";
  try {
    const result = await authFetch("markOneppoDone", {
      id: currentPatientId,
      actualDate,
      prescriptionDate: prescriptionDate || undefined,
      actualDays: Number(actualDays),
      printStartOverride: printStartOverride || undefined,
      printEndOverride: printEndOverride || undefined,
      manualNextDate: manualNextDate || undefined,
      manualPriority
    });
    if (!result.success) { statusEl.textContent = result.message || "記録に失敗しました。"; return; }
    document.getElementById("done-modal").hidden = true;
    await loadPatients();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}

async function handleUndo(patient) {
  if (!confirm("直前の「済」を取り消します。よろしいですか？")) return;
  try {
    const result = await authFetch("undoOneppoDone", { id: patient.id });
    if (!result.success) { alert(result.message || "取消に失敗しました。"); return; }
    await loadPatients();
  } catch (e) {
    console.error(e);
    alert("通信エラーが発生しました。");
  }
}

function openChangedModal(patient) {
  currentPatientId = patient.id;
  document.getElementById("changed-form-status").textContent = "";
  document.getElementById("changed-reason").value = "来局状況不明";
  document.getElementById("changed-reason-free").value = "";
  document.getElementById("changed-modal").hidden = false;
}

async function handleConfirmChanged() {
  const statusEl = document.getElementById("changed-form-status");
  const reason = document.getElementById("changed-reason").value;
  const reasonFree = document.getElementById("changed-reason-free").value.trim();
  if (reason === "その他" && !reasonFree) { statusEl.textContent = "「その他」を選んだ場合は、補足を入力してください。"; return; }

  statusEl.textContent = "記録しています…";
  try {
    const result = await authFetch("markOneppoChanged", { id: currentPatientId, reason, reasonFree });
    if (!result.success) { statusEl.textContent = result.message || "記録に失敗しました。"; return; }
    document.getElementById("changed-modal").hidden = true;
    await loadPatients();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}
