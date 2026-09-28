# TREE PS V37 – Vercel single-project fix

## What was fixed
- Removed the old `vercel.json` rewrites that proxied `/api/*` to an old deployment URL.
- Frontend keeps production API calls same-origin (`/api/...`).
- API serverless functions remain under `/api`.
- Bumped build markers to V37 for verification.

## Deploy
1. Push this project to GitHub on the branch connected to Vercel.
2. Redeploy the latest commit.
3. Test:
   - `/api/auth/version` → JSON containing `TREE-AUTH-V37`
   - `/health` → JSON containing `TREE-API-V37`
4. Register/login from the same project domain.

Do not put an old deployment URL in `vercel.json`.
