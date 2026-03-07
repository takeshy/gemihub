import { useState, useRef, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import { useI18n } from "~/i18n/context";
import type { SkillMetadata } from "~/types/skill";

interface SkillSelectorProps {
  skills: SkillMetadata[];
  activeSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
}

export function SkillSelector({
  skills,
  activeSkillIds,
  onToggleSkill,
}: SkillSelectorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (skills.length === 0) return null;

  const activeCount = activeSkillIds.filter((id) =>
    skills.some((s) => s.id === id),
  ).length;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded-md p-1.5 transition-colors ${
          activeCount > 0
            ? "text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        }`}
        title={t("skills.selector.title")}
      >
        <Sparkles size={ICON.LG} />
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-purple-600 text-[8px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {t("skills.selector.title")}
          </div>
          {skills.map((skill) => {
            const isActive = activeSkillIds.includes(skill.id);
            return (
              <button
                key={skill.id}
                onClick={() => onToggleSkill(skill.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <span
                  className={`inline-flex h-3 w-3 flex-shrink-0 items-center justify-center rounded border text-[8px] leading-none ${
                    isActive
                      ? "border-purple-500 bg-purple-500 text-white"
                      : "border-gray-400 dark:border-gray-500"
                  }`}
                >
                  {isActive ? "\u2713" : ""}
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{skill.name}</div>
                  {skill.description && (
                    <div className="truncate text-gray-500 dark:text-gray-400">
                      {skill.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SkillChips({
  skills,
  activeSkillIds,
  onToggleSkill,
}: SkillSelectorProps) {
  const activeSkills = skills.filter((s) => activeSkillIds.includes(s.id));
  if (activeSkills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {activeSkills.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs text-purple-700 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
        >
          <Sparkles size={10} />
          <span className="max-w-[120px] truncate">{skill.name}</span>
          <button
            onClick={() => onToggleSkill(skill.id)}
            className="ml-0.5 rounded-full p-0.5 text-purple-400 hover:bg-purple-200 hover:text-purple-600 dark:hover:bg-purple-800 dark:hover:text-purple-200"
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  );
}
