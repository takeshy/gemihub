import type { Language } from "~/types/settings";

export interface TranslationStrings {
  // Common
  "common.save": string;
  "common.cancel": string;
  "common.close": string;
  "common.ok": string;
  "common.settings": string;
  "common.logout": string;

  // Header
  "header.chat": string;
  "header.workflow": string;
  "header.files": string;
  "header.editor": string;
  "header.plugins": string;
  "header.manual": string;

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
  "chat.alwaysThinkLabel": string;
  "chat.thinkFlash": string;
  "chat.thinkFlashLite": string;
  "chat.toolModeLockGemma4WebSearch": string;
  "chat.toolModeLockWebSearch": string;
  "chat.toolModeLockRag": string;
  "chat.toolModeLocked": string;
  "chat.unpushWarning.title": string;
  "chat.unpushWarning.description": string;
  "chat.unpushWarning.sendAnyway": string;
  "chat.unpushWarning.cancel": string;

  "chat.saveToDrive": string;
  "chat.savedToDrive": string;

  // Compact
  "chat.compact": string;
  "chat.compacting": string;
  "chat.compacted": string;
  "chat.compactFailed": string;
  "chat.compactedContext": string;

  // Webpage-builder auto-review
  "chat.autoReview.pass": string;
  "chat.autoReview.fail": string;
  "chat.autoReview.issuesLabel": string;
  "chat.autoReview.autoFixing": string;
  "chat.autoReview.failed": string;
  "chat.autoReview.fixPrompt": string;

  // Welcome hints
  "chat.welcomeTitle": string;
  "chat.welcomeHint": string;
  "chat.welcomeThinking": string;
  "chat.welcomeImage": string;
  "chat.welcomeCompact": string;
  "chat.welcomeNewChat": string;
  "chat.welcomeBuilderTitle": string;
  "chat.welcomeBuilderHint": string;
  "chat.welcomeBuilderButton": string;
  "chat.welcomeBuilderLogin": string;
  "chat.welcomeBuilderCalendar": string;
  "chat.welcomeBuilderApi": string;

  // Message usage
  "message.tokens": string;
  "message.thinkingTokens": string;

  // Settings page
  "settings.title": string;
  "settings.tab.general": string;
  "settings.tab.mcp": string;
  "settings.tab.rag": string;
  // General tab
  "settings.general.apiKey": string;
  "settings.general.apiKeyGetLink": string;
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
  "settings.rag.addSetting": string;
  "settings.rag.noSettings": string;
  "settings.rag.copyStoreId": string;
  "settings.rag.external": string;
  "settings.rag.internal": string;
  "settings.rag.sync": string;
  "settings.rag.type": string;
  "settings.rag.typeInternal": string;
  "settings.rag.typeExternal": string;
  "settings.rag.storeIdsLabel": string;
  "settings.rag.targetFoldersLabel": string;
  "settings.rag.targetFoldersHint": string;
  "settings.rag.excludePatternsLabel": string;
  "settings.rag.syncSaveFailed": string;
  "settings.rag.syncFailed": string;
  "settings.rag.noResponseBody": string;
  "settings.rag.syncError": string;

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": string;
  "settings.encryption.encryptWorkflow": string;

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
  "settings.general.invalidApiKey": string;
  "settings.general.apiKeyRequired": string;
  "settings.general.passwordRequiredError": string;
  "settings.general.currentPasswordRequired": string;
  "settings.general.required": string;
  "settings.general.errorTitle": string;
  "settings.general.generalSaved": string;

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
  "contextMenu.tempEditUrlHint": string;
  "contextMenu.tempEditUrlYes": string;
  "contextMenu.tempEditUrlNo": string;
  "contextMenu.noTempFile": string;
  "contextMenu.clearCache": string;
  "contextMenu.clearCacheModified": string;
  "contextMenu.clearCacheSkipModified": string;
  "contextMenu.cacheFolder": string;
  "fileTree.cacheAll": string;
  "contextMenu.publish": string;
  "contextMenu.unpublish": string;
  "contextMenu.copyLink": string;
  "contextMenu.published": string;
  "contextMenu.unpublished": string;
  "contextMenu.linkCopied": string;
  "contextMenu.publishFailed": string;
  "contextMenu.unpublishFailed": string;
  "contextMenu.renameFailed": string;
  "contextMenu.bulkRenameConfirm": string;
  "contextMenu.bulkMoveConfirm": string;
  "contextMenu.duplicateFailed": string;
  "contextMenu.moveFailed": string;
  "contextMenu.fileAlreadyExists": string;
  "contextMenu.duplicate": string;
  "contextMenu.convertToPdf": string;
  "contextMenu.convertedPdf": string;
  "contextMenu.convertPdfFailed": string;
  "contextMenu.convertToHtml": string;
  "contextMenu.convertedHtml": string;
  "contextMenu.convertHtmlFailed": string;
  "contextMenu.downloadZip": string;
  "contextMenu.downloadZipFailed": string;

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
  "settings.sync.fullPushCompleted": string;
  "settings.sync.fullPushSkipped": string;
  "settings.sync.noCachedFiles": string;
  "settings.sync.noSyncEligibleFiles": string;
  "settings.sync.fullPushFailed": string;
  "settings.sync.fullPullCompleted": string;
  "settings.sync.fullPullFailed": string;
  "settings.sync.detectionFailed": string;
  "settings.sync.rebuildFailed": string;
  "settings.sync.rebuildCompleted": string;
  "settings.sync.pruneFailed": string;
  "settings.sync.pruneError": string;
  "settings.sync.failedToLoadStats": string;
  "sync.newFilesDetected": string;

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
  "plugins.installFailed": string;
  "plugins.toggleFailed": string;
  "plugins.updateFailed": string;
  "plugins.uninstallFailed": string;
  "plugins.localCannotUninstall": string;
  "plugins.localBadge": string;
  "plugins.permissionsTitle": string;
  "plugins.permissionsDescription": string;
  "plugins.permissionGemini": string;
  "plugins.permissionDrive": string;
  "plugins.permissionStorage": string;
  "plugins.permissionCalendar": string;
  "plugins.permissionGmail": string;
  "plugins.permissionSheets": string;
  "plugins.noPermissions": string;
  "plugins.confirmInstall": string;
  "plugins.cancelInstall": string;
  "plugins.previewFailed": string;
  "plugins.updateNewPermissions": string;
  "plugins.confirmUpdate": string;

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
  "fileTree.folderName": string;
  "fileTree.addDateTime": string;
  "fileTree.addLocation": string;
  "fileTree.selectedCount": string;
  "fileContent.dateTime": string;
  "fileContent.location": string;
  "fileContent.latitude": string;
  "fileContent.longitude": string;

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
  "workflow.nodeComment": string;
  "workflow.pushRequired": string;
  "workflow.retryFromHere": string;
  "workflow.retryFromError": string;
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
  "workflow.ai.createTitle": string;
  "workflow.ai.modifyTitle": string;
  "workflow.ai.workflowName": string;
  "workflow.ai.namePlaceholder": string;
  "workflow.ai.refineLabel": string;
  "workflow.ai.createLabel": string;
  "workflow.ai.modifyLabel": string;
  "workflow.ai.refinePlaceholder": string;
  "workflow.ai.createPlaceholder": string;
  "workflow.ai.modifyPlaceholder": string;
  "workflow.ai.model": string;
  "workflow.ai.generating": string;
  "workflow.ai.thinking": string;
  "workflow.ai.ctrlEnter": string;
  "workflow.ai.cancel": string;
  "workflow.ai.stop": string;
  "workflow.ai.regenerate": string;
  "workflow.ai.generate": string;
  "workflow.ai.emptyResponse": string;
  "workflow.ai.generationFailed": string;
  "workflow.ai.noResponseStream": string;
  "workflow.ai.generationError": string;
  "workflow.ai.copyPrompt": string;
  "workflow.ai.promptCopied": string;
  "workflow.ai.pasteLabel": string;
  "workflow.ai.pastePlaceholder": string;
  "workflow.ai.applyPasted": string;
  "workflow.ai.enterPastedYaml": string;
  "workflow.ai.parseFailed": string;
  "workflow.ai.createAsSkill": string;
  "workflow.ai.skillName": string;
  "workflow.ai.skillNamePlaceholder": string;
  "workflow.ai.createSkillTitle": string;
  "workflow.ai.modifySkillTitle": string;
  "workflow.ai.confirmSkillChanges": string;
  "workflow.ai.describeCreate": string;
  "workflow.ai.describeCreateSkill": string;
  "workflow.ai.placeholderCreateSkill": string;
  "workflow.ai.planning": string;
  "workflow.ai.reviewing": string;
  "workflow.ai.refining": string;
  "workflow.ai.phasePlan": string;
  "workflow.ai.phaseGenerate": string;
  "workflow.ai.phaseReview": string;
  "workflow.ai.planComplete": string;
  "workflow.ai.planReplan": string;
  "workflow.ai.planReplanPlaceholder": string;
  "workflow.ai.planOk": string;
  "workflow.ai.reviewApproved": string;
  "workflow.ai.reviewRefining": string;
  "workflow.ai.reviewComplete": string;
  "workflow.ai.refineBtn": string;
  "workflow.ai.refinePlaceholderReview": string;
  "workflow.ai.acceptWithIssuesConfirm": string;
  "workflow.ai.reviewVerdictPass": string;
  "workflow.ai.reviewVerdictFail": string;
  "workflow.ai.reviewSummary": string;
  "workflow.ai.reviewIssues": string;
  "workflow.ai.reviewNoIssues": string;
  "workflow.ai.severityHigh": string;
  "workflow.ai.severityMedium": string;
  "workflow.ai.severityLow": string;
  "workflow.ai.contextPlan": string;
  "workflow.ai.contextThinking": string;
  "workflow.ai.contextReview": string;
  "workflow.ai.noChanges": string;
  "workflow.ai.skillInstructionsChanges": string;
  "workflow.ai.workflowYamlChanges": string;
  "workflow.ai.autoRepair": string;
  "workflow.ai.parseFailureTitle": string;
  "workflow.ai.parseFailureHint": string;
  "workflow.ai.parseFailureCopy": string;
  "workflow.createWorkflowWithAI": string;
  "workflow.createSkillWithAI": string;
  "workflow.modifyWorkflowWithAI": string;
  "workflow.modifySkillWithAI": string;
  "workflow.createHintWorkflow": string;
  "workflow.createHintSkill": string;
  "workflow.skillNoInlineWorkflow": string;
  "workflow.tabLabel": string;
  "chat.openWorkflow": string;
  "chat.workflowErrorHint": string;
  "chat.skillsUsed": string;
  "chat.clickToOpen": string;
  "workflow.preview.previewPrefix": string;
  "workflow.preview.changesPrefix": string;
  "workflow.preview.defaultName": string;
  "workflow.preview.visual": string;
  "workflow.preview.yaml": string;
  "workflow.preview.diff": string;
  "workflow.preview.cancel": string;
  "workflow.preview.refine": string;
  "workflow.preview.accept": string;
  "workflow.preview.saving": string;
  "workflow.preview.parseFailed": string;
  "workflow.preview.noNodes": string;
  "workflow.preview.noDiff": string;
  "workflow.preview.skillMd": string;

  // Trash & Conflicts
  "settings.sync.trashTitle": string;
  "settings.sync.trashDescription": string;
  "settings.sync.conflictsTitle": string;
  "settings.sync.conflictsDescription": string;
  "settings.sync.manage": string;
  "settings.sync.migrationTool": string;
  "settings.sync.migrationToolDescription": string;
  "settings.sync.migrationTokenGenerate": string;
  "settings.sync.migrationTokenWarning": string;
  "settings.sync.migrationTokenFreeNotice": string;
  "settings.sync.backupTokenCopy": string;
  "settings.sync.backupTokenCopied": string;
  "settings.sync.backupTokenHide": string;
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
  "trash.bulkDeleteConfirm": string;
  "trash.permanentDeleteOption": string;
  "trash.permanentDeleteWarning": string;
  "trash.deleteFailed": string;
  "trash.restoreFailed": string;
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
  "conflict.editDeleteDescription": string;
  "conflict.deletedOnRemote": string;
  "conflict.acceptDeletion": string;

  // Sync diff dialog
  "sync.pushLabel": string;
  "sync.pullLabel": string;
  "sync.pushChanges": string;
  "sync.pullChanges": string;
  "sync.pushDirection": string;
  "sync.pullDirection": string;
  "sync.openFile": string;
  "sync.noDiff": string;
  "sync.encryptedNoDiff": string;
  "sync.conflictBadge": string;
  "sync.ignore": string;
  "sync.unignore": string;

  // Shortcuts tab
  "settings.tab.shortcuts": string;
  "settings.shortcuts.description": string;
  "settings.shortcuts.noShortcuts": string;
  "settings.shortcuts.addShortcut": string;
  "settings.shortcuts.pressKey": string;
  "settings.shortcuts.duplicate": string;
  "settings.shortcuts.requireModifier": string;
  "settings.shortcuts.builtinConflict": string;
  "settings.shortcuts.selectWorkflow": string;
  "settings.shortcuts.silent": string;
  "settings.shortcuts.silentDescription": string;
  "settings.shortcuts.executing": string;
  "settings.shortcuts.executionDone": string;
  "settings.shortcuts.executionError": string;

  // Hubwork tab
  "settings.tab.hubwork": string;
  "settings.hubwork.title": string;
  "settings.hubwork.domain": string;
  "settings.hubwork.domainPlaceholder": string;
  "settings.hubwork.domainProvision": string;
  "settings.hubwork.domainRemove": string;
  "settings.hubwork.domainStatus": string;
  "settings.hubwork.domainStatusActive": string;
  "settings.hubwork.domainStatusPendingDns": string;
  "settings.hubwork.domainStatusProvisioningCert": string;
  "settings.hubwork.domainStatusFailed": string;
  "settings.hubwork.domainDnsHeader": string;
  "settings.hubwork.domainDnsTypeLabel": string;
  "settings.hubwork.domainDnsNameLabel": string;
  "settings.hubwork.domainDnsValueLabel": string;
  "settings.hubwork.domainDnsPropagation": string;
  "settings.hubwork.domainCheckSsl": string;
  "settings.hubwork.domainCheckDns": string;
  "settings.hubwork.domainCheckRefresh": string;
  "settings.hubwork.domainDnsOk": string;
  "settings.hubwork.domainDnsMismatch": string;
  "settings.hubwork.domainDnsMissing": string;
  "settings.hubwork.domainDnsExpected": string;
  "settings.hubwork.domainDnsActual": string;
  "settings.hubwork.domainReady": string;
  "settings.hubwork.domainNotReady": string;
  "settings.hubwork.domainChecking": string;
  "settings.hubwork.schedules": string;
  "settings.hubwork.schedulesEmpty": string;
  "settings.hubwork.scheduleAdd": string;
  "settings.hubwork.scheduleWorkflow": string;
  "settings.hubwork.scheduleCron": string;
  "settings.hubwork.scheduleEnabled": string;
  "settings.hubwork.scheduleRemove": string;
  "settings.hubwork.subscription": string;
  "settings.hubwork.subscribeButton": string;
  "settings.hubwork.slugLabel": string;
  "settings.hubwork.slugRequired": string;
  "settings.hubwork.slugInvalid": string;
  "settings.hubwork.slugUnavailable": string;
  "settings.hubwork.siteUrl": string;
  "settings.hubwork.subscriptionActive": string;
  "settings.hubwork.subscriptionGranted": string;
  "settings.hubwork.manageSubscription": string;
  "settings.hubwork.subscriptionRequired": string;
  "settings.hubwork.accounts": string;
  "settings.hubwork.accountsEmpty": string;
  "settings.hubwork.accountAdd": string;
  "settings.hubwork.accountTypeNamePlaceholder": string;
  "settings.hubwork.identitySheet": string;
  "settings.hubwork.identityEmailColumn": string;
  "settings.hubwork.dataSources": string;
  "settings.hubwork.dataSourceAdd": string;
  "settings.hubwork.dataSourceKey": string;
  "settings.hubwork.dataSourceSheet": string;
  "settings.hubwork.dataSourceMatchBy": string;
  "settings.hubwork.dataSourceFields": string;
  "settings.hubwork.dataSourceFieldsPlaceholder": string;
  "settings.hubwork.dataSourceShape": string;
  "settings.hubwork.dataSourceLimit": string;
  "settings.hubwork.dataSourceSort": string;
  "settings.hubwork.spreadsheetId": string;
  "settings.hubwork.spreadsheetAdd": string;
  "settings.hubwork.spreadsheetPickerTitle": string;
  "settings.hubwork.spreadsheetNamePlaceholder": string;
  "settings.hubwork.spreadsheetCreate": string;
  "settings.hubwork.spreadsheetFetchRequired": string;
  "settings.hubwork.selectSpreadsheet": string;
  "settings.hubwork.scopeUpgradeRequired": string;
  "settings.hubwork.scopeUpgradeDescription": string;
  "settings.hubwork.scopeUpgradeButton": string;
  "settings.hubwork.paidApiKeyRequired": string;
  "settings.hubwork.provisioning": string;
  "settings.hubwork.welcomeTitle": string;
  "settings.hubwork.welcomeDescription": string;
  "settings.hubwork.welcomeFeature1": string;
  "settings.hubwork.welcomeFeature2": string;
  "settings.hubwork.welcomeFeature3": string;
  "settings.hubwork.spreadsheetInUse": string;
  "settings.hubwork.skillMissingTitle": string;
  "settings.hubwork.skillMissingDescription": string;
  "settings.hubwork.skillInstall": string;
  "settings.hubwork.skillUpdate": string;
  "settings.hubwork.skillUpdateConfirm": string;
  "settings.hubwork.skillUpdateSuccess": string;
  "settings.hubwork.skillUpdateError": string;

  // Offline
  "offline.indicator": string;
  "offline.banner": string;

  // Root folder mismatch
  "rootMismatch.title": string;
  "rootMismatch.description": string;
  "rootMismatch.migrating": string;
  "rootMismatch.confirm": string;

  // Frontmatter editor
  "frontmatter.properties": string;
  "frontmatter.addProperty": string;
  "frontmatter.addProperties": string;
  "frontmatter.propertyType": string;
  "frontmatter.remove": string;
  "frontmatter.text": string;
  "frontmatter.number": string;
  "frontmatter.checkbox": string;
  "frontmatter.date": string;
  "frontmatter.dateTime": string;
  "frontmatter.list": string;
  "frontmatter.cut": string;
  "frontmatter.copy": string;
  "frontmatter.paste": string;

  // Skills
  "settings.general.showManagementFolders": string;
  "settings.general.showManagementFoldersDescription": string;
  "skills.selector.title": string;
}

const en: TranslationStrings = {
  // Common
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.ok": "OK",
  "common.settings": "Settings",
  "common.logout": "Logout",

  // Header
  "header.chat": "Chat",
  "header.workflow": "Workflow / skill",
  "header.files": "Files",
  "header.editor": "Editor",
  "header.plugins": "Plugins",
  "header.manual": "Manual",

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
  "chat.alwaysThinkLabel": "Always Think",
  "chat.thinkFlash": "Flash",
  "chat.thinkFlashLite": "Flash Lite",
  "chat.toolModeLockGemma4WebSearch": "Gemma 4 cannot use function calling with Web Search",
  "chat.toolModeLockWebSearch": "Drive tools are disabled during Web Search",
  "chat.toolModeLockRag": "Drive tools are disabled when RAG is enabled",
  "chat.toolModeLocked": "Auto (locked)",
  "chat.unpushWarning.title": "Unpushed Changes",
  "chat.unpushWarning.description": "The following files have local changes not yet pushed to Drive. The AI may see outdated content.",
  "chat.unpushWarning.sendAnyway": "Send Anyway",
  "chat.unpushWarning.cancel": "Cancel",

  "chat.saveToDrive": "Save to Drive",
  "chat.savedToDrive": "Saved to Drive",

  // Compact
  "chat.compact": "/compact",
  "chat.compacting": "Compacting...",
  "chat.compacted": "Conversation compressed: {{before}} messages → {{after}}",
  "chat.compactFailed": "Failed to compress conversation",
  "chat.compactedContext": "Compacted conversation context",

  // Webpage-builder auto-review
  "chat.autoReview.pass": "✅ Auto-review: looks good",
  "chat.autoReview.fail": "⚠️ Auto-review: issues found",
  "chat.autoReview.issuesLabel": "Issues",
  "chat.autoReview.autoFixing": "_Attempting an auto-fix pass…_",
  "chat.autoReview.failed": "Auto-review failed: {{message}}",
  "chat.autoReview.fixPrompt": "The automated review found the following high-severity issues. Read each affected file back with read_drive_file, fix the issue, and re-save the corrected file with update_drive_file. Do NOT propose a new plan — just fix and save.\n\n{{issues}}",

  // Welcome hints
  "chat.welcomeTitle": "Start a conversation with AI",
  "chat.welcomeHint": "Ask questions about your files, create new ones, or search your Drive.",
  "chat.welcomeThinking": "Use words like \"think\" or \"analyze\" to enable deep thinking mode",
  "chat.welcomeImage": "Use \"generate image\" or \"create image\" to auto-switch to image model",
  "chat.welcomeCompact": "Type /compact to compress a long conversation into a new chat",
  "chat.welcomeNewChat": "Gemini has no memory, so the entire chat history is sent each time. Always click + to start a new chat when changing topics",
  "chat.welcomeBuilderTitle": "Build a Web App",
  "chat.welcomeBuilderHint": "Create web apps through AI chat — login pages, booking systems, APIs, and more.",
  "chat.welcomeBuilderButton": "Build a Web App",
  "chat.welcomeBuilderLogin": "User login via Google Sheets — add emails to a spreadsheet to manage access",
  "chat.welcomeBuilderCalendar": "Booking system — let logged-in users reserve your available Google Calendar slots",
  "chat.welcomeBuilderApi": "Custom APIs — build endpoints that interact with Google Sheets, Calendar, and more",

  // Message usage
  "message.tokens": "Tokens",
  "message.thinkingTokens": "Thinking",

  // Settings
  "settings.title": "Settings",
  "settings.tab.general": "General",
  "settings.tab.mcp": "MCP Servers",
  "settings.tab.rag": "RAG",

  // General tab
  "settings.general.apiKey": "Gemini API Key",
  "settings.general.apiKeyGetLink": "Get your API key",
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
  "settings.rag.addSetting": "Add Setting",
  "settings.rag.noSettings": "No RAG settings configured.",
  "settings.rag.copyStoreId": "Copy Store ID",
  "settings.rag.external": "External",
  "settings.rag.internal": "Internal",
  "settings.rag.sync": "Sync",
  "settings.rag.type": "Type",
  "settings.rag.typeInternal": "Internal (Google Drive folders)",
  "settings.rag.typeExternal": "External (store IDs)",
  "settings.rag.storeIdsLabel": "Store IDs (one per line)",
  "settings.rag.targetFoldersLabel": "Target Folders (one per line, name or ID)",
  "settings.rag.targetFoldersHint": "Folder names (e.g. {example}) or Drive folder IDs. Leave empty to use the root folder.",
  "settings.rag.excludePatternsLabel": "Exclude Patterns (one per line, regex)",
  "settings.rag.syncSaveFailed": "Failed to save settings before sync.",
  "settings.rag.syncFailed": "Sync failed.",
  "settings.rag.noResponseBody": "No response body.",
  "settings.rag.syncError": "Sync error.",

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": "Encrypt Chat History",
  "settings.encryption.encryptWorkflow": "Encrypt Workflow History",

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
  "settings.general.invalidApiKey": "Invalid API key. Please check your Gemini API key and try again.",
  "settings.general.apiKeyRequired": "API key is required for initial setup.",
  "settings.general.passwordRequiredError": "Password is required for initial setup.",
  "settings.general.currentPasswordRequired": "Current password is required to change the API key.",
  "settings.general.required": "Required",
  "settings.general.errorTitle": "Save Error",
  "settings.general.generalSaved": "General settings saved.",

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
  "contextMenu.tempEditUrlConfirm": "Generate an edit URL so the file can be edited in other apps? (valid for 1 hour)",
  "contextMenu.tempEditUrlHint": "Downloads between GemiHub instances are always available without issuing a URL.",
  "contextMenu.tempEditUrlYes": "Issue URL",
  "contextMenu.tempEditUrlNo": "No URL",
  "contextMenu.noTempFile": "No temp file found for this file.",
  "contextMenu.clearCache": "Clear Cache",
  "contextMenu.clearCacheModified": "This file has unsaved changes that will be lost. Continue?",
  "contextMenu.clearCacheSkipModified": "Some files have unsaved changes that will be lost. Continue?",
  "contextMenu.cacheFolder": "Cache folder",
  "fileTree.cacheAll": "Cache all files",
  "contextMenu.publish": "Publish to Web",
  "contextMenu.unpublish": "Unpublish",
  "contextMenu.copyLink": "Copy Share Link",
  "contextMenu.published": "Published! Link copied to clipboard.",
  "contextMenu.unpublished": "File has been unpublished.",
  "contextMenu.linkCopied": "Link copied to clipboard.",
  "contextMenu.publishFailed": "Failed to publish file.",
  "contextMenu.unpublishFailed": "Failed to unpublish file.",
  "contextMenu.renameFailed": "Failed to rename.",
  "contextMenu.bulkRenameConfirm": "Rename {count} files on Drive?",
  "contextMenu.bulkMoveConfirm": "Move {count} files on Drive?",
  "contextMenu.duplicateFailed": "Failed to duplicate.",
  "contextMenu.moveFailed": "Failed to move.",
  "contextMenu.fileAlreadyExists": "\"{name}\" already exists. Overwrite?",
  "contextMenu.duplicate": "Duplicate",
  "contextMenu.convertToPdf": "Convert to PDF",
  "contextMenu.convertedPdf": "PDF created in temporaries/.",
  "contextMenu.convertPdfFailed": "Failed to convert file to PDF.",
  "contextMenu.convertToHtml": "Convert to HTML",
  "contextMenu.convertedHtml": "HTML created in temporaries/.",
  "contextMenu.convertHtmlFailed": "Failed to convert file to HTML.",
  "contextMenu.downloadZip": "Download as ZIP",
  "contextMenu.downloadZipFailed": "Failed to create ZIP.",

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
  "settings.sync.fullPushCompleted": "Full push completed.",
  "settings.sync.fullPushSkipped": "Full push completed with warning: skipped {count} file(s).",
  "settings.sync.noCachedFiles": "No cached files to push.",
  "settings.sync.noSyncEligibleFiles": "No sync-eligible cached files to push.",
  "settings.sync.fullPushFailed": "Full push failed.",
  "settings.sync.fullPullCompleted": "Full pull completed. Downloaded {count} file(s).",
  "settings.sync.fullPullFailed": "Full pull failed.",
  "settings.sync.detectionFailed": "Detection failed.",
  "settings.sync.rebuildFailed": "Rebuild failed.",
  "settings.sync.rebuildCompleted": "Sync meta rebuilt.",
  "settings.sync.pruneFailed": "Prune failed.",
  "settings.sync.pruneError": "Prune error.",
  "settings.sync.failedToLoadStats": "Failed to load stats.",
  "sync.newFilesDetected": "{count} new file(s) on Drive",

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
  "plugins.installFailed": "Install failed",
  "plugins.toggleFailed": "Toggle failed",
  "plugins.updateFailed": "Update failed",
  "plugins.uninstallFailed": "Uninstall failed",
  "plugins.localCannotUninstall": "Local plugins cannot be uninstalled from the UI.",
  "plugins.localBadge": "Local",
  "plugins.permissionsTitle": "Permissions Required",
  "plugins.permissionsDescription": "This plugin requests access to the following APIs:",
  "plugins.permissionGemini": "Gemini AI — Send messages to Gemini AI",
  "plugins.permissionDrive": "Drive — Read, create, and update files",
  "plugins.permissionStorage": "Storage — Save plugin data",
  "plugins.permissionCalendar": "Calendar — Read and manage Google Calendar events",
  "plugins.permissionGmail": "Gmail — Send emails",
  "plugins.permissionSheets": "Sheets — Create and edit Google Sheets",
  "plugins.noPermissions": "This plugin does not request any special permissions.",
  "plugins.confirmInstall": "Install",
  "plugins.cancelInstall": "Cancel",
  "plugins.previewFailed": "Failed to fetch plugin info",
  "plugins.updateNewPermissions": "This update adds new permissions:",
  "plugins.confirmUpdate": "Update",

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
  "fileTree.folderName": "Folder name",
  "fileTree.addDateTime": "Add date/time",
  "fileTree.addLocation": "Add location",
  "fileTree.selectedCount": "{count} selected",
  "fileContent.dateTime": "Date:",
  "fileContent.location": "Location:",
  "fileContent.latitude": "Lat.",
  "fileContent.longitude": "Lng.",

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
  "settings.rag.searchTip": "When the gemihub (auto) RAG is configured, a semantic RAG search tab is available in file search (magnifying glass / Ctrl+Shift+F). You can switch between Local, Drive, and RAG search.",

  // Quick Open
  "quickOpen.placeholder": "Search files...",
  "quickOpen.noResults": "No matching files",
  "quickOpen.selectFile": "Select a file...",

  // Workflow
  "workflow.nodeComment": "Comment",
  "workflow.pushRequired": "Push to sync changes with server before executing",
  "workflow.retryFromHere": "Retry from here",
  "workflow.retryFromError": "Retry from error",
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
  "workflow.ai.createTitle": "Create workflow with AI",
  "workflow.ai.modifyTitle": "Modify Workflow with AI",
  "workflow.ai.workflowName": "Workflow Name",
  "workflow.ai.namePlaceholder": "e.g., process-notes",
  "workflow.ai.refineLabel": "Additional request (refine the result)",
  "workflow.ai.createLabel": "Describe what this workflow should do",
  "workflow.ai.modifyLabel": "Describe how to modify this workflow",
  "workflow.ai.refinePlaceholder": "e.g., Change the loop to process only .md files...",
  "workflow.ai.createPlaceholder": "e.g., Read all markdown files from Drive, summarize each one using AI, and save the summaries to a new file...",
  "workflow.ai.modifyPlaceholder": "e.g., Add error handling to the HTTP request node...",
  "workflow.ai.model": "Model",
  "workflow.ai.generating": "Generating workflow...",
  "workflow.ai.thinking": "Thinking...",
  "workflow.ai.ctrlEnter": "Ctrl+Enter to generate",
  "workflow.ai.cancel": "Cancel",
  "workflow.ai.stop": "Stop",
  "workflow.ai.regenerate": "Regenerate",
  "workflow.ai.generate": "Generate",
  "workflow.ai.emptyResponse": "AI returned empty response. Please try again.",
  "workflow.ai.generationFailed": "Generation failed",
  "workflow.ai.noResponseStream": "No response stream",
  "workflow.ai.generationError": "Generation error",
  "workflow.ai.copyPrompt": "Copy Prompt",
  "workflow.ai.promptCopied": "Prompt copied to clipboard",
  "workflow.ai.pasteLabel": "Paste the response from external LLM",
  "workflow.ai.pastePlaceholder": "Paste the YAML or markdown (with ```yaml blocks) from Claude, GPT, etc...",
  "workflow.ai.applyPasted": "Apply",
  "workflow.ai.enterPastedYaml": "Please paste YAML content",
  "workflow.ai.parseFailed": "Could not find valid workflow YAML in pasted content",
  "workflow.ai.createAsSkill": "Create as agent skill",
  "workflow.ai.skillName": "Skill name",
  "workflow.ai.skillNamePlaceholder": "e.g., Code Review Helper",
  "workflow.ai.createSkillTitle": "Create skill with AI",
  "workflow.ai.modifySkillTitle": "Modify skill with AI",
  "workflow.ai.confirmSkillChanges": "Confirm skill changes",
  "workflow.ai.describeCreate": "Describe the workflow you want to create:",
  "workflow.ai.describeCreateSkill": "Describe the skill you want to create:",
  "workflow.ai.placeholderCreateSkill": "E.g., a code review skill that reviews the active note and suggests improvements when requested",
  "workflow.ai.planning": "Planning",
  "workflow.ai.reviewing": "Reviewing",
  "workflow.ai.refining": "Refining",
  "workflow.ai.phasePlan": "Plan",
  "workflow.ai.phaseGenerate": "Generate",
  "workflow.ai.phaseReview": "Review",
  "workflow.ai.planComplete": "Plan ready — review and proceed",
  "workflow.ai.planReplan": "Re-plan",
  "workflow.ai.planReplanPlaceholder": "Describe what to change in the plan...",
  "workflow.ai.planOk": "OK",
  "workflow.ai.reviewApproved": "Review passed",
  "workflow.ai.reviewRefining": "Issues found, refining...",
  "workflow.ai.reviewComplete": "Review complete — accept or refine",
  "workflow.ai.refineBtn": "Refine",
  "workflow.ai.refinePlaceholderReview": "Describe what to fix...",
  "workflow.ai.acceptWithIssuesConfirm": "The review flagged issues. Accept this result anyway?",
  "workflow.ai.reviewVerdictPass": "Review passed",
  "workflow.ai.reviewVerdictFail": "Issues found",
  "workflow.ai.reviewSummary": "Summary",
  "workflow.ai.reviewIssues": "Issues",
  "workflow.ai.reviewNoIssues": "No issues found.",
  "workflow.ai.severityHigh": "High",
  "workflow.ai.severityMedium": "Medium",
  "workflow.ai.severityLow": "Low",
  "workflow.ai.contextPlan": "Plan",
  "workflow.ai.contextThinking": "Thinking",
  "workflow.ai.contextReview": "Review",
  "workflow.ai.noChanges": "(no changes)",
  "workflow.ai.skillInstructionsChanges": "SKILL.md instructions — changes:",
  "workflow.ai.workflowYamlChanges": "Workflow YAML — changes:",
  "workflow.ai.autoRepair": "Auto-repair {{attempt}}/{{max}}",
  "workflow.ai.parseFailureTitle": "Could not parse generated workflow",
  "workflow.ai.parseFailureHint": "After auto-repair attempts failed, the raw response is shown below. You can copy it and try a stronger LLM.",
  "workflow.ai.parseFailureCopy": "Copy raw response",
  "workflow.createWorkflowWithAI": "Create workflow with AI",
  "workflow.createSkillWithAI": "Create skill with AI",
  "workflow.modifyWorkflowWithAI": "Modify workflow with AI",
  "workflow.modifySkillWithAI": "Modify skill with AI",
  "workflow.createHintWorkflow": "Workflow: automates a predefined series of steps, run from the sidebar panel or a hotkey.",
  "workflow.createHintSkill": "Skill: bundles instructions and workflows the chat assistant can call on demand when the conversation matches its description.",
  "workflow.skillNoInlineWorkflow": "This skill stores its workflow in a separate file. Use \"Modify skill with AI\" to edit it as a whole.",
  "workflow.tabLabel": "Workflow / skill",
  "chat.openWorkflow": "Open workflow",
  "chat.workflowErrorHint": "Tip: open the workflow, modify it with AI, reference the execution history to pick the failing step, and ask the AI to fix it.",
  "chat.skillsUsed": "Skills used",
  "chat.clickToOpen": "Click to open: {{source}}",
  "workflow.preview.previewPrefix": "Preview: ",
  "workflow.preview.changesPrefix": "Changes: ",
  "workflow.preview.defaultName": "Workflow",
  "workflow.preview.visual": "Visual",
  "workflow.preview.yaml": "YAML",
  "workflow.preview.diff": "Diff",
  "workflow.preview.cancel": "Cancel",
  "workflow.preview.refine": "Refine",
  "workflow.preview.accept": "Accept",
  "workflow.preview.saving": "Saving...",
  "workflow.preview.parseFailed": "Failed to parse generated YAML. Check the YAML tab for raw content.",
  "workflow.preview.noNodes": "No nodes found",
  "workflow.preview.noDiff": "No differences detected.",
  "workflow.preview.skillMd": "SKILL.md",

  // Trash & Manage Files
  "settings.sync.trashTitle": "Trash",
  "settings.sync.trashDescription": "Restore or permanently delete trashed files.",
  "settings.sync.conflictsTitle": "Conflict Backups",
  "settings.sync.conflictsDescription": "Manage conflict backup files from sync resolution.",
  "settings.sync.manage": "Manage",
  "settings.sync.migrationTool": "Migration Tool",
  "settings.sync.migrationToolDescription": "Generate a token for Obsidian Gemini Helper or external migration tools. If encryption is enabled, authentication credentials are also exported to Google Drive.",
  "settings.sync.migrationTokenGenerate": "Generate Token",
  "settings.sync.migrationTokenWarning": "This token grants access to your GemHub files in Google Drive. It expires in about 1 hour.",
  "settings.sync.migrationTokenFreeNotice": "This feature is temporarily available for free while the Premium Plan is being prepared.",
  "settings.sync.backupTokenCopy": "Copy",
  "settings.sync.backupTokenCopied": "Copied!",
  "settings.sync.backupTokenHide": "Hide Token",
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
  "trash.bulkDeleteConfirm": "Move {count} file(s) to trash?",
  "trash.permanentDeleteOption": "Permanently delete (skip trash)",
  "trash.permanentDeleteWarning": "This action cannot be undone.",
  "trash.deleteFailed": "Failed to delete files.",
  "trash.restoreFailed": "Failed to restore files.",
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
  "conflict.editDeleteDescription": "These files were edited locally but deleted on remote. Choose to keep your local version (re-creates the file on Drive) or accept the deletion.",
  "conflict.deletedOnRemote": "Deleted on remote",
  "conflict.acceptDeletion": "Accept Deletion",

  // Sync diff dialog
  "sync.pushLabel": "Push to Drive",
  "sync.pullLabel": "Pull to Local",
  "sync.pushChanges": "Push Changes",
  "sync.pullChanges": "Pull Changes",
  "sync.pushDirection": "Local \u2192 Drive",
  "sync.pullDirection": "Drive \u2192 Local",
  "sync.openFile": "Open",
  "sync.noDiff": "Binary file",
  "sync.encryptedNoDiff": "Encrypted file (diff not available)",
  "sync.conflictBadge": "Conflict",
  "sync.ignore": "Ignore",
  "sync.unignore": "Unignore",

  // Shortcuts tab
  "settings.tab.shortcuts": "Shortcuts",
  "settings.shortcuts.description": "Assign keyboard shortcuts to quickly execute your workflows. Selecting Background executes the workflow without opening the workflow screen. If the workflow has a file picker dialog, the currently open file is automatically selected.",
  "settings.shortcuts.noShortcuts": "No shortcut keys configured. Add a shortcut to execute a workflow with a key combination.",
  "settings.shortcuts.addShortcut": "Add Shortcut",
  "settings.shortcuts.pressKey": "Press a key...",
  "settings.shortcuts.duplicate": "This key combination is already assigned.",
  "settings.shortcuts.requireModifier": "Ctrl/Cmd or Alt modifier is required. Shift alone is not sufficient. Function keys (F1–F12) can be used alone.",
  "settings.shortcuts.builtinConflict": "This key combination is reserved by the application.",
  "settings.shortcuts.selectWorkflow": "Select a workflow…",
  "settings.shortcuts.silent": "Background",
  "settings.shortcuts.silentDescription": "Execute the workflow without opening the workflow screen. Progress is shown in the status bar.",
  "settings.shortcuts.executing": "Executing: {name}",
  "settings.shortcuts.executionDone": "Completed: {name}",
  "settings.shortcuts.executionError": "Error: {name}",

  // Hubwork tab
  "settings.tab.hubwork": "Premium Plan",
  "settings.hubwork.title": "Premium Plan",
  "settings.hubwork.domain": "Custom Domain",
  "settings.hubwork.domainPlaceholder": "app.example.com",
  "settings.hubwork.domainProvision": "Provision",
  "settings.hubwork.domainRemove": "Remove",
  "settings.hubwork.domainStatus": "Status",
  "settings.hubwork.domainStatusActive": "Active",
  "settings.hubwork.domainStatusPendingDns": "Pending DNS verification",
  "settings.hubwork.domainStatusProvisioningCert": "Provisioning certificate...",
  "settings.hubwork.domainStatusFailed": "Domain provisioning failed",
  "settings.hubwork.domainDnsHeader": "Add the following DNS records at your registrar:",
  "settings.hubwork.domainDnsTypeLabel": "Type",
  "settings.hubwork.domainDnsNameLabel": "Name",
  "settings.hubwork.domainDnsValueLabel": "Value",
  "settings.hubwork.domainDnsPropagation": "DNS propagation and SSL provisioning may take several minutes to a few hours. Click \"Status\" to check progress.",
  "settings.hubwork.domainCheckSsl": "SSL certificate",
  "settings.hubwork.domainCheckDns": "A record",
  "settings.hubwork.domainCheckRefresh": "Refresh status",
  "settings.hubwork.domainDnsOk": "Configured correctly",
  "settings.hubwork.domainDnsMismatch": "Points to wrong IP",
  "settings.hubwork.domainDnsMissing": "Not found",
  "settings.hubwork.domainDnsExpected": "Expected",
  "settings.hubwork.domainDnsActual": "Actual",
  "settings.hubwork.domainReady": "Custom domain is live",
  "settings.hubwork.domainNotReady": "Custom domain is not yet reachable",
  "settings.hubwork.domainChecking": "Checking...",
  "settings.hubwork.schedules": "Scheduled Workflows",
  "settings.hubwork.schedulesEmpty": "No scheduled workflows configured.",
  "settings.hubwork.scheduleAdd": "Add Schedule",
  "settings.hubwork.scheduleWorkflow": "Workflow file",
  "settings.hubwork.scheduleCron": "Cron expression",
  "settings.hubwork.scheduleEnabled": "Enabled",
  "settings.hubwork.scheduleRemove": "Remove",
  "settings.hubwork.subscription": "Subscription",
  "settings.hubwork.subscribeButton": "Subscribe — ¥2,000/month",
  "settings.hubwork.slugLabel": "Your subdomain",
  "settings.hubwork.slugRequired": "Please enter a subdomain",
  "settings.hubwork.slugInvalid": "3+ chars, lowercase letters, numbers, and hyphens only",
  "settings.hubwork.slugUnavailable": "New subscriptions are temporarily unavailable while OAuth verification is in progress.",
  "settings.hubwork.siteUrl": "Site URL",
  "settings.hubwork.subscriptionActive": "Active",
  "settings.hubwork.subscriptionGranted": "Granted account (free)",
  "settings.hubwork.manageSubscription": "Manage Subscription",
  "settings.hubwork.subscriptionRequired": "A Premium subscription is required to enable this feature.",
  "settings.hubwork.accounts": "Account Types",
  "settings.hubwork.accountsEmpty": "No account types configured.",
  "settings.hubwork.accountAdd": "Add Account Type",
  "settings.hubwork.accountTypeNamePlaceholder": "(select a sheet)",
  "settings.hubwork.identitySheet": "Auth Sheet",
  "settings.hubwork.identityEmailColumn": "Email Column",
  "settings.hubwork.dataSources": "Data Sources",
  "settings.hubwork.dataSourceAdd": "Add Data Source",
  "settings.hubwork.dataSourceKey": "Key",
  "settings.hubwork.dataSourceSheet": "Sheet",
  "settings.hubwork.dataSourceMatchBy": "Match By",
  "settings.hubwork.dataSourceFields": "Fields",
  "settings.hubwork.dataSourceFieldsPlaceholder": "email, name, company",
  "settings.hubwork.dataSourceShape": "Shape",
  "settings.hubwork.dataSourceLimit": "Limit",
  "settings.hubwork.dataSourceSort": "Sort",
  "settings.hubwork.spreadsheetId": "Spreadsheets",
  "settings.hubwork.spreadsheetAdd": "Add Spreadsheet",
  "settings.hubwork.spreadsheetPickerTitle": "Select a Spreadsheet",
  "settings.hubwork.spreadsheetNamePlaceholder": "Spreadsheet name",
  "settings.hubwork.spreadsheetCreate": "Create",
  "settings.hubwork.spreadsheetFetchRequired": "Fetch sheet names for all spreadsheets used in account types before saving.",
  "settings.hubwork.selectSpreadsheet": "Select spreadsheet",
  "settings.hubwork.scopeUpgradeRequired": "Additional permissions required",
  "settings.hubwork.scopeUpgradeDescription": "The Premium plan needs Gmail and Calendar access. Click to re-authorize with the required permissions.",
  "settings.hubwork.scopeUpgradeButton": "Grant permissions",
  "settings.hubwork.paidApiKeyRequired": "A paid API key is required to subscribe. Please set API Plan to \"Paid\" in the General tab.",
  "settings.hubwork.provisioning": "Setting up Webpage Builder skill...",
  "settings.hubwork.welcomeTitle": "Pro Plan is ready!",
  "settings.hubwork.welcomeDescription": "The \"Webpage Builder\" skill and a spreadsheet have been automatically set up. Here's what you can do:",
  "settings.hubwork.welcomeFeature1": "Open Chat and describe the page you want — the AI will build it for you.",
  "settings.hubwork.welcomeFeature2": "A \"webpage_builder\" spreadsheet with an \"accounts\" sheet has been created. The AI can add more sheets (e.g. tickets, meetings) as needed when building pages.",
  "settings.hubwork.welcomeFeature3": "To enable login, add user email addresses to the \"email\" column in the \"accounts\" sheet of the spreadsheet.",
  "settings.hubwork.spreadsheetInUse": "This spreadsheet is used by the following Account Types. Please remove them first:",
  "settings.hubwork.skillMissingTitle": "Webpage Builder skill is not installed",
  "settings.hubwork.skillMissingDescription": "The AI Web Builder requires the \"Webpage Builder\" skill. Please install it to start building pages with AI.",
  "settings.hubwork.skillInstall": "Install Webpage Builder Skill",
  "settings.hubwork.skillUpdate": "Update Skill to Latest",
  "settings.hubwork.skillUpdateConfirm": "This will overwrite the current \"Webpage Builder\" skill with the latest version. Your previous version is preserved in edit history. Continue?",
  "settings.hubwork.skillUpdateSuccess": "Skill updated successfully.",
  "settings.hubwork.skillUpdateError": "Failed to update skill.",

  // Offline
  "offline.indicator": "Offline",
  "offline.banner": "You are in offline mode. Some features are unavailable.",

  // Root folder mismatch
  "rootMismatch.title": "New gemihub folder detected",
  "rootMismatch.description": "Your local cached files will be moved to conflicts. You can restore them from Settings > Conflicts.",
  "rootMismatch.migrating": "Migrating...",
  "rootMismatch.confirm": "OK",

  // Frontmatter editor
  "frontmatter.properties": "Properties",
  "frontmatter.addProperty": "Add property",
  "frontmatter.addProperties": "Add properties",
  "frontmatter.propertyType": "Property type",
  "frontmatter.remove": "Remove",
  "frontmatter.text": "Text",
  "frontmatter.number": "Number",
  "frontmatter.checkbox": "Checkbox",
  "frontmatter.date": "Date",
  "frontmatter.dateTime": "Date & time",
  "frontmatter.list": "List",
  "frontmatter.cut": "Cut",
  "frontmatter.copy": "Copy",
  "frontmatter.paste": "Paste",

  // Skills
  "settings.general.showManagementFolders": "Show management folders",
  "settings.general.showManagementFoldersDescription": "Show folders used by external tools (e.g. LocalLlmHub) in the file tree.",
  "skills.selector.title": "Agent Skills",
};

const ja: TranslationStrings = {
  // Common
  "common.save": "保存",
  "common.cancel": "キャンセル",
  "common.close": "閉じる",
  "common.ok": "OK",
  "common.settings": "設定",
  "common.logout": "ログアウト",

  // Header
  "header.chat": "チャット",
  "header.workflow": "ワークフロー / スキル",
  "header.files": "ファイル",
  "header.editor": "エディタ",
  "header.plugins": "プラグイン",
  "header.manual": "マニュアル",

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
  "chat.alwaysThinkLabel": "常に思考",
  "chat.thinkFlash": "Flash",
  "chat.thinkFlashLite": "Flash Lite",
  "chat.toolModeLockGemma4WebSearch": "Gemma 4はWeb Searchとファンクションコールを同時に使用できません",
  "chat.toolModeLockWebSearch": "Web Search中はDriveツールは無効です",
  "chat.toolModeLockRag": "RAG使用時はDriveツールは無効です",
  "chat.toolModeLocked": "自動（ロック中）",
  "chat.unpushWarning.title": "未プッシュの変更",
  "chat.unpushWarning.description": "以下のファイルにはDriveにプッシュされていないローカル変更があります。AIは古い内容を参照する可能性があります。",
  "chat.unpushWarning.sendAnyway": "そのまま送信",
  "chat.unpushWarning.cancel": "キャンセル",

  "chat.saveToDrive": "Driveに保存",
  "chat.savedToDrive": "Drive保存済み",

  // Compact
  "chat.compact": "/compact",
  "chat.compacting": "圧縮中...",
  "chat.compacted": "会話を圧縮しました: {{before}}メッセージ → {{after}}",
  "chat.compactFailed": "会話の圧縮に失敗しました",
  "chat.compactedContext": "圧縮された会話コンテキスト",

  // Webpage-builder auto-review
  "chat.autoReview.pass": "✅ 自動レビュー: 問題なし",
  "chat.autoReview.fail": "⚠️ 自動レビュー: 修正が必要",
  "chat.autoReview.issuesLabel": "検出された問題",
  "chat.autoReview.autoFixing": "_自動で修正を試みます…_",
  "chat.autoReview.failed": "自動レビューに失敗しました: {{message}}",
  "chat.autoReview.fixPrompt": "自動レビューで以下の重大な問題が見つかりました。各ファイルを read_drive_file で読み直し、問題を修正してから update_drive_file で上書き保存してください。新たなプラン提示は不要です。\n\n{{issues}}",

  // Welcome hints
  "chat.welcomeTitle": "AIとの会話を始めましょう",
  "chat.welcomeHint": "ファイルについて質問したり、新規作成したり、Drive内を検索できます。",
  "chat.welcomeThinking": "「考えて」「分析して」などのキーワードで深い思考モードが有効になります",
  "chat.welcomeImage": "「画像を生成」「generate image」で自動的に画像モデルに切り替わります",
  "chat.welcomeCompact": "/compact で長い会話を要約して新しいチャットに引き継げます",
  "chat.welcomeNewChat": "Geminiは記憶ができないため、毎回このチャットの全会話を送信します。話題を変える時は必ず + ボタンで新しいチャットを始めてください",
  "chat.welcomeBuilderTitle": "Webアプリを構築する",
  "chat.welcomeBuilderHint": "AIチャットでWebアプリを構築 — ログインページ、予約システム、APIなど。",
  "chat.welcomeBuilderButton": "Webアプリを構築する",
  "chat.welcomeBuilderLogin": "Google Sheetsでユーザーログイン — スプレッドシートにメールアドレスを追加してアクセス管理",
  "chat.welcomeBuilderCalendar": "予約システム — ログインしたユーザーがGoogleカレンダーの空き時間を予約",
  "chat.welcomeBuilderApi": "カスタムAPI — Google Sheets、Calendar等と連携するエンドポイントを構築",

  // Message usage
  "message.tokens": "トークン",
  "message.thinkingTokens": "思考",

  // Settings
  "settings.title": "設定",
  "settings.tab.general": "一般",
  "settings.tab.mcp": "MCPサーバー",
  "settings.tab.rag": "RAG",

  // General tab
  "settings.general.apiKey": "Gemini APIキー",
  "settings.general.apiKeyGetLink": "APIキーを取得",
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
  "settings.rag.addSetting": "設定を追加",
  "settings.rag.noSettings": "RAG設定がありません。",
  "settings.rag.copyStoreId": "Store IDをコピー",
  "settings.rag.external": "外部",
  "settings.rag.internal": "内部",
  "settings.rag.sync": "同期",
  "settings.rag.type": "タイプ",
  "settings.rag.typeInternal": "内部（Google Driveフォルダ）",
  "settings.rag.typeExternal": "外部（Store ID）",
  "settings.rag.storeIdsLabel": "Store ID（1行に1つ）",
  "settings.rag.targetFoldersLabel": "対象フォルダ（1行に1つ、名前またはID）",
  "settings.rag.targetFoldersHint": "フォルダ名（例: {example}）またはDriveフォルダID。空欄の場合はルートフォルダが対象になります。",
  "settings.rag.excludePatternsLabel": "除外パターン（1行に1つ、正規表現）",
  "settings.rag.syncSaveFailed": "同期前の設定保存に失敗しました。",
  "settings.rag.syncFailed": "同期に失敗しました。",
  "settings.rag.noResponseBody": "レスポンスがありません。",
  "settings.rag.syncError": "同期エラー。",

  // Encryption (integrated into General tab)
  "settings.encryption.encryptChat": "チャット履歴を暗号化",
  "settings.encryption.encryptWorkflow": "ワークフロー履歴を暗号化",

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
  "settings.general.invalidApiKey": "無効なAPIキーです。Gemini APIキーを確認して再度お試しください。",
  "settings.general.apiKeyRequired": "初回設定にはAPIキーが必要です。",
  "settings.general.passwordRequiredError": "初回設定にはパスワードが必要です。",
  "settings.general.currentPasswordRequired": "APIキーを変更するには現在のパスワードが必要です。",
  "settings.general.required": "必須",
  "settings.general.errorTitle": "保存エラー",
  "settings.general.generalSaved": "一般設定を保存しました。",

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
  "contextMenu.tempEditUrlConfirm": "別アプリでも編集できるようURLを発行しますか？（有効期限1時間）",
  "contextMenu.tempEditUrlHint": "GemiHub同士のダウンロードはURL発行なしでいつでも利用できます。",
  "contextMenu.tempEditUrlYes": "発行必要",
  "contextMenu.tempEditUrlNo": "発行不要",
  "contextMenu.noTempFile": "このファイルの一時ファイルが見つかりません。",
  "contextMenu.clearCache": "キャッシュクリア",
  "contextMenu.clearCacheModified": "未保存の変更がありますが、変更は失われます。続行しますか？",
  "contextMenu.clearCacheSkipModified": "未保存の変更があるファイルがありますが、変更は失われます。続行しますか？",
  "contextMenu.cacheFolder": "フォルダをキャッシュ",
  "fileTree.cacheAll": "すべてキャッシュ",
  "contextMenu.publish": "ウェブに公開",
  "contextMenu.unpublish": "公開を解除",
  "contextMenu.copyLink": "共有リンクをコピー",
  "contextMenu.published": "公開しました！リンクをクリップボードにコピーしました。",
  "contextMenu.unpublished": "公開を解除しました。",
  "contextMenu.linkCopied": "リンクをクリップボードにコピーしました。",
  "contextMenu.publishFailed": "ファイルの公開に失敗しました。",
  "contextMenu.unpublishFailed": "公開の解除に失敗しました。",
  "contextMenu.renameFailed": "名前の変更に失敗しました。",
  "contextMenu.bulkRenameConfirm": "{count}件のファイルをDriveでリネームしますか？",
  "contextMenu.bulkMoveConfirm": "{count}件のファイルをDriveで移動しますか？",
  "contextMenu.duplicateFailed": "複製に失敗しました。",
  "contextMenu.moveFailed": "移動に失敗しました。",
  "contextMenu.fileAlreadyExists": "「{name}」は既に存在します。上書きしますか？",
  "contextMenu.duplicate": "複製",
  "contextMenu.convertToPdf": "PDFに変換",
  "contextMenu.convertedPdf": "temporaries/ にPDFを作成しました。",
  "contextMenu.convertPdfFailed": "PDF変換に失敗しました。",
  "contextMenu.convertToHtml": "HTMLに変換",
  "contextMenu.convertedHtml": "temporaries/ にHTMLを作成しました。",
  "contextMenu.convertHtmlFailed": "HTML変換に失敗しました。",
  "contextMenu.downloadZip": "ZIPでダウンロード",
  "contextMenu.downloadZipFailed": "ZIP作成に失敗しました。",

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
  "settings.sync.fullPushCompleted": "完全Pushが完了しました。",
  "settings.sync.fullPushSkipped": "完全Pushが完了しましたが、{count}件のファイルをスキップしました。",
  "settings.sync.noCachedFiles": "Pushするキャッシュファイルがありません。",
  "settings.sync.noSyncEligibleFiles": "同期対象のキャッシュファイルがありません。",
  "settings.sync.fullPushFailed": "完全Pushに失敗しました。",
  "settings.sync.fullPullCompleted": "完全Pullが完了しました。{count}件のファイルをダウンロードしました。",
  "settings.sync.fullPullFailed": "完全Pullに失敗しました。",
  "settings.sync.detectionFailed": "検出に失敗しました。",
  "settings.sync.rebuildFailed": "再構築に失敗しました。",
  "settings.sync.rebuildCompleted": "同期メタデータを再構築しました。",
  "settings.sync.pruneFailed": "整理に失敗しました。",
  "settings.sync.pruneError": "整理中にエラーが発生しました。",
  "settings.sync.failedToLoadStats": "統計の読み込みに失敗しました。",
  "sync.newFilesDetected": "Drive に新しいファイルが {count} 件あります",

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
  "plugins.installFailed": "インストールに失敗しました",
  "plugins.toggleFailed": "切り替えに失敗しました",
  "plugins.updateFailed": "更新に失敗しました",
  "plugins.uninstallFailed": "アンインストールに失敗しました",
  "plugins.localCannotUninstall": "ローカルプラグインはUIからアンインストールできません。",
  "plugins.localBadge": "ローカル",
  "plugins.permissionsTitle": "必要な権限",
  "plugins.permissionsDescription": "このプラグインは以下のAPIへのアクセスを要求しています:",
  "plugins.permissionGemini": "Gemini AI — Gemini AIにメッセージを送信",
  "plugins.permissionDrive": "Drive — ファイルの読み取り・作成・更新",
  "plugins.permissionStorage": "Storage — プラグインデータの保存",
  "plugins.permissionCalendar": "Calendar — Googleカレンダーの予定を読み取り・管理",
  "plugins.permissionGmail": "Gmail — メールの送信",
  "plugins.permissionSheets": "Sheets — Googleスプレッドシートの作成・編集",
  "plugins.noPermissions": "このプラグインは特別な権限を要求していません。",
  "plugins.confirmInstall": "インストール",
  "plugins.cancelInstall": "キャンセル",
  "plugins.previewFailed": "プラグイン情報の取得に失敗しました",
  "plugins.updateNewPermissions": "この更新により新しい権限が追加されます:",
  "plugins.confirmUpdate": "更新",

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
  "fileTree.folderName": "フォルダ名",
  "fileTree.addDateTime": "日時を追加",
  "fileTree.addLocation": "位置情報を追加",
  "fileTree.selectedCount": "{count}件選択中",
  "fileContent.dateTime": "日時:",
  "fileContent.location": "場所:",
  "fileContent.latitude": "緯度",
  "fileContent.longitude": "経度",

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
  "settings.rag.searchTip": "gemihub（自動）のRAGが設定されている場合、ファイル検索（虫めがね / Ctrl+Shift+F）でセマンティックRAG検索タブが利用できます。ローカル・Drive・RAG検索を切り替えられます。",

  // Quick Open
  "quickOpen.placeholder": "ファイルを検索...",
  "quickOpen.noResults": "一致するファイルがありません",
  "quickOpen.selectFile": "ファイルを選択...",

  // Workflow
  "workflow.nodeComment": "コメント",
  "workflow.pushRequired": "Pushしてサーバー側に反映しないと実行できません",
  "workflow.retryFromHere": "ここからリトライ",
  "workflow.retryFromError": "エラーからリトライ",
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
  "workflow.ai.createTitle": "AIでワークフローを作成",
  "workflow.ai.modifyTitle": "AIでワークフローを修正",
  "workflow.ai.workflowName": "ワークフロー名",
  "workflow.ai.namePlaceholder": "例: process-notes",
  "workflow.ai.refineLabel": "追加リクエスト（結果を改善）",
  "workflow.ai.createLabel": "ワークフローの内容を説明してください",
  "workflow.ai.modifyLabel": "ワークフローの修正内容を説明してください",
  "workflow.ai.refinePlaceholder": "例: ループを.mdファイルのみ処理するように変更...",
  "workflow.ai.createPlaceholder": "例: Driveのすべてのmarkdownファイルを読み込み、それぞれをAIで要約し、要約を新しいファイルに保存...",
  "workflow.ai.modifyPlaceholder": "例: HTTPリクエストノードにエラーハンドリングを追加...",
  "workflow.ai.model": "モデル",
  "workflow.ai.generating": "ワークフローを生成中...",
  "workflow.ai.thinking": "思考中...",
  "workflow.ai.ctrlEnter": "Ctrl+Enterで生成",
  "workflow.ai.cancel": "キャンセル",
  "workflow.ai.stop": "停止",
  "workflow.ai.regenerate": "再生成",
  "workflow.ai.generate": "生成",
  "workflow.ai.emptyResponse": "AIが空の応答を返しました。もう一度お試しください。",
  "workflow.ai.generationFailed": "生成に失敗しました",
  "workflow.ai.noResponseStream": "レスポンスストリームがありません",
  "workflow.ai.generationError": "生成エラー",
  "workflow.ai.copyPrompt": "プロンプトをコピー",
  "workflow.ai.promptCopied": "プロンプトをクリップボードにコピーしました",
  "workflow.ai.pasteLabel": "外部LLMからのレスポンスを貼り付け",
  "workflow.ai.pastePlaceholder": "Claude、GPT等が出力したYAMLまたはMarkdown（```yamlブロック含む）を貼り付け...",
  "workflow.ai.applyPasted": "適用",
  "workflow.ai.enterPastedYaml": "YAMLの内容を貼り付けてください",
  "workflow.ai.parseFailed": "貼り付けた内容からワークフローYAMLを見つけられませんでした",
  "workflow.ai.createAsSkill": "エージェントスキルとして作成",
  "workflow.ai.skillName": "スキル名",
  "workflow.ai.skillNamePlaceholder": "例: コードレビューヘルパー",
  "workflow.ai.createSkillTitle": "AIでスキルを作成",
  "workflow.ai.modifySkillTitle": "AIでスキルを修正",
  "workflow.ai.confirmSkillChanges": "スキル変更の確認",
  "workflow.ai.describeCreate": "作成したいワークフローを説明してください:",
  "workflow.ai.describeCreateSkill": "作成したいスキルを説明してください:",
  "workflow.ai.placeholderCreateSkill": "例: 依頼されたときに現在のノートをレビューして改善案を提案するコードレビュースキル",
  "workflow.ai.planning": "計画中",
  "workflow.ai.reviewing": "レビュー中",
  "workflow.ai.refining": "修正中",
  "workflow.ai.phasePlan": "計画",
  "workflow.ai.phaseGenerate": "生成",
  "workflow.ai.phaseReview": "レビュー",
  "workflow.ai.planComplete": "計画が完成しました — 確認して進めてください",
  "workflow.ai.planReplan": "再計画",
  "workflow.ai.planReplanPlaceholder": "計画の変更点を記述してください...",
  "workflow.ai.planOk": "OK",
  "workflow.ai.reviewApproved": "レビュー通過",
  "workflow.ai.reviewRefining": "問題が見つかりました、修正中...",
  "workflow.ai.reviewComplete": "レビュー完了 — 承認または修正",
  "workflow.ai.refineBtn": "修正",
  "workflow.ai.refinePlaceholderReview": "修正内容を記述してください...",
  "workflow.ai.acceptWithIssuesConfirm": "レビューで問題が指摘されました。それでもこの結果を承認しますか？",
  "workflow.ai.reviewVerdictPass": "レビュー通過",
  "workflow.ai.reviewVerdictFail": "問題あり",
  "workflow.ai.reviewSummary": "概要",
  "workflow.ai.reviewIssues": "問題点",
  "workflow.ai.reviewNoIssues": "問題は見つかりませんでした。",
  "workflow.ai.severityHigh": "高",
  "workflow.ai.severityMedium": "中",
  "workflow.ai.severityLow": "低",
  "workflow.ai.contextPlan": "計画",
  "workflow.ai.contextThinking": "思考過程",
  "workflow.ai.contextReview": "レビュー",
  "workflow.ai.noChanges": "（変更なし）",
  "workflow.ai.skillInstructionsChanges": "SKILL.md の説明 — 変更内容:",
  "workflow.ai.workflowYamlChanges": "ワークフロー YAML — 変更内容:",
  "workflow.ai.autoRepair": "自動修復 {{attempt}}/{{max}}",
  "workflow.ai.parseFailureTitle": "生成されたワークフローをパースできませんでした",
  "workflow.ai.parseFailureHint": "自動修復に失敗しました。以下に生のレスポンスを表示しています。コピーしてより強力な LLM で試せます。",
  "workflow.ai.parseFailureCopy": "生レスポンスをコピー",
  "workflow.createWorkflowWithAI": "AIでワークフローを作成",
  "workflow.createSkillWithAI": "AIでスキルを作成",
  "workflow.modifyWorkflowWithAI": "AIでワークフローを修正",
  "workflow.modifySkillWithAI": "AIでスキルを修正",
  "workflow.createHintWorkflow": "ワークフロー: あらかじめ定義した一連の手順を自動化し、サイドバーパネルまたはホットキーから実行します。",
  "workflow.createHintSkill": "スキル: チャットアシスタントが会話の内容に応じてオンデマンドで呼び出す、指示とワークフローのセットです。",
  "workflow.skillNoInlineWorkflow": "このスキルはワークフローを別ファイルに保存しています。「AIでスキルを修正」で全体を編集してください。",
  "workflow.tabLabel": "ワークフロー / スキル",
  "chat.openWorkflow": "ワークフローを開く",
  "chat.workflowErrorHint": "ヒント: ワークフローを開き、AIで修正、実行履歴からエラーステップを参照してAIに修正を依頼してください。",
  "chat.skillsUsed": "使用スキル",
  "chat.clickToOpen": "クリックで開く: {{source}}",
  "workflow.preview.previewPrefix": "プレビュー: ",
  "workflow.preview.changesPrefix": "変更: ",
  "workflow.preview.defaultName": "ワークフロー",
  "workflow.preview.visual": "ビジュアル",
  "workflow.preview.yaml": "YAML",
  "workflow.preview.diff": "差分",
  "workflow.preview.cancel": "キャンセル",
  "workflow.preview.refine": "修正",
  "workflow.preview.accept": "適用",
  "workflow.preview.saving": "保存中...",
  "workflow.preview.parseFailed": "生成されたYAMLの解析に失敗しました。YAMLタブで生の内容を確認してください。",
  "workflow.preview.noNodes": "ノードが見つかりません",
  "workflow.preview.noDiff": "差分はありません。",
  "workflow.preview.skillMd": "SKILL.md",

  // Trash & Manage Files
  "settings.sync.trashTitle": "ゴミ箱",
  "settings.sync.trashDescription": "削除されたファイルの復元・完全削除を管理します。",
  "settings.sync.conflictsTitle": "コンフリクトバックアップ",
  "settings.sync.conflictsDescription": "同期コンフリクト解決時のバックアップファイルを管理します。",
  "settings.sync.manage": "管理",
  "settings.sync.migrationTool": "移行ツール",
  "settings.sync.migrationToolDescription": "Obsidian Gemini Helper や外部移行ツール用のトークンを生成します。暗号化が有効な場合、認証情報も Google Drive にエクスポートされます。",
  "settings.sync.migrationTokenGenerate": "トークンを生成",
  "settings.sync.migrationTokenWarning": "このトークンは Google Drive の GemHub ファイルへのアクセス権を付与します。約1時間で失効します。",
  "settings.sync.migrationTokenFreeNotice": "Premium Plan 準備中のため、この機能は一時的に無料で利用できます。",
  "settings.sync.backupTokenCopy": "コピー",
  "settings.sync.backupTokenCopied": "コピーしました！",
  "settings.sync.backupTokenHide": "トークンを非表示",
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
  "trash.bulkDeleteConfirm": "{count}件のファイルをゴミ箱に移動しますか？",
  "trash.permanentDeleteOption": "完全に削除する（ゴミ箱に入れない）",
  "trash.permanentDeleteWarning": "この操作は元に戻せません。",
  "trash.deleteFailed": "ファイルの削除に失敗しました。",
  "trash.restoreFailed": "ファイルの復元に失敗しました。",
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
  "conflict.editDeleteDescription": "これらのファイルはローカルで編集されましたが、リモートで削除されています。ローカル版を保持する（Drive にファイルを再作成）か、削除を受け入れるか選択してください。",
  "conflict.deletedOnRemote": "リモートで削除済み",
  "conflict.acceptDeletion": "削除を受け入れる",

  // Sync diff dialog
  "sync.pushLabel": "ドライブ反映",
  "sync.pullLabel": "ローカル反映",
  "sync.pushChanges": "ドライブ反映 — 変更一覧",
  "sync.pullChanges": "ローカル反映 — 変更一覧",
  "sync.pushDirection": "ローカル \u2192 ドライブ",
  "sync.pullDirection": "ドライブ \u2192 ローカル",
  "sync.openFile": "開く",
  "sync.noDiff": "バイナリファイル",
  "sync.encryptedNoDiff": "暗号化ファイル（差分表示不可）",
  "sync.conflictBadge": "コンフリクト",
  "sync.ignore": "無視",
  "sync.unignore": "無視解除",

  // Shortcuts tab
  "settings.tab.shortcuts": "ショートカット",
  "settings.shortcuts.description": "キーボードショートカットを割り当てて、作成済みのワークフローをすばやく実行できます。バックグラウンドを選ぶとワークフロー画面を開かずに実行できます。ファイルを選択するダイアログがある場合は、現在開いているファイルが自動的に選択されます。",
  "settings.shortcuts.noShortcuts": "ショートカットキーは設定されていません。ショートカットを追加して、キー操作でワークフローを実行できます。",
  "settings.shortcuts.addShortcut": "ショートカットを追加",
  "settings.shortcuts.pressKey": "キーを押してください...",
  "settings.shortcuts.duplicate": "このキーの組み合わせは既に割り当てられています。",
  "settings.shortcuts.requireModifier": "Ctrl/Cmd または Alt 修飾キーが必要です。Shift のみでは不十分です。ファンクションキー（F1〜F12）は単独で使用できます。",
  "settings.shortcuts.builtinConflict": "このキーの組み合わせはアプリケーションで予約されています。",
  "settings.shortcuts.selectWorkflow": "ワークフローを選択…",
  "settings.shortcuts.silent": "バックグラウンド",
  "settings.shortcuts.silentDescription": "ワークフロー画面を開かずに実行します。進行状況はステータスバーに表示されます。",
  "settings.shortcuts.executing": "実行中: {name}",
  "settings.shortcuts.executionDone": "完了: {name}",
  "settings.shortcuts.executionError": "エラー: {name}",

  // Hubwork tab
  "settings.tab.hubwork": "プレミアムプラン",
  "settings.hubwork.title": "プレミアムプラン",
  "settings.hubwork.domain": "カスタムドメイン",
  "settings.hubwork.domainPlaceholder": "app.example.com",
  "settings.hubwork.domainProvision": "設定開始",
  "settings.hubwork.domainRemove": "削除",
  "settings.hubwork.domainStatus": "ステータス",
  "settings.hubwork.domainStatusActive": "有効",
  "settings.hubwork.domainStatusPendingDns": "DNS検証待ち",
  "settings.hubwork.domainStatusProvisioningCert": "証明書を発行中...",
  "settings.hubwork.domainStatusFailed": "ドメイン設定に失敗しました",
  "settings.hubwork.domainDnsHeader": "DNSレジストラで以下のレコードを設定してください:",
  "settings.hubwork.domainDnsTypeLabel": "種別",
  "settings.hubwork.domainDnsNameLabel": "名前",
  "settings.hubwork.domainDnsValueLabel": "値",
  "settings.hubwork.domainDnsPropagation": "DNSの反映とSSL証明書の発行には数分〜数時間かかります。「ステータス」ボタンで進捗を確認できます。",
  "settings.hubwork.domainCheckSsl": "SSL証明書",
  "settings.hubwork.domainCheckDns": "Aレコード",
  "settings.hubwork.domainCheckRefresh": "ステータスを更新",
  "settings.hubwork.domainDnsOk": "正しく設定済み",
  "settings.hubwork.domainDnsMismatch": "別のIPに向いています",
  "settings.hubwork.domainDnsMissing": "未設定",
  "settings.hubwork.domainDnsExpected": "期待値",
  "settings.hubwork.domainDnsActual": "実測値",
  "settings.hubwork.domainReady": "カスタムドメインは利用可能です",
  "settings.hubwork.domainNotReady": "カスタムドメインはまだ利用できません",
  "settings.hubwork.domainChecking": "確認中...",
  "settings.hubwork.schedules": "スケジュール実行",
  "settings.hubwork.schedulesEmpty": "スケジュールが設定されていません。",
  "settings.hubwork.scheduleAdd": "スケジュール追加",
  "settings.hubwork.scheduleWorkflow": "ワークフローファイル",
  "settings.hubwork.scheduleCron": "Cron式",
  "settings.hubwork.scheduleEnabled": "有効",
  "settings.hubwork.scheduleRemove": "削除",
  "settings.hubwork.subscription": "サブスクリプション",
  "settings.hubwork.subscribeButton": "登録する — ¥2,000/月",
  "settings.hubwork.slugLabel": "サブドメイン",
  "settings.hubwork.slugRequired": "サブドメインを入力してください",
  "settings.hubwork.slugInvalid": "3文字以上、小文字英数字とハイフンのみ",
  "settings.hubwork.slugUnavailable": "OAuth 認証審査中のため、新規サブスクリプションは現在ご利用いただけません。",
  "settings.hubwork.siteUrl": "サイトURL",
  "settings.hubwork.subscriptionActive": "有効",
  "settings.hubwork.subscriptionGranted": "管理者付与アカウント（無料）",
  "settings.hubwork.manageSubscription": "サブスクリプション管理",
  "settings.hubwork.subscriptionRequired": "この機能を有効にするにはプレミアムプランのサブスクリプションが必要です。",
  "settings.hubwork.accounts": "アカウント種別",
  "settings.hubwork.accountsEmpty": "アカウント種別が設定されていません。",
  "settings.hubwork.accountAdd": "アカウント種別を追加",
  "settings.hubwork.accountTypeNamePlaceholder": "（シートを選択）",
  "settings.hubwork.identitySheet": "認証シート",
  "settings.hubwork.identityEmailColumn": "メールカラム",
  "settings.hubwork.dataSources": "データソース",
  "settings.hubwork.dataSourceAdd": "データソース追加",
  "settings.hubwork.dataSourceKey": "キー",
  "settings.hubwork.dataSourceSheet": "シート",
  "settings.hubwork.dataSourceMatchBy": "照合カラム",
  "settings.hubwork.dataSourceFields": "フィールド",
  "settings.hubwork.dataSourceFieldsPlaceholder": "email, name, company",
  "settings.hubwork.dataSourceShape": "形式",
  "settings.hubwork.dataSourceLimit": "件数制限",
  "settings.hubwork.dataSourceSort": "ソート",
  "settings.hubwork.spreadsheetId": "スプレッドシート",
  "settings.hubwork.spreadsheetAdd": "スプレッドシートを追加",
  "settings.hubwork.spreadsheetPickerTitle": "スプレッドシートを選択",
  "settings.hubwork.spreadsheetNamePlaceholder": "スプレッドシート名",
  "settings.hubwork.spreadsheetCreate": "作成",
  "settings.hubwork.spreadsheetFetchRequired": "保存前にアカウント種別で使用する全スプレッドシートのシート名を取得してください。",
  "settings.hubwork.selectSpreadsheet": "スプレッドシートを選択",
  "settings.hubwork.scopeUpgradeRequired": "追加の権限が必要です",
  "settings.hubwork.scopeUpgradeDescription": "プレミアムプランにはGmailとカレンダーへのアクセス権限が必要です。クリックして権限を付与してください。",
  "settings.hubwork.scopeUpgradeButton": "権限を付与",
  "settings.hubwork.paidApiKeyRequired": "サブスクリプションにはPaid APIキーが必要です。Generalタブで「Paid」に設定してください。",
  "settings.hubwork.provisioning": "Webpage Builderスキルをセットアップ中...",
  "settings.hubwork.welcomeTitle": "Proプランの準備ができました！",
  "settings.hubwork.welcomeDescription": "「Webpage Builder」スキルとスプレッドシートが自動的にセットアップされました：",
  "settings.hubwork.welcomeFeature1": "Chatで作りたいページを伝えるだけで、AIがWebページを作成します。",
  "settings.hubwork.welcomeFeature2": "accountsシートを含む「webpage_builder」スプレッドシートが作成されました。AIがページ作成時に必要に応じてシート（tickets、meetingsなど）を追加します。",
  "settings.hubwork.welcomeFeature3": "ログインを有効にするには、スプレッドシートのaccountsシートの「email」列にユーザーのメールアドレスを追加してください。",
  "settings.hubwork.spreadsheetInUse": "このスプレッドシートは以下のAccount Typeで使用されています。先にAccount Typeを削除してください：",
  "settings.hubwork.skillMissingTitle": "Webpage Builderスキルが未インストールです",
  "settings.hubwork.skillMissingDescription": "AI Web Builderを使用するには「Webpage Builder」スキルが必要です。インストールしてAIによるページ作成を始めましょう。",
  "settings.hubwork.skillInstall": "Webpage Builderスキルをインストール",
  "settings.hubwork.skillUpdate": "スキルを最新版に更新",
  "settings.hubwork.skillUpdateConfirm": "「Webpage Builder」スキルを最新版で上書きします。以前の内容は編集履歴から確認できます。続行しますか？",
  "settings.hubwork.skillUpdateSuccess": "スキルを更新しました。",
  "settings.hubwork.skillUpdateError": "スキルの更新に失敗しました。",

  // Offline
  "offline.indicator": "オフライン",
  "offline.banner": "オフラインモードです。一部の機能は利用できません。",

  // Root folder mismatch
  "rootMismatch.title": "新しいgemihubフォルダを検出しました",
  "rootMismatch.description": "ローカルキャッシュのファイルをコンフリクトに移動します。設定のコンフリクト管理から復元できます。",
  "rootMismatch.migrating": "移行中...",
  "rootMismatch.confirm": "OK",

  // Frontmatter editor
  "frontmatter.properties": "プロパティ",
  "frontmatter.addProperty": "プロパティを追加",
  "frontmatter.addProperties": "プロパティを追加",
  "frontmatter.propertyType": "プロパティタイプ",
  "frontmatter.remove": "削除",
  "frontmatter.text": "テキスト",
  "frontmatter.number": "数値",
  "frontmatter.checkbox": "チェックボックス",
  "frontmatter.date": "日付",
  "frontmatter.dateTime": "日時",
  "frontmatter.list": "リスト",
  "frontmatter.cut": "切り取り",
  "frontmatter.copy": "コピー",
  "frontmatter.paste": "貼り付け",

  // Skills
  "settings.general.showManagementFolders": "管理フォルダを表示",
  "settings.general.showManagementFoldersDescription": "外部ツールが使用するフォルダ（例: LocalLlmHub）をファイルツリーに表示します。",
  "skills.selector.title": "エージェントスキル",
};

const translations: Record<Language, TranslationStrings> = { en, ja };

export function t(language: Language, key: keyof TranslationStrings): string {
  return translations[language]?.[key] ?? translations.en[key] ?? key;
}
