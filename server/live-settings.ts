import { z } from "zod";
import { shopSchema, type ShopConfig } from "./domain.ts";
export const liveSectionSchema = z.enum(["basic", "menus", "staff", "hours", "rules"]);
export type LiveSection = z.infer<typeof liveSectionSchema>;
export const basicSchema = z.object({ name: shopSchema.shape.name, industry: shopSchema.shape.industry, description: shopSchema.shape.description, address: shopSchema.shape.address, notificationEmail: shopSchema.shape.notificationEmail, region: shopSchema.shape.region });
export const liveValue = (config: ShopConfig, section: LiveSection) => section === "basic" ? basicSchema.parse(config) : config[section];
export const updateLiveValue = (config: ShopConfig, section: LiveSection, value: unknown) => shopSchema.parse(section === "basic" ? { ...config, ...basicSchema.parse(value) } : { ...config, [section]: value });
