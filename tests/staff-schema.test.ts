import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { google } from "googleapis";
import { readConfig, encrypt } from "../server/google.ts";
import { sample } from "../server/domain.ts";
import type { Shop } from "../server/store.ts";
test("staff photo appends imageId after the existing six columns and accepts legacy sheets", async (t) => {
  t.after(() => mock.restoreAll());
  let photo = false;
  mock.method(google, "sheets", (() => ({
    spreadsheets: {
      values: {
        async batchGet() {
          return {
            data: {
              valueRanges: [
                {
                  values: [
                    ["id", "name", "duration", "price", "active", "imageId"],
                    ...sample.menus.map((menu) => [
                      menu.id,
                      menu.name,
                      menu.duration,
                      menu.price,
                      menu.active,
                      "",
                    ]),
                  ],
                },
                {
                  values: [
                    [
                      "id",
                      "name",
                      "menuIds",
                      "weekdays",
                      "start",
                      "end",
                      ...(photo ? ["imageId"] : []),
                    ],
                    ...sample.staff.map((person) => [
                      person.id,
                      person.name,
                      JSON.stringify(person.menuIds),
                      JSON.stringify(person.weekdays),
                      person.start,
                      person.end,
                      ...(photo ? ["a".repeat(64)] : []),
                    ]),
                  ],
                },
                {
                  values: [
                    ["key", "value"],
                    ...Object.entries(sample)
                      .filter(
                        ([key]) => !["menus", "staff", "pages"].includes(key),
                      )
                      .map(([key, value]) => [key, JSON.stringify(value)]),
                  ],
                },
                { values: [["id", "record"]] },
              ],
            },
          };
        },
      },
    },
  })) as any);
  const shop = { google: { sheetId: "sheet" } } as Shop;
  const legacy = await readConfig(shop, encrypt("token"));
  assert.equal(legacy.staff[0].imageId, undefined);
  assert.equal(legacy.staff[0].name, sample.staff[0].name);
  photo = true;
  const modern = await readConfig(shop, encrypt("token"));
  assert.equal(modern.staff[0].imageId, "a".repeat(64));
  assert.deepEqual(modern.staff[0].menuIds, legacy.staff[0].menuIds);
});
