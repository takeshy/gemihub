import { z } from "zod";
import { dateJST, type Booking } from "./domain.ts";

export const customerPeriods = [
  { value: "all", label: "全期間" },
  { value: "week", label: "1週間前以降" },
  { value: "month", label: "1か月前以降" },
  { value: "quarter", label: "3か月前以降" },
  { value: "half-year", label: "半年前以降" },
  { value: "year", label: "1年前以降" },
  { value: "custom", label: "任意の開始日" },
] as const;
export const customerFilterSchema = z.object({
  period: z.enum(["all", "week", "month", "quarter", "half-year", "year", "custom"]).default("all"),
  since: z.iso.date().optional(),
}).refine(filter => filter.period !== "custom" || !!filter.since, { message: "開始日を指定してください", path: ["since"] });
export type CustomerFilter = z.infer<typeof customerFilterSchema>;

// Calendar periods start at JST midnight. Clamp month/year subtraction at month end.
export function customerSince(filter: CustomerFilter, now: Date): string | undefined {
  if (filter.period === "all") return undefined;
  if (filter.period === "custom") return filter.since;
  const date = new Date(`${dateJST(now)}T00:00:00Z`);
  if (filter.period === "week") date.setUTCDate(date.getUTCDate() - 7);
  else {
    const months = { month: 1, quarter: 3, "half-year": 6, year: 12 }[filter.period];
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export type Inquiry = {
  id: string;
  shopId: string;
  email: string;
  name: string;
  message: string;
  reply: string;
  status: string;
  at: string;
};
export type CustomerRecord = {
  shopId: string;
  email: string;
  updatedBy: string;
  updatedAt: string;
};
export const customerFileLimit = 5 * 1024 * 1024;
export const customerTotalFileLimit = 10 * 1024 * 1024;
export const customerAttachmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(255).regex(/^[^\x00-\x1f\x7f]+$/),
  mimeType: z.string().max(150).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
  size: z.number().int().min(0).max(customerFileLimit),
});
export type CustomerAttachment = z.infer<typeof customerAttachmentSchema>;
export const customerNoteSchema = z.object({
  id: z.string().min(1), shopId: z.string(), email: z.string(),
  text: z.string().max(10000), attachments: z.array(customerAttachmentSchema).max(5),
  createdAt: z.iso.datetime(), createdBy: z.string(),
  status: z.enum(["active", "deleted"]), updatedAt: z.iso.datetime(), updatedBy: z.string(),
});
export type CustomerNote = z.infer<typeof customerNoteSchema>;
export const customerNoteInputSchema = z.object({
  requestId: z.uuid(), text: z.string().max(10000),
  files: z.array(customerAttachmentSchema.omit({ id: true, size: true }).extend({
    data: z.string().max(Math.ceil(customerFileLimit / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })).max(5).default([]),
}).refine(input => !!input.text.trim() || input.files.length > 0, { message: "メモまたは添付ファイルを指定してください" });
export const previewCustomerImage = (mimeType: string) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mimeType);
export type CustomerImage = CustomerAttachment & { noteId: string; createdAt: string; noteUpdatedAt: string };
export type CustomerImages = { name: string; images: CustomerImage[] };
export function customerImages(notes: CustomerNote[]): CustomerImage[] {
  return notes.filter(note => note.status === "active")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .flatMap(note => note.attachments.filter(file => previewCustomerImage(file.mimeType)).map(file => ({ ...file, noteId: note.id, createdAt: note.createdAt, noteUpdatedAt: note.updatedAt })));
}
export type CustomerSummary = {
  email: string;
  name: string;
  visitCount: number;
  lastVisit: string | null;
  totalAmount: number;
  hasNote: boolean;
};
export type CustomerEvent =
  | { kind: "booking"; at: string; booking: Booking }
  | { kind: "inquiry"; at: string; inquiry: Inquiry }
  | { kind: "note"; at: string; note: CustomerNote };
export type CustomerDetail = CustomerSummary & {
  history: CustomerEvent[];
};
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
const timestamp = (value: string) => Date.parse(value) || 0;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const isVisit = (booking: Booking, now: Date) =>
  booking.status === "active" && Date.parse(booking.end) <= now.getTime();

// Inputs are scoped to one shop by the caller. Totals use recorded booking prices.
export function aggregateCustomers(
  bookings: Booking[],
  inquiries: Inquiry[],
  notes: CustomerNote[],
  now: Date,
  since?: string,
): CustomerDetail[] {
  const start = since ? Date.parse(`${since}T00:00:00+09:00`) : -Infinity;
  const groups = new Map<string, CustomerEvent[]>();
  function add(email: string, event: CustomerEvent) {
    const key = normalizeEmail(email);
    if (!key) return;
    const history = groups.get(key) || [];
    history.push(event);
    groups.set(key, history);
  }
  for (const booking of bookings) add(booking.customer, { kind: "booking", at: booking.start, booking });
  for (const inquiry of inquiries) add(inquiry.email, { kind: "inquiry", at: inquiry.at, inquiry });
  const notesByEmail = new Map<string, CustomerNote[]>();
  for (const note of notes.filter(note => note.status === "active")) {
    const email = normalizeEmail(note.email);
    notesByEmail.set(email, [...(notesByEmail.get(email) || []), note]);
  }
  const eventId = (event: CustomerEvent) => `${event.kind}:${event.kind === "booking" ? event.booking.id : event.kind === "inquiry" ? event.inquiry.id : event.note.id}`;
  const recordedAt = (event: CustomerEvent) => event.kind === "booking" ? event.booking.createdAt : event.at;
  return [...groups].map(([email, history]) => {
    // Equal timestamps use a stable identity tie-break, independent of sheet row order.
    const latest = [...history].sort((a, b) => timestamp(recordedAt(b)) - timestamp(recordedAt(a)) || compare(eventId(b), eventId(a)))[0];
    const customerNotes = notesByEmail.get(email) || [];
    const selectedHistory: CustomerEvent[] = [...history, ...customerNotes.map(note => ({ kind: "note" as const, at: note.createdAt, note }))].filter(event => timestamp(event.at) >= start);
    const visits = selectedHistory.flatMap(event => event.kind === "booking" && isVisit(event.booking, now) ? [event.booking] : []);
    return {
      email,
      name: latest.kind === "booking" ? latest.booking.name : latest.kind === "inquiry" ? latest.inquiry.name : "",
      visitCount: visits.length,
      lastVisit: visits.map(booking => booking.start).sort((a, b) => timestamp(b) - timestamp(a))[0] || null,
      totalAmount: visits.reduce((sum, booking) => sum + booking.price, 0),
      hasNote: customerNotes.length > 0,
      history: selectedHistory.sort((a, b) => timestamp(b.at) - timestamp(a.at) || compare(eventId(b), eventId(a))),
    };
  }).sort((a, b) => compare(a.email, b.email));
}

export function customerSummaries(customers: CustomerDetail[]): CustomerSummary[] {
  return customers.filter(customer => customer.history.length > 0).map(({ history, ...summary }) => summary);
}
