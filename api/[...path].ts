import app from "../src/server";
import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await app.ready();
    app.routing(req as any, res as any);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TREE PS API error";
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, message }));
    }
  }
}
