# Pastry

> Anonymous pastebin with file storage — built on Cloudflare's global edge network.

**Live:** [paste.collacou.com](https://paste.collacou.com) &nbsp;|&nbsp; **API:** [paste-api.collacou.workers.dev](https://paste-api.collacou.workers.dev/api/v1/health)

---

## What it is

Pastry is a production-grade pastebin inspired by rentry. It supports Markdown rendering, passcode-protected permanent pastes, an anonymous guest mode, and R2-backed file uploads — all running serverlessly at the edge with zero cold starts.

It's intentionally kept scope-focused so the system design and backend engineering decisions are visible, not buried.

---

## System Design

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA — Vite, Tailwind CSS)                       │
│                                                                  │
│  1. POST /api/v1/auth/login  ──────────────────────────────────┐│
│  2. GET|POST /api/v1/entries ──────────────────────────┐       ││
│  3. POST /sign/upload ─────────────────────┐           │       ││
│  4. PUT {presigned-url} ──────┐            │           │       ││
│  5. POST /api/v1/files/confirm│            │           │       ││
└───────────────────────────────┼────────────┼───────────┼───────┘│
                                │            │           │         
         ┌──────────────────────┘            │           │         
         ▼                                  │           │         
  ┌─────────────┐   ┌──────────────────┐   │           │         
  │  Cloudflare │   │  r2-signer       │   │           │         
  │  R2 Bucket  │◄──│  Worker          │◄──┘           │         
  │  (pastry)   │   │  (auth-gated     │               │         
  └─────────────┘   │   presigned URLs)│               │         
         ▲          └──────────────────┘               │         
         │ native R2 binding (deletes)                  ▼         
         │                                   ┌──────────────────┐ 
         └───────────────────────────────────│  paste-api       │ 
                                             │  Hono Worker     │ 
                                             │                  │ 
                                             │  ├ Auth (JWT)    │ 
                                             │  ├ Rate limiting │ 
                                             │  ├ Zod schemas   │ 
                                             │  ├ Quota enforce │ 
                                             │  └ Req logging   │ 
                                             └────────┬─────────┘ 
                                                      │           
                                                      ▼           
                                             ┌──────────────────┐ 
                                             │  Cloudflare D1   │ 
                                             │  (SQLite at edge)│ 
                                             └──────────────────┘ 
```

### Upload flow (3-step, server-verified)

```
Client                   r2-signer Worker          paste-api Worker        R2
  │                            │                         │                  │
  │── POST /sign/upload ───────►                         │                  │
  │   { key, Bearer token }    │                         │                  │
  │   ◄── { presignedPutUrl } ─│                         │                  │
  │                            │                         │                  │
  │── PUT presignedPutUrl ───────────────────────────────────────────────► │
  │   (file bytes, direct)     │                         │     stored       │
  │                            │                         │                  │
  │── POST /api/v1/files/confirm ───────────────────────►│                  │
  │                            │   R2_BUCKET.head(key) ──────────────────► │
  │                            │                         │◄── exists        │
  │                            │         quota check D1 ─│                  │
  │◄── { file record } ─────────────────────────────────│                  │
```

**Why this matters:** Metadata is only inserted after the server independently verifies the object exists in R2. This prevents phantom records from failed or spoofed uploads. Quota is enforced server-side — the client-side check is UI-only.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + Vite | Fast HMR, tree-shaking, optimised bundle |
| Styling | Tailwind CSS | Utility-first, zero runtime CSS |
| API | Hono on Cloudflare Workers | 0ms cold start, typed routes, middleware pipeline |
| Database | Cloudflare D1 (SQLite) | Serverless SQL, globally replicated reads |
| File Storage | Cloudflare R2 | S3-compatible, zero egress fees |
| Auth | HMAC-SHA256 JWT (Web Crypto API) | Stateless, no external auth service |
| Validation | Zod v4 | Parse-don't-validate, runtime type safety |

---

## Backend Engineering Decisions

### Authentication
Token-based sessions using HMAC-SHA256 JWTs signed with the Web Crypto API (no `crypto` Node module — runs natively in the CF edge runtime). Tokens are 7-day rolling, verified on every protected endpoint. Passcodes are never stored in cookies or sent in URLs.

### Rate Limiting
Sliding-window in-memory rate limiter per IP:
- `120 req/min` on all `/api/*` routes
- `10 req/15min` on `/api/v1/auth/*` — brute-force protection

### Input Validation
All mutation endpoints use Zod v4 schemas at the route level via `@hono/zod-validator`. Keys written to R2 are validated against a strict regex allowlist on the signer worker, preventing path traversal and bucket pollution.

### Observability
Every request is stamped with a `crypto.randomUUID()` request ID, returned as `X-Request-Id` and embedded in structured JSON log lines:

```json
{
  "requestId": "f3a2...",
  "method": "POST",
  "path": "/api/v1/entries",
  "status": 200,
  "durationMs": 42,
  "ip": "1.2.3.4",
  "timestamp": "2026-03-30T16:00:00.000Z"
}
```

### Security Surface
| Threat | Mitigation |
|---|---|
| Credential exposure | R2 keys never touch the browser; `VITE_` prefix never used for secrets |
| Bucket pollution | Key regex allowlist on r2-signer before signing |
| Unauthenticated DELETE | Presigned DELETEs removed; server uses native R2 binding after ownership check |
| Client-side quota bypass | Quota re-enforced on `POST /files/confirm` against live D1 data |
| Brute-force | 10 req/15min on auth endpoint |
| Phantom file records | `R2_BUCKET.head(key)` verifies upload before D1 insert |

---

## Project Structure

```
paste/
├── src/                        # React frontend
│   ├── lib/
│   │   ├── api.js              # Typed fetch wrapper → paste-api
│   │   └── r2.js              # Upload/download URL helpers → r2-signer
│   ├── components/
│   │   ├── R2UploadPanel.jsx   # 3-step upload, progress, server-confirm
│   │   └── FileManager.jsx     # Modal shell
│   └── pages/
│       ├── Paste.jsx           # Editor (admin + guest mode)
│       ├── StaticPaste.jsx     # Public view with Markdown rendering
│       └── Landing.jsx         # Mode selection + JWT auth
│
└── workers/
    ├── api/                    # paste-api — main Hono backend
    │   ├── src/
    │   │   ├── index.js        # Routes + rate limiting + error handler
    │   │   ├── middleware.js   # Auth, request logging, JWT sign/verify
    │   │   ├── schemas.js      # Zod v4 validation schemas
    │   │   └── errors.js       # ApiError class + error codes
    │   ├── schema.sql          # D1 schema with indexes + triggers
    │   └── wrangler.toml
    │
    └── r2-signer/              # Standalone URL signer worker
        ├── src/worker.js       # Auth-gated presigned URL generation
        └── wrangler.toml
```

---

## Running Locally

```bash
# Install frontend deps
npm install

# Start frontend dev server
npm run dev

# In a separate terminal — start API worker locally
cd workers/api
npm install
npx wrangler dev

# In another terminal — start r2-signer locally
cd workers/r2-signer
npx wrangler dev --port 8788
```

Set your local `.env` (see `.env.example`):

```bash
VITE_API_URL=http://localhost:8787
VITE_R2_SIGNER_URL=http://localhost:8788
```

---

## Deploying

```bash
# Deploy API worker
cd workers/api
wrangler deploy

# Deploy r2-signer worker
cd workers/r2-signer
wrangler deploy

# Set secrets (do this once per worker)
wrangler secret put TOKEN_SECRET
wrangler secret put DEV_PASSCODE
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# Apply D1 schema
wrangler d1 execute paste-db --file=workers/api/schema.sql --remote
```

---

## Schema

```sql
CREATE TABLE entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  content     TEXT DEFAULT '',
  passcode    TEXT,
  is_guest    INTEGER DEFAULT 0,
  views       INTEGER DEFAULT 0,
  expires_at  TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  file_url   TEXT NOT NULL,
  file_name  TEXT NOT NULL,
  file_size  INTEGER NOT NULL,
  key        TEXT UNIQUE,
  owner      TEXT,
  is_guest   INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Indexes on `slug`, `passcode`, `is_guest`, `expires_at`, `entry_id`. Auto-update trigger on `updated_at`.

---

## API Reference

```
POST   /api/v1/auth/login          Login, returns JWT
GET    /api/v1/health              DB connectivity check
GET    /api/v1/entries/me          Get own entry (auth required)
GET    /api/v1/entries/:slug       Get entry by slug (public)
POST   /api/v1/entries             Create or update entry
DELETE /api/v1/entries/:id         Delete entry (auth + ownership)
PATCH  /api/v1/entries/:id/clear   Clear content (auth + ownership)
POST   /api/v1/files/confirm       Verify R2 upload + insert metadata
DELETE /api/v1/files/key/:key      Delete file (auth + ownership + R2)
DELETE /api/v1/files/:id           Delete file (auth + ownership + R2)
GET    /api/v1/stats               Storage usage summary
POST   /api/v1/entries/:slug/views Increment view counter

# r2-signer worker
POST   /sign/upload                Get presigned PUT URL (auth or guest)
POST   /sign/download              Get presigned GET URL (auth only)
GET    /health                     Signer health check
```

---

*Built by [Ulric Collaco](https://github.com/collacou)*
