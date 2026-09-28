# TREE PS V32 — direct API origin fix

The production frontend calls the known-good Vercel deployment URL directly for `/api/*` so login/register do not depend on the broken `gtpstreps.vercel.app` alias.

Known-good API origin:
`https://gtpstreps-q83dsvlyb-petergts-projects-38342bf6.vercel.app`

After deployment, use the normal site URL for the UI. If the deployment-specific URL is ever retired, update `API_BASE` in `src/main.tsx` to the new working deployment URL.
