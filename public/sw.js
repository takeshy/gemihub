// Retire the note application's service worker after the domain handover.
// Keep IndexedDB and unrelated caches intact: they may contain unsynced notes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("gemihub-sw-")).map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
