# TREE PS V31 — Authentication API fallback

This version keeps the single-project structure and does not require `VITE_API_URL`.

Production browser API requests first use the same-origin `/api/...`. If the current Vercel alias responds with 404/405/5xx, the frontend retries against the known-good Vercel deployment used during the V29 verification:

`https://gtpstreps-q83dsvlyb-petergts-projects-38342bf6.vercel.app`

This specifically fixes Login/Register when the production alias is mapped to a deployment without the API function.
