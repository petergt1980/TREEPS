# TREE PS V29 — single Vercel project

Deploy the repository root as one Vercel project.

- Root Directory: `/`
- Framework: Vite
- Build: `npm run build`
- Output: `dist`
- No Vercel Services config.
- `/api/*` is served by `api/[...path].ts`.
- `/api/auth/version` is served directly by `api/auth/version.ts`.
- `/health` rewrites to `/api/health`.
- `src/server.ts` exports Fastify and never calls `listen()` on import.
- `src/dev-server.ts` is only for local development.

Required Vercel environment variables:
- DATABASE_URL
- TREE_PS_SHARED_SECRET
- TREE_PS_ADMIN_EMAILS
- NODE_ENV=production
