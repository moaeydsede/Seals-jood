# Jood kids seals — نظام المبيعات (نسخة PRO بدون مجلدات)

هذه نسخة **مستقرة** بملفات منفصلة (أفضل من ملف واحد ضخم)، وجميع الملفات موجودة في **جذر الريبو** بدون أي مجلدات.

## ملفات المشروع داخل ZIP
- index.html
- style.css
- favicon.svg
- app.js
- auth.js
- audit.js
- firebase.js
- permissions.js
- utils.js
- views.js
- README.md

## نشر المشروع على GitHub Pages (من الموبايل)
1) GitHub → Repository جديد  
2) Upload files → ارفع **كل الملفات** (بدون مجلدات)  
3) Settings → Pages  
4) Deploy from branch → Branch: `main` → Folder: `/ (root)` → Save  
5) افتح رابط الموقع

## Firebase (مختصر)
- Authentication → Email/Password → Enable → أنشئ أدمن
- Firestore Database → أنشئ قاعدة
- Storage → Get started (لرفع اللوجو)

## إنشاء الأدمن في Firestore
Collection: `users`  
Document ID = **UID** تبع الأدمن  
Fields:
- role: "admin"
- displayName: "Admin"
- active: true

> الأدمن يمتلك كل الصلاحيات تلقائياً.

Version: PRO_FLAT_2026-02-19
