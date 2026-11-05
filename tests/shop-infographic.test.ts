import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { shopInfographic } from "../shared/shop-infographic.ts";
import { shopSystem, systemSvg } from "../server/shop-system.ts";
import { requestLocale } from "../server/i18n.ts";

test("screen model and SVG follow PayPal enablement and the current refund policy", () => {
  const config = structuredClone(sample);
  config.rules.cancelHours = 9;
  config.rules.payment = { enabled: false, refundTiers: [{ hoursBefore: 72, percent: 100 }, { hoursBefore: 24, percent: 55 }, { hoursBefore: 0, percent: 0 }] };
  for (const enabled of [false, true, false]) {
    config.rules.payment.enabled = enabled;
    const model = shopInfographic(config);
    const lines = shopSystem(config).sections[0].lines.join("\n");
    assert.equal(model.bookingFlow.length, enabled ? 5 : 4);
    assert.match(model.bookingFlow[0].detail, /メール認証.*Google/);
    assert.ok(lines.includes(model.payment.summary));
    assert.ok(lines.includes(model.payment.cancellation));
    for (const detailed of [true, false]) {
      const svg = systemSvg(config, detailed);
      assert.equal(svg.includes("PayPal"), enabled);
      for (const step of model.bookingFlow) assert.ok(svg.includes(step.label));
    }
    if (enabled) {
      assert.match(model.payment.policy!, /72時間以上.*100%.*24時間以上72時間未満.*55%.*24時間未満.*0%/);
      assert.ok(lines.includes(model.payment.policy!));
      assert.match(model.payment.cancellation, /予約時の条件.*お店都合は全額返金/);
      assert.doesNotMatch(lines, /開始9時間前まで/);
    } else {
      assert.equal(model.payment.policy, undefined);
      assert.match(lines, /開始9時間前まで/);
      assert.doesNotMatch(lines, /%返金|自動返金/);
    }
  }
  config.rules.payment.enabled = true;
  config.rules.payment.refundTiers = [{ hoursBefore: 0, percent: 80 }];
  assert.equal(shopInfographic(config).payment.policy, "いつでも：80%返金");
  assert.match(systemSvg(config), /80%返金/);
  assert.doesNotMatch(systemSvg(config), /55%返金/);
  delete config.rules.payment;
  assert.equal(shopInfographic(config).bookingFlow.length, 4);
});

test("enabled article pages, custom pages and bookable owner agree with the exported model", () => {
  const config = structuredClone(sample);
  config.staff = []; config.ownerBooking = true;
  config.pages = [{ id: "faq", slug: "faq", title: "FAQ <&>", navigationLabel: "FAQ", body: "<p>FAQ</p>", layout: "standard", imageUrl: "" }];
  for (const blogs of [false, true]) for (const announcements of [false, true]) {
    config.appearance = { accent: "sage", layout: "standard", imageUrl: "", articles: { blogs, announcements } };
    const model = shopInfographic(config);
    assert.equal(model.staff.length, 1);
    assert.equal(model.staff[0].id, "owner");
    assert.equal(model.pageCount, 5 + 2 * Number(blogs) + 2 * Number(announcements));
    assert.equal(model.pages.some(page => page.title === "ブログ一覧・記事"), blogs);
    assert.equal(model.pages.some(page => page.title === "お知らせ一覧・記事"), announcements);
    const svg = systemSvg(config);
    assert.equal(svg.includes("ブログ一覧・記事"), blogs);
    assert.equal(svg.includes("お知らせ一覧・記事"), announcements);
    assert.match(svg, /FAQ &lt;&amp;&gt;/);
    assert.match(svg, /スタッフ 1人/);
  }
  delete config.appearance;
  assert.equal(shopInfographic(config).pageCount, 9);
});

test("shared diagram content is translated for English screens and SVGs", () => {
  requestLocale.run("en", () => {
    const config = structuredClone(sample);
    config.rules.payment = { enabled: true, refundTiers: [{ hoursBefore: 0, percent: 100 }] };
    const model = shopInfographic(config);
    assert.equal(model.bookingFlow[3].label, "Pay with PayPal");
    const svg = systemSvg(config);
    assert.ok(shopSystem(config).sections[0].lines.includes(model.payment.summary));
    assert.ok(svg.includes("Pay with PayPal"));
    assert.doesNotMatch(JSON.stringify([model.bookingFlow, model.payment, model.pages]), /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  });
});
