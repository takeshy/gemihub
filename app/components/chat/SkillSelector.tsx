import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Plus } from "lucide-react";
import { useI18n } from "~/i18n/context";
import type { SkillMetadata } from "~/types/skill";

interface SkillSelectorProps {
  skills: SkillMetadata[];
  activeSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
  /** Open a skill's SKILL.md file — chip name clickable when provided. */
  onOpenSkill?: (skillMdFileId: string, skillName: string) => void;
  disabled?: boolean;
}

/**
 * Inline skill selector: ✨ [chip ×] [chip ×] [+ dropdown]
 * Matches the obsidian-gemini-helper design.
 */
export function SkillSelector({
  skills,
  activeSkillIds,
  onToggleSkill,
  onOpenSkill,
  disabled,
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

  const activeSkills = skills.filter((s) => activeSkillIds.includes(s.id));

  return (
    <div className="flex items-center gap-1 px-3 py-1 flex-wrap">
      <Sparkles size={14} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
      {activeSkills.map((skill) => {
        const clickable = onOpenSkill && skill.skillMdFileId;
        return (
          <span
            key={skill.id}
            className="inline-flex items-center gap-1 rounded-full bg-purple-600 px-2 py-0.5 text-[11px] text-white whitespace-nowrap"
            title={skill.description}
          >
            {clickable ? (
              <button
                type="button"
                onClick={() => onOpenSkill(skill.skillMdFileId, skill.name)}
                className="bg-transparent border-none text-white p-0 m-0 cursor-pointer underline-offset-2 hover:underline shadow-none"
              >
                {skill.name}
              </button>
            ) : (
              <span>{skill.name}</span>
            )}
            <button
              onClick={() => onToggleSkill(skill.id)}
              disabled={disabled}
              className="inline-flex items-center justify-center p-0 ml-0.5 opacity-70 hover:opacity-100 bg-transparent border-none text-white cursor-pointer shadow-none"
            >
              <X size={10} />
            </button>
          </span>
        );
      })}
      <div className="relative inline-flex" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          disabled={disabled}
          className="inline-flex items-center justify-center w-5 h-5 p-0 rounded-full border border-dashed border-gray-400 bg-transparent text-gray-400 cursor-pointer hover:border-gray-600 hover:text-gray-600 dark:border-gray-500 dark:text-gray-500 dark:hover:border-gray-300 dark:hover:text-gray-300 disabled:opacity-50 shadow-none"
          title={t("skills.selector.title")}
        >
          <Plus size={12} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 z-10 mb-1 min-w-[200px] max-h-[200px] overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {skills.map((skill) => {
              const isActive = activeSkillIds.includes(skill.id);
              return (
                <label
                  key={skill.id}
                  className="flex items-start gap-1.5 rounded px-1.5 py-1 cursor-pointer text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => onToggleSkill(skill.id)}
                    disabled={disabled}
                    className="mt-0.5 flex-shrink-0"
                  />
                  <div className="flex flex-col gap-px min-w-0">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{skill.name}</span>
                    {skill.description && (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {skill.description}
                      </span>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
