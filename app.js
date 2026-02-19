import {
  auth, db,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, limit, where,
  addDoc, serverTimestamp, writeBatch, runTransaction, increment, deleteDoc
} from "./firebase.js";

const COMPANY_ID = "main";
const PATH = (p) => `companies/${COMPANY_ID}/${p}`;

const $ = (id) => document.getElementById(id);
const fmt2 = (n) => (Number(n||0)).toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2});
const todayISO = () => new Date().toISOString().slice(0,10);

const toast = (msg) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__t);
  window.__t = setTimeout(()=>t.classList.remove("show"), 2200);
};

function openDrawer(open=true){ $("drawer").classList.toggle("open", open); }
$("btnMenu").onclick = ()=>openDrawer(true);
$("btnCloseDrawer").onclick = ()=>openDrawer(false);

function showModal(id, show=true){
  $("modalBackdrop").classList.toggle("hidden", !show);
  $(id).classList.toggle("hidden", !show);
}
document.addEventListener("click", (e)=>{
  const closeId = e.target?.getAttribute?.("data-close");
  if(closeId) showModal(closeId, false);
  if(e.target?.id==="modalBackdrop"){
    ["modalCompany","modalForm","modalInvoice"].forEach(m=>{
      if(!$(m).classList.contains("hidden")) showModal(m,false);
    });
  }
});

function setView(viewId){
  ["view-login","view-home","view-pos","view-items","view-customers","view-accounts","view-reports","view-audit","view-settings"]
    .forEach(v => $(v).classList.toggle("hidden", v !== viewId));
  openDrawer(false);
}
function routeTo(route){
  const map = {
    home:"view-home", pos:"view-pos", items:"view-items", customers:"view-customers",
    accounts:"view-accounts", reports:"view-reports", audit:"view-audit", settings:"view-settings"
  };
  setView(map[route] || "view-home");
  if(route==="pos") refreshPOS();
  if(route==="items") refreshItems();
  if(route==="customers") refreshCustomers();
  if(route==="accounts") refreshAccounts();
  if(route==="reports") refreshReports();
  if(route==="audit") refreshAudit();
  if(route==="settings") loadSettings();
}
document.querySelectorAll(".nav-item[data-route], .tile[data-route]").forEach(b=>{
  b.addEventListener("click", ()=>routeTo(b.dataset.route));
});
$("tileAll").onclick = ()=>openDrawer(true);

$("btnLogin").onclick = async ()=>{
  $("loginHint").textContent = "";
  try{
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  }catch(e){
    $("loginHint").textContent = "فشل الدخول: " + (e?.message || e);
  }
};
$("btnLogout").onclick = async ()=>{ await signOut(auth); toast("تم تسجيل الخروج"); };

let currentUser=null, isAdmin=false;
let companyDoc=null, accDefaults=null, financialPeriod=null;
let defaultWarehouseId="wh_main";

async function logAudit(action, entity, entityId){
  try{
    await addDoc(collection(db, PATH("auditLog")),{
      at: serverTimestamp(),
      uid: currentUser?.uid||"",
      email: currentUser?.email||"",
      action, entity, entityId
    });
  }catch(_){}
}

async function ensureCoreDocs(){
  await setDoc(doc(db, PATH("settings/company")),{
    name:"matgr mo", phoneSales:"", whatsapp:"", telegram:"", facebookUrl:"",
    address:"", footerNote:"شكراً لتعاملكم معنا", showSocialIcons:true, defaultPrint:"A4", logoDataUrl:""
  },{merge:true});

  await setDoc(doc(db, PATH("settings/accountingDefaults")),{
    customersAcc:"12002", salesAcc:"41", inventoryAcc:"12001", cogsAcc:"",
    cashAcc:"14001", vodafoneAcc:"14002", instaAcc:"14003", suppliersAcc:"21001"
  },{merge:true});

  await setDoc(doc(db, PATH("settings/financialPeriod")),{
    allowAdminOverride:true, lockedUntilDate:"1970-01-01"
  },{merge:true});

  await setDoc(doc(db, PATH("counters/numbers")),{
    invoiceSale:1, journalEntry:1
  },{merge:true});

  await setDoc(doc(db, PATH("warehouses/wh_main")),{
    active:true, isDefault:true, name:"المستودع الرئيسي"
  },{merge:true});
}

async function ensureFirstAdmin(){
  const snap = await getDocs(query(collection(db, PATH("users")), limit(1)));
  if(snap.empty){
    await setDoc(doc(db, PATH(`users/${currentUser.uid}`)),{role:"admin", email:currentUser.email, createdAt:serverTimestamp()},{merge:true});
  }else{
    const uref = doc(db, PATH(`users/${currentUser.uid}`));
    const us = await getDoc(uref);
    if(!us.exists()){
      await setDoc(uref,{role:"user", email:currentUser.email, createdAt:serverTimestamp()},{merge:true});
    }
  }
}

async function loadSettings(){
  const cs = await getDoc(doc(db, PATH("settings/company")));
  companyDoc = cs.exists()? cs.data():{};
  const ad = await getDoc(doc(db, PATH("settings/accountingDefaults")));
  accDefaults = ad.exists()? ad.data():{};
  const fp = await getDoc(doc(db, PATH("settings/financialPeriod")));
  financialPeriod = fp.exists()? fp.data():{allowAdminOverride:true, lockedUntilDate:"1970-01-01"};

  $("setCustomersAcc").value = accDefaults.customersAcc || "";
  $("setSalesAcc").value = accDefaults.salesAcc || "";
  $("setInventoryAcc").value = accDefaults.inventoryAcc || "";
  $("setCogsAcc").value = accDefaults.cogsAcc || "";
  $("setCashAcc").value = accDefaults.cashAcc || "";
  $("setVodafoneAcc").value = accDefaults.vodafoneAcc || "";
  $("setInstaAcc").value = accDefaults.instaAcc || "";
  $("setSuppliersAcc").value = accDefaults.suppliersAcc || "";
  $("setLockUntil").value = financialPeriod.lockedUntilDate || "1970-01-01";
  $("setAdminOverride").value = String(financialPeriod.allowAdminOverride ?? true);
}

async function refreshCompany(){
  const cs = await getDoc(doc(db, PATH("settings/company")));
  companyDoc = cs.exists()? cs.data():{};
}

async function loadRole(){
  const us = await getDoc(doc(db, PATH(`users/${currentUser.uid}`)));
  const role = us.exists()? (us.data().role || "user") : "user";
  isAdmin = role==="admin";
  $("userBadge").textContent = `${currentUser.email} — ${isAdmin? "Admin":"User"}`;
}

function canOverride(){
  return isAdmin && financialPeriod?.allowAdminOverride===true;
}
async function isLocked(dateISO){
  await loadSettings();
  if(canOverride()) return false;
  return dateISO < (financialPeriod?.lockedUntilDate || "1970-01-01");
}

onAuthStateChanged(auth, async (u)=>{
  currentUser = u||null;
  if(!u){
    $("btnLogout").classList.add("hidden");
    $("userBadge").textContent = "غير مسجل";
    setView("view-login");
    return;
  }
  $("btnLogout").classList.remove("hidden");
  await ensureCoreDocs();
  await ensureFirstAdmin();
  await loadRole();
  await loadSettings();
  setView("view-home");
  toast("تم تسجيل الدخول");
});

// ===== Company modal =====
$("btnCompany").onclick = async ()=>{
  if(!currentUser) return;
  await refreshCompany();
  $("cmpName").value = companyDoc.name||"";
  $("cmpPhoneSales").value = companyDoc.phoneSales||"";
  $("cmpWhatsapp").value = companyDoc.whatsapp||"";
  $("cmpTelegram").value = companyDoc.telegram||"";
  $("cmpFacebook").value = companyDoc.facebookUrl||"";
  $("cmpAddress").value = companyDoc.address||"";
  $("cmpFooter").value = companyDoc.footerNote||"";
  $("cmpShowIcons").value = String(companyDoc.showSocialIcons ?? true);
  $("cmpLogoFile").value="";
  $("companyHint").textContent="";
  showModal("modalCompany", true);
};

async function compressImageToDataUrl(file, maxW=520, quality=0.82){
  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  await new Promise((res,rej)=>{img.onload=res; img.onerror=rej;});
  const ratio = img.width/img.height;
  const w = Math.min(maxW, img.width);
  const h = Math.round(w/ratio);
  const c = document.createElement("canvas");
  c.width=w; c.height=h;
  const ctx=c.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,w,h);
  ctx.drawImage(img,0,0,w,h);
  const url=c.toDataURL("image/jpeg", quality);
  URL.revokeObjectURL(img.src);
  return url;
}

$("btnSaveCompany").onclick = async ()=>{
  try{
    const ref = doc(db, PATH("settings/company"));
    const payload = {
      name:$("cmpName").value.trim(),
      phoneSales:$("cmpPhoneSales").value.trim(),
      whatsapp:$("cmpWhatsapp").value.trim(),
      telegram:$("cmpTelegram").value.trim(),
      facebookUrl:$("cmpFacebook").value.trim(),
      address:$("cmpAddress").value.trim(),
      footerNote:$("cmpFooter").value.trim(),
      showSocialIcons: $("cmpShowIcons").value==="true",
      defaultPrint: $("cmpPrintDefault").value
    };
    const file = $("cmpLogoFile").files?.[0];
    if(file) payload.logoDataUrl = await compressImageToDataUrl(file);
    await setDoc(ref, payload, {merge:true});
    await logAudit("update","company","settings/company");
    showModal("modalCompany", false);
    toast("تم حفظ بيانات الشركة");
  }catch(e){
    $("companyHint").textContent = "تعذر الحفظ: " + (e?.message||e);
  }
};

// ===== Settings save =====
$("btnSaveSettings").onclick = async ()=>{
  try{
    if(!isAdmin) return toast("التعديل للأدمن فقط");
    await setDoc(doc(db, PATH("settings/accountingDefaults")),{
      customersAcc:$("setCustomersAcc").value.trim(),
      salesAcc:$("setSalesAcc").value.trim(),
      inventoryAcc:$("setInventoryAcc").value.trim(),
      cogsAcc:$("setCogsAcc").value.trim(),
      cashAcc:$("setCashAcc").value.trim(),
      vodafoneAcc:$("setVodafoneAcc").value.trim(),
      instaAcc:$("setInstaAcc").value.trim(),
      suppliersAcc:$("setSuppliersAcc").value.trim()
    },{merge:true});
    await setDoc(doc(db, PATH("settings/financialPeriod")),{
      lockedUntilDate:$("setLockUntil").value || "1970-01-01",
      allowAdminOverride: $("setAdminOverride").value==="true"
    },{merge:true});
    await logAudit("update","settings","financialPeriod/accountingDefaults");
    $("settingsHint").textContent="تم الحفظ";
    toast("تم حفظ الإعدادات");
  }catch(e){
    $("settingsHint").textContent="خطأ: " + (e?.message||e);
  }
};

// ===== Accounts =====
let accountsCache=[];
$("accountsSearch").oninput = ()=>renderAccounts();

async function refreshAccounts(){
  const snap = await getDocs(query(collection(db, PATH("accounts")), orderBy("code")));
  accountsCache = snap.docs.map(d=>({id:d.id, ...d.data()}));
  renderAccounts();
}

function buildTree(list, parent=""){
  const kids = list.filter(x => (x.parent||"") === parent).sort((a,b)=>(a.code||"").localeCompare(b.code||""));
  return kids.map(k=>({...k, children: buildTree(list, k.code)}));
}
function renderAccounts(){
  const term = $("accountsSearch").value.trim();
  const list = term ? accountsCache.filter(a => (a.code||"").includes(term) || (a.name||"").includes(term)) : accountsCache;
  const tree = buildTree(list);
  const box = $("accountsTree");
  box.innerHTML="";
  const ensureStyle = ()=>{
    if(document.getElementById("treeStyle")) return;
    const st=document.createElement("style");
    st.id="treeStyle";
    st.textContent = `
      .tree-row{display:grid;grid-template-columns:120px 1fr 90px 170px;gap:10px;align-items:center;
        padding:10px;border-bottom:1px solid rgba(34,52,85,.65);}
      .tree-row:hover{background:rgba(14,165,164,.06)}
      .tree-actions{display:flex;gap:8px}
      .tree-actions .btn{padding:8px 10px}
      .tree-code{font-weight:800}
      .tree-meta{color:#93a4c7;font-size:12px}
    `;
    document.head.appendChild(st);
  };
  ensureStyle();
  const walk = (n, depth)=>{
    const row=document.createElement("div");
    row.className="tree-row";
    row.style.paddingRight = (8+depth*14)+"px";
    row.innerHTML = `
      <div class="tree-code"><bdi>${n.code||""}</bdi></div>
      <div>${n.name||""}</div>
      <div class="tree-meta">${n.allowPost? "ترحيل":"تجميعي"}</div>
      <div class="tree-actions">
        <button class="btn" data-act="e">تعديل</button>
        <button class="btn danger" data-act="d">حذف</button>
      </div>
    `;
    row.querySelector('[data-act="e"]').onclick = ()=>openAccountForm(n);
    row.querySelector('[data-act="d"]').onclick = ()=>deleteAccount(n);
    box.appendChild(row);
    (n.children||[]).forEach(ch=>walk(ch, depth+1));
  };
  tree.forEach(n=>walk(n,0));
}

$("btnAddAccount").onclick = ()=>openAccountForm(null);

function openAccountForm(acc){
  showModal("modalForm", true);
  $("modalFormTitle").textContent = acc? `تعديل حساب ${acc.code}`:"إضافة حساب";
  $("modalFormBody").innerHTML = `
    <div class="form grid2">
      <div class="field"><label>الكود</label><input id="fAccCode" ${acc?"disabled":""} value="${acc?.code||""}" placeholder="14001"></div>
      <div class="field"><label>اسم الحساب</label><input id="fAccName" value="${acc?.name||""}"></div>
      <div class="field"><label>الأب (Parent)</label><input id="fAccParent" value="${acc?.parent||""}" placeholder="14 أو فارغ"></div>
      <div class="field"><label>المستوى</label><input id="fAccLevel" type="number" min="1" value="${acc?.level||1}"></div>
      <div class="field"><label>النوع</label>
        <select id="fAccType">
          <option value="asset">أصول</option><option value="liability">خصوم</option><option value="equity">حقوق</option>
          <option value="revenue">إيرادات</option><option value="purchase">مشتريات</option><option value="expense">مصاريف</option><option value="cogs">تكلفة</option>
        </select>
      </div>
      <div class="field"><label>ترحيل</label>
        <select id="fAccAllowPost"><option value="false">تجميعي</option><option value="true">ترحيل</option></select>
      </div>
    </div>
    <div class="hint" id="fAccHint"></div>
  `;
  $("fAccType").value = acc?.type || "asset";
  $("fAccAllowPost").value = String(acc?.allowPost ?? false);

  $("modalFormFoot").innerHTML = `
    <button class="btn" data-close="modalForm">إلغاء</button>
    <button class="btn primary" id="btnSaveAcc">${acc? "حفظ":"إضافة"}</button>
  `;
  $("btnSaveAcc").onclick = async ()=>{
    try{
      const code=$("fAccCode").value.trim(), name=$("fAccName").value.trim();
      if(!code || !name) return $("fAccHint").textContent="الكود والاسم مطلوبان";
      await setDoc(doc(db, PATH(`accounts/${code}`)),{
        code, name,
        parent:$("fAccParent").value.trim(),
        level:Number($("fAccLevel").value||1),
        type:$("fAccType").value,
        allowPost:$("fAccAllowPost").value==="true",
        active:true, updatedAt:serverTimestamp()
      },{merge:true});
      await logAudit(acc? "update":"create","account",code);
      showModal("modalForm", false);
      toast("تم حفظ الحساب");
      refreshAccounts();
    }catch(e){
      $("fAccHint").textContent="خطأ: "+(e?.message||e);
    }
  };
}

async function deleteAccount(acc){
  if(!isAdmin) return toast("الحذف للأدمن فقط");
  if(!confirm(`حذف الحساب ${acc.code} ؟`)) return;
  try{
    await deleteDoc(doc(db, PATH(`accounts/${acc.code}`)));
    await logAudit("delete","account",acc.code);
    toast("تم الحذف");
    refreshAccounts();
  }catch(e){
    toast("تعذر الحذف: "+(e?.message||e));
  }
}

$("btnSeedAccounts").onclick = async ()=>{
  if(!isAdmin) return toast("للأدمن فقط");
  const basics = [
    {code:"1",name:"الأصول",parent:"",level:1,type:"asset",allowPost:false},
    {code:"12",name:"الأصول المتداولة",parent:"1",level:2,type:"asset",allowPost:false},
    {code:"12001",name:"مخزون بضاعة",parent:"12",level:3,type:"asset",allowPost:true},
    {code:"12002",name:"عملاء",parent:"12",level:3,type:"asset",allowPost:true},
    {code:"14",name:"الأموال الجاهزة والشبه جاهزة",parent:"1",level:2,type:"asset",allowPost:false},
    {code:"14001",name:"خزينة كاش",parent:"14",level:3,type:"asset",allowPost:true},
    {code:"14002",name:"فودافون",parent:"14",level:3,type:"asset",allowPost:true},
    {code:"14003",name:"إنستا",parent:"14",level:3,type:"asset",allowPost:true},
    {code:"2",name:"الخصوم",parent:"",level:1,type:"liability",allowPost:false},
    {code:"21",name:"الخصوم قصيرة الأجل",parent:"2",level:2,type:"liability",allowPost:false},
    {code:"21001",name:"موردين",parent:"21",level:3,type:"liability",allowPost:true},
    {code:"4",name:"الإيرادات",parent:"",level:1,type:"revenue",allowPost:false},
    {code:"41",name:"مبيعات",parent:"4",level:2,type:"revenue",allowPost:true},
    {code:"6",name:"مصاريف",parent:"",level:1,type:"expense",allowPost:false}
  ];
  const batch = writeBatch(db);
  basics.forEach(b=>batch.set(doc(db, PATH(`accounts/${b.code}`)),{...b,active:true,updatedAt:serverTimestamp()},{merge:true}));
  await batch.commit();
  await logAudit("seed","accounts","basics");
  toast("تم تأكيد الحسابات الأساسية");
  refreshAccounts();
};

// ===== Items, Customers, Warehouses, Stock =====
let itemsCache=[], customersCache=[], warehousesCache=[], stockMap=new Map();

async function refreshWarehouses(){
  const snap = await getDocs(query(collection(db, PATH("warehouses"))));
  warehousesCache = snap.docs.map(d=>({id:d.id,...d.data()})).filter(w=>w.active!==false);
  const def = warehousesCache.find(w=>w.isDefault) || warehousesCache[0];
  if(def) defaultWarehouseId = def.id;
  const sel = $("itemsWarehouseFilter");
  sel.innerHTML = warehousesCache.map(w=>`<option value="${w.id}">${w.name||w.id}</option>`).join("");
  sel.value = defaultWarehouseId;
}

async function refreshStock(){
  const snap = await getDocs(query(collection(db, PATH("stock")), where("warehouseId","==", defaultWarehouseId)));
  stockMap = new Map();
  snap.docs.forEach(d=>{
    const s=d.data();
    stockMap.set(`${s.itemId}|${s.warehouseId}`, {id:d.id,...s});
  });
}

async function ensureStockDoc(itemId, warehouseId){
  const key=`${itemId}|${warehouseId}`;
  if(stockMap.has(key)) return stockMap.get(key);
  const ref = await addDoc(collection(db, PATH("stock")),{itemId,warehouseId,quantity:0,updatedAt:serverTimestamp()});
  const obj={id:ref.id,itemId,warehouseId,quantity:0};
  stockMap.set(key,obj);
  return obj;
}

$("itemsSearch").oninput = ()=>renderItems();

async function refreshItems(){
  await refreshWarehouses();
  await refreshStock();
  const snap = await getDocs(query(collection(db, PATH("items")), orderBy("name")));
  itemsCache = snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.id!=="_init");
  renderItems();
  refreshPOSSelectors();
}
function renderItems(){
  const term = $("itemsSearch").value.trim();
  const list = term ? itemsCache.filter(i => (i.name||"").includes(term) || (i.code||"").includes(term) || (i.barcode||"").includes(term)) : itemsCache;
  const tbody = $("itemsTable").querySelector("tbody");
  tbody.innerHTML="";
  list.forEach(i=>{
    const qty = Number(stockMap.get(`${i.id}|${defaultWarehouseId}`)?.quantity || 0);
    const tr=document.createElement("tr");
    tr.innerHTML = `
      <td><bdi>${i.code||""}</bdi></td>
      <td><bdi>${i.barcode||""}</bdi></td>
      <td>${i.name||""}</td>
      <td>${i.unit||""}</td>
      <td><bdi>${fmt2(i.salePrice||0)}</bdi></td>
      <td><bdi>${fmt2(qty)}</bdi></td>
      <td>
        <button class="btn" data-e>تعديل</button>
        <button class="btn danger" data-d>حذف</button>
      </td>
    `;
    tr.querySelector("[data-e]").onclick=()=>openItemForm(i);
    tr.querySelector("[data-d]").onclick=()=>deleteItem(i);
    tbody.appendChild(tr);
  });
  $("kpiItems").textContent=String(itemsCache.length);
}
$("btnAddItem").onclick = ()=>openItemForm(null);

function openItemForm(item){
  showModal("modalForm", true);
  $("modalFormTitle").textContent = item? "تعديل مادة":"إضافة مادة";
  $("modalFormBody").innerHTML = `
    <div class="form grid2">
      <div class="field"><label>الكود</label><input id="fItemCode" value="${item?.code||""}" placeholder="110001"></div>
      <div class="field"><label>الباركود</label><input id="fItemBarcode" value="${item?.barcode||""}" placeholder="اختياري"></div>
      <div class="field"><label>اسم المادة</label><input id="fItemName" value="${item?.name||""}"></div>
      <div class="field"><label>الوحدة</label><input id="fItemUnit" value="${item?.unit||"قطعة"}"></div>
      <div class="field"><label>سعر البيع</label><input id="fItemPrice" type="number" step="0.01" min="0" value="${item?.salePrice ?? 0}"></div>
      <div class="field"><label>كمية افتتاحية (للإضافة فقط)</label><input id="fItemQty" type="number" min="0" step="1" value=""></div>
    </div>
    <div class="hint" id="fItemHint"></div>
  `;
  $("modalFormFoot").innerHTML = `
    <button class="btn" data-close="modalForm">إلغاء</button>
    <button class="btn primary" id="btnSaveItem">${item? "حفظ":"إضافة"}</button>
  `;
  $("btnSaveItem").onclick = async ()=>{
    try{
      const name=$("fItemName").value.trim();
      if(!name) return $("fItemHint").textContent="الاسم مطلوب";
      const payload={
        code:$("fItemCode").value.trim(),
        barcode:$("fItemBarcode").value.trim(),
        name,
        unit:$("fItemUnit").value.trim()||"قطعة",
        salePrice:Number($("fItemPrice").value||0),
        active:true,
        updatedAt:serverTimestamp()
      };
      if(item){
        await setDoc(doc(db, PATH(`items/${item.id}`)), payload, {merge:true});
        await logAudit("update","item",item.id);
      }else{
        const ref=await addDoc(collection(db, PATH("items")), payload);
        await logAudit("create","item",ref.id);
        const qty=Number($("fItemQty").value||0);
        if(qty>0){
          const st=await ensureStockDoc(ref.id, defaultWarehouseId);
          await setDoc(doc(db, PATH(`stock/${st.id}`)),{quantity:qty,updatedAt:serverTimestamp()},{merge:true});
          await logAudit("stock_init","stock",ref.id);
        }
      }
      showModal("modalForm", false);
      toast("تم حفظ المادة");
      refreshItems();
    }catch(e){
      $("fItemHint").textContent="خطأ: "+(e?.message||e);
    }
  };
}
async function deleteItem(item){
  if(!isAdmin) return toast("الحذف للأدمن فقط");
  if(!confirm(`حذف "${item.name}" ؟`)) return;
  await deleteDoc(doc(db, PATH(`items/${item.id}`)));
  await logAudit("delete","item",item.id);
  toast("تم الحذف");
  refreshItems();
}

// customers
$("customersSearch").oninput = ()=>renderCustomers();
async function refreshCustomers(){
  const snap = await getDocs(query(collection(db, PATH("customers")), orderBy("name")));
  customersCache = snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.id!=="_init");
  renderCustomers();
  refreshPOSSelectors();
}
function renderCustomers(){
  const term=$("customersSearch").value.trim();
  const list=term? customersCache.filter(c=>(c.name||"").includes(term)||(c.phone||"").includes(term)) : customersCache;
  const tbody=$("customersTable").querySelector("tbody");
  tbody.innerHTML="";
  list.forEach(c=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${c.name||""}</td><td><bdi>${c.phone||""}</bdi></td><td>${c.address||""}</td>
      <td><button class="btn" data-e>تعديل</button><button class="btn danger" data-d>حذف</button></td>
    `;
    tr.querySelector("[data-e]").onclick=()=>openCustomerForm(c);
    tr.querySelector("[data-d]").onclick=()=>deleteCustomer(c);
    tbody.appendChild(tr);
  });
  $("kpiCustomers").textContent=String(customersCache.length);
}
$("btnAddCustomer").onclick = ()=>openCustomerForm(null);

function openCustomerForm(c){
  showModal("modalForm", true);
  $("modalFormTitle").textContent = c? "تعديل عميل":"إضافة عميل";
  $("modalFormBody").innerHTML=`
    <div class="form grid2">
      <div class="field"><label>الاسم</label><input id="fCusName" value="${c?.name||""}"></div>
      <div class="field"><label>الهاتف</label><input id="fCusPhone" value="${c?.phone||""}"></div>
      <div class="field" style="grid-column:1/-1"><label>العنوان</label><input id="fCusAddr" value="${c?.address||""}"></div>
    </div>
    <div class="hint" id="fCusHint"></div>
  `;
  $("modalFormFoot").innerHTML = `
    <button class="btn" data-close="modalForm">إلغاء</button>
    <button class="btn primary" id="btnSaveCus">${c? "حفظ":"إضافة"}</button>
  `;
  $("btnSaveCus").onclick = async ()=>{
    try{
      const name=$("fCusName").value.trim();
      if(!name) return $("fCusHint").textContent="الاسم مطلوب";
      const payload={name, phone:$("fCusPhone").value.trim(), address:$("fCusAddr").value.trim(), active:true, updatedAt:serverTimestamp()};
      if(c){
        await setDoc(doc(db, PATH(`customers/${c.id}`)), payload, {merge:true});
        await logAudit("update","customer",c.id);
      }else{
        const ref=await addDoc(collection(db, PATH("customers")), payload);
        await logAudit("create","customer",ref.id);
      }
      showModal("modalForm", false);
      toast("تم حفظ العميل");
      refreshCustomers();
    }catch(e){
      $("fCusHint").textContent="خطأ: "+(e?.message||e);
    }
  };
}
async function deleteCustomer(c){
  if(!isAdmin) return toast("الحذف للأدمن فقط");
  const inv = await getDocs(query(collection(db, PATH("invoices")), where("customerId","==", c.id), limit(1)));
  if(!inv.empty) return toast("لا يمكن حذف عميل عليه حركة/فواتير");
  await deleteDoc(doc(db, PATH(`customers/${c.id}`)));
  await logAudit("delete","customer",c.id);
  toast("تم حذف العميل");
  refreshCustomers();
}

// ===== POS =====
let posLines=[];
let counters=null;

function refreshPOSSelectors(){
  const selC=$("posCustomer");
  if(selC){
    selC.innerHTML = [`<option value="">عميل نقدي</option>`].concat(customersCache.map(c=>`<option value="${c.id}">${c.name}</option>`)).join("");
  }
  const selI=$("posItem");
  if(selI){
    selI.innerHTML = itemsCache.map(i=>`<option value="${i.id}">${i.name}</option>`).join("");
    if(itemsCache[0]) setPosItem(itemsCache[0].id);
  }
  const selR=$("rptItemSelect");
  if(selR) selR.innerHTML = itemsCache.map(i=>`<option value="${i.id}">${i.name}</option>`).join("");
}

async function refreshCounters(){
  const cs = await getDoc(doc(db, PATH("counters/numbers")));
  counters = cs.exists()? cs.data():{invoiceSale:1,journalEntry:1};
  $("kpiLastInvoice").textContent = String((counters.invoiceSale||1)-1);
}
async function refreshPOS(){
  await refreshCustomers();
  await refreshItems();
  await refreshCounters();
  newSale();
}
function newSale(){
  posLines=[];
  $("posNote").value="";
  $("posWarn").textContent="";
  $("posQty").value="1";
  renderPosTable();
}
$("btnNewSale").onclick = ()=>newSale();

function setPosItem(itemId){
  const it=itemsCache.find(x=>x.id===itemId);
  if(it) $("posPrice").value=String(Number(it.salePrice||0));
}
$("posItem").onchange = (e)=>setPosItem(e.target.value);

function renderPosTable(){
  const tbody=$("posTable").querySelector("tbody");
  tbody.innerHTML="";
  let total=0;
  posLines.forEach((l,idx)=>{
    const v=Number(l.qty)*Number(l.price);
    total += v;
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><bdi>${l.code||""}</bdi></td><td>${l.name||""}</td><td>${l.unit||""}</td>
      <td><bdi>${fmt2(l.qty)}</bdi></td><td><bdi>${fmt2(l.price)}</bdi></td><td><bdi>${fmt2(v)}</bdi></td>
      <td><button class="btn danger">حذف</button></td>
    `;
    tr.querySelector("button").onclick=()=>{posLines.splice(idx,1);renderPosTable();};
    tbody.appendChild(tr);
  });
  $("posTotal").textContent=fmt2(total);
}

$("btnAddLine").onclick = ()=>{
  $("posWarn").textContent="";
  const itemId=$("posItem").value;
  const it=itemsCache.find(x=>x.id===itemId);
  if(!it) return;
  const qty=Math.max(1, Number($("posQty").value||1));
  const price=Math.max(0, Number($("posPrice").value||0));
  const available = Number(stockMap.get(`${itemId}|${defaultWarehouseId}`)?.quantity || 0);
  const already = posLines.filter(x=>x.itemId===itemId).reduce((s,x)=>s+Number(x.qty||0),0);
  if(available - already < qty){
    $("posWarn").textContent="الكمية لا تسمح";
    return;
  }
  posLines.push({itemId, code:it.code||"", name:it.name, unit:it.unit||"", qty, price});
  renderPosTable();
};

async function nextCounter(name){
  const ref = doc(db, PATH("counters/numbers"));
  return await runTransaction(db, async (tx)=>{
    const s = await tx.get(ref);
    const cur = Number(s.data()?.[name] || 1);
    tx.update(ref, {[name]: increment(1)});
    return cur;
  });
}
function payMethodLabel(v){
  return v==="cash"?"كاش":v==="vodafone"?"فودافون":v==="insta"?"إنستا":"آجل";
}
function payMethodAccount(method){
  if(method==="cash") return accDefaults.cashAcc;
  if(method==="vodafone") return accDefaults.vodafoneAcc;
  if(method==="insta") return accDefaults.instaAcc;
  return accDefaults.customersAcc; // آجل
}
function toWordsEGP(n){
  const v = Math.round((Number(n)||0)*100)/100;
  return `فقط ${fmt2(v)} جنيه مصري لا غير`;
}

$("btnSaveInvoice").onclick = async ()=>{
  try{
    $("posWarn").textContent="";
    if(posLines.length===0) return $("posWarn").textContent="أضف مواد أولاً";
    const dateISO=todayISO();
    if(await isLocked(dateISO)) return $("posWarn").textContent="الفترة مقفلة لهذا التاريخ";
    await loadSettings();
    if(!accDefaults.customersAcc || !accDefaults.salesAcc) return $("posWarn").textContent="أكمل إعدادات المحاسبة";

    // تحقق مخزون
    for(const l of posLines){
      const available = Number(stockMap.get(`${l.itemId}|${defaultWarehouseId}`)?.quantity || 0);
      if(available < Number(l.qty||0)) return $("posWarn").textContent="الكمية لا تسمح";
    }

    const invoiceNo = await nextCounter("invoiceSale");
    const jeNo = await nextCounter("journalEntry");
    const invId = `S-${invoiceNo}`;

    const customerId=$("posCustomer").value||"";
    const customer=customersCache.find(c=>c.id===customerId);
    const payMethod=$("posPayMethod").value;
    const note=$("posNote").value.trim();
    const total=posLines.reduce((s,l)=>s+Number(l.qty)*Number(l.price),0);

    const batch = writeBatch(db);

    // invoice
    batch.set(doc(db, PATH(`invoices/${invId}`)),{
      no:invoiceNo, type:"sale", date:dateISO, createdAt:serverTimestamp(),
      uid:currentUser.uid, email:currentUser.email,
      customerId, customerName: customer?.name || "عميل نقدي",
      payMethod, payMethodLabel: payMethodLabel(payMethod),
      warehouseId: defaultWarehouseId,
      note,
      lines: posLines.map(l=>({itemId:l.itemId, code:l.code, name:l.name, unit:l.unit, qty:l.qty, price:l.price, value:Number(l.qty)*Number(l.price)})),
      total
    });

    // stock updates
    for(const l of posLines){
      const st = await ensureStockDoc(l.itemId, defaultWarehouseId);
      batch.set(doc(db, PATH(`stock/${st.id}`)),{quantity: increment(-Number(l.qty)), updatedAt:serverTimestamp()},{merge:true});
    }

    // journal entry
    const debitAcc = payMethod==="credit" ? accDefaults.customersAcc : payMethodAccount(payMethod);
    const creditAcc = accDefaults.salesAcc;
    batch.set(doc(db, PATH(`journalEntries/J-${jeNo}`)),{
      no:jeNo, date:dateISO, source:"invoiceSale", sourceId:invId,
      createdAt:serverTimestamp(), uid:currentUser.uid, email:currentUser.email,
      memo:`فاتورة بيع رقم ${invoiceNo}`,
      lines:[
        {acc:debitAcc, side:"debit", amount:total, note:`قيد ${invId}`},
        {acc:creditAcc, side:"credit", amount:total, note:`قيد ${invId}`}
      ]
    });

    await batch.commit();
    await logAudit("create","invoice",invId);
    await logAudit("create","journalEntry",`J-${jeNo}`);

    toast("تم حفظ الفاتورة");
    await refreshStock();
    await refreshItems();
    await refreshCounters();
    await showInvoiceModal(invId);
    newSale();
  }catch(e){
    $("posWarn").textContent="خطأ: "+(e?.message||e);
  }
};

async function showInvoiceModal(invId){
  await refreshCompany();
  const snap = await getDoc(doc(db, PATH(`invoices/${invId}`)));
  if(!snap.exists()) return;
  const inv=snap.data();
  const c=companyDoc||{};
  const logo = c.logoDataUrl ? `<img class="inv-logo" src="${c.logoDataUrl}" alt="logo">`
                             : `<div class="inv-logo" style="display:grid;place-items:center;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc">LOGO</div>`;
  const icons = (c.showSocialIcons!==false) ? `
    <div class="inv-social"><div class="badge">W</div><div class="badge">T</div><div class="badge">F</div></div>` : "";
  const rows = (inv.lines||[]).map(l=>`
    <tr>
      <td>${l.code||""}</td><td>${l.name||""}</td><td>${l.qty}</td><td>${l.unit||""}</td>
      <td>${fmt2(l.price)}</td><td>${fmt2(l.value)}</td>
    </tr>`).join("");

  $("invoiceArea").innerHTML = `
    <div class="inv-head">
      ${logo}
      <div style="text-align:left">
        <div style="font-weight:900;font-size:22px;">${c.name||""}</div>
        <div style="margin-top:8px;font-size:13px;">
          <div>Contact Sales</div>
          <div><bdi>${c.phoneSales||""}</bdi></div>
        </div>
        ${icons}
      </div>
    </div>
    <h1>فاتورة : مبيعات</h1>
    <div class="meta"><div>رقم الفاتورة: <bdi>${inv.no}</bdi></div><div>التاريخ: <bdi>${inv.date||""}</bdi></div></div>
    <div class="meta"><div>السيد: <b>${inv.customerName||""}</b></div><div>البيان: <b>${inv.note||""}</b></div></div>
    <table>
      <thead><tr><th>رمز المادة</th><th>اسم المادة</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>القيمة</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sum">
      <div class="box">
        <div class="row"><span>المجموع:</span><bdi>${fmt2(inv.total)}</bdi></div>
        <div class="row"><span>إجمالي الحسميات:</span><bdi>${fmt2(0)}</bdi></div>
        <div class="row"><span>المجموع النهائي:</span><bdi>${fmt2(inv.total)}</bdi></div>
      </div>
      <div class="box">
        <div style="font-weight:900;margin-bottom:6px;">${toWordsEGP(inv.total)}</div>
        <div class="small">طريقة الدفع: <b>${inv.payMethodLabel||""}</b></div>
        <div class="small">العنوان: ${c.address||""}</div>
      </div>
    </div>
    <div class="foot"><div>رصيد العميل قبل الفاتورة: <bdi>-</bdi></div><div>رصيد العميل: <bdi>-</bdi></div></div>
    <div style="margin-top:8px;text-align:center;font-size:12px;color:#111">${c.footerNote||""}</div>
  `;

  showModal("modalInvoice", true);

  $("btnDownloadPNG").onclick = async ()=>{
    const canvas = await window.html2canvas($("invoiceArea"), {scale:2, backgroundColor:"#ffffff"});
    const a=document.createElement("a");
    a.download = `invoice-${inv.no}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };
  $("btnDownloadPDF").onclick = async ()=>{
    const canvas = await window.html2canvas($("invoiceArea"), {scale:2, backgroundColor:"#ffffff"});
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const w=window.open("","_blank");
    w.document.write(`<html dir="rtl"><head><title>invoice</title></head><body style="margin:0"><img src="${img}" style="width:100%"/></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
}

$("btnOpenInvoices").onclick = async ()=>{
  const snap = await getDocs(query(collection(db, PATH("invoices")), orderBy("createdAt","desc"), limit(10)));
  const list = snap.docs.map(d=>({id:d.id,...d.data()}));
  showModal("modalForm", true);
  $("modalFormTitle").textContent="آخر الفواتير";
  $("modalFormBody").innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>الرقم</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody>
          ${list.map(x=>`
            <tr>
              <td><bdi>${x.id}</bdi></td><td><bdi>${x.date||""}</bdi></td><td>${x.customerName||""}</td>
              <td><bdi>${fmt2(x.total||0)}</bdi></td>
              <td><button class="btn" data-open="${x.id}">فتح</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
  $("modalFormFoot").innerHTML = `<button class="btn" data-close="modalForm">إغلاق</button>`;
  document.querySelectorAll("[data-open]").forEach(b=>{
    b.onclick = ()=>{ showModal("modalForm", false); showInvoiceModal(b.dataset.open); };
  });
};

// ===== Reports (مبدئي) =====
$("btnRptStock").onclick = async ()=>{
  await refreshStock();
  const tbody=$("rptStock").querySelector("tbody");
  tbody.innerHTML="";
  itemsCache.forEach(i=>{
    const qty=Number(stockMap.get(`${i.id}|${defaultWarehouseId}`)?.quantity||0);
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${i.name}</td><td><bdi>${fmt2(qty)}</bdi></td>`;
    tbody.appendChild(tr);
  });
};
$("btnRptItemMoves").onclick = async ()=>{
  const itemId=$("rptItemSelect").value;
  const tbody=$("rptItemMoves").querySelector("tbody");
  tbody.innerHTML="";
  const snap = await getDocs(query(collection(db, PATH("invoices")), where("type","==","sale"), orderBy("createdAt","desc"), limit(80)));
  snap.docs.forEach(d=>{
    const inv=d.data();
    (inv.lines||[]).filter(l=>l.itemId===itemId).forEach(l=>{
      const tr=document.createElement("tr");
      tr.innerHTML=`<td><bdi>${inv.date||""}</bdi></td><td>بيع</td><td><bdi>${l.qty}</bdi></td><td><bdi>${d.id}</bdi></td>`;
      tbody.appendChild(tr);
    });
  });
};
$("btnRptCustomerBalances").onclick = async ()=>{
  await loadSettings();
  const acc = String(accDefaults.customersAcc||"");
  const tbody=$("rptCustomerBalances").querySelector("tbody");
  tbody.innerHTML="";
  const snap = await getDocs(query(collection(db, PATH("journalEntries")), orderBy("createdAt","desc"), limit(300)));
  let debit=0, credit=0;
  snap.docs.forEach(d=>{
    const je=d.data();
    (je.lines||[]).forEach(l=>{
      if(String(l.acc)===acc){
        if(l.side==="debit") debit += Number(l.amount||0);
        else credit += Number(l.amount||0);
      }
    });
  });
  const bal=debit-credit;
  const tr=document.createElement("tr");
  tr.innerHTML=`<td>إجمالي العملاء</td><td><bdi>${fmt2(debit)}</bdi></td><td><bdi>${fmt2(credit)}</bdi></td><td><bdi>${fmt2(bal)}</bdi></td>`;
  tbody.appendChild(tr);
};

async function refreshReports(){
  refreshPOSSelectors();
}

// ===== Audit =====
$("btnRefreshAudit").onclick = ()=>refreshAudit();
async function refreshAudit(){
  const snap = await getDocs(query(collection(db, PATH("auditLog")), orderBy("at","desc"), limit(100)));
  const tbody=$("auditTable").querySelector("tbody");
  tbody.innerHTML="";
  snap.docs.forEach(d=>{
    const x=d.data();
    const when = x.at?.toDate ? x.at.toDate().toLocaleString("ar-EG") : "";
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><bdi>${when}</bdi></td><td><bdi>${x.email||""}</bdi></td><td>${x.action||""}</td><td>${x.entity||""}</td><td><bdi>${x.entityId||""}</bdi></td>`;
    tbody.appendChild(tr);
  });
}

// ===== Year close & roll-over =====
$("navCloseYear").onclick = async ()=>{
  if(!isAdmin) return toast("للأدمن فقط");
  const yearStr = prompt("اكتب سنة الإقفال (مثال 2026):");
  if(!yearStr) return;
  const y = Number(yearStr);
  if(!y || y<2000) return;
  if(!confirm(`سيتم إقفال سنة ${y} وإنشاء أرصدة افتتاحية لسنة ${y+1}. متابعة؟`)) return;

  const start = `${y}-01-01`, end = `${y}-12-31`;
  const snap = await getDocs(query(collection(db, PATH("journalEntries")), orderBy("date")));
  const bal = new Map(); // acc -> {d,c}
  snap.docs.forEach(d=>{
    const je=d.data();
    const dt=je.date||"1970-01-01";
    if(dt<start || dt>end) return;
    (je.lines||[]).forEach(l=>{
      const acc=String(l.acc||"");
      if(!acc) return;
      const cur=bal.get(acc) || {d:0,c:0};
      if(l.side==="debit") cur.d += Number(l.amount||0);
      else cur.c += Number(l.amount||0);
      bal.set(acc, cur);
    });
  });

  const openYear=y+1;
  const openDate=`${openYear}-01-01`;
  const opening=[];
  bal.forEach((v,acc)=>{
    const net=v.d - v.c;
    if(Math.abs(net) < 0.0001) return;
    opening.push({acc, net}); // + مدين / - دائن
  });

  await setDoc(doc(db, PATH(`journalEntries/OPEN-${openYear}`)),{
    no: await nextCounter("journalEntry"),
    date: openDate,
    source:"yearClose",
    sourceId:`Y-${y}`,
    createdAt: serverTimestamp(),
    uid: currentUser.uid,
    email: currentUser.email,
    memo:`أرصدة افتتاحية لسنة ${openYear} (ناتجة عن إقفال سنة ${y})`,
    openingBalances: opening
  },{merge:true});

  await setDoc(doc(db, PATH("settings/financialPeriod")),{
    lockedUntilDate: end,
    allowAdminOverride: true
  },{merge:true});

  await logAudit("year_close","financialPeriod",String(y));
  toast("تم الإقفال وإنشاء أرصدة افتتاحية");
};
