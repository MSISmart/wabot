import type { OutMsg } from "./types";

const PLATFORM = "https://api.kapso.ai/platform/v1";
const META = "https://api.kapso.ai/meta/whatsapp/v24.0";
export const WEBHOOK_EVENTS = [
  "whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered",
  "whatsapp.message.read", "whatsapp.message.failed",
];

export const kapsoConfigured = () => !!process.env.KAPSO_API_KEY;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.KAPSO_API_KEY;
  if (!key) throw new Error("KAPSO_API_KEY לא מוגדר");
  const res = await fetch(url, {
    ...init,
    headers: { "X-API-Key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Builds the WhatsApp Cloud API payload. WhatsApp limits are enforced here so the engine never has to think about them. */
export function toWhatsAppPayload(to: string, m: OutMsg) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (m.type) {
    case "text":
      return { ...base, type: "text", text: { body: clip(m.text, 4096), preview_url: false } };
    case "buttons":
      return {
        ...base, type: "interactive",
        interactive: {
          type: "button", body: { text: clip(m.text, 1024) },
          action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: clip(b.title, 20) } })) },
        },
      };
    case "list":
      return {
        ...base, type: "interactive",
        interactive: {
          type: "list", body: { text: clip(m.text, 1024) },
          action: {
            button: clip(m.button, 20),
            sections: [{
              title: clip(m.button, 24),
              rows: m.rows.slice(0, 10).map((r) => ({
                id: r.id, title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}),
              })),
            }],
          },
        },
      };
    case "template":
      return {
        ...base, type: "template",
        template: {
          name: m.name, language: { code: m.language },
          ...(m.params.length ? { components: [{ type: "body", parameters: m.params.map((t) => ({ type: "text", text: t })) }] } : {}),
        },
      };
  }
}

export async function kapsoSend(phoneNumberId: string, to: string, m: OutMsg) {
  const r = await call<{ messages?: { id: string }[] }>(`${META}/${phoneNumberId}/messages`, {
    method: "POST", body: JSON.stringify(toWhatsAppPayload(to, m)),
  });
  return r.messages?.[0]?.id ?? null;
}

export async function kapsoCreateCustomer(name: string, externalId: string) {
  const r = await call<{ data: { id: string } }>(`${PLATFORM}/customers`, {
    method: "POST", body: JSON.stringify({ customer: { name, external_customer_id: externalId } }),
  });
  return r.data.id;
}

export async function kapsoCreateSetupLink(customerId: string, successUrl: string, failureUrl: string) {
  const r = await call<{ data: { url: string } }>(`${PLATFORM}/customers/${customerId}/setup_links`, {
    method: "POST",
    body: JSON.stringify({ setup_link: { success_redirect_url: successUrl, failure_redirect_url: failureUrl } }),
  });
  return r.data.url;
}

export async function kapsoRegisterWebhook(phoneNumberId: string, url: string, secret: string) {
  await call(`${PLATFORM}/whatsapp/phone_numbers/${phoneNumberId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ whatsapp_webhook: { kind: "kapso", url, events: WEBHOOK_EVENTS, secret_key: secret } }),
  });
}
