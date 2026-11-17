# MF-V-01 — Maliye-Finans

KB Group için çok kullanıcılı, sunucu tabanlı muhasebe uygulaması: kasa,
gelir, gider, çalışma alanları, kasa aktarımları, borçlar, mali notlar,
hazırlanan raporlar, arşiv ve kullanıcı/erişim yönetimi. Arayüz Türkçe,
İngilizce ve Kurmancî.

Next.js uyumlu [vinext](https://github.com/cloudflare/vinext) (Vite
üzerinde) + React 19, [Drizzle ORM](https://orm.drizzle.team) ile
**PostgreSQL**. Canlıda Coolify üzerinde Docker ile çalışır
(`kb-group.live`).

## Mimari özeti

- **İstemci + sunucu**: `app/page.tsx` (tek sayfalık React arayüzü, sayfalar
  `app/components/`) ve `app/api/**/route.ts` (REST API uçları).
- **Veritabanı**: şema `db/schema.ts`, migration'lar `drizzle/`.
- **Kimlik doğrulama**: `scrypt` şifre hash'i, httpOnly oturum çerezi
  (`app/api/_lib/auth.ts`), kullanıcı bazlı sayfa izinleri ve kasa bazlı
  erişim (`app/api/_lib/cash-access.ts`).
- **Güvenlik**: sunucu taraflı yetki denetimi, süreli IP engeli (60 dk) ve
  hesap kilidi (15 dk), Zod ile girdi doğrulama, CSRF origin kontrolü
  (`app/api/_lib/http.ts`), aktif içerikli (SVG/HTML) eklerin reddi.
- **Prod sunucu**: `server.mjs` — sunmayı vinext'in `startProdServer`'ına
  devreder; üstüne açılışta migration (advisory lock ile), her yanıtta
  güvenlik başlıkları (CSP, HSTS, X-Frame-Options…), istek gövdesi boyut
  sınırı, süresi dolan oturumların temizliği ve SIGTERM'de düzgün kapanma
  ekler.

## Gereksinimler

- Node.js `>=22.13.0`
- PostgreSQL 16+ (canlıda 17)

## Kurulum (yerel)

```bash
npm ci
cp .env.example .env.local
```

`.env.local` içindeki alanları doldurun:

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | `postgres://kullanici:sifre@host:5432/veritabani` |
| `SESSION_COOKIE_SECURE` | Prod'da `true` (HTTPS), yerel HTTP'de `false` |
| `SESSION_TTL_HOURS` | Oturum süresi (varsayılan 12) |
| `PGSSL` | Uzak Postgres TLS istiyorsa `require` |
| `PGPOOL_MAX` | Bağlantı havuzu üst sınırı |
| `PORT`, `HOST` | `server.mjs`'in dinleyeceği adres |
| `VINEXT_TRUST_PROXY`, `TRUSTED_PROXY_COUNT` | Reverse proxy arkasında `1` (canlıda Traefik → ikisi de `1`) |
| `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_PASSWORD`, `SEED_USER_PASSWORD` | `npm run db:seed` için (en az 10 karakter) |

## Veritabanı

```bash
npm run db:migrate    # migration'ları uygular (.env.local'ı okur)
npm run db:generate   # şema değişince yeni migration üretir
npm run db:seed       # boş bir veritabanında ilk admin/manager/user hesaplarını oluşturur
```

`server.mjs` açılışta migration'ları kendisi uygular.

## Geliştirme

```bash
npm run dev
```

Geliştirme sunucusu yalnız bu bilgisayardan erişilebilir (`localhost`).
Claude Code tarayıcı paneli `.claude/launch.json` ile 5190 portunu kullanır.

## Dağıtım (Coolify)

- `main`'e her push, GitHub webhook'u ile Coolify'da otomatik deploy başlatır.
- `Dockerfile` çok aşamalıdır; çalışma imajında `HEALTHCHECK` (`/api/health`)
  vardır, Coolify yeni konteynere trafiği ancak o hazır olunca verir.
- Ortam değişkenleri Coolify → uygulama → Environment Variables'ta tutulur.
- Deploy sırasında eski/yeni konteyner birkaç saniye birlikte çalışır; bu
  arada bir `/assets` dosyası yüklenemezse sayfa kendini bir kez yeniler
  (`app/layout.tsx`).

## Test

```bash
npm test
```

Sırasıyla: tip kontrolü, prod derlemesi, ardından `tests/*.test.mjs`
(Excel tutar birim testi, sayfa ve derleme çıktısı testleri,
`tests/api.test.mjs`'deki API entegrasyon testleri).

API testleri **ayrı bir yerel test veritabanında** çalışır: `npm test`
`DATABASE_URL`'yi `.env.test` dosyasından okur ve testler, adı `_test` ile
bitmeyen ya da `localhost` dışındaki bir veritabanında çalışmayı reddeder.
İlk kurulum:

```bash
createdb mfv01_test   # veya: CREATE DATABASE mfv01_test OWNER <kullanıcı>;
echo "DATABASE_URL=postgres://kullanici:sifre@localhost:5432/mfv01_test" > .env.test
node --env-file=.env.test node_modules/drizzle-kit/bin.cjs migrate
node --env-file=.env.test tests/helpers/seed-test-admin.mjs   # admin / admin123
```

GitHub Actions (`.github/workflows/ci.yml`) lint, tip kontrolü, derleme ve
tüm testleri her `main` push'unda ve pull request'te geçici bir Postgres 17
ile çalıştırır. Coolify CI sonucunu beklemeden deploy eder; kırmızı bir CI,
yayındaki sürümün hemen kontrol edilmesi gerektiği anlamına gelir.

## Yedekleme

- **Asıl yedek: Coolify** — `mfv01-postgres` için günlük `pg_dump` yedeği
  (Coolify → veritabanı → Backups). Her şeyi kapsar; `pg_restore` ile geri
  yüklenir.
- **Uygulama içi** (Ayarlar → Yedekleme ve veritabanı, yalnız süper admin):
  oturumlar dışındaki tüm tabloların tam yedeği (`.json.gz`) alınır ve geri
  yüklenir. Yalnız aynı veritabanı şemasında (aynı migration'larla) alınmış
  bir yedek geri yüklenebilir; daha eski yedekler için Coolify yedeği kullanılır.

## Proje yapısı

- `app/page.tsx` — uygulama kabuğu ve veri katmanı
- `app/components/` — sayfalar (`records/` altında Gelir/Gider/Kasa tablosu parçaları)
- `app/lib/` — istemci yardımcıları (finans hesapları, i18n, Excel, ekler, bildirimler)
- `app/api/**/route.ts`, `app/api/_lib/` — API uçları ve sunucu yardımcıları
- `db/schema.ts`, `drizzle/` — şema ve migration'lar
- `server.mjs` — prod giriş noktası
- `tests/` — `node --test` testleri
- `docs/` — eski ürün spesifikasyonu ve 1.0.9 düzeltme planı (tarihçe)

Masaüstü (Electron) sürümü 1.1.0'da kaldırıldı; uygulama yalnız web
sürümü olarak geliştirilir.
