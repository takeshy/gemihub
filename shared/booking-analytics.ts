import type { ArticleAccessDays } from "./article-access.ts";
import type { Currency } from "./region.ts";

export const bookingSteps = ["menu_selected", "staff_selected", "slot_selected"] as const;
export type BookingStep = typeof bookingSteps[number];
export type ConversionCounts = { entered: number; menu: number; slot: number; completed: number; within1Day: number; within7Days: number };
export type MenuSalesRow = { id: string; name: string; kind: "service" | "addon" | "unknown"; visits: number; revenue: number; trend: { date: string; visits: number; revenue: number }[] };
export type BookingAnalytics = {
  days: ArticleAccessDays; from: string; to: string; timeZone: string; currency: Currency;
  logsTruncated: boolean; unidentifiedViews: number;
  funnel: ConversionCounts;
  cohorts: (ConversionCounts & { date: string; ageDays: number; mature1Day: boolean; mature7Days: boolean })[];
  staff: { id: string; name: string; visits: number; revenue: number; selected: number; completed: number; trend: { date: string; visits: number; revenue: number }[]; menus: MenuSalesRow[] }[];
  menus: MenuSalesRow[];
};
