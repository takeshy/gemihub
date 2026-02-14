import type { Language } from "~/types/settings";

export interface TranslationStrings {
  // Common
  "common.save": string;
  "common.cancel": string;
  "common.settings": string;
  "common.logout": string;

  // Header
  "header.chat": string;
  "header.workflow": string;
  "header.files": string;
  "header.editor": string;
  "header.plugins": string;

  // Index - unauthenticated
  "index.title": string;
  "index.subtitle": string;
  "index.signIn": string;

  // Index - API key warning
  "index.apiKeyWarning": string;
  "index.apiKeyLocked": string;

  // MainViewer
  "mainViewer.welcome": string;
  "mainViewer.welcomeDescription": string;
  "mainViewer.retry": string;
  "mainViewer.loadError": string;
  "mainViewer.offlineNoCache": string;
  "mainViewer.saved": string;
  "mainViewer.saving": string;
  "mainViewer.preview": string;
  "mainViewer.wysiwyg": string;
  "mainViewer.raw": string;
  "mainViewer.diff": string;
  "mainViewer.diffTarget": string;

  // ChatPanel
  "chat.newChat": string;
  "chat.noHistory": string;
  "chat.confirmDelete": string;
  "chat.mcpToolsLabel": string;
  "chat.toolModeLockGemma": string;
  "chat.toolModeLockWebSearch": string;
  "chat.toolModeLockFlashLiteRag": string;
  "chat.toolModeLocked": string;

  "chat.saveToDrive": string;
  "chat.savedToDrive": string;

  // Settings page
  "settings.title": string;
  "settings.tab.general": string;
  "settings.tab.mcp": string;
  "settings.tab.rag": string;
  // General tab
  "settings.general.apiKey": string;
  "settings.general.apiKeyPlaceholder": string;
  "settings.general.apiKeyKeep": string;
  "settings.general.apiPlan": string;
  "settings.general.paid": string;
  "settings.general.free": string;
  "settings.general.defaultModel": string;
  "settings.general.usePlanDefault": string;
  "settings.general.systemPrompt": string;
  "settings.general.systemPromptPlaceholder": string;
  "settings.general.language": string;
  "settings.general.fontSize": string;
  "settings.general.theme": string;

  // MCP tab
  "settings.mcp.noServers": string;
  "settings.mcp.addServer": string;
  "settings.mcp.name": string;
  "settings.mcp.url": string;
  "settings.mcp.headers": string;

  "settings.mcp.add": string;
  "settings.mcp.testAndAdd": string;
  "settings.mcp.tools": string;
  "settings.mcp.save": string;
  "settings.mcp.oauthAuthenticated": string;
  "settings.mcp.oauthAuthenticating": string;
  "settings.mcp.oauthSuccess": string;
  "settings.mcp.oauthFailed": string;
  "settings.mcp.oauthReauthorize": string;

  // RAG tab
  "settings.rag.enable": string;
  "settings.rag.topK": string;
  "settings.rag.topKDescription": string;
  "settings.rag.settings": string;
  "settings.rag.pendingCount": string;
  "settings.rag.enableAutoRag": string;
  "settings.rag.registerAndSync": string;
  "settings.rag.autoLabel": string;
  "settings.rag.autoRagModalTitle": string;
  "settings.rag.autoRagModalExcludeNote": string;
  "settings.rag.autoRagAllFiles": string;
  "settings.rag.autoRagAllFilesDescription": string;
  "settings.rag.autoRagCustomize": string;
  "settings.rag.autoRagCustomizeDescription": string;
  "settings.rag.fileCount": string;
  "settings.rag.fileCountPending": string;
  "settings.rag.filesDialogTitle": string;
  "settings.rag.filterPlaceholder": string;
  "settings.rag.filterAll": string;
  "settings.rag.filterRegistered": string;
  "settings.rag.filterPending": string;
  "settings.rag.excludePatternHint": string;
  "settings.rag.invalidExcludePattern": string;
  "settings.rag.applyAndSync": string;
  "settings.rag.noFiles": string;
  "settings.rag.reloadConfirm": string;

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": string;
  "settings.encryption.encryptWorkflow": string;
  "settings.encryption.reset": string;
  "settings.encryption.resetWarning": string;
  "settings.encryption.confirmReset": string;

  // Password / API Key encryption
  "settings.general.password": string;
  "settings.general.confirmPassword": string;
  "settings.general.currentPassword": string;
  "settings.general.newPassword": string;
  "settings.general.changePassword": string;
  "settings.general.encryptionSection": string;
  "settings.general.passwordRequired": string;
  "settings.general.wrongCurrentPassword": string;
  "settings.general.passwordMismatch": string;
  "settings.general.passwordMinLength": string;
  "settings.general.apiKeyPasswordSection": string;
  "settings.general.configured": string;

  // Unlock dialog
  "unlock.title": string;
  "unlock.description": string;
  "unlock.submit": string;
  "unlock.error": string;

  // Edit History (in Sync tab)
  "settings.editHistory.sectionTitle": string;
  "settings.editHistory.prune": string;
  "settings.editHistory.pruneConfirm": string;
  "settings.editHistory.pruneLabel": string;
  "settings.editHistory.pruneDescription": string;
  "settings.editHistory.pruneResult": string;
  "settings.editHistory.pruneResultNone": string;
  "settings.editHistory.stats": string;
  "settings.editHistory.statsLabel": string;
  "settings.editHistory.statsDescription": string;

  // History Modal / Context menu
  "editHistory.title": string;
  "editHistory.noHistory": string;
  "editHistory.clearAll": string;
  "editHistory.close": string;
  "editHistory.menuLabel": string;
  "editHistory.confirmClearAll": string;
  "editHistory.confirmRestore": string;
  "editHistory.restore": string;
  "editHistory.saveAs": string;
  "editHistory.saveAsName": string;
  "editHistory.save": string;
  "editHistory.restoreFailed": string;
  "editHistory.showRemote": string;

  // Context menu
  "contextMenu.rename": string;
  "contextMenu.download": string;
  "contextMenu.tempDownload": string;
  "contextMenu.tempDownloadConfirm": string;
  "contextMenu.tempUpload": string;
  "contextMenu.tempUploaded": string;
  "contextMenu.tempUrlCopied": string;
  "contextMenu.tempEditUrlConfirm": string;
  "contextMenu.noTempFile": string;
  "contextMenu.clearCache": string;
  "contextMenu.clearCacheModified": string;
  "contextMenu.clearCacheSkipModified": string;
  "contextMenu.publish": string;
  "contextMenu.unpublish": string;
  "contextMenu.copyLink": string;
  "contextMenu.published": string;
  "contextMenu.unpublished": string;
  "contextMenu.linkCopied": string;
  "contextMenu.publishFailed": string;
  "contextMenu.unpublishFailed": string;
  "contextMenu.fileAlreadyExists": string;
  "contextMenu.duplicate": string;
  "contextMenu.convertToPdf": string;
  "contextMenu.convertedPdf": string;
  "contextMenu.convertPdfFailed": string;
  "contextMenu.convertToHtml": string;
  "contextMenu.convertedHtml": string;
  "contextMenu.convertHtmlFailed": string;

  // Temp files
  "settings.general.tempFiles": string;
  "settings.general.tempFilesDescription": string;
  "settings.general.manageTempFiles": string;

  // Sync tab
  "settings.tab.sync": string;
  "settings.sync.status": string;
  "settings.sync.lastUpdatedAt": string;
  "settings.sync.notSynced": string;
  "settings.sync.dataManagement": string;
  "settings.sync.conflictResolution": string;
  "settings.sync.conflictFolder": string;
  "settings.sync.clearConflicts": string;
  "settings.sync.clearConflictsConfirm": string;
  "settings.sync.clearConflictsDescription": string;
  "settings.sync.conflictsCleared": string;
  "settings.sync.fullSyncOps": string;
  "settings.sync.fullPush": string;
  "settings.sync.fullPushDescription": string;
  "settings.sync.fullPushConfirm": string;
  "settings.sync.fullPull": string;
  "settings.sync.fullPullDescription": string;
  "settings.sync.fullPullConfirm": string;
  "settings.sync.tempFiles": string;
  "settings.sync.manageTempFiles": string;
  "settings.sync.untrackedFiles": string;
  "settings.sync.untrackedDescription": string;
  "settings.sync.detectUntracked": string;
  "settings.sync.noUntracked": string;
  "settings.sync.deleteSelected": string;
  "settings.sync.restoreSelected": string;
  "settings.sync.save": string;
  "settings.sync.pushRejected": string;
  "settings.sync.rebuildTree": string;
  "settings.sync.rebuildTreeDescription": string;
  "settings.sync.rebuild": string;
  "settings.sync.dangerZone": string;
  "settings.sync.dangerZoneDescription": string;

  // Temp diff modal
  "tempDiff.title": string;
  "tempDiff.noDiff": string;
  "tempDiff.binaryCompare": string;
  "tempDiff.currentFile": string;
  "tempDiff.tempFile": string;
  "tempDiff.accept": string;
  "tempDiff.reject": string;
  "tempFiles.title": string;
  "tempFiles.noFiles": string;
  "tempFiles.selectAll": string;
  "tempFiles.downloadSelected": string;
  "tempFiles.deleteSelected": string;
  "tempFiles.confirmDelete": string;
  "tempFiles.savedAt": string;
  "tempFiles.binaryConfirmTitle": string;
  "tempFiles.binaryConfirmMessage": string;
  "tempFiles.binaryConfirmApply": string;
  "tempFiles.binaryConfirmCancel": string;

  // Encrypted file viewer
  "crypt.enterPassword": string;
  "crypt.enterPasswordDesc": string;
  "crypt.passwordPlaceholder": string;
  "crypt.unlock": string;
  "crypt.decrypting": string;
  "crypt.wrongPassword": string;
  "crypt.encrypt": string;
  "crypt.encrypting": string;
  "crypt.decrypt": string;
  "crypt.decryptConfirm": string;
  "crypt.decryptFailed": string;
  "crypt.decryptDuplicate": string;
  "crypt.encryptEmptyFile": string;
  "crypt.notConfigured": string;

  // Plugins tab
  "settings.tab.plugins": string;
  "plugins.addPlugin": string;
  "plugins.repoPlaceholder": string;
  "plugins.install": string;
  "plugins.installSuccess": string;
  "plugins.installedPlugins": string;
  "plugins.noPlugins": string;
  "plugins.enable": string;
  "plugins.disable": string;
  "plugins.update": string;
  "plugins.updated": string;
  "plugins.uninstall": string;
  "plugins.uninstalled": string;
  "plugins.confirmUninstall": string;
  "plugins.invalidRepo": string;
  "plugins.settings": string;
  "plugins.reloadConfirm": string;

  // Commands tab
  "settings.tab.commands": string;
  "settings.commands.noCommands": string;
  "settings.commands.addCommand": string;
  "settings.commands.name": string;
  "settings.commands.description": string;
  "settings.commands.promptTemplate": string;
  "settings.commands.promptHelp": string;
  "settings.commands.modelOverride": string;
  "settings.commands.noOverride": string;
  "settings.commands.searchSetting": string;
  "settings.commands.driveToolMode": string;
  "settings.commands.mcpServers": string;
  "settings.commands.add": string;
  "settings.commands.update": string;
  "settings.commands.edit": string;
  "settings.commands.delete": string;

  // File tree - new file dialog
  "fileTree.newFile": string;
  "fileTree.fileName": string;
  "fileTree.fileNamePlaceholder": string;
  "fileTree.fileNameDefault": string;
  "fileTree.extension": string;
  "fileTree.customExt": string;
  "fileTree.create": string;
  "fileTree.cancel": string;

  // Search
  "search.title": string;
  "search.placeholder": string;
  "search.ragPlaceholder": string;
  "search.searching": string;
  "search.noResults": string;
  "search.resultCount": string;
  "search.error": string;
  "search.backToFiles": string;
  "search.ragMode": string;
  "search.driveMode": string;
  "search.localMode": string;
  "search.localNote": string;
  "search.modelLabel": string;
  "settings.rag.searchTip": string;

  // Quick Open
  "quickOpen.placeholder": string;
  "quickOpen.noResults": string;
  "quickOpen.selectFile": string;

  // Workflow
  "workflow.pushRequired": string;
  "workflow.referenceHistory": string;
  "workflow.historySelect.title": string;
  "workflow.historySelect.recentExecutions": string;
  "workflow.historySelect.steps": string;
  "workflow.historySelect.selectRunToView": string;
  "workflow.historySelect.includeAll": string;
  "workflow.historySelect.includeSelected": string;
  "workflow.historySelect.stepsSelected": string;
  "workflow.historySelect.skipped": string;
  "workflow.historySelect.error": string;

  // Trash & Conflicts
  "settings.sync.trashTitle": string;
  "settings.sync.trashDescription": string;
  "settings.sync.conflictsTitle": string;
  "settings.sync.conflictsDescription": string;
  "settings.sync.manage": string;
  "trash.tabTrash": string;
  "trash.tabConflicts": string;
  "trash.noFiles": string;
  "trash.noConflicts": string;
  "trash.permanentDelete": string;
  "trash.permanentDeleteConfirm": string;
  "trash.restore": string;
  "trash.restoreAs": string;
  "trash.selectAll": string;
  "trash.softDeleteConfirm": string;
  "trash.softDeleteFolderConfirm": string;
  "trash.conflictInfo": string;

  // Conflict dialog
  "conflict.title": string;
  "conflict.description": string;
  "conflict.keepLocal": string;
  "conflict.keepRemote": string;
  "conflict.local": string;
  "conflict.remote": string;
  "conflict.unknownTime": string;
  "conflict.resolveAll": string;
  "conflict.resolving": string;
  "conflict.close": string;
  "conflict.diff": string;
  "conflict.hideDiff": string;
  "conflict.diffError": string;
  "conflict.backupNote": string;

  // Sync diff dialog
  "sync.pushLabel": string;
  "sync.pullLabel": string;
  "sync.pushChanges": string;
  "sync.pullChanges": string;
  "sync.pushDirection": string;
  "sync.pullDirection": string;
  "sync.openFile": string;
  "sync.noDiff": string;

  // Shortcuts tab
  "settings.tab.shortcuts": string;
  "settings.shortcuts.noShortcuts": string;
  "settings.shortcuts.addShortcut": string;
  "settings.shortcuts.action": string;
  "settings.shortcuts.key": string;
  "settings.shortcuts.ctrlOrMeta": string;
  "settings.shortcuts.shift": string;
  "settings.shortcuts.alt": string;
  "settings.shortcuts.pressKey": string;
  "settings.shortcuts.actionExecuteWorkflow": string;
  "settings.shortcuts.duplicate": string;
  "settings.shortcuts.requireModifier": string;
  "settings.shortcuts.builtinConflict": string;
  "settings.shortcuts.targetWorkflow": string;
  "settings.shortcuts.selectWorkflow": string;
  "settings.shortcuts.save": string;

  // Offline
  "offline.indicator": string;
  "offline.banner": string;
}

const en: TranslationStrings = {
  // Common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.settings": "Settings",
  "common.logout": "Logout",

  // Header
  "header.chat": "Chat",
  "header.workflow": "Workflow",
  "header.files": "Files",
  "header.editor": "Editor",
  "header.plugins": "Plugins",

  // Index
  "index.title": "GemiHub",
  "index.subtitle": "Build and execute AI-powered workflows visually",
  "index.signIn": "Sign in with Google",
  "index.apiKeyWarning": "Gemini API key is not set. AI features will not work.",
  "index.apiKeyLocked": "Gemini API key is locked. Enter your password to unlock.",

  // MainViewer
  "mainViewer.welcome": "Welcome to GemiHub",
  "mainViewer.welcomeDescription": "Select a file from the file tree to start editing, or create a new workflow or file using the buttons above.",
  "mainViewer.retry": "Retry",
  "mainViewer.loadError": "Failed to load file",
  "mainViewer.offlineNoCache": "This file is not available offline. Please sync while online to cache it.",
  "mainViewer.saved": "Saved",
  "mainViewer.saving": "Saving...",
  "mainViewer.preview": "Preview",
  "mainViewer.wysiwyg": "WYSIWYG",
  "mainViewer.raw": "Raw",
  "mainViewer.diff": "Diff",
  "mainViewer.diffTarget": "Select file to compare",

  // ChatPanel
  "chat.newChat": "New Chat",
  "chat.noHistory": "No chat history",
  "chat.confirmDelete": "Delete this chat?",
  "chat.mcpToolsLabel": "MCP Tools",
  "chat.toolModeLockGemma": "Gemma models don't support function calling",
  "chat.toolModeLockWebSearch": "Drive tools are disabled during Web Search",
  "chat.toolModeLockFlashLiteRag": "Drive tools are disabled when Flash Lite uses RAG",
  "chat.toolModeLocked": "Auto (locked)",

  "chat.saveToDrive": "Save to Drive",
  "chat.savedToDrive": "Saved to Drive",

  // Settings
  "settings.title": "Settings",
  "settings.tab.general": "General",
  "settings.tab.mcp": "MCP Servers",
  "settings.tab.rag": "RAG",

  // General tab
  "settings.general.apiKey": "Gemini API Key",
  "settings.general.apiKeyPlaceholder": "AIza...",
  "settings.general.apiKeyKeep": "Leave blank to keep current key",
  "settings.general.apiPlan": "API Plan",
  "settings.general.paid": "Paid",
  "settings.general.free": "Free",
  "settings.general.defaultModel": "Default Model",
  "settings.general.usePlanDefault": "Use plan default",
  "settings.general.systemPrompt": "System Prompt",
  "settings.general.systemPromptPlaceholder": "Optional system-level instructions for the AI...",
  "settings.general.language": "Language",
  "settings.general.fontSize": "Font Size",
  "settings.general.theme": "Theme",

  // MCP tab
  "settings.mcp.noServers": "No MCP servers configured.",
  "settings.mcp.addServer": "Add Server",
  "settings.mcp.name": "Name",
  "settings.mcp.url": "URL",
  "settings.mcp.headers": "Headers (JSON)",

  "settings.mcp.add": "Add",
  "settings.mcp.testAndAdd": "Test & Add",
  "settings.mcp.tools": "Tools: {{tools}}",
  "settings.mcp.save": "Save MCP Settings",
  "settings.mcp.oauthAuthenticated": "Authenticated",
  "settings.mcp.oauthAuthenticating": "Authenticating...",
  "settings.mcp.oauthSuccess": "OAuth authentication successful",
  "settings.mcp.oauthFailed": "OAuth authentication failed: {{error}}",
  "settings.mcp.oauthReauthorize": "Re-authorize",

  // RAG tab
  "settings.rag.enable": "Enable RAG (Retrieval-Augmented Generation)",
  "settings.rag.topK": "Top-K results",
  "settings.rag.topKDescription": "Number of document chunks retrieved from the RAG store per query. Higher values provide more context but use more tokens.",
  "settings.rag.settings": "RAG Settings",
  "settings.rag.pendingCount": "{count} file(s) pending RAG registration",
  "settings.rag.enableAutoRag": "Enable Auto RAG Registration",
  "settings.rag.registerAndSync": "Register & Sync",
  "settings.rag.autoLabel": "Auto",
  "settings.rag.autoRagModalTitle": "Auto RAG Registration",
  "settings.rag.autoRagModalExcludeNote": "System files (_sync-meta.json, settings.json, etc.), history files (chat history, workflow history), and encrypted files are automatically excluded in both modes.",
  "settings.rag.autoRagAllFiles": "All files (Recommended)",
  "settings.rag.autoRagAllFilesDescription": "Register all eligible files in the RAG store and start sync immediately.",
  "settings.rag.autoRagCustomize": "Customize folders",
  "settings.rag.autoRagCustomizeDescription": "Configure target folders and exclude patterns before syncing.",
  "settings.rag.fileCount": "{registered} / {total}",
  "settings.rag.fileCountPending": "(pending: {count})",
  "settings.rag.filesDialogTitle": "RAG Files — {name}",
  "settings.rag.filterPlaceholder": "Filter by filename…",
  "settings.rag.filterAll": "All",
  "settings.rag.filterRegistered": "Registered",
  "settings.rag.filterPending": "Pending",
  "settings.rag.excludePatternHint": "Regex supported. e.g. \\.copy\\., _backup, ^temp/",
  "settings.rag.invalidExcludePattern": "Invalid exclude pattern regex: {pattern}",
  "settings.rag.applyAndSync": "Apply & Sync",
  "settings.rag.noFiles": "No files found.",
  "settings.rag.reloadConfirm": "RAG registration complete. Reload to enable RAG search?",

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": "Encrypt Chat History",
  "settings.encryption.encryptWorkflow": "Encrypt Workflow History",
  "settings.encryption.reset": "Reset encryption keys...",
  "settings.encryption.resetWarning": "This will remove all encryption keys. Encrypted data will become unreadable. Are you sure?",
  "settings.encryption.confirmReset": "Confirm Reset",

  // Password / API Key encryption
  "settings.general.password": "Password",
  "settings.general.confirmPassword": "Confirm Password",
  "settings.general.currentPassword": "Current Password",
  "settings.general.newPassword": "New Password",
  "settings.general.changePassword": "Change Password",
  "settings.general.encryptionSection": "File Encryption",
  "settings.general.passwordRequired": "Password is required to save API key",
  "settings.general.wrongCurrentPassword": "Current password is incorrect",
  "settings.general.passwordMismatch": "Passwords do not match",
  "settings.general.passwordMinLength": "Password must be at least 8 characters",
  "settings.general.apiKeyPasswordSection": "API Key & Password",
  "settings.general.configured": "API Key & Encryption configured.",

  // Unlock dialog
  "unlock.title": "Enter Password",
  "unlock.description": "Enter your password to decrypt the API key.",
  "unlock.submit": "Unlock",
  "unlock.error": "Incorrect password",

  // Edit History (in Sync tab)
  "settings.editHistory.sectionTitle": "Edit History",
  "settings.editHistory.prune": "Prune",
  "settings.editHistory.pruneConfirm": "Remove edit history entries older than the retention period?\nThis action cannot be undone.",
  "settings.editHistory.pruneLabel": "Prune Old Entries",
  "settings.editHistory.pruneDescription": "Remove entries older than {days} days or exceeding {max} entries per file.",
  "settings.editHistory.pruneResult": "Pruned {count} entries. ({total} remaining across {files} files)",
  "settings.editHistory.pruneResultNone": "No entries to prune. ({total} entries across {files} files, all within retention period)",
  "settings.editHistory.stats": "Stats",
  "settings.editHistory.statsLabel": "Storage Statistics",
  "settings.editHistory.statsDescription": "View edit history storage usage and entry counts.",

  // History Modal / Context menu
  "editHistory.title": "History",
  "editHistory.noHistory": "No history for this file",
  "editHistory.clearAll": "Clear All",
  "editHistory.close": "Close",
  "editHistory.menuLabel": "History",
  "editHistory.confirmClearAll": "Clear all history for this file?",
  "editHistory.confirmRestore": "Restore file to this point? Current content will be overwritten.",
  "editHistory.restore": "Restore",
  "editHistory.saveAs": "Save As",
  "editHistory.saveAsName": "File name",
  "editHistory.save": "Save",
  "editHistory.restoreFailed": "Failed to restore file.",
  "editHistory.showRemote": "Show Remote",

  // Context menu
  "contextMenu.rename": "Rename",
  "contextMenu.download": "Download",
  "contextMenu.tempDownload": "Temp DL",
  "contextMenu.tempDownloadConfirm": "Overwrite local file with temp file content?",
  "contextMenu.tempUpload": "Temp UP",
  "contextMenu.tempUploaded": "Uploaded",
  "contextMenu.tempUrlCopied": "Edit URL copied",
  "contextMenu.tempEditUrlConfirm": "Generate an edit URL so the file can be edited in other apps? (view: 30 min, edit: 1 day)",
  "contextMenu.noTempFile": "No temp file found for this file.",
  "contextMenu.clearCache": "Clear Cache",
  "contextMenu.clearCacheModified": "This file has unsaved changes that will be lost. Continue?",
  "contextMenu.clearCacheSkipModified": "Some files have unsaved changes that will be lost. Continue?",
  "contextMenu.publish": "Publish to Web",
  "contextMenu.unpublish": "Unpublish",
  "contextMenu.copyLink": "Copy Share Link",
  "contextMenu.published": "Published! Link copied to clipboard.",
  "contextMenu.unpublished": "File has been unpublished.",
  "contextMenu.linkCopied": "Link copied to clipboard.",
  "contextMenu.publishFailed": "Failed to publish file.",
  "contextMenu.unpublishFailed": "Failed to unpublish file.",
  "contextMenu.fileAlreadyExists": "\"{name}\" already exists. Overwrite?",
  "contextMenu.duplicate": "Duplicate",
  "contextMenu.convertToPdf": "Convert to PDF",
  "contextMenu.convertedPdf": "PDF created in temporaries/.",
  "contextMenu.convertPdfFailed": "Failed to convert file to PDF.",
  "contextMenu.convertToHtml": "Convert to HTML",
  "contextMenu.convertedHtml": "HTML created in temporaries/.",
  "contextMenu.convertHtmlFailed": "Failed to convert file to HTML.",

  // Temp files
  "settings.general.tempFiles": "Temporary Files",
  "settings.general.tempFilesDescription": "Manage temporary files saved to Drive before Push.",
  "settings.general.manageTempFiles": "Manage Temp Files",

  // Sync tab
  "settings.tab.sync": "Sync",
  "settings.sync.status": "Sync Status",
  "settings.sync.lastUpdatedAt": "Last updated at",
  "settings.sync.notSynced": "Not synced yet",
  "settings.sync.dataManagement": "Data Management",
  "settings.sync.conflictResolution": "Conflict Resolution",
  "settings.sync.conflictFolder": "Conflict Folder Name",
  "settings.sync.clearConflicts": "Clear Conflict Files",
  "settings.sync.clearConflictsConfirm": "Delete all files in the conflict folder?",
  "settings.sync.clearConflictsDescription": "Delete all conflict backup files from Drive.",
  "settings.sync.conflictsCleared": "Deleted {count} conflict file(s).",
  "settings.sync.fullSyncOps": "Full Sync Operations",
  "settings.sync.fullPush": "Full Push",
  "settings.sync.fullPushDescription": "Upload all cached files to Google Drive (overwrites remote).",
  "settings.sync.fullPushConfirm": "This will overwrite all remote files with local cache. Continue?",
  "settings.sync.fullPull": "Full Pull",
  "settings.sync.fullPullDescription": "Download all files from Google Drive (overwrites local cache).",
  "settings.sync.fullPullConfirm": "This will overwrite all local cache with remote files. Continue?",
  "settings.sync.tempFiles": "Temporary Files",
  "settings.sync.manageTempFiles": "Manage Temp Files",
  "settings.sync.untrackedFiles": "Untracked Remote Files",
  "settings.sync.untrackedDescription": "Find remote files not tracked in local cache.",
  "settings.sync.detectUntracked": "Detect",
  "settings.sync.noUntracked": "No untracked files found.",
  "settings.sync.deleteSelected": "Delete Selected",
  "settings.sync.restoreSelected": "Restore Selected",
  "settings.sync.save": "Save Sync Settings",
  "settings.sync.pushRejected": "Remote is newer. Pull first.",
  "settings.sync.rebuildTree": "Rebuild File Tree",
  "settings.sync.rebuildTreeDescription": "Re-scan Google Drive and rebuild the sync metadata. Use this if the file tree is out of sync.",
  "settings.sync.rebuild": "Rebuild",
  "settings.sync.dangerZone": "Danger Zone",
  "settings.sync.dangerZoneDescription": "These operations may cause data loss and cannot be undone.",

  // Temp diff modal
  "tempDiff.title": "Temp File Comparison",
  "tempDiff.noDiff": "No differences found.",
  "tempDiff.binaryCompare": "Binary file comparison",
  "tempDiff.currentFile": "Current file",
  "tempDiff.tempFile": "Temp file",
  "tempDiff.accept": "Accept",
  "tempDiff.reject": "Cancel",
  "tempFiles.title": "Temporary Files",
  "tempFiles.noFiles": "No temporary files found.",
  "tempFiles.selectAll": "Select All",
  "tempFiles.downloadSelected": "Download Selected",
  "tempFiles.deleteSelected": "Delete Selected",
  "tempFiles.confirmDelete": "Delete the selected temporary files?",
  "tempFiles.savedAt": "Saved at",
  "tempFiles.binaryConfirmTitle": "Binary File Update",
  "tempFiles.binaryConfirmMessage": "This will directly update the file on Google Drive. Continue?",
  "tempFiles.binaryConfirmApply": "Update Drive",
  "tempFiles.binaryConfirmCancel": "Cancel",

  // Encrypted file viewer
  "crypt.enterPassword": "Enter Password",
  "crypt.enterPasswordDesc": "This file is encrypted. Enter your password to view.",
  "crypt.passwordPlaceholder": "Password",
  "crypt.unlock": "Unlock",
  "crypt.decrypting": "Decrypting...",
  "crypt.wrongPassword": "Invalid password",
  "crypt.encrypt": "Encrypt",
  "crypt.encrypting": "Encrypting & uploading...",
  "crypt.decrypt": "Decrypt",
  "crypt.decryptConfirm": "Permanently decrypt this file? The .encrypted extension will be removed.",
  "crypt.decryptFailed": "Decryption failed",
  "crypt.decryptDuplicate": "\"{name}\" already exists. Rename or delete it before decrypting.",
  "crypt.encryptEmptyFile": "Cannot encrypt an empty file.",
  "crypt.notConfigured": "Encryption is not configured. Please set it up in Settings.",

  // Plugins tab
  "settings.tab.plugins": "Plugins",
  "plugins.addPlugin": "Add Plugin",
  "plugins.repoPlaceholder": "owner/repo or https://github.com/owner/repo",
  "plugins.install": "Install",
  "plugins.installSuccess": "Plugin installed successfully.",
  "plugins.installedPlugins": "Installed Plugins",
  "plugins.noPlugins": "No plugins installed.",
  "plugins.enable": "Enable",
  "plugins.disable": "Disable",
  "plugins.update": "Update",
  "plugins.updated": "Plugin updated successfully.",
  "plugins.uninstall": "Uninstall",
  "plugins.uninstalled": "Plugin uninstalled.",
  "plugins.confirmUninstall": "Uninstall this plugin? This will remove all plugin data.",
  "plugins.invalidRepo": "Invalid repository format. Use owner/repo.",
  "plugins.settings": "Settings",
  "plugins.reloadConfirm": "Reload to activate changes?",

  // Commands tab
  "settings.tab.commands": "Commands",
  "settings.commands.noCommands": "No slash commands configured.",
  "settings.commands.addCommand": "Add Command",
  "settings.commands.name": "Command Name",
  "settings.commands.description": "Description",
  "settings.commands.promptTemplate": "Prompt Template",
  "settings.commands.promptHelp": "Use {content} for current file content, {selection} for selected text, @filename for file references.",
  "settings.commands.modelOverride": "Model Override",
  "settings.commands.noOverride": "No override (use default)",
  "settings.commands.searchSetting": "Search Setting Override",
  "settings.commands.driveToolMode": "Drive Tool Mode Override",
  "settings.commands.mcpServers": "MCP Servers",
  "settings.commands.add": "Add",
  "settings.commands.update": "Update",
  "settings.commands.edit": "Edit",
  "settings.commands.delete": "Delete",

  // File tree - new file dialog
  "fileTree.newFile": "New File",
  "fileTree.fileName": "File name",
  "fileTree.fileNamePlaceholder": "",
  "fileTree.fileNameDefault": "Default: {name}",
  "fileTree.extension": "Extension",
  "fileTree.customExt": "Custom",
  "fileTree.create": "Create",
  "fileTree.cancel": "Cancel",

  // Search
  "search.title": "Search",
  "search.placeholder": "Enter search query...",
  "search.ragPlaceholder": "e.g. Which files describe the authentication flow?",
  "search.searching": "Searching...",
  "search.noResults": "No results found.",
  "search.resultCount": "{count} results found",
  "search.error": "Search failed. Please try again.",
  "search.backToFiles": "Back to Files",
  "search.ragMode": "RAG",
  "search.driveMode": "Drive",
  "search.localMode": "Local",
  "search.localNote": "Only cached files are searched.",
  "search.modelLabel": "Model",
  "settings.rag.searchTip": "When RAG is configured, file search (magnifying glass / Ctrl+Shift+F) defaults to semantic RAG search. You can also switch to Drive or Local search.",

  // Quick Open
  "quickOpen.placeholder": "Search files...",
  "quickOpen.noResults": "No matching files",
  "quickOpen.selectFile": "Select a file...",

  // Workflow
  "workflow.pushRequired": "Push to sync changes with server before executing",
  "workflow.referenceHistory": "Reference Execution History",
  "workflow.historySelect.title": "Select Execution Steps",
  "workflow.historySelect.recentExecutions": "Recent Executions",
  "workflow.historySelect.steps": "Steps",
  "workflow.historySelect.selectRunToView": "Select a run to view steps",
  "workflow.historySelect.includeAll": "Include All",
  "workflow.historySelect.includeSelected": "Include Selected",
  "workflow.historySelect.stepsSelected": "{count} step(s) selected",
  "workflow.historySelect.skipped": "Skipped",
  "workflow.historySelect.error": "Error",

  // Trash & Manage Files
  "settings.sync.trashTitle": "Trash",
  "settings.sync.trashDescription": "Restore or permanently delete trashed files.",
  "settings.sync.conflictsTitle": "Conflict Backups",
  "settings.sync.conflictsDescription": "Manage conflict backup files from sync resolution.",
  "settings.sync.manage": "Manage",
  "trash.tabTrash": "Trash",
  "trash.tabConflicts": "Conflicts",
  "trash.noFiles": "No files in trash.",
  "trash.noConflicts": "No conflict backups.",
  "trash.permanentDelete": "Permanently Delete",
  "trash.permanentDeleteConfirm": "Permanently delete the selected files? This cannot be undone.",
  "trash.restore": "Restore",
  "trash.restoreAs": "Restore as:",
  "trash.selectAll": "Select All",
  "trash.softDeleteConfirm": "Move \"{name}\" to trash?",
  "trash.softDeleteFolderConfirm": "Move all {count} file(s) in folder \"{name}\" to trash?",
  "trash.conflictInfo": "Conflict backups created during sync resolution.",

  // Conflict dialog
  "conflict.title": "Sync Conflicts ({count})",
  "conflict.description": "A conflict occurs when the same file has been modified both locally and on Drive since the last sync. Choose which version to keep for each file.",
  "conflict.keepLocal": "Keep Local",
  "conflict.keepRemote": "Keep Remote",
  "conflict.local": "Local",
  "conflict.remote": "Remote",
  "conflict.unknownTime": "unknown",
  "conflict.resolveAll": "Resolve All",
  "conflict.resolving": "Resolving...",
  "conflict.close": "Close",
  "conflict.diff": "Diff",
  "conflict.hideDiff": "Hide",
  "conflict.diffError": "Failed to load diff",
  "conflict.backupNote": "The overwritten version is backed up and can be restored from Settings > Sync > Conflict Backups.",

  // Sync diff dialog
  "sync.pushLabel": "Push to Drive",
  "sync.pullLabel": "Pull to Local",
  "sync.pushChanges": "Push Changes",
  "sync.pullChanges": "Pull Changes",
  "sync.pushDirection": "Local \u2192 Drive",
  "sync.pullDirection": "Drive \u2192 Local",
  "sync.openFile": "Open",
  "sync.noDiff": "Binary file",

  // Shortcuts tab
  "settings.tab.shortcuts": "Shortcuts",
  "settings.shortcuts.noShortcuts": "No shortcut keys configured.",
  "settings.shortcuts.addShortcut": "Add Shortcut",
  "settings.shortcuts.action": "Action",
  "settings.shortcuts.key": "Key",
  "settings.shortcuts.ctrlOrMeta": "Ctrl / Cmd",
  "settings.shortcuts.shift": "Shift",
  "settings.shortcuts.alt": "Alt",
  "settings.shortcuts.pressKey": "Press a key...",
  "settings.shortcuts.actionExecuteWorkflow": "Execute Workflow",
  "settings.shortcuts.duplicate": "This key combination is already assigned.",
  "settings.shortcuts.requireModifier": "Ctrl/Cmd or Alt modifier is required. Shift alone is not sufficient. Function keys (F1–F12) can be used alone.",
  "settings.shortcuts.builtinConflict": "This key combination is reserved by the application.",
  "settings.shortcuts.targetWorkflow": "Target Workflow",
  "settings.shortcuts.selectWorkflow": "Select a workflow…",
  "settings.shortcuts.save": "Save Shortcut Settings",

  // Offline
  "offline.indicator": "Offline",
  "offline.banner": "You are in offline mode. Some features are unavailable.",
};

const ja: TranslationStrings = {
  // Common
  "common.save": "保存",
  "common.cancel": "キャンセル",
  "common.settings": "設定",
  "common.logout": "ログアウト",

  // Header
  "header.chat": "チャット",
  "header.workflow": "ワークフロー",
  "header.files": "ファイル",
  "header.editor": "エディタ",
  "header.plugins": "プラグイン",

  // Index
  "index.title": "GemiHub",
  "index.subtitle": "AIワークフローをビジュアルに構築・実行",
  "index.signIn": "Googleでサインイン",
  "index.apiKeyWarning": "Gemini APIキーが設定されていません。AI機能は動作しません。",
  "index.apiKeyLocked": "Gemini APIキーはロックされています。パスワードを入力して解除してください。",

  // MainViewer
  "mainViewer.welcome": "GemiHubへようこそ",
  "mainViewer.welcomeDescription": "ファイルツリーからファイルを選択して編集を開始するか、上のボタンから新しいワークフローやファイルを作成してください。",
  "mainViewer.retry": "再試行",
  "mainViewer.loadError": "ファイルの読み込みに失敗しました",
  "mainViewer.offlineNoCache": "このファイルはオフラインでは利用できません。オンライン時に同期してキャッシュしてください。",
  "mainViewer.saved": "保存済み",
  "mainViewer.saving": "保存中...",
  "mainViewer.preview": "プレビュー",
  "mainViewer.wysiwyg": "WYSIWYG",
  "mainViewer.raw": "Raw",
  "mainViewer.diff": "比較",
  "mainViewer.diffTarget": "比較するファイルを選択",

  // ChatPanel
  "chat.newChat": "新しいチャット",
  "chat.noHistory": "チャット履歴はありません",
  "chat.confirmDelete": "このチャットを削除しますか？",
  "chat.mcpToolsLabel": "MCPツール",
  "chat.toolModeLockGemma": "Gemmaモデルはファンクションコールに対応していません",
  "chat.toolModeLockWebSearch": "Web Search中はDriveツールは無効です",
  "chat.toolModeLockFlashLiteRag": "Flash LiteでRAG使用時はDriveツールは無効です",
  "chat.toolModeLocked": "自動（ロック中）",

  "chat.saveToDrive": "Driveに保存",
  "chat.savedToDrive": "Drive保存済み",

  // Settings
  "settings.title": "設定",
  "settings.tab.general": "一般",
  "settings.tab.mcp": "MCPサーバー",
  "settings.tab.rag": "RAG",

  // General tab
  "settings.general.apiKey": "Gemini APIキー",
  "settings.general.apiKeyPlaceholder": "AIza...",
  "settings.general.apiKeyKeep": "現在のキーを保持する場合は空欄",
  "settings.general.apiPlan": "APIプラン",
  "settings.general.paid": "有料",
  "settings.general.free": "無料",
  "settings.general.defaultModel": "デフォルトモデル",
  "settings.general.usePlanDefault": "プランのデフォルトを使用",
  "settings.general.systemPrompt": "システムプロンプト",
  "settings.general.systemPromptPlaceholder": "AIへのシステムレベルの指示（任意）...",
  "settings.general.language": "言語",
  "settings.general.fontSize": "フォントサイズ",
  "settings.general.theme": "テーマ",

  // MCP tab
  "settings.mcp.noServers": "MCPサーバーは設定されていません。",
  "settings.mcp.addServer": "サーバーを追加",
  "settings.mcp.name": "名前",
  "settings.mcp.url": "URL",
  "settings.mcp.headers": "ヘッダー (JSON)",

  "settings.mcp.add": "追加",
  "settings.mcp.testAndAdd": "テスト＆追加",
  "settings.mcp.tools": "ツール: {{tools}}",
  "settings.mcp.save": "MCP設定を保存",
  "settings.mcp.oauthAuthenticated": "認証済み",
  "settings.mcp.oauthAuthenticating": "認証中...",
  "settings.mcp.oauthSuccess": "OAuth認証が成功しました",
  "settings.mcp.oauthFailed": "OAuth認証に失敗しました: {{error}}",
  "settings.mcp.oauthReauthorize": "再認証",

  // RAG tab
  "settings.rag.enable": "RAG（検索拡張生成）を有効にする",
  "settings.rag.topK": "Top-K 結果数",
  "settings.rag.topKDescription": "1回の質問でRAGストアから取得するドキュメント断片の数。多いほど文脈が豊富になりますが、トークン消費が増えます。",
  "settings.rag.settings": "RAG設定",
  "settings.rag.pendingCount": "{count}件のファイルがRAG登録待ちです",
  "settings.rag.enableAutoRag": "自動RAG登録を有効にする",
  "settings.rag.registerAndSync": "登録 & Sync",
  "settings.rag.autoLabel": "自動",
  "settings.rag.autoRagModalTitle": "自動RAG登録",
  "settings.rag.autoRagModalExcludeNote": "システム生成ファイル（_sync-meta.json, settings.json等）、履歴ファイル（チャット履歴、ワークフロー履歴）、暗号化ファイルはどちらのモードでも自動的に除外されます。",
  "settings.rag.autoRagAllFiles": "すべてのファイル（推奨）",
  "settings.rag.autoRagAllFilesDescription": "対象ファイルをすべてRAGストアに登録し、すぐに同期を開始します。",
  "settings.rag.autoRagCustomize": "カスタマイズ",
  "settings.rag.autoRagCustomizeDescription": "対象フォルダや除外パターンを設定してから同期します。",
  "settings.rag.fileCount": "{registered} / {total}",
  "settings.rag.fileCountPending": "（未登録: {count}）",
  "settings.rag.filesDialogTitle": "RAGファイル — {name}",
  "settings.rag.filterPlaceholder": "ファイル名で絞り込み…",
  "settings.rag.filterAll": "すべて",
  "settings.rag.filterRegistered": "登録済",
  "settings.rag.filterPending": "未登録",
  "settings.rag.excludePatternHint": "正規表現が使えます。例: \\.copy\\., _backup, ^temp/",
  "settings.rag.invalidExcludePattern": "除外パターンの正規表現が不正です: {pattern}",
  "settings.rag.applyAndSync": "適用 & 同期",
  "settings.rag.noFiles": "ファイルが見つかりません。",
  "settings.rag.reloadConfirm": "RAG登録が完了しました。リロードしてRAG検索を有効にしますか？",

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": "チャット履歴を暗号化",
  "settings.encryption.encryptWorkflow": "ワークフロー履歴を暗号化",
  "settings.encryption.reset": "暗号化キーをリセット...",
  "settings.encryption.resetWarning": "すべての暗号化キーが削除されます。暗号化されたデータは読み取れなくなります。よろしいですか？",
  "settings.encryption.confirmReset": "リセットを確認",

  // Password / API Key encryption
  "settings.general.password": "パスワード",
  "settings.general.confirmPassword": "パスワード確認",
  "settings.general.currentPassword": "現在のパスワード",
  "settings.general.newPassword": "新しいパスワード",
  "settings.general.changePassword": "パスワード変更",
  "settings.general.encryptionSection": "ファイル暗号化",
  "settings.general.passwordRequired": "APIキーの保存にはパスワードが必要です",
  "settings.general.wrongCurrentPassword": "現在のパスワードが正しくありません",
  "settings.general.passwordMismatch": "パスワードが一致しません",
  "settings.general.passwordMinLength": "パスワードは8文字以上である必要があります",
  "settings.general.apiKeyPasswordSection": "APIキー & パスワード",
  "settings.general.configured": "APIキーと暗号化が設定されています。",

  // Unlock dialog
  "unlock.title": "パスワードを入力",
  "unlock.description": "APIキーを復号するためにパスワードを入力してください。",
  "unlock.submit": "ロック解除",
  "unlock.error": "パスワードが正しくありません",

  // Edit History (in Sync tab)
  "settings.editHistory.sectionTitle": "編集履歴",
  "settings.editHistory.prune": "整理",
  "settings.editHistory.pruneConfirm": "保持期間を超えた編集履歴エントリを削除しますか？\nこの操作は元に戻せません。",
  "settings.editHistory.pruneLabel": "古いエントリを整理",
  "settings.editHistory.pruneDescription": "{days}日以上経過、またはファイルあたり{max}件を超えるエントリを削除します。",
  "settings.editHistory.pruneResult": "{count}件のエントリを削除しました。（{files}ファイル中 残り{total}件）",
  "settings.editHistory.pruneResultNone": "削除対象のエントリはありません。（{files}ファイル中 {total}件、すべて保持期間内）",
  "settings.editHistory.stats": "統計",
  "settings.editHistory.statsLabel": "ストレージ統計",
  "settings.editHistory.statsDescription": "編集履歴のストレージ使用量とエントリ数を表示します。",

  // History Modal / Context menu
  "editHistory.title": "履歴",
  "editHistory.noHistory": "このファイルの履歴はありません",
  "editHistory.clearAll": "すべてクリア",
  "editHistory.close": "閉じる",
  "editHistory.menuLabel": "履歴",
  "editHistory.confirmClearAll": "このファイルの履歴をすべてクリアしますか？",
  "editHistory.confirmRestore": "この時点に復元しますか？現在の内容は上書きされます。",
  "editHistory.restore": "復元",
  "editHistory.saveAs": "別名で保存",
  "editHistory.saveAsName": "ファイル名",
  "editHistory.save": "保存",
  "editHistory.restoreFailed": "ファイルの復元に失敗しました。",
  "editHistory.showRemote": "リモートを表示",

  // Context menu
  "contextMenu.rename": "名前を変更",
  "contextMenu.download": "ダウンロード",
  "contextMenu.tempDownload": "一時DL",
  "contextMenu.tempDownloadConfirm": "一時ファイルの内容でローカルを上書きしますか？",
  "contextMenu.tempUpload": "一時UP",
  "contextMenu.tempUploaded": "UP済",
  "contextMenu.tempUrlCopied": "編集URLをコピーしました",
  "contextMenu.tempEditUrlConfirm": "別アプリでも編集できるようURLを発行しますか？（閲覧30分、更新1日）",
  "contextMenu.noTempFile": "このファイルの一時ファイルが見つかりません。",
  "contextMenu.clearCache": "キャッシュクリア",
  "contextMenu.clearCacheModified": "未保存の変更がありますが、変更は失われます。続行しますか？",
  "contextMenu.clearCacheSkipModified": "未保存の変更があるファイルがありますが、変更は失われます。続行しますか？",
  "contextMenu.publish": "ウェブに公開",
  "contextMenu.unpublish": "公開を解除",
  "contextMenu.copyLink": "共有リンクをコピー",
  "contextMenu.published": "公開しました！リンクをクリップボードにコピーしました。",
  "contextMenu.unpublished": "公開を解除しました。",
  "contextMenu.linkCopied": "リンクをクリップボードにコピーしました。",
  "contextMenu.publishFailed": "ファイルの公開に失敗しました。",
  "contextMenu.unpublishFailed": "公開の解除に失敗しました。",
  "contextMenu.fileAlreadyExists": "「{name}」は既に存在します。上書きしますか？",
  "contextMenu.duplicate": "複製",
  "contextMenu.convertToPdf": "PDFに変換",
  "contextMenu.convertedPdf": "temporaries/ にPDFを作成しました。",
  "contextMenu.convertPdfFailed": "PDF変換に失敗しました。",
  "contextMenu.convertToHtml": "HTMLに変換",
  "contextMenu.convertedHtml": "temporaries/ にHTMLを作成しました。",
  "contextMenu.convertHtmlFailed": "HTML変換に失敗しました。",

  // Temp files
  "settings.general.tempFiles": "一時ファイル",
  "settings.general.tempFilesDescription": "Push前にDriveに保存された一時ファイルを管理します。",
  "settings.general.manageTempFiles": "一時ファイルを管理",

  // Sync tab
  "settings.tab.sync": "同期",
  "settings.sync.status": "同期ステータス",
  "settings.sync.lastUpdatedAt": "最終更新日時",
  "settings.sync.notSynced": "未同期",
  "settings.sync.dataManagement": "データ管理",
  "settings.sync.conflictResolution": "コンフリクト解決",
  "settings.sync.conflictFolder": "コンフリクトフォルダ名",
  "settings.sync.clearConflicts": "コンフリクトファイルを削除",
  "settings.sync.clearConflictsConfirm": "コンフリクトフォルダ内のすべてのファイルを削除しますか？",
  "settings.sync.clearConflictsDescription": "Driveのコンフリクトバックアップファイルをすべて削除します。",
  "settings.sync.conflictsCleared": "{count}件のコンフリクトファイルを削除しました。",
  "settings.sync.fullSyncOps": "完全同期操作",
  "settings.sync.fullPush": "完全Push",
  "settings.sync.fullPushDescription": "キャッシュされたすべてのファイルをGoogle Driveにアップロード（リモートを上書き）。",
  "settings.sync.fullPushConfirm": "すべてのリモートファイルをローカルキャッシュで上書きします。続行しますか？",
  "settings.sync.fullPull": "完全Pull",
  "settings.sync.fullPullDescription": "Google Driveからすべてのファイルをダウンロード（ローカルキャッシュを上書き）。",
  "settings.sync.fullPullConfirm": "すべてのローカルキャッシュをリモートファイルで上書きします。続行しますか？",
  "settings.sync.tempFiles": "一時ファイル",
  "settings.sync.manageTempFiles": "一時ファイルを管理",
  "settings.sync.untrackedFiles": "未追跡リモートファイル",
  "settings.sync.untrackedDescription": "ローカルキャッシュで追跡されていないリモートファイルを検出します。",
  "settings.sync.detectUntracked": "検出",
  "settings.sync.noUntracked": "未追跡ファイルは見つかりませんでした。",
  "settings.sync.deleteSelected": "選択を削除",
  "settings.sync.restoreSelected": "選択を復元",
  "settings.sync.save": "同期設定を保存",
  "settings.sync.pushRejected": "リモートが新しいです。先にPullしてください。",
  "settings.sync.rebuildTree": "ファイルツリーの再構築",
  "settings.sync.rebuildTreeDescription": "Google Driveを再スキャンして同期メタデータを再構築します。ファイルツリーが実際のDrive内容とズレた場合に使用してください。",
  "settings.sync.rebuild": "再構築",
  "settings.sync.dangerZone": "危険な操作",
  "settings.sync.dangerZoneDescription": "これらの操作はデータ損失を引き起こす可能性があり、元に戻せません。",

  // Temp diff modal
  "tempDiff.title": "一時ファイルの比較",
  "tempDiff.noDiff": "差分はありません。",
  "tempDiff.binaryCompare": "バイナリファイルの比較",
  "tempDiff.currentFile": "現在のファイル",
  "tempDiff.tempFile": "一時ファイル",
  "tempDiff.accept": "適用",
  "tempDiff.reject": "キャンセル",
  "tempFiles.title": "一時ファイル",
  "tempFiles.noFiles": "一時ファイルが見つかりません。",
  "tempFiles.selectAll": "すべて選択",
  "tempFiles.downloadSelected": "選択をダウンロード",
  "tempFiles.deleteSelected": "選択を削除",
  "tempFiles.confirmDelete": "選択した一時ファイルを削除しますか？",
  "tempFiles.savedAt": "保存日時",
  "tempFiles.binaryConfirmTitle": "バイナリファイルの更新",
  "tempFiles.binaryConfirmMessage": "このデータでGoogle Driveのファイルが直接更新されます。続行しますか？",
  "tempFiles.binaryConfirmApply": "Driveを更新",
  "tempFiles.binaryConfirmCancel": "キャンセル",

  // Encrypted file viewer
  "crypt.enterPassword": "パスワードを入力",
  "crypt.enterPasswordDesc": "このファイルは暗号化されています。パスワードを入力してください。",
  "crypt.passwordPlaceholder": "パスワード",
  "crypt.unlock": "解除",
  "crypt.decrypting": "復号中...",
  "crypt.wrongPassword": "パスワードが正しくありません",
  "crypt.encrypt": "暗号化",
  "crypt.encrypting": "暗号化＆アップロード中...",
  "crypt.decrypt": "暗号化解除",
  "crypt.decryptConfirm": "このファイルの暗号化を永続的に解除しますか？.encrypted拡張子が除去されます。",
  "crypt.decryptFailed": "暗号化解除に失敗しました",
  "crypt.decryptDuplicate": "「{name}」が既に存在します。暗号化解除する前にリネームまたは削除してください。",
  "crypt.encryptEmptyFile": "空のファイルは暗号化できません。",
  "crypt.notConfigured": "暗号化が未設定です。設定画面から暗号化を設定してください。",

  // Plugins tab
  "settings.tab.plugins": "プラグイン",
  "plugins.addPlugin": "プラグインを追加",
  "plugins.repoPlaceholder": "owner/repo または https://github.com/owner/repo",
  "plugins.install": "インストール",
  "plugins.installSuccess": "プラグインをインストールしました。",
  "plugins.installedPlugins": "インストール済みプラグイン",
  "plugins.noPlugins": "プラグインはインストールされていません。",
  "plugins.enable": "有効化",
  "plugins.disable": "無効化",
  "plugins.update": "更新",
  "plugins.updated": "プラグインを更新しました。",
  "plugins.uninstall": "アンインストール",
  "plugins.uninstalled": "プラグインをアンインストールしました。",
  "plugins.confirmUninstall": "このプラグインをアンインストールしますか？すべてのプラグインデータが削除されます。",
  "plugins.invalidRepo": "リポジトリの形式が無効です。owner/repo の形式で入力してください。",
  "plugins.settings": "設定",
  "plugins.reloadConfirm": "リロードして変更を反映しますか？",

  // Commands tab
  "settings.tab.commands": "コマンド",
  "settings.commands.noCommands": "スラッシュコマンドは設定されていません。",
  "settings.commands.addCommand": "コマンドを追加",
  "settings.commands.name": "コマンド名",
  "settings.commands.description": "説明",
  "settings.commands.promptTemplate": "プロンプトテンプレート",
  "settings.commands.promptHelp": "{content} で現在のファイル内容、{selection} で選択テキスト、@ファイル名 でファイル参照を使用できます。",
  "settings.commands.modelOverride": "モデル上書き",
  "settings.commands.noOverride": "上書きなし（デフォルトを使用）",
  "settings.commands.searchSetting": "検索設定の上書き",
  "settings.commands.driveToolMode": "Driveツールモードの上書き",
  "settings.commands.mcpServers": "MCPサーバー",
  "settings.commands.add": "追加",
  "settings.commands.update": "更新",
  "settings.commands.edit": "編集",
  "settings.commands.delete": "削除",

  // File tree - new file dialog
  "fileTree.newFile": "新規ファイル",
  "fileTree.fileName": "ファイル名",
  "fileTree.fileNamePlaceholder": "",
  "fileTree.fileNameDefault": "デフォルト: {name}",
  "fileTree.extension": "拡張子",
  "fileTree.customExt": "カスタム",
  "fileTree.create": "作成",
  "fileTree.cancel": "キャンセル",

  // Search
  "search.title": "検索",
  "search.placeholder": "検索キーワードを入力...",
  "search.ragPlaceholder": "例: 認証フローについて書かれたファイルはどれ？",
  "search.searching": "検索中...",
  "search.noResults": "結果が見つかりませんでした。",
  "search.resultCount": "{count}件の結果",
  "search.error": "検索に失敗しました。もう一度お試しください。",
  "search.backToFiles": "ファイル一覧に戻る",
  "search.ragMode": "RAG",
  "search.driveMode": "Drive",
  "search.localMode": "ローカル",
  "search.localNote": "キャッシュ済みファイルのみが検索対象です。",
  "search.modelLabel": "モデル",
  "settings.rag.searchTip": "RAGが設定されている場合、ファイル検索（虫めがね / Ctrl+Shift+F）はデフォルトでセマンティックRAG検索を使用します。Drive検索やローカル検索に切り替えることもできます。",

  // Quick Open
  "quickOpen.placeholder": "ファイルを検索...",
  "quickOpen.noResults": "一致するファイルがありません",
  "quickOpen.selectFile": "ファイルを選択...",

  // Workflow
  "workflow.pushRequired": "Pushしてサーバー側に反映しないと実行できません",
  "workflow.referenceHistory": "実行履歴を参照",
  "workflow.historySelect.title": "実行ステップを選択",
  "workflow.historySelect.recentExecutions": "実行履歴",
  "workflow.historySelect.steps": "ステップ",
  "workflow.historySelect.selectRunToView": "実行を選択してステップを表示",
  "workflow.historySelect.includeAll": "すべて含める",
  "workflow.historySelect.includeSelected": "選択を含める",
  "workflow.historySelect.stepsSelected": "{count}件のステップを選択中",
  "workflow.historySelect.skipped": "スキップ",
  "workflow.historySelect.error": "エラー",

  // Trash & Manage Files
  "settings.sync.trashTitle": "ゴミ箱",
  "settings.sync.trashDescription": "削除されたファイルの復元・完全削除を管理します。",
  "settings.sync.conflictsTitle": "コンフリクトバックアップ",
  "settings.sync.conflictsDescription": "同期コンフリクト解決時のバックアップファイルを管理します。",
  "settings.sync.manage": "管理",
  "trash.tabTrash": "ゴミ箱",
  "trash.tabConflicts": "コンフリクト",
  "trash.noFiles": "ゴミ箱にファイルはありません。",
  "trash.noConflicts": "コンフリクトバックアップはありません。",
  "trash.permanentDelete": "完全に削除",
  "trash.permanentDeleteConfirm": "選択したファイルを完全に削除しますか？この操作は元に戻せません。",
  "trash.restore": "復元",
  "trash.restoreAs": "復元名:",
  "trash.selectAll": "すべて選択",
  "trash.softDeleteConfirm": "「{name}」をゴミ箱に移動しますか？",
  "trash.softDeleteFolderConfirm": "フォルダ「{name}」内の{count}件のファイルをゴミ箱に移動しますか？",
  "trash.conflictInfo": "同期コンフリクト解決時に作成されたバックアップです。",

  // Conflict dialog
  "conflict.title": "同期コンフリクト ({count})",
  "conflict.description": "コンフリクトは、前回の同期以降に同じファイルがローカルと Drive の両方で変更された場合に発生します。各ファイルについて保持するバージョンを選択してください。",
  "conflict.keepLocal": "ローカルを保持",
  "conflict.keepRemote": "リモートを保持",
  "conflict.local": "ローカル",
  "conflict.remote": "リモート",
  "conflict.unknownTime": "不明",
  "conflict.resolveAll": "すべて解決",
  "conflict.resolving": "解決中...",
  "conflict.close": "閉じる",
  "conflict.diff": "差分",
  "conflict.hideDiff": "非表示",
  "conflict.diffError": "差分の読み込みに失敗しました",
  "conflict.backupNote": "上書きされたバージョンはバックアップされ、設定 > 同期 > コンフリクトバックアップから復元できます。",

  // Sync diff dialog
  "sync.pushLabel": "ドライブ反映",
  "sync.pullLabel": "ローカル反映",
  "sync.pushChanges": "ドライブ反映 — 変更一覧",
  "sync.pullChanges": "ローカル反映 — 変更一覧",
  "sync.pushDirection": "ローカル \u2192 ドライブ",
  "sync.pullDirection": "ドライブ \u2192 ローカル",
  "sync.openFile": "開く",
  "sync.noDiff": "バイナリファイル",

  // Shortcuts tab
  "settings.tab.shortcuts": "ショートカット",
  "settings.shortcuts.noShortcuts": "ショートカットキーは設定されていません。",
  "settings.shortcuts.addShortcut": "ショートカットを追加",
  "settings.shortcuts.action": "アクション",
  "settings.shortcuts.key": "キー",
  "settings.shortcuts.ctrlOrMeta": "Ctrl / Cmd",
  "settings.shortcuts.shift": "Shift",
  "settings.shortcuts.alt": "Alt",
  "settings.shortcuts.pressKey": "キーを押してください...",
  "settings.shortcuts.actionExecuteWorkflow": "ワークフロー実行",
  "settings.shortcuts.duplicate": "このキーの組み合わせは既に割り当てられています。",
  "settings.shortcuts.requireModifier": "Ctrl/Cmd または Alt 修飾キーが必要です。Shift のみでは不十分です。ファンクションキー（F1〜F12）は単独で使用できます。",
  "settings.shortcuts.builtinConflict": "このキーの組み合わせはアプリケーションで予約されています。",
  "settings.shortcuts.targetWorkflow": "対象ワークフロー",
  "settings.shortcuts.selectWorkflow": "ワークフローを選択…",
  "settings.shortcuts.save": "ショートカット設定を保存",

  // Offline
  "offline.indicator": "オフライン",
  "offline.banner": "オフラインモードです。一部の機能は利用できません。",
};

const translations: Record<Language, TranslationStrings> = { en, ja };

export function t(language: Language, key: keyof TranslationStrings): string {
  return translations[language]?.[key] ?? translations.en[key] ?? key;
}
