import { useState, useEffect } from "react";
import { data, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { requireAuth, getSession, commitSession, setGeminiApiKey, setTokens } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { getSettings, saveSettings } from "~/services/user-settings.server";
import { resolveLanguage } from "~/i18n/resolve-language";
import { rebuildSyncMeta } from "~/services/sync-meta.server";
import { ENCRYPTED_AUTH_FILE_NAME } from "~/services/sync-diff";
import { validateMcpServerUrl } from "~/services/url-validator.server";
import { GoogleGenAI } from "@google/genai";
import type {
  UserSettings,
  McpServerConfig,
  RagSetting,
  ApiPlan,
  ModelType,
  Language,
  FontSize,
  Theme,
  ShortcutKeyBinding,
  HubworkSchedule,
} from "~/types/settings";
import {
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
} from "~/types/settings";
import { I18nProvider, useI18n } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { getLocalPlugins } from "~/services/local-plugins.server";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateKeyPair,
  encryptData,
} from "~/services/crypto-core";
import {
  ArrowLeft,
  Settings as SettingsIcon,
  Server,
  Database,
  Terminal,
  RefreshCw,
  Puzzle,
  Keyboard,
  Globe,
} from "lucide-react";
import { CommandsTab } from "~/components/settings/CommandsTab";
import { PluginsTab } from "~/components/settings/PluginsTab";
import { ShortcutsTab } from "~/components/settings/ShortcutsTab";
import { GeneralTab } from "~/components/settings/GeneralTab";
import { SyncTab } from "~/components/settings/SyncTab";
import { McpTab } from "~/components/settings/McpTab";
import { RagTab } from "~/components/settings/RagTab";
import { HubworkTab } from "~/components/settings/HubworkTab";
import { useIsMobile } from "~/hooks/useIsMobile";
import { PluginProvider } from "~/contexts/PluginContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

type TabId = "general" | "mcp" | "rag" | "commands" | "plugins" | "sync" | "shortcuts" | "hubwork";

import type { TranslationStrings } from "~/i18n/translations";

const TABS: { id: TabId; labelKey: keyof TranslationStrings; icon: typeof SettingsIcon; desktopOnly?: boolean }[] = [
  { id: "general", labelKey: "settings.tab.general", icon: SettingsIcon },
  { id: "sync", labelKey: "settings.tab.sync", icon: RefreshCw },
  { id: "mcp", labelKey: "settings.tab.mcp", icon: Server },
  { id: "rag", labelKey: "settings.tab.rag", icon: Database },
  { id: "commands", labelKey: "settings.tab.commands", icon: Terminal },
  { id: "shortcuts", labelKey: "settings.tab.shortcuts", icon: Keyboard, desktopOnly: true },
  { id: "plugins", labelKey: "settings.tab.plugins", icon: Puzzle },
  { id: "hubwork", labelKey: "settings.tab.hubwork", icon: Globe },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);
  const { getAccountByRootFolderId } = await import("~/services/hubwork-accounts.server");

  let hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
  // Also try matching by email for accounts created via Stripe/admin before user enabled
  if (!hubworkAccount && validTokens.email) {
    const { getAccountByEmail } = await import("~/services/hubwork-accounts.server");
    hubworkAccount = await getAccountByEmail(validTokens.email);
  }

  // Ensure refresh token for all Hubwork accounts
  if (hubworkAccount?.plan) {
    // Always update refresh token if available (ensures new OAuth scopes are persisted)
    if (validTokens.refreshToken) {
      import("~/services/hubwork-accounts.server").then(({ updateRefreshToken, updateAccount }) => {
        updateRefreshToken(hubworkAccount!.id, validTokens.refreshToken).catch(() => {});
        // Also update rootFolderId/email if missing
        const updates: Record<string, string> = {};
        if (!hubworkAccount!.rootFolderId && validTokens.rootFolderId) updates.rootFolderId = validTokens.rootFolderId;
        if (!hubworkAccount!.email && validTokens.email) updates.email = validTokens.email;
        if (Object.keys(updates).length > 0) {
          updateAccount(hubworkAccount!.id, updates).catch(() => {});
        }
      });
    }
  }
  const settings = {
    ...driveSettings,
    hubwork: driveSettings.hubwork
      ? {
          ...driveSettings.hubwork,
          accountId: hubworkAccount?.id,
          plan: hubworkAccount?.plan,
          accountSlug: hubworkAccount?.accountSlug,
          defaultDomain: hubworkAccount?.defaultDomain,
          customDomain: hubworkAccount?.customDomain || driveSettings.hubwork.customDomain,
          billingStatus: hubworkAccount?.billingStatus,
          accountStatus: hubworkAccount?.accountStatus,
          domainStatus: hubworkAccount?.domainStatus || driveSettings.hubwork.domainStatus,
        }
      : hubworkAccount?.plan
        ? { plan: hubworkAccount.plan, accountId: hubworkAccount.id, accountSlug: hubworkAccount.accountSlug, defaultDomain: hubworkAccount.defaultDomain }
        : driveSettings.hubwork,
  };

  // Persist plan/billingStatus into Drive settings.json so _index loader can
  // read it without querying Firestore on every page load.
  if (hubworkAccount?.plan && driveSettings.hubwork) {
    const drivePlan = driveSettings.hubwork.plan;
    const driveBilling = driveSettings.hubwork.billingStatus;
    if (drivePlan !== hubworkAccount.plan || driveBilling !== hubworkAccount.billingStatus) {
      const updatedHubwork = {
        ...driveSettings.hubwork,
        plan: hubworkAccount.plan,
        billingStatus: hubworkAccount.billingStatus,
      };
      saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...driveSettings,
        hubwork: updatedHubwork,
      }).catch(() => {});
    }
  } else if (!hubworkAccount?.plan && driveSettings.hubwork?.plan) {
    // Clean up stale plan from Drive settings when Firestore account no longer exists
    const { plan: _stale, billingStatus: _staleBilling, ...rest } = driveSettings.hubwork;
    saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
      ...driveSettings,
      hubwork: Object.keys(rest).length > 0 ? rest : undefined,
    }).catch(() => {});
  }

  // Merge local plugins (dev only)
  const localPlugins = getLocalPlugins();
  const localIds = new Set(localPlugins.map((p) => p.id));
  const mergedPlugins = [
    ...localPlugins,
    ...(settings.plugins || []).filter((p) => !localIds.has(p.id)),
  ];
  const mergedSettings = { ...settings, plugins: mergedPlugins };
  const acceptLanguage = request.headers.get("Accept-Language");
  const effectiveLanguage = resolveLanguage(mergedSettings.language, acceptLanguage);

  const grantedScopes = validTokens.grantedScopes || "";
  const hasGmailScope = grantedScopes.includes("gmail");
  const hasCalendarScope = grantedScopes.includes("calendar");
  const hasHubworkScopes = hasGmailScope && hasCalendarScope;

  return data(
    {
      settings: { ...mergedSettings, language: effectiveLanguage },
      hasApiKey: !!validTokens.geminiApiKey,
      maskedKey: validTokens.geminiApiKey ? maskApiKey(validTokens.geminiApiKey) : null,
      hasHubworkScopes,
      rootFolderId: validTokens.rootFolderId,
    },
    { headers: setCookieHeader ? { "Set-Cookie": setCookieHeader } : undefined }
  );
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  // Build a base session that already includes refreshed tokens (if any).
  // Action cases that modify the session should build on top of this.
  const baseSession = setCookieHeader
    ? await setTokens(request, validTokens)
    : await getSession(request);
  const jsonWithCookie = async (data: unknown, init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    // If tokens were refreshed but no action-specific Set-Cookie was provided,
    // commit the base session so refreshed tokens are persisted.
    if (setCookieHeader && !headers.has("Set-Cookie")) {
      headers.set("Set-Cookie", await commitSession(baseSession));
    }
    return Response.json(data, { ...init, headers });
  };
  const currentSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  const formData = await request.formData();
  const _action = formData.get("_action") as string;
  try {
    switch (_action) {
      case "saveGeneral": {
        const apiPlan = (formData.get("apiPlan") as ApiPlan) || currentSettings.apiPlan;
        const selectedModel = (formData.get("selectedModel") as ModelType) || null;
        const systemPrompt = (formData.get("systemPrompt") as string) || "";
        const geminiApiKey = (formData.get("geminiApiKey") as string)?.trim() || "";
        const language = (formData.get("language") as Language) || currentSettings.language;
        const fontSize = Number(formData.get("fontSize")) as FontSize || currentSettings.fontSize;
        const theme = (formData.get("theme") as Theme) || currentSettings.theme || "system";
        const showManagementFolders = formData.get("showManagementFolders") === "on";

        // Encryption-related fields
        const password = (formData.get("password") as string)?.trim() || "";
        const confirmPassword = (formData.get("confirmPassword") as string)?.trim() || "";
        const currentPassword = (formData.get("currentPassword") as string)?.trim() || "";
        const newPassword = (formData.get("newPassword") as string)?.trim() || "";
        const encryptChatHistory = formData.get("encryptChatHistory") === "on";
        const encryptWorkflowHistory = formData.get("encryptWorkflowHistory") === "on";

        // Require API key and password on initial setup
        if (!currentSettings.encryptedApiKey) {
          if (!geminiApiKey) {
            return jsonWithCookie({ success: false, message: "apiKeyRequired" });
          }
          if (!password) {
            return jsonWithCookie({ success: false, message: "passwordRequiredError" });
          }
        }

        // Validate API key by calling Gemini API
        if (geminiApiKey) {
          try {
            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const validationModel = getDefaultModelForPlan(apiPlan);
            await ai.models.get({ model: validationModel });
          } catch {
            return jsonWithCookie({ success: false, message: "invalidApiKey" });
          }
        }

        const updatedSettings: UserSettings = {
          ...currentSettings,
          apiPlan,
          selectedModel: selectedModel && isModelAllowedForPlan(apiPlan, selectedModel)
            ? selectedModel
            : getDefaultModelForPlan(apiPlan),
          systemPrompt,
          language,
          fontSize,
          theme,
          showManagementFolders,
        };

        // Update file encryption toggles
        updatedSettings.encryption = {
          ...updatedSettings.encryption,
          encryptChatHistory,
          encryptWorkflowHistory,
        };

        let effectiveApiKey = geminiApiKey;

        const isInitialSetup = !currentSettings.encryptedApiKey && geminiApiKey && password;
        const isPasswordChange = !!currentSettings.encryptedApiKey && currentPassword && newPassword;
        const isApiKeyChangeOnly = !!currentSettings.encryptedApiKey && geminiApiKey && !newPassword;

        if (isApiKeyChangeOnly && !currentPassword) {
          return jsonWithCookie({ success: false, message: "currentPasswordRequired" });
        }

        if (isInitialSetup) {
          // Initial setup: encrypt API key + generate RSA key pair
          if (password !== confirmPassword) {
            return jsonWithCookie({ success: false, message: "Passwords do not match." });
          }
          if (password.length < 8) {
            return jsonWithCookie({ success: false, message: "Password must be at least 8 characters." });
          }

          const { encryptedPrivateKey: encApiKey, salt: apiSalt } = await encryptPrivateKey(geminiApiKey, password);
          updatedSettings.encryptedApiKey = encApiKey;
          updatedSettings.apiKeySalt = apiSalt;

          // Generate RSA key pair
          const keyPair = await generateKeyPair();
          const { encryptedPrivateKey: encRsaKey, salt: rsaSalt } = await encryptPrivateKey(keyPair.privateKey, password);
          updatedSettings.encryption = {
            ...updatedSettings.encryption,
            enabled: true,
            publicKey: keyPair.publicKey,
            encryptedPrivateKey: encRsaKey,
            salt: rsaSalt,
          };
        } else if (isPasswordChange) {
          // Password change: decrypt with old, re-encrypt with new
          if (newPassword !== confirmPassword) {
            return jsonWithCookie({ success: false, message: "Passwords do not match." });
          }
          if (newPassword.length < 8) {
            return jsonWithCookie({ success: false, message: "Password must be at least 8 characters." });
          }

          try {
            const decryptedApiKey = await decryptPrivateKey(
              currentSettings.encryptedApiKey, currentSettings.apiKeySalt, currentPassword
            );
            effectiveApiKey = geminiApiKey || decryptedApiKey;

            const { encryptedPrivateKey: encApiKey, salt: apiSalt } = await encryptPrivateKey(effectiveApiKey, newPassword);
            updatedSettings.encryptedApiKey = encApiKey;
            updatedSettings.apiKeySalt = apiSalt;

            // Re-encrypt RSA private key if exists
            if (currentSettings.encryption.encryptedPrivateKey && currentSettings.encryption.salt) {
              const rsaPrivateKey = await decryptPrivateKey(
                currentSettings.encryption.encryptedPrivateKey, currentSettings.encryption.salt, currentPassword
              );
              const { encryptedPrivateKey: encRsaKey, salt: rsaSalt } = await encryptPrivateKey(rsaPrivateKey, newPassword);
              updatedSettings.encryption = {
                ...updatedSettings.encryption,
                encryptedPrivateKey: encRsaKey,
                salt: rsaSalt,
              };
            }
          } catch {
            return jsonWithCookie({ success: false, message: "Current password is incorrect." });
          }
        } else if (isApiKeyChangeOnly) {
          // API key change only: re-encrypt new API key with current password
          try {
            // Verify current password by decrypting existing key
            await decryptPrivateKey(
              currentSettings.encryptedApiKey, currentSettings.apiKeySalt, currentPassword
            );

            const { encryptedPrivateKey: encApiKey, salt: apiSalt } = await encryptPrivateKey(geminiApiKey, currentPassword);
            updatedSettings.encryptedApiKey = encApiKey;
            updatedSettings.apiKeySalt = apiSalt;
          } catch {
            return jsonWithCookie({ success: false, message: "Current password is incorrect." });
          }
        }

        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        // Update session with API key and plan/model
        // Use baseSession which already has refreshed tokens if applicable
        if (effectiveApiKey) {
          const keySession = await setGeminiApiKey(request, effectiveApiKey);
          baseSession.set("geminiApiKey", keySession.get("geminiApiKey"));

          // Refresh the encrypted API key in Hubwork Firestore only if the user
          // already has scheduled workflows (Scheduler needs it). When no
          // schedules exist, no copy is kept in Firestore.
          if ((currentSettings.hubwork?.schedules?.length ?? 0) > 0) {
            try {
              const { getAccountByRootFolderId, getAccountByEmail, updateAccount, encryptGeminiApiKey } = await import("~/services/hubwork-accounts.server");
              let hwAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
              if (!hwAccount && validTokens.email) hwAccount = await getAccountByEmail(validTokens.email);
              if (hwAccount && (hwAccount.plan === "pro" || hwAccount.plan === "granted")) {
                await updateAccount(hwAccount.id, { encryptedGeminiApiKey: encryptGeminiApiKey(effectiveApiKey) });
              }
            } catch { /* best-effort */ }
          }
        }
        baseSession.set("apiPlan", apiPlan);
        baseSession.set("selectedModel", updatedSettings.selectedModel);
        baseSession.set("language", language);

        return jsonWithCookie(
          { success: true, message: "General settings saved.", apiKeyUpdated: !!effectiveApiKey },
          { headers: { "Set-Cookie": await commitSession(baseSession) } }
        );
      }

      case "saveMcp": {
        const mcpJson = formData.get("mcpServers") as string;
        let mcpServers: McpServerConfig[];
        try {
          mcpServers = mcpJson ? JSON.parse(mcpJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid MCP servers JSON." });
        }

        mcpServers = normalizeMcpServers(mcpServers);

        for (const server of mcpServers) {
          try {
            if (!server?.url || typeof server.url !== "string") {
              return jsonWithCookie({ success: false, message: "Each MCP server must include a valid URL." });
            }
            validateMcpServerUrl(server.url);
          } catch (error) {
            return jsonWithCookie({
              success: false,
              message: error instanceof Error
                ? `Invalid URL for MCP server "${server?.name || "unknown"}": ${error.message}`
                : "Invalid MCP server URL.",
            });
          }
        }

        const updatedSettings: UserSettings = { ...currentSettings, mcpServers };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "MCP server settings saved." });
      }

      case "saveRag": {
        const ragEnabled = formData.get("ragEnabled") === "on";
        const ragTopK = Math.min(20, Math.max(1, Number(formData.get("ragTopK")) || 5));
        const ragSettingsJson = formData.get("ragSettings") as string;
        let ragSettings: Record<string, RagSetting>;
        try {
          ragSettings = ragSettingsJson
            ? JSON.parse(ragSettingsJson)
            : currentSettings.ragSettings;
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid RAG settings JSON." });
        }
        const selectedRagSetting = (formData.get("selectedRagSetting") as string) || null;
        const ragRegistrationOnPush = formData.get("ragRegistrationOnPush") === "on";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          ragEnabled,
          ragTopK,
          ragSettings,
          selectedRagSetting,
          ragRegistrationOnPush,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "RAG settings saved." });
      }



      case "saveCommands": {
        const commandsJson = formData.get("slashCommands") as string;
        let slashCommands;
        try {
          slashCommands = commandsJson ? JSON.parse(commandsJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid commands JSON." });
        }
        const normalizedMcpServers = normalizeMcpServers(currentSettings.mcpServers || []);
        const normalizedCommands = (slashCommands as typeof currentSettings.slashCommands).map((cmd) => ({
          ...cmd,
          enabledMcpServers: (() => {
            const normalizedIds = normalizeSelectedMcpServerIds(
              cmd.enabledMcpServers,
              normalizedMcpServers
            );
            return normalizedIds.length > 0 ? normalizedIds : null;
          })(),
        }));
        const updatedSettings: UserSettings = {
          ...currentSettings,
          mcpServers: normalizedMcpServers,
          slashCommands: normalizedCommands,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Command settings saved." });
      }

      case "rebuildTree": {
        await rebuildSyncMeta(validTokens.accessToken, validTokens.rootFolderId);
        return jsonWithCookie({ success: true, message: "Sync meta rebuilt." });
      }

      case "saveShortcuts": {
        const shortcutsJson = formData.get("shortcutKeys") as string;
        let shortcutKeys: ShortcutKeyBinding[];
        try {
          shortcutKeys = shortcutsJson ? JSON.parse(shortcutsJson) : [];
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid shortcuts JSON." });
        }
        const updatedSettings: UserSettings = { ...currentSettings, shortcutKeys };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Shortcut settings saved." });
      }

      case "generateMigrationToken": {
        // TODO: Re-enable paid plan check once Premium Plan is fully launched
        // {
        //   const { getAccountByRootFolderId } = await import("~/services/hubwork-accounts.server");
        //   const account = await getAccountByRootFolderId(validTokens.rootFolderId);
        //   if (!account?.plan) {
        //     return jsonWithCookie({ success: false, message: "A paid plan is required to generate migration tokens." });
        //   }
        // }
        // Generate migration token (XOR-encoded accessToken + rootFolderId)
        const payload = JSON.stringify({ a: validTokens.accessToken, r: validTokens.rootFolderId });
        const buf = Buffer.from(payload);
        for (let i = 0; i < buf.length; i++) buf[i] ^= 0x5a;
        const migrationToken = buf.toString("hex");

        // If encryption is set up, also export _encrypted-auth.json to Drive
        const enc = currentSettings.encryption;
        if (enc?.enabled && enc.publicKey && enc.encryptedPrivateKey && enc.salt) {
          const url = new URL(request.url);
          const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
          const apiOrigin = `${proto}://${url.host}`;
          const authPayload = JSON.stringify({
            refreshToken: validTokens.refreshToken,
            apiOrigin,
          });
          const encrypted = await encryptData(authPayload, enc.publicKey);

          const authFileContent = JSON.stringify({
            data: encrypted,
            encryptedPrivateKey: enc.encryptedPrivateKey,
            salt: enc.salt,
          }, null, 2);
          const { findFileByExactName, createFile, updateFile } = await import("~/services/google-drive.server");
          const existingFile = await findFileByExactName(
            validTokens.accessToken, ENCRYPTED_AUTH_FILE_NAME, validTokens.rootFolderId
          );
          if (existingFile) {
            await updateFile(validTokens.accessToken, existingFile.id, authFileContent, "application/json");
          } else {
            await createFile(
              validTokens.accessToken, ENCRYPTED_AUTH_FILE_NAME, authFileContent,
              validTokens.rootFolderId, "application/json"
            );
          }
        }

        return jsonWithCookie({
          success: true,
          migrationToken,
        });
      }

      case "hubwork-spreadsheet-labels": {
        // Merge labels into existing spreadsheets without changing the list.
        const labelsJson = formData.get("labels") as string;
        let labels: Record<string, string>;
        try {
          labels = JSON.parse(labelsJson || "{}");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid labels data" });
        }
        const existingSS = currentSettings.hubwork?.spreadsheets || [];
        const updated = existingSS.map((s) => labels[s.id] ? { ...s, label: labels[s.id] } : s);
        const updatedSettings = {
          ...currentSettings,
          hubwork: { ...currentSettings.hubwork, spreadsheets: updated } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Labels updated" });
      }

      case "hubwork-accounts": {
        const spreadsheetsJson = formData.get("spreadsheets") as string;
        const accountsJson = formData.get("accounts") as string;
        const newSpreadsheetId = formData.get("newSpreadsheetId") as string | null;
        let spreadsheets: import("~/types/settings").HubworkSpreadsheet[];
        let accounts: Record<string, import("~/types/settings").HubworkAccountType>;
        try {
          spreadsheets = JSON.parse(spreadsheetsJson || "[]");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid spreadsheets data" });
        }
        try {
          accounts = JSON.parse(accountsJson || "{}");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid accounts data" });
        }
        const validSpreadsheets = spreadsheets.filter((s) => s.id?.trim());
        // Preserve existing values only when the field was not sent at all.
        // An explicit empty value ([] or {}) means intentional deletion.
        const finalSpreadsheets = spreadsheetsJson != null ? validSpreadsheets : currentSettings.hubwork?.spreadsheets;
        let finalAccounts: Record<string, import("~/types/settings").HubworkAccountType> | undefined = accountsJson != null ? accounts : (currentSettings.hubwork?.accounts ?? {});

        // Auto-create "accounts" account type for a newly created spreadsheet
        if (newSpreadsheetId) {
          finalAccounts = {
            ...finalAccounts,
            accounts: { identity: { spreadsheetId: newSpreadsheetId, sheet: "accounts", emailColumn: "email" } },
          };
        }

        // Remove account types whose identity or data sources reference a deleted spreadsheet
        if (finalAccounts && finalSpreadsheets) {
          const ssIds = new Set(finalSpreadsheets.map((s) => s.id));
          const defaultSsId = finalSpreadsheets[0]?.id;
          const cleaned: Record<string, import("~/types/settings").HubworkAccountType> = {};
          for (const [key, at] of Object.entries(finalAccounts)) {
            const identityRef = at.identity.spreadsheetId || defaultSsId;
            if (!identityRef || !ssIds.has(identityRef)) continue;
            // Also strip data sources referencing deleted spreadsheets
            if (at.data) {
              const cleanedData: Record<string, import("~/types/settings").HubworkDataSource> = {};
              for (const [dk, ds] of Object.entries(at.data)) {
                const dsRef = ds.spreadsheetId || defaultSsId;
                if (dsRef && ssIds.has(dsRef)) cleanedData[dk] = ds;
              }
              at.data = Object.keys(cleanedData).length > 0 ? cleanedData : undefined;
            }
            cleaned[key] = at;
          }
          finalAccounts = Object.keys(cleaned).length > 0 ? cleaned : undefined;
        }
        const updatedSettings = {
          ...currentSettings,
          hubwork: {
            ...currentSettings.hubwork,
            spreadsheets: finalSpreadsheets,
            accounts: finalAccounts,
          } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true, message: "Account types saved" });
      }

      case "hubwork-schedules": {
        const schedulesJson = formData.get("schedules") as string;
        let schedules: HubworkSchedule[];
        try {
          schedules = JSON.parse(schedulesJson || "[]");
        } catch {
          return jsonWithCookie({ success: false, message: "Invalid schedules data" });
        }
        schedules = schedules.map((schedule) => ({
          ...schedule,
          concurrencyPolicy: schedule.concurrencyPolicy === "forbid" ? "forbid" : "allow",
        }));

        // When schedules are present, the Scheduler needs a server-side copy of
        // the Gemini API key. Require the key to be unlocked in this session so
        // that we can encrypt and persist it alongside the schedules.
        if (schedules.length > 0 && !validTokens.geminiApiKey) {
          return jsonWithCookie({ success: false, message: "scheduleApiKeyRequired" });
        }

        const updatedSettings = {
          ...currentSettings,
          hubwork: { ...currentSettings.hubwork, schedules } as typeof currentSettings.hubwork,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);

        // Rebuild Firestore schedule index and synchronize the encrypted API
        // key with the new schedule count: write when schedules exist, delete
        // when none remain. accountId is not reliably in Drive settings (it's
        // injected by the loader), so resolve from Firestore directly via
        // rootFolderId or email.
        try {
          const { getAccountByRootFolderId, getAccountByEmail, rebuildScheduleIndex, updateAccount, encryptGeminiApiKey, clearEncryptedGeminiApiKey } = await import("~/services/hubwork-accounts.server");
          let hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
          if (!hubworkAccount && validTokens.email) {
            hubworkAccount = await getAccountByEmail(validTokens.email);
          }
          if (hubworkAccount && (hubworkAccount.plan === "pro" || hubworkAccount.plan === "granted")) {
            await rebuildScheduleIndex(hubworkAccount.id, schedules);
            if (schedules.length > 0 && validTokens.geminiApiKey) {
              await updateAccount(hubworkAccount.id, {
                encryptedGeminiApiKey: encryptGeminiApiKey(validTokens.geminiApiKey),
              });
            } else if (schedules.length === 0) {
              await clearEncryptedGeminiApiKey(hubworkAccount.id);
            }
          }
        } catch (e) {
          console.warn("[settings] Schedules saved to Drive, but failed to sync Firestore schedule index or encrypted API key:", e);
        }
        return jsonWithCookie({ success: true, message: "Schedules saved" });
      }

      default:
        return jsonWithCookie({ success: false, message: "Unknown action." });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An error occurred.";
    return jsonWithCookie({ success: false, message });
  }
}

// ---------------------------------------------------------------------------
// Client loader — apply localStorage language before render to avoid hydration mismatch
// ---------------------------------------------------------------------------

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  const data = await serverLoader();
  try {
    const ls = localStorage.getItem("gemihub-language");
    if ((ls === "ja" || ls === "en") && data.settings.language !== ls) {
      return { ...data, settings: { ...data.settings, language: ls as Language } };
    }
  } catch { /* localStorage unavailable */ }
  return data;
}

clientLoader.hydrate = true as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Settings() {
  const { settings, hasApiKey, maskedKey, hasHubworkScopes, rootFolderId } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const [currentLang, setCurrentLang] = useState<Language>(settings.language ?? "en");
  useApplySettings(currentLang, settings.fontSize, settings.theme);

  const [hubworkCallback, setHubworkCallback] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Detect redirect return params. Use useSearchParams (router-aware) so that
  // client-side navigations (e.g. review-slug Pro activation, which redirects
  // same-route via fetcher.Form without remounting Settings) also trigger the
  // callback handling. Cleanup goes through setSearchParams — not
  // window.history.replaceState — so the Router's location stays in sync with
  // the real URL; otherwise a second same-query redirect would look like "no
  // change" to the Router and this effect would never re-fire.
  useEffect(() => {
    if (searchParams.has("mcp-oauth-return")) {
      setActiveTab("mcp");
    }
    if (searchParams.has("hubwork_subscribed") || searchParams.has("hubwork_upgraded")) {
      setActiveTab("hubwork");
    }
    // Mirror the URL, so hubworkCallback clears on non-callback visits instead
    // of latching to true forever after the first callback.
    setHubworkCallback(searchParams.has("hubwork_subscribed"));

    const needsCleanup =
      searchParams.has("mcp-oauth-return") ||
      searchParams.has("hubwork_subscribed") ||
      searchParams.has("hubwork_upgraded");
    if (needsCleanup) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("mcp-oauth-return");
          next.delete("hubwork_subscribed");
          next.delete("hubwork_upgraded");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  return (
    <I18nProvider language={currentLang}>
      <PluginProvider pluginConfigs={settings.plugins || []} language={currentLang} hasPremium={settings.hubwork?.plan === "pro" || settings.hubwork?.plan === "granted"}>
        <SettingsInner
          settings={settings}
          hasApiKey={hasApiKey}
          maskedKey={maskedKey}
          hasHubworkScopes={hasHubworkScopes}
          rootFolderId={rootFolderId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onLanguageChange={setCurrentLang}
          hubworkCallback={hubworkCallback}
        />
      </PluginProvider>
    </I18nProvider>
  );
}

function SettingsInner({
  settings,
  hasApiKey,
  maskedKey,
  hasHubworkScopes,
  rootFolderId,
  activeTab,
  setActiveTab,
  onLanguageChange,
  hubworkCallback,
}: {
  settings: UserSettings;
  hasApiKey: boolean;
  maskedKey: string | null;
  hasHubworkScopes: boolean;
  rootFolderId: string;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  onLanguageChange: (lang: Language) => void;
  hubworkCallback: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const visibleTabs = isMobile ? TABS.filter((tab) => !tab.desktopOnly) : TABS;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => {
              // Go back if previous page was same origin, otherwise go to top
              const prev = document.referrer;
              if (prev && new URL(prev).origin === window.location.origin) {
                navigate(-1);
              } else {
                navigate("/");
              }
            }}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("settings.title")}</h1>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <nav className="flex gap-1 overflow-x-auto scrollbar-hide" aria-label="Settings tabs">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 text-xs sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:border-gray-300"
                  }`}
                >
                  <Icon size={16} />
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab content */}
      <main className="max-w-5xl mx-auto px-4 py-4 sm:py-8">
        {activeTab === "general" && (
          <GeneralTab settings={settings} hasApiKey={hasApiKey} maskedKey={maskedKey} onLanguageChange={onLanguageChange} />
        )}
        {activeTab === "sync" && <SyncTab settings={settings} />}
        {activeTab === "mcp" && <McpTab settings={settings} />}
        {activeTab === "rag" && <RagTab settings={settings} />}
        {activeTab === "commands" && <CommandsTab settings={settings} />}
        {activeTab === "plugins" && <PluginsTab settings={settings} />}
        {activeTab === "shortcuts" && <ShortcutsTab settings={settings} />}
        {activeTab === "hubwork" && <HubworkTab settings={settings} hasHubworkScopes={hasHubworkScopes} rootFolderId={rootFolderId} isCallback={hubworkCallback} />}
      </main>
    </div>
  );
}
