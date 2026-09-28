import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../src/server";
import { URL } from "node:url";

/**
 * Single Vercel Function entrypoint for every TREE-PS API route.
 * vercel.json rewrites /api/* and /health here and passes the original
 * pathname through the __path query parameter.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const incomingUrl = new URL(req.url || "/", "http://vercel.internal");
    const forwardedPath = incomingUrl.searchParams.get("__path");
    const requestPath = forwardedPath || incomingUrl.pathname;

    // Keep the original query string except our internal routing parameter.
    const query = new URLSearchParams(incomingUrl.search);
    query.delete("__path");
    const queryString = query.toString();
    const injectUrl = queryString ? `${requestPath}?${queryString}` : requestPath;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }

    // Vercel may pre-parse JSON bodies on some requests. For raw streams,
    // Fastify can receive the body directly through app.inject payload only
    // when we buffer it here.
    let body: string | Buffer | undefined;
    const method = (req.method || "GET").toUpperCase();
    if (!["GET", "HEAD"].includes(method)) {
      const chunks: Buffer[] = [];
      for await (const chunk of req as any) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunks.length) body = Buffer.concat(chunks);
    }

    await app.ready();

    const result = await app.inject({
      method: method as any,
      url: injectUrl,
      headers,
      ...(body !== undefined ? { payload: body } : {})
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
