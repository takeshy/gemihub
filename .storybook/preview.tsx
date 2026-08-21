import type { Preview } from "@storybook/react-vite";
import "../app/app.css";

// React Router's dev module graph may evaluate route-level server helpers
// while composing the real IDE components. Keep their environment guards
// inert in the browser; all network calls remain intercepted below.
(globalThis as typeof globalThis & { process?: { env: Record<string, string> } }).process ??= { env: { NODE_ENV: "development" } };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Stories are intentionally hermetic: UI code can exercise its normal fetch
// paths, but no request can reach Drive, Firestore, Stripe, GitHub, or Gemini.
globalThis.fetch = async (input, init) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, globalThis.location?.origin ?? "http://storybook.local");

  if (url.pathname === "/api/orgs/list") {
    return json({ organizations: [{ id: "acme", name: "Acme Design", role: "owner" }] });
  }
  if (url.pathname === "/api/projects/list") {
    return json({ projects: [{ id: "website", orgId: "acme", name: "Website renewal", role: "admin" }] });
  }
  if (url.pathname === "/api/members/list" && url.searchParams.has("projectId")) {
    return json({ members: [{ uid: "user-2", email: "editor@example.com", role: "editor", isExternal: false }] });
  }
  if (url.pathname === "/api/members/list") {
    return json({
      members: [
        { uid: "user-1", email: "owner@example.com", role: "owner" },
        { uid: "user-2", email: "editor@example.com", role: "member", monthlyBudgetUsdOverride: 20 },
      ],
    });
  }
  if (url.pathname === "/api/orgs/ai-settings") {
    return json({
      settings: {
        vertexProjectId: "acme-ai-project",
        vertexLocation: "asia-northeast1",
        monthlyBudgetUsd: 100,
        defaultUserMonthlyBudgetUsd: 25,
      },
      usage: { organization: { estimatedCostUsd: 12.4, inputTokens: 124000, outputTokens: 18000 }, users: {} },
      oauthStatus: { connected: true, connectedEmail: "owner@example.com", connectedAt: Date.now(), clientConfigured: true, projectId: "acme-ai-project" },
      budget: { includedUsd: 100, configuredUsd: 100, topUpUsd: 0, limitUsd: 100 },
      storage: { usedBytes: 12884901888, quotaGb: 100, includedGb: 100, addonUnits: 0 },
    });
  }
  if (url.pathname === "/api/drive/files") {
    return json({ files: [{ id: "weekly", name: "Workflows/weekly-report.yaml" }] });
  }
  if (url.pathname === "/api/drive/tree") {
    const modifiedTime = "2026-08-21T03:00:00.000Z";
    return json({ meta: { lastUpdatedAt: modifiedTime, files: {
      dashboard: { name: "Dashboards/team-overview.dashboard", mimeType: "text/yaml", md5Checksum: "dashboard", modifiedTime },
      weekly: { name: "Workflows/weekly-content-report.yaml", mimeType: "text/yaml", md5Checksum: "weekly", modifiedTime },
      notes: { name: "Notes/project-notes.md", mimeType: "text/markdown", md5Checksum: "notes", modifiedTime },
    } } });
  }
  if (url.pathname === "/api/calendar") {
    return json({
      events: [
        { id: "design-review", summary: "Design review / デザインレビュー", start: "2026-08-22T10:00:00+09:00", end: "2026-08-22T11:00:00+09:00", location: "Meet", htmlLink: "https://calendar.google.com/calendar/event?eid=design-review" },
        { id: "release", summary: "Release prep / リリース準備", start: "2026-08-22T14:30:00+09:00", end: "2026-08-22T15:30:00+09:00", description: "Final check / 最終チェック", htmlLink: "https://calendar.google.com/calendar/event?eid=release" },
        { id: "planning", summary: "Weekly planning / 来週の計画", start: "2026-08-26", end: "2026-08-27", htmlLink: "https://calendar.google.com/calendar/event?eid=planning" },
      ],
    });
  }
  if (url.pathname === "/api/chat/history") return json([]);
  if (url.pathname === "/api/sync" && init?.method === "POST") {
    let fileIds: string[] = [];
    try {
      const body = typeof init.body === "string" ? JSON.parse(init.body) as { fileIds?: string[] } : {};
      fileIds = body.fileIds ?? [];
    } catch { /* malformed fixture requests intentionally fall through */ }
    const remoteContents: Record<string, string> = {
      weekly: "name: Weekly content report\ndescription: Build the weekly draft\nnodes:\n  - id: collect\n    type: drive-search\n    query: quarterly plan\n  - id: summarize\n    type: generate-text\n    prompt: Summarize the collected notes\n  - id: publish\n    type: drive-save\n    path: Reports/draft.md\n",
      notes: "# Project notes\n\nQuarterly planning notes and product goals.\n\n## Next actions\n\n- Review the roadmap\n- Confirm the release date\n",
      roadmap: "# Product roadmap\n\n## Q3\n\n- Search improvements: in progress\n- Workflow templates: planned\n- Organization projects: planned\n",
      settings: "language: ja\ntheme: system\nautoSync: false\nragTopK: 5\n",
      archived: "# Archived launch checklist\n\n- [x] Design review\n- [x] Security review\n- [ ] Release notes\n",
      conflicted: "# Quarterly report\n\n## Highlights\n\n- Search latency improved by 24%\n- Workflow adoption reached 65%\n- Customer satisfaction reached 91%\n\n## Follow-up\n\n- Complete the documentation migration\n",
    };
    return json({ files: fileIds.map((id) => ({ id, content: remoteContents[id] ?? "Previous remote content\n" })) });
  }
  if (url.pathname === "/api/settings/external-skills") return json({ skills: [] });
  if (url.pathname.startsWith("/api/")) return json({ success: true, files: [], plugins: [] });
  if (url.pathname === "/settings") return json({ success: true });

  return json({ error: `Unmocked Storybook request: ${url.pathname}` }, 404);
};

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    a11y: { test: "todo" },
    options: { storySort: { order: ["Templates", "Settings"] } },
  },
};

export default preview;
