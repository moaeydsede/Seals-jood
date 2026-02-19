import { watchAuth, login, logout } from './auth.js';
import { hasPerm } from './permissions.js';
import { toast } from './utils.js';

import {
  viewLogin, viewDashboard,
  viewInvoices, viewInvoiceEditor, bindInvoiceEditor,
  viewCustomers, bindCustomers,
  viewProducts, bindProducts,
  viewPayments, bindPayments,
  viewReports, bindReports,
  viewCompany, bindCompany,
  viewUsers, bindUsers,
  viewAudit
} from './views.js';

const VERSION = '2026.02.19-INVOICE-PRO';

const navItems = [
  {href:'#/dashboard', label:'الرئيسية', perm:'reports_view'},
  {href:'#/invoices', label:'فواتير المبيعات', perm:'invoices_view'},
  {href:'#/returns', label:'مرتجع مبيعات', perm:'returns_view'},
  {href:'#/customers', label:'العملاء', perm:'customers_view'},
  {href:'#/products', label:'الأصناف (قائمة أسعار)', perm:'products_view'},
  {href:'#/payments', label:'الدفعات', perm:'payments_view'},
  {href:'#/reports', label:'التقارير', perm:'reports_view'},
  {href:'#/audit', label:'سجل العمليات', perm:'audit_view', tag:'Admin'},
  {href:'#/company', label:'بيانات الشركة', perm:'company_manage', tag:'Admin'},
  {href:'#/users', label:'المستخدمون والصلاحيات', perm:'users_manage', tag:'Admin'}
];

const elView = document.getElementById('view');
const elNav = document.getElementById('nav');
const elSidebar = document.getElementById('sidebar');
const elChipUser = document.getElementById('chipUser');
const btnLogout = document.getElementById('btnLogout');
document.getElementById('ver').textContent = VERSION;

function openMenu(open=true){
  elSidebar.classList.toggle('open', open);
}
document.getElementById('btnMenu').addEventListener('click', ()=>openMenu(true));
document.getElementById('btnCloseMenu').addEventListener('click', ()=>openMenu(false));
elSidebar.addEventListener('click', (e)=>{
  if(e.target.matches('a')) openMenu(false);
});

let authUser = null;
let me = null;

btnLogout.addEventListener('click', async ()=>{
  await logout();
});

function renderNav(){
  const items = navItems.filter(it=>{
    if(!me) return false;
    return hasPerm(me, it.perm);
  });
  elNav.innerHTML = items.map(it=>{
    const active = location.hash.startsWith(it.href) ? 'active' : '';
    const tag = it.tag ? `<span class="tag">${it.tag}</span>` : '';
    return `<a class="${active}" href="${it.href}">${it.label}${tag}</a>`;
  }).join('');
}

async function route(){
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\/?/,'').split('/');
  const r0 = parts[0] || 'dashboard';
  const r1 = parts[1] || '';
  const r2 = parts[2] || '';

  if(!authUser){
    elView.innerHTML = await viewLogin();
    bindLoginForm();
    return;
  }
  if(me && me.active === false){
    elView.innerHTML = `<div class="card pad" style="max-width:720px;margin:24px auto;">
      <div class="h1">الحساب غير مفعل</div>
      <div class="muted">اطلب من الأدمن تفعيل المستخدم داخل شاشة “المستخدمون والصلاحيات”.</div>
      <div class="hr"></div>
      <button class="btn ghost" id="btnLogout2">تسجيل خروج</button>
    </div>`;
    document.getElementById('btnLogout2').onclick=()=>logout();
    return;
  }

  // default route permissions
  try{
    switch(r0){
      case 'dashboard':
        elView.innerHTML = await viewDashboard(me);
        break;

      case 'invoices':
        if(r1==='new'){ location.hash = '#/invoices/new'; }
        if(r1==='new' || r1){
          elView.innerHTML = await viewInvoiceEditor(me, 'sale', r1||'new');
          await bindInvoiceEditor(me,'sale', r1||'new');
        }else{
          elView.innerHTML = await viewInvoices(me,'sale');
        }
        break;

      case 'returns':
        if(r1==='new' || r1){
          elView.innerHTML = await viewInvoiceEditor(me, 'return', r1||'new');
          await bindInvoiceEditor(me,'return', r1||'new');
        }else{
          elView.innerHTML = await viewInvoices(me,'return');
        }
        break;

      case 'customers':
        elView.innerHTML = await viewCustomers(me);
        await bindCustomers(me);
        break;

      case 'products':
        elView.innerHTML = await viewProducts(me);
        await bindProducts(me);
        break;

      case 'payments':
        elView.innerHTML = await viewPayments(me);
        await bindPayments(me);
        break;

      case 'reports':
        elView.innerHTML = await viewReports(me);
        await bindReports(me);
        break;

      case 'company':
        elView.innerHTML = await viewCompany(me);
        await bindCompany(me);
        break;

      case 'users':
        elView.innerHTML = await viewUsers(me);
        await bindUsers(me);
        break;

      case 'audit':
        elView.innerHTML = await viewAudit(me);
        break;

      default:
        location.hash = '#/dashboard';
        return;
    }
  }catch(e){
    console.error(e);
    elView.innerHTML = `<div class="card pad"><div class="h1">حدث خطأ</div><div class="muted">${String(e.message||e)}</div></div>`;
  }

  renderNav();
}

function bindLoginForm(){
  const form = document.getElementById('formLogin');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const email = fd.get('email').toString().trim();
    const password = fd.get('password').toString();
    try{
      await login(email, password);
      toast('تم تسجيل الدخول');
    }catch(err){
      toast('فشل الدخول: تأكد من البيانات');
      console.error(err);
    }
  });
}

watchAuth((u, profile)=>{
  authUser = u;
  me = profile;

  if(!u){
    elChipUser.textContent = 'غير مسجل';
    btnLogout.style.display='none';
    renderNav();
    route();
    return;
  }
  elChipUser.textContent = (profile?.displayName || u.email || 'مستخدم');
  btnLogout.style.display='inline-flex';

  // if no hash set, go dashboard
  if(!location.hash) location.hash = '#/dashboard';
  renderNav();
  route();
});

window.addEventListener('hashchange', ()=>route());

// ===== post-render hooks =====
function afterRender(me, route){
  try{
    if(route === 'products' && window.__productsExcelButtons) window.__productsExcelButtons(me);
    if(route === 'invoice_new' || route === 'invoice_edit'){
      const form = document.querySelector('form[data-form="invoice"]');
      if(form && window.bindInvoiceLineLookup) window.bindInvoiceLineLookup(me, form);
      if(form && window.bindDiscountSync) window.bindDiscountSync(form);
    }
  }catch(e){ console.error(e); }
}
window.afterRender = afterRender;

function recalcTotals(){
  const form = document.querySelector('form[data-form="invoice"]');
  if(!form) return;
  const rows = Array.from(form.querySelectorAll('tbody tr'));
  let subtotal = 0;
  rows.forEach(tr=>{
    const price = Number(tr.querySelector('[data-ln="price"]')?.value||0);
    const qty = Number(tr.querySelector('[data-ln="qty"]')?.value||0);
    const line = (price*qty)||0;
    subtotal += line;
    const t = tr.querySelector('[data-ln="total"]');
    if(t) t.textContent = fmtMoney(line);
  });
  const subEl = form.querySelector('[data-t="subtotal"]');
  if(subEl) subEl.textContent = String(+subtotal.toFixed(2));
  const p = form.querySelector('[name="discountPercent"]');
  const a = form.querySelector('[name="discountAmount"]');
  let discAmt = 0;
  if(p && a){
    const r = calcDiscountSync(subtotal, null, p.value, a.value);
    discAmt = Number(a.value||r.amount||0);
  }
  discAmt = Math.min(Math.max(discAmt,0), subtotal);
  const grand = subtotal - discAmt;
  const paid = Number(form.querySelector('[name="paid"]')?.value||0);
  const remaining = Math.max(0, grand - paid);
  form.querySelector('[data-t="grand"]')?.textContent = fmtMoney(grand);
  form.querySelector('[data-t="remaining"]')?.textContent = fmtMoney(remaining);
  const wordsEl = form.querySelector('[data-t="words"]');
  if(wordsEl && typeof amountToArabicWordsEGP === 'function'){
    wordsEl.textContent = amountToArabicWordsEGP(grand);
  }
}
window.recalcTotals = recalcTotals;
