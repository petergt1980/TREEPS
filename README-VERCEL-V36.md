# TREE PS V36

Single Vercel project. Production frontend uses same-origin `/api/*`. Vercel rewrites those requests to the known working API deployment, avoiding browser CORS errors. The API also explicitly supports CORS/OPTIONS for direct calls.

Deploy from repository root (`.`). No `VITE_API_URL` is needed.
