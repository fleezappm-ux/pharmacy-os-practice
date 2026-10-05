"use strict";

const CATEGORIES = [
  { key: "generic", label: "後発品調剤率", kicker: "GENERIC RATE" },
  { key: "concentration", label: "処方箋集中率", kicker: "CONCENTRATION" },
  { key: "insurance", label: "保険調剤実績", kicker: "INSURANCE" },
  { key: "homecare", label: "在宅患者管理", kicker: "HOMECARE" },
  { key: "survey", label: "処方箋調べ", kicker: "PRESCRIPTION SURVEY" }
];

const INSURANCE_ORDER = ["医保", "国保", "後期高齢", "公費（単・複）", "労災", "総合計"];
const els = {
  loading: document.getElementById("yearly-loading"),
  yearSelect: document.getElementById("fiscal-year-select"),
  yearRange: document.getElementById("year-range"),
  tabs: document.getElementById("category-tabs"),
  kicker: document.getElementById("category-kicker"),
  title: document.getElementById("category-title"),
  completion: document.getElementById("completion-badge"),
  latestValue: document.getElementById("latest-value"),
  latestMonth: document.getElementById("latest-month"),
  filledCount: document.getElementById("filled-count"),
  monthCountLabel: document.getElementById("month-count-label"),
  monthList: document.getElementById("month-list")
};

let monthsData = [];
let availableYears = [];
let loadSeq = 0;
let selectedFiscalYear = "";
const initialParams = new URLSearchParams(location.search);
const requestedCategory = initialParams.get("category");
const requestedFiscalYear = Number(initialParams.get("fy"));
let activeCategory = CATEGORIES.some((item) => item.key === requestedCategory) ? requestedCategory : "generic";

const hasValue = (value) => value !== null && value !== undefined && value !== "";
const numberValue = (value) => hasValue(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const formatNumber = (value, suffix = "") => {
  const n = numberValue(value);
  return n === null ? "―" : `${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${suffix}`;
};
const normalizeLabel = (value) => String(value || "").replace(/[\s　]/g, "");
const isTotalRow = (row) => normalizeLabel(row?.["区分"]) === "総合計";

function fiscalYearOf(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

function currentFiscalYear() {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

function monthsForSelectedYear() {
  return monthsData.filter((month) => fiscalYearOf(month.key) === Number(selectedFiscalYear));
}

function rowsFor(month, key) {
  const value = month[key];
  if (key === "generic" || key === "survey") return value ? [value] : [];
  return Array.isArray(value) ? value : [];
}

function monthHasData(month, key = activeCategory) {
  return rowsFor(month, key).length > 0;
}

function sumField(rows, field, excludeTotal = true) {
  return rows
    .filter((row) => !excludeTotal || !isTotalRow(row))
    .reduce((sum, row) => sum + (numberValue(row[field]) || 0), 0);
}

function insuranceTotals(rows) {
  const total = rows.find(isTotalRow);
  const pick = (field) => {
    const totalValue = numberValue(total?.[field]);
    return totalValue === null ? sumField(rows, field) : totalValue;
  };
  return {
    cases: pick("件数（件）"),
    medical: pick("処方箋回数_医科"),
    dental: pick("処方箋回数_歯科"),
    prescriptions: pick("処方箋回数_合計"),
    points: pick("調剤報酬点数_合計")
  };
}

function homecareTotals(rows) {
  return { cases: sumField(rows, "件数（件）", false), visits: sumField(rows, "回数（回）", false) };
}

function primaryValue(month, key = activeCategory) {
  if (!monthHasData(month, key)) return "未入力";
  if (key === "generic") return formatNumber(month.generic["新指標割合"], "%");
  if (key === "survey") return formatNumber(month.survey["1日平均取扱処方箋枚数"], "枚/日");
  if (key === "concentration") {
    const top = [...month.concentration].sort((a, b) => (numberValue(b["全体割合"]) || 0) - (numberValue(a["全体割合"]) || 0))[0];
    return `${top?.["医療機関名"] || "名称未設定"} ${formatNumber(top?.["全体割合"], "%")}`;
  }
  if (key === "insurance") return `処方箋受付回数 ${formatNumber(insuranceTotals(month.insurance).prescriptions, "回")}`;
  const totals = homecareTotals(month.homecare);
  return `${formatNumber(totals.cases, "件")}・${formatNumber(totals.visits, "回")}`;
}

// 表示する年度を決めます。選択中の年度があればそれ、なければURL指定、当年度、先頭の順です。
function pickFiscalYear(years) {
  const selected = Number(selectedFiscalYear);
  if (selectedFiscalYear && years.includes(selected)) return selected;
  if (years.includes(requestedFiscalYear)) return requestedFiscalYear;
  if (years.includes(currentFiscalYear())) return currentFiscalYear();
  return years[0];
}

function renderYearOptions() {
  const years = availableYears;
  const preferred = pickFiscalYear(years);
  selectedFiscalYear = String(preferred || "");
  els.yearSelect.textContent = "";
  years.forEach((year) => {
    const option = new Option(`${year}年度`, String(year), false, String(year) === selectedFiscalYear);
    els.yearSelect.add(option);
  });
  updateYearRange();
}

function updateYearRange() {
  if (!selectedFiscalYear) return;
  els.yearRange.textContent = `${selectedFiscalYear}年4月 — ${Number(selectedFiscalYear) + 1}年3月`;
}

function renderTabs() {
  els.tabs.textContent = "";
  CATEGORIES.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-tab${category.key === activeCategory ? " active" : ""}`;
    button.textContent = category.label;
    button.setAttribute("aria-pressed", String(category.key === activeCategory));
    button.addEventListener("click", () => {
      if (activeCategory === category.key) return;
      activeCategory = category.key;
      monthsData = [];
      els.monthList.textContent = "";
      renderTabs();
      loadYearlyData();
    });
    els.tabs.appendChild(button);
  });
}

function renderOverview(months) {
  const category = CATEGORIES.find((item) => item.key === activeCategory);
  const filled = months.filter((month) => monthHasData(month));
  const latest = filled[0];
  els.kicker.textContent = category.kicker;
  els.title.textContent = category.label;
  els.filledCount.textContent = `${filled.length} / ${months.length}`;
  els.monthCountLabel.textContent = months.length === 12 ? "年度内の入力状況" : "取得範囲内の入力状況";
  els.latestValue.textContent = latest ? primaryValue(latest) : "未入力";
  els.latestMonth.textContent = latest ? latest.label : "入力済みの月はありません";
  els.completion.textContent = filled.length === months.length && months.length ? "すべて入力済み" : `${months.length - filled.length}か月 未入力`;
  els.completion.classList.toggle("partial", filled.length !== months.length);
}

function addMetric(container, label, value) {
  const box = document.createElement("div");
  box.className = "metric";
  const caption = document.createElement("span");
  caption.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  box.append(caption, strong);
  container.appendChild(box);
}

function addRecordRow(container, titleText, values, total = false) {
  const row = document.createElement("div");
  row.className = `record-row${total ? " total" : ""}`;
  const title = document.createElement("div");
  title.className = "record-title";
  title.textContent = titleText || "名称未設定";
  const valueWrap = document.createElement("div");
  valueWrap.className = "record-values";
  values.filter((item) => item.value !== "―").forEach((item) => {
    const span = document.createElement("span");
    span.append(`${item.label} `);
    const bold = document.createElement("b");
    bold.textContent = item.value;
    span.appendChild(bold);
    valueWrap.appendChild(span);
  });
  if (!valueWrap.childNodes.length) valueWrap.textContent = "数値なし";
  row.append(title, valueWrap);
  container.appendChild(row);
}

function sortInsuranceRows(rows) {
  return [...rows].sort((a, b) => {
    const aName = normalizeLabel(a["区分"]);
    const bName = normalizeLabel(b["区分"]);
    const aKnown = INSURANCE_ORDER.indexOf(aName);
    const bKnown = INSURANCE_ORDER.indexOf(bName);
    if (aKnown >= 0 || bKnown >= 0) return (aKnown < 0 ? 999 : aKnown) - (bKnown < 0 ? 999 : bKnown);
    const aOrder = numberValue(a["並び順"]);
    const bOrder = numberValue(b["並び順"]);
    if (aOrder !== null || bOrder !== null) return (aOrder ?? 999) - (bOrder ?? 999);
    return aName.localeCompare(bName, "ja");
  });
}

function renderDetail(month, container) {
  if (!monthHasData(month)) {
    const empty = document.createElement("p");
    empty.className = "empty-detail";
    empty.textContent = "この月はまだ入力されていません。";
    container.appendChild(empty);
    return;
  }

  const metrics = document.createElement("div");
  metrics.className = "detail-lead";
  const records = document.createElement("div");
  records.className = "record-list";

  if (activeCategory === "generic") {
    const row = month.generic;
    addMetric(metrics, "新指標割合", formatNumber(row["新指標割合"], "%"));
    addMetric(metrics, "カットオフ値割合", formatNumber(row["カットオフ値割合"], "%"));
    addRecordRow(records, "数量内訳", [
      { label: "全医薬品", value: formatNumber(row["全医薬品規格単位数量"]) },
      { label: "後発品あり", value: formatNumber(row["後発品あり規格単位数量"]) },
      { label: "後発医薬品", value: formatNumber(row["後発医薬品規格単位数量"]) }
    ]);
  } else if (activeCategory === "concentration") {
    const sorted = [...month.concentration].sort((a, b) => (numberValue(b["全体割合"]) || 0) - (numberValue(a["全体割合"]) || 0));
    addMetric(metrics, "最も高い医療機関", sorted[0]?.["医療機関名"] || "―");
    addMetric(metrics, "最高集中率", formatNumber(sorted[0]?.["全体割合"], "%"));
    sorted.forEach((row) => addRecordRow(records, row["医療機関名"], [
      { label: "受付", value: formatNumber(row["受付回数"], "回") },
      { label: "集中率", value: formatNumber(row["全体割合"], "%") }
    ]));
  } else if (activeCategory === "insurance") {
    const totals = insuranceTotals(month.insurance);
    addMetric(metrics, "総合計", formatNumber(totals.cases, "件"));
    addMetric(metrics, "処方箋受付", formatNumber(totals.prescriptions, "回"));
    addMetric(metrics, "調剤報酬", formatNumber(totals.points, "点"));
    sortInsuranceRows(month.insurance).forEach((row) => addRecordRow(records, row["区分"], [
      { label: "件数", value: formatNumber(row["件数（件）"], "件") },
      { label: "医科", value: formatNumber(row["処方箋回数_医科"], "回") },
      { label: "歯科", value: formatNumber(row["処方箋回数_歯科"], "回") },
      { label: "受付計", value: formatNumber(row["処方箋回数_合計"], "回") },
      { label: "点数", value: formatNumber(row["調剤報酬点数_合計"], "点") }
    ], isTotalRow(row)));
  } else if (activeCategory === "homecare") {
    const totals = homecareTotals(month.homecare);
    addMetric(metrics, "患者件数", formatNumber(totals.cases, "件"));
    addMetric(metrics, "訪問回数", formatNumber(totals.visits, "回"));
    [...month.homecare].sort((a, b) => (numberValue(a["並び順"]) ?? 999) - (numberValue(b["並び順"]) ?? 999)).forEach((row) => addRecordRow(records, row["区分"], [
      { label: "件数", value: formatNumber(row["件数（件）"], "件") },
      { label: "回数", value: formatNumber(row["回数（回）"], "回") }
    ]));
  } else {
    const row = month.survey;
    addMetric(metrics, "1日平均", formatNumber(row["1日平均取扱処方箋枚数"], "枚"));
    ["処方箋受付回数", "取扱処方箋枚数", "月間取扱処方箋枚数", "営業日数", "開局日数"].forEach((field) => {
      if (hasValue(row[field])) addRecordRow(records, field, [{ label: "", value: formatNumber(row[field]) }]);
    });
  }

  if (metrics.childNodes.length) container.appendChild(metrics);
  if (records.childNodes.length) container.appendChild(records);
}

function renderMonthCard(month, openFirst) {
  const details = document.createElement("details");
  details.className = `month-card${monthHasData(month) ? " has-data" : ""}`;
  details.open = openFirst;
  const summary = document.createElement("summary");
  summary.className = "month-summary";
  const marker = document.createElement("span");
  marker.className = "month-marker";
  marker.textContent = `${Number(month.key.slice(5))}月`;
  const copy = document.createElement("span");
  copy.className = "month-copy";
  const name = document.createElement("span");
  name.className = "month-name";
  name.textContent = month.label;
  const primary = document.createElement("span");
  primary.className = "month-primary";
  primary.textContent = primaryValue(month);
  copy.append(name, primary);
  const status = document.createElement("span");
  status.className = "month-status";
  const dot = document.createElement("span");
  dot.className = "status-dot";
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";
  status.append(dot, chevron);
  summary.append(marker, copy, status);
  const body = document.createElement("div");
  body.className = "month-detail";
  renderDetail(month, body);
  details.append(summary, body);
  return details;
}

function renderView() {
  updateYearRange();
  const months = monthsForSelectedYear();
  renderOverview(months);
  els.monthList.textContent = "";
  if (!months.length) {
    const empty = document.createElement("p");
    empty.className = "empty-detail";
    empty.textContent = "この年度のデータは取得範囲にありません。";
    els.monthList.appendChild(empty);
    return;
  }
  let firstDataOpened = false;
  months.forEach((month) => {
    const shouldOpen = !firstDataOpened && monthHasData(month);
    if (shouldOpen) firstDataOpened = true;
    els.monthList.appendChild(renderMonthCard(month, shouldOpen));
  });
}

// 選んだカテゴリ・年度の分だけをサーバーから取得します（全カテゴリ・全期間は取得しません）。
// 前回の結果があれば先に表示し、そのあと最新に差し替えます。
async function loadYearlyData(forceRefresh) {
  const seq = ++loadSeq;
  const category = activeCategory;
  const fiscalYear = Number(selectedFiscalYear) || (requestedFiscalYear || currentFiscalYear());
  const params = { category, fy: fiscalYear };
  els.loading.className = "loading-message";
  els.loading.textContent = "データを読み込んでいます…";
  let shownFromCache = false;

  const apply = (result) => {
    if (seq !== loadSeq) return;
    monthsData = result.months || [];
    availableYears = result.years || [];
    if (!monthsData.length && availableYears.length && !availableYears.includes(fiscalYear)) {
      // 指定された年度が取得範囲にない場合は、従来どおり当年度などに切り替えます。
      selectedFiscalYear = "";
    } else {
      selectedFiscalYear = String(fiscalYear);
    }
    renderYearOptions();
    renderTabs();
    if (availableYears.length && Number(selectedFiscalYear) !== fiscalYear) {
      loadYearlyData();
      return;
    }
    renderView();
  };

  try {
    let result;
    if (forceRefresh === true) {
      els.loading.textContent = "最新の内容に更新しています…";
      shownFromCache = monthsData.length > 0;
      result = await authFetch("yearlyDetail", { ...params, refresh: true });
      if (result && result.success) writeViewCache("yearlyDetail", params, result);
    } else {
      result = await authFetchWithCache("yearlyDetail", params, (cached) => {
        apply(cached);
        shownFromCache = true;
        if (seq === loadSeq) els.loading.textContent = "最新の内容に更新しています…";
      });
    }
    if (seq !== loadSeq) return;
    if (!result.success) throw new Error(result.message || "読み込みに失敗しました。");
    apply(result);
    if (seq === loadSeq) els.loading.textContent = "";
  } catch (error) {
    if (seq !== loadSeq) return;
    console.error(error);
    if (shownFromCache) {
      els.loading.className = "loading-message";
      els.loading.textContent = "最新の内容を取得できませんでした。前回の内容を表示しています。";
      return;
    }
    els.loading.className = "loading-message error";
    els.loading.textContent = "現在、データを読み込めません。時間をおいて更新してください。";
  }
}

els.yearSelect.addEventListener("change", () => {
  selectedFiscalYear = els.yearSelect.value;
  monthsData = [];
  els.monthList.textContent = "";
  loadYearlyData();
});
document.getElementById("reload-button").addEventListener("click", () => loadYearlyData(true));
requireAuth(() => loadYearlyData());
