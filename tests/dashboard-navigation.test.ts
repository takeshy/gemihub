import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardRoute, dashboardSearch, dashboardTabs } from "../src/dashboard-navigation.ts";

test("all dashboard destinations and legacy links restore their intended view", () => {
  for (const tab of dashboardTabs) assert.equal(dashboardRoute(`?tab=${tab}`).tab, tab);
  for (const [tab, expected] of [["team", "staff"], ["hours", "basic"], ["rules", "basic"], ["create-page", "build"], ["data", "dashboard"], ["unknown", "dashboard"]]) assert.equal(dashboardRoute(`?tab=${tab}`).tab, expected);
  assert.equal(dashboardRoute("").tab, "dashboard");
  assert.equal(dashboardRoute("?screen=theme").tab, "try");
  assert.equal(dashboardRoute("?calendar=connected").tab, "staff");
  assert.equal(dashboardRoute("?customer=guest%40example.com&tab=basic").tab, "customers");
  assert.equal(dashboardRoute("?lang=en", "menus").tab, "menus");
  const deep = dashboardRoute("?shop=second&tab=try&screen=blogs%3Aarticle&article=2026-11-01-autumn&intent=modify&request=1&plan=plan-1");
  assert.equal(deep.shop, "second"); assert.equal(deep.screen, "blogs:article"); assert.equal(deep.article, "2026-11-01-autumn"); assert.equal(deep.plan, "plan-1"); assert.equal(deep.intent, "modify"); assert.equal(deep.focusRequest, true);
});

test("menu navigation retains language and shop while clearing context belonging to the previous screen", () => {
  const deep = "?lang=en&customer=guest%40example.com&customerView=images&inquiry=old&request=1&intent=modify&plan=old&calendar=connected&tab=customers&screen=contact&article=old&shop=first";
  const search = dashboardSearch(deep, "menus", "second");
  assert.deepEqual([...new URLSearchParams(search)], [["lang", "en"], ["tab", "menus"], ["shop", "second"]]);
  assert.equal(dashboardRoute(search).tab, "menus", "customer drill-down must not override a menu selection");
  const screen = dashboardSearch(search, "try", "second", "page:faq");
  assert.equal(dashboardRoute(screen).screen, "page:faq");
  const article = dashboardRoute(dashboardSearch(screen, "try", "second", "blogs:article", "2026-11-01-autumn"));
  assert.equal(article.article, "2026-11-01-autumn");
  assert.equal(dashboardRoute(dashboardSearch(screen, "basic", "second", "contact", "stale")).screen, undefined);
});

test("consultation links select a saved conversation and clear it on leaving",()=>{
  const search=dashboardSearch("?lang=en", "assistant", "one", undefined,undefined,"chat-one");
  assert.equal(dashboardRoute(search).conversation,"chat-one");
  assert.equal(dashboardRoute(dashboardSearch(search,"dashboard","one")).conversation,undefined);
});
