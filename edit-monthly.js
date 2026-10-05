"use strict";

const GAS_URL=PHARMACY_CONFIG.GAS_URL;
const loadingMessage=document.getElementById("edit-loading");
let deleteContext=null; let monthsData=[]; let subrowContext=null;
const text=(v,f="―")=>v===null||v===undefined||v===""?f:String(v);
const pick=(obj,keys,f="")=>{for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&obj[k]!=="")return obj[k]}return f};
function formatDate(v){if(!v)return"—";if(typeof v==="object"&&v!==null)v=v.start||"";if(!v)return"—";const s=String(v).slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(s)?`${Number(s.slice(0,4))}年${Number(s.slice(5,7))}月${Number(s.slice(8,10))}日`:s}

const MODAL_IDS=["generic-modal","subrow-modal","survey-modal","delete-modal"];
function showModal(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function hideModal(id){document.getElementById(id).hidden=true;if(MODAL_IDS.every(m=>document.getElementById(m).hidden))document.body.style.overflow=""}
function hideAllEditModals(){MODAL_IDS.filter(m=>m!=="delete-modal").forEach(hideModal)}

async function apiWrite(action,payload){const j=await authFetch(action,payload);if(!j.success)throw new Error(j.message||"保存に失敗しました。");return j}

/* ===== 後発品調剤率（月1件） ===== */
function findMonth(monthKey){return monthsData.find(m=>m.key===monthKey)}

function renderGenericList(){
  const c=document.getElementById("generic-edit-list");c.textContent="";
  monthsData.forEach(month=>{
    const row=document.createElement("button");row.type="button";row.className="list-row";
    const main=document.createElement("div");main.className="list-main";
    const title=document.createElement("span");title.className="list-title";title.textContent=month.label;main.appendChild(title);
    const filled=!!month.generic;
    const detail=document.createElement("span");detail.className="list-detail";
    detail.textContent=filled?`カットオフ値割合：${text(month.generic["カットオフ値割合"])}%`:"未入力";
    main.appendChild(detail);
    const badge=document.createElement("span");badge.className=`badge ${filled?"green":"none"}`;badge.textContent=filled?"入力済み":"未入力";
    row.append(main,badge);
    row.addEventListener("click",()=>openGenericForm(month));
    c.appendChild(row);
  });
}

function openGenericForm(month){
  const g=month.generic;
  document.getElementById("generic-month-display").textContent=month.label;
  document.getElementById("generic-id").value=g?.id||"";
  document.getElementById("generic-month-key").value=month.key;
  document.getElementById("generic-all").value=g?.["全医薬品規格単位数量"]??"";
  document.getElementById("generic-eligible").value=g?.["後発品あり規格単位数量"]??"";
  document.getElementById("generic-generic").value=g?.["後発医薬品規格単位数量"]??"";
  document.getElementById("generic-new-rate").value=g?.["新指標割合"]??"";
  document.getElementById("generic-cutoff").value=g?.["カットオフ値割合"]??"";
  const btn=document.getElementById("generic-delete-button");
  btn.hidden=!g;
  btn.onclick=g?()=>openDeleteConfirm("generic",{id:g.id,type:month.label}):null;
  showModal("generic-modal");
}

document.getElementById("generic-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const monthKey=document.getElementById("generic-month-key").value;
  const month=findMonth(monthKey);
  const numOrEmpty=id=>{const v=document.getElementById(id).value;return v===""?"":Number(v)};
  const payload={id:document.getElementById("generic-id").value,monthKey,row:{
    "対象月":month.label,
    "全医薬品規格単位数量":numOrEmpty("generic-all"),
    "後発品あり規格単位数量":numOrEmpty("generic-eligible"),
    "後発医薬品規格単位数量":numOrEmpty("generic-generic"),
    "新指標割合":numOrEmpty("generic-new-rate"),
    "カットオフ値割合":numOrEmpty("generic-cutoff")
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveGenericRateRow",payload);
    hideModal("generic-modal");
    loadingMessage.textContent="";
    await loadYearlyCategories(true);
  }catch(err){
    hideModal("generic-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 処方箋集中率・保険調剤実績・在宅（月に複数明細） ===== */
const CATEGORY_LABELS={concentration:"処方箋集中率",insurance:"保険調剤実績",homecare:"在宅患者への薬学的管理"};
const CATEGORY_FIELDS={
  concentration:{titleProp:"医療機関名",titleLabel:"医療機関名",numberFields:[{name:"受付回数",label:"受付回数"},{name:"全体割合",label:"全体割合（%）"}]},
  insurance:{titleProp:"区分",titleLabel:"区分",numberFields:[{name:"件数（件）",label:"件数（件）"},{name:"処方箋回数_医科",label:"処方箋回数_医科"},{name:"処方箋回数_歯科",label:"処方箋回数_歯科"},{name:"処方箋回数_合計",label:"処方箋回数_合計"},{name:"調剤報酬点数_合計",label:"調剤報酬点数_合計"}]},
  homecare:{titleProp:"区分",titleLabel:"区分",numberFields:[{name:"件数（件）",label:"件数（件）"},{name:"回数（回）",label:"回数（回）"}]}
};

function renderSubCategoryList(category){
  const c=document.getElementById(`${category}-edit-list`);c.textContent="";
  monthsData.forEach(month=>{
    const rows=month[category]||[];
    const row=document.createElement("button");row.type="button";row.className="list-row";
    const main=document.createElement("div");main.className="list-main";
    const title=document.createElement("span");title.className="list-title";title.textContent=month.label;main.appendChild(title);
    const detail=document.createElement("span");detail.className="list-detail";
    detail.textContent=rows.length?rows.map(r=>r[CATEGORY_FIELDS[category].titleProp]).filter(Boolean).join("、"):"未入力";
    main.appendChild(detail);
    const badge=document.createElement("span");badge.className=`badge ${rows.length?"green":"none"}`;badge.textContent=rows.length?`${rows.length}件`:"未入力";
    row.append(main,badge);
    row.addEventListener("click",()=>openSubrowMonth(category,month));
    c.appendChild(row);
  });
}

function resetSubrowForm(){
  document.getElementById("subrow-id").value="";
  document.getElementById("subrow-title").value="";
  document.querySelectorAll("#subrow-number-fields input").forEach(i=>i.value="");
  document.getElementById("subrow-delete-button").hidden=true;
  document.getElementById("subrow-delete-button").onclick=null;
}

function buildSubrowNumberFields(category){
  const container=document.getElementById("subrow-number-fields");
  container.innerHTML="";
  CATEGORY_FIELDS[category].numberFields.forEach(f=>{
    const label=document.createElement("label");
    label.textContent=f.label;
    const input=document.createElement("input");
    input.type="number";input.step="any";input.dataset.field=f.name;
    label.appendChild(input);
    container.appendChild(label);
  });
}

function renderSubrowList(){
  const{category,month}=subrowContext;
  const config=CATEGORY_FIELDS[category];
  const c=document.getElementById("subrow-list");c.textContent="";
  const rows=month[category]||[];
  if(!rows.length){c.innerHTML='<p class="empty-message">この月の明細はまだありません。</p>';return}
  rows.forEach(r=>{
    const row=document.createElement("button");row.type="button";row.className="list-row";
    const main=document.createElement("div");main.className="list-main";
    const title=document.createElement("span");title.className="list-title";title.textContent=text(r[config.titleProp],"名称未設定");main.appendChild(title);
    const detail=document.createElement("span");detail.className="list-detail";
    detail.textContent=config.numberFields.map(f=>`${f.label}：${text(r[f.name])}`).join(" ／ ");
    main.appendChild(detail);
    row.appendChild(main);
    row.addEventListener("click",()=>{
      document.getElementById("subrow-id").value=r.id;
      document.getElementById("subrow-title").value=r[config.titleProp]||"";
      document.querySelectorAll("#subrow-number-fields input").forEach(i=>{i.value=r[i.dataset.field]??""});
      const btn=document.getElementById("subrow-delete-button");
      btn.hidden=false;
      btn.onclick=()=>openDeleteConfirm("subrow",{id:r.id,type:r[config.titleProp]||"この明細",category:category});
    });
    c.appendChild(row);
  });
}

function openSubrowMonth(category,month){
  subrowContext={category,month};
  document.getElementById("subrow-modal-title").textContent=CATEGORY_LABELS[category];
  document.getElementById("subrow-month-display").textContent=month.label;
  document.getElementById("subrow-title-label").firstChild.textContent=CATEGORY_FIELDS[category].titleLabel+" ";
  buildSubrowNumberFields(category);
  resetSubrowForm();
  renderSubrowList();
  showModal("subrow-modal");
}

document.getElementById("subrow-cancel-button").addEventListener("click",resetSubrowForm);

document.getElementById("subrow-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const{category,month}=subrowContext;
  const config=CATEGORY_FIELDS[category];
  const row={[config.titleProp]:document.getElementById("subrow-title").value.trim()};
  document.querySelectorAll("#subrow-number-fields input").forEach(i=>{
    row[i.dataset.field]=i.value===""?"":Number(i.value);
  });
  const payload={id:document.getElementById("subrow-id").value,category,monthKey:month.key,row};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveMonthlyCategoryRow",payload);
    loadingMessage.textContent="";
    await loadYearlyCategories(true);
    const refreshedMonth=findMonth(month.key);
    subrowContext={category,month:refreshedMonth};
    resetSubrowForm();
    renderSubrowList();
  }catch(err){
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 処方箋調べ（月1件・自動計算） ===== */
function renderSurveyList(){
  const c=document.getElementById("survey-edit-list");c.textContent="";
  monthsData.forEach(month=>{
    const s=month.survey;
    const row=document.createElement("button");row.type="button";row.className="list-row";
    const main=document.createElement("div");main.className="list-main";
    const title=document.createElement("span");title.className="list-title";title.textContent=month.label;main.appendChild(title);
    const filled=s&&s["処方箋受付回数"]!==null&&s["処方箋受付回数"]!==undefined&&s["処方箋受付回数"]!=="";
    const detail=document.createElement("span");detail.className="list-detail";
    detail.textContent=filled?`合計：${text(s["合計（処方箋受付枚数）"])} ／ 1日平均：${text(s["1日平均取扱処方箋枚数"])}`:"未入力";
    main.appendChild(detail);
    const badge=document.createElement("span");badge.className=`badge ${filled?"green":"none"}`;badge.textContent=filled?"入力済み":"未入力";
    row.append(main,badge);
    row.addEventListener("click",()=>openSurveyForm(month));
    c.appendChild(row);
  });
}

function updateSurveyTotalPreview(){
  const v=id=>Number(document.getElementById(id).value)||0;
  const total=v("survey-dental")+v("survey-ophthalmology")+v("survey-ent")+v("survey-other");
  document.getElementById("survey-total-preview").textContent=total;
}

function openSurveyForm(month){
  const s=month.survey;
  document.getElementById("survey-month-display").textContent=month.label;
  document.getElementById("survey-id").value=s?.id||"";
  document.getElementById("survey-month-key").value=month.key;
  document.getElementById("survey-count").value=s?.["処方箋受付回数"]??"";
  document.getElementById("survey-dental").value=s?.["歯科（処方箋受付枚数）"]??"";
  document.getElementById("survey-ophthalmology").value=s?.["眼科（処方箋受付枚数）"]??"";
  document.getElementById("survey-ent").value=s?.["耳鼻咽喉科（処方箋受付枚数）"]??"";
  document.getElementById("survey-other").value=s?.["その他（処方箋受付枚数）"]??"";
  updateSurveyTotalPreview();
  const btn=document.getElementById("survey-delete-button");
  btn.hidden=!s;
  btn.onclick=s?()=>openDeleteConfirm("survey",{id:s.id,type:month.label}):null;
  showModal("survey-modal");
}

["survey-dental","survey-ophthalmology","survey-ent","survey-other"].forEach(id=>document.getElementById(id).addEventListener("input",updateSurveyTotalPreview));

document.getElementById("survey-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const monthKey=document.getElementById("survey-month-key").value;
  const month=findMonth(monthKey);
  const numOrEmpty=id=>{const v=document.getElementById(id).value;return v===""?"":Number(v)};
  const payload={id:document.getElementById("survey-id").value,row:{
    "年月":month.label,
    "処方箋受付回数":numOrEmpty("survey-count"),
    "歯科（処方箋受付枚数）":numOrEmpty("survey-dental"),
    "眼科（処方箋受付枚数）":numOrEmpty("survey-ophthalmology"),
    "耳鼻咽喉科（処方箋受付枚数）":numOrEmpty("survey-ent"),
    "その他（処方箋受付枚数）":numOrEmpty("survey-other")
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusSurveyRow",payload);
    hideModal("survey-modal");
    loadingMessage.textContent="";
    await loadYearlyCategories(true);
  }catch(err){
    hideModal("survey-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});


const DELETE_LABELS={generic:"この月の後発品調剤率データを削除しますか？",subrow:"この明細を削除しますか？",survey:"この月の処方箋調べデータを削除しますか？"};
const DELETE_ACTIONS={generic:"deleteGenericRateRow",subrow:"deleteMonthlyCategoryRow",survey:"deleteStatusSurveyRow"};
const DELETE_MODALS={generic:"generic-modal",subrow:"subrow-modal",survey:"survey-modal"};

function openDeleteConfirm(type,item){
  deleteContext={type,item};
  document.getElementById("delete-modal-title").textContent=DELETE_LABELS[type];
  document.getElementById("delete-target-name").textContent=item.type;
  showModal("delete-modal");
}

document.getElementById("confirm-delete").addEventListener("click",async()=>{
  if(!deleteContext)return;
  const{type,item}=deleteContext;
  try{
    loadingMessage.textContent="削除しています…";
    const payload=type==="subrow"?{id:item.id,category:item.category}:{id:item.id};
    await apiWrite(DELETE_ACTIONS[type],payload);
    hideModal("delete-modal");
    loadingMessage.textContent="";
    if(type==="subrow"){
      await loadYearlyCategories(true);
      const{category,month}=subrowContext;
      const refreshedMonth=findMonth(month.key);
      subrowContext={category,month:refreshedMonth};
      resetSubrowForm();
      renderSubrowList();
    }else{
      hideModal(DELETE_MODALS[type]);
      await loadYearlyCategories(true);
    }
  }catch(err){
    hideModal("delete-modal");
    hideModal(DELETE_MODALS[type]);
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`削除できません：${err.message}`;
  }
});

async function loadYearlyCategories(forceRefresh){
  loadingMessage.className="loading-message";loadingMessage.textContent="データを読み込んでいます…";
  try{
    const result=await authFetch("yearlyPerformance",forceRefresh===true?{refresh:true}:undefined);
    if(!result.success)throw new Error(result.message||"読み込みに失敗しました。");
    monthsData=result.months||[];
    renderGenericList();
    renderSubCategoryList("concentration");
    renderSubCategoryList("insurance");
    renderSubCategoryList("homecare");
    renderSurveyList();
  }catch(e){
    ["generic-edit-list","concentration-edit-list","insurance-edit-list","homecare-edit-list","survey-edit-list"].forEach(id=>{
      document.getElementById(id).innerHTML='<p class="empty-message">読み込みに失敗しました。</p>';
    });
  }finally{
    if(loadingMessage.textContent==="データを読み込んでいます…")loadingMessage.textContent="";
  }
}

document.getElementById("reload-button").addEventListener("click",()=>loadYearlyCategories(true));
document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",hideAllEditModals));
document.querySelectorAll("[data-close-delete]").forEach(x=>x.addEventListener("click",()=>hideModal("delete-modal")));
document.querySelectorAll(".edit-tab").forEach(t=>t.addEventListener("click",()=>{document.querySelectorAll(".edit-tab").forEach(x=>x.classList.remove("active"));t.classList.add("active");document.querySelectorAll(".edit-section").forEach(s=>s.hidden=true);document.getElementById(t.dataset.target).hidden=false}));

requireEditPermission("canEditMonthly",()=>loadYearlyCategories());
