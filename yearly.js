"use strict";

const OVERVIEW_CATEGORIES = [
  { key: "insurance", label: "保険調剤実績" },
  { key: "generic", label: "後発品調剤率" },
  { key: "concentration", label: "処方箋集中率" },
  { key: "homecare", label: "在宅患者管理" },
  { key: "survey", label: "1日平均処方箋枚数" }
];

const loading = document.getElementById("yearly-loading");
const latestGrid = document.getElementById("latest-grid");
const monthlyList = document.getElementById("monthly-list");
const yearSelect = document.getElementById("fiscal-year-select");
const yearRange = document.getElementById("year-range");
let monthsData = [];
let selectedFiscalYear = "";

const hasValue = (value) => value !== null && value !== undefined && value !== "";
const numberValue = (value) => hasValue(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const formatNumber = (value, suffix = "") => {
  const number = numberValue(value);
  return number === null ? "―" : `${number.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${suffix}`;
};
const normalizeLabel = (value) => String(value || "").replace(/[\s　]/g, "");
const isTotalRow = (row) => normalizeLabel(row?.["区分"]) === "総合計";

function fiscalYearOf(key) {
  const [year, month] = key.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

function currentFiscalYear() {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function rowsFor(month, key) {
  const value = month[key];
  if (key === "generic" || key === "survey") return value ? [value] : [];
  return Array.isArray(value) ? value : [];
}

function hasCategoryData(month, key) {
  return rowsFor(month, key).length > 0;
}

function sumField(rows, field) {
  return rows.filter((row) => !isTotalRow(row)).reduce((sum, row) => sum + (numberValue(row[field]) || 0), 0);
}

function insuranceTotal(rows, field) {
  const totalValue = numberValue(rows.find(isTotalRow)?.[field]);
  return totalValue === null ? sumField(rows, field) : totalValue;
}

function topConcentrationRow(month) {
  return [...(month.concentration || [])].sort((a, b) =>
    (numberValue(b["全体割合"]) || 0) - (numberValue(a["全体割合"]) || 0)
  )[0];
}

function categoryValue(month, key) {
  if (!hasCategoryData(month, key)) return "未入力";
  if (key === "generic") return formatNumber(month.generic["新指標割合"], "%");
  if (key === "survey") return formatNumber(month.survey["1日平均取扱処方箋枚数"], "枚/日");
  if (key === "insurance") return `総合計 ${formatNumber(insuranceTotal(month.insurance, "件数（件）"), "件")}`;
  if (key === "homecare") {
    const cases = month.homecare.reduce((sum, row) => sum + (numberValue(row["件数（件）"]) || 0), 0);
    const visits = month.homecare.reduce((sum, row) => sum + (numberValue(row["回数（回）"]) || 0), 0);
    return `${formatNumber(cases, "件")}・${formatNumber(visits, "回")}`;
  }
  const top = topConcentrationRow(month);
  return formatNumber(top?.["全体割合"], "%");
}

function categoryNote(month, key) {
  if (!hasCategoryData(month, key)) return "";
  if (key === "concentration") {
    return topConcentrationRow(month)?.["医療機関名"] || "医療機関名未設定";
  }
  if (key === "insurance") {
    const medical = insuranceTotal(month.insurance, "処方箋回数_医科");
    const dental = insuranceTotal(month.insurance, "処方箋回数_歯科");
    const points = insuranceTotal(month.insurance, "調剤報酬点数_合計");
    const parts = [];
    if (numberValue(medical) !== null) parts.push(`医科 ${formatNumber(medical, "回")}`);
    if (numberValue(dental) !== null) parts.push(`歯科 ${formatNumber(dental, "回")}`);
    if (numberValue(points) !== null) parts.push(`点数 ${formatNumber(points, "点")}`);
    return parts.join(" ・ ");
  }
  if (key === "survey") return "営業日から算出";
  return "";
}

function monthlyCategoryValue(month, key) {
  if (key !== "concentration") return categoryValue(month, key);
  const top = topConcentrationRow(month);
  return `${top?.["医療機関名"] || "名称未設定"} ${formatNumber(top?.["全体割合"], "%")}`;
}

function renderLatestCards() {
  latestGrid.textContent = "";
  OVERVIEW_CATEGORIES.forEach((category) => {
    const latest = monthsData.find((month) => hasCategoryData(month, category.key));
    const card = document.createElement("a");
    card.className = `latest-card latest-card-${category.key}${latest ? "" : " empty"}`;
    card.href = `yearly-detail.html?category=${category.key}${latest ? `&fy=${fiscalYearOf(latest.key)}` : ""}`;
    const top = document.createElement("div");
    top.className = "latest-card-top";
    const title = document.createElement("span");
    title.className = "latest-card-title";
    title.textContent = category.label;
    const arrow = document.createElement("span");
    arrow.className = "latest-arrow";
    arrow.textContent = "›";
    top.append(title, arrow);
    const value = document.createElement("strong");
    value.className = "latest-value";
    value.textContent = latest ? categoryValue(latest, category.key) : "未入力";
    const note = document.createElement("span");
    note.className = "latest-note";
    note.textContent = latest ? categoryNote(latest, category.key) : "";
    const date = document.createElement("span");
    date.className = "latest-date";
    date.textContent = latest ? `最新更新：${latest.label}` : "入力データなし";
    card.append(top, value);
    if (note.textContent) card.append(note);
    card.append(date);
    latestGrid.appendChild(card);
  });
}

function renderYearOptions() {
  const years = [...new Set(monthsData.map((month) => fiscalYearOf(month.key)))].sort((a, b) => b - a);
  const params = new URLSearchParams(location.search);
  const requested = Number(params.get("fy"));
  const kept = years.includes(Number(selectedFiscalYear)) ? Number(selectedFiscalYear) : null;
  const preferred = kept !== null ? kept : (years.includes(requested) ? requested : (years.includes(currentFiscalYear()) ? currentFiscalYear() : years[0]));
  selectedFiscalYear = String(preferred || "");
  yearSelect.textContent = "";
  years.forEach((year) => yearSelect.add(new Option(`${year}年度`, String(year), false, String(year) === selectedFiscalYear)));
  updateYearRange();
}

function updateYearRange() {
  if (!selectedFiscalYear) return;
  yearRange.textContent = `${selectedFiscalYear}年4月 — ${Number(selectedFiscalYear) + 1}年3月`;
}

function renderMonthlyList() {
  monthlyList.textContent = "";
  const months = monthsData.filter((month) => fiscalYearOf(month.key) === Number(selectedFiscalYear));
  if (!months.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "この年度は取得範囲にありません。";
    monthlyList.appendChild(empty);
    return;
  }

  months.forEach((month) => {
    const completed = OVERVIEW_CATEGORIES.filter((category) => hasCategoryData(month, category.key)).length;
    const card = document.createElement("article");
    card.className = "process-card";
    const head = document.createElement("div");
    head.className = "process-head";
    const title = document.createElement("span");
    title.className = "process-month";
    title.textContent = month.label;
    const count = document.createElement("span");
    count.className = `process-count${completed === OVERVIEW_CATEGORIES.length ? "" : " partial"}`;
    count.textContent = `${completed} / ${OVERVIEW_CATEGORIES.length} 入力`;
    head.append(title, count);
    const grid = document.createElement("div");
    grid.className = "process-grid";
    OVERVIEW_CATEGORIES.forEach((category) => {
      const filled = hasCategoryData(month, category.key);
      const item = document.createElement("div");
      item.className = `process-item${filled ? "" : " empty"}`;
      const label = document.createElement("span");
      label.className = "process-label";
      label.textContent = category.label;
      const value = document.createElement("span");
      value.className = "process-value";
      value.textContent = filled ? monthlyCategoryValue(month, category.key) : "未入力";
      item.append(label, value);
      grid.appendChild(item);
    });
    card.append(head, grid);
    monthlyList.appendChild(card);
  });
}

function applyOverview(result) {
  monthsData = result.months || [];
  renderLatestCards();
  renderYearOptions();
  renderMonthlyList();
}

// 一覧画面は、サーバーの「月計表」（月ごとの代表値だけ）を読みます。元のデータは変更しません。
// forceRefresh が true のとき（更新ボタン）は、月計表をNotionから作り直してもらいます。
async function loadOverview(forceRefresh) {
  loading.className = "loading-message";
  loading.textContent = "データを読み込んでいます…";
  let shownFromCache = false;
  try {
    let result;
    if (forceRefresh === true) {
      loading.textContent = "最新の内容に更新しています…";
      shownFromCache = monthsData.length > 0;
      result = await authFetch("yearlySummary", { refresh: true });
      if (result && result.success) writeViewCache("yearlySummary", undefined, result);
    } else {
      // 前回の結果があれば先に表示し、そのあと最新に差し替えます。
      result = await authFetchWithCache("yearlySummary", undefined, (cached) => {
        applyOverview(cached);
        shownFromCache = true;
        loading.textContent = "最新の内容に更新しています…";
      });
    }
    if (!result.success) throw new Error(result.message || "読み込みに失敗しました。");
    applyOverview(result);
    loading.textContent = "";
  } catch (error) {
    console.error(error);
    if (shownFromCache) {
      loading.className = "loading-message";
      loading.textContent = "最新の内容を取得できませんでした。前回の内容を表示しています。";
      return;
    }
    loading.className = "loading-message error";
    loading.textContent = "現在、データを読み込めません。時間をおいて更新してください。";
  }
}

yearSelect.addEventListener("change", () => { selectedFiscalYear = yearSelect.value; updateYearRange(); renderMonthlyList(); });
document.getElementById("reload-button").addEventListener("click", () => loadOverview(true));
requireAuth(loadOverview);
