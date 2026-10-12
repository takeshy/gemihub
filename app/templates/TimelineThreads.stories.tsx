import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { I18nProvider } from "~/i18n/context";
import { EditorContextProvider } from "~/contexts/EditorContext";
import TimelineWidget from "~/dashboard/widgets/TimelineWidget";
import { buildEntryBlock } from "~/dashboard/memo/memoTimeline";
import { setCachedFile, setCachedRemoteMeta } from "~/services/indexeddb-cache-drive";
import { setActiveProjectSelection } from "~/services/active-project";

function ThreadScene() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    setActiveProjectSelection(null);
    const name = "Dashboards/Timeline/ThreadDemo/2026-10-11.md";
    const content = [
      buildEntryBlock({ id: "root", createdAt: "2026-10-11T10:00:00.000Z", metadata: { "author-name": "あなた" }, body: "夕食に、きのこを使った料理を作りたい。" }),
      buildEntryBlock({ id: "chef", createdAt: "2026-10-12T00:00:00.000Z", metadata: { speaker: "gourmet", "author-name": "料理担当", "root-id": "root", "reply-to": "root" }, body: "きのこのクリームパスタはいかがでしょう。香りを出すため、先にきのこを炒めます。" }),
      buildEntryBlock({ id: "conflict", createdAt: "2026-10-12T00:01:00.000Z", metadata: { speaker: "user", "author-name": "あなた", "root-id": "root", "reply-to": "root", "conflict-of": "root", "conflict-operation": "edit", "local-only": "true" }, body: "GemiHub 側で変更したメモ：和風のきのこ料理も試したい。" }),
    ].join("\n\n---\n\n");
    void (async () => {
      await setCachedFile({ fileId: "thread-demo", fileName: name, content, md5Checksum: "fixture", modifiedTime: "2026-10-12T00:01:00.000Z", cachedAt: Date.now() });
      await setCachedRemoteMeta({ id: "current", rootFolderId: "storybook-root", lastUpdatedAt: "", cachedAt: Date.now(), files: { "thread-demo": { name, mimeType: "text/markdown", md5Checksum: "fixture", modifiedTime: "2026-10-12T00:01:00.000Z" } } });
      if (active) setReady(true);
    })();
    return () => { active = false; if (online) Object.defineProperty(navigator, "onLine", online); else Reflect.deleteProperty(navigator, "onLine"); };
  }, []);
  return <I18nProvider language="ja"><EditorContextProvider><div className="h-[760px] max-w-2xl border bg-white">
    {ready && <TimelineWidget config={{ name: "ThreadDemo" }} />}
  </div></EditorContextProvider></I18nProvider>;
}
function RoutedThreads() {
  const router = useMemo(() => createMemoryRouter([{ path: "*", element: <ThreadScene /> }]), []);
  return <RouterProvider router={router} />;
}
const meta = { title: "Templates/TimelineThreads", component: RoutedThreads, parameters: { layout: "centered" } } satisfies Meta<typeof RoutedThreads>;
export default meta;
export const RepliesAndConflict: StoryObj<typeof meta> = {};
