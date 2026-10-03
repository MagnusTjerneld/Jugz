// Jugz moved into Puzzles. This service worker replaces the old one at the same address, so a visitor whose
// browser still has the old game cached gets this instead: it deletes the old caches, unregisters itself and reloads
// open pages, which then load the redirect in index.html from the network.
// Only this app's own caches: Puzzles lives on the same origin and keeps its own.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /^jugz-/.test(k)).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach((c) => c.navigate(c.url));
  })());
});
