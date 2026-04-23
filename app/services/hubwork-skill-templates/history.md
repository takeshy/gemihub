# Webpage Builder Skill History

## v{{SKILL_TEMPLATE_VERSION}} - {{SKILL_TEMPLATE_DATE}}

- Restructured `SKILL.md` to follow the [obra/superpowers](https://github.com/obra/superpowers) `writing-skills` conventions: trigger-condition `description` field (not workflow summary), lowercase-hyphenated `name`, an explicit "Iron Law" near the top, a Before/After Core Pattern table, a Quick Reference, and a Red Flags / Rationalisations table consolidating the prior "Common Mistakes" list.
- No behavioural rule was removed — every existing guard (request.* prefix, `:json` modifier rules, script-node-for-UUIDs, no-frameworks, calendar event flat shape, auth-not-authorization) is preserved. The Pre-Save & Verification Checklist is unchanged so it remains in sync with `webpage-review.server.ts`.
- Lowered the manifest `name` from "Webpage Builder" to "webpage-builder" to match the convention used by the folder ID and superpowers' naming rule.

## v1.0.0 - 2026-04-23

- Added the `create-article` workflow for publishing dated blog posts and announcements from Drive notes.
- Article output paths now include the source note basename, so multiple posts can be published on the same day without overwriting each other.
- Added `manifest.json` versioning for update detection in settings.
