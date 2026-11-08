import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { VisualChangeReview } from "../VisualChangeReview";
import { ChromePreview } from "../SiteChrome";
import { sample } from "../../server/domain";
import { standardTheme } from "../../shared/theme-editing";
import { tr } from "../../shared/i18n";

function ReviewExample({ failed = false }: { failed?: boolean }) {
  const [open, setOpen] = useState(true);
  const [before, setBefore] = useState(() => structuredClone(sample));
  const [after, setAfter] = useState(() => ({ ...structuredClone(sample), appearance: {
    accent: "sage" as const, layout: "standard" as const, imageUrl: "",
    copy: { navReserve: tr("予約する") },
    theme: { ...standardTheme, headerCss: ".public-nav{gap:24px;padding:18px}" },
  } }));
  const preview = (config: typeof before) => <div className="comparison-preview"><div inert><ChromePreview config={config} part="header" /></div></div>;
  return <main><button onClick={() => setOpen(true)}>{tr("修正案を比較")}</button>{preview(before)}
    {open && <VisualChangeReview reviewed before={preview(before)} after={preview(after)} summary={[tr("共通ヘッダー")]} busy={false} error={failed ? tr("操作できませんでした") : ""}
      onAccept={() => { setBefore(after); setOpen(false); }} onCancel={() => setOpen(false)} onRefine={async () => {
        setAfter(current => ({ ...current, appearance: { ...current.appearance, theme: { ...current.appearance.theme, headerCss: ".public-nav{gap:32px;padding:24px}" } } })); return true;
      }} />}
  </main>;
}
const meta = { title: "運営/画面の編集/修正案を比較", component: ReviewExample, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReviewExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Header: Story = {};
export const Retry: Story = { tags: ["expected-alert"], args: { failed: true } };
