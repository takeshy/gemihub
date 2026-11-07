import type { Store, Shop } from "./store.ts";
import type { ShopConversation, ShopChatMessage } from "./shop-chat.ts";
import type { ImageUpload } from "./menu-images.ts";

export const exportColumns = {
  bookings: ["id", "customer", "name", "menuId", "staffId", "start", "end", "status", "createdAt", "updatedBy", "updatedAt", "requestKey", "price", "message", "payment", "optionIds", "items", "coupon", "phone"],
  customers: ["email", "name", "birthDate", "gender", "phone", "updatedBy", "updatedAt"],
  inquiries: ["id", "email", "name", "message", "reply", "status", "at", "phone", "subject", "source", "createdBy"],
  inquiryInteractions: ["id", "inquiryId", "kind", "text", "at", "by", "to", "delivery", "legacy"],
  members: ["email", "accepted", "status", "invitedAt", "acceptedAt", "revokedAt"],
  posts: ["id", "version", "address", "draft", "published", "publishedAt"],
  customerNotes: ["id", "email", "text", "attachments", "createdAt", "createdBy", "status", "updatedAt", "updatedBy"],
  menus: ["id", "name", "duration", "price", "active", "imageId", "optionFor", "optionGroup"],
  staff: ["id", "name", "menuIds", "weekdays", "start", "end", "imageId", "customAvailability"],
} as const;
export type ExportTable = keyof typeof exportColumns;

export async function exportRows(store: Store, shop: Shop, table: ExportTable): Promise<unknown[]> {
  if (table === "bookings") return store.bookings(shop.id);
  if (table === "menus" || table === "staff") return shop.published?.[table] || shop.draft?.[table] || [];
  const kinds = { inquiryInteractions: "inquiryInteraction", customers: "customer", inquiries: "inquiry", members: "member", posts: "post", customerNotes: "customerNote" };
  return store.records(kinds[table], shop);
}

export async function shopExport(store: Store, shop: Shop, email: string) {
  const [bookings, customers, inquiries, members, posts, customerNotes, waitlist, chats, messages, images, couponCampaigns, couponGrants, couponUses, couponManual, inquiryInteractions] = await Promise.all([
    store.bookings(shop.id), store.records("customer", shop), store.records("inquiry", shop),
    store.records("member", shop), store.records("post", shop), store.records("customerNote", shop), store.records("slotWish", shop),
    store.records<ShopConversation>("shopChat", shop), store.records<ShopChatMessage>("shopChatMessage", shop),
    store.entries<ImageUpload>("menuImageUpload", shop),
    store.records("couponCampaign", shop), store.records("couponGrant", shop), store.records("couponUse", shop), store.records("couponManual", shop), store.records("inquiryInteraction", shop),
  ]);
  const ownChats = chats.filter(chat => chat.email === email);
  const ownIds = new Set(ownChats.map(chat => chat.id));
  return {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    shop: { id: shop.id, slug: shop.slug, publication: shop.publication, revision: shop.revision,
      config: shop.published, draft: shop.draft, history: shop.history,
      driveFolderId: shop.google?.folderId },
    records: { bookings, customers, inquiries, inquiryInteractions, members, posts, customerNotes, waitlist, couponCampaigns, couponGrants, couponUses, couponManual,
      menus: shop.published?.menus || shop.draft?.menus || [], staff: shop.published?.staff || shop.draft?.staff || [] },
    chats: ownChats, messages: messages.filter(message => message.email === email && ownIds.has(message.conversationId)),
    files: images.filter(({ value }) => value.complete).map(({ id, value }) => ({ imageId: id, fileId: value.fileId, name: value.name, mimeType: value.mimeType, size: value.size, archived: !!value.archived })),
  };
}

export function exportCsv(rows: unknown[], columns: readonly string[]) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    // Quoting alone does not stop spreadsheet programs from evaluating formulas.
    if (typeof value === "string" && (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell((row as Record<string, unknown>)[key])).join(','))].join('\r\n') + '\r\n';
}
