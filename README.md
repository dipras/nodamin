# ⚡ Nodamin

![Nodamin](featured.png)

**Lightweight Database Admin for Node.js** — A single-file Adminer alternative powered by Node.js and TypeScript.

Nodamin adalah web-based database administration tool yang terinspirasi dari [Adminer](https://www.adminer.org/). Dibuat dengan Node.js, TypeScript, dan dikemas menjadi **single JavaScript file** yang siap pakai tanpa dependencies eksternal saat runtime.

## ✨ Features

- 🚀 **Single File Distribution** - Build menghasilkan 1 file JS yang portable (~1MB)
- 🔌 **Multiple Database Support** - MySQL & SQLite (tersedia), PostgreSQL, MongoDB (planned)
- 🎨 **Simple & Clean UI** - Light/Dark theme dengan toggle
- 📦 **Zero Runtime Dependencies** - Semua embedded dalam bundle
- ⚙️ **Custom Host & Port** - Konfigurasi binding port dan host via CLI atau environment variable
- 🔧 **Full CRUD Operations** - Insert, update, delete, truncate, drop
- 📝 **SQL Query Editor** - Execute raw SQL dengan result viewer
- 📊 **Table Browser** - Pagination, sorting, dan quick actions
- 🔍 **Database Explorer** - Browse databases, tables, dan structure
- 📦 **Export/Import** - Export database/table to SQL, import SQL files
- ✅ **Bulk Actions** - Select multiple tables/rows for bulk operations

## 🚀 Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/dipras/nodamin.git
cd nodamin

# Install dependencies
npm install

# Build single file
npm run build
```

### Usage

```bash
# Run dengan default port (3088)
npm start

# Run dengan custom port dan host
node dist/nodamin.js --port 8080 --host 127.0.0.1

# Atau dengan environment variable
NODAMIN_HOST=0.0.0.0 NODAMIN_PORT=9000 node dist/nodamin.js
```

Buka browser ke URL yang ditampilkan pada log (default: `http://localhost:3088`) dan connect ke database MySQL atau SQLite kamu.

📝 **Catatan untuk SQLite**:
- Kamu bisa mengunggah file `.db` yang sudah ada via UI.
- Memilih opsi **Create New** akan membuat database In-Memory sementara (data hilang saat server restart), cocok untuk testing cepat.

## 🛠️ Development

```bash
# Type check
npm run typecheck

# Build single file (production)
npm run build

# Development mode dengan watch
npm run dev
```

### Project Structure

```
src/
├── index.ts           # Entry point & CLI parser
├── server.ts          # HTTP server
├── router.ts          # Request router & body parser
├── routes.ts          # Route handlers
├── types.ts           # TypeScript type definitions
├── db/
│   └── mysql.ts       # MySQL driver & operations
└── views/
    └── pages.ts       # HTML templates (embedded)
```

## 📋 Current MySQL Features

- ✅ Connect / Disconnect
- ✅ List databases
- ✅ Create / Drop database
- ✅ List tables with metadata (engine, rows, size, collation)
- ✅ View table structure (columns, types, keys, defaults)
- ✅ Browse table data with pagination & sorting
- ✅ Insert, Edit, Delete rows
- ✅ Drop & Truncate tables
- ✅ Raw SQL query editor with result display
- ✅ Create table with GUI (column types, constraints)
- ✅ Export table to SQL dump
- ✅ Export entire database to SQL dump
- ✅ Import SQL files
- ✅ Bulk actions for tables (drop, truncate, export multiple)
- ✅ Bulk delete for rows
- ✅ Light/Dark theme toggle with localStorage persistence
- ✅ Error handling with user-friendly messages

## 🗺️ Roadmap

## 🗺️ Roadmap

### Database Drivers
- [ ] **PostgreSQL** - Second priority after MySQL
- [x] **SQLite** - File-based & In-Memory database support ✅
- [ ] **MariaDB** - Should be easy since it's MySQL-compatible
- [ ] **MongoDB** - NoSQL support with collection/document view
- [ ] **Microsoft SQL Server** - Enterprise database support
- [ ] **Redis** - Key-value store browser

### Features
- [x] **Export** - Export table/query results to SQL dump ✅
- [x] **Import** - Import SQL files ✅
- [x] **Table creation** - Create table with GUI (columns, types, constraints) ✅
- [x] **Dark/Light theme toggle** ✅
- [x] **Bulk actions** - Select and operate on multiple tables/rows ✅
- [ ] **Alter table** - Add/modify/drop columns via GUI
- [ ] **Index management** - Create/drop indexes
- [ ] **Foreign key viewer** - View and manage foreign key relationships
- [ ] **Export to CSV/JSON** - Additional export formats
- [ ] **Query history** - Save and recall previous SQL queries
- [ ] **Multiple connections** - Save and switch between database connections
- [ ] **Keyboard shortcuts** - Quick navigation
- [ ] **Query autocomplete** - Basic SQL autocomplete in query editor
- [ ] **Table search/filter** - Filter tables in sidebar
- [ ] **Column-level filtering** - Filter data by column value
- [ ] **Stored procedures/functions** - View and execute
- [ ] **User/privileges management** - Manage database users
- [ ] **ERD viewer** - Visual entity relationship diagram
- [ ] **Connection via URL** - Support connection string format (e.g., `mysql://user:pass@host:port/db`)
- [ ] **Authentication** - Optional login to protect the admin panel
- [ ] **npx support** - Run directly with `npx nodamin`

## 📝 License

GPL-2.0 - Same as Adminer

## 🙏 Credits

Inspired by [Adminer](https://www.adminer.org/) by Jakub Vrána.

Built with Node.js, TypeScript, and ❤️
