# TREE-PS V34

Single Vercel project. No backend/frontend split.

Important: this version uses the known-good deployment API as a server-side rewrite for `/api/*`, while the frontend also uses that API as its production base. This makes old cached frontend requests to relative `/api/...` work as well.

After deploy, test:
- https://gtpstreps.vercel.app/health
- https://gtpstreps.vercel.app/api/auth/version
- Register / Login

Do not add VITE_API_URL.
