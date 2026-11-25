# 허용 채널 유튜브

허용한 채널의 영상만 이 페이지에서 볼 수 있습니다. 일반 유튜브 검색은 없습니다.

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

3. 저장소 루트에서 `python3 study/youtube/update_feed.py`를 실행하거나, GitHub Actions의 **Update YouTube feed** 워크플로를 수동 실행합니다.
4. 변경된 `channels.json`과 `videos.json`을 커밋하면 사이트에 반영됩니다.

영상 목록은 YouTube RSS로 약 3시간마다 자동 갱신됩니다. API 키는 필요 없습니다.

## 자동 갱신 (GitHub Actions)

`github-action-youtube-feed.yml`을 저장소의 `.github/workflows/youtube-feed.yml`로 복사하면 약 3시간마다 `videos.json`이 자동 갱신됩니다. 이 파일을 워크플로 경로에 넣으려면 GitHub 토큰에 `workflow` 권한이 필요합니다.
