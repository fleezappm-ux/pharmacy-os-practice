"use strict";

const GAS_URL=PHARMACY_CONFIG.GAS_URL;
const loadingMessage=document.getElementById("edit-loading");
let notices=[]; let licenses=[]; let pharmacists=[]; let sellers=[]; let institutions=[]; let deleteContext=null;
const text=(v,f="―")=>v===null||v===undefined||v===""?f:String(v);
const pick=(obj,keys,f="")=>{for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null&&obj[k]!=="")return obj[k]}return f};
function formatDate(v){if(!v)return"—";if(typeof v==="object"&&v!==null)v=v.start||"";if(!v)return"—";const s=String(v).slice(0,10);return/^\d{4}-\d{2}-\d{2}$/.test(s)?`${Number(s.slice(0,4))}年${Number(s.slice(5,7))}月${Number(s.slice(8,10))}日`:s}

const MODAL_IDS=["notice-modal","license-modal","pharmacist-modal","seller-modal","institution-modal","delete-modal"];
function showModal(id){document.getElementById(id).hidden=false;document.body.style.overflow="hidden"}
function hideModal(id){document.getElementById(id).hidden=true;if(MODAL_IDS.every(m=>document.getElementById(m).hidden))document.body.style.overflow=""}
function hideAllEditModals(){MODAL_IDS.filter(m=>m!=="delete-modal").forEach(hideModal)}

async function apiWrite(action,payload){const j=await authFetch(action,payload);if(!j.success)throw new Error(j.message||"保存に失敗しました。");return j}

/* ===== 各種届出 ===== */
function normalizeNotice(raw,index){const type=pick(raw,["届出種別","name","title"],"名称未設定");const condition=pick(raw,["有効期限"],"");const dateRaw=pick(raw,["指定年月日"],"");const date=typeof dateRaw==="object"&&dateRaw!==null?(dateRaw.start||""):dateRaw;const number=pick(raw,["指定番号・備考"],"");const order=Number(pick(raw,["並び順"],index+1))||index+1;const acquisition=pick(raw,["取得状況"],"取得済み");const id=pick(raw,["id"],"");return{raw,id,type,condition,date,number,order,acquisition}}

function renderNoticeList(){const c=document.getElementById("notice-edit-list");c.textContent="";if(!notices.length){c.innerHTML='<p class="empty-message">届出データはありません。</p>';return}notices.slice().sort((a,b)=>a.order-b.order).forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=`#${n.order}　${n.type}`;main.appendChild(title);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=`有効期限：${formatDate(n.date)} ／ 指定番号：${text(n.number)}`;main.appendChild(detail);const badge=document.createElement("span");badge.className=`badge ${n.acquisition==="取得済み"?"green":"none"}`;badge.textContent=n.acquisition;row.append(main,badge);row.addEventListener("click",()=>openNoticeForm(n));c.appendChild(row)})}

function openNoticeForm(n){document.getElementById("notice-modal-title").textContent=n?"届出を編集":"新規届出を追加";document.getElementById("notice-id").value=n?.id||"";document.getElementById("notice-type").value=n?.type||"";document.getElementById("notice-acquisition").value=n?.acquisition||"取得済み";document.getElementById("notice-deadline").value=n?.condition||"";document.getElementById("notice-date").value=n?.date?String(n.date).slice(0,10):"";document.getElementById("notice-number").value=n?.number||"";document.getElementById("notice-order").value=n?.order||((notices.at(-1)?.order||0)+1);const btn=document.getElementById("notice-delete-button");btn.hidden=!n;btn.onclick=n?()=>openDeleteConfirm("notice",n):null;showModal("notice-modal")}

document.getElementById("notice-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const payload={id:document.getElementById("notice-id").value,notice:{
    "届出種別":document.getElementById("notice-type").value.trim(),
    "取得状況":document.getElementById("notice-acquisition").value,
    "有効期限":document.getElementById("notice-deadline").value.trim(),
    "指定年月日":document.getElementById("notice-date").value,
    "指定番号・備考":document.getElementById("notice-number").value.trim(),
    "並び順":Number(document.getElementById("notice-order").value)
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusNotice",payload);
    hideModal("notice-modal");
    await loadAll();
  }catch(err){
    hideModal("notice-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 許可・登録 ===== */
function normalizeLicense(raw,index){const type=pick(raw,["種類"],"名称未設定");const dateRaw=pick(raw,["有効期限"],"");const date=typeof dateRaw==="object"&&dateRaw!==null?(dateRaw.start||""):dateRaw;const number=pick(raw,["許可(登録・認定・免許)番号"],"");const order=Number(pick(raw,["並び順"],index+1))||index+1;const acquisition=pick(raw,["取得状況"],"取得済み");const id=pick(raw,["id"],"");return{raw,id,type,date,number,order,acquisition}}

function renderLicenseList(){const c=document.getElementById("license-edit-list");c.textContent="";if(!licenses.length){c.innerHTML='<p class="empty-message">許可・登録データはありません。</p>';return}licenses.slice().sort((a,b)=>a.order-b.order).forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=`#${n.order}　${n.type}`;main.appendChild(title);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=`登録番号：${text(n.number)} ／ 有効期限：${formatDate(n.date)}`;main.appendChild(detail);const badge=document.createElement("span");badge.className=`badge ${n.acquisition==="取得済み"?"green":"none"}`;badge.textContent=n.acquisition;row.append(main,badge);row.addEventListener("click",()=>openLicenseForm(n));c.appendChild(row)})}

function openLicenseForm(n){document.getElementById("license-modal-title").textContent=n?"許可・登録を編集":"新規許可・登録を追加";document.getElementById("license-id").value=n?.id||"";document.getElementById("license-type").value=n?.type||"";document.getElementById("license-acquisition").value=n?.acquisition||"取得済み";document.getElementById("license-number").value=n?.number||"";document.getElementById("license-date").value=n?.date?String(n.date).slice(0,10):"";document.getElementById("license-order").value=n?.order||((licenses.at(-1)?.order||0)+1);const btn=document.getElementById("license-delete-button");btn.hidden=!n;btn.onclick=n?()=>openDeleteConfirm("license",n):null;showModal("license-modal")}

document.getElementById("license-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const payload={id:document.getElementById("license-id").value,license:{
    "種類":document.getElementById("license-type").value.trim(),
    "取得状況":document.getElementById("license-acquisition").value,
    "許可(登録・認定・免許)番号":document.getElementById("license-number").value.trim(),
    "有効期限":document.getElementById("license-date").value,
    "並び順":Number(document.getElementById("license-order").value)
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusLicense",payload);
    hideModal("license-modal");
    await loadAll();
  }catch(err){
    hideModal("license-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 薬剤師名簿 ===== */
function normalizePharmacist(raw,index){const name=pick(raw,["薬剤師　氏名"],"氏名未設定");const licenseNumber=pick(raw,["薬剤師登録番号"],"");const insuranceNumber=pick(raw,["保険薬剤師登録番号"],"");const dateRaw=pick(raw,["登録年月日"],"");const date=typeof dateRaw==="object"&&dateRaw!==null?(dateRaw.start||""):dateRaw;const note=pick(raw,["備考(異動月日)"],"");const order=Number(pick(raw,["並び順"],index+1))||index+1;const id=pick(raw,["id"],"");return{raw,id,name,licenseNumber,insuranceNumber,date,note,order}}

function renderPharmacistList(){const c=document.getElementById("pharmacist-edit-list");c.textContent="";if(!pharmacists.length){c.innerHTML='<p class="empty-message">薬剤師の登録はありません。</p>';return}pharmacists.slice().sort((a,b)=>a.order-b.order).forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=n.name;main.appendChild(title);const parts=[];if(n.licenseNumber)parts.push(`薬剤師登録番号：${n.licenseNumber}`);if(n.insuranceNumber)parts.push(`保険薬剤師登録番号：${n.insuranceNumber}`);if(n.date)parts.push(`登録年月日：${formatDate(n.date)}`);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=parts.length?parts.join(" ／ "):"―";main.appendChild(detail);row.append(main);row.addEventListener("click",()=>openPharmacistForm(n));c.appendChild(row)})}

function openPharmacistForm(n){document.getElementById("pharmacist-modal-title").textContent=n?"薬剤師を編集":"新規薬剤師を追加";document.getElementById("pharmacist-id").value=n?.id||"";document.getElementById("pharmacist-name").value=n?.name||"";document.getElementById("pharmacist-license-number").value=n?.licenseNumber||"";document.getElementById("pharmacist-insurance-number").value=n?.insuranceNumber||"";document.getElementById("pharmacist-date").value=n?.date?String(n.date).slice(0,10):"";document.getElementById("pharmacist-note").value=n?.note||"";document.getElementById("pharmacist-order").value=n?.order||((pharmacists.at(-1)?.order||0)+1);const btn=document.getElementById("pharmacist-delete-button");btn.hidden=!n;btn.onclick=n?()=>openDeleteConfirm("pharmacist",{id:n.id,type:n.name,order:n.order}):null;showModal("pharmacist-modal")}

document.getElementById("pharmacist-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const payload={id:document.getElementById("pharmacist-id").value,pharmacist:{
    "薬剤師　氏名":document.getElementById("pharmacist-name").value.trim(),
    "薬剤師登録番号":document.getElementById("pharmacist-license-number").value.trim(),
    "保険薬剤師登録番号":document.getElementById("pharmacist-insurance-number").value.trim(),
    "登録年月日":document.getElementById("pharmacist-date").value,
    "備考(異動月日)":document.getElementById("pharmacist-note").value.trim(),
    "並び順":Number(document.getElementById("pharmacist-order").value)
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusPharmacist",payload);
    hideModal("pharmacist-modal");
    await loadAll();
  }catch(err){
    hideModal("pharmacist-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 登録販売者名簿 ===== */
function normalizeSeller(raw,index){const name=pick(raw,["登録販売者　氏名"],"氏名未設定");const dateRaw=pick(raw,["登録年月日"],"");const date=typeof dateRaw==="object"&&dateRaw!==null?(dateRaw.start||""):dateRaw;const note=pick(raw,["備考"],"");const id=pick(raw,["id"],"");return{raw,id,name,date,note,order:index+1}}

function renderSellerList(){const c=document.getElementById("seller-edit-list");c.textContent="";if(!sellers.length){c.innerHTML='<p class="empty-message">登録販売者の登録はありません。</p>';return}sellers.forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=n.name;main.appendChild(title);const parts=[];if(n.date)parts.push(`登録年月日：${formatDate(n.date)}`);if(n.note)parts.push(n.note);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=parts.length?parts.join(" ／ "):"―";main.appendChild(detail);row.append(main);row.addEventListener("click",()=>openSellerForm(n));c.appendChild(row)})}

function openSellerForm(n){document.getElementById("seller-modal-title").textContent=n?"登録販売者を編集":"新規登録販売者を追加";document.getElementById("seller-id").value=n?.id||"";document.getElementById("seller-name").value=n?.name||"";document.getElementById("seller-date").value=n?.date?String(n.date).slice(0,10):"";document.getElementById("seller-note").value=n?.note||"";const btn=document.getElementById("seller-delete-button");btn.hidden=!n;btn.onclick=n?()=>openDeleteConfirm("seller",{id:n.id,type:n.name,order:null}):null;showModal("seller-modal")}

document.getElementById("seller-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const payload={id:document.getElementById("seller-id").value,seller:{
    "登録販売者　氏名":document.getElementById("seller-name").value.trim(),
    "登録年月日":document.getElementById("seller-date").value,
    "備考":document.getElementById("seller-note").value.trim()
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusSeller",payload);
    hideModal("seller-modal");
    await loadAll();
  }catch(err){
    hideModal("seller-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 基本情報（単一レコード） ===== */
function populateBasicForm(info){info=info||{};document.getElementById("basic-id").value=info.id||"";document.getElementById("basic-insurance-pharmacy-id").value=info.insurancePharmacyId||"";document.getElementById("basic-name").value=info["薬局・店舗販売業の名称"]||"";document.getElementById("basic-owner").value=info["開設者氏名(又は代表者)"]||"";document.getElementById("basic-manager").value=info["管理者氏名"]||"";document.getElementById("basic-address").value=info["所在地"]||"";document.getElementById("basic-hours").value=info["開局時間"]||"";document.getElementById("basic-holiday").value=info["休日"]||"";const licenseDate=info["薬局許可年月日"];document.getElementById("basic-license-date").value=licenseDate&&licenseDate.start?String(licenseDate.start).slice(0,10):"";const insuranceDate=info["保険薬局指定年月日"];document.getElementById("basic-insurance-date").value=insuranceDate&&insuranceDate.start?String(insuranceDate.start).slice(0,10):"";document.getElementById("basic-insurance-code").value=info["コード番号"]||"";const renewalDate=info["指定更新期限"];document.getElementById("basic-insurance-renewal").value=renewalDate&&renewalDate.start?String(renewalDate.start).slice(0,10):""}

document.getElementById("basic-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const id=document.getElementById("basic-id").value;
  if(!id){loadingMessage.className="loading-message error";loadingMessage.textContent="基本情報のIDが取得できていません。再読み込みしてください。";return}
  const payload={id,insurancePharmacyId:document.getElementById("basic-insurance-pharmacy-id").value,basicInfo:{
    "薬局・店舗販売業の名称":document.getElementById("basic-name").value.trim(),
    "開設者氏名(又は代表者)":document.getElementById("basic-owner").value.trim(),
    "管理者氏名":document.getElementById("basic-manager").value.trim(),
    "所在地":document.getElementById("basic-address").value.trim(),
    "開局時間":document.getElementById("basic-hours").value.trim(),
    "休日":document.getElementById("basic-holiday").value.trim(),
    "薬局許可年月日":document.getElementById("basic-license-date").value,
    "保険薬局指定年月日":document.getElementById("basic-insurance-date").value,
    "コード番号":document.getElementById("basic-insurance-code").value.trim(),
    "指定更新期限":document.getElementById("basic-insurance-renewal").value
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusBasicInfo",payload);
    loadingMessage.textContent="保存しました。";
    await loadAll();
  }catch(err){
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 試験検査機関の利用契約 ===== */
function normalizeInstitution(raw,index){const name=pick(raw,["利用機関名"],"名称未設定");const dateRaw=pick(raw,["契約更新期限"],"");const date=typeof dateRaw==="object"&&dateRaw!==null?(dateRaw.start||""):dateRaw;const id=pick(raw,["id"],"");return{raw,id,name,date,order:index+1}}

function renderInstitutionList(){const c=document.getElementById("institution-edit-list");c.textContent="";if(!institutions.length){c.innerHTML='<p class="empty-message">試験検査機関の登録はありません。</p>';return}institutions.forEach(n=>{const row=document.createElement("button");row.type="button";row.className="list-row";const main=document.createElement("div");main.className="list-main";const title=document.createElement("span");title.className="list-title";title.textContent=n.name;main.appendChild(title);const detail=document.createElement("span");detail.className="list-detail";detail.textContent=`契約更新期限：${formatDate(n.date)}`;main.appendChild(detail);row.append(main);row.addEventListener("click",()=>openInstitutionForm(n));c.appendChild(row)})}

function openInstitutionForm(n){document.getElementById("institution-modal-title").textContent=n?"試験検査機関を編集":"新規試験検査機関を追加";document.getElementById("institution-id").value=n?.id||"";document.getElementById("institution-name").value=n?.name||"";document.getElementById("institution-date").value=n?.date?String(n.date).slice(0,10):"";const btn=document.getElementById("institution-delete-button");btn.hidden=!n;btn.onclick=n?()=>openDeleteConfirm("institution",{id:n.id,type:n.name,order:null}):null;showModal("institution-modal")}

document.getElementById("institution-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const payload={id:document.getElementById("institution-id").value,institution:{
    "利用機関名":document.getElementById("institution-name").value.trim(),
    "契約更新期限":document.getElementById("institution-date").value
  }};
  try{
    loadingMessage.textContent="保存しています…";
    await apiWrite("saveStatusTestInstitution",payload);
    hideModal("institution-modal");
    await loadAll();
  }catch(err){
    hideModal("institution-modal");
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`保存できません：${err.message}`;
  }
});

/* ===== 削除確認 ===== */
const DELETE_LABELS={notice:"この届出を削除しますか？",license:"この許可・登録を削除しますか？",pharmacist:"この薬剤師を削除しますか？",seller:"この登録販売者を削除しますか？",institution:"この試験検査機関を削除しますか？"};
const DELETE_ACTIONS={notice:"deleteStatusNotice",license:"deleteStatusLicense",pharmacist:"deleteStatusPharmacist",seller:"deleteStatusSeller",institution:"deleteStatusTestInstitution"};
const DELETE_MODALS={notice:"notice-modal",license:"license-modal",pharmacist:"pharmacist-modal",seller:"seller-modal",institution:"institution-modal"};

function openDeleteConfirm(type,item){
  deleteContext={type,item};
  document.getElementById("delete-modal-title").textContent=DELETE_LABELS[type];
  document.getElementById("delete-target-name").textContent=item.order?`${item.type}（並び順：${item.order}）`:item.type;
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
    await loadAll();
  }catch(err){
    hideModal("delete-modal");
    hideModal(DELETE_MODALS[type]);
    loadingMessage.className="loading-message error";
    loadingMessage.textContent=`削除できません：${err.message}`;
  }
});

/* ===== 読み込み ===== */
async function loadAll(){loadingMessage.className="loading-message";loadingMessage.textContent="データを読み込んでいます…";try{const result=await authFetch("status");if(!result.success)throw new Error(result.message||"読み込みに失敗しました。");const data=result.data||result;notices=(data.notices||[]).map(normalizeNotice);licenses=(data.licenses||[]).map(normalizeLicense);pharmacists=(data.pharmacists||[]).map(normalizePharmacist);sellers=(data.registeredSellers||[]).map(normalizeSeller);institutions=(data.testInstitutions||[]).map(normalizeInstitution);renderNoticeList();renderLicenseList();renderPharmacistList();renderSellerList();renderInstitutionList();populateBasicForm(data.basicInfo);loadingMessage.textContent=""}catch(e){loadingMessage.className="loading-message error";loadingMessage.textContent="現在、データを読み込めません。GAS連携を確認してください。"}}

document.getElementById("reload-button").addEventListener("click",loadAll);
document.getElementById("add-notice-button").addEventListener("click",()=>openNoticeForm(null));
document.getElementById("add-license-button").addEventListener("click",()=>openLicenseForm(null));
document.getElementById("add-pharmacist-button").addEventListener("click",()=>openPharmacistForm(null));
document.getElementById("add-seller-button").addEventListener("click",()=>openSellerForm(null));
document.getElementById("add-institution-button").addEventListener("click",()=>openInstitutionForm(null));
document.querySelectorAll("[data-close-modal]").forEach(x=>x.addEventListener("click",hideAllEditModals));
document.querySelectorAll("[data-close-delete]").forEach(x=>x.addEventListener("click",()=>hideModal("delete-modal")));
document.querySelectorAll(".edit-tab").forEach(t=>t.addEventListener("click",()=>{document.querySelectorAll(".edit-tab").forEach(x=>x.classList.remove("active"));t.classList.add("active");document.querySelectorAll(".edit-section").forEach(s=>s.hidden=true);document.getElementById(t.dataset.target).hidden=false}));

requireEditPermission("canEditOther",loadAll);
