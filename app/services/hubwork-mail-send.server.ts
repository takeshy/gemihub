import type { gmail_v1 } from "googleapis";
import { validateEmailHeader } from "~/utils/security";

/**
 * Send an HTML email through Gmail. Plain-text-only flow or multipart alternative
 * is intentionally omitted: Hubwork recipients are users who asked for the link,
 * and simpler raw messages reduce spam-filter friction.
 */
export async function sendHtmlEmail(
  gmailClient: gmail_v1.Gmail,
  { to, subject, html }: { to: string; subject: string; html: string },
): Promise<void> {
  validateEmailHeader(to, "to");
  validateEmailHeader(subject, "subject");

  const subjectEncoded = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ];
  const rawMessage = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmailClient.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });
}
