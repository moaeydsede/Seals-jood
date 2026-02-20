# MATGR MO - الأمين 9 (ويب)

نظام POS + محاسبة (بدون ضرائب) يعمل على GitHub Pages + Firebase (Firestore/Auth).

## الدخول الافتراضي
- Email: admin@erp.local
- Password: Admin123

## أهم المزايا
- POS: بيع / مرتجع مبيعات / مشتريات / مرتجع مشتريات
- فواتير بعدد بنود غير محدود
- فصل التقارير المالية عن المخزنية
- Excel: استيراد/تصدير (مواد/عملاء) + تصدير تقارير
- طباعة PDF + حفظ صورة للفاتورة
- دليل حسابات شجري + إدارة من داخل البرنامج
- Audit Log
- إقفال سنة + تدوير أرصدة (قيد افتتاحي للسنة الجديدة + قفل الفترة)

## GitHub Pages
1) ارفع الملفات.
2) Settings → Pages → Deploy from branch → main /(root).
3) Firebase → Authentication → Authorized domains أضف: USERNAME.github.io

## ملاحظة
الشعار يُحفظ داخل Firestore كـ DataURL ولا يحتاج Storage.
