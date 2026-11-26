#!/usr/bin/env python3
"""유튜브 영상의 인기 댓글을 정적 JSON으로 모읍니다.

YouTube Data API 키나 로그인 없이, 웹 플레이어가 쓰는 공개 innertube 엔드포인트
(/youtubei/v1/next)로 댓글 패널을 읽습니다. 영상 하나당 요청 2~4번이라
3시간 주기 GitHub Actions에서도 몇 분 안에 끝납니다.

결과: study/youtube/comments/{videoId}.json
      study/youtube/comments/index.json  (수집된 영상 목록 — UI가 404 없이 확인)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIDEOS_PATH = HERE / "videos.json"
COMMENTS_DIR = HERE / "comments"
INDEX_DIR = HERE / "index"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"  # youtube.com 웹 클라이언트 공개 키
CLIENT_VERSION = "2.20261125.00.00"
SORT_TOP = "top"
MAX_REPLY_THREADS = 3
MAX_REPLIES_EACH = 3

_lock = threading.Lock()
_abort = threading.Event()
_stats = {"fetched": 0, "written": 0, "failed": 0, "skipped": 0}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def context() -> dict:
    return {"client": {"clientName": "WEB", "clientVersion": CLIENT_VERSION, "hl": "ko", "gl": "KR"}}


def post_next(payload: dict, timeout: int = 25, retries: int = 2) -> dict:
    url = f"https://www.youtube.com/youtubei/v1/next?key={API_KEY}&prettyPrint=false"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
        "X-Youtube-Client-Name": "1",
        "X-Youtube-Client-Version": CLIENT_VERSION,
    }
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8", "replace"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def walk_find(obj, key: str, out: list) -> list:
    if isinstance(obj, dict):
        if key in obj:
            out.append(obj[key])
        for value in obj.values():
            walk_find(value, key, out)
    elif isinstance(obj, list):
        for value in obj:
            walk_find(value, key, out)
    return out


def runs_text(node, sep: str = "") -> str:
    """text renderer ({runs:[{text}]} 또는 {simpleText}) → 문자열."""
    if not isinstance(node, dict):
        return ""
    if isinstance(node.get("simpleText"), str):
        return node["simpleText"]
    runs = node.get("runs")
    if isinstance(runs, list):
        return sep.join(str(r.get("text") or "") for r in runs if isinstance(r, dict)).strip()
    return ""


def to_int(value) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        digits = re.sub(r"[^0-9]", "", value)
        if digits:
            try:
                return int(digits)
            except ValueError:
                return 0
        return 0
    return 0


def relative_to_iso(text: str, base: datetime) -> str:
    """'20시간 전', '3일 전', '2주 전' → 대략적 ISO 날짜."""
    m = re.match(r"\s*(\d+)?\s*(초|분|시간|일|주|개월|년)\s*전", text or "")
    if not m:
        if "방금" in (text or ""):
            return base.strftime("%Y-%m-%dT%H:%M:%SZ")
        return ""
    n = int(m.group(1) or 1)
    unit = m.group(2)
    delta = {
        "초": timedelta(seconds=n),
        "분": timedelta(minutes=n),
        "시간": timedelta(hours=n),
        "일": timedelta(days=n),
        "주": timedelta(weeks=n),
        "개월": timedelta(days=30 * n),
        "년": timedelta(days=365 * n),
    }[unit]
    return (base - delta).strftime("%Y-%m-%dT%H:%M:%SZ")


def comment_entities(resp: dict) -> list[dict]:
    """frameworkUpdates 안의 commentEntityPayload → 순서 유지 목록."""
    fw = resp.get("frameworkUpdates") or {}
    mutations = ((fw.get("entityBatchUpdate") or {}).get("mutations")) or []
    out: list[dict] = []
    for mutation in mutations:
        payload = (mutation or {}).get("payload") or {}
        entity = payload.get("commentEntityPayload")
        if not isinstance(entity, dict):
            continue
        props = entity.get("properties") or {}
        author = entity.get("author") or {}
        toolbar = entity.get("toolbar") or {}
        out.append(
            {
                "id": props.get("commentId") or "",
                "level": props.get("replyLevel") or 0,
                "text": (props.get("content") or {}).get("content") or "",
                "published": props.get("publishedTime") or "",
                "author": author.get("displayName") or "",
                "authorId": author.get("channelId") or "",
                "isCreator": bool(author.get("isCreator")),
                "likes": to_int(toolbar.get("likeCountNotliked") or toolbar.get("likeCountLiked")),
                "replyCount": to_int(toolbar.get("replyCount")),
            }
        )
    return out


def thread_items(resp: dict) -> list[dict]:
    """응답의 continuationItems를 평탄화 (여러 엔드포인트·커맨드 형태 모두)."""
    items: list[dict] = []
    for endpoint in resp.get("onResponseReceivedEndpoints") or []:
        if not isinstance(endpoint, dict):
            continue
        for key, value in endpoint.items():
            if key == "clickTrackingParams" or not isinstance(value, dict):
                continue
            chunk = value.get("continuationItems")
            if isinstance(chunk, list):
                items.extend([c for c in chunk if isinstance(c, dict)])
            if isinstance(value.get("continuationItemRenderer"), dict):
                items.append(value)
    appended = (resp.get("continuationContents") or {}).get("commentSectionContents")
    if isinstance(appended, dict):
        items.extend([c for c in appended.get("continuationItems") or [] if isinstance(c, dict)])
    return items


def comment_panel(initial: dict) -> dict | None:
    for panel in walk_find(initial, "engagementPanelSectionListRenderer", []):
        if panel.get("targetId") == "engagement-panel-comments-section" or panel.get(
            "panelIdentifier"
        ) == "engagement-panel-comments-section":
            return panel
    return None


def panel_total(panel: dict) -> int:
    header = (panel.get("header") or {}).get("engagementPanelTitleHeaderRenderer") or {}
    return to_int(runs_text(header.get("contextualInfo")))


def panel_comments_token(panel: dict) -> str:
    content = panel.get("content") or {}
    for token in walk_find(content, "continuationCommand", []):
        tok = (token or {}).get("token")
        if tok:
            return tok
    return ""


def fetch_video_comments(
    video: dict, max_comments: int, max_reply_threads: int, max_replies: int = MAX_REPLIES_EACH
) -> dict | None:
    video_id = video["id"]
    base = datetime.now(timezone.utc)

    initial = post_next({"context": context(), "videoId": video_id})
    panel = comment_panel(initial)
    if panel is None:
        # 댓글 패널이 아예 없으면(차단·삭제·연령 제한 등) 이번 실행에서는 건너뜁니다.
        return None

    total = panel_total(panel)
    token = panel_comments_token(panel)
    if not token:
        return {
            "videoId": video_id,
            "title": video.get("title") or "",
            "updatedAt": utc_now(),
            "sort": SORT_TOP,
            "total": 0,
            "disabled": True,
            "comments": [],
        }

    collected: list[dict] = []
    order: list[str] = []
    reply_tokens: dict[str, str] = {}
    next_token = token

    for _page in range(3):
        if not next_token or len(collected) >= max_comments:
            break
        resp = post_next({"context": context(), "continuation": next_token})
        entities = {e["id"]: e for e in comment_entities(resp) if e["id"]}
        next_token = ""
        for item in thread_items(resp):
            thread = item.get("commentThreadRenderer")
            if isinstance(thread, dict):
                cid = ((thread.get("commentViewModel") or {}).get("commentViewModel") or {}).get(
                    "commentId"
                ) or ""
                if cid and cid in entities:
                    if cid not in order:
                        order.append(cid)
                    replies = (thread.get("replies") or {}).get("commentRepliesRenderer") or {}
                    tok = ""
                    for cont in replies.get("contents") or []:
                        tok = (
                            ((cont.get("continuationItemRenderer") or {}).get("continuationEndpoint") or {})
                            .get("continuationCommand")
                            or {}
                        ).get("token") or ""
                        if tok:
                            break
                    if tok:
                        reply_tokens[cid] = tok
                continue
            cont = item.get("continuationItemRenderer")
            if isinstance(cont, dict):
                tok = (
                    ((cont.get("continuationEndpoint") or {}).get("continuationCommand") or {}).get("token")
                ) or ""
                if tok and (cont.get("button") or cont.get("continuationEndpoint")):
                    next_token = tok

        for cid in order:
            entity = entities.get(cid)
            if entity and all(entity["id"] != c["id"] for c in collected):
                collected.append(entity)
        if not order:
            break

    collected = collected[:max_comments]

    # 인기 댓글 몇 개에 달린 답글만 추가 수집
    for comment in collected[:max_reply_threads]:
        tok = reply_tokens.get(comment["id"])
        if not tok or comment["replyCount"] <= 0:
            continue
        try:
            resp = post_next({"context": context(), "continuation": tok})
        except Exception:  # noqa: BLE001 — 답글 실패는 댓글 저장을 막지 않음
            continue
        replies = [e for e in comment_entities(resp) if e["id"] and e["id"] != comment["id"]]
        replies.sort(key=lambda r: r["likes"], reverse=True)
        comment["replies"] = [
            {
                "id": r["id"],
                "author": r["author"],
                "isCreator": r["isCreator"],
                "text": r["text"],
                "published": r["published"],
                "publishedAt": relative_to_iso(r["published"], base),
                "likes": r["likes"],
            }
            for r in replies[:max_replies]
        ]
        time.sleep(0.15)

    out_comments = []
    for c in collected:
        item = {
            "id": c["id"],
            "author": c["author"],
            "isCreator": c["isCreator"],
            "text": c["text"],
            "published": c["published"],
            "publishedAt": relative_to_iso(c["published"], base),
            "likes": c["likes"],
            "replyCount": c["replyCount"],
        }
        if c.get("replies"):
            item["replies"] = c["replies"]
        out_comments.append(item)

    return {
        "videoId": video_id,
        "title": video.get("title") or "",
        "updatedAt": utc_now(),
        "sort": SORT_TOP,
        "total": total or len(out_comments),
        "comments": out_comments,
    }


def select_targets(videos: list[dict], args) -> list[dict]:
    now = datetime.now(timezone.utc)

    def published_dt(v: dict) -> datetime:
        raw = (v.get("published") or "").strip()
        if not raw:
            return datetime(1970, 1, 1, tzinfo=timezone.utc)
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                return datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                return datetime(1970, 1, 1, tzinfo=timezone.utc)

    only = set(args.only or [])
    fresh_cutoff = now - timedelta(days=args.fresh_days)
    targets: list[dict] = []
    for video in videos:
        vid = video.get("id")
        if not vid:
            continue
        if only and vid not in only:
            continue
        has_file = (COMMENTS_DIR / f"{vid}.json").is_file()
        if has_file and published_dt(video) < fresh_cutoff:
            _stats["skipped"] += 1
            continue
        targets.append(video)

    # 최신 영상 먼저
    targets.sort(key=lambda v: v.get("published") or "", reverse=True)
    return targets


def write_comment_file(data: dict) -> bool:
    COMMENTS_DIR.mkdir(parents=True, exist_ok=True)
    path = COMMENTS_DIR / f"{data['videoId']}.json"
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    if path.is_file():
        try:
            if path.read_text(encoding="utf-8") == text:
                return False
        except OSError:
            pass
    path.write_text(text, encoding="utf-8")
    return True


def write_manifest(videos: list[dict]) -> None:
    ids = sorted(p.stem for p in COMMENTS_DIR.glob("*.json") if p.name != "index.json")
    path = COMMENTS_DIR / "index.json"
    if path.is_file():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
            if old.get("videoIds") == ids:
                return  # 목록이 그대로면 파일을 다시 쓰지 않습니다(불필요한 커밋 방지)
        except (OSError, ValueError):
            pass
    payload = {
        "updatedAt": utc_now(),
        "count": len(ids),
        "videoIds": ids,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def prune(videos: list[dict]) -> int:
    """videos.json과 검색 인덱스 어디에도 없는 영상의 댓글 파일을 정리합니다."""
    known = {v.get("id") for v in videos if v.get("id")}
    manifest = INDEX_DIR / "manifest.json"
    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
            for channel in data.get("channels") or []:
                file = channel.get("file")
                if not file:
                    continue
                path = INDEX_DIR / file
                if not path.is_file():
                    continue
                for row in json.loads(path.read_text(encoding="utf-8")).get("videos") or []:
                    if row and row[0]:
                        known.add(row[0])
        except (OSError, ValueError):
            print("인덱스를 읽지 못해 정리를 건너뜁니다.", file=sys.stderr)
            return 0
    else:
        print("index/manifest.json이 없어 정리를 건너뜁니다.", file=sys.stderr)
        return 0

    removed = 0
    for path in COMMENTS_DIR.glob("*.json"):
        if path.name == "index.json":
            continue
        if path.stem not in known:
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def main() -> int:
    parser = argparse.ArgumentParser(description="유튜브 인기 댓글을 정적 JSON으로 모읍니다.")
    parser.add_argument("--max-videos", type=int, default=40, help="한 번에 처리할 최대 영상 수 (기본 40)")
    parser.add_argument("--max-comments", type=int, default=25, help="영상당 수집할 최대 댓글 수 (기본 25)")
    parser.add_argument("--reply-threads", type=int, default=3, help="답글을 모을 댓글 수 (기본 3)")
    parser.add_argument("--replies", type=int, default=3, help="댓글 하나에 저장할 최대 답글 수 (기본 3)")
    parser.add_argument(
        "--fresh-days",
        type=int,
        default=7,
        help="이 기간 안에 올라온 영상은 댓글 파일이 있어도 다시 모읍니다 (기본 7일)",
    )
    parser.add_argument("--time-budget", type=int, default=300, help="이 초를 넘기면 남은 영상은 다음 실행으로 (기본 300)")
    parser.add_argument("--workers", type=int, default=4, help="동시 요청 수 (기본 4)")
    parser.add_argument("--only", action="append", default=[], help="이 영상 ID만 수집 (여러 번 지정 가능)")
    parser.add_argument("--no-prune", action="store_true", help="오래된 댓글 파일 정리를 하지 않습니다.")
    args = parser.parse_args()

    videos_path = VIDEOS_PATH
    if not videos_path.is_file():
        print("videos.json이 없습니다.", file=sys.stderr)
        return 1
    videos = json.loads(videos_path.read_text(encoding="utf-8")).get("videos") or []
    if not videos:
        print("videos.json에 영상이 없습니다.", file=sys.stderr)
        return 1

    targets = select_targets(videos, args)
    if not targets:
        print("새로 모을 댓글이 없습니다.", flush=True)
        if not args.no_prune:
            removed = prune(videos)
            if removed:
                print(f"정리: {removed}개 파일 삭제", flush=True)
        write_manifest(videos)
        return 0

    targets = targets[: args.max_videos]
    print(f"댓글 수집 대상 {len(targets)}개 (동시 {args.workers})", flush=True)
    started = time.time()

    def work(video: dict) -> None:
        if _abort.is_set() or time.time() - started > args.time_budget:
            with _lock:
                _stats["skipped"] += 1
            return
        try:
            data = fetch_video_comments(video, args.max_comments, args.reply_threads, args.replies)
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _stats["failed"] += 1
                # 첫 요청부터 모두 막히면(차단·장애) 남은 영상은 다음 실행으로 넘깁니다.
                if _stats["fetched"] == 0 and _stats["failed"] >= 5:
                    _abort.set()
            print(f"  FAIL {video.get('id')}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            return
        if data is None:
            with _lock:
                _stats["failed"] += 1
            print(f"  SKIP {video.get('id')}: 댓글 패널 없음", file=sys.stderr, flush=True)
            return
        changed = write_comment_file(data)
        with _lock:
            _stats["fetched"] += 1
            if changed:
                _stats["written"] += 1
        print(
            f"  OK {video.get('id')} 댓글 {len(data['comments'])}/{data.get('total')}"
            f" ({'저장' if changed else '변화 없음'})",
            flush=True,
        )

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        list(pool.map(work, targets))

    removed = 0
    if not args.no_prune:
        removed = prune(videos)
    write_manifest(videos)
    print(
        f"완료: fetched={_stats['fetched']} written={_stats['written']}"
        f" failed={_stats['failed']} skipped={_stats['skipped']} pruned={removed}"
        f" {int(time.time() - started)}s",
        flush=True,
    )
    if _abort.is_set():
        print("댓글 수집이 일찍 멈췄습니다(요청 차단 추정). 기존 파일은 그대로 두었습니다.", file=sys.stderr)
    if _stats["fetched"] == 0 and _stats["failed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
