import { app } from './server';

const port = Number(process.env.PORT ?? 3000);

await app.listen({ host: '0.0.0.0', port });
console.log(`TREE PS API listening on http://localhost:${port}`);

const shutdown = async () => {
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
