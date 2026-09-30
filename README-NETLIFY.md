# TREE PS — Netlify deployment

This project is a Vite frontend with a Fastify API exposed through one Netlify Function.

## Netlify

This release removes the separate Game Lock economy from the player-facing Game Hub. Games run in free-play mode. Trading uses the selected internal WL / DL / BGL / GGL wallet currency; the market page is reference data only. Gacha openings are free and do not debit the wallet.


Build command:

`npm run build`

Publish directory:

`dist`

Required environment variables are configured in the Netlify dashboard:

- `DATABASE_URL`
- `TREE_PS_SHARED_SECRET`
- `TREE_PS_ADMIN_EMAILS`

Do not commit real credentials to Git. The repository intentionally keeps `.env.example` blank.

API requests use same-origin paths such as `/api/auth/login` and `/api/config/site`.

### Admin email

Set `TREE_PS_ADMIN_EMAILS` in Netlify with the exact login email, for example `admin@example.com`. The runtime accepts comma, semicolon, space, or newline separated values. `TREE_PS_ADMIN_EMAIL`, `ADMIN_EMAILS`, and `ADMIN_EMAIL` are also accepted as aliases. Make sure the variable is available to **Functions/runtime**, not only the build environment, then redeploy.

The authenticated endpoint `/api/auth/admin-config` reports whether an admin variable is available at runtime without revealing its value.
