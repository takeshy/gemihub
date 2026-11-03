import { z } from "zod";
import { shopSchema, ownerStaffId, type ShopConfig } from "./domain.ts";
export const liveSectionSchema = z.enum(["basic", "menus", "staff", "hours", "rules"]);
export type LiveSection = z.infer<typeof liveSectionSchema>;
export const basicSchema = z.object({ name: shopSchema.shape.name, industry: shopSchema.shape.industry, description: shopSchema.shape.description, address: shopSchema.shape.address, notificationEmail: shopSchema.shape.notificationEmail, map: shopSchema.shape.map, region: shopSchema.shape.region });
export const liveValue = (config: ShopConfig, section: LiveSection) => section === "basic" ? basicSchema.parse(config) : config[section];
export function updateLiveValue(config: ShopConfig, section: LiveSection, value: unknown) {
  const updated = shopSchema.parse(section === "basic" ? { ...config, ...basicSchema.parse(value) } : { ...config, [section]: value, ...(section === "staff" && (!config.staff.length || Array.isArray(value) && (!value.length || value.some(staff => staff?.id === ownerStaffId))) ? { ownerBooking: true } : {}) });
  const owner = config.staff.find(staff => staff.id === ownerStaffId);
  // Older name/photo-only screens omit this marker and send automatic opening
  // hours. They must not erase working conditions configured on a newer screen.
  if (section === "staff" && owner?.customAvailability) updated.staff = updated.staff.map(staff => staff.id === ownerStaffId && !staff.customAvailability
    ? {...staff, customAvailability:true, start:owner.start, end:owner.end, weekdays:owner.weekdays, menuIds:owner.menuIds} : staff);
  return updated;
}
