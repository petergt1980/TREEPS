# TREE PS V35

Single Vercel project. No backend/frontend folders.

## Production API
The frontend is intentionally configured to call the last verified working Vercel deployment directly:
`https://gtpstreps-q83dsvlyb-petergts-projects-38342bf6.vercel.app`

The browser console prints `[TREE-PS V35] API ORIGIN:` and sets `window.__TREE_PS_BUILD__ = "V35"`.

After deployment, open DevTools Console and confirm `TREE-PS V35`. Register/Login Network requests must go to the deployment URL above, not `/api/...` on the website domain.

This is a temporary bridge until the production domain alias is repaired.
