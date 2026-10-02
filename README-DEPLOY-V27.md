# TREE PS V27 — Single Vercel Project

One Vercel project. No backend/frontend folders.

Structure:
- api/[...path].ts — Fastify-backed API catch-all
- api/health.ts — health check
- api/auth/version.ts — routing/auth diagnostic
- src/main.tsx — Vite/React UI
- src/server.ts — Fastify application and routes

Vercel:
- Root Directory: repository root
- Build Command: npm run build
- Output Directory: dist

Environment variables:
- DATABASE_URL
- TREE_PS_SHARED_SECRET
- TREE_PS_ADMIN_EMAILS
- NODE_ENV=production

API checks:
- /health
- /api
- /api/auth/version
