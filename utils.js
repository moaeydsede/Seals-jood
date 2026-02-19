export function fmtMoney(n){
  const v = Number(n||0);
  return v.toLocaleString('ar-EG', {minimumFractionDigits:2, maximumFractionDigits:2});
}
export function fmtDate(ts){
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts||Date.now()));
  return d.toLocaleDateString('ar-EG');
}
export function fmtDateTime(ts){
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts||Date.now()));
  return d.toLocaleString('ar-EG');
}
export function uid(){
  return Math.random().toString(16).slice(2)+Date.now().toString(16);
}
export function toast(msg, kind=''){
  const el = document.getElementById('toast');
  if(!el) return;
  el.classList.add('show');
  el.textContent = msg;
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=> el.classList.remove('show'), 2600);
}
export function escapeHtml(s=''){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}
export function clamp(n,min,max){ return Math.min(max, Math.max(min,n)); }

export function parseDiscount(value, type){
  const v = Number(value||0);
  if(type === 'percent') return clamp(v,0,100);
  return Math.max(0,v);
}

export function calcLine(qty, price, discType, discVal){
  qty = Number(qty||0); price = Number(price||0);
  const gross = qty * price;
  let disc = 0;
  if(discType === 'percent') disc = gross * (Number(discVal||0)/100);
  else disc = Number(discVal||0);
  disc = clamp(disc,0,gross);
  const net = gross - disc;
  return {gross, disc, net};
}

export function amountToArabicWordsEGP(amount){
  // Lightweight Arabic words (approx). Not a full linguistic engine.
  // Good enough for invoices.
  const num = Number(amount||0);
  const pounds = Math.floor(num);
  const piasters = Math.round((num - pounds)*100);

  function toWords(n){
    const ones = ['صفر','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة'];
    const tens = ['','عشرة','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
    const teens = ['عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
    const hundreds = ['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];

    if(n < 10) return ones[n];
    if(n < 20) return teens[n-10];
    if(n < 100){
      const o = n % 10, t = Math.floor(n/10);
      return o ? `${ones[o]} و ${tens[t]}` : tens[t];
    }
    if(n < 1000){
      const r = n % 100, h = Math.floor(n/100);
      return r ? `${hundreds[h]} و ${toWords(r)}` : hundreds[h];
    }
    if(n < 1_000_000){
      const r = n % 1000, th = Math.floor(n/1000);
      const thWord = th===1 ? 'ألف' : (th===2 ? 'ألفان' : `${toWords(th)} ألف`);
      return r ? `${thWord} و ${toWords(r)}` : thWord;
    }
    const r = n % 1_000_000, m = Math.floor(n/1_000_000);
    const mWord = m===1 ? 'مليون' : (m===2 ? 'مليونان' : `${toWords(m)} مليون`);
    return r ? `${mWord} و ${toWords(r)}` : mWord;
  }

  const p = toWords(pounds);
  const pi = piasters ? toWords(piasters) : 'صفر';
  return `${p} جنيه مصري و ${pi} قرش فقط لا غير`;
}

// ===== Discount helpers (percent <-> amount) =====
function clampNumber(x, min=0, max=1e18){
  x = Number(x);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/**
 * Sync discount fields:
 * - If user edits percent -> compute amount
 * - If user edits amount -> compute percent
 * Returns { percent, amount }
 */
function calcDiscountSync(subtotal, changed, percentVal, amountVal){
  const sub = clampNumber(subtotal, 0);
  let p = clampNumber(percentVal, 0, 100);
  let a = clampNumber(amountVal, 0, sub);
  if (sub <= 0) return { percent: 0, amount: 0 };
  if (changed === "percent"){
    a = clampNumber((sub * p) / 100, 0, sub);
  } else if (changed === "amount"){
    p = clampNumber((a / sub) * 100, 0, 100);
  }
  return { percent: +p.toFixed(4), amount: +a.toFixed(2) };
}

window.calcDiscountSync = calcDiscountSync;
