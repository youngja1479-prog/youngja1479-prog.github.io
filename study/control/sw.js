/* 생활 통제 서비스 워커
 * - 화면(index.html)은 항상 최신을 먼저 받아 오고(네트워크 우선), 오프라인일 때만 저장해 둔 화면을 씁니다.
 * - manifest·아이콘 같은 앱 셸은 stale-while-revalidate로 즉시 보여 주고 뒤에서 갱신합니다.
 * - 범위는 /study/control/ 안쪽만 — /study/planner/, /study/outline/, /study/ 허브 요청은 건드리지 않습니다.
 * 캐시 버전을 올리면 activate 때 예전 캐시를 지웁니다.
 */

const VERSION = "1";
const SHELL_CACHE = "control-shell-v" + VERSION;

const SCOPE = new URL("./", self.location.href).pathname; // "/study/control/"
const INDEX_URL = SCOPE + "index.html";
const SW_URL = SCOPE + "sw.js";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<meta name="theme-color" content="#fafafa"><title>생활 통제</title><style>' +
  'html,body{margin:0;height:100%;background:#fafafa;color:#18181b;' +
  'font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif}' +
  'main{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  'min-height:100dvh;gap:10px;text-align:center;padding:24px}' +
  'h1{margin:0;font-size:1.1rem;letter-spacing:-.02em;font-weight:650}' +
  'p{margin:0;color:#71717a;font-size:.85rem;line-height:1.65}' +
  'button{margin-top:12px;min-height:40px;padding:0 16px;border:1px solid #d4d4d8;border-radius:6px;' +
  'background:#fff;color:#18181b;font:inherit;font-size:.85rem;font-weight:600;cursor:pointer}' +
  '</style></head><body><main><h1>생활 통제</h1>' +
  '<p>오프라인 상태예요.<br>연결되면 오늘 기록을 그대로 다시 불러옵니다.</p>' +
  '<button onclick="location.reload()">다시 시도</button></main></body></html>';

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) =>
          name === SHELL_CACHE || name.indexOf("control-") !== 0 ? null : caches.delete(name)
        )
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return; // 바깥 요청은 그대로
  if (url.pathname.indexOf(SCOPE) !== 0) return;  // 이 앱 밖(/study/ 허브 등)은 손대지 않음
  if (url.pathname === SW_URL) return;            // 워커 스크립트 자체는 브라우저가 관리

  const relative = url.pathname.slice(SCOPE.length);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request));
    return;
  }
  if (isShell(relative)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

function isShell(relative) {
  if (!relative || relative === "index.html" || relative === "manifest.json") return true;
  return relative.indexOf("icons/") === 0;
}

async function handleNavigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      cache.put(INDEX_URL, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(INDEX_URL)) || (await cache.match(SCOPE));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const response = await network;
  if (response) return response;
  return new Response("", { status: 504, statusText: "Offline and not cached" });
}
