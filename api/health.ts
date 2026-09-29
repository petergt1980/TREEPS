import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    service: 'tree-ps',
    runtime: 'vercel-node',
    version: 'TREE-API-V39',
    api: true,
    time: new Date().toISOString()
  }));
}
