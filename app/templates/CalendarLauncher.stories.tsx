import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolLauncher } from "~/components/ide/ToolLauncher";
import { I18nProvider } from "~/i18n/context";
import { setGoogleCalendarMonthCache } from "~/services/indexeddb-cache-drive";
import type { Language } from "~/types/settings";
import { settingsFixture } from "./settings.fixtures";

function CalendarLauncherScene({ language = "ja" }: { language?: Language }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void setGoogleCalendarMonthCache({
      monthKey: "2026-08",
      fetchedAt: new Date("2026-08-22T07:35:00+09:00").getTime(),
      events: [
        { id: "design-review", summary: "Design review / デザインレビュー", start: "2026-08-22T10:00:00+09:00", end: "2026-08-22T11:00:00+09:00", location: "Meet", htmlLink: "https://calendar.google.com/calendar/event?eid=design-review" },
        { id: "release", summary: "Release prep / リリース準備", start: "2026-08-22T14:30:00+09:00", end: "2026-08-22T15:30:00+09:00", description: "Final check / 最終チェック", htmlLink: "https://calendar.google.com/calendar/event?eid=release" },
        { id: "planning", summary: "Weekly planning / 来週の計画", start: "2026-08-26", end: "2026-08-27", htmlLink: "https://calendar.google.com/calendar/event?eid=planning" },
      ],
    }).then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const dayTimer = window.setTimeout(() => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "22")
        ?.click();
    }, 500);
    return () => window.clearTimeout(dayTimer);
  }, [ready]);

  return (
    <I18nProvider language={language}>
      <main className="min-h-screen bg-slate-100 p-8 dark:bg-slate-950">
        {ready ? (
          <ToolLauncher
            open
            initialTool="calendar"
            encryptionSettings={settingsFixture.encryption}
            onClose={() => undefined}
          />
        ) : null}
      </main>
    </I18nProvider>
  );
}

const meta = {
  title: "Templates/Calendar Launcher",
  component: CalendarLauncherScene,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CalendarLauncherScene>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Calendar: Story = {};
export const CalendarEnglish: Story = { args: { language: "en" } };
