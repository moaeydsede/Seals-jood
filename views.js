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
    <div class="muted">ادخل البريد وكلمة المرور</div>
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
        <div class="muted"></div>
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
  const isAdmin = me.role === 'admin';
  const canEdit = isAdmin; // التعديل للأدمن فقط
  const isNew = !model?.id;

  const items = (model?.items || []).map(it=>({
    code: (it.code || it.codeSnapshot || it.productCode || '').toString(),
    nameSnapshot: it.nameSnapshot || '',
    unitSnapshot: it.unitSnapshot || 'قطعة',
    qty: Number(it.qty||0) || 1,
    priceSnapshot: Number(it.priceSnapshot||0) || 0,
    discountTypeItem: it.discountTypeItem || 'amount',
    discountValueItem: Number(it.discountValueItem||0) || 0
  }));

  const payType = model?.payType || 'cash';
  const dateISO = new Date(model?.date?.toDate?model.date.toDate():model?.date||Date.now()).toISOString().slice(0,10);
  const discountPercent = Number(model?.discountPercent ?? 0) || 0;
  const discountAmount = Number(model?.discountAmount ?? 0) || 0;
  const paid = Number(model?.paid ?? 0) || 0;

  return `<div class="card pad">
    <div class="row">
      <div>
        <div class="h1">${docType==='sale'?'فاتورة مبيعات':'مرتجع مبيعات'}</div>
      </div>
      <div class="spacer"></div>
      <a class="btn ghost small no-print" href="#/${docType==='sale'?'invoices':'returns'}">رجوع</a>
      ${!isNew ? `<span class="badge ${model.locked?'ok':'warn'}">${model.locked?'مقفلة':'غير مقفلة'}</span>`:''}
    </div>

    <div class="hr"></div>

    <form id="formInv" class="grid cols2">
      <div class="field">
        <div class="label">التاريخ</div>
        <input class="input" name="date" type="date" value="${escapeHtml(dateISO)}" ${(!isNew && !canEdit)?'disabled':''}/>
      </div>

      <div class="field">
        <div class="label">نوع الفاتورة</div>
        <select name="payType" ${(!isNew && !canEdit)?'disabled':''}>
          <option value="cash" ${payType==='cash'?'selected':''}>نقدي</option>
          <option value="credit" ${payType==='credit'?'selected':''}>أجل</option>
        </select>
      </div>

      <div class="field" style="grid-column:1/-1">
        <div class="label">العميل</div>
        <select name="customerId" ${(!isNew && !canEdit)?'disabled':''}>${customersOptions}</select>
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
                <th style="min-width:90px">رمز</th>
                <th>اسم المادة</th>
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
      </div>

      <div class="card pad" style="grid-column:1/-1;">
        <div class="row" style="align-items:flex-end">
          <div class="field" style="flex:1">
            <div class="label">خصم %</div>
            <input class="input" name="discountPercent" type="number" step="0.01" value="${escapeHtml(discountPercent)}" ${(!isNew && !canEdit)?'disabled':''}/>
          </div>
          <div class="field" style="flex:1">
            <div class="label">خصم قيمة</div>
            <input class="input" name="discountAmount" type="number" step="0.01" value="${escapeHtml(discountAmount)}" ${(!isNew && !canEdit)?'disabled':''}/>
          </div>
          <div class="field" style="flex:1">
            <div class="label">دفعة</div>
            <input class="input" name="paid" type="number" step="0.01" value="${escapeHtml(paid)}" ${(!isNew && !canEdit)?'disabled':''}/>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid cols2">
          <div class="field"><div class="label">المجموع قبل الخصم</div><div class="h2 num" id="bSubtotal">0</div></div>
          <div class="field"><div class="label">الإجمالي بعد الخصم</div><div class="h2 num" id="bGrand">0</div></div>
          <div class="field"><div class="label">المتبقي</div><div class="h2 num" id="bRemaining">0</div></div>
          <div class="field"><div class="label">كتابة المبلغ</div><div class="muted" id="moneyWords">—</div></div>
        </div>

        <div class="hr"></div>

        <div class="row no-print">
          <button class="btn primary" type="submit">${isNew?'حفظ':'تحديث'}</button>
          <div class="spacer"></div>
          ${(!isNew) ? `<button class="btn ghost no-print" type="button" id="btnPrintA4">طباعة A4</button>
                       <button class="btn ghost no-print" type="button" id="btnPrintTh">طباعة حراري</button>` : ''}
          ${(!isNew && me.role==='admin') ? `<button class="btn danger no-print" type="button" id="btnDelete">حذف</button>`:''}
        </div>
      </div>

      <input type="hidden" name="_seedItems" value="${escapeAttr(JSON.stringify(items))}"/>
    </form>
  </div>`;
}

function buildLineEditorRow(idx, item, products, disabled){
  const isAdmin = !disabled; // disabled here means not editable for non-admin existing invoice
  const canEditPrice = (window.__meRole === 'admin'); // set in bind
  const code = (item.code||'').toString();
  const name = item.nameSnapshot || '—';
  const qty = Number(item.qty ?? 1);
  const price = Number(item.priceSnapshot ?? 0);
  const discType = item.discountTypeItem ?? 'amount';
  const discVal = Number(item.discountValueItem ?? 0);

  return `<tr data-idx="${idx}">
    <td class="num"><input class="input" style="padding:8px" inputmode="numeric" data-f="code" value="${escapeHtml(code)}" ${disabled?'disabled':''} placeholder="رقم"></td>
    <td><div class="muted" data-calc="name">${escapeHtml(name)}</div></td>
    <td class="num"><input class="input" style="padding:8px" type="number" min="0" step="1" data-f="qty" value="${escapeHtml(qty)}" ${disabled?'disabled':''}></td>
    <td>قطعة</td>
    <td class="num"><input class="input" style="padding:8px" type="number" step="0.01" data-f="priceSnapshot" value="${escapeHtml(price)}" ${(disabled || !canEditPrice)?'disabled':''}></td>
    <td class="num">
      <div class="row" style="justify-content:flex-start">
        <select data-f="discountTypeItem" style="max-width:96px" ${disabled?'disabled':''}>
          <option value="amount" ${discType==='amount'?'selected':''}>مبلغ</option>
          <option value="percent" ${discType==='percent'?'selected':''}>٪</option>
        </select>
        <input class="input" style="padding:8px;max-width:140px" type="number" step="0.01" data-f="discountValueItem" value="${escapeHtml(discVal)}" ${disabled?'disabled':''}>
      </div>
    </td>
    <td class="num" data-calc="total">0</td>
    <td class="actions no-print">
      <button class="btn ghost small" type="button" data-act="del" ${disabled?'disabled':''}>حذف</button>
    </td>
  </tr>`;
}

function computeInvoiceFromForm(form, products){
  const data = new FormData(form);
  const dateStr = data.get('date');
  const date = Timestamp.fromDate(new Date(dateStr+'T12:00:00'));
  const payType = (data.get('payType') || 'cash').toString();
  const customerId = (data.get('customerId') || '').toString();
  const discountPercent = Number(data.get('discountPercent')||0);
  const discountAmountRaw = Number(data.get('discountAmount')||0);
  const paid = Number(data.get('paid')||0);

  const rows = Array.from(document.querySelectorAll('#tblLines tbody tr'));
  const items = rows.map(r=>{
    const get = (f)=> r.querySelector(`[data-f="${f}"]`)?.value;
    const code = (get('code')||'').toString().trim();
    const qty = Number(get('qty')||0);
    const priceSnapshot = Number(get('priceSnapshot')||0);
    const discountTypeItem = (get('discountTypeItem')||'amount').toString();
    const discountValueItem = Number(get('discountValueItem')||0);
    const nameSnapshot = (r.querySelector('[data-calc="name"]')?.textContent||'').toString().trim();
    const unitSnapshot = 'قطعة';
    return { code, nameSnapshot, unitSnapshot, qty, priceSnapshot, discountTypeItem, discountValueItem };
  }).filter(it=>it.code && it.qty>0);

  // totals
  let subtotal=0, discItems=0, afterItems=0;
  items.forEach(it=>{
    const {gross,disc,net} = calcLine(Number(it.qty||0), Number(it.priceSnapshot||0), it.discountTypeItem, Number(it.discountValueItem||0));
    subtotal += gross; discItems += disc; afterItems += net;
  });

  // invoice discount: sync percent/amount based on subtotal after item discounts
  const synced = calcDiscountSync(afterItems, 'amount', discountPercent, discountAmountRaw);
  const discountAmount = clamp(synced.amount, 0, afterItems);
  const grandTotal = clamp(afterItems - discountAmount, 0, 1e18);
  const remaining = clamp(grandTotal - paid, 0, 1e18);

  return {
    date, payType, customerId,
    items,
    subtotal: +subtotal.toFixed(2),
    discountItems: +discItems.toFixed(2),
    afterItems: +afterItems.toFixed(2),
    discountPercent: +synced.percent.toFixed(2),
    discountAmount: +discountAmount.toFixed(2),
    grandTotal: +grandTotal.toFixed(2),
    paid: +paid.toFixed(2),
    remaining: +remaining.toFixed(2)
  };
}

function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }

function calcDiscountSync(base, mode, percent, amount){
  // mode unused; keep both synced
  base = Number(base||0);
  percent = Number(percent||0);
  amount = Number(amount||0);
  // if percent was edited more recently, UI will pass amount already; we still normalize both
  if(!isFinite(base) || base<=0) return {percent:0, amount:0};
  // prefer amount if it's non-zero and percent is zero; otherwise prefer percent
  const useAmount = (amount>0 && (percent===0 || !isFinite(percent)));
  let a = useAmount ? amount : (base*(percent/100));
  a = clamp(a,0,base);
  let p = (base===0)?0:(a/base*100);
  p = clamp(p,0,100);
  return {percent:p, amount:a};
}

function renderInvoicePrint(company, inv, kind='a4'){
  const phones = (company.phones||[]).filter(Boolean);
  const phoneLine = phones.join('  ');
  const logoUrl = company.logoUrl || '';
  const wa = company.whatsapp || '';
  const tg = company.telegram || '';
  const fb = company.facebook || '';

  const title = inv.docType==='return' ? 'مرتجع مبيعات' : 'فاتورة : مبيعات';
  const invoiceNo = inv.invoiceNo ?? '';
  const dateStr = fmtDate(inv.date?.toDate?inv.date.toDate():inv.date);

  const items = (inv.items||[]).map(it=>{
    const code = (it.code||it.codeSnapshot||'').toString();
    const name = (it.nameSnapshot||'').toString();
    const unit = (it.unitSnapshot||'قطعة').toString();
    const qty = Number(it.qty||0);
    const price = Number(it.priceSnapshot||0);
    const {gross, disc, net} = calcLine(qty, price, it.discountTypeItem||'amount', Number(it.discountValueItem||0));
    return {code,name,unit,qty,price,value:net};
  });

  const grossSum = items.reduce((a,x)=>a+(x.qty*x.price),0);
  const afterItems = Number(inv.afterItems ?? items.reduce((a,x)=>a+x.value,0));
  const discItems = Math.max(0, grossSum - afterItems);
  const discInv = Number(inv.discountAmount||0);
  const totalDiscount = discItems + discInv;
  const grand = Number(inv.grandTotal||0);
  const paid = Number(inv.paid||0);
  const remaining = Number(inv.remaining||Math.max(0, grand-paid));

  const moneyWords = amountToArabicWordsEGP(grand);

  const rowsHtml = items.map(x=>`
    <tr>
      <td class="code">${escapeHtml(x.code)}</td>
      <td class="name">${escapeHtml(x.name)}</td>
      <td class="num">${escapeHtml(x.qty.toFixed(0))}</td>
      <td>${escapeHtml(x.unit)}</td>
      <td class="num">${escapeHtml(fmtMoney(x.price))}</td>
      <td class="num">${escapeHtml(fmtMoney(x.value))}</td>
    </tr>
  `).join('');

  const contactIcons = `
    <div class="icons">
      ${wa?`<span class="chip">WhatsApp</span>`:''}
      ${tg?`<span class="chip">Telegram</span>`:''}
      ${fb?`<span class="chip">Facebook</span>`:''}
    </div>
  `;

  const a4 = `
  <html lang="ar" dir="rtl"><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${title} #${invoiceNo}</title>
    <style>
      @page{ size:A4; margin:12mm; }
      body{ font-family: Tahoma, Arial, sans-serif; color:#111; }
      .top{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .logo{ width:170px; height:70px; object-fit:contain; }
      .contact{ text-align:left; flex:1; }
      .contact h3{ margin:0; font-size:20px; letter-spacing:.3px; }
      .contact .phone{ margin-top:6px; font-size:14px; }
      .icons{ margin-top:6px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
      .chip{ border:1px solid #cfd6df; padding:3px 8px; border-radius:999px; font-size:12px; }
      h2{ text-align:center; margin:12px 0 6px; font-size:18px; }
      .meta{ display:flex; justify-content:space-between; margin:10px 0; font-size:14px; }
      .meta .box{ min-width:260px; }
      .meta b{ display:inline-block; min-width:110px; }
      table{ width:100%; border-collapse:collapse; font-size:13px; }
      th,td{ border:1px solid #9aa7b3; padding:8px 6px; vertical-align:top; }
      th{ background:#e9f0f3; font-weight:700; }
      td.num, th.num{ text-align:center; white-space:nowrap; }
      td.code{ text-align:center; width:72px; }
      .totalsWrap{ margin-top:12px; display:flex; justify-content:space-between; gap:16px; }
      .totals{ width:320px; border:1px solid #9aa7b3; }
      .totals .row{ display:flex; justify-content:space-between; border-bottom:1px solid #9aa7b3; }
      .totals .row:last-child{ border-bottom:none; }
      .totals .k{ padding:8px 10px; background:#e9f0f3; width:55%; font-weight:700; }
      .totals .v{ padding:8px 10px; width:45%; text-align:center; font-weight:800; }
      .words{ flex:1; display:flex; align-items:flex-end; font-size:14px; }
      .words b{ font-weight:800; }
      .balances{ margin-top:12px; display:flex; justify-content:space-between; font-size:14px; }
      .muted{ color:#444; }
      .printBtn{ display:none; }
      @media print{ .printBtn{ display:none } }
    </style>
  </head><body>
    <div class="top">
      <div>${logoUrl?`<img class="logo" src="${escapeHtml(logoUrl)}" />`:''}</div>
      <div class="contact">
        <h3>Contact Sales</h3>
        <div class="phone">${escapeHtml(phoneLine||'')}</div>
        ${contactIcons}
      </div>
    </div>

    <h2>${title}</h2>

    <div class="meta">
      <div class="box">
        <div><b>رقم الفاتورة:</b> ${escapeHtml(invoiceNo)}</div>
        <div><b>التاريخ:</b> ${escapeHtml(dateStr)}</div>
      </div>
      <div class="box" style="text-align:right">
        <div><b>السيد:</b> ${escapeHtml(inv.customerNameSnapshot||'—')}</div>
        <div><b>البيان:</b> ${escapeHtml(inv.payType==='credit'?'أجل':'نقدي')}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>رمز المادة</th>
          <th>اسم المادة</th>
          <th class="num">الكمية</th>
          <th>الوحدة</th>
          <th class="num">السعر</th>
          <th class="num">القيمة</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="totalsWrap">
      <div class="words"><div><b>${escapeHtml(moneyWords)}</b></div></div>
      <div class="totals">
        <div class="row"><div class="k">المجموع</div><div class="v">${escapeHtml(fmtMoney(grossSum))}</div></div>
        <div class="row"><div class="k">إجمالي الحسميات</div><div class="v">${escapeHtml(fmtMoney(totalDiscount))}</div></div>
        <div class="row"><div class="k">المجموع النهائي</div><div class="v">${escapeHtml(fmtMoney(grand))}</div></div>
      </div>
    </div>

    <div class="balances">
      <div><span class="muted">دفعة:</span> <b>${escapeHtml(fmtMoney(paid))}</b></div>
      <div><span class="muted">المتبقي:</span> <b>${escapeHtml(fmtMoney(remaining))}</b></div>
    </div>

    <script>window.onload=()=>{ setTimeout(()=>window.print(),200); };</script>
  </body></html>`;

  // thermal simplified
  const th = `
  <html lang="ar" dir="rtl"><head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${title}</title>
    <style>
      body{ font-family: Tahoma, Arial; width: 80mm; margin:0; padding:6mm; }
      h2,h3{ margin:0; text-align:center; }
      .muted{ font-size:12px; text-align:center; }
      table{ width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
      th,td{ border-bottom:1px dashed #999; padding:4px 0; }
      td.num{ text-align:left; white-space:nowrap; }
      .sum{ margin-top:8px; font-size:12px; }
      .sum div{ display:flex; justify-content:space-between; }
    </style>
  </head><body>
    <h3>${escapeHtml(company.name||'')}</h3>
    <div class="muted">${escapeHtml(phoneLine||'')}</div>
    <div class="muted">${escapeHtml(title)} #${escapeHtml(invoiceNo)} — ${escapeHtml(dateStr)}</div>
    <table>
      <thead><tr><th>صنف</th><th class="num">قيمة</th></tr></thead>
      <tbody>
        ${items.map(x=>`<tr><td>${escapeHtml(x.code)} ${escapeHtml(x.name)}</td><td class="num">${escapeHtml(fmtMoney(x.value))}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="sum">
      <div><span>الإجمالي</span><b>${escapeHtml(fmtMoney(grand))}</b></div>
      <div><span>المتبقي</span><b>${escapeHtml(fmtMoney(remaining))}</b></div>
    </div>
    <script>window.onload=()=>{ setTimeout(()=>window.print(),200); };</script>
  </body></html>`;

  return kind==='th' ? th : a4;
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
  const form = document.getElementById('formInv');
  if(!form) return;

  window.__meRole = me.role;

  // set selected customer
  if(id==='new'){
    form.customerId.value = '';
  }else{
    const snap = await getDoc(doc(db,'invoices', id));
    if(snap.exists()){
      const inv = snap.data();
      form.customerId.value = inv.customerId || '';
      // seed discount fields
      form.discountPercent.value = Number(inv.discountPercent||0);
      form.discountAmount.value = Number(inv.discountAmount||0);
      form.paid.value = Number(inv.paid||0);
    }
  }

  const products = await listProductsOptions(); // [{id,code,name,price}]
  const byCode = new Map(products.map(p=>[String(p.code||'').trim(), p]));

  const tbody = document.querySelector('#tblLines tbody');

  // load state
  let state = {items:[]};
  if(id!=='new'){
    const snap = await getDoc(doc(db,'invoices', id));
    if(snap.exists()){
      const inv = snap.data();
      state.items = (inv.items||[]).map(it=>({
        code: (it.code||it.codeSnapshot||'').toString(),
        nameSnapshot: it.nameSnapshot || '',
        unitSnapshot: it.unitSnapshot || 'قطعة',
        qty: Number(it.qty||0) || 1,
        priceSnapshot: Number(it.priceSnapshot||0) || 0,
        discountTypeItem: it.discountTypeItem || 'amount',
        discountValueItem: Number(it.discountValueItem||0) || 0
      }));
    }
  }else{
    try{
      const seed = JSON.parse(form.querySelector('[name="_seedItems"]')?.value||'[]');
      state.items = (seed||[]);
    }catch{ state.items=[]; }
  }

  const isAdmin = me.role==='admin';
  const disabled = (id!=='new' && !isAdmin); // edits only admin for existing

  if(state.items.length===0) state.items.push({code:'',nameSnapshot:'',unitSnapshot:'قطعة',qty:1,priceSnapshot:0,discountTypeItem:'amount',discountValueItem:0});

  let lastDiscEdited = 'percent'; // 'percent'|'amount'

  function applyCode(idx, code){
    code = String(code||'').trim();
    const p = byCode.get(code);
    if(p){
      state.items[idx].code = code;
      state.items[idx].nameSnapshot = p.name || '';
      // price from price list unless admin has typed something else
      if(!(isAdmin && Number(state.items[idx].priceSnapshot||0)>0)){
        state.items[idx].priceSnapshot = Number(p.price||0);
      }
    }else{
      state.items[idx].code = code;
      if(!code) state.items[idx].nameSnapshot = '';
    }
  }

  function rerenderLines(){
    tbody.innerHTML = state.items.map((it,idx)=>buildLineEditorRow(idx, it, products, disabled)).join('');

    // delete buttons
    tbody.querySelectorAll('button[data-act="del"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const tr = btn.closest('tr');
        const idx = Number(tr.getAttribute('data-idx'));
        state.items.splice(idx,1);
        if(state.items.length===0) state.items.push({code:'',nameSnapshot:'',unitSnapshot:'قطعة',qty:1,priceSnapshot:0,discountTypeItem:'amount',discountValueItem:0});
        rerenderLines();
        recalcTotals();
      });
    });

    // bind inputs
    tbody.querySelectorAll('input,select').forEach(el=>{
      el.addEventListener('input', ()=>{
        const tr = el.closest('tr');
        const idx = Number(tr.getAttribute('data-idx'));
        const f = el.getAttribute('data-f');
        state.items[idx][f] = el.value;

        if(f==='code'){
          applyCode(idx, el.value);
          // update name cell immediately
          const nameEl = tr.querySelector('[data-calc="name"]');
          if(nameEl) nameEl.textContent = state.items[idx].nameSnapshot || '—';
          // if product found set price input
          const priceEl = tr.querySelector('[data-f="priceSnapshot"]');
          if(priceEl && (!priceEl.disabled)) priceEl.value = Number(state.items[idx].priceSnapshot||0);
        }
        recalcTotals();
      });
    });

    // initial apply code for existing lines
    Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{
      const idx = Number(tr.getAttribute('data-idx'));
      const codeEl = tr.querySelector('[data-f="code"]');
      if(codeEl) applyCode(idx, codeEl.value);
      const nameEl = tr.querySelector('[data-calc="name"]');
      if(nameEl) nameEl.textContent = state.items[idx].nameSnapshot || '—';
    });

    recalcTotals();
  }

  function recalcTotals(){
    // compute totals per line and invoice
    let subtotal=0, afterItems=0;
    Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{
      const idx = Number(tr.getAttribute('data-idx'));
      const item = state.items[idx];
      const qty = Number(tr.querySelector('[data-f="qty"]')?.value||0);
      const price = Number(tr.querySelector('[data-f="priceSnapshot"]')?.value||0);
      const discType = tr.querySelector('[data-f="discountTypeItem"]')?.value || 'amount';
      const discVal = Number(tr.querySelector('[data-f="discountValueItem"]')?.value||0);
      const {gross, net} = calcLine(qty, price, discType, discVal);
      subtotal += gross;
      afterItems += net;
      tr.querySelector('[data-calc="total"]').textContent = fmtMoney(net);
      // persist normalized values
      item.qty = qty;
      item.priceSnapshot = price;
      item.discountTypeItem = discType;
      item.discountValueItem = discVal;
    });

    // sync invoice discount
    const pIn = Number(form.discountPercent.value||0);
    const aIn = Number(form.discountAmount.value||0);
    const synced = calcDiscountSync(afterItems, 'amount', pIn, aIn);
    if(lastDiscEdited==='percent'){
      form.discountAmount.value = synced.amount.toFixed(2);
    }else{
      form.discountPercent.value = synced.percent.toFixed(2);
    }
    const discAmt = clamp(synced.amount,0,afterItems);
    const grand = clamp(afterItems - discAmt,0,1e18);
    const paid = Number(form.paid.value||0);
    const remaining = clamp(grand - paid,0,1e18);

    document.getElementById('bSubtotal').textContent = fmtMoney(afterItems + discAmt); // قبل خصم الفاتورة
    document.getElementById('bGrand').textContent = fmtMoney(grand);
    document.getElementById('bRemaining').textContent = fmtMoney(remaining);
    document.getElementById('moneyWords').textContent = amountToArabicWordsEGP(grand);
  }

  // add line
  document.getElementById('btnAddLine')?.addEventListener('click', ()=>{
    state.items.push({code:'',nameSnapshot:'',unitSnapshot:'قطعة',qty:1,priceSnapshot:0,discountTypeItem:'amount',discountValueItem:0});
    rerenderLines();
  });

  // discount edit tracking
  form.discountPercent?.addEventListener('input', ()=>{ lastDiscEdited='percent'; recalcTotals(); });
  form.discountAmount?.addEventListener('input', ()=>{ lastDiscEdited='amount'; recalcTotals(); });
  form.paid?.addEventListener('input', ()=>recalcTotals());

  rerenderLines();

  // submit
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(id!=='new' && me.role!=='admin'){ toast('التعديل للأدمن فقط'); return; }

    // customer snapshot
    const customerId = form.customerId.value || '';
    let customerNameSnapshot = '—';
    if(customerId){
      const cs = await getDoc(doc(db,'customers', customerId));
      if(cs.exists()) customerNameSnapshot = cs.data().name || '—';
    }

    const computed = computeInvoiceFromForm(form, products);
    computed.docType = (mode==='sale'?'sale':'return');
    computed.customerNameSnapshot = customerNameSnapshot;

    // attach items with name snapshot finalized from code lookup
    computed.items = state.items
      .map(it=>({ ...it, code:String(it.code||'').trim(), nameSnapshot: it.nameSnapshot||'—', unitSnapshot:'قطعة', qty:Number(it.qty||0), priceSnapshot:Number(it.priceSnapshot||0) }))
      .filter(it=>it.code && it.qty>0);

    if(computed.items.length===0){ toast('أضف بنوداً صحيحة'); return; }

    if(id==='new'){
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
        updatedAt: serverTimestamp(),
        updatedByUid: me.uid,
        updatedByName: me.displayName || me.email || 'user'
      });
      await logAudit(me, 'UPDATE_INVOICE', {docType:computed.docType, invoiceId:id, invoiceNo:computed.invoiceNo});
      toast('تم التحديث');
    }
  });

  // print + delete for existing
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

      <div class="card pad" style="grid-column:1/-1; background:rgba(255,255,255,.03);">
        <div class="row">
          <div>
            <div class="h2">اللوجو</div>
            <div class="muted">رفع صورة شعار (PNG/JPG). سيتم حفظها تلقائياً</div>
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
    <div class="hr"></div>
    <div class="card pad" style="background:rgba(255,255,255,.03);">
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
