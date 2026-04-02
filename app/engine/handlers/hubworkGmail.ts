import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";
import { validateEmailHeader } from "~/utils/security";

export async function handleGmailSendNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext
): Promise<void> {
  if (!serviceContext.hubworkGmailClient) {
    throw new Error("Hubwork Gmail is not configured. Enable Hubwork and connect Gmail.");
  }

  const to = replaceVariables(node.properties["to"] || "", context);
  const subject = replaceVariables(node.properties["subject"] || "", context);
  const body = replaceVariables(node.properties["body"] || "", context);

  if (!to) throw new Error("gmail-send: 'to' property is required");
  if (!subject) throw new Error("gmail-send: 'subject' property is required");

  validateEmailHeader(to, "to");
  validateEmailHeader(subject, "subject");

  // Body is Base64-encoded with Content-Transfer-Encoding: base64,
  // which prevents any MIME boundary injection regardless of body content.
  const messageParts = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ];
  const rawMessage = messageParts.join("\r\n");
  const encodedMessage = Buffer.from(rawMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await serviceContext.hubworkGmailClient.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, res.data.id || "sent");
  }
}
