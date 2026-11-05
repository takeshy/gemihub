import { z } from "zod";
import { shopSchema, ownerStaffId, type ShopConfig } from "./domain.ts";
export const liveSectionSchema = z.enum(["basic", "menus", "staff", "hours", "rules"]);
export type LiveSection = z.infer<typeof liveSectionSchema>;
export const basicSchema = z.object({ name: shopSchema.shape.name, industry: shopSchema.shape.industry, description: shopSchema.shape.description, address: shopSchema.shape.address, notificationEmail: shopSchema.shape.notificationEmail, map: shopSchema.shape.map, region: shopSchema.shape.region });
export const liveValue = (config: ShopConfig, section: LiveSection) => section === "basic" ? basicSchema.parse(config) : config[section];
export function updateLiveValue(config: ShopConfig, section: LiveSection, value: unknown) {
  const updated = shopSchema.parse(section === "basic" ? { ...config, ...basicSchema.parse(value) } : { ...config, [section]: value, ...(section === "staff" ? { hours: withoutRemovedStaff(config.hours, value) } : {}), ...(section === "staff" &&(!config.staff.length || Array.isArray(value) && (!value.length || value.some(staff => staff?.id === ownerStaffId))) ? { ownerBooking: true } : {}) });
  const owner = config.staff.find(staff => staff.id === ownerStaffId);
  // Older name/photo-only screens omit this marker and send automatic opening
  // hours. They must not erase working conditions configured on a newer screen.
  if (section === "staff" && owner?.customAvailability) updated.staff = updated.staff.map(staff => staff.id === ownerStaffId && !staff.customAvailability
    ? {...staff, customAvailability:true, start:owner.start, end:owner.end, weekdays:owner.weekdays, menuIds:owner.menuIds} : staff);
  return updated;
}
/**
 * Removing a staff member also removes them from the dates they were chosen to work. A date left with
 * nobody keeps its empty list, so the save stops and names the date instead of silently opening it to everyone.
 */
function withoutRemovedStaff(hours: ShopConfig["hours"], staff: unknown): ShopConfig["hours"] {
  if (!hours.specialDays?.length || !Array.isArray(staff)) return hours;
  const ids = new Set([ownerStaffId, ...staff.map(person => (person as { id?: unknown })?.id).filter((id): id is string => typeof id === "string")]);
  return { ...hours, specialDays: hours.specialDays.map(day => day.staffIds ? { ...day, staffIds: day.staffIds.filter(id => ids.has(id)) } : day) };
}
