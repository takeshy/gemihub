import { createContext, useContext } from "react";
import { intlLocale, tr } from "../shared/i18n";
import { currencyOf, dateIn, defaultRegion, formatMinor, formatMoney, type Currency, type Region } from "../shared/region";

// Region belongs to the rendered shop, including nested previews. A hidden preview or another
// shop on the same page must not change the currency/time zone used by its siblings or callbacks.
export const ShopRegionContext = createContext<Region>(defaultRegion);
export function createDisplay(region: Region = defaultRegion) {
  const shopTime = (value: string | number | Date, options: Intl.DateTimeFormatOptions = {}) =>
    new Date(value).toLocaleString(intlLocale(), { timeZone: region.timeZone, ...options });
  return {
    money: (amount: number, currency: Currency = currencyOf(region)) => formatMoney(amount, currency, intlLocale()),
    shopTime,
    when: (value: string) => shopTime(value, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }),
    shopToday: (now: Date | number = Date.now()) => dateIn(now, region.timeZone),
    displayCurrency: () => currencyOf(region),
    displayTimeZone: () => region.timeZone,
    timeZoneLabel: region.country === "JP" ? tr("日本時間") : region.timeZone,
  };
}
export function useShopDisplay(region?: Region) {
  const inherited = useContext(ShopRegionContext);
  return createDisplay(region || inherited);
}
/** Stored payment and refund amounts use their own snapshotted currency, in yen or cents. */
export const paid = (amount: number, currency: Currency = "JPY") => formatMinor(amount, currency, intlLocale());
