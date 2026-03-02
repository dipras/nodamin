# ⚡ Nodamin

**Lightweight Database Admin for Node.js** — A single-file Adminer alternative powered by Node.js and TypeScript.

Nodamin adalah web-based database administration tool yang terinspirasi dari [Adminer](https://www.adminer.org/). Dibuat dengan Node.js, TypeScript, dan dikemas menjadi **single JavaScript file** yang siap pakai tanpa dependencies eksternal saat runtime.

## ✨ Features

- 🚀 **Single File Distribution** - Build menghasilkan 1 file JS yang portable (~1MB)
- 🔌 **Multiple Database Support** - MySQL (tersedia), PostgreSQL, SQLite, MongoDB (planned)
- 🎨 **Simple & Clean UI** - Dark theme, fokus pada fungsionalitas
- 📦 **Zero Runtime Dependencies** - Semua embedded dalam bundle
- ⚙️ **Custom Port** - Konfigurasi port via CLI atau environment variable
- 🔧 **Full CRUD Operations** - Insert, update, delete, truncate, drop
- 📝 **SQL Query Editor** - Execute raw SQL dengan result viewer
- 📊 **Table Browser** - Pagination, sorting, dan quick actions
- 🔍 **Database Explorer** - Browse databases, tables, dan structure

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

# Run dengan custom port
node dist/nodamin.js --port 8080

# Atau dengan environment variable
NODAMIN_PORT=9000 node dist/nodamin.js
```

Buka browser ke `http://localhost:3088` dan connect ke database MySQL kamu.

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

## 🗺️ Roadmap

## 🗺️ Roadmap

### Database Drivers
- [ ] **PostgreSQL** - Second priority after MySQL
- [ ] **SQLite** - File-based database support
- [ ] **MariaDB** - Should be easy since it's MySQL-compatible
- [ ] **MongoDB** - NoSQL support with collection/document view
- [ ] **Microsoft SQL Server** - Enterprise database support
- [ ] **Redis** - Key-value store browser

### Features
- [ ] **Export** - Export table/query results to CSV, JSON, SQL dump
- [ ] **Import** - Import SQL files
- [ ] **Table creation** - Create table with GUI (columns, types, constraints)
- [ ] **Alter table** - Add/modify/drop columns via GUI
- [ ] **Index management** - Create/drop indexes
- [ ] **Foreign key viewer** - View and manage foreign key relationships
- [ ] **Query history** - Save and recall previous SQL queries
- [ ] **Multiple connections** - Save and switch between database connections
- [ ] **Dark/Light theme toggle**
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
