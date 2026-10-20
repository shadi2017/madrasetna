# خطة الاستعادة في 10 دقائق — مدرستنا

الهدف: لو حصل خطأ في البيانات أو المشروع الأساسي وقع، تقدر ترجع الموقع شغال بأقل تأثير ممكن.

## أرقام يجب أن تعرفها

| المقياس | القيمة الحالية |
|---|---|
| **RPO** (أقصى بيانات ممكن تضيع) | حتى 24 ساعة — آخر نسخة 12:00 ص |
| **RTO** (زمن العودة المتوقع) | 10–25 دقيقة مع مشروع احتياطي جاهز |
| مكان النسخ | Supabase الثاني + R2 + Telegram + الإيميل + المتصفح |
| التشفير | AES-256-GCM (لو `BACKUP_ENCRYPTION_KEY` مضبوط) |

> قبل أي عملية كبيرة (استيراد Excel، حذف جماعي، تغيير معادلة الدرجات): اضغط **نسخ احتياطي الآن** من شاشة النسخ الاحتياطي.

## شنطة الطوارئ (Restore Kit) — جهّزها من الآن

احتفظ بنسخة منها في Password Manager + نسخة ورقية/فلاشة بعيدًا عن السيرفر:

- [ ] `BACKUP_ENCRYPTION_KEY` (مفتاح فك التشفير).
- [ ] `service_role` key للمشروع الأساسي.
- [ ] `service_role` key للمشروع الاحتياطي.
- [ ] Project URL + anon key لكل مشروع.
- [ ] بيانات دخول Supabase وCloudflare R2 وTelegram وResend.
- [ ] صلاحية على GitHub repo (لتغيير المتغيرات وإعادة النشر).
- [ ] آخر نسخة احتياطية محفوظة على جهازك/موبايلك (من Telegram أو الإيميل).
- [ ] هذا الملف + `BACKUP.md` + سكربتات `scripts/`.
- [ ] `SUPABASE_DB_URL` (Connection String) لو هتستخدم `pg_dump` الكامل.

## أول 60 ثانية — لا تتصرف من غير ما تحمي النسخة

1. **لا تحذف المشروع القديم** ولا تعمل Reset قبل ما تنزّل آخر نسخة.
2. نزّل أحدث ملف من Telegram أو الإيميل إلى جهازك.
3. لو الملف مشفر، فك تشفيره:

```sh
node scripts/decrypt-backup.mjs "madrasetna-YYYY-MM-DD.json.gz.enc" "$BACKUP_ENCRYPTION_KEY"
```

على Windows PowerShell:

```powershell
$env:BACKUP_ENCRYPTION_KEY="المفتاح"
node scripts/decrypt-backup.mjs "madrasetna-YYYY-MM-DD.json.gz.enc"
```

4. تأكد أن الملف JSON سليم وافتحه سريعًا (لازم يبدأ بـ `madrasetna-cloud-backup-v1`).

## شجرة القرار

### الحالة A — مشكلة في البيانات فقط (المشروع الأساسي شغال)

مثال: حذف طلاب بالخطأ، استيراد Excel غلط، تعديل درجات جماعي.

**الحل الأسرع: استعادة داخل نفس المشروع.**

```sh
SUPABASE_URL="https://PRIMARY.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
RESTORE_ADMIN_PASSWORD="كلمة-مرور-مؤقتة-قوية" \
node scripts/restore-backup.mjs "madrasetna-YYYY-MM-DD.json" --confirm
```

- السكربت يعمل Dry-run افتراضيًا. شغّله أولًا بدون `--confirm` لمراجعة الأعداد.
- على Windows PowerShell استخدم:
```powershell
$env:SUPABASE_URL="https://PRIMARY.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."
$env:RESTORE_ADMIN_PASSWORD="كلمة-مرور-مؤقتة-قوية"
node scripts/restore-backup.mjs "madrasetna-YYYY-MM-DD.json" --confirm
```
- الاستعادة `upsert` وليست حذفًا: الصفوف الموجودة يتم تحديثها من النسخة، والجديدة تُضاف.
- إذا كان الخطأ في جدول واحد فقط، الأفضل تستعيد من النسخة إلى **مشروع تجريبي** ثم تنقل الجدول المطلوب يدويًا.
- **كلمات المرور لا تتأثر** في هذه الحالة لأنك لم تغيّر مشروع Auth؛ و`RESTORE_ADMIN_PASSWORD` اختياري لو أردت تعيين كلمة مرور مؤقتة للأدمن.
- لو لم تضبط `RESTORE_ADMIN_PASSWORD`، يبقى أدمن المشروع الحالي بكلمة مروره الحالية. لو استخدمت السكربت على مشروع جديد، لازم تعيد تعيين كلمة مرور الأدمن.

### الحالة B — المشروع الأساسي وقع/اتحذف

**الحل: مشروع احتياطي جاهز + استعادة البيانات + تحويل الواجهة.**

#### تجهيز مسبق (مرة واحدة، مش وقت الأزمة)

1. أنشئ مشروع Supabase احتياطي (يمكن استخدام نفس مشروع النسخ الاحتياطي).
2. طبّق كل الميجريشنز `001` → `008` عليه.
3. انشر الدوال:

```sh
npx supabase functions deploy manage-student --no-verify-jwt --project-ref <STANDBY_REF>
npx supabase functions deploy backup --no-verify-jwt --project-ref <STANDBY_REF>
```

4. اضبط أسرار الدوال على المشروع الاحتياطي (نفس خطوات `BACKUP.md`، مع تغيير `SUPABASE_URL`).
5. **اتركه فارغًا من البيانات**، ولا تدخل عليه طلابًا. هذا هو Standby.
6. سجّل الـURL والـanon key والـservice_role key في شنطة الطوارئ.

#### وقت الأزمة (10 دقائق)

| الدقيقة | الخطوة |
|---|---|
| 0–1 | نزّل آخر نسخة، فك تشفيرها، وتأكد من سلامتها |
| 1–2 | افتح المشروع الاحتياطي (أو أنشئ مشروعًا جديدًا لو الاحتياطي نفسه غير متاح) |
| 2–4 | لو المشروع جديد: طبّق `001`→`008` من SQL Editor. لو Standby جاهز: تخطَّ |
| 4–7 | شغّل الاستعادة (أمر تحت) |
| 7–8 | حدّث متغيرات الواجهة على GitHub وأعد النشر |
| 8–9 | اختبر: تسجيل دخول أدمن، عدد الطلاب، تقييم يوم، النتيجة، QR |
| 9–10 | فعّل إعلانًا للطلاب واطمئن على المزامنة |

**أمر الاستعادة:**

```sh
SUPABASE_URL="https://STANDBY.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="..." \
RESTORE_ADMIN_PASSWORD="كلمة-مرور-مؤقتة-قوية" \
node scripts/restore-backup.mjs "madrasetna-YYYY-MM-DD.json" --confirm
```

**تحويل الواجهة:**

- GitHub → Settings → Secrets and variables → Actions → Variables:
  - `VITE_SUPABASE_URL` = رابط المشروع الاحتياطي
  - `VITE_SUPABASE_ANON_KEY` = anon key
- شغّل workflow **Deploy** من Actions (أو اعمل push بسيط).
- أو من CLI:

```sh
gh variable set VITE_SUPABASE_URL --body "https://STANDBY.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "<ANON_KEY>"
gh workflow run deploy.yml
```

**مهم:** رابط GitHub Pages نفسه لا يتغير (`https://shadi2017.github.io/madrasetna/`)، فالطلاب لا يحتاجون رابطًا جديدًا. لو استخدمت دومين مخصص، حافظ عليه ولا تغيّره وقت الأزمة.

### الحالة C — الواجهة فقط وقعت (GitHub Pages)

- البيانات في Supabase سليمة.
- أعد النشر من Actions، أو ابنِ محليًا:

```sh
npm ci
npm run build
```

- ارفع `dist` على Cloudflare Pages أو أي استضافة Static مؤقتة، مع نفس متغيرات Supabase.
- لا تحتاج استعادة بيانات.

### الحالة D — الأدمن فقد الجهاز/كلمة المرور

- استخدم شاشة **استعادة كلمة مرور الأدمن** إن كانت مفعّلة.
- أو من Supabase Dashboard → Authentication → Users → Send recovery / Reset password.
- لا تحتاج النسخة الاحتياطية.

## حدود مهمة — كلمات المرور

النسخة الاحتياطية عبر API تحتوي **هويات المستخدمين وإيميلاتهم وبياناتهم الوصفية، لكنها لا تحتوي كلمات المرور أو الـpassword hashes**.

- **الحالة A** (استعادة داخل نفس المشروع): كلمات المرور تبقى كما هي. لا تأثير.
- **الحالة B** (مشروع جديد): `restore-backup.mjs` ينشئ المستخدمين بكلمات مرور عشوائية. لازم:
  - الأدمن: مرّر `RESTORE_ADMIN_PASSWORD` أثناء الاستعادة، أو أعد التعيين من Supabase Dashboard.
  - الطلاب: الأدمن يعيد تعيين كلمات المرور من التطبيق/دالة `manage-student` حسب الحاجة.
- هذا هو الحد الوحيد الذي لا يمكن تجاوزه مجانًا عبر API. لتجنب إعادة تعيين كلمات المرور في كارثة كاملة، استخدم **نسخة قاعدة بيانات كاملة**:

### Level 2 (اختياري): pg_dump كامل

> يحتوي على password hashes وكل الـschemas. تعامل معه كملف سري للغاية، وشفّره قبل رفعه.

```sh
# مرة كل يوم/أسبوع من جهاز موثوق أو GitHub Actions
pg_dump "$SUPABASE_DB_URL" \
  --no-owner --no-privileges \
  --schema=public --schema=auth \
  --file="full-madrasetna-$(date +%F).sql"

gzip -9 "full-madrasetna-$(date +%F).sql"
```

الاستعادة إلى مشروع جديد:

```sh
gunzip -c full-madrasetna-YYYY-MM-DD.sql.gz | psql "$NEW_SUPABASE_DB_URL"
```

**تحذيرات:**
- استخدم إصدار `pg_dump` مساويًا أو أحدث من إصدار Postgres في Supabase.
- جرّب الاستعادة على مشروع تجريبي أولًا. استعادة `auth` قد تتأثر بإصدار GoTrue وإعدادات المشروع.
- لا تعتمد على `pg_dump` كبديل وحيد؛ اجعله نسخة إضافية (Level 2) بجانب نسخة API اليومية.
- الحل الرسمي والأضمن لكلمات المرور هو خطة Supabase Pro (نسخ يومية). لو الميزانية تسمح لاحقًا، فهي أقصر طريق.

## ما بعد الاستعادة

- [ ] سجّل دخول الأدمن.
- [ ] راجع عدد الطلاب = العدد في النسخة.
- [ ] افتح يومًا قديمًا وتأكد من الدرجات.
- [ ] جرّب مسح QR لطالب.
- [ ] تأكد أن النتيجة/الترتيب يظهران حسب حالة النشر.
- [ ] أعد تفعيل النسخ الاحتياطي على المشروع الجديد واضبط cron وVault.
- [ ] اعمل **نسخة احتياطية الآن** بعد التأكد.
- [ ] بدّل `BACKUP_SUPABASE_URL` لو المشروع الثاني اتغير.
- [ ] غيّر كل الأسرار القديمة (service role, cron secret, Telegram token إن لزم).
- [ ] راقب `backup_runs` أول 3 ليالٍ.
- [ ] اكتب سبب الحادثة وخطوة منع تكرارها.

## قواعد ذهبية

1. **لا تحذف المشروع القديم قبل 7 أيام** من التأكد. حتى لو واجهة جديدة شغالة، القديم قد يكون مصدر إنقاذ.
2. **لا تشارك النسخة أو المفتاح** في واتساب عام. استخدم قناة خاصة.
3. **اختبر الاستعادة شهريًا** على مشروع تجريبي. نسخة لم تُجرّب = نسخة غير مضمونة.
4. **قبل أي تغيير كبير**: نسخة يدوية فورية.
5. **RPO 24 ساعة**: لو حصلت كارثة قبل منتصف الليل، آخر نسخة هي نسخة ليلة أمس. أي تعديلات اليوم ستضيع. هذا مقبول لمدرسة، لكن يجب أن يكون معروفًا.
6. لو أردت RPO أقل، جدول نسخة إضافية الساعة 12 ظهرًا (نفس الدالة، تشغيل يدوي/آخر cron) — لكنها تكلف مساحة أكبر.
