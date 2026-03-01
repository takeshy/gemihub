import { useState, useCallback } from "react";
import { useFetcher } from "react-router";
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  Pencil,
  FileBox,
  Check,
  Copy,
  X,
  Search,
} from "lucide-react";
import { useI18n } from "~/i18n/context";
import { invalidateIndexCache } from "~/routes/_index";
import { StatusBanner, SectionCard, Label, inputClass } from "~/components/settings/shared";
import { RagFilesDialog } from "~/components/settings/RagFilesDialog";
import type { UserSettings, RagSetting } from "~/types/settings";
import { DEFAULT_RAG_SETTING, DEFAULT_RAG_STORE_KEY } from "~/types/settings";

export function RagTab({ settings }: { settings: UserSettings }) {
  const fetcher = useFetcher();
  const { t } = useI18n();

  const [ragTopK, setRagTopK] = useState(settings.ragTopK);
  const [ragSettings, setRagSettings] = useState<Record<string, RagSetting>>(settings.ragSettings);
  const [selectedRagSetting, setSelectedRagSetting] = useState<string | null>(
    settings.ragSettings[DEFAULT_RAG_STORE_KEY] ? DEFAULT_RAG_STORE_KEY : settings.selectedRagSetting
  );
  const [syncing, setSyncing] = useState(false);
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [copiedStoreId, setCopiedStoreId] = useState<string | null>(null);
  const [editingTopK, setEditingTopK] = useState(false);
  const [topKDraft, setTopKDraft] = useState(settings.ragTopK);
  const [showAutoRagModal, setShowAutoRagModal] = useState(false);

  const settingNames = Object.keys(ragSettings).sort((a, b) => {
    if (a === DEFAULT_RAG_STORE_KEY) return -1;
    if (b === DEFAULT_RAG_STORE_KEY) return 1;
    return a.localeCompare(b);
  });

  const saveRagSettings = useCallback((overrides?: {
    ragSettings?: Record<string, RagSetting>;
    selectedRagSetting?: string | null;
    ragTopK?: number;
  }) => {
    const rs = overrides?.ragSettings ?? ragSettings;

    // Validate exclude patterns are valid regex
    for (const [, s] of Object.entries(rs)) {
      for (const p of s.excludePatterns || []) {
        try {
          new RegExp(p);
        } catch {
          setSyncMsg(t("settings.rag.invalidExcludePattern").replace("{pattern}", p));
          return;
        }
      }
    }

    const sel = overrides?.selectedRagSetting !== undefined ? overrides.selectedRagSetting : selectedRagSetting;
    const topK = overrides?.ragTopK ?? ragTopK;
    const hasGemihub = !!rs[DEFAULT_RAG_STORE_KEY];
    const hasSettings = Object.keys(rs).length > 0;
    const fd = new FormData();
    fd.set("_action", "saveRag");
    fd.set("ragEnabled", hasSettings ? "on" : "off");
    fd.set("ragTopK", String(topK));
    fd.set("ragSettings", JSON.stringify(rs));
    fd.set("selectedRagSetting", sel || "");
    fd.set("ragRegistrationOnPush", hasGemihub ? "on" : "off");
    fetcher.submit(fd, { method: "post" });
  }, [fetcher, ragTopK, ragSettings, selectedRagSetting, t]);

  const addRagSetting = useCallback(() => {
    // Auto-generate a unique name
    let idx = settingNames.length + 1;
    let name = `setting-${idx}`;
    while (ragSettings[name]) {
      idx++;
      name = `setting-${idx}`;
    }
    setRagSettings((prev) => ({ ...prev, [name]: { ...DEFAULT_RAG_SETTING } }));
    setSelectedRagSetting(name);
    setEditingKey(name);
    // Start rename immediately so user can type a proper name
    setRenamingKey(name);
    setRenameValue(name);
  }, [ragSettings, settingNames]);

  const removeRagSetting = useCallback(
    (name: string) => {
      const newSettings: Record<string, RagSetting> = {};
      for (const [k, v] of Object.entries(ragSettings)) {
        if (k !== name) newSettings[k] = v;
      }
      setRagSettings(newSettings);
      let newSelected = selectedRagSetting;
      if (selectedRagSetting === name) {
        const remaining = settingNames.filter((n) => n !== name);
        newSelected = remaining.length > 0 ? remaining[0] : null;
        setSelectedRagSetting(newSelected);
      }
      if (editingKey === name) setEditingKey(null);
      if (renamingKey === name) setRenamingKey(null);
      saveRagSettings({ ragSettings: newSettings, selectedRagSetting: newSelected });
    },
    [selectedRagSetting, settingNames, renamingKey, editingKey, ragSettings, saveRagSettings]
  );

  const commitRename = useCallback(() => {
    if (!renamingKey) return;
    const newName = renameValue.trim();
    if (!newName || newName === renamingKey) {
      setRenamingKey(null);
      return;
    }
    if (ragSettings[newName]) {
      // Name already exists, cancel
      setRenamingKey(null);
      return;
    }
    const newSettings: Record<string, RagSetting> = {};
    for (const [k, v] of Object.entries(ragSettings)) {
      newSettings[k === renamingKey ? newName : k] = v;
    }
    setRagSettings(newSettings);
    const newSelected = selectedRagSetting === renamingKey ? newName : selectedRagSetting;
    if (selectedRagSetting === renamingKey) setSelectedRagSetting(newName);
    if (editingKey === renamingKey) setEditingKey(newName);
    setRenamingKey(null);
    saveRagSettings({ ragSettings: newSettings, selectedRagSetting: newSelected });
  }, [renamingKey, renameValue, ragSettings, selectedRagSetting, editingKey, saveRagSettings]);

  const updateCurrentSettingByKey = useCallback(
    (key: string, patch: Partial<RagSetting>) => {
      setRagSettings((prev) => ({
        ...prev,
        [key]: { ...prev[key], ...patch },
      }));
    },
    []
  );

  const handleSyncByKey = useCallback(async (key: string, settingsOverride?: Record<string, RagSetting>) => {
    const rs = settingsOverride ?? ragSettings;
    if (!rs[key]) return;

    // Validate exclude patterns are valid regex
    const patterns = rs[key].excludePatterns || [];
    for (const p of patterns) {
      try {
        new RegExp(p);
      } catch {
        setSyncMsg(t("settings.rag.invalidExcludePattern").replace("{pattern}", p));
        return;
      }
    }

    setSyncing(true);
    setSyncingKey(key);
    setSyncMsg(null);
    try {
      const hasGemihub = !!rs[DEFAULT_RAG_STORE_KEY];
      const hasSettings = Object.keys(rs).length > 0;
      const fd = new FormData();
      fd.set("_action", "saveRag");
      fd.set("ragEnabled", hasSettings ? "on" : "off");
      fd.set("ragTopK", String(ragTopK));
      fd.set("ragSettings", JSON.stringify(rs));
      fd.set("selectedRagSetting", key);
      fd.set("ragRegistrationOnPush", hasGemihub ? "on" : "off");
      const saveRes = await fetch("/settings", { method: "POST", body: fd });
      if (!saveRes.ok) {
        setSyncMsg(t("settings.rag.syncSaveFailed"));
        return;
      }

      const res = await fetch("/api/settings/rag-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragSettingName: key }),
      });

      if (!res.ok) {
        const data = await res.json();
        setSyncMsg(data.error || t("settings.rag.syncFailed"));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setSyncMsg(t("settings.rag.noResponseBody"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let completedRagSetting: RagSetting | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.message) setSyncMsg(evt.message);
            if (evt.type === "complete" && evt.ragSetting) {
              completedRagSetting = evt.ragSetting as RagSetting;
            }
          } catch {
            // skip
          }
        }
      }
      // Update local state from SSE complete event directly
      // (avoids re-fetch overwriting exclude patterns with stale loader data)
      if (completedRagSetting) {
        setRagSettings((prev) => ({ ...prev, [key]: completedRagSetting! }));
        // Prompt reload when gemihub RAG store is newly created (search needs storeId)
        if (key === DEFAULT_RAG_STORE_KEY && !settings.ragSettings?.[DEFAULT_RAG_STORE_KEY]?.storeId) {
          invalidateIndexCache();
          if (confirm(t("settings.rag.reloadConfirm"))) {
            window.location.href = "/";
          }
        }
      }
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : t("settings.rag.syncError"));
    } finally {
      setSyncing(false);
    }
  }, [ragSettings, ragTopK, settings.ragSettings, t]);

  const [ragFilesDialogKey, setRagFilesDialogKey] = useState<string | null>(null);

  const getFileCounts = useCallback((key: string) => {
    const s = ragSettings[key];
    if (!s) return { total: 0, registered: 0, pending: 0 };
    const files = Object.values(s.files ?? {});
    const total = files.length;
    const registered = files.filter((f) => f.status === "registered").length;
    return { total, registered, pending: total - registered };
  }, [ragSettings]);

  return (
    <SectionCard>
      <StatusBanner fetcher={fetcher} />

      {/* Search tip */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        <Search size={14} className="mt-0.5 flex-shrink-0" />
        <span>{t("settings.rag.searchTip")}</span>
      </div>

      {/* Auto RAG Registration button (only when gemihub setting doesn't exist) */}
      {!ragSettings[DEFAULT_RAG_STORE_KEY] && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowAutoRagModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            <Database size={16} />
            {t("settings.rag.enableAutoRag")}
          </button>
        </div>
      )}

      {/* Auto RAG Modal */}
      {showAutoRagModal && (
        <div className="fixed inset-0 z-50 flex items-start pt-4 md:items-center md:pt-0 justify-center bg-black/50" onClick={() => setShowAutoRagModal(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("settings.rag.autoRagModalTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowAutoRagModal(false)}
                className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t("settings.rag.autoRagModalExcludeNote")}
            </p>

            <div className="space-y-3">
              {/* All files option */}
              <button
                type="button"
                onClick={() => {
                  const newSettings = { ...ragSettings, [DEFAULT_RAG_STORE_KEY]: { ...DEFAULT_RAG_SETTING } };
                  setRagSettings(newSettings);
                  setSelectedRagSetting(DEFAULT_RAG_STORE_KEY);
                  setShowAutoRagModal(false);
                  handleSyncByKey(DEFAULT_RAG_STORE_KEY, newSettings);
                }}
                className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {t("settings.rag.autoRagAllFiles")}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.rag.autoRagAllFilesDescription")}
                </p>
              </button>

              {/* Customize option */}
              <button
                type="button"
                onClick={() => {
                  const newSettings = { ...ragSettings, [DEFAULT_RAG_STORE_KEY]: { ...DEFAULT_RAG_SETTING } };
                  setRagSettings(newSettings);
                  setSelectedRagSetting(DEFAULT_RAG_STORE_KEY);
                  saveRagSettings({ ragSettings: newSettings, selectedRagSetting: DEFAULT_RAG_STORE_KEY });
                  setEditingKey(DEFAULT_RAG_STORE_KEY);
                  setShowAutoRagModal(false);
                }}
                className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {t("settings.rag.autoRagCustomize")}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t("settings.rag.autoRagCustomizeDescription")}
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top-K inline edit */}
      <div className="mb-6">
        {editingTopK ? (
          <div className="flex items-center gap-2">
            <Label>{t("settings.rag.topK")}:</Label>
            <input
              type="number"
              min={1}
              max={20}
              value={topKDraft}
              onChange={(e) => setTopKDraft(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className={inputClass + " max-w-[80px]"}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setRagTopK(topKDraft);
                  saveRagSettings({ ragTopK: topKDraft });
                  setEditingTopK(false);
                }
                if (e.key === "Escape") setEditingTopK(false);
              }}
            />
            <button
              type="button"
              onClick={() => {
                setRagTopK(topKDraft);
                saveRagSettings({ ragTopK: topKDraft });
                setEditingTopK(false);
              }}
              className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
              title="Apply"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => setEditingTopK(false)}
              className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("settings.rag.topK")}: <span className="font-medium">{ragTopK}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setTopKDraft(ragTopK);
                  setEditingTopK(true);
                }}
                className="p-1 rounded text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Edit"
              >
                <Pencil size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("settings.rag.topKDescription")}
            </p>
          </div>
        )}
      </div>

      {/* RAG settings list */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <Label>{t("settings.rag.settings")}</Label>
          <button
            type="button"
            onClick={addRagSetting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            <Plus size={14} />
            {t("settings.rag.addSetting")}
          </button>
        </div>

        {settingNames.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">{t("settings.rag.noSettings")}</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-700 rounded-md divide-y divide-gray-200 dark:divide-gray-700">
            {settingNames.map((name) => {
              const s = ragSettings[name];
              const isEditing = editingKey === name;
              const isSelected = selectedRagSetting === name;
              return (
                <div key={name}>
                  {/* Row */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${
                      isSelected
                        ? "bg-blue-50 dark:bg-blue-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    }`}
                    onClick={() => setSelectedRagSetting(name)}
                  >
                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      {renamingKey === name ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                            if (e.key === "Escape") setRenamingKey(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-transparent border border-blue-400 rounded px-1.5 py-0.5 outline-none text-sm w-full max-w-[200px] focus:ring-1 focus:ring-blue-500 dark:text-gray-100"
                          autoFocus
                        />
                      ) : (
                        <span
                          className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate block"
                          onDoubleClick={(e) => {
                            if (name === DEFAULT_RAG_STORE_KEY) return;
                            e.stopPropagation();
                            setRenamingKey(name);
                            setRenameValue(name);
                          }}
                        >
                          {name}
                        </span>
                      )}
                      {s.storeId && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-gray-400 font-mono truncate">{s.storeId}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(s.storeId!);
                              setCopiedStoreId(s.storeId!);
                              setTimeout(() => setCopiedStoreId(null), 1500);
                            }}
                            className="shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                            title={t("settings.rag.copyStoreId")}
                          >
                            {copiedStoreId === s.storeId ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-400" />}
                          </button>
                        </div>
                      )}
                      {(() => {
                        const counts = getFileCounts(name);
                        if (counts.total === 0) return null;
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRagFilesDialogKey(name);
                            }}
                            className="text-xs mt-0.5 font-medium block text-left hover:underline cursor-pointer"
                          >
                            <span className="text-gray-600 dark:text-gray-300">
                              {t("settings.rag.fileCount").replace("{registered}", String(counts.registered)).replace("{total}", String(counts.total))}
                            </span>
                            {counts.pending > 0 && (
                              <span className="text-amber-600 dark:text-amber-400 ml-1">
                                {t("settings.rag.fileCountPending").replace("{count}", String(counts.pending))}
                              </span>
                            )}
                          </button>
                        );
                      })()}
                    </div>

                    {/* Type badge */}
                    <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                      s.isExternal
                        ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                    }`}>
                      {s.isExternal ? t("settings.rag.external") : t("settings.rag.internal")}
                    </span>

                    {/* Auto badge for gemihub setting */}
                    {name === DEFAULT_RAG_STORE_KEY && (
                      <span className="shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                        {t("settings.rag.autoLabel")}
                      </span>
                    )}

                    {/* Sync button */}
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRagSetting(name);
                        handleSyncByKey(name);
                      }}
                      className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-xs disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={syncing && syncingKey === name ? "animate-spin" : ""} />
                      {t("settings.rag.sync")}
                    </button>

                    {/* Edit (pencil) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRagSetting(name);
                        setEditingKey(isEditing ? null : name);
                      }}
                      className={`shrink-0 p-1.5 rounded ${
                        isEditing
                          ? "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30"
                          : "text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingKey === name) setEditingKey(null);
                        removeRagSetting(name);
                      }}
                      className="shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Expanded editor */}
                  {isEditing && (
                    <div className="px-4 py-4 bg-gray-50 dark:bg-gray-800/50 space-y-4 border-t border-gray-200 dark:border-gray-700">
                      {/* Internal / External toggle */}
                      <div>
                        <Label>{t("settings.rag.type")}</Label>
                        <div className="flex gap-4 mt-1">
                          {[
                            { value: false, label: t("settings.rag.typeInternal") },
                            { value: true, label: t("settings.rag.typeExternal") },
                          ].map((opt) => (
                            <label
                              key={String(opt.value)}
                              className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                            >
                              <input
                                type="radio"
                                checked={s.isExternal === opt.value}
                                onChange={() => updateCurrentSettingByKey(name, { isExternal: opt.value })}
                                className="text-blue-600 focus:ring-blue-500"
                              />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>

                      {s.isExternal ? (
                        <div>
                          <Label htmlFor={`rag-storeIds-${name}`}>{t("settings.rag.storeIdsLabel")}</Label>
                          <textarea
                            id={`rag-storeIds-${name}`}
                            rows={3}
                            value={s.storeIds.join("\n")}
                            onChange={(e) =>
                              updateCurrentSettingByKey(name, {
                                storeIds: e.target.value.split("\n"),
                              })
                            }
                            onBlur={(e) =>
                              updateCurrentSettingByKey(name, {
                                storeIds: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
                              })
                            }
                            className={inputClass + " font-mono resize-y"}
                          />
                        </div>
                      ) : (
                        <>
                          <div>
                            <Label htmlFor={`rag-targetFolders-${name}`}>{t("settings.rag.targetFoldersLabel")}</Label>
                            <textarea
                              id={`rag-targetFolders-${name}`}
                              rows={3}
                              value={s.targetFolders.join("\n")}
                              onChange={(e) =>
                                updateCurrentSettingByKey(name, {
                                  targetFolders: e.target.value.split("\n"),
                                })
                              }
                              onBlur={(e) =>
                                updateCurrentSettingByKey(name, {
                                  targetFolders: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
                                })
                              }
                              className={inputClass + " font-mono resize-y"}
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t("settings.rag.targetFoldersHint").replace("{example}", "workflows")}
                            </p>
                          </div>
                          <div>
                            <Label htmlFor={`rag-excludePatterns-${name}`}>{t("settings.rag.excludePatternsLabel")}</Label>
                            <textarea
                              id={`rag-excludePatterns-${name}`}
                              rows={2}
                              value={s.excludePatterns.join("\n")}
                              onChange={(e) =>
                                updateCurrentSettingByKey(name, {
                                  excludePatterns: e.target.value.split("\n"),
                                })
                              }
                              onBlur={(e) =>
                                updateCurrentSettingByKey(name, {
                                  excludePatterns: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
                                })
                              }
                              className={inputClass + " font-mono resize-y"}
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t("settings.rag.excludePatternHint")}
                            </p>
                          </div>
                        </>
                      )}

                      {/* Apply & Sync (Internal only) */}
                      {!s.isExternal && (
                        <button
                          type="button"
                          disabled={syncing}
                          onClick={() => handleSyncByKey(name)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={syncing && syncingKey === name ? "animate-spin" : ""} />
                          {t("settings.rag.applyAndSync")}
                        </button>
                      )}

                      {/* Save (External only) */}
                      {s.isExternal && (
                        <button
                          type="button"
                          onClick={() => saveRagSettings()}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium"
                        >
                          {t("common.save")}
                        </button>
                      )}

                      {/* Sync message */}
                      {syncMsg && syncingKey === name && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{syncMsg}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Register & Sync button for new internal settings */}
        {selectedRagSetting && ragSettings[selectedRagSetting] && !ragSettings[selectedRagSetting].storeId && !ragSettings[selectedRagSetting].isExternal && (
          <div className="mt-3">
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSyncByKey(selectedRagSetting)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              <FileBox size={14} className={syncing && syncingKey === selectedRagSetting ? "animate-spin" : ""} />
              {t("settings.rag.registerAndSync")}
            </button>
          </div>
        )}
      </div>

      {/* RAG Files Dialog */}
      {ragFilesDialogKey && ragSettings[ragFilesDialogKey] && (
        <RagFilesDialog
          settingName={ragFilesDialogKey}
          files={ragSettings[ragFilesDialogKey].files}
          onClose={() => setRagFilesDialogKey(null)}
        />
      )}
    </SectionCard>
  );
}
