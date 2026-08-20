import { useState, useEffect } from "react";
import { data, redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { requireAuth, getSession, commitSession, setGeminiApiKey, setTokens } from "~/services/session.server";
import { getValidTokens, hasRequiredHubworkScopes } from "~/services/google-auth.server";
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
  Language,
  FontSize,
  Theme,
  ShortcutKeyBinding,
  HubworkSchedule,
} from "~/types/settings";
import {
  normalizeMcpServers,
  normalizeSelectedMcpServerIds,
  normalizeDeprecatedModelName,
  getDefaultModelForPlan,
  isModelAllowedForPlan,
} from "~/types/settings";
import { I18nProvider } from "~/i18n/context";
import { useApplySettings } from "~/hooks/useApplySettings";
import { getLocalPlugins } from "~/services/local-plugins.server";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateKeyPair,
  encryptData,
} from "~/services/crypto-core";
import { EnterpriseProvider } from "~/contexts/EnterpriseContext";
import type { EnterpriseSessionContext } from "~/types/enterprise";
import { PluginProvider } from "~/contexts/PluginContext";
import { isActivePremiumAccount } from "~/types/hubwork";
import { resolveSubmittedGeminiApiKey } from "~/utils/settings-api-key";
import {
  SettingsTemplate,
  isSettingsTabId,
  type SettingsTabId,
} from "~/templates/SettingsTemplate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  // Tokenless org sessions have no Drive-backed settings to load yet.
  if (!tokens.accessToken) {
    throw redirect("/login?workspace=pending");
  }
  const { tokens: validTokens, setCookieHeader } = await getValidTokens(request, tokens);
  const driveSettings = await getSettings(validTokens.accessToken, validTokens.rootFolderId);

  let hubworkAccount: Awaited<ReturnType<typeof import("~/services/hubwork-accounts.server").getAccountByRootFolderId>> = null;
  let hubworkAccountMatchedByEmail = false;
  let hubworkLookupSucceeded = true;
  try {
    const { getAccountByRootFolderId, getAccountByEmail } = await import("~/services/hubwork-accounts.server");
    hubworkAccount = await getAccountByRootFolderId(validTokens.rootFolderId);
    // Also try matching by email for accounts created via Stripe/admin before user enabled
    if (!hubworkAccount && validTokens.email) {
      hubworkAccount = await getAccountByEmail(validTokens.email);
      hubworkAccountMatchedByEmail = !!hubworkAccount;
    }
  } catch (error) {
    hubworkLookupSucceeded = false;
    console.warn("[settings] Failed to load Hubwork account from Firestore:", describeError(error));
  }
  const grantedScopes = validTokens.grantedScopes || "";
  const hasHubworkScopes = hasRequiredHubworkScopes(grantedScopes);

  // Ensure session identity and refresh token for Hubwork accounts without downgrading stored scopes.
  if (hubworkAccount?.plan) {
    import("~/services/hubwork-accounts.server").then(({ updateRefreshToken, updateAccount }) => {
      const updates: Record<string, string> = {};
      if (
        hubworkAccountMatchedByEmail &&
        validTokens.rootFolderId &&
        hubworkAccount!.rootFolderId !== validTokens.rootFolderId
      ) {
        updates.rootFolderId = validTokens.rootFolderId;
      }
      if (!hubworkAccount!.email && validTokens.email) updates.email = validTokens.email;
      if (Object.keys(updates).length > 0) {
        updateAccount(hubworkAccount!.id, updates).catch(() => {});
      }

      if (validTokens.refreshToken && hasHubworkScopes) {
        updateRefreshToken(hubworkAccount!.id, validTokens.refreshToken).catch(() => {});
      }
    });
  }
  const settings = {
    ...driveSettings,
    hubwork: hubworkAccount?.plan
      ? {
          ...driveSettings.hubwork,
          accountId: hubworkAccount.id,
          plan: hubworkAccount.plan,
          currency: hubworkAccount.currency,
          accountSlug: hubworkAccount.accountSlug,
          defaultDomain: hubworkAccount.defaultDomain,
          customDomain: hubworkAccount.customDomain || driveSettings.hubwork?.customDomain,
          billingStatus: hubworkAccount.billingStatus,
          accountStatus: hubworkAccount.accountStatus,
          domainStatus: hubworkAccount.domainStatus || driveSettings.hubwork?.domainStatus,
        }
      : driveSettings.hubwork,
  };

  // Persist plan/billingStatus into Drive settings.json so _index loader can
  // read it without querying Firestore on every page load.
  if (hubworkAccount?.plan && driveSettings.hubwork) {
    const drivePlan = driveSettings.hubwork.plan;
    const driveBilling = driveSettings.hubwork.billingStatus;
    const driveCurrency = driveSettings.hubwork.currency;
    if (drivePlan !== hubworkAccount.plan || driveBilling !== hubworkAccount.billingStatus || driveCurrency !== hubworkAccount.currency) {
      const updatedHubwork = {
        ...driveSettings.hubwork,
        plan: hubworkAccount.plan,
        currency: hubworkAccount.currency,
        billingStatus: hubworkAccount.billingStatus,
      };
      saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
        ...driveSettings,
        hubwork: updatedHubwork,
      }).catch(() => {});
    }
  } else if (hubworkLookupSucceeded && !hubworkAccount?.plan && driveSettings.hubwork?.plan) {
    // Clean up stale plan from Drive settings when Firestore account no longer exists
    const { plan: _stale, billingStatus: _staleBilling, ...rest } = driveSettings.hubwork;
    saveSettings(validTokens.accessToken, validTokens.rootFolderId, {
      ...driveSettings,
      hubwork: Object.keys(rest).length > 0 ? rest : undefined,
    }).catch(() => {});
  }

  // Organizations: resolve the enterprise selection and whether the user
  // belongs to any org. Gated on isFirestoreAvailable so self-hosted /
  // credential-less environments never touch Firestore.
  let enterprise: EnterpriseSessionContext = {
    uid: null,
    email: null,
    currentOrgId: null,
    currentProjectId: null,
    selection: null,
    selectionStatus: "no-session",
  };
  let hasOrganizations = false;
  // Non-null when Firestore is configured but the lookup failed (most often a
  // missing collection-group index). Shown to users who are entitled to the
  // organization tab, so the cause is visible instead of the tab silently
  // vanishing — never to ordinary users, who have nothing to do with orgs.
  let enterpriseError: string | null = null;
  try {
    const { isFirestoreAvailable } = await import("~/services/firestore.server");
    if (isFirestoreAvailable()) {
      const { resolveEnterpriseContext } = await import("~/services/enterprise-context.server");
      enterprise = await resolveEnterpriseContext(request);
      if (enterprise.uid) {
        const { listAccessibleOrganizationsForUser } = await import("~/services/projects.server");
        const { isSuperAdmin } = await import("~/services/super-admin.server");
        hasOrganizations =
          isSuperAdmin(enterprise.email ?? undefined) ||
          (await listAccessibleOrganizationsForUser(enterprise.uid)).length > 0;
      }
    }
  } catch (error) {
    enterpriseError = describeError(error);
    console.warn("[settings] Failed to resolve enterprise context:", enterpriseError);
  }

  // The organization tab belongs to Business (and granted) accounts, plus
  // anyone who already belongs to an org — an invited member is on their own
  // plan, so plan alone must not gate them out — plus service admins.
  const businessAccount =
    !!hubworkAccount &&
    hubworkAccount.accountStatus === "enabled" &&
    (hubworkAccount.plan === "business" || hubworkAccount.plan === "granted");
  const { isSuperAdmin: isServiceAdmin } = await import("~/services/super-admin.server");
  const showEnterpriseTab =
    hasOrganizations || businessAccount || isServiceAdmin(validTokens.email);

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

  return data(
    {
      settings: { ...mergedSettings, language: effectiveLanguage },
      hasApiKey: !!validTokens.geminiApiKey,
      maskedKey: validTokens.geminiApiKey ? maskApiKey(validTokens.geminiApiKey) : null,
      hasHubworkScopes,
      rootFolderId: validTokens.rootFolderId,
      enterprise,
      hasOrganizations,
      showEnterpriseTab,
      enterpriseError: showEnterpriseTab ? enterpriseError : null,
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
        // GeneralTab hides the whole Gemini block (the model <select> included)
        // on an organization mount, so an absent field means "not editable
        // here", not "cleared". Without the fallback, saving any other General
        // setting from an org mount would silently reset the user's chosen
        // model to the plan default below.
        const selectedModel = formData.has("selectedModel")
          ? normalizeDeprecatedModelName(formData.get("selectedModel")) ?? null
          : normalizeDeprecatedModelName(currentSettings.selectedModel) ?? null;
        const systemPrompt = (formData.get("systemPrompt") as string) || "";
        // Password managers may autofill the API-key password input when the user
        // only intends to save another setting (for example, the default model).
        // For an existing setup, only treat the field as an API-key change after
        // the user explicitly edited it in this form.
        const apiKeyEdited = formData.get("apiKeyEdited") === "true";
        const geminiApiKey = resolveSubmittedGeminiApiKey(
          formData.get("geminiApiKey"),
          !!currentSettings.encryptedApiKey,
          apiKeyEdited,
        );
        const language = (formData.get("language") as Language) || currentSettings.language;
        const fontSize = Number(formData.get("fontSize")) as FontSize || currentSettings.fontSize;
        const theme = (formData.get("theme") as Theme) || currentSettings.theme || "system";
        const showManagementFolders = formData.get("showManagementFolders") === "on";
        const dashboardEnabled = formData.get("dashboardEnabled") === "on";
        const workflowEnabled = formData.get("workflowEnabled") === "on";
        const ragFeatureEnabled = formData.get("ragFeatureEnabled") === "on";
        const webpageBuilderEnabled = formData.get("webpageBuilderEnabled") === "on";
        // Same absent-vs-cleared distinction as selectedModel above: the whole
        // AI provider block is hidden on an org mount, so a missing field
        // means "not editable here". Reading it as false would turn personal
        // Vertex off every time an org member saved an unrelated setting.
        const usePersonalVertex = formData.has("usePersonalVertex")
          ? formData.get("usePersonalVertex") === "on"
          : currentSettings.usePersonalVertex === true;

        // Encryption-related fields
        const password = (formData.get("password") as string)?.trim() || "";
        const confirmPassword = (formData.get("confirmPassword") as string)?.trim() || "";
        const currentPassword = (formData.get("currentPassword") as string)?.trim() || "";
        const newPassword = (formData.get("newPassword") as string)?.trim() || "";
        const encryptChatHistory = formData.get("encryptChatHistory") === "on";
        const encryptWorkflowHistory = formData.get("encryptWorkflowHistory") === "on";

        // The Gemini API key is OPTIONAL: an organization project runs on the
        // tenant's Vertex AI, and a user may only want the editor, dashboard,
        // or sync. A password is required only when a key is actually being
        // stored, because the key is kept encrypted at rest.
        if (!currentSettings.encryptedApiKey && geminiApiKey && !password) {
          return jsonWithCookie({ success: false, message: "passwordRequiredError" });
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
          dashboardEnabled,
          workflowEnabled,
          ragFeatureEnabled,
          webpageBuilderEnabled,
          usePersonalVertex,
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
              if (hwAccount && (hwAccount.plan === "business" || hwAccount.plan === "granted")) {
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
        const okfRoot = ((formData.get("okfRoot") as string) || "").trim().replace(/^\/+|\/+$/g, "") || "Knowledge";

        const updatedSettings: UserSettings = {
          ...currentSettings,
          ragEnabled,
          ragTopK,
          ragSettings,
          selectedRagSetting,
          ragRegistrationOnPush,
          okfRoot,
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
          model: normalizeDeprecatedModelName(cmd.model),
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
        let account: Awaited<ReturnType<typeof import("~/services/hubwork-accounts.server").getAccountByRootFolderId>> = null;
        try {
          const { getAccountByRootFolderId, getAccountByEmail } = await import("~/services/hubwork-accounts.server");
          account = await getAccountByRootFolderId(validTokens.rootFolderId);
          if (!account && validTokens.email) {
            account = await getAccountByEmail(validTokens.email);
          }
        } catch (error) {
          console.warn("[settings] Failed to load Hubwork account for migration token:", describeError(error));
          return jsonWithCookie({ success: false, message: "Could not verify Premium plan for external sync tokens." }, { status: 503 });
        }
        // A member of a Business organization is covered by the organization's
        // subscription: the entitlement follows the workspace they work in,
        // not a personal Hubwork account they were never asked to buy.
        let entitled = !!account && isActivePremiumAccount(account);
        if (!entitled && validTokens.currentOrgId && validTokens.currentProjectId) {
          try {
            const { getAccountByProject } = await import("~/services/hubwork-accounts.server");
            const orgAccount = await getAccountByProject(
              validTokens.currentOrgId,
              validTokens.currentProjectId,
            );
            entitled = !!orgAccount && isActivePremiumAccount(orgAccount);
          } catch (error) {
            console.warn("[settings] Failed to check the organization's plan:", describeError(error));
          }
        }
        if (!entitled) {
          return jsonWithCookie({ success: false, message: "A Premium plan is required to generate external sync tokens." }, { status: 403 });
        }

        // Generate external sync token (XOR-encoded accessToken + rootFolderId)
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
          if (hubworkAccount && (hubworkAccount.plan === "business" || hubworkAccount.plan === "granted")) {
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

      case "saveHomeDashboard": {
        const homeDashboard = (formData.get("homeDashboard") as string) || null;
        const updatedSettings: UserSettings = {
          ...currentSettings,
          homeDashboard,
        };
        await saveSettings(validTokens.accessToken, validTokens.rootFolderId, updatedSettings);
        return jsonWithCookie({ success: true });
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
  const { settings, hasApiKey, maskedKey, hasHubworkScopes, rootFolderId, enterprise, hasOrganizations, showEnterpriseTab, enterpriseError } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

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
    const requestedTab = searchParams.get("tab");
    if (isSettingsTabId(requestedTab)) {
      setActiveTab(requestedTab);
    }
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
    <EnterpriseProvider
      selection={enterprise.selection}
      currentOrgId={enterprise.currentOrgId}
      currentProjectId={enterprise.currentProjectId}
      currentUserId={enterprise.uid}
      currentUserEmail={enterprise.email}
      hasOrganizations={hasOrganizations}
    >
    <I18nProvider language={currentLang}>
      <PluginProvider pluginConfigs={settings.plugins || []} language={currentLang} hasPremium={settings.hubwork?.plan === "business" || settings.hubwork?.plan === "granted"}>
        <SettingsTemplate
          settings={settings}
          hasApiKey={hasApiKey}
          maskedKey={maskedKey}
          hasHubworkScopes={hasHubworkScopes}
          rootFolderId={rootFolderId}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onBack={() => {
            const prev = document.referrer;
            if (prev && new URL(prev).origin === window.location.origin) {
              navigate(-1);
            } else {
              navigate("/");
            }
          }}
          onLanguageChange={setCurrentLang}
          hubworkCallback={hubworkCallback}
          showEnterpriseTab={showEnterpriseTab}
          enterpriseError={enterpriseError}
        />
      </PluginProvider>
    </I18nProvider>
    </EnterpriseProvider>
  );
}
