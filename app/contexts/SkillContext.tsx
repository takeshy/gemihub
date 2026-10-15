import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { SkillMetadata, SkillWorkflowRef, LoadedSkill } from "~/types/skill";
import {
  discoverSkills,
  loadSkill,
  buildSkillSystemPrompt,
} from "~/services/skill-loader";
import type { AgentPluginConfig } from "~/types/settings";

interface SkillContextValue {
  skills: SkillMetadata[];
  activeSkillIds: string[];
  toggleSkill: (skillId: string) => void;
  activateSkill: (skillId: string) => void;
  loading: boolean;
  refreshSkills: () => void;
  getActiveSkillsSystemPrompt: (extraSkillIds?: string[], hubworkAccounts?: Record<string, unknown>) => Promise<string>;
  getActiveSkillWorkflows: (extraSkillIds?: string[]) => SkillWorkflowEntry[];
  /** Like the active-skill getters, for an explicit set of skills (e.g. Timeline @ai). */
  getSkillsSystemPrompt: (skillIds: string[], hubworkAccounts?: Record<string, unknown>) => Promise<string>;
  getSkillWorkflows: (skillIds: string[]) => SkillWorkflowEntry[];
}

interface SkillWorkflowEntry {
  skillId: string;
  skillName: string;
  workflow: SkillWorkflowRef;
  folderId: string;
}

const SkillContext = createContext<SkillContextValue>({
  skills: [],
  activeSkillIds: [],
  toggleSkill: () => {},
  activateSkill: () => {},
  loading: false,
  refreshSkills: () => {},
  getActiveSkillsSystemPrompt: async () => "",
  getActiveSkillWorkflows: () => [],
  getSkillsSystemPrompt: async () => "",
  getSkillWorkflows: () => [],
});

const STORAGE_KEY = "gemihub:activeSkills";

function getPendingSkillActivationKey(rootFolderId?: string): string {
  return `gemihub:pendingSkillActivation:${rootFolderId || "default"}`;
}

export function SkillProvider({
  children,
  rootFolderId,
  agentPlugins = [],
  dashboardEnabled = false,
}: {
  children: ReactNode;
  rootFolderId?: string;
  agentPlugins?: AgentPluginConfig[];
  /** Advanced feature flag — the dashboard skill is hidden while it is off. */
  dashboardEnabled?: boolean;
}) {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const loadedCacheRef = useRef<Map<string, LoadedSkill>>(new Map());
  const pendingSkillActivationKey = getPendingSkillActivationKey(rootFolderId);

  const discover = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverSkills(agentPlugins, { dashboardEnabled });
      setSkills(found);
      try {
        const pendingSkillId = localStorage.getItem(pendingSkillActivationKey);
        if (pendingSkillId && found.some((skill) => skill.id === pendingSkillId)) {
          setActiveSkillIds((prev) => (prev.includes(pendingSkillId) ? prev : [...prev, pendingSkillId]));
          localStorage.removeItem(pendingSkillActivationKey);
        }
      } catch { /* ignore */ }
      // Invalidate cache on rediscovery
      loadedCacheRef.current.clear();
    } catch (err) {
      console.error("Failed to discover skills:", err);
    } finally {
      setLoading(false);
    }
  }, [pendingSkillActivationKey, agentPlugins, dashboardEnabled]);

  // Discover on mount
  useEffect(() => {
    discover();
  }, [discover]);

  // Rediscover on sync-complete or tree-cached (initial load)
  useEffect(() => {
    const handler = () => discover();
    window.addEventListener("sync-complete", handler);
    window.addEventListener("tree-cached", handler);
    return () => {
      window.removeEventListener("sync-complete", handler);
      window.removeEventListener("tree-cached", handler);
    };
  }, [discover]);

  // Persist active skill IDs
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(activeSkillIds));
    } catch { /* ignore */ }
  }, [activeSkillIds]);

  const toggleSkill = useCallback((skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId)
        ? prev.filter((id) => id !== skillId)
        : [...prev, skillId],
    );
  }, []);

  const activateSkill = useCallback((skillId: string) => {
    setActiveSkillIds((prev) =>
      prev.includes(skillId) ? prev : [...prev, skillId],
    );
  }, []);

  const mergeSkillIds = useCallback((extraSkillIds?: string[]) => {
    return extraSkillIds
      ? [...new Set([...activeSkillIds, ...extraSkillIds])]
      : activeSkillIds;
  }, [activeSkillIds]);

  const getSkillsSystemPrompt = useCallback(async (skillIds: string[], hubworkAccounts?: Record<string, unknown>): Promise<string> => {
    const selected = skills.filter((s) => skillIds.includes(s.id));
    if (selected.length === 0) return "";

    const loaded: LoadedSkill[] = [];
    for (const s of selected) {
      let cached = loadedCacheRef.current.get(s.id);
      if (!cached) {
        cached = await loadSkill(s);
        loadedCacheRef.current.set(s.id, cached);
      }
      loaded.push(cached);
    }

    return buildSkillSystemPrompt(loaded, hubworkAccounts);
  }, [skills]);

  const getSkillWorkflows = useCallback((skillIds: string[]) => {
    const result: SkillWorkflowEntry[] = [];
    for (const s of skills) {
      if (!skillIds.includes(s.id)) continue;
      for (const wf of s.workflows) {
        result.push({
          skillId: s.id,
          skillName: s.name,
          workflow: wf,
          folderId: s.folderId,
        });
      }
    }
    return result;
  }, [skills]);

  const getActiveSkillsSystemPrompt = useCallback(
    (extraSkillIds?: string[], hubworkAccounts?: Record<string, unknown>) =>
      getSkillsSystemPrompt(mergeSkillIds(extraSkillIds), hubworkAccounts),
    [getSkillsSystemPrompt, mergeSkillIds],
  );

  const getActiveSkillWorkflows = useCallback(
    (extraSkillIds?: string[]) => getSkillWorkflows(mergeSkillIds(extraSkillIds)),
    [getSkillWorkflows, mergeSkillIds],
  );

  return (
    <SkillContext.Provider
      value={{
        skills,
        activeSkillIds,
        toggleSkill,
        activateSkill,
        loading,
        refreshSkills: discover,
        getActiveSkillsSystemPrompt,
        getActiveSkillWorkflows,
        getSkillsSystemPrompt,
        getSkillWorkflows,
      }}
    >
      {children}
    </SkillContext.Provider>
  );
}

export function useSkills(): SkillContextValue {
  return useContext(SkillContext);
}
