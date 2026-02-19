# Jood kids seals — نظام مبيعات (نسخة PRO بدون مجلدات)

## الملفات داخل ZIP
- index.html  ✅ (المشروع كامل في ملف واحد)
- README.md

## النشر على GitHub Pages (من الموبايل)
1) GitHub → Repository جديد
2) Upload files → ارفع `index.html` و `README.md` (بدون مجلدات)
3) Settings → Pages
4) Deploy from branch → Branch: main → Folder: /root → Save
5) افتح رابط الموقع

## إعداد Firebase (مرة واحدة)
### 1) Authentication
Firebase Console → Authentication → Sign-in method → Email/Password → Enable  
ثم أنشئ مستخدم للأدمن (Email/Password)

### 2) Firestore
Firestore Database → Create database  
Collections المستخدمة:
- users
- customers
- products
- invoices
- payments
- auditLogs
- counters (document: invoices)

### 3) Storage
Storage → Get started (لرفع اللوجو)

## إنشاء الأدمن (مهم جداً)
بعد إنشاء الأدمن في Authentication انسخ UID ثم:
Firestore → Collection `users` → Document ID = UID
ضع البيانات:
```json
{
  "displayName": "Admin",
  "role": "admin",
  "active": true,
  "permissions": {}
}
```

> الأدمن يمتلك كل الصلاحيات تلقائياً.

## مميزات النسخة PRO
- لا يوجد مخزون ✅
- بدون ضرائب ✅
- خصم على الصنف + خصم على الفاتورة ✅
- نوع الفاتورة: نقدي/أجل + دفعة جزئية للأجل ✅
- دفعة على الحساب + ربط دفعة بفاتورة ✅
- طباعة فاتورة A4 + حراري ✅
- سند قبض A4 + حراري ✅
- زر بيانات الشركة + رفع/حذف لوجو ✅
- صلاحيات احترافية + شاشة المستخدمين ✅
- سجل عمليات Audit Log بالتاريخ والوقت ✅
- حذف (للأدمن) ✅

Version: 2026.02.19-PRO
