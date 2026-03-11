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

interface SkillContextValue {
  skills: SkillMetadata[];
  activeSkillIds: string[];
  toggleSkill: (skillId: string) => void;
  activateSkill: (skillId: string) => void;
  loading: boolean;
  refreshSkills: () => void;
  getActiveSkillsSystemPrompt: (extraSkillIds?: string[]) => Promise<string>;
  getActiveSkillWorkflows: (extraSkillIds?: string[]) => Array<{
    skillId: string;
    skillName: string;
    workflow: SkillWorkflowRef;
    folderId: string;
  }>;
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
});

const STORAGE_KEY = "gemihub:activeSkills";

export function SkillProvider({
  children,
}: {
  children: ReactNode;
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

  const discover = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverSkills();
      setSkills(found);
      // Invalidate cache on rediscovery
      loadedCacheRef.current.clear();
    } catch (err) {
      console.error("Failed to discover skills:", err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const getActiveSkillsSystemPrompt = useCallback(async (extraSkillIds?: string[]): Promise<string> => {
    const allIds = mergeSkillIds(extraSkillIds);
    const activeSkills = skills.filter((s) => allIds.includes(s.id));
    if (activeSkills.length === 0) return "";

    const loaded: LoadedSkill[] = [];
    for (const s of activeSkills) {
      let cached = loadedCacheRef.current.get(s.id);
      if (!cached) {
        cached = await loadSkill(s);
        loadedCacheRef.current.set(s.id, cached);
      }
      loaded.push(cached);
    }

    return buildSkillSystemPrompt(loaded);
  }, [skills, mergeSkillIds]);

  const getActiveSkillWorkflows = useCallback((extraSkillIds?: string[]) => {
    const allIds = mergeSkillIds(extraSkillIds);
    const result: Array<{
      skillId: string;
      skillName: string;
      workflow: SkillWorkflowRef;
      folderId: string;
    }> = [];
    for (const s of skills) {
      if (!allIds.includes(s.id)) continue;
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
  }, [skills, mergeSkillIds]);

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
      }}
    >
      {children}
    </SkillContext.Provider>
  );
}

export function useSkills(): SkillContextValue {
  return useContext(SkillContext);
}
