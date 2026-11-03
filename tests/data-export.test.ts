import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { google } from "googleapis";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample } from "../server/domain.ts";
import { exportCsv } from "../server/data-export.ts";

test("CSV preserves quotes, newlines and nested values and prevents spreadsheet formula execution", () => {
  const csv=exportCsv([{name:'=HYPERLINK("https://example.invalid")',text:'line 1\nline 2, "quoted"',amount:-12.5,detail:{id:"x"}},{name:" +cmd",text:"normal",amount:0}],['name','text','amount','detail']);
  assert.ok(csv.startsWith('\uFEFF"name","text","amount","detail"\r\n'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.invalid"")"'));
  assert.ok(csv.includes('"line 1\nline 2, ""quoted"""'));
  assert.ok(csv.includes('"-12.5","{""id"":""x""}"'));
  assert.ok(csv.includes('"\' +cmd"'));
});

test("owner exports scoped JSON and CSV without Google access, credentials or other users' chats", async t => {
  process.env.DEMO_MODE="true";
  t.after(()=>mock.restoreAll());
  mock.method(google,"sheets",(()=>{throw new Error("Sheets must not be called");}) as any);
  mock.method(google,"drive",(()=>{throw new Error("Exports must not require Google Drive");}) as any);
  const store=new Store(":memory:");
  const shop=await store.createShop("owner@example.com");shop.published=structuredClone(sample);shop.publication="public";await store.saveShop(shop);
  const other=await store.createShop("other@example.com");
  for(const [id,email] of [["owner",shop.owner],["staff","staff@example.com"],["other",other.owner]])await store.put("session",digest(id),{user:{email,name:id,role:"owner",shopId:shop.id},expires:Date.now()+3600000});
  await store.put("user",shop.owner,{email:shop.owner,refreshToken:"secret-google-token"});
  await store.put("member",`${shop.id}:staff@example.com`,{shopId:shop.id,email:"staff@example.com",accepted:true});
  await store.put("customer",`${shop.id}:guest@example.com`,{shopId:shop.id,email:"guest@example.com",name:"=secret-formula"});
  await store.put("customer",`${other.id}:other@example.com`,{shopId:other.id,email:"other@example.com",name:"foreign-private-record"});
  await store.put("menuImageUpload","own-image",{shopId:shop.id,fileId:"drive-file",name:"photo.png",mimeType:"image/png",size:10,complete:true,data:"binary-must-not-export"});
  await store.put("menuImageUpload","foreign-image",{shopId:other.id,fileId:"foreign-private-image",complete:true});
  for(const [id,email] of [["own-chat",shop.owner],["staff-chat","staff@example.com"]]){
    await store.put("shopChat",id,{id,shopId:shop.id,email,title:id});
    await store.put("shopChatMessage",id,{id,shopId:shop.id,email,conversationId:id,text:id});
  }
  const server=createApp(store);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();});
  const request=(query="",user="owner",id=shop.id)=>fetch(`${origin}/api/shops/${id}/export${query}`,{headers:{Cookie:`gemihub_session=${user}`}});
  for(const user of ["staff","other","anonymous"])assert.equal((await request("",user)).status,403);
  assert.equal((await request("","owner",other.id)).status,403);
  const response=await request();assert.equal(response.status,200);
  assert.match(response.headers.get("content-disposition")!,/attachment; filename="gemihub-.*\.json"/);
  assert.match(response.headers.get("cache-control")!,/no-store/);
  const text=await response.text();assert.doesNotMatch(text,/secret-google-token|foreign-private-record|staff-chat|foreign-private-image|binary-must-not-export/);
  const data=JSON.parse(text);assert.equal(data.schemaVersion,1);assert.equal(data.shop.id,shop.id);
  assert.equal(data.records.customers[0].email,"guest@example.com");assert.equal(data.chats.length,1);assert.equal(data.messages.length,1);
  assert.deepEqual(data.files.map((file:{imageId:string;fileId:string})=>[file.imageId,file.fileId]),[["own-image","drive-file"]]);
  const csv=await request("?format=csv&table=customers");assert.match(csv.headers.get("content-type")!,/text\/csv/);assert.ok((await csv.text()).includes('"\'=secret-formula"'));
  assert.equal((await request("?format=csv&table=users")).status,400);
  assert.equal((await request("?format=exe")).status,400);
});
