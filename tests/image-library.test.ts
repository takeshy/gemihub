import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { propose, proposeArticle, identifyVisual, explainSystem } from "../server/ai.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { uploadMenuImage, readMenuImage, menuImageSnapshot, validateMenuImages, type ImageUpload } from "../server/menu-images.ts";
import { generateLibraryImage, listImages } from "../server/image-library.ts";
import { requestImageIdsSchema, requestImageTotalLimit, generateImageSchema, type LibraryImage } from "../server/image-library-domain.ts";
import { artifacts } from "../server/artifacts.ts";
import { driveMock } from "../server/drive-mock.ts";
import { createPreviewClient } from "../src/local-preview.ts";
import { requestImageParts, readRequestImages, type RequestImage } from "../server/request-images.ts";

const image = { mimeType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
process.env.DEMO_MODE = "true";

test("Private memo images stay on customer pages and out of managed inputs; selected managed bytes reach text and page models", async t => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  const other = await store.createShop("other@example.com");
  for (const [id, email] of [["owner", shop.owner], ["staff", "staff@example.com"], ["customer", "guest@example.com"], ["other", other.owner]]) await store.put("session", digest(id), { user: { email, name: id }, expires: Date.now() + 600000 });
  await store.put("member", `${shop.id}:staff@example.com`, { accepted: true, shopId: shop.id });
  const files = memoryCustomerFiles(store);
  const uploaded = await uploadMenuImage(store, shop, { ...image, name: "管理画像.png", requestId: randomUUID() }, files, "");
  const foreign = await uploadMenuImage(store, other, { ...image, name: "他店.png", requestId: randomUUID() }, files, "");
  const privateId = "e".repeat(64);
  await files.upload(shop, "", privateId, { ...image, name: "非公開.png" });
  const note = { id: "memo", shopId: shop.id, email: "guest@example.com", text: "PRIVATE MEMO BODY", attachments: [{ id: privateId, name: "非公開.png", mimeType: image.mimeType, size: Buffer.byteLength(image.data, "base64") }, { id: "pdf", name: "文書.pdf", mimeType: "application/pdf", size: 5 }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: shop.owner, updatedBy: shop.owner, status: "active" };
  await store.put("customerNote", note.id, note);
  await store.put("customer",`${shop.id}:guest@example.com`,{shopId:shop.id,email:"guest@example.com",name:"お客様",birthDate:"1990-01-01",gender:"not_specified",updatedBy:shop.owner,updatedAt:new Date().toISOString()});
  await store.put("customerNote", "deleted", { ...note, id: "deleted", status: "deleted" });
  await store.put("customerNote", "foreign", { ...note, id: "foreign", shopId: other.id });
  let proposedImages: RequestImage[] = [], pageImages: RequestImage[] = [], questionImages: RequestImage[] = [], calls = 0, inject = false;
  const server = createApp(store, {
    async visualReview() { return { approved: true, issues: [] }; },
    propose: async (_text, current, _email, _demo, images = []) => { calls++; proposedImages = images; const config = structuredClone(current || sample); config.header.imageId = inject ? foreign.imageId : images[0]?.id; config.header.imageUrl = ""; return { config, summary: ["画像変更"] }; },
    proposeArticle, identifyVisual,
    explainSystem: async (_text, _config, _demo, context) => { questionImages = context?.images || []; return { answer: "選択画像を確認", changeRequest: true }; },
    createPage: async (_messages, _context, _mode, images = []) => { pageImages = images; return { reply: "画像を使った案", page: { slug: "photo", title: "紹介", navigationLabel: "紹介", body: "紹介文", layout: "standard", imageUrl: "", imageId: inject ? foreign.imageId : images[0]?.id } }; },
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  const base = `/api/shops/${shop.id}/`;
  async function api(path: string, data?: unknown, user = "owner") { const response = await fetch(origin + base + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${user}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: response.status, body: await response.json() }; }
  assert.equal((await api("images/customer-memos")).status,404);
  const customerImages=await api("customers/guest%40example.com/images");assert.equal(customerImages.status,200);assert.deepEqual(customerImages.body.images.map((item:{id:string})=>item.id),[privateId]);
  assert.deepEqual((await api("images")).body.map((item: LibraryImage) => item.id), [uploaded.imageId]);
  assert.equal((await api("images/customer-memos", { name: "edit" })).status, 404);
  const request = { text: "選んだ画像をヘッダーに使って", imageIds: [uploaded.imageId] };
  const result = await api("plan", request); assert.equal(result.status, 200); assert.equal(result.body.config.header.imageId, uploaded.imageId); assert.equal((await store.shop(shop.id))!.published!.header.imageId, undefined);
  assert.deepEqual(proposedImages, [{ id: uploaded.imageId, name: "管理画像.png", ...image }]);
  assert.deepEqual(requestImageParts({ request: "写真を使う" }, proposedImages).at(-1), { inlineData: image });
  assert.equal((await api("system/question", { question: "選択画像を使いたい", revision: shop.revision, imageIds: request.imageIds })).status, 200); assert.deepEqual(questionImages, proposedImages);
  const pageRequest = { messages: [{ role: "user", text: "選んだ画像で紹介ページを作って" }], mode: "write", imageIds: request.imageIds };
  assert.equal((await api("pages/create-with-ai", pageRequest)).body.page.imageId, uploaded.imageId); assert.deepEqual(pageImages, proposedImages);
  await store.put("visual", "pen", { id: "pen", shopId: shop.id, base: shop.revision, config: structuredClone(shop.published), source: structuredClone(shop.published), createdAt: Date.now(), candidates: [{ id: "part:header", label: "ヘッダー" }] });
  const pen = await api("visual/propose", { id: "pen", target: "part:header", instruction: "選んだ画像を使う", imageIds: request.imageIds }); assert.equal(pen.status, 200); assert.equal(pen.body.config.header.imageId, uploaded.imageId); assert.deepEqual(proposedImages, pageImages);
  for (const id of [privateId, foreign.imageId]) {
    const before = calls; assert.equal((await api("plan", { ...request, imageIds: [id] })).status, 404); assert.equal(calls, before);
    assert.equal((await api("pages/create-with-ai", { ...pageRequest, imageIds: [id] })).status, 404);
  }
  assert.equal((await api("plan", { ...request, imageIds: [uploaded.imageId, uploaded.imageId] })).status, 400);
  inject = true; assert.equal((await api("plan", request)).status, 400); assert.equal((await api("pages/create-with-ai", pageRequest)).status, 400); inject = false;
  const archived = await uploadMenuImage(store, shop, { ...image, name: "削除.png", requestId: randomUUID() }, files, ""); await api(`images/${archived.imageId}/archive`, {}); assert.equal((await api("plan", { ...request, imageIds: [archived.imageId] })).status, 404);
  const huge = { ...image, data: Buffer.concat([Buffer.from(image.data, "base64"), Buffer.alloc(4 * 1024 * 1024)]).toString("base64") };
  const largeIds = await Promise.all([1, 2, 3].map(async n => (await uploadMenuImage(store, shop, { ...huge, name: `${n}.png`, requestId: randomUUID() }, files, "")).imageId));
  const optimized = await readRequestImages(store, shop, largeIds, files, "");
  assert.equal(optimized.length, 3);
  assert.ok(optimized.every(image => image.mimeType === "image/jpeg"));
  assert.ok(optimized.reduce((sum,image) => sum + Buffer.byteLength(image.data,"base64"),0) < 12 * 1024 * 1024);
  assert.equal((await readMenuImage(store,shop,largeIds[0],files,"")).data,huge.data,"original in Drive remains intact");
});

test("Image library is owner-only; header/page images are public only when referenced and cannot expose private attachments or other shops", async t => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  const other = await store.createShop("other@example.com"); other.published = structuredClone(sample); await store.saveShop(other);
  for (const [id, email] of [["owner", shop.owner], ["staff", "staff@example.com"], ["customer", "guest@example.com"], ["other", other.owner]]) await store.put("session", digest(id), { user: { email, name: id, role: "customer", shopId: shop.id }, expires: Date.now() + 600000 });
  await store.put("member", `${shop.id}:staff@example.com`, { email: "staff@example.com", shopId: shop.id, accepted: true });
  const server = createApp(store); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  async function api(path: string, data?: unknown, user = "owner") {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${user}`, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const base = `/api/shops/${shop.id}/images`;
  const input = { ...image, name: "紹介.png", requestId: randomUUID() };
  for (const user of ["staff", "customer", "other", "anonymous"]) {
    assert.equal((await api(base, undefined, user)).status, 403);
    assert.equal((await api(base, input, user)).status, 403);
    assert.equal((await api(`${base}/generate`, { name: "生成.png", prompt: "花", requestId: randomUUID() }, user)).status, 403);
  }
  const uploaded = await api(base, input); assert.equal(uploaded.status, 200); const id = uploaded.body.imageId;
  assert.equal((await api(base, input)).body.imageId, id);
  const items: LibraryImage[] = (await api(base)).body; assert.equal(items.length, 1); assert.equal(items[0].id, id); assert.equal(items[0].name, "紹介.png");
  assert.equal("fileId" in items[0], false); assert.deepEqual(items[0].usedBy, []);
  assert.equal((await api(`/api/public/${shop.slug}/images/${id}`, undefined, "anonymous")).status, 404);
  assert.deepEqual((await api(`${base}/${id}`)).body, image);
  assert.equal((await api(`${base}/${id}/rename`, { name: "春の紹介.png" })).status, 200);
  assert.equal((await api(base)).body[0].name, "春の紹介.png");
  const desired = structuredClone(shop.published!); desired.header.imageId = id;
  desired.pages = [{ id: "faq", slug: "faq", title: "よくある質問", navigationLabel: "FAQ", body: "## ご案内", layout: "standard", imageUrl: "", imageId: id }];
  for (const scope of [{ kind: "part", part: "header" }, { kind: "page", pageId: "faq" }]) {
    const current = (await store.shop(shop.id))!;
    const plan = await api(`/api/shops/${shop.id}/plan`, { text: "選択した画像を反映", config: desired, local: { base: current.revision, source: current.published, requestId: randomUUID(), scope } });
    assert.equal(plan.status, 200);
    assert.equal((await api(`/api/shops/${shop.id}/plans/${plan.body.id}/approve`, {})).status, 200);
    assert.equal((await api(`/api/shops/${shop.id}/plans/${plan.body.id}/publish`, {})).status, 200);
    if (scope.kind === "part") assert.equal((await store.shop(shop.id))!.published!.pages.length, 0, "header publication must not publish the local page");
  }
  Object.assign(shop, (await store.shop(shop.id))!);
  assert.deepEqual((await api(`/api/public/${shop.slug}/images/${id}`, undefined, "anonymous")).body, image);
  assert.equal((await api(`/api/public/${shop.slug}/menu-images/${id}`, undefined, "anonymous")).status, 404);
  assert.deepEqual((await api(base)).body[0].usedBy, ["ヘッダー", "ページ：よくある質問"]);
  assert.equal((await api(`${base}/${id}/archive`, {})).status, 409);
  for (const user of ["staff", "customer", "other", "anonymous"]) {
    assert.equal((await api(`${base}/${id}/rename`, { name: "他人.png" }, user)).status, 403);
    assert.equal((await api(`${base}/${id}/archive`, {}, user)).status, 403);
  }
  other.published!.header.imageId = id; await store.saveShop(other);
  assert.equal((await api(`/api/public/${other.slug}/images/${id}`, undefined, "anonymous")).status, 404);
  const privateId = "f".repeat(64); await store.put("customerNoteUpload", privateId, { shopId: shop.id, attachments: [{ id: "private-drive-file" }] });
  const forged = structuredClone(sample); forged.header.imageId = privateId;
  await assert.rejects(validateMenuImages(store, shop, forged), /画像がありません/);
  assert.equal((await api(`${base}/${privateId}`)).status, 404);
  delete shop.published!.header.imageId; shop.published!.pages = []; await store.saveShop(shop);
  assert.equal((await api(`${base}/${id}/archive`, {})).status, 409, "retained designs still need the image for restoration");
  // Once the referencing versions have aged out, normal image archiving is allowed.
  shop.designVersions = []; await store.saveShop(shop);
  assert.equal((await api(`${base}/${id}/archive`, {})).status, 200);
  assert.deepEqual((await api(base)).body, []);
  assert.equal((await api(`${base}/${id}`)).status, 404);
  const receipt = (await store.get<ImageUpload>("menuImageUpload", id))!;
  assert.ok(await store.get("demoCustomerFile", receipt.fileId), "archiving retains the owner's Drive file");
});

test("AI generation uses separate locks, persists one image per request and lets ordinary shop operations finish while generating", async t => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); shop.published = structuredClone(sample); await store.saveShop(shop);
  await store.put("session", digest("owner"), { user: { email: shop.owner, role: "owner", name: "店主" }, expires: Date.now() + 600000 });
  let release!: () => void, started!: () => void, calls = 0;
  const wait = new Promise<void>(resolve => { release = resolve; }); const generating = new Promise<void>(resolve => { started = resolve; });
  const server = createApp(store, { propose, proposeArticle, identifyVisual, explainSystem, generateImage: async () => { calls++; started(); await wait; return { ...image, model: "test-gemini-image" }; } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; process.env.APP_ORIGIN = origin;
  t.after(() => { release(); server.close(); void store.close(); });
  async function api(path: string, data?: unknown) { const response = await fetch(origin + `/api/shops/${shop.id}/` + path, { method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: response.status, body: await response.json() }; }
  const input = { requestId: randomUUID(), name: "花.png", prompt: "季節の花を飾った明るい窓辺", aspectRatio: "16:9" };
  const first = api("images/generate", input); await generating;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const context = await Promise.race([api("build-context"), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("image generation blocked shop operations")), 2000); })]);
    assert.equal(context.status, 200);
  } finally { clearTimeout(timer); release(); }
  const second = api("images/generate", input);
  const results = await Promise.all([first, second]); assert.equal(results[0].status, 200); assert.deepEqual(results[0], results[1]); assert.equal(calls, 1);
  const list = (await api("images")).body; assert.equal(list.length, 1); assert.equal(list[0].source, "ai"); assert.equal(list[0].prompt, input.prompt); assert.equal(list[0].model, "test-gemini-image");
  assert.equal((await api("images/generate", { ...input, prompt: "別の指示" })).status, 409); assert.equal(calls, 1);
});

test("Generated bytes survive a failed Drive upload without another paid generation; legacy uploads remain discoverable", async () => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); const files = memoryCustomerFiles(store);
  let calls = 0, reserves = 0, interrupted = false;
  const largeImage = { ...image, data: Buffer.concat([Buffer.from(image.data, "base64"), Buffer.alloc(900000)]).toString("base64") };
  const generator = async () => { calls++; return { ...largeImage, model: "test-image-model" }; };
  const gateway = { ...files, async reserve(count: number, token: string) { reserves++; return files.reserve(count, token); }, async upload(...args: Parameters<typeof files.upload>) { await files.upload(...args); if (!interrupted) { interrupted = true; throw new Error("lost Drive response"); } } };
  const input = generateImageSchema.parse({ requestId: randomUUID(), name: "generated.png", prompt: "季節の花" });
  await assert.rejects(generateLibraryImage(store, shop, input, gateway, "", generator), /lost Drive response/);
  const chunks = await store.list<{ data: string }>("imageGenerationData"); assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.data.length <= 400000));
  const saved = await generateLibraryImage(store, shop, input, gateway, "", generator);
  assert.deepEqual(await generateLibraryImage(store, shop, input, gateway, "", generator), saved); assert.equal(calls, 1); assert.equal(reserves, 1);
  assert.deepEqual(await readMenuImage(store, shop, saved.imageId, files, ""), largeImage);
  assert.equal((await store.list("imageGenerationData")).length, 0);
  const original = await uploadMenuImage(store, shop, { ...image, name: "old.png", requestId: randomUUID() }, files, "");
  const old = (await store.get<ImageUpload>("menuImageUpload", original.imageId))!; delete old.name; delete old.source; delete old.createdAt; await store.put("menuImageUpload", original.imageId, old);
  assert.ok((await listImages(store, shop, null)).some(item => item.id === original.imageId && item.source === "upload"));
  const other = await store.createShop("other@example.com");
  await assert.rejects(generateLibraryImage(store, other, { ...input, requestId: randomUUID(), referenceImageId: saved.imageId }, files, "", generator), /画像がありません/); assert.equal(calls, 1);
  let referenceData: unknown;
  await generateLibraryImage(store, shop, { ...input, requestId: randomUUID(), referenceImageId: original.imageId }, files, "", async (_input, reference) => { referenceData = reference; return { ...image, model: "test-image-model" }; });
  assert.deepEqual(referenceData, image);
});

test("Failed and interrupted generation requests cannot silently repeat the paid model call", async () => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); const files = memoryCustomerFiles(store);
  const input = generateImageSchema.parse({ requestId: randomUUID(), name: "花.png", prompt: "季節の花" });
  let calls = 0;
  const failure = async () => { calls++; throw Object.assign(new Error("生成できませんでした"), { status: 422 }); };
  await assert.rejects(generateLibraryImage(store, shop, input, files, "", failure), /生成できませんでした/);
  await assert.rejects(generateLibraryImage(store, shop, input, files, "", failure), /生成できませんでした/);
  assert.equal(calls, 1);
  const interrupted = { ...input, requestId: randomUUID() };
  const id = digest(`${shop.id}:image-generation:${interrupted.requestId}`);
  await store.put("imageGeneration", id, { shopId: shop.id, hash: digest(JSON.stringify(interrupted)), state: "started" });
  await assert.rejects(generateLibraryImage(store, shop, interrupted, files, "", failure), /前回の生成結果を確認できません/);
  assert.equal(calls, 1);
  assert.equal((await listImages(store, shop, null)).length, 0);
});

test("Header and page managed images survive scoped artifacts and offline previews while unreferenced images are omitted", async () => {
  const store = new Store(":memory:"); const shop = await store.createShop("owner@example.com"); const files = memoryCustomerFiles(store);
  const { imageId } = await uploadMenuImage(store, shop, { ...image, name: "page.png", requestId: randomUUID() }, files, "");
  const config = structuredClone(sample); config.header.imageId = imageId; config.pages = [{ id: "faq", slug: "faq", title: "FAQ", navigationLabel: "FAQ", body: "本文", imageUrl: "", imageId, layout: "standard" }];
  await validateMenuImages(store, shop, config);
  const assets = await menuImageSnapshot(store, shop, config, files, ""); assert.deepEqual(Object.keys(assets), [imageId]);
  const mock = driveMock(config, { ...assets, ["e".repeat(64)]: image }); assert.deepEqual(Object.keys(mock.menuImages!), [imageId]);
  const output = artifacts(config, '<html><head></head><body><div id="root"></div></body></html>', undefined, assets);
  assert.ok(output["web/parts/header.html"].includes(`data:image/png;base64,${image.data}`));
  assert.ok(output["web/pages/faq.html"].includes(`data:image/png;base64,${image.data}`));
  assert.equal(JSON.parse(output["web/parts/header.json"]).imageId, imageId);
  const preview = createPreviewClient(config, { customerName: "お客様", bookings: [], posts: [] }, shop.id, async id => assets[id]);
  assert.deepEqual(await preview(`/api/public/local-preview/images/${imageId}`), image);
  await assert.rejects(preview(`/api/public/local-preview/images/${"e".repeat(64)}`));
});

test("AI requests accept 15 original images totaling 75MB and prepare bounded model inputs", async () => {
  const ids = Array.from({length:15},(_,index) => String(index+1).padStart(64,"0"));
  assert.equal(requestImageIdsSchema.safeParse(ids).success,true);
  assert.equal(requestImageIdsSchema.safeParse([...ids,"f".repeat(64)]).success,false);
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  const bytes = Buffer.alloc(5*1024*1024);
  Buffer.from(image.data,"base64").copy(bytes);
  assert.equal(bytes.length*15,requestImageTotalLimit);
  for(const id of ids) await store.put("menuImageUpload",id,{shopId:shop.id,fileId:id,size:bytes.length,mimeType:"image/png",complete:true,name:`${id}.png`});
  const files = { ...memoryCustomerFiles(store), async read(){return bytes;} };
  const prepared = await readRequestImages(store,shop,ids,files,"");
  assert.equal(prepared.length,15);
  assert.deepEqual(prepared.map(image=>image.id),ids);
  assert.ok(Buffer.byteLength(JSON.stringify(requestImageParts({request:"test"},prepared))) < 16*1024*1024);
  const record = (await store.get<ImageUpload>("menuImageUpload",ids[0]))!;
  await store.put("menuImageUpload",ids[0],{...record,size:record.size+1});
  await assert.rejects(readRequestImages(store,shop,ids,files,""),/合計75MB/);
  await store.close();
});
