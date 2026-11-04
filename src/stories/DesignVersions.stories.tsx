import React, { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { getLocale, tr } from "../../shared/i18n";
import { ApiProvider, type ApiClient } from "../api";
import { DesignVersionHistory } from "../DesignVersionHistory";
import type { DesignPublication } from "../../server/design-versions";

type Scenario = "empty" | "list" | "pending" | "publishing" | "screen";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const summary = (ja: string, en: string) => getLocale() === "en" ? en : ja;

/** In-memory stand-in for GET /design-versions and POST /design-versions/:n/restore. */
function createVersionClient(scenario: Scenario): ApiClient {
  const versions: DesignPublication[] = scenario === "empty" ? [] : [
    { number: 3, at: hoursAgo(2), summary: summary("トップの写真を大きく、配色をローズに変更", "Larger hero photo and rose color scheme") },
    { number: 2, at: hoursAgo(26), summary: summary("フッターにアクセスと営業時間を追加", "Added access and hours to the footer") },
    { number: 1, at: hoursAgo(72), summary: summary("最初のデザインを公開", "Published the first design") },
  ];
  let current: DesignPublication = scenario === "empty"
    ? { number: 1, at: hoursAgo(1), summary: summary("最初のデザインを公開", "Published the first design") }
    : { number: 4, at: hoursAgo(1), summary: summary("版 2 に復元", "Restored version 2"), restoredFrom: 2 };
  let revision = 7;
  let pendingRestore = scenario === "pending" ? { requestId: "00000000-0000-4000-8000-000000000001", number: 1, target: "all" } : null;
  const client = async (path: string, data?: unknown) => {
    const { pathname, searchParams } = new URL(path, "http://storybook.local");
    const restore = pathname.match(/\/design-versions\/(\d+)\/restore$/);
    if (restore && data) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const number = Number(restore[1]);
      const version = versions.find(item => item.number === number) || (() => { throw new Error(tr("版が見つかりません")); })();
      const target = (data as { target?: string }).target;
      versions.unshift({ ...current });
      current = { number: current.number + 1, at: new Date().toISOString(), summary: target ? summary(`「お店のこと」を版 ${number} に復元`, `Restored “About” to version ${number}`) : summary(`版 ${number} に復元`, `Restored version ${number}`), ...(target ? {} : { restoredFrom: version.number }) };
      versions.splice(10);
      revision++;
      pendingRestore = null;
      return { ok: true };
    }
    // A screen's history lists only versions whose state of that screen differs from now; here, every other one.
    const listed = searchParams.get("target") ? versions.filter((_, index) => index % 2 === 0) : versions;
    if (pathname.endsWith("/design-versions")) return { versions: listed.map(({ number, at, summary }) => ({ number, at, summary })), current, revision, publishing: scenario === "publishing" || !!pendingRestore, pendingRestore };
    throw new Error(tr("未対応のモック操作"));
  };
  return client as ApiClient;
}

function VersionHistoryStory({ scenario }: { scenario: Scenario }) {
  const screen = scenario === "screen";
  const client = useMemo(() => createVersionClient(scenario), [scenario]);
  const [revision, setRevision] = useState(7);
  return <ApiProvider value={client}>
    <main style={{ maxWidth: 880, margin: "0 auto", padding: 16 }}>
      <h1>{screen ? tr("お店のこと") : tr("版履歴")}</h1>
      <DesignVersionHistory {...(screen ? { target: "screen:about", targetLabel: tr("お店のこと") } : {})} shopId="story-shop" revision={revision} timeZone="Asia/Tokyo" onRestored={async () => setRevision(value => value + 1)} />
    </main>
  </ApiProvider>;
}

/** The panel loads lazily on open, so each story opens it the way an owner would. */
async function openHistory({ canvasElement }: { canvasElement: HTMLElement }) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const details = canvasElement.querySelector<HTMLDetailsElement>(".design-version-history");
    if (details) { if (!details.open) details.querySelector("summary")!.click(); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("The version history panel did not appear");
}

const meta = {
  title: "運営/画面の編集/版履歴",
  component: VersionHistoryStory,
  parameters: { layout: "fullscreen" },
  render: args => <VersionHistoryStory key={args.scenario} {...args} />,
  play: openHistory,
} satisfies Meta<typeof VersionHistoryStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  name: "まだ版がない（初回公開直後）",
  args: { scenario: "empty" },
};

export const List: Story = {
  name: "版の一覧・ワンクリックで復元",
  args: { scenario: "list" },
};

export const ScreenOnly: Story = {
  name: "画面ごとの版履歴・この画面だけ戻す",
  args: { scenario: "screen" },
};

export const PendingRestore: Story = {
  name: "復元が未完了・同じ版を再試行",
  args: { scenario: "pending" },
};

export const Publishing: Story = {
  name: "公開処理中は復元できない",
  args: { scenario: "publishing" },
};
