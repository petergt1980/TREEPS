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

function routedPath(req: IncomingMessage): string {
  const raw = req.url || "/api";
  try {
    const url = new URL(raw, "https://tree-ps.local");
    const path = url.searchParams.get("path");
    if (path) return path.startsWith("/") ? path : `/${path}`;
    return url.pathname;
  } catch {
    return raw.split("?")[0] || "/api";
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const mod = await import("../src/server");
    const app = mod.default;
    const body = await readBody(req);
    const method = (req.method || "GET").toUpperCase();
    const path = routedPath(req);

    await app.ready();
    const result = await app.inject({
      method: method as any,
      url: path,
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
    console.error("TREE PS API invocation failed:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        success: false,
        code: "FUNCTION_INIT_FAILED",
        message
      }));
    }
  }
}
