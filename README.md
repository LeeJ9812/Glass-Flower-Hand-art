# 🌸 Flower Hand Art

웹캠 기반 인터랙티브 미디어아트. 손을 펼치면 꽃이 피고, 접으면 꽃이 집니다.

---

## ⚠️ 중요: HTTPS 필수

**모바일에서 카메라 접근은 HTTPS 환경에서만 작동합니다.**  
로컬호스트(`localhost`, `127.0.0.1`)는 HTTP에서도 허용됩니다.

```
✅ https://your-domain.com     — 모바일/데스크탑 모두 작동
✅ http://localhost:3000        — 로컬 개발 시 작동
❌ http://192.168.0.x:3000     — 모바일 카메라 불가
```

---

## 로컬 실행 방법

### 방법 1: npx serve (권장)
```bash
cd flower-hand-art
npx serve .
# → http://localhost:3000 으로 접속
```

### 방법 2: Python 내장 서버
```bash
python -m http.server 3000
```

### 방법 3: VS Code Live Server 확장
`index.html` 우클릭 → "Open with Live Server"

---

## 에셋 구조

```
flower-hand-art/
└── assets/
    ├── closed/
    │   └── image.jpeg     ← 오므린 꽃 이미지  (bloom < 0.3)
    ├── open/
    │   └── image.jpeg     ← 활짝 핀 꽃 이미지 (bloom > 0.7)
    └── seq/
        ├── frame_0001.jpg
        ├── frame_0002.jpg
        └── frame_XXXX.jpg ← 피고 지는 이미지 시퀀스 (bloom 0.3~0.7)
```

---

## 에셋 교체 방법

### 오므린 꽃 이미지 교체
`assets/closed/image.jpeg` 를 같은 이름으로 덮어쓰기

### 활짝 핀 꽃 이미지 교체
`assets/open/image.jpeg` 를 같은 이름으로 덮어쓰기

### 이미지 시퀀스 교체
1. `assets/seq/` 안의 기존 파일을 모두 삭제
2. 새 프레임을 `frame_0001.jpg`, `frame_0002.jpg`, ... 형식으로 넣기
3. `config.js` 에서 프레임 수 수정:

```js
// config.js
export const totalFrames = 240;  // ← 실제 프레임 수로 변경
```

---

## 배포

### GitHub Pages
```bash
# 1. repository 생성 후 push
git init && git add . && git commit -m "initial commit"
git remote add origin https://github.com/[username]/flower-hand-art.git
git push -u origin main

# 2. Settings → Pages → Branch: main → Save
# 3. https://[username].github.io/flower-hand-art/ 접속
```

### Vercel
```bash
# Vercel CLI
npx vercel

# 또는 vercel.com 에서 GitHub repo 연결
```
`vercel.json`이 포함되어 있어 별도 설정 없이 배포됩니다.

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 언어 | 순수 HTML / CSS / JavaScript (ES Modules) |
| 빌드 | 없음 — 브라우저에서 바로 실행 |
| 손 인식 | MediaPipe Hands (CDN) |
| 렌더링 | Canvas 2D API, OffscreenCanvas |
| 모바일 | 가로화면 강제, CSS scaleX(-1) 미러링, 720p 버퍼 제한 |

---

## 파일 구조

```
flower-hand-art/
├── index.html          # Canvas 레이어, 가이드/로딩/오류 UI
├── style.css           # 레이아웃, 모바일 대응, 가이드 애니메이션
├── main.js             # 진입점, 카메라/렌더 루프, 데모 모드, 디버그 패널
├── handTracker.js      # MediaPipe Hands 래퍼, bloom 계산
├── flowerRenderer.js   # 이미지 시퀀스 렌더링 (전체화면 cover)
├── config.js           # 시퀀스 프레임 수 등 에셋 설정
├── vercel.json         # Vercel 배포 설정
├── .nojekyll           # GitHub Pages Jekyll 비활성화
└── assets/
    ├── closed/         # 오므린 꽃 이미지
    ├── open/           # 활짝 핀 꽃 이미지
    └── seq/            # 이미지 시퀀스 프레임 (frame_0001.jpg ~)
```

---

## 테스트 시나리오

### 기능 테스트
- [ ] 데스크탑 Chrome — 양손 동시 인식, 각 손 bloom 독립 작동
- [ ] iPhone Safari — 가로화면, 가이드 표시 후 손 감지 시 즉시 숨김
- [ ] Android Chrome — 가로화면, 후면 카메라 전환
- [ ] 에셋 없을 때 — fallback 꽃(Canvas 절차적 드로잉) 표시 확인

### 성능 테스트
- [ ] 모바일에서 디버그 패널 → 모드: `hybrid`, 해상도: `?×? (mob)` 확인
- [ ] 손 30초 감지 안 됨 → FPS가 10으로 떨어지는지 확인 (idle 배터리 절약)
- [ ] 리사이즈 / 화면 회전 시 canvas 깨짐 없음

### 에러 처리 테스트
- [ ] 카메라 권한 거부 → 안내 메시지 + 재시도 버튼 표시
- [ ] HTTP 모바일 접속 → HTTPS 필요 안내 표시
- [ ] 카메라 전환 버튼 → 🤳 ↔ 📷 아이콘 전환

### 브라우저 지원
| 브라우저 | 지원 |
|---------|------|
| Chrome 90+ | ✅ |
| Safari 16.4+ (iOS) | ✅ (fullscreen 미지원) |
| Firefox 105+ | ✅ |
| Samsung Internet | ✅ |
| IE / Edge Legacy | ❌ |

---

## License

### Code
MIT License — feel free to use, modify, and distribute the source code.

### Assets
- **Images**: Created with [Nanobana](https://nanobana.ai) — all rights reserved by the original creator.
- **Video**: Generated with [Google Veo](https://deepmind.google/technologies/veo/) via Google Flow (free tier) — watermark retained, subject to [Google's Terms of Service](https://policies.google.com/terms).

> Note: The MIT License applies to the source code only. Asset files (images and video sequences) are not covered under this license and may not be redistributed independently.
