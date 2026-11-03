import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {AddressInfo} from "node:net";
import {sample,shopSchema,bookingStaff,slots,ownerStaffId,shopDate} from "../server/domain.ts";
import {applySettingsFacts,proposeSettings} from "../server/settings-ai.ts";
import {Store} from "../server/store.ts";
import {createApp} from "../server/app.ts";
import {digest} from "../server/auth.ts";
import {encrypt} from "../server/google.ts";
import {createPreviewClient,sampleFixtures} from "../src/local-preview.ts";

function ownerShop() {
 return shopSchema.parse({...structuredClone(sample),ownerBooking:true,staff:[],hours:{start:"09:00",end:"19:00",closedWeekdays:[],holidays:[],weekdayHours:[{day:2,start:"09:00",end:"21:00"}]},rules:{...sample.rules,leadMinutes:0,advanceDays:60,sameDay:true}});
}

test("owner shifts restrict weekdays, hours and base/add-on skills without changing older profile-only availability",()=>{
 const config=ownerShop(),now=new Date("2026-11-01T00:00:00+09:00");
 // Old profiles stored opening hours when their names/photos were saved; they must
 // still follow later weekday extensions until working conditions are edited.
 config.staff=[{...bookingStaff(config)[0],start:"09:00",end:"19:00",weekdays:[1],menuIds:["simple"],name:"Owner"}];
 assert.equal(slots(config,[],"2026-11-03","simple",ownerStaffId,now).at(-1)!.end,"2026-11-03T12:00:00.000Z");
 assert.ok(slots(config,[],"2026-11-03","design",ownerStaffId,now).length);
 config.staff[0]={...config.staff[0],customAvailability:true,weekdays:[2,5],start:"10:00",end:"17:00",menuIds:["simple"]};
 const choices=slots(config,[],"2026-11-03","simple",ownerStaffId,now);assert.equal(choices[0].start,"2026-11-03T01:00:00.000Z");assert.equal(choices.at(-1)!.end,"2026-11-03T08:00:00.000Z");
 assert.deepEqual(slots(config,[],"2026-11-02","simple",ownerStaffId,now),[]);assert.deepEqual(slots(config,[],"2026-11-03","design",ownerStaffId,now),[]);
 config.menus.push({id:"care",name:"Care",duration:30,price:500,active:true,optionFor:["simple"]});
 assert.deepEqual(slots(config,[],"2026-11-03","simple",ownerStaffId,now,["care"]),[]);config.staff[0].menuIds.push("care");
 const combined=slots(config,[],"2026-11-03","simple",ownerStaffId,now,["care"]);assert.ok(combined.length);assert.ok(combined.every(slot=>Date.parse(slot.end)-Date.parse(slot.start)===90*60000));assert.equal(combined.at(-1)!.end,"2026-11-03T08:00:00.000Z");
 config.hours.weekdayHours=[{day:2,start:"11:00",end:"16:00"}];const shortened=slots(config,[],"2026-11-03","simple",ownerStaffId,now);assert.equal(shortened[0].start,"2026-11-03T02:00:00.000Z");assert.equal(shortened.at(-1)!.end,"2026-11-03T07:00:00.000Z");
 config.hours.closedWeekdays=[2];assert.deepEqual(slots(config,[],"2026-11-03","simple",ownerStaffId,now),[]);config.hours.closedWeekdays=[];config.hours.holidays=["2026-11-03"];assert.deepEqual(slots(config,[],"2026-11-03","simple",ownerStaffId,now),[]);
});

test("settings AI can configure the implicit owner and preserves profile-only defaults for name changes",async()=>{
 const config=ownerShop();
 const proposed=await proposeSettings("staff",config,"Owner works Monday and Friday, 11–16",{generate:async input=>{
  const text=input.contents[0].parts?.[0]?.text;assert.ok(text);const prompt=JSON.parse(text);assert.equal(prompt.current[0].id,ownerStaffId);
  return JSON.stringify({facts:{items:[{id:ownerStaffId,name:"Owner",weekdays:[1,5],start:"11:00",end:"16:00",menuIds:["simple"]}]},warnings:[]});
 }});
 const row=(proposed.value as typeof config.staff)[0];assert.equal(row.customAvailability,true);assert.deepEqual(row.weekdays,[1,5]);assert.equal(row.end,"16:00");
 const named=applySettingsFacts(config,"staff",{items:[{name:bookingStaff(config)[0].name,weekdays:[1],start:"10:00",end:"16:00",menuIds:["simple"]}]}).config;assert.equal(named.staff.length,1);assert.equal(named.staff[0].id,ownerStaffId);assert.equal(named.staff[0].customAvailability,true);
 config.staff=[{...bookingStaff(config)[0],end:"19:00",imageId:"a".repeat(64)}];
 const renamed=applySettingsFacts(config,"staff",{items:[{id:ownerStaffId,name:"Renamed"}]}).config;assert.equal(renamed.staff[0].name,"Renamed");assert.equal(renamed.staff[0].customAvailability,undefined);
 const shifted=applySettingsFacts(config,"staff",{items:[{id:ownerStaffId,name:"Owner",weekdays:[2]}]}).config;
 assert.equal(shifted.staff[0].customAvailability,true);assert.equal(shifted.staff[0].end,"21:00");assert.equal(shifted.staff[0].imageId,"a".repeat(64));assert.deepEqual(bookingStaff(shifted)[0].weekdays,[2]);
});

test("saved owner shifts control HTTP and offline booking, keeping automatic owner Calendar checks",async t=>{
 process.env.DEMO_MODE="true";const store=new Store(":memory:"),shop=await store.createShop("owner@example.com"),config=ownerShop();shop.published=config;shop.publication="public";await store.saveShop(shop);
 await store.put("user",shop.owner,{email:shop.owner,name:"Owner",role:"owner",calendarRefreshToken:encrypt("calendar")});
 for(const [key,email,role] of [["owner",shop.owner,"owner"],["customer","customer@example.com","customer"]])await store.put("session",digest(key),{user:{email,name:key,role,shopId:shop.id},expires:Date.now()+600000});
 await store.put("customer",`${shop.id}:customer@example.com`,{shopId:shop.id,email:"customer@example.com",name:"Customer",birthDate:"1990-01-01",gender:"not_specified"});
 let busy:{start:string;end:string}[]=[];
 const server=createApp(store,undefined,{async exchange(){throw new Error("No separate Calendar setup");},async busy(connection){assert.equal(connection.staffId,ownerStaffId);assert.equal(connection.email,shop.owner);return busy;}});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;t.after(async()=>{server.close();await store.close();});
 const request=async(path:string,data?:unknown,who="owner")=>{const response=await fetch(origin+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:`gemihub_session=${who}`,"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};};
 const date=shopDate(config,Date.now()+4*86400000),weekday=new Date(date+"T12:00:00Z").getUTCDay();
 const profile={...bookingStaff(config)[0],customAvailability:true as const,weekdays:[weekday],start:"11:00",end:"14:00",menuIds:["simple"]};
 assert.equal((await request(`/api/shops/${shop.id}/live-settings/staff`,{value:[profile],requestId:randomUUID()})).status,200);
 const saved=(await store.shop(shop.id))!.published!;assert.deepEqual(bookingStaff(saved)[0],profile);assert.equal((await request(`/api/shops/${shop.id}/staff-accounts`)).body.staff.length,0);
 const {customAvailability: _marker,...oldProfile}=profile;const oldSave={value:[{...oldProfile,name:"New name from an older screen",weekdays:[0,1,2,3,4,5,6],start:"09:00",end:"21:00",menuIds:config.menus.map(menu=>menu.id)}],requestId:randomUUID()};
 assert.equal((await request(`/api/shops/${shop.id}/live-settings/staff`,oldSave)).status,200);assert.equal((await request(`/api/shops/${shop.id}/live-settings/staff`,oldSave)).status,200);const retained=(await store.shop(shop.id))!.published!.staff[0];assert.equal(retained.name,"New name from an older screen");assert.equal(retained.customAvailability,true);assert.deepEqual(retained.weekdays,profile.weekdays);assert.equal(retained.end,"14:00");assert.deepEqual(retained.menuIds,["simple"]);
 const path=`/api/public/${shop.slug}/slots?date=${date}&menu=simple`,choices=(await request(path)).body;assert.ok(choices.length);assert.equal(choices[0].start,`${date}T02:00:00.000Z`);assert.equal(choices.at(-1).end,`${date}T05:00:00.000Z`);
 assert.deepEqual((await request(`/api/public/${shop.slug}/slots?date=${date}&menu=design`)).body,[]);
 const other=shopDate(config,Date.parse(`${date}T12:00:00Z`)+86400000);assert.deepEqual((await request(`/api/public/${shop.slug}/slots?date=${other}&menu=simple`)).body,[]);
 assert.equal((await request(`/api/public/${shop.slug}/bookings`,{menuId:"simple",start:`${date}T00:00:00.000Z`,name:"Customer"},"customer")).status,409);
 busy=[choices[0]];assert.equal((await request(`/api/public/${shop.slug}/bookings`,{menuId:"simple",start:choices[0].start,name:"Customer"},"customer")).status,409);busy=[];
 assert.equal((await request(`/api/public/${shop.slug}/bookings`,{menuId:"simple",start:choices[0].start,name:"Customer"},"customer")).status,200);
 const fixtures=sampleFixtures(saved);fixtures.bookings=[];const preview=createPreviewClient(saved,fixtures,"shift");assert.deepEqual(await preview(`/api/public/local-preview/slots?date=${date}&menu=simple`),choices);
});
