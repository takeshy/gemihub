import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type {AddressInfo} from "node:net";
import {Store} from "../server/store.ts";
import {createApp} from "../server/app.ts";
import {digest} from "../server/auth.ts";
import {sample,shopSchema,bookingStaff,bookingStaffName,slots,ownerStaffId,dateJST} from "../server/domain.ts";
import {encrypt} from "../server/google.ts";
import {managedImageIds,imageUses} from "../server/image-references.ts";
import {driveSnapshot} from "../server/artifacts.ts";
import {createPreviewClient,sampleFixtures} from "../src/local-preview.ts";

const image={mimeType:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="};

test("owner profile saves a name and managed photo without adding capacity, staff login or Calendar setup",async t=>{
 process.env.DEMO_MODE="true";
 const store=new Store(":memory:"),shop=await store.createShop("owner@example.com");
 const initial=shopSchema.parse({...structuredClone(sample),ownerBooking:true,staff:[]});initial.hours.closedWeekdays=[];shop.published=initial;shop.publication="public";await store.saveShop(shop);
 await store.put("user",shop.owner,{email:shop.owner,name:"Owner",role:"owner",calendarRefreshToken:encrypt("owner-calendar")});
 for(const [key,email,role] of [["owner",shop.owner,"owner"],["employee","employee@example.com","customer"]])await store.put("session",digest(key),{user:{email,name:key,role,shopId:shop.id},expires:Date.now()+600000});
 await store.put("member",`${shop.id}:employee@example.com`,{shopId:shop.id,email:"employee@example.com",accepted:true,status:"accepted"});
 const server=createApp(store,undefined,{async exchange(){throw new Error("No separate Calendar authorization");},async busy(connection){assert.equal(connection.email,shop.owner);assert.equal(connection.staffId,ownerStaffId);return[];}});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;t.after(async()=>{server.close();await store.close();});
 const request=async(path:string,data?:unknown,who="owner")=>{const response=await fetch(origin+path,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:`gemihub_session=${who}`,"Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});return{status:response.status,body:await response.json()};};
 const base=`/api/shops/${shop.id}`,uploaded=await request(`${base}/images`,{...image,name:"owner.png",requestId:randomUUID()});assert.equal(uploaded.status,200);
 const profile={...bookingStaff(initial)[0],name:"森田",imageId:uploaded.body.imageId};
 assert.equal((await request(`${base}/live-settings/staff`,{value:[profile],requestId:randomUUID()},"employee")).status,403);
 assert.equal((await request(`${base}/live-settings/staff`,{value:[profile],requestId:randomUUID()})).status,200);
 const saved=(await store.shop(shop.id))!.published!;assert.equal(saved.ownerBooking,true);assert.equal(bookingStaff(saved).length,1);assert.equal(bookingStaff(saved)[0].name,"森田");assert.equal(bookingStaffName(saved,ownerStaffId),"森田");assert.equal(bookingStaff(saved)[0].imageId,profile.imageId);
 assert.deepEqual((await request(`${base}/staff-accounts`)).body.staff,[]);assert.equal((await store.list("staffAccount")).length,0);
 assert.equal((await request(`${base}/staff-accounts`,{staffId:ownerStaffId,email:"employee@example.com"})).status,400);
 const oldClientId=process.env.GOOGLE_CLIENT_ID;process.env.GOOGLE_CLIENT_ID="test-owner-profile";
 try{assert.equal((await request(`${base}/calendar/connect`,{staffId:ownerStaffId},"employee")).status,403);}finally{if(oldClientId===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=oldClientId;}
 const linked=(await request(`${base}/calendar`)).body;assert.equal(linked.connected,true);assert.equal(linked.staffId,ownerStaffId);
 const date=dateJST(new Date(Date.now()+3*86400000)),choices=await request(`/api/public/${shop.slug}/slots?date=${date}&menu=simple`);assert.equal(choices.status,200);assert.deepEqual(choices.body.map((slot:{start:string})=>slot.start),slots(initial,[],date,"simple").map(slot=>slot.start));assert.ok(choices.body.every((slot:{staffId:string})=>slot.staffId===ownerStaffId));
 assert.deepEqual((await request(`/api/public/${shop.slug}/images/${profile.imageId}`)).body,image);
 assert.ok(managedImageIds(saved).includes(profile.imageId));assert.ok(imageUses(saved,profile.imageId).some(label=>label.includes("森田")));
 const artifacts=driveSnapshot(saved,'<title></title><div id="root"></div>',undefined,{[profile.imageId]:image as {mimeType:"image/png";data:string}});assert.ok(JSON.parse(artifacts["web/mock.json"]).menuImages[profile.imageId]);
 const preview=createPreviewClient(saved,sampleFixtures(saved),shop.id,async()=>image as {mimeType:"image/png";data:string});assert.deepEqual(await preview(`/api/public/local-preview/images/${profile.imageId}`),image);
 const withEmployee=[profile,{...sample.staff[1],menuIds:saved.menus.map(menu=>menu.id)}];assert.equal((await request(`${base}/live-settings/staff`,{value:withEmployee,requestId:randomUUID()})).status,200);
 assert.deepEqual(bookingStaff((await store.shop(shop.id))!.published!).map(staff=>staff.id),["haru",ownerStaffId]);assert.equal((await request(`${base}/staff-accounts`)).body.staff.length,1);
 assert.equal((await request(`${base}/live-settings/staff`,{value:[profile],requestId:randomUUID()})).status,200);assert.equal(bookingStaff((await store.shop(shop.id))!.published!).length,1);
});
