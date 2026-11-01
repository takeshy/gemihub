import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store, type User } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { randomUUID } from "node:crypto";
import { uploadMenuImage } from "../server/menu-images.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { digest } from "../server/auth.ts";
import { calendarScope, type CalendarConnection } from "../server/calendar.ts";

test("registered staff log in and grant Calendar together without creating an owner; removed and foreign accounts stay denied", async (t) => {
  process.env.DEMO_MODE = "true";
  process.env.GOOGLE_CLIENT_ID = "test-client";
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample);
  await store.saveShop(shop);
  const other = await store.createShop("other@example.com");
  other.published = structuredClone(sample);
  await store.saveShop(other);
  for (const [id, email] of [
    ["owner", shop.owner],
    ["customer", "staff@example.com"],
    ["other", other.owner],
  ])
    await store.put("session", digest(id), {
      user: {
        email,
        name: id,
        role: id === "customer" ? "customer" : "owner",
      } satisfies User,
      expires: Date.now() + 600000,
    });
  let identityEmail = "staff@example.com",
    denied = false;
  const gateway = {
    async exchange() {
      if (denied)
        throw Object.assign(new Error("カレンダーの利用許可が必要です"), {
          status: 400,
        });
      return {
        email: identityEmail,
        name: "スタッフ本人",
        refreshToken: "encrypted-calendar-token",
      };
    },
    async busy(_connection: CalendarConnection) {
      return [];
    },
  };
  const server = createApp(store, undefined, gateway);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => {
    server.close();
    await store.close();
  });
  async function request(
    path: string,
    id = "owner",
    data?: unknown,
    extra = "",
  ) {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      redirect: "manual",
      headers: {
        Origin: origin,
        Cookie: `omai_session=${id}${extra}`,
        "Content-Type": "application/json",
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
      location: response.headers.get("location"),
    };
  }
  const base = `/api/shops/${shop.id}`;
  for (const who of ["customer", "other", "anonymous"]) {
    assert.equal((await request(`${base}/staff-accounts`, who)).status, 403);
    assert.equal(
      (
        await request(`${base}/staff-accounts`, who, {
          staffId: "aoi",
          email: identityEmail,
          previousEmail: "",
        })
      ).status,
      403,
    );
  }
  assert.equal(
    (await request(`/api/staff-login/${shop.id}`, "anonymous")).status,
    200,
  );
  assert.equal(
    (await request(`/api/staff-login/missing`, "anonymous")).status,
    404,
  );
  const input = {
    staffId: "aoi",
    email: " STAFF@example.com ",
    previousEmail: "",
  };
  assert.equal(
    (await request(`${base}/staff-accounts`, "owner", input)).status,
    200,
  );
  const account = (await request(`${base}/staff-accounts`)).body.staff.find(
    (row: any) => row.staffId === "aoi",
  );
  assert.equal(account.email, identityEmail);
  assert.equal(account.accepted, false);
  assert.equal((await request(base + "/calendar", "customer")).status, 403);
  assert.deepEqual((await request("/api/invitations", "customer")).body, []);
  assert.equal(
    (await request(`/api/invitations/${shop.id}/accept`, "customer", {}))
      .status,
    403,
    "registration cannot bypass Calendar login via legacy invitation endpoint",
  );
  assert.equal(
    (
      await request(`${base}/staff-accounts`, "owner", {
        staffId: "haru",
        email: identityEmail,
        previousEmail: "",
      })
    ).status,
    409,
  );
  async function start() {
    const result = await request(
      `/auth/google?staffShop=${shop.id}`,
      "anonymous",
    );
    assert.equal(result.status, 302);
    const url = new URL(result.location!);
    assert.ok(url.searchParams.get("scope")!.includes(calendarScope));
    assert.ok(!url.searchParams.get("scope")!.includes("drive"));
    assert.ok(!url.searchParams.get("scope")!.includes("gmail"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state")!;
    const pending = await store.get<{ verifier: string }>(
      "oauth",
      digest(state),
    );
    assert.equal(digest(pending!.verifier).length, 64);
    return { state, cookie: result.cookie };
  }
  async function finish(
    pending: Awaited<ReturnType<typeof start>>,
    query = "code=fake",
  ) {
    return request(
      `/auth/google/callback?state=${pending.state}&${query}`,
      "anonymous",
      undefined,
      `; ${pending.cookie}`,
    );
  }
  let pending = await start();
  assert.equal(
    (
      await request(
        `/auth/google/callback?state=${pending.state}&code=fake`,
        "anonymous",
      )
    ).status,
    400,
  );
  identityEmail = "unregistered@example.com";
  assert.equal((await finish(pending)).status, 403);
  identityEmail = "staff@example.com";
  pending = await start();
  denied = true;
  assert.equal((await finish(pending)).status, 400);
  denied = false;
  assert.equal(
    (await store.get<{ accepted: boolean }>(
      "member",
      `${shop.id}:${identityEmail}`,
    ))!.accepted,
    false,
  );
  pending = await start();
  assert.equal((await finish(pending, "error=access_denied")).status, 400);
  pending = await start();
  const saved = (await store.get<Record<string, unknown>>(
    "oauth",
    digest(pending.state),
  ))!;
  await store.put("oauth", digest(pending.state), {
    ...saved,
    expires: Date.now() - 1,
  });
  assert.equal((await finish(pending)).status, 400);
  pending = await start();
  const login = await finish(pending);
  assert.equal(login.status, 302);
  assert.equal(
    new URL(login.location!, origin).searchParams.get("tab"),
    "bookings",
  );
  assert.ok(login.cookie.startsWith("omai_session="));
  assert.equal(
    (await finish(pending)).status,
    400,
    "OAuth state consumed once",
  );
  const sessionId = login.cookie.split("=")[1];
  const linked = await request(base + "/calendar", sessionId);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.connected, true);
  assert.equal(linked.body.staffId, "aoi");
  assert.ok(!JSON.stringify(linked.body).includes("token"));
  assert.equal(
    (await store.list("shop")).length,
    2,
    "staff login never creates an owner shop",
  );
  assert.equal(
    await store.get("user", identityEmail),
    undefined,
    "no Drive/Gmail owner credentials stored for staff",
  );
  assert.equal(
    (await request(`${base}/staff-accounts`, sessionId)).status,
    403,
  );
  assert.equal(
    (await request(`${base}/calendar/connect`, sessionId, { staffId: "haru" }))
      .status,
    403,
    "staff cannot claim another assignee",
  );
  assert.equal(
    (await request(`/api/shops/${other.id}/calendar`, sessionId)).status,
    403,
  );
  const workspace = await request("/api/workspace", sessionId);
  assert.equal(workspace.body.shops.length, 1);
  assert.ok(
    !JSON.stringify(workspace.body).includes("encrypted-calendar-token"),
  );
  const photo = {
    requestId: randomUUID(),
    name: "本人の写真.png",
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  };
  const foreign = await uploadMenuImage(
    store,
    shop,
    { ...photo, requestId: randomUUID(), name: "非公開の別画像.png" },
    memoryCustomerFiles(store),
    "",
  );
  assert.equal((await request(`${base}/staff-photo`, "other")).status, 403);
  const ownUpload = await request(
    `${base}/staff-photo/images`,
    sessionId,
    photo,
  );
  assert.equal(ownUpload.status, 200);
  const imageId = ownUpload.body.imageId;
  const choices = await request(`${base}/staff-photo/images`, sessionId);
  assert.deepEqual(
    choices.body.map((image: any) => image.id),
    [imageId],
  );
  assert.equal(
    (await request(`${base}/staff-photo/images/${foreign.imageId}`, sessionId))
      .status,
    404,
  );
  const photoSave = { requestId: randomUUID(), imageId, previousImageId: "" };
  assert.equal(
    (
      await request(`${base}/staff-photo`, sessionId, {
        ...photoSave,
        imageId: foreign.imageId,
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(`/api/public/${shop.slug}/images/${imageId}`, "anonymous"))
      .status,
    404,
    "upload is private before saving",
  );
  assert.equal(
    (await request(`${base}/staff-photo`, sessionId, photoSave)).status,
    200,
  );
  assert.equal(
    (await request(`${base}/staff-photo`, sessionId, photoSave)).status,
    200,
    "same save is safe to retry",
  );
  const updated = (await store.shop(shop.id))!;
  assert.equal(updated.published!.staff[0].imageId, imageId);
  assert.deepEqual(updated.published!.staff[1], shop.published!.staff[1]);
  assert.equal(
    updated.published!.staff[0].start,
    shop.published!.staff[0].start,
  );
  assert.equal(
    (await request(`/api/public/${shop.slug}/images/${imageId}`, "anonymous"))
      .status,
    200,
  );
  assert.equal(
    (await request(`${base}/staff-photo/images/${imageId}`, sessionId)).body
      .data,
    photo.data,
  );
  assert.equal(
    (
      await request(`${base}/staff-photo`, sessionId, {
        requestId: randomUUID(),
        previousImageId: "",
      })
    ).status,
    409,
  );
  pending = await start();
  assert.equal(
    (
      await request(`${base}/staff-accounts`, "owner", {
        staffId: "aoi",
        email: "",
        previousEmail: identityEmail,
      })
    ).status,
    200,
  );
  assert.equal(
    await store.get("calendar", `${shop.id}:${identityEmail}`),
    undefined,
  );
  assert.equal(
    (await request(base + "/calendar", sessionId)).status,
    403,
    "existing session loses access immediately",
  );
  assert.equal(
    (await finish(pending)).status,
    403,
    "removal during OAuth is checked again",
  );
  assert.equal(
    (await request(`${base}/staff-accounts`, "owner", input)).status,
    200,
  );
  const config = structuredClone(shop.published!);
  config.staff = config.staff.filter((staff) => staff.id !== "aoi");
  shop.published = config;
  await store.saveShop(shop);
  assert.equal(
    (await finish(await start())).status,
    403,
    "deleted staff is rejected",
  );
});
