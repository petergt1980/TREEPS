import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    success: true,
    version: "TREE-AUTH-V27",
    register: true,
    login: true,
    link: true,
    runtime: "vercel"
  }));
}
