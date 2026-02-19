import { db, storage } from './firebase.js';
import { PERMS, hasPerm } from './permissions.js';
import { fmtMoney, fmtDate, fmtDateTime, toast, calcLine, parseDiscount, amountToArabicWordsEGP, escapeHtml } from './utils.js';
import { logAudit } from './audit.js';

import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, getDocs, serverTimestamp, runTransaction, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref as sRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

function need(me, perm){
  if(!hasPerm(me, perm)){
    return `<div class="card pad"><div class="h1">صلاحية غير كافية</div>
      <div class="muted">لا تملك صلاحية: <b>${escapeHtml(PERMS[perm]||perm)}</b></div></div>`;
  }
  return null;
}

export async function viewLogin(){
  return `<div class="card pad" style="max-width:520px;margin:24px auto;">
    <div class="h1">تسجيل الدخول</div>
    <div class="muted">ادخل البريد وكلمة المرور (Firebase Auth)</div>
    <div class="hr"></div>
    <form id="formLogin" class="grid" autocomplete="on">
      <div class="field">
        <div class="label">البريد الإلكتروني</div>
        <input class="input" name="email" type="email" required placeholder="example@mail.com" />
      </div>
      <div class="field">
        <div class="label">كلمة المرور</div>
        <input class="input" name="password" type="password" required placeholder="••••••••" />
      </div>
      <div class="row">
        <button class="btn" type="submit">دخول</button>
        <div class="muted">إن لم يفتح: تأكد أن المستخدم Active داخل قاعدة users.</div>
      </div>
    </form>
  </div>`;
}

async function getCompany(){
  const snap = await getDoc(doc(db,'settings','company'));
  return snap.exists()? snap.data(): {name:'Jood kids seals', phones:[], address:'', whatsapp:'', telegram:'', facebook:'', footerNote:'', logoUrl:''};
}

export async function viewDashboard(me){
  const deny = need(me,'reports_view');
  // dashboard is like reports_view
  if(deny) return deny;

  // KPIs from last 30 days
  const start = Timestamp.fromDate(new Date(Date.now() - 30*24*3600*1000));
  const qInv = query(collection(db,'invoices'), where('date','>=', start), orderBy('date','desc'), limit(200));
  const snaps = await getDocs(qInv);
  let sales=0, returns=0, count=0;
  snaps.forEach(s=>{
    const d=s.data();
    count++;
    if(d.docType==='return') returns += Number(d.grandTotal||0);
    else sales += Number(d.grandTotal||0);
  });
  const net = sales - returns;

  return `<div class="grid">
    <div class="card pad">
      <div class="h1">الرئيسية</div>
      <div class="muted">ملخص آخر 30 يوم (مبيعات/مرتجعات)</div>
      <div class="hr"></div>
      <div class="kpis">
        <div class="kpi"><div class="t">إجمالي المبيعات</div><div class="v">${fmtMoney(sales)} ج</div></div>
        <div class="kpi"><div class="t">إجمالي المرتجعات</div><div class="v">${fmtMoney(returns)} ج</div></div>
        <div class="kpi"><div class="t">صافي المبيعات</div><div class="v">${fmtMoney(net)} ج</div></div>
        <div class="kpi"><div class="t">عدد المستندات</div><div class="v">${count}</div></div>
      </div>
    </div>

    <div class="card pad">
      <div class="row">
        <div>
          <div class="h2">اختصارات</div>
          <div class="muted">افتح سريعًا أهم الشاشات</div>
        </div>
        <div class="spacer"></div>
        <a class="btn small" href="#/invoices/new">فاتورة جديدة</a>
        <a class="btn small ghost" href="#/returns/new">مرتجع جديد</a>
      </div>
    </div>
  </div>`;
}

async function listCustomersOptions(){
  const qy = query(collection(db,'customers'), orderBy('name','asc'), limit(500));
  const snaps = await getDocs(qy);
  const opts = ['<option value="">— اختر —</option>'];
  snaps.forEach(s=>{
    const d=s.data();
    opts.push(`<option value="${s.id}">${escapeHtml(d.name||'')}</option>`);
  });
  return opts.join('');
}
async function listProductsOptions(){
  const qy = query(collection(db,'products'), orderBy('name','asc'), limit(1000));
  const snaps = await getDocs(qy);
  const list = [];
  snaps.forEach(s=>{
    const d=s.data();
    if(d.active===false) return;
    list.push({id:s.id, name:d.name, code:d.code||'', price:Number(d.price||0)});
  });
  return list;
}

function invoiceTableRow(i, prodList){
  const p = prodList.find(x=>x.id===i.productId) || null;
  const code = i.codeSnapshot ?? (p?.code||'');
  const name = i.nameSnapshot ?? (p?.name||'');
  const price = i.priceSnapshot ?? (p?.price||0);
  const qty = i.qty ?? 1;
  const discType = i.discountTypeItem ?? 'amount';
  const discVal = i.discountValueItem ?? 0;
  const {gross, disc, net} = calcLine(qty, price, discType, discVal);
  const total = net;
  return {code,name,price,qty,discType,discVal,total,gross,disc};
}

function renderInvoiceEditor(me, docType, model, customersOptions, products){
  // model = existing invoice or draft
  const isAdmin = me.role === 'admin';
  const canEdit = isAdmin; // per requirement
  const isNew = !model?.id;

  const items = model?.items || [];
  const payType = model?.payType || 'cash';
  const customerId = model?.customerId || '';
  const date = model?.date ? fmtDate(model.date) : fmtDate(new Date());
  const discountTypeInvoice = model?.discountTypeInvoice || 'amount';
  const discountValueInvoice = model?.discountValueInvoice ?? 0;
  const paid = model?.paid ?? (payType==='cash' ? (model?.grandTotal||0) : 0);

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">${docType==='sale'?'فاتورة مبيعات':'مرتجع مبيعات'}</div>
        <div class="muted">${isNew?'إنشاء مستند جديد':'عرض/تعديل (الأدمن فقط)'}</div>
      </div>
      <div class="spacer"></div>
      <a class="btn ghost small no-print" href="#/${docType==='sale'?'invoices':'returns'}">رجوع</a>
      ${!isNew ? `<span class="badge ${model.locked?'ok':'warn'}">${model.locked?'مقفلة':'غير مقفلة'}</span>`:''}
    </div>

    <div class="hr"></div>

    <form id="formInv" class="grid cols2">
      <div class="field">
        <div class="label">التاريخ</div>
        <input class="input" name="date" type="date" value="${escapeHtml(new Date(model?.date?.toDate?model.date.toDate():model?.date||Date.now()).toISOString().slice(0,10))}" ${(!isNew && !canEdit)?'disabled':''}/>
      </div>

      <div class="field">
        <div class="label">نوع الفاتورة</div>
        <select name="payType" ${(!isNew && !canEdit)?'disabled':''}>
          <option value="cash" ${payType==='cash'?'selected':''}>نقدي</option>
          <option value="credit" ${payType==='credit'?'selected':''}>أجل</option>
        </select>
      </div>

      <div class="field">
        <div class="label">العميل</div>
        <select name="customerId" ${(!isNew && !canEdit)?'disabled':''}>${customersOptions}</select>
        <div class="muted">ملاحظة: لا يوجد “عميل نقدي” افتراضي — اختر عميلًا أو اتركه فارغًا.</div>
      </div>

      <div class="field">
        <div class="label">ملاحظة</div>
        <input class="input" name="note" value="${escapeHtml(model?.note||'')}" ${(!isNew && !canEdit)?'disabled':''} placeholder="اختياري"/>
      </div>

      <div class="card pad" style="grid-column:1/-1;">
        <div class="row no-print">
          <div class="h2">بنود الفاتورة</div>
          <div class="spacer"></div>
          <button type="button" class="btn small" id="btnAddLine" ${(!isNew && !canEdit)?'disabled':''}>إضافة بند</button>
        </div>
        <div class="hr"></div>
        <div style="overflow:auto;">
          <table class="table" id="tblLines">
            <thead>
              <tr>
                <th>رمز</th>
                <th>الصنف</th>
                <th class="num">الكمية</th>
                <th>الوحدة</th>
                <th class="num">السعر</th>
                <th class="num">خصم الصنف</th>
                <th class="num">الإجمالي</th>
                <th class="actions no-print">إجراءات</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="muted" style="margin-top:8px;">الوحدة ثابتة: <b>قطعة</b>. الخصم احترافي: على الصنف وعلى الفاتورة.</div>
      </div>

      <div class="card pad" style="grid-column:1/-1;">
        <div class="grid cols3">
          <div class="field">
            <div class="label">خصم الفاتورة</div>
            <div class="row">
              <select name="discountTypeInvoice" style="max-width:140px" ${(!isNew && !canEdit)?'disabled':''}>
                <option value="amount" ${discountTypeInvoice==='amount'?'selected':''}>مبلغ</option>
                <option value="percent" ${discountTypeInvoice==='percent'?'selected':''}>٪</option>
              </select>
              <input class="input" name="discountValueInvoice" type="number" step="0.01" value="${escapeHtml(discountValueInvoice)}" ${(!isNew && !canEdit)?'disabled':''}/>
            </div>
          </div>

          <div class="field">
            <div class="label">المدفوع</div>
            <input class="input" name="paid" type="number" step="0.01" value="${escapeHtml(paid)}" ${(!isNew && !canEdit)?'disabled':''}/>
            <div class="muted">نقدي: المدفوع = الإجمالي (افتراضي). أجل: يمكن دفع جزء.</div>
          </div>

          <div class="field">
            <div class="label">المبلغ بالحروف</div>
            <div class="input" id="moneyWords" style="min-height:48px; display:flex; align-items:center;"></div>
          </div>
        </div>

        <div class="hr"></div>
        <div class="row">
          <div class="badge" id="bSubtotal">المجموع: 0.00</div>
          <div class="badge" id="bDiscItems">خصم الأصناف: 0.00</div>
          <div class="badge" id="bDiscInv">خصم الفاتورة: 0.00</div>
          <div class="badge ok" id="bGrand">الإجمالي: 0.00</div>
          <div class="badge" id="bRemaining">المتبقي: 0.00</div>
          <div class="spacer"></div>
          ${isNew ? `<button class="btn ok no-print" type="submit">حفظ</button>` : (canEdit ? `<button class="btn ok no-print" type="submit">حفظ التعديل</button>` : '')}
          ${!isNew ? `<button class="btn ghost no-print" type="button" id="btnPrintA4">طباعة A4</button>
                       <button class="btn ghost no-print" type="button" id="btnPrintTh">طباعة حراري</button>` : ''}
          ${(!isNew && me.role==='admin') ? `<button class="btn danger no-print" type="button" id="btnDelete">حذف</button>`:''}
        </div>
      </div>
    </form>
  </div>`;
}

function buildLineEditorRow(idx, item, products, disabled){
  const prod = products.find(p=>p.id===item.productId) || null;
  const productOptions = ['<option value="">— اختر صنف —</option>'].concat(
    products.map(p=>`<option value="${p.id}" ${(item.productId===p.id)?'selected':''}>${escapeHtml(p.name)} — ${fmtMoney(p.price)} ج</option>`)
  ).join('');
  const qty = item.qty ?? 1;
  const price = item.priceSnapshot ?? (prod?.price||0);
  const discType = item.discountTypeItem ?? 'amount';
  const discVal = item.discountValueItem ?? 0;

  return `<tr data-idx="${idx}">
    <td class="muted">${escapeHtml(item.codeSnapshot||prod?.code||'')}</td>
    <td>
      <select data-f="productId" ${disabled?'disabled':''}>${productOptions}</select>
      <div class="muted" style="font-size:11px;margin-top:4px;">Snapshot: الاسم/السعر يُحفظ داخل الفاتورة</div>
    </td>
    <td class="num"><input class="input" style="padding:8px" type="number" min="0" step="1" data-f="qty" value="${escapeHtml(qty)}" ${disabled?'disabled':''}></td>
    <td>قطعة</td>
    <td class="num"><input class="input" style="padding:8px" type="number" step="0.01" data-f="priceSnapshot" value="${escapeHtml(price)}" ${disabled?'disabled':''}></td>
    <td class="num">
      <div class="row" style="justify-content:flex-start">
        <select data-f="discountTypeItem" style="max-width:96px" ${disabled?'disabled':''}>
          <option value="amount" ${discType==='amount'?'selected':''}>مبلغ</option>
          <option value="percent" ${discType==='percent'?'selected':''}>٪</option>
        </select>
        <input class="input" style="padding:8px;max-width:140px" type="number" step="0.01" data-f="discountValueItem" value="${escapeHtml(discVal)}" ${disabled?'disabled':''}>
      </div>
    </td>
    <td class="num" data-calc="total">0.00</td>
    <td class="actions no-print">
      <button class="btn small danger" type="button" data-act="del" ${disabled?'disabled':''}>حذف بند</button>
    </td>
  </tr>`;
}

function computeInvoiceFromForm(form, products){
  const data = new FormData(form);
  const dateStr = data.get('date');
  const date = Timestamp.fromDate(new Date(dateStr+'T12:00:00'));
  const payType = data.get('payType') || 'cash';
  const customerId = data.get('customerId') || '';
  const note = (data.get('note')||'').toString().trim();
  const discountTypeInvoice = data.get('discountTypeInvoice') || 'amount';
  const discountValueInvoice = parseDiscount(data.get('discountValueInvoice'), discountTypeInvoice);
  const paid = Number(data.get('paid')||0);

  // lines from table
  const rows = Array.from(document.querySelectorAll('#tblLines tbody tr'));
  const items = rows.map(r=>{
    const idx = r.getAttribute('data-idx');
    const get = (f)=> r.querySelector(`[data-f="${f}"]`)?.value;
    const productId = get('productId') || '';
    const prod = products.find(p=>p.id===productId) || {};
    const nameSnapshot = prod.name || '';
    const codeSnapshot = prod.code || '';
    const qty = Number(get('qty')||0);
    const priceSnapshot = Number(get('priceSnapshot')||0);
    const discountTypeItem = get('discountTypeItem') || 'amount';
    const discountValueItem = parseDiscount(get('discountValueItem'), discountTypeItem);
    const {gross, disc, net} = calcLine(qty, priceSnapshot, discountTypeItem, discountValueItem);
    return {
      productId,
      codeSnapshot,
      nameSnapshot,
      qty,
      unit:'قطعة',
      priceSnapshot,
      discountTypeItem,
      discountValueItem,
      lineGross: gross,
      lineDiscount: disc,
      lineTotal: net
    };
  }).filter(x=>x.productId && x.qty>0);

  // totals
  const subtotal = items.reduce((a,x)=>a+Number(x.lineGross||0),0);
  const discItems = items.reduce((a,x)=>a+Number(x.lineDiscount||0),0);
  const afterItems = items.reduce((a,x)=>a+Number(x.lineTotal||0),0);

  let discInv = 0;
  if(discountTypeInvoice==='percent') discInv = afterItems*(discountValueInvoice/100);
  else discInv = discountValueInvoice;
  discInv = clamp(discInv,0,afterItems);
  const grandTotal = afterItems - discInv;

  let paidTotal = paid;
  if(payType==='cash') paidTotal = grandTotal; // default enforce on cash (user can still edit if admin)
  paidTotal = clamp(paidTotal,0,grandTotal);
  const remaining = grandTotal - paidTotal;

  return {
    date, payType, customerId, note,
    items,
    subtotal,
    discountTypeInvoice,
    discountValueInvoice,
    discountItemsTotal: discItems,
    discountInvoiceTotal: discInv,
    grandTotal,
    paid: paidTotal,
    remaining
  };
}

function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }

function renderInvoicePrint(company, inv, kind='a4'){
  // kind a4 / th
  const logo = company.logoUrl ? `<img src="${escapeHtml(company.logoUrl)}" style="max-height:${kind==='a4'?'70px':'50px'};object-fit:contain" />` : '';
  const phones = (company.phones||[]).map(p=>escapeHtml(p)).join(' — ');
  const header = kind==='a4' ? `
    <div style="display:flex;gap:14px;align-items:center;justify-content:space-between;">
      <div style="min-width:0">
        <div style="font-size:20px;font-weight:900">${escapeHtml(company.name||'')}</div>
        <div style="font-size:12px;color:#333;margin-top:4px">${escapeHtml(company.address||'')}</div>
        <div style="font-size:12px;color:#333;margin-top:4px">${phones}</div>
      </div>
      <div>${logo}</div>
    </div>
    <hr/>
  ` : `
    <div style="text-align:center;">
      <div style="font-weight:900;font-size:18px">${escapeHtml(company.name||'')}</div>
      ${logo?`<div style="margin-top:6px">${logo}</div>`:''}
      <div style="font-size:12px;margin-top:6px">${phones}</div>
      <div style="font-size:12px">${escapeHtml(company.address||'')}</div>
    </div>
    <hr/>
  `;

  const title = inv.docType==='return' ? 'مرتجع مبيعات' : 'فاتورة مبيعات';
  const pay = inv.payType==='credit' ? 'أجل' : 'نقدي';
  const cust = inv.customerNameSnapshot || '—';
  const date = fmtDate(inv.date);

  const rows = inv.items.map((x,i)=>`
    <tr>
      <td>${escapeHtml(x.codeSnapshot||'')}</td>
      <td>${escapeHtml(x.nameSnapshot||'')}</td>
      <td style="text-align:left">${Number(x.qty||0)}</td>
      <td>قطعة</td>
      <td style="text-align:left">${fmtMoney(x.priceSnapshot||0)}</td>
      <td style="text-align:left">${fmtMoney(x.lineTotal||0)}</td>
    </tr>
  `).join('');

  const totals = `
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
      <div>المجموع: <b>${fmtMoney(inv.subtotal||0)}</b> ج</div>
      <div>خصم الأصناف: <b>${fmtMoney(inv.discountItemsTotal||0)}</b> ج</div>
      <div>خصم الفاتورة: <b>${fmtMoney(inv.discountInvoiceTotal||0)}</b> ج</div>
      <div>الإجمالي: <b>${fmtMoney(inv.grandTotal||0)}</b> ج</div>
      <div>المدفوع: <b>${fmtMoney(inv.paid||0)}</b> ج</div>
      <div>المتبقي: <b>${fmtMoney(inv.remaining||0)}</b> ج</div>
    </div>
  `;

  const words = amountToArabicWordsEGP(inv.grandTotal||0);

  const footer = company.footerNote ? `<hr/><div style="font-size:12px;color:#333">${escapeHtml(company.footerNote)}</div>`:'';

  const pageStyle = kind==='th' ? `
    <style>
      @page { size: 80mm auto; margin: 6mm; }
      body { font-family: Arial, "Noto Kufi Arabic", "Noto Sans Arabic", sans-serif; direction: rtl; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th,td { padding:6px 0; border-bottom:1px dashed #999; text-align:right; }
      th{ font-weight:800; }
      .meta{ font-size:12px; }
    </style>
  ` : `
    <style>
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, "Noto Kufi Arabic", "Noto Sans Arabic", sans-serif; direction: rtl; }
      table { width:100%; border-collapse:collapse; font-size:12px; }
      th,td { padding:8px; border:1px solid #ddd; text-align:right; }
      th{ background:#f5f7ff; font-weight:800; }
      .meta{ font-size:12px; color:#333; }
    </style>
  `;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${pageStyle}</head>
  <body>
    ${header}
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;" class="meta">
      <div><b>${title}</b></div>
      <div>رقم: <b>${inv.invoiceNo}</b></div>
      <div>تاريخ: <b>${date}</b></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px" class="meta">
      <div>العميل: <b>${escapeHtml(cust)}</b></div>
      <div>النوع: <b>${pay}</b></div>
    </div>
    <hr/>
    <table>
      <thead>
        <tr>
          <th>رمز</th><th>المادة</th><th style="text-align:left">الكمية</th><th>الوحدة</th>
          <th style="text-align:left">السعر</th><th style="text-align:left">القيمة</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <hr/>
    ${totals}
    <hr/>
    <div style="font-size:12px;color:#333">المبلغ بالحروف: <b>${escapeHtml(words)}</b></div>
    ${footer}
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
}

export async function viewInvoices(me, mode='sale'){
  const perm = mode==='sale' ? 'invoices_view' : 'returns_view';
  const deny = need(me, perm);
  if(deny) return deny;

  const docType = mode==='sale' ? 'sale' : 'return';
  const qy = query(collection(db,'invoices'), where('docType','==', docType), limit(200));
  const snaps = await getDocs(qy);

  const docs = snaps.docs.map(s=>({ id:s.id, ...s.data() }));
  docs.sort((a,b)=>((b.date?.toMillis?.() ?? 0) - (a.date?.toMillis?.() ?? 0)));

  const rows = [];
  docs.forEach(d=>{
    rows.push(`<tr>
      <td class="num">${d.invoiceNo ?? ''}</td>
      <td>${escapeHtml(d.customerNameSnapshot||'—')}</td>
      <td>${fmtDate(d.date)}</td>
      <td class="num">${fmtMoney(d.grandTotal||0)}</td>
      <td>${d.payType==='credit' ? '<span class="badge warn">أجل</span>' : '<span class="badge ok">نقدي</span>'}</td>
      <td>${d.locked ? '<span class="badge ok">مقفلة</span>' : '<span class="badge warn">غير مقفلة</span>'}</td>
      <td class="actions">
        <a class="btn small ghost" href="#/${mode}/${d.id}">فتح</a>
      </td>
    </tr>`);
  });

  const canCreate = hasPerm(me, mode==='sale'?'invoices_create':'returns_create');

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">${mode==='sale'?'فواتير المبيعات':'مرتجعات المبيعات'}</div>
        <div class="muted">بحث سريع: اكتب رقم فاتورة أو اسم عميل داخل المتصفح (Ctrl+F)</div>
      </div>
      <div class="spacer"></div>
      ${canCreate?`<a class="btn no-print" href="#/${mode}/new">${mode==='sale'?'فاتورة جديدة':'مرتجع جديد'}</a>`:''}
    </div>
    <div class="hr"></div>
    <div style="overflow:auto;">
      <table class="table">
        <thead>
          <tr>
            <th class="num">رقم</th>
            <th>العميل</th>
            <th>التاريخ</th>
            <th class="num">الإجمالي</th>
            <th>النوع</th>
            <th>القفل</th>
            <th class="actions">إجراءات</th>
          </tr>
        </thead>
        <tbody>${rows.join('') || `<tr><td colspan="7" class="muted">لا توجد بيانات بعد.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export async function viewInvoiceEditor(me, mode, id){
  const permView = mode==='sale' ? 'invoices_view' : 'returns_view';
  const permCreate = mode==='sale' ? 'invoices_create' : 'returns_create';
  if(!hasPerm(me, permView)) return need(me, permView);

  const docType = mode==='sale' ? 'sale' : 'return';
  const customersOptions = await listCustomersOptions();
  const products = await listProductsOptions();

  if(id==='new'){
    if(!hasPerm(me, permCreate)) return need(me, permCreate);
    const html = renderInvoiceEditor(me, docType, {docType, locked:false, items:[]}, customersOptions, products);
    return html;
  }

  const snap = await getDoc(doc(db,'invoices', id));
  if(!snap.exists()) return `<div class="card pad"><div class="h1">غير موجود</div></div>`;
  const inv = {id:snap.id, ...snap.data()};
  const html = renderInvoiceEditor(me, docType, inv, customersOptions, products);
  return html;
}

export async function bindInvoiceEditor(me, mode, id){
  // called after view rendered
  const form = document.getElementById('formInv');
  if(!form) return;

  // set selected customer on new (options already built)
  if(id==='new'){
    form.customerId.value = '';
  }else{
    const snap = await getDoc(doc(db,'invoices', id));
    if(snap.exists()){
      const inv = snap.data();
      form.customerId.value = inv.customerId || '';
    }
  }

  const products = await listProductsOptions();

  // lines state
  let state = {items:[]};
  if(id!=='new'){
    const snap = await getDoc(doc(db,'invoices', id));
    if(snap.exists()) state = {items: (snap.data().items||[])};
  }

  const isAdmin = me.role === 'admin';
  const disabled = (id!=='new' && !isAdmin); // edits only admin
  const tbody = document.querySelector('#tblLines tbody');

  function rerenderLines(){
    tbody.innerHTML = state.items.map((it,idx)=>buildLineEditorRow(idx, it, products, disabled)).join('');
    tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const tr = btn.closest('tr');
        const idx = Number(tr.getAttribute('data-idx'));
        state.items.splice(idx,1);
        rerenderLines(); recalcTotals();
      });
    });
    tbody.querySelectorAll('select,input').forEach(el=>{
      el.addEventListener('input', ()=>{
        const tr = el.closest('tr');
        const idx = Number(tr.getAttribute('data-idx'));
        const f = el.getAttribute('data-f');
        state.items[idx][f] = el.value;
        // when product changes, set snapshots
        if(f==='productId'){
          const prod = products.find(p=>p.id===el.value);
          state.items[idx].nameSnapshot = prod?.name || '';
          state.items[idx].codeSnapshot = prod?.code || '';
          state.items[idx].priceSnapshot = prod?.price || 0;
          rerenderLines();
        }else{
          recalcTotals();
        }
      });
    });
    recalcTotals();
  }

  function recalcTotals(){
    // compute per row totals
    let subtotal=0, discItems=0, afterItems=0;
    Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{
      const idx = Number(tr.getAttribute('data-idx'));
      const item = state.items[idx];
      const prod = products.find(p=>p.id===item.productId) || {};
      const qty = Number(item.qty||tr.querySelector('[data-f="qty"]')?.value||0);
      const price = Number(item.priceSnapshot||tr.querySelector('[data-f="priceSnapshot"]')?.value||prod.price||0);
      const discType = item.discountTypeItem || tr.querySelector('[data-f="discountTypeItem"]')?.value || 'amount';
      const discVal = Number(item.discountValueItem||tr.querySelector('[data-f="discountValueItem"]')?.value||0);
      const {gross,disc,net} = calcLine(qty, price, discType, discVal);
      subtotal += gross;
      discItems += disc;
      afterItems += net;
      tr.querySelector('[data-calc="total"]').textContent = fmtMoney(net);
    });

    const dt = form.discountTypeInvoice.value;
    const dv = Number(form.discountValueInvoice.value||0);
    let discInv = (dt==='percent') ? afterItems*(dv/100) : dv;
    discInv = clamp(discInv,0,afterItems);
    const grand = afterItems - discInv;

    const payType = form.payType.value;
    let paid = Number(form.paid.value||0);
    if(payType==='cash') paid = grand;
    paid = clamp(paid,0,grand);
    const remaining = grand - paid;

    document.getElementById('bSubtotal').textContent = `المجموع: ${fmtMoney(subtotal)} ج`;
    document.getElementById('bDiscItems').textContent = `خصم الأصناف: ${fmtMoney(discItems)} ج`;
    document.getElementById('bDiscInv').textContent = `خصم الفاتورة: ${fmtMoney(discInv)} ج`;
    document.getElementById('bGrand').textContent = `الإجمالي: ${fmtMoney(grand)} ج`;
    document.getElementById('bRemaining').textContent = `المتبقي: ${fmtMoney(remaining)} ج`;
    document.getElementById('moneyWords').textContent = amountToArabicWordsEGP(grand);
    // update paid field enforce cash
    if(payType==='cash') form.paid.value = grand.toFixed(2);
  }

  document.getElementById('btnAddLine')?.addEventListener('click', ()=>{
    state.items.push({productId:'', qty:1, unit:'قطعة', priceSnapshot:0, discountTypeItem:'amount', discountValueItem:0});
    rerenderLines();
  });

  form.discountTypeInvoice?.addEventListener('input', recalcTotals);
  form.discountValueInvoice?.addEventListener('input', recalcTotals);
  form.payType?.addEventListener('input', recalcTotals);
  form.paid?.addEventListener('input', recalcTotals);

  // initialize at least one line
  if(state.items.length===0){
    state.items.push({productId:'', qty:1, unit:'قطعة', priceSnapshot:0, discountTypeItem:'amount', discountValueItem:0});
  }
  rerenderLines();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(id!=='new' && me.role!=='admin'){ toast('التعديل متاح للأدمن فقط'); return; }

    // customer snapshot
    const customerId = form.customerId.value || '';
    let customerNameSnapshot = '';
    if(customerId){
      const cs = await getDoc(doc(db,'customers', customerId));
      if(cs.exists()) customerNameSnapshot = cs.data().name || '';
    }

    const computed = computeInvoiceFromForm(form, products);
    computed.docType = (mode==='sale'?'sale':'return');
    computed.customerNameSnapshot = customerNameSnapshot || '—';

    // return should be negative effect? We'll store as positive grandTotal but docType marks return.
    // For simplicity, keep totals positive and treat return as separate in reports.

    if(computed.items.length===0){ toast('أضف بنوداً صحيحة'); return; }

    if(id==='new'){
      // transaction for invoiceNo counter
      const newId = await runTransaction(db, async (tx)=>{
        const cRef = doc(db,'counters','invoices');
        const cSnap = await tx.get(cRef);
        let next = 1;
        if(cSnap.exists()) next = Number(cSnap.data().next||1);
        tx.set(cRef, {next: next+1}, {merge:true});
        const invRef = doc(collection(db,'invoices'));
        tx.set(invRef, {
          invoiceNo: next,
          ...computed,
          locked: true,
          createdByUid: me.uid,
          createdByName: me.displayName || me.email || 'user',
          createdAt: serverTimestamp()
        });
        return invRef.id;
      });

      await logAudit(me, 'CREATE_INVOICE', {docType:computed.docType, invoiceId:newId});
      toast('تم الحفظ');
      location.hash = `#/${mode}/${newId}`;
      return;
    }else{
      const invRef = doc(db,'invoices', id);
      await updateDoc(invRef, {
        ...computed,
        locked: true,
        updatedAt: serverTimestamp(),
        updatedByUid: me.uid,
        updatedByName: me.displayName || me.email || 'admin'
      });
      await logAudit(me, 'UPDATE_INVOICE', {docType:computed.docType, invoiceId:id});
      toast('تم حفظ التعديل');
    }
  });

  if(id!=='new'){
    const btnA4 = document.getElementById('btnPrintA4');
    const btnTh = document.getElementById('btnPrintTh');
    async function doPrint(kind){
      const invSnap = await getDoc(doc(db,'invoices', id));
      if(!invSnap.exists()) return;
      const inv = {id:invSnap.id, ...invSnap.data()};
      const company = await getCompany();
      const html = renderInvoicePrint(company, inv, kind);
      const w = window.open('', '_blank');
      w.document.open(); w.document.write(html); w.document.close();
      // lock already true; still log print
      await logAudit(me, kind==='a4'?'PRINT_INVOICE_A4':'PRINT_INVOICE_TH', {invoiceId:id, invoiceNo:inv.invoiceNo});
    }
    btnA4?.addEventListener('click', ()=>doPrint('a4'));
    btnTh?.addEventListener('click', ()=>doPrint('th'));

    document.getElementById('btnDelete')?.addEventListener('click', async ()=>{
      if(me.role!=='admin'){ toast('الحذف للأدمن فقط'); return; }
      const invSnap = await getDoc(doc(db,'invoices', id));
      if(!invSnap.exists()) return;
      const inv = invSnap.data();
      if(!confirm(`تأكيد حذف المستند رقم ${inv.invoiceNo}?`)) return;
      await deleteDoc(doc(db,'invoices', id));
      await logAudit(me, 'DELETE_INVOICE', {invoiceId:id, invoiceNo:inv.invoiceNo, docType:inv.docType, total:inv.grandTotal});
      toast('تم الحذف');
      location.hash = `#/${mode}`;
    });
  }
}

export async function viewCustomers(me){
  const deny = need(me,'customers_view');
  if(deny) return deny;

  const canManage = hasPerm(me,'customers_manage');

  const qy = query(collection(db,'customers'), orderBy('name','asc'), limit(500));
  const snaps = await getDocs(qy);

  const rows = [];
  snaps.forEach(s=>{
    const d=s.data();
    rows.push(`<tr>
      <td>${escapeHtml(d.name||'')}</td>
      <td>${escapeHtml(d.phone||'')}</td>
      <td>${escapeHtml(d.address||'')}</td>
      <td class="actions">
        ${canManage?`<button class="btn small ghost" data-act="edit" data-id="${s.id}">تعديل</button>`:''}
        ${me.role==='admin'?`<button class="btn small danger" data-act="del" data-id="${s.id}">حذف</button>`:''}
      </td>
    </tr>`);
  });

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">العملاء</div>
        <div class="muted">بدون رصيد افتتاحي — الرصيد يُحسب من الحركات</div>
      </div>
      <div class="spacer"></div>
      ${canManage?`<button class="btn no-print" id="btnNewCust">عميل جديد</button>`:''}
    </div>
    <div class="hr"></div>
    <div id="custFormWrap" class="card pad" style="display:none; background:rgba(255,255,255,.03);"></div>
    <div style="overflow:auto;">
      <table class="table">
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th><th class="actions">إجراءات</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="4" class="muted">لا توجد بيانات.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export async function bindCustomers(me){
  const canManage = hasPerm(me,'customers_manage');
  const wrap = document.getElementById('custFormWrap');
  const btnNew = document.getElementById('btnNewCust');
  if(btnNew && canManage){
    btnNew.addEventListener('click', ()=>showForm());
  }
  function showForm(model=null){
    wrap.style.display='block';
    wrap.innerHTML = `<div class="row">
      <div class="h2">${model?'تعديل عميل':'عميل جديد'}</div>
      <div class="spacer"></div>
      <button class="btn small ghost" id="btnCloseCust">إغلاق</button>
    </div>
    <div class="hr"></div>
    <form id="formCust" class="grid cols2">
      <div class="field"><div class="label">اسم العميل</div><input class="input" name="name" required value="${escapeHtml(model?.name||'')}"></div>
      <div class="field"><div class="label">الهاتف</div><input class="input" name="phone" value="${escapeHtml(model?.phone||'')}"></div>
      <div class="field" style="grid-column:1/-1;"><div class="label">العنوان</div><input class="input" name="address" value="${escapeHtml(model?.address||'')}"></div>
      <div class="row" style="grid-column:1/-1;">
        <button class="btn ok" type="submit">حفظ</button>
        ${model?`<span class="muted">ID: ${escapeHtml(model.id)}</span>`:''}
      </div>
    </form>`;
    document.getElementById('btnCloseCust').onclick=()=>{ wrap.style.display='none'; wrap.innerHTML=''; };
    document.getElementById('formCust').onsubmit = async (e)=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const data={name:fd.get('name').toString().trim(), phone:(fd.get('phone')||'').toString().trim(), address:(fd.get('address')||'').toString().trim(), updatedAt:serverTimestamp()};
      if(!data.name){ toast('الاسم مطلوب'); return; }
      if(model){
        await updateDoc(doc(db,'customers', model.id), data);
        await logAudit(me,'UPDATE_CUSTOMER',{customerId:model.id, name:data.name});
      }else{
        const r = await addDoc(collection(db,'customers'), {...data, createdAt:serverTimestamp()});
        await logAudit(me,'CREATE_CUSTOMER',{customerId:r.id, name:data.name});
      }
      toast('تم الحفظ'); location.hash='#/customers';
    };
  }

  document.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id=btn.getAttribute('data-id');
      const s=await getDoc(doc(db,'customers',id));
      if(!s.exists()) return;
      showForm({id, ...s.data()});
    });
  });
  document.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(me.role!=='admin'){ toast('الحذف للأدمن فقط'); return; }
      const id=btn.getAttribute('data-id');
      // prevent delete if referenced
      const qy = query(collection(db,'invoices'), where('customerId','==',id), limit(1));
      const hits = await getDocs(qy);
      if(!hits.empty){ toast('لا يمكن حذف عميل عليه فواتير'); return; }
      if(!confirm('تأكيد حذف العميل؟')) return;
      await deleteDoc(doc(db,'customers',id));
      await logAudit(me,'DELETE_CUSTOMER',{customerId:id});
      toast('تم الحذف'); location.hash='#/customers';
    });
  });
}

export async function viewProducts(me){
  const deny = need(me,'products_view');
  if(deny) return deny;
  const canManage = hasPerm(me,'products_manage');

  const qy = query(collection(db,'products'), orderBy('name','asc'), limit(1000));
  const snaps = await getDocs(qy);

  const rows = [];
  snaps.forEach(s=>{
    const d=s.data();
    rows.push(`<tr>
      <td>${escapeHtml(d.code||'')}</td>
      <td>${escapeHtml(d.name||'')}</td>
      <td class="num">${fmtMoney(d.price||0)}</td>
      <td>${d.active===false?'<span class="badge danger">موقوف</span>':'<span class="badge ok">نشط</span>'}</td>
      <td class="actions">
        ${canManage?`<button class="btn small ghost" data-act="edit" data-id="${s.id}">تعديل</button>`:''}
        ${me.role==='admin'?`<button class="btn small danger" data-act="del" data-id="${s.id}">حذف</button>`:''}
      </td>
    </tr>`);
  });

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">الأصناف (قائمة أسعار)</div>
        <div class="muted">بدون مخزون — فقط رمز/اسم/سعر</div>
      </div>
      <div class="spacer"></div>
      ${canManage?`<button class="btn no-print" id="btnNewProd">صنف جديد</button>`:''}
    </div>
    <div class="hr"></div>
    <div id="prodFormWrap" class="card pad" style="display:none; background:rgba(255,255,255,.03);"></div>
    <div style="overflow:auto;">
      <table class="table">
        <thead><tr><th>الرمز</th><th>الاسم</th><th class="num">السعر</th><th>الحالة</th><th class="actions">إجراءات</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="5" class="muted">لا توجد بيانات.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export async function bindProducts(me){
  const canManage = hasPerm(me,'products_manage');
  const wrap = document.getElementById('prodFormWrap');
  const btnNew = document.getElementById('btnNewProd');
  if(btnNew && canManage){
    btnNew.addEventListener('click', ()=>showForm());
  }
  function showForm(model=null){
    wrap.style.display='block';
    wrap.innerHTML = `<div class="row">
      <div class="h2">${model?'تعديل صنف':'صنف جديد'}</div>
      <div class="spacer"></div>
      <button class="btn small ghost" id="btnCloseProd">إغلاق</button>
    </div>
    <div class="hr"></div>
    <form id="formProd" class="grid cols2">
      <div class="field"><div class="label">رمز الصنف</div><input class="input" name="code" value="${escapeHtml(model?.code||'')}" placeholder="اختياري"></div>
      <div class="field"><div class="label">اسم الصنف</div><input class="input" name="name" required value="${escapeHtml(model?.name||'')}"></div>
      <div class="field"><div class="label">السعر (جنيه)</div><input class="input" name="price" type="number" step="0.01" required value="${escapeHtml(model?.price??0)}"></div>
      <div class="field"><div class="label">الحالة</div>
        <select name="active">
          <option value="true" ${(model?.active===false)?'':'selected'}>نشط</option>
          <option value="false" ${(model?.active===false)?'selected':''}>موقوف</option>
        </select>
      </div>
      <div class="row" style="grid-column:1/-1;">
        <button class="btn ok" type="submit">حفظ</button>
      </div>
    </form>`;
    document.getElementById('btnCloseProd').onclick=()=>{ wrap.style.display='none'; wrap.innerHTML=''; };
    document.getElementById('formProd').onsubmit = async (e)=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const data={
        code:(fd.get('code')||'').toString().trim(),
        name:fd.get('name').toString().trim(),
        price:Number(fd.get('price')||0),
        active: fd.get('active')==='true',
        updatedAt:serverTimestamp()
      };
      if(!data.name){ toast('الاسم مطلوب'); return; }
      if(model){
        await updateDoc(doc(db,'products', model.id), data);
        await logAudit(me,'UPDATE_PRODUCT',{productId:model.id, name:data.name});
      }else{
        const r = await addDoc(collection(db,'products'), {...data, createdAt:serverTimestamp()});
        await logAudit(me,'CREATE_PRODUCT',{productId:r.id, name:data.name});
      }
      toast('تم الحفظ'); location.hash='#/products';
    };
  }

  document.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id=btn.getAttribute('data-id');
      const s=await getDoc(doc(db,'products',id));
      if(!s.exists()) return;
      showForm({id, ...s.data()});
    });
  });
  document.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(me.role!=='admin'){ toast('الحذف للأدمن فقط'); return; }
      const id=btn.getAttribute('data-id');
      // prevent delete if referenced in invoices
      const qy = query(collection(db,'invoices'), where('items','!=',null), limit(1)); // can't query array of objects; so soft check omitted
      if(!confirm('تأكيد حذف الصنف؟ (إن كان مستخدمًا في فواتير سابقة لن تتأثر الفواتير بسبب Snapshot)')) return;
      await deleteDoc(doc(db,'products',id));
      await logAudit(me,'DELETE_PRODUCT',{productId:id});
      toast('تم الحذف'); location.hash='#/products';
    });
  });
}

export async function viewPayments(me){
  const deny = need(me,'payments_view');
  if(deny) return deny;

  const canCreate = hasPerm(me,'payments_create');

  const qy = query(collection(db,'payments'), orderBy('date','desc'), limit(200));
  const snaps = await getDocs(qy);

  const rows = [];
  snaps.forEach(s=>{
    const d=s.data();
    rows.push(`<tr>
      <td>${escapeHtml(d.customerNameSnapshot||'—')}</td>
      <td>${fmtDate(d.date)}</td>
      <td class="num">${fmtMoney(d.amount||0)}</td>
      <td>${escapeHtml(d.method||'')}</td>
      <td>${d.invoiceNo ? `فاتورة #${d.invoiceNo}` : 'على الحساب'}</td>
      <td class="actions">
        ${hasPerm(me,'payments_print')?`<button class="btn small ghost" data-act="print" data-id="${s.id}">طباعة</button>`:''}
        ${me.role==='admin'?`<button class="btn small danger" data-act="del" data-id="${s.id}">حذف</button>`:''}
      </td>
    </tr>`);
  });

  const customersOptions = await listCustomersOptions();

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">الدفعات</div>
        <div class="muted">تشمل دفعة على الحساب + دفعة مرتبطة بفاتورة</div>
      </div>
      <div class="spacer"></div>
      ${canCreate?`<button class="btn no-print" id="btnNewPay">دفعة جديدة</button>`:''}
    </div>
    <div class="hr"></div>
    <div id="payFormWrap" class="card pad" style="display:none; background:rgba(255,255,255,.03);"></div>

    <div style="overflow:auto;">
      <table class="table">
        <thead><tr><th>العميل</th><th>التاريخ</th><th class="num">المبلغ</th><th>الطريقة</th><th>النوع</th><th class="actions">إجراءات</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="6" class="muted">لا توجد بيانات.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="muted" style="margin-top:10px;">طرق الدفع الافتراضية: نقداً / تحويل / فودافون كاش (يمكن تعديلها لاحقًا).</div>
  </div>`;
}

function renderPaymentPrint(company, pay, kind='a4'){
  const phones = (company.phones||[]).join(' — ');
  const logo = company.logoUrl ? `<img src="${escapeHtml(company.logoUrl)}" style="max-height:${kind==='a4'?'70px':'50px'};object-fit:contain" />` : '';
  const pageStyle = kind==='th' ? `
    <style>
      @page { size: 80mm auto; margin: 6mm; }
      body { font-family: Arial, "Noto Kufi Arabic", "Noto Sans Arabic", sans-serif; direction: rtl; }
      .t{font-weight:900;font-size:16px;text-align:center}
      .k{font-size:12px}
    </style>
  ` : `
    <style>
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, "Noto Kufi Arabic", "Noto Sans Arabic", sans-serif; direction: rtl; }
      .wrap{border:1px solid #ddd;padding:12px;border-radius:10px}
      .t{font-weight:900;font-size:18px}
      .k{font-size:12px;color:#333}
    </style>
  `;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${pageStyle}</head>
  <body>
    ${kind==='a4'?`<div class="wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div class="t">${escapeHtml(company.name||'')}</div>
          <div class="k">${escapeHtml(company.address||'')}</div>
          <div class="k">${escapeHtml(phones||'')}</div>
        </div>
        <div>${logo}</div>
      </div>
      <hr/>
      <div class="t" style="text-align:center">سند قبض</div>
      <div class="k">التاريخ: <b>${fmtDate(pay.date)}</b></div>
      <div class="k">العميل: <b>${escapeHtml(pay.customerNameSnapshot||'—')}</b></div>
      <div class="k">المبلغ: <b>${fmtMoney(pay.amount||0)}</b> جنيه</div>
      <div class="k">الطريقة: <b>${escapeHtml(pay.method||'')}</b></div>
      <div class="k">: <b>${pay.invoiceNo?`دفعة لفاتورة رقم ${pay.invoiceNo}`:'دفعة على الحساب'}</b></div>
      ${company.footerNote?`<hr/><div class="k">${escapeHtml(company.footerNote)}</div>`:''}
    </div>`:
    `<div style="text-align:center">
      <div class="t">${escapeHtml(company.name||'')}</div>
      ${logo?`<div style="margin-top:6px">${logo}</div>`:''}
      <div class="k">${escapeHtml(phones||'')}</div>
      <hr/>
      <div class="t">سند قبض</div>
      <div class="k">تاريخ: <b>${fmtDate(pay.date)}</b></div>
      <div class="k">عميل: <b>${escapeHtml(pay.customerNameSnapshot||'—')}</b></div>
      <div class="k">مبلغ: <b>${fmtMoney(pay.amount||0)}</b></div>
      <div class="k">طريقة: <b>${escapeHtml(pay.method||'')}</b></div>
      <div class="k">${pay.invoiceNo?`فاتورة #${pay.invoiceNo}`:'على الحساب'}</div>
      ${company.footerNote?`<hr/><div class="k">${escapeHtml(company.footerNote)}</div>`:''}
    </div>`}
    <script>window.onload=()=>window.print();</script>
  </body></html>`;
}

export async function bindPayments(me){
  const canCreate = hasPerm(me,'payments_create');
  const wrap = document.getElementById('payFormWrap');
  const btnNew = document.getElementById('btnNewPay');

  const customersOptions = await listCustomersOptions();

  if(btnNew && canCreate){
    btnNew.addEventListener('click', ()=>showForm());
  }

  function showForm(model=null){
    wrap.style.display='block';
    wrap.innerHTML = `<div class="row">
      <div class="h2">${model?'تعديل دفعة':'دفعة جديدة'}</div>
      <div class="spacer"></div>
      <button class="btn small ghost" id="btnClosePay">إغلاق</button>
    </div>
    <div class="hr"></div>
    <form id="formPay" class="grid cols2">
      <div class="field">
        <div class="label">التاريخ</div>
        <input class="input" name="date" type="date" value="${new Date().toISOString().slice(0,10)}" />
      </div>
      <div class="field">
        <div class="label">العميل</div>
        <select name="customerId" required>${customersOptions}</select>
      </div>
      <div class="field">
        <div class="label">المبلغ</div>
        <input class="input" name="amount" type="number" step="0.01" required />
      </div>
      <div class="field">
        <div class="label">طريقة الدفع</div>
        <select name="method">
          <option value="نقداً">نقداً</option>
          <option value="تحويل">تحويل</option>
          <option value="فودافون كاش">فودافون كاش</option>
        </select>
      </div>
      <div class="field" style="grid-column:1/-1;">
        <div class="label">ربط بفاتورة (اختياري)</div>
        <input class="input" name="invoiceNo" type="number" step="1" placeholder="اكتب رقم الفاتورة أو اتركه فارغًا لدفعة على الحساب" />
      </div>
      <div class="field" style="grid-column:1/-1;">
        <div class="label">ملاحظة</div>
        <input class="input" name="note" placeholder="اختياري" />
      </div>
      <div class="row" style="grid-column:1/-1;">
        <button class="btn ok" type="submit">حفظ</button>
      </div>
    </form>`;
    document.getElementById('btnClosePay').onclick=()=>{ wrap.style.display='none'; wrap.innerHTML=''; };
    document.getElementById('formPay').onsubmit = async (e)=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const customerId = fd.get('customerId')?.toString()||'';
      const amount = Number(fd.get('amount')||0);
      const method = (fd.get('method')||'').toString();
      const invoiceNo = Number(fd.get('invoiceNo')||0) || null;
      const note = (fd.get('note')||'').toString().trim();
      const date = Timestamp.fromDate(new Date(fd.get('date')+'T12:00:00'));

      if(!customerId){ toast('اختر عميل'); return; }
      if(amount<=0){ toast('المبلغ غير صحيح'); return; }

      // snapshot customer name
      const cs = await getDoc(doc(db,'customers', customerId));
      const customerNameSnapshot = cs.exists()? (cs.data().name||'') : '—';

      // optional invoice link by invoiceNo
      let invoiceId = null;
      let linkedInvoiceNo = null;
      if(invoiceNo){
        const qy = query(collection(db,'invoices'), where('invoiceNo','==', invoiceNo), limit(1));
        const hits = await getDocs(qy);
        if(hits.empty){ toast('لم يتم العثور على رقم الفاتورة'); return; }
        invoiceId = hits.docs[0].id;
        linkedInvoiceNo = invoiceNo;
        // update invoice paid/remaining (admin only or allowed perm?)
        // Requirement doesn't restrict; but safe: allow payments_create.
        const invRef = doc(db,'invoices', invoiceId);
        await runTransaction(db, async (tx)=>{
          const s=await tx.get(invRef);
          if(!s.exists()) throw new Error('invoice missing');
          const inv=s.data();
          const grand=Number(inv.grandTotal||0);
          const paidOld=Number(inv.paid||0);
          const paidNew = clamp(paidOld + amount, 0, grand);
          const remNew = grand - paidNew;
          tx.update(invRef, {paid: paidNew, remaining: remNew, updatedAt: serverTimestamp()});
        });
      }

      const r = await addDoc(collection(db,'payments'),{
        customerId,
        customerNameSnapshot,
        amount,
        method,
        note,
        date,
        invoiceId,
        invoiceNo: linkedInvoiceNo,
        onAccount: !invoiceId,
        createdByUid: me.uid,
        createdByName: me.displayName || me.email || 'user',
        createdAt: serverTimestamp()
      });
      await logAudit(me,'CREATE_PAYMENT',{paymentId:r.id, amount, customerId, invoiceNo: linkedInvoiceNo});
      toast('تم الحفظ'); location.hash='#/payments';
    };
  }

  // print / delete actions
  document.querySelectorAll('button[data-act="print"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!hasPerm(me,'payments_print')){ toast('لا تملك صلاحية الطباعة'); return; }
      const id=btn.getAttribute('data-id');
      const s=await getDoc(doc(db,'payments',id));
      if(!s.exists()) return;
      const company=await getCompany();
      const pay={id, ...s.data()};
      // choose kind
      const kind = confirm('طباعة حراري؟ (OK=حراري, Cancel=A4)') ? 'th' : 'a4';
      const html = renderPaymentPrint(company, pay, kind);
      const w = window.open('', '_blank');
      w.document.open(); w.document.write(html); w.document.close();
      await logAudit(me, kind==='th'?'PRINT_RECEIPT_TH':'PRINT_RECEIPT_A4', {paymentId:id});
    });
  });

  document.querySelectorAll('button[data-act="del"]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(me.role!=='admin'){ toast('الحذف للأدمن فقط'); return; }
      const id=btn.getAttribute('data-id');
      const s=await getDoc(doc(db,'payments',id));
      if(!s.exists()) return;
      const pay=s.data();
      if(!confirm('تأكيد حذف الدفعة؟')) return;

      // If linked invoice, rollback paid (best effort)
      if(pay.invoiceId){
        const invRef = doc(db,'invoices', pay.invoiceId);
        await runTransaction(db, async (tx)=>{
          const invS=await tx.get(invRef);
          if(invS.exists()){
            const inv=invS.data();
            const grand=Number(inv.grandTotal||0);
            const paidOld=Number(inv.paid||0);
            const paidNew = clamp(paidOld - Number(pay.amount||0), 0, grand);
            tx.update(invRef, {paid: paidNew, remaining: grand - paidNew, updatedAt: serverTimestamp()});
          }
        });
      }

      await deleteDoc(doc(db,'payments',id));
      await logAudit(me,'DELETE_PAYMENT',{paymentId:id, amount:pay.amount, invoiceNo:pay.invoiceNo||null});
      toast('تم الحذف'); location.hash='#/payments';
    });
  });
}

export async function viewCompany(me){
  const deny = need(me,'company_manage');
  if(deny) return deny;

  const company = await getCompany();
  const phones = (company.phones||[]).join('\n');

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">بيانات الشركة</div>
        <div class="muted">تعديل ورفع لوجو — للأدمن فقط</div>
      </div>
      <div class="spacer"></div>
      <span class="badge ok">Admin</span>
    </div>
    <div class="hr"></div>

    <form id="formCompany" class="grid cols2">
      <div class="field">
        <div class="label">اسم الشركة</div>
        <input class="input" name="name" value="${escapeHtml(company.name||'')}" required>
      </div>
      <div class="field">
        <div class="label">العنوان</div>
        <input class="input" name="address" value="${escapeHtml(company.address||'')}">
      </div>
      <div class="field" style="grid-column:1/-1;">
        <div class="label">أرقام التواصل (كل رقم بسطر)</div>
        <textarea name="phones">${escapeHtml(phones)}</textarea>
      </div>
      <div class="field">
        <div class="label">واتساب</div>
        <input class="input" name="whatsapp" value="${escapeHtml(company.whatsapp||'')}">
      </div>
      <div class="field">
        <div class="label">تليجرام</div>
        <input class="input" name="telegram" value="${escapeHtml(company.telegram||'')}">
      </div>
      <div class="field" style="grid-column:1/-1;">
        <div class="label">فيسبوك</div>
        <input class="input" name="facebook" value="${escapeHtml(company.facebook||'')}">
      </div>
      <div class="field" style="grid-column:1/-1;">
        <div class="label">ملاحظة أسفل الفاتورة</div>
        <textarea name="footerNote" placeholder="مثال: شكراً لتعاملكم معنا">${escapeHtml(company.footerNote||'')}</textarea>
      </div>

      <div class="card pad" style="grid-column:1/-1; background:rgba(255,255,255,.03);">
        <div class="row">
          <div>
            <div class="h2">اللوجو</div>
            <div class="muted">رفع صورة شعار (PNG/JPG). سيتم حفظها في Firebase Storage</div>
          </div>
          <div class="spacer"></div>
          ${company.logoUrl?`<a class="btn small ghost" href="${escapeHtml(company.logoUrl)}" target="_blank">عرض</a>`:''}
        </div>
        <div class="hr"></div>
        <div class="row">
          <input class="input" type="file" id="fileLogo" accept="image/*" style="max-width:420px;">
          <button class="btn small ok" type="button" id="btnUploadLogo">رفع/تحديث</button>
          ${company.logoUrl?`<button class="btn small danger" type="button" id="btnDeleteLogo">حذف اللوجو</button>`:''}
        </div>
      </div>

      <div class="row" style="grid-column:1/-1;">
        <button class="btn ok" type="submit">حفظ ات</button>
      </div>
    </form>
  </div>`;
}

export async function bindCompany(me){
  const form = document.getElementById('formCompany');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const phones = (fd.get('phones')||'').toString().split('\n').map(s=>s.trim()).filter(Boolean);
    const data = {
      name: fd.get('name').toString().trim(),
      address: (fd.get('address')||'').toString().trim(),
      phones,
      whatsapp: (fd.get('whatsapp')||'').toString().trim(),
      telegram: (fd.get('telegram')||'').toString().trim(),
      facebook: (fd.get('facebook')||'').toString().trim(),
      footerNote: (fd.get('footerNote')||'').toString().trim(),
      updatedAt: serverTimestamp(),
      updatedBy: me.uid
    };
    await setDoc(doc(db,'settings','company'), data, {merge:true});
    await logAudit(me,'UPDATE_COMPANY', {});
    toast('تم حفظ بيانات الشركة');
  });

  const btnUpload = document.getElementById('btnUploadLogo');
  btnUpload?.addEventListener('click', async ()=>{
    const inp = document.getElementById('fileLogo');
    const file = inp?.files?.[0];
    if(!file){ toast('اختر صورة أولاً'); return; }
    const path = `company/logo.png`;
    const r = sRef(storage, path);
    await uploadBytes(r, file, {contentType: file.type});
    const url = await getDownloadURL(r);
    await setDoc(doc(db,'settings','company'), {logoUrl:url, updatedAt: serverTimestamp(), updatedBy: me.uid}, {merge:true});
    await logAudit(me,'UPLOAD_LOGO', {path});
    toast('تم رفع اللوجو');
    location.hash = '#/company';
  });

  const btnDel = document.getElementById('btnDeleteLogo');
  btnDel?.addEventListener('click', async ()=>{
    if(!confirm('تأكيد حذف اللوجو؟')) return;
    const path = `company/logo.png`;
    try{ await deleteObject(sRef(storage, path)); }catch(e){}
    await setDoc(doc(db,'settings','company'), {logoUrl:'', updatedAt: serverTimestamp(), updatedBy: me.uid}, {merge:true});
    await logAudit(me,'DELETE_LOGO', {path});
    toast('تم حذف اللوجو');
    location.hash = '#/company';
  });
}

export async function viewUsers(me){
  const deny = need(me,'users_manage');
  if(deny) return deny;

  const qy = query(collection(db,'users'), orderBy('displayName','asc'), limit(200));
  const snaps = await getDocs(qy);
  const rows = [];
  snaps.forEach(s=>{
    const d=s.data();
    rows.push(`<tr>
      <td>${escapeHtml(d.displayName||'')}</td>
      <td>${escapeHtml(d.role||'user')}</td>
      <td>${d.active?'<span class="badge ok">مفعل</span>':'<span class="badge danger">موقوف</span>'}</td>
      <td class="actions"><button class="btn small ghost" data-act="edit" data-id="${s.id}">تعديل</button></td>
    </tr>`);
  });

  return `<div class="card pad">
    <div class="h1">المستخدمون والصلاحيات</div>
    <div class="muted">ملاحظة: إنشاء حساب (Email/Password) يتم من Firebase Auth. هنا نحدد Active/Permissions.</div>
    <div class="hr"></div>
    <div class="card pad" style="background:rgba(255,255,255,.03);">
      <div class="h2">إضافة مستخدم جديد (خطوتين)</div>
      <ol class="muted" style="margin:0; padding-inline-start:18px;">
        <li>أنشئ المستخدم من Firebase Authentication (Email/Password).</li>
        <li>انسخ UID من قائمة Users داخل Auth ثم اضغط “مستخدم جديد” وألصقه لتفعيل الصلاحيات.</li>
      </ol>
      <div class="hr"></div>
      <button class="btn no-print" id="btnNewUser">مستخدم جديد</button>
    </div>

    <div class="hr"></div>
    <div id="userFormWrap" class="card pad" style="display:none; background:rgba(255,255,255,.03);"></div>

    <div style="overflow:auto;">
      <table class="table">
        <thead><tr><th>الاسم</th><th>الدور</th><th>الحالة</th><th class="actions">إجراءات</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="4" class="muted">لا توجد بيانات.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export async function bindUsers(me){
  const wrap = document.getElementById('userFormWrap');
  const btnNew = document.getElementById('btnNewUser');
  btnNew?.addEventListener('click', ()=>showForm(null, true));

  function permChecks(selected){
    return Object.entries(PERMS).map(([k, label])=>{
      const checked = selected?.[k] ? 'checked' : '';
      return `<label class="row" style="justify-content:space-between; margin:6px 0; gap:12px;">
        <span>${escapeHtml(label)}</span>
        <input type="checkbox" name="perm_${k}" ${checked} />
      </label>`;
    }).join('');
  }

  async function showForm(userId, isNew=false){
    let model = null;
    if(userId){
      const s=await getDoc(doc(db,'users', userId));
      if(s.exists()) model = {id:userId, ...s.data()};
    }
    wrap.style.display='block';
    wrap.innerHTML = `<div class="row">
      <div class="h2">${isNew?'مستخدم جديد':'تعديل مستخدم'}</div>
      <div class="spacer"></div>
      <button class="btn small ghost" id="btnCloseUser">إغلاق</button>
    </div>
    <div class="hr"></div>
    <form id="formUser" class="grid cols2">
      <div class="field">
        <div class="label">UID</div>
        <input class="input" name="uid" ${isNew?'':'disabled'} value="${escapeHtml(model?.id||'')}" placeholder="الصقه من Firebase Auth" required>
      </div>
      <div class="field">
        <div class="label">الاسم المعروض</div>
        <input class="input" name="displayName" value="${escapeHtml(model?.displayName||'')}" required>
      </div>
      <div class="field">
        <div class="label">الدور</div>
        <select name="role">
          <option value="user" ${(model?.role==='admin')?'':'selected'}>user</option>
          <option value="admin" ${(model?.role==='admin')?'selected':''}>admin</option>
        </select>
      </div>
      <div class="field">
        <div class="label">الحالة</div>
        <select name="active">
          <option value="true" ${(model?.active===false)?'':'selected'}>مفعل</option>
          <option value="false" ${(model?.active===false)?'selected':''}>موقوف</option>
        </select>
      </div>

      <div class="card pad" style="grid-column:1/-1; background:rgba(255,255,255,.03);">
        <div class="h2">الصلاحيات (Checkbox)</div>
        <div class="muted">الأدمن يمتلك كل الصلاحيات تلقائياً.</div>
        <div class="hr"></div>
        <div class="grid cols2">${permChecks(model?.permissions||{})}</div>
      </div>

      <div class="row" style="grid-column:1/-1;">
        <button class="btn ok" type="submit">حفظ</button>
      </div>
    </form>`;
    document.getElementById('btnCloseUser').onclick=()=>{ wrap.style.display='none'; wrap.innerHTML=''; };

    document.getElementById('formUser').onsubmit = async (e)=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const uid = fd.get('uid')?.toString().trim();
      const displayName = fd.get('displayName')?.toString().trim();
      const role = fd.get('role')?.toString()||'user';
      const active = fd.get('active')==='true';

      const permissions = {};
      Object.keys(PERMS).forEach(k=>{
        permissions[k] = fd.get(`perm_${k}`) === 'on';
      });

      if(!uid || !displayName){ toast('ات ناقصة'); return; }
      await setDoc(doc(db,'users', uid), {
        displayName, role, active, permissions,
        updatedAt: serverTimestamp(), updatedBy: me.uid
      }, {merge:true});
      await logAudit(me, isNew?'CREATE_USER':'UPDATE_USER', {uid, role, active});
      toast('تم الحفظ'); location.hash='#/users';
    };
  }

  document.querySelectorAll('button[data-act="edit"]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id=btn.getAttribute('data-id');
      showForm(id,false);
    });
  });
}

export async function viewAudit(me){
  const deny = need(me,'audit_view');
  if(deny) return deny;

  const qy = query(collection(db,'auditLogs'), orderBy('at','desc'), limit(200));
  const snaps = await getDocs(qy);

  const rows = [];
  snaps.forEach(s=>{
    const d=s.data();
    rows.push(`<tr>
      <td>${fmtDateTime(d.at)}</td>
      <td>${escapeHtml(d.byName||'')}</td>
      <td>${escapeHtml(d.action||'')}</td>
      <td class="muted">${escapeHtml(JSON.stringify(d.meta||{}))}</td>
    </tr>`);
  });

  return `<div class="card pad">
    <div class="h1">سجل العمليات</div>
    <div class="muted">آخر 200 عملية</div>
    <div class="hr"></div>
    <div style="overflow:auto;">
      <table class="table">
        <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>تفاصيل</th></tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="4" class="muted">لا توجد بيانات.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export async function viewReports(me){
  const deny = need(me,'reports_view');
  if(deny) return deny;

  return `<div class="card pad">
    <div class="h1">التقارير</div>
    <div class="muted">نسخة أولى: تقارير أساسية (قيد التوسعة)</div>
    <div class="hr"></div>
    <div class="grid cols2">
      <div class="card pad" style="background:rgba(255,255,255,.03);">
        <div class="h2">تقرير مبيعات بين تاريخين</div>
        <form id="formRepSales" class="grid">
          <div class="field"><div class="label">من</div><input class="input" type="date" name="from" required></div>
          <div class="field"><div class="label">إلى</div><input class="input" type="date" name="to" required></div>
          <div class="row"><button class="btn ok" type="submit">عرض</button>
            ${hasPerm(me,'reports_export')?`<button class="btn ghost" type="button" id="btnExportCSV" disabled>تصدير CSV</button>`:''}
          </div>
        </form>
        <div class="hr"></div>
        <div id="repOut" class="muted">—</div>
      </div>

      <div class="card pad" style="background:rgba(255,255,255,.03);">
        <div class="h2">أرصدة العملاء (حساب تلقائي)</div>
        <div class="muted">يحسب من الفواتير والدفعات (بدون رصيد افتتاحي)</div>
        <div class="hr"></div>
        <button class="btn ok" id="btnCustBalances">حساب الأرصدة</button>
        <div class="hr"></div>
        <div id="repBal" class="muted">—</div>
      </div>
    </div>
  </div>`;
}

export async function bindReports(me){
  const form = document.getElementById('formRepSales');
  const out = document.getElementById('repOut');
  const btnCSV = document.getElementById('btnExportCSV');
  let lastRows = [];

  form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd=new FormData(form);
    const from = new Date(fd.get('from')+'T00:00:00');
    const to = new Date(fd.get('to')+'T23:59:59');
    const fromTs = Timestamp.fromDate(from);
    const toTs = Timestamp.fromDate(to);

    const qy = query(collection(db,'invoices'), where('date','>=', fromTs), where('date','<=', toTs), orderBy('date','desc'), limit(1000));
    const snaps = await getDocs(qy);
    let sales=0, returns=0;
    lastRows = [];
    snaps.forEach(s=>{
      const d=s.data();
      if(d.docType==='return') returns += Number(d.grandTotal||0);
      else sales += Number(d.grandTotal||0);
      lastRows.push({invoiceNo:d.invoiceNo, date: fmtDate(d.date), customer:d.customerNameSnapshot||'', docType:d.docType, total:d.grandTotal});
    });
    const net = sales - returns;
    out.textContent = `مبيعات: ${fmtMoney(sales)} ج — مرتجعات: ${fmtMoney(returns)} ج — صافي: ${fmtMoney(net)} ج — عدد: ${lastRows.length}`;

    if(btnCSV){
      btnCSV.disabled = !(lastRows.length>0);
    }
  });

  btnCSV?.addEventListener('click', ()=>{
    if(!hasPerm(me,'reports_export')) return;
    const header = ['invoiceNo','date','customer','docType','total'];
    const csv = [header.join(',')].concat(
      lastRows.map(r=>header.map(k=>String(r[k]??'').replaceAll(',',' ')).join(','))
    ).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales_report_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('btnCustBalances')?.addEventListener('click', async ()=>{
    const repBal = document.getElementById('repBal');
    repBal.textContent = 'جاري الحساب...';
    // load customers
    const cs = await getDocs(query(collection(db,'customers'), orderBy('name','asc'), limit(2000)));
    // for each customer, compute: remaining of invoices (sales - returns) - payments
    const balances = [];
    for(const c of cs.docs){
      const id=c.id; const name=c.data().name||'';
      const invQ = query(collection(db,'invoices'), where('customerId','==',id), limit(2000));
      const invS = await getDocs(invQ);
      let invNet=0;
      invS.forEach(s=>{
        const d=s.data();
        const total = Number(d.grandTotal||0);
        if(d.docType==='return') invNet -= total;
        else invNet += Number(d.remaining||0); // only remaining affects balance
      });

      const payQ = query(collection(db,'payments'), where('customerId','==',id), limit(2000));
      const payS = await getDocs(payQ);
      let pays=0;
      payS.forEach(s=> pays += Number(s.data().amount||0));
      const bal = invNet - pays;
      balances.push({name, bal});
    }
    balances.sort((a,b)=>b.bal-a.bal);
    const top = balances.slice(0,50).map(x=>`${x.name}: ${fmtMoney(x.bal)} ج`).join('\n');
    repBal.textContent = top || 'لا توجد بيانات';
  });
}

// ===== Excel Import/Export for Products (SheetJS) =====
async function importProductsFromExcel(me){
  if(!window.XLSX){ toast('مكتبة Excel غير متاحة'); return; }
  if(!isAdmin(me)){ toast('هذه العملية للأدمن فقط'); return; }
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0];
    if(!file) return;
    try{
      toast('جاري قراءة الملف...');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
      let added=0, updated=0, failed=0;
      for(const r of rows){
        const code = String(r.code ?? r.Code ?? r.CODE ?? '').trim();
        const name = String(r.name ?? r.Name ?? r.NAME ?? '').trim();
        const price = Number(r.price ?? r.Price ?? r.PRICE ?? 0);
        if(!code || !name || !Number.isFinite(price)){ failed++; continue; }
        const docId = code; // use code as doc id for simplicity
        const ref = doc(db,'products', docId);
        const snap = await getDoc(ref);
        const payload = { code, name, price, unit:'قطعة', active:true, updatedAt: serverTimestamp() };
        if(snap.exists()){ await updateDoc(ref, payload); updated++; }
        else { await setDoc(ref, { ...payload, createdAt: serverTimestamp() }); added++; }
      }
      toast(`تم: إضافة ${added} / تحديث ${updated} / أخطاء ${failed}`);
      // refresh products view if a reload hook exists
      if(window.__refreshProducts) window.__refreshProducts();
    }catch(e){ console.error(e); toast('فشل الاستيراد'); }
  };
  inp.click();
}

async function exportProductsToExcel(me){
  if(!window.XLSX){ toast('مكتبة Excel غير متاحة'); return; }
  const qs = await getDocs(query(collection(db,'products')));
  const rows = [];
  qs.forEach(s=>{
    const d=s.data()||{};
    if(d.active===false) return;
    rows.push({ code: d.code ?? s.id, name: d.name ?? '', price: Number(d.price||0) });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'products');
  const fname = `products_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

function __productsExcelButtons(me){
  const host = document.querySelector('[data-view="products"] .toolbar-actions');
  if(!host) return;
  if(host.querySelector('[data-x="import"]')) return;
  const b1 = document.createElement('button');
  b1.className = 'btn';
  b1.textContent = 'استيراد Excel';
  b1.dataset.x='import';
  b1.onclick = ()=> importProductsFromExcel(me);
  const b2 = document.createElement('button');
  b2.className = 'btn ghost';
  b2.textContent = 'تصدير Excel';
  b2.dataset.x='export';
  b2.onclick = ()=> exportProductsToExcel(me);
  host.prepend(b2);
  host.prepend(b1);
}
window.__productsExcelButtons = __productsExcelButtons;

// ===== Invoice line lookup: enter product code -> autofill =====
async function lookupProductByCode(code){
  const c = String(code||'').trim();
  if(!c) return null;
  // doc id may be code, else query
  let snap = await getDoc(doc(db,'products', c));
  if(snap.exists()) return { id: snap.id, ...snap.data() };
  const qs = await getDocs(query(collection(db,'products'), where('code','==',c), limit(1)));
  if(!qs.empty){ const s=qs.docs[0]; return { id:s.id, ...s.data() }; }
  return null;
}

function bindInvoiceLineLookup(me, formEl){
  formEl.querySelectorAll('[data-ln="code"]').forEach(inp=>{
    if(inp.__bound) return;
    inp.__bound = true;
    inp.addEventListener('change', async ()=>{
      const tr = inp.closest('tr');
      const code = inp.value;
      const prod = await lookupProductByCode(code);
      if(!prod){
        toast('رقم الصنف غير موجود');
        tr.querySelector('[data-ln="name"]').textContent = '—';
        tr.querySelector('[data-ln="unit"]').textContent = '—';
        const priceInp = tr.querySelector('[data-ln="price"]');
        if(priceInp) priceInp.value = '';
        return;
      }
      tr.querySelector('[data-ln="name"]').textContent = prod.name || '';
      tr.querySelector('[data-ln="unit"]').textContent = prod.unit || 'قطعة';
      const priceInp = tr.querySelector('[data-ln="price"]');
      if(priceInp){
        priceInp.value = Number(prod.price||0).toFixed(2);
        priceInp.disabled = !isAdmin(me); // admin only
      }
      const qtyInp = tr.querySelector('[data-ln="qty"]');
      if(qtyInp) qtyInp.focus();
      if(window.recalcTotals) window.recalcTotals();
    });
  });
}
window.bindInvoiceLineLookup = bindInvoiceLineLookup;

function bindDiscountSync(formEl){
  const p = formEl.querySelector('[name="discountPercent"]');
  const a = formEl.querySelector('[name="discountAmount"]');
  const subEl = formEl.querySelector('[data-t="subtotal"]');
  if(!p || !a || !subEl) return;
  const sync = (changed)=>{
    const sub = Number(subEl.textContent||0);
    const r = calcDiscountSync(sub, changed, p.value, a.value);
    p.value = r.percent ? String(+r.percent.toFixed(2)) : '0';
    a.value = r.amount ? String(+r.amount.toFixed(2)) : '0';
    if(window.recalcTotals) window.recalcTotals();
  };
  p.addEventListener('input', ()=>sync('percent'));
  a.addEventListener('input', ()=>sync('amount'));
}
window.bindDiscountSync = bindDiscountSync;

function renderInvoiceEditorPRO(me, state){
  const inv = state || { items:[{code:'',qty:1}], discountPercent:0, discountAmount:0, payType:'cash' };
  const rows = (inv.items||[]).map((it,idx)=>`
    <tr>
      <td><input class="in" data-ln="code" inputmode="numeric" value="${escapeAttr(it.code||'')}" placeholder="رقم"></td>
      <td><div class="celltext" data-ln="name">${escapeHtml(it.nameSnapshot||'—')}</div></td>
      <td><div class="celltext" data-ln="unit">${escapeHtml(it.unitSnapshot||'قطعة')}</div></td>
      <td><input class="in" data-ln="price" ${isAdmin(me)?'':'disabled'} value="${Number(it.priceSnapshot||0).toFixed(2)}" inputmode="decimal"></td>
      <td><input class="in" data-ln="qty" value="${Number(it.qty||1)}" inputmode="decimal"></td>
      <td><div class="celltext" data-ln="total">${fmtMoney((Number(it.qty||0)*Number(it.priceSnapshot||0))||0)}</div></td>
      <td><button type="button" class="btn ghost" data-act="delLine" data-idx="${idx}">حذف</button></td>
    </tr>
  `).join('');
  return `
  <form data-form="invoice" class="card">
    <div class="card-h">فاتورة</div>
    <div class="grid2">
      <label class="fld"><span>العميل</span><input class="in" name="customerName" value="${escapeAttr(inv.customerNameSnapshot||'')}"></label>
      <label class="fld"><span>النوع</span>
        <select class="in" name="docType">
          <option value="sale" ${inv.docType==='sale'?'selected':''}>فاتورة مبيعات</option>
          <option value="return" ${inv.docType==='return'?'selected':''}>مرتجع مبيعات</option>
        </select>
      </label>
      <label class="fld"><span>طريقة</span>
        <select class="in" name="payType">
          <option value="cash" ${inv.payType==='cash'?'selected':''}>نقدي</option>
          <option value="credit" ${inv.payType==='credit'?'selected':''}>أجل</option>
        </select>
      </label>
      <label class="fld"><span>دفعة (للأجل)</span><input class="in" name="paid" inputmode="decimal" value="${Number(inv.paid||0).toFixed(2)}"></label>
    </div>

    <div class="tablewrap">
      <table class="tbl">
        <thead><tr>
          <th>رمز</th><th>اسم المادة</th><th>الوحدة</th><th>السعر</th><th>الكمية</th><th>القيمة</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="row gap">
      <button type="button" class="btn" data-act="addLine">إضافة سطر</button>
      <div class="spacer"></div>
      <button type="submit" class="btn primary">حفظ</button>
      <button type="button" class="btn ghost" data-act="printA4">طباعة A4</button>
    </div>

    <div class="totals">
      <div class="trow"><span>المجموع</span><b data-t="subtotal">0</b></div>
      <div class="trow">
        <span>خصم %</span><input class="in sm" name="discountPercent" inputmode="decimal" value="${Number(inv.discountPercent||0)}">
        <span>خصم قيمة</span><input class="in sm" name="discountAmount" inputmode="decimal" value="${Number(inv.discountAmount||0).toFixed(2)}">
      </div>
      <div class="trow"><span>الإجمالي بعد الخصم</span><b data-t="grand">0</b></div>
      <div class="trow"><span>المتبقي</span><b data-t="remaining">0</b></div>
      <div class="muted" data-t="words"></div>
    </div>
  </form>`;
}
window.renderInvoiceEditorPRO = renderInvoiceEditorPRO;

function bindInvoiceActions(me){
  const form = document.querySelector('form[data-form="invoice"]');
  if(!form || form.__actionsBound) return;
  form.__actionsBound = true;

  form.addEventListener('input', (e)=>{
    if(e.target.matches('[data-ln="qty"],[data-ln="price"],[name="paid"]')) recalcTotals();
  });

  form.addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    const act = btn.dataset.act;
    if(act==='addLine'){
      const tb = form.querySelector('tbody');
      tb.insertAdjacentHTML('beforeend', `
        <tr>
          <td><input class="in" data-ln="code" inputmode="numeric" value="" placeholder="رقم"></td>
          <td><div class="celltext" data-ln="name">—</div></td>
          <td><div class="celltext" data-ln="unit">قطعة</div></td>
          <td><input class="in" data-ln="price" ${isAdmin(me)?'':'disabled'} value="0.00" inputmode="decimal"></td>
          <td><input class="in" data-ln="qty" value="1" inputmode="decimal"></td>
          <td><div class="celltext" data-ln="total">${fmtMoney(0)}</div></td>
          <td><button type="button" class="btn ghost" data-act="delLine">حذف</button></td>
        </tr>`);
      bindInvoiceLineLookup(me, form);
      recalcTotals();
      return;
    }
    if(act==='delLine'){
      const tr = btn.closest('tr');
      tr?.remove();
      recalcTotals();
      return;
    }
    if(act==='printA4'){
      window.print();
      return;
    }
  });

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    // Gather invoice data and save to Firestore (simple)
    const docType = form.querySelector('[name="docType"]').value;
    const customerName = form.querySelector('[name="customerName"]').value.trim();
    const payType = form.querySelector('[name="payType"]').value;
    const paid = Number(form.querySelector('[name="paid"]').value||0);
    const discountPercent = Number(form.querySelector('[name="discountPercent"]').value||0);
    const discountAmount = Number(form.querySelector('[name="discountAmount"]').value||0);

    const items = Array.from(form.querySelectorAll('tbody tr')).map(tr=>{
      const code = tr.querySelector('[data-ln="code"]').value.trim();
      const nameSnapshot = tr.querySelector('[data-ln="name"]').textContent.trim();
      const unitSnapshot = tr.querySelector('[data-ln="unit"]').textContent.trim() || 'قطعة';
      const priceSnapshot = Number(tr.querySelector('[data-ln="price"]').value||0);
      const qty = Number(tr.querySelector('[data-ln="qty"]').value||0);
      return { code, nameSnapshot, unitSnapshot, priceSnapshot, qty };
    }).filter(it=>it.code && it.qty>0);

    if(!items.length){ toast('أضف صنف واحد على الأقل'); return; }

    const subtotal = items.reduce((s,it)=>s + (it.priceSnapshot*it.qty), 0);
    const disc = calcDiscountSync(subtotal, "amount", discountPercent, discountAmount).amount;
    const grandTotal = subtotal - disc;
    const remaining = Math.max(0, grandTotal - paid);

    // invoice number counter
    const counterRef = doc(db,'counters','invoices');
    const invNo = await runTransaction(db, async (t)=>{
      const snap = await t.get(counterRef);
      const next = snap.exists() ? Number(snap.data().next||1) : 1;
      t.set(counterRef, { next: next+1 }, { merge:true });
      return next;
    });

    const payload = {
      docType,
      invoiceNo: invNo,
      customerNameSnapshot: customerName,
      payType,
      paid: +paid.toFixed(2),
      discountPercent: +discountPercent,
      discountAmount: +disc.toFixed(2),
      subtotal: +subtotal.toFixed(2),
      grandTotal: +grandTotal.toFixed(2),
      remaining: +remaining.toFixed(2),
      items,
      createdAt: serverTimestamp(),
      createdBy: { uid: me.uid, name: me.displayName||me.email||'' }
    };
    await addDoc(collection(db,'invoices'), payload);
    toast(`تم حفظ الفاتورة رقم ${invNo}`);
  });

  // initial calc
  recalcTotals();
}
window.bindInvoiceActions = bindInvoiceActions;
