#!/usr/bin/env python3
"""허용 채널의 전체 영상 검색 인덱스를 만듭니다.

yt-dlp --flat-playlist 로 /videos, /shorts, /streams 를 수집합니다.
기본은 기존 인덱스에 최신 영상을 덧붙이는 증분 갱신입니다.
전체 다시 받으려면 --full 을 붙이세요.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHANNELS_PATH = HERE / "channels.json"
VIDEOS_PATH = HERE / "videos.json"
INDEX_DIR = HERE / "index"
TABS = ("videos", "shorts", "streams")
MISSING_TAB = "does not have a"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_to_day(value: object) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc).strftime("%Y-%m-%d")
        except (OSError, OverflowError, ValueError):
            return ""
    text = str(value).strip()
    if not text:
        return ""
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    if text.isdigit() and len(text) == 8:  # YYYYMMDD
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except ValueError:
        return ""


def load_json(path: Path, default):
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def pack_videos(rows: list[dict]) -> list[list]:
    rows = sorted(
        rows,
        key=lambda r: (r.get("published") or "", -int(r.get("ord") or 0)),
        reverse=True,
    )
    packed: list[list] = []
    seen: set[str] = set()
    for r in rows:
        vid = r.get("id") or ""
        if not vid or vid in seen:
            continue
        seen.add(vid)
        row = [vid, r.get("title") or "", r.get("published") or ""]
        # 4번째 칸이 1이면 쇼츠. 판별 전(None)이면 칸을 비워 두고 나중에 채웁니다.
        if r.get("isShort") is not None:
            row.append(1 if r["isShort"] else 0)
        packed.append(row)
    return packed


def unpack_videos(items: list) -> list[dict]:
    rows: list[dict] = []
    for i, item in enumerate(items or []):
        is_short = None
        if isinstance(item, dict):
            vid = item.get("id") or ""
            title = item.get("title") or ""
            published = iso_to_day(item.get("published"))
            if isinstance(item.get("isShort"), bool):
                is_short = item["isShort"]
        elif isinstance(item, (list, tuple)) and item:
            vid = item[0] if len(item) > 0 else ""
            title = item[1] if len(item) > 1 else ""
            published = iso_to_day(item[2] if len(item) > 2 else "")
            if len(item) > 3 and item[3] in (0, 1, True, False):
                is_short = bool(item[3])
        else:
            continue
        if not vid:
            continue
        rows.append({"id": vid, "title": title, "published": published, "ord": i, "isShort": is_short})
    return rows


def merge_row(
    store: dict[str, dict],
    video_id: str,
    title: str,
    published: str,
    prefer_date: bool = False,
    is_short: bool | None = None,
) -> None:
    if not video_id:
        return
    cur = store.get(video_id)
    if cur is None:
        store[video_id] = {
            "id": video_id,
            "title": title or "",
            "published": published or "",
            "ord": len(store),
            "isShort": is_short,
        }
        return
    if is_short is not None:
        # 쇼츠로 확인된 사실은 유지하고, 일반 영상 판정은 아직 모를 때만 채웁니다.
        if is_short or cur.get("isShort") is None:
            cur["isShort"] = is_short
    if title and (not cur.get("title") or (title != cur["title"] and not title.endswith("..."))):
        # Prefer a non-truncated, usually Korean, title
        if not cur.get("title") or cur["title"].endswith("...") or (prefer_date is False and title):
            if not (title.endswith("...") and cur.get("title") and not cur["title"].endswith("...")):
                cur["title"] = title
    if published:
        if not cur.get("published") or prefer_date or (prefer_date is False and published > (cur.get("published") or "")):
            # RSS / precise dates should pass prefer_date=True
            if prefer_date or not cur.get("published"):
                cur["published"] = published


def import_yt_dlp():
    try:
        import yt_dlp  # type: ignore
        return yt_dlp
    except ImportError:
        print(
            "yt-dlp가 필요합니다. 예: python3 -m venv .venv && .venv/bin/pip install yt-dlp",
            file=sys.stderr,
        )
        raise SystemExit(2)


def extract_tab(yt_dlp, url: str, *, lang_ko: bool, dates: bool, playlist_end: int | None, tab: str = "") -> list[dict]:
    extractor_args: dict = {}
    if lang_ko:
        extractor_args.setdefault("youtube", {})["lang"] = ["ko"]
    if dates:
        extractor_args.setdefault("youtubetab", {})["approximate_date"] = [""]

    opts = {
        "extract_flat": True,
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "retries": 5,
        "extractor_retries": 5,
        "socket_timeout": 30,
        "http_headers": {"Accept-Language": "ko-KR,ko;q=0.9,en;q=0.3"} if lang_ko else {},
        "extractor_args": extractor_args,
    }
    if playlist_end:
        opts["playlistend"] = playlist_end

    rows: list[dict] = []
    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            if MISSING_TAB in msg:
                return []
            raise
    if not info:
        return []
    for entry in info.get("entries") or []:
        if not entry:
            continue
        video_id = entry.get("id") or ""
        if not video_id or entry.get("_type") == "playlist":
            continue
        title = (entry.get("title") or "").strip()
        published = iso_to_day(entry.get("timestamp")) or iso_to_day(entry.get("upload_date"))
        rows.append(
            {
                "id": video_id,
                "title": title,
                "published": published,
                # /shorts 탭에서 나온 영상만 쇼츠. /videos·/streams 탭은 일반 영상으로 본다.
                "isShort": True if tab == "shorts" else (False if tab in ("videos", "streams") else None),
            }
        )
    return rows


def crawl_channel(yt_dlp, channel_id: str, *, full: bool, incremental_end: int) -> tuple[dict[str, dict], list[str]]:
    store: dict[str, dict] = {}
    errors: list[str] = []
    end = None if full else incremental_end
    for tab in TABS:
        url = f"https://www.youtube.com/channel/{channel_id}/{tab}"
        # Title pass (Korean), then date pass (English UI so relative dates parse)
        for label, kwargs in (
            ("titles", {"lang_ko": True, "dates": False}),
            ("dates", {"lang_ko": False, "dates": True}),
        ):
            try:
                entries = extract_tab(yt_dlp, url, playlist_end=end, tab=tab, **kwargs)
            except Exception as exc:  # noqa: BLE001
                err = f"{tab}/{label}: {type(exc).__name__}: {exc}"
                errors.append(err)
                print(f"  FAIL {channel_id} {err}", file=sys.stderr)
                continue
            if MISSING_TAB in "" and not entries and not full:
                pass
            prefer_date = label == "dates"
            for e in entries:
                merge_row(
                    store,
                    e["id"],
                    e["title"],
                    e["published"],
                    prefer_date=prefer_date,
                    is_short=e.get("isShort"),
                )
            print(f"  {tab}/{label}: {len(entries)}개", flush=True)
    return store, errors


def merge_rss(store: dict[str, dict], channel_id: str) -> int:
    data = load_json(VIDEOS_PATH, {})
    added = 0
    for item in data.get("videos") or []:
        if (item or {}).get("channelId") != channel_id:
            continue
        before = len(store)
        merge_row(
            store,
            item.get("id") or "",
            item.get("title") or "",
            iso_to_day(item.get("published")),
            prefer_date=True,
            is_short=item.get("isShort") if isinstance(item.get("isShort"), bool) else None,
        )
        if len(store) > before or True:
            added += 1
    return added


def load_existing(channel_id: str) -> dict[str, dict]:
    path = INDEX_DIR / f"{channel_id}.json"
    data = load_json(path, {})
    store: dict[str, dict] = {}
    for row in unpack_videos(data.get("videos") or []):
        store[row["id"]] = row
    return store


def write_channel(channel_id: str, store: dict[str, dict]) -> int:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    packed = pack_videos(list(store.values()))
    payload = {
        "id": channel_id,
        "updatedAt": utc_now(),
        "videos": packed,
    }
    path = INDEX_DIR / f"{channel_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return len(packed)


def classify_shorts(only: set[str], workers: int = 16, recheck: bool = False) -> int:
    """쇼츠 여부를 아직 모르는 인덱스 항목을 썬네일·리다이렉트로 판별해 채워 넣습니다."""
    sys.path.insert(0, str(HERE))
    from update_feed import load_short_cache, probe_short, save_short_cache  # noqa: PLC0415

    cache = load_short_cache()
    data = load_json(CHANNELS_PATH, {})
    channels = [c for c in data.get("channels") or [] if (c.get("id") or "").strip()]

    stores: dict[str, dict[str, dict]] = {}
    pending: list[str] = []
    for ch in channels:
        cid = ch["id"].strip()
        if only and cid not in only:
            continue
        if not (INDEX_DIR / f"{cid}.json").is_file():
            continue
        store = load_existing(cid)
        stores[cid] = store
        if recheck:
            # 이미 쇼츠로 판별된 항목을 다시 확인합니다 (오판이 있었다면 바로잡기)
            pending.extend(row["id"] for row in store.values() if row.get("isShort") is not False)
        else:
            pending.extend(row["id"] for row in store.values() if row.get("isShort") is None)

    pending = list(dict.fromkeys(pending))
    to_probe = pending if recheck else [vid for vid in pending if vid not in cache]
    to_probe_set = set(to_probe)
    print(f"쇼츠 판별: 대상 {len(pending)}개 (새로 확인 {len(to_probe)}개, 동시 {workers})", flush=True)
    if to_probe:
        done = 0
        for start in range(0, len(to_probe), 1000):
            chunk = to_probe[start : start + 1000]
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for video_id, flag in zip(chunk, pool.map(probe_short, chunk)):
                    if flag is not None:
                        cache[video_id] = flag
            done += len(chunk)
            save_short_cache(cache)
            print(f"  ... {done}/{len(to_probe)} (쇼츠 {sum(1 for v in cache.values() if v == 1)}개)", flush=True)

    changed = 0
    shorts_total = 0
    for cid, store in stores.items():
        touched = False
        for row in store.values():
            if recheck:
                if row["id"] in to_probe_set and row["id"] in cache:
                    if row.get("isShort") != (cache[row["id"]] == 1):
                        touched = True
                    row["isShort"] = cache[row["id"]] == 1
            elif row.get("isShort") is None and row["id"] in cache:
                row["isShort"] = cache[row["id"]] == 1
                touched = True
            if row.get("isShort"):
                shorts_total += 1
        if touched:
            write_channel(cid, store)
            changed += 1

    remaining = sum(1 for store in stores.values() for row in store.values() if row.get("isShort") is None)
    print(f"쇼츠 판별 완료: 파일 {changed}개 갱신, 쇼츠 {shorts_total}개, 미판별 {remaining}개", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="허용 채널 전체 영상 검색 인덱스를 만듭니다.")
    parser.add_argument("--full", action="store_true", help="채널의 모든 영상을 다시 수집합니다.")
    parser.add_argument("--end", type=int, default=80, help="증분 갱신 시 탭마다 가져올 최신 영상 수 (기본 80)")
    parser.add_argument("--only", action="append", default=[], help="이 채널 ID만 갱신 (여러 번 지정 가능)")
    parser.add_argument(
        "--classify-shorts",
        action="store_true",
        help="인덱스의 쇼츠 여부를 썬네일·리다이렉트로 판별해 채워 넣습니다 (크롤링 없이).",
    )
    parser.add_argument(
        "--recheck-shorts",
        action="store_true",
        help="--classify-shorts와 함께 쓸 때, 이미 판별된 항목도 다시 확인합니다.",
    )
    args = parser.parse_args()

    if args.classify_shorts:
        return classify_shorts(set(args.only), recheck=args.recheck_shorts)

    yt_dlp = import_yt_dlp()
    data = load_json(CHANNELS_PATH, {})
    channels = data.get("channels") or []
    if not channels:
        print("channels.json에 채널이 없습니다.", file=sys.stderr)
        return 1

    only = set(args.only)
    manifest_channels: list[dict] = []
    ok = 0
    fail = 0

    # Keep manifest entries for channels we did not touch
    old_manifest = load_json(INDEX_DIR / "manifest.json", {})
    old_by_id = {c.get("id"): c for c in (old_manifest.get("channels") or []) if c.get("id")}

    for ch in channels:
        cid = (ch.get("id") or "").strip()
        name = (ch.get("name") or cid).strip()
        if only and cid not in only:
            if cid in old_by_id:
                manifest_channels.append(old_by_id[cid])
            elif (INDEX_DIR / f"{cid}.json").is_file():
                existing = load_existing(cid)
                manifest_channels.append(
                    {"id": cid, "name": name, "file": f"{cid}.json", "count": len(existing)}
                )
            continue
        if not cid.startswith("UC") or len(cid) != 24:
            print(f"SKIP {name}: 잘못된 채널 ID ({cid})", file=sys.stderr)
            fail += 1
            continue

        print(f"== {name} ({cid}) {'FULL' if args.full else 'incremental'} ==", flush=True)
        store = load_existing(cid)
        before = len(store)
        try:
            crawled, errors = crawl_channel(yt_dlp, cid, full=args.full, incremental_end=args.end)
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
            fail += 1
            if store:
                count = write_channel(cid, store)
                manifest_channels.append(
                    {"id": cid, "name": name, "file": f"{cid}.json", "count": count, "errors": [str(exc)]}
                )
            continue

        for row in crawled.values():
            merge_row(store, row["id"], row.get("title") or "", row.get("published") or "", prefer_date=False)
            # If the new crawl has a date and old was empty, merge_row already fills it.
            # If both have dates, keep existing unless old was empty.
            if row.get("published") and not (store[row["id"]].get("published")):
                store[row["id"]]["published"] = row["published"]
            if row.get("published") and row.get("title"):
                # already merged; ensure date from date-pass is kept when old index had no date
                if not load_existing.__name__:
                    pass

        # Re-merge crawled dates explicitly: crawled date should fill blanks
        for row in crawled.values():
            cur = store[row["id"]]
            if row.get("title") and (
                not cur.get("title") or (cur["title"].endswith("...") and not row["title"].endswith("..."))
            ):
                cur["title"] = row["title"]
            if row.get("published") and not cur.get("published"):
                cur["published"] = row["published"]

        rss_n = merge_rss(store, cid)
        count = write_channel(cid, store)
        size = (INDEX_DIR / f"{cid}.json").stat().st_size
        print(f"  saved {count}개 (before {before}, rss {rss_n}) {size} bytes", flush=True)
        entry = {"id": cid, "name": name, "file": f"{cid}.json", "count": count}
        if errors:
            entry["errors"] = errors
        manifest_channels.append(entry)
        ok += 1

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "updatedAt": utc_now(),
        "channels": manifest_channels,
        "total": sum(int(c.get("count") or 0) for c in manifest_channels),
    }
    (INDEX_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote manifest total={manifest['total']} ok={ok} fail={fail}", flush=True)
    return 1 if ok == 0 and fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
