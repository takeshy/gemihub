import { tr } from "../shared/i18n.ts";
import { currencyOf, regionOf, validPrice } from "../shared/region.ts";
import { bookingPaymentSchema } from "./payment-domain.ts";
import { customerNoteSchema } from "./customers.ts";
import { clients } from "./google.ts";
import type { Shop } from "./store.ts";
const layouts: Record<string, { tab: string; columns: string[] }> = {
  booking: {
    tab: "reservations",
    columns: [
      "id",
      "customer",
      "name",
      "menuId",
      "staffId",
      "start",
      "end",
      "status",
      "createdAt",
      "updatedBy",
      "updatedAt",
      "requestKey",
      "price",
      "message",
      "payment",
    ],
  },
  inquiry: {
    tab: "inquiries",
    columns: ["id", "email", "name", "message", "reply", "status", "at"],
  },
  member: {
    tab: "members",
    columns: [
      "email",
      "accepted",
      "status",
      "invitedAt",
      "acceptedAt",
      "revokedAt",
    ],
  },
  post: { tab: "posts", columns: ["id", "record"] },
  customer: { tab: "customers", columns: ["email", "updatedBy", "updatedAt", "name", "birthDate", "gender"] },
  customerNote: { tab: "customer_notes", columns: ["id", "email", "text", "attachments", "createdAt", "createdBy", "status", "updatedAt", "updatedBy"] },
  shopChat: {tab:"ai_chats",columns:["id","email","intent","title","createdAt","updatedAt"]},
  shopChatMessage: {tab:"ai_chat_messages",columns:["id","conversationId","email","role","text","requestId","sequence","createdAt","updatedAt","detail"]},
};
async function table(shop: Shop, kind: string, token: string) {
  const layout = layouts[kind];
  if (!layout || !shop.google) throw new Error(tr("保存先がありません"));
  const { sheets } = clients(token);
  const spreadsheetId = shop.google.sheetId;
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  if (!metadata.data.sheets?.some((s) => s.properties?.title === layout.tab)) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: layout.tab } } }],
        },
      });
    } catch (error) {
      const refreshed = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets.properties.title",
      });
      if (
        !refreshed.data.sheets?.some((s) => s.properties?.title === layout.tab)
      )
        throw error;
    }
  }
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${layout.tab}!A:Z`,
  });
  const rows = response.data.values || [];
  const header = rows[0] || [];
  const legacyCustomerHeader = kind === "customer" && header.length === 3 && header.every((value, index) => value === layout.columns[index]);
  const legacyBookingHeader = kind === "booking" && header.length === 14 && header.every((value, index) => value === layout.columns[index]);
  if (!legacyCustomerHeader && !legacyBookingHeader && (
    header.some((v, i) => v !== layout.columns[i]) ||
    (header.length && header.length !== layout.columns.length)
  ))
    throw Object.assign(new Error(tr("{0} の列構造を確認してください", layout.tab)), {
      status: 409,
    });
  const identities = rows
    .slice(1)
    .filter((row) => row[0])
    .map((row) => String(row[0]).trim().toLowerCase());
  if (new Set(identities).size !== identities.length)
    throw Object.assign(new Error(tr("{0} の識別子が重複しています", layout.tab)), {
      status: 409,
    });
  if (header.length !== layout.columns.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${layout.tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [layout.columns] },
    });
  }
  return { sheets, spreadsheetId, layout, rows: rows.slice(1) };
}
export async function readRecords(
  shop: Shop,
  kind: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  const { layout, rows } = await table(shop, kind, token);
  return rows
    .filter((r) => r[0])
    .map((row) => {
      if (kind === "post")
        return { ...JSON.parse(String(row[1])), shopId: shop.id };
      const value: Record<string, unknown> = Object.fromEntries(
        layout.columns.map((k, i) => [k, row[i] ?? ""]),
      );
      value.shopId = shop.id;
      if (kind === "shopChatMessage") { value.detail = JSON.parse(String(value.detail || "{}")); value.sequence = Number(value.sequence); }
      if (kind === "customerNote") {
        value.email = String(value.email).trim().toLowerCase();
        try {
          value.attachments = JSON.parse(String(value.attachments || "[]"));
          return customerNoteSchema.parse(value);
        } catch { throw Object.assign(new Error(tr("お客様メモの記録を確認してください")), { status: 409 }); }
      }
      if (kind === "member" || kind === "customer") {
        value.email = String(value.email).trim().toLowerCase();
      }
      if (kind === "member") {
        value.accepted =
          String(value.accepted).toLowerCase() === "true" &&
          value.status !== "revoked";
      }
      if (kind === "booking") {
        const price = Number(value.price);
        if (value.payment) {
          try { value.payment = bookingPaymentSchema.parse(JSON.parse(String(value.payment))); }
          catch { throw Object.assign(new Error(tr("予約台帳の支払いの記録を確認してください")), { status: 409 }); }
        } else delete value.payment;
        const payment = value.payment as { currency: "JPY" | "USD" } | undefined;
        if (String(value.price).trim() === "" || !validPrice(price, payment?.currency || currencyOf(regionOf(shop.published))))
          throw Object.assign(new Error(tr("予約台帳の料金を確認してください")), { status: 409 });
        value.price = price;
      }
      if (
        kind === "booking" &&
        (!["active", "cancelled", "no_show"].includes(String(value.status)) ||
          !Number.isFinite(Date.parse(String(value.start))) ||
          !Number.isFinite(Date.parse(String(value.end))))
      )
        throw Object.assign(
          new Error(tr("予約台帳の日時・状態を確認してください")),
          { status: 409 },
        );
      return value;
    });
}
export async function writeRecord(
  shop: Shop,
  kind: string,
  id: string,
  value: Record<string, unknown>,
  token: string,
) {
  const { sheets, spreadsheetId, layout, rows } = await table(
    shop,
    kind,
    token,
  );
  const key = kind === "member" || kind === "customer" ? value.email : id;
  const index = rows.findIndex(
    (r) => String(r[0]).trim().toLowerCase() === String(key).toLowerCase(),
  );
  const row =
    kind === "post"
      ? [id, JSON.stringify(value)]
      : layout.columns.map((k) => kind === "booking" && k === "payment" ? (value.payment ? JSON.stringify(value.payment) : "") : kind === "customerNote" && k === "attachments" ? JSON.stringify(value[k] || []) : kind === "shopChatMessage" && k === "detail" ? JSON.stringify(value[k] || {}) : value[k] ?? "");
  // A retry reads by identity before choosing its fixed row; it never appends blindly.
  const number = index < 0 ? rows.length + 2 : index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${layout.tab}!A${number}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  });
}
