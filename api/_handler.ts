import type { IncomingMessage, ServerResponse } from "node:http";

function headersFrom(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { app } = await import("../src/server");
    const body = await readBody(req);
    const method = (req.method || "GET").toUpperCase();
    const url = req.url || "/api";
    const result = await app.inject({
      method: method as any,
      url,
      headers: headersFrom(req),
      ...(body !== undefined ? { payload: body } : {})
    });

    res.statusCode = result.statusCode;
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) res.setHeader(key, value as any);
    }
    res.end(result.rawPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[TREE PS] Vercel API error:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, code: "TREE_PS_API_RUNTIME_ERROR", message }));
    }
  }
}
