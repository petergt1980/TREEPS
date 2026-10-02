# TREE PS V39 – Vercel API import fix

This version fixes the Vercel TypeScript build errors caused by API route files importing `_handler` from the project root.

## Fix
All API functions now import the canonical handler at `api/_handler.ts` using the correct relative path for their directory depth.

Examples:
- `api/auth/login.ts` -> `../_handler`
- `api/player/inventory.ts` -> `../_handler`
- `api/admin/gacha/[id].ts` -> `../../_handler`
- `api/admin/trading/assets/[symbol].ts` -> `../../../_handler`
- `api/markets.ts` -> `./_handler`

No root `_handler.ts` shim is required.

## Verification endpoints
- `/api/auth/version` -> `TREE-AUTH-V39`
- `/health` -> `TREE-API-V39`

Build command remains `npm run build`, which runs the Vite production build. Vercel should be able to type-check and bundle the API Functions now that their imports resolve correctly.
