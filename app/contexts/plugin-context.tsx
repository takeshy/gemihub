import { createContext, useContext, type ReactNode } from "react";
import type { PluginAPI, PluginInstance, PluginSettingsTab, PluginView } from "~/types/plugin";

export interface PluginContextValue {
  plugins: PluginInstance[];
  sidebarViews: PluginView[];
  mainViews: PluginView[];
  settingsTabs: PluginSettingsTab[];
  loading: boolean;
  getPluginAPI: (pluginId: string) => PluginAPI | null;
}

export const EMPTY_PLUGIN_CONTEXT: PluginContextValue = {
  plugins: [],
  sidebarViews: [],
  mainViews: [],
  settingsTabs: [],
  loading: false,
  getPluginAPI: () => null,
};

export const PluginContext = createContext<PluginContextValue>(EMPTY_PLUGIN_CONTEXT);

export function StaticPluginProvider({ children }: { children: ReactNode }) {
  return <PluginContext.Provider value={EMPTY_PLUGIN_CONTEXT}>{children}</PluginContext.Provider>;
}

export function usePlugins(): PluginContextValue {
  return useContext(PluginContext);
}
