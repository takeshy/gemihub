import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { proposePhoneRules } from "../server/phone-rules-ai.ts";
import { requestLocale } from "../server/i18n.ts";
import { phoneSettingsOf } from "../shared/phone.ts";

test("phone rule improvements receive current draft and bounded call context without changing settings", async () => {
  const config = structuredClone(sample), original = structuredClone(config);
  config.menus.push({ id: "removal", name: "Removal", price: 500, duration: 30, active: true, optionFor: ["simple"] });
  const expected = structuredClone(config);
  for (const locale of ["ja", "en"] as const) await requestLocale.run(locale, async () => {
    const proposed = await proposePhoneRules(config, "Keep existing guidance.", "Improve addon checks", { transcript: "Call context", outcome: "error", issue: "Invalid combination" }, {
      generate: async input => {
        const payload = JSON.parse(input.contents[0].parts![0].text!);
        assert.equal(payload.rules, "Keep existing guidance.");
        assert.equal(payload.call.transcript, "Call context");
        assert.deepEqual(payload.shop.menus.find((menu: any) => menu.id === "removal").optionFor, ["simple"]);
        assert.match(input.system, locale === "en" ? /Never use standalone services as addons/ : /単独メニューを追加メニューとして扱わず/);
        assert.match(input.system, locale === "en" ? /personal data/ : /個人情報/);
        return JSON.stringify({ rules: "Keep existing guidance. Check compatible addons.", explanation: "Added checks.", warnings: ["Update menu settings to allow additional combinations."] });
      },
    });
    assert.match(proposed.rules, /^Keep existing guidance/);
    assert.equal(proposed.warnings.length, 1);
    assert.deepEqual(config, expected);
  });
  assert.deepEqual(phoneSettingsOf({ phone: { enabled: true, twilioNumber: "+18312167968", cashBookings: true } }), { enabled: true, twilioNumber: "+18312167968", cashBookings: true });
  assert.equal(original.menus.some(menu => menu.id === "removal"), false);
});

test("invalid phone rule proposals fail without returning partial rules", async () => {
  for (const value of ["not json", JSON.stringify({ rules: "x".repeat(6001), explanation: "Too long", warnings: [] }), JSON.stringify({ rules: "Rule", explanation: "", warnings: [] }), JSON.stringify({ rules: "Rule", explanation: "Changed", warnings: [], enabled: true })]) {
    await assert.rejects(proposePhoneRules(sample, "", "Change tone", undefined, { generate: async () => value }), /電話ルールの改善案/);
  }
});
