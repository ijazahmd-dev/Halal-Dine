# Halal Dine Architecture Documentation

## 1. System Overview

Halal Dine is built as a unified monorepo containing three deployable applications:

- **Mobile Application (`apps/mobile`)**: Single Expo/React Native cross-platform application for customers and restaurant owners ("My Business" unlocked on verification).
- **Web Application (`apps/web`)**: Next.js App Router project containing both public landing/SEO pages (`src/app/(public)`) and protected Admin Console (`src/app/(admin)`).
- **Backend API (`apps/api`)**: NestJS modular monolith providing REST APIs, OpenAPI/Swagger documentation, and PostGIS geospatial operations.

## 2. Monorepo Organization

Shared domain logic, validation, pure utilities, and typed contracts live in the `packages/` directory:

- `@halal-dine/contracts`: Shared TypeScript interfaces and domain enums.
- `@halal-dine/validation`: Cross-platform Zod schemas.
- `@halal-dine/utils`: Pure geodetic calculations (Haversine) and string helpers.
- `@halal-dine/api-client`: Universal typed fetch client.
- `@halal-dine/config`: Base TypeScript and linting configs.

## 3. Geospatial Architecture (PostGIS)

Discovery searches rely on PostgreSQL with PostGIS extensions:

- Coordinates are stored as `latitude` and `longitude` in the `Restaurant` table.
- A PostGIS `geometry(Point, 4326)` column with a GIST index provides sub-millisecond proximity queries.
- Radius filtering and distance calculations are performed inside PostgreSQL using `ST_DWithin` and `ST_Distance`.
