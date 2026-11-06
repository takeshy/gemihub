import { z } from "zod";
import { dateIn } from "../shared/region.ts";
import { tr } from "../shared/i18n.ts";
export const inquiryStatusSchema = z.enum(["new", "in_progress", "waiting", "completed"]);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;
export const inquiryStatuses = inquiryStatusSchema.options;
export const inquiryChannelSchema = z.enum(["customer", "phone", "note", "email"]);
export type InquiryChannel = z.infer<typeof inquiryChannelSchema>;
export type InquiryInteraction = {
  id: string; shopId: string; inquiryId: string; kind: InquiryChannel; text: string;
  at: string; by?: string; legacy?: boolean;
  delivery?: "queued" | "sent" | "retrying" | "simulated";
  to?: string;
};
export const inquiryStatusLabel = (status: InquiryStatus) => ({ new: tr("未対応"), in_progress: tr("対応中"), waiting: tr("確認待ち"), completed: tr("対応済み") })[status];
export const inquiryChannelLabel = (kind: InquiryChannel) => ({ customer: tr("お客様からの連絡"), phone: tr("電話対応"), note: tr("社内メモ"), email: tr("メール返信") })[kind];
export const inquiryStatus = (inquiry: { status: string }): InquiryStatus =>
  inquiry.status === "completed" || inquiry.status === "replied"
    ? "completed"
    : inquiry.status === "new" || inquiry.status === "waiting" ? inquiry.status : "in_progress";
export const manualInquirySchema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1).max(100),
  email: z.union([z.literal(""), z.email()]).default(""), phone: z.string().trim().max(50).default(""),
  subject: z.string().trim().max(200).default(""), message: z.string().trim().min(1).max(5000),
  source: z.enum(["phone", "customer", "note"]).default("phone"),
}).strict();
export const inquiryInteractionSchema = z.object({ requestId: z.uuid(), kind: z.enum(["phone", "customer", "note"]), text: z.string().trim().min(1).max(5000) }).strict();
export const inquiryReplied = (inquiry: { reply: string }) =>
  !!inquiry.reply.trim();
export function inquiryReplyLabel(inquiry: { reply: string; interactions?: InquiryInteraction[] }) {
  const latest = (inquiry.interactions || []).filter(entry => entry.kind === "email").sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))[0];
  return latest?.delivery === "queued" ? tr("送信待ち") : latest?.delivery === "retrying" ? tr("送信を再試行中") : latest?.delivery === "simulated" ? tr("デモのため送信しません") : inquiryReplied(inquiry) ? tr("返信済み") : tr("未返信");
}
export type InquiryFilter = {
  showCompleted: boolean;
  query: string;
  reply: "all" | "unreplied" | "replied";
  from: string;
  to: string;
};
export function filterInquiries<
  T extends {
    id: string;
    status: string;
    reply: string;
    name: string;
    email: string;
    message: string;
    at?: string;
    subject?: string;
    phone?: string;
    interactions?: InquiryInteraction[];
  },
>(inquiries: T[], filter: InquiryFilter, timeZone = "Asia/Tokyo"): T[] {
  const query = filter.query.trim().toLowerCase();
  return inquiries
    .filter((inquiry) => {
      if (!filter.showCompleted && inquiryStatus(inquiry) === "completed")
        return false;
      if (
        filter.reply !== "all" &&
        inquiryReplied(inquiry) !== (filter.reply === "replied")
      )
        return false;
      if (
        query &&
        ![inquiry.name, inquiry.email, inquiry.phone || "", inquiry.subject || "", inquiry.message, inquiry.reply, ...(inquiry.interactions || []).map(entry => entry.text)].some(
          (value) => value.toLowerCase().includes(query),
        )
      )
        return false;
      if (filter.from || filter.to) {
        const time = Date.parse(inquiry.at || "");
        if (!Number.isFinite(time)) return false;
        const day = dateIn(time, timeZone);
        if (
          (filter.from && day < filter.from) ||
          (filter.to && day > filter.to)
        )
          return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0) ||
        a.id.localeCompare(b.id),
    );
}
