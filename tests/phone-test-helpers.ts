import type { Shop } from "../server/store.ts";
import type { PhoneSettings } from "../server/phone-reception.ts";

export function applyPhoneSettings(shop: Shop, settings: PhoneSettings) {
  shop.phone = settings;
}
