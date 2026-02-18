import * as F from './firebase.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_ADMIN = { username:'Admin', email:'admin@erp.local', password:'Admin123' };

const fmt = (n) => (Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
const todayISO = () => new Date().toISOString().slice(0,10);

let currentUser = null;
let currentRole = "guest";

// cached
let cacheItemsByModelNo = new Map();
let cacheCustomers = [];
let lastCompany = null;

function toast(msg, type="primary"){
  const wrap = document.createElement('div');
  wrap.className = `toast align-items-center text-bg-${type} border-0`;
  wrap.setAttribute('role','alert');
  wrap.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
  document.body.appendChild(wrap);
  const t = new bootstrap.Toast(wrap, { delay: 2600 });
  t.show();
  wrap.addEventListener('hidden.bs.toast', () => wrap.remove());
}

function setConnBadge(ok){
  const setOne = (el)=>{
    if(!el) return;
    if(ok){
      el.textContent = 'متصل';
      el.className = 'badge text-bg-success';
    }else{
      el.textContent = 'غير متصل';
      el.className = 'badge text-bg-warning';
    }
  };
  setOne($('#connBadge'));
  setOne($('#connBadgeLogin'));
}

function socialIcon(url){
  const u = (url||"").toLowerCase();
  if(u.includes('t.me') || u.includes('telegram')) return { icon:'fa-brands fa-telegram', label:'Telegram' };
  if(u.includes('wa.me') || u.includes('whatsapp')) return { icon:'fa-brands fa-whatsapp', label:'WhatsApp' };
  if(u.includes('instagram') || u.includes('insta')) return { icon:'fa-brands fa-instagram', label:'Instagram' };
  if(u.includes('facebook') || u.includes('fb')) return { icon:'fa-brands fa-facebook', label:'Facebook' };
  return { icon:'fa-solid fa-link', label:'Link' };
}

// -------------------- Views --------------------
function switchView(viewId){
  document.querySelectorAll('.view').forEach(v => v.classList.add('d-none'));
  const v = document.getElementById(viewId);
  if(v) v.classList.remove('d-none');

  document.querySelectorAll('[data-view]').forEach(a => a.classList.remove('active'));
  document.querySelectorAll(`[data-view="${viewId}"]`).forEach(a => a.classList.add('active'));
}

function showAppUI(isSignedIn){
  const loginView = document.getElementById('viewLogin');
  if(isSignedIn){
    loginView?.classList.add('d-none');
  }else{
    loginView?.classList.remove('d-none');
  }
  document.querySelectorAll('.view').forEach(v=>{
    if(v.id === 'viewLogin') return;
    if(isSignedIn) v.classList.remove('d-none'); else v.classList.add('d-none');
  });
  // title
  const t = document.getElementById('loginAppTitle');
  if(t) t.textContent = (localStorage.getItem('ERP_APP_NAME') || 'ERP PRO Lite');
}

document.querySelectorAll('[data-view]').forEach(a => {
  a.addEventListener('click', (e)=>{
    e.preventDefault();
    switchView(a.dataset.view);
  });
});

// -------------------- Setup Modal --------------------
const setupModal = new bootstrap.Modal($('#setupModal'));
const customerModal = new bootstrap.Modal($('#customerModal'));
const itemModal = new bootstrap.Modal($('#itemModal'));
const invoiceModal = new bootstrap.Modal($('#invoiceModal'));
const voucherModal = new bootstrap.Modal($('#voucherModal'));
const pickerModal = new bootstrap.Modal($('#pickerModal'));

function fillRulesPreview(){
  const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isAdmin() {
      return signedIn() &&
        exists(/databases/$(database)/documents/users/$(request.auth.uid)) &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin";
    }

    match /users/{uid} {
      allow read: if signedIn() && request.auth.uid == uid;
      allow write: if isAdmin() || (signedIn() && request.auth.uid == uid); // يسمح بإنشاء وثيقة المستخدم لأول مرة
    }

    match /company/{docId} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    match /items/{id} {
      allow read: if signedIn();
      allow write: if signedIn(); // يمكن تعديلها: isAdmin() فقط
    }

    match /customers/{id} {
      allow read: if signedIn();
      allow write: if signedIn();
    }

    match /invoices/{id} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if isAdmin(); // الأدمن فقط تعديل/حذف
    }

    match /vouchers/{id} {
      allow read: if signedIn();
      allow write: if signedIn();
    }

    match /counters/{name} {
      allow read: if signedIn();
      allow write: if isAdmin(); // العدادات يفضل للأدمن
    }
  }
}`;
  $('#rulesPreview').textContent = rules;
}
fillRulesPreview();


  $('#firebaseConfigText').value = cfg ? JSON.stringify(cfg, null, 2) : '';
  $('#appNameInput').value = localStorage.getItem('ERP_APP_NAME') || 'ERP PRO Lite';
  setupModal.show();
});

$('#btnSaveFirebaseConfig').addEventListener('click', ()=>{
  try{
    const cfg = JSON.parse($('#firebaseConfigText').value.trim());
    F.saveConfig(cfg);
    localStorage.setItem('ERP_APP_NAME', ($('#appNameInput').value || 'ERP PRO Lite').trim());
    toast('تم حفظ الإعداد ✅', 'success');
  }catch(e){
    toast('JSON غير صحيح', 'danger');
  }
});

$('#btnApplyFirebaseConfig').addEventListener('click', async ()=>{
  const r = F.initFirebaseFromSaved();
  if(!r.ok){
    toast('فشل تهيئة Firebase: ' + r.error, 'danger');
    setConnBadge(false);
    return;
  }
  $('#brandTitle').textContent = (localStorage.getItem('ERP_APP_NAME') || 'ERP PRO Lite');
  setConnBadge(true);
  toast('تم الاتصال بـ Firebase ✅', 'success');
  setupModal.hide();
  // wire auth
  wireAuth();
});

// -------------------- Auth --------------------
function wireAuth(){
  if(!F.Firebase.ready) return;

  F.onAuthStateChanged(F.Firebase.auth, async (user)=>{
    currentUser = user || null;
    if(user){
      await F.ensureUserDoc(user);
      // make default admin always admin
      if((user.email||'').toLowerCase() === DEFAULT_ADMIN.email.toLowerCase()){
        await F.setDoc(F.doc(F.Firebase.db,'users', user.uid), { role:'admin', email:user.email||'' }, { merge:true });
      }
      currentRole = await F.getRole(user.uid);
      showAppUI(true);
      switchView('viewCompany');
    }else{
      currentRole = "guest";
      showAppUI(false);
    }
    renderWhoami();
    await refreshAll();
  });
}

function renderWhoami(){
  if(!currentUser){
    $('#whoami').textContent = 'غير مسجل دخول';
    return;
  }
  $('#whoami').textContent = `مسجل: ${currentUser.email || ''} • الصلاحية: ${currentRole}`;
}

$('#btnDoLogin').addEventListener('click', async ()=>{
  const raw = ($('#loginEmail').value || '').trim();
  const pass = ($('#loginPassword').value || '').trim();
  if(!F.Firebase.ready) return toast('اعمل إعداد Firebase أولاً', 'warning');
  if(!raw || !pass) return toast('أدخل اسم المستخدم/البريد وكلمة المرور', 'warning');

  const isDefaultAdmin = raw.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase();
  const email = isDefaultAdmin ? DEFAULT_ADMIN.email : raw;

  try{
    await F.signInWithEmailAndPassword(F.Firebase.auth, email, pass);
  }catch(e){
    if(isDefaultAdmin){
      // auto-create admin once if not exists
      try{ await F.createUserWithEmailAndPassword(F.Firebase.auth, DEFAULT_ADMIN.email, DEFAULT_ADMIN.password); }catch(_){}
      try{ await F.signInWithEmailAndPassword(F.Firebase.auth, DEFAULT_ADMIN.email, DEFAULT_ADMIN.password); }
      catch(e3){ return toast('فشل تسجيل الدخول للأدمن. فعّل Email/Password في Firebase Auth', 'danger'); }
    }else{
      return toast('بيانات الدخول غير صحيحة', 'danger');
    }
  }
});

$('#btnDoRegister').addEventListener('click', async ()=>{
  const raw = ($('#loginEmail').value || '').trim();
  const pass = ($('#loginPassword').value || '').trim();
  if(!F.Firebase.ready) return toast('اعمل إعداد Firebase أولاً', 'warning');
  if(!raw || !pass) return toast('أدخل اسم المستخدم/البريد وكلمة المرور', 'warning');

  const isDefaultAdmin = raw.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase();
  const email = isDefaultAdmin ? DEFAULT_ADMIN.email : raw;

  try{
    await F.createUserWithEmailAndPassword(F.Firebase.auth, email, pass);
    toast('تم إنشاء الحساب ✅', 'success');
  }catch(e){
    toast('تعذر إنشاء الحساب. ربما البريد مستخدم بالفعل', 'danger');
  }
});

$('#btnDoLogout').addEventListener('click', async ()=>{
  await F.signOut(F.Firebase.auth);
  toast('تم تسجيل الخروج', 'secondary');
  
});

// -------------------- Company --------------------
function renderCompany(company){
  lastCompany = company || {};
  $('#companyName').value = lastCompany.name || '';
  $('#salesPhone1').value = lastCompany.salesPhone1 || '';
  $('#salesPhone2').value = lastCompany.salesPhone2 || '';
  $('#factoryPhone').value = lastCompany.factoryPhone || '';
  $('#companyLocationUrl').value = lastCompany.locationUrl || '';

  const socials = Array.isArray(lastCompany.socials) ? lastCompany.socials : [];
  renderSocials(socials);

  const logoUrl = lastCompany.logoUrl || '';
  const hasLogo = !!logoUrl;
  $('logoPreview').src = hasLogo ? logoUrl : '';
  $('logoPreview2').src = hasLogo ? logoUrl : '';
  $('logoHint').textContent = hasLogo ? 'تم تحميل اللوجو.' : 'لا يوجد لوجو مرفوع بعد.';
  $('previewCompanyName').textContent = lastCompany.name || '—';
  $('previewPhones').textContent = [lastCompany.salesPhone1, lastCompany.salesPhone2, lastCompany.factoryPhone].filter(Boolean).join(' • ') || '—';
  $('previewMapBtn').href = lastCompany.locationUrl || '#';
}

function renderSocials(socials){
  const chips = $('socialChips');
  const preview = $('previewSocial');
  chips.innerHTML = '';
  preview.innerHTML = '';

  socials.forEach((url, idx)=>{
    const meta = socialIcon(url);
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<i class="${meta.icon}"></i><span class="mono">${meta.label}</span>
      <button class="btn btn-sm btn-link text-danger p-0 ms-1" title="حذف"><i class="fa-solid fa-xmark"></i></button>`;
    chip.querySelector('button').addEventListener('click', ()=>{
      socials.splice(idx, 1);
      lastCompany.socials = socials;
      renderSocials(socials);
    });
    chips.appendChild(chip);

    const b = document.createElement('a');
    b.className = 'chip text-decoration-none';
    b.href = url;
    b.target = '_blank';
    b.innerHTML = `<i class="${meta.icon}"></i><span>${meta.label}</span>`;
    preview.appendChild(b);
  });
}

$('#btnAddSocial').addEventListener('click', ()=>{
  const url = $('#socialUrlInput').value.trim();
  if(!url) return;
  if(!lastCompany) lastCompany = {};
  if(!Array.isArray(lastCompany.socials)) lastCompany.socials = [];
  lastCompany.socials.push(url);
  $('#socialUrlInput').value = '';
  renderSocials(lastCompany.socials);
});

$('#btnSaveCompany').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  if(currentRole !== 'admin') return toast('حفظ بيانات الشركة للأدمن فقط', 'warning');

  const payload = {
    name: $('#companyName').value.trim(),
    salesPhone1: $('#salesPhone1').value.trim(),
    salesPhone2: $('#salesPhone2').value.trim(),
    factoryPhone: $('#factoryPhone').value.trim(),
    locationUrl: $('#companyLocationUrl').value.trim(),
    socials: (lastCompany?.socials || []),
    updatedAt: F.serverTimestamp(),
  };
  if(lastCompany?.logoUrl) payload.logoUrl = lastCompany.logoUrl;

  await F.setDoc(F.doc(F.Firebase.db, 'company', 'profile'), payload, { merge:true });
  toast('تم حفظ بيانات الشركة ✅', 'success');
  await loadCompany();
});

$('#btnUploadLogo').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  if(currentRole !== 'admin') return toast('رفع اللوجو للأدمن فقط', 'warning');

  const file = $('#logoFile').files?.[0];
  if(!file) return toast('اختر صورة', 'warning');

  try{
    const path = `logos/company_logo_${Date.now()}_${file.name}`;
    const r = F.sRef(F.Firebase.storage, path);
    await F.uploadBytes(r, file);
    const url = await F.getDownloadURL(r);
    lastCompany = lastCompany || {};
    lastCompany.logoUrl = url;
    toast('تم رفع اللوجو ✅', 'success');
    renderCompany(lastCompany);
  }catch(e){
    toast('فشل رفع اللوجو', 'danger');
  }
});

async function loadCompany(){
  if(!F.Firebase.ready || !currentUser) return;
  const snap = await F.getDoc(F.doc(F.Firebase.db, 'company', 'profile'));
  renderCompany(snap.exists() ? snap.data() : {});
}

// -------------------- Customers --------------------
function requireSignedIn(){
  if(!F.Firebase.ready){ toast('أولاً: إعداد Firebase', 'warning'); return false; }
  if(!currentUser){ toast('سجل دخول أولاً', 'warning'); return false; }
  return true;
}

$('#btnNewCustomer').addEventListener('click', ()=>{
  if(!requireSignedIn()) return;
  $('#customerId').value = '';
  $('#custName').value = '';
  $('#custPhone').value = '';
  $('#custAddress').value = '';
  $('#custShip').value = '';
  $('#customerModalTitle').textContent = 'إضافة عميل';
  customerModal.show();
});

$('#btnSaveCustomer').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  const id = $('#customerId').value.trim();
  const payload = {
    name: $('#custName').value.trim(),
    phone: $('#custPhone').value.trim(),
    address: $('#custAddress').value.trim(),
    shipCompany: $('#custShip').value.trim(),
    updatedAt: F.serverTimestamp(),
  };
  if(!payload.name) return toast('اسم العميل مطلوب', 'warning');

  if(id){
    await F.updateDoc(F.doc(F.Firebase.db, 'customers', id), payload);
  }else{
    const autoNo = await F.nextCounter('customerNo');
    await F.addDoc(F.collection(F.Firebase.db, 'customers'), {
      ...payload,
      customerNo: autoNo,
      createdAt: F.serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email || '',
    });
  }
  customerModal.hide();
  toast('تم حفظ العميل ✅', 'success');
  await loadCustomers();
});

async function loadCustomers(){
  if(!F.Firebase.ready || !currentUser) return;
  const q = F.query(F.collection(F.Firebase.db, 'customers'), F.orderBy('customerNo', 'desc'), F.limit(500));
  const snap = await F.getDocs(q);
  cacheCustomers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCustomersTable();
}

function renderCustomersTable(){
  const term = ($('#customerSearch').value || '').trim().toLowerCase();
  const rows = cacheCustomers.filter(c => {
    if(!term) return true;
    return (c.name||'').toLowerCase().includes(term) || (c.phone||'').toLowerCase().includes(term);
  }).sort((a,b)=>(b.customerNo||0)-(a.customerNo||0));

  const tb = $('customersTbody');
  tb.innerHTML = '';
  rows.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.customerNo || ''}</td>
      <td>${escapeHtml(c.name||'')}</td>
      <td class="mono">${escapeHtml(c.phone||'')}</td>
      <td>${escapeHtml(c.address||'')}</td>
      <td>${escapeHtml(c.shipCompany||'')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger"><i class="fa-solid fa-trash"></i></button>
      </td>`;
    const [btnEdit, btnDel] = tr.querySelectorAll('button');
    btnEdit.addEventListener('click', ()=>{
      $('#customerId').value = c.id;
      $('#custName').value = c.name || '';
      $('#custPhone').value = c.phone || '';
      $('#custAddress').value = c.address || '';
      $('#custShip').value = c.shipCompany || '';
      $('#customerModalTitle').textContent = 'تعديل عميل';
      customerModal.show();
    });
    btnDel.addEventListener('click', async ()=>{
      if(!confirm('حذف العميل؟')) return;
      await F.deleteDoc(F.doc(F.Firebase.db, 'customers', c.id));
      toast('تم الحذف', 'secondary');
      await loadCustomers();
    });
    tb.appendChild(tr);
  });
}

$('#customerSearch').addEventListener('input', renderCustomersTable);

// -------------------- Items --------------------
$('#btnNewItem').addEventListener('click', ()=>{
  if(!requireSignedIn()) return;
  $('#itemId').value = '';
  $('#itemModelNo').value = '';
  $('#itemModelName').value = '';
  $('#itemUnit').value = '';
  $('#itemSellPrice').value = '';
  $('#itemModalTitle').textContent = 'إضافة مادة';
  itemModal.show();
});

$('#btnSaveItem').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  const id = $('#itemId').value.trim();
  const modelNo = $('#itemModelNo').value.trim();
  const payload = {
    modelNo,
    modelName: $('#itemModelName').value.trim(),
    unit: $('#itemUnit').value.trim(),
    sellPrice: Number($('#itemSellPrice').value || 0),
    updatedAt: F.serverTimestamp(),
  };
  if(!payload.modelNo) return toast('رقم الموديل مطلوب', 'warning');
  if(!payload.modelName) return toast('اسم الموديل مطلوب', 'warning');

  if(id){
    await F.updateDoc(F.doc(F.Firebase.db, 'items', id), payload);
  }else{
    const autoNo = await F.nextCounter('itemNo');
    await F.addDoc(F.collection(F.Firebase.db, 'items'), {
      ...payload,
      itemNo: autoNo,
      createdAt: F.serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email || '',
    });
  }
  itemModal.hide();
  toast('تم حفظ المادة ✅', 'success');
  await loadItems();
});

let cacheItems = [];
async function loadItems(){
  if(!F.Firebase.ready || !currentUser) return;
  const q = F.query(F.collection(F.Firebase.db, 'items'), F.orderBy('itemNo', 'desc'), F.limit(2000));
  const snap = await F.getDocs(q);
  cacheItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheItemsByModelNo = new Map();
  cacheItems.forEach(i => cacheItemsByModelNo.set(String(i.modelNo||'').trim(), i));
  renderItemsTable();
}

function renderItemsTable(){
  const term = ($('#itemSearch').value || '').trim().toLowerCase();
  const rows = cacheItems.filter(i=>{
    if(!term) return true;
    return String(i.modelNo||'').toLowerCase().includes(term) || String(i.modelName||'').toLowerCase().includes(term);
  }).sort((a,b)=>(b.itemNo||0)-(a.itemNo||0));

  const tb = $('itemsTbody');
  tb.innerHTML = '';
  rows.forEach(i=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i.itemNo || ''}</td>
      <td class="mono">${escapeHtml(i.modelNo||'')}</td>
      <td>${escapeHtml(i.modelName||'')}</td>
      <td>${escapeHtml(i.unit||'')}</td>
      <td class="mono">${fmt(i.sellPrice||0)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-primary me-1"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger"><i class="fa-solid fa-trash"></i></button>
      </td>`;
    const [btnEdit, btnDel] = tr.querySelectorAll('button');
    btnEdit.addEventListener('click', ()=>{
      $('#itemId').value = i.id;
      $('#itemModelNo').value = i.modelNo || '';
      $('#itemModelName').value = i.modelName || '';
      $('#itemUnit').value = i.unit || '';
      $('#itemSellPrice').value = i.sellPrice ?? '';
      $('#itemModalTitle').textContent = 'تعديل مادة';
      itemModal.show();
    });
    btnDel.addEventListener('click', async ()=>{
      if(!confirm('حذف المادة؟')) return;
      await F.deleteDoc(F.doc(F.Firebase.db, 'items', i.id));
      toast('تم الحذف', 'secondary');
      await loadItems();
    });
    tb.appendChild(tr);
  });
}

$('#itemSearch').addEventListener('input', renderItemsTable);

// -------------------- Picker (customers) --------------------
let pickerMode = "invoice";
let pickedCustomer = null;

function openCustomerPicker(mode){
  pickerMode = mode;
  $('#pickerSearch').value = '';
  renderPickerRows();
  pickerModal.show();
}

function renderPickerRows(){
  const term = ($('#pickerSearch').value||'').trim().toLowerCase();
  const rows = cacheCustomers.filter(c=>{
    if(!term) return true;
    return (c.name||'').toLowerCase().includes(term) || (c.phone||'').toLowerCase().includes(term);
  }).sort((a,b)=>(b.customerNo||0)-(a.customerNo||0));

  const tb = $('pickerTbody');
  tb.innerHTML = '';
  rows.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.customerNo||''}</td>
      <td>${escapeHtml(c.name||'')}</td>
      <td class="mono">${escapeHtml(c.phone||'')}</td>
      <td>${escapeHtml(c.address||'')}</td>
      <td class="text-end"><button class="btn btn-sm btn-primary"><i class="fa-solid fa-check"></i></button></td>
    `;
    tr.querySelector('button').addEventListener('click', ()=>{
      pickedCustomer = c;
      if(pickerMode === 'invoice'){
        applyPickedCustomerToInvoice(c);
      }else{
        applyPickedCustomerToVoucher(c);
      }
      pickerModal.hide();
    });
    tb.appendChild(tr);
  });
}

$('#pickerSearch').addEventListener('input', renderPickerRows);

$('#btnPickCustomer').addEventListener('click', ()=>{
  if(!requireSignedIn()) return;
  openCustomerPicker('invoice');
});
$('#btnPickCustomerForVoucher').addEventListener('click', ()=>{
  if(!requireSignedIn()) return;
  openCustomerPicker('voucher');
});

function applyPickedCustomerToInvoice(c){
  $('#invoiceCustomer').value = c.name || '';
  $('#invoiceCustomerMeta').textContent = `${c.phone||''} • ${c.address||''} • ${c.shipCompany||''}`;
  $('#invoiceCustomer').dataset.customerId = c.id;
}

function applyPickedCustomerToVoucher(c){
  $('#voucherCustomer').value = c.name || '';
  $('#voucherCustomerMeta').textContent = `${c.phone||''} • ${c.address||''} • ${c.shipCompany||''}`;
  $('#voucherCustomer').dataset.customerId = c.id;
}

// -------------------- Invoices --------------------
let editingInvoice = null;
let invoiceLines = [];

function newInvoice(type){
  if(!requireSignedIn()) return;
  editingInvoice = null;
  invoiceLines = [];
  $('#invoiceId').value = '';
  $('#invoiceType').value = type;
  $('#invoiceModalTitle').textContent = (type === 'sale') ? 'فاتورة مبيعات' : 'مرتجع مبيعات';
  $('#invoiceDate').value = todayISO();
  $('#invoiceCustomer').value = '';
  $('#invoiceCustomer').dataset.customerId = '';
  $('#invoiceCustomerMeta').textContent = '—';
  $('#invoiceNotes').value = '';
  $('#balanceBefore').value = 0;
  $('#invoiceTotal').value = '0.00';
  $('#invoiceLinesTbody').innerHTML = '';
  $('#invoicePermHint').textContent = '';
  invoiceModal.show();

  // number
  allocateInvoiceNo(type).catch(()=>{});
}

async function allocateInvoiceNo(type){
  const counterName = (type === 'sale') ? 'saleInvoiceNo' : 'returnInvoiceNo';
  let n;
  try{
    n = await F.nextCounter(counterName);
  }catch(e){
    // if counters locked by rules, fallback to timestamp based
    n = Math.floor(Date.now()/1000);
  }
  $('#invoiceNo').value = String(n);
}

$('#btnNewSaleInvoice').addEventListener('click', ()=> newInvoice('sale'));
$('#btnNewReturnInvoice').addEventListener('click', ()=> newInvoice('return'));

$('#btnAddLine').addEventListener('click', ()=>{
  addInvoiceLine({ modelNo:'', modelName:'', unit:'', price:0, qty:1, total:0 });
});

function addInvoiceLine(line){
  invoiceLines.push(line);
  renderInvoiceLines();
}

function renderInvoiceLines(){
  const tb = $('#invoiceLinesTbody');
  tb.innerHTML = '';
  invoiceLines.forEach((ln, idx)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="form-control form-control-sm mono" value="${escapeAttr(ln.modelNo||'')}" placeholder="902"></td>
      <td><input class="form-control form-control-sm" value="${escapeAttr(ln.modelName||'')}" placeholder="اسم المادة" readonly></td>
      <td><input class="form-control form-control-sm" value="${escapeAttr(ln.unit||'')}" placeholder="قطعة" readonly></td>
      <td><input class="form-control form-control-sm mono" value="${Number(ln.price||0)}" readonly></td>
      <td><input class="form-control form-control-sm mono" type="number" step="1" min="0" value="${Number(ln.qty||0)}"></td>
      <td><input class="form-control form-control-sm mono" value="${fmt(ln.total||0)}" readonly></td>
      <td class="text-end"><button class="btn btn-sm btn-outline-danger"><i class="fa-solid fa-trash"></i></button></td>
    `;
    const [modelInp, nameInp, unitInp, priceInp, qtyInp] = tr.querySelectorAll('input');
    const btnDel = tr.querySelector('button');

    modelInp.addEventListener('input', ()=>{
      const key = String(modelInp.value||'').trim();
      ln.modelNo = key;
      const item = cacheItemsByModelNo.get(key);
      if(item){
        ln.modelName = item.modelName || '';
        ln.unit = item.unit || '';
        ln.price = Number(item.sellPrice||0);
      }else{
        ln.modelName = '';
        ln.unit = '';
        ln.price = 0;
      }
      recalcLine(ln);
      renderInvoiceLines(); // re-render to reflect fetched values
    });

    qtyInp.addEventListener('input', ()=>{
      ln.qty = Number(qtyInp.value || 0);
      recalcLine(ln);
      renderInvoiceTotals();
      tr.querySelectorAll('input')[5].value = fmt(ln.total||0);
    });

    btnDel.addEventListener('click', ()=>{
      invoiceLines.splice(idx,1);
      renderInvoiceLines();
    });

    tb.appendChild(tr);
  });
  renderInvoiceTotals();
}

function recalcLine(ln){
  ln.total = Number(ln.price||0) * Number(ln.qty||0);
}

function renderInvoiceTotals(){
  const total = invoiceLines.reduce((s,ln)=> s + Number(ln.total||0), 0);
  $('#invoiceTotal').value = fmt(total);
}

$('#btnSaveInvoice').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  const type = $('#invoiceType').value;
  const invoiceNo = $('#invoiceNo').value.trim();
  const date = $('#invoiceDate').value || todayISO();
  const custId = $('#invoiceCustomer').dataset.customerId || '';
  if(!custId) return toast('اختر عميل', 'warning');
  if(invoiceLines.length === 0) return toast('أضف بند واحد على الأقل', 'warning');

  // validate items exist
  for(const ln of invoiceLines){
    if(!ln.modelNo) return toast('رقم موديل ناقص في أحد السطور', 'warning');
    if(!cacheItemsByModelNo.get(String(ln.modelNo).trim())) return toast('موديل غير موجود: ' + ln.modelNo, 'danger');
  }

  const cust = cacheCustomers.find(c=>c.id===custId) || {};
  const total = invoiceLines.reduce((s,ln)=> s + Number(ln.total||0), 0);

  const payload = {
    type,
    invoiceNo: Number(invoiceNo),
    date,
    customerId: custId,
    customerName: cust.name || '',
    customerPhone: cust.phone || '',
    customerAddress: cust.address || '',
    shipCompany: cust.shipCompany || '',
    lines: invoiceLines.map(ln=>({
      modelNo: ln.modelNo,
      modelName: ln.modelName,
      unit: ln.unit,
      price: Number(ln.price||0),
      qty: Number(ln.qty||0),
      total: Number(ln.total||0),
    })),
    notes: $('#invoiceNotes').value.trim(),
    balanceBefore: Number($('#balanceBefore').value||0),
    total: Number(total),
    updatedAt: F.serverTimestamp(),
  };

  // permissions: only admin can edit existing
  const id = $('#invoiceId').value.trim();
  try{
    if(id){
      if(currentRole !== 'admin') return toast('الأدمن فقط يمكنه تعديل الفاتورة', 'warning');
      await F.updateDoc(F.doc(F.Firebase.db, 'invoices', id), payload);
    }else{
      await F.addDoc(F.collection(F.Firebase.db, 'invoices'), {
        ...payload,
        createdAt: F.serverTimestamp(),
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email || '',
      });
    }
    invoiceModal.hide();
    toast('تم حفظ الفاتورة ✅', 'success');
    await loadInvoices();
  }catch(e){
    toast('فشل الحفظ (قد تكون القواعد تمنع ذلك).', 'danger');
  }
});

$('#btnPrintInvoice').addEventListener('click', ()=>{
  const id = $('#invoiceId').value.trim();
  // print from current editor state
  const inv = {
    id: id || null,
    type: $('#invoiceType').value,
    invoiceNo: $('#invoiceNo').value,
    date: $('#invoiceDate').value,
    customerName: $('#invoiceCustomer').value,
    customerPhone: (pickedCustomer?.phone || ''),
    lines: invoiceLines,
    total: Number(parseMoney($('#invoiceTotal').value)),
    balanceBefore: Number($('#balanceBefore').value||0),
    notes: $('#invoiceNotes').value.trim(),
    createdByEmail: currentUser?.email || ''
  };
  renderInvoicePrint(inv);
  window.print();
});

function parseMoney(s){
  return String(s||'0').replace(/,/g,'');
}

let cacheInvoices = [];
async function loadInvoices(){
  if(!F.Firebase.ready || !currentUser) return;
  const q = F.query(F.collection(F.Firebase.db, 'invoices'), F.orderBy('invoiceNo', 'desc'), F.limit(500));
  const snap = await F.getDocs(q);
  cacheInvoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderInvoicesTable();
}

function renderInvoicesTable(){
  const term = ($('#invoiceSearch').value||'').trim().toLowerCase();
  const rows = cacheInvoices.filter(inv=>{
    if(!term) return true;
    return String(inv.invoiceNo||'').includes(term) ||
      (inv.customerName||'').toLowerCase().includes(term) ||
      (inv.customerPhone||'').toLowerCase().includes(term);
  }).sort((a,b)=>(Number(b.invoiceNo||0)-Number(a.invoiceNo||0)));

  const tb = $('invoicesTbody');
  tb.innerHTML = '';
  rows.forEach(inv=>{
    const dt = inv.createdAt?.toDate ? inv.createdAt.toDate() : null;
    const when = dt ? dt.toLocaleString() : (inv.date || '');
    const typeLabel = inv.type === 'sale' ? 'مبيعات' : 'مرتجع';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${inv.invoiceNo || ''}</td>
      <td><span class="badge ${inv.type==='sale'?'text-bg-success':'text-bg-warning'}">${typeLabel}</span></td>
      <td>${escapeHtml(inv.customerName||'')}</td>
      <td class="mono">${escapeHtml(inv.customerPhone||'')}</td>
      <td class="mono">${fmt(inv.total||0)}</td>
      <td class="mono">${escapeHtml(inv.createdByEmail||'')}</td>
      <td>${escapeHtml(when||'')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-dark me-1" title="عرض/طباعة"><i class="fa-solid fa-eye"></i></button>
        <button class="btn btn-sm btn-outline-primary me-1" title="تعديل"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="حذف"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    const [btnView, btnEdit, btnDel] = tr.querySelectorAll('button');

    btnView.addEventListener('click', ()=>{
      renderInvoicePrint(inv);
      window.print();
    });

    btnEdit.addEventListener('click', ()=>{
      if(currentRole !== 'admin') return toast('الأدمن فقط يمكنه تعديل الفاتورة', 'warning');
      openInvoiceForEdit(inv);
    });

    btnDel.addEventListener('click', async ()=>{
      if(currentRole !== 'admin') return toast('الأدمن فقط يمكنه حذف الفاتورة', 'warning');
      if(!confirm('حذف الفاتورة؟')) return;
      await F.deleteDoc(F.doc(F.Firebase.db, 'invoices', inv.id));
      toast('تم الحذف', 'secondary');
      await loadInvoices();
    });

    tb.appendChild(tr);
  });
}

$('#invoiceSearch').addEventListener('input', renderInvoicesTable);

function openInvoiceForEdit(inv){
  editingInvoice = inv;
  invoiceLines = (inv.lines||[]).map(x=>({ ...x }));
  $('#invoiceId').value = inv.id;
  $('#invoiceType').value = inv.type || 'sale';
  $('#invoiceModalTitle').textContent = inv.type === 'sale' ? 'تعديل فاتورة مبيعات' : 'تعديل مرتجع مبيعات';
  $('#invoiceNo').value = inv.invoiceNo || '';
  $('#invoiceDate').value = inv.date || todayISO();
  $('#invoiceCustomer').value = inv.customerName || '';
  $('#invoiceCustomer').dataset.customerId = inv.customerId || '';
  $('#invoiceCustomerMeta').textContent = `${inv.customerPhone||''} • ${inv.customerAddress||''} • ${inv.shipCompany||''}`;
  $('#invoiceNotes').value = inv.notes || '';
  $('#balanceBefore').value = inv.balanceBefore ?? 0;
  $('#invoicePermHint').textContent = ': تعديل/حذف الفواتير للأدمن فقط.';
  renderInvoiceLines();
  invoiceModal.show();
}

// -------------------- Vouchers --------------------
let cacheVouchers = [];

function newVoucher(type){
  if(!requireSignedIn()) return;
  $('#voucherId').value = '';
  $('#voucherType').value = type;
  $('#voucherModalTitle').textContent = (type === 'receipt') ? 'سند قبض' : 'سند دفع';
  $('#voucherDate').value = todayISO();
  $('#voucherAmount').value = 0;
  $('#voucherNotes').value = '';
  $('#voucherCustomer').value = '';
  $('#voucherCustomer').dataset.customerId = '';
  $('#voucherCustomerMeta').textContent = '—';
  voucherModal.show();
  allocateVoucherNo(type).catch(()=>{});
}

async function allocateVoucherNo(type){
  const counterName = (type === 'receipt') ? 'receiptNo' : 'paymentNo';
  let n;
  try{ n = await F.nextCounter(counterName); }
  catch(e){ n = Math.floor(Date.now()/1000); }
  $('#voucherNo').value = String(n);
}

$('#btnNewReceipt').addEventListener('click', ()=> newVoucher('receipt'));
$('#btnNewPayment').addEventListener('click', ()=> newVoucher('payment'));

$('#btnSaveVoucher').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  const type = $('#voucherType').value;
  const no = Number($('#voucherNo').value || 0);
  const date = $('#voucherDate').value || todayISO();
  const amount = Number($('#voucherAmount').value || 0);
  const custId = $('#voucherCustomer').dataset.customerId || '';
  if(!custId) return toast('اختر عميل', 'warning');
  if(amount <= 0) return toast('المبلغ يجب أن يكون أكبر من صفر', 'warning');

  const cust = cacheCustomers.find(c=>c.id===custId) || {};
  const payload = {
    type,
    voucherNo: no,
    date,
    amount,
    customerId: custId,
    customerName: cust.name || '',
    customerPhone: cust.phone || '',
    notes: $('#voucherNotes').value.trim(),
    updatedAt: F.serverTimestamp(),
  };

  const id = $('#voucherId').value.trim();
  if(id){
    await F.updateDoc(F.doc(F.Firebase.db, 'vouchers', id), payload);
  }else{
    await F.addDoc(F.collection(F.Firebase.db, 'vouchers'), {
      ...payload,
      createdAt: F.serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email || '',
    });
  }
  voucherModal.hide();
  toast('تم حفظ السند ✅', 'success');
  await loadVouchers();
});

$('#btnPrintVoucher').addEventListener('click', ()=>{
  const v = {
    type: $('#voucherType').value,
    voucherNo: $('#voucherNo').value,
    date: $('#voucherDate').value,
    amount: Number($('#voucherAmount').value||0),
    customerName: $('#voucherCustomer').value,
    customerPhone: (pickedCustomer?.phone || ''),
    notes: $('#voucherNotes').value.trim(),
    createdByEmail: currentUser?.email || ''
  };
  renderVoucherPrint(v);
  window.print();
});

async function loadVouchers(){
  if(!F.Firebase.ready || !currentUser) return;
  const q = F.query(F.collection(F.Firebase.db, 'vouchers'), F.orderBy('voucherNo', 'desc'), F.limit(500));
  const snap = await F.getDocs(q);
  cacheVouchers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderVouchersTable();
}

function renderVouchersTable(){
  const term = ($('#voucherSearch').value||'').trim().toLowerCase();
  const rows = cacheVouchers.filter(v=>{
    if(!term) return true;
    return String(v.voucherNo||'').includes(term) ||
      (v.customerName||'').toLowerCase().includes(term) ||
      (v.customerPhone||'').toLowerCase().includes(term);
  }).sort((a,b)=>(Number(b.voucherNo||0)-Number(a.voucherNo||0)));

  const tb = $('vouchersTbody');
  tb.innerHTML = '';
  rows.forEach(v=>{
    const dt = v.createdAt?.toDate ? v.createdAt.toDate() : null;
    const when = dt ? dt.toLocaleString() : (v.date || '');
    const typeLabel = v.type === 'receipt' ? 'قبض' : 'دفع';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${v.voucherNo || ''}</td>
      <td><span class="badge ${v.type==='receipt'?'text-bg-primary':'text-bg-danger'}">${typeLabel}</span></td>
      <td>${escapeHtml(v.customerName||'')}</td>
      <td class="mono">${escapeHtml(v.customerPhone||'')}</td>
      <td class="mono">${fmt(v.amount||0)}</td>
      <td class="mono">${escapeHtml(v.createdByEmail||'')}</td>
      <td>${escapeHtml(when||'')}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-dark me-1" title="طباعة"><i class="fa-solid fa-print"></i></button>
        <button class="btn btn-sm btn-outline-primary me-1" title="تعديل"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-sm btn-outline-danger" title="حذف"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    const [btnPrint, btnEdit, btnDel] = tr.querySelectorAll('button');
    btnPrint.addEventListener('click', ()=>{
      renderVoucherPrint(v);
      window.print();
    });
    btnEdit.addEventListener('click', ()=>{
      $('#voucherId').value = v.id;
      $('#voucherType').value = v.type || 'receipt';
      $('#voucherModalTitle').textContent = v.type === 'receipt' ? 'تعديل سند قبض' : 'تعديل سند دفع';
      $('#voucherNo').value = v.voucherNo || '';
      $('#voucherDate').value = v.date || todayISO();
      $('#voucherAmount').value = v.amount ?? 0;
      $('#voucherNotes').value = v.notes || '';
      $('#voucherCustomer').value = v.customerName || '';
      $('#voucherCustomer').dataset.customerId = v.customerId || '';
      $('#voucherCustomerMeta').textContent = `${v.customerPhone||''}`;
      voucherModal.show();
    });
    btnDel.addEventListener('click', async ()=>{
      if(!confirm('حذف السند؟')) return;
      await F.deleteDoc(F.doc(F.Firebase.db, 'vouchers', v.id));
      toast('تم الحذف', 'secondary');
      await loadVouchers();
    });
    tb.appendChild(tr);
  });
}

$('#voucherSearch').addEventListener('input', renderVouchersTable);

// -------------------- Excel Import/Export --------------------
function adminOnly(){
  if(currentRole !== 'admin'){
    toast('هذه العملية للأدمن فقط', 'warning');
    return false;
  }
  return true;
}

$('#btnExportAll').addEventListener('click', async ()=>{
  if(!requireSignedIn()) return;
  if(!adminOnly()) return;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cacheItems.map(i=>({
    itemNo:i.itemNo, modelNo:i.modelNo, modelName:i.modelName, unit:i.unit, sellPrice:i.sellPrice
  }))), 'items');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cacheCustomers.map(c=>({
    customerNo:c.customerNo, name:c.name, phone:c.phone, address:c.address, shipCompany:c.shipCompany
  }))), 'customers');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cacheInvoices.map(inv=>({
    invoiceNo:inv.invoiceNo, type:inv.type, date:inv.date, customerName:inv.customerName, customerPhone:inv.customerPhone, total:inv.total, createdByEmail:inv.createdByEmail
  }))), 'invoices');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cacheVouchers.map(v=>({
    voucherNo:v.voucherNo, type:v.type, date:v.date, customerName:v.customerName, customerPhone:v.customerPhone, amount:v.amount, createdByEmail:v.createdByEmail
  }))), 'vouchers');

  XLSX.writeFile(wb, 'ERP_EXPORT_ALL.xlsx');
});

$('#btnDownloadTemplates').addEventListener('click', ()=>{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { modelNo:'902', modelName:'اسم الموديل', unit:'قطعة', sellPrice:265 }
  ]), 'items_template');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { name:'اسم العميل', phone:'+20...', address:'العنوان', shipCompany:'شركة الشحن' }
  ]), 'customers_template');
  XLSX.writeFile(wb, 'ERP_TEMPLATES.xlsx');
});

async function importSheet(file, kind){
  if(!requireSignedIn()) return;
  if(!adminOnly()) return;
  if(!file) return toast('اختر ملف Excel', 'warning');

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data);
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });

  if(kind === 'items'){
    let ok = 0;
    for(const r of rows){
      const modelNo = String(r.modelNo||r['رقم الموديل']||'').trim();
      if(!modelNo) continue;
      const payload = {
        modelNo,
        modelName: String(r.modelName||r['اسم الموديل']||'').trim(),
        unit: String(r.unit||r['الوحدة']||'').trim(),
        sellPrice: Number(r.sellPrice||r['سعر البيع']||0),
        updatedAt: F.serverTimestamp(),
      };
      if(!payload.modelName) continue;
      // upsert by modelNo
      const existing = cacheItemsByModelNo.get(modelNo);
      if(existing){
        await F.updateDoc(F.doc(F.Firebase.db, 'items', existing.id), payload);
      }else{
        const autoNo = await F.nextCounter('itemNo');
        await F.addDoc(F.collection(F.Firebase.db, 'items'), {
          ...payload,
          itemNo: autoNo,
          createdAt: F.serverTimestamp(),
          createdBy: currentUser.uid,
          createdByEmail: currentUser.email || '',
        });
      }
      ok++;
    }
    toast(`تم استيراد ${ok} مادة ✅`, 'success');
    await loadItems();
  }

  if(kind === 'customers'){
    let ok = 0;
    for(const r of rows){
      const name = String(r.name||r['اسم العميل']||'').trim();
      if(!name) continue;
      const payload = {
        name,
        phone: String(r.phone||r['رقم الهاتف']||'').trim(),
        address: String(r.address||r['العنوان']||'').trim(),
        shipCompany: String(r.shipCompany||r['شركة الشحن']||'').trim(),
        updatedAt: F.serverTimestamp(),
      };
      const autoNo = await F.nextCounter('customerNo');
      await F.addDoc(F.collection(F.Firebase.db, 'customers'), {
        ...payload,
        customerNo: autoNo,
        createdAt: F.serverTimestamp(),
        createdBy: currentUser.uid,
        createdByEmail: currentUser.email || '',
      });
      ok++;
    }
    toast(`تم استيراد ${ok} عميل ✅`, 'success');
    await loadCustomers();
  }
}

$('#btnImportItems').addEventListener('click', async ()=>{
  await importSheet($('#importItemsFile').files?.[0], 'items');
});
$('#btnImportCustomers').addEventListener('click', async ()=>{
  await importSheet($('#importCustomersFile').files?.[0], 'customers');
});

// -------------------- Printing Templates --------------------
function renderInvoicePrint(inv){
  const company = lastCompany || {};
  const typeLabel = inv.type === 'sale' ? 'فاتورة : مبيعات' : 'فاتورة : مرتجع مبيعات';
  const logoUrl = company.logoUrl || '';
  const socials = Array.isArray(company.socials) ? company.socials : [];
  const phone = company.salesPhone2 || company.salesPhone1 || '';

  const lines = (inv.lines||[]).map((ln, i)=>({
    idx: i+1,
    modelNo: ln.modelNo,
    name: ln.modelName,
    qty: Number(ln.qty||0),
    unit: ln.unit,
    price: Number(ln.price||0),
    total: Number(ln.total||0),
  }));

  const total = Number(inv.total || 0);
  const balBefore = Number(inv.balanceBefore || 0);
  const balAfter = balBefore + (inv.type==='sale' ? total : -total);

  const socialHtml = socials.slice(0,4).map(url=>{
    const m = socialIcon(url);
    return `<div class="s"><i class="${m.icon}"></i><span class="mono">${phone ? phone : m.label}</span></div>`;
  }).join('');

  const rowsHtml = lines.map(l=>`
    <tr>
      <td class="mono">${escapeHtml(l.modelNo||'')}</td>
      <td>${escapeHtml(l.name||'')}</td>
      <td class="mono">${fmt(l.qty)}</td>
      <td>${escapeHtml(l.unit||'')}</td>
      <td class="mono">${fmt(l.price)}</td>
      <td class="mono">${fmt(l.total)}</td>
    </tr>
  `).join('');

  $('printArea').innerHTML = `
    <div class="print-page">
      <div class="print-header">
        <div>
          ${logoUrl ? `<img class="print-logo" src="${logoUrl}" alt="logo">` : `<div class="fw-bold">${escapeHtml(company.name||'')}</div>`}
        </div>
        <div class="text-end">
          <div class="fw-bold">Contact Sales</div>
          <div class="print-social">${socialHtml || `<div class="s"><i class="fa-solid fa-phone"></i><span class="mono">${escapeHtml(phone||'')}</span></div>`}</div>
        </div>
      </div>

      <div class="print-title">${typeLabel}</div>

      <div class="print-meta">
        <div>
          <div><b>رقم الفاتورة:</b> <span class="mono">${escapeHtml(String(inv.invoiceNo||''))}</span></div>
          <div><b>التاريخ:</b> <span class="mono">${escapeHtml(inv.date||'')}</span></div>
        </div>
        <div class="text-end">
          <div><b>السيد:</b> ${escapeHtml(inv.customerName||'')}</div>
          <div><b>البيان:</b> —</div>
        </div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th>رمز المادة</th>
            <th>اسم المادة</th>
            <th>الكمية</th>
            <th>الوحدة</th>
            <th>السعر</th>
            <th>القيمة</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="print-summary">
        <div class="box">
          <div class="rowx"><span>المجموع:</span><b class="mono">${fmt(total)}</b></div>
          <div class="rowx"><span>إجمالي الحسابات:</span><span class="mono">0.00</span></div>
          <div class="rowx"><span>المجموع النهائي:</span><b class="mono">${fmt(total)}</b></div>
        </div>
        <div class="box">
          <div class="rowx"><span>رصيد العميل قبل الفاتورة:</span><b class="mono">${fmt(balBefore)}</b></div>
          <div class="rowx"><span>رصيد العميل بعد الفاتورة:</span><b class="mono">${fmt(balAfter)}</b></div>
          <div class="rowx"><span>:</span><span>${escapeHtml(inv.notes||'—')}</span></div>
        </div>
      </div>

      <div class="print-footer">
        <div>أضيفت بواسطة: <span class="mono">${escapeHtml(inv.createdByEmail||'')}</span></div>
        <div class="mono">${new Date().toLocaleString()}</div>
      </div>
    </div>
  `;
}

function renderVoucherPrint(v){
  const company = lastCompany || {};
  const logoUrl = company.logoUrl || '';
  const typeLabel = v.type === 'receipt' ? 'سند قبض' : 'سند دفع';
  $('printArea').innerHTML = `
    <div class="print-page">
      <div class="print-header">
        <div>
          ${logoUrl ? `<img class="print-logo" src="${logoUrl}" alt="logo">` : `<div class="fw-bold">${escapeHtml(company.name||'')}</div>`}
        </div>
        <div class="text-end">
          <div class="fw-bold">${escapeHtml(typeLabel)}</div>
          <div class="small text-muted">A4</div>
        </div>
      </div>

      <div class="print-meta">
        <div>
          <div><b>رقم السند:</b> <span class="mono">${escapeHtml(String(v.voucherNo||''))}</span></div>
          <div><b>التاريخ:</b> <span class="mono">${escapeHtml(v.date||'')}</span></div>
        </div>
        <div class="text-end">
          <div><b>العميل:</b> ${escapeHtml(v.customerName||'')}</div>
        </div>
      </div>

      <div class="box" style="border:1px solid #cfd6df;border-radius:12px;padding:10px;margin-top:10px;">
        <div class="rowx" style="display:flex;justify-content:space-between;"><span>المبلغ:</span><b class="mono">${fmt(v.amount||0)}</b></div>
        <div class="rowx" style="display:flex;justify-content:space-between;"><span>:</span><span>${escapeHtml(v.notes||'—')}</span></div>
      </div>

      <div class="print-footer">
        <div>أضيفت بواسطة: <span class="mono">${escapeHtml(v.createdByEmail||'')}</span></div>
        <div class="mono">${new Date().toLocaleString()}</div>
      </div>
    </div>
  `;
}

// -------------------- utilities --------------------
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/\n/g,' '); }

// -------------------- refresh all --------------------
async function refreshAll(){
  if(!F.Firebase.ready || !currentUser) return;
  await Promise.all([
    loadCompany(),
    loadCustomers(),
    loadItems(),
    loadInvoices(),
    loadVouchers(),
  ]);
}

async function boot(){
  const r = F.initFirebaseFromSaved();
  if(r.ok){
    setConnBadge(true);
    $('#brandTitle').textContent = (localStorage.getItem('ERP_APP_NAME') || 'ERP PRO Lite');
    wireAuth();
  }else{
    setConnBadge(false);
    // even if firebase fails, show login (but it won't authenticate)
    showAppUI(false);
  }
  $('#invoiceDate').value = todayISO();
  $('#voucherDate').value = todayISO();
}
boot();


// PWA Service Worker
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}
