// 네트워크 우선: 온라인이면 항상 최신(배포 직후 바로 반영), 오프라인이면 마지막으로 받은 버전을 캐시에서 제공
const CACHE = "report-brief-v7";
const SHELL_FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL_FILES.map((f) => new Request(f, { cache: "no-cache" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // cache: "no-cache" — 브라우저 HTTP 캐시(GitHub Pages 10분)를 건너뛰고 항상 서버에 새 버전 확인
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => hit || caches.match(e.request, { ignoreSearch: true }))
      )
  );
});

// ── 푸시 알림 ──
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || "리포트 브리프", {
      body: d.body || "새 보고서가 도착했어요",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: d.tag || "brief",
      data: { url: d.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const hit = list.find((c) => c.url.startsWith(self.registration.scope));
      if (hit) return hit.focus().then((c) => c.navigate?.(url) ?? c);
      return self.clients.openWindow(url);
    })
  );
});
