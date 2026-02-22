# MATGR MO - PRO+++

ملفات جاهزة للرفع على GitHub Pages.

## الدخول
admin@erp.local / Admin123

> ملاحظة مهمة جدًا:
> - لا تفتح النظام مباشرة من ملف على الهاتف (file://) لأن Firebase لن يعمل.
> - يجب تشغيله عبر **https** (GitHub Pages) أو عبر سيرفر محلي (http://localhost).

## إذا زر الدخول لا يعمل
عادةً السبب يكون أحد التالي:
1) **auth/unauthorized-domain**: أضف دومين GitHub Pages في Firebase:
   Firebase Console → Authentication → Settings → Authorized domains
2) **auth/operation-not-allowed**: فعّل Email/Password من:
   Firebase Console → Authentication → Sign-in method
3) **auth/network-request-failed**: مشكلة اتصال بالإنترنت.

## أهم ما تم إضافته
- إضافة موردين + سند قبض/دفع + قيد افتتاحي متعدد البنود
- تقارير مالية منفصلة (كل تقرير شاشة)
- صفحات الفواتير مع زر إضافة لفتح POS بنفس النوع
- Excel (استيراد/تصدير) + PDF
- طباعة الفواتير بأكثر من صيغة: PDF A4 + PDF حراري 80mm + طباعة مباشرة + تصدير PNG
- COGS يعتمد على سعر الشراء في بطاقة الصنف (purchasePrice)


## المستخدمون والصلاحيات
- من داخل البرنامج: **المستخدمون والصلاحيات** (للأدمن).
- إنشاء المستخدم يتم عبر Auth ثانوي (لا يخرج الأدمن).
- تعطيل المستخدم يتم داخل النظام.

## الإقفال السنوي والتدوير
- زر **إقفال سنة** يقوم بقفل الفترة حتى 31/12 وإنشاء **قيد افتتاحي تلقائي** للسنة الجديدة (حسابات 1/2/3 فقط).
