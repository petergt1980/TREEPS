# TREE PS — Netlify deployment

This project is a Vite frontend with a Fastify API exposed through one Netlify Function.

## Netlify

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
