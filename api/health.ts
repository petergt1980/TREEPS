import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: true,
    service: "tree-ps",
    runtime: "vercel-node",
    api: true,
    version: "TREE-API-V28",
    time: new Date().toISOString()
  }));
}
