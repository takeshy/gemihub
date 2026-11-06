export const customerScreens = ["reserve_view", "mypage_view"] as const;
export type CustomerActivity = { id: string; at: string; operation: string; bookingId?: string };
export type CustomerActivityResult = { rows: CustomerActivity[]; truncated: boolean; retentionDays: number };
