# الأمين 9 — POS + محاسبة (Firebase + GitHub Pages)

## 1) تفعيل Firebase
- Authentication: Email/Password
- Firestore Database

### Authorized Domains
أضف دومين GitHub Pages:
- USERNAME.github.io

### Firestore Rules (مبدئي للتشغيل)
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /companies/{companyId}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 2) رفع على GitHub
ارفع الملفات (index.html + styles.css + firebase.js + app.js + README.md) ثم فعّل GitHub Pages.

## 3) ملاحظات مهمة
- اللوجو يتم رفعه من داخل النظام (بيانات الشركة) ويتم حفظه داخل Firestore كـ DataURL (بدون Storage).
- طباعة الفاتورة: تحميل صورة PNG أو طباعة PDF عبر html2canvas.
- منع البيع عند نفاد الكمية: مفعل.
- زر (إقفال سنة وتدوير أرصدة): ينشئ سند OPEN-YYYY ويقفل السنة (lockedUntilDate) مع السماح للأدمن بالتجاوز.

## 4) تسجيل الأدمن
أول حساب يسجل دخول للنظام سيتم تعيينه Admin تلقائياً داخل:
companies/main/users/{uid}
