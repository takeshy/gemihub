import { test } from "node:test";
import assert from "node:assert/strict";
import { sample, shopSchema } from "../server/domain.ts";
import { themeSchema } from "../shared/presentation.ts";
import { screenDesignError, screenIds, screenStarter, themeStarter } from "../shared/screens.ts";

test("built-in screens accept checked HTML around required working slots; the theme starter is valid", () => {
  for (const id of screenIds) assert.equal(screenDesignError(id, screenStarter(id)), undefined, id);
  themeSchema.parse(themeStarter);
  const screens = Object.fromEntries(screenIds.map(id => [id, screenStarter(id)]));
  assert.deepEqual(Object.keys(shopSchema.parse({ ...sample, screens }).screens!), [...screenIds]);

  assert.match(screenDesignError("reserve", { html: "<h2>予約</h2>", css: "" })!, /missing: booking/, "the booking form cannot be removed");
  assert.match(screenDesignError("contact", { html: '<slot name="booking"></slot>', css: "" })!, /unknown: booking/);
  assert.ok(screenDesignError("mine", { html: '<slot name="mypage"></slot><slot name="mypage"></slot>', css: "" }), "a slot cannot repeat");
  assert.ok(screenDesignError("reserve", { html: '<slot name="booking"></slot><script>x()</script>', css: "" }));
  assert.ok(screenDesignError("about", { html: '<p onclick="x()">x</p>', css: "" }));
  assert.equal(screenDesignError("about", { html: "<p>メニューなどを出さないお店紹介</p>", css: "" }), undefined, "the about screen may omit facts");
  assert.throws(() => shopSchema.parse({ ...sample, screens: { reserve: { html: "<p>no booking</p>", css: "" } } }));
});
