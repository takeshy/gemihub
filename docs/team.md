# Team & Multi-Tenant Architecture

## Overview

GemiHub supports two usage tiers with different deployment models:

- **Personal Plan (Free):** Shared Cloud Run instance. Each user logs in with their own Google account and works in their own `gemihub/` folder on My Drive.
- **Team Plan (Paid):** Dedicated Cloud Run instance per team. Team members share files via workspace-level sync, with each member's Drive serving as a replica.

## Workspace Model

Users can have multiple workspaces (e.g., personal and team), each mapped to a separate folder on their Google Drive.

```
My Drive/
├── gemihub/              ← Personal workspace
│   ├── my-note.md
│   ├── settings.json
│   ├── history/
│   └── plugins/
└── gemihub-company/      ← Team workspace
    ├── shared-doc.md
    ├── shared-workflow.yml
    ├── settings.json      ← Team-shared settings (MCP servers, RAG, commands)
    ├── history/
    └── plugins/           ← Team-shared plugins
```

### Key Design Decisions

**Why workspaces instead of per-file sync control:**

1. **Clear boundary** — Everything in a team workspace is shared. No ambiguity about which files are team vs. personal.
2. **Independent settings** — Each workspace has its own `settings.json`, `plugins/`, `history/`. Teams can share MCP server configs, RAG settings, and slash commands.
3. **Minimal code changes** — The existing codebase operates entirely through `rootFolderId`. Switching workspace = switching `rootFolderId`. All existing features (`listFiles`, `syncMeta`, `push`, `pull`, `settings`, `history`) work without modification.
4. **`ensureRootFolder` already supports custom names** — The function accepts an optional `folderName` parameter (`google-drive.server.ts`).

### Session Structure

```typescript
// Extended session to support multiple workspaces
interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiryTime: number;
  rootFolderId: string;        // Active workspace's folder ID
  workspaces: Workspace[];     // All available workspaces
  activeWorkspaceIndex: number;
}

interface Workspace {
  name: string;          // Display name (e.g., "Personal", "Company")
  rootFolderId: string;  // Drive folder ID
  folderName: string;    // Drive folder name (e.g., "gemihub", "gemihub-company")
  isTeam: boolean;       // Whether this is a team workspace
}
```

### UI

A workspace switcher dropdown in the header. Switching changes `activeWorkspaceIndex` and updates `rootFolderId` in the session. The rest of the app (file tree, editor, chat, sync) operates on the active `rootFolderId` as before.

## Team Sync

When a team member pushes changes in a team workspace, the server broadcasts those changes to all other team members' Drives in parallel.

### Architecture

```
User A pushes in team workspace
  │
  ▼
Team Cloud Run server
  ├─ 1. Process A's push normally (write to A's Drive)
  ├─ 2. Detect: this is a team workspace
  ├─ 3. Read team-store.json from local filesystem
  ├─ 4. For each other member (B, C, D...):
  │     ├─ Refresh their access token using stored refresh token
  │     └─ Create/update changed files in their Drive
  └─ 5. Return push response to A (broadcast runs async in background)
```

```
Promise.allSettled([
  writeToB(B.token, B.rootId, changedFiles),
  writeToC(C.token, C.rootId, changedFiles),
  writeToD(D.token, D.rootId, changedFiles),
])
// allSettled: one member's token failure doesn't block others
```

### Sync Trigger

Push-triggered broadcast. When a user pushes changes in a team workspace, the server fans out to other members asynchronously. The push response returns immediately without waiting for broadcast completion.

### Conflict Handling

The existing Push/Pull conflict resolution mechanism applies:

1. User A pushes → changes broadcast to B's Drive
2. User B has local edits → B's next push detects MD5 mismatch on Drive
3. Existing conflict resolution dialog prompts B to merge or overwrite

### API Quota

Google Drive API allows ~12 requests/sec/user. For a 5-person team with 10 changed files: ~50 requests, well within limits. For larger teams or bulk changes, implement throttling.

## Deployment Model

### Personal Plan

```
gemihub.example.com → Shared Cloud Run (multi-tenant)
  ├─ Users log in with their own Google accounts
  ├─ Each user gets their own gemihub/ folder
  ├─ Session cookies isolate users (httpOnly, per-browser)
  └─ No team sync, no cross-user token storage
```

### Team Plan

```
team-{id}.gemihub.example.com → Dedicated Cloud Run per team
  ├─ Team members log in with their own Google accounts
  ├─ team-store.json on local filesystem (encrypted with SESSION_SECRET)
  │   └─ Contains all team members' refresh tokens
  ├─ GCS Fuse volume mount for persistence across scale-in/out
  └─ Push in team workspace → broadcast to all members
```

Dedicated Cloud Run per team solves:

| Problem | Solution |
|---------|----------|
| Multiple server instances sharing state | One team = one dedicated instance, local file works |
| Security of storing others' refresh tokens | Server-side only, never sent to clients |
| Risk of accessing personal workspace via team token | Team Cloud Run only handles team workspace; no code path to personal `gemihub/` |
| Admin Drive circular dependency | Local filesystem, no Drive access needed for token store |

### Cloud Run Configuration

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: gemihub-team-{id}
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/execution-environment: gen2
    spec:
      containers:
        - image: gcr.io/project/gemihub
          env:
            - name: TEAM_MODE
              value: "true"
            - name: TEAM_WORKSPACE_NAME
              value: "gemihub-company"
          volumeMounts:
            - name: team-data
              mountPath: /data
      volumes:
        - name: team-data
          csi:
            driver: gcsfuse.run.googleapis.com
            volumeAttributes:
              bucketName: gemihub-team-{id}-data
```

### Team Provisioning Flow

1. User subscribes to a team plan
2. Automated provisioning:
   - Create GCS bucket (`gemihub-team-{id}-data`)
   - Deploy Cloud Run service (`team-{id}.gemihub.example.com`)
   - No OAuth redirect URI changes needed (single shared URI, see below)
3. Team members access `team-{id}.gemihub.example.com`
4. Google login (via shared OAuth gateway) → refresh token saved to `team-store.json` on server
5. Subsequent pushes in team workspace trigger broadcast to all members

## Token Store

### Structure

```json
{
  "members": [
    {
      "userId": "hashed-user-id",
      "refreshToken": "AES-256-GCM encrypted token",
      "rootFolderId": "drive-folder-id",
      "joinedAt": "2026-02-17T00:00:00Z",
      "status": "active"
    }
  ]
}
```

### Security

- Refresh tokens encrypted with AES-256-GCM using `SESSION_SECRET` as key (same pattern as `geminiApiKey` encryption in `session.server.ts`)
- File stored on server filesystem only, never transmitted to clients
- Persisted via GCS Fuse mount (encrypted at rest by GCS)

### Token Expiry Handling

- Google OAuth refresh tokens can expire (especially for test-mode OAuth apps: 7-day limit)
- On broadcast failure due to expired token, mark member status as `"needs_reauth"`
- Display re-authentication prompt when that member next logs in

## OAuth Considerations

### Scope

No scope change required. The existing `drive.file` scope works because:

- Each user authenticates with their own Google account
- The server writes to each user's Drive using that user's own token
- Files created by GemiHub are accessible via the `drive.file` scope

### OAuth Consent Screen

- **Same Google Workspace org:** Set user type to "Internal" (all org members can log in)
- **External users:** Set to "External" and add users as test users (up to 100), or publish the app for unrestricted access

### Redirect URIs — Shared OAuth Gateway

A single redirect URI is registered in the Google OAuth client, regardless of how many teams exist:

```
https://gemihub.example.com/auth/google/callback
```

Team Cloud Run instances do **not** register their own redirect URIs. Instead, the OAuth flow routes through the shared gateway:

```
1. User visits team-abc.gemihub.example.com
2. → Redirects to gemihub.example.com/auth/google?team=team-abc
3. → OAuth state parameter includes { ..., team: "team-abc" }
4. → Google OAuth redirect_uri = gemihub.example.com/auth/google/callback (always the same)
5. → Callback decodes state, extracts team=team-abc
6. → Exchanges authorization code for tokens
7. → Redirects to team-abc.gemihub.example.com with session/token set
```

```
                        Single OAuth redirect URI
                                  │
team-abc.gemihub.example.com ─┐   ▼
team-xyz.gemihub.example.com ─┼→ gemihub.example.com/auth/google/callback
gemihub.example.com ──────────┘   │
                                  ├─ Decode team ID from state parameter
                                  └─ Redirect to team URL with session
```

This avoids the Google OAuth redirect URI limit and eliminates per-team OAuth configuration.

## Security Considerations

### Critical

#### 1. Cross-Domain Token Relay

The OAuth gateway (gemihub.example.com) must pass tokens to the team URL (team-abc.gemihub.example.com). Naive approaches are insecure:

- **URL parameters:** Tokens leak to browser history, Referer headers, server logs.
- **Parent domain cookie (`.gemihub.example.com`):** All team subdomains can read each other's session cookies, destroying tenant isolation.

**Mitigation:** Use a short-lived, single-use authorization code exchange:

```
1. Gateway generates a random code, stores it server-side (60s TTL) mapped to tokens
2. Redirect to team-abc.gemihub.example.com/auth/relay?code=<random>
3. Team server exchanges code for tokens via server-to-server call to gateway
4. Code is deleted after use
```

This mirrors OAuth's own authorization code flow and never exposes tokens to the browser.

#### 2. Refresh Token Scope Exceeds Team Workspace

The `drive.file` scope grants access to ALL files GemiHub has created for a user, not just the team workspace folder. A compromised team server could use a member's stored refresh token to access their personal `gemihub/` folder.

The claim "no code path to personal workspace" is a software-level restriction, not a security boundary.

**Mitigation:** Use separate OAuth client IDs for personal and team instances. Files created under the personal OAuth client are not accessible to tokens from the team OAuth client, providing OAuth-level isolation.

#### 3. Token Encryption Key Management

All team members' refresh tokens are encrypted with a single key derived from `SESSION_SECRET` via simple SHA-256 (no salt, no iterations). Risks:

- `SESSION_SECRET` leak = all tokens compromised
- Same secret used for cookie signing and token encryption
- Weak key derivation (no KDF)

**Mitigation:**
- Introduce a separate `TEAM_TOKEN_ENCRYPTION_KEY` environment variable
- Use PBKDF2 with per-member salt (same pattern as `crypto-core.ts` private key encryption)
- Add `keyVersion` field for key rotation support

### High

#### 4. Team Membership Authorization

No mechanism to validate who can join a team. Anyone who discovers the team URL can log in and have their token stored.

**Mitigation:**
- Implement invitation links with HMAC-signed tokens and expiry
- Validate user email/ID against an allowlist on callback
- Require admin approval for new members
- Enforce maximum member count per plan tier

#### 5. OAuth State Parameter Integrity

Embedding the team ID in the OAuth `state` parameter creates a tampering risk. An attacker could modify the team field to redirect their OAuth flow to a different team.

**Mitigation:** Store team ID server-side in the session, associated with the state UUID. The state parameter remains an opaque token. Alternatively, HMAC-sign the entire state value with the server secret.

#### 6. Content Injection via Broadcast

Broadcast writes file content directly to members' Drives with no validation. A malicious team member could push:

- Markdown with XSS payloads
- Workflow YAML with `http`/`mcp` nodes pointing to attacker-controlled servers
- Modified `settings.json` adding malicious MCP server configurations

**Mitigation:**
- Validate workflow YAML against the known node type schema
- Schema-validate `settings.json` on broadcast, reject unknown fields or new MCP servers without admin approval
- Ensure the markdown editor sanitizes HTML output (verify existing sanitization is robust)

#### 7. GCS Bucket IAM

The GCS bucket storing `team-store.json` must have strict IAM policies.

**Mitigation:**
- Dedicated service account per team bucket (`roles/storage.objectAdmin` on that bucket only)
- Uniform bucket-level access control
- Enable audit logging and consider CMEK (Customer-Managed Encryption Keys)
- Alternatively, use Secret Manager instead of GCS for the token store

### Medium

#### 8. Cookie Isolation

- Never set cookie `domain` to `.gemihub.example.com`; each instance sets cookies for its own exact hostname only
- Use distinct cookie names per instance (e.g., `__session_team_{id}`) to prevent collisions
- Consider `sameSite: "strict"` for team instances

#### 9. Rate Limiting

- Enforce maximum member count per team plan
- Rate-limit the join flow
- Prune inactive/`needs_reauth` members after a configurable period

#### 10. Broadcast Failure Handling

- Log all broadcast failures with member ID and error details
- Store `lastBroadcastStatus` per member in team-store.json
- Surface failures in UI for team admins
- Implement catch-up mechanism for members that missed broadcasts

#### 11. CSRF Protection

- Add Origin header validation on all POST endpoints for team instances
- Explicit CSRF tokens for state-mutating API endpoints

### Low

#### 12. Plugin Code Execution

Team-shared plugins execute arbitrary JavaScript in all members' browsers. Require admin approval for plugin installation in team workspaces.

#### 13. team-store.json Race Conditions

GCS Fuse is eventually consistent. Concurrent writes (two members joining simultaneously, join during broadcast) could cause data loss. Use optimistic locking with a version field and retry logic, or consider Firestore for transactional guarantees.

#### 14. Audit Logging

Implement structured audit logging for all token-store operations: member join/leave, token usage for broadcast, reauth events. Log to a separate append-only store.
