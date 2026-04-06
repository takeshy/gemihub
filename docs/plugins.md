# Plugins

Extend Gemini Hub with community plugins installed from GitHub Releases. Inspired by Obsidian + BRAT.

## Features

- **GitHub Release Install**: Install plugins from any public GitHub repo
- **Trusted Execution**: Plugins run with the same privileges as the host app. Only install plugins you trust
- **Drive Storage**: Plugin files and data stored in Google Drive (`plugins/` folder)
- **IndexedDB Cache**: Plugin assets cached client-side for fast loading
- **Hot Enable/Disable**: Toggle plugins without page reload
- **Plugin API**: Access Gemini AI, Drive files, Google Calendar, Gmail, and plugin-scoped storage

## For Users

### Installing a Plugin

1. Go to **Settings > Plugins**
2. Enter the GitHub repository (e.g. `owner/repo` or `https://github.com/owner/repo`)
3. Click **Install**

The latest GitHub Release must contain at least `manifest.json` and `main.js`. `styles.css` is optional.

### Managing Plugins

| Action | Description |
|--------|-------------|
| **Enable/Disable** | Toggle the power icon next to the plugin |
| **Update** | Click the refresh icon to pull the latest release |
| **Uninstall** | Click the trash icon (removes all plugin data from Drive) |

### Where Plugin Data is Stored

```
gemihub/
  plugins/
    {plugin-id}/
      manifest.json   ← Plugin metadata
      main.js          ← Plugin code
      styles.css       ← Plugin styles (optional)
      data.json        ← Plugin-scoped storage
```

---

## For Plugin Developers

### Project Structure

A plugin release must contain these assets:

| File | Required | Description |
|------|----------|-------------|
| `manifest.json` | Yes | Plugin metadata |
| `main.js` | Yes | Plugin entry point (bundled) |
| `styles.css` | No | Plugin styles |

### manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",  // reserved for future use
  "description": "What my plugin does",
  "author": "Your Name",
  "assets": [
    { "name": "model.wasm", "url": "https://cdn.example.com/model.wasm" }
  ]
}
```

The `id` must be unique and is used as the Drive folder name and IndexedDB cache key.

The optional `assets` array declares external files (e.g. WASM binaries, large models) that the plugin needs at runtime. Each entry has a `name` (filename to reference from code) and a `url` (HTTPS URL the server downloads from). See [External Assets](#external-assets) for details.

### main.js

Build with esbuild (or similar) with `react` and `react-dom` as externals. The entry point must export a class with an `onload` method:

```javascript
class MyPlugin {
  onload(api) {
    // Called when plugin is loaded
    // Use api to register views, commands, or call host APIs
  }

  onunload() {
    // Called when plugin is disabled or uninstalled
    // Clean up event listeners, timers, etc.
  }
}

// Both export styles are supported:
module.exports = MyPlugin;
// or: module.exports.default = MyPlugin;
```

Example esbuild config:

```javascript
require("esbuild").build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  external: ["react", "react-dom", "react-dom/client"],
  jsx: "automatic",
});
```

### Plugin API

The `api` object passed to `onload` provides:

#### Language

```typescript
// Current language setting ("en", "ja", etc.)
const lang = api.language;
```

#### UI Registration

```typescript
// Register a sidebar or main view
api.registerView({
  id: "my-view",
  name: "My View",
  icon: "puzzle",       // optional icon identifier
  location: "sidebar", // or "main"
  extensions: [".csv", ".tsv"], // optional: dot-prefixed file extensions (main views only)
  component: MyReactComponent, // receives { api, fileId?, fileName? } as props
});

// Register a slash command for the chat
api.registerSlashCommand({
  name: "my-command",
  description: "Does something",
  execute: async (args) => {
    return "result text";
  },
});

// Register a settings tab (shown in Settings > Plugins via gear icon)
api.registerSettingsTab({
  component: MySettingsComponent, // receives { api, onClose } as props
});
```

#### Gemini AI

```typescript
const response = await api.gemini.chat(
  [
    { role: "user", content: "Hello" },
  ],
  {
    model: "gemini-2.5-flash",      // optional
    systemPrompt: "You are helpful", // optional
  }
);
// response is the model's text reply
```

#### Active File Change Listener

```typescript
// Subscribe to file selection changes in the IDE
const unsubscribe = api.onActiveFileChanged(({ fileId, fileName, mimeType }) => {
  if (fileId) {
    console.log(`File opened: ${fileName} (${fileId})`);
  } else {
    console.log("File closed");
  }
});

// Call the returned function to unsubscribe
unsubscribe();
```

#### Google Drive

All drive operations are local-first — reads come from the IndexedDB cache (with server fallback on cache miss), and writes update the local cache and edit history. Changes are synced to Google Drive when the user pushes.

```typescript
// Read a file
const content = await api.drive.readFile(fileId);

// Search files by name
const files = await api.drive.searchFiles("query");

// List files in a folder (omit folder to list files in the gemihub root folder)
const files = await api.drive.listFiles(folder);

// Create a text file (created in the gemihub root folder)
const { id, name } = await api.drive.createFile("notes.md", "# Notes");

// Create a binary file (pass ArrayBuffer)
const response = await fetch(imageUrl);
const buffer = await response.arrayBuffer();
const { id, name } = await api.drive.createFile("photo.png", buffer);

// Update a file (text)
await api.drive.updateFile(fileId, "new content");

// Update a file (binary — updated locally, push to sync to Drive)
await api.drive.updateFile(fileId, arrayBuffer);

// Rebuild the file tree from Drive
await api.drive.rebuildTree();
```

> **Note:** `createFile` returns a temporary `new:*` prefixed ID for newly created files. This ID works with all other `api.drive` methods. After a push, the file receives a real Drive ID. `updateFile` automatically resolves stale `new:*` IDs by falling back to file name lookup.

#### Google Calendar (Premium)

Requires the premium plan with calendar scope. The `calendar` property is optional — check for its existence before use.

```typescript
if (api.calendar) {
  // List events
  const events = await api.calendar.listEvents({
    timeMin: "2026-04-01T00:00:00Z",
    timeMax: "2026-04-30T23:59:59Z",
    maxResults: 10,
  });

  // Create an event
  const { eventId, htmlLink } = await api.calendar.createEvent({
    summary: "Meeting",
    start: "2026-04-10T10:00:00+09:00",
    end: "2026-04-10T11:00:00+09:00",
  });

  // Update an event
  await api.calendar.updateEvent(eventId, { summary: "Updated Meeting" });

  // Delete an event
  await api.calendar.deleteEvent(eventId);
}
```

#### Gmail (Premium)

Requires the premium plan with gmail.send scope. The `gmail` property is optional — check for its existence before use.

```typescript
if (api.gmail) {
  const { messageId } = await api.gmail.sendEmail({
    to: "recipient@example.com",
    subject: "Hello from GemiHub",
    body: "<p>This is an HTML email.</p>",
    cc: "cc@example.com",    // optional
    bcc: "bcc@example.com",  // optional
  });
}
```

#### Plugin Storage

Each plugin has its own `data.json` on Drive for persistent key-value storage:

```typescript
// Get a value
const value = await api.storage.get("myKey");

// Set a value
await api.storage.set("myKey", { count: 42 });

// Get all stored data
const all = await api.storage.getAll();
```

#### External Assets

Plugins can declare external assets (WASM binaries, ML models, etc.) in `manifest.json`. The server acts as a caching proxy — it downloads the file from the declared URL on the first request and serves it from the local cache (`data/plugins/{id}/`) on subsequent requests.

```typescript
// Fetch a declared asset by name (returns ArrayBuffer)
const buf = await api.assets.fetch("model.wasm");
const module = await WebAssembly.instantiate(buf);
```

**Rules:**
- Assets must be declared in the `assets` array of `manifest.json`. Requests for undeclared names are rejected (403).
- URLs must use HTTPS. Private/internal addresses (localhost, 169.254.x, 10.x, etc.) are blocked.
- The asset cache is automatically cleared on plugin update or uninstall.
- Asset names must be flat filenames (no `/`, `\`, or leading `.`).

#### React

The host's React instances are available to avoid version mismatches:

```typescript
const React = api.React;
const ReactDOM = api.ReactDOM;
```

### View Components

View components receive `{ api, fileId?, fileName? }` as props. `fileId` and `fileName` are provided when a file is currently open (always set for extension-matched views, optional for panel-selected main views):

```tsx
function MyPanel({ api, fileId, fileName }) {
  const React = api.React;
  const [data, setData] = React.useState(null);

  React.useEffect(() => {
    if (fileId) {
      api.drive.readFile(fileId).then(setData);
    }
  }, [fileId]);

  return <div>{fileName}: {JSON.stringify(data)}</div>;
}
```

- **Sidebar views** appear as tabs in the right panel (alongside Chat and Workflow)
- **Main views** replace the file editor in the main area

### Security

- Plugins run with the same privileges as the host app (full access to DOM, `fetch`, etc.)
- Only install plugins from sources you trust
- `require()` shim only provides `react`, `react-dom`, and `react-dom/client`
- Plugin code runs in the browser, not on the server

### Local Development

In development mode (`NODE_ENV !== "production"`), plugins can be loaded directly from the local filesystem without installing via GitHub. Place your plugin files in the `plugins/{id}/` directory at the project root:

```
plugins/
  my-plugin/
    manifest.json
    main.js
    styles.css     ← optional
```

Local plugins are automatically detected and always enabled. The IndexedDB cache is bypassed, so changes to `main.js` or `styles.css` take effect on the next page reload without needing to update the version. Local plugins cannot be uninstalled from the UI — simply remove the directory to unload them.

### Publishing

1. Create a GitHub repository for your plugin
2. Build `main.js` and `manifest.json` (and optionally `styles.css`)
3. Create a GitHub Release and attach the files as release assets
4. Users install via `owner/repo` in Settings > Plugins

To publish an update, create a new release with an updated version tag. Users click the update button to pull the latest.

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/plugins` | List installed plugins |
| POST | `/api/plugins` | Install plugin `{ repo }` |
| GET | `/api/plugins/:id?file={name}` | Serve plugin file (main.js, styles.css, manifest.json) |
| GET | `/api/plugins/:id?asset={name}` | Serve a cached external asset declared in manifest |
| POST | `/api/plugins/:id` | Actions: `toggle`, `getData`, `setData`, `update`, `checkUpdate` |
| DELETE | `/api/plugins/:id` | Uninstall plugin |
| POST | `/api/calendar` | Calendar operations: `list`, `create`, `update`, `delete` |
| POST | `/api/gmail` | Gmail operations: `send` |
