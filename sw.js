// sw.js
self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  // 기본 네트워크 요청을 그대로 처리함
  e.respondWith(fetch(e.request));
});