import type { EmailMessage, EmailPort } from "@occasion/core";

/**
 * Resend adapter.
 *
 * One HTTP call against one endpoint, so it is written against `fetch` rather
 * than the provider's SDK. The Stripe adapter takes the opposite decision and
 * is right to: Stripe's surface here is intents, refunds, transfers, connected
 * accounts and webhook signature verification, and hand-rolling that would be
 * reimplementing a client. Sending one message is not that.
 *
 * **Every recipient is redirected to the sandbox address off production.** No
 * sending domain is verified in this milestone, so a message addressed to a
 * real customer would be refused by the provider — and a demo that mails real
 * people about demo orders is worse than one that mails nobody. The intended
 * recipient goes in the subject, so the sandbox inbox still shows who each
 * message was for. `env.ts` refuses the redirect on the production tier and
 * requires it everywhere else, which is where that guarantee actually lives.
 *
 * Consent and the merge-field allowlist are enforced in the service layer above
 * this port, not here.
 */

const ENDPOINT = "https://api.resend.com/emails";

export function createEmail(options: {
  apiKey: string;
  from: string;
  /** Where every message goes instead of its addressee, off production. */
  sandboxRecipient: string | undefined;
}): EmailPort {
  return {
    async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
      const to = options.sandboxRecipient ?? message.to;
      const subject = options.sandboxRecipient
        ? `[to: ${message.to}] ${message.subject}`
        : message.subject;

      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          // The domain's own key, derived from what the message is rather than
          // when it was tried. A retry after a timeout asks the provider to
          // finish the send it already started instead of starting a second.
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: options.from,
          to: [to],
          subject,
          html: message.html,
        }),
      });

      if (!response.ok) {
        // Thrown, not swallowed. The caller marks the send failed and the job
        // retries; reporting success here would leave a message that never went
        // out looking like one that did.
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Resend refused the message (${response.status}): ${detail.slice(0, 300) || "no detail"}`,
        );
      }

      const body: unknown = await response.json();
      const id = (body as { id?: unknown }).id;

      if (typeof id !== "string") {
        // Without the provider's id there is nothing for a delivery webhook to
        // match against, so the send would be recorded as gone and never learn
        // whether it arrived.
        throw new Error("Resend accepted the message but returned no id.");
      }

      return { providerMessageId: id };
    },
  };
}
