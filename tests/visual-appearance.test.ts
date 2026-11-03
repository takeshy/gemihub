import { test } from "node:test";
import assert from "node:assert/strict";
import { sample } from "../server/domain.ts";
import { proposeVisualAppearance } from "../server/visual.ts";

const theme = { headerHtml: '<header><h1>Original headline</h1><slot name="navigation"></slot></header>', bodyHtml: '<main><slot name="content"></slot></main>', footerHtml: '<footer><slot name="content"></slot></footer>', css: 'h1{color:#193e32}' };
test("a partial visual proposal preserves the rest of the theme and all business data", async () => {
  const current = { ...structuredClone(sample), appearance: { accent: "sage" as const, layout: "standard" as const, imageUrl: "", theme } };
  const headerHtml = theme.headerHtml.replace("Original headline", "Your moment of calm.");
  const {config, summary} = await proposeVisualAppearance(current, "Change the headline", [], {generate:async () => JSON.stringify({appearance:{theme:{headerHtml}}})});
  assert.equal(config.appearance!.theme!.headerHtml, headerHtml);
  assert.deepEqual({...config.appearance!.theme,headerHtml:theme.headerHtml}, theme);
  assert.deepEqual({...config,appearance:current.appearance}, current);
  assert.ok(summary.length);
  assert.equal(current.appearance.theme.headerHtml, theme.headerHtml);
});
test("visual proposals reject payment changes, unsafe HTML and incomplete new themes", async () => {
  const current = {...structuredClone(sample),appearance:{accent:"sage" as const,layout:"standard" as const,imageUrl:"",theme}};
  for (const value of [
    {appearance:{accent:"rose"},rules:{payment:{enabled:false}}},
    {appearance:{theme:{headerHtml:'<script>alert(1)</script><slot name="navigation"></slot>'}}},
  ]) await assert.rejects(proposeVisualAppearance(current,"Change the headline",[],{generate:async()=>JSON.stringify(value)}));
  await assert.rejects(proposeVisualAppearance({...current,appearance:undefined},"Create a theme",[],{generate:async()=>JSON.stringify({appearance:{theme:{headerHtml:theme.headerHtml}}})}));
});
