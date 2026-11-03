import { sample, shopSchema } from "../../server/domain.ts";
export function optionShop(usd = false) {
  return shopSchema.parse({ ...structuredClone(sample), staff: [], ownerBooking: true,
    ...(usd ? { region: { country: "US", timeZone: "America/New_York" } } : {}),
    hours: { start: "09:00", end: "21:00", closedWeekdays: [], holidays: [] },
    menus: [
      { id: "hand", name: "Hand", duration: 60, price: usd ? 50 : 5000, active: true },
      { id: "foot", name: "Foot", duration: 60, price: usd ? 55.01 : 6000, active: true },
      { id: "own-off", name: "Our removal", duration: 35, price: 0, active: true, optionFor: ["hand", "foot"], optionGroup: "removal" },
      { id: "other-off", name: "Other removal", duration: 35, price: usd ? 10.02 : 500, active: true, optionFor: ["hand", "foot"], optionGroup: "removal" },
      { id: "care", name: "Foot care", duration: 35, price: usd ? 20.03 : 4000, active: true, optionFor: ["foot"] },
    ] });
}
