import assert from "node:assert/strict";
import test from "node:test";
import { createPluginAPI } from "./plugin-api.ts";
import type { PluginSettingsTab, PluginView } from "~/types/plugin";

test("registerView namespaces view IDs with pluginId", () => {
  const views: PluginView[] = [];
  const apiA = createPluginAPI("alpha", "en", {
    onRegisterView: (view) => views.push(view),
    onRegisterSettingsTab: () => {},
  });
  const apiB = createPluginAPI("beta", "en", {
    onRegisterView: (view) => views.push(view),
    onRegisterSettingsTab: () => {},
  });

  const Dummy = () => null;
  apiA.registerView({
    id: "panel",
    name: "Panel A",
    location: "sidebar",
    component: Dummy,
  });
  apiB.registerView({
    id: "panel",
    name: "Panel B",
    location: "main",
    component: Dummy,
  });

  assert.equal(views.length, 2);
  assert.equal(views[0]?.id, "alpha:panel");
  assert.equal(views[1]?.id, "beta:panel");
});

test("registerSettingsTab stamps pluginId", () => {
  const settingsTabs: PluginSettingsTab[] = [];
  const api = createPluginAPI("my-plugin", "ja", {
    onRegisterView: () => {},
    onRegisterSettingsTab: (tab) => settingsTabs.push(tab),
  });

  api.registerSettingsTab({
    component: () => null,
  });

  assert.equal(settingsTabs.length, 1);
  assert.equal(settingsTabs[0]?.pluginId, "my-plugin");
});
