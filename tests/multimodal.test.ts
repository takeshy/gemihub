import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.ts";
import { Store, type Shop } from "../server/store.ts";
import {
  sample,
  planSummary,
  documents,
  shopSchema,
} from "../server/domain.ts";
import { shopSystem, systemSvg } from "../server/shop-system.ts";
import type { ConsultationContext } from "../server/ai.ts";
import { validateVisualChange, type VisualRequest } from "../server/visual.ts";
import type { AddressInfo } from "node:net";
process.env.DEMO_MODE = "true";
process.env.APP_ORIGIN = "http://127.0.0.1";
test("diagram uses validated published settings, customer staff selection, escaping and all data destinations", () => {
  const c = structuredClone(sample);
  c.name = '<script>"店"</script>';
  c.hours.holidays = ["2026-11-01"];
  c.rules.sameDay = false;
  const svg = systemSvg(c);
  assert.equal(svg, systemSvg(structuredClone(c)));
  assert.match(svg, /お客様が指名・指名なしを選択/);
  assert.match(svg, /2026-11-01/);
  assert.match(svg, /当日予約不可/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(
    shopSystem(c)
      .sections.flatMap((s) => s.lines)
      .join("\n"),
    /Google ドライブ/,
  );
  assert.match(svg, /Firestore/);
  assert.match(documents(c, []).spec, /"sameDay": false/);
  assert.match(systemSvg(c), /指名先／対応スタッフ/);
  assert.match(shopSystem({ ...c, staff: [] }).sections.flatMap(section => section.lines).join("\n"), /店主/);
  assert.throws(() =>
    shopSchema.parse({
      ...c,
      appearance: { accent: "sage", layout: "standard", imageUrl: "https://" },
    }),
  );
});
test("pen changes are limited to the selected text or safe appearance", () => {
  const next = structuredClone(sample);
  next.menus[0].name = "新しい名前";
  assert.equal(
    validateVisualChange(sample, next, "menu:simple").menus[0].name,
    "新しい名前",
  );
  assert.throws(() => validateVisualChange(sample, next, "name"));
  next.rules.interval = 60;
  assert.throws(() => validateVisualChange(sample, next, "menu:simple"));
  const appearance = {
    ...sample,
    appearance: {
      accent: "rose" as const,
      layout: "compact" as const,
      imageUrl: "https://example.com/image.png",
    },
  };
  assert.deepEqual(
    validateVisualChange(sample, appearance, "appearance").appearance,
    appearance.appearance,
  );
});
test("removed uploads, image identification, ambiguous target selection, explanation and stale requests preserve approval and authorization", async (t) => {
  const store = new Store(":memory:");
  let ids = ["name", "description", "invented"];
  let illegal = false;
  let questionCalls = 0;
  const screens: unknown[] = [];
  const ai = {
    async identifyVisual(
      media: {
        data: string;
        mimeType: string;
      },
      targets: {
        id: string;
        label: string;
      }[],
      _instruction: string,
      screen?: { id: string; label: string; file: string },
    ) {
      screens.push(screen);
      assert.equal(media.mimeType, "image/png");
      assert.ok(targets.some((t) => t.id === "name"));
      return {
        ids,
        explanation: "店名か紹介文を囲んでいます。対象を選んでください。",
      };
    },
    async explainSystem(question: string, config: typeof sample, _demo?: boolean, context?: ConsultationContext) {
      questionCalls++;
      assert.equal(config.name, sample.name);
      assert.ok(context?.history.some(h => h.summary));
      assert.equal(context?.messages[0]?.text, "指名なしではどうなる？");
      return {
        answer: "変更するにはプランの承認が必要です。",
        changeRequest: true,
      };
    },
    async propose(text: string, current: typeof sample | null) {
      const config = structuredClone(current || sample);
      config.name = "新しい店名";
      if (illegal) config.rules.interval = 60;
      return { config, summary: planSummary(current, config) };
    },
    async proposeArticle() {
      return { title: "title", excerpt: "", body: "body" };
    },
  };
  const server = createApp(store, ai);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => {
    server.close();
    void store.close();
  });
  async function request(path: string, data?: unknown, cookie = "") {
    const res = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: res.status,
      body: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  const owner = (await request("/api/demo-login", { role: "owner" })).cookie;
  const shop: Shop = (await request("/api/workspace", undefined, owner)).body
    .shops[0];
  const base = `/api/shops/${shop.id}`;
  assert.equal((await request(base + "/system", undefined, owner)).status, 409);
  const audio = { data: "YWJjZA==", mimeType: "audio/webm" };
  assert.equal((await request(base + "/audio", audio)).status, 403);
  assert.equal((await request(base + "/audio", audio, owner)).status, 404);
  assert.equal((await store.list("plan")).length, 0);
  assert.equal((await store.shop(shop.id))!.published, null);
  const created = (
    await request(base + "/plan", { text: "作成", config: sample }, owner)
  ).body;
  await request(base + `/plans/${created.id}/approve`, {}, owner);
  const visual = {
    media: { data: "YWJjZA==", mimeType: "image/png" },
    instruction: "ここを新しい店名にして",
    displayed: sample,
    planId: created.id,
    screen: { id: "about", label: "お店のこと", file: "web/index.html#about" },
  };
  const preview = await request(base + "/visual/identify", visual, owner);
  assert.equal(preview.status, 200);
  assert.deepEqual(screens.at(-1), visual.screen, "the screen name and file reach the AI, so a request without marks can be located");
  assert.equal(preview.body.candidates.length, 1);
  const input = {
    text: visual.instruction,
    visual: { id: preview.body.id, target: "name" },
  };
  assert.equal(
    (
      await request(
        base + "/plan",
        { ...input, visual: { ...input.visual, target: "rules" } },
        owner,
      )
    ).status,
    409,
  );
  const token = (await store.get<VisualRequest>("visual", preview.body.id))!;
  token.createdAt = Date.now() - 1800001;
  await store.put("visual", token.id, token);
  assert.equal((await request(base + "/plan", input, owner)).status, 409);
  token.createdAt = Date.now();
  await store.put("visual", token.id, token);
  illegal = true;
  assert.equal((await request(base + "/plan", input, owner)).status, 400);
  illegal = false;
  const proposed = await request(base + "/plan", input, owner);
  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.approved, false);
  assert.equal(
    (await request(base + `/plans/${proposed.body.id}/publish`, {}, owner))
      .status,
    409,
  );
  await request(base + `/plans/${created.id}/publish`, { publication: "public" }, owner);
  assert.equal((await request(base + "/plan", input, owner)).status, 409);
  const diagram = await request(base + "/system", undefined, owner);
  assert.equal(diagram.status, 200);
  const revision = diagram.body.revision;
  const context = await request(base + "/build-context", undefined, owner);
  assert.equal(context.status, 200);
  assert.deepEqual(context.body.config, sample);
  assert.match(context.body.hash, /^[a-f0-9]{64}$/);
  assert.equal((await request(base + "/system/question", { question: "どう動く？", revision, hash: "stale" }, owner)).status, 409);
  assert.equal((await request(base + "/plan", { text: "古い画面からの変更", context: { revision, hash: "stale" } }, owner)).status, 409);
  const history = structuredClone((await store.shop(shop.id))!.history);
  const explanation = await request(
    base + "/system/question",
    { question: "指名なしに変更して", revision, hash: context.body.hash, messages: [{ role: "user", text: "指名なしではどうなる？" }] },
    owner,
  );
  assert.equal(explanation.body.changeRequest, true);
  assert.equal(questionCalls, 1);
  assert.equal(
    (await store.shop(shop.id))!.published!.rules.interval,
    sample.rules.interval,
  );
  assert.deepEqual((await store.shop(shop.id))!.history, history);
  assert.equal(
    (
      await request(
        base + "/system/question",
        { question: "どう動く？", revision: revision - 1 },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(questionCalls, 1);
  const live = { ...visual };
  delete (live as Partial<typeof live>).planId;
  ids = [];
  const clarification = await request(base + "/visual/identify", live, owner);
  assert.equal(clarification.status, 200);
  assert.deepEqual(clarification.body.candidates, []);
  assert.equal(clarification.body.id, "", "a clarification creates no editable target or proposal");
  ids = ["name"];
  const identified = await request(base + "/visual/identify", live, owner);
  const change = await request(
    base + "/plan",
    { ...input, visual: { id: identified.body.id, target: "name" } },
    owner,
  );
  assert.equal(change.status, 200);
  const plans = (await request("/api/workspace", undefined, owner)).body
    .shops[0].plans;
  assert.equal(plans.at(-1).id, change.body.id);
  assert.equal((await store.shop(shop.id))!.published!.name, sample.name);
  await request(base + `/plans/${change.body.id}/approve`, {}, owner);
  await request(base + `/plans/${change.body.id}/publish`, {}, owner);
  const updated = await request(base + "/system", undefined, owner);
  assert.equal(updated.body.diagram.name, "新しい店名");
  assert.equal(updated.body.revision, revision + 1);
  const customer = (
    await request("/api/demo-login", {
      role: "customer",
      shopId: shop.id,
      email: "guest@example.com",
    })
  ).cookie;
  assert.equal((await request(base + "/build-context", undefined, customer)).status, 403);
  assert.equal(
    (await request(base + "/system", undefined, customer)).status,
    403,
  );
  assert.equal(
    (
      await request(
        base + "/system/question",
        { question: "見たい", revision },
        customer,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(base + "/visual/identify", live, customer)).status,
    403,
  );
  assert.equal((await request(base + "/audio", audio, customer)).status, 403);
  assert.equal((await request(`/api/public/${shop.slug}`)).body.canEdit, false);
  assert.equal(
    (await request(`/api/public/${shop.slug}`)).body.config.notificationEmail,
    undefined,
  );
  await request(base + "/invite", { email: "guest@example.com" }, owner);
  await request(`/api/invitations/${shop.id}/accept`, {}, customer);
  assert.equal((await request(base + "/build-context", undefined, customer)).status, 200);
  assert.equal(
    (await request(base + "/system", undefined, customer)).status,
    200,
  );
  assert.equal((await request(base + "/audio", audio, customer)).status, 404);
  token.createdAt = Date.now() - 1800001;
  await store.put("visual", token.id, token);
  await store.cleanup();
  assert.equal(await store.get("visual", token.id), undefined);
});
