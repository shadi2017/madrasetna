# النسخ الاحتياطي — مدرستنا

النظام يعمل تلقائيًا **بعد منتصف الليل بتوقيت القاهرة (00:00)**، وينشئ نسخة لليوم الدراسي الذي انتهى للتو. لا يعمل إلا إذا كان التاريخ موجودًا في جدول **أيام الدراسة** وله تاريخ.

## ماذا يحدث كل ليلة؟

```text
الساعة 12:00 ص (القاهرة)
        │
        ▼
pg_cron داخل Supabase (كل 15 دقيقة)
        │  x-backup-secret
        ▼
Edge Function: backup
        │
        ├── يقرأ كل البيانات من المشروع الأساسي (Service Role)
        ├── يضغط JSON.gz
        ├── يشفر AES-256-GCM (اختياري لكن مُوصى به بشدة)
        ├── يرفع إلى: Supabase الثاني (Storage خاص)
        ├── يرفع إلى: Cloudflare R2
        ├── يرسل الملف إلى: Telegram Bot
        ├── يرسل ملخص + رابط مؤقت إلى: Resend Email
        └── يسجل النتيجة في جدول backup_runs
```

النسخة تحتوي: الطلاب، الأيام، التقييمات، الدرجات المستقلة، نظام الدرجات، الإعدادات (بما فيها اللوجو والنصوص الديناميكية)، إعدادات النسخ، سجل التدقيق، المشرفين، وبيانات هوية مستخدمي Auth (المعرّف والإيميل والبيانات الوصفية — **بدون كلمات المرور**).

> **مهم:** كلمات مرور الطلاب لا يمكن تصديرها من واجهة Supabase API. راجع قسم «حدود الاستعادة» في `RECOVERY.md`. للسيناريو الأكثر شيوعًا (تلف بيانات داخل نفس المشروع) لا تحتاج إعادة تعيين كلمات المرور. لو المشروع نفسه ضاع، ستحتاج خطة إعادة تعيين أو نسخة `pg_dump` كاملة.

## المتطلبات (كلها مجانية)

| الخدمة | الاستخدام | الحد المجاني |
|---|---|---|
| Supabase الثاني | تخزين النسخ + جدول ملخص | 1 GB Storage / 500 MB DB |
| Cloudflare R2 | نسخة ثانية خارج Supabase | 10 GB تخزين |
| Telegram Bot | إرسال الملف مباشرة | 50 MB للملف |
| Resend | إيميل فيه رابط تحميل | 100 إيميل/يوم |
| Supabase pg_cron + pg_net | الجدولة | متاحان في الخطة المجانية |

## 1) المشروع الأساسي

طبّق الميجريشنز بالترتيب:

```sql
-- في SQL Editor للمشروع الأساسي
-- 001 … 006 ثم:
-- 007_backups.sql
-- 008_dynamic_content_midnight_backup.sql
-- 009_restore_support.sql
```

أو باستخدام CLI:

```sh
npx supabase db push --project-ref <PRIMARY_REF>
```

## 2) مشروع Supabase الثاني (هدف التخزين)

1. أنشئ مشروعًا مجانيًا ثانيًا من لوحة Supabase (مشروع منفصل تمامًا).
2. في SQL Editor للمشروع الثاني شغّل:

```sql
-- محتوى الملف supabase/backup-target-setup.sql
```

3. لا تنشئ Bucket يدويًا؛ دالة النسخ تنشئ Bucket خاصًا اسمه `madrasetna-backups` تلقائيًا.
4. احتفظ بـ:
   - Project URL: `https://xxxx.supabase.co`
   - `service_role` key (من Settings → API). **لا تضعه في الواجهة أبدًا.**

## 3) Cloudflare R2

1. من Cloudflare → R2 → Create bucket، الاسم مثلًا `madrasetna-backups`.
2. Manage R2 API Tokens → Create API token → صلاحية **Object Read & Write** لنفس الـBucket.
3. احتفظ بـ:
   - Account ID
   - Access Key ID
   - Secret Access Key

## 4) Telegram Bot

1. افتح [@BotFather](https://t.me/BotFather) واعمل `/newbot`، واحفظ التوكن.
2. أرسل أي رسالة للبوت، ثم افتح:

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

وخد `chat.id`. لو هتستخدم قناة، ضيف البوت كـAdmin.

## 5) Resend (اختياري لكنه مطلوب لو عايز إيميل)

1. أنشئ حساب Resend ومفتاح API.
2. بدون دومين: استخدم `onboarding@resend.dev`، ويُسمح بالإرسال إلى **بريد صاحب الحساب فقط**.
3. مع دومين موثّق: استخدم `backup@yourdomain.com`.
4. احتفظ بـ API Key والبريد المستلم.

## 6) مفتاح التشفير (مهم جدًا)

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

- الناتج 32 بايت Base64. حطه في `BACKUP_ENCRYPTION_KEY`.
- **احتفظ بنسخة منه خارج السيرفر** (Password Manager + ورقة في مكان آمن). لو ضاع المفتاح، النسخ المشفرة لا يمكن فتحها.
- لو لم تضبط المفتاح، النسخ ستكون `json.gz` غير مشفرة. المسموح به، لكن غير مُوصى به لبيانات الطلاب.

## 7) أسرار Edge Function

```sh
npx supabase secrets set \
  BACKUP_CRON_SECRET="ضع-سلسلة-عشوائية-طويلة" \
  BACKUP_ENCRYPTION_KEY="المفتاح-الأساسي-Base64" \
  BACKUP_SUPABASE_URL="https://BACKUP_REF.supabase.co" \
  BACKUP_SUPABASE_SERVICE_ROLE_KEY="service_role-للمشروع-الثاني" \
  BACKUP_BUCKET="madrasetna-backups" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="madrasetna-backups" \
  TELEGRAM_BOT_TOKEN="..." \
  TELEGRAM_CHAT_ID="..." \
  RESEND_API_KEY="..." \
  BACKUP_EMAIL_TO="you@example.com" \
  BACKUP_EMAIL_FROM="onboarding@resend.dev" \
  --project-ref <PRIMARY_REF>
```

`BACKUP_CRON_SECRET` لازم يطابق اللي هتحطه في Vault في الخطوة الجاية.

> البريد المستلم يُقرأ من إعدادات النسخ في التطبيق (`backup_settings.email`). `BACKUP_EMAIL_TO` اختياري ويُستخدم كبديل فقط لو الإعدادات فاضية.

> على Windows PowerShell: استخدم سطرًا واحدًا طويلًا (بدون `\`) أو استبدل كل `\` في نهاية السطر بـ `` ` ``.

## 8) نشر الدالة

```sh
npx supabase functions deploy backup --no-verify-jwt --project-ref <PRIMARY_REF>
```

`--no-verify-jwt` مقصود: الدالة تتحقق بنفسها من:
- `x-backup-secret` في حالة الـcron.
- JWT + `is_admin()` في حالة الضغط اليدوي من لوحة الأدمن.

## 9) جدولة منتصف الليل

افتح `supabase/backup-cron.sql`، بدّل القيمتين، وشغّله في SQL Editor للمشروع الأساسي:

```sql
select vault.create_secret('https://PRIMARY_REF.supabase.co/functions/v1/backup','backup_function_url','...');
select vault.create_secret('نفس-BACKUP_CRON_SECRET','backup_cron_secret','...');
```

ثم شغّل باقي الملف. هو:

- يفعّل `pg_cron` و`pg_net` و`supabase_vault`.
- ينشئ `public.trigger_backup()` التي تقرأ القيم من Vault (بدون كتابة الأسرار في SQL).
- يجدول `madrasetna-daily-backup` كل 15 دقيقة.

للتأكد:

```sql
select jobid, schedule, command, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
```

## 10) التفعيل من التطبيق

ادخل كأدمن → **النسخ الاحتياطي**:

- فعّل «تشغيل النسخ التلقائي».
- الوقت: `00:00` (الافتراضي).
- اكتب بريد الاستلام (اختياري).
- عدد النسخ المحفوظة: 14 يومًا مثلًا.
- اضغط **نسخ احتياطي الآن** للتجربة.

التجربة اليدوية تنشئ نسخة لليوم الدراسي الأحدث حتى اليوم، حتى لو لم يكن اليوم نفسه يوم دراسة. النسخة اليدوية منفصلة عن النسخة التلقائية، فلا تلغي نسخة منتصف الليل.

بعد نجاح التجربة ستظهر `supabase` و`telegram` و`email` بحالة `ok`. لو R2 غير مفعّل ستظهر `r2: skipped`، وهذا لا يؤثر على بقية النسخة.

## أين تُحفظ النسخ؟

| الهدف | المسار | ملاحظات |
|---|---|---|
| Supabase الثاني | Bucket `madrasetna-backups` → `daily/YYYY-MM-DD.json.gz.enc` | خاص، Service Role فقط |
| R2 | Bucket → `daily/YYYY-MM-DD.json.gz.enc` | خاص |
| Telegram | ملف في المحادثة | حد 50 MB |
| الإيميل | رابط موقّع صالح 7 أيام | لا يُرفق الملف |
| المتصفح | IndexedDB | آخر 14 نسخة، مضغوطة gzip، للتنزيل فقط |

## فك التشفير

```sh
npm run backup:decrypt -- "madrasetna-2026-10-19.json.gz.enc" "<BASE64_KEY>"
# أو
node scripts/decrypt-backup.mjs "madrasetna-2026-10-19.json.gz.enc" "$BACKUP_ENCRYPTION_KEY"
```

الناتج: ملف `.json` قابل للقراءة. راجع `RECOVERY.md` لخطوات الاستعادة.

## الأمان

- `service_role` لا يدخل في الواجهة ولا في GitHub Secrets الخاصة بالواجهة. مكانه الوحيد: Edge Function Secrets.
- Bucket المشروع الثاني وR2 **خاصان** (Private).
- الإيميل فيه رابط موقّع مؤقت، وليس مرفقًا دائمًا.
- الملف مشفر AES-256-GCM. حتى لو تسرب من Telegram أو R2، بدون المفتاح لا يُقرأ.
- لا تشارك ملف النسخة أو مفتاح التشفير في محادثة عامة.
- سجّل من لديه صلاحية الوصول لمشروع Supabase الثاني وR2.

## الحدود والقيود

- **RPO = 24 ساعة**: أي تعديل بعد منتصف الليل وقبل النسخة التالية قد يضيع عند كارثة كبرى. قبل أي عملية كبيرة (استيراد Excel مثلًا) اضغط **نسخ احتياطي الآن**.
- **مشروع Supabase المجاني قد يتوقف بعد 7 أيام بدون نشاط.** عندها تتوقف نسخة الـcron أيضًا. ملف `.github/workflows/keepalive.yml` يعمل Ping يوميًا باستخدام المتغيرين العامين للمساعدة في إبقاء المشروع نشطًا، لكنه ليس ضمانًا؛ افتح التطبيق أو لوحة Supabase أسبوعيًا.
- **RTO المتوقع = 10–25 دقيقة** لو المشروع الاحتياطي جاهز. راجع `RECOVERY.md`.
- Telegram لا يقبل أكثر من 50 MB. لو كبرت النسخة، راجع الرابط في الإيميل أو R2.
- المشروع المجاني الثاني سعته 1 GB. الاحتفاظ 14–30 نسخة صغيرة كافٍ لسنوات مدرسية.
- النسخة المحلية تعمل فقط عندما يفتح الأدمن التطبيق بعد منتصف الليل؛ المتصفح لا يعمل في الخلفية.
- النسخة المحلية تحتوي بيانات الدراسة (الطلاب، الأيام، التقييمات، الدرجات، الإعدادات، سجل التدقيق) لكنها **لا تحتوي حسابات الدخول أو كلمات المرور**؛ هي نسخة إضافية سريعة، وليست بديلًا عن النسخة السحابية.
- النسخة لا تحتوي كلمات المرور. راجع `RECOVERY.md` لخطة التعامل معها.

## استكشاف الأخطاء

| المشكلة | السبب المحتمل | الحل |
|---|---|---|
| `skipped: disabled` | التشغيل التلقائي غير مفعّل | فعّله من شاشة النسخ الاحتياطي |
| `skipped: not_study_day` | اليوم السابق غير موجود في أيام الدراسة أو بلا تاريخ | أضف التاريخ في جدول الأيام |
| `skipped: already_done` | نسخة اليوم موجودة بنجاح | طبيعي؛ استخدم «نسخ احتياطي الآن» لو عايز نسخة إضافية |
| `skipped: in_progress` | نسخة لنفس اليوم قيد التنفيذ الآن | انتظر 15 دقيقة؛ لا تشغّل نسخة يدوية في نفس الوقت |
| `skipped: before_run_time` | الوقت الحالي قبل وقت التشغيل المضبوط | اضبط الوقت أو انتظر |
| لا يوجد ملف في Telegram | التوكن/chat id خطأ أو البوت لم يبدأ المحادثة | أرسل رسالة للبوت وتأكد من `getUpdates` |
| الإيميل لا يصل | Resend بدون دومين يرسل لصاحب الحساب فقط | استخدم بريد صاحب الحساب أو وثّق دومين |
| `NO_STORAGE_TARGET` | لا يوجد هدف تخزين مضبوط | راجع أسرار Supabase الثاني وR2 |
| فشل فك التشفير | مفتاح مختلف أو ملف تالف | استخدم المفتاح الأصلي، وتأكد من وجود `MADB1` في بداية الملف |

## اختبار شهري مقترح

1. حمّل آخر نسخة من Telegram أو الإيميل.
2. فك تشفيرها.
3. شغّل `scripts/restore-backup.mjs` على **مشروع تجريبي** (Dry-run أولًا ثم `--confirm`).
4. سجّل الوقت الفعلي للاستعادة.
5. تأكد من: تسجيل دخول الأدمن، عدد الطلاب، تقييم يوم واحد، النتيجة، وQR.
