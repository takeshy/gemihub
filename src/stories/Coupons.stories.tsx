import React, { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Coupons, defaultCoupon } from "../Coupons";
import { ApiProvider, type ApiClient } from "../api";
import { sample } from "../../server/domain";
import { couponRuleSchema, type CouponCampaign } from "../../shared/coupons";
import { tr } from "../../shared/i18n";
import { ShopRegionContext } from "../money";
import { Screen } from "./Screen";

function CouponManagementStory({ empty = false, fail = false }: { empty?: boolean; fail?: boolean }) {
  const api = useMemo(() => {
    let campaigns: CouponCampaign[] = empty ? [] : [
      { ...defaultCoupon(), id: "a".repeat(64), shopId: "story-shop", currency: "JPY", enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { ...defaultCoupon(), title: tr("誕生日月"), id: "b".repeat(64), shopId: "story-shop", currency: "JPY", enabled: true, conditions: [{ type: "birthday_month" }], discount: { type: "percent", value: 20 }, schedule: { type: "monthly", day: 1, hour: 9 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ];
    return (async (path: string, data?: unknown) => {
      if (fail) throw new Error(tr("操作できませんでした"));
      if (path.endsWith("/propose")) return { rule: { ...defaultCoupon(), title: tr("誕生日月"), conditions: [{ type: "birthday_month" }], discount: { type: "percent", value: 20 }, schedule: { type: "monthly", day: 1, hour: 9 } }, question: "" };
      if (path.endsWith("/calculate")) return { ok: true };
      if (path.endsWith("/manual")) return {ok:true,count:(data as {customers:string[]}).customers.length};
      if (path.endsWith("/enabled")) { campaigns=campaigns.map(c=>path.includes(c.id)?{...c,enabled:(data as {enabled:boolean}).enabled}:c); return {ok:true}; }
      if (data) { const input=data as {rule:unknown}; campaigns.push({ ...couponRuleSchema.parse(input.rule), id: "d".repeat(64)+campaigns.length, shopId:"story-shop",currency:"JPY",enabled:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() }); return {ok:true}; }
      return { campaigns, issued: empty ? 0 : 12, customers:[{email:"guest@example.com",name:tr("山田 花子")},{email:"other@example.com",name:tr("鈴木 さくら")}] };
    }) as ApiClient;
  }, [empty,fail]);
  return <ApiProvider value={api}><ShopRegionContext.Provider value={{country:"JP",timeZone:"Asia/Tokyo"}}><main style={{maxWidth:1000,margin:"auto",padding:16}}><Coupons shopId="story-shop" config={structuredClone(sample)}/></main></ShopRegionContext.Provider></ApiProvider>;
}
const meta={title:"運営/予約・お客様/クーポン",component:CouponManagementStory,parameters:{layout:"fullscreen"}} satisfies Meta<typeof CouponManagementStory>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Management:Story={name:"クーポン",args:{}};
export const ManualGrants:Story={name:"手動付与",args:{},play:async({canvasElement})=>{const button=canvasElement.querySelectorAll('.coupon-actions button')[2];if(!button)throw new Error('Manual coupon action missing');(button as HTMLElement).click();}};
export const Create:Story={name:"クーポンを作る",args:{},play:async({canvasElement})=>{(canvasElement.querySelectorAll('.coupon-actions button')[1] as HTMLElement).click();}};
export const Empty:Story={name:"クーポン未作成",args:{empty:true}};
export const LoadingError:Story={name:"読み込み失敗",args:{fail:true},tags:["expected-alert"]};
export const Booking:Story={name:"クーポンを選ぶ",render:()=> <Screen scenario="coupon-reservation"/>};
export const Wallet:Story={name:"お持ちのクーポン",render:()=> <Screen scenario="coupon-mypage"/>};
