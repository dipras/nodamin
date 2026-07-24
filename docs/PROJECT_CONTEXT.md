# Nodamin Project Context

Dokumen ini adalah router konteks lintas-sesi untuk repo **Nodamin**. Source code dan
`package.json` adalah source of truth; jika dokumen ini berbeda dari implementasi, ikuti source lalu
perbarui dokumen secara atomik. Terakhir diperbarui: 2026-07-25. Jangan simpan secret atau kredensial
database di sini. Guardrails universal: semua koleksi koneksi database dan pilihan koneksi aktif
harus tetap terisolasi per `sessionId`; perubahan kapabilitas database harus menjaga kontrak
`DatabaseDriver` dan perilaku
MySQL/SQLite tetap selaras; jangan edit `src/views/compiled.ts` atau `src/views/assets.ts` secara
manual karena keduanya generated; pertahankan urutan route spesifik sebelum route parametrik yang
lebih generik; jangan melakukan operasi git destruktif atau menimpa perubahan lokal pengguna.

## Kalau mau ngerjain X, baca Y

| Task | Baca bagian ini | Entry point |
|---|---|---|
| Tambah atau ubah route/operasi CRUD | [Request flow dan routing](#request-flow-dan-routing) | `src/routes.ts`, `src/routes/`, `src/router.ts` |
| Tambah driver atau kapabilitas database | [Kontrak driver database](#kontrak-driver-database) | `src/db/driver.ts`, `src/db/index.ts` |
| Ubah perilaku khusus MySQL/SQLite | [Perbedaan driver](#perbedaan-driver) | `src/db/mysql.ts`, `src/db/sqlite.ts` |
| Ubah halaman, template, CSS, atau browser JS | [Rendering dan generated files](#rendering-dan-generated-files) | `src/views/templates/`, `src/views/pages.ts` |
| Ubah login koneksi, cookie, atau isolasi koneksi | [Session dan koneksi](#session-dan-koneksi) | `src/session.ts`, `src/db/index.ts` |
| Ubah CLI, host, port, build, atau packaging | [Runtime dan build](#runtime-dan-build) | `src/index.ts`, `esbuild.config.js`, `package.json` |
| Audit arsitektur atau hubungan file | [Graphify](#graphify) | `graphify-out/GRAPH_REPORT.md` |
| Sebelum commit apa pun | Guardrails pada paragraf pembuka dan [Development workflow](#development-workflow) | `package.json` |

Berhenti membaca setelah section yang dirujuk beserta guardrails pembuka sudah cukup untuk task.
Jangan membaca domain lain kecuali entry point yang disentuh mengimpor atau mendelegasikan ke domain
tersebut.

## Ringkasan project

Nodamin adalah admin database web single-process yang dijalankan melalui Node.js/`npx`, dengan UI
server-rendered untuk MySQL dan SQLite. Repo ini memiliki HTTP server, routing, session memory,
driver database, template EJS, serta pipeline bundling menjadi satu entry JavaScript. Repo ini bukan
database server dan belum menyediakan autentikasi aplikasi terpisah dari form kredensial koneksi.

## Stack

- TypeScript 5.9, strict mode, ESM/NodeNext; source menargetkan ES2022.
- Node.js 20+; bundle produksi esbuild 0.27 menargetkan Node 20.
- HTTP server bawaan Node, router internal, dan `formidable` untuk multipart form.
- `mysql2/promise` untuk MySQL; `better-sqlite3` untuk SQLite.
- EJS 4 diprekompilasi; CSS, browser JavaScript, dan favicon di-embed ke bundle.
- npm + `package-lock.json`; paket dipublikasikan sebagai `@dipras/nodamin`.

## Struktur dan arsitektur

```text
src/index.ts                  CLI/env parser, registrasi route, start server
src/server.ts                 node:http server dan boundary error tak tertangani
src/router.ts                 registrasi/matching route, query/body/multipart parser
src/routes.ts                 orchestrator urutan registrasi tanpa handler
src/routes/*.ts               handler per domain: connection, schema/import, query, export,
                              rows, table actions/browse, static, dan guard bersama
src/session.ts                cookie session dan in-memory session lifetime
src/types.ts                  tipe lintas-layer
src/db/driver.ts              kontrak kapabilitas semua driver
src/db/index.ts               facade + koleksi driver dan koneksi aktif per sessionId
src/db/sql.ts                 parser statement SQL dan klasifikasi query read-only
src/db/mysql.ts               implementasi MySQL berbasis connection pool
src/db/sqlite.ts              implementasi SQLite berbasis satu file/in-memory DB
src/views/pages.ts            view-model dan komposisi layout/template
src/views/templates/*.ejs     source of truth markup
src/views/styles.css          source of truth styling
src/views/scripts.js          source of truth browser behavior
build-templates.js            generator src/views/compiled.ts
build-assets.js               generator src/views/assets.ts
esbuild.config.js             single-file ESM bundle ke dist/nodamin.js
```

Alur utama: `index.ts` mendaftarkan handler → `server.ts` meneruskan request ke `router.ts` →
router membentuk `RouteContext` termasuk `sessionId` → modul di `routes/` memanggil facade
`db/index.ts` dan renderer `views/pages.ts` → driver aktif menjalankan query → HTML atau download
dikirim ke client.

## Pattern per-domain

### Request flow dan routing

- Route hanya didaftarkan melalui `get()`/`post()` dan dicocokkan sesuai urutan registrasi.
  Letakkan path khusus seperti `/db/:db/table/create` atau `/db/:db/import` sebelum
  `/db/:db/table/:table`.
- Handler menerima `RouteContext`; parameter path, query, body, dan `sessionId` sudah diparsing oleh
  router. Multipart menghasilkan field scalar dan objek file `formidable`.
- Semua handler yang butuh database aktif harus memanggil `requireConnection()` terlebih dahulu,
  lalu meneruskan `ctx.sessionId` ke facade DB.
- Sebelum operasi scoped database/table, set database aktif lewat
  `db.setCurrentDatabase(sessionId, dbName)`. Pada SQLite operasi ini sengaja no-op.
- Encode segmen path dinamis dengan `encodeURIComponent` saat membuat redirect atau link.
- Saat menambah input array HTML, pertahankan normalisasi scalar-versus-array karena multipart
  dapat menghasilkan keduanya.

### Session dan koneksi

- Cookie `nodamin_session` menunjuk ke session in-memory dengan timeout satu jam; akses valid
  memperbarui `lastAccessedAt`, dan cleanup berjalan tiap lima menit.
- `src/db/index.ts` menyimpan koleksi instance driver dan satu `activeId` per `sessionId`. Jangan
  memperkenalkan singleton koneksi global, mencampur koleksi antar-session, atau mengakses driver
  tanpa `sessionId`.
- Flow connect: bentuk `DbConnection` (form atau URL MySQL) → `testConnection()` memakai driver
  sementara → buat atau gunakan session dan cookie → `db.connect(sessionId, conn)`. Menambah koneksi
  mempertahankan driver lain dalam session; switch hanya mengganti `activeId`. Flow logout/expiry
  harus menutup seluruh driver, menghapus mapping, dan membersihkan cookie.
- `DbConnection.readOnly` dan `queryTimeoutMs` adalah setting per koneksi. Read-only harus ditegakkan
  di driver/facade, bukan hanya dengan menyembunyikan tombol UI.
- Mengganti koneksi pada ID yang sama harus memutus instance lama sebelum membuat driver baru;
  menambah ID berbeda tidak boleh memutus driver lain dalam session tersebut.
- State session dan koneksi tidak persisten; restart proses menghapus semuanya. SQLite `:memory:`
  juga kehilangan seluruh data saat proses berhenti.

### Kontrak driver database

- `DatabaseDriver` adalah batas kapabilitas lintas database. Tambah/ubah operasi di interface,
  facade `src/db/index.ts`, dan setiap implementasi driver dalam perubahan yang sama.
- Raw query menerima `QueryExecutionOptions`; query aktif dapat dibatalkan lewat `cancelQuery()`.
  MySQL mendukung interrupt live melalui koneksi terpisah dan `KILL QUERY`; SQLite berbasis
  `better-sqlite3` tetap sinkron dan mengembalikan `false` karena tidak dapat diinterupsi oleh request
  HTTP paralel pada event loop yang sama.
- Routes dan views hanya menggunakan facade, bukan mengimpor `MySQLDriver`/`SQLiteDriver` langsung.
- Nilai data memakai parameter query pada operasi insert/update/delete. Identifier tabel/kolom tidak
  dapat diparameterkan, sehingga harus di-quote sesuai dialect dan tidak boleh disisipkan tanpa
  validasi/escaping yang setara dengan driver yang ada.
- `QueryResult`, `ColumnInfo`, dan `TableInfo` adalah bentuk normalisasi yang dikonsumsi route/view;
  pertahankan kontraknya saat memetakan metadata native driver.
- Raw SQL dan import SQL memang fitur produk. Perlakukan perubahan parser/eksekusinya sebagai
  high-risk karena input sengaja dieksekusi terhadap database yang sedang terhubung.
- Read-only raw SQL diklasifikasikan oleh `src/db/sql.ts`, termasuk seluruh statement dalam script
  dan executable comments MySQL. Semua method CRUD/DDL/import juga wajib menolak koneksi read-only.

### Perbedaan driver

- MySQL memakai pool dan current database melalui konfigurasi/query dialect MySQL; identifier
  menggunakan backtick.
- SQLite bersifat satu file = satu database; `setCurrentDatabase()` no-op, identifier menggunakan
  double quote, dan operasi sinkron `better-sqlite3` dibungkus API async agar cocok dengan interface.
- SQLite mode `create` saat ini membuat `:memory:` database; nama yang dimasukkan hanya menjadi
  display name, bukan file baru.
- SQLite tidak memiliki `TRUNCATE`, create/drop database, atau metadata engine/collation setara
  MySQL; implementasi mempertahankan respons kompatibel atau fallback yang disengaja.
- Import MySQL memakai statement splitter yang memahami quote, comment, dan directive `DELIMITER`,
  lalu berhenti dengan nomor statement saat error. SQLite memakai parser script native di dalam
  transaksi agar trigger dan rollback tetap benar; script yang membawa transaksi eksplisit
  mengelola boundary transaksinya sendiri.
- Perubahan DDL, import/export, pagination, sorting, primary key, default value, dan autoincrement
  harus diperiksa pada kedua dialect.

### Rendering dan generated files

- Edit markup di `src/views/templates/*.ejs`, styling di `src/views/styles.css`, dan browser logic di
  `src/views/scripts.js`.
- `src/views/pages.ts` membentuk data template, sidebar, dan layout. Jika kontrak data template
  berubah, perbarui renderer dan template bersamaan.
- Jalankan `npm run build:templates` untuk meregenerasi `src/views/compiled.ts`; jalankan
  `npm run build:assets` untuk meregenerasi `src/views/assets.ts`.
- `npm run build` dan `npm run typecheck` sudah menjalankan kedua generator sebelum bundling/check.
  Generated files di-ignore oleh git dan bukan tempat perubahan manual.
- Asset runtime di-embed sebagai konstanta; server tidak melayani direktori static umum. Favicon
  dilayani oleh route khusus dari base64.

### Runtime dan build

- CLI menerima `--port`/`-p`, `--host`/`-h`, dan bentuk `--key=value`; env vars menimpa hasil CLI.
- Default listen adalah loopback `127.0.0.1:3088`; bind ke wildcard harus dipilih eksplisit lewat
  CLI atau environment dan hanya aman pada jaringan tepercaya atau di belakang autentikasi.
- Build bundle berawal dari `src/index.ts`, menghasilkan `dist/nodamin.js` ESM untuk Node 20+,
  meminifikasi produksi, dan mengecualikan native dependency `better-sqlite3`.
- Paket npm hanya menerbitkan `dist`; perubahan runtime harus tetap bekerja dari bundle tanpa
  mengandalkan file source/template terpisah.

## Environment variables

| Variable | Default | Efek |
|---|---:|---|
| `NODAMIN_PORT` | `3088` | Port HTTP; menimpa nilai CLI jika valid |
| `NODAMIN_HOST` | `127.0.0.1` | Host/interface bind; menimpa nilai CLI |

## Skill dan dokumentasi pendukung

- `graphify`: baca/query `graphify-out/graph.json` lebih dulu untuk pertanyaan arsitektur, dependency,
  atau alur lintas-file; rebuild/update graph setelah perubahan struktur yang material.
- `dp-context-pattern`: gunakan ketika merapikan dokumen ini; pertahankan fungsi router dan jangan
  menambahkan changelog naratif.
- `README.md`: dokumentasi pengguna, fitur, instalasi, CLI, dan roadmap publik. Jangan menduplikasi
  roadmap ke context ini.

## Graphify

- Artefak utama: `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`, dan
  `graphify-out/graph.json`.
- Gunakan `graphify query "<pertanyaan>"`, `graphify path "<node-a>" "<node-b>"`, atau
  `graphify explain "<node>"` dari root repo.
- Gunakan build incremental Graphify setelah source berubah; lakukan full rebuild jika corpus atau
  konfigurasi ekstraksi berubah secara mendasar.
- Graphify versi saat context ini dibuat belum memiliki AST extractor untuk `.ejs`; audit perubahan
  template tetap harus membaca source template langsung.

## Development workflow

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
npm start
```

- Gunakan `npm test` untuk unit/integration test router, session, quoting identifier, dan SQLite;
  gunakan `npm run typecheck` untuk pemeriksaan TypeScript dan generator; gunakan `npm run build`
  untuk verifikasi bundle distribusi.
- Shared driver conformance suite selalu menguji SQLite. Set `NODAMIN_TEST_MYSQL_HOST`,
  `NODAMIN_TEST_MYSQL_DATABASE`, serta opsional `NODAMIN_TEST_MYSQL_PORT`,
  `NODAMIN_TEST_MYSQL_USER`, dan `NODAMIN_TEST_MYSQL_PASSWORD` untuk menjalankan kontrak dan
  query-cancellation test yang sama terhadap MySQL sungguhan.
- Repo belum mendefinisikan script lint atau formatter. Perilaku MySQL tetap memerlukan smoke test
  dengan server eksternal karena suite lokal hanya menguji helper dialect MySQL.
- `npm run dev` menggabungkan TypeScript watch dan esbuild watch; hentikan seluruh proses watch saat
  selesai.

## Known issues

- Belum ada autentikasi aplikasi terpisah; server yang terekspos dapat menampilkan form koneksi DB.
- Request POST dibatasi oleh pemeriksaan same-origin dan operasi destruktif memakai POST; perubahan
  baru harus mempertahankan boundary ini.
- Session, mapping driver, dan SQLite in-memory state hilang saat restart; tidak ada persistence atau
  multi-process coordination.
- Import MySQL tidak dapat menjanjikan rollback atomik untuk DDL karena statement DDL dapat melakukan
  implicit commit di server.

## Checklist update dokumen

- Perbarui dokumen ini dalam commit/PR yang sama jika invariant, kontrak driver, struktur layer,
  env var, command build, generated-file flow, atau source of truth berubah.
- Detail implementasi lokal yang tidak mengubah pattern tidak perlu ditambahkan.
- Pastikan tabel routing tetap menunjuk heading dan entry point aktual.
- Jangan menambah riwayat perubahan, nomor ticket, commit hash, fokus sesi terbaru, hasil verifikasi
  bertanggal, secret, atau path absolute spesifik mesin.
