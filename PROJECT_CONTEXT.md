# PROJECT CONTEXT — HALAL DINE

This document serves as the primary source of truth for Halal Dine's product vision, architecture, technology stack, business workflows, and development principles.

---

## 1. PROJECT OVERVIEW

- **Project Name:** Halal Dine
- **Initial Target Market:** Kerala, India.
- **Long-Term Vision:** Expand across India and potentially international markets.

Halal Dine is a location-based halal restaurant discovery and verification platform. The primary objective is to help people discover restaurants serving halal food and understand the credibility of their halal claims.

Unlike conventional restaurant discovery platforms, Halal Dine's primary differentiator is its **halal verification and transparency system**.

### Customer Capabilities

- Discover nearby restaurants via geolocation.
- Search restaurants by name, city, district, or location.
- Explore restaurants through interactive map and list views.
- View restaurant profiles, photos, menus, and opening hours when available.
- Understand the restaurant's halal verification status with clear badge signifiers.
- View detailed verification information and relevant supporting evidence.
- Get turn-by-turn directions through Google Maps integration.
- Save favorite restaurants to user profile.
- Report incorrect or outdated information.
- Suggest missing restaurants to be added to the platform.

### Business & Administration Capabilities

- Restaurant owners can claim their business listing, manage profiles/menus, and submit halal verification applications with supporting documents.
- Administrators independently review ownership claims, halal verification applications, community reports, and data audit trails.

> **Core Value Proposition:** Trustworthy halal information, not simply restaurant listings.

---

## 2. FINAL ARCHITECTURAL DECISIONS

The architecture is locked to exactly **three deployable applications** within a unified monorepo:

### Application 1: Customer & Owner Mobile Application

- **Stack:** React Native, Expo, TypeScript.
- **Scope:** Customer discovery and dining features.
- **Important:** Restaurant owner management functionality ("My Business") lives inside this **same** mobile app, conditionally unlocked based on verified owner permissions. There is **no separate restaurant owner mobile app**.

### Application 2: Unified Web Application (Public + Admin)

- **Stack:** Next.js (App Router), React, TypeScript.
- **Scope:**
  1. **Public-facing website:** Landing pages, platform overview, verification methodology, SEO-optimized district/city/restaurant pages, FAQ, legal pages.
  2. **Protected Admin Dashboard:** Verification queue, ownership review, restaurant management, reports, user management, and audit logs.
- Separate route groups (`(public)` and `(admin)`), distinct layouts, navigation, and role-based middleware guards, housed within one Next.js project. There is **no separate Next.js project for admin**.

### Application 3: Backend API

- **Stack:** Node.js, NestJS, TypeScript, REST API, Swagger/OpenAPI.
- **Scope:** Central API service powering both mobile app and web frontend. Modular monolith architecture.

### Database & Geospatial Engine

- **Engine:** PostgreSQL with PostGIS extension.
- **ORM:** Prisma ORM.
- **Capabilities:** Native PostGIS spatial queries, radius/bounding-box discovery, ST_DWithin/ST_Distance calculations, and spatial indexing (GIST).

### Monorepo & Tooling

- **Package Manager:** pnpm workspaces.
- **Monorepo Build Orchestration:** Turborepo.
- **Shared Packages:** API contracts, typed client, validation schemas, shared configuration, and utility functions.

---

## 3. MONOREPO STRUCTURE

```text
halal-dine/
│
├── apps/
│   ├── mobile/                         # React Native + Expo (Customer + Owner)
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   ├── (tabs)/                 # Customer navigation
│   │   │   ├── restaurant/             # Restaurant details
│   │   │   ├── search/
│   │   │   ├── favorites/
│   │   │   ├── business/               # Owner dashboard ("My Business")
│   │   │   ├── ownership/              # Ownership claims
│   │   │   ├── verification/           # Halal verification submission
│   │   │   ├── profile/
│   │   │   └── _layout.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── store/
│   │   ├── assets/
│   │   ├── types/
│   │   ├── app.json
│   │   └── package.json
│   │
│   ├── web/                            # Next.js (Public Site + Admin Dashboard)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (public)/           # Public website and SEO pages
│   │   │   │   ├── (admin)/            # Protected admin dashboard
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── lib/
│   │   │   └── types/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── api/                            # NestJS Modular Monolith
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── users/
│       │   │   ├── restaurants/
│       │   │   ├── ownership/
│       │   │   ├── verification/
│       │   │   ├── discovery/
│       │   │   ├── menus/
│       │   │   ├── favorites/
│       │   │   ├── reports/
│       │   │   ├── reviews/
│       │   │   ├── notifications/
│       │   │   ├── subscriptions/
│       │   │   ├── promotions/
│       │   │   ├── integrations/
│       │   │   │   ├── google-places/
│       │   │   │   └── apify/
│       │   │   └── admin/
│       │   ├── common/
│       │   ├── config/
│       │   ├── database/
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── test/
│       └── package.json
│
├── packages/
│   ├── contracts/                      # Shared DTOs and API contracts
│   ├── api-client/                     # Typed API client (fetch/axios)
│   ├── validation/                     # Shared Zod / class-validator schemas
│   ├── config/                         # Shared ESLint, TSConfig, Prettier
│   └── utils/                          # Shared pure utilities (formatting, geo helpers)
│
├── infrastructure/
│   ├── docker/                         # Docker compose for local Postgres+PostGIS
│   └── deployment/
│
├── docs/
│   ├── architecture.md
│   ├── database-schema.md
│   ├── api-design.md
│   ├── halal-verification-policy.md
│   └── security.md
│
├── .github/
│   └── workflows/
│
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── .gitignore
└── README.md
```

---

## 4. USER ROLES AND PERMISSIONS

### A. Customers

- Browse and search restaurants without forced sign-up.
- Filter by district, city, cuisine, and halal status.
- View restaurant details, halal verification proofs, menus, and directions.
- Authenticated customers can save favorites, submit restaurant suggestions, report inaccuracies, and initiate an ownership claim.

### B. Restaurant Owners

- Same user account type as customers, augmented with verified ownership permissions for one or more restaurants.
- Unlocks the "My Business" module inside the mobile app:
  - Restaurant profile management (description, hours, contact).
  - High-resolution photo gallery uploads.
  - Menu catalog management.
  - Halal verification application submission and evidence management.
  - Verification status tracking & audit communication.
  - Future: Subscriptions and sponsored promotions.
- Strict authorization: Users can only manage restaurants where they have an `APPROVED` ownership relation in the backend.

### C. Administrators and Verifiers

- Access the protected Admin Dashboard in Next.js via MFA and role-based permissions.
- Review and verify business ownership claims.
- Review halal verification cases, examine documents/certificates, request additional evidence, approve or reject applications.
- Manage restaurant data, manual overrides, and scraper synchronization flags.
- Handle user reports and flags.
- Monitor audit logs and track verification expiration cycles.

---

## 5. RESTAURANT OWNERSHIP VERIFICATION WORKFLOW

Restaurants can exist in the platform as unclaimed records (ingested or suggested).

1. Customer locates their restaurant and taps "Claim this restaurant".
2. Authentication prompt if guest.
3. Owner submits claim with:
   - Business identification (trade license, GSTIN, FSSAI registration in India).
   - Owner/representative proof of identity.
   - Contact phone & email verification.
   - Additional utility or premise documentation.
4. Claim transitions to `PENDING` status.
5. Admin/Verifier inspects documentation via Admin Dashboard.
6. Actions available: `APPROVE`, `REJECT`, `REQUEST_INFO`.
7. Once `APPROVED`, the user is granted the `RESTAURANT_OWNER` relationship for that specific restaurant entity.
8. The mobile app dynamically exposes the "My Business" management dashboard.

**Security Constraints:**

- No self-approval.
- No editing rights granted prior to formal approval.
- Every ownership operation validated server-side by checking the `RestaurantOwner` junction entity against the authenticated user's ID.
- Ownership is strictly segregated from halal verification.

---

## 6. HALAL VERIFICATION SYSTEM

The halal verification system is the central trust pillar of Halal Dine.

### Verification Status Enum

- `VERIFIED_HALAL`: Independently verified by Halal Dine verifiers against valid certification or formal verification policy.
- `RESTAURANT_CLAIMS_HALAL`: The owner asserts halal compliance, but third-party proof is unverified or under validation.
- `VERIFICATION_PENDING`: Verification application has been submitted and is actively being reviewed.
- `UNVERIFIED`: Ingested restaurant without explicit halal claim or verification.
- `VERIFICATION_EXPIRED`: Previously verified, but certificate/audit validity has lapsed without renewal.
- `REPORT_UNDER_REVIEW`: Verification suspended or under re-examination due to credible consumer or community reports.

### Operational Principles

1. **Separation of Concerns:** Business ownership approval $\neq$ Halal verification.
2. **Independent Human Decision:** AI or OCR may parse certificates, but a human verifier must authorize `VERIFIED_HALAL` status.
3. **Auditability:** Every transition, evidence document, expiry date, and verifier note is permanently logged in a verification history audit table.
4. **No Pay-for-Verification:** Subscriptions and promotional tiers must never alter or expedite verification outcomes.
5. **Immediate Application:** Owners can apply for verification immediately upon ownership approval.

---

## 7. RESTAURANT DISCOVERY AND DATA INGESTION

### Geographic Focus

Initial target: **Kerala, India**, rolling out district-by-district (e.g., Ernakulam, Kozhikode, Malappuram, Thiruvananthapuram).

### Data Strategy

1. **Primary Database (PostgreSQL + PostGIS):**
   - Serves all consumer discovery queries.
   - Spatial queries using PostGIS functions (`ST_DWithin`, `ST_Distance`) with spatial GIST indexes on coordinates (`geometry(Point, 4326)`).
   - District and municipal boundary awareness.

2. **Google Places API:**
   - On-demand fallback search when local database queries return insufficient results.
   - Auto-complete place search and Google Place ID resolution.
   - Google Maps turn-by-turn navigation deep links.

3. **Apify Scraper (`compass/crawler-google-places`):**
   - Scheduled district-wide discovery and bulk ingestion.
   - Ingestion Pipeline:
     - Run scraper for target district bounding box / keywords.
     - Fetch dataset via Apify REST API.
     - Normalize and validate payloads against validation schemas.
     - Upsert restaurants matching on `googlePlaceId`.
     - Flag missing records for manual verification (never hard-delete based on scraper omission).
     - Protect Halal Dine-owned attributes (verification status, owner edits, custom menus) from being overwritten by external ingestion runs.
     - Maintain an ingestion run log with counts of added, updated, and skipped records.

---

## 8. PUBLIC WEBSITE & ADMIN DASHBOARD (NEXT.JS)

### Public Experience (`apps/web/src/app/(public)`)

- High-converting landing page with app download CTAs.
- Deep-dive explainer on the Halal Verification Framework.
- SEO-optimized landing pages for Kerala districts and top cities (e.g., `/kerala/kozhikode/halal-restaurants`).
- Public restaurant profile previews with open graph metadata.
- About, Contact, FAQ, Terms, and Privacy Policy pages.

### Admin Experience (`apps/web/src/app/(admin)`)

- Authenticated route group with role-based layout and middleware guards.
- Metric overview (total listings, claims pending, verification queue, active reports).
- Ownership Claim Review queue with document preview modal.
- Halal Verification Queue with certificate inspector and decision logger.
- Restaurant Catalog manager with manual edit and scraper sync flags.
- User and role management.
- Audit log explorer.

---

## 9. BACKEND ARCHITECTURE (NESTJS)

### Modular Monolith Modules

- `auth`: JWT access tokens, refresh token rotation, password hashing (Argon2/bcrypt), session tracking.
- `users`: User profiles, role management, customer preferences.
- `restaurants`: Core restaurant CRUD, metadata, timings, attributes.
- `ownership`: Claim submissions, document upload associations, claim approvals.
- `verification`: Halal verification workflows, status transitions, certificate records, audit trail.
- `discovery`: Spatial PostGIS search, district/city filters, text search, sorting.
- `integrations/google-places`: Google Places client, reverse geocoding, fallback lookup.
- `integrations/apify`: Apify webhook/polling consumer, ingestion transformer, deduplication engine.
- `menus`: Menu sections, items, prices, dietary tags.
- `favorites`: User bookmarking and saved collections.
- `reports`: Community issue reporting and moderation queue.
- `notifications`: Push notifications (Expo/FCM) and email alerts (transactional).
- `admin`: Specialized administrator endpoints for metrics, audits, and bulk operations.
- `audit-logging`: System-wide immutable event logging for sensitive operations.

---

## 10. SECURITY & AUTHENTICATION SPECIFICATIONS

- **Unified Account:** A single user model supports Customer, Restaurant Owner, and Admin roles.
- **Mobile Auth:** Secure store (Keychain/Keystore via Expo SecureStore) for refresh tokens; short-lived JWT access tokens in memory.
- **Web Auth:** Secure, `HttpOnly`, `SameSite=Lax/Strict`, encrypted cookie sessions.
- **Document Protection:** Sensitive business certificates and ownership evidence stored in private S3 buckets. Served exclusively via short-lived pre-signed URLs after backend permission verification.
- **Data Protection:** Rate limiting (Throttler), CORS protection, Helmet security headers, strict Zod/class-validator DTO sanitization.

---

## 11. TECHNOLOGY STACK MATRIX

| Layer                 | Primary Technology                                     | Purpose                                               |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Monorepo              | pnpm + Turborepo                                       | Workspace management, shared packages, caching        |
| Mobile App            | React Native + Expo (TypeScript)                       | Universal customer and business management app        |
| Web Application       | Next.js (App Router, TypeScript)                       | Public website + Admin dashboard                      |
| Backend API           | NestJS (TypeScript)                                    | Modular REST API with Swagger/OpenAPI                 |
| Database              | PostgreSQL + PostGIS                                   | Relational data + spatial geospatial indexes          |
| ORM                   | Prisma ORM                                             | Schema migrations, typed queries, raw PostGIS queries |
| Discovery & Ingestion | Google Places API + Apify                              | Ingestion, place matching, fallback queries           |
| Object Storage        | AWS S3 (or S3-compatible MinIO)                        | Public restaurant images & private verification docs  |
| Async / Queue         | BullMQ + Redis (when needed)                           | Scraper data processing, background emails, cleanup   |
| Styling               | Tailwind CSS (Web) / NativeWind or StyleSheet (Mobile) | Consistent design systems                             |

---

## 12. DEVELOPMENT RULES

1. The architectural decisions in this document are final. Do not introduce a separate owner app or separate admin Next.js project.
2. Development proceeds incrementally: verify each layer before proceeding.
3. Every protected backend operation must be authorized server-side; never trust client-side claims.
4. Keep external scraper/API logic isolated in modular integration adapters.
5. PostGIS handles spatial queries; do not perform distance calculations in memory.
6. Preserve existing working code and comments.
7. Maintain strict TypeScript compilation across the entire monorepo.
