import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import { Store } from '../server/store.ts';
import { sample } from '../server/domain.ts';
import { digest } from '../server/auth.ts';
import * as intelligence from '../server/ai.ts';

process.env.DEMO_MODE='true';
test('temporary progress is cleaned up after the visual request window', async () => {
 const store = new Store(':memory:');
 await store.put('visualGenerationProgress', 'expired', { startedAt: Date.now() - 1800001 });
 await store.put('visualGenerationProgress', 'active', { startedAt: Date.now() });
 await store.cleanup();
 assert.equal(await store.get('visualGenerationProgress', 'expired'), undefined);
 assert.ok(await store.get('visualGenerationProgress', 'active'));
 await store.close();
});
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};};
test('visual progress stays readable during generation/review, separates retries and protects the shop',async t=>{
 const store=new Store(':memory:');const shop=await store.createShop('owner@example.com');shop.published=structuredClone(sample);await store.saveShop(shop);
 await store.put('session',digest('owner'),{user:{email:shop.owner,name:'Owner',role:'owner'},expires:Date.now()+600000});
 await store.put('session',digest('member'),{user:{email:'member@example.com',name:'Member',role:'customer'},expires:Date.now()+600000});
 await store.put('member',`${shop.id}:member@example.com`,{shopId:shop.id,email:'member@example.com',accepted:true,status:'accepted'});
 const generating=gate(),reviewing=gate(),repairing=gate();let generated=0,reviews=0,fail=false;
 const server=createApp(store,{...intelligence,visualAppearance:async current=>{if(fail)throw new Error('fixture provider failure');generated++;await(generated===1?generating.promise:repairing.promise);return{config:{...current,appearance:{accent:'navy',layout:'standard',imageUrl:''}},summary:[]};},visualReview:async()=>{reviews++;if(reviews===1){await reviewing.promise;return{approved:false,issues:['Change the icon color']};}return{approved:true,issues:[]};}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;process.env.APP_ORIGIN=origin;
 t.after(async()=>{generating.release();reviewing.release();repairing.release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await store.close();});
 const id=randomUUID(),requestId=randomUUID();await store.put('visual',id,{id,shopId:shop.id,base:0,source:shop.published,config:shop.published,candidates:[{id:'appearance',label:'Appearance'}],screen:'reserve',createdAt:Date.now()});
 async function api(path:string,data?:unknown,actor='owner'){const r=await fetch(`${origin}/api/shops/${shop.id}/${path}`,{method:data===undefined?'GET':'POST',headers:{Origin:origin,Cookie:`gemihub_session=${actor}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return{status:r.status,body:await r.json()};}
 const path=`visual/${id}/progress?requestId=${requestId}`;
 assert.equal((await api(path)).body,null);assert.equal((await api(path,undefined,'member')).status,403);
 const pending=api('visual/propose',{id,requestId,target:'appearance',instruction:'Change the icon color'});
 async function stage(expected:string){for(let i=0;i<100;i++){const value=(await api(path)).body;if(value?.stage===expected)return value;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail(`missing stage ${expected}`);}
 const first=await stage('generating');assert.equal(first.attempt,1);assert.equal(first.requestId,requestId);
 assert.equal((await api(`visual/${id}/progress?requestId=${randomUUID()}`)).body,null);
 generating.release();await stage('reviewing');reviewing.release();assert.equal((await stage('repairing')).attempt,2);repairing.release();
 assert.equal((await pending).status,200);await stage('complete');assert.equal((await store.shop(shop.id))!.published!.appearance?.accent,shop.published.appearance?.accent,'a proposal never publishes itself');
 fail=true;const failedId=randomUUID();assert.equal((await api('visual/propose',{id,requestId:failedId,target:'appearance',instruction:'Retry'})).status,500);
 assert.equal((await api(`visual/${id}/progress?requestId=${failedId}`)).body.stage,'failed');assert.equal((await api(path)).body.stage,'complete','a later attempt does not replace another request’s progress');
});
