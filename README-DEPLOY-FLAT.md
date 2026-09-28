# TREE PS V25 — Single Vercel Project

Flat single-project layout. There is **no `backend/` or `frontend/` folder**.

```text
TREE-PS/
├── api/
│   └── [...path].ts
├── src/
│   ├── main.tsx
│   ├── server.ts
│   └── styles.css
├── lua/
├── sql/
├── index.html
├── package.json
├── vite.config.ts
└── vercel.json
```

## Vercel

Import the repository as **one Vercel project**.

- Root Directory: repository root (`.`)
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

The API is provided by the Vercel Function at `api/[...path].ts`; it forwards requests into the Fastify app using `app.inject()`. No second backend project is required.

## Environment Variables

Set these in the **same Vercel project**:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `TREE_PS_SHARED_SECRET` — permanent secret used by the Lua bridge
- `TREE_PS_ADMIN_EMAILS` — comma-separated bootstrap admin emails
- `NODE_ENV` — `production`

Do not commit `.env`.

## Lua

`lua/tree_web_link.lua` is configured to call the current TREE-PS Vercel domain:

```lua
local WEB_BASE_URL = "https://gtpstreps.vercel.app"
```

Change only that value if the Vercel production domain changes. `SHARED_SECRET` must match the Vercel environment variable exactly.

## Local development

```bash
npm install
npm run dev
```

In a second terminal:

```bash
npm run dev:server
```
