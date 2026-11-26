# 허용 채널 유튜브

허용한 채널의 영상만 이 페이지에서 볼 수 있습니다. 검색도 허용 채널의 제목 안에서만 이루어집니다. 일반 유튜브 검색은 없습니다.

## 채널 추가하는 방법

1. 유튜브 채널 페이지에서 채널 ID를 확인합니다.
   - 주소가 `youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx` 이면 그 `UC...` 값이 ID입니다.
   - `@아이디` 주소면 페이지 소스에서 `channelid=UC...` 또는 RSS 주소 `feeds/videos.xml?channel_id=UC...`를 찾으면 됩니다.
   - ID는 보통 `UC`로 시작하는 24자입니다.
2. `channels.json`의 `channels` 배열에 항목을 추가합니다.

```json
{
  "id": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "name": "화면에 보일 이름",
  "handle": "@선택사항"
}
```

3. 최근 목록과 검색 인덱스를 갱신합니다.

```bash
python3 study/youtube/update_feed.py
python3 -m venv /tmp/ytdlp-venv && /tmp/ytdlp-venv/bin/pip install -U yt-dlp
/tmp/ytdlp-venv/bin/python3 study/youtube/update_index.py --full
```

4. 변경된 `channels.json`, `videos.json`, `index/` 를 커밋하면 사이트에 반영됩니다.

## 목록을 다시 받는 방법

- 최근 영상(채널당 약 15개, `videos.json`): `python3 study/youtube/update_feed.py`
- 검색용 전체 인덱스(`index/`): `yt-dlp`가 있는 환경에서 `python3 study/youtube/update_index.py --full`
- 이미 인덱스가 있을 때 최신분만 덧붙이려면 `--full` 없이 `python3 study/youtube/update_index.py` 만 실행하면 됩니다.
- 쇼츠 여부 판별이 빠진 항목을 채우려면 `python3 study/youtube/update_index.py --classify-shorts`,
  이미 판별된 쇼츠를 다시 확인하려면 `--classify-shorts --recheck-shorts` 를 씁니다.

## 쇼츠 / 일반 구분

- `videos.json`은 `isShort`(true/false), `index/*.json`은 네 번째 칸(`1`이면 쇼츠, `0`이면 일반)로 표시합니다.
- 판별은 ① 쇼츠에만 생기는 세로 썸네일 `i.ytimg.com/vi/{id}/oardefault.jpg`(200이면 쇼츠),
  ② `/shorts/{id}`가 `/watch?v=`로 넘기는지(넘기면 일반 영상) 순서로 확인하고, 판별 결과는 `shorts-cache.json`에 남겨 다음 실행에서 다시 묻지 않습니다.

## 댓글

- `python3 study/youtube/update_comments.py` — `videos.json`의 영상 중 인기순 상위 댓글을 `comments/{videoId}.json`으로 저장합니다.
  - 영상당 기본 25개 댓글 + 인기 댓글 3개에 달린 답글 3개씩, 최근 7일 영상은 다시 수집합니다.
  - `--max-videos`(한 번에 처리할 영상 수), `--time-budget`(초), `--only {videoId}`(특정 영상만) 옵션이 있습니다.
  - 수집된 영상 목록은 `comments/index.json`에 남고, 사이트는 이 목록으로 댓글 유무를 먼저 확인합니다.

## 자동 갱신 (GitHub Actions)

`.github/workflows/youtube-feed.yml`이 약 3시간마다 최근 목록(`videos.json`), 검색 인덱스(`index/`), 최근 영상 댓글(`comments/`)을 갱신합니다. 자정(UTC) 회차와 수동 실행의 `full` 옵션은 채널 전체를 다시 수집합니다. 같은 내용의 사본이 `github-action-youtube-feed.yml`에도 있습니다.
