// MATGR MO PRO+++ (Single-file app logic)
// Designed for GitHub Pages + Firebase (Auth/Firestore)

import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, getAuth, signOut as signOutAny } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs,
  serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

let COMPANY_ID=(localStorage.getItem("companyId")||"main");
const $=id=>document.getElementById(id);
const setValById=(id,val)=>{ const el=$(id); if(el) el.value=val; };
const setTextById=(id,val)=>{ const el=$(id); if(el) el.innerText=val; };
const fmt=new Intl.NumberFormat("ar-EG",{maximumFractionDigits:2});
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const iso=()=>new Date().toISOString();
const dateOnly=(s)=>String(s||"").slice(0,10);

let USER=null, USERDOC=null, COMPANY={}, PERIOD={}, MAP={};
let SECONDARY_APP=null;
function getSecondaryAuth(){
  try{
    if(!SECONDARY_APP){
      SECONDARY_APP = initializeApp(auth.app.options, "secondary");
    }
    return getAuth(SECONDARY_APP);
  }catch(e){
    return null;
  }
}

let WAREHOUSES=[], ITEMS=[], CUSTOMERS=[], SUPPLIERS=[], ACCOUNTS=[];
let POS_LINES=[], LAST_INV=null;
let EDITING_INVOICE_ID=null;
let EDITING_INVOICE_NO=null;
let EDITING_INVOICE_TYPE=null;

function showModal(title, bodyHtml, onOk){
  $("modalTitle").innerText=title; $("modalBody").innerHTML=bodyHtml; $("modalBackdrop").style.display="flex";
  const ok=$("modalOk"), cancel=$("modalCancel");
  // reset default state (some screens may customize)
  ok.style.display="";
  cancel.innerText="إلغاء";
  ok.innerText="موافق";
  const cleanup=()=>{$("modalBackdrop").style.display="none"; ok.onclick=null; cancel.onclick=null;};
  cancel.onclick=cleanup; ok.onclick=()=>{cleanup(); onOk?.();};
}
function closeModal(){ $("modalBackdrop").style.display="none"; $("modalOk").onclick=null; $("modalCancel").onclick=null; $("modalOk").style.display=""; $("modalCancel").style.display=""; }
function role(){ return USERDOC?.role||"viewer"; }
function can(roles){ return roles.includes(role()); }

function perms(){ return USERDOC?.perms||null; }
function canDo(key){
  // Admin always allowed
  if(role()==="admin") return true;
  const p=perms();
  if(p && (key in p)) return p[key]===true;
  // default by role
  const r=role();
  const defaults={
    cashier:{pos:true, sales:true, salesReturn:true, customers:true, vouchers:true, reports:true},
    accountant:{pos:true, sales:true, salesReturn:true, purchases:true, purchasesReturn:true, customers:true, suppliers:true, accounts:true, journals:true, reports:true, invReports:true, cogs:true},
    viewer:{reports:true},
  };
  const d=defaults[r]||{};
  return d[key]===true;
}

async function audit(action, entity, entityId, details={}){
  try{
    await addDoc(collection(db,"companies",COMPANY_ID,"auditLog"),{
      ts:serverTimestamp(),iso:iso(),uid:USER.uid,email:USER.email||"",
      action,entity,entityId:entityId||"",details
    });
  }catch(e){}
}

function openDrawer(){ $("sidebar").classList.add("open"); $("drawerBackdrop").style.display="block"; }
function closeDrawer(){ $("sidebar").classList.remove("open"); $("drawerBackdrop").style.display="none"; }

$("btnHamburger").addEventListener("click",openDrawer);
$("drawerBackdrop").addEventListener("click",closeDrawer);


// ---------- Error Overlay ----------
function showToast(message, type="info", ms=2600){
  try{
    let wrap=document.getElementById("toastWrap");
    if(!wrap){
      wrap=document.createElement("div");
      wrap.id="toastWrap";
      wrap.style.position="fixed";
      wrap.style.left="12px";
      wrap.style.right="12px";
      wrap.style.bottom="12px";
      wrap.style.zIndex="9998";
      wrap.style.display="flex";
      wrap.style.flexDirection="column";
      wrap.style.gap="8px";
      wrap.style.pointerEvents="none";
      document.body.appendChild(wrap);
    }
    const t=document.createElement("div");
    t.style.pointerEvents="auto";
    t.style.background= type==="danger" ? "rgba(180,30,30,.95)" : type==="warn" ? "rgba(200,140,0,.95)" : type==="ok" ? "rgba(20,140,80,.95)" : "rgba(20,30,50,.92)";
    t.style.color="#fff";
    t.style.padding="10px 12px";
    t.style.borderRadius="14px";
    t.style.fontSize="12px";
    t.style.boxShadow="0 10px 25px rgba(0,0,0,.35)";
    t.style.whiteSpace="pre-wrap";
    t.textContent=String(message||"");
    t.onclick=()=>t.remove();
    wrap.appendChild(t);
    setTimeout(()=>{ try{ t.remove(); }catch(e){} }, ms);
  }catch(e){}
}

function showError(msg){
  // افتراضيًا: لا نُظهر الرسالة الحمراء في كل الصفحات (لتفادي الإزعاج).
  // لتفعيلها عند الحاجة: ضع في المتصفح localStorage.debugErrors="1"
  const debug = (localStorage.getItem("debugErrors")==="1");
  if(!debug){
    console.error("[APP ERROR]", msg);
    showToast("حدث خطأ غير متوقع. راجع سجل العمليات إن لزم.", "danger", 3500);
    return;
  }
  try{
    let box=document.getElementById("errBox");
    if(!box){
      box=document.createElement("div");
      box.id="errBox";
      box.style.position="fixed";
      box.style.left="12px";
      box.style.right="12px";
      box.style.bottom="12px";
      box.style.zIndex="9999";
      box.style.background="rgba(180,30,30,.95)";
      box.style.color="#fff";
      box.style.padding="10px 12px";
      box.style.borderRadius="12px";
      box.style.fontSize="12px";
      box.style.whiteSpace="pre-wrap";
      box.style.maxHeight="40vh";
      box.style.overflow="auto";
      box.onclick=()=>box.remove();
      document.body.appendChild(box);
    }
    box.textContent=String(msg||"خطأ غير معروف")+"\n(اضغط لإغلاق)";
  }catch(e){}
}
window.addEventListener('error', (e)=>{ showError(e.message||e.error||"Error"); });
window.addEventListener('unhandledrejection', (e)=>{ showError(e.reason?.message||e.reason||"Promise Error"); });
// ---------- Navigation / Views ----------
const content=$("content");
let CURRENT_VIEW="home";
function setTitle(t){ $("pageTitle").innerText=t; }
function viewWrap(id, title){ return `<div class="view" id="view_${id}" style="display:none;"></div>`; }

const VIEWS=[
  ["home","الرئيسية"],
  ["pos","POS"],
  ["salesInvoices","فواتير المبيعات"],
  ["salesReturns","مرتجع المبيعات"],
  ["purchaseInvoices","فواتير المشتريات"],
  ["purchaseReturns","مرتجع مشتريات"],
  ["invMoves","حركة الفواتير"],
  ["receiptVoucher","سند قبض"],
  ["paymentVoucher","سند دفع"],
  ["openingEntry","قيد افتتاحي"],
  ["items","دليل المواد"],
  ["customers","دليل العملاء"],
  ["suppliers","دليل الموردين"],
  ["accounts","دليل الحسابات"],
  ["map","ربط الحسابات"],
  ["invReports","تقارير المخزون"],
  ["trial","ميزان مراجعة"],
  ["custStatement","كشف حساب عميل"],
  ["supStatement","كشف حساب مورد"],
  ["balances","أرصدة العملاء والموردين"],
  ["cogs","تكلفة البضاعة المباعة"],
  ["cashJournal","يومية الصندوق"],
  ["users","المستخدمون والصلاحيات"],
  ["company","بيانات الشركة"],
  ["audit","سجل العمليات"]
];

content.innerHTML = VIEWS.map(v=>viewWrap(v[0],v[1])).join("");


function ensureViewReady(id){
  try{
    if(id==="pos") return mountPOS();
    if(["salesInvoices","salesReturns","purchaseInvoices","purchaseReturns"].includes(id)) return mountInvoicePages();
    if(id==="invMoves") return mountInvoiceMoves();
    if(["receiptVoucher","paymentVoucher"].includes(id)) return mountVouchers();
    if(id==="openingEntry") return mountOpening();
    if(id==="invReports") return mountInvReports();
    if(["trial","custStatement","supStatement","balances","cogs","cashJournal"].includes(id)) return mountReports();
  }catch(e){
    showError(e.message||e);
  }
}
function setView(id){
  // تأكد أن الصفحة مركّبة (حتى لو حدث خطأ سابق)
  ensureViewReady(id);
  VIEWS.forEach(v=>{
    const el=$("view_"+v[0]); if(!el) return;
    el.style.display = (v[0]===id)?"block":"none";
  });
  document.querySelectorAll(".navBtn").forEach(b=>b.classList.toggle("active", b.dataset.view===id));
  document.querySelectorAll(".iconBtn").forEach(b=>b.classList.toggle("active", b.dataset.view===id));
  const t = VIEWS.find(v=>v[0]===id)?.[1]||"";
  setTitle(t);
  CURRENT_VIEW=id;
  closeDrawer();

  // لو الصفحة فاضية، اعرض رسالة واضحة
  const el=$("view_"+id);
  if(el && !el.innerHTML.trim()){
    el.innerHTML = `<div class="card"><div class="cardTitle">لم يتم تحميل الشاشة</div>
      <div style="opacity:.85;line-height:1.8">
      اضغط تحديث للصفحة، وإذا استمرت المشكلة افتح "سجل العمليات" ثم أرسل لقطة من رسالة الخطأ الحمراء إن ظهرت.
      </div></div>`;
  }
}

document.querySelectorAll(".navBtn").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
document.querySelectorAll(".iconBtn").forEach(b=>{
  if(b.dataset.view) b.addEventListener("click",()=>setView(b.dataset.view));
  if(b.dataset.action==="more") b.addEventListener("click",openDrawer);
});


function setCompanyMini(){
  $("companyNameMini").innerText=COMPANY?.name||"MATGR MO";
  if(COMPANY?.logoDataUrl){
    $("companyLogoMini").innerHTML=`<img src="${COMPANY.logoDataUrl}" style="max-width:100%;max-height:100%"/>`;
  }
}

// ---------- Loaders ----------
async function getSettingsDoc(name, fallback={}){
  const s=await getDoc(doc(db,"companies",COMPANY_ID,"settings",name));
  return s.exists()?s.data():fallback;
}
async function setSettingsDoc(name, data){
  await setDoc(doc(db,"companies",COMPANY_ID,"settings",name),data,{merge:true});
}
async function loadList(colName, orderField="name"){
  const qy = orderField ? query(collection(db,"companies",COMPANY_ID,colName), orderBy(orderField), limit(2000))
                        : query(collection(db,"companies",COMPANY_ID,colName), limit(2000));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>{ if(d.id==="_init") return; list.push({id:d.id,...d.data()}); });
  return list;
}
async function loadAccounts(){
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"accounts"), limit(5000)));
  const list=[];
  snap.forEach(d=>{
    if(d.id==="_init") return;
    const data=d.data()||{};
    const code = String(data.code||d.id||"").trim();
    if(!code) return;
    list.push({id:d.id, ...data, code});
  });
  list.sort((a,b)=>String(a.code).localeCompare(String(b.code),"en"));
  return list;
}
async function loadInvoices(type){
  // تجنّب الحاجة إلى Composite Index (type + ts) عبر التحميل بترتيب واحد ثم فلترة محلية
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"invoices"), orderBy("ts","desc"), limit(1500)));
  const list=[]; 
  snap.forEach(d=>{ 
    if(d.id==="_init") return; 
    const obj={id:d.id,...d.data()}; 
    if(!type || obj.type===type) list.push(normalizeInvoice(obj));
  });
  return list;
}
async function loadJournal(){
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"journalEntries"), orderBy("ts","desc"), limit(2000)));
  const list=[]; snap.forEach(d=>{ if(d.id==="_init") return; list.push({id:d.id,...d.data()}); });
  return list;
}
async function loadUserDoc(uid){
  const s=await getDoc(doc(db,"companies",COMPANY_ID,"users",uid));
  return s.exists()?s.data():null;
}

function parseLockedUntil(){
  const d=new Date((PERIOD?.lockedUntilDate||"1970-01-01")+"T00:00:00"); 
  return Number.isFinite(d.getTime())?d:new Date("1970-01-01T00:00:00");
}
function canOverrideLock(){
  return role()==="admin" && (USERDOC?.canOverrideLock===true || PERIOD?.allowAdminOverride===true);
}
function updatePeriodUI(){
  const locked=parseLockedUntil(); const today=new Date();
  if(today<=locked){
    $("periodPill").innerText=`الفترة: مقفلة حتى ${PERIOD.lockedUntilDate}`;
  }else{
    $("periodPill").innerText="الفترة: مفتوحة";
  }
}

// ---------- POS ----------
function posHTML(){
  return `
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">POS</div>
      <div class="editBanner" id="posEditBanner" style="display:none"></div>
      <div class="row3">
        <div class="field"><label>نوع</label>
          <select id="posType">
            <option value="sale">بيع</option>
            <option value="sale_return">مرتجع مبيعات</option>
            <option value="purchase">مشتريات</option>
            <option value="purchase_return">مرتجع مشتريات</option>
          </select>
        </div>
        <div class="field"><label>الطرف</label><select id="posParty"></select></div>
        <div class="field"><label>الدفع</label>
          <select id="posPay">
            <option value="cash">كاش</option>
            <option value="vodafone">فودافون</option>
            <option value="insta">إنستا</option>
            <option value="credit">آجل</option>
          </select>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label>المستودع</label><select id="posWh"></select></div>
        <div class="field"><label>ملاحظة</label><input id="posNote" placeholder="اختياري"/></div>
      </div>

      <div class="divider"></div>

      <div class="row4">
        <div class="field"><label>باركود / اسم الصنف</label>
          <input id="posCode" list="itemsList" placeholder="اكتب باركود أو جزء من اسم الصنف"/>
          <datalist id="itemsList"></datalist>
          <div class="miniHint" id="posItemHint"></div>
        </div>
        <div class="field"><label>المادة</label><select id="posItem"></select></div>
        <div class="field"><label>الكمية</label><input id="posQty" type="number" min="1" value="1"/></div>
        <div class="field"><label>السعر</label><input id="posPrice" type="number" min="0" placeholder="يتم جلب السعر تلقائيًا"/></div>
      </div>
      <button class="btn" id="posAdd">إضافة سطر</button>
      <div class="hint warn" id="posWarn"></div>

      <div class="tableWrap">
        <table class="tbl" id="posTbl">
          <thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th></th></tr></thead>
          <tbody></tbody>
        </table>
      </div>

      <div class="totals">
        <div class="totLine"><span>الإجمالي</span><b id="posTotal">0</b></div>
        <div class="totLine"><span>خصم رقم</span><input id="posDiscAmt" type="number" value="0" min="0"/></div>
        <div class="totLine"><span>خصم %</span><input id="posDiscPct" type="number" value="0" min="0" max="100"/></div>
        <div class="totLine"><span>الصافي</span><b id="posNet">0</b></div>
      </div>

      <div class="row2">
        <button class="btn primary" id="posSave">حفظ وترحيل</button>
        <button class="btn" id="posPrint">طباعة</button>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">معاينة</div>
      <div class="invoice" id="invPreview"></div>
    </div>
  </div>`;
}

function fillSelect(sel, rows, labelFn){
  sel.innerHTML="";
  rows.forEach(r=>{
    const o=document.createElement("option");
    o.value=r.id; o.textContent=labelFn(r);
    sel.appendChild(o);
  });
}

function payAccount(method){
  if(method==="cash") return MAP.cashAccount;
  if(method==="vodafone") return MAP.vodafoneAccount;
  if(method==="insta") return MAP.instaAccount;
  return "";
}

async function stockQty(whId,itemId){
  const s=await getDoc(doc(db,"companies",COMPANY_ID,"stock",`${whId}__${itemId}`));
  return s.exists()?n(s.data().qty):0;
}

async function adjustStockTx(tx, whId, itemId, delta){
  const ref=doc(db,"companies",COMPANY_ID,"stock",`${whId}__${itemId}`);
  const s=await tx.get(ref);
  const cur=s.exists()?n(s.data().qty):0;
  const next=cur+delta;
  if(next<0) throw new Error("الكمية لا تسمح");
  tx.set(ref,{warehouseId:whId,itemId,qty:next,updatedAt:serverTimestamp(),iso:iso()},{merge:true});
}

async function nextNoTx(tx, field){
  const ref=doc(db,"companies",COMPANY_ID,"counters","numbers");
  const s=await tx.get(ref);
  const cur=s.exists()?n(s.data()[field]):1;
  tx.set(ref,{[field]:cur+1},{merge:true});
  return cur;
}

function invTitle(type){
  return {sale:"فاتورة مبيعات",sale_return:"مرتجع مبيعات",purchase:"فاتورة مشتريات",purchase_return:"مرتجع مشتريات"}[type]||"فاتورة";
}

function computeTotals(){
  const total=POS_LINES.reduce((s,l)=>s+l.qty*l.price,0);
  const discAmt=n($("posDiscAmt").value);
  const discPct=n($("posDiscPct").value);
  const disc=Math.min(total, discAmt + total*(discPct/100));
  const net=Math.max(0,total-disc);
  $("posTotal").innerText=fmt.format(total);
  $("posNet").innerText=fmt.format(net);
  return {total,disc,net};
}

function renderPosLines(){
  const tb=$("posTbl").querySelector("tbody"); tb.innerHTML="";
  POS_LINES.forEach((l,idx)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${l.name}</td><td>${fmt.format(l.qty)}</td><td>${fmt.format(l.price)}</td><td><b>${fmt.format(l.qty*l.price)}</b></td>
      <td><button class="btn danger" data-del="${idx}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{POS_LINES.splice(Number(b.dataset.del),1); renderPosLines(); renderPreview();});
  computeTotals();
}

function partyName(type, partyId){
  const pid=String(partyId||"");
  if(type==="sale"||type==="sale_return"){
    if(pid==="cash") return "عميل نقدي";
    const nm = CUSTOMERS.find(c=>c.id===pid)?.name;
    return (nm && String(nm).trim()) ? String(nm).trim() : "عميل غير معروف";
  }
  const nm = SUPPLIERS.find(s=>s.id===pid)?.name;
  return (nm && String(nm).trim()) ? String(nm).trim() : "مورد غير معروف";
}

function normalizeInvoice(inv){
  if(!inv) return inv;
  const type=inv.type;
  const pid=String(inv.partyId||inv.customerId||inv.supplierId||"");
  // normalize partyId
  if(!inv.partyId && pid) inv.partyId=pid;
  // compute name from stored fields or masters
  let pName = String(inv.partyName||inv.customerName||inv.supplierName||"").trim();
  if(!pName){
    pName = partyName(type, inv.partyId);
  }
  inv.partyName = pName;
  // explicit fields used by some reports/prints
  if(type==="sale"||type==="sale_return"){
    inv.customerId = (inv.partyId==="cash")?"cash":inv.partyId;
    inv.customerName = (inv.partyId==="cash")?"عميل نقدي":pName;
    inv.supplierId = inv.supplierId||"";
    inv.supplierName = inv.supplierName||"";
    inv.partyType = "customer";
  }else{
    inv.supplierId = inv.partyId||inv.supplierId||"";
    inv.supplierName = pName;
    inv.customerId = inv.customerId||"";
    inv.customerName = inv.customerName||"";
    inv.partyType = "supplier";
  }
  return inv;
}


async function computePartyBalancesForInvoice(inv){
  const dIso=String(inv.date||"");
  const type=inv.type;
  const partyId=String(inv.partyId||"");
  const isCust=(type==="sale"||type==="sale_return");
  const types = isCust ? ["sale","sale_return"] : ["purchase","purchase_return"];
  const list=[];
  for(const t of types){
    try{ list.push(...(await loadInvoices(t))); }catch(_){}
  }
  // same party
  const relevant=list.filter(x=>String(x.partyId||"")===partyId);
  const signOf=(t)=> (t==="sale"||t==="purchase") ? 1 : -1;
  const before = relevant.filter(x=>String(x.date||"") < dIso)
                         .reduce((s,x)=>s+signOf(x.type)*n(x.net),0);
  const after = before + signOf(type)*n(inv.net);
  return {balanceBefore:before, balanceAfter:after};
}

function renderPreview(){
  if(!$("invPreview")) return;
  const type=$("posType").value;
  const whName=WAREHOUSES.find(w=>w.id===$("posWh").value)?.name||"";
  const pName=partyName(type,$("posParty").value);
  const {total,disc,net}=computeTotals();
  const pName=partyName(type,pId);
  const partyExtra = (type==="sale"||type==="sale_return") ? {
    partyId:pId,
    partyName:pName,
    partyType:"customer",
    customerId:(pId==="cash")?"cash":pId,
    customerName:(pId==="cash")?"عميل نقدي":pName,
    supplierId:"",
    supplierName:""
  } : {
    partyId:pId,
    partyName:pName,
    partyType:"supplier",
    supplierId:pId,
    supplierName:pName,
    customerId:"",
    customerName:""
  };
  const lines = POS_LINES.map(l=>`<tr><td>${l.barcode||l.code||""}</td><td>${l.name}</td><td>${fmt.format(l.qty)}</td><td>${l.unit||""}</td><td>${fmt.format(l.price)}</td><td>${fmt.format(l.qty*l.price)}</td></tr>`).join("");
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" style="max-width:56px;max-height:56px;border-radius:12px"/>`:"LOGO";
  $("invPreview").innerHTML = `
    <div class="invTop">
      <div class="invLogo">${logo}</div>
      <div class="invHeader">
        <div class="invCompany">${COMPANY.name||"MATGR MO"}</div>
        <div class="invContact">${COMPANY.address||""}</div>
        <div class="invPhone">${COMPANY.phoneSales||""}</div>
      </div>
    </div>
    <div class="invTitle">${invTitle(type)}</div>
    <div class="invMeta">
      <div><b>رقم:</b> ${LAST_INV?.no||"-"}</div>
      <div><b>تاريخ:</b> ${new Date().toLocaleString("ar-EG")}</div>
      <div><b>الطرف:</b> ${pName}</div>
      <div><b>المستودع:</b> ${whName}</div>
    </div>
    <table class="invTbl"><thead><tr><th>رمز</th><th>المادة</th><th>كمية</th><th>وحدة</th><th>سعر</th><th>قيمة</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="invFoot">
      <div class="invTotals">
        <div><span>المجموع:</span> <b>${fmt.format(total)}</b></div>
        <div><span>الحسم:</span> <b>${fmt.format(disc)}</b></div>
        <div><span>الصافي:</span> <b>${fmt.format(net)}</b></div>
      </div>
      <div class="invNote">${COMPANY.footerNote||"شكراً لتعاملكم معنا"}</div>
    </div>`;
}

function buildInvoiceJELines(type, net, payMethod){
  const lines=[];
  const cashAcc=payAccount(payMethod);
  const isCredit=payMethod==="credit";
  const ok=(acc)=>acc && ACCOUNTS.some(a=>String(a.code)===String(acc));
  const dr=(acc,amt,memo)=>ok(acc)?{account:String(acc),debit:amt,credit:0,memo:memo||""}:null;
  const cr=(acc,amt,memo)=>ok(acc)?{account:String(acc),debit:0,credit:amt,memo:memo||""}:null;

  if(type==="sale"){
    lines.push((isCredit && MAP.arControl)?dr(MAP.arControl,net,"آجل"):dr(cashAcc,net,"تحصيل"));
    lines.push(cr(MAP.salesAccount,net,"مبيعات"));
  }else if(type==="sale_return"){
    lines.push(dr(MAP.salesReturnAccount,net,"مرتجع"));
    lines.push((isCredit && MAP.arControl)?cr(MAP.arControl,net,"تخفيض آجل"):cr(cashAcc,net,"رد مبلغ"));
  }else if(type==="purchase"){
    lines.push(dr(MAP.purchaseAccount,net,"مشتريات"));
    lines.push((isCredit && MAP.apControl)?cr(MAP.apControl,net,"آجل"):cr(cashAcc,net,"دفع"));
  }else if(type==="purchase_return"){
    lines.push((isCredit && MAP.apControl)?dr(MAP.apControl,net,"تخفيض آجل"):dr(cashAcc,net,"استرداد"));
    lines.push(cr(MAP.purchaseReturnAccount,net,"مرتجع مشتريات"));
  }
  return lines.filter(Boolean);
}

async function saveInvoice(){
  if(POS_LINES.length===0){ $("posWarn").innerText="أضف بنود."; return; }
  $("posWarn").innerText="";
  const type=$("posType").value;
  const whId=$("posWh").value;
  const pay=$("posPay").value;
  const pId=$("posParty").value;
  const note=$("posNote").value.trim();
  const {total,disc,net}=computeTotals();
  const pName=partyName(type,pId);
  const partyExtra = (type==="sale"||type==="sale_return") ? {
    partyId:pId,
    partyName:pName,
    partyType:"customer",
    customerId:(pId==="cash")?"cash":pId,
    customerName:(pId==="cash")?"عميل نقدي":pName,
    supplierId:"",
    supplierName:""
  } : {
    partyId:pId,
    partyName:pName,
    partyType:"supplier",
    supplierId:pId,
    supplierName:pName,
    customerId:"",
    customerName:""
  };

  // permissions
  const permKey = {sale:"sales",sale_return:"salesReturn",purchase:"purchases",purchase_return:"purchasesReturn"}[type]||"pos";
  if(!canDo(permKey)){ $("posWarn").innerText="لا تملك صلاحية إنشاء/تعديل هذا النوع."; return; }
  if(EDITING_INVOICE_ID && !canDo("edit")){ $("posWarn").innerText="لا تملك صلاحية التعديل."; return; }

  // check lock
  const locked=parseLockedUntil();
  const invDate=new Date();
  if(invDate<=locked && !canOverrideLock()){ $("posWarn").innerText="الفترة مقفلة."; return; }

  const deltaFor=(t,qty)=>{
    if(t==="sale") return -qty;
    if(t==="sale_return") return +qty;
    if(t==="purchase") return +qty;
    if(t==="purchase_return") return -qty;
    return 0;
  };

  try{
    let result=null;

    if(!EDITING_INVOICE_ID){
      // CREATE
      result = await runTransaction(db, async (tx)=>{
        const field={sale:"invoiceSale",sale_return:"invoiceSaleReturn",purchase:"invoicePurchase",purchase_return:"invoicePurchaseReturn"}[type]||"invoiceSale";
        const no=await nextNoTx(tx,field);

        for(const l of POS_LINES){
          await adjustStockTx(tx, whId, l.itemId, deltaFor(type,n(l.qty)));
        }

        const invRef=doc(collection(db,"companies",COMPANY_ID,"invoices"));
        const jeLines=buildInvoiceJELines(type,net,pay);
        const jeRef=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));

        tx.set(invRef,{
          type,no,ts:serverTimestamp(),date:iso(),warehouseId:whId,payMethod:pay,
          ...partyExtra,note,total,discount:disc,net,
          lines:POS_LINES.map(x=>({...x})),
          jeId:jeRef.id,
          createdBy:USER.uid,createdByEmail:USER.email||""
        });

        tx.set(jeRef,{
          ts:serverTimestamp(),date:iso(),source:"invoice",invoiceId:invRef.id,invoiceType:type,
          no:`JE-${type}-${no}`,note:`قيد تلقائي - ${invTitle(type)} رقم ${no}`,lines:jeLines,
          createdBy:USER.uid,createdByEmail:USER.email||""
        });

        return {id:invRef.id,no,type};
      });

      LAST_INV=result;
      await audit("create","invoice",result.id,{type,no:result.no,net});

    }else{
      // UPDATE
      const invId=EDITING_INVOICE_ID;
      result = await runTransaction(db, async (tx)=>{
        const invRef=doc(db,"companies",COMPANY_ID,"invoices",invId);
        const snap=await tx.get(invRef);
        if(!snap.exists()) throw new Error("الفاتورة غير موجودة.");
        const old=snap.data();
        const oldType=old.type;
        const oldWh=old.warehouseId;
        if(oldType!==type) throw new Error("لا يمكن تغيير نوع الفاتورة أثناء التعديل.");
        if(oldWh!==whId) throw new Error("لا يمكن تغيير المستودع أثناء التعديل.");

        // compute diff deltas per item
        const agg=(lines,t)=>{
          const map=new Map();
          (lines||[]).forEach(l=>{
            const k=l.itemId;
            map.set(k,(map.get(k)||0)+deltaFor(t,n(l.qty)));
          });
          return map;
        };
        const oldMap=agg(old.lines, oldType);
        const newMap=agg(POS_LINES, type);

        const itemIds=new Set([...oldMap.keys(),...newMap.keys()]);
        for(const itemId of itemIds){
          const diff=(newMap.get(itemId)||0)-(oldMap.get(itemId)||0);
          if(diff!==0) await adjustStockTx(tx, whId, itemId, diff);
        }

        // update invoice
        tx.set(invRef,{
          payMethod:pay,
          ...partyExtra,
          note,total,discount:disc,net,
          lines:POS_LINES.map(x=>({...x})),
          updatedAt:serverTimestamp(),
          updatedBy:USER.uid,updatedByEmail:USER.email||""
        },{merge:true});

        // update JE
        const jeId=old.jeId;
        if(jeId){
          const jeRef=doc(db,"companies",COMPANY_ID,"journalEntries",jeId);
          tx.set(jeRef,{
            date:iso(),
            invoiceType:type,
            note:`قيد تلقائي - ${invTitle(type)} رقم ${old.no}`,
            lines:buildInvoiceJELines(type,net,pay),
            updatedAt:serverTimestamp(),
            updatedBy:USER.uid,updatedByEmail:USER.email||""
          },{merge:true});
        }

        return {id:invId,no:old.no,type};
      });

      await audit("update","invoice",result.id,{type,no:result.no,net});
      LAST_INV={id:result.id,no:result.no};

      // exit edit mode UI
      EDITING_INVOICE_ID=null;
      EDITING_INVOICE_NO=null;
      EDITING_INVOICE_TYPE=null;
      try{
        $("posType").disabled=false;
        $("posEditBanner").style.display="none";
      }catch(_){}
    }

    // update items last purchase price
    if(type==="purchase"||type==="purchase_return"){
      for(const l of POS_LINES){
        try{
          await setDoc(doc(db,"companies",COMPANY_ID,"items",l.itemId),{
            purchasePrice: Math.max(0,n(l.price)),
            updatedAt:serverTimestamp(),iso:iso()
          },{merge:true});
        }catch(_){}
      }
      // refresh cache
      ITEMS = await loadCollection("items");
    }

    // compute and store party balances for printing (non-transactional but helpful)
    try{
      const invDoc=await getDoc(doc(db,"companies",COMPANY_ID,"invoices",result.id));
      const invData=invDoc.exists()?invDoc.data():null;
      if(invData){
        const bal=await computePartyBalancesForInvoice(invData);
        await setDoc(doc(db,"companies",COMPANY_ID,"invoices",result.id),bal,{merge:true});
      }
    }catch(_){}

    renderPreview();
    showModal("تم الحفظ",`تم حفظ وترحيل ${invTitle(type)} رقم <b>${result.no}</b>.`,()=>{});
  }catch(e){
    $("posWarn").innerText=e?.message||"فشل الحفظ.";
  }
}


async function printCurrent(){
  // Backward-compatible default: A4 PDF
  await exportInvoice({format:"pdf_a4"});
}

// ---------- Printing (A4 + Receipt + PNG + Browser Print) ----------
function mmToPt(mm){ return (Number(mm)||0)*2.834645669; }
function getPrintStage(){
  let st=$("printStage");
  if(!st){
    st=document.createElement("div");
    st.id="printStage";
    st.style.position="fixed";
    st.style.left="-10000px";
    st.style.top="0";
    st.style.width="1000px";
    st.style.background="#fff";
    st.style.zIndex="-1";
    document.body.appendChild(st);
  }
  return st;
}

function receiptHTML(){
  const type=$("posType").value;
  const whName=WAREHOUSES.find(w=>w.id===$("posWh").value)?.name||"";
  const pName=partyName(type,$("posParty").value);
  const pay=$("posPay").value;
  const {total,disc,net}=computeTotals();
  const pName=partyName(type,pId);
  const partyExtra = (type==="sale"||type==="sale_return") ? {
    partyId:pId,
    partyName:pName,
    partyType:"customer",
    customerId:(pId==="cash")?"cash":pId,
    customerName:(pId==="cash")?"عميل نقدي":pName,
    supplierId:"",
    supplierName:""
  } : {
    partyId:pId,
    partyName:pName,
    partyType:"supplier",
    supplierId:pId,
    supplierName:pName,
    customerId:"",
    customerName:""
  };
  const now=new Date().toLocaleString("ar-EG");
  const no=LAST_INV?.no||"-";
  const lines=POS_LINES.map(l=>{
    const qty=fmt.format(n(l.qty));
    const price=fmt.format(n(l.price));
    const sum=fmt.format(n(l.qty)*n(l.price));
    return `
      <div class="rLine">
        <div class="rName">${(l.name||"").toString()}</div>
        <div class="rMeta">${qty} × ${price}</div>
        <div class="rSum">${sum}</div>
      </div>`;
  }).join("");
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" class="rLogo"/>`:"";
  return `
  <div class="receipt">
    <div class="rHead">
      ${logo}
      <div class="rCompany">${COMPANY.name||"MATGR MO"}</div>
      <div class="rSub">${COMPANY.address||""}</div>
      <div class="rSub">${COMPANY.phoneSales||""}</div>
    </div>
    <div class="rTitle">${invTitle(type)}</div>
    <div class="rInfo">
      <div><b>رقم</b> ${no}</div>
      <div><b>تاريخ</b> ${now}</div>
      <div><b>طرف</b> ${pName}</div>
      <div><b>دفع</b> ${pay}</div>
      <div><b>مستودع</b> ${whName}</div>
    </div>
    <div class="rDivider"></div>
    <div class="rLines">${lines||"<div class='rEmpty'>لا توجد بنود</div>"}</div>
    <div class="rDivider"></div>
    <div class="rTotals">
      <div><span>المجموع</span><b>${fmt.format(total)}</b></div>
      <div><span>الحسم</span><b>${fmt.format(disc)}</b></div>
      <div class="rNet"><span>الصافي</span><b>${fmt.format(net)}</b></div>
    </div>
    <div class="rFoot">${COMPANY.footerNote||"شكراً لتعاملكم معنا"}</div>
  </div>`;
}

async function canvasFromElement(el, scale=2){
  return await window.html2canvas(el,{scale,backgroundColor:"#ffffff"});
}

async function exportPNG(el, filename){
  const canvas=await canvasFromElement(el,2);
  const a=document.createElement("a");
  a.href=canvas.toDataURL("image/png");
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function exportPDFA4Multi(el, filename){
  const canvas=await canvasFromElement(el,2);
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF("p","pt","a4");
  const pageW=pdf.internal.pageSize.getWidth();
  const pageH=pdf.internal.pageSize.getHeight();
  const margin=24;

  // Scale canvas to page width
  const renderW=pageW-(margin*2);
  const scale=renderW/canvas.width;

  // Split into pages if needed
  const sliceH=Math.floor((pageH-(margin*2))/scale);
  let y=0;
  let page=0;
  while(y<canvas.height){
    const slice=document.createElement("canvas");
    slice.width=canvas.width;
    slice.height=Math.min(sliceH, canvas.height-y);
    const ctx=slice.getContext("2d");
    ctx.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    const img=slice.toDataURL("image/png");
    if(page>0) pdf.addPage();
    const h=slice.height*scale;
    pdf.addImage(img,"PNG",margin,margin,renderW,h);
    y += sliceH;
    page++;
  }
  pdf.save(filename);
}

async function exportPDFReceipt(el, filename){
  const canvas=await canvasFromElement(el,3);
  const img=canvas.toDataURL("image/png");
  const {jsPDF}=window.jspdf;
  const wPt=mmToPt(80);
  const hPt=Math.max(mmToPt(120), (canvas.height/canvas.width)*wPt);
  const pdf=new jsPDF({orientation:"p",unit:"pt",format:[wPt,hPt]});
  pdf.addImage(img,"PNG",0,0,wPt,hPt);
  pdf.save(filename);
}

function openPrintWindow(html, pageCss){
  const w=window.open("","_blank");
  if(!w) return showToast("لم يتم فتح نافذة الطباعة. فعّل النوافذ المنبثقة.");
  w.document.open();
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Print</title>
    <style>
      body{margin:0;padding:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; background:#fff;}
      ${pageCss||""}
    </style>
  </head><body>${html}
    <script>setTimeout(()=>{window.focus();window.print();},200);</script>
  </body></html>`);
  w.document.close();
}

async function exportInvoice(opts){
  // opts.format: pdf_a4 | pdf_receipt | png_a4 | png_receipt | print_a4 | print_receipt
  renderPreview();
  const no=LAST_INV?.no||"preview";
  const stage=getPrintStage();
  stage.innerHTML="";

  if(opts.format.includes("receipt")){
    stage.innerHTML=receiptHTML();
    const receiptEl=stage.querySelector(".receipt");
    if(opts.format==="pdf_receipt") return exportPDFReceipt(receiptEl,`receipt_${no}.pdf`);
    if(opts.format==="png_receipt") return exportPNG(receiptEl,`receipt_${no}.png`);
    if(opts.format==="print_receipt"){
      const css=`@page{size:80mm auto;margin:4mm;} .receipt{width:72mm;padding:4mm;}`;
      return openPrintWindow(receiptHTML(), css);
    }
    return;
  }

  const invEl=$("invPreview");
  if(opts.format==="pdf_a4") return exportPDFA4Multi(invEl,`invoice_${no}.pdf`);
  if(opts.format==="png_a4") return exportPNG(invEl,`invoice_${no}.png`);
  if(opts.format==="print_a4"){
    const css=`@page{size:A4;margin:12mm;} .invoice{max-width:180mm;margin:0 auto;}`;
    return openPrintWindow(invEl.outerHTML, css);
  }
}

function openPrintMenu(){
  const no=LAST_INV?.no||"preview";
  const html=`
    <div style="display:grid;gap:10px">
      <div class="hint">اختر صيغة الطباعة/التصدير للفاتورة رقم <b>${no}</b></div>
      <div class="row2">
        <button class="btn primary" id="pm_pdf_a4">PDF A4</button>
        <button class="btn" id="pm_print_a4">طباعة A4</button>
      </div>
      <div class="row2">
        <button class="btn primary" id="pm_pdf_rec">PDF حراري 80mm</button>
        <button class="btn" id="pm_print_rec">طباعة حراري</button>
      </div>
      <div class="row2">
        <button class="btn" id="pm_png_a4">صورة PNG A4</button>
        <button class="btn" id="pm_png_rec">صورة PNG حراري</button>
      </div>
      <div class="hint">لن يتم فقد أي خاصية أو تأثير على الربط مع Firebase.</div>
    </div>`;
  showModal("نماذج الطباعة", html, ()=>{});
  // Replace modal OK with close only
  $("modalOk").style.display="none";
  $("modalCancel").innerText="إغلاق";
  const bind=(id,fn)=>{ const b=$(id); if(b) b.onclick=async ()=>{ try{ await fn(); }catch(e){ showToast(e?.message||"فشل التصدير"); } }; };
  bind("pm_pdf_a4",()=>exportInvoice({format:"pdf_a4"}));
  bind("pm_print_a4",()=>exportInvoice({format:"print_a4"}));
  bind("pm_pdf_rec",()=>exportInvoice({format:"pdf_receipt"}));
  bind("pm_print_rec",()=>exportInvoice({format:"print_receipt"}));
  bind("pm_png_a4",()=>exportInvoice({format:"png_a4"}));
  bind("pm_png_rec",()=>exportInvoice({format:"png_receipt"}));

// ---------- Universal Print Menus (Invoices / Vouchers / Reports) ----------
const LAST_DOC = {
  invoice: null,          // last printed/previewed invoice object
  voucherReceipt: null,   // {kind:"receipt", no, date, note, lines, cashAccount}
  voucherPayment: null,
  opening: null,
};

function safeText(x){ return (x==null?"":String(x)); }
function payLabel(v){
  if(v==="cash") return "كاش";
  if(v==="vodafone") return "فودافون";
  if(v==="insta") return "إنستا";
  return safeText(v);
}
function findWarehouseName(id){
  return WAREHOUSES.find(w=>String(w.id)===String(id))?.name||"";
}
function companyLogoHTML(max=56){
  return COMPANY.logoDataUrl ? `<img src="${COMPANY.logoDataUrl}" style="max-width:${max}px;max-height:${max}px;border-radius:12px"/>` : "";
}


function _arabicWordsUnder1000(n){
  n=Math.floor(Math.abs(n||0));
  const ones=["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة"];
  const tens=["","عشرة","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
  const teens=["عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
  const hundreds=["","مائة","مائتان","ثلاثمائة","أربعمائة","خمسمائة","ستمائة","سبعمائة","ثمانمائة","تسعمائة"];
  let parts=[];
  const h=Math.floor(n/100);
  const r=n%100;
  if(h) parts.push(hundreds[h]);
  if(r){
    if(r<10) parts.push(ones[r]);
    else if(r<20) parts.push(teens[r-10]);
    else{
      const t=Math.floor(r/10), o=r%10;
      if(o) parts.push(ones[o]);
      parts.push(tens[t]);
    }
  }
  return parts.filter(Boolean).join(" و ");
}
function arabicNumberWords(n){
  n=Math.floor(Math.abs(n||0));
  if(n===0) return "صفر";
  const units=[
    {v:1e6, s:"مليون", d:"مليونان", p:"ملايين"},
    {v:1e3, s:"ألف", d:"ألفان", p:"آلاف"},
  ];
  let parts=[];
  for(const u of units){
    const q=Math.floor(n/u.v);
    if(q){
      if(q===1) parts.push(u.s);
      else if(q===2) parts.push(u.d);
      else if(q<=10) parts.push(_arabicWordsUnder1000(q)+" "+u.p);
      else parts.push(_arabicWordsUnder1000(q)+" "+u.s);
      n = n % u.v;
    }
  }
  if(n) parts.push(_arabicWordsUnder1000(n));
  return parts.join(" و ");
}
function moneyWordsEGP(amount){
  const v=Math.round((Number(amount)||0)*100)/100;
  const egp=Math.floor(Math.abs(v));
  const pias=Math.round((Math.abs(v)-egp)*100);
  let s=`فقط ${arabicNumberWords(egp)} جنيه مصري`;
  if(pias) s += ` و ${arabicNumberWords(pias)} قرش`;
  return s + " لا غير";
}

function invoiceA4HTMLFrom(inv){
  const whName=findWarehouseName(inv.warehouseId);
  const dateStr = inv.date ? new Date(inv.date).toLocaleDateString("ar-EG") : new Date().toLocaleDateString("ar-EG");
  const timeStr = inv.date ? new Date(inv.date).toLocaleTimeString("ar-EG") : new Date().toLocaleTimeString("ar-EG");
  const lines=(inv.lines||[]).map(l=>{
    const qty=n(l.qty), price=n(l.price);
    const sum=qty*price;
    return `<tr>
      <td class="tdCode">${safeText(l.barcode||l.code||"")}</td>
      <td class="tdName">${safeText(l.name||"")}</td>
      <td class="tdQty">${fmt.format(qty)}</td>
      <td class="tdUnit">${safeText(l.unit||"")}</td>
      <td class="tdPrice">${fmt.format(price)}</td>
      <td class="tdSum">${fmt.format(sum)}</td>
    </tr>`;
  }).join("");

  const total=n(inv.total), disc=n(inv.discount), net=n(inv.net);
  const title=invTitle(inv.type||"sale");
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" class="invLogo"/>`:`<div class="invLogoPh">LOGO</div>`;

  const phone= safeText(COMPANY.phoneSales||"");
  const wa= safeText(COMPANY.whatsapp||"");
  const tg= safeText(COMPANY.telegram||"");
  const fb= safeText(COMPANY.facebook||"");
  const amountWords = moneyWordsEGP(net);

  const balBefore = (inv.balanceBefore!=null)? n(inv.balanceBefore): null;
  const balAfter  = (inv.balanceAfter!=null)? n(inv.balanceAfter): null;
  const isCust = (inv.type==="sale"||inv.type==="sale_return");
  const balLbl = isCust ? "رصيد العميل" : "رصيد المورد";

  return `
  <div class="pdoc invoice invoicePro">
    <div class="invTop">
      <div class="invBrand">${logo}</div>

      <div class="invContacts">
        <div class="invContactTitle">Contact Sales</div>
        <div class="invIcons">
          ${wa?`<span class="invIcon wa" title="WhatsApp"></span>`:""}
          ${tg?`<span class="invIcon tg" title="Telegram"></span>`:""}
          ${fb?`<span class="invIcon fb" title="Facebook"></span>`:""}
        </div>
        <div class="invPhone">${phone}</div>
      </div>

      <div class="invMetaBox">
        <div class="invMetaLine"><span>رقم الفاتورة:</span><b>${safeText(inv.no||"-")}</b></div>
        <div class="invMetaLine"><span>التاريخ:</span><b>${dateStr}</b></div>
        <div class="invMetaLine"><span>الوقت:</span><b>${timeStr}</b></div>
      </div>
    </div>

    <div class="invTitleRow">
      <div class="invDocTitle">${safeText(title)}</div>
    </div>

    <div class="invPartyRow">
      <div class="invPartyRight">
        <div class="invPartyLine"><span>السيد:</span> <b>${safeText(inv.partyName||"")}</b></div>
        <div class="invPartyLine"><span>البيان:</span> <span>${safeText(inv.note||"")}</span></div>
      </div>
      <div class="invPartyLeft">
        <div class="invPartyLine"><span>المستودع:</span> <b>${safeText(whName)}</b></div>
        <div class="invPartyLine"><span>الدفع:</span> <b>${safeText(payLabel(inv.payMethod))}</b></div>
      </div>
    </div>

    <div class="invTableWrap">
      <table class="invTbl">
        <thead>
          <tr>
            <th class="thCode">باركود</th>
            <th class="thName">اسم المادة</th>
            <th class="thQty">الكمية</th>
            <th class="thUnit">الوحدة</th>
            <th class="thPrice">السعر</th>
            <th class="thSum">القيمة</th>
          </tr>
        </thead>
        <tbody>${lines||`<tr><td colspan="6" class="hint">لا توجد بنود</td></tr>`}</tbody>
      </table>
    </div>

    <div class="invBottom">
      <div class="invTotals">
        <div class="invTotRow"><span>المجموع:</span><b>${fmt.format(total)}</b></div>
        <div class="invTotRow"><span>إجمالي الحسميات:</span><b>${fmt.format(disc)}</b></div>
        <div class="invTotRow invNet"><span>المجموع النهائي:</span><b>${fmt.format(net)}</b></div>
      </div>

      <div class="invWords">
        <div class="invWordsText">${amountWords}</div>
        <div class="invBalances">
          ${balBefore==null?"":`<div><span>${balLbl} قبل الفاتورة:</span> <b>${fmt.format(balBefore)}</b></div>`}
          ${balAfter==null?"":`<div><span>${balLbl} بعد الفاتورة:</span> <b>${fmt.format(balAfter)}</b></div>`}
        </div>
      </div>
    </div>

  </div>`;
}

function invoiceReceiptHTMLFrom(inv){
  const whName=findWarehouseName(inv.warehouseId);
  const dateStr = inv.date ? new Date(inv.date).toLocaleString("ar-EG") : new Date().toLocaleString("ar-EG");
  const no=safeText(inv.no||"-");
  const title=invTitle(inv.type||"sale");
  const lines=(inv.lines||[]).map(l=>{
    const qty=fmt.format(n(l.qty));
    const price=fmt.format(n(l.price));
    const sum=fmt.format(n(l.qty)*n(l.price));
    return `
      <div class="rLine">
        <div class="rName">${safeText(l.name||"")}</div>
        <div class="rMeta">${qty} × ${price}</div>
        <div class="rSum">${sum}</div>
      </div>`;
  }).join("");
  const total=fmt.format(n(inv.total));
  const disc=fmt.format(n(inv.discount));
  const net=fmt.format(n(inv.net));
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" class="rLogo"/>`:"";
  return `
  <div class="receipt">
    <div class="rHead">
      ${logo}
      <div class="rCompany">${safeText(COMPANY.name||"MATGR MO")}</div>
      <div class="rSmall">${safeText(COMPANY.address||"")}</div>
      <div class="rSmall">${safeText(COMPANY.phoneSales||"")}</div>
    </div>
    <div class="rTitle">${title}</div>
    <div class="rSmall">رقم: <b>${no}</b></div>
    <div class="rSmall">تاريخ: ${dateStr}</div>
    <div class="rSmall">الطرف: ${safeText(inv.partyName||"")}</div>
    <div class="rSmall">المستودع: ${safeText(whName)}</div>
    <div class="rSmall">الدفع: ${payLabel(inv.payMethod)}</div>
    <div class="rDivider"></div>
    ${lines||`<div class="hint">لا توجد بنود</div>`}
    <div class="rDivider"></div>
    <div class="rTot"><span>الإجمالي</span><b>${total}</b></div>
    <div class="rTot"><span>خصم</span><b>${disc}</b></div>
    <div class="rTot net"><span>الصافي</span><b>${net}</b></div>
    <div class="rDivider"></div>
    <div class="rSmall">شكراً لتعاملكم معنا</div>
  </div>`;
}

function voucherPrintA4HTMLFrom(kind, data){
  const title = kind==="receipt" ? "سند قبض" : "سند دفع";
  const dateStr = data?.date ? new Date(data.date).toLocaleString("ar-EG") : new Date().toLocaleString("ar-EG");
  const no = safeText(data?.no||"-");
  const note = safeText(data?.note||"");
  const lines=(data?.lines||[]).map(l=>`<tr><td>${safeText(l.name||l.account||"")}</td><td>${fmt.format(n(l.debit))}</td><td>${fmt.format(n(l.credit))}</td><td>${safeText(l.memo||"")}</td></tr>`).join("");
  const dr=(data?.lines||[]).reduce((s,l)=>s+n(l.debit),0);
  const cr=(data?.lines||[]).reduce((s,l)=>s+n(l.credit),0);
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" class="pLogo"/>`:`<div class="pLogoPh">LOGO</div>`;
  return `
  <div class="pdoc voucher">
    <div class="pHead">
      <div class="pBrand">${logo}</div>
      <div class="pCo">
        <div class="pCoName">${safeText(COMPANY.name||"MATGR MO")}</div>
        <div class="pCoInfo">${safeText(COMPANY.address||"")}</div>
        <div class="pCoInfo">${safeText(COMPANY.phoneSales||"")}</div>
      </div>
      <div class="pMeta">
        <div><b>رقم:</b> ${no}</div>
        <div><b>تاريخ:</b> ${dateStr}</div>
      </div>
    </div>

    <div class="pTitle">${title}</div>

    <div class="pMetaGrid">
      <div><b>البيان:</b> ${note}</div>
      <div><b>المدين:</b> ${fmt.format(dr)}</div>
      <div><b>الدائن:</b> ${fmt.format(cr)}</div>
    </div>

    <div class="tableWrap pTable">
      <table class="tbl">
        <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th></tr></thead>
        <tbody>${lines||`<tr><td colspan="4" class="hint">لا توجد بنود</td></tr>`}</tbody>
      </table>
    </div>

    <div class="pFoot">
      <div class="pSign"><div class="pSignLbl">استلمت</div><div class="pSignLine"></div></div>
      <div class="pSign"><div class="pSignLbl">المحاسب</div><div class="pSignLine"></div></div>
      <div class="pSign"><div class="pSignLbl">المدير</div><div class="pSignLine"></div></div>
    </div>
  </div>`;
}


function openingPrintA4HTMLFrom(data){
  const title="قيد افتتاحي";
  const dateStr = data?.date ? new Date(data.date).toLocaleString("ar-EG") : new Date().toLocaleString("ar-EG");
  const note = safeText(data?.note||"");
  const lines=(data?.lines||[]).map(l=>`<tr><td>${safeText(l.name||l.account||"")}</td><td>${fmt.format(n(l.debit))}</td><td>${fmt.format(n(l.credit))}</td><td>${safeText(l.memo||"")}</td></tr>`).join("");
  const dr=(data?.lines||[]).reduce((s,l)=>s+n(l.debit),0);
  const cr=(data?.lines||[]).reduce((s,l)=>s+n(l.credit),0);
  const logo=COMPANY.logoDataUrl?`<img src="${COMPANY.logoDataUrl}" class="pLogo"/>`:`<div class="pLogoPh">LOGO</div>`;
  return `
  <div class="pdoc voucher">
    <div class="pHead">
      <div class="pBrand">${logo}</div>
      <div class="pCo">
        <div class="pCoName">${safeText(COMPANY.name||"MATGR MO")}</div>
        <div class="pCoInfo">${safeText(COMPANY.address||"")}</div>
        <div class="pCoInfo">${safeText(COMPANY.phoneSales||"")}</div>
      </div>
      <div class="pMeta">
        <div><b>تاريخ:</b> ${dateStr}</div>
      </div>
    </div>

    <div class="pTitle">${title}</div>

    <div class="pMetaGrid">
      <div><b>البيان:</b> ${note}</div>
      <div><b>المدين:</b> ${fmt.format(dr)}</div>
      <div><b>الدائن:</b> ${fmt.format(cr)}</div>
    </div>

    <div class="tableWrap pTable">
      <table class="tbl">
        <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th></tr></thead>
        <tbody>${lines||`<tr><td colspan="4" class="hint">لا توجد بنود</td></tr>`}</tbody>
      </table>
    </div>

    <div class="pFoot">
      <div class="pSign"><div class="pSignLbl">المحاسب</div><div class="pSignLine"></div></div>
      <div class="pSign"><div class="pSignLbl">المدير</div><div class="pSignLine"></div></div>
      <div class="pSign"><div class="pSignLbl">اعتماد</div><div class="pSignLine"></div></div>
    </div>
  </div>`;
}

function openUniversalPrintMenu(opts){
  // opts: {title, filenameBase, a4HTML, receiptHTML?}
  const html=`
    <div style="display:grid;gap:10px">
      <div class="hint">اختر صيغة الطباعة/التصدير لـ <b>${safeText(opts.title||"المستند")}</b></div>

      <div class="row2">
        <button class="btn primary" id="u_pm_pdf_a4">PDF A4</button>
        <button class="btn" id="u_pm_print_a4">طباعة A4</button>
      </div>
      <div class="row2">
        <button class="btn" id="u_pm_png_a4">صورة PNG (A4)</button>
        <button class="btn ghost" id="u_pm_close">إغلاق</button>
      </div>

      ${opts.receiptHTML?`
      <div class="divider"></div>
      <div class="row2">
        <button class="btn primary" id="u_pm_pdf_rec">PDF حراري 80mm</button>
        <button class="btn" id="u_pm_print_rec">طباعة حراري</button>
      </div>
      <div class="row2">
        <button class="btn" id="u_pm_png_rec">صورة PNG (80mm)</button>
        <div></div>
      </div>`:""}
    </div>`;
  showModal("طباعة/تصدير", html, ()=>{});
  $("modalCancel").style.display="none";
  $("modalOk").style.display="none";
  $("u_pm_close").onclick=closeModal;

  const a4Stage=()=>{
    const st=getPrintStage(); st.innerHTML=opts.a4HTML||""; return st.firstElementChild||st;
  };
  const recStage=()=>{
    const st=getPrintStage(); st.innerHTML=opts.receiptHTML||""; return st.querySelector(".receipt")||st.firstElementChild||st;
  };

  bind("u_pm_pdf_a4", async ()=>{ try{ await exportPDFA4Multi(a4Stage(), `${opts.filenameBase||"doc"}.pdf`); }catch(e){ showToast("فشل تصدير PDF"); } });
  bind("u_pm_png_a4", async ()=>{ try{ await exportPNG(a4Stage(), `${opts.filenameBase||"doc"}.png`); }catch(e){ showToast("فشل تصدير PNG"); } });
  bind("u_pm_print_a4", ()=>{ 
    const css=`@page{size:A4;margin:12mm;} body{background:#fff;} .pdoc{max-width:180mm;margin:0 auto;} .invoice{max-width:180mm;}`;
    openPrintWindow(opts.a4HTML, css);
  });

  if(opts.receiptHTML){
    bind("u_pm_pdf_rec", async ()=>{ try{ await exportPDFReceipt(recStage(), `${opts.filenameBase||"doc"}_80mm.pdf`); }catch(e){ showToast("فشل تصدير PDF"); } });
    bind("u_pm_png_rec", async ()=>{ try{ await exportPNG(recStage(), `${opts.filenameBase||"doc"}_80mm.png`); }catch(e){ showToast("فشل تصدير PNG"); } });
    bind("u_pm_print_rec", ()=>{ 
      const css=`@page{size:80mm auto;margin:4mm;} .receipt{width:72mm;padding:4mm;}`;
      openPrintWindow(opts.receiptHTML, css);
    });
  }
}
}

// ---------- POS mount ----------
function mountPOS(){
  const v=$("view_pos");
  v.innerHTML=posHTML();

  fillSelect($("posWh"), WAREHOUSES.length?WAREHOUSES:[{id:"main",name:"المستودع الرئيسي"}], w=>w.name||w.id);
  fillSelect($("posItem"), ITEMS, it=>`${(it.barcode||it.code||it.id)} - ${it.name||""}`);

  // datalist for quick code entry
  const dl=$("itemsList");
  if(dl){
    dl.innerHTML = ITEMS.map(it=>{
      const v = safeText(it.barcode || it.code || it.id);
      const label = safeText((it.name||"") + (it.code?` (رمز:${it.code})`:""));
      return `<option value="${v}">${label}</option>`;
    }).join("");
  }

  function currentItem(){ return ITEMS.find(i=>i.id===$("posItem").value) || null; }
  function setPriceByType(){
    const type=$("posType").value;
    const it=currentItem();
    const priceEl=$("posPrice");
    const hint=$("posItemHint");
    if(!it){ if(hint) hint.textContent=""; return; }
    const isPurchase = (type==="purchase"||type==="purchase_return");
    const base = isPurchase ? n(it.purchasePrice||0) : n(it.price||0);
    if(hint){
      hint.textContent = `${safeText(it.name||"")} • وحدة: ${safeText(it.unit||"")} • ${isPurchase?"آخر شراء":"سعر بيع"}: ${fmt.format(base)}`;
    }
    // lock price input for non-admin on purchases
    if(isPurchase && role()!=="admin"){
      priceEl.value = String(base||0);
      priceEl.disabled = true;
      priceEl.title = "السعر في المشتريات يمكن تعديله للأدمن فقط";
    }else{
      if(priceEl.disabled) priceEl.disabled=false;
      if(!priceEl.value) priceEl.value = String(base||0);
      priceEl.title = "";
    }
  }

  $("posCode").oninput=()=>{
    const q=$("posCode").value.trim();
    const ql=q.toLowerCase();
    // filter by BARCODE primarily, also allow partial name search
    const matches = q ? ITEMS.filter(it=>{
      const bc=String(it.barcode||"").trim();
      const code=String(it.code||it.id||"").trim();
      const name=String(it.name||"").toLowerCase();
      return (bc && bc.includes(q)) || name.includes(ql) || (!bc && code===q);
    }) : ITEMS.slice();

    // refresh dropdown items (limit to avoid huge lists)
    fillSelect($("posItem"), matches.slice(0,120), it=>`${(it.barcode||it.code||it.id)} - ${it.name||""}`);
    if(matches.length===1){
      $("posItem").value = matches[0].id;
      setPriceByType();
    }else{
      // try exact barcode match
      const exact = matches.find(it=>String(it.barcode||"").trim()===q) || null;
      if(exact){ $("posItem").value = exact.id; setPriceByType(); }
    }
  };
  $("posItem").onchange=()=>{
    const it=currentItem();
    $("posCode").value = it ? String(it.barcode||it.code||it.id) : "";
    $("posPrice").value="";
    setPriceByType();
  };
  $("posType").onchange=()=>{POS_LINES=[]; renderPosLines(); fillParty(); $("posPrice").value=""; setPriceByType(); renderPreview();};
  $("posDiscAmt").oninput=()=>{computeTotals(); renderPreview();};
  $("posDiscPct").oninput=()=>{computeTotals(); renderPreview();};
  $("posPay").onchange=renderPreview;
  $("posWh").onchange=renderPreview;
  $("posParty").onchange=renderPreview;

  async function fillParty(){
    const type=$("posType").value;
    const sel=$("posParty");
    sel.innerHTML="";

    // Always reload parties here to avoid stale lists (fix: newly added customer/supplier not showing)
    try{ CUSTOMERS = await loadList("customers","name"); }catch(_){}
    try{ SUPPLIERS = await loadList("suppliers","name"); }catch(_){}

    if(type==="sale"||type==="sale_return"){
      sel.innerHTML += `<option value="cash">عميل نقدي</option>`;
      (CUSTOMERS||[]).forEach(c=>sel.innerHTML += `<option value="${c.id}">${safeText(c.name||"")}</option>`);
    }else{
      if(!SUPPLIERS || SUPPLIERS.length===0) sel.innerHTML += `<option value="sup">مورد افتراضي</option>`;
      (SUPPLIERS||[]).forEach(s=>sel.innerHTML += `<option value="${s.id}">${safeText(s.name||"")}</option>`);
    }
  }
  window.POS_FILL_PARTY = fillParty;
  fillParty();
  setPriceByType();

  $("posAdd").onclick=async ()=>{
    $("posWarn").innerText="";
    const type=$("posType").value;
    const whId=$("posWh").value;
    const itemId=$("posItem").value;
    const qty=Math.max(1,n($("posQty").value));
    const override=$("posPrice").value.trim();
    const item=ITEMS.find(i=>i.id===itemId);
    if(!item){$("posWarn").innerText="اختر مادة";return;}
    const delta=(type==="sale"||type==="purchase_return")?-qty:+qty;
    if(delta<0){
      const cur=await stockQty(whId,itemId);
      if(cur+delta<0){$("posWarn").innerText="الكمية لا تسمح";return;}
    }
    const isPurchase=(type==="purchase"||type==="purchase_return");
    const defaultPrice=isPurchase?n(item.purchasePrice||0):n(item.price||0);
    let price=Math.max(0,defaultPrice);
    if(isPurchase && role()!=="admin"){
      // locked
      price=Math.max(0,defaultPrice);
    }else if(override){
      price=Math.max(0,n(override));
    }
    POS_LINES.push({itemId, barcode:item.barcode||"", code:item.code||"", name:item.name||"", unit:item.unit||"", qty, price});
    $("posPrice").value="";
    renderPosLines(); renderPreview();
  };

  $("posSave").onclick=saveInvoice;
  $("posPrint").onclick=openPrintMenu;

  renderPosLines(); renderPreview();
}
async function openInvoiceForEdit(inv){
  if(!canDo("edit")){ toast("لا تملك صلاحية التعديل."); return; }
  // load fresh invoice doc to ensure jeId exists
  try{
    const snap=await getDoc(doc(db,"companies",COMPANY_ID,"invoices",inv.id));
    if(snap.exists()) inv={id:inv.id,...snap.data()};
  }catch(_){}
  EDITING_INVOICE_ID=inv.id;
  EDITING_INVOICE_NO=inv.no;
  EDITING_INVOICE_TYPE=inv.type;

  setView("pos");
  $("posType").value=inv.type;
  $("posType").dispatchEvent(new Event("change"));
  $("posType").disabled=true;

  $("posWh").value=inv.warehouseId||"main";
  $("posPay").value=inv.payMethod||"cash";
  $("posParty").value=inv.partyId||((inv.type==="sale"||inv.type==="sale_return")?"cash":"sup");
  $("posNote").value=inv.note||"";

  POS_LINES = (inv.lines||[]).map(l=>({
    itemId:l.itemId,
    barcode:l.barcode||"",
    code:l.code||"",
    name:l.name||"",
    unit:l.unit||"",
    qty:n(l.qty),
    price:n(l.price)
  }));
  renderPosLines(); renderPreview();
  try{
    const b=$("posEditBanner");
    b.style.display="block";
    b.innerHTML = `وضع التعديل: <b>${invTitle(inv.type)}</b> رقم <b>${safeText(inv.no)}</b> <button class="btn sm danger" id="posCancelEdit">إلغاء التعديل</button>`;
    $("posCancelEdit").onclick=()=>{
      EDITING_INVOICE_ID=null; EDITING_INVOICE_NO=null; EDITING_INVOICE_TYPE=null;
      $("posType").disabled=false;
      b.style.display="none";
      POS_LINES=[]; renderPosLines(); renderPreview();
      toast("تم إلغاء وضع التعديل.");
    };
  }catch(_){}
}

function confirmDeleteInvoice(inv){
  if(!canDo("delete")){ toast("لا تملك صلاحية الحذف."); return; }
  showModal("تأكيد الحذف",`
    <div style="line-height:1.9">
      هل أنت متأكد من حذف <b>${invTitle(inv.type)}</b> رقم <b>${safeText(inv.no)}</b> ؟<br>
      سيتم عكس حركة المخزون وحذف القيد المحاسبي المرتبط.
    </div>
  `, async ()=>{
    await deleteInvoice(inv);
  });
}

async function deleteInvoice(inv){
  try{
    const invId=inv.id;
    const invRef=doc(db,"companies",COMPANY_ID,"invoices",invId);

    // Use transaction to reverse stock and delete invoice doc
    const snap=await getDoc(invRef);
    if(!snap.exists()){ toast("الفاتورة غير موجودة."); return; }
    const data=snap.data();
    const type=data.type;
    const whId=data.warehouseId;
    const deltaFor=(t,qty)=>{
      if(t==="sale") return -qty;
      if(t==="sale_return") return +qty;
      if(t==="purchase") return +qty;
      if(t==="purchase_return") return -qty;
      return 0;
    };

    await runTransaction(db, async (tx)=>{
      const s=await tx.get(invRef);
      if(!s.exists()) return;
      const d=s.data();
      (d.lines||[]).forEach(l=>{
        const rev = -deltaFor(d.type,n(l.qty)); // reverse
        if(rev!==0) adjustStockTx(tx, d.warehouseId, l.itemId, rev);
      });
      tx.delete(invRef);
      if(d.jeId){
        const jeRef=doc(db,"companies",COMPANY_ID,"journalEntries",d.jeId);
        tx.delete(jeRef);
      }
    });

    await audit("delete","invoice",invId,{type,no:data.no||"",net:n(data.net)});
    toast("تم حذف الفاتورة.");

  }catch(e){
    showError(e?.message||e);
    toast("فشل الحذف.");
  }
}


// ---------- CRUD masters with Excel ----------
function mountItems(){
  const v=$("view_items");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">إضافة مادة</div>
      <div class="row2">
        <div class="field"><label>كود</label><input id="i_code" placeholder="110001"/></div>
        <div class="field"><label>اسم</label><input id="i_name" placeholder="قماش سنجل"/></div>
      </div>
      <div class="row2">
        <div class="field grow" style="grid-column: span 2;"><label>باركود</label><input id="i_barcode" placeholder="اختياري (مثال: 1234567890)"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>وحدة</label><input id="i_unit"  placeholder="قطعة"/></div>
        <div class="field"><label>سعر بيع</label><input id="i_price" type="number" value="0" min="0"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>سعر شراء (COGS)</label><input id="i_pprice" type="number" value="0" min="0"/></div>
        <div class="field"><label>كمية افتتاحية</label><input id="i_oqty" type="number" value="0" min="0"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>مستودع</label><select id="i_wh"></select></div>
        <div class="field"><label>حالة</label><select id="i_active"><option value="true">فعال</option><option value="false">غير فعال</option></select></div>
      </div>
      <button class="btn primary" id="i_save">حفظ</button>
      <div class="row2">
        <button class="btn" id="i_export">تصدير Excel</button>
        <button class="btn" id="i_template">قالب Excel</button>
      </div>
      <div class="field"><label>استيراد Excel</label><input type="file" id="i_import" accept=".xlsx,.xls"/></div>
      <div class="hint" id="i_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">دليل المواد</div>
      <div class="row2">
        <input class="search" id="i_q" placeholder="بحث"/>
        <button class="btn" id="i_reload">تحديث</button>
      </div>
      <div class="tableWrap">
        <table class="tbl" id="i_tbl"><thead><tr><th>كود</th><th>باركود</th><th>اسم</th><th>وحدة</th><th>بيع</th><th>شراء</th><th></th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </div>`;
  fillSelect($("i_wh"), WAREHOUSES, w=>w.name||w.id);

  $("i_export").onclick=()=>exportExcel("items.xlsx", ITEMS.map(x=>({code:x.code||"",barcode:x.barcode||"",name:x.name||"",unit:x.unit||"",price:n(x.price),purchasePrice:n(x.purchasePrice),openingQty:n(x.openingQty||0),active:x.active!==false})));
  $("i_template").onclick=()=>exportExcel("items_template.xlsx",[{code:"",barcode:"",name:"",unit:"",price:0,purchasePrice:0,openingQty:0,active:true}]);
  $("i_reload").onclick=refreshItems;
  $("i_q").oninput=refreshItems;

  $("i_save").onclick=async ()=>{
    if(!can(["admin","accountant"])) return $("i_msg").innerText="لا تملك صلاحية.";
    const name=$("i_name").value.trim(); if(!name) return $("i_msg").innerText="الاسم مطلوب.";
    const docRef=await addDoc(collection(db,"companies",COMPANY_ID,"items"),{
      code:$("i_code").value.trim(),
      barcode:($("i_barcode").value.trim()||$("i_code").value.trim()),
      name,unit:$("i_unit").value.trim(),
      price:Math.max(0,n($("i_price").value)),
      purchasePrice:Math.max(0,n($("i_pprice").value)),
      active:$("i_active").value==="true",
      createdAt:serverTimestamp(),iso:iso()
    });
    const oq=Math.max(0,n($("i_oqty").value));
    if(oq>0){
      const wh=$("i_wh").value;
      await setDoc(doc(db,"companies",COMPANY_ID,"stock",`${wh}__${docRef.id}`),{warehouseId:wh,itemId:docRef.id,qty:oq,updatedAt:serverTimestamp(),iso:iso()},{merge:true});
    }
    await audit("create","item",docRef.id,{name});
    ["i_code","i_barcode","i_name","i_unit"].forEach(id=>$(id).value=""); $("i_price").value="0"; $("i_pprice").value="0"; $("i_oqty").value="0";
    $("i_msg").innerText="تم الحفظ.";
    await refreshAll();
  };

  $("i_import").onchange=async (ev)=>{
    if(!can(["admin","accountant"])) return $("i_msg").innerText="لا تملك صلاحية.";
    const file=ev.target.files?.[0]; if(!file) return;
    const data=await file.arrayBuffer();
    const wb=window.XLSX.read(data,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=window.XLSX.utils.sheet_to_json(ws,{defval:""});
    const wh=$("i_wh").value;
    let cnt=0;
    for(const r of rows){
      const name=String(r.name||"").trim(); if(!name) continue;
      const docRef=await addDoc(collection(db,"companies",COMPANY_ID,"items"),{
        code:String(r.code||"").trim(),
        barcode:String(r.barcode||r.Barcode||r.BARCODE||r["باركود"]||r["BARCODE"]||"").trim() || String(r.code||"").trim(),
        name,unit:String(r.unit||"").trim(),
        price:Math.max(0,n(r.price)),purchasePrice:Math.max(0,n(r.purchasePrice)),
        active:String(r.active||"true").toLowerCase()!=="false",
        createdAt:serverTimestamp(),iso:iso()
      });
      const oq=Math.max(0,n(r.openingQty)); if(oq>0){
        await setDoc(doc(db,"companies",COMPANY_ID,"stock",`${wh}__${docRef.id}`),{warehouseId:wh,itemId:docRef.id,qty:oq,updatedAt:serverTimestamp(),iso:iso()},{merge:true});
      }
      cnt++;
    }
    await audit("import","items","excel",{count:cnt});
    $("i_msg").innerText=`تم استيراد ${cnt}`;
    ev.target.value="";
    await refreshAll();
  };
}

function mountCustomers(){
  const v=$("view_customers");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">إضافة عميل</div>
      <div class="row2">
        <div class="field"><label>اسم</label><input id="c_name"/></div>
        <div class="field"><label>هاتف</label><input id="c_phone"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>عنوان</label><input id="c_addr"/></div>
        <div class="field"><label>ملاحظة</label><input id="c_note"/></div>
      </div>
      <button class="btn primary" id="c_save">حفظ</button>
      <div class="row2">
        <button class="btn" id="c_export">تصدير Excel</button>
        <button class="btn" id="c_template">قالب Excel</button>
      </div>
      <div class="field"><label>استيراد Excel</label><input type="file" id="c_import" accept=".xlsx,.xls"/></div>
      <div class="hint" id="c_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">دليل العملاء</div>
      <div class="row2">
        <input class="search" id="c_q" placeholder="بحث"/>
        <button class="btn" id="c_reload">تحديث</button>
      </div>
      <div class="tableWrap"><table class="tbl" id="c_tbl"><thead><tr><th>اسم</th><th>هاتف</th><th>عنوان</th><th></th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>`;
  $("c_export").onclick=()=>exportExcel("customers.xlsx",CUSTOMERS.map(x=>({name:x.name||"",phone:x.phone||"",address:x.address||"",note:x.note||""})));
  $("c_template").onclick=()=>exportExcel("customers_template.xlsx",[{name:"",phone:"",address:"",note:""}]);
  $("c_reload").onclick=refreshCustomers;
  $("c_q").oninput=refreshCustomers;
  $("c_save").onclick=async ()=>{
    if(!can(["admin","accountant","cashier"])) return $("c_msg").innerText="لا تملك صلاحية.";
    const name=$("c_name").value.trim(); if(!name) return $("c_msg").innerText="الاسم مطلوب.";
    const ref=await addDoc(collection(db,"companies",COMPANY_ID,"customers"),{
      name,phone:$("c_phone").value.trim(),address:$("c_addr").value.trim(),note:$("c_note").value.trim(),
      active:true,createdAt:serverTimestamp(),iso:iso()
    });
    await audit("create","customer",ref.id,{name});
    ["c_name","c_phone","c_addr","c_note"].forEach(id=>$(id).value="");
    $("c_msg").innerText="تم الحفظ.";
    await refreshAll();
  };
  $("c_import").onchange=async (ev)=>{
    if(!can(["admin","accountant"])) return $("c_msg").innerText="لا تملك صلاحية.";
    const file=ev.target.files?.[0]; if(!file) return;
    const data=await file.arrayBuffer();
    const wb=window.XLSX.read(data,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=window.XLSX.utils.sheet_to_json(ws,{defval:""});
    let cnt=0;
    for(const r of rows){
      const name=String(r.name||"").trim(); if(!name) continue;
      await addDoc(collection(db,"companies",COMPANY_ID,"customers"),{
        name,phone:String(r.phone||"").trim(),address:String(r.address||"").trim(),note:String(r.note||"").trim(),
        active:true,createdAt:serverTimestamp(),iso:iso()
      });
      cnt++;
    }
    await audit("import","customers","excel",{count:cnt});
    $("c_msg").innerText=`تم استيراد ${cnt}`;
    ev.target.value="";
    await refreshAll();
  };
}

function mountSuppliers(){
  const v=$("view_suppliers");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">إضافة مورد</div>
      <div class="row2">
        <div class="field"><label>اسم</label><input id="s_name"/></div>
        <div class="field"><label>هاتف</label><input id="s_phone"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>عنوان</label><input id="s_addr"/></div>
        <div class="field"><label>ملاحظة</label><input id="s_note"/></div>
      </div>
      <button class="btn primary" id="s_save">حفظ</button>
      <div class="row2">
        <button class="btn" id="s_export">تصدير Excel</button>
        <button class="btn" id="s_template">قالب Excel</button>
      </div>
      <div class="field"><label>استيراد Excel</label><input type="file" id="s_import" accept=".xlsx,.xls"/></div>
      <div class="hint" id="s_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">دليل الموردين</div>
      <div class="row2">
        <input class="search" id="s_q" placeholder="بحث"/>
        <button class="btn" id="s_reload">تحديث</button>
      </div>
      <div class="tableWrap"><table class="tbl" id="s_tbl"><thead><tr><th>اسم</th><th>هاتف</th><th>عنوان</th><th></th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>`;
  $("s_export").onclick=()=>exportExcel("suppliers.xlsx",SUPPLIERS.map(x=>({name:x.name||"",phone:x.phone||"",address:x.address||"",note:x.note||""})));
  $("s_template").onclick=()=>exportExcel("suppliers_template.xlsx",[{name:"",phone:"",address:"",note:""}]);
  $("s_reload").onclick=refreshSuppliers;
  $("s_q").oninput=refreshSuppliers;
  $("s_save").onclick=async ()=>{
    if(!can(["admin","accountant"])) return $("s_msg").innerText="لا تملك صلاحية.";
    const name=$("s_name").value.trim(); if(!name) return $("s_msg").innerText="الاسم مطلوب.";
    const ref=await addDoc(collection(db,"companies",COMPANY_ID,"suppliers"),{
      name,phone:$("s_phone").value.trim(),address:$("s_addr").value.trim(),note:$("s_note").value.trim(),
      active:true,createdAt:serverTimestamp(),iso:iso()
    });
    await audit("create","supplier",ref.id,{name});
    ["s_name","s_phone","s_addr","s_note"].forEach(id=>$(id).value="");
    $("s_msg").innerText="تم الحفظ.";
    await refreshAll();
  };
  $("s_import").onchange=async (ev)=>{
    if(!can(["admin","accountant"])) return $("s_msg").innerText="لا تملك صلاحية.";
    const file=ev.target.files?.[0]; if(!file) return;
    const data=await file.arrayBuffer();
    const wb=window.XLSX.read(data,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=window.XLSX.utils.sheet_to_json(ws,{defval:""});
    let cnt=0;
    for(const r of rows){
      const name=String(r.name||"").trim(); if(!name) continue;
      await addDoc(collection(db,"companies",COMPANY_ID,"suppliers"),{
        name,phone:String(r.phone||"").trim(),address:String(r.address||"").trim(),note:String(r.note||"").trim(),
        active:true,createdAt:serverTimestamp(),iso:iso()
      });
      cnt++;
    }
    await audit("import","suppliers","excel",{count:cnt});
    $("s_msg").innerText=`تم استيراد ${cnt}`;
    ev.target.value="";
    await refreshAll();
  };
}

function mountAccounts(){
  const v=$("view_accounts");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">إضافة/تعديل حساب</div>
      <div class="row2">
        <div class="field"><label>كود</label><input id="a_code" placeholder="14001"/></div>
        <div class="field"><label>اسم</label><input id="a_name" placeholder="خزنة كاش"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>Parent</label><input id="a_parent" placeholder="14"/></div>
        <div class="field"><label>Level</label><input id="a_level" type="number" value="1" min="1"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>Type</label>
          <select id="a_type">
            <option value="asset">أصول</option><option value="liability">خصوم</option><option value="equity">حقوق</option>
            <option value="revenue">إيرادات</option><option value="purchase">مشتريات</option><option value="expense">مصاريف</option><option value="cogs">تكلفة</option>
          </select>
        </div>
        <div class="field"><label>allowPost</label>
          <select id="a_post"><option value="false">false</option><option value="true">true</option></select>
        </div>
      </div>
      <button class="btn primary" id="a_save">حفظ</button>
      <div class="hint" id="a_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">الشجرة</div>
      <div class="row2">
        <button class="btn" id="a_reload">تحديث</button>
        <button class="btn" id="a_export">تصدير Excel</button>
      </div>
      <div class="tree" id="a_tree"></div>
    </div>
  </div>`;
  $("a_reload").onclick=refreshAccounts;
  $("a_export").onclick=()=>exportExcel("accounts.xlsx",ACCOUNTS.map(a=>({code:a.code,name:a.name,parent:a.parent||"",level:a.level||"",type:a.type||"",allowPost:!!a.allowPost})));
  $("a_save").onclick=async ()=>{
    if(!can(["admin","accountant"])) return $("a_msg").innerText="لا تملك صلاحية.";
    const code=$("a_code").value.trim(); const name=$("a_name").value.trim();
    if(!code||!name) return $("a_msg").innerText="الكود والاسم مطلوبان.";
    await setDoc(doc(db,"companies",COMPANY_ID,"accounts",code),{
      code,name,parent:$("a_parent").value.trim(),level:n($("a_level").value)||1,type:$("a_type").value,
      allowPost:$("a_post").value==="true",updatedAt:serverTimestamp(),iso:iso()
    },{merge:true});
    await audit("upsert","account",code,{name});
    $("a_msg").innerText="تم الحفظ.";
    await refreshAll();
  };

  // Load & render tree immediately (fix: دليل الحسابات يظهر فاضي)
  try{ refreshAccounts(); }catch(_){ }
}

function buildTreeHTML(){
  const byParent={};
  const normParent=(p)=>{
    p=String(p??"").trim();
    // Some users enter 0 or - as root
    if(p==="0"||p==="-"||p==="null"||p==="undefined") return "";
    return p;
  };
  ACCOUNTS.forEach(a=>{
    const p=normParent(a.parent);
    byParent[p]=byParent[p]||[];
    byParent[p].push(a);
  });
  Object.values(byParent).forEach(arr=>arr.sort((x,y)=>String(x.code).localeCompare(String(y.code),"en")));
  const badge=(a)=>a.allowPost?'<span class="badge post">ترحيل</span>':'<span class="badge sum">تجميعي</span>';
  const rec=(p,depth)=>{
    const arr=byParent[p]||[];
    return arr.map(a=>`
      <div class="treeItem" style="margin-right:${depth*10}px">
        <div class="treeHead"><div><span class="treeCode">${a.code}</span> — ${a.name} <span class="badge">${a.type||""}</span> ${badge(a)}</div><div class="badge">L${a.level||""}</div></div>
        <div class="hint">Parent: ${a.parent||"-"}</div>
      </div>
      ${rec(String(a.code),depth+1)}
    `).join("");
  };
  return rec("",0);
}

function mountMap(){
  const v=$("view_map");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">ربط الحسابات</div>
    <div class="row3">
      <div class="field"><label>كاش</label><input id="m_cash" placeholder="14001"/></div>
      <div class="field"><label>فودافون</label><input id="m_vod" placeholder="14002"/></div>
      <div class="field"><label>إنستا</label><input id="m_insta" placeholder="14003"/></div>
    </div>
    <div class="row3">
      <div class="field"><label>مبيعات</label><input id="m_sales" placeholder="41"/></div>
      <div class="field"><label>مرتجع مبيعات</label><input id="m_sret" placeholder="42"/></div>
      <div class="field"><label>مشتريات</label><input id="m_pur" placeholder="51"/></div>
    </div>
    <div class="row3">
      <div class="field"><label>مرتجع مشتريات</label><input id="m_pret" placeholder="52"/></div>
      <div class="field"><label>حساب عملاء (اختياري)</label><input id="m_ar" placeholder=""/></div>
      <div class="field"><label>حساب موردين (اختياري)</label><input id="m_ap" placeholder=""/></div>
    </div>
    <button class="btn primary" id="m_save">حفظ</button>
    <div class="hint" id="m_msg"></div>
  </div>`;
  const set=(id,val)=>$(id).value=val||"";
  set("m_cash",MAP.cashAccount); set("m_vod",MAP.vodafoneAccount); set("m_insta",MAP.instaAccount);
  set("m_sales",MAP.salesAccount); set("m_sret",MAP.salesReturnAccount); set("m_pur",MAP.purchaseAccount);
  set("m_pret",MAP.purchaseReturnAccount); set("m_ar",MAP.arControl); set("m_ap",MAP.apControl);
  $("m_save").onclick=async ()=>{
    if(!can(["admin"])) return $("m_msg").innerText="للأدمن فقط.";
    MAP={
      cashAccount:$("m_cash").value.trim(),
      vodafoneAccount:$("m_vod").value.trim(),
      instaAccount:$("m_insta").value.trim(),
      salesAccount:$("m_sales").value.trim(),
      salesReturnAccount:$("m_sret").value.trim(),
      purchaseAccount:$("m_pur").value.trim(),
      purchaseReturnAccount:$("m_pret").value.trim(),
      arControl:$("m_ar").value.trim(),
      apControl:$("m_ap").value.trim(),
      updatedAt:serverTimestamp(),iso:iso()
    };
    await setSettingsDoc("accountingMap",MAP);
    await audit("update","map","settings",{});
    $("m_msg").innerText="تم الحفظ.";
  };
}

// ---------- Invoice pages with Add buttons ----------
function invoiceListHTML(title, addText){
  return `
  <div class="card">
    <div class="cardTitle">${title}</div>
    <div class="row3">
      <div class="field"><label>من</label><input type="date" class="from"/></div>
      <div class="field"><label>إلى</label><input type="date" class="to"/></div>
      <div class="field"><label>بحث</label><input class="q" placeholder="رقم/اسم"/></div>
    </div>
    <div class="row2">
      <button class="btn primary add">${addText}</button>
      <button class="btn load">تحميل</button>
    </div>
    <div class="row2">
      <button class="btn xlsx">تصدير Excel</button>
      <button class="btn pdf">تصدير PDF</button>
    </div>
    <div class="tableWrap">
      <table class="tbl list"><thead><tr><th>تاريخ</th><th>رقم</th><th>الطرف</th><th>الدفع</th><th>الصافي</th><th>بنود</th><th>إجراءات</th></tr></thead><tbody></tbody></table>
    </div>
  </div>`;
}
function mountInvoicePages(){
  $("view_salesInvoices").innerHTML=invoiceListHTML("فواتير المبيعات","إضافة فاتورة مبيعات");
  $("view_salesReturns").innerHTML=invoiceListHTML("مرتجع المبيعات","إضافة مرتجع مبيعات");
  $("view_purchaseInvoices").innerHTML=invoiceListHTML("فواتير المشتريات","إضافة فاتورة مشتريات");
  $("view_purchaseReturns").innerHTML=invoiceListHTML("مرتجع مشتريات","إضافة مرتجع مشتريات");
  initInvoicePage("salesInvoices","sale");
  initInvoicePage("salesReturns","sale_return");
  initInvoicePage("purchaseInvoices","purchase");
  initInvoicePage("purchaseReturns","purchase_return");
}
function mountInvoiceMoves(){
  const v=$("view_invMoves");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">حركة الفواتير</div>
    <div class="row4">
      <div class="field"><label>نوع</label>
        <select id="mv_type">
          <option value="all">الكل</option>
          <option value="sale">مبيعات</option>
          <option value="sale_return">مرتجع مبيعات</option>
          <option value="purchase">مشتريات</option>
          <option value="purchase_return">مرتجع مشتريات</option>
        </select>
      </div>
      <div class="field"><label>من</label><input id="mv_from" type="date"></div>
      <div class="field"><label>إلى</label><input id="mv_to" type="date"></div>
      <div class="field"><label>بحث</label><input id="mv_q" placeholder="رقم/اسم طرف"/></div>
    </div>
    <div class="row2">
      <button class="btn" id="mv_load">تحميل</button>
      <button class="btn" id="mv_xlsx">Excel</button>
    </div>

    <div class="tableWrap">
      <table class="tbl" id="mv_tbl">
        <thead><tr><th>تاريخ</th><th>نوع</th><th>رقم</th><th>الطرف</th><th>الدفع</th><th>الصافي</th><th>بنود</th><th>إجراءات</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="hint" id="mv_hint"></div>
  </div>`;

  const d=new Date(), f=new Date(d.getTime()-30*86400000);
  $("mv_from").value=f.toISOString().slice(0,10);
  $("mv_to").value=d.toISOString().slice(0,10);

  let last=[];
  const load=async ()=>{
    const t=$("mv_type").value;
    const from=$("mv_from").value, to=$("mv_to").value;
    const q=($("mv_q").value||"").trim();
    const types = (t==="all")?["sale","sale_return","purchase","purchase_return"]:[t];
    let list=[];
    for(const x of types){ list.push(...(await loadInvoices(x))); }
    list=list.filter(inv=>betweenIso(inv.date,from,to));
    if(q){
      list=list.filter(inv=>String(inv.no).includes(q) || String(inv.partyName||"").includes(q));
    }
    list.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""),"en"));
    last=list;

    const tb=$("mv_tbl").querySelector("tbody");
    tb.innerHTML="";
    list.forEach((inv,idx)=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`
        <td>${String(inv.date||"").slice(0,19).replace("T"," ")}</td>
        <td>${invTitle(inv.type)}</td>
        <td><b class="link" data-open="${idx}">${safeText(inv.no)}</b></td>
        <td>${safeText(inv.partyName||"")}</td>
        <td>${safeText(inv.payMethod||"")}</td>
        <td>${fmt.format(n(inv.net))}</td>
        <td>${(inv.lines||[]).length}</td>
        <td>
          <div class="tblActions">
            <button class="btn sm" data-view="${idx}">عرض</button>
            <button class="btn sm primary" data-print="${idx}">طباعة</button>
            ${canDo("edit")?`<button class="btn sm" data-edit="${idx}">تعديل</button>`:""}
            ${canDo("delete")?`<button class="btn sm danger" data-del="${idx}">حذف</button>`:""}
          </div>
        </td>`;
      tb.appendChild(tr);
    });

    const openPreview=(inv)=>{
      const a4=invoiceA4HTMLFrom(inv);
      showModal("معاينة", `<div class="printPreviewWrap">${a4}</div>`, ()=>{});
      $("modalCancel").style.display="none";
      $("modalOk").style.display="none";
    };

    tb.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPreview(last[Number(b.dataset.open)]));
    tb.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>openPreview(last[Number(b.dataset.view)]));
    tb.querySelectorAll("[data-print]").forEach(b=>b.onclick=()=>{
      const inv=last[Number(b.dataset.print)];
      if(!inv) return;
      LAST_DOC.invoice=inv;
      openUniversalPrintMenu({
        title:`${invTitle(inv.type)} رقم ${inv.no}`,
        filenameBase:`invoice_${safeText(inv.no||"")}`,
        a4HTML: invoiceA4HTMLFrom(inv),
        receiptHTML: invoiceReceiptHTMLFrom(inv)
      });
    });
    tb.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openInvoiceForEdit(last[Number(b.dataset.edit)]));
    tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>confirmDeleteInvoice(last[Number(b.dataset.del)]));

    $("mv_hint").textContent=`عدد الفواتير: ${list.length}`;
  };

  $("mv_load").onclick=load;
  $("mv_xlsx").onclick=()=>exportExcel("invoice_moves.xlsx", last.map(inv=>({
    date:String(inv.date||"").slice(0,19).replace("T"," "),
    type:invTitle(inv.type), no:inv.no, party:inv.partyName||"", pay:inv.payMethod||"",
    net:n(inv.net), lines:(inv.lines||[]).length
  })));

  load();
}


function initInvoicePage(viewId,type){
  const root=$("view_"+viewId);
  const from=root.querySelector(".from"), to=root.querySelector(".to"), q=root.querySelector(".q");
  const add=root.querySelector(".add"), load=root.querySelector(".load");
  const xlsxBtn=root.querySelector(".xlsx"), pdfBtn=root.querySelector(".pdf");
  const tbody=root.querySelector("tbody");
  const d=new Date(); const f=new Date(d.getTime()-30*86400000);
  from.value=f.toISOString().slice(0,10); to.value=d.toISOString().slice(0,10);

  let lastRows=[];      // excel/pdf list
  let lastInvoices=[];  // full invoices for actions

  async function run(){
    const list=await loadInvoices(type);
    const filtered=list.filter(inv=>{
      const dd=dateOnly(inv.date);
      if(dd<from.value||dd>to.value) return false;
      const s=q.value.trim();
      if(!s) return true;
      return String(inv.no).includes(s) || String(inv.partyName||"").includes(s) || (inv.lines||[]).some(l=>String(l.barcode||"").includes(s) || String(l.name||"").includes(s));
    });
    lastInvoices=filtered;

    lastRows=filtered.map(inv=>({
      date:String(inv.date||"").slice(0,19).replace("T"," "),
      no:inv.no,
      party:inv.partyName||"",
      pay:inv.payMethod||"",
      net:n(inv.net),
      lines:(inv.lines||[]).length
    }));

    tbody.innerHTML="";
    filtered.forEach((inv,idx)=>{
      const tr=document.createElement("tr");
      tr.innerHTML=
        `<td>${String(inv.date||"").slice(0,19).replace("T"," ")}</td>
         <td><b>${safeText(inv.no)}</b></td>
         <td>${safeText(inv.partyName||"")}</td>
         <td>${safeText(inv.payMethod||"")}</td>
         <td>${fmt.format(n(inv.net))}</td>
         <td>${(inv.lines||[]).length}</td>
         <td>
           <div class="tblActions">
             <button class="btn sm" data-view="${idx}">عرض</button>
             <button class="btn sm primary" data-print="${idx}">طباعة</button>
             ${canDo("edit")?`<button class="btn sm" data-edit="${idx}">تعديل</button>`:""}
             ${canDo("delete")?`<button class="btn sm danger" data-del="${idx}">حذف</button>`:""}
           </div>
         </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{
      const inv=lastInvoices[Number(b.dataset.view)];
      if(!inv) return;
      const a4=invoiceA4HTMLFrom(inv);
      showModal("معاينة", `<div class="printPreviewWrap">${a4}</div>`, ()=>{});
      $("modalCancel").style.display="none";
      $("modalOk").style.display="none";
    });

    tbody.querySelectorAll("[data-print]").forEach(b=>b.onclick=()=>{
      const inv=lastInvoices[Number(b.dataset.print)];
      if(!inv) return;
      LAST_DOC.invoice=inv;
      openUniversalPrintMenu({
        title:`${invTitle(inv.type)} رقم ${inv.no}`,
        filenameBase:`invoice_${safeText(inv.no||"")}`,
        a4HTML: invoiceA4HTMLFrom(inv),
        receiptHTML: invoiceReceiptHTMLFrom(inv)
      });
    });

    // edit
    tbody.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>{
      const inv=lastInvoices[Number(b.dataset.edit)];
      if(!inv) return;
      openInvoiceForEdit(inv);
    });
    // delete
    tbody.querySelectorAll("[data-del]").forEach(b=>b.onclick=async ()=>{
      const inv=lastInvoices[Number(b.dataset.del)];
      if(!inv) return;
      confirmDeleteInvoice(inv);
    });
  }

  add.onclick=()=>{
    setView("pos");
    $("posType").value=type;
    $("posType").dispatchEvent(new Event("change"));
  };
  load.onclick=run;
  xlsxBtn.onclick=()=>exportExcel(`${viewId}.xlsx`,lastRows);
  // List PDF: keep as A4 multi-page of the list itself
  pdfBtn.onclick=()=>exportPDF(root.querySelector(".card"),`${viewId}.pdf`);

  // Auto load once for convenience
  run();
}

// ---------- Inventory reports ----------

function mountInvReports(){
  const v=$("view_invReports");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">تقارير المخزون والمواد</div>

    <div class="row3">
      <div class="field"><label>المستودع</label><select id="r_wh"></select></div>
      <div class="field"><label>من</label><input id="r_from" type="date"></div>
      <div class="field"><label>إلى</label><input id="r_to" type="date"></div>
    </div>

    <div class="row3">
      <div class="field grow" style="grid-column: span 2;">
        <label>المادة</label>
        <select id="r_item">
          <option value="all">كل المواد</option>
        </select>
      </div>
      <div class="field">
        <label>بحث مادة</label>
        <input class="search" id="r_item_q" placeholder="بحث بالاسم أو الباركود"/>
      </div>
      <div class="field">
        <label>نطاق</label>
        <div class="pill" style="display:inline-flex;align-items:center;gap:8px;justify-content:center;width:100%;">تقارير مخزنية</div>
      </div>
    </div>

    <div class="row2">
      <button class="btn primary" id="r_balance">رصيد المخزون</button>
      <button class="btn" id="r_move">حركة المخزون</button>
    </div>
    <div class="row2">
      <button class="btn" id="r_valuation">تقييم المخزون بالكلفة</button>
      <button class="btn" id="r_bywh">جرد حسب المستودع</button>
    </div>

    <div class="row2">
      <button class="btn" id="r_xlsx">تصدير Excel</button>
      <button class="btn" id="r_pdf">تصدير PDF</button>
    </div>

    <div class="divider"></div>

    <div class="reportBox" id="r_box">
      <div class="reportTitle" id="r_title">-</div>
      <div class="smallHint" id="r_hint" style="color:var(--muted);margin:6px 0 10px 0;font-size:12px;"></div>
      <div class="tableWrap"><table class="tbl" id="r_tbl"><thead></thead><tbody></tbody></table></div>
    </div>
  </div>`;

  const whSel=$("r_wh");
  whSel.innerHTML = `<option value="all">كل المستودعات</option>` + WAREHOUSES.map(w=>`<option value="${w.id}">${w.name||w.id}</option>`).join("");

  const itemSel=$("r_item");
  itemSel.innerHTML = `<option value="all">كل المواد</option>` + ITEMS.map(i=>`<option value="${i.id}">${(i.barcode?("["+i.barcode+"] "):"")}${(i.code?("("+i.code+") "):"")}${i.name||""}</option>`).join("");

  const itemQ=$("r_item_q");
  const rebuildItemOptions=(list)=>{
    const cur=itemSel.value;
    itemSel.innerHTML = `<option value="all">كل المواد</option>` + list.map(i=>`<option value="${i.id}">${(i.barcode?("["+i.barcode+"] "):"")}${(i.code?("("+i.code+") "):"")}${i.name||""}</option>`).join("");
    if(cur && [...itemSel.options].some(o=>o.value===cur)) itemSel.value=cur;
  };
  if(itemQ){
    itemQ.oninput=()=>{
      const q=(itemQ.value||"").trim();
      const ql=q.toLowerCase();
      const filtered = q ? ITEMS.filter(it=>{
        const name=String(it.name||"").toLowerCase();
        const bc=String(it.barcode||"");
        const code=String(it.code||"");
        return name.includes(ql) || bc.includes(q) || code.includes(q);
      }) : ITEMS;
      rebuildItemOptions(filtered.slice(0,500));
      if(q){
        const exact = filtered.find(it=>String(it.barcode||"").trim()===q) || filtered.find(it=>String(it.code||"").trim()===q) || null;
        if(exact){ itemSel.value=exact.id; }
      }
    };
  }


  const d=new Date(); const f=new Date(d.getTime()-7*86400000);
  $("r_from").value=f.toISOString().slice(0,10);
  $("r_to").value=d.toISOString().slice(0,10);

  let lastRows=[];
  const setTable=(headers,rows)=>{
    const thead=$("r_tbl").querySelector("thead"), tbody=$("r_tbl").querySelector("tbody");
    thead.innerHTML=""; tbody.innerHTML="";
    const trh=document.createElement("tr");
    headers.forEach(h=>{const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);});
    thead.appendChild(trh);
    rows.forEach(r=>{
      const tr=document.createElement("tr");
      r.forEach(c=>{const td=document.createElement("td"); td.textContent=c; tr.appendChild(td);});
      tbody.appendChild(tr);
    });
  };

  const getStockMap = async ()=>{
    const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"stock"), limit(8000)));
    const stock={};
    snap.forEach(d=>{ if(d.id==="_init")return; const x=d.data(); stock[`${x.warehouseId}__${x.itemId}`]=n(x.qty); });
    return stock;
  };

  const whName = (whId)=> whId==="all" ? "كل المستودعات" : (WAREHOUSES.find(w=>w.id===whId)?.name||whId);

  $("r_balance").onclick=async ()=>{
    const wh=whSel.value;
    const stock=await getStockMap();
    const items = (itemSel.value==="all") ? ITEMS : ITEMS.filter(it=>it.id===itemSel.value);

    const rows=items.map(it=>{
      let qty=0;
      if(wh==="all"){ WAREHOUSES.forEach(w=>qty+= (stock[`${w.id}__${it.id}`]||0)); }
      else qty = stock[`${wh}__${it.id}`]||0;
      return [it.code||"",it.barcode||"",it.name||"",it.unit||"",fmt.format(qty)];
    });

    lastRows = rows.map(r=>({code:r[0],barcode:r[1],name:r[2],unit:r[3],qty:r[4]}));
    $("r_title").innerText=`رصيد المخزون — ${whName(wh)}`;
    $("r_hint").innerText = (itemSel.value==="all") ? "الرصيد الحالي حسب سجل المخزون." : "الرصيد الحالي للمادة المحددة.";
    setTable(["كود","باركود","اسم","وحدة","كمية"],rows);
  };

  $("r_move").onclick=async ()=>{
    const from=$("r_from").value, to=$("r_to").value, wh=whSel.value;
    const itemId=itemSel.value;

    // NOTE: loadInvoices already handles safe querying
    const invs=[
      ...(await loadInvoices("sale")),
      ...(await loadInvoices("sale_return")),
      ...(await loadInvoices("purchase")),
      ...(await loadInvoices("purchase_return"))
    ];

    const rows=[];
    invs
      .filter(inv=>{
        const dd=dateOnly(inv.date);
        if(dd<from||dd>to) return false;
        if(wh!=="all" && inv.warehouseId!==wh) return false;
        return true;
      })
      .forEach(inv=>{
        const baseDate=String(inv.date||"").slice(0,19).replace("T"," ");
        const whId=inv.warehouseId||"";
        const party = inv.customerName || inv.supplierName || inv.partyName || "";
        (inv.lines||[]).forEach(l=>{
          if(itemId!=="all" && l.itemId!==itemId) return;
          const it=ITEMS.find(x=>x.id===l.itemId);
          // sign: sale reduces stock, purchase increases stock
          const sign=(inv.type==="sale"||inv.type==="purchase_return")?-1:+1;
          const qty = sign*n(l.qty);
          rows.push([baseDate, invTitle(inv.type), String(inv.no||inv.id||""), whId, it?.code||"", it?.barcode||"", it?.name||"", fmt.format(qty), party]);
        });
      });

    lastRows = rows.map(r=>({date:r[0],type:r[1],no:r[2],warehouse:r[3],code:r[4],barcode:r[5],name:r[6],qty:r[7],party:r[8]}));
    const itemLabel = itemId==="all" ? "كل المواد" : (ITEMS.find(i=>i.id===itemId)?.name||"مادة");
    $("r_title").innerText=`حركة المخزون — ${itemLabel} (${from} → ${to})`;
    $("r_hint").innerText="(+ يعني زيادة مخزون / - يعني نقصان مخزون) — البيع ينقص، الشراء يزيد، المرتجع يعكس.";
    setTable(["تاريخ","نوع","رقم","مستودع","كود","باركود","اسم","كمية(+/-)","طرف"],rows);
  };

  $("r_valuation").onclick=async ()=>{
    const wh=whSel.value;
    const stock=await getStockMap();
    const items = (itemSel.value==="all") ? ITEMS : ITEMS.filter(it=>it.id===itemSel.value);

    let totalValue=0;
    const rows=items.map(it=>{
      let qty=0;
      if(wh==="all"){ WAREHOUSES.forEach(w=>qty+= (stock[`${w.id}__${it.id}`]||0)); }
      else qty = stock[`${wh}__${it.id}`]||0;

      const cost=n(it.purchasePrice||0);
      const val=qty*cost;
      totalValue += val;
      return [it.code||"",it.barcode||"",it.name||"",it.unit||"",fmt.format(qty),fmt.format(cost),fmt.format(val)];
    });

    lastRows = rows.map(r=>({code:r[0],barcode:r[1],name:r[2],unit:r[3],qty:r[4],cost:r[5],value:r[6]}));
    $("r_title").innerText=`تقييم المخزون بالكلفة — ${whName(wh)}`;
    $("r_hint").innerText=`القيمة = الكمية × سعر الشراء (من دليل المواد). إجمالي القيمة: ${fmt.format(totalValue)}`;
    setTable(["كود","باركود","اسم","وحدة","كمية","كلفة/وحدة","قيمة"],rows);
  };

  $("r_bywh").onclick=async ()=>{
    const stock=await getStockMap();
    const items = (itemSel.value==="all") ? ITEMS : ITEMS.filter(it=>it.id===itemSel.value);

    const headers=["كود","باركود","اسم","وحدة", ...WAREHOUSES.map(w=>w.name||w.id), "الإجمالي"];
    const rows=items.map(it=>{
      let total=0;
      const cols=WAREHOUSES.map(w=>{
        const q=stock[`${w.id}__${it.id}`]||0;
        total+=q;
        return fmt.format(q);
      });
      return [it.code||"",it.barcode||"",it.name||"",it.unit||"", ...cols, fmt.format(total)];
    });

    // export friendly
    lastRows = rows.map(r=>{
      const obj={code:r[0],barcode:r[1],name:r[2],unit:r[3]};
      WAREHOUSES.forEach((w,idx)=> obj["wh_"+(w.name||w.id)]=r[4+idx]);
      obj.total=r[r.length-1];
      return obj;
    });

    $("r_title").innerText="جرد حسب المستودع";
    $("r_hint").innerText="يعرض الكميات لكل مادة حسب كل مستودع + الإجمالي.";
    setTable(headers,rows);
  };

  $("r_xlsx").onclick=()=>exportExcel("inventory_reports.xlsx", lastRows);
  $("r_pdf").onclick=()=>exportPDF($("r_box"),"inventory_reports.pdf");
}


// ---------- Vouchers ----------
function voucherHTML(title, kind){
  return `
  <div class="card">
    <div class="cardTitle">${title}</div>
    <div class="row3">
      <div class="field"><label>تاريخ</label><input id="${kind}_dt" type="datetime-local"></div>
      <div class="field"><label>الخزنة</label><select id="${kind}_cash"></select></div>
      <div class="field"><label>البيان</label><input id="${kind}_note" placeholder="اختياري"></div>
    </div>

    <div class="divider"></div>

    <div class="row3">
      <div class="field"><label>الحساب</label><select id="${kind}_acc"></select></div>
      <div class="field"><label>المبلغ</label><input id="${kind}_amt" type="number" value="0" min="0"></div>
      <div class="field"><label>ملاحظة</label><input id="${kind}_memo" placeholder="اختياري"></div>
    </div>
    <button class="btn" id="${kind}_add">إضافة بند</button>

    <div class="tableWrap">
      <table class="tbl" id="${kind}_tbl"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th><th></th></tr></thead><tbody></tbody></table>
    </div>

    <div class="totals">
      <div class="totLine"><span>مدين</span><b id="${kind}_dr">0</b></div>
      <div class="totLine"><span>دائن</span><b id="${kind}_cr">0</b></div>
      <div class="hint warn" id="${kind}_warn"></div>
    </div>

    <div class="row2">
      <button class="btn primary" id="${kind}_save">حفظ وترحيل</button>
      <button class="btn" id="${kind}_print">طباعة/تصدير</button>
    </div>

    <div class="divider"></div>
    <div class="reportBox" id="${kind}_box">
      <div class="reportTitle">${title}</div>
      <div class="hint" id="${kind}_meta">-</div>
      <div class="tableWrap">
        <table class="tbl" id="${kind}_pt"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </div>`;
}

const VOUCH={receipt:[],payment:[]};

function mountVouchers(){
  $("view_receiptVoucher").innerHTML=voucherHTML("سند قبض","receipt");
  $("view_paymentVoucher").innerHTML=voucherHTML("سند دفع","payment");
  initVoucher("receipt");
  initVoucher("payment");
}

function initVoucher(kind){
  const dt=new Date();
  const pad=x=>String(x).padStart(2,"0");
  const local=`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  $(kind+"_dt").value=local;

  const cashSel=$(kind+"_cash");
  cashSel.innerHTML = [
    {id:MAP.cashAccount, label:`كاش (${MAP.cashAccount||"-"})`},
    {id:MAP.vodafoneAccount, label:`فودافون (${MAP.vodafoneAccount||"-"})`},
    {id:MAP.instaAccount, label:`إنستا (${MAP.instaAccount||"-"})`},
  ].filter(x=>x.id).map(x=>`<option value="${x.id}">${x.label}</option>`).join("");

  const accSel=$(kind+"_acc");
  accSel.innerHTML = ACCOUNTS.filter(a=>a.allowPost).map(a=>`<option value="${a.code}">${a.code} - ${a.name}</option>`).join("");

  const render=()=>{
    const tbody=$(kind+"_tbl").querySelector("tbody");
    tbody.innerHTML="";
    VOUCH[kind].forEach((l,idx)=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${l.name}</td><td>${fmt.format(l.debit)}</td><td>${fmt.format(l.credit)}</td><td>${l.memo||""}</td>
        <td><button class="btn danger" data-del="${idx}">حذف</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{VOUCH[kind].splice(Number(b.dataset.del),1); render();});
    const dr=VOUCH[kind].reduce((s,l)=>s+n(l.debit),0);
    const cr=VOUCH[kind].reduce((s,l)=>s+n(l.credit),0);
    $(kind+"_dr").innerText=fmt.format(dr);
    $(kind+"_cr").innerText=fmt.format(cr);
    $(kind+"_warn").innerText = Math.abs(dr-cr)>0.001 ? "يجب تساوي المدين والدائن" : "";
    const pt=$(kind+"_pt").querySelector("tbody");
    pt.innerHTML=VOUCH[kind].map(l=>`<tr><td>${l.name}</td><td>${fmt.format(l.debit)}</td><td>${fmt.format(l.credit)}</td><td>${l.memo||""}</td></tr>`).join("");
  };

  $(kind+"_add").onclick=()=>{
    const acc=$(kind+"_acc").value;
    const amt=Math.max(0,n($(kind+"_amt").value));
    if(!acc||amt<=0) return;
    const a=ACCOUNTS.find(x=>String(x.code)===String(acc));
    const memo=$(kind+"_memo").value.trim();
    if(kind==="receipt") VOUCH[kind].push({account:acc,name:`${a.code} - ${a.name}`,debit:0,credit:amt,memo});
    else VOUCH[kind].push({account:acc,name:`${a.code} - ${a.name}`,debit:amt,credit:0,memo});
    $(kind+"_amt").value="0"; $(kind+"_memo").value="";
    render();
  };

  $(kind+"_save").onclick=async ()=>{
    if(!can(["admin","accountant"])) return $(kind+"_warn").innerText="لا تملك صلاحية.";
    if(VOUCH[kind].length===0) return $(kind+"_warn").innerText="أضف بنود.";
    const cash=$(kind+"_cash").value;
    const dr=VOUCH[kind].reduce((s,l)=>s+n(l.debit),0);
    const cr=VOUCH[kind].reduce((s,l)=>s+n(l.credit),0);
    if(Math.abs(dr-cr)>0.001) return $(kind+"_warn").innerText="القيد غير متوازن.";

    // auto cash line
    const lines=[...VOUCH[kind]];
    if(kind==="receipt") lines.unshift({account:cash,name:`${cash} - خزنة`,debit:cr,credit:0,memo:"إجمالي قبض"});
    else lines.unshift({account:cash,name:`${cash} - خزنة`,debit:0,credit:dr,memo:"إجمالي دفع"});

    const locked=parseLockedUntil();
    const vDate=new Date($(kind+"_dt").value || dt);
    if(vDate<=locked && !canOverrideLock()) return $(kind+"_warn").innerText="الفترة مقفلة.";

    try{
      const saved = await runTransaction(db, async (tx)=>{
        const no=await nextNoTx(tx, kind==="receipt"?"voucherReceipt":"voucherPayment");
        const vno=`V-${kind}-${no}`;
        const vdate=new Date($(kind+"_dt").value).toISOString();
        const vnote=$(kind+"_note").value.trim() || (kind==="receipt"?"سند قبض":"سند دفع");
        const ref=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
        tx.set(ref,{
          ts:serverTimestamp(),
          date:vdate,
          source:"voucher",
          voucherType:kind,
          no:vno,
          note:vnote,
          lines:lines.map(l=>({account:l.account,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})),
          createdBy:USER.uid,createdByEmail:USER.email||""
        });
        return { kind, no:vno, date:vdate, note:vnote, lines:lines.map(l=>({account:l.account,name:l.name,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})) };
      });
      await audit("create","voucher",kind,{count:lines.length});
      LAST_DOC[kind==="receipt"?"voucherReceipt":"voucherPayment"]=saved;
      $(kind+"_meta").innerText=`${saved.no} • ${new Date(saved.date).toLocaleString("ar-EG")} • ${saved.note||""}`;
      showModal("تم","تم حفظ وترحيل السند.",()=>{});
    }catch(e){
      $(kind+"_warn").innerText=e?.message||"فشل الحفظ";
    }
  };

  $(kind+"_print").onclick=()=>{
    const data = LAST_DOC[kind==="receipt"?"voucherReceipt":"voucherPayment"] || {
      kind, no:`${kind==="receipt"?"V-receipt": "V-payment"}-preview`,
      date: new Date($(kind+"_dt").value || new Date()).toISOString(),
      note: $(kind+"_note").value.trim() || (kind==="receipt"?"سند قبض":"سند دفع"),
      lines: (function(){
        const cash=$(kind+"_cash").value;
        const dr=VOUCH[kind].reduce((s,l)=>s+n(l.debit),0);
        const cr=VOUCH[kind].reduce((s,l)=>s+n(l.credit),0);
        const lines=[...VOUCH[kind]];
        if(kind==="receipt") lines.unshift({account:cash,name:`${cash} - خزنة`,debit:cr,credit:0,memo:"إجمالي قبض"});
        else lines.unshift({account:cash,name:`${cash} - خزنة`,debit:0,credit:dr,memo:"إجمالي دفع"});
        return lines;
      })()
    };
    openUniversalPrintMenu({
      title: (kind==="receipt"?"سند قبض":"سند دفع") + ` رقم ${safeText(data.no)}`,
      filenameBase: `${kind}_voucher_${safeText(data.no)}`,
      a4HTML: voucherPrintA4HTMLFrom(kind, data),
      receiptHTML: null
    });
  };

  render();
}

// Opening entry
function mountOpening(){
  const v=$("view_openingEntry");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">قيد افتتاحي</div>
    <div class="row2">
      <div class="field"><label>تاريخ</label><input id="o_date" type="date"/></div>
      <div class="field"><label>بيان</label><input id="o_note" value="قيد افتتاحي"/></div>
    </div>
    <div class="row3">
      <div class="field"><label>الحساب</label><select id="o_acc"></select></div>
      <div class="field"><label>مدين</label><input id="o_dr" type="number" value="0" min="0"/></div>
      <div class="field"><label>دائن</label><input id="o_cr" type="number" value="0" min="0"/></div>
    </div>
    <div class="field"><label>ملاحظة</label><input id="o_memo"/></div>
    <button class="btn" id="o_add">إضافة بند</button>

    <div class="tableWrap">
      <table class="tbl" id="o_tbl"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th><th></th></tr></thead><tbody></tbody></table>
    </div>

    <div class="totals">
      <div class="totLine"><span>مدين</span><b id="o_sumDr">0</b></div>
      <div class="totLine"><span>دائن</span><b id="o_sumCr">0</b></div>
      <div class="hint warn" id="o_warn"></div>
    </div>

    <div class="row2">
      <button class="btn primary" id="o_save">حفظ وترحيل</button>
      <button class="btn" id="o_print">طباعة/تصدير</button>
    </div>

    <div class="divider"></div>
    <div class="reportBox" id="o_box">
      <div class="reportTitle">قيد افتتاحي</div>
      <div class="hint" id="o_meta">-</div>
      <div class="tableWrap"><table class="tbl" id="o_pt"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th></tr></thead><tbody></tbody></table></div>
    </div>
  </div>`;
  const d=new Date(); $("o_date").value=d.toISOString().slice(0,10);
  $("o_acc").innerHTML = ACCOUNTS.filter(a=>a.allowPost).map(a=>`<option value="${a.code}">${a.code} - ${a.name}</option>`).join("");

  let lines=[];
  const render=()=>{
    const tbody=$("o_tbl").querySelector("tbody");
    tbody.innerHTML="";
    lines.forEach((l,idx)=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${l.name}</td><td>${fmt.format(l.debit)}</td><td>${fmt.format(l.credit)}</td><td>${l.memo||""}</td>
        <td><button class="btn danger" data-del="${idx}">حذف</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{lines.splice(Number(b.dataset.del),1); render();});
    const dr=lines.reduce((s,l)=>s+n(l.debit),0);
    const cr=lines.reduce((s,l)=>s+n(l.credit),0);
    $("o_sumDr").innerText=fmt.format(dr);
    $("o_sumCr").innerText=fmt.format(cr);
    $("o_warn").innerText = Math.abs(dr-cr)>0.001 ? "القيد غير متوازن" : "";
    $("o_pt").querySelector("tbody").innerHTML = lines.map(l=>`<tr><td>${l.name}</td><td>${fmt.format(l.debit)}</td><td>${fmt.format(l.credit)}</td><td>${l.memo||""}</td></tr>`).join("");
  };

  $("o_add").onclick=()=>{
    const acc=$("o_acc").value;
    const dr=Math.max(0,n($("o_dr").value));
    const cr=Math.max(0,n($("o_cr").value));
    if(!acc || (dr<=0 && cr<=0)) return;
    const a=ACCOUNTS.find(x=>String(x.code)===String(acc));
    lines.push({account:acc,name:`${a.code} - ${a.name}`,debit:dr,credit:cr,memo:$("o_memo").value.trim()});
    $("o_dr").value="0"; $("o_cr").value="0"; $("o_memo").value="";
    render();
  };

  $("o_save").onclick=async ()=>{
    if(!can(["admin"])) return $("o_warn").innerText="للأدمن فقط.";
    if(lines.length===0) return $("o_warn").innerText="أضف بنود.";
    const dr=lines.reduce((s,l)=>s+n(l.debit),0);
    const cr=lines.reduce((s,l)=>s+n(l.credit),0);
    if(Math.abs(dr-cr)>0.001) return $("o_warn").innerText="القيد غير متوازن.";

    const locked=parseLockedUntil();
    const vDate=new Date($("o_date").value+"T00:00:00");
    if(vDate<=locked && !canOverrideLock()) return $("o_warn").innerText="الفترة مقفلة.";

    try{
      const saved = await runTransaction(db, async (tx)=>{
        const no=await nextNoTx(tx,"openingEntry");
        const ono=`OPEN-${no}`;
        const odate=new Date($("o_date").value+"T00:00:00").toISOString();
        const onote=$("o_note").value.trim()||"قيد افتتاحي";
        const ref=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
        tx.set(ref,{
          ts:serverTimestamp(),
          date:odate,
          source:"opening",
          no:ono,
          note:onote,
          lines:lines.map(l=>({account:l.account,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})),
          createdBy:USER.uid,createdByEmail:USER.email||""
        });
        return { no:ono, date:odate, note:onote, lines:lines.map(l=>({account:l.account,name:l.name,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})) };
      });
      await audit("create","opening","entry",{count:lines.length});
      LAST_DOC.opening=saved;
      $("o_meta").innerText=`${saved.no} • ${new Date(saved.date).toLocaleDateString("ar-EG")} • ${saved.note}`;
      showModal("تم","تم ترحيل القيد.",()=>{});
    }catch(e){
      $("o_warn").innerText=e?.message||"فشل";
    }
  };

  $("o_print").onclick=()=>{
    const data = LAST_DOC.opening || {
      no:"OPEN-preview",
      date:new Date($("o_date").value+"T00:00:00").toISOString(),
      note:$("o_note").value.trim()||"قيد افتتاحي",
      lines: (function(){
        // build from current lines
        const arr=[];
        const tbody=$("o_pt").querySelector("tbody");
        // but we already have closure variable lines, so fallback below
        return (typeof lines!=="undefined" && Array.isArray(lines)) ? lines.map(l=>({account:l.account,name:l.name,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})) : arr;
      })()
    };
    openUniversalPrintMenu({
      title:`قيد افتتاحي ${safeText(data.no)}`,
      filenameBase:`opening_${safeText(data.no)}`,
      a4HTML: openingPrintA4HTMLFrom(data),
      receiptHTML: null
    });
  };

  render();
}

// ---------- Financial reports ----------

function reportShell(title, key, extraHtml=""){
  return `
  <div class="card">
    <div class="cardTitle">${title}</div>

    <div class="row3">
      <div class="field"><label>من</label><input id="${key}_from" type="date"/></div>
      <div class="field"><label>إلى</label><input id="${key}_to" type="date"/></div>
      <div class="field">${extraHtml}</div>
    </div>

    <div class="chips" id="${key}_presets">
      <button class="chip" data-preset="today">اليوم</button>
      <button class="chip" data-preset="week">هذا الأسبوع</button>
      <button class="chip" data-preset="month">هذا الشهر</button>
      <button class="chip" data-preset="30">آخر 30 يوم</button>
      <button class="chip" data-preset="90">آخر 90 يوم</button>
    </div>

    <div class="row2">
      <button class="btn primary" id="${key}_run">تشغيل</button>
      <button class="btn" id="${key}_xlsx">Excel</button>
    </div>
    <div class="row2">
      <button class="btn" id="${key}_pdf">PDF</button>
      <button class="btn" id="${key}_print">طباعة/تصدير</button>
    </div>

    <div class="row2">
      <div class="field grow">
        <label>بحث داخل التقرير</label>
        <input id="${key}_q" placeholder="ابحث بالاسم/الرقم/الملاحظة..." />
      </div>
      <div class="field">
        <label>ترتيب</label>
        <select id="${key}_sort">
          <option value="">-</option>
        </select>
      </div>
    </div>

    <div class="reportSummary" id="${key}_summary"></div>

    <div class="divider"></div>
    <div class="reportBox" id="${key}_box">
      <div class="reportTitle" id="${key}_title">-</div>
      <div class="tableWrap"><table class="tbl tblSortable" id="${key}_tbl"><thead></thead><tbody></tbody></table></div>
      <div class="hint small" id="${key}_hint"></div>
    </div>
  </div>`;
}

const REPORT_CACHE={};
const REPORT_STATE={};


function setTable(id, headers, rows){
  const table=$(id);
  const thead=table.querySelector("thead"), tbody=table.querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";
  const trh=document.createElement("tr");
  headers.forEach(h=>{const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);});
  thead.appendChild(trh);
  rows.forEach(r=>{
    const tr=document.createElement("tr");
    r.forEach(c=>{const td=document.createElement("td"); td.textContent=c; tr.appendChild(td);});
    tbody.appendChild(tr);
  });
}



function _reportPresetRange(preset){
  const now=new Date();
  const d0=new Date(now);
  const startOfWeek=(d)=>{
    const day=(d.getDay()+6)%7; // Mon=0
    const s=new Date(d); s.setDate(d.getDate()-day); return s;
  };
  const startOfMonth=(d)=> new Date(d.getFullYear(), d.getMonth(), 1);
  const toIso=(d)=> d.toISOString().slice(0,10);

  let from, to=toIso(now);
  if(preset==="today"){ from=to; }
  else if(preset==="week"){ from=toIso(startOfWeek(d0)); }
  else if(preset==="month"){ from=toIso(startOfMonth(d0)); }
  else {
    const days=parseInt(preset,10);
    const f=new Date(now.getTime()-(isFinite(days)?days:30)*86400000);
    from=toIso(f);
  }
  return {from,to};
}

function _reportDetectSortableOptions(columns){
  // Build options for sort select
  const opts=[{v:"",t:"-"}];
  columns.forEach(c=>{
    opts.push({v:c.k+":asc",t:`${c.label} ↑`});
    opts.push({v:c.k+":desc",t:`${c.label} ↓`});
  });
  return opts;
}

function _reportTextIndex(row){
  try{
    return Object.values(row||{}).map(v=>String(v??"")).join(" ").toLowerCase();
  }catch(e){ return ""; }
}

function renderReport(key, meta){
  // meta: {title, columns:[{k,label,type?,sum?}], rows:[obj], hint?, onRowClick?}
  REPORT_STATE[key]=REPORT_STATE[key]||{q:"", sort:""};
  REPORT_STATE[key].meta=meta;

  const qEl=$(key+"_q"); if(qEl) REPORT_STATE[key].q = (qEl.value||"").trim().toLowerCase();
  const sEl=$(key+"_sort"); if(sEl) REPORT_STATE[key].sort = sEl.value||"";

  let rows=[...(meta.rows||[])];
  const q=REPORT_STATE[key].q;
  if(q){
    rows = rows.filter(r=>_reportTextIndex(r).includes(q));
  }

  // sort
  const sort=REPORT_STATE[key].sort;
  if(sort){
    const [k,dir]=sort.split(":");
    rows.sort((a,b)=>{
      const av=a?.[k], bv=b?.[k];
      const an=Number(av), bn=Number(bv);
      const bothNum=Number.isFinite(an) && Number.isFinite(bn) && (typeof av!=="string") && (typeof bv!=="string");
      let cmp=0;
      if(bothNum) cmp=an-bn;
      else cmp=String(av??"").localeCompare(String(bv??""),"ar");
      return dir==="desc"?-cmp:cmp;
    });
  }

  // header
  const headers = meta.columns.map(c=>c.label);
  const bodyRows = rows.map(r=>meta.columns.map(c=>{
    const v=r?.[c.k];
    if(c.type==="num") return fmt.format(n(v));
    if(c.type==="pct") return (isFinite(Number(v))? (Number(v)*100).toFixed(2)+"%": "");
    return String(v??"");
  }));

  setTable(key+"_tbl", headers, bodyRows);

  // summary
  const sumEl=$(key+"_summary");
  if(sumEl){
    const chips=[];
    chips.push(`<div class="sumCard"><div class="sumLbl">عدد الصفوف</div><div class="sumVal">${rows.length}</div></div>`);
    meta.columns.filter(c=>c.sum).forEach(c=>{
      const total=rows.reduce((s,r)=>s+n(r?.[c.k]),0);
      chips.push(`<div class="sumCard"><div class="sumLbl">${c.label}</div><div class="sumVal">${fmt.format(total)}</div></div>`);
    });
    sumEl.innerHTML = chips.join("");
  }

  // hint
  const hintEl=$(key+"_hint"); if(hintEl) hintEl.textContent = meta.hint || (q?`نتائج البحث: ${rows.length}`:"");

  // row click (drilldown)
  if(meta.onRowClick){
    const tb=$(key+"_tbl")?.querySelector("tbody");
    if(tb){
      [...tb.querySelectorAll("tr")].forEach((tr,i)=>{
        tr.classList.add("clickRow");
        tr.onclick=()=>meta.onRowClick(rows[i]);
      });
    }
  }
}

function wireReportUI(key, columns){
  // presets
  const p=$(key+"_presets");
  if(p){
    p.querySelectorAll("[data-preset]").forEach(btn=>{
      btn.onclick=()=>{
        const pr=btn.getAttribute("data-preset");
        const r=_reportPresetRange(pr);
        setValById(key+"_from", r.from);
        setValById(key+"_to", r.to);
      };
    });
  }
  // search
  const q=$(key+"_q");
  if(q){
    q.oninput=()=>{
      const meta=REPORT_STATE[key]?.meta;
      if(meta) renderReport(key, meta);
    };
  }
  // sort selector
  const s=$(key+"_sort");
  if(s){
    s.innerHTML = _reportDetectSortableOptions(columns).map(o=>`<option value="${o.v}">${o.t}</option>`).join("");
    s.onchange=()=>{
      const meta=REPORT_STATE[key]?.meta;
      if(meta) renderReport(key, meta);
    };
  }
}



function mountReports(){
  $("view_trial").innerHTML=reportShell("ميزان مراجعة","trial");
  $("view_custStatement").innerHTML=reportShell("كشف حساب عميل","cust", `<label>العميل</label><select id="cust_party"></select>`);
  $("view_supStatement").innerHTML=reportShell("كشف حساب مورد","sup", `<label>المورد</label><select id="sup_party"></select>`);
  $("view_balances").innerHTML=reportShell("أرصدة العملاء والموردين","bal");
  $("view_cogs").innerHTML=reportShell("تقرير الربحية (مبيعات مقابل COGS)","cogs", `<label>نوع التقرير</label><select id="cogs_mode"><option value="items">بالأصناف</option><option value="invoices">بالفواتير</option></select>`);
  $("view_cashJournal").innerHTML=reportShell("يومية الصندوق","cash", `<label>الخزنة</label><select id="cash_acc"></select>`);

  const initDates=(key)=>{
    const d=new Date(), f=new Date(d.getTime()-30*86400000);
    setValById(key+"_from", f.toISOString().slice(0,10));
    setValById(key+"_to", d.toISOString().slice(0,10));
  };
  ["trial","cust","sup","bal","cogs","cash"].forEach(initDates);

  // party selectors
  $("cust_party").innerHTML = `<option value="cash">عميل نقدي</option>` + CUSTOMERS.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
  $("sup_party").innerHTML = SUPPLIERS.map(s=>`<option value="${s.id}">${s.name}</option>`).join("") || `<option value="sup">مورد</option>`;
  $("cash_acc").innerHTML = `<option value="all">كل الخزن</option>` + [MAP.cashAccount,MAP.vodafoneAccount,MAP.instaAccount].filter(Boolean).map(a=>`<option value="${a}">${a}</option>`).join("");

  // wire common UI
  wireReportUI("trial", [
    {k:"account",label:"الحساب"},
    {k:"name",label:"الاسم"},
    {k:"dr",label:"مدين",type:"num",sum:true},
    {k:"cr",label:"دائن",type:"num",sum:true},
    {k:"balance",label:"الرصيد",type:"num",sum:true},
  ]);
  wireReportUI("cust", [
    {k:"date",label:"تاريخ"},
    {k:"type",label:"نوع"},
    {k:"no",label:"رقم"},
    {k:"amount",label:"قيمة(+/-)",type:"num",sum:true},
    {k:"pay",label:"دفع"},
    {k:"note",label:"ملاحظة"},
  ]);
  wireReportUI("sup", [
    {k:"date",label:"تاريخ"},
    {k:"type",label:"نوع"},
    {k:"no",label:"رقم"},
    {k:"amount",label:"قيمة(+/-)",type:"num",sum:true},
    {k:"pay",label:"دفع"},
    {k:"note",label:"ملاحظة"},
  ]);
  wireReportUI("bal", [
    {k:"type",label:"نوع"},
    {k:"name",label:"اسم"},
    {k:"balance",label:"الرصيد",type:"num",sum:true},
  ]);
  wireReportUI("cogs", [
    {k:"date",label:"تاريخ"},
    {k:"type",label:"نوع"},
    {k:"no",label:"رقم"},
    {k:"party",label:"الطرف"},
    {k:"code",label:"كود"},
    {k:"name",label:"اسم"},
    {k:"qty",label:"كمية صافية",type:"num",sum:true},
    {k:"revenue",label:"مبيعات/قيمة",type:"num",sum:true},
    {k:"cogs",label:"COGS/كلفة",type:"num",sum:true},
    {k:"profit",label:"ربح",type:"num",sum:true},
    {k:"margin",label:"نسبة",type:"pct"},
  ]);
  wireReportUI("cash", [
    {k:"date",label:"تاريخ"},
    {k:"no",label:"رقم"},
    {k:"account",label:"حساب"},
    {k:"in",label:"داخل",type:"num",sum:true},
    {k:"out",label:"خارج",type:"num",sum:true},
    {k:"delta",label:"صافي",type:"num",sum:true},
    {k:"running",label:"رصيد جارٍ",type:"num"},
    {k:"note",label:"بيان"},
  ]);

  // handlers
  $("trial_run").onclick=runTrial;
  $("trial_xlsx").onclick=()=>exportExcel("trial.xlsx", REPORT_CACHE.trial||[]);
  $("trial_pdf").onclick=()=>exportPDF($("trial_box"),"trial.pdf");
  $("trial_print").onclick=()=>openUniversalPrintMenu({title:"ميزان مراجعة", filenameBase:"trial", a4HTML:$("trial_box").outerHTML, receiptHTML:null});

  $("cust_run").onclick=runCust;
  $("cust_xlsx").onclick=()=>exportExcel("customer_statement.xlsx", REPORT_CACHE.cust||[]);
  $("cust_pdf").onclick=()=>exportPDF($("cust_box"),"customer_statement.pdf");
  $("cust_print").onclick=()=>openUniversalPrintMenu({title:"كشف حساب عميل", filenameBase:"customer_statement", a4HTML:$("cust_box").outerHTML, receiptHTML:null});

  $("sup_run").onclick=runSup;
  $("sup_xlsx").onclick=()=>exportExcel("supplier_statement.xlsx", REPORT_CACHE.sup||[]);
  $("sup_pdf").onclick=()=>exportPDF($("sup_box"),"supplier_statement.pdf");
  $("sup_print").onclick=()=>openUniversalPrintMenu({title:"كشف حساب مورد", filenameBase:"supplier_statement", a4HTML:$("sup_box").outerHTML, receiptHTML:null});

  $("bal_run").onclick=runBalances;
  $("bal_xlsx").onclick=()=>exportExcel("balances.xlsx", REPORT_CACHE.bal||[]);
  $("bal_pdf").onclick=()=>exportPDF($("bal_box"),"balances.pdf");
  $("bal_print").onclick=()=>openUniversalPrintMenu({title:"أرصدة العملاء والموردين", filenameBase:"balances", a4HTML:$("bal_box").outerHTML, receiptHTML:null});

  $("cogs_run").onclick=runCogs;
  const cm=$("cogs_mode"); if(cm) cm.onchange=()=>runCogs();
  $("cogs_xlsx").onclick=()=>exportExcel("profit_report.xlsx", REPORT_CACHE.cogs||[]);
  $("cogs_pdf").onclick=()=>exportPDF($("cogs_box"),"profit_report.pdf");
  $("cogs_print").onclick=()=>openUniversalPrintMenu({title:"تقرير الربحية", filenameBase:"profit_report", a4HTML:$("cogs_box").outerHTML, receiptHTML:null});

  $("cash_run").onclick=runCash;
  $("cash_xlsx").onclick=()=>exportExcel("cash_journal.xlsx", REPORT_CACHE.cash||[]);
  $("cash_pdf").onclick=()=>exportPDF($("cash_box"),"cash_journal.pdf");
  $("cash_print").onclick=()=>openUniversalPrintMenu({title:"يومية الصندوق", filenameBase:"cash_journal", a4HTML:$("cash_box").outerHTML, receiptHTML:null});

  // default run for better UX
  setTimeout(()=>{ try{ runBalances(); }catch(e){} }, 200);
}


function betweenIso(dateIso, from, to){
  const d=dateOnly(dateIso);
  return d>=from && d<=to;
}

async function runTrial(){
  const from=$("trial_from").value, to=$("trial_to").value;
  const entries=await loadJournal();
  const map={};
  entries.filter(e=>betweenIso(e.date,from,to)).forEach(e=>{
    (e.lines||[]).forEach(l=>{
      const acc=String(l.account||""); if(!acc) return;
      map[acc]=map[acc]||{dr:0,cr:0};
      map[acc].dr += n(l.debit);
      map[acc].cr += n(l.credit);
    });
  });
  const rows=Object.keys(map).sort((a,b)=>String(a).localeCompare(String(b),"en")).map(code=>{
    const name=ACCOUNTS.find(a=>String(a.code)===String(code))?.name||"";
    const dr=map[code].dr, cr=map[code].cr, bal=dr-cr;
    return {account:code,name,dr,cr,balance:bal};
  });
  REPORT_CACHE.trial=rows;
  $("trial_title").innerText=`ميزان مراجعة (${from} → ${to})`;
  renderReport("trial",{
    title:"ميزان مراجعة",
    columns:[
      {k:"account",label:"الحساب"},
      {k:"name",label:"الاسم"},
      {k:"dr",label:"مدين",type:"num",sum:true},
      {k:"cr",label:"دائن",type:"num",sum:true},
      {k:"balance",label:"الرصيد",type:"num",sum:true},
    ],
    rows,
    hint:"اضغط على ترتيب/ابحث للحصول على نتائج أدق."
  });
}

async function runCust(){
  const from=$("cust_from").value, to=$("cust_to").value;
  const party=$("cust_party").value;
  const invs=[...(await loadInvoices("sale")),...(await loadInvoices("sale_return"))]
    .filter(inv=>String(inv.partyId||"cash")===String(party));

  const sign= t => (t==="sale")?1:-1;

  const opening = invs
    .filter(inv=>dateOnly(inv.date) < from)
    .reduce((s,inv)=>s + sign(inv.type)*n(inv.net),0);

  const rows=[];
  invs.filter(inv=>betweenIso(inv.date,from,to))
      .forEach(inv=>{
        rows.push({
          date:String(inv.date||"").slice(0,19).replace("T"," "),
          type:invTitle(inv.type),
          no:inv.no,
          amount:sign(inv.type)*n(inv.net),
          pay:inv.payMethod||"",
          note:inv.note||"",
          invId:inv.id,
          invType:inv.type
        });
      });

  rows.sort((a,b)=>String(a.date).localeCompare(String(b.date),"en"));

  // running
  let run=opening;
  rows.forEach(r=>{ run += n(r.amount); r.running = run; });

  REPORT_CACHE.cust=rows;
  const partyName = party==="cash" ? "عميل نقدي" : (CUSTOMERS.find(c=>c.id===party)?.name||"");
  $("cust_title").innerText=`كشف حساب تفصيلي (عميل): ${partyName} (${from} → ${to})`;
  $("cust_hint").textContent = `الرصيد الافتتاحي قبل ${from}: ${fmt.format(opening)}`;

  renderReport("cust",{
    title:"كشف حساب عميل",
    columns:[
      {k:"date",label:"تاريخ"},
      {k:"type",label:"نوع"},
      {k:"no",label:"رقم"},
      {k:"amount",label:"قيمة(+/-)",type:"num",sum:true},
      {k:"running",label:"الرصيد الجاري",type:"num"},
      {k:"pay",label:"دفع"},
      {k:"note",label:"ملاحظة"},
    ],
    rows,
    hint:"اضغط على الصف لفتح تفاصيل الفاتورة.",
    onRowClick:(r)=>{
      const inv=invs.find(x=>x.id===r.invId) || null;
      if(!inv) return;
      const a4=invoiceA4HTMLFrom(inv);
      showModal("تفاصيل الفاتورة", `<div class="printPreviewWrap">${a4}</div>`, ()=>{});
      $("modalCancel").style.display="none";
      $("modalOk").style.display="none";
    }
  });
}


async function runSup(){
  const from=$("sup_from").value, to=$("sup_to").value;
  const party=$("sup_party").value;
  const invs=[...(await loadInvoices("purchase")),...(await loadInvoices("purchase_return"))]
    .filter(inv=>String(inv.partyId||"sup")===String(party));

  const sign= t => (t==="purchase")?1:-1;

  const opening = invs
    .filter(inv=>dateOnly(inv.date) < from)
    .reduce((s,inv)=>s + sign(inv.type)*n(inv.net),0);

  const rows=[];
  invs.filter(inv=>betweenIso(inv.date,from,to))
      .forEach(inv=>{
        rows.push({
          date:String(inv.date||"").slice(0,19).replace("T"," "),
          type:invTitle(inv.type),
          no:inv.no,
          amount:sign(inv.type)*n(inv.net),
          pay:inv.payMethod||"",
          note:inv.note||"",
          invId:inv.id,
          invType:inv.type
        });
      });

  rows.sort((a,b)=>String(a.date).localeCompare(String(b.date),"en"));

  let run=opening;
  rows.forEach(r=>{ run += n(r.amount); r.running = run; });

  REPORT_CACHE.sup=rows;
  const partyName = (SUPPLIERS.find(s=>s.id===party)?.name||"مورد");
  $("sup_title").innerText=`كشف حساب تفصيلي (مورد): ${partyName} (${from} → ${to})`;
  $("sup_hint").textContent = `الرصيد الافتتاحي قبل ${from}: ${fmt.format(opening)}`;

  renderReport("sup",{
    title:"كشف حساب مورد",
    columns:[
      {k:"date",label:"تاريخ"},
      {k:"type",label:"نوع"},
      {k:"no",label:"رقم"},
      {k:"amount",label:"قيمة(+/-)",type:"num",sum:true},
      {k:"running",label:"الرصيد الجاري",type:"num"},
      {k:"pay",label:"دفع"},
      {k:"note",label:"ملاحظة"},
    ],
    rows,
    hint:"اضغط على الصف لفتح تفاصيل الفاتورة.",
    onRowClick:(r)=>{
      const inv=invs.find(x=>x.id===r.invId) || null;
      if(!inv) return;
      const a4=invoiceA4HTMLFrom(inv);
      showModal("تفاصيل الفاتورة", `<div class="printPreviewWrap">${a4}</div>`, ()=>{});
      $("modalCancel").style.display="none";
      $("modalOk").style.display="none";
    }
  });
}


async function runBalances(){
  const from=$("bal_from").value, to=$("bal_to").value;
  const sales=[...(await loadInvoices("sale")),...(await loadInvoices("sale_return"))];
  const pur=[...(await loadInvoices("purchase")),...(await loadInvoices("purchase_return"))];

  const byCust={}, bySup={};
  sales.filter(inv=>betweenIso(inv.date,from,to)).forEach(inv=>{
    const id=inv.partyId||"cash"; const sign=inv.type==="sale"?1:-1;
    byCust[id]=(byCust[id]||0)+sign*n(inv.net);
  });
  pur.filter(inv=>betweenIso(inv.date,from,to)).forEach(inv=>{
    const id=inv.partyId||"sup"; const sign=inv.type==="purchase"?1:-1;
    bySup[id]=(bySup[id]||0)+sign*n(inv.net);
  });

  const rows=[];
  Object.entries(byCust).forEach(([id,b])=>{
    const name=id==="cash"?"عميل نقدي":(CUSTOMERS.find(c=>c.id===id)?.name||"");
    rows.push({type:"عميل",name,balance:b});
  });
  Object.entries(bySup).forEach(([id,b])=>{
    const name=SUPPLIERS.find(s=>s.id===id)?.name||"مورد";
    rows.push({type:"مورد",name,balance:b});
  });

  rows.sort((a,b)=>Math.abs(b.balance)-Math.abs(a.balance));
  REPORT_CACHE.bal=rows;
  $("bal_title").innerText=`أرصدة العملاء والموردين (${from} → ${to})`;

  renderReport("bal",{
    title:"أرصدة العملاء والموردين",
    columns:[
      {k:"type",label:"نوع"},
      {k:"name",label:"اسم"},
      {k:"balance",label:"الرصيد",type:"num",sum:true},
    ],
    rows,
    hint:"هذه الأرصدة مبنية على صافي الفواتير ضمن الفترة. يمكنك فتح كشف الحساب للتفاصيل."
  });
}


async function runCogs(){
  const from=$("cogs_from").value, to=$("cogs_to").value;
  const mode = $("cogs_mode") ? $("cogs_mode").value : "items";

  const sales=[...(await loadInvoices("sale")),...(await loadInvoices("sale_return"))];

  if(mode==="invoices"){
    const rows = sales
      .filter(inv=>betweenIso(inv.date,from,to))
      .map(inv=>{
        const sign = inv.type==="sale" ? 1 : -1;
        let revenue=0, cogs=0, qty=0;

        (inv.lines||[]).forEach(l=>{
          const it=ITEMS.find(x=>x.id===l.itemId);
          const cost=n(it?.purchasePrice||0);
          const q = n(l.qty) * sign;
          qty += q;
          revenue += (n(l.qty)*n(l.price))*sign;
          cogs += (n(l.qty)*cost)*sign;
        });

        const profit = n(revenue)-n(cogs);
        const margin = (n(revenue)===0)?0:(profit/n(revenue));

        return {
          date:String(inv.date||"").slice(0,19).replace("T"," "),
          type:invTitle(inv.type),
          no:String(inv.no||inv.id||""),
          party:(inv.customerName||inv.supplierName||inv.partyName||""),
          qty,
          revenue,
          cogs,
          profit,
          margin
        };
      })
      .sort((a,b)=> (new Date(b.date).getTime()) - (new Date(a.date).getTime()));

    REPORT_CACHE.cogs=rows;
    $("cogs_title").innerText=`ربحية بالفواتير (${from} → ${to})`;

    renderReport("cogs",{
      title:"ربحية بالفواتير",
      columns:[
        {k:"date",label:"تاريخ"},
        {k:"type",label:"نوع"},
        {k:"no",label:"رقم"},
        {k:"party",label:"الطرف"},
        {k:"qty",label:"كمية صافية",type:"num",sum:true},
        {k:"revenue",label:"قيمة البيع",type:"num",sum:true},
        {k:"cogs",label:"قيمة الكلفة",type:"num",sum:true},
        {k:"profit",label:"الربح",type:"num",sum:true},
        {k:"margin",label:"نسبة الربح",type:"pct"},
      ],
      rows,
      hint:"التكلفة محسوبة من (سعر الشراء) في دليل المواد. فاتورة المرتجع تظهر بقيم سالبة."
    });
    return;
  }

  // items mode (default)
  const byItem={};

  sales.filter(inv=>betweenIso(inv.date,from,to)).forEach(inv=>{
    const sign=inv.type==="sale"?1:-1;
    (inv.lines||[]).forEach(l=>{
      const it=ITEMS.find(x=>x.id===l.itemId);
      const cost=n(it?.purchasePrice||0);
      const revenue=sign*n(l.qty)*n(l.price);
      const cogs=sign*n(l.qty)*cost;

      byItem[l.itemId]=byItem[l.itemId]||{code:it?.code||"",name:it?.name||"",qty:0,revenue:0,cogs:0};
      byItem[l.itemId].qty += sign*n(l.qty);
      byItem[l.itemId].revenue += revenue;
      byItem[l.itemId].cogs += cogs;
    });
  });

  const rows=Object.values(byItem).map(r=>{
    const profit=n(r.revenue)-n(r.cogs);
    const margin = (n(r.revenue)===0)?0:(profit/n(r.revenue));
    return {code:r.code,name:r.name,qty:r.qty,revenue:r.revenue,cogs:r.cogs,profit,margin};
  }).sort((a,b)=>Math.abs(b.profit)-Math.abs(a.profit));

  REPORT_CACHE.cogs=rows;
  $("cogs_title").innerText=`ربحية بالأصناف (${from} → ${to})`;

  renderReport("cogs",{
    title:"ربحية بالأصناف",
    columns:[
      {k:"code",label:"كود"},
      {k:"name",label:"اسم"},
      {k:"qty",label:"كمية صافية",type:"num",sum:true},
      {k:"revenue",label:"مبيعات",type:"num",sum:true},
      {k:"cogs",label:"COGS",type:"num",sum:true},
      {k:"profit",label:"مجمل الربح",type:"num",sum:true},
      {k:"margin",label:"هامش",type:"pct"},
    ],
    rows,
    hint:"الهامش = مجمل الربح ÷ المبيعات. الأسعار من الفواتير، والتكلفة من سعر الشراء في دليل المواد."
  });
}


async function runCash(){
  const from=$("cash_from").value, to=$("cash_to").value;
  const acc=$("cash_acc").value;
  const entries=await loadJournal();
  const cashSet=new Set([MAP.cashAccount,MAP.vodafoneAccount,MAP.instaAccount].filter(Boolean).map(String));

  const inRange=[];
  let opening=0;

  entries.forEach(e=>{
    const d=dateOnly(e.date);
    (e.lines||[]).forEach(l=>{
      const code=String(l.account||"");
      const match = (acc==="all") ? cashSet.has(code) : (code===String(acc));
      if(!match) return;

      const delta=n(l.debit)-n(l.credit);
      if(d < from) opening += delta;
      else if(d>=from && d<=to){
        inRange.push({
          date:String(e.date||"").slice(0,19).replace("T"," "),
          no:e.no||e.id,
          account:code,
          in: Math.max(0, delta),
          out: Math.max(0, -delta),
          delta,
          note:e.note||""
        });
      }
    });
  });

  // sort and running
  inRange.sort((a,b)=>String(a.date).localeCompare(String(b.date),"en"));
  let run=opening;
  inRange.forEach(r=>{ run += n(r.delta); r.running = run; });

  REPORT_CACHE.cash=inRange;
  $("cash_title").innerText=`يومية الصندوق (${from} → ${to})`;
  $("cash_hint").textContent = `الرصيد الافتتاحي قبل ${from}: ${fmt.format(opening)}`;

  renderReport("cash",{
    title:"يومية الصندوق",
    columns:[
      {k:"date",label:"تاريخ"},
      {k:"no",label:"رقم"},
      {k:"account",label:"حساب"},
      {k:"in",label:"داخل",type:"num",sum:true},
      {k:"out",label:"خارج",type:"num",sum:true},
      {k:"delta",label:"صافي",type:"num",sum:true},
      {k:"running",label:"رصيد جارٍ",type:"num"},
      {k:"note",label:"بيان"},
    ],
    rows: inRange,
    hint:"تم احتساب الرصيد الجاري بناءً على قيود اليومية للحسابات النقدية المحددة في (ربط الحسابات)."
  });
}

// ---------- Company & Audit ----------

// ---------- Users & Permissions ----------
let USERS_ROWS=[];
function defaultPermsForRole(r){
  if(r==="admin") return {all:true};
  if(r==="cashier") return {pos:true,sales:true,salesReturn:true,customers:true,vouchers:true,reports:true,invReports:true,cogs:true};
  if(r==="accountant") return {pos:true,sales:true,salesReturn:true,purchases:true,purchasesReturn:true,customers:true,suppliers:true,accounts:true,journals:true,vouchers:true,reports:true,invReports:true,cogs:true,cashJournal:true};
  return {reports:true};
}
function renderPermCheckbox(key,label){
  return `<label class="permItem"><input type="checkbox" data-perm="${key}"><span>${label}</span></label>`;
}

function mountUsers(){
  const v=$("view_users");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">المستخدمون والصلاحيات</div>
      <div class="hint">للأدمن فقط: إنشاء مستخدم + تحديد دور وصلاحيات داخل النظام.</div>

      <div class="cardSubTitle">إضافة مستخدم</div>
      <div class="row2">
        <div class="field"><label>البريد</label><input id="u_email" placeholder="user@erp.local"/></div>
        <div class="field"><label>كلمة المرور</label><input id="u_pass" type="password" placeholder="••••••••"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>الاسم</label><input id="u_name" placeholder="اسم المستخدم"/></div>
        <div class="field"><label>الدور</label>
          <select id="u_role">
            <option value="cashier">كاشير</option>
            <option value="accountant">محاسب</option>
            <option value="viewer">مشاهد</option>
            <option value="admin">أدمن</option>
          </select>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label>يسمح بتعديل قيود فترة مقفلة</label>
          <select id="u_override"><option value="false">لا</option><option value="true">نعم</option></select>
        </div>
        <div class="field"><label>ملاحظات</label><input id="u_note" placeholder="اختياري"/></div>
      </div>
      <button class="btn primary" id="u_create">إنشاء</button>

      <div class="divider"></div>

      <div class="cardSubTitle">تعديل صلاحيات / تعطيل</div>
      <div class="row2">
        <div class="field"><label>اختيار مستخدم</label><select id="u_pick"></select></div>
        <div class="field"><label>دور جديد</label>
          <select id="u_role2">
            <option value="cashier">كاشير</option>
            <option value="accountant">محاسب</option>
            <option value="viewer">مشاهد</option>
            <option value="admin">أدمن</option>
          </select>
        </div>
      </div>
      <div class="row2">
        <div class="field"><label>Override Lock</label>
          <select id="u_override2"><option value="false">لا</option><option value="true">نعم</option></select>
        </div>
        <div class="field"><label>Active</label>
          <select id="u_active2"><option value="true">نعم</option><option value="false">لا</option></select>
        </div>
      </div>
      <div class="cardSubTitle">صلاحيات تفصيلية</div>
      <div class="permGrid" id="u_perms">
        ${renderPermCheckbox("pos","POS / الفواتير")}
        ${renderPermCheckbox("sales","مبيعات")}
        ${renderPermCheckbox("salesReturn","مرتجع مبيعات")}
        ${renderPermCheckbox("purchases","مشتريات")}
        ${renderPermCheckbox("purchasesReturn","مرتجع مشتريات")}
        ${renderPermCheckbox("customers","عملاء")}
        ${renderPermCheckbox("suppliers","موردين")}
        ${renderPermCheckbox("items","مواد")}
        ${renderPermCheckbox("warehouses","مخازن")}
        ${renderPermCheckbox("accounts","دليل حسابات")}
        ${renderPermCheckbox("journals","قيود يومية")}
        ${renderPermCheckbox("vouchers","سندات قبض/دفع")}
        ${renderPermCheckbox("reports","تقارير")}
        ${renderPermCheckbox("invReports","تقارير مخزون")}
        ${renderPermCheckbox("cogs","ربحية/تكلفة")}
        ${renderPermCheckbox("cashJournal","يومية الصندوق")}
        ${renderPermCheckbox("edit","تعديل")}
        ${renderPermCheckbox("delete","حذف")}
      </div>

      <button class="btn" id="u_update">حفظ</button>
      <div class="hint" id="u_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">قائمة المستخدمين</div>
      <div class="row2">
        <button class="btn" id="u_reload">تحديث</button>
        <button class="btn" id="u_xlsx">Excel</button>
      </div>
      <div class="tableWrap">
        <table class="tbl" id="u_tbl">
          <thead><tr><th>البريد</th><th>الاسم</th><th>الدور</th><th>Active</th><th>Override</th><th>آخر تحديث</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="hint">تعطيل المستخدم يتم داخل النظام. حذف حساب Firebase Auth نهائياً يحتاج سيرفر/Functions.</div>
    </div>
  </div>`;

  $("u_reload").onclick=refreshUsers;
  $("u_xlsx").onclick=()=>exportExcel("users.xlsx", USERS_ROWS);

  $("u_create").onclick=async ()=>{
    if(!can(["admin"])) return $("u_msg").innerText="للأدمن فقط.";
    const email=$("u_email").value.trim().toLowerCase();
    const pass=$("u_pass").value;
    const name=$("u_name").value.trim();
    const role=$("u_role").value;
    const canOverride=$("u_override").value==="true";
    if(!email||!pass) return $("u_msg").innerText="أدخل البريد وكلمة المرور.";

    const sec=getSecondaryAuth();
    if(!sec) return $("u_msg").innerText="تعذر إنشاء مستخدم (Auth).";
    try{
      const cred = await createUserWithEmailAndPassword(sec, email, pass);
      const uid = cred.user.uid;
      await setDoc(doc(db,"companies",COMPANY_ID,"users",uid),{
        uid,email,name,role,
        isActive:true,
        perms: defaultPermsForRole(role),
        canOverrideLock:canOverride,
        note:$("u_note").value.trim(),
        createdAt:serverTimestamp(),iso:iso(),
        updatedAt:serverTimestamp()
      },{merge:true});
      await audit("create","user",uid,{email,role});
      try{ await signOutAny(sec);}catch(_){}
      $("u_msg").innerText="تم إنشاء المستخدم.";
      ["u_email","u_pass","u_name","u_note"].forEach(id=>$(id).value="");
      await refreshUsers();
    }catch(e){
      $("u_msg").innerText=(e?.message||"فشل").replace("Firebase: ","");
      try{ await signOutAny(sec);}catch(_){}
    }
  };

  $("u_update").onclick=async ()=>{
    if(!can(["admin"])) return $("u_msg").innerText="للأدمن فقط.";
    const uid=$("u_pick").value; if(!uid) return;
    const role=$("u_role2").value;
    const canOverride=$("u_override2").value==="true";
    const isActive=$("u_active2").value==="true";
    const perms={};
    const wrap=$("u_perms");
    if(wrap){
      wrap.querySelectorAll("input[data-perm]").forEach(ch=>{
        const k=ch.getAttribute("data-perm");
        perms[k]=ch.checked===true;
      });
    }
    await setDoc(doc(db,"companies",COMPANY_ID,"users",uid),{
      role,canOverrideLock:canOverride,isActive,
      perms: (role==="admin") ? {all:true} : perms,
      updatedAt:serverTimestamp(),iso:iso()
    },{merge:true});
    await audit("update","user",uid,{role,canOverride,isActive});
    $("u_msg").innerText="تم الحفظ.";
    await refreshUsers();
  };
}

async function refreshUsers(){
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"users"), orderBy("email"), limit(2000)));
  const rows=[];
  snap.forEach(d=>{
    const x=d.data();
    rows.push({
      uid:d.id,
      email:x.email||"",
      name:x.name||"",
      role:x.role||"",
      isActive:x.isActive!==false,
      canOverrideLock:x.canOverrideLock===true,
      perms:x.perms||defaultPermsForRole(x.role||"viewer"),
      updatedAt:String(x.iso||"").replace("T"," ").slice(0,19)
    });
  });
  USERS_ROWS=rows;

  const tb=$("u_tbl")?.querySelector("tbody");
  if(tb){
    tb.innerHTML="";
    rows.forEach(r=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${r.email}</td><td>${r.name}</td><td><b>${r.role}</b></td><td>${r.isActive?"نعم":"لا"}</td><td>${r.canOverrideLock?"نعم":"لا"}</td><td>${r.updatedAt||""}</td>`;
      tb.appendChild(tr);
    });
  }

  const pick=$("u_pick");
  if(pick){
    pick.innerHTML=rows.map(r=>`<option value="${r.uid}">${r.email} (${r.role})</option>`).join("");
    pick.onchange=()=>{
      const uid=pick.value;
      const r=rows.find(x=>x.uid===uid);
      if(!r) return;
      $("u_role2").value=r.role||"viewer";
      $("u_override2").value=r.canOverrideLock?"true":"false";
      $("u_active2").value=r.isActive?"true":"false";
      // perms
      const boxWrap=$("u_perms");
      if(boxWrap){
        boxWrap.querySelectorAll("input[data-perm]").forEach(ch=>{
          const k=ch.getAttribute("data-perm");
          ch.checked = (r.perms?.all===true) ? true : (r.perms?.[k]===true);
          ch.disabled = (r.role==="admin"); // admin gets all
        });
      }
    };
    if(rows[0]){ pick.value=rows[0].uid; pick.dispatchEvent(new Event("change")); }
  }
}

function mountCompany(){
  const v=$("view_company");
  v.innerHTML=`
  <div class="grid2">

    <div class="card">
      <div class="cardTitle">بيانات الشركة</div>

      <div class="row2">
        <div class="field"><label>الاسم</label><input id="co_name" placeholder="اسم الشركة"/></div>
        <div class="field"><label>المدينة</label><input id="co_city" placeholder="المدينة"/></div>
      </div>

      <div class="row2">
        <div class="field"><label>العنوان</label><input id="co_addr" placeholder="العنوان"/></div>
        <div class="field"><label>هاتف (مبيعات)</label><input id="co_phone" placeholder="رقم الهاتف"/></div>
      </div>

      <div class="row2">
        <div class="field"><label>واتساب</label><input id="co_whats" placeholder="رابط أو رقم واتساب"/></div>
        <div class="field"><label>فيسبوك</label><input id="co_fb" placeholder="رابط صفحة فيسبوك"/></div>
      </div>

      <div class="row2">
        <div class="field"><label>تيليجرام</label><input id="co_tg" placeholder="رابط تيليجرام"/></div>
        <div class="field"><label>الموقع الإلكتروني</label><input id="co_web" placeholder="رابط الموقع"/></div>
      </div>

      <div class="field"><label>رابط خرائط (Google Maps)</label><input id="co_maps" placeholder="رابط الموقع على الخرائط"/></div>

      <div class="row2">
        <div class="field"><label>ملاحظة أسفل الفاتورة</label><input id="co_note" placeholder="ملاحظة تظهر في الطباعة"/></div>
        <div class="field"><label>سياسة الاسترجاع</label><input id="co_policy" placeholder="سياسة الاسترجاع"/></div>
      </div>

      <div class="field"><label>الشعار</label><input type="file" id="co_logo" accept="image/*"/></div>

      <div class="row2">
        <button class="btn primary" id="co_save">حفظ</button>
        <button class="btn" id="co_refresh">تحديث</button>
      </div>
      <div class="hint" id="co_msg"></div>
    </div>

    <div class="card">
      <div class="cardTitle">معاينة</div>
      <div class="previewRow">
        <div class="logoPreview" id="co_prevLogo">LOGO</div>
        <div>
          <div class="previewName" id="co_prevName">-</div>
          <div class="previewSub" id="co_prevAddr">-</div>
          <div class="hint small" id="co_prevLinks">-</div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="hint">
        ✅ هذه البيانات تظهر في نماذج الطباعة (A4 / Receipt) في الفواتير والسندات والتقارير.
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">إدارة الشركات (أكثر من داتا)</div>
      <div class="hint">كل شركة لها بياناتها المستقلة داخل Firebase تحت (companies / COMPANY_ID).</div>

      <div class="row2">
        <div class="field grow">
          <label>اختر الشركة الحالية</label>
          <select id="co_selectCompany"></select>
        </div>
        <button class="btn" id="co_switchCompany">تبديل</button>
      </div>

      <div class="row2">
        <div class="field grow"><label>إنشاء شركة جديدة</label><input id="co_newCompanyId" placeholder="مثال: company2 أو متجر-2"/></div>
        <button class="btn primary" id="co_createCompany">إنشاء</button>
      </div>

      <div class="hint small" id="co_companyMsg"></div>
    </div>

    <div class="card dangerCard">
      <div class="cardTitle">تفريغ البرنامج بالكامل (للأدمن فقط)</div>
      <div class="hint">
        • سيحذف <b>كل البيانات</b> (فواتير، سندات، قيود، عملاء، موردين، مواد، مخزون، تقارير...) للشركة الحالية فقط.<br/>
        • لن يحذف المستخدمين (Users) لتفادي قفل الدخول.<br/>
        • الإجراء لا يمكن التراجع عنه.
      </div>
      <div class="field">
        <label>للتأكيد اكتب: DELETE</label>
        <input id="co_wipeConfirm" placeholder="DELETE"/>
      </div>
      <button class="btn danger" id="co_wipeAll">تفريغ البيانات الآن</button>
      <div class="hint small" id="co_wipeMsg"></div>
    </div>

  </div>`;

  const setVal=(id,val)=>{ const el=$(id); if(el) el.value = (val??""); };

  // fill current
  setVal("co_name",COMPANY.name||"");
  setVal("co_addr",COMPANY.address||"");
  setVal("co_city",COMPANY.city||"");
  setVal("co_phone",COMPANY.phoneSales||"");
  setVal("co_whats",COMPANY.whatsapp||"");
  setVal("co_fb",COMPANY.facebook||"");
  setVal("co_tg",COMPANY.telegram||"");
  setVal("co_web",COMPANY.website||"");
  setVal("co_maps",COMPANY.mapsLink||"");
  setVal("co_note",COMPANY.footerNote||"");
  setVal("co_policy",COMPANY.returnPolicy||"");

  const paintPreview=()=>{
    $("co_prevName").innerText=COMPANY.name||"-";
    $("co_prevAddr").innerText=COMPANY.address||"-";
    const links=[];
    if(COMPANY.phoneSales) links.push(`☎ ${COMPANY.phoneSales}`);
    if(COMPANY.whatsapp) links.push(`WhatsApp`);
    if(COMPANY.facebook) links.push(`Facebook`);
    if(COMPANY.website) links.push(`Web`);
    $("co_prevLinks").innerText = links.length?links.join(" • "):"-";
    if(COMPANY.logoDataUrl) $("co_prevLogo").innerHTML=`<img src="${COMPANY.logoDataUrl}" style="max-width:100%;max-height:100%"/>`;
    else $("co_prevLogo").textContent="LOGO";
  };
  paintPreview();

  $("co_refresh").onclick=async ()=>{
    COMPANY=await getSettingsDoc("company",{});
    setCompanyMini();
    setVal("co_name",COMPANY.name||"");
    setVal("co_addr",COMPANY.address||"");
    setVal("co_city",COMPANY.city||"");
    setVal("co_phone",COMPANY.phoneSales||"");
    setVal("co_whats",COMPANY.whatsapp||"");
    setVal("co_fb",COMPANY.facebook||"");
    setVal("co_tg",COMPANY.telegram||"");
    setVal("co_web",COMPANY.website||"");
    setVal("co_maps",COMPANY.mapsLink||"");
    setVal("co_note",COMPANY.footerNote||"");
    setVal("co_policy",COMPANY.returnPolicy||"");
    paintPreview();
    $("co_msg").innerText="تم التحديث.";
  };

  $("co_save").onclick=async ()=>{
    if(!can(["admin"])) return $("co_msg").innerText="للأدمن فقط.";
    const data={
      name:($("co_name").value||"").trim(),
      address:($("co_addr").value||"").trim(),
      city:($("co_city").value||"").trim(),
      phoneSales:($("co_phone").value||"").trim(),
      whatsapp:($("co_whats").value||"").trim(),
      facebook:($("co_fb").value||"").trim(),
      telegram:($("co_tg").value||"").trim(),
      website:($("co_web").value||"").trim(),
      mapsLink:($("co_maps").value||"").trim(),
      footerNote:($("co_note").value||"").trim(),
      returnPolicy:($("co_policy").value||"").trim(),
      updatedAt:serverTimestamp(),iso:iso()
    };
    const file=$("co_logo").files?.[0];
    if(file){
      const reader=new FileReader();
      reader.onload=async ()=>{
        data.logoDataUrl=reader.result;
        await setSettingsDoc("company",data);
        COMPANY=await getSettingsDoc("company",{});
        setCompanyMini();
        paintPreview();
        $("co_msg").innerText="تم الحفظ.";
        await audit("update","company","settings",{});
      };
      reader.readAsDataURL(file);
      return;
    }
    await setSettingsDoc("company",data);
    COMPANY=await getSettingsDoc("company",{});
    setCompanyMini();
    paintPreview();
    $("co_msg").innerText="تم الحفظ.";
    await audit("update","company","settings",{});
  };

  // --- Companies management ---
  async function refreshCompaniesList(){
    try{
      const snap=await getDocs(query(collection(db,"companies"), limit(200)));
      const ids=[];
      snap.forEach(d=>ids.push(d.id));
      ids.sort((a,b)=>String(a).localeCompare(String(b)));
      const sel=$("co_selectCompany");
      sel.innerHTML = ids.map(id=>`<option value="${id}">${id}${id===COMPANY_ID?" (الحالية)":""}</option>`).join("") || `<option value="main">main</option>`;
      sel.value = COMPANY_ID;
    }catch(e){
      // If rules prevent listing, fallback to current only
      const sel=$("co_selectCompany");
      sel.innerHTML = `<option value="${COMPANY_ID}">${COMPANY_ID}</option>`;
      sel.value=COMPANY_ID;
      $("co_companyMsg").innerText="ملاحظة: لا يمكن عرض قائمة الشركات من صلاحيات Firebase الحالية. يمكنك إدخال ID للشركة وإنشاؤها/التبديل إليها مباشرة.";
    }
  }
  refreshCompaniesList();

  $("co_switchCompany").onclick=()=>{
    if(!can(["admin"])) return $("co_companyMsg").innerText="للأدمن فقط.";
    const id=$("co_selectCompany").value.trim();
    if(!id) return;
    localStorage.setItem("companyId", id);
    location.reload();
  };

  $("co_createCompany").onclick=async ()=>{
    if(!can(["admin"])) return $("co_companyMsg").innerText="للأدمن فقط.";
    const id=($("co_newCompanyId").value||"").trim();
    if(!id) return $("co_companyMsg").innerText="اكتب Company ID.";
    // create parent company doc so it can be listed
    await setDoc(doc(db,"companies",id), {createdAt:serverTimestamp(),iso:iso(),createdBy:USER?.email||""}, {merge:true});
    // seed minimal settings
    await setDoc(doc(db,"companies",id,"settings","company"), {name:id,updatedAt:serverTimestamp(),iso:iso()}, {merge:true});
    await setDoc(doc(db,"companies",id,"settings","financialPeriod"), {lockedUntilDate:"1970-01-01",allowAdminOverride:false,updatedAt:serverTimestamp(),iso:iso()}, {merge:true});
    await setDoc(doc(db,"companies",id,"settings","accountingMap"), {cashAccount:"",vodafoneAccount:"",instaAccount:"",salesAccount:"",salesReturnAccount:"",purchaseAccount:"",purchaseReturnAccount:"",arControl:"",apControl:"",updatedAt:serverTimestamp(),iso:iso()}, {merge:true});
    $("co_companyMsg").innerText=`تم إنشاء الشركة: ${id}`;
    await refreshCompaniesList();
  };

  // --- Wipe all data (admin only) ---
  async function wipeCollection(colName, batchLimit=900){
    const colRef=collection(db,"companies",COMPANY_ID,colName);
    // try deleting in chunks
    while(true){
      const snap=await getDocs(query(colRef, limit(batchLimit)));
      if(snap.empty) break;
      const dels=[];
      snap.forEach(d=>{
        if(d.id==="_init") return;
        dels.push(deleteDoc(doc(db,"companies",COMPANY_ID,colName,d.id)));
      });
      await Promise.all(dels);
      if(snap.size<batchLimit) break;
    }
  }
  async function wipeSettingsButKeepCompany(){
    const sref=collection(db,"companies",COMPANY_ID,"settings");
    const snap=await getDocs(query(sref, limit(200)));
    const dels=[];
    snap.forEach(d=>{
      if(d.id==="company") return;
      dels.push(deleteDoc(doc(db,"companies",COMPANY_ID,"settings",d.id)));
    });
    await Promise.all(dels);
  }

  $("co_wipeAll").onclick=async ()=>{
    if(!can(["admin"])) return $("co_wipeMsg").innerText="للأدمن فقط.";
    const v=($("co_wipeConfirm").value||"").trim().toUpperCase();
    if(v!=="DELETE") return $("co_wipeMsg").innerText="اكتب DELETE للتأكيد.";
    // double confirm
    showModal("تأكيد نهائي","هل أنت متأكد؟ سيتم حذف كل البيانات لهذه الشركة ولا يمكن التراجع.", async ()=>{
      try{
        $("co_wipeMsg").innerText="جارٍ التفريغ...";
        const cols=[
          "invoices","journalEntries","vouchers","customers","suppliers","items","accounts","warehouses",
          "stock","counters","auditLog"
        ];
        for(const c of cols){ await wipeCollection(c); }
        await wipeSettingsButKeepCompany();
        await audit("wipe","company","allData",{companyId:COMPANY_ID});
        $("co_wipeMsg").innerText="✅ تم تفريغ البيانات.";
        // refresh core lists
        await bootData();
        setView("home");
      }catch(e){
        $("co_wipeMsg").innerText="خطأ: "+(e.message||e);
      }
    });
  };
}

let AUDIT_ROWS=[];
function mountAudit(){
  const v=$("view_audit");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">سجل العمليات</div>
    <div class="row2">
      <button class="btn" id="au_reload">تحديث</button>
      <button class="btn" id="au_xlsx">Excel</button>
    </div>
    <div class="tableWrap">
      <table class="tbl" id="au_tbl"><thead><tr><th>وقت</th><th>مستخدم</th><th>عملية</th><th>كيان</th><th>معرف</th></tr></thead><tbody></tbody></table>
    </div>
  </div>`;
  $("au_reload").onclick=refreshAudit;
  $("au_xlsx").onclick=()=>exportExcel("audit.xlsx",AUDIT_ROWS);
}
async function refreshAudit(){
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"auditLog"), orderBy("ts","desc"), limit(800)));
  const rows=[];
  snap.forEach(d=>{ if(d.id==="_init")return; const x=d.data(); rows.push({time:String(x.iso||"").replace("T"," ").slice(0,19),email:x.email||"",action:x.action||"",entity:x.entity||"",id:x.entityId||""}); });
  AUDIT_ROWS=rows;
  const tb=$("au_tbl").querySelector("tbody"); tb.innerHTML="";
  rows.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${r.time}</td><td>${r.email}</td><td><b>${r.action}</b></td><td>${r.entity}</td><td>${r.id}</td>`;
    tb.appendChild(tr);
  });
}

// ---------- Annual close (Year Closing + Roll Balances) ----------
$("btnAnnualClose").onclick=()=>{
  if(!can(["admin"])) return showModal("صلاحيات","للأدمن فقط.",()=>{});
  showModal("إقفال سنوي + تدوير الأرصدة",`
    <div class="field"><label>السنة المراد إقفالها</label><input id="closeYear" type="number" placeholder="2026"/></div>
    <div class="hint">
      • سيتم قفل الفترة حتى 31/12<br/>
      • سيتم إنشاء <b>قيد افتتاحي تلقائي</b> للسنة الجديدة (1/1) لحسابات الميزانية (1/2/3).<br/>
      • الأرباح والخسائر (4/5/6) لا تُدَوَّر تلقائياً هنا.
    </div>`, async ()=>{
    const y=Number(document.getElementById("closeYear").value);
    if(!Number.isFinite(y)||y<2000||y>2100) return;

    const lock=`${y}-12-31`;
    // 1) Lock period
    await setSettingsDoc("financialPeriod",{lockedUntilDate:lock,allowAdminOverride:true,updatedAt:serverTimestamp(),iso:iso()});
    PERIOD=await getSettingsDoc("financialPeriod",{lockedUntilDate:"1970-01-01",allowAdminOverride:false});
    updatePeriodUI();

    // 2) Load needed data
    await refreshAccounts();
    const yearEnd = new Date(`${y}-12-31T23:59:59.999Z`).getTime();

    // 3) Sum balances from journal entries (debit - credit)
    const bal={}; // code -> net
    // NOTE: fetch a lot, but capped reasonably
    const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"journalEntries"), orderBy("date","asc"), limit(6000)));
    snap.forEach(d=>{
      const je=d.data();
      const dt = new Date(je.date||je.ts?.toDate?.()||0).getTime();
      if(!dt || dt>yearEnd) return;
      (je.lines||[]).forEach(ln=>{
        const c=String(ln.account||"").trim();
        if(!c) return;
        const net = (Number(ln.debit)||0) - (Number(ln.credit)||0);
        bal[c]=(bal[c]||0)+net;
      });
    });

    // 4) Build opening entry lines for Balance Sheet accounts only (1/2/3) and allowPost=true
    const bsAccounts = ACCOUNTS.filter(a=>{
      const code=String(a.code||"");
      const top=code.slice(0,1);
      return ["1","2","3"].includes(top) && a.allowPost===true;
    });

    const lines=[];
    bsAccounts.forEach(a=>{
      const code=String(a.code);
      const net=round2(bal[code]||0);
      if(Math.abs(net) < 0.005) return;
      if(net>0) lines.push({account:code, debit:round2(net), credit:0, note:"تدوير رصيد"});
      else      lines.push({account:code, debit:0, credit:round2(Math.abs(net)), note:"تدوير رصيد"});
    });

    // Ensure balanced; if not, push difference to "رأس المال" (31) if exists and allowPost=true
    const sumD=round2(lines.reduce((s,x)=>s+(Number(x.debit)||0),0));
    const sumC=round2(lines.reduce((s,x)=>s+(Number(x.credit)||0),0));
    const diff=round2(sumD - sumC);
    if(Math.abs(diff) >= 0.01){
      const equityFallback = (ACCOUNTS.find(a=>String(a.code)==="31" && a.allowPost===true) || ACCOUNTS.find(a=>String(a.code).startsWith("31") && a.allowPost===true));
      if(equityFallback){
        if(diff>0) lines.push({account:String(equityFallback.code), debit:0, credit:round2(diff), note:"تسوية تدوير"});
        else       lines.push({account:String(equityFallback.code), debit:round2(Math.abs(diff)), credit:0, note:"تسوية تدوير"});
      }
    }

    // 5) Create Opening JE for next year
    const jeDoc={
      ts:serverTimestamp(),
      date:`${y+1}-01-01T00:00:00.000Z`,
      source:"annual_close",
      no:`OPEN-${y+1}`,
      note:`قيد افتتاحي مُدوَّر تلقائياً للسنة ${y+1}`,
      lines,
      createdBy:USER.uid,
      createdByEmail:USER.email||""
    };
    await addDoc(collection(db,"companies",COMPANY_ID,"journalEntries"), jeDoc);
    await audit("annual_close","financialPeriod",lock,{lines:lines.length});
    showToast("تم الإقفال وإنشاء قيد افتتاحي تلقائياً.");
  });
};

function round2(x){ return Math.round((Number(x)||0)*100)/100; }

// ---------- Home ----------
function mountHome(){
  const v=$("view_home");
  v.innerHTML=`
  <div class="grid2">
    <div class="card">
      <div class="cardTitle">اختصارات</div>
      <div class="actionsGrid">
        <button class="tile" id="go_pos">فتح POS</button>
        <button class="tile" id="go_sales">فواتير المبيعات</button>
        <button class="tile" id="go_trial">ميزان مراجعة</button>
        <button class="tile" id="go_inv">تقارير المخزون</button>
      </div>
    </div>
    <div class="card">
      <div class="cardTitle">ملخص</div>
      <div class="kpiRow">
        <div class="kpi"><div class="kpiLabel">مواد</div><div class="kpiValue" id="k_items">-</div></div>
        <div class="kpi"><div class="kpiLabel">عملاء</div><div class="kpiValue" id="k_customers">-</div></div>
        <div class="kpi"><div class="kpiLabel">موردين</div><div class="kpiValue" id="k_suppliers">-</div></div>
      </div>
      <div class="hint">التقارير المالية منفصلة عن المخزنية • Excel + PDF</div>
    </div>
  </div>`;
  $("go_pos").onclick=()=>setView("pos");
  $("go_sales").onclick=()=>setView("salesInvoices");
  $("go_trial").onclick=()=>setView("trial");
  $("go_inv").onclick=()=>setView("invReports");
}

// ---------- Refresh tables ----------
function exportExcel(filename, rows){
  const ws=window.XLSX.utils.json_to_sheet(rows);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
  window.XLSX.writeFile(wb,filename);
}
async function exportPDF(el, filename){
  // Upgraded: multi-page A4 PDF (prevents cut-off on long reports)
  await exportPDFA4Multi(el, filename);
}

async function refreshItems(){
  ITEMS=await loadList("items","name");
  const tb=$("i_tbl")?.querySelector("tbody");
  if(!tb) return;
  const q=($("i_q").value||"").trim();
  const list=q?ITEMS.filter(x=> (x.name||"").includes(q) || (x.code||"").includes(q) || (String(x.barcode||"")).includes(q) ):ITEMS;
  tb.innerHTML="";
  list.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${it.code||""}</td><td>${it.barcode||""}</td><td>${it.name||""}</td><td>${it.unit||""}</td><td>${fmt.format(n(it.price))}</td><td>${fmt.format(n(it.purchasePrice))}</td>
      <td><button class="btn danger" data-del="${it.id}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=async ()=>{
    if(!can(["admin","accountant"])) return;
    await deleteDoc(doc(db,"companies",COMPANY_ID,"items",b.dataset.del));
    await audit("delete","item",b.dataset.del,{});
    await refreshAll();
  });
}

async function refreshCustomers(){
  CUSTOMERS=await loadList("customers","name");
  const tb=$("c_tbl")?.querySelector("tbody"); if(!tb) return;
  const q=($("c_q").value||"").trim();
  const list=q?CUSTOMERS.filter(x=>(x.name||"").includes(q)||(x.phone||"").includes(q)):CUSTOMERS;
  tb.innerHTML="";
  list.forEach(c=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${c.name||""}</td><td>${c.phone||""}</td><td>${c.address||""}</td>
      <td><button class="btn danger" data-del="${c.id}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=async ()=>{
    if(!can(["admin","accountant"])) return;
    await deleteDoc(doc(db,"companies",COMPANY_ID,"customers",b.dataset.del));
    await audit("delete","customer",b.dataset.del,{});
    await refreshAll();
  });
}

async function refreshSuppliers(){
  SUPPLIERS=await loadList("suppliers","name");
  const tb=$("s_tbl")?.querySelector("tbody"); if(!tb) return;
  const q=($("s_q").value||"").trim();
  const list=q?SUPPLIERS.filter(x=>(x.name||"").includes(q)||(x.phone||"").includes(q)):SUPPLIERS;
  tb.innerHTML="";
  list.forEach(s=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${s.name||""}</td><td>${s.phone||""}</td><td>${s.address||""}</td>
      <td><button class="btn danger" data-del="${s.id}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.onclick=async ()=>{
    if(!can(["admin","accountant"])) return;
    await deleteDoc(doc(db,"companies",COMPANY_ID,"suppliers",b.dataset.del));
    await audit("delete","supplier",b.dataset.del,{});
    await refreshAll();
  });
}

async function refreshAccounts(){
  ACCOUNTS=await loadAccounts();
  if($("a_tree")) $("a_tree").innerHTML=buildTreeHTML();
}

async function refreshAll(){
  try{
    WAREHOUSES=await loadList("warehouses","name");
    if(WAREHOUSES.length===0) WAREHOUSES=[{id:"main",name:"المستودع الرئيسي",isDefault:true}];
  }catch(e){
    WAREHOUSES=WAREHOUSES.length?WAREHOUSES:[{id:"main",name:"المستودع الرئيسي",isDefault:true}];
  }
  try{ ITEMS=await loadList("items","name"); }catch(e){ ITEMS=ITEMS||[]; }
  try{ CUSTOMERS=await loadList("customers","name"); }catch(e){ CUSTOMERS=CUSTOMERS||[]; }
  try{ SUPPLIERS=await loadList("suppliers","name"); }catch(e){ SUPPLIERS=SUPPLIERS||[]; }
  try{ ACCOUNTS=await loadAccounts(); }catch(e){ ACCOUNTS=ACCOUNTS||[]; }

  // refresh mounted UIs safely
  try{ if($("i_wh")) fillSelect($("i_wh"),WAREHOUSES,w=>w.name||w.id); }catch(e){}
  try{ if($("posWh")) fillSelect($("posWh"),WAREHOUSES,w=>w.name||w.id); }catch(e){}
  try{ if($("posItem")) fillSelect($("posItem"),ITEMS,it=>`${it.code||it.id} - ${it.name||""}`); }catch(e){}
  try{ if($("k_items")) $("k_items").innerText=String(ITEMS.length); }catch(e){}
  try{ if($("k_customers")) $("k_customers").innerText=String(CUSTOMERS.length); }catch(e){}
  try{ if($("k_suppliers")) $("k_suppliers").innerText=String(SUPPLIERS.length); }catch(e){}

  try{ await refreshItems(); }catch(e){}
  try{ await refreshCustomers(); }catch(e){}
  try{ await refreshSuppliers(); }catch(e){}
  try{ await refreshAccounts(); }catch(e){}

  // remount dependent pages (حتى لو حصل خطأ في جزء آخر)
  try{ mountInvoicePages(); }catch(e){}
  try{ mountInvReports(); }catch(e){}
  try{ mountVouchers(); }catch(e){}
  try{ mountOpening(); }catch(e){}
  try{ mountReports(); }catch(e){}
  try{ mountPOS(); }catch(e){}
  try{ if(window.POS_FILL_PARTY) await window.POS_FILL_PARTY(); }catch(e){}
}

// ---------- Auth ----------
$("btnLogin").onclick=async ()=>{
  $("loginError").innerText="";
  const raw = ($("loginEmail").value||"").trim();
  const pass = ($("loginPassword").value||"");
  if(!raw || !pass){
    $("loginError").innerText="يرجى إدخال البريد/اسم المستخدم وكلمة المرور.";
    return;
  }
  // دعم تسجيل الدخول باسم مستخدم مثل: admin
  // إذا لم يحتوي الإدخال على @ سنضيف نطاقًا افتراضيًا مطابقًا للقالب.
  let email = raw;
  if(!raw.includes("@")) email = raw.toLowerCase() + "@erp.local";
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(e){
    // محاولة ثانية: إذا كتب المستخدم email بنطاق مختلف، جرّب كما هو أيضًا
    try{
      if(email !== raw) await signInWithEmailAndPassword(auth, raw, pass);
      else throw e;
    }catch(_){
      $("loginError").innerText="بيانات الدخول غير صحيحة أو لم يتم إنشاء المستخدم على Firebase Auth.";
    }
  }
};
$("btnLogout").onclick=()=>signOut(auth);

onAuthStateChanged(auth, async (user)=>{
  try{
    USER=user;
    if(!user){
      $("loginPage").style.display="flex";
      $("shell").style.display="none";
      return;
    }
    $("loginPage").style.display="none";
    $("shell").style.display="flex";
    $("userEmail").innerText=user.email||"";

    try{
      USERDOC=await loadUserDoc(user.uid);
    }catch(e){
      USERDOC=null;
      console.warn("loadUserDoc failed", e);
    }
    $("userRole").innerText=role();

    if(USERDOC && USERDOC.isActive===false){
      await signOut(auth);
      $("loginError").innerText="هذا المستخدم معطل داخل النظام.";
      return;
    }

    // إعدادات الشركة والفترة والخرائط - مع fallback آمن
    try{ COMPANY=await getSettingsDoc("company",{}); }catch(e){ COMPANY={}; }
    try{ PERIOD=await getSettingsDoc("financialPeriod",{lockedUntilDate:"1970-01-01",allowAdminOverride:false}); }catch(e){ PERIOD={lockedUntilDate:"1970-01-01",allowAdminOverride:false}; }
    try{ MAP=await getSettingsDoc("accountingMap",{
      cashAccount:"14001",vodafoneAccount:"14002",instaAccount:"14003",
      salesAccount:"41",salesReturnAccount:"42",purchaseAccount:"51",purchaseReturnAccount:"52",
      arControl:"",apControl:""
    }); }catch(e){ MAP={
      cashAccount:"14001",vodafoneAccount:"14002",instaAccount:"14003",
      salesAccount:"41",salesReturnAccount:"42",purchaseAccount:"51",purchaseReturnAccount:"52",
      arControl:"",apControl:""
    }; }

    setCompanyMini();
    updatePeriodUI();

    // تركيب الصفحات (لن نوقف التطبيق إذا تعثّر جزء)
    try{ mountHome(); }catch(e){ console.warn(e); }
    try{ mountItems(); }catch(e){ console.warn(e); }
    try{ mountCustomers(); }catch(e){ console.warn(e); }
    try{ mountSuppliers(); }catch(e){ console.warn(e); }
    try{ mountAccounts(); }catch(e){ console.warn(e); }
    try{ mountMap(); }catch(e){ console.warn(e); }
    try{ mountUsers(); }catch(e){ console.warn(e); }
    try{ mountCompany(); }catch(e){ console.warn(e); }
    try{ mountAudit(); }catch(e){ console.warn(e); }
    try{ mountInvoicePages(); }catch(e){ console.warn(e); }
    try{ mountVouchers(); }catch(e){ console.warn(e); }
    try{ mountOpening(); }catch(e){ console.warn(e); }
    try{ mountInvReports(); }catch(e){ console.warn(e); }
    try{ mountReports(); }catch(e){ console.warn(e); }
    try{ mountPOS(); }catch(e){ console.warn(e); }

    // تحميل البيانات - مع معالجة أخطاء Firestore/Indexes بدون إظهار شاشة حمراء
    try{ await refreshAll(); }catch(e){ showToast(e?.message||"تعذر تحميل بعض البيانات.", "warn", 4000); }
    try{ await refreshUsers(); }catch(e){ /* ignore */ }
    try{ await refreshAudit(); }catch(e){ /* ignore */ }

    setView("home");
  }catch(e){
    showError(e?.message||e);
  }
});