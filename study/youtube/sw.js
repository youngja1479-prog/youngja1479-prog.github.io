/* SY 서비스 워커
 * - videos/channels/comments/index 같은 데이터는 항상 최신(네트워크 우선) + 오프라인 fallback
 * - index.html·아이콘·manifest 같은 앱 셸은 stale-while-revalidate
 * 캐시 버전을 올리면 activate 때 예전 캐시를 지웁니다.
 */

const VERSION = "1";
const SHELL_CACHE = "sy-shell-v" + VERSION;
const DATA_CACHE = "sy-data-v" + VERSION;

const SCOPE = new URL("./", self.location.href).pathname; // "/study/youtube/"
const INDEX_URL = SCOPE + "index.html";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// 설치 직후에도 오프라인에서 목록이 보이도록 작은 데이터 파일은 미리 담아 둡니다.
// (index/*.json 은 채널 전체라 3MB가 넘어서 쓰는 것만 담습니다.)
const DATA_PRECACHE = ["./videos.json", "./channels.json", "./comments/index.json", "./index/manifest.json"];

const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<meta name="theme-color" content="#121214"><title>SY</title><style>' +
  'html,body{margin:0;height:100%;background:#121214;color:#f4f4f5;' +
  'font-family:ui-sans-serif,system-ui,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}' +
  'main{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  'min-height:100dvh;gap:10px;text-align:center;padding:24px}' +
  'h1{margin:0;font-size:2rem;letter-spacing:-.02em;color:#e8c56b}' +
  'p{margin:0;color:#a1a1aa;font-size:.9rem;line-height:1.6}' +
  'button{margin-top:10px;min-height:44px;padding:0 20px;border:1px solid #2e2e34;border-radius:12px;' +
  'background:#1c1c20;color:#f4f4f5;font:inherit;font-weight:650;cursor:pointer}' +
  '</style></head><body><main><h1>SY</h1>' +
  '<p>오프라인 상태예요.<br>인터넷에 연결되면 목록을 새로 불러옵니다.</p>' +
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
      const dataCache = await caches.open(DATA_CACHE);
      await Promise.all(
        DATA_PRECACHE.map((url) =>
          dataCache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.map((name) => (keep.has(name) ? null : caches.delete(name))));
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
  if (url.origin !== self.location.origin) return; // 썸네일·플레이어는 그대로 통과
  if (url.pathname.indexOf(SCOPE) !== 0) return; // 이 앱 밖(/study/outline/ 등)은 손대지 않음

  const relative = url.pathname.slice(SCOPE.length);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request));
    return;
  }
  if (isData(relative)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (isShell(relative)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});

function isData(relative) {
  return (
    relative === "videos.json" ||
    relative === "channels.json" ||
    relative === "shorts-cache.json" ||
    relative.indexOf("comments/") === 0 ||
    relative.indexOf("index/") === 0
  );
}

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

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const response = await network;
  if (response) return response;
  return new Response("", { status: 504, statusText: "Offline and not cached" });
}
