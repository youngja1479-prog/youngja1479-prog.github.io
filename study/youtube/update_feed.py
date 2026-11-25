#!/usr/bin/env python3
"""YouTube RSS에서 허용 채널의 최신 영상을 모아 videos.json을 만듭니다."""

from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
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
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={id}"
UA = "GKC-study-youtube-feed/1.0 (+https://youngja1479-prog.github.io/study/youtube/)"


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
