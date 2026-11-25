/* Keeps Radar POI on the phone: page and scripts are fetched fresh when there is signal (cached copy when not);
   map images, fonts and the Excel library come from the phone's cache. Google Sheet / Drive calls are never cached. */
const V = "poi-v1";
const CORE = ["./", "index.html", "config.js", "shim.js", "logo-bni.png", "map-light.webp"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function fresh(req) {
  return fetch(req).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html")));
}
function stored(req) {
  return caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (/script\.google|googleusercontent|drive\.google/.test(u.hostname)) return;
  if (u.origin === location.origin) {
    if (req.mode === "navigate" || /\.(html|js)$/.test(u.pathname) || u.pathname.endsWith("/")) { e.respondWith(fresh(req)); return; }
    e.respondWith(stored(req)); return;
  }
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(u.hostname)) e.respondWith(stored(req));
});
