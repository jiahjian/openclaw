// Whatsapp tests cover HTTP API active listener behavior.
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getActiveWebListener } from "./active-listener.js";
import { whatsappPlugin } from "./channel.js";
import {
  createWhatsAppHttpApiActiveListener,
  resolveWhatsAppHttpApiConfig,
} from "./http-api-listener.js";

const servers: http.Server[] = [];
const originalEnv = { ...process.env };

function restoreEnvValue(
  key: "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_API_ROOT" | "OPENCLAW_WHATSAPP_ACCESS_TOKEN",
) {
  if (originalEnv[key] === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = originalEnv[key];
  }
}

async function startJsonServer(
  handler: (params: {
    body: Record<string, unknown>;
    headers: http.IncomingHttpHeaders;
    path: string;
  }) => Record<string, unknown>,
): Promise<{ baseUrl: string; requests: Array<Record<string, unknown>> }> {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      const path = request.url ?? "/";
      requests.push({ body, headers: request.headers, path });
      const payload = handler({ body, headers: request.headers, path });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP server address");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}/crabline/whatsapp`, requests };
}

afterEach(async () => {
  restoreEnvValue("WHATSAPP_ACCESS_TOKEN");
  restoreEnvValue("OPENCLAW_WHATSAPP_ACCESS_TOKEN");
  restoreEnvValue("WHATSAPP_API_ROOT");
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("WhatsApp HTTP API listener", () => {
  it("resolves WhatsApp API root env only when both values are present", () => {
    expect(resolveWhatsAppHttpApiConfig({})).toBeNull();
    expect(
      resolveWhatsAppHttpApiConfig({
        WHATSAPP_ACCESS_TOKEN: "token",
        WHATSAPP_API_ROOT: "http://127.0.0.1:49152/crabline/whatsapp",
      }),
    ).toEqual({
      accessToken: "token",
      apiRoot: "http://127.0.0.1:49152/crabline/whatsapp",
    });
    expect(
      resolveWhatsAppHttpApiConfig({
        OPENCLAW_WHATSAPP_ACCESS_TOKEN: "openclaw-token",
        WHATSAPP_API_ROOT: "http://127.0.0.1:49152/crabline/whatsapp",
      }),
    ).toEqual({
      accessToken: "openclaw-token",
      apiRoot: "http://127.0.0.1:49152/crabline/whatsapp",
    });
  });

  it("sends WhatsApp text and presence requests to the API root", async () => {
    const { baseUrl, requests } = await startJsonServer(({ path }) =>
      path.endsWith("/messages")
        ? { messages: [{ id: "wamid.CRABLINE00000001" }] }
        : { presence: "composing" },
    );
    const listener = createWhatsAppHttpApiActiveListener({
      accessToken: "crabline-whatsapp-access-token",
      apiRoot: baseUrl,
    });

    await expect(
      listener.sendMessage("15551234567@s.whatsapp.net", "hello from qa"),
    ).resolves.toMatchObject({
      kind: "text",
      messageId: "wamid.CRABLINE00000001",
      providerAccepted: true,
    });
    await listener.sendComposingTo("15551234567@s.whatsapp.net");

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      body: {
        messaging_product: "whatsapp",
        text: { body: "hello from qa" },
        to: "15551234567@s.whatsapp.net",
        type: "text",
      },
      path: "/crabline/whatsapp/messages",
    });
    expect(requests[0]?.headers).toMatchObject({
      authorization: "Bearer crabline-whatsapp-access-token",
    });
    expect(requests[1]).toMatchObject({
      body: { presence: "composing" },
      path: "/crabline/whatsapp/presence",
    });
  });

  it("registers an HTTP API active listener while the WhatsApp gateway account is running", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "crabline-whatsapp-access-token";
    process.env.WHATSAPP_API_ROOT = "http://127.0.0.1:49152/crabline/whatsapp";
    const abort = new AbortController();
    const setStatus = vi.fn();
    const task = whatsappPlugin.gateway?.startAccount?.({
      abortSignal: abort.signal,
      account: {
        accountId: "default",
      },
      accountId: "default",
      cfg: {
        channels: {
          whatsapp: {
            enabled: true,
          },
        },
      },
      getStatus: () => ({}),
      log: { info: vi.fn() },
      runtime: {},
      setStatus,
    } as never);

    await expect(
      new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const interval = setInterval(() => {
          if (getActiveWebListener("default")) {
            clearInterval(interval);
            resolve();
            return;
          }
          if (Date.now() - startedAt > 1_000) {
            clearInterval(interval);
            reject(new Error("HTTP API listener was not registered"));
          }
        }, 10);
      }),
    ).resolves.toBeUndefined();
    expect(setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        connected: true,
        healthState: "healthy",
        linked: true,
        running: true,
      }),
    );

    abort.abort();
    await task;
    expect(getActiveWebListener("default")).toBeNull();
  });
});
