TREE-PS V38

Vercel deployment fix:
- Uses the standard root /api directory with explicit Vercel Functions for each API route.
- Removes the broad catch-all function and old external rewrite approach.
- Framework preset is left as Other (framework: null) so Vercel can deploy the /api functions independently of the Vite static output.
- Frontend production API remains same-origin at /api/* .

Deploy from the repository root. After deployment, test /api/auth/version and /api/config/site.
