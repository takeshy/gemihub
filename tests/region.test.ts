import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { currencyOf, regionOf, regionSchema, regionForBrowser, dateIn, zonedDate, localDateTime, toMinor, fromMinor, paypalValue } from "../shared/region.ts";
import { sample, shopSchema, slots, documents, type Booking } from "../server/domain.ts";
import { browserLocale, localeForRequest, regionForRequest, requestLocale } from "../server/i18n.ts";
import { Store } from "../server/store.ts";
import { availableSlots, calendarGateway } from "../server/calendar.ts";
import { createApp } from "../server/app.ts";
import { customerSince, aggregateCustomers } from "../server/customers.ts";
import { filterInquiries } from "../server/inquiries.ts";
import { createDisplay } from "../src/money.ts";
import { propose } from "../server/ai.ts";
import { artifacts } from "../server/artifacts.ts";
import { scopedConfig, scopedSource } from "../server/pages.ts";

const us = { country: "US", timeZone: "America/New_York" } as const;
function config() {
  const c = structuredClone(sample); c.region = us; c.menus[0].price = 55.01;
  c.hours = { start: "00:00", end: "23:00", closedWeekdays: [], holidays: [] };
  c.staff.forEach(s => { s.weekdays = [0,1,2,3,4,5,6]; s.start = "00:00"; s.end = "23:00"; });
  c.rules.sameDay = true; c.rules.leadMinutes = 0; c.rules.advanceDays = 365;
  return c;
}

test("legacy shops remain JPY; USD prices use cents and display independently of interface language", () => {
  assert.deepEqual(regionOf(sample), {country:"JP",timeZone:"Asia/Tokyo"});
  assert.equal(currencyOf(regionOf(sample)), "JPY");
  const c=config(); assert.equal(shopSchema.parse(c).menus[0].price,55.01);
  c.menus[0].price=55.001; assert.equal(shopSchema.safeParse(c).success,false);
  c.region={country:"JP",timeZone:"Asia/Tokyo"}; c.menus[0].price=55.01; assert.equal(shopSchema.safeParse(c).success,false);
  assert.equal(toMinor(55.01,"USD"),5501); assert.equal(fromMinor(2750,"USD"),27.5);
  assert.equal(paypalValue(5501,"USD"),"55.01"); assert.equal(paypalValue(5501,"JPY"),"5501");
  assert.equal(regionSchema.safeParse({country:"US",timeZone:"Asia/Tokyo"}).success,false);
  const american=createDisplay(us), japanese=createDisplay();
  requestLocale.run("en",()=>{assert.equal(american.money(55.01),"$55.01"); assert.equal(japanese.money(5501),"¥5,501");});
  const instant=new Date("2026-03-08T04:30:00Z");
  assert.equal(american.shopToday(instant),"2026-03-07"); assert.equal(japanese.shopToday(instant),"2026-03-08");
  assert.equal(american.displayTimeZone(),us.timeZone,"another preview cannot change an existing formatter");
});

test("US clocks reject spring gaps, choose the earlier repeated time, and keep real durations within shifts", () => {
  assert.equal(zonedDate("2026-01-15","10:00",us.timeZone).toISOString(),"2026-01-15T15:00:00.000Z");
  assert.equal(zonedDate("2026-07-15","10:00",us.timeZone).toISOString(),"2026-07-15T14:00:00.000Z");
  assert.equal(Number.isNaN(zonedDate("2026-03-08","02:30",us.timeZone).getTime()),true);
  assert.equal(zonedDate("2026-11-01","01:30",us.timeZone).toISOString(),"2026-11-01T05:30:00.000Z");
  const c=config(); c.hours.start="00:00";c.hours.end="04:00";c.rules.interval=30;
  const spring=slots(c,[],"2026-03-08","simple",undefined,new Date("2026-03-01T00:00:00Z"));
  assert.equal(new Set(spring.map(s=>s.start)).size,spring.length);
  assert.ok(spring.every(s=>!localDateTime(s.start,us.timeZone).includes("T02:")));
  assert.ok(spring.every(s=>Date.parse(s.end)-Date.parse(s.start)===60*60000));
  assert.ok(spring.some(s=>s.start==="2026-03-08T06:30:00.000Z"&&s.end==="2026-03-08T07:30:00.000Z"));
  c.hours.end="02:00";
  const fall=slots(c,[],"2026-11-01","simple",undefined,new Date("2026-10-25T00:00:00Z"));
  assert.ok(fall.length); assert.ok(fall.every(s=>Date.parse(s.end)<=Date.parse("2026-11-01T07:00:00Z")));
  c.rules.advanceDays=1;c.hours.end="23:00";
  assert.deepEqual(slots(c,[],"2026-03-09","simple",undefined,new Date("2026-03-08T04:30:00Z")),[],"advance days count shop calendar dates across DST");
  c.hours.closedWeekdays=[0];assert.deepEqual(slots(c,[],"2026-03-08","simple",undefined,new Date("2026-03-01T00:00:00Z")),[]);
});

test("Calendar FreeBusy uses 23/25-hour local days and excludes overlapping US slots", async () => {
  const store=new Store(":memory:"); const shop=await store.createShop("owner@example.com"); const c=config();
  await store.put("calendar","owner",{shopId:shop.id,email:shop.owner,staffId:"aoi",refreshToken:"fixture"});
  const ranges:string[][]=[];
  const gateway={...calendarGateway,async busy(_connection:unknown,start:string,end:string){ranges.push([start,end]);return [];}};
  await availableSlots(store,shop,c,"2026-03-08","simple","aoi",gateway);
  await availableSlots(store,shop,c,"2026-11-01","simple","aoi",gateway);
  assert.deepEqual(ranges,[["2026-03-08T05:00:00.000Z","2026-03-09T04:00:00.000Z"],["2026-11-01T04:00:00.000Z","2026-11-02T05:00:00.000Z"]]);
  const day=dateIn(Date.now()+4*86400000,us.timeZone);
  const free=await availableSlots(store,shop,c,day,"simple","aoi",gateway);assert.ok(free.length);
  const busy=await availableSlots(store,shop,c,day,"simple","aoi",{...gateway,async busy(){return [{start:free[0].start,end:free[0].end}];}});
  assert.ok(!busy.some(s=>s.start===free[0].start));await store.close();
});

test("customer and inquiry date ranges start at the shop's local midnight", () => {
  const now=new Date("2026-03-08T04:30:00Z");
  assert.equal(customerSince({period:"week"},now,us.timeZone),"2026-02-28");
  assert.equal(customerSince({period:"week"},now),"2026-03-01");
  const bookings=["2026-03-08T04:59:00Z","2026-03-08T05:00:00Z"].map((start,i)=>({id:String(i),shopId:"s",customer:"a@example.com",name:"A",menuId:"simple",staffId:"aoi",price:55.01,message:"",status:"active",createdAt:start,start,end:start}) as Booking);
  const customers=aggregateCustomers(bookings,[],[],new Date("2026-03-10T00:00:00Z"),"2026-03-08",[],us.timeZone);
  assert.equal(customers[0].visitCount,1);assert.equal(customers[0].totalAmount,55.01);
  const inquiries=bookings.map(b=>({id:b.id,at:b.start,status:"in_progress",name:"A",email:"a@example.com",message:"x",reply:""}));
  assert.deepEqual(filterInquiries(inquiries,{showCompleted:false,query:"",reply:"all",from:"2026-03-08",to:"2026-03-08"},us.timeZone).map(i=>i.id),["1"]);
});

test("first-visit language and new-shop region are independent; explicit language never rewrites an existing region", async t => {
  for(const [header,expected] of [["ja-JP,en;q=0.9","ja"],["en-US,ja;q=0.8","en"],["fr-FR","en"],[undefined,"ja"]] as const)assert.equal(browserLocale(header),expected);
  assert.deepEqual(regionForBrowser("en-US","America/Los_Angeles"),{country:"US",timeZone:"America/Los_Angeles"});
  assert.deepEqual(regionForBrowser("de","Europe/Berlin"),us);
  const req={url:"/?lang=ja",headers:{"accept-language":"en-US",cookie:"gemihub_tz=America%2FLos_Angeles; gemihub_locale=ja"}} as IncomingMessage;
  assert.equal(localeForRequest(req),"ja");assert.equal(regionForRequest(req).country,"US");
  process.env.DEMO_MODE="true";
  const store=new Store(":memory:");const server=createApp(store);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await store.close();});
  async function login(language:string){const res=await fetch(origin+"/api/demo-login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json","Accept-Language":language,Cookie:"gemihub_tz=America%2FLos_Angeles"},body:JSON.stringify({role:"owner",email:"us@example.com"})});assert.equal(res.status,200);return res.headers.get("set-cookie")!.split(";")[0];}
  let cookie=await login("en-US");const shop=(await store.list<import("../server/store.ts").Shop>("shop"))[0];
  assert.deepEqual(shop.regionDefault,{country:"US",timeZone:"America/Los_Angeles"});
  cookie=await login("ja-JP");assert.deepEqual((await store.shop(shop.id))!.regionDefault,shop.regionDefault);
  const response=await fetch(origin+`/api/shops/${shop.id}/plan`,{method:"POST",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify({text:"A small salon"})});
  assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.config.region.country,"US");assert.equal(plan.config.menus[0].price,55);
  const legacy=await store.createShop("legacy@example.com");assert.equal(legacy.regionDefault,undefined);
  assert.equal((await store.createShop("legacy@example.com",us)).regionDefault,undefined);
});

test("US proposals and Drive artifacts retain region, dollar prices, and settings-only region changes", async () => {
  const draft=await propose("A salon",null,"owner@example.com",true,[],us);assert.deepEqual(draft.config.region,us);
  const c=config();const local=structuredClone(c);local.region={country:"JP",timeZone:"Asia/Tokyo"};local.description="Edited";
  assert.equal((scopedSource(c,{kind:"shared"}) as object).hasOwnProperty("region"),false);
  assert.deepEqual(scopedConfig(c,local,{kind:"shared"}).region,us);
  const output=requestLocale.run("en",()=>artifacts(c,'<html><head></head><body><div id="root"></div></body></html>'));
  assert.match(output["web/index.html"],/\$55\.01/);assert.deepEqual(JSON.parse(output["web/shop.json"]).region,us);
  assert.ok(!requestLocale.run("en",()=>documents(c,[]).spec).includes("Times are in Japan time"));
});
