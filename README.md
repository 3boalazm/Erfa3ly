# ارفعلي · Erfa3ly

بيتٌ لما ينتجه الوكلاء: صفحة HTML، مجلد بناء، ZIP، أو مستند PDF — يُرفع فيحصل على
رابط معاينة **معزول**، إصدارات لا تُعدَّل، ورابط مشاركة قابل للإلغاء.

> **النطاق بصراحة:** نستضيف **ملفات ثابتة** فقط. لا ننفّذ أوامر، ولا نشغّل خوادم،
> ولا نوصّل قواعد بيانات لتطبيقاتك. المشروع الذي يحتاج Backend يحتاج بيئة تشغيل
> أخرى — ونقول لك ذلك في الواجهة عند رفع ZIP يبدو تطبيقاً كاملاً.

الواجهة عربية (RTL) مع تبديل إنجليزي، والكود والتعليقات بالإنجليزية.

## لمحة سريعة

- **رفع مباشر من المتصفح إلى Vercel Blob** — لا يمرّ الملف عبر دالة Vercel (سقف جسم الدالة 4.5 MB)، وملفات فوق 100 MB تُرفع مجزّأة تلقائياً.
- **معاينة معزولة بمستويين**: `CSP: sandbox` على كل ملف + `<iframe sandbox>` بلا `allow-same-origin`. لا كوكيز، لا وصول إلى واجهة المنصة.
- **ZIP آمن**: فحص الأحجام المعلنة **قبل** فكّ الضغط، رفض zip-slip، بلا كتابة على القرص، ثم استنتاج نقطة الدخول (`index.html` حتى لو كان داخل مجلد يغلّف الموقع).
- **إصدارات**: كل تعديل أو استرجاع ينتج نسخة؛ لا يُعاد كتابة نسخة قديمة أبداً.
- **روابط مشاركة**: توكن عشوائي 32 حرفاً، قابل للإلغاء والانتهاء والتثبيت على إصدار.
- **يعمل محلياً بلا أي خدمة**: قرص + Postgres داخل العملية (PGlite) بنفس SQL الإنتاج.

## تشغيل محلي

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:3000
```

كل متغيرات البيئة فارغة تعني: تخزين محلي في `./.erfa3ly-data/blobs`، وقاعدة بيانات
PGlite في `./.erfa3ly-data/pgdata`. لا Docker، لا حساب، لا مفاتيح.

```bash
npm test           # 24 اختباراً: مسارات، ZIP، استنتاج نقطة الدخول
npm run typecheck
npm run build      # next build --webpack
```

## النشر على Vercel

الشرط: **Postgres** (Neon/Supabase) و**Blob store**. الكود يرفض العمل على Vercel بدونهما
برسالة واضحة بدل أن يفقد الملفات بصمت.

```bash
# من لوحة Vercel: Storage → Blob ، Storage → Postgres
# ثم متغيرات البيئة:
#   BLOB_READ_WRITE_TOKEN   (تلقائي عند ربط Blob)
#   DATABASE_URL            (تلقائي عند ربط Postgres)
#   CRON_SECRET             (إلزامي لجدولة التنظيف)
#   ERFA3LY_PUBLIC_URL=https://<نطاقك>
```

بعد النشر تحقق بسطر واحد: `curl -s https://<نطاقك>/api/health` — يجب أن يعيد
`storage: "blob"` و`database: "postgres"` و`problems: []`. يقبل المشروع نمطَي ربط
Blob: توكن `BLOB_READ_WRITE_TOKEN` (يظهر كـ `blobAuth: "token"`)، أو ربط عبر OIDC
بحيث يكفي `BLOB_STORE_ID` (يظهر كـ `blobAuth: "oidc"`، والرفع يمرّ عبر
`uploadPresigned`). إن ظهر `storage: "local"` فلا متجر مربوط، والرفع سيفشل بـ 413.

`vercel.json` يضيف Cron يومياً إلى `/api/cron/gc` (جلسات الرفع المتروكة، والمواقع
المحذوفة بعد مدة الاحتفاظ). التفاصيل الكاملة، والأرقام، وأربع تصحيحات لازمة على
الخطة الأولية في **[docs/deploy-vercel.md](docs/deploy-vercel.md)**.

## كيف يعمل

```
browser ──① open session──▶ /api/uploads        (فحص مسارات/أحجام/حصّة/حدّ معدّل + توليد site/version)
browser ──② bytes────────▶ Vercel Blob مباشرة    (أو بثّ PUT إلى القرص محلياً)
browser ──③ commit──────▶ /api/uploads/<id>/commit (ما وصل فعلاً، فكّ ZIP، نقطة الدخول، الصفوف)
```

- المعاينة: `/api/raw/<siteId>/<version|current>/<path>` — ترويسة CSP، أنواع MIME من جدول ثابت، دعم `Range` لملفات PDF والفيديو، وحقن shim للتخزين المحلي داخل HTML.
- لوحة المالك: `/d/<id>` — معاينة، إصدارات، مشاركة، تعديل صفحة مفردة، حذف.
- صفحة القارئ: `/v/<token>` — معاينة فقط، بلا أي عناصر تحكّم يمكن انتحالها.

المزيد: [docs/architecture.md](docs/architecture.md) · [SECURITY.md](SECURITY.md)

## الحدود الافتراضية

| البند | القيمة | المتغير |
| --- | --- | --- |
| حصة المساحة (لكل مالك) | 900 MB | `ERFA3LY_QUOTA_BYTES` |
| أقصى ملف | 100 MB | `ERFA3LY_MAX_FILE_BYTES` |
| أقصى عملية نشر | 500 MB | `ERFA3LY_MAX_VERSION_BYTES` |
| عدد الملفات | 2000 | `ERFA3LY_MAX_FILES` |
| مدة جلسة الرفع | 24 ساعة | `ERFA3LY_SESSION_TTL_HOURS` |
| الاحتفاظ بعد الحذف | 7 أيام | `ERFA3LY_DELETED_RETENTION_DAYS` |
| عمليات الكتابة | 60/ساعة | `ERFA3LY_RATE_LIMIT_PER_HOUR` |

على Hobby: 1 GB تخزين و10 GB نقل شهرياً — أي أن موقعاً بحجم 500 MB يُشاهد عشرين مرة
فقط قبل نفاد النقل. الأرقام ليست تفاصيل، هي قرار معماري.

## بنية المستودع

```
src/app/            صفحات (RSC) + مسارات API رقيقة
src/lib/
  storage.ts        واجهة التخزين + اختيار المشغّل
  storage-local.ts  القرص (تطوير)
  storage-blob.ts   Vercel Blob (إنتاج)
  db.ts / schema.ts Postgres (pg) أو PGlite محلياً — نفس SQL
  uploads.ts        جلسات الرفع، الـ commit، والتنظيف
  tree.ts           نقطة الدخول، تجريد المجلد الغلاف، كشف «يحتاج خادماً»
  unzip.ts          فكّ ZIP بحدود قبل الفك
  paths.ts          حرّاس المسارات (جوهر الأمان)
  sites.ts / shares.ts  الصفوف والصلاحيات
  i18n.ts           القواميس (عربي/إنجليزي)
src/components/     واجهة الرفع ولوحة الموقع (client)
test/               vitest: paths, tree, unzip
```

## ما لم يُنفَّذ بعد

مصادقة حقيقية (OIDC)، كلمة مرور لرابط المشاركة، مشغّل S3/R2، معاينة Office
(Gotenberg خارج Vercel)، بحث نصي داخل المستندات، وتحميل الأصول من نطاق معاينة منفصل.

## الترخيص

MIT — راجع [LICENSE](LICENSE).
