import type { Route } from "./+types/api.kakeratta";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { withKakeratta, beginKakerattaPoll, endKakerattaPoll } from "~/services/kakeratta.server";
import { pollKakeratta } from "~/services/kakeratta-worker";
import { createDirectStore } from "~/services/kakeratta-direct-store.server";
import { getDirectTools } from "~/services/kakeratta-direct-tools.server";
import type { KakerattaGenerate } from "~/services/kakeratta-worker";
import type { KakerattaProfile } from "~/types/kakeratta";
import { collectKakerattaAnswer } from "~/services/kakeratta-chat";
import { KakerattaSettingsSchema, resolveKakerattaProfile, getKakerattaRagError } from "~/types/kakeratta";
import { syncTimelineFromDrive, TimelinePremiumRequired } from "~/services/kakeratta-timeline.server";
import { getDefaultModelForPlan, getAvailableModels, isImageGenerationModel, supportsWebSearch } from "~/types/settings";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const tokens = await requireAuth(request);
  const { tokens: valid, setCookieHeader } = await getValidTokens(request, tokens);
  const headers = setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined;
  const settings = await getSettings(valid.accessToken, valid.rootFolderId);
  const body = await request.json().catch(() => null);
  try {
    if (body?.operation === "personas") {
      const config = KakerattaSettingsSchema.parse(body.config);
      const result = await withKakeratta(config, request.signal, call => call("list_personas", {}));
      return Response.json({ personas: result.personas }, { headers });
    }
    if (body?.operation !== "poll" && body?.operation !== "timeline") return Response.json({ error: "Invalid operation" }, { status: 400, headers });
    const config = KakerattaSettingsSchema.parse(settings.kakeratta ?? {});
    if (!config.enabled) return Response.json({ disabled: true }, { headers });
    // Cross-process ownership is enforced by Kakeratta's atomic claims.
    const controller = beginKakerattaPoll(valid.rootFolderId);
    if (!controller) return Response.json({ busy: true }, { headers });
    try {
      const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(240_000)]);
      if (Array.isArray(body.timelineFiles) && body.timelineFiles.length && body.timelineRootFolderId !== valid.rootFolderId) return Response.json({ error: "Timeline cache belongs to another account. Reload GemiHub before synchronizing." }, { status: 400, headers });
      let timeline: Awaited<ReturnType<typeof syncTimelineFromDrive>> | { error: string } | undefined;
      if (config.timelineSync.enabled) {
        try {
          timeline = await syncTimelineFromDrive(valid, config, settings.language ?? "en", signal, Array.isArray(body.timelineFiles) ? body.timelineFiles : []);
        } catch (error) {
          if (body.operation === "timeline") throw error;
          timeline = { error: error instanceof TimelinePremiumRequired ? error.message : "Timeline synchronization failed. Your local changes were kept." };
        }
      }
      if (body.operation === "timeline") return Response.json({ timeline }, { headers });
      const ragError = getKakerattaRagError(config, settings);
      if (ragError) return Response.json({ error: ragError, timeline }, { status: 400, headers });
      const generate = (resolveProfile: (context: unknown) => KakerattaProfile): KakerattaGenerate => async (messages, systemPrompt, turnSignal, context) => {
        const profile = resolveProfile(context);
        const requestedModel = profile.model || settings.selectedModel || getDefaultModelForPlan(settings.apiPlan);
        const model = getAvailableModels(settings.apiPlan).find(m => m.name === requestedModel)?.name;
        if (!model || isImageGenerationModel(model)) throw new Error("Choose a supported answer model");
        if (profile.webSearch && !supportsWebSearch(model)) throw new Error("Choose a model supporting Web Search");
        const rag = profile.ragSetting ? settings.ragSettings[profile.ragSetting] : undefined;
        if (profile.ragSetting && !rag) throw new Error("RAG setting no longer exists");
        // Use the same provider routing and read-only tool enforcement as chat.
        const { action: chat } = await import("./api.chat");
        const chatRequest = new Request(new URL("/api/chat", request.url), {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: setCookieHeader?.split(";")[0] ?? request.headers.get("Cookie") ?? "", "X-GemiHub-Kakeratta": "true" },
          signal: turnSignal,
          body: JSON.stringify({ messages, model, systemPrompt, driveToolMode: profile.readFiles ? "readOnly" : "none", enableMcp: false, ragStoreIds: rag?.storeIds?.length ? rag.storeIds : rag?.storeId ? [rag.storeId] : [], webSearchEnabled: profile.webSearch }),
        });
        const response = await chat({ request: chatRequest, params: {}, context: {} } as Parameters<typeof chat>[0]);
        return collectKakerattaAnswer(response, turnSignal);
      };
      const tokenSnapshot = new Map(settings.mcpServers.map(server => [server.id, JSON.stringify(server.oauthTokens ?? null)]));
      const directTools = config.direct.enabled ? await getDirectTools(settings, config.direct.mcpServerIds, undefined, async servers => {
        const changed = servers.filter(server => JSON.stringify(server.oauthTokens ?? null) !== tokenSnapshot.get(server.id));
        if (!changed.length) return;
        const latest = await getSettings(valid.accessToken, valid.rootFolderId);
        let updated = false;
        const mcpServers = latest.mcpServers.map(server => {
          const refreshed = changed.find(candidate => candidate.id === server.id && candidate.url === server.url && JSON.stringify(candidate.headers ?? {}) === JSON.stringify(server.headers ?? {}));
          if (!refreshed || JSON.stringify(server.oauthTokens ?? null) !== tokenSnapshot.get(server.id)) return server;
          updated = true;
          return { ...server, oauthTokens: refreshed.oauthTokens };
        });
        if (updated) await saveSettings(valid.accessToken, valid.rootFolderId, { ...latest, mcpServers });
        for (const server of changed) tokenSnapshot.set(server.id, JSON.stringify(server.oauthTokens ?? null));
      }) : undefined;
      const directStore = config.direct.enabled ? await createDirectStore(valid.rootFolderId, config.url, config.headers) : undefined;
      const result = await withKakeratta(config, signal, call => pollKakeratta(call, generate(context => resolveKakerattaProfile(config, context)), signal, config.direct.enabled ? {
        store: directStore!,
        generate: generate(() => config.direct),
        tools: directTools?.definitions,
        executeTool: directTools?.execute,
      } : undefined));
      return Response.json({ pending: result.pending, submitted: result.submitted, unsubmitted: result.unsubmitted, failed: result.errors.length, requests: result.requests, timeline }, { headers });
    } finally {
      endKakerattaPoll(valid.rootFolderId);
    }
  } catch (error) {
    if (error instanceof TimelinePremiumRequired) return Response.json({ error: error.message }, { status: 403, headers });
    // Remote errors can contain credential-bearing URLs and headers.
    return Response.json({ error: "Kakeratta connection failed. Check the URL, headers and answer settings." }, { status: 400, headers });
  }
}
