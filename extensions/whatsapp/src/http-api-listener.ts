// Whatsapp plugin module implements HTTP API active listener behavior.
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";
import type { WhatsAppConnectionControllerHandle } from "./connection-controller-registry.js";
import type { ActiveWebListener } from "./inbound/types.js";

export type WhatsAppHttpApiConfig = {
  accessToken: string;
  apiRoot: string;
};

function readString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
}

function joinUrl(root: string, path: string): string {
  return `${root.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

async function postWhatsAppHttpApiJson(params: {
  accessToken: string;
  auditContext: string;
  body: Record<string, unknown>;
  url: string;
}): Promise<Record<string, unknown>> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    init: {
      body: JSON.stringify(params.body),
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
    policy: { allowPrivateNetwork: true },
    auditContext: params.auditContext,
  });
  try {
    const rawBody = await response.text();
    const parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    if (!response.ok) {
      throw new Error(`WhatsApp HTTP API request failed with HTTP ${response.status}: ${rawBody}`);
    }
    return parsed;
  } finally {
    await release();
  }
}

export function resolveWhatsAppHttpApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppHttpApiConfig | null {
  const apiRoot = env.WHATSAPP_API_ROOT?.trim();
  const accessToken =
    env.WHATSAPP_ACCESS_TOKEN?.trim() || env.OPENCLAW_WHATSAPP_ACCESS_TOKEN?.trim();
  if (!apiRoot || !accessToken) {
    return null;
  }
  return { accessToken, apiRoot };
}

export function createWhatsAppHttpApiActiveListener(
  config: WhatsAppHttpApiConfig,
): ActiveWebListener {
  return {
    async sendMessage(to, text, mediaBuffer, mediaType) {
      if (mediaBuffer || mediaType) {
        throw new Error("WhatsApp HTTP API listener supports text sends only.");
      }
      const body = await postWhatsAppHttpApiJson({
        accessToken: config.accessToken,
        auditContext: "whatsapp-http-api-send",
        body: {
          messaging_product: "whatsapp",
          text: { body: text },
          to,
          type: "text",
        },
        url: joinUrl(config.apiRoot, "messages"),
      });
      const messageId =
        readString((body.messages as Array<{ id?: unknown }> | undefined)?.[0]?.id) ??
        readString(body.messageId) ??
        "unknown";
      return {
        kind: "text",
        messageId,
        keys: [
          {
            fromMe: true,
            id: messageId,
            remoteJid: to,
          },
        ],
        providerAccepted: messageId !== "unknown",
      };
    },
    async sendComposingTo() {
      await postWhatsAppHttpApiJson({
        accessToken: config.accessToken,
        auditContext: "whatsapp-http-api-presence",
        body: { presence: "composing" },
        url: joinUrl(config.apiRoot, "presence"),
      });
    },
    async sendPoll() {
      throw new Error("WhatsApp HTTP API listener does not support poll sends yet.");
    },
    async sendReaction() {
      throw new Error("WhatsApp HTTP API listener does not support reaction sends yet.");
    },
  };
}

export function createWhatsAppHttpApiConnectionController(
  config: WhatsAppHttpApiConfig,
): WhatsAppConnectionControllerHandle {
  const listener = createWhatsAppHttpApiActiveListener(config);
  return {
    getActiveListener: () => listener,
    getCurrentSock: () => null,
    getSelfIdentity: () => null,
  };
}
