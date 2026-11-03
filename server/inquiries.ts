import { z } from "zod";
import { dateIn } from "../shared/region.ts";
export const inquiryStatusSchema = z.enum(["in_progress", "completed"]);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;
export const inquiryStatus = (inquiry: { status: string }): InquiryStatus =>
  inquiry.status === "completed" || inquiry.status === "replied"
    ? "completed"
    : "in_progress";
export const inquiryReplied = (inquiry: { reply: string }) =>
  !!inquiry.reply.trim();
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
        ![inquiry.name, inquiry.email, inquiry.message, inquiry.reply].some(
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
