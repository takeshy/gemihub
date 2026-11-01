import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample, planSummary } from "../server/domain.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";
test("consultation never creates changes; new pages and navigation are reviewed and applied together", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const original = structuredClone(sample);
  original.pages = [{id:"access", slug:"access", title:"アクセス", navigationLabel:"アクセス", body:"既存の案内", layout:"standard", imageUrl:""}];
  shop.published = original; shop.publication = "public";
  await store.saveShop(shop);
  await store.put("session", digest("owner"), {user:{email:shop.owner,name:"店主",role:"owner"},expires:Date.now()+600000});
  const added = {id:"faq", slug:"faq", title:"よくある質問", navigationLabel:"はじめての方へ", body:"## 予約の方法\n\n予約画面でメニューと日時を選びます。", layout:"standard" as const, imageUrl:""};
  let generated = 0;
  const server = createApp(store, {...intelligence,
    async explainSystem(question) { assert.match(question, /相談のみ|新しいページ/); return {answer:"内容を確認してください",changeRequest:true,ready:true}; },
    async propose(text) {
      generated++;
      assert.match(text, /新しいページ/);
      const config = structuredClone(original);
      // A page-only request must preserve live data even if the model changes it.
      config.menus[0].price = 1; config.hours.end = "12:00"; config.pages[0].body = "依頼していない書き換え";
      config.pages.push(added);
      return {config,summary:planSummary(original,config)};
    },
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => {server.close(); void store.close();});
  const base = `/api/shops/${shop.id}`;
  async function request(action:string,data?:unknown) {
    const response = await fetch(origin+base+action,{method:data===undefined?"GET":"POST",headers:{Origin:origin,Cookie:"gemihub_session=owner","Content-Type":"application/json"},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,body:await response.json()};
  }
  const context = (await request("/build-context")).body;
  const answer = await request("/system/question",{question:"ページを増やせますか？",intent:"consult",revision:context.revision,hash:context.hash});
  assert.equal(answer.status,200); assert.equal(answer.body.changeRequest,false); assert.equal(answer.body.ready,false);
  assert.equal((await request("/plan",{text:"相談だけ",intent:"consult"})).status,400);
  assert.equal(generated,0);
  const plan = await request("/plan",{text:"FAQを新しいページとして追加したい",intent:"new-page",context:{revision:context.revision,hash:context.hash}});
  assert.equal(plan.status,200);
  assert.deepEqual(plan.body.config.menus,original.menus);
  assert.deepEqual(plan.body.config.hours,original.hours);
  assert.deepEqual(plan.body.config.pages,[original.pages[0],added]);
  assert.deepEqual((await store.shop(shop.id))!.published,original,"proposals do not publish new pages or menu entries");
  assert.equal((await request(`/plans/${plan.body.id}/publish`,{})).status,409);
  await request(`/plans/${plan.body.id}/approve`,{});
  assert.equal((await request(`/plans/${plan.body.id}/publish`,{})).status,200);
  const publicConfig = await (await fetch(`${origin}/api/public/${shop.slug}`)).json();
  assert.equal(publicConfig.config.pages[1].navigationLabel,"はじめての方へ");
  assert.equal(publicConfig.config.pages[1].slug,"faq");
  assert.deepEqual(publicConfig.config.menus,original.menus);
});
