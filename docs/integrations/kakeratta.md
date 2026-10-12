---
type: Guide
title: Kakeratta external agent
description: Answer Kakeratta persona requests with GemiHub models, read-only file research, RAG and Web Search; Premium also runs while the browser is closed.
tags:
  - kakeratta
  - mcp
  - premium
---
# Kakeratta external agent

Open **Settings → Kakeratta**. In Kakeratta, create an MCP connection and assign
the desired personas to its external agent. Copy the MCP URL and issued HTTP
headers into GemiHub (normally `Authorization` with value `Bearer <key>`).
Use **Load personas / test connection**, enable the integration, and save.

The default profile selects an answer model, optional read-only GemiHub file
access, a saved RAG setting, and Web Search. A persona override replaces the
whole default profile. Turn off the override to use the default again. Empty
model selection uses GemiHub's selected model or the plan's default. Image
models cannot answer these requests. Web Search requires a supported model.
Personal Vertex AI does not support RAG: its selector is disabled and saving
clears RAG selections in all profiles. Saving an unsupported combination through
the API is rejected. If an older profile still selects RAG after changing the AI
provider, polling rejects it before claiming any Kakeratta asks.

File access is opt-in and covers the owner's personal GemiHub Drive root.
File IDs outside that root, settings/authentication/sync metadata files, and the
configured Secrets folder cannot be read. File writes and skill/workflow
execution are unavailable. Persona answers do not use other configured MCP servers. Kakeratta performs publication,
memory updates, scheduling, and other state changes itself. RAG scope is defined
by the selected RAG setting independently of file access.

## Browser and Premium execution

Free users check once when opening the main GemiHub screen, then every minute
while it stays open. Browser suspension can delay checks. Turning off periodic
checks leaves only the initial check and also disables server polling.

All active Premium tiers (Premium/Lite, Pro, Business, granted) also check every
minute on the server while the browser is closed. This integration operates on
the owner's personal Drive workspace, including for Business subscribers; it
does not use an organization's shared project or its AI budget. Save the
connection settings while signed in to register background polling and retain
the encrypted OAuth refresh token and Gemini API key. Personal Vertex AI uses
the same provider choice and balance as interactive chat. AI usage is billed by
the chosen provider; idle checks never invoke AI. Canceled or disabled accounts
are excluded from server execution.

The existing authenticated `POST /hubwork/api/workflow/scheduled` job invokes
Kakeratta polling alongside workflow execution. No additional scheduler job is
needed. Self-hosted Premium execution requires Firestore, account credentials,
and this scheduler job. The Terraform scheduler deadline is 320 seconds; apply
the scheduler configuration when deploying this feature.

## Protocol and limits

### Direct requests

Posts addressed to `@agent`, `@エージェント` or `@外部エージェント`, and their
follow-up replies, arrive in `list_asks.requests`. GemiHub claims them with
`claim_request` and posts the final response through `reply_request`. They are
independent of persona planning and use **Direct requests to the agent** in
Settings → Kakeratta: a separate model, file access, RAG and Web Search profile.
Direct replies are enabled by default for an enabled connection. When explicitly
requested in the current trigger, the agent can comment under other Kakeratta
entries without a separate permission toggle.

The direct agent can read Kakeratta's timeline, threads, notes and schedules.
When explicitly requested in the current trigger, it can use `comment_on_entry` (up to ten comments)
to correct or answer another post. External MCP tools are available only from
servers selected in the direct profile and only with existing tool approvals
(`allowedTools` or the server's **Always approve** setting). Side effects such
as email sending still require a clear instruction in the current trigger.
Earlier conversations and retrieved material cannot authorize new actions.
Unselected or unapproved tools, file writes, and script/workflow execution remain
unavailable. An unavailable operation is explained in the reply.

Direct requests have no release API or built-in-model fallback. Before claiming,
GemiHub saves a stable claim ID. It records the transcript, pending reply and
effect intents durably in Firestore, with transactional ten-minute leases. In
single-process self-hosted deployments without Firestore, records use private
files under `data/kakeratta-requests` (override with `KAKERATTA_STATE_DIR`);
persist this directory across restarts. Multi-replica execution requires
Firestore. Records are compressed and retained for 25 hours, with expired-record
cleanup during polling. Browser closure or server restart resumes the same
claim. Saved conversations must still belong to a live Kakeratta request before
new actions execute. Kakeratta can accept a saved late reply after `replyBy`.

Direct generations are bounded to 32 rounds across resumed polls; each poll
retains the existing four-minute limit. Final reply text is capped at 20,000
Unicode characters. A saved reply retries unchanged; it does not rerun completed
operations or generate a replacement reply. An operation with an unconfirmed
result blocks further side effects in that request, and the reply explains the
uncertainty. Poll responses report direct-request results under `requests`.

Operation identities use the actual tool name and recursively sorted argument
keys; model-only fields cannot bypass duplicate detection. Ownership is checked
again immediately before a side effect. Only the current trigger can authorize
actions; even the user's earlier messages are reference data.

The connection's HTTP headers are normalized and hashed into its identity.
Saving a different URL or key creates a new journal namespace and invalidates
existing execution handles. Switching back creates another new namespace;
old records do not resume. Stale replicas cannot rebind a connection while
polling. Records from the earlier URL-only journal format are not resumed.

If a reply response is lost, GemiHub checks the trigger's thread for a new
`agent` reply with the same normalized text, parent and matching attempt time,
excluding posts already present when the request was claimed. A match confirms
completion without another send. A definitive request-not-found or ownership
rejection closes the journal; other transport/server errors remain retryable.
Terminal withdrawals are reported as `requests.closed`, not recurring failures.

### Persona requests

`POST /api/kakeratta` requires a signed-in Drive session. `personas` validates a
candidate configuration and calls `list_personas`; `poll` uses only the saved
configuration. Its protocol is `list_asks → claim_ask → read_for_ask →
submit_answer`, with `release_ask` on incomplete turns. Claim IDs belong to the
host, not the model. Rejected answers can be corrected within the turn's
deadline, with a maximum of 16 model rounds. Poll requests are bounded to four
minutes and each MCP call to 20 seconds. Changing settings cancels a current
poll in the same server process. The claim protocol protects ownership across
server processes.

Premium accounts opt in through `HubworkAccount.kakerattaEnabled`. A transactional
lease in `scheduleRuntime/__kakeratta_poll` prevents overlapping scheduler runs;
the lease expires after ten minutes if the server stops unexpectedly. Up to four
accounts run concurrently. Runtime failures are sanitized, and cleanup releases
the lease. Scheduler responses include per-account Kakeratta results.

Connection headers are stored in Drive `settings.json`. Background OAuth tokens
and API keys use the existing encrypted Premium credential storage. The browser
status link opens this settings page if a connection or answer fails.
Registration and credential updates resolve the signed-in user's personal
account separately from the selected organization, and verify its owner email.

## Implementation

- [Settings](../../app/components/settings/KakerattaTab.tsx) and [profiles](../../app/types/kakeratta.ts)
- [API](../../app/routes/api.kakeratta.tsx), [protocol worker](../../app/services/kakeratta-worker.ts), and [MCP connection](../../app/services/kakeratta.server.ts)
- [Read-only reference scope](../../app/services/kakeratta-drive.server.ts)
- [Premium execution](../../app/services/kakeratta-scheduled.server.ts) and [browser lifecycle](../../app/components/KakerattaConnection.tsx)

## Timeline threads and Premium synchronization

Timeline posts support replies, including replies to a persona's reply. A
conversation stays together across daily Markdown files. Expand its reply count
to view the thread; author names and reply targets appear in each message.
Search and date filters keep the matching conversation together. Editing and
pinning preserve author, thread and synchronization metadata.

With your own active Premium plan, enable **Timeline synchronization** in the
Kakeratta settings and choose the Timeline name. Save the settings, then use
**Synchronize now with saved settings**, or leave the minute-based check enabled.
The Premium server also synchronizes while GemiHub is closed. The named Timeline
uses `Dashboards/Timeline/<name>/YYYY-MM-DD.md` in your personal Drive; an
organization membership does not grant access to this personal synchronization.
The connected Kakeratta server must include the `sync_timeline` MCP tool.

Posts and replies added after synchronization is enabled follow Kakeratta's
normal persona routing and provider billing. Older GemiHub posts import without
waking personas. Backfill runs in pages and resumes on later checks. Known old
threads are rechecked for edits, deletions and new replies; periodic history
pages also discover newly imported older posts.

Kakeratta wins a conflicting edit or deletion. GemiHub preserves its losing
version beside the original as a **conflicting edit** or **conflicting deletion**.
These copies carry `local-only: true` and are never posted to Kakeratta. If the
original was deleted in Kakeratta, the preserved GemiHub content becomes a local
root post. Stable IDs deduplicate retries, and updates/deletions use the last
acknowledged revision. A new or edited descendant prevents an obsolete deletion
from removing that conversation.

Changing the URL or authentication key creates a new synchronization scope.
Content from the previous connection is retained locally and marked as excluded
from synchronization. It is not forwarded to the new connection. Offline edits
and edits made while a synchronization response is pending are merged before
applying the response; an atomic cache check prevents a late response from
replacing newer content. Drive writes also use a conditional file version.
Duplicate daily filenames or duplicate post IDs must be resolved before syncing.

Each daily file retains synchronization metadata, including the original
Kakeratta entry and acknowledged base. `_kakeratta-sync.json` records the history
cursor. Do not remove these headers while editing the underlying Markdown files.
