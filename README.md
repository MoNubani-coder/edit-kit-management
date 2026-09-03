# Edit Kit Management System

Internal web application replacing the paper **External Editing Kit — Handover
and Return** form. Manages equipment kits issued to editors, records every item
and accessory at handover and return, captures editor and engineer signatures,
tracks issues, and generates handover/return reports.

Everything the paper form hard-codes — equipment groups, accessories, software,
checklist rows — is **data** here. Administrators build new kits and templates
from the UI; no deployment required.

## Stack

Next.js 16 (App Router) · TypeScript (strict) · PostgreSQL 16 · Prisma 7 ·
Tailwind CSS 4 · shadcn/ui · React Hook Form + Zod · Auth.js v5 · Docker

## Quick start

```powershell
cp .env.example .env          # then set AUTH_SECRET (see the file for how)
npm install
npm run db:up                 # PostgreSQL via Docker Compose
npm run db:migrate
npm run db:seed               # prints the sign-in accounts once
npm run dev                   # http://localhost:3000
```

Requires Node.js ≥ 22.12 (LTS). Prisma 7 will not install on odd-numbered
(non-LTS) Node releases.

## Documentation

| Document | Contents |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Current status, setup, what to test, next steps — **start here** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, ER model, decisions, risks |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The 13 delivery phases |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run check` | Typecheck + lint |
| `npm run build` | Production build (standalone output) |
| `npm run db:migrate` | Apply migrations (dev) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:studio` | Prisma Studio |
| `npm run setup` | install → db up → migrate → seed |

## Project status

**Phase 1 of 13 — Architecture and database schema.** See
[DEVELOPMENT.md](DEVELOPMENT.md).
