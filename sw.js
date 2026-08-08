// Surfer's Blog Service Worker — 离线可读
// 策略：页面导航 = SWR（先回缓存离线可读，后台更新缓存，文章更新不失效）；
//       静态资源 = cache-first（文件名带 hash 天然免疫过期）。
// 版本号变更 = 全量换新缓存。
// 每次改 JS/CSS/组件后必须 bump（否则 SW 缓存旧资源，用户看到旧版/旧交互）。
const VERSION = 'surfer-v5';
const CACHE = `surfer-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域（Waline 等）不缓存
  // dev 资源不缓存：/src/、/@vite/ 等模块路径无 hash，cache-first 会永远返回旧代码
  // （曾导致 View Transitions 修复不生效、主题导航后变暗的假象）
  if (url.pathname.startsWith('/src/') || url.pathname.includes('/@vite/') || url.pathname.includes('/@fs/') || url.pathname.includes('/@id/')) return;

  // 页面导航：生产 SWR（先回缓存离线可读，后台更新）；dev network-first（内容常变，缓存仅离线兜底）
  if (request.mode === 'navigate') {
    // dev：localhost/127.0.0.1，或非标准端口（80/443 之外 = dev server，含局域网 IP 真机调试）
    const isDev = ['localhost', '127.0.0.1'].includes(self.location.hostname)
      || !['80', '443'].includes(self.location.port);
    if (isDev) {
      event.respondWith(
        fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => caches.match(request)),
      );
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => cached); // 离线 → 回缓存
        return cached || network;
      }),
    );
    return;
  }

  // 静态资源：cache-first，未命中才拉取并缓存
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    }),
  );
});
