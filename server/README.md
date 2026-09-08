# StoryFlow Gallery Backend (P1)

Cloud sync for screenplays: auth (email/password + JWT/refresh rotation) and
local-first screenplay sync with immutable version history. No Docker —
installs directly on a stock Node + PostgreSQL machine.

## Stack

- Hono + @hono/node-server (HTTP)
- node-postgres (`pg`) — raw SQL, no ORM
- Node built-in crypto only for secrets: scrypt password hashing, sha256
  refresh-token hashes (HS256 JWT via `hono/jwt`)
- zod for auth-body validation; screenplay docs are validated losslessly by
  hand and stored as JSONB verbatim

## Layout

```
server/
  src/
    index.ts               entry — middleware, routes, graceful shutdown
    env.ts                 config (.env loader, no dependency)
    db.ts                  pg Pool + query/withTx helpers + migration runner
    migrations/001_init.sql  users / devices / scripts / script_versions
    lib/errors.ts            AppError → {error:{code,message,...}} envelope
    lib/password.ts          scrypt hash + refresh-token hashing
    lib/auth.ts              JWT issue/verify + requireAuth middleware
    routes/auth.ts           register/login/refresh/logout + rate limit
    routes/scripts.ts        list/create/push/get/soft-delete, revision guard
```

## API (P1 contract — mirrors `services/apiClient.ts`)

```
POST /auth/register {email,password,displayName,deviceName} → 201 {user,tokens}
POST /auth/login    {email,password,deviceName}             →     {user,tokens}
POST /auth/refresh  {refreshToken}                          →     {user,tokens}   (rotation, single use)
POST /auth/logout   {refreshToken} + Bearer                 → 204
GET    /scripts                       Bearer → CloudScript[]
POST   /scripts   {doc}               Bearer + Idempotency-Key → {id,revision}
PUT    /scripts/:id?ifMatch=N {doc}    Bearer → {revision} | 409 {error:{code,serverRevision}}
GET    /scripts/:id                   Bearer → {script,doc,revision}
DELETE /scripts/:id                   Bearer → 204 (soft delete)
GET    /health
```

`tokens = {accessToken (15 min JWT), refreshToken (opaque, 90 d, rotated)}`
Errors: `{error:{code,message,serverRevision?}}`.

## Native install (Debian/Ubuntu VPS)

```bash
# 1. Node 20+ and PostgreSQL 15+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo apt install -y postgresql

# 2. Database
sudo -u postgres psql -c "create role storyflow login password '<strong-password>'"
sudo -u postgres createdb -O storyflow storyflow

# 3. App
git clone <repo> && cd storyflow/server
npm ci
cp .env.example .env   # set DATABASE_URL, JWT_SECRET=$(openssl rand -hex 32), CORS_ORIGIN
npm run build && npm start
```

### systemd unit

```ini
# /etc/systemd/system/storyflow-gallery.service
[Unit]
Description=StoryFlow Gallery API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/storyflow/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production
User=storyflow

[Install]
WantedBy=multi-user.target
```

### Reverse proxy

Any TLS-terminating proxy works (Caddy example):

```
api.example.com {
    reverse_proxy localhost:8787
}
```

## Dev (this repo's box)

A throwaway PostgreSQL cluster already runs at port 5433 (user `bird`, trust
auth, data dir `/tmp/opencode/pgdata`):

```bash
cd server
npm install
DATABASE_URL='postgres://bird@127.0.0.1:5433/storyflow_dev' npm run dev
```

End-to-end check with curl — see `scripts/server-smoke.ts` in the repo root
(or just point the web app's `services/gallery.ts` at `http://localhost:8787`).

## Design notes

- **Revisions are the sync unit**: whole-doc JSONB per revision (immutable
  rows) → version history, rollback and conflict snapshots fall out for free.
- **Optimistic locking**: `PUT ?ifMatch=N` inside `SELECT … FOR UPDATE`;
  mismatch → 409 with `serverRevision` so the client can accept-and-overwrite.
- **Idempotent create**: `Idempotency-Key` has a partial UNIQUE index; races
  resolve to the winning script.
- **Refresh rotation**: each refresh revokes the old `devices` row; unknown
  token → 401 (device revoked server-side by logout).
- **P1 scoping**: only `owner_type='user'`, `visibility='private'`. Groups and
  public gallery arrive in P2 as additive migrations.
