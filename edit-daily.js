"use strict";

const GAS_URL=PHARMACY_CONFIG.GAS_URL;
const loadingMessage=document.getElementById("edit-loading");
let deleteContext=null;
let ownName="";
let isSystemAdminUser=false;
const text=(v,f="―")=>v===null||v===undefined||v===""?f:String(v);
const pick=(obj,keys,f="")=>{for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&obj[k]!=="")return obj[k]}return f};
function formatDate(v){if(!v)return"—";if(typeof v==="object"&&v!==null)v=v.start||"";if(!v)return"—";const s=String(v).slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(s)?`${Number(s.slice(0,4))}年${Number(s.slice(5,7))}月${Number(s.slice(8,10))}日`:s}

const MODAL_IDS=["daily-modal","delete-modal"];
function showModal(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function hideModal(id){document.getElementById(id).hidden=true;if(MODAL_IDS.every(m=>document.getElementById(m).hidden))document.body.style.overflow=""}
function hideAllEditModals(){MODAL_IDS.filter(m=>m!=="delete-modal").forEach(hideModal)}

async function apiWrite(action,payload){const j=await authFetch(action,payload);if(!j.success)throw new Error(j.message||"保存に失敗しました。");return j}

/* ===== 日次業務 ===== */
let dailyReports=[];
function normalizeDailyReport(raw){const date=pick(raw,["日付"],"");const dateStr=typeof date==="object"&&date!==null?(date.start||""):date;return{raw,id:pick(raw,["id"],""),date:dateStr,closed:Boolean(raw["休業日"]),hours:raw["開局時間"]||"",count:raw["処方箋枚数"],managerAbsence:raw["管理者不在時間"]||"",managerResponder:raw["管理者不在時対応者"]||"",pharmacistAbsence:raw["薬剤師不在時間"]||"",pharmacistResponder:raw["薬剤師不在時対応者"]||"",notes:raw["特記事項"]||"",handover:raw["申し送り"]||"",confirmedBy:raw["確認印"]||""}}

async function loadDailyReports(){try{const result=await authFetch("dailyReports");if(!result.success)throw new Error(result.message||"読み込みに失敗しました。");dailyReports=(result.reports||[]).map(normalizeDailyReport);renderDailyList();openFromDateParam()}catch(e){document.getElementById("daily-edit-list").innerHTML='<p class="empty-message">読み込みに失敗しました。</p>'}finally{if(loadingMessage.textContent==="データを読み込んでいます…")loadingMessage.textContent=""}}

/** URLに?date=YYYY-MM-DDが付いている場合、該当日の記録を自動で開きます（重複エラーからの誘導用）。 */
function openFromDateParam(){
  const params=new URLSearchParams(location.search);
  const targetDate=params.get("date");
  if(!targetDate)return;
  const target=dailyReports.find(n=>n.date&&String(n.date).slice(0,10)===targetDate);
  if(target)openDailyForm(target);
}

function renderDailyList(){const c=document.getElementById("daily-edit-list");c.textContent="";if(!dailyReports.length){c.innerHTML='<p class="empty-message">日次業務の記録はありません。</p>';return}dailyReports.forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=formatDate(n.date);main.appendChild(title);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=n.closed?"休業日":`開局時間：${text(n.hours)} ／ 処方箋枚数：${text(n.count)}`;main.appendChild(detail);const badge=document.createElement("span");badge.className=`badge ${n.closed?"none":"green"}`;badge.textContent=n.closed?"休業日":"営業日";row.append(main,badge);row.addEventListener("click",()=>openDailyForm(n));c.appendChild(row)})}

function openDailyForm(n){document.getElementById("daily-edit-id").value=n.id;document.getElementById("daily-edit-date").value=n.date?String(n.date).slice(0,10):"";document.getElementById("daily-edit-closed").checked=n.closed;document.getElementById("daily-edit-hours").value=n.hours||"";document.getElementById("daily-edit-count").value=n.count??"";document.getElementById("daily-edit-manager-absence").value=n.managerAbsence||"";document.getElementById("daily-edit-manager-responder").value=n.managerResponder||"";document.getElementById("daily-edit-pharmacist-absence").value=n.pharmacistAbsence||"";document.getElementById("daily-edit-pharmacist-responder").value=n.pharmacistResponder||"";document.getElementById("daily-edit-notes").value=n.notes||"";document.getElementById("daily-edit-handover").value=n.handover||"";document.getElementById("daily-edit-confirmed").value=ownName||"読み込み中…";document.getElementById("daily-edit-confirmed-select").value=n.confirmedBy||"";document.getElementById("daily-edit-delete-button").onclick=()=>openDeleteConfirm("daily",{id:n.id,type:formatDate(n.date),order:null});showModal("daily-modal")}

document.getElementById("daily-edit-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.getElementById("daily-edit-id").value;
  const numOrEmpty=v=>v===""?"":Number(v);
  const payload={id,report:{
    "日付":document.getElementById("daily-edit-date").value,
    "休業日":document.getElementById("daily-edit-closed").checked,
    "開局時間":document.getElementById("daily-edit-hours").value.trim(),
    "処方箋枚数":numOrEmpty(document.getElementById("daily-edit-count").value),
    "管理者不在時間":document.getElementById("daily-edit-manager-absence").value.trim(),
    "管理者不在時対応者":document.getElementById("daily-edit-manager-responder").value.trim(),
    "薬剤師不在時間":document.getElementById("daily-edit-pharmacist-absence").value.trim(),
    "薬剤師不在時対応者":document.getElementById("daily-edit-pharmacist-responder").value.trim(),
    "特記事項":document.getElementById("daily-edit-notes").value.trim(),
    "申し送り":document.getElementById("daily-edit-handover").value.trim(),
    "確認印":isSystemAdminUser?document.getElementById("daily-edit-confirmed-select").value:document.getElementById("daily-edit-confirmed").value
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("updateDailyReport",payload);
    hideModal("daily-modal");
    loadingMessage.textContent="";
    await loadDailyReports();
  }catch(err){
    hideModal("daily-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 削除確認（共通） ===== */
/* ===== 削除確認 ===== */
const DELETE_LABELS={daily:"この日報を削除しますか？"};
const DELETE_ACTIONS={daily:"deleteDailyReport"};
const DELETE_MODALS={daily:"daily-modal"};

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
    await apiWrite(DELETE_ACTIONS[type],{id:item.id});
    hideModal("delete-modal");
    hideModal(DELETE_MODALS[type]);
    loadingMessage.textContent="";
    await loadDailyReports();
  }catch(err){
    hideModal("delete-modal");
    hideModal(DELETE_MODALS[type]);
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`削除できません：${err.message}`;
  }
});

document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",hideAllEditModals));
document.querySelectorAll("[data-close-delete]").forEach(x=>x.addEventListener("click",()=>hideModal("delete-modal")));

async function loadOwnName(){
  try{
    const result=await fetchWhoAmIShared();
    isSystemAdminUser=result.success&&(result.role==="system_admin"||result.role==="admin");
    if(isSystemAdminUser){
      document.getElementById("daily-edit-confirmed").hidden=true;
      document.getElementById("daily-edit-confirmed-select").hidden=false;
      const namesResult=await authFetch("pharmacistNames");
      if(namesResult.success){
        const select=document.getElementById("daily-edit-confirmed-select");
        (namesResult.names||[]).forEach(name=>{
          const option=document.createElement("option");
          option.value=name;option.textContent=name;
          select.appendChild(option);
        });
      }
    }else{
      ownName=(result.success&&result.name)?result.name:"（氏名未登録）";
      document.getElementById("daily-edit-confirmed").value=ownName;
    }
  }catch(e){
    console.error("氏名の取得に失敗しました。",e);
    document.getElementById("daily-edit-confirmed").value="（取得できませんでした）";
  }
}

requireEditPermission("canEditDaily",()=>{loadDailyReports();loadOwnName()});
