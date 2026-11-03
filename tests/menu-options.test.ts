import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { optionShop } from "./fixtures/option-shop.ts";
import { sample, slots, menuSelection, bookingMenuName, shopSchema, shopDate, type Booking } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { defaultRefundTiers } from "../server/payment-domain.ts";
import type { PayPalOrder, PayPalRefund, PaymentGateway } from "../server/paypal.ts";
import type { Checkout } from "../server/payments.ts";
import { paypalValue, currencyOf, regionOf, toMinor } from "../shared/region.ts";
import { createPreviewClient, sampleFixtures } from "../src/local-preview.ts";

test("add-ons enforce parent menus and exclusive groups, and extend the full occupied time", () => {
  const config=optionShop(),date="2026-11-06",now=new Date("2026-11-01T00:00:00Z");
  const selection=menuSelection(config,"foot",["other-off","care"])!;assert.equal(selection.price,10500);assert.equal(selection.duration,130);
  for(const [base,ids] of [["own-off",[]],["hand",["care"]],["foot",["own-off","other-off"]],["foot",["care","care"]],["foot",["missing"]]] as [string,string[]][])assert.equal(menuSelection(config,base,ids),undefined);
  const normal=slots(config,[],date,"foot",undefined,now),combined=slots(config,[],date,"foot",undefined,now,["other-off","care"]);assert.ok(combined.length<normal.length);assert.equal(Date.parse(combined[0].end)-Date.parse(combined[0].start),130*60000);
  const busy={...normal[0],start:normal[0].end,end:new Date(Date.parse(normal[0].end)+35*60000).toISOString(),id:"busy",shopId:"s",customer:"x@example.com",name:"X",menuId:"hand",price:0,message:"",status:"active" as const,createdAt:""};
  assert.ok(slots(config,[busy],date,"foot",undefined,now).some(slot=>slot.start===normal[0].start));assert.ok(!slots(config,[busy],date,"foot",undefined,now,["care"]).some(slot=>slot.start===normal[0].start),"the add-on portion also needs to be free");
  assert.equal(menuSelection(optionShop(true),"foot",["care","other-off"])!.price,85.06,"dollar totals are summed in cents");
  assert.equal(shopSchema.safeParse({...config,menus:config.menus.map(menu=>menu.id==="care"?{...menu,optionFor:["missing"]}:menu)}).success,false);
  assert.equal(shopSchema.safeParse({...config,menus:config.menus.map(menu=>menu.id==="care"?{...menu,optionFor:["own-off"]}:menu)}).success,false);
  assert.equal(shopSchema.safeParse({...config,menus:config.menus.map(menu=>menu.id==="care"?{...menu,optionFor:[]}:menu)}).success,false);
});

for(const usd of [false,true])test(`HTTP add-on booking charges and refunds the total with a frozen item snapshot (${usd?"USD":"JPY"})`,async t=>{
  process.env.DEMO_MODE="true";const config=optionShop(usd),currency=currencyOf(regionOf(config)),total=usd?85.06:10500,minor=toMinor(total,currency);config.rules.payment={enabled:true,refundTiers:structuredClone(defaultRefundTiers)};
  const store=new Store(":memory:"),shop=await store.createShop("owner@example.com");shop.published=config;await store.saveShop(shop);
  await store.put("session",digest("customer"),{user:{email:"customer@example.com",name:"Customer",role:"customer",shopId:shop.id},expires:Date.now()+600000});
  await store.put("customer",`${shop.id}:customer@example.com`,{shopId:shop.id,email:"customer@example.com",name:"Customer",birthDate:"1990-01-01",gender:"not_specified"});
  let order:PayPalOrder|undefined,created=0,captured=0,refunded=0;
  const gateway:PaymentGateway={environment:"sandbox",async ready(){},async create(id,amount,_return,_cancel,actualCurrency){assert.equal(amount,minor);assert.equal(actualCurrency,currency);created++;order={id:"order",status:"CREATED",purchase_units:[{custom_id:id,amount:{currency_code:currency,value:paypalValue(minor,currency)}}],links:[{rel:"payer-action",href:"https://www.sandbox.paypal.com/checkoutnow?token=option-test"}]};return structuredClone(order);},async order(){return structuredClone(order!);},async capture(){captured++;order!.status="COMPLETED";order!.purchase_units![0].payments={captures:[{id:"capture",status:"COMPLETED",amount:{currency_code:currency,value:paypalValue(minor,currency)}}]};return structuredClone(order!);},async refund(_capture,amount,_request,actualCurrency){assert.equal(amount,minor);assert.equal(actualCurrency,currency);refunded++;return{id:"refund",status:"COMPLETED",amount:{currency_code:currency,value:paypalValue(minor,currency)}};},async refundStatus(){throw new Error("Unexpected refund poll");}};
  const server=createApp(store,undefined,undefined,undefined,gateway);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;t.after(async()=>{server.close();await store.close();});
  const request=async(path:string,data?:unknown)=>{const r=await fetch(origin+path,{method:data===undefined?"GET":"POST",headers:{Cookie:"gemihub_session=customer",Origin:origin,"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});return{status:r.status,body:await r.json()};};
  const base=`/api/public/${shop.slug}`,date=shopDate(config,Date.now()+4*86400000),choices=await request(`${base}/slots?date=${date}&menu=foot&option=other-off&option=care`);assert.equal(choices.status,200);const first=choices.body[0];assert.equal(Date.parse(first.end)-Date.parse(first.start),130*60000);
  const input={name:"Customer",menuId:"foot",optionIds:["other-off","care"],start:first.start,requestId:randomUUID(),paymentConsent:{amount:total,policy:defaultRefundTiers}};
  assert.equal((await request(`${base}/bookings`,{...input,menuId:"care",optionIds:[]})).status,400);
  assert.equal((await request(`${base}/bookings`,{...input,optionIds:["own-off","other-off"]})).status,400);
  assert.equal((await request(`${base}/bookings`,{...input,menuId:"hand",optionIds:["care"]})).status,400);
  assert.equal((await request(`${base}/bookings`,{...input,paymentConsent:{...input.paymentConsent,amount:config.menus[1].price}})).status,409);assert.equal(created,0);
  assert.equal((await request(`${base}/bookings`,{...input,expectedDuration:60})).status,409);assert.equal(created,0);
  const started=await request(`${base}/bookings`,input);assert.equal(started.status,200);assert.equal(started.body.checkout.amount,total);assert.equal(created,1);
  const id=started.body.checkout.id,checkout=(await store.get<Checkout>("checkout",id))!;assert.equal(checkout.booking.price,total);assert.equal(checkout.booking.items!.length,3);assert.deepEqual(checkout.booking.optionIds,["care","other-off"]);
  assert.equal((await request(`${base}/bookings`,{...input,optionIds:["care","other-off"]})).status,200);assert.equal(created,1,"reordered retries reuse the same checkout");
  assert.equal((await request(`${base}/bookings`,{...input,optionIds:["care"]})).status,409);
  assert.ok(!(await request(`${base}/slots?date=${date}&menu=hand`)).body.some((slot:{start:string})=>Date.parse(slot.start)<Date.parse(first.end)),"the full combined duration is held");
  order!.status="APPROVED";const completed=await request(`${base}/checkouts/${id}/capture`,{});assert.equal(completed.status,200);assert.equal(completed.body.ok,true);assert.equal(captured,1);
  const booking=completed.body.booking as Booking;assert.equal(booking.payment!.amount,minor);assert.equal(booking.price,total);assert.equal(bookingMenuName(config,booking),"Foot + Foot care + Other removal");
  const changed=structuredClone(config);changed.menus.find(menu=>menu.id==="care")!.name="Changed after booking";changed.menus.find(menu=>menu.id==="care")!.price=9999;await store.saveShop({...shop,published:changed});
  assert.equal(bookingMenuName(changed,(await store.bookings(shop.id))[0]),"Foot + Foot care + Other removal");
  const quote=await request(`${base}/bookings/${booking.id}/cancel-quote`);assert.equal(quote.body.amount,minor);
  assert.equal((await request(`${base}/bookings/${booking.id}/cancel`,{expectedRefund:minor})).status,200);assert.equal(refunded,1);assert.equal((await store.bookings(shop.id))[0].payment!.cancellation!.amount,minor);
});

test("sample bookings skip add-on-only staff and allow configurations with no standalone service assignment", () => {
  const config = structuredClone(sample);
  config.menus.push({ id: "care", name: "Care", duration: 15, price: 500, active: true, optionFor: ["simple"] });
  config.staff[0].menuIds = ["care"];
  config.staff[1].menuIds.push("care");
  const fixtures = sampleFixtures(shopSchema.parse(config));
  assert.equal(fixtures.bookings[0].staffId, config.staff[1].id);
  assert.equal(fixtures.bookings[0].menuId, "simple");
  config.menus = config.menus.map(menu => ({ ...menu, active: false }));
  config.staff[1].menuIds = ["care"];
  const empty = sampleFixtures(shopSchema.parse(config));
  assert.deepEqual(empty.bookings, []);
  assert.equal(empty.posts.length, 2);
});

test("offline preview uses the same add-on totals and duration, preserving the item list",async()=>{
  const config=optionShop(),fixtures=sampleFixtures(config);fixtures.bookings=[];
  const api=createPreviewClient(config,fixtures,"preview"),date=shopDate(config,Date.now()+3*86400000);
  const choices=await api<{start:string;end:string}[]>(`/api/public/local-preview/slots?date=${date}&menu=foot&option=care&option=other-off`);assert.ok(choices.length);
  await api("/api/public/local-preview/bookings",{name:"Customer",menuId:"foot",optionIds:["care","other-off"],start:choices[0].start});
  const booked=await api<Booking[]>("/api/public/local-preview/bookings");assert.equal(booked[0].price,10500);assert.equal(Date.parse(booked[0].end)-Date.parse(booked[0].start),130*60000);assert.equal(bookingMenuName(config,booked[0]),"Foot + Foot care + Other removal");
});
