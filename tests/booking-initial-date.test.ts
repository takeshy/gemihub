import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, firstAvailableSlots, bookingDates, type Booking } from "../server/domain.ts";
import { nextAvailableSlots, type CalendarGateway } from "../server/calendar.ts";
import { Store } from "../server/store.ts";
import { createPreviewClient, sampleFixtures } from "../src/local-preview.ts";
import { encrypt } from "../server/google.ts";

const now = new Date("2026-11-04T00:00:00Z"); // Wednesday, 09:00 in Japan.
function config() {
  const c = structuredClone(sample);
  c.ownerBooking = true; c.staff = [];
  c.hours = {start:"09:00",end:"18:00",closedWeekdays:[4],holidays:["2026-11-06"]};
  c.rules = {...c.rules,sameDay:false,advanceDays:7,leadMinutes:60};
  return c;
}
const busyDay = (date:string, staffId="owner"): Booking => ({id:date,shopId:"shop",customer:"test@example.com",name:"Test",menuId:sample.menus[0].id,staffId,start:`${date}T00:00:00Z`,end:`${date}T10:00:00Z`,price:0,status:"active",message:"",createdAt:now.toISOString()});

test("initial booking date skips same-day restrictions, closed days, holidays and full days", () => {
  const c=config();
  const result=firstAvailableSlots(c,[busyDay("2026-11-07")],c.menus[0].id,undefined,[],now);
  assert.equal(result.date,"2026-11-08");assert.ok(result.slots.length);
  c.hours.closedWeekdays=[0,1,2,3,4,5,6];
  assert.deepEqual(firstAvailableSlots(c,[],c.menus[0].id,undefined,[],now),{date:"",slots:[]});
});

test("lead time, menu duration, add-ons, staff availability and time zones govern the first date", () => {
  const c=config();c.rules.sameDay=true;c.rules.leadMinutes=10*60;
  assert.equal(firstAvailableSlots(c,[],c.menus[0].id,undefined,[],now).date,"2026-11-07");
  c.rules.leadMinutes=0;c.hours.closedWeekdays=[];c.hours.holidays=[];
  c.hours.end="10:00";c.menus[0].duration=45;
  c.menus.push({id:"extra",name:"Extra",duration:30,price:0,active:true,optionFor:[c.menus[0].id]});
  assert.equal(firstAvailableSlots(c,[],c.menus[0].id,undefined,["extra"],now).date,"");
  c.hours.end="18:00";delete c.ownerBooking;c.staff=[{id:"one",name:"One",menuIds:[c.menus[0].id],weekdays:[5],start:"09:00",end:"18:00"}];
  assert.equal(firstAvailableSlots(c,[],c.menus[0].id,"one",[],now).date,"2026-11-06");
  assert.equal(firstAvailableSlots(c,[],c.menus[0].id,"one",["extra"],now).date,"");
  c.region={country:"US",timeZone:"America/Los_Angeles"};c.rules.sameDay=false;c.rules.advanceDays=3;
  assert.deepEqual(bookingDates(c,now),["2026-11-04","2026-11-05","2026-11-06"]);
  c.region={country:"US",timeZone:"America/New_York"};c.rules.sameDay=true;
  assert.deepEqual(bookingDates(c,new Date("2026-11-01T04:30:00Z")),["2026-11-01","2026-11-02","2026-11-03","2026-11-04"]);
});

test("first-date search includes external Calendar conflicts in one range lookup and propagates Calendar failures", async t => {
  const store=new Store(":memory:");t.after(()=>store.close());
  const shop=await store.createShop("owner@example.com");
  await store.put("user",shop.owner,{email:shop.owner,role:"owner",calendarRefreshToken:encrypt("calendar-test")});
  const c=config();
  let calls=0;
  const gateway:CalendarGateway={async exchange(){throw new Error("Unexpected OAuth");},async busy(connection,start,end){calls++;assert.equal(connection.staffId,"owner");assert.equal(start,"2026-11-06T15:00:00.000Z");assert.equal(end,"2026-11-11T15:00:00.000Z");return [{start:"2026-11-06T15:00:00Z",end:"2026-11-07T15:00:00Z"}];}};
  const result=await nextAvailableSlots(store,shop,c,c.menus[0].id,undefined,gateway,[],now);
  assert.equal(result.date,"2026-11-08");assert.equal(calls,1);
  await store.put("checkout","hold",{id:"hold",shopId:shop.id,phase:"awaiting_approval",expires:Date.now()+600000,booking:busyDay("2026-11-08")});
  assert.equal((await nextAvailableSlots(store,shop,c,c.menus[0].id,undefined,gateway,[],now)).date,"2026-11-09","an in-progress payment also blocks the initial date");
  await assert.rejects(nextAvailableSlots(store,shop,c,c.menus[0].id,undefined,{...gateway,async busy(){throw new Error("Calendar unavailable");}},[],now),{status:503});
});

test("practice bookings use the same first-date search and never propose an unavailable date", async () => {
  const c=config();
  // The practice client uses the live clock, so close today and the next day explicitly.
  const days=bookingDates({...c,rules:{...c.rules,sameDay:true}});
  c.hours.closedWeekdays=[];c.hours.holidays=days.slice(0,3);
  const client=createPreviewClient(c,{...sampleFixtures(c),bookings:[]},"shop");
  const result=await client<{date:string;slots:unknown[]}>(`/api/public/local-preview/slots/next?menu=${c.menus[0].id}`);
  assert.equal(result.date,days[3]);assert.ok(result.slots.length);
});
