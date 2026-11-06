export const articleAccessDays = [7, 30, 90] as const;
export type ArticleAccessDays = typeof articleAccessDays[number];
export type ArticleAccessRow = { postId: string; category: "blogs" | "announcements"; title: string; path: string; views: number; uniqueBrowsers: number };
export type ArticleAccessResult = { days: ArticleAccessDays; from: string; to: string; total: number; byCategory: { blogs: number; announcements: number }; rows: ArticleAccessRow[] };
export type SiteTrafficResult = { days: ArticleAccessDays; timeZone: string; totalViews: number; rows: { date: string; views: number; uniqueBrowsers: number }[] };
export type MonthlyTrafficResult = { days: ArticleAccessDays; unit: "month"; from: string; to: string; timeZone: string; totalViews: number; uniqueCountsAvailable: boolean; rows: { date: string; views: number; uniqueBrowsers: number | null }[] };
