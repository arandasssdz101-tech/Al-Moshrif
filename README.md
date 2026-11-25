# الإشراف التربوي (School Admin)

تطبيق إدارة المدرسة والإشراف التربوي والمطعم والمكتبة يعمل دون إنترنت على المتصفح وأجهزة أندرويد (Android 7.0 – Android 16).

## بناء ملفات APK تلقائياً عبر GitHub

تم إعداد مسار **GitHub Actions** (`.github/workflows/android.yml`) ليقوم عند كل دفع إلى `main` أو `master` (أو يدوياً من تبويب **Actions ← Build Android APK ← Run workflow**) ببناء ونشر الحزم التالية في **Releases (`latest`)** و**Workflow Artifacts**:

- `school-admin.apk`: ملف APK شامل يعمل على جميع معماريات أندرويد القديمة والجديدة (`arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`).
- `school-admin-arm64-v8a.apk` / `school-admin-armeabi-v7a.apk` / `school-admin-x86_64.apk` / `school-admin-x86.apk`: نسخ مقسمة حسب المعالج بحجم أصغر.
- `school-admin.aab`: حزمة Android App Bundle المخصصة للنشر على متجر Google Play.

## البناء محلياً

```bash
npm install
npm run build:android:apk      # بناء ملف APK شامل
npm run build:android:splits   # بناء ملفات APK مقسمة حسب المعالج
npm run build:android:aab      # بناء حزمة AAB
```