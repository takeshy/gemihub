// Hybrid encryption utilities using Web Crypto API.
// Shared by client and server (no .server.ts suffix). The implementation and
// its on-disk format live in gemihub-sync-core so GemiHub web, Obsidian and
// Desktop read and write the same encrypted files.

export * from "gemihub-sync-core/crypto";
