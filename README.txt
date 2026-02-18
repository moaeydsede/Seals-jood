ERP PRO Lite (GitHub + Firebase)
================================

ملفات بدون مجلدات (مناسبة للرفع من الموبايل).

1) رفع على GitHub
- افتح GitHub → New repository
- ارفع الملفات كما هي (بدون مجلدات)
- من Settings → Pages
  - Source: Deploy from branch
  - Branch: main / root
  - احفظ وسيعطيك رابط GitHub Pages

2) إعداد Firebase
- أنشئ Project في Firebase
- فعّل:
  - Firestore Database
  - Storage
  - Authentication → Email/Password
- من Project Settings → Your apps → Web app
  - انسخ firebaseConfig وضعه داخل (إعداد Firebase) في التطبيق

3) جعل حسابك Admin
- بعد تسجيل الدخول، اذهب Firestore
- Collection: users
- Doc ID: UID الخاص بك
- ضع field: role = "admin"

4) الطباعة PDF A4
- افتح فاتورة → طباعة
- من نافذة الطباعة اختر "Save as PDF"

✅ النسخة بدون PWA وبدون زر إعداد Firebase.
الربط مع Firebase مدمج داخل الملفات.

بيانات دخول الأدمن:
- Admin (أو admin@erp.local)
- Admin123
