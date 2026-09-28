# TREE PS V27 - Single Vercel Project

Use the repository root as the Vercel project root. No backend/frontend subprojects.

- Vite builds `dist/`.
- `/api/*` is handled by `api/[...path].ts`.
- `/health` is handled by `api/health.ts`.
- Fastify is lazy-loaded per API invocation.
- `src/server.ts` no longer uses top-level await for CORS registration.

Environment variables on Vercel:
- DATABASE_URL
- TREE_PS_SHARED_SECRET
- TREE_PS_ADMIN_EMAILS
- NODE_ENV=production

Do not commit `.env`.
