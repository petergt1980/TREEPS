# TREE-PS — Single-Project Vercel Layout

This version intentionally has **no `backend/` or `frontend/` directories**.

## Layout
```text
TREE-PS/
├── api/
│   └── [...path].ts
├── src/
│   ├── main.tsx
│   ├── styles.css
│   └── server.ts
├── lua/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vercel.json
```

## Vercel
Import this repository as a normal Vite project. Do not use Services.

Environment Variables:
- `DATABASE_URL` = Neon PostgreSQL connection string
- `TREE_PS_SHARED_SECRET` = same secret used by the Lua link script
- `TREE_PS_ADMIN_EMAILS` = comma-separated admin emails
- `NODE_ENV` = `production`

The frontend calls `/api/...` on the same domain. The catch-all Vercel Function in `api/[...path].ts` forwards those requests to the Fastify app.

## Local
```bash
npm install
npm run dev
```
In a second terminal, if you want the API separately while developing:
```bash
npm run dev:server
```
