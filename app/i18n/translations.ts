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

  // Index - unauthenticated
  "index.title": string;
  "index.subtitle": string;
  "index.signIn": string;

  // Index - API key warning
  "index.apiKeyWarning": string;

  // MainViewer
  "mainViewer.welcome": string;
  "mainViewer.welcomeDescription": string;
  "mainViewer.retry": string;
  "mainViewer.saved": string;
  "mainViewer.saving": string;
  "mainViewer.preview": string;
  "mainViewer.wysiwyg": string;
  "mainViewer.raw": string;

  // ChatPanel
  "chat.newChat": string;
  "chat.noHistory": string;
  "chat.confirmDelete": string;

  // Settings page
  "settings.title": string;
  "settings.tab.general": string;
  "settings.tab.mcp": string;
  "settings.tab.rag": string;
  "settings.tab.encryption": string;
  "settings.tab.editHistory": string;

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
  "settings.general.rootFolderName": string;
  "settings.general.rootFolderDescription": string;
  "settings.general.language": string;
  "settings.general.fontSize": string;

  // MCP tab
  "settings.mcp.noServers": string;
  "settings.mcp.addServer": string;
  "settings.mcp.name": string;
  "settings.mcp.url": string;
  "settings.mcp.headers": string;
  "settings.mcp.enabled": string;
  "settings.mcp.add": string;
  "settings.mcp.save": string;

  // RAG tab
  "settings.rag.enable": string;
  "settings.rag.topK": string;
  "settings.rag.settings": string;
  "settings.rag.save": string;

  // Encryption tab
  "settings.encryption.setup": string;
  "settings.encryption.setupDescription": string;
  "settings.encryption.password": string;
  "settings.encryption.confirmPassword": string;
  "settings.encryption.generateKeys": string;
  "settings.encryption.configured": string;
  "settings.encryption.encryptChat": string;
  "settings.encryption.encryptWorkflow": string;
  "settings.encryption.reset": string;
  "settings.encryption.resetWarning": string;
  "settings.encryption.confirmReset": string;
  "settings.encryption.save": string;

  // Edit History tab
  "settings.editHistory.maxAge": string;
  "settings.editHistory.maxEntries": string;
  "settings.editHistory.contextLines": string;
  "settings.editHistory.prune": string;
  "settings.editHistory.stats": string;
  "settings.editHistory.save": string;

  // Edit History Modal / Context menu
  "editHistory.title": string;
  "editHistory.noHistory": string;
  "editHistory.clearAll": string;
  "editHistory.close": string;
  "editHistory.menuLabel": string;
  "editHistory.clearHistory": string;
  "editHistory.confirmClear": string;
  "editHistory.confirmClearAll": string;

  // Context menu
  "contextMenu.rename": string;
  "contextMenu.tempDownload": string;
  "contextMenu.noTempFile": string;

  // Temp files
  "settings.general.tempFiles": string;
  "settings.general.tempFilesDescription": string;
  "settings.general.manageTempFiles": string;
  "tempFiles.title": string;
  "tempFiles.noFiles": string;
  "tempFiles.selectAll": string;
  "tempFiles.downloadSelected": string;
  "tempFiles.deleteSelected": string;
  "tempFiles.confirmDelete": string;
  "tempFiles.savedAt": string;

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
  "settings.commands.save": string;
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

  // Index
  "index.title": "Gemini Hub",
  "index.subtitle": "Build and execute AI-powered workflows visually",
  "index.signIn": "Sign in with Google",
  "index.apiKeyWarning": "Gemini API key is not set. AI features will not work.",

  // MainViewer
  "mainViewer.welcome": "Welcome to Gemini Hub",
  "mainViewer.welcomeDescription": "Select a file from the file tree to start editing, or create a new workflow or file using the buttons above.",
  "mainViewer.retry": "Retry",
  "mainViewer.saved": "Saved",
  "mainViewer.saving": "Saving...",
  "mainViewer.preview": "Preview",
  "mainViewer.wysiwyg": "WYSIWYG",
  "mainViewer.raw": "Raw",

  // ChatPanel
  "chat.newChat": "New Chat",
  "chat.noHistory": "No chat history",
  "chat.confirmDelete": "Delete this chat?",

  // Settings
  "settings.title": "Settings",
  "settings.tab.general": "General",
  "settings.tab.mcp": "MCP Servers",
  "settings.tab.rag": "RAG",
  "settings.tab.encryption": "Encryption",
  "settings.tab.editHistory": "Edit History",

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
  "settings.general.rootFolderName": "Drive Root Folder Name",
  "settings.general.rootFolderDescription": "Name of the Google Drive folder used to store all app data.",
  "settings.general.language": "Language",
  "settings.general.fontSize": "Font Size",

  // MCP tab
  "settings.mcp.noServers": "No MCP servers configured.",
  "settings.mcp.addServer": "Add Server",
  "settings.mcp.name": "Name",
  "settings.mcp.url": "URL",
  "settings.mcp.headers": "Headers (JSON)",
  "settings.mcp.enabled": "Enabled",
  "settings.mcp.add": "Add",
  "settings.mcp.save": "Save MCP Settings",

  // RAG tab
  "settings.rag.enable": "Enable RAG (Retrieval-Augmented Generation)",
  "settings.rag.topK": "Top-K results",
  "settings.rag.settings": "RAG Settings",
  "settings.rag.save": "Save RAG Settings",

  // Encryption tab
  "settings.encryption.setup": "Set Up Encryption",
  "settings.encryption.setupDescription": "Create a password to generate encryption keys. This password cannot be recovered.",
  "settings.encryption.password": "Password",
  "settings.encryption.confirmPassword": "Confirm Password",
  "settings.encryption.generateKeys": "Generate Keys",
  "settings.encryption.configured": "Encryption configured.",
  "settings.encryption.encryptChat": "Encrypt Chat History",
  "settings.encryption.encryptWorkflow": "Encrypt Workflow History",
  "settings.encryption.reset": "Reset encryption keys...",
  "settings.encryption.resetWarning": "This will remove all encryption keys. Encrypted data will become unreadable. Are you sure?",
  "settings.encryption.confirmReset": "Confirm Reset",
  "settings.encryption.save": "Save Encryption Settings",

  // Edit History tab
  "settings.editHistory.maxAge": "Max Age (days)",
  "settings.editHistory.maxEntries": "Max Entries Per File",
  "settings.editHistory.contextLines": "Context Lines (0-10)",
  "settings.editHistory.prune": "Prune",
  "settings.editHistory.stats": "Stats",
  "settings.editHistory.save": "Save Edit History Settings",

  // Edit History Modal / Context menu
  "editHistory.title": "Edit History",
  "editHistory.noHistory": "No edit history for this file",
  "editHistory.clearAll": "Clear All",
  "editHistory.close": "Close",
  "editHistory.menuLabel": "Edit History",
  "editHistory.clearHistory": "Clear History",
  "editHistory.confirmClear": "Clear all edit history for this file?",
  "editHistory.confirmClearAll": "Clear all edit history for this file?",

  // Context menu
  "contextMenu.rename": "Rename",
  "contextMenu.tempDownload": "Temp Download",
  "contextMenu.noTempFile": "No temp file found for this file.",

  // Temp files
  "settings.general.tempFiles": "Temporary Files",
  "settings.general.tempFilesDescription": "Manage temporary files saved to Drive before Push.",
  "settings.general.manageTempFiles": "Manage Temp Files",
  "tempFiles.title": "Temporary Files",
  "tempFiles.noFiles": "No temporary files found.",
  "tempFiles.selectAll": "Select All",
  "tempFiles.downloadSelected": "Download Selected",
  "tempFiles.deleteSelected": "Delete Selected",
  "tempFiles.confirmDelete": "Delete the selected temporary files?",
  "tempFiles.savedAt": "Saved at",

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
  "settings.commands.save": "Save Command Settings",
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

  // Index
  "index.title": "Gemini Hub",
  "index.subtitle": "AIワークフローをビジュアルに構築・実行",
  "index.signIn": "Googleでサインイン",
  "index.apiKeyWarning": "Gemini APIキーが設定されていません。AI機能は動作しません。",

  // MainViewer
  "mainViewer.welcome": "Gemini Hubへようこそ",
  "mainViewer.welcomeDescription": "ファイルツリーからファイルを選択して編集を開始するか、上のボタンから新しいワークフローやファイルを作成してください。",
  "mainViewer.retry": "再試行",
  "mainViewer.saved": "保存済み",
  "mainViewer.saving": "保存中...",
  "mainViewer.preview": "プレビュー",
  "mainViewer.wysiwyg": "WYSIWYG",
  "mainViewer.raw": "Raw",

  // ChatPanel
  "chat.newChat": "新しいチャット",
  "chat.noHistory": "チャット履歴はありません",
  "chat.confirmDelete": "このチャットを削除しますか？",

  // Settings
  "settings.title": "設定",
  "settings.tab.general": "一般",
  "settings.tab.mcp": "MCPサーバー",
  "settings.tab.rag": "RAG",
  "settings.tab.encryption": "暗号化",
  "settings.tab.editHistory": "編集履歴",

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
  "settings.general.rootFolderName": "Driveルートフォルダ名",
  "settings.general.rootFolderDescription": "アプリデータの保存に使用するGoogle Driveフォルダの名前。",
  "settings.general.language": "言語",
  "settings.general.fontSize": "フォントサイズ",

  // MCP tab
  "settings.mcp.noServers": "MCPサーバーは設定されていません。",
  "settings.mcp.addServer": "サーバーを追加",
  "settings.mcp.name": "名前",
  "settings.mcp.url": "URL",
  "settings.mcp.headers": "ヘッダー (JSON)",
  "settings.mcp.enabled": "有効",
  "settings.mcp.add": "追加",
  "settings.mcp.save": "MCP設定を保存",

  // RAG tab
  "settings.rag.enable": "RAG（検索拡張生成）を有効にする",
  "settings.rag.topK": "Top-K 結果数",
  "settings.rag.settings": "RAG設定",
  "settings.rag.save": "RAG設定を保存",

  // Encryption tab
  "settings.encryption.setup": "暗号化のセットアップ",
  "settings.encryption.setupDescription": "暗号化キーを生成するためのパスワードを作成してください。このパスワードは復元できません。",
  "settings.encryption.password": "パスワード",
  "settings.encryption.confirmPassword": "パスワード確認",
  "settings.encryption.generateKeys": "キーを生成",
  "settings.encryption.configured": "暗号化が設定されています。",
  "settings.encryption.encryptChat": "チャット履歴を暗号化",
  "settings.encryption.encryptWorkflow": "ワークフロー履歴を暗号化",
  "settings.encryption.reset": "暗号化キーをリセット...",
  "settings.encryption.resetWarning": "すべての暗号化キーが削除されます。暗号化されたデータは読み取れなくなります。よろしいですか？",
  "settings.encryption.confirmReset": "リセットを確認",
  "settings.encryption.save": "暗号化設定を保存",

  // Edit History tab
  "settings.editHistory.maxAge": "最大保存日数",
  "settings.editHistory.maxEntries": "ファイルごとの最大エントリ数",
  "settings.editHistory.contextLines": "コンテキスト行数 (0-10)",
  "settings.editHistory.prune": "整理",
  "settings.editHistory.stats": "統計",
  "settings.editHistory.save": "編集履歴設定を保存",

  // Edit History Modal / Context menu
  "editHistory.title": "編集履歴",
  "editHistory.noHistory": "このファイルの編集履歴はありません",
  "editHistory.clearAll": "すべてクリア",
  "editHistory.close": "閉じる",
  "editHistory.menuLabel": "編集履歴",
  "editHistory.clearHistory": "履歴をクリア",
  "editHistory.confirmClear": "このファイルの編集履歴をすべてクリアしますか？",
  "editHistory.confirmClearAll": "このファイルの編集履歴をすべてクリアしますか？",

  // Context menu
  "contextMenu.rename": "名前を変更",
  "contextMenu.tempDownload": "一時ダウンロード",
  "contextMenu.noTempFile": "このファイルの一時ファイルが見つかりません。",

  // Temp files
  "settings.general.tempFiles": "一時ファイル",
  "settings.general.tempFilesDescription": "Push前にDriveに保存された一時ファイルを管理します。",
  "settings.general.manageTempFiles": "一時ファイルを管理",
  "tempFiles.title": "一時ファイル",
  "tempFiles.noFiles": "一時ファイルが見つかりません。",
  "tempFiles.selectAll": "すべて選択",
  "tempFiles.downloadSelected": "選択をダウンロード",
  "tempFiles.deleteSelected": "選択を削除",
  "tempFiles.confirmDelete": "選択した一時ファイルを削除しますか？",
  "tempFiles.savedAt": "保存日時",

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
  "settings.commands.save": "コマンド設定を保存",
};

const translations: Record<Language, TranslationStrings> = { en, ja };

export function t(language: Language, key: keyof TranslationStrings): string {
  return translations[language]?.[key] ?? translations.en[key] ?? key;
}
