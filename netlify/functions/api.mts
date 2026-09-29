import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../../src/server";

function headersFromRequest(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

async function toIncomingRequest(request: Request): Promise<{ url: string; method: string; headers: Record<string,string>; body?: Buffer }> {
  const url = new URL(request.url);
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : Buffer.from(await request.arrayBuffer());

  return {
    url: `${url.pathname}${url.search}`,
    method: request.method,
    headers: headersFromRequest(request),
    body,
  };
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const incoming = await toIncomingRequest(request);
    const result = await app.inject({
      method: incoming.method as any,
      url: incoming.url,
      headers: incoming.headers,
      ...(incoming.body !== undefined ? { payload: incoming.body } : {}),
    });

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.headers)) {
      if (value !== undefined) responseHeaders.set(key, String(value));
    }

    return new Response(result.rawPayload, {
      status: result.statusCode,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[TREE PS] Netlify API error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        code: "TREE_PS_API_RUNTIME_ERROR",
        message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }
}

// Keep these imports referenced so Netlify's TypeScript bundler treats this as
// a Node-compatible function entrypoint without requiring lambda callback APIs.
void (undefined as unknown as IncomingMessage);
void (undefined as unknown as ServerResponse);
