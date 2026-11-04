import { tr } from "../../shared/i18n";
import { bookingMenuName, bookingStaffName, bookingTransferable, type Booking } from "../../server/domain";
import { transferTerms } from "../../server/transfer-domain";
import { refundQuote } from "../../server/payment-domain";
import { simulateCancellation } from "../payment-mock";
import type { Workspace, Session } from "../App";
import type { SellingTransfer, TransferListing } from "../Transfers";

export const customerTransferScenarios = [
  "transfer-offers", "transfer-eligible", "transfer-listed", "transfer-seller-buying",
  "transfer-buyer-creating", "transfer-buyer-paying", "transfer-buyer-review",
  "transfer-sold", "transfer-refund-pending", "transfer-refund-review", "transfer-expired", "transfer-received",
] as const;
export const ownerTransferScenarios = ["owner-transfer-listed", "owner-transfer-sold", "owner-transfer-refund"] as const;
export type TransferScenario = typeof customerTransferScenarios[number] | typeof ownerTransferScenarios[number];

export function customerBooking(booking: Booking): Booking {
  const { transfers, requestKey: _requestKey, ...rest } = booking;
  return transfers?.length ? { ...rest, message: "", transferredIn: true } : rest;
}

type Offer = SellingTransfer & {
  seller: string;
  buyer?: { customer: string; name: string; phase: string; expires: number; review: boolean };
};

/** In-memory story interactions only: no payment gateway, persistence or external navigation. */
export function createTransferFixtures(scenario: string, shop: Workspace, session: Session) {
  const config = shop.published!;
  const offers: Offer[] = [];
  const now = Date.now();
  const ownEmail = "guest@example.com";
  const ownName = tr("山田 花子");
  const otherEmail = "other@example.com";
  const otherName = tr("鈴木 さくら");
  const isTransfer = scenario.startsWith("transfer-") || scenario.startsWith("owner-transfer-");
  const bookingFor = (id: string) => shop.bookings.find(booking => booking.id === id)!;
  const view = ({ seller: _seller, buyer: _buyer, phase: _phase, buying: _buying, unsold: _unsold, refund: _refund, ...listing }: Offer): TransferListing => listing;
  const busy = (offer: Offer) => !!offer.buyer && !["expired", "failed"].includes(offer.buyer.phase);
  function updateOwnerListings() {
    shop.transferListings = offers.filter(offer => offer.phase === "listed").map(offer => ({
      id: offer.id, bookingId: offer.bookingId, price: offer.amount, currency: offer.currency,
      discountPercent: offer.discountPercent, deadline: offer.deadline, buying: busy(offer), review: !!offer.buyer?.review,
    }));
  }
  function list(booking: Booking, at = new Date().toISOString()) {
    const p = booking.payment!;
    const terms = transferTerms(p, booking.start, at);
    if (!terms) throw new Error(tr("今は譲渡に出せません。"));
    const offer: Offer = {
      id: `story-transfer-${offers.length + 1}`, bookingId: booking.id, seller: booking.customer,
      start: booking.start, end: booking.end, menu: bookingMenuName(config, booking), staff: bookingStaffName(config, booking.staffId),
      amount: terms.price, currency: p.currency, discountPercent: terms.discountPercent, deadline: terms.deadline,
      policy: structuredClone(p.policy), phase: "listed", buying: false, unsold: terms.unsold,
    };
    offers.push(offer); updateOwnerListings();
    return offer;
  }
  function sell(offer: Offer, customer: string, name: string, refundStatus: "completed" | "pending" | "awaiting_funds" | "manual_review" = "completed") {
    const booking = bookingFor(offer.bookingId);
    if (offer.phase === "sold") return booking;
    const p = booking.payment!;
    const entry = {
      id: offer.id, at: new Date().toISOString(),
      from: { customer: booking.customer, name: booking.name, message: booking.message }, to: { customer, name },
      price: offer.amount, currency: offer.currency, discountPercent: offer.discountPercent,
      previous: { orderId: p.orderId, captureId: p.captureId, amount: p.amount },
      refund: { amount: offer.amount, status: refundStatus, requestId: `sample-refund-${offer.id}` },
    };
    booking.transfers = [...(booking.transfers || []), entry];
    booking.customer = customer; booking.name = name; booking.message = "";
    booking.payment = { ...p, orderId: `sample-order-${offer.id}`, captureId: `sample-capture-${offer.id}`, amount: offer.amount };
    offer.phase = "sold"; offer.refund = entry.refund;
    updateOwnerListings();
    return booking;
  }
  if (isTransfer) {
    const booking = shop.bookings[0];
    shop.bookings = [booking];
    booking.start = new Date(now + 18 * 3600000).toISOString();
    booking.end = new Date(now + 19 * 3600000).toISOString();
    if (["transfer-offers", "transfer-received", "owner-transfer-sold", "owner-transfer-refund"].includes(scenario) || scenario.startsWith("transfer-buyer-")) {
      booking.customer = otherEmail; booking.name = otherName;
    }
    if (scenario === "transfer-expired") {
      booking.start = new Date(now + 11 * 3600000).toISOString();
      booking.end = new Date(now + 12 * 3600000).toISOString();
    }
    if (scenario !== "transfer-eligible") {
      const offer = list(booking, new Date(Date.parse(booking.start) - 18 * 3600000).toISOString());
      if (scenario === "transfer-offers") {
        const half = structuredClone(booking);
        half.id = "story-half-price"; half.start = new Date(now + 0.5 * 3600000).toISOString(); half.end = new Date(now + 1.5 * 3600000).toISOString();
        const middle = structuredClone(booking);
        middle.id = "story-middle-price"; middle.start = new Date(now + 6 * 3600000).toISOString(); middle.end = new Date(now + 7 * 3600000).toISOString();
        shop.bookings.push(middle, half); list(middle); list(half);
      } else if (scenario.startsWith("transfer-buyer-") || scenario === "transfer-seller-buying") {
        offer.buyer = {
          customer: scenario === "transfer-seller-buying" ? otherEmail : ownEmail,
          name: scenario === "transfer-seller-buying" ? otherName : ownName,
          phase: scenario === "transfer-buyer-creating" ? "creating" : "capturing", expires: now + 10 * 60000,
          review: scenario === "transfer-buyer-review",
        };
      } else if (["transfer-sold", "transfer-refund-pending", "transfer-refund-review", "transfer-received", "owner-transfer-sold", "owner-transfer-refund"].includes(scenario)) {
        const incoming = scenario === "transfer-received" || scenario.startsWith("owner-transfer-");
        sell(offer, incoming ? ownEmail : otherEmail, incoming ? ownName : otherName,
          scenario === "transfer-refund-pending" ? "pending" : scenario === "transfer-refund-review" ? "manual_review" : scenario === "owner-transfer-refund" ? "awaiting_funds" : "completed");
      } else if (scenario === "transfer-expired") {
        offer.phase = "expired"; booking.status = "cancelled";
        booking.payment!.cancellation = { ...offer.unsold, at: offer.deadline, by: booking.customer, reason: "customer", status: "completed", requestId: "sample-expired-refund" };
      }
    }
    updateOwnerListings();
  }
  function release(bookingId: string) {
    const offer = offers.find(offer => offer.bookingId === bookingId && offer.phase === "listed");
    if (!offer) return;
    if (busy(offer)) throw new Error(tr("代わりに利用する方の決済が進行中です。完了または期限切れの後に操作してください。"));
    offer.phase = "withdrawn"; updateOwnerListings();
  }
  function retry() {
    for (const booking of shop.bookings) for (const entry of booking.transfers || [])
      if (["pending", "retrying", "awaiting_funds"].includes(entry.refund.status)) entry.refund.status = "completed";
  }
  function request(action: string, data?: unknown) {
    const input = (data || {}) as Record<string, unknown>;
    if (/\/bookings\/[^/]+\/cancel(?:-quote)?$/.test(action)) {
      const booking = bookingFor(action.split("/").at(-2)!);
      const p = booking.payment!;
      const listed = offers.find(offer => offer.bookingId === booking.id && offer.phase === "listed");
      const terms = bookingTransferable(config, booking) && !booking.transfers?.some(entry => ["retrying", "pending", "awaiting_funds"].includes(entry.refund.status)) ? transferTerms(p, booking.start, new Date().toISOString()) : undefined;
      const quote = p.cancellation || { ...refundQuote(p.amount, booking.start, new Date().toISOString(), p.policy, "customer"), ...(listed ? { amount: listed.unsold.amount, transfer: { id: listed.id, price: listed.amount, deadline: listed.deadline } } : terms ? { transfer: { price: terms.price, deadline: terms.deadline } } : {}) };
      if (action.endsWith("cancel-quote")) return quote;
      if (!p.cancellation && (listed || terms)) {
        if (!listed) list(booking);
        return { ok: true, cancellationPending: true, booking: customerBooking(booking) };
      }
      simulateCancellation(booking, "customer");
      return { ok: true, booking: customerBooking(booking) };
    }
    if (action.endsWith("/transfers")) return offers.filter(offer => offer.phase === "listed").map(offer => ({ ...view(offer), mine: offer.seller === session.user?.email, available: !busy(offer) }));
    if (action.endsWith("/transfers/mine")) return {
      selling: offers.filter(offer => offer.seller === session.user?.email).map(offer => ({ ...view(offer), phase: offer.phase, buying: busy(offer), unsold: offer.unsold, refund: offer.refund })),
      buying: offers.filter(offer => offer.phase === "listed" && offer.buyer?.customer === session.user?.email && busy(offer)).map(offer => ({ ...view(offer), ...offer.buyer })),
    };
    if (/\/bookings\/[^/]+\/transfer(?:-quote)?$/.test(action)) {
      const booking = bookingFor(action.split("/").at(-2)!);
      const terms = transferTerms(booking.payment!, booking.start, new Date().toISOString());
      if (action.endsWith("transfer-quote")) return terms ? { eligible: true, ...terms } : { eligible: false };
      return { ok: true, transfer: view(list(booking)) };
    }
    const offer = offers.find(offer => offer.id === action.split("/").at(-2))!;
    const verb = action.split("/").at(-1);
    if (verb === "withdraw") { release(offer.bookingId); return { ok: true }; }
    if (verb === "checkout") {
      if (busy(offer)) throw new Error(tr("ほかの方がお支払い手続き中です。少し時間をおいてご確認ください。"));
      offer.buyer = { customer: session.user!.email, name: String(input.name), phase: "captured", expires: Date.now() + 600000, review: false };
    } else if (verb === "abandon" && offer.buyer?.phase === "creating") offer.buyer.phase = "expired";
    else if (verb === "resume" && offer.buyer) offer.buyer.phase = "capturing";
    else if (verb === "capture" && offer.buyer && !offer.buyer.review) sell(offer, offer.buyer.customer, offer.buyer.name);
    updateOwnerListings();
    return { ok: offer.phase === "sold", booking: offer.phase === "sold" ? customerBooking(bookingFor(offer.bookingId)) : undefined, checkout: { id: offer.id, phase: offer.buyer?.phase || "expired" } };
  }
  return {
    handles: (action: string) => action.startsWith("/api/public/") && (/\/transfers(?:\/|$)/.test(action) || /\/bookings\/[^/]+\/transfer(?:-quote)?$/.test(action) || (/\/bookings\/[^/]+\/cancel(?:-quote)?$/.test(action) && !!bookingFor(action.split("/").at(-2)!)?.payment)),
    request, release, retry,
  };
}
