import React from "react";
import type {Meta,StoryObj} from "@storybook/react-vite";
import {BookingComplete} from "../BookingComplete";
import {sample,shopDate,type Booking,type ShopConfig} from "../../server/domain";
import {zonedDate,regionOf} from "../../shared/region";
import {defaultRefundTiers} from "../../server/payment-domain";
import {simulatePayment} from "../payment-mock";
import {ShopRegionContext} from "../money";

function example(paid=false,usd=false,addons=false) {
  const config:ShopConfig=structuredClone(sample);
  if(usd)config.region={country:"US",timeZone:"America/New_York"};
  config.rules.payment={enabled:paid,refundTiers:structuredClone(defaultRefundTiers)};
  const start=zonedDate(shopDate(config,Date.now()+3*86400000),"10:00",regionOf(config).timeZone);
  const booking:Booking={id:"booking-example-001",shopId:"example",customer:"customer@example.com",name:"Hanako",menuId:config.menus[0].id,staffId:config.staff[0].id,price:usd?55.25:addons?6500:5500,message:"",start:start.toISOString(),end:new Date(start.getTime()+(addons?90:60)*60000).toISOString(),status:"active",createdAt:new Date().toISOString(),...(addons?{items:[{menuId:"simple",name:config.menus[0].name,price:5500,duration:60},{menuId:"care",name:"Care",price:1000,duration:30}]}:{})};
  return {config,booking:simulatePayment(booking,config),simulation:true,onMine:()=>{},onNew:()=>{}};
}
const meta={title:"お客様の予約/予約完了",component:BookingComplete,parameters:{layout:"fullscreen"},render:args=><ShopRegionContext.Provider value={regionOf(args.config)}><main className="public-shop"><BookingComplete {...args}/></main></ShopRegionContext.Provider>} satisfies Meta<typeof BookingComplete>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Standard:Story={name:"予約完了",args:example()};
export const Paid:Story={name:"支払い済みの予約完了",args:example(true)};
export const Addons:Story={name:"追加メニューを含む予約完了",args:example(false,false,true)};
export const Dollars:Story={name:"US・ドルでの予約完了",args:example(true,true)};
