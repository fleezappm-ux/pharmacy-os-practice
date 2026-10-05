"use strict";

const GAS_ENDPOINT = PHARMACY_CONFIG.GAS_URL;
document.title=`Pharmacy OS | ${PHARMACY_CONFIG.PHARMACY_NAME}`;
document.addEventListener("DOMContentLoaded",()=>{
  ["pharmacy-name-heading", "side-pharmacy-name"].forEach((id)=>{
    const element=document.getElementById(id);
    if(element) element.textContent=PHARMACY_CONFIG.PHARMACY_NAME;
  });
});

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const DEFAULT_HOURS = {
  0: "休局",
  1: "8:45\n18:00",
  2: "8:45\n18:00",
  3: "8:45\n18:00",
  4: "8:30\n16:30",
  5: "8:45\n18:00",
  6: "8:30\n13:00",
};

const todayLabel = document.querySelector("#today-label");
const weekCalendar = document.querySelector("#week-calendar");
const handoverList = document.querySelector("#handover-list");
const averageLabel = document.querySelector("#average-label");
const averageValue = document.querySelector("#average-value");
const averageNote = document.querySelector("#average-note");
const genericRateValue = document.querySelector("#generic-rate-value");
const genericRateLabel = document.querySelector("#generic-rate-label");
const genericRateUnit = document.querySelector("#generic-rate-unit");
const genericRateNote = document.querySelector("#generic-rate-note");
const monthlyHeading = document.querySelector("#monthly-heading");
const concentrationLabel = document.querySelector("#concentration-label");
const concentrationList = document.querySelector("#concentration-list");
const homeStatus = document.querySelector("#home-status");
const notificationPanel = document.querySelector("#notification-panel");
const notificationList = document.querySelector("#notification-list");
const refreshButton = document.querySelector("#refresh-button");
const mobileRefreshButton = document.querySelector("#mobile-refresh-button");
const toast = document.querySelector("#toast");

function formatJapaneseDate(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function isSameDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function renderWeekCalendar() {
  const today = new Date();
  const mondayOffset = today.getDay() === 0 ? -6 : 1 - today.getDay();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);

  weekCalendar.replaceChildren();

  for (let index = 0; index < 7; index += 1) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const dayOfWeek = date.getDay();
    const card = document.createElement("div");
    card.className = "day-card";
    if (isSameDate(date, today)) card.classList.add("today");
    if (dayOfWeek === 0) card.classList.add("closed");

    const weekday = document.createElement("span");
    weekday.className = "weekday";
    weekday.textContent = WEEKDAY_LABELS[dayOfWeek];

    const day = document.createElement("span");
    day.className = "date";
    day.textContent = date.getDate();

    const hours = document.createElement("span");
    hours.className = "hours";
    hours.textContent = DEFAULT_HOURS[dayOfWeek];

    card.append(weekday, day, hours);
    weekCalendar.append(card);
  }
}

function formatShortDate(dateString) {
  if (!dateString) return "日付なし";
  const [year, month, day] = dateString.split("-").map(Number);
  return `${month}月${day}日`;
}

function renderHandovers(handovers) {
  handoverList.replaceChildren();

  if (!handovers.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact";
    empty.innerHTML = "<span aria-hidden=\"true\">✅</span><p>現在、申し送りはありません。</p>";
    handoverList.append(empty);
    return;
  }

  handovers.forEach((handover) => {
    const item = document.createElement("article");
    item.className = "handover-item";

    const date = document.createElement("p");
    date.className = "handover-date";
    date.textContent = formatShortDate(handover.date);

    const text = document.createElement("p");
    text.className = "handover-text";
    text.textContent = handover.text;

    item.append(date, text);
    handoverList.append(item);
  });
}

function renderNotifications(notifications) {
  if (!notifications.length) {
    notificationPanel.hidden = true;
    notificationList.replaceChildren();
    return;
  }

  notificationPanel.hidden = false;
  notificationList.replaceChildren();

  notifications.forEach((notice) => {
    const item = document.createElement("article");
    item.className = "handover-item";

    const date = document.createElement("p");
    date.className = "handover-date";
    date.textContent = notice.通知タイミング種別 || "";

    const text = document.createElement("p");
    text.className = "handover-text";
    text.textContent = `${notice.予定名}（${formatShortDate(notice.実施日)}）`;

    item.append(date, text);
    notificationList.append(item);
  });
}

async function loadCalendarNotifications(forceRefresh) {
  try {
    const result = await authFetch("getTodayNotifications", forceRefresh === true ? { refresh: true } : undefined);
    if (!result.success) throw new Error(result.message || "取得に失敗しました。");
    renderNotifications(result.notifications || []);
  } catch (error) {
    console.error("Notification error:", error);
    // 通知の取得に失敗しても、他のホーム画面表示には影響させません（パネルを隠すだけにします）。
    notificationPanel.hidden = true;
  }
}

function renderHomeData(data) {
  averageLabel.textContent = "1日平均処方箋枚数";
  averageValue.textContent = data.previousMonthAverage ?? "―";
  averageNote.textContent = data.previousMonthAverageSource === "survey"
    ? `${data.previousMonthLabel}・処方箋調べより`
    : data.previousMonthRecordedDays
    ? `${data.previousMonthLabel}・${data.previousMonthRecordedDays}日分から算出`
    : `${data.previousMonthLabel}・記録なし`;
  const summaryMonthLabel = data.previousMonthLabel || "前月";
  const hasGeneric = data.genericRate !== null && data.genericRate !== undefined;
  monthlyHeading.textContent = `${data.currentMonthLabel || "今月"}の状況`;
  genericRateValue.textContent = hasGeneric ? data.genericRate : "未入力";
  genericRateUnit.hidden = !hasGeneric;
  genericRateLabel.textContent = "後発品使用率";
  genericRateNote.textContent = `${summaryMonthLabel}の実績`;
  renderConcentration(data.concentrationTop4 || [], summaryMonthLabel);
  renderHandovers(data.handovers || []);
}

async function loadHomeData(forceRefresh) {
  refreshButton.disabled = true;
  refreshButton.textContent = "…";
  homeStatus.textContent = "";
  let shownFromCache = false;

  try {
    // 前回の結果があれば先に表示し、そのあと最新に差し替えます。
    let data;
    if (forceRefresh === true) {
      // 更新ボタンのときは、サーバーの控えを使わず最新を取得します。
      data = await authFetch("home", { refresh: true });
      if (data && data.success) writeViewCache("home", undefined, data);
    } else {
      data = await authFetchWithCache("home", undefined, (cached) => {
        renderHomeData(cached);
        shownFromCache = true;
      });
    }
    if (!data.success) throw new Error(data.message || "取得に失敗しました。");
    renderHomeData(data);
  } catch (error) {
    console.error("Home data error:", error);
    if (shownFromCache) {
      homeStatus.textContent = "最新情報を取得できませんでした。前回の内容を表示しています。";
    } else {
      homeStatus.textContent = `最新情報を取得できませんでした：${error.message}`;
      renderHandovers([]);
    }
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "↻";
  }
}

function renderConcentration(entries, monthLabel) {
  concentrationLabel.textContent = monthLabel && monthLabel !== "未設定"
    ? `${monthLabel} 処方箋集中率 上位4医療機関`
    : "処方箋集中率 上位4医療機関";
  concentrationList.replaceChildren();
  if (!entries.length) {
    const item = document.createElement("li");
    item.textContent = "未入力";
    concentrationList.append(item);
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.append(document.createTextNode(entry.medicalInstitution));
    const percentage = document.createElement("span");
    percentage.textContent = `${entry.percentage}%`;
    item.append(percentage);
    concentrationList.append(item);
  });
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

document.querySelectorAll("[data-pending]").forEach((element) => {
  element.addEventListener("click", (event) => {
    event.preventDefault();
    showToast("この機能は準備中です。");
  });
});

const reminderModal = document.querySelector("#reminder-modal");
const reminderClose = document.querySelector("#reminder-close");
const reminderSnooze = document.querySelector("#reminder-snooze");
const reminderSummary = document.querySelector("#reminder-summary");
const reminderList = document.querySelector("#reminder-list");
const REMINDER_SNOOZE_KEY = "pharmacy-os-reminder-snoozed";

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function closeReminder() {
  reminderModal.hidden = true;
}

function renderReminderStatus(data) {
  if (localStorage.getItem(REMINDER_SNOOZE_KEY) === localDateKey()) return;

  const missing = [];
  (data.dailyMissingDates || []).forEach((dateStr) => {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    const weekday = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
    missing.push({ label: `${y}年${m}月${d}日(${weekday}) の日次業務`, href: `index.html?date=${encodeURIComponent(dateStr)}` });
  });
  (data.monthlyMissing || []).forEach((item) => {
    missing.push({
      label: `${data.previousMonthLabel || "前月"} ${item.label}`,
      href: item.href,
    });
  });

  if (!missing.length) {
    closeReminder();
    return;
  }

  reminderSummary.textContent = `${missing.length}件の入力を確認してください。`;
  reminderList.replaceChildren();
  missing.forEach((item) => {
    const link = document.createElement("a");
    link.className = "reminder-link";
    link.href = item.href;
    link.textContent = item.label;
    reminderList.append(link);
  });
  reminderModal.hidden = false;
}

async function loadReminderStatus(forceRefresh) {
  try {
    const data = await authFetch("reminders", forceRefresh === true ? { refresh: true } : undefined);
    if (!data.success) throw new Error(data.message || "未入力確認に失敗しました。");
    renderReminderStatus(data);
  } catch (error) {
    console.error("Reminder status error:", error);
  }
}

async function refreshHome(forceRefresh) {
  await Promise.all([loadHomeData(forceRefresh === true), loadReminderStatus(forceRefresh === true), loadCalendarNotifications(forceRefresh === true)]);
}

reminderClose.addEventListener("click", closeReminder);
reminderSnooze.addEventListener("click", () => {
  localStorage.setItem(REMINDER_SNOOZE_KEY, localDateKey());
  closeReminder();
});
reminderModal.addEventListener("click", (event) => {
  if (event.target === reminderModal) closeReminder();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !reminderModal.hidden) closeReminder();
});

todayLabel.textContent = formatJapaneseDate(new Date());
renderWeekCalendar();
refreshButton.addEventListener("click", () => refreshHome(true));
if (mobileRefreshButton) mobileRefreshButton.addEventListener("click", () => refreshHome(true));
requireAuth(() => refreshHome());
