# Halal Dine

Halal Dine is a location-based halal restaurant discovery and verification platform, starting in Kerala, India and expanding progressively.

---

## Architecture Overview

```text
halal-dine/
├── apps/
│   ├── mobile/         # React Native + Expo (Unified Customer & Owner App)
│   ├── web/            # Next.js (Public SEO Website + Protected Admin Dashboard)
│   └── api/            # NestJS Modular Monolith + PostGIS + Swagger
├── packages/
│   ├── contracts/      # TypeScript DTOs and Enums
│   ├── api-client/     # Universal typed HTTP client
│   ├── validation/     # Zod validation schemas
│   ├── config/         # Shared TypeScript and lint configs
│   └── utils/          # Pure geospatial and formatting utilities
├── infrastructure/
│   └── docker/         # Docker Compose for PostgreSQL + PostGIS
└── docs/               # Architecture, Schema, and Policy Documentation
```

---

## Quick Start

### 1. Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Start PostgreSQL with PostGIS

```bash
pnpm run docker:up
```

### 5. Run Database Migrations

```bash
pnpm run db:migrate
```

### 6. Start Development Servers

```bash
pnpm run dev
```

- **API & Swagger Docs:** [http://localhost:3001/api/docs](http://localhost:3001/api/docs)
- **API Health Check:** [http://localhost:3001/api/health](http://localhost:3001/api/health)
- **Web App (Public):** [http://localhost:3000](http://localhost:3000)
- **Admin Dashboard:** [http://localhost:3000/admin](http://localhost:3000/admin)
- **Mobile App:** Expo CLI will launch in terminal (press `a` for Android, `i` for iOS, `w` for Web)

---

## Useful Commands

| Command                | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `pnpm run build`       | Build all shared packages and applications via Turborepo |
| `pnpm run check-types` | Typecheck all monorepo workspaces                        |
| `pnpm run format`      | Run Prettier formatter across repository                 |
| `pnpm run docker:up`   | Start local PostGIS Docker container                     |
| `pnpm run docker:down` | Stop local PostGIS Docker container                      |
| `pnpm run db:migrate`  | Run Prisma database migrations                           |
| `pnpm run db:generate` | Regenerate Prisma client                                 |
| `pnpm run db:studio`   | Launch Prisma Studio GUI                                 |

---

## Primary Specifications

Refer to [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) for complete specifications, business workflows, and development principles.
