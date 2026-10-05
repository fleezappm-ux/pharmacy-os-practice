"use strict";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];
const TYPE_CLASS = { "勉強会": "study", "当番医": "duty", "当番薬局": "duty", "その他": "other" };
const TYPE_LABEL_PLACE = { "勉強会": "場所", "当番医": "医療機関名", "当番薬局": "薬局名", "その他": "場所" };

let viewYear, viewMonth; // viewMonth: 1-12
let monthEvents = [];    // getCalendarEventsの結果（表示中の月＋前後の空白日を含む範囲）
let oneppoOccurrences = []; // 一包化の次回予定日を、擬似的な予定として保持
let activeFilter = "all";
let selectedDateStr = null;
let editingEvent = null; // 編集中の元イベント（保存/削除時に使用）
let oneppoEnabled = false; // 店舗設定DBの「一包化サポートON/OFF」
let canManageOneppoToggle = false;
let currentView = "month";

const monthLabel = document.getElementById("month-label");
const monthGrid = document.getElementById("month-grid");
const calendarLoading = document.getElementById("calendar-loading");
const dayDetail = document.getElementById("day-detail");
const dayDetailHeading = document.getElementById("day-detail-heading");
const dayDetailList = document.getElementById("day-detail-list");

function pad2(n) { return String(n).padStart(2, "0"); }
function dateStr(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function todayStr() {
  const t = new Date();
  return dateStr(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
function formatJapaneseMonth(y, m) { return `${y}年${m}月`; }

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth() + 1;

  requireAuth(() => {
    loadStoreSettings();
    loadMonth();
  });

  document.getElementById("reload-button").addEventListener("click", loadMonth);
  document.getElementById("prev-month-button").addEventListener("click", () => changePeriod(-1));
  document.getElementById("next-month-button").addEventListener("click", () => changePeriod(1));
  document.getElementById("today-button").addEventListener("click", () => {
    const t = new Date();
    viewYear = t.getFullYear();
    viewMonth = t.getMonth() + 1;
    selectedDateStr = todayStr();
    loadMonth();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.filter;
      if (activeFilter === "oneppo" && !oneppoOccurrences.length) {
        loadOneppoOccurrences().then(renderCurrentView);
      } else {
        renderCurrentView();
      }
    });
  });

  document.getElementById("add-event-fab").addEventListener("click", () => openEventModal(null, selectedDateStr || todayStr()));
  document.getElementById("oneppo-toggle-button").addEventListener("click", handleToggleOneppo);
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.currentTarget.closest(".modal").hidden = true;
    });
  });

  document.getElementById("event-allday").addEventListener("change", updateTimeFieldsVisibility);
  document.getElementById("event-has-prep").addEventListener("change", updatePrepFieldsVisibility);
  document.getElementById("event-repeat").addEventListener("change", updateRepeatFieldsVisibility);
  document.getElementById("event-type").addEventListener("change", updateTypeFieldsVisibility);
  document.getElementById("save-event-button").addEventListener("click", handleSaveEvent);
  document.getElementById("delete-event-button").addEventListener("click", handleDeleteEvent);

  document.getElementById("notify-timing").addEventListener("change", (e) => {
    document.getElementById("notify-custom-days-field").hidden = e.target.value !== "任意日数前";
  });
  document.getElementById("notify-target-type").addEventListener("change", (e) => {
    document.getElementById("notify-target-emails-field").hidden = e.target.value !== "指定参加者";
  });
  document.getElementById("add-notification-button").addEventListener("click", handleAddNotification);
});

/** 店舗設定DBの一包化サポートON/OFFを取得し、OFFなら一包化関連のUIを隠します。 */
async function loadStoreSettings() {
  try {
    const [result, who] = await Promise.all([
      authFetch("getStoreSettings"),
      fetchWhoAmIShared()
    ]);
    if (!result.success) throw new Error(result.message || "店舗設定の取得に失敗しました。");
    oneppoEnabled = !!result.oneppoEnabled;
    canManageOneppoToggle = !!(who.success && (who.role === "system_admin" || who.role === "admin" || who.role === "managing_pharmacist"));
  } catch (e) {
    console.error(e);
    oneppoEnabled = false;
    canManageOneppoToggle = false;
  }
  renderOneppoControl();
}

function renderOneppoControl() {
  const control = document.getElementById("oneppo-control");
  const link = document.getElementById("oneppo-link");
  const chip = document.getElementById("oneppo-filter-chip");
  const status = document.getElementById("oneppo-status");
  const toggle = document.getElementById("oneppo-toggle-button");
  const bottomLink = document.getElementById("bottom-oneppo-link");

  control.hidden = !(oneppoEnabled || canManageOneppoToggle);
  link.hidden = !oneppoEnabled;
  if (chip) chip.hidden = !oneppoEnabled;
  if (bottomLink) bottomLink.hidden = !oneppoEnabled;
  status.textContent = oneppoEnabled ? "ON" : "OFF";
  status.className = `oneppo-status ${oneppoEnabled ? "on" : "off"}`;
  toggle.hidden = !canManageOneppoToggle;
  toggle.textContent = oneppoEnabled ? "OFFにする" : "ONにする";
  toggle.className = `oneppo-toggle-button${oneppoEnabled ? " turn-off" : ""}`;
}

async function handleToggleOneppo() {
  const nextEnabled = !oneppoEnabled;
  if (!nextEnabled && !confirm("一包化サポートをOFFにします。よろしいですか？")) return;
  const button = document.getElementById("oneppo-toggle-button");
  button.disabled = true;
  try {
    const result = await authFetch("setOneppoEnabled", { enabled: nextEnabled });
    if (!result.success) throw new Error(result.message || "切り替えに失敗しました。");
    oneppoEnabled = nextEnabled;
    oneppoOccurrences = [];
    if (!oneppoEnabled && activeFilter === "oneppo") {
      activeFilter = "all";
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === "all"));
      renderCurrentView();
    }
    renderOneppoControl();
  } catch (e) {
    console.error(e);
    alert(e.message || "通信エラーが発生しました。");
  } finally {
    button.disabled = false;
  }
}

function changeMonth(diff) {
  viewMonth += diff;
  if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
  if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
  loadMonth();
}

function changePeriod(diff) {
  if ((currentView === "week" || currentView === "day") && selectedDateStr) {
    const [y, m, d] = selectedDateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + diff * (currentView === "week" ? 7 : 1));
    selectedDateStr = dateStr(date.getFullYear(), date.getMonth() + 1, date.getDate());
    if (viewYear !== date.getFullYear() || viewMonth !== date.getMonth() + 1) {
      viewYear = date.getFullYear();
      viewMonth = date.getMonth() + 1;
      loadMonth();
      return;
    }
    renderCurrentView();
    return;
  }
  changeMonth(diff);
}

function switchView(view) {
  currentView = view;
  if (!selectedDateStr) selectedDateStr = todayStr();
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  renderCurrentView();
}

/** カレンダーグリッドは月をまたいで前後の空白日も表示するため、その範囲を計算します。 */
function getGridRange(year, month) {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastOfMonth = new Date(year, month, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - lastOfMonth.getDay()));
  return {
    start: dateStr(gridStart.getFullYear(), gridStart.getMonth() + 1, gridStart.getDate()),
    end: dateStr(gridEnd.getFullYear(), gridEnd.getMonth() + 1, gridEnd.getDate())
  };
}

async function loadMonth() {
  calendarLoading.hidden = false;
  calendarLoading.classList.remove("error");
  calendarLoading.textContent = "読み込んでいます…";
  monthLabel.textContent = formatJapaneseMonth(viewYear, viewMonth);
  document.getElementById("appbar-title").textContent = formatJapaneseMonth(viewYear, viewMonth);
  dayDetail.hidden = true;
  if (!selectedDateStr) selectedDateStr = todayStr();

  try {
    const range = getGridRange(viewYear, viewMonth);
    const result = await authFetch("getCalendarEvents", { startDate: range.start, endDate: range.end });
    if (!result.success) throw new Error(result.message || "取得に失敗しました。");
    monthEvents = result.events || [];
    if (activeFilter === "oneppo") await loadOneppoOccurrences();
    calendarLoading.hidden = true;
    renderCurrentView();
  } catch (e) {
    console.error(e);
    calendarLoading.hidden = false;
    calendarLoading.classList.add("error");
    calendarLoading.textContent = "読み込みに失敗しました。しばらくしてから再読み込みしてください。";
  }
}

/** 一包化患者の「次回来局予定日」を、カレンダー表示用の擬似的な予定に変換します。 */
async function loadOneppoOccurrences() {
  try {
    const result = await authFetch("getOneppoPatients");
    if (!result.success) return;
    oneppoOccurrences = (result.patients || [])
      .filter((p) => p["状態"] === "継続中" && p["現在の予定状態"] === "未完了")
      .map((p) => {
        const manual = p["手動指定優先フラグ"] && p["手動指定の次回来局予定日"] && p["手動指定の次回来局予定日"].start;
        const auto = p["自動計算した次回来局予定日"] && p["自動計算した次回来局予定日"].start;
        const nextDate = manual || auto;
        if (!nextDate) return null;
        return {
          実施日: String(nextDate).slice(0, 10),
          予定名: `一包化：${p["カレンダー表示名"] || p["氏名（フルネーム）"] || ""}`,
          予定種別: "一包化",
          isOneppo: true,
          patientId: p.id
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error(e);
  }
}

function typeClassFor(event) {
  if (event.isOneppo) return "oneppo";
  return TYPE_CLASS[event.予定種別] || "other";
}

function passesFilter(event) {
  if (activeFilter === "all") return !event.isOneppo;
  if (activeFilter === "duty") return event.予定種別 === "当番医" || event.予定種別 === "当番薬局";
  if (activeFilter === "oneppo") return !!event.isOneppo;
  return event.予定種別 === activeFilter;
}

function visibleEvents() {
  const source = activeFilter === "oneppo" ? oneppoOccurrences : monthEvents;
  return source.filter(passesFilter).slice().sort((a, b) => {
    const left = `${a.実施日 || ""} ${a.開始時刻 || ""}`;
    const right = `${b.実施日 || ""} ${b.開始時刻 || ""}`;
    return left.localeCompare(right);
  });
}

function renderCurrentView() {
  const ids = { month: "month-view", week: "week-view", day: "single-day-view", list: "list-view" };
  Object.entries(ids).forEach(([view, id]) => { document.getElementById(id).hidden = view !== currentView; });
  dayDetail.hidden = true;
  if (currentView === "month") renderGrid();
  else if (currentView === "week") renderWeekView();
  else if (currentView === "day") renderDayView();
  else renderListView();
}

function renderGrid() {
  monthGrid.innerHTML = "";
  const range = getGridRange(viewYear, viewMonth);
  const [sy, sm, sd] = range.start.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const today = todayStr();

  const eventsByDate = {};
  const allEvents = activeFilter === "oneppo" ? oneppoOccurrences : monthEvents;
  allEvents.filter(passesFilter).forEach((ev) => {
    if (!eventsByDate[ev.実施日]) eventsByDate[ev.実施日] = [];
    eventsByDate[ev.実施日].push(ev);
  });

  for (let i = 0; i < 42; i++) {
    const y = cursor.getFullYear(), m = cursor.getMonth() + 1, d = cursor.getDate();
    const cellDate = dateStr(y, m, d);
    const outside = m !== viewMonth;

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell" + (outside ? " outside" : "") + (cellDate === today ? " today" : "") + (cellDate === selectedDateStr ? " selected" : "");
    cell.dataset.date = cellDate;

    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d;
    cell.appendChild(num);

    const evWrap = document.createElement("div");
    evWrap.className = "day-events";
    const dayEvents = eventsByDate[cellDate] || [];
    dayEvents.slice(0, 3).forEach((ev) => {
      const chip = document.createElement("span");
      chip.className = "evt-chip " + typeClassFor(ev);
      chip.textContent = ev.予定名;
      evWrap.appendChild(chip);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement("span");
      more.className = "day-more";
      more.textContent = `ほか${dayEvents.length - 3}件`;
      evWrap.appendChild(more);
    }
    cell.appendChild(evWrap);

    cell.addEventListener("click", () => selectDate(cellDate, dayEvents));
    monthGrid.appendChild(cell);

    cursor.setDate(cursor.getDate() + 1);
  }
}

function eventsForDate(day) {
  return visibleEvents().filter((event) => event.実施日 === day);
}

function startOfWeek(dateValue) {
  const [y, m, d] = dateValue.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function appendAgenda(container, events, emptyText) {
  container.innerHTML = "";
  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  events.forEach((ev) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "event-row";
    const dot = document.createElement("span");
    dot.className = `dot ${typeClassFor(ev)}`;
    const main = document.createElement("div");
    main.className = "event-main";
    const title = document.createElement("p");
    title.className = "event-title";
    title.textContent = ev.予定名;
    const sub = document.createElement("p");
    sub.className = "event-sub";
    sub.textContent = ev.isOneppo ? "一包化サポート" : buildEventSubText(ev);
    main.append(title, sub);
    row.append(dot, main);
    row.addEventListener("click", () => ev.isOneppo ? location.assign("oneppo.html") : openEventModal(ev, ev.実施日));
    container.appendChild(row);
  });
}

function renderWeekView() {
  const root = document.getElementById("week-view");
  root.innerHTML = "";
  const base = selectedDateStr || todayStr();
  const cursor = startOfWeek(base);
  const strip = document.createElement("div");
  strip.className = "week-strip";
  const agenda = document.createElement("div");
  agenda.className = "agenda-events";
  for (let i = 0; i < 7; i++) {
    const day = dateStr(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    const button = document.createElement("button");
    button.type = "button";
    button.className = `week-day${day === todayStr() ? " today" : ""}${day === base ? " selected" : ""}`;
    button.innerHTML = `<small>${WEEKDAY_JP[cursor.getDay()]}</small><b>${cursor.getDate()}</b>`;
    button.addEventListener("click", () => { selectedDateStr = day; renderWeekView(); });
    strip.appendChild(button);
    cursor.setDate(cursor.getDate() + 1);
  }
  const [y, m, d] = base.split("-").map(Number);
  const heading = document.createElement("h2");
  heading.className = "view-heading";
  heading.textContent = `${m}月${d}日（${WEEKDAY_JP[new Date(y, m - 1, d).getDay()]}）`;
  appendAgenda(agenda, eventsForDate(base), "この日の予定はありません。");
  root.append(strip, heading, agenda);
}

function renderDayView() {
  const root = document.getElementById("single-day-view");
  const day = selectedDateStr || todayStr();
  const [y, m, d] = day.split("-").map(Number);
  root.innerHTML = `<h2 class="view-heading">${y}年${m}月${d}日（${WEEKDAY_JP[new Date(y, m - 1, d).getDay()]}）</h2><div class="agenda-events"></div>`;
  appendAgenda(root.querySelector(".agenda-events"), eventsForDate(day), "この日の予定はありません。");
}

function renderListView() {
  const root = document.getElementById("list-view");
  root.innerHTML = '<h2 class="view-heading">今月の予定一覧</h2><div class="agenda-events"></div>';
  const list = root.querySelector(".agenda-events");
  const events = visibleEvents().filter((event) => {
    const prefix = `${viewYear}-${pad2(viewMonth)}-`;
    return String(event.実施日 || "").startsWith(prefix);
  });
  appendAgenda(list, events, "この月の予定はありません。");
  list.querySelectorAll(".event-row").forEach((row, index) => {
    const ev = events[index];
    const date = document.createElement("time");
    date.className = "agenda-date";
    date.textContent = String(ev.実施日 || "").slice(5).replace("-", "/");
    row.prepend(date);
  });
}

function selectDate(dateStrValue, dayEvents) {
  selectedDateStr = dateStrValue;
  renderGrid();

  dayDetail.hidden = false;
  const [y, m, d] = dateStrValue.split("-").map(Number);
  dayDetailHeading.textContent = `${y}年${m}月${d}日（${WEEKDAY_JP[new Date(y, m - 1, d).getDay()]}）`;
  dayDetailList.innerHTML = "";

  if (!dayEvents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "この日の予定はありません。";
    dayDetailList.appendChild(empty);
    return;
  }

  dayEvents.forEach((ev) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "event-row";
    const dot = document.createElement("span");
    dot.className = "dot " + typeClassFor(ev);
    const main = document.createElement("div");
    main.className = "event-main";
    const title = document.createElement("p");
    title.className = "event-title";
    title.textContent = ev.予定名;
    const sub = document.createElement("p");
    sub.className = "event-sub";
    sub.textContent = ev.isOneppo ? "一包化サポート（一包化管理画面で操作します）" : buildEventSubText(ev);
    main.appendChild(title);
    main.appendChild(sub);
    row.appendChild(dot);
    row.appendChild(main);
    row.addEventListener("click", () => {
      if (ev.isOneppo) { location.href = "oneppo.html"; return; }
      openEventModal(ev, ev.実施日);
    });
    dayDetailList.appendChild(row);
  });
}

function buildEventSubText(ev) {
  const parts = [];
  if (ev.終日) parts.push("終日");
  else if (ev.開始時刻 || ev.終了時刻) parts.push(`${ev.開始時刻 || ""}〜${ev.終了時刻 || ""}`);
  if (ev["場所・機関名"]) parts.push(ev["場所・機関名"]);
  return parts.join(" ・ ");
}

/* ============================================================
 * 予定の追加・編集モーダル
 * ============================================================ */

function updateTimeFieldsVisibility() {
  document.getElementById("event-time-fields").hidden = document.getElementById("event-allday").checked;
}
function updatePrepFieldsVisibility() {
  document.getElementById("event-prep-fields").hidden = !document.getElementById("event-has-prep").checked;
}
function updateRepeatFieldsVisibility() {
  document.getElementById("event-repeat-end-field").hidden = document.getElementById("event-repeat").value === "なし";
}
function updateTypeFieldsVisibility() {
  const type = document.getElementById("event-type").value;
  document.getElementById("event-place-label").textContent = TYPE_LABEL_PLACE[type] || "場所・機関名";
  document.getElementById("event-phone-field").hidden = !(type === "当番医" || type === "当番薬局");
  document.getElementById("event-people-field").hidden = !(type === "勉強会" || type === "その他");
  document.getElementById("event-people-label").textContent = type === "勉強会" ? "参加者" : "関係者";
}

function openEventModal(event, defaultDate) {
  editingEvent = event;
  const modal = document.getElementById("event-modal");
  document.getElementById("event-modal-title").textContent = event ? "予定を編集" : "予定を追加";
  document.getElementById("event-form-status").textContent = "";
  document.getElementById("delete-event-button").hidden = !event;

  document.getElementById("event-type").value = (event && event.予定種別) || "勉強会";
  document.getElementById("event-title").value = (event && event.予定名) || "";
  document.getElementById("event-date").value = (event && event.実施日) || defaultDate || todayStr();
  document.getElementById("event-allday").checked = !!(event && event.終日);
  document.getElementById("event-start-time").value = (event && event.開始時刻) || "";
  document.getElementById("event-end-time").value = (event && event.終了時刻) || "";
  document.getElementById("event-place").value = (event && event["場所・機関名"]) || "";
  document.getElementById("event-phone").value = (event && event.電話番号) || "";
  document.getElementById("event-people").value = (event && event["参加者・関係者"]) || "";
  document.getElementById("event-note").value = (event && event.備考) || "";
  document.getElementById("event-has-prep").checked = !!(event && event.準備期間あり);
  document.getElementById("event-prep-start").value = (event && event.準備開始相対日数 != null) ? Math.abs(event.準備開始相対日数) : 0;
  document.getElementById("event-prep-end").value = (event && event.準備終了相対日数 != null) ? Math.abs(event.準備終了相対日数) : 0;
  document.getElementById("event-repeat").value = (event && event.繰り返し種別) || "なし";
  document.getElementById("event-repeat-end").value = (event && event.繰り返し終了日) || "";

  updateTypeFieldsVisibility();
  updateTimeFieldsVisibility();
  updatePrepFieldsVisibility();
  updateRepeatFieldsVisibility();

  // 通知設定は、既存の予定（ruleIdが確定している）でのみ設定できます。新規作成中はまだ対象がないため案内だけ表示します。
  const notificationSection = document.getElementById("notification-section");
  const notificationHint = document.getElementById("notification-hint");
  if (event && event.ruleId) {
    notificationSection.hidden = false;
    notificationHint.hidden = true;
    document.getElementById("notification-form-status").textContent = "";
    loadNotificationsForEvent(event.ruleId);
  } else {
    notificationSection.hidden = true;
    notificationHint.hidden = false;
  }

  modal.hidden = false;
}

/** 予定に紐づく通知設定を読み込んで一覧表示します。 */
async function loadNotificationsForEvent(ruleId) {
  const listEl = document.getElementById("notification-list-in-modal");
  listEl.textContent = "読み込み中…";
  try {
    const result = await authFetch("getCalendarNotificationsForEvent", { ruleId });
    if (!result.success) { listEl.textContent = ""; return; }
    renderNotificationList(result.notifications || []);
  } catch (e) {
    console.error(e);
    listEl.textContent = "";
  }
}

function renderNotificationList(notifications) {
  const listEl = document.getElementById("notification-list-in-modal");
  listEl.innerHTML = "";
  if (!notifications.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.style.margin = "0 0 10px";
    p.textContent = "この予定にはまだ通知が設定されていません。";
    listEl.appendChild(p);
    return;
  }
  notifications.forEach((n) => {
    const row = document.createElement("div");
    row.className = "notify-row";
    const text = document.createElement("span");
    text.className = "notify-row-text";
    const timingText = n["通知タイミング種別"] === "任意日数前" ? `${n["任意日数"]}日前` : n["通知タイミング種別"];
    const targetText = n["通知対象種別"] === "指定参加者" ? "（指定参加者）" : "（全員）";
    text.textContent = `${timingText} ${targetText}`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "notify-row-remove";
    removeBtn.textContent = "削除";
    removeBtn.addEventListener("click", () => handleRemoveNotification(n.id, editingEvent && editingEvent.ruleId));
    row.appendChild(text);
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  });
}

async function handleAddNotification() {
  const statusEl = document.getElementById("notification-form-status");
  if (!editingEvent || !editingEvent.ruleId) { statusEl.textContent = "先に予定を保存してください。"; return; }

  const timingType = document.getElementById("notify-timing").value;
  const customDays = document.getElementById("notify-custom-days").value;
  const targetType = document.getElementById("notify-target-type").value;
  const targetEmails = document.getElementById("notify-target-emails").value.trim();

  if (targetType === "指定参加者" && !targetEmails) { statusEl.textContent = "対象者のメールアドレスを入力してください。"; return; }

  statusEl.textContent = "追加しています…";
  try {
    const result = await authFetch("saveCalendarNotification", {
      ruleId: editingEvent.ruleId,
      eventTitle: document.getElementById("event-title").value.trim(),
      timingType,
      customDays: timingType === "任意日数前" ? Number(customDays) : undefined,
      targetType,
      targetEmails: targetType === "指定参加者" ? targetEmails : ""
    });
    if (!result.success) { statusEl.textContent = result.message || "追加に失敗しました。"; return; }
    statusEl.textContent = "";
    document.getElementById("notify-custom-days").value = "";
    document.getElementById("notify-target-emails").value = "";
    await loadNotificationsForEvent(editingEvent.ruleId);
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}

async function handleRemoveNotification(id, ruleId) {
  if (!confirm("この通知設定を削除します。よろしいですか？")) return;
  try {
    const result = await authFetch("deleteCalendarNotification", { id });
    if (!result.success) { alert(result.message || "削除に失敗しました。"); return; }
    if (ruleId) await loadNotificationsForEvent(ruleId);
  } catch (e) {
    console.error(e);
    alert("通信エラーが発生しました。");
  }
}

/** 準備開始・終了の相対日数から、単発予定用の絶対日付も一緒に計算します。 */
function computeAbsoluteDate(baseDateStr, daysBefore) {
  const [y, m, d] = baseDateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - Number(daysBefore || 0));
  return dateStr(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function collectEventFormData() {
  const date = document.getElementById("event-date").value;
  const allDay = document.getElementById("event-allday").checked;
  const hasPrep = document.getElementById("event-has-prep").checked;
  const prepStartDays = Number(document.getElementById("event-prep-start").value || 0);
  const prepEndDays = Number(document.getElementById("event-prep-end").value || 0);

  return {
    "予定名": document.getElementById("event-title").value.trim(),
    "予定種別": document.getElementById("event-type").value,
    "実施日": date,
    "終日": allDay,
    "開始時刻": allDay ? "" : document.getElementById("event-start-time").value,
    "終了時刻": allDay ? "" : document.getElementById("event-end-time").value,
    "場所・機関名": document.getElementById("event-place").value.trim(),
    "電話番号": document.getElementById("event-phone").value.trim(),
    "参加者・関係者": document.getElementById("event-people").value.trim(),
    "備考": document.getElementById("event-note").value.trim(),
    "準備期間あり": hasPrep,
    "準備開始日": hasPrep ? computeAbsoluteDate(date, prepStartDays) : "",
    "準備終了日": hasPrep ? computeAbsoluteDate(date, prepEndDays) : "",
    "準備開始相対日数": hasPrep ? -Math.abs(prepStartDays) : 0,
    "準備終了相対日数": hasPrep ? -Math.abs(prepEndDays) : 0,
    "繰り返し種別": document.getElementById("event-repeat").value,
    "繰り返し終了日": document.getElementById("event-repeat-end").value
  };
}

function askEditScope() {
  return new Promise((resolve) => {
    const modal = document.getElementById("scope-modal");
    modal.hidden = false;
    const buttons = modal.querySelectorAll("[data-scope]");
    const cleanup = () => {
      buttons.forEach((b) => b.replaceWith(b.cloneNode(true)));
      modal.hidden = true;
    };
    modal.querySelectorAll("[data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const scope = btn.dataset.scope;
        cleanup();
        resolve(scope);
      }, { once: true });
    });
    modal.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => { cleanup(); resolve(null); }, { once: true });
    });
  });
}

async function handleSaveEvent() {
  const statusEl = document.getElementById("event-form-status");
  const ev = collectEventFormData();
  if (!ev["予定名"]) { statusEl.textContent = "予定名を入力してください。"; return; }
  if (!ev["実施日"]) { statusEl.textContent = "実施日を入力してください。"; return; }

  const payload = { event: ev };
  if (editingEvent) {
    payload.id = editingEvent.ruleId;
    const isRecurring = (editingEvent.繰り返し種別 || "なし") !== "なし";
    if (isRecurring) {
      const scope = await askEditScope();
      if (!scope) return;
      payload.editScope = scope;
      if (scope !== "all") payload.targetDate = editingEvent.実施日;
    } else {
      payload.editScope = "all";
    }
  }

  statusEl.textContent = "保存しています…";
  try {
    const result = await authFetch("saveCalendarEvent", payload);
    if (!result.success) { statusEl.textContent = result.message || "保存に失敗しました。"; return; }
    document.getElementById("event-modal").hidden = true;
    await loadMonth();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}

async function handleDeleteEvent() {
  if (!editingEvent) return;
  const statusEl = document.getElementById("event-form-status");
  const payload = { id: editingEvent.ruleId };

  const isRecurring = (editingEvent.繰り返し種別 || "なし") !== "なし";
  if (isRecurring) {
    const scope = await askEditScope();
    if (!scope) return;
    payload.editScope = scope;
    if (scope !== "all") payload.targetDate = editingEvent.実施日;
  } else {
    if (!confirm("この予定を削除します。よろしいですか？")) return;
    payload.editScope = "all";
  }

  statusEl.textContent = "削除しています…";
  try {
    const result = await authFetch("deleteCalendarEvent", payload);
    if (!result.success) { statusEl.textContent = result.message || "削除に失敗しました。"; return; }
    document.getElementById("event-modal").hidden = true;
    await loadMonth();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "通信エラーが発生しました。";
  }
}
