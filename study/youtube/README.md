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

## 자동 갱신 (GitHub Actions)

`.github/workflows/youtube-feed.yml`이 약 3시간마다 최근 목록(`videos.json`)과 검색 인덱스(`index/`)를 갱신합니다. 자정(UTC) 회차와 수동 실행의 `full` 옵션은 채널 전체를 다시 수집합니다. 같은 내용의 사본이 `github-action-youtube-feed.yml`에도 있습니다.
