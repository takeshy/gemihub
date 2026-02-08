import { useState, useCallback } from "react";
import { useFetcher } from "react-router";
import { Plus, Trash2, Pencil, Save, Loader2, Check, AlertCircle } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type {
  UserSettings,
  SlashCommand,
  ModelType,
  DriveToolMode,
} from "~/types/settings";
import { getAvailableModels } from "~/types/settings";
import { useI18n } from "~/i18n/context";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm";

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
    >
      {children}
    </label>
  );
}

interface CommandsTabProps {
  settings: UserSettings;
}

interface CommandFormData {
  name: string;
  description: string;
  promptTemplate: string;
  model: string;
  searchSetting: string;
  driveToolMode: string;
  enabledMcpServers: string[];
}

const emptyForm: CommandFormData = {
  name: "",
  description: "",
  promptTemplate: "",
  model: "",
  searchSetting: "",
  driveToolMode: "",
  enabledMcpServers: [],
};

function commandToForm(cmd: SlashCommand): CommandFormData {
  return {
    name: cmd.name,
    description: cmd.description,
    promptTemplate: cmd.promptTemplate,
    model: cmd.model || "",
    searchSetting: cmd.searchSetting || "",
    driveToolMode: cmd.driveToolMode || "",
    enabledMcpServers: cmd.enabledMcpServers || [],
  };
}

function formToCommand(form: CommandFormData, id?: string): SlashCommand {
  return {
    id: id || `cmd-${Date.now()}`,
    name: form.name.trim(),
    description: form.description.trim(),
    promptTemplate: form.promptTemplate,
    model: (form.model as ModelType) || null,
    searchSetting: form.searchSetting || null,
    driveToolMode: (form.driveToolMode as DriveToolMode) || null,
    enabledMcpServers: form.enabledMcpServers.length > 0 ? form.enabledMcpServers : null,
  };
}

export function CommandsTab({ settings }: CommandsTabProps) {
  const fetcher = useFetcher();
  const loading = fetcher.state !== "idle";
  const { t } = useI18n();

  const [commands, setCommands] = useState<SlashCommand[]>(settings.slashCommands || []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<CommandFormData>({ ...emptyForm });

  const availableModels = getAvailableModels(settings.apiPlan);
  const enabledMcpServers = settings.mcpServers;

  const data = fetcher.data as { success?: boolean; message?: string } | undefined;

  const submitCommands = useCallback((updatedCommands: SlashCommand[]) => {
    const fd = new FormData();
    fd.set("_action", "saveCommands");
    fd.set("slashCommands", JSON.stringify(updatedCommands));
    fetcher.submit(fd, { method: "post" });
  }, [fetcher]);

  const startEdit = useCallback((cmd: SlashCommand) => {
    setEditingId(cmd.id);
    setForm(commandToForm(cmd));
    setAdding(false);
  }, []);

  const startAdd = useCallback(() => {
    setAdding(true);
    setEditingId(null);
    setForm({ ...emptyForm });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setAdding(false);
    setForm({ ...emptyForm });
  }, []);

  const saveEdit = useCallback(() => {
    if (!form.name.trim()) return;
    let updatedCommands: SlashCommand[];
    if (editingId) {
      updatedCommands = commands.map((cmd) =>
        cmd.id === editingId ? formToCommand(form, editingId) : cmd
      );
    } else {
      updatedCommands = [...commands, formToCommand(form)];
    }
    setCommands(updatedCommands);
    submitCommands(updatedCommands);
    setEditingId(null);
    setAdding(false);
    setForm({ ...emptyForm });
  }, [form, editingId, commands, submitCommands]);

  const removeCommand = useCallback((id: string) => {
    const updatedCommands = commands.filter((cmd) => cmd.id !== id);
    setCommands(updatedCommands);
    submitCommands(updatedCommands);
    if (editingId === id) {
      setEditingId(null);
      setAdding(false);
      setForm({ ...emptyForm });
    }
  }, [commands, editingId, submitCommands]);

  const toggleMcpServer = useCallback((serverName: string) => {
    setForm((prev) => {
      const servers = prev.enabledMcpServers.includes(serverName)
        ? prev.enabledMcpServers.filter((s) => s !== serverName)
        : [...prev.enabledMcpServers, serverName];
      return { ...prev, enabledMcpServers: servers };
    });
  }, []);

  const showForm = adding || editingId !== null;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      {/* Status banner */}
      {data && (
        <div
          className={`mb-6 p-3 rounded-md border text-sm ${
            data.success
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {data.success ? <Check size={ICON.LG} /> : <AlertCircle size={ICON.LG} />}
            {data.message}
          </div>
        </div>
      )}

      {/* Command list */}
      {commands.length === 0 && !showForm && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {t("settings.commands.noCommands")}
        </p>
      )}

      <div className="space-y-3 mb-6">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800/50"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                /{cmd.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {cmd.description}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => startEdit(cmd)}
                className="p-1.5 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
                title={t("settings.commands.edit")}
              >
                <Pencil size={ICON.LG} />
              </button>
              <button
                type="button"
                onClick={() => removeCommand(cmd.id)}
                disabled={loading}
                className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                title={t("settings.commands.delete")}
              >
                <Trash2 size={ICON.LG} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add/Edit form */}
      {showForm ? (
        <div className="mb-6 p-4 border border-blue-200 dark:border-blue-800 rounded-md bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
          <div>
            <Label htmlFor="cmd-name">{t("settings.commands.name")}</Label>
            <input
              id="cmd-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="summarize"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="cmd-description">{t("settings.commands.description")}</Label>
            <input
              id="cmd-description"
              type="text"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Summarize the current file"
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="cmd-prompt">{t("settings.commands.promptTemplate")}</Label>
            <textarea
              id="cmd-prompt"
              rows={4}
              value={form.promptTemplate}
              onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
              placeholder={"Summarize the following content:\n\n{content}"}
              className={inputClass + " font-mono resize-y"}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("settings.commands.promptHelp")}
            </p>
          </div>
          <div>
            <Label htmlFor="cmd-model">{t("settings.commands.modelOverride")}</Label>
            <select
              id="cmd-model"
              value={form.model}
              onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))}
              className={inputClass}
            >
              <option value="">{t("settings.commands.noOverride")}</option>
              {availableModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="cmd-search">{t("settings.commands.searchSetting")}</Label>
            <select
              id="cmd-search"
              value={form.searchSetting}
              onChange={(e) => setForm((p) => ({ ...p, searchSetting: e.target.value }))}
              className={inputClass}
            >
              <option value="">{t("settings.commands.noOverride")}</option>
              <option value="__websearch__">Web Search</option>
              {Object.keys(settings.ragSettings).map((name) => (
                <option key={name} value={name}>
                  RAG: {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="cmd-drive">{t("settings.commands.driveToolMode")}</Label>
            <select
              id="cmd-drive"
              value={form.driveToolMode}
              onChange={(e) => setForm((p) => ({ ...p, driveToolMode: e.target.value }))}
              className={inputClass}
            >
              <option value="">{t("settings.commands.noOverride")}</option>
              <option value="all">All tools</option>
              <option value="noSearch">No search</option>
              <option value="none">None</option>
            </select>
          </div>
          {enabledMcpServers.length > 0 && (
            <div>
              <Label>{t("settings.commands.mcpServers")}</Label>
              <div className="space-y-1 mt-1">
                {enabledMcpServers.map((server) => (
                  <label
                    key={server.name}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.enabledMcpServers.includes(server.name)}
                      onChange={() => toggleMcpServer(server.name)}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    {server.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              disabled={loading || !form.name.trim()}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {loading ? <Loader2 size={ICON.LG} className="animate-spin" /> : <Save size={ICON.LG} />}
              {editingId ? t("settings.commands.update") : t("settings.commands.add")}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-md hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 text-sm"
        >
          <Plus size={ICON.LG} />
          {t("settings.commands.addCommand")}
        </button>
      )}
    </div>
  );
}
