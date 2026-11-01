import type { Store, Shop } from "./store.ts";
export type StaffAccount = { shopId: string; staffId: string; email: string };
export type StaffMember = {
  shopId: string;
  email: string;
  accepted: boolean;
  status?: string;
  invitedAt?: string;
  acceptedAt?: string;
  revokedAt?: string;
};
export const staffAccountKey = (shopId: string, email: string) =>
  `${shopId}:${email.trim().toLowerCase()}`;
export async function staffAccounts(store: Store, shop: Shop) {
  const members = await store.records<StaffMember>("member", shop);
  return (await store.list<StaffAccount>("staffAccount")).filter(
    (account) =>
      account.shopId === shop.id &&
      (account.email === shop.owner ||
        members.some(
          (member) =>
            member.email === account.email &&
            member.status !== "revoked" &&
            (member.accepted || member.status === "registered"),
        )),
  );
}
