// MATGR MO PRO+++ (Single-file app logic)
// Designed for GitHub Pages + Firebase (Auth/Firestore)

import { auth, db } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, getAuth, signOut as signOutAny } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs,
  serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const COMPANY_ID="main";
const $=id=>document.getElementById(id);
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

function showModal(title, bodyHtml, onOk){
  $("modalTitle").innerText=title; $("modalBody").innerHTML=bodyHtml; $("modalBackdrop").style.display="flex";
  const ok=$("modalOk"), cancel=$("modalCancel");
  const cleanup=()=>{$("modalBackdrop").style.display="none"; ok.onclick=null; cancel.onclick=null;};
  cancel.onclick=cleanup; ok.onclick=()=>{cleanup(); onOk?.();};
}
function role(){ return USERDOC?.role||"viewer"; }
function can(roles){ return roles.includes(role()); }

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

function setView(id){
  VIEWS.forEach(v=>{
    const el=$("view_"+v[0]); if(!el) return;
    el.style.display = (v[0]===id)?"block":"none";
  });
  document.querySelectorAll(".navBtn").forEach(b=>b.classList.toggle("active", b.dataset.view===id));
  const t = VIEWS.find(v=>v[0]===id)?.[1]||"";
  setTitle(t);
  CURRENT_VIEW=id;
  closeDrawer();
}

document.querySelectorAll(".navBtn").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));

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
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"accounts"), limit(3000)));
  const list=[]; snap.forEach(d=>list.push({id:d.id,...d.data()}));
  list.sort((a,b)=>String(a.code).localeCompare(String(b.code),"en"));
  return list;
}
async function loadInvoices(type){
  const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"invoices"), where("type","==",type), orderBy("ts","desc"), limit(1000)));
  const list=[]; snap.forEach(d=>{ if(d.id==="_init") return; list.push({id:d.id,...d.data()}); });
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

      <div class="row3">
        <div class="field"><label>المادة</label><select id="posItem"></select></div>
        <div class="field"><label>الكمية</label><input id="posQty" type="number" min="1" value="1"/></div>
        <div class="field"><label>سعر (اختياري)</label><input id="posPrice" type="number" min="0" placeholder="اتركه للسعر الافتراضي"/></div>
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
  if(type==="sale"||type==="sale_return"){
    if(partyId==="cash") return "عميل نقدي";
    return CUSTOMERS.find(c=>c.id===partyId)?.name||"";
  }
  return SUPPLIERS.find(s=>s.id===partyId)?.name||"مورد";
}

function renderPreview(){
  if(!$("invPreview")) return;
  const type=$("posType").value;
  const whName=WAREHOUSES.find(w=>w.id===$("posWh").value)?.name||"";
  const pName=partyName(type,$("posParty").value);
  const {total,disc,net}=computeTotals();
  const lines = POS_LINES.map(l=>`<tr><td>${l.code||""}</td><td>${l.name}</td><td>${fmt.format(l.qty)}</td><td>${l.unit||""}</td><td>${fmt.format(l.price)}</td><td>${fmt.format(l.qty*l.price)}</td></tr>`).join("");
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

  // check lock
  const locked=parseLockedUntil();
  const invDate=new Date();
  if(invDate<=locked && !canOverrideLock()){ $("posWarn").innerText="الفترة مقفلة."; return; }

  // stock deltas
  const deltas=POS_LINES.map(l=>{
    const q=l.qty;
    let delta=0;
    if(type==="sale") delta=-q;
    if(type==="sale_return") delta=+q;
    if(type==="purchase") delta=+q;
    if(type==="purchase_return") delta=-q;
    return {itemId:l.itemId, delta};
  });

  try{
    const result = await runTransaction(db, async (tx)=>{
      const field={sale:"invoiceSale",sale_return:"invoiceSaleReturn",purchase:"invoicePurchase",purchase_return:"invoicePurchaseReturn"}[type]||"invoiceSale";
      const no=await nextNoTx(tx,field);

      for(const d of deltas){
        await adjustStockTx(tx, whId, d.itemId, d.delta);
      }

      const invRef=doc(collection(db,"companies",COMPANY_ID,"invoices"));
      tx.set(invRef,{
        type,no,ts:serverTimestamp(),date:iso(),warehouseId:whId,payMethod:pay,
        partyId:pId,partyName:partyName(type,pId),note,total,discount:disc,net,
        lines:POS_LINES.map(x=>({...x})),
        createdBy:USER.uid,createdByEmail:USER.email||""
      });

      const jeLines=buildInvoiceJELines(type,net,pay);
      const jeRef=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
      tx.set(jeRef,{
        ts:serverTimestamp(),date:iso(),source:"invoice",invoiceId:invRef.id,invoiceType:type,
        no:`JE-${type}-${no}`,note:`قيد تلقائي - ${invTitle(type)} رقم ${no}`,lines:jeLines,
        createdBy:USER.uid,createdByEmail:USER.email||""
      });

      return {id:invRef.id,no};
    });

    LAST_INV=result;
    await audit("create","invoice",result.id,{type,no:result.no,net});
    renderPreview();
    showModal("تم الحفظ",`تم حفظ وترحيل ${invTitle(type)} رقم <b>${result.no}</b>.`,()=>{});
  }catch(e){
    $("posWarn").innerText=e?.message||"فشل الحفظ.";
  }
}

async function printCurrent(){
  renderPreview();
  const el=$("invPreview");
  const canvas=await window.html2canvas(el,{scale:2,backgroundColor:"#ffffff"});
  const img=canvas.toDataURL("image/png");
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF("p","pt","a4");
  const w=pdf.internal.pageSize.getWidth();
  const h=pdf.internal.pageSize.getHeight();
  const ratio=Math.min(w/canvas.width,h/canvas.height);
  pdf.addImage(img,"PNG",(w-canvas.width*ratio)/2,20,canvas.width*ratio,canvas.height*ratio);
  pdf.save(`invoice_${LAST_INV?.no||"preview"}.pdf`);
}

// ---------- POS mount ----------
function mountPOS(){
  const v=$("view_pos");
  v.innerHTML=posHTML();

  fillSelect($("posWh"), WAREHOUSES.length?WAREHOUSES:[{id:"main",name:"المستودع الرئيسي"}], w=>w.name||w.id);
  fillSelect($("posItem"), ITEMS, it=>`${it.code||it.id} - ${it.name||""}`);
  $("posType").onchange=()=>{POS_LINES=[]; renderPosLines(); fillParty(); renderPreview();};
  $("posDiscAmt").oninput=()=>{computeTotals(); renderPreview();};
  $("posDiscPct").oninput=()=>{computeTotals(); renderPreview();};
  $("posPay").onchange=renderPreview;
  $("posWh").onchange=renderPreview;
  $("posParty").onchange=renderPreview;

  async function fillParty(){
    const type=$("posType").value;
    const sel=$("posParty");
    sel.innerHTML="";
    if(type==="sale"||type==="sale_return"){
      sel.innerHTML += `<option value="cash">عميل نقدي</option>`;
      CUSTOMERS.forEach(c=>sel.innerHTML += `<option value="${c.id}">${c.name}</option>`);
    }else{
      if(SUPPLIERS.length===0) sel.innerHTML += `<option value="sup">مورد افتراضي</option>`;
      SUPPLIERS.forEach(s=>sel.innerHTML += `<option value="${s.id}">${s.name}</option>`);
    }
  }
  fillParty();

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
    const defaultPrice=(type==="purchase"||type==="purchase_return")?n(item.purchasePrice||0):n(item.price||0);
    const price=override?Math.max(0,n(override)):Math.max(0,defaultPrice);
    POS_LINES.push({itemId,code:item.code||"",name:item.name||"",unit:item.unit||"",qty,price});
    $("posPrice").value="";
    renderPosLines(); renderPreview();
  };

  $("posSave").onclick=saveInvoice;
  $("posPrint").onclick=printCurrent;

  renderPosLines(); renderPreview();
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
        <div class="field"><label>وحدة</label><input id="i_unit" placeholder="قطعة"/></div>
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
        <table class="tbl" id="i_tbl"><thead><tr><th>كود</th><th>اسم</th><th>وحدة</th><th>بيع</th><th>شراء</th><th></th></tr></thead><tbody></tbody></table>
      </div>
    </div>
  </div>`;
  fillSelect($("i_wh"), WAREHOUSES, w=>w.name||w.id);

  $("i_export").onclick=()=>exportExcel("items.xlsx", ITEMS.map(x=>({code:x.code||"",name:x.name||"",unit:x.unit||"",price:n(x.price),purchasePrice:n(x.purchasePrice),active:x.active!==false})));
  $("i_template").onclick=()=>exportExcel("items_template.xlsx",[{code:"",name:"",unit:"",price:0,purchasePrice:0,openingQty:0,active:true}]);
  $("i_reload").onclick=refreshItems;
  $("i_q").oninput=refreshItems;

  $("i_save").onclick=async ()=>{
    if(!can(["admin","accountant"])) return $("i_msg").innerText="لا تملك صلاحية.";
    const name=$("i_name").value.trim(); if(!name) return $("i_msg").innerText="الاسم مطلوب.";
    const docRef=await addDoc(collection(db,"companies",COMPANY_ID,"items"),{
      code:$("i_code").value.trim(),name,unit:$("i_unit").value.trim(),
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
    ["i_code","i_name","i_unit"].forEach(id=>$(id).value=""); $("i_price").value="0"; $("i_pprice").value="0"; $("i_oqty").value="0";
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
        code:String(r.code||"").trim(),name,unit:String(r.unit||"").trim(),
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
}

function buildTreeHTML(){
  const byParent={};
  ACCOUNTS.forEach(a=>{
    const p=String(a.parent||"").trim();
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
      <table class="tbl list"><thead><tr><th>تاريخ</th><th>رقم</th><th>الطرف</th><th>الدفع</th><th>الصافي</th><th>بنود</th></tr></thead><tbody></tbody></table>
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
function initInvoicePage(viewId,type){
  const root=$("view_"+viewId);
  const from=root.querySelector(".from"), to=root.querySelector(".to"), q=root.querySelector(".q");
  const add=root.querySelector(".add"), load=root.querySelector(".load");
  const xlsxBtn=root.querySelector(".xlsx"), pdfBtn=root.querySelector(".pdf");
  const tbody=root.querySelector("tbody");
  const d=new Date(); const f=new Date(d.getTime()-30*86400000);
  from.value=f.toISOString().slice(0,10); to.value=d.toISOString().slice(0,10);
  let last=[];
  async function run(){
    const list=await loadInvoices(type);
    const rows=list.filter(inv=>{
      const dd=dateOnly(inv.date);
      if(dd<from.value||dd>to.value) return false;
      const s=q.value.trim();
      if(!s) return true;
      return String(inv.no).includes(s) || String(inv.partyName||"").includes(s);
    }).map(inv=>({
      date:String(inv.date||"").slice(0,19).replace("T"," "),
      no:inv.no,
      party:inv.partyName||"",
      pay:inv.payMethod||"",
      net:n(inv.net),
      lines:(inv.lines||[]).length
    }));
    last=rows;
    tbody.innerHTML="";
    rows.forEach(r=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${r.date}</td><td><b>${r.no}</b></td><td>${r.party}</td><td>${r.pay}</td><td>${fmt.format(r.net)}</td><td>${r.lines}</td>`;
      tbody.appendChild(tr);
    });
  }
  add.onclick=()=>{
    setView("pos");
    $("posType").value=type;
    $("posType").dispatchEvent(new Event("change"));
  };
  load.onclick=run;
  xlsxBtn.onclick=()=>exportExcel(`${viewId}.xlsx`,last);
  pdfBtn.onclick=()=>exportPDF(root.querySelector(".card"),`${viewId}.pdf`);
}

// ---------- Inventory reports ----------
function mountInvReports(){
  const v=$("view_invReports");
  v.innerHTML=`
  <div class="card">
    <div class="cardTitle">تقارير المخزون</div>
    <div class="row3">
      <div class="field"><label>المستودع</label><select id="r_wh"></select></div>
      <div class="field"><label>من</label><input id="r_from" type="date"></div>
      <div class="field"><label>إلى</label><input id="r_to" type="date"></div>
    </div>
    <div class="row2">
      <button class="btn primary" id="r_balance">رصيد المخزون</button>
      <button class="btn" id="r_move">حركة مادة (اختر مادة من POS)</button>
    </div>
    <div class="row2">
      <button class="btn" id="r_xlsx">تصدير Excel</button>
      <button class="btn" id="r_pdf">تصدير PDF</button>
    </div>
    <div class="divider"></div>
    <div class="reportBox" id="r_box">
      <div class="reportTitle" id="r_title">-</div>
      <div class="tableWrap"><table class="tbl" id="r_tbl"><thead></thead><tbody></tbody></table></div>
    </div>
  </div>`;
  const whSel=$("r_wh");
  whSel.innerHTML = `<option value="all">كل المستودعات</option>` + WAREHOUSES.map(w=>`<option value="${w.id}">${w.name||w.id}</option>`).join("");
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

  $("r_balance").onclick=async ()=>{
    const wh=whSel.value;
    const snap=await getDocs(query(collection(db,"companies",COMPANY_ID,"stock"), limit(4000)));
    const stock={};
    snap.forEach(d=>{ if(d.id==="_init")return; const x=d.data(); stock[`${x.warehouseId}__${x.itemId}`]=n(x.qty); });
    const rows=ITEMS.map(it=>{
      let qty=0;
      if(wh==="all"){ WAREHOUSES.forEach(w=>qty+= (stock[`${w.id}__${it.id}`]||0)); }
      else qty = stock[`${wh}__${it.id}`]||0;
      return [it.code||"",it.name||"",it.unit||"",fmt.format(qty)];
    });
    lastRows = rows.map(r=>({code:r[0],name:r[1],unit:r[2],qty:r[3]}));
    $("r_title").innerText=`رصيد المخزون (${wh==="all"?"كل المستودعات":(WAREHOUSES.find(w=>w.id===wh)?.name||wh)})`;
    setTable(["كود","اسم","وحدة","كمية"],rows);
  };

  $("r_move").onclick=async ()=>{
    const itemId = $("posItem")?.value;
    const item=ITEMS.find(i=>i.id===itemId);
    if(!item) return showModal("تنبيه","اختر مادة من شاشة POS أولاً.",()=>{});
    const from=$("r_from").value, to=$("r_to").value, wh=whSel.value;
    const invs=[...(await loadInvoices("sale")), ...(await loadInvoices("sale_return")), ...(await loadInvoices("purchase")), ...(await loadInvoices("purchase_return"))];
    const rows=[];
    invs.filter(inv=>{
      const dd=dateOnly(inv.date);
      if(dd<from||dd>to) return false;
      if(wh!=="all" && inv.warehouseId!==wh) return false;
      return true;
    }).forEach(inv=>{
      (inv.lines||[]).forEach(l=>{
        if(l.itemId!==itemId) return;
        const sign=(inv.type==="sale"||inv.type==="purchase_return")?-1:+1;
        rows.push([String(inv.date||"").slice(0,19).replace("T"," "),invTitle(inv.type),String(inv.no),inv.warehouseId,fmt.format(n(l.qty)*sign)]);
      });
    });
    lastRows = rows.map(r=>({date:r[0],type:r[1],no:r[2],warehouse:r[3],qty:r[4]}));
    $("r_title").innerText=`حركة مادة: ${item.name} (${from} → ${to})`;
    setTable(["تاريخ","نوع","رقم","مستودع","كمية(+/-)"],rows);
  };

  $("r_xlsx").onclick=()=>exportExcel("inventory_report.xlsx", lastRows);
  $("r_pdf").onclick=()=>exportPDF($("r_box"),"inventory_report.pdf");
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
      <button class="btn" id="${kind}_pdf">تصدير PDF</button>
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
      await runTransaction(db, async (tx)=>{
        const no=await nextNoTx(tx, kind==="receipt"?"voucherReceipt":"voucherPayment");
        const ref=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
        tx.set(ref,{
          ts:serverTimestamp(),
          date:new Date($(kind+"_dt").value).toISOString(),
          source:"voucher",
          voucherType:kind,
          no:`V-${kind}-${no}`,
          note:$(kind+"_note").value.trim() || (kind==="receipt"?"سند قبض":"سند دفع"),
          lines:lines.map(l=>({account:l.account,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})),
          createdBy:USER.uid,createdByEmail:USER.email||""
        });
      });
      await audit("create","voucher",kind,{count:lines.length});
      $(kind+"_meta").innerText=`${new Date().toLocaleString("ar-EG")} • ${$(kind+"_note").value.trim()||""}`;
      showModal("تم","تم حفظ وترحيل السند.",()=>{});
    }catch(e){
      $(kind+"_warn").innerText=e?.message||"فشل الحفظ";
    }
  };

  $(kind+"_pdf").onclick=()=>exportPDF($(kind+"_box"),`${kind}_voucher.pdf`);

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
      <button class="btn" id="o_pdf">تصدير PDF</button>
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
      await runTransaction(db, async (tx)=>{
        const no=await nextNoTx(tx,"openingEntry");
        const ref=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
        tx.set(ref,{
          ts:serverTimestamp(),
          date:new Date($("o_date").value+"T00:00:00").toISOString(),
          source:"opening",
          no:`OPEN-${no}`,
          note:$("o_note").value.trim()||"قيد افتتاحي",
          lines:lines.map(l=>({account:l.account,debit:n(l.debit),credit:n(l.credit),memo:l.memo||""})),
          createdBy:USER.uid,createdByEmail:USER.email||""
        });
      });
      await audit("create","opening","entry",{count:lines.length});
      $("o_meta").innerText=`${$("o_note").value.trim()} • ${$("o_date").value}`;
      showModal("تم","تم ترحيل القيد.",()=>{});
    }catch(e){
      $("o_warn").innerText=e?.message||"فشل";
    }
  };

  $("o_pdf").onclick=()=>exportPDF($("o_box"),"opening_entry.pdf");

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
    <div class="row2">
      <button class="btn primary" id="${key}_run">تشغيل</button>
      <button class="btn" id="${key}_xlsx">Excel</button>
    </div>
    <div class="row2">
      <button class="btn" id="${key}_pdf">PDF</button>
      <button class="btn" id="${key}_print">طباعة</button>
    </div>
    <div class="divider"></div>
    <div class="reportBox" id="${key}_box">
      <div class="reportTitle" id="${key}_title">-</div>
      <div class="tableWrap"><table class="tbl" id="${key}_tbl"><thead></thead><tbody></tbody></table></div>
    </div>
  </div>`;
}

const REPORT_CACHE={};

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

function mountReports(){
  $("view_trial").innerHTML=reportShell("ميزان مراجعة","trial");
  $("view_custStatement").innerHTML=reportShell("كشف حساب عميل","cust", `<label>العميل</label><select id="cust_party"></select>`);
  $("view_supStatement").innerHTML=reportShell("كشف حساب مورد","sup", `<label>المورد</label><select id="sup_party"></select>`);
  $("view_balances").innerHTML=reportShell("أرصدة العملاء والموردين","bal");
  $("view_cogs").innerHTML=reportShell("تكلفة البضاعة المباعة (COGS)","cogs");
  $("view_cashJournal").innerHTML=reportShell("يومية الصندوق","cash", `<label>الخزنة</label><select id="cash_acc"></select>`);

  const initDates=(key)=>{
    const d=new Date(), f=new Date(d.getTime()-30*86400000);
    $(key+"_from").value=f.toISOString().slice(0,10);
    $(key+"_to").value=d.toISOString().slice(0,10);
  };
  ["trial","cust","sup","bal","cogs","cash"].forEach(initDates);

  // party selectors
  $("cust_party").innerHTML = `<option value="cash">عميل نقدي</option>` + CUSTOMERS.map(c=>`<option value="${c.id}">${c.name}</option>`).join("");
  $("sup_party").innerHTML = SUPPLIERS.map(s=>`<option value="${s.id}">${s.name}</option>`).join("") || `<option value="sup">مورد</option>`;
  $("cash_acc").innerHTML = `<option value="all">كل الخزن</option>` + [MAP.cashAccount,MAP.vodafoneAccount,MAP.instaAccount].filter(Boolean).map(a=>`<option value="${a}">${a}</option>`).join("");

  // handlers
  $("trial_run").onclick=runTrial;
  $("trial_xlsx").onclick=()=>exportExcel("trial.xlsx", REPORT_CACHE.trial||[]);
  $("trial_pdf").onclick=()=>exportPDF($("trial_box"),"trial.pdf");
  $("trial_print").onclick=()=>exportPDF($("trial_box"),"trial_print.pdf");

  $("cust_run").onclick=runCust;
  $("cust_xlsx").onclick=()=>exportExcel("customer_statement.xlsx", REPORT_CACHE.cust||[]);
  $("cust_pdf").onclick=()=>exportPDF($("cust_box"),"customer_statement.pdf");
  $("cust_print").onclick=()=>exportPDF($("cust_box"),"customer_statement_print.pdf");

  $("sup_run").onclick=runSup;
  $("sup_xlsx").onclick=()=>exportExcel("supplier_statement.xlsx", REPORT_CACHE.sup||[]);
  $("sup_pdf").onclick=()=>exportPDF($("sup_box"),"supplier_statement.pdf");
  $("sup_print").onclick=()=>exportPDF($("sup_box"),"supplier_statement_print.pdf");

  $("bal_run").onclick=runBalances;
  $("bal_xlsx").onclick=()=>exportExcel("balances.xlsx", REPORT_CACHE.bal||[]);
  $("bal_pdf").onclick=()=>exportPDF($("bal_box"),"balances.pdf");
  $("bal_print").onclick=()=>exportPDF($("bal_box"),"balances_print.pdf");

  $("cogs_run").onclick=runCogs;
  $("cogs_xlsx").onclick=()=>exportExcel("cogs.xlsx", REPORT_CACHE.cogs||[]);
  $("cogs_pdf").onclick=()=>exportPDF($("cogs_box"),"cogs.pdf");
  $("cogs_print").onclick=()=>exportPDF($("cogs_box"),"cogs_print.pdf");

  $("cash_run").onclick=runCash;
  $("cash_xlsx").onclick=()=>exportExcel("cash_journal.xlsx", REPORT_CACHE.cash||[]);
  $("cash_pdf").onclick=()=>exportPDF($("cash_box"),"cash_journal.pdf");
  $("cash_print").onclick=()=>exportPDF($("cash_box"),"cash_journal_print.pdf");
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
  setTable("trial_tbl",["الحساب","الاسم","مدين","دائن","الرصيد"], rows.map(r=>[r.account,r.name,fmt.format(r.dr),fmt.format(r.cr),fmt.format(r.balance)]));
  $("trial_title").innerText=`ميزان مراجعة (${from} → ${to})`;
}

async function runCust(){
  const from=$("cust_from").value, to=$("cust_to").value;
  const party=$("cust_party").value;
  const invs=[...(await loadInvoices("sale")),...(await loadInvoices("sale_return"))];
  const rows=[];
  invs.filter(inv=>betweenIso(inv.date,from,to)).filter(inv=>String(inv.partyId||"cash")===String(party)).forEach(inv=>{
    const sign=inv.type==="sale"?1:-1;
    rows.push({date:String(inv.date||"").slice(0,19).replace("T"," "),type:invTitle(inv.type),no:inv.no,amount:sign*n(inv.net),pay:inv.payMethod||"",note:inv.note||""});
  });
  const bal=rows.reduce((s,r)=>s+n(r.amount),0);
  REPORT_CACHE.cust=rows;
  setTable("cust_tbl",["تاريخ","نوع","رقم","قيمة(+/-)","دفع","ملاحظة"], rows.map(r=>[r.date,r.type,String(r.no),fmt.format(r.amount),r.pay,r.note]).concat([["","","الرصيد",fmt.format(bal),"",""]]));
  const name=party==="cash"?"عميل نقدي":(CUSTOMERS.find(c=>c.id===party)?.name||"");
  $("cust_title").innerText=`كشف حساب عميل: ${name} (${from} → ${to})`;
}

async function runSup(){
  const from=$("sup_from").value, to=$("sup_to").value;
  const party=$("sup_party").value;
  const invs=[...(await loadInvoices("purchase")),...(await loadInvoices("purchase_return"))];
  const rows=[];
  invs.filter(inv=>betweenIso(inv.date,from,to)).filter(inv=>String(inv.partyId||"sup")===String(party)).forEach(inv=>{
    const sign=inv.type==="purchase"?1:-1;
    rows.push({date:String(inv.date||"").slice(0,19).replace("T"," "),type:invTitle(inv.type),no:inv.no,amount:sign*n(inv.net),pay:inv.payMethod||"",note:inv.note||""});
  });
  const bal=rows.reduce((s,r)=>s+n(r.amount),0);
  REPORT_CACHE.sup=rows;
  setTable("sup_tbl",["تاريخ","نوع","رقم","قيمة(+/-)","دفع","ملاحظة"], rows.map(r=>[r.date,r.type,String(r.no),fmt.format(r.amount),r.pay,r.note]).concat([["","","الرصيد",fmt.format(bal),"",""]]));
  const name=SUPPLIERS.find(s=>s.id===party)?.name||"مورد";
  $("sup_title").innerText=`كشف حساب مورد: ${name} (${from} → ${to})`;
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
  setTable("bal_tbl",["نوع","اسم","الرصيد"], rows.map(r=>[r.type,r.name,fmt.format(r.balance)]));
  $("bal_title").innerText=`أرصدة (${from} → ${to})`;
}

async function runCogs(){
  const from=$("cogs_from").value, to=$("cogs_to").value;
  const sales=[...(await loadInvoices("sale")),...(await loadInvoices("sale_return"))];
  const byItem={};
  sales.filter(inv=>betweenIso(inv.date,from,to)).forEach(inv=>{
    const sign=inv.type==="sale"?1:-1;
    (inv.lines||[]).forEach(l=>{
      const it=ITEMS.find(x=>x.id===l.itemId);
      const cost=n(it?.purchasePrice||0);
      byItem[l.itemId]=byItem[l.itemId]||{code:it?.code||"",name:it?.name||"",qty:0,unitCost:cost,cogs:0};
      byItem[l.itemId].qty += sign*n(l.qty);
      byItem[l.itemId].unitCost = cost;
      byItem[l.itemId].cogs += sign*n(l.qty)*cost;
    });
  });
  const rows=Object.values(byItem).map(r=>({code:r.code,name:r.name,qty:r.qty,unitCost:r.unitCost,cogs:r.cogs})).sort((a,b)=>Math.abs(b.cogs)-Math.abs(a.cogs));
  const sum=rows.reduce((s,r)=>s+n(r.cogs),0);
  REPORT_CACHE.cogs=rows;
  setTable("cogs_tbl",["كود","اسم","كمية صافية","تكلفة الوحدة","إجمالي التكلفة"], rows.map(r=>[r.code,r.name,fmt.format(r.qty),fmt.format(r.unitCost),fmt.format(r.cogs)]).concat([["","","","الإجمالي",fmt.format(sum)]]));
  $("cogs_title").innerText=`COGS (${from} → ${to})`;
}

async function runCash(){
  const from=$("cash_from").value, to=$("cash_to").value;
  const acc=$("cash_acc").value;
  const entries=await loadJournal();
  const cashSet=new Set([MAP.cashAccount,MAP.vodafoneAccount,MAP.instaAccount].filter(Boolean).map(String));
  const rows=[];
  entries.filter(e=>betweenIso(e.date,from,to)).forEach(e=>{
    (e.lines||[]).forEach(l=>{
      const code=String(l.account||"");
      if(acc==="all"){ if(!cashSet.has(code)) return; } else { if(code!==String(acc)) return; }
      const delta=n(l.debit)-n(l.credit);
      rows.push({date:String(e.date||"").slice(0,19).replace("T"," "),no:e.no||e.id,account:code,delta,note:e.note||""});
    });
  });
  REPORT_CACHE.cash=rows;
  setTable("cash_tbl",["تاريخ","رقم","حساب","تغير(+/-)","بيان"], rows.map(r=>[r.date,r.no,r.account,fmt.format(r.delta),r.note]));
  $("cash_title").innerText=`يومية الصندوق (${from} → ${to})`;
}

// ---------- Company & Audit ----------

// ---------- Users & Permissions ----------
let USERS_ROWS=[];
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
    await setDoc(doc(db,"companies",COMPANY_ID,"users",uid),{
      role,canOverrideLock:canOverride,isActive,
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
        <div class="field"><label>الاسم</label><input id="co_name"/></div>
        <div class="field"><label>العنوان</label><input id="co_addr"/></div>
      </div>
      <div class="row2">
        <div class="field"><label>هاتف</label><input id="co_phone"/></div>
        <div class="field"><label>ملاحظة الفاتورة</label><input id="co_note"/></div>
      </div>
      <div class="field"><label>شعار</label><input type="file" id="co_logo" accept="image/*"/></div>
      <button class="btn primary" id="co_save">حفظ</button>
      <div class="hint" id="co_msg"></div>
    </div>
    <div class="card">
      <div class="cardTitle">معاينة</div>
      <div class="previewRow">
        <div class="logoPreview" id="co_prevLogo">LOGO</div>
        <div>
          <div class="previewName" id="co_prevName">-</div>
          <div class="previewSub" id="co_prevAddr">-</div>
        </div>
      </div>
    </div>
  </div>`;
  $("co_name").value=COMPANY.name||"";
  $("co_addr").value=COMPANY.address||"";
  $("co_city").value=COMPANY.city||"";
  $("co_phone").value=COMPANY.phoneSales||"";
  $("co_whats").value=COMPANY.whatsapp||"";
  $("co_fb").value=COMPANY.facebook||"";
  $("co_tg").value=COMPANY.telegram||"";
  $("co_web").value=COMPANY.website||"";
  $("co_maps").value=COMPANY.mapsLink||"";
  $("co_note").value=COMPANY.footerNote||"";
  $("co_policy").value=COMPANY.returnPolicy||"";
  $("co_prevName").innerText=COMPANY.name||"-";
  $("co_prevAddr").innerText=COMPANY.address||"-";
  if(COMPANY.logoDataUrl) $("co_prevLogo").innerHTML=`<img src="${COMPANY.logoDataUrl}" style="max-width:100%;max-height:100%"/>`;

  $("co_save").onclick=async ()=>{
    if(!can(["admin"])) return $("co_msg").innerText="للأدمن فقط.";
    const data={
      name:$("co_name").value.trim(),
      address:$("co_addr").value.trim(),
      city:($("co_city")?$("co_city").value.trim():""),
      phoneSales:$("co_phone").value.trim(),
      whatsapp:($("co_whats")?$("co_whats").value.trim():""),
      facebook:($("co_fb")?$("co_fb").value.trim():""),
      telegram:($("co_tg")?$("co_tg").value.trim():""),
      website:($("co_web")?$("co_web").value.trim():""),
      mapsLink:($("co_maps")?$("co_maps").value.trim():""),
      footerNote:$("co_note").value.trim(),
      returnPolicy:($("co_policy")?$("co_policy").value.trim():""),
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
        $("co_msg").innerText="تم الحفظ.";
      };
      reader.readAsDataURL(file);
      return;
    }
    await setSettingsDoc("company",data);
    COMPANY=await getSettingsDoc("company",{});
    setCompanyMini();
    $("co_msg").innerText="تم الحفظ.";
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

// ---------- Annual close ----------
$("btnAnnualClose").onclick=()=>{
  if(!can(["admin"])) return showModal("صلاحيات","للأدمن فقط.",()=>{});
  showModal("إقفال سنة",`<div class="field"><label>السنة</label><input id="closeYear" type="number" placeholder="2026"/></div><div class="hint">سيتم قفل الفترة حتى 31/12 وإنشاء قيد افتتاحي للسنة الجديدة.</div>`, async ()=>{
    const y=Number(document.getElementById("closeYear").value);
    if(!Number.isFinite(y)||y<2000||y>2100) return;
    const lock=`${y}-12-31`;
    await setSettingsDoc("financialPeriod",{lockedUntilDate:lock,allowAdminOverride:true,updatedAt:serverTimestamp(),iso:iso()});
    PERIOD=await getSettingsDoc("financialPeriod",{lockedUntilDate:"1970-01-01",allowAdminOverride:false});
    updatePeriodUI();
    await addDoc(collection(db,"companies",COMPANY_ID,"journalEntries"),{ts:serverTimestamp(),date:`${y+1}-01-01T00:00:00.000Z`,source:"annual_close",no:`OPEN-${y+1}`,note:`قيد افتتاحي للسنة ${y+1} (عبّئه من شاشة قيد افتتاحي)`,lines:[],createdBy:USER.uid,createdByEmail:USER.email||""});
    await audit("annual_close","financialPeriod",lock,{});
  });
};

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
  const canvas=await window.html2canvas(el,{scale:2,backgroundColor:"#ffffff"});
  const img=canvas.toDataURL("image/png");
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF("p","pt","a4");
  const w=pdf.internal.pageSize.getWidth(), h=pdf.internal.pageSize.getHeight();
  const ratio=Math.min(w/canvas.width,h/canvas.height);
  pdf.addImage(img,"PNG",(w-canvas.width*ratio)/2,20,canvas.width*ratio,canvas.height*ratio);
  pdf.save(filename);
}

async function refreshItems(){
  ITEMS=await loadList("items","name");
  const tb=$("i_tbl")?.querySelector("tbody");
  if(!tb) return;
  const q=($("i_q").value||"").trim();
  const list=q?ITEMS.filter(x=>(x.name||"").includes(q)||(x.code||"").includes(q)):ITEMS;
  tb.innerHTML="";
  list.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${it.code||""}</td><td>${it.name||""}</td><td>${it.unit||""}</td><td>${fmt.format(n(it.price))}</td><td>${fmt.format(n(it.purchasePrice))}</td>
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
  WAREHOUSES=await loadList("warehouses","name");
  if(WAREHOUSES.length===0) WAREHOUSES=[{id:"main",name:"المستودع الرئيسي",isDefault:true}];
  ITEMS=await loadList("items","name");
  CUSTOMERS=await loadList("customers","name");
  SUPPLIERS=await loadList("suppliers","name");
  ACCOUNTS=await loadAccounts();
  // refresh mounted UIs
  if($("i_wh")) fillSelect($("i_wh"),WAREHOUSES,w=>w.name||w.id);
  if($("posWh")) fillSelect($("posWh"),WAREHOUSES,w=>w.name||w.id);
  if($("posItem")) fillSelect($("posItem"),ITEMS,it=>`${it.code||it.id} - ${it.name||""}`);
  if($("k_items")) $("k_items").innerText=String(ITEMS.length);
  if($("k_customers")) $("k_customers").innerText=String(CUSTOMERS.length);
  if($("k_suppliers")) $("k_suppliers").innerText=String(SUPPLIERS.length);
  await refreshItems(); await refreshCustomers(); await refreshSuppliers(); await refreshAccounts();
  // remount dependent pages
  mountInvoicePages();
  mountInvReports();
  mountVouchers();
  mountOpening();
  mountReports();
  mountPOS();
}

// ---------- Auth ----------
$("btnLogin").onclick=async ()=>{
  $("loginError").innerText="";
  try{
    await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);
  }catch(e){
    $("loginError").innerText="بيانات الدخول غير صحيحة.";
  }
};
$("btnLogout").onclick=()=>signOut(auth);

onAuthStateChanged(auth, async (user)=>{
  USER=user;
  if(!user){
    $("loginPage").style.display="flex";
    $("shell").style.display="none";
    return;
  }
  $("loginPage").style.display="none";
  $("shell").style.display="flex";
  $("userEmail").innerText=user.email||"";
  USERDOC=await loadUserDoc(user.uid);
  $("userRole").innerText=role();

  if(USERDOC && USERDOC.isActive===false){
    await signOut(auth);
    $("loginError").innerText="هذا المستخدم معطل داخل النظام.";
    return;
  }


  COMPANY=await getSettingsDoc("company",{});
  PERIOD=await getSettingsDoc("financialPeriod",{lockedUntilDate:"1970-01-01",allowAdminOverride:false});
  MAP=await getSettingsDoc("accountingMap",{
    cashAccount:"14001",vodafoneAccount:"14002",instaAccount:"14003",
    salesAccount:"41",salesReturnAccount:"42",purchaseAccount:"51",purchaseReturnAccount:"52",
    arControl:"",apControl:""
  });

  setCompanyMini();
  updatePeriodUI();

  mountHome();
  mountItems();
  mountCustomers();
  mountSuppliers();
  mountAccounts();
  mountMap();
  mountUsers();
  mountCompany();
  mountAudit();

  await refreshAll();
  await refreshUsers();
  await refreshAudit();

  setView("home");
});
