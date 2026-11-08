import { sample, type ShopConfig } from "../../server/domain";
import { getLocale } from "../../shared/i18n";
import { currencyOf, regionOf, type Currency } from "../../shared/region";

/** Synthetic examples only. Existing shops always keep their own region and prices. */
export const sampleCurrency = (): Currency => getLocale() === "en" ? "USD" : "JPY";
export const samplePrice = (config: ShopConfig, yen: number) => currencyOf(regionOf(config)) === "USD" ? yen / 100 : yen;
export function sampleConfig(explicitUS = false): ShopConfig {
  const config = structuredClone(sample);
  if (explicitUS || sampleCurrency() === "USD") {
    config.region = { country: "US", timeZone: "America/Los_Angeles" };
    config.menus = config.menus.map((menu, index) => ({ ...menu, price: explicitUS ? (index ? 78 : 55.25) : menu.price / 100 }));
  }
  return config;
}
