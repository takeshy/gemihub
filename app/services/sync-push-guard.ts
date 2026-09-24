// Push preflight guards — implemented in gemihub-sync-core (shared protocol).

export {
  indexUniqueRemotePaths,
  findAmbiguousPushPaths,
  remoteChangedSincePushSnapshot,
  findPendingDeletionsChangedOnRemote,
  type PushSnapshotEntry,
} from "gemihub-sync-core/protocol";
