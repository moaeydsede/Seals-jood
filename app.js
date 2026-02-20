import { auth, db } from "./firebase.js";

import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { doc, getDoc, setDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const COMPANY_ID = "main";
const $ = (id)=>document.getElementById(id);
const fmt = new Intl.NumberFormat("ar-EG",{maximumFractionDigits:2});
const safeNumber=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const nowIso=()=>new Date().toISOString();
const toDateInputValue=(d)=>{const p=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());};

let USERDOC=null, COMPANY=null, PERIOD=null, WAREHOUSES=[], ITEMS=[], CUSTOMERS=[], ACCOUNTS=[];
let POS_LINES=[], LAST_SAVED_INVOICE=null;

function showModal(title, bodyHtml, onOk){
  $("modalTitle").innerText=title; $("modalBody").innerHTML=bodyHtml; $("modalBackdrop").style.display="flex";
  const ok=$("modalOk"), cancel=$("modalCancel");
  const cleanup=()=>{$("modalBackdrop").style.display="none"; ok.onclick=null; cancel.onclick=null;};
  cancel.onclick=()=>cleanup();
  ok.onclick=()=>{cleanup(); onOk?.();};
}

function closeDrawer(){ $("sidebar").classList.remove("open"); $("drawerBackdrop").style.display="none"; }
function openDrawer(){ $("sidebar").classList.add("open"); $("drawerBackdrop").style.display="block"; }

function setView(name){
  document.querySelectorAll(".view").forEach(v=>v.style.display="none");
  const t=$("view_"+name); if(t) t.style.display="block";
  document.querySelectorAll(".navBtn").forEach(b=>b.classList.toggle("active", b.dataset.view===name));
  const m={home:"الرئيسية",pos:"نقطة البيع (POS)",items:"دليل المواد",customers:"دليل العملاء",accounts:"دليل الحسابات",
  reportsInventory:"تقارير مخزنية",reportsFinancial:"تقارير مالية",company:"بيانات الشركة",audit:"سجل العمليات",
  salesInvoices:"فواتير المبيعات",salesReturns:"مرتجع المبيعات",purchaseInvoices:"فواتير المشتريات",purchaseReturns:"مرتجع المشتريات"};
  $("pageTitle").innerText=m[name]||"النظام";
  closeDrawer();
}

async function audit(action, entity, entityId, details={}){
  try{
    const u=auth.currentUser; if(!u) return;
    await addDoc(collection(db,"companies",COMPANY_ID,"auditLog"),{ts:serverTimestamp(),iso:nowIso(),uid:u.uid,email:u.email||"",action,entity,entityId:entityId||"",details});
  }catch(e){console.warn("audit failed",e);}
}

async function getCompanySettings(){
  const ref=doc(db,"companies",COMPANY_ID,"settings","company");
  const s=await getDoc(ref); return s.exists()?s.data():{};
}
async function setCompanySettings(data){
  const ref=doc(db,"companies",COMPANY_ID,"settings","company");
  await setDoc(ref,data,{merge:true});
}
async function getFinancialPeriod(){
  const ref=doc(db,"companies",COMPANY_ID,"settings","financialPeriod");
  const s=await getDoc(ref);
  return s.exists()?s.data():{lockedUntilDate:"1970-01-01",allowAdminOverride:false};
}
function parseLockedUntil(period){
  const s=period?.lockedUntilDate||"1970-01-01"; const d=new Date(s+"T00:00:00");
  return Number.isFinite(d.getTime())?d:new Date("1970-01-01T00:00:00");
}
function canOverrideLock(userDoc, period){
  return userDoc?.role==="admin" && (userDoc?.canOverrideLock===true || period?.allowAdminOverride===true);
}
function requireRole(allowed){ return allowed.includes(USERDOC?.role||"viewer"); }

async function loadUserDoc(uid){
  const ref=doc(db,"companies",COMPANY_ID,"users",uid);
  const s=await getDoc(ref); return s.exists()?s.data():null;
}
async function loadWarehouses(){
  const qy=query(collection(db,"companies",COMPANY_ID,"warehouses"));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>list.push({id:d.id,...d.data()}));
  return list.sort((a,b)=>(b.isDefault?1:0)-(a.isDefault?1:0));
}
async function loadItems(){
  const qy=query(collection(db,"companies",COMPANY_ID,"items"),orderBy("name"),limit(500));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>{if(d.id==="_init")return; list.push({id:d.id,...d.data()});});
  return list;
}
async function loadCustomers(){
  const qy=query(collection(db,"companies",COMPANY_ID,"customers"),orderBy("name"),limit(500));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>{if(d.id==="_init")return; list.push({id:d.id,...d.data()});});
  return list;
}
async function loadAccounts(){
  const qy=query(collection(db,"companies",COMPANY_ID,"accounts"));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>list.push({id:d.id,...d.data()}));
  list.sort((a,b)=>String(a.code).localeCompare(String(b.code),"en"));
  return list;
}
async function loadInvoicesByType(type,count=200){
  const qy=query(collection(db,"companies",COMPANY_ID,"invoices"),where("type","==",type),orderBy("ts","desc"),limit(count));
  const snap=await getDocs(qy); const list=[];
  snap.forEach(d=>{if(d.id==="_init")return; list.push({id:d.id,...d.data()});});
  return list;
}
async function countTodayInvoices(){
  const qy=query(collection(db,"companies",COMPANY_ID,"invoices"),orderBy("ts","desc"),limit(200));
  const snap=await getDocs(qy); const today=toDateInputValue(new Date()); let c=0;
  snap.forEach(d=>{const x=d.data(); if((x.date||"").slice(0,10)===today)c++;});
  return c;
}

function fillSelect(sel,list,getLabel){
  sel.innerHTML=""; list.forEach(x=>{const o=document.createElement("option"); o.value=x.id; o.textContent=getLabel(x); sel.appendChild(o);});
}
function fillPOS(){
  const party=$("posParty"); party.innerHTML="";
  const o0=document.createElement("option"); o0.value="cash"; o0.textContent="عميل نقدي"; party.appendChild(o0);
  CUSTOMERS.forEach(c=>{const o=document.createElement("option"); o.value=c.id; o.textContent=c.name||"(بدون اسم)"; party.appendChild(o);});
  fillSelect($("posWarehouse"),WAREHOUSES,w=>w.name||w.id);
  fillSelect($("posItem"),ITEMS,it=>`${it.code||it.id} - ${it.name||""}`);
  fillSelect($("itemWh"),WAREHOUSES,w=>w.name||w.id);
  fillSelect($("repWh"),[{id:"all",name:"كل المستودعات"},...WAREHOUSES],w=>w.name||w.id);
  const d=new Date(); const from=new Date(d.getTime()-7*86400000);
  $("repFrom").value=toDateInputValue(from); $("repTo").value=toDateInputValue(d);
  $("finFrom").value=toDateInputValue(from); $("finTo").value=toDateInputValue(d);
}
function setCompanyUI(){
  $("companyNameMini").innerText=COMPANY?.name||"MATGR MO";
  $("invCompanyName").innerText=COMPANY?.name||"MATGR MO";
  $("previewName").innerText=COMPANY?.name||"-";
  $("previewSub").innerText=COMPANY?.address||"-";
  $("invFooterNote").innerText=COMPANY?.footerNote||"شكراً لتعاملكم معنا";
  $("invPhone").innerText=COMPANY?.phoneSales||"-";
  $("invContact").innerText=COMPANY?.address||"Contact Sales";
  const show=COMPANY?.showSocialIcons!==false;
  const social=[]; if(show){ if(COMPANY?.whatsapp)social.push("واتساب"); if(COMPANY?.telegram)social.push("تيليجرام"); if(COMPANY?.facebookUrl)social.push("فيسبوك"); }
  $("invSocial").innerText=social.join(" • ");
  if(COMPANY?.logoDataUrl){
    const mk=(id)=>{const img=document.createElement("img"); img.src=COMPANY.logoDataUrl; $(id).innerHTML=""; $(id).appendChild(img);};
    mk("invLogoBox"); mk("logoPreview");
    $("companyLogoMini").innerHTML=""; const img3=document.createElement("img"); img3.src=COMPANY.logoDataUrl; img3.style.maxWidth="100%"; img3.style.maxHeight="100%"; $("companyLogoMini").appendChild(img3);
  }
  $("coName").value=COMPANY?.name||"";
  $("coAddress").value=COMPANY?.address||"";
  $("coPhoneSales").value=COMPANY?.phoneSales||"";
  $("coFooterNote").value=COMPANY?.footerNote||"";
  $("coWhatsapp").value=COMPANY?.whatsapp||"";
  $("coTelegram").value=COMPANY?.telegram||"";
  $("coFacebook").value=COMPANY?.facebookUrl||"";
  $("coShowIcons").value=String(COMPANY?.showSocialIcons!==false);
}
function guardUI(){
  const role=USERDOC?.role||"viewer";
  document.querySelectorAll(".navBtn").forEach(b=>b.style.display="");
  if(role==="cashier"){
    document.querySelectorAll('[data-view="accounts"],[data-view="reportsFinancial"],[data-view="audit"]').forEach(b=>b.style.display="none");
    $("btnAnnualClose").style.display="none";
  }
  if(role==="viewer"){ $("btnAnnualClose").style.display="none"; }
}
function modeTitle(type){
  return {sale:"فاتورة مبيعات",sale_return:"مرتجع مبيعات",purchase:"فاتورة مشتريات",purchase_return:"مرتجع مشتريات"}[type]||"فاتورة";
}

/* POS */
function computePOS(){
  const total=POS_LINES.reduce((s,l)=>s+l.qty*l.price,0);
  const discAmt=safeNumber($("posDiscAmt").value);
  const discPct=safeNumber($("posDiscPct").value);
  const disc=Math.min(total, discAmt + total*(discPct/100));
  const net=Math.max(0,total-disc);
  $("posTotal").innerText=fmt.format(total);
  $("posNet").innerText=fmt.format(net);
  return {total,disc,net};
}
function renderPOSLines(){
  const tb=$("posTable").querySelector("tbody"); tb.innerHTML="";
  POS_LINES.forEach((l,idx)=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${l.name}</td><td>${l.unit}</td><td>${fmt.format(l.qty)}</td><td>${fmt.format(l.price)}</td><td><b>${fmt.format(l.qty*l.price)}</b></td><td><button class="btn danger" data-del="${idx}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",()=>{POS_LINES.splice(Number(b.dataset.del),1); renderPOSLines(); refreshInvoicePreview();}));
  computePOS();
}
async function getStockQty(itemId, whId){
  const ref=doc(db,"companies",COMPANY_ID,"stock",`${whId}__${itemId}`);
  const s=await getDoc(ref); return s.exists()?safeNumber(s.data().qty):0;
}
async function adjustStockTx(tx,itemId,whId,delta){
  const ref=doc(db,"companies",COMPANY_ID,"stock",`${whId}__${itemId}`);
  const s=await tx.get(ref); const cur=s.exists()?safeNumber(s.data().qty):0; const next=cur+delta;
  if(next<0) throw new Error("الكمية لا تسمح");
  tx.set(ref,{itemId,warehouseId:whId,qty:next,updatedAt:serverTimestamp(),iso:nowIso()},{merge:true});
}
function refreshInvoicePreview(){
  const mode=$("posMode").value;
  $("invDocTitle").innerText=modeTitle(mode);
  const partyId=$("posParty").value;
  const partyName=partyId==="cash"?"عميل نقدي":(CUSTOMERS.find(c=>c.id===partyId)?.name||"-");
  $("invParty").innerText=partyName;
  $("invDate").innerText=new Date().toLocaleString("ar-EG");
  $("invNo").innerText=LAST_SAVED_INVOICE?.no||"-";
  const tb=$("invLines").querySelector("tbody"); tb.innerHTML="";
  POS_LINES.forEach(l=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${l.code||""}</td><td>${l.name}</td><td>${fmt.format(l.qty)}</td><td>${l.unit}</td><td>${fmt.format(l.price)}</td><td>${fmt.format(l.qty*l.price)}</td>`;
    tb.appendChild(tr);
  });
  const {total,disc,net}=computePOS();
  $("invSum").innerText=fmt.format(total);
  $("invDisc").innerText=fmt.format(disc);
  $("invNet").innerText=fmt.format(net);
}
$("posMode").addEventListener("change",()=>{POS_LINES=[]; renderPOSLines(); $("posWarn").innerText=""; refreshInvoicePreview();});
$("posDiscAmt").addEventListener("input",refreshInvoicePreview);
$("posDiscPct").addEventListener("input",refreshInvoicePreview);
$("posParty").addEventListener("change",refreshInvoicePreview);
$("posPayMethod").addEventListener("change",refreshInvoicePreview);
$("posWarehouse").addEventListener("change",refreshInvoicePreview);

$("btnAddLine").addEventListener("click", async ()=>{
  $("posWarn").innerText="";
  const itemId=$("posItem").value, whId=$("posWarehouse").value;
  const qty=Math.max(1,safeNumber($("posQty").value));
  const override=$("posPriceOverride").value.trim();
  const item=ITEMS.find(i=>i.id===itemId);
  if(!item){$("posWarn").innerText="اختر مادة.";return;}
  const mode=$("posMode").value;
  const delta = (mode==="sale"||mode==="purchase_return") ? -qty : +qty;
  if(delta<0){
    const cur=await getStockQty(itemId,whId);
    if(cur+delta<0){$("posWarn").innerText="الكمية لا تسمح";return;}
  }
  const price=override?Math.max(0,safeNumber(override)):Math.max(0,safeNumber(item.price));
  POS_LINES.push({itemId,code:item.code||"",name:item.name||"",unit:item.unit||"",qty,price});
  $("posPriceOverride").value="";
  renderPOSLines(); refreshInvoicePreview();
});

async function nextNumberTx(tx, field){
  const ref=doc(db,"companies",COMPANY_ID,"counters","numbers");
  const s=await tx.get(ref); const cur=s.exists()?safeNumber(s.data()[field]):1;
  tx.set(ref,{[field]:cur+1},{merge:true});
  return cur;
}
function invoiceCounterField(type){
  return {sale:"invoiceSale",sale_return:"invoiceSaleReturn",purchase:"invoicePurchase",purchase_return:"invoicePurchaseReturn"}[type]||"invoiceSale";
}

async function saveAndPostInvoice(){
  if(POS_LINES.length===0){$("posWarn").innerText="أضف بنود للفاتورة.";return;}
  $("posWarn").innerText="";
  const type=$("posMode").value, whId=$("posWarehouse").value, payMethod=$("posPayMethod").value;
  const partyId=$("posParty").value;
  const partyName=partyId==="cash"?"عميل نقدي":(CUSTOMERS.find(c=>c.id===partyId)?.name||"");
  const note=$("posNote").value.trim();
  const {total,disc,net}=computePOS();
  const date=nowIso();
  const deltas=POS_LINES.map(l=>{
    const q=l.qty;
    let d=0;
    if(type==="sale") d=-q;
    if(type==="sale_return") d=+q;
    if(type==="purchase") d=+q;
    if(type==="purchase_return") d=-q;
    return {itemId:l.itemId, delta:d};
  });

  try{
    const res=await runTransaction(db, async (tx)=>{
      const periodRef=doc(db,"companies",COMPANY_ID,"settings","financialPeriod");
      const periodSnap=await tx.get(periodRef);
      const period=periodSnap.exists()?periodSnap.data():{lockedUntilDate:"1970-01-01",allowAdminOverride:false};
      const locked=parseLockedUntil(period);
      const invDate=new Date(date);
      if(invDate<=locked && !canOverrideLock(USERDOC,period)) throw new Error("الفترة مقفلة. لا يمكن الترحيل.");

      const no=await nextNumberTx(tx, invoiceCounterField(type));
      for(const d of deltas) await adjustStockTx(tx,d.itemId,whId,d.delta);

      const invRef=doc(collection(db,"companies",COMPANY_ID,"invoices"));
      const invId=invRef.id;
      tx.set(invRef,{type,no,ts:serverTimestamp(),date,warehouseId:whId,payMethod,partyId,partyName,note,total,discount:disc,net,lines:POS_LINES.map(x=>({...x})),createdBy:auth.currentUser.uid,createdByEmail:auth.currentUser.email||""});

      const jeRef=doc(collection(db,"companies",COMPANY_ID,"journalEntries"));
      tx.set(jeRef,{ts:serverTimestamp(),date,source:"invoice",invoiceId:invId,invoiceType:type,no:"JE-"+String(no),lines:[],note:`قيد تلقائي - ${modeTitle(type)} رقم ${no}`,createdBy:auth.currentUser.uid,createdByEmail:auth.currentUser.email||""});
      return {invId,no};
    });

    LAST_SAVED_INVOICE={id:res.invId,no:res.no};
    $("invNo").innerText=String(res.no);
    await audit("create","invoice",res.invId,{type,no:res.no,net});
    showModal("تم الحفظ",`تم حفظ وترحيل ${modeTitle(type)} رقم <b>${res.no}</b>.`,()=>{});
  }catch(e){ $("posWarn").innerText=e?.message||"فشل الحفظ."; }
}
$("btnSaveInvoice").addEventListener("click",saveAndPostInvoice);

$("btnPrintInvoice").addEventListener("click", async ()=>{
  refreshInvoicePreview();
  const node=$("invoicePreview");
  const canvas=await window.html2canvas(node,{scale:2,backgroundColor:"#ffffff"});
  const imgData=canvas.toDataURL("image/png");
  const a=document.createElement("a"); a.href=imgData; a.download=`invoice_${LAST_SAVED_INVOICE?.no||"preview"}.png`; a.click();
  const {jsPDF}=window.jspdf; const pdf=new jsPDF("p","pt","a4");
  const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
  const ratio=Math.min(pageW/canvas.width,pageH/canvas.height);
  pdf.addImage(imgData,"PNG",(pageW-canvas.width*ratio)/2,20,canvas.width*ratio,canvas.height*ratio);
  pdf.save(`invoice_${LAST_SAVED_INVOICE?.no||"preview"}.pdf`);
});

/* Excel helpers */
function exportToExcel(filename, rows){
  const ws=window.XLSX.utils.json_to_sheet(rows);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
  window.XLSX.writeFile(wb,filename);
}
function downloadTemplate(filename, headers){
  exportToExcel(filename,[Object.fromEntries(headers.map(h=>[h,""]))]);
}

/* Items */
async function refreshItemsTable(){
  ITEMS=await loadItems(); fillPOS(); $("kpiItems").innerText=String(ITEMS.length);
  const q=($("itemsSearch").value||"").trim();
  const list=q?ITEMS.filter(i=>(i.name||"").includes(q)||(i.code||"").includes(q)):ITEMS;
  const tb=$("itemsTable").querySelector("tbody"); tb.innerHTML="";
  list.forEach(it=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${it.code||""}</td><td>${it.name||""}</td><td>${it.unit||""}</td><td>${fmt.format(safeNumber(it.price))}</td><td><button class="btn danger" data-del="${it.id}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async ()=>{
    if(!requireRole(["admin","accountant"])) return showModal("صلاحيات","هذه العملية تتطلب صلاحية.",()=>{});
    const id=b.dataset.del; await deleteDoc(doc(db,"companies",COMPANY_ID,"items",id)); await audit("delete","item",id); await refreshItemsTable();
  }));
}
$("btnRefreshItems").addEventListener("click",refreshItemsTable);
$("itemsSearch").addEventListener("input",refreshItemsTable);
$("btnAddItem").addEventListener("click", async ()=>{
  if(!requireRole(["admin","accountant"])) return $("itemMsg").innerText="لا تملك صلاحية الإضافة.";
  $("itemMsg").innerText="";
  const code=$("itemCode").value.trim(), name=$("itemName").value.trim(), unit=$("itemUnit").value.trim();
  const price=Math.max(0,safeNumber($("itemPrice").value));
  const wh=$("itemWh").value, openingQty=Math.max(0,safeNumber($("itemOpeningQty").value));
  if(!name) return $("itemMsg").innerText="اسم المادة مطلوب.";
  const ref=await addDoc(collection(db,"companies",COMPANY_ID,"items"),{code,name,unit,price,active:true,createdAt:serverTimestamp(),iso:nowIso()});
  await audit("create","item",ref.id,{name,code});
  if(openingQty>0){
    await setDoc(doc(db,"companies",COMPANY_ID,"stock",`${wh}__${ref.id}`),{itemId:ref.id,warehouseId:wh,qty:openingQty,updatedAt:serverTimestamp(),iso:nowIso()},{merge:true});
    await audit("create","stock",`${wh}__${ref.id}`,{qty:openingQty});
  }
  $("itemCode").value="";$("itemName").value="";$("itemUnit").value="";$("itemPrice").value="0";$("itemOpeningQty").value="0";
  $("itemMsg").innerText="تم حفظ المادة.";
  await refreshItemsTable();
});
$("btnItemsExport").addEventListener("click",()=>exportToExcel("items.xlsx",ITEMS.map(i=>({code:i.code||"",name:i.name||"",unit:i.unit||"",price:safeNumber(i.price)}))));
$("btnItemsTemplate").addEventListener("click",()=>downloadTemplate("items_template.xlsx",["code","name","unit","price","openingQty"]));
$("itemsImportFile").addEventListener("change", async (ev)=>{
  if(!requireRole(["admin","accountant"])) return $("itemMsg").innerText="لا تملك صلاحية الاستيراد.";
  const file=ev.target.files?.[0]; if(!file) return;
  const data=await file.arrayBuffer(); const wb=window.XLSX.read(data,{type:"array"});
  const ws=wb.Sheets[wb.SheetNames[0]]; const rows=window.XLSX.utils.sheet_to_json(ws,{defval:""});
  const wh=$("itemWh").value; let added=0;
  for(const r of rows){
    const name=String(r.name||"").trim(); if(!name) continue;
    const docRef=await addDoc(collection(db,"companies",COMPANY_ID,"items"),{code:String(r.code||"").trim(),name,unit:String(r.unit||"").trim(),price:Math.max(0,safeNumber(r.price)),active:true,createdAt:serverTimestamp(),iso:nowIso()});
    const oq=Math.max(0,safeNumber(r.openingQty)); if(oq>0) await setDoc(doc(db,"companies",COMPANY_ID,"stock",`${wh}__${docRef.id}`),{itemId:docRef.id,warehouseId:wh,qty:oq,updatedAt:serverTimestamp(),iso:nowIso()},{merge:true});
    added++;
  }
  await audit("import","items","excel",{count:added});
  $("itemMsg").innerText=`تم استيراد ${added} مادة.`;
  ev.target.value="";
  await refreshItemsTable();
});

/* Customers */
async function refreshCustomersTable(){
  CUSTOMERS=await loadCustomers(); fillPOS(); $("kpiCustomers").innerText=String(CUSTOMERS.length);
  const q=($("customersSearch").value||"").trim();
  const list=q?CUSTOMERS.filter(c=>(c.name||"").includes(q)||(c.phone||"").includes(q)):CUSTOMERS;
  const tb=$("customersTable").querySelector("tbody"); tb.innerHTML="";
  list.forEach(c=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${c.name||""}</td><td>${c.phone||""}</td><td>${c.address||""}</td><td><button class="btn danger" data-del="${c.id}">حذف</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click",async ()=>{
    if(!requireRole(["admin","accountant"])) return showModal("صلاحيات","هذه العملية تتطلب صلاحية.",()=>{});
    const id=b.dataset.del; await deleteDoc(doc(db,"companies",COMPANY_ID,"customers",id)); await audit("delete","customer",id); await refreshCustomersTable();
  }));
}
$("btnRefreshCustomers").addEventListener("click",refreshCustomersTable);
$("customersSearch").addEventListener("input",refreshCustomersTable);
$("btnAddCustomer").addEventListener("click", async ()=>{
  if(!requireRole(["admin","accountant","cashier"])) return $("custMsg").innerText="لا تملك صلاحية الإضافة.";
  const name=$("custName").value.trim(); if(!name) return $("custMsg").innerText="اسم العميل مطلوب.";
  const ref=await addDoc(collection(db,"companies",COMPANY_ID,"customers"),{name,phone:$("custPhone").value.trim(),address:$("custAddress").value.trim(),note:$("custNote").value.trim(),active:true,createdAt:serverTimestamp(),iso:nowIso()});
  await audit("create","customer",ref.id,{name});
  $("custName").value="";$("custPhone").value="";$("custAddress").value="";$("custNote").value="";
  $("custMsg").innerText="تم حفظ العميل.";
  await refreshCustomersTable();
});
$("btnCustomersExport").addEventListener("click",()=>exportToExcel("customers.xlsx",CUSTOMERS.map(c=>({name:c.name||"",phone:c.phone||"",address:c.address||"",note:c.note||""}))));
$("btnCustomersTemplate").addEventListener("click",()=>downloadTemplate("customers_template.xlsx",["name","phone","address","note"]));
$("customersImportFile").addEventListener("change", async (ev)=>{
  if(!requireRole(["admin","accountant"])) return $("custMsg").innerText="لا تملك صلاحية الاستيراد.";
  const file=ev.target.files?.[0]; if(!file) return;
  const data=await file.arrayBuffer(); const wb=window.XLSX.read(data,{type:"array"});
  const ws=wb.Sheets[wb.SheetNames[0]]; const rows=window.XLSX.utils.sheet_to_json(ws,{defval:""});
  let added=0;
  for(const r of rows){
    const name=String(r.name||"").trim(); if(!name) continue;
    await addDoc(collection(db,"companies",COMPANY_ID,"customers"),{name,phone:String(r.phone||"").trim(),address:String(r.address||"").trim(),note:String(r.note||"").trim(),active:true,createdAt:serverTimestamp(),iso:nowIso()});
    added++;
  }
  await audit("import","customers","excel",{count:added});
  $("custMsg").innerText=`تم استيراد ${added} عميل.`;
  ev.target.value="";
  await refreshCustomersTable();
});

/* Accounts */
function buildTree(accounts){
  const byParent=new Map();
  accounts.forEach(a=>{const p=(a.parent||"").trim(); if(!byParent.has(p))byParent.set(p,[]); byParent.get(p).push(a);});
  for(const [k,arr] of byParent){arr.sort((x,y)=>String(x.code).localeCompare(String(y.code),"en"));}
  function renderNode(parent,depth){
    const list=byParent.get(parent)||[]; const frag=document.createDocumentFragment();
    list.forEach(a=>{
      const div=document.createElement("div"); div.className="treeItem";
      const badge=a.allowPost?'<span class="badge post">ترحيل</span>':'<span class="badge sum">تجميعي</span>';
      div.innerHTML=`<div class="treeHead"><div><span class="treeCode">${a.code}</span> — ${a.name||""} <span class="badge">${a.type||""}</span> ${badge}</div><div class="badge">level ${a.level||""}</div></div><div class="hint">Parent: ${a.parent||"-"}</div>`;
      div.style.marginRight=(depth*10)+"px";
      frag.appendChild(div); frag.appendChild(renderNode(String(a.code),depth+1));
    });
    return frag;
  }
  const root=document.createElement("div"); root.appendChild(renderNode("",0)); return root.innerHTML;
}
async function refreshAccounts(){
  ACCOUNTS=await loadAccounts();
  $("accountsTree").innerHTML=buildTree(ACCOUNTS);
  $("kpiInvoicesToday").innerText=String(await countTodayInvoices());
}
$("btnRefreshAccounts").addEventListener("click",refreshAccounts);
$("btnAddAccount").addEventListener("click", async ()=>{
  if(!requireRole(["admin","accountant"])) return $("accMsg").innerText="لا تملك صلاحية الإضافة.";
  const code=$("accCode").value.trim(), name=$("accName").value.trim(), parent=$("accParent").value.trim();
  const level=Math.max(1,safeNumber($("accLevel").value)); const type=$("accType").value; const allowPost=$("accAllowPost").value==="true";
  if(!code||!name) return $("accMsg").innerText="الكود والاسم مطلوبان.";
  await setDoc(doc(db,"companies",COMPANY_ID,"accounts",code),{code,name,parent,level,type,allowPost,active:true,updatedAt:serverTimestamp(),iso:nowIso()},{merge:true});
  await audit("upsert","account",code,{name,parent,type,allowPost});
  $("accMsg").innerText="تم حفظ الحساب.";
  $("accCode").value="";$("accName").value="";$("accParent").value="";$("accLevel").value="1";
  await refreshAccounts();
});
$("btnAccountsExport").addEventListener("click",()=>exportToExcel("accounts.xlsx",ACCOUNTS.map(a=>({code:a.code||"",name:a.name||"",parent:a.parent||"",level:safeNumber(a.level),type:a.type||"",allowPost:!!a.allowPost,active:a.active!==false}))));

/* Invoice list views */
function invoiceListViewHtml(title){
  return `<div class="card"><div class="cardTitle">${title}</div>
    <div class="row3"><div class="field"><label>من تاريخ</label><input type="date" class="invFrom"/></div>
    <div class="field"><label>إلى تاريخ</label><input type="date" class="invTo"/></div>
    <div class="field"><label>بحث</label><input class="invSearch" placeholder="رقم/اسم"/></div></div>
    <div class="row2"><button class="btn primary btnLoad">تحميل</button><button class="btn btnExport">تصدير Excel</button></div>
    <div class="divider"></div><div class="tableWrap"><table class="tbl invTblList"><thead><tr><th>التاريخ</th><th>الرقم</th><th>الطرف</th><th>الدفع</th><th>الصافي</th><th>عدد البنود</th></tr></thead><tbody></tbody></table></div>
    <div class="hint">الجدول يدعم فواتير بعدد بنود غير محدود.</div></div>`;
}
function mountInvoiceLists(){
  $("view_salesInvoices").innerHTML=invoiceListViewHtml("فواتير المبيعات");
  $("view_salesReturns").innerHTML=invoiceListViewHtml("مرتجع المبيعات");
  $("view_purchaseInvoices").innerHTML=invoiceListViewHtml("فواتير المشتريات");
  $("view_purchaseReturns").innerHTML=invoiceListViewHtml("مرتجع المشتريات");
}
function initInvoiceListHandlers(viewId,type){
  const root=$("view_"+viewId);
  const from=root.querySelector(".invFrom"), to=root.querySelector(".invTo"), search=root.querySelector(".invSearch");
  const btnLoad=root.querySelector(".btnLoad"), btnExport=root.querySelector(".btnExport"), tb=root.querySelector("tbody");
  const d=new Date(); const f=new Date(d.getTime()-30*86400000);
  from.value=toDateInputValue(f); to.value=toDateInputValue(d);
  let lastRows=[];
  async function load(){
    const list=await loadInvoicesByType(type,200);
    const sFrom=from.value||"1970-01-01", sTo=to.value||"9999-12-31";
    const q=(search.value||"").trim();
    lastRows=list.filter(inv=>{
      const dd=(inv.date||"").slice(0,10);
      if(dd<sFrom||dd>sTo) return false;
      if(!q) return true;
      return String(inv.no).includes(q) || (inv.partyName||"").includes(q);
    }).map(inv=>({date:(inv.date||"").slice(0,19).replace("T"," "),no:inv.no,partyName:inv.partyName||"",payMethod:inv.payMethod||"",net:safeNumber(inv.net),linesCount:(inv.lines||[]).length}));
    tb.innerHTML="";
    lastRows.forEach(r=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td>${r.date}</td><td><b>${r.no}</b></td><td>${r.partyName}</td><td>${r.payMethod}</td><td>${fmt.format(r.net)}</td><td>${r.linesCount}</td>`;
      tb.appendChild(tr);
    });
  }
  btnLoad.addEventListener("click",load);
  btnExport.addEventListener("click",()=>exportToExcel(`${viewId}.xlsx`,lastRows));
}

/* Reports */
function setTable(table, headers, rows){
  const thead=table.querySelector("thead"), tbody=table.querySelector("tbody");
  thead.innerHTML=""; tbody.innerHTML="";
  const trh=document.createElement("tr");
  headers.forEach(h=>{const th=document.createElement("th"); th.textContent=h; trh.appendChild(th);});
  thead.appendChild(trh);
  rows.forEach(r=>{const tr=document.createElement("tr"); r.forEach(c=>{const td=document.createElement("td"); td.textContent=c; tr.appendChild(td);}); tbody.appendChild(tr);});
}
function exportTableAsExcel(filename, table){
  const ws=window.XLSX.utils.table_to_sheet(table);
  const wb=window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb,ws,"Report");
  window.XLSX.writeFile(wb,filename);
}
async function exportElementToPDF(el, filename){
  const canvas=await window.html2canvas(el,{scale:2,backgroundColor:"#ffffff"});
  const imgData=canvas.toDataURL("image/png");
  const {jsPDF}=window.jspdf; const pdf=new jsPDF("p","pt","a4");
  const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight();
  const ratio=Math.min(pageW/canvas.width,pageH/canvas.height);
  pdf.addImage(imgData,"PNG",20,20,canvas.width*ratio,canvas.height*ratio);
  pdf.save(filename);
}
async function runStockBalance(){
  const wh=$("repWh").value;
  const qy=query(collection(db,"companies",COMPANY_ID,"stock"),limit(1000));
  const snap=await getDocs(qy); const stock=[];
  snap.forEach(d=>{if(d.id==="_init")return; stock.push({id:d.id,...d.data()});});
  const byKey=new Map(); stock.forEach(s=>byKey.set(`${s.warehouseId}__${s.itemId}`,safeNumber(s.qty)));
  const rows=[];
  ITEMS.forEach(it=>{
    let qty=0;
    if(wh==="all"){ WAREHOUSES.forEach(w=>qty+=(byKey.get(`${w.id}__${it.id}`)||0)); }
    else qty=byKey.get(`${wh}__${it.id}`)||0;
    rows.push([it.code||"",it.name||"",it.unit||"",fmt.format(qty)]);
  });
  $("invReportTitle").innerText=`رصيد المخزون (${wh==="all"?"كل المستودعات":(WAREHOUSES.find(w=>w.id===wh)?.name||wh)})`;
  setTable($("invReportTable"),["الكود","المادة","الوحدة","الكمية"],rows);
}
async function runItemMovement(){
  const wh=$("repWh").value, from=$("repFrom").value||"1970-01-01", to=$("repTo").value||"9999-12-31";
  const itemId=$("posItem").value; const item=ITEMS.find(i=>i.id===itemId);
  if(!item) return showModal("تنبيه","اختر مادة من شاشة POS ثم عد هنا لتقرير الحركة.",()=>{});
  const invs=[];
  for(const t of ["sale","sale_return","purchase","purchase_return"]){ invs.push(...await loadInvoicesByType(t,200)); }
  const rows=[];
  invs.filter(inv=>{
    const dd=(inv.date||"").slice(0,10);
    if(dd<from||dd>to) return false;
    if(wh!=="all" && inv.warehouseId!==wh) return false;
    return true;
  }).forEach(inv=>{
    (inv.lines||[]).forEach(l=>{
      if(l.itemId!==itemId) return;
      const sign=(inv.type==="sale"||inv.type==="purchase_return")?-1:+1;
      rows.push([(inv.date||"").slice(0,19).replace("T"," "),inv.type,inv.no,inv.warehouseId,fmt.format(safeNumber(l.qty)*sign),fmt.format(safeNumber(l.price))]);
    });
  });
  $("invReportTitle").innerText=`حركة مادة: ${item.name} (${from} → ${to})`;
  setTable($("invReportTable"),["التاريخ","النوع","الرقم","المستودع","الكمية (+/-)","السعر"],rows);
}
async function runFinancialReport(){
  const mode=$("finMode").value, from=$("finFrom").value||"1970-01-01", to=$("finTo").value||"9999-12-31";
  const qy=query(collection(db,"companies",COMPANY_ID,"journalEntries"),orderBy("ts","desc"),limit(500));
  const snap=await getDocs(qy); const entries=[];
  snap.forEach(d=>{if(d.id==="_init")return; entries.push({id:d.id,...d.data()});});
  const filtered=entries.filter(e=>{const dd=(e.date||"").slice(0,10); return dd>=from && dd<=to;});
  if(mode==="daily"){
    $("finReportTitle").innerText=`قيود يومية (${from} → ${to})`;
    setTable($("finReportTable"),["التاريخ","الرقم","البيان","المصدر"], filtered.map(e=>[(e.date||"").slice(0,19).replace("T"," "), e.no||e.id, e.note||"", e.source||""]));
    return;
  }
  $("finReportTitle").innerText=`ميزان مراجعة (مبدئي) (${from} → ${to})`;
  setTable($("finReportTable"),["ملاحظة"], [[ "تم إنشاء قيود تلقائية للفواتير. لميزان مراجعة كامل سيتم ربط حسابات الترحيل من إعدادات النظام في المرحلة التالية." ]]);
}

$("btnStockBalance").addEventListener("click",runStockBalance);
$("btnItemMovement").addEventListener("click",runItemMovement);
$("btnInvExportExcel").addEventListener("click",()=>exportTableAsExcel("inventory_report.xlsx",$("invReportTable")));
$("btnInvExportPDF").addEventListener("click",()=>exportElementToPDF($("invReportTable").closest(".reportBox"),"inventory_report.pdf"));
$("btnRunFinancial").addEventListener("click",runFinancialReport);
$("btnFinExportExcel").addEventListener("click",()=>exportTableAsExcel("financial_report.xlsx",$("finReportTable")));
$("btnFinExportPDF").addEventListener("click",()=>exportElementToPDF($("finReportBox"),"financial_report.pdf"));

/* Company */
$("btnSaveCompany").addEventListener("click", async ()=>{
  if(!requireRole(["admin"])) return $("coMsg").innerText="هذه العملية للأدمن فقط.";
  $("coMsg").innerText="";
  const data={name:$("coName").value.trim(),address:$("coAddress").value.trim(),phoneSales:$("coPhoneSales").value.trim(),
    footerNote:$("coFooterNote").value.trim(),whatsapp:$("coWhatsapp").value.trim(),telegram:$("coTelegram").value.trim(),
    facebookUrl:$("coFacebook").value.trim(),showSocialIcons:$("coShowIcons").value==="true",updatedAt:serverTimestamp(),iso:nowIso()};
  const file=$("coLogoFile").files?.[0];
  if(file){
    const reader=new FileReader();
    reader.onload=async ()=>{
      data.logoDataUrl=reader.result;
      await setCompanySettings(data); await audit("update","company","settings",{});
      COMPANY=await getCompanySettings(); setCompanyUI();
      $("coMsg").innerText="تم الحفظ."; $("coLogoFile").value="";
    };
    reader.readAsDataURL(file); return;
  }
  await setCompanySettings(data); await audit("update","company","settings",{});
  COMPANY=await getCompanySettings(); setCompanyUI();
  $("coMsg").innerText="تم الحفظ.";
});

/* Audit */
async function refreshAudit(){
  const qy=query(collection(db,"companies",COMPANY_ID,"auditLog"),orderBy("ts","desc"),limit(200));
  const snap=await getDocs(qy); const rows=[];
  snap.forEach(d=>{if(d.id==="_init")return; const x=d.data(); rows.push({iso:x.iso||"",email:x.email||"",action:x.action||"",entity:x.entity||"",entityId:x.entityId||""});});
  const tb=$("auditTable").querySelector("tbody"); tb.innerHTML="";
  rows.forEach(r=>{const tr=document.createElement("tr"); tr.innerHTML=`<td>${r.iso.replace("T"," ").slice(0,19)}</td><td>${r.email}</td><td><b>${r.action}</b></td><td>${r.entity}</td><td>${r.entityId}</td>`; tb.appendChild(tr);});
}
$("btnRefreshAudit").addEventListener("click",refreshAudit);
$("btnClearAuditFilter").addEventListener("click",refreshAudit);

/* Annual close */
function updatePeriodUI(){
  const locked=parseLockedUntil(PERIOD); const today=new Date();
  if(today<=locked){
    $("periodPill").innerText=`الفترة: مقفلة حتى ${PERIOD.lockedUntilDate}`;
    $("periodPill").style.color="rgba(245,158,11,.9)";
    $("periodHint").innerText=`الفترة مقفلة حتى ${PERIOD.lockedUntilDate}. الأدمن يمكنه التجاوز إذا كان مفعّلاً.`;
  }else{
    $("periodPill").innerText="الفترة: مفتوحة";
    $("periodPill").style.color="rgba(154,164,178,.95)";
    $("periodHint").innerText="الفترة مفتوحة. يمكنك العمل بشكل طبيعي.";
  }
}
async function doAnnualClose(year){
  const lockDate=`${year}-12-31`, openingDate=`${year+1}-01-01T00:00:00.000Z`;
  await setDoc(doc(db,"companies",COMPANY_ID,"settings","financialPeriod"),{lockedUntilDate:lockDate,allowAdminOverride:true,updatedAt:serverTimestamp(),iso:nowIso()},{merge:true});
  await addDoc(collection(db,"companies",COMPANY_ID,"journalEntries"),{ts:serverTimestamp(),date:openingDate,source:"annual_close",no:`OPEN-${year+1}`,note:`قيد افتتاحي للسنة ${year+1} (سيتم تعبئته لاحقاً حسب الأرصدة)`,lines:[],createdBy:auth.currentUser.uid,createdByEmail:auth.currentUser.email||""});
  await audit("annual_close","financialPeriod",lockDate,{});
  PERIOD=await getFinancialPeriod(); updatePeriodUI();
  showModal("تم",`تم قفل السنة حتى <b>${lockDate}</b> وإنشاء قيد افتتاحي <b>OPEN-${year+1}</b>.`,()=>{});
}
$("btnAnnualClose").addEventListener("click",()=>{
  if(!requireRole(["admin"])) return showModal("صلاحيات","إقفال السنة للأدمن فقط.",()=>{});
  showModal("إقفال سنة وتدوير أرصدة",`<div class="field"><label>السنة المراد إقفالها</label><input id="closeYear" type="number" placeholder="2026" /></div><div class="hint">سيتم قفل الفترة + إنشاء قيد افتتاحي للسنة الجديدة.</div>`,async ()=>{
    const y=Number(document.getElementById("closeYear").value);
    if(!Number.isFinite(y)||y<2000||y>2100) return showModal("خطأ","أدخل سنة صحيحة.",()=>{});
    await doAnnualClose(y);
  });
});

/* Auth & Shell */
$("btnLogin").addEventListener("click", async ()=>{
  const email=$("loginEmail").value.trim(), pass=$("loginPassword").value;
  $("loginError").innerText="";
  try{ await signInWithEmailAndPassword(auth,email,pass); }catch(e){ $("loginError").innerText="خطأ في تسجيل الدخول. تأكد من البيانات."; }
});
$("btnLogout").addEventListener("click", async ()=>{ await signOut(auth); });
$("btnHamburger").addEventListener("click",()=>openDrawer());
$("drawerBackdrop").addEventListener("click",()=>closeDrawer());
document.querySelectorAll(".navBtn").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.view)));
document.querySelectorAll("[data-go]").forEach(btn=>btn.addEventListener("click",()=>setView(btn.dataset.go)));

mountInvoiceLists();
initInvoiceListHandlers("salesInvoices","sale");
initInvoiceListHandlers("salesReturns","sale_return");
initInvoiceListHandlers("purchaseInvoices","purchase");
initInvoiceListHandlers("purchaseReturns","purchase_return");

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    $("loginPage").style.display="flex"; $("shell").style.display="none"; return;
  }
  $("loginPage").style.display="none"; $("shell").style.display="flex";
  $("userEmail").innerText=user.email||"";
  USERDOC=await loadUserDoc(user.uid);
  $("userRole").innerText=USERDOC?.role||"viewer";
  guardUI();
  COMPANY=await getCompanySettings();
  PERIOD=await getFinancialPeriod();
  WAREHOUSES=await loadWarehouses();
  ITEMS=await loadItems();
  CUSTOMERS=await loadCustomers();
  ACCOUNTS=await loadAccounts();
  fillPOS(); setCompanyUI(); updatePeriodUI();
  $("kpiItems").innerText=String(ITEMS.length);
  $("kpiCustomers").innerText=String(CUSTOMERS.length);
  $("kpiInvoicesToday").innerText=String(await countTodayInvoices());
  renderPOSLines(); refreshInvoicePreview();
  refreshItemsTable(); refreshCustomersTable(); refreshAccounts(); refreshAudit();
  setView("home");
});