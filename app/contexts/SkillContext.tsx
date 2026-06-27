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
import { cacheProvisionedSkillFiles } from "~/services/provisioned-skill-cache";

interface SkillContextValue {
  skills: SkillMetadata[];
  activeSkillIds: string[];
  toggleSkill: (skillId: string) => void;
  activateSkill: (skillId: string) => void;
  activateExclusiveSkill: (skillId: string, exclusiveSkillIds: string[]) => void;
  loading: boolean;
  refreshSkills: () => void;
  getActiveSkillsSystemPrompt: (extraSkillIds?: string[], hubworkAccounts?: Record<string, unknown>) => Promise<string>;
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
  activateExclusiveSkill: () => {},
  loading: false,
  refreshSkills: () => {},
  getActiveSkillsSystemPrompt: async () => "",
  getActiveSkillWorkflows: () => [],
});

const STORAGE_KEY = "gemihub:activeSkills";

function getPendingSkillActivationKey(rootFolderId?: string): string {
  return `gemihub:pendingSkillActivation:${rootFolderId || "default"}`;
}

export function SkillProvider({
  children,
  rootFolderId,
}: {
  children: ReactNode;
  rootFolderId?: string;
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
  const gemihubSkillsProvisionedRef = useRef(false);
  const pendingSkillActivationKey = getPendingSkillActivationKey(rootFolderId);

  const discover = useCallback(async () => {
    setLoading(true);
    try {
      const found = await discoverSkills();
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
  }, [pendingSkillActivationKey]);

  // Discover on mount
  useEffect(() => {
    discover();
  }, [discover]);

  // Ensure built-in GemiHub skills are installed for every user. They are
  // provisioned as normal Drive-backed skills so the existing skill loader,
  // chip UI, and read_drive_file instructions continue to work unchanged.
  useEffect(() => {
    if (gemihubSkillsProvisionedRef.current) return;
    gemihubSkillsProvisionedRef.current = true;

    (async () => {
      try {
        const { getCachedRemoteMeta } = await import("~/services/indexeddb-cache");
        const cachedMeta = await getCachedRemoteMeta();
        const fileEntries = Object.values(cachedMeta?.files ?? {});
        const hasMarkdown = fileEntries.some((f) => f.name?.startsWith("skills/markdown/"));
        const hasCanvas = fileEntries.some((f) => f.name?.startsWith("skills/canvas/"));
        const hasBase = fileEntries.some((f) => f.name?.startsWith("skills/base/"));
        const hasDashboard = fileEntries.some((f) => f.name?.startsWith("skills/dashboard/"));
        if (hasMarkdown && hasCanvas && hasBase && hasDashboard) return;

        const res = await fetch("/api/settings/gemihub-skills-provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        if (!res.ok) return;

        const data = await res.json();
        const files = data.files as Parameters<typeof cacheProvisionedSkillFiles>[0] | undefined;
        if (!files || files.length === 0) return;

        await cacheProvisionedSkillFiles(files);
        await discover();
      } catch (err) {
        console.warn("Failed to provision built-in GemiHub skills:", err);
      }
    })();
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

  const activateExclusiveSkill = useCallback((skillId: string, exclusiveSkillIds: string[]) => {
    const exclusive = new Set(exclusiveSkillIds);
    setActiveSkillIds((prev) => {
      const next = prev.filter((id) => !exclusive.has(id) || id === skillId);
      return next.includes(skillId) ? next : [...next, skillId];
    });
  }, []);

  const mergeSkillIds = useCallback((extraSkillIds?: string[]) => {
    return extraSkillIds
      ? [...new Set([...activeSkillIds, ...extraSkillIds])]
      : activeSkillIds;
  }, [activeSkillIds]);

  const getActiveSkillsSystemPrompt = useCallback(async (extraSkillIds?: string[], hubworkAccounts?: Record<string, unknown>): Promise<string> => {
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

    return buildSkillSystemPrompt(loaded, hubworkAccounts);
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
        activateExclusiveSkill,
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
