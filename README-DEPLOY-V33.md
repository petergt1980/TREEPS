# TREE PS V33

Single Vercel project. Production API uses the same-origin `/api/index?path=...` gateway.
Do not configure VITE_API_URL or a second backend project.

Environment variables: DATABASE_URL, TREE_PS_SHARED_SECRET, TREE_PS_ADMIN_EMAILS, NODE_ENV=production.

After deploy test:
- /health
- /api/auth/version
- /api/index?path=/api/auth/register (POST only)
