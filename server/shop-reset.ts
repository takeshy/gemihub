import { tr } from "../shared/i18n.ts";
import { regionOf, type Region } from "../shared/region.ts";
import type { Session } from "./auth.ts";
import { trashFile } from "./google.ts";
import { bookingLockKey, mailLockKey, isArchivedShop, type Shop, type Store, type User } from "./store.ts";

type Reset = { email: string; previousShopId: string; at: string; region: Region; shopId?: string };
function reject(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

/** One reset per old shop, including retries from another tab or after a lost response. */
export async function resetShop(store: Store, email: string, shopId: string, trash = trashFile) {
  return store.locked(`shop-reset:${email}`, () => store.locked(shopId, () => store.locked(bookingLockKey(shopId), () => store.locked(mailLockKey(shopId), async () => {
    const saved = await store.get<User>("user", email);
    if (!saved || saved.role !== "owner" || saved.judge || saved.legacyNotes || saved.accessPending)
      reject(403, tr("店主のみ利用できます"));
    const previous = await store.get<Shop>("shop", shopId);
    if (!previous || previous.owner !== email || previous.judge) reject(403, tr("店主のみ利用できます"));
    let reset = await store.get<Reset>("shopReset", shopId);
    if (!reset) {
      if (isArchivedShop(previous) || saved.shopId !== shopId) reject(409, tr("お店の状態が変わりました。画面を読み直してください。"));
      if (previous.google && !saved.refreshToken) reject(503, tr("店主の Google 再接続が必要です"));
      reset = { email, previousShopId: shopId, at: new Date().toISOString(), region: previous.published ? regionOf(previous.published) : previous.regionDefault || regionOf(null) };
      await store.put("shopReset", shopId, reset);
    }
    if (reset.email !== email) reject(403, tr("店主のみ利用できます"));
    if (!reset.shopId) {
      // Hide the old site before touching Drive. A failure can resume using this journal.
      if (!previous.archivedAt) await store.saveShop({ ...previous, archivedAt: reset.at });
      if (previous.google) {
        if (!saved.refreshToken) reject(503, tr("店主の Google 再接続が必要です"));
        await trash(saved.refreshToken, previous.google.folderId);
      }
      const fresh = await store.createShop(email, reset.region);
      reset = { ...reset, shopId: fresh.id };
      await store.put("shopReset", shopId, reset);
    }
    // Keep sign-in and Google authorization. Updating the existing session also allows
    // an identical retry when the first response never reached the browser.
    const updated = { ...saved, shopId: reset.shopId };
    // An old completed reset must never move an account back after a later reset.
    if (saved.shopId === shopId || saved.shopId === reset.shopId || !await store.shop(saved.shopId || "")) {
      await store.put("user", email, updated);
      for (const entry of await store.entries<Session>("session")) {
        if (entry.value.user.email === email && entry.value.user.role === "owner")
          await store.put("session", entry.id, { ...entry.value, user: { ...entry.value.user, shopId: reset.shopId } });
        else if (entry.value.user.shopId === shopId && entry.value.user.role === "customer")
          await store.delete("session", entry.id);
      }
    }
    return { ok: true, shopId: reset.shopId };
  }))));
}
