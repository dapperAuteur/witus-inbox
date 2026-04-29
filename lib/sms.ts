import "server-only";
import { getEnv } from "./env";

// Mobile Text Alerts API. Verify endpoint + body shape against the current
// MTA dashboard when activating the key (plans/user-tasks/03-mobile-text-alerts-env.md §A.5-6).
const MTA_ENDPOINT = "https://api.mobile-text-alerts.com/send";

export interface SmsArgs {
  text: string;
  recipients?: string[];
}

export interface SmsResult {
  ok: boolean;
  detail?: string;
}

export async function sendSms(args: SmsArgs): Promise<SmsResult> {
  const env = getEnv();
  const apiKey = env.MOBILE_TEXT_ALERTS_API_KEY;
  const envRecipients = parseRecipients(env.MOBILE_TEXT_ALERTS_RECIPIENTS);
  const recipients = args.recipients ?? envRecipients;

  if (!apiKey || recipients.length === 0) {
    if (process.env.VERCEL_ENV === "production") {
      console.error(
        "[sms] refusing to send: MOBILE_TEXT_ALERTS_API_KEY or recipients missing in production"
      );
      return {
        ok: false,
        detail: "mta creds missing in production",
      };
    }
    console.warn(
      "[sms] MOBILE_TEXT_ALERTS_API_KEY or recipients missing. Dev-log fallback."
    );
    console.log("[sms:dev]", { text: args.text, recipientCount: recipients.length });
    return { ok: true, detail: "dev-log" };
  }

  try {
    const res = await fetch(MTA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: args.text,
        phoneNumbers: recipients,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, detail: `MTA ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, detail: data.id };
  } catch (err) {
    return { ok: false, detail: `MTA fetch failed: ${String(err)}` };
  }
}

function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && /^\+\d{7,15}$/.test(v));
  } catch {
    return [];
  }
}
