import type { ReactNode } from "react";
import { BookOpen, Database, FolderOpen, Globe, Plug, SearchX } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { TimelineAiSettings } from "~/services/timeline-ai";
import type { TimelineAiChoices } from "./useTimelineAi";

// Chips keep the textarea focused so the mobile keyboard stays up while
// lookups are toggled.
const keepFocus = { onPointerDown: (e: React.PointerEvent) => e.preventDefault() };

function Chip({ on, icon, children, onClick }: { on: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      {...keepFocus}
      onClick={onClick}
      className={`flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        on
          ? "border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-200"
          : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** @ai reply settings, edited in place above the composer and kept open while toggling. */
export function TimelineAiPanel({
  choices,
  settings,
  onChange,
}: {
  choices: TimelineAiChoices | null;
  settings: TimelineAiSettings;
  onChange: (patch: Partial<TimelineAiSettings>) => void;
}) {
  const { t } = useI18n();
  if (!choices) {
    return <div className="mb-2 rounded-md border border-gray-200 p-2 text-xs text-gray-500 dark:border-gray-700">{t("dashboard.timelineAiReplyUnavailable")}</div>;
  }
  const searchValues = ["", ...(choices.webSearch ? ["web"] : []), ...choices.ragSettings.map((name) => `rag:${name}`)];
  const search = searchValues.includes(settings.search) ? settings.search : "";
  const toggleIn = (key: "mcpServers" | "skills", id: string) => {
    const current = settings[key];
    onChange({ [key]: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] });
  };

  return (
    <div className="mb-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dashboard.timelineAiReplyHint")}</p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{t("dashboard.timelineAiReplyModel")}</span>
        <select
          value={choices.model}
          onChange={(e) => onChange({ model: e.target.value })}
          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-base text-gray-900 focus:border-blue-500 focus:outline-none md:text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {choices.models.map((model) => <option key={model.name} value={model.name}>{model.displayName}</option>)}
        </select>
      </label>

      <Row label={t("dashboard.timelineAiReplyDriveRead")}>
        <Chip on={settings.driveRead} icon={<FolderOpen size={12} />} onClick={() => onChange({ driveRead: !settings.driveRead })}>
          {t("dashboard.timelineAiReplyDriveRead")}
        </Chip>
      </Row>

      <Row label={t("dashboard.timelineAiReplySearch")}>
        <Chip on={search === ""} icon={<SearchX size={12} />} onClick={() => onChange({ search: "" })}>{t("dashboard.timelineAiReplySearchNone")}</Chip>
        {choices.webSearch && (
          <Chip on={search === "web"} icon={<Globe size={12} />} onClick={() => onChange({ search: "web" })}>{t("dashboard.timelineAiReplySearchWeb")}</Chip>
        )}
        {choices.ragSettings.map((name) => (
          <Chip key={name} on={search === `rag:${name}`} icon={<Database size={12} />} onClick={() => onChange({ search: `rag:${name}` })}>{name}</Chip>
        ))}
      </Row>

      {choices.mcpServers.length > 0 && (
        <Row label={t("dashboard.timelineAiReplyMcp")}>
          {choices.mcpServers.map((server) => (
            <Chip key={server.id} on={settings.mcpServers.includes(server.id)} icon={<Plug size={12} />} onClick={() => toggleIn("mcpServers", server.id)}>{server.name}</Chip>
          ))}
        </Row>
      )}

      {choices.skills.length > 0 && (
        <Row label={t("dashboard.timelineAiReplySkills")}>
          {choices.skills.map((skill) => (
            <Chip key={skill.id} on={settings.skills.includes(skill.id)} icon={<BookOpen size={12} />} onClick={() => toggleIn("skills", skill.id)}>{skill.name}</Chip>
          ))}
        </Row>
      )}
    </div>
  );
}
