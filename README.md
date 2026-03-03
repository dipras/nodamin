# ⚡ Nodamin

![Nodamin](featured.png)

**Lightweight Database Admin for Node.js** — A single-process Adminer alternative powered by Node.js and TypeScript.

Nodamin is a web-based database administration tool inspired by [Adminer](https://www.adminer.org/). Built with Node.js and TypeScript, it is compiled into a highly portable package that requires zero external configuration to run.

## ✨ Features

- 🚀 **Zero Configuration** - Instantly run via `npx` with no setup required.
- 🔌 **Multiple Database Support** - MySQL & SQLite (Available), PostgreSQL, MongoDB (Planned)
- 🎨 **Simple & Clean UI** - Toggle between Light and Dark themes.
- ⚙️ **Custom Host & Port** - Configure binding ports and hosts via CLI or environment variables.
- 🔧 **Full CRUD Operations** - Insert, update, delete, truncate, and drop tables/rows.
- 📝 **SQL Query Editor** - Execute raw SQL with an interactive result viewer.
- 📊 **Table Browser** - Discover tables with pagination, sorting, and quick actions.
- 🔍 **Database Explorer** - Browse databases, tables, and structures easily.
- 📦 **Export/Import** - Export database/table to SQL dumps, or import existing SQL files.
- ✅ **Bulk Actions** - Select multiple tables/rows for bulk operations.

## 🚀 Quick Start

The fastest and easiest way to use Nodamin is via `npx` (requires Node.js):

```bash
# Automatically download & run via npx
npx @dipras/nodamin

# Run with a custom port and host
npx @dipras/nodamin --port 8080 --host 127.0.0.1
```

Open your browser to the URL displayed in your terminal (default: `http://localhost:3088`) and connect to your MySQL or SQLite database.

<details>
<summary><b>🛠️ Install from Source (Manual)</b></summary>

```bash
# Clone repository
git clone https://github.com/dipras/nodamin.git
cd nodamin

# Install dependencies
npm install

# Build the distribution file
npm run build

# Run
npm start
```
</details>

📝 **Notes for SQLite**:
- You can upload an existing `.db` file directly via the UI.
- Selecting the **Create New** option will provision a temporary **In-Memory** database (data is lost upon server restart). This is perfect for quick testing and prototyping.

## 🛠️ Configuration & CLI Variables

Nodamin can be configured using CLI arguments or Environment Variables:

| CLI Argument | Environment Variable | Default | Description |
| :--- | :--- | :--- | :--- |
| `--port <number>` | `NODAMIN_PORT` | `3088` | Port for the web interface. |
| `--host <string>` | `NODAMIN_HOST` | `0.0.0.0` | IP Address/Host to bind the server to. |

**Example using Environment Variables:**
```bash
NODAMIN_HOST=127.0.0.1 NODAMIN_PORT=9000 npx @dipras/nodamin
```

## 🛠️ Development

```bash
# Type check
npm run typecheck

# Build single file (production)
npm run build

# Development mode with watch
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
- [x] **Connection via URL** - Support connection string format (e.g., `mysql://user:pass@host:port/db`)
- [ ] **Authentication** - Optional login to protect the admin panel
- [x] **npx support** - Run directly with `npx @dipras/nodamin`

## 📝 License

GPL-2.0 - Same as Adminer

## 🙏 Credits

Inspired by [Adminer](https://www.adminer.org/) by Jakub Vrána.

Built with Node.js, TypeScript, and ❤️
