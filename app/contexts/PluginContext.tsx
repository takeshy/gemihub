import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { PluginConfig } from "~/types/settings";
import type {
  PluginAPI,
  PluginInstance,
  PluginView,
  PluginSlashCommand,
  PluginSettingsTab,
} from "~/types/plugin";
import { loadPlugin, loadPluginStyles, unloadPlugin } from "~/services/plugin-loader";
import { createPluginAPI } from "~/services/plugin-api";

interface PluginContextValue {
  plugins: PluginInstance[];
  sidebarViews: PluginView[];
  mainViews: PluginView[];
  slashCommands: PluginSlashCommand[];
  settingsTabs: PluginSettingsTab[];
  loading: boolean;
  getPluginAPI: (pluginId: string) => PluginAPI | null;
}

const PluginContext = createContext<PluginContextValue>({
  plugins: [],
  sidebarViews: [],
  mainViews: [],
  slashCommands: [],
  settingsTabs: [],
  loading: false,
  getPluginAPI: () => null,
});

export function PluginProvider({
  pluginConfigs,
  language,
  children,
}: {
  pluginConfigs: PluginConfig[];
  language: string;
  children: ReactNode;
}) {
  const [plugins, setPlugins] = useState<PluginInstance[]>([]);
  const [sidebarViews, setSidebarViews] = useState<PluginView[]>([]);
  const [mainViews, setMainViews] = useState<PluginView[]>([]);
  const [slashCommands, setSlashCommands] = useState<PluginSlashCommand[]>([]);
  const [settingsTabs, setSettingsTabs] = useState<PluginSettingsTab[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef<Set<string>>(new Set());
  const apiMapRef = useRef<Map<string, PluginAPI>>(new Map());
  const cancelledRef = useRef(false);

  const addView = useCallback((view: PluginView) => {
    if (view.location === "sidebar") {
      setSidebarViews((prev) => [...prev.filter((v) => v.id !== view.id), view]);
    } else {
      setMainViews((prev) => [...prev.filter((v) => v.id !== view.id), view]);
    }
  }, []);

  const addSlashCommand = useCallback((cmd: PluginSlashCommand) => {
    setSlashCommands((prev) => [
      ...prev.filter((c) => !(c.pluginId === cmd.pluginId && c.name === cmd.name)),
      cmd,
    ]);
  }, []);

  const addSettingsTab = useCallback((tab: PluginSettingsTab) => {
    setSettingsTabs((prev) => [
      ...prev.filter((t) => t.pluginId !== tab.pluginId),
      tab,
    ]);
  }, []);

  const getPluginAPI = useCallback((pluginId: string): PluginAPI | null => {
    return apiMapRef.current.get(pluginId) ?? null;
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    const enabledConfigs = pluginConfigs.filter((c) => c.enabled);
    const enabledIds = new Set(enabledConfigs.map((c) => c.id));

    // Unload plugins that were disabled or removed
    const currentLoaded = [...loadedRef.current];
    const toUnloadIds = currentLoaded.filter((id) => !enabledIds.has(id));

    for (const id of toUnloadIds) {
      loadedRef.current.delete(id);
      apiMapRef.current.delete(id);
    }

    if (toUnloadIds.length > 0) {
      const unloadSet = new Set(toUnloadIds);
      setPlugins((prev) => {
        const toUnload = prev.filter((p) => unloadSet.has(p.id));
        for (const p of toUnload) unloadPlugin(p);
        return prev.filter((p) => !unloadSet.has(p.id));
      });
      setSidebarViews((prev) => prev.filter((v) => enabledIds.has(v.pluginId)));
      setMainViews((prev) => prev.filter((v) => enabledIds.has(v.pluginId)));
      setSlashCommands((prev) => prev.filter((c) => enabledIds.has(c.pluginId)));
      setSettingsTabs((prev) => prev.filter((t) => enabledIds.has(t.pluginId)));
    }

    // Load new plugins
    const toLoad = enabledConfigs.filter(
      (c) => !loadedRef.current.has(c.id)
    );

    if (toLoad.length === 0) return;

    setLoading(true);

    Promise.all(
      toLoad.map(async (config) => {
        try {
          const api = createPluginAPI(config.id, language, {
            onRegisterView: addView,
            onRegisterSlashCommand: addSlashCommand,
            onRegisterSettingsTab: addSettingsTab,
          });

          const instance = await loadPlugin(config, api);
          await loadPluginStyles(config);

          if (cancelledRef.current) {
            unloadPlugin(instance);
            return null;
          }

          loadedRef.current.add(config.id);
          apiMapRef.current.set(config.id, api);
          return instance;
        } catch (err) {
          console.error(`Failed to load plugin ${config.id}:`, err);
          return null;
        }
      })
    ).then((loaded) => {
      if (cancelledRef.current) return;
      const valid = loaded.filter(Boolean) as PluginInstance[];
      if (valid.length > 0) {
        setPlugins((prev) => [...prev, ...valid]);
      }
      setLoading(false);
    });

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginConfigs]);

  // Cleanup all plugins on unmount
  useEffect(() => {
    return () => {
      setPlugins((prev) => {
        for (const p of prev) unloadPlugin(p);
        return [];
      });
      loadedRef.current.clear();
      apiMapRef.current.clear();
    };
  }, []);

  return (
    <PluginContext.Provider
      value={{ plugins, sidebarViews, mainViews, slashCommands, settingsTabs, loading, getPluginAPI }}
    >
      {children}
    </PluginContext.Provider>
  );
}

export function usePlugins(): PluginContextValue {
  return useContext(PluginContext);
}
