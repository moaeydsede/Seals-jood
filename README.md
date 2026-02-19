# Jood kids seals — نظام مبيعات (بدون مجلدات)

## رفع المشروع (GitHub Pages)
1) Repository جديد
2) Upload files → ارفع `index.html` و `README.md`
3) Settings → Pages → Deploy from branch
4) Branch: main — Folder: /root → Save

## Firebase
- Auth: Email/Password (Enable)
- Firestore + Storage (Enable)

## إنشاء الأدمن
Firestore → users → Document ID = UID
```json
{
  "displayName": "Admin",
  "role": "admin",
  "active": true,
  "permissions": {}
}
```

نسخة: 2026.02.19-FULL
