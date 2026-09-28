import app from "../src/server";
import type { IncomingMessage, ServerResponse } from "node:http";

type VercelRequest = IncomingMessage & {
  body?: unknown;
};

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => VercelResponse;
  send: (body: unknown) => VercelResponse;
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    await app.ready();

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }

    let payload: string | Buffer | undefined;
    if (req.body !== undefined && req.body !== null) {
      payload = typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body);
    }

    const result = await app.inject({
      method: (req.method || "GET") as any,
      url: req.url || "/",
      headers,
      ...(payload !== undefined ? { payload } : {})
    });

    res.statusCode = result.statusCode;
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) res.setHeader(key, value as any);
    }
    res.end(result.rawPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TREE PS API error";
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, message }));
    }
  }
}
