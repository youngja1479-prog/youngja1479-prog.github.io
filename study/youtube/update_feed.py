#!/usr/bin/env python3
"""YouTube RSS에서 허용 채널의 최신 영상을 모아 videos.json을 만듭니다."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}

HERE = Path(__file__).resolve().parent
CHANNELS_PATH = HERE / "channels.json"
OUT_PATH = HERE / "videos.json"
SHORTS_CACHE_PATH = HERE / "shorts-cache.json"
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={id}"
UA = "GKC-study-youtube-feed/1.0 (+https://youngja1479-prog.github.io/study/youtube/)"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
SHORTS_CHECK_WORKERS = 8


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 — 리다이렉트를 따라가야 판별되므로 막습니다
        return None


def load_short_cache() -> dict[str, int]:
    """{videoId: 1(쇼츠) | 0(일반)} 캐시."""
    if not SHORTS_CACHE_PATH.is_file():
        return {}
    try:
        data = json.loads(SHORTS_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    raw = data.get("map") if isinstance(data, dict) else None
    cache: dict[str, int] = {}
    for key, value in (raw or {}).items():
        if isinstance(key, str) and value in (0, 1, True, False):
            cache[key] = 1 if value in (1, True) else 0
    return cache


def save_short_cache(cache: dict[str, int]) -> None:
    payload = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "map": {k: cache[k] for k in sorted(cache)},
    }
    SHORTS_CACHE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def probe_short(video_id: str, timeout: int = 15) -> int | None:
    """쇼츠 여부를 두 가지 신호로 판별합니다.

    1) `/vi/{id}/oardefault.jpg` — 쇼츠에만 생기는 세로 썸네일 (CDN, 아주 빠름)
    2) `/shorts/{id}` 가 303으로 `/watch?v=`로 보내면 일반 영상, 200 + 쇼츠 페이지면 쇼츠
    판별이 안 되면 None (모르는 상태로 두고 다음 실행에서 다시)
    """
    oar = f"https://i.ytimg.com/vi/{video_id}/oardefault.jpg"
    try:
        head = urllib.request.Request(oar, method="HEAD", headers={"User-Agent": BROWSER_UA})
        with urllib.request.urlopen(head, timeout=timeout):
            return 1
    except Exception:  # noqa: BLE001 — 404면 다음 신호로
        pass

    url = f"https://www.youtube.com/shorts/{video_id}"
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    try:
        with opener.open(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            # 차단 페이지가 200으로 올 수 있으니 쇼츠 페이지 표식을 확인합니다.
            body = b""
            while len(body) < 1_400_000:
                chunk = resp.read(200_000)
                if not chunk:
                    break
                body += chunk
                if b"WEB_PAGE_TYPE_SHORTS" in body:
                    return 1
            return None
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308):
            location = exc.headers.get("Location") or ""
            if "/watch" in location:
                return 0
            if "/shorts/" in location:
                return 1
            return None
        return None
    except Exception:  # noqa: BLE001
        return None


def resolve_shorts(
    ids: list[str], cache: dict[str, int], workers: int = SHORTS_CHECK_WORKERS, recheck: bool = False
) -> dict[str, int]:
    """캐시에 없는 영상만 확인해 {id: 1|0} 로 돌려줍니다."""
    missing = [vid for vid in dict.fromkeys(ids) if vid and (recheck or vid not in cache)]
    if missing:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for video_id, flag in zip(missing, pool.map(probe_short, missing)):
                if flag is not None:
                    cache[video_id] = flag
        print(f"shorts 판별: 새로 확인 {len(missing)}개 → 쇼츠 {sum(1 for v in missing if cache.get(v) == 1)}개")
        save_short_cache(cache)
    return {vid: cache.get(vid, 0) for vid in ids if vid}


def fetch(url: str, timeout: int = 25) -> bytes:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/atom+xml, application/xml, text/xml"})
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        return resp.read()


def text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def parse_feed(raw: bytes, expected_id: str) -> tuple[str, list[dict]]:
    root = ET.fromstring(raw)
    feed_title = text(root.find("atom:title", NS))
    videos: list[dict] = []
    for entry in root.findall("atom:entry", NS):
        video_id = text(entry.find("yt:videoId", NS))
        channel_id = text(entry.find("yt:channelId", NS)) or expected_id
        if not video_id:
            continue
        if channel_id and channel_id != expected_id:
            continue
        title = text(entry.find("atom:title", NS))
        published = text(entry.find("atom:published", NS))
        videos.append(
            {
                "id": video_id,
                "title": title,
                "channelId": expected_id,
                "published": published,
            }
        )
    return feed_title, videos


def main() -> int:
    parser = argparse.ArgumentParser(description="YouTube RSS에서 허용 채널의 최신 영상을 모아 videos.json을 만듭니다.")
    parser.add_argument("--recheck-shorts", action="store_true", help="쇼츠 여부를 캐시와 관계없이 다시 판별합니다.")
    args = parser.parse_args()
    data = json.loads(CHANNELS_PATH.read_text(encoding="utf-8"))
    channels = data.get("channels") or []
    if not channels:
        print("channels.json에 채널이 없습니다.", file=sys.stderr)
        return 1

    all_videos: list[dict] = []
    errors: list[dict] = []
    ok = 0

    for ch in channels:
        cid = (ch.get("id") or "").strip()
        name = (ch.get("name") or cid).strip()
        if not cid.startswith("UC") or len(cid) != 24:
            errors.append({"id": cid, "name": name, "error": "잘못된 채널 ID"})
            print(f"SKIP {name}: 잘못된 채널 ID ({cid})", file=sys.stderr)
            continue
        url = FEED_URL.format(id=cid)
        try:
            raw = fetch(url)
            feed_title, videos = parse_feed(raw, cid)
            all_videos.extend(videos)
            ok += 1
            print(f"OK {name} ({cid}) {len(videos)}개  feed={feed_title}")
        except Exception as exc:  # noqa: BLE001 — 채널 하나 실패해도 나머지는 저장
            errors.append({"id": cid, "name": name, "error": f"{type(exc).__name__}: {exc}"})
            print(f"FAIL {name} ({cid}): {type(exc).__name__}: {exc}", file=sys.stderr)

    all_videos.sort(key=lambda v: v.get("published") or "", reverse=True)

    cache = load_short_cache()
    flags = resolve_shorts([v["id"] for v in all_videos], cache, recheck=args.recheck_shorts)
    for video in all_videos:
        video["isShort"] = flags.get(video["id"], 0) == 1

    out = {
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "videos": all_videos,
        "errors": errors,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH} videos={len(all_videos)} ok={ok}/{len(channels)} errors={len(errors)}")

    if ok == 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
