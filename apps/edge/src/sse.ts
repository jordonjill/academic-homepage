import type {
  ErrorEventPayload,
  MetaEventPayload,
  ToolEventPayload
} from "@academic-homepage/shared";

import type { Env } from "./env.ts";

const encoder = new TextEncoder();

function parseOrigin(input: string | null) {
  if (!input) {
    return null;
  }

  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export interface SseWriter {
  meta(payload: MetaEventPayload): void;
  token(text: string): void;
  tool(payload: ToolEventPayload): void;
  error(payload: ErrorEventPayload): void;
  done(requestId: string): void;
}

function encodeEvent(event: string, payload: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function createSseStream(
  handler: (writer: SseWriter) => Promise<void>
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const writer: SseWriter = {
        meta(payload) {
          controller.enqueue(encodeEvent("meta", payload));
        },
        token(text) {
          controller.enqueue(encodeEvent("token", { text }));
        },
        tool(payload) {
          controller.enqueue(encodeEvent("tool", payload));
        },
        error(payload) {
          controller.enqueue(encodeEvent("error", payload));
        },
        done(requestId) {
          controller.enqueue(encodeEvent("done", { requestId }));
        }
      };

      try {
        await handler(writer);
      } finally {
        controller.close();
      }
    }
  });
}

export function buildCorsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const requestedOrigin = parseOrigin(origin);
  const configuredOrigin = parseOrigin(env.SITE_ORIGIN ?? null);

  const allowedOrigin =
    requestedOrigin &&
    configuredOrigin &&
    isLoopbackHostname(requestedOrigin.hostname) &&
    isLoopbackHostname(configuredOrigin.hostname)
      ? requestedOrigin.origin
      : env.SITE_ORIGIN ?? origin ?? "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

export function buildSseHeaders(request: Request, env: Env): HeadersInit {
  return {
    ...buildCorsHeaders(request, env),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive"
  };
}
