/**
 * handTracker.js
 * MediaPipe Hands 초기화 및 손 상태(bloom 값) 분석을 담당한다.
 */

// ─────────────────────────────────────────────
// 랜드마크 인덱스 상수
// MediaPipe Hands 21개 포인트: 0=wrist, 1-4=thumb, 5-8=index, ...
// ─────────────────────────────────────────────

const LM = {
  WRIST: 0,
  // 각 손가락: [MCP, PIP, DIP, TIP]
  THUMB:  [1,  2,  3,  4],
  INDEX:  [5,  6,  7,  8],
  MIDDLE: [9,  10, 11, 12],
  RING:   [13, 14, 15, 16],
  PINKY:  [17, 18, 19, 20],
};

// bloom 계산에 사용할 4개 손가락 (엄지 제외)
const FINGERS = [LM.INDEX, LM.MIDDLE, LM.RING, LM.PINKY];

// 각도 → bloom 변환 범위
const ANGLE_STRAIGHT = 160; // 이상이면 bloom 1.0
const ANGLE_BENT     = 90;  // 이하이면 bloom 0.0

// isOpen 판단 임계값 (낮출수록 더 민감)
const OPEN_THRESHOLD = 0.6;

// 모바일 감지: modelComplexity 0으로 낮춰 CPU 부하 절감
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// 카메라 해상도 (모바일은 720p로 제한)
const CAM_WIDTH  = IS_MOBILE ? 1280 : 1920;
const CAM_HEIGHT = IS_MOBILE ?  720 : 1080;

// ─────────────────────────────────────────────
// 카메라 권한 에러 메시지
// ─────────────────────────────────────────────

const CAM_ERROR_MESSAGES = {
  NotAllowedError:    '카메라 접근 권한이 거부되었습니다.\n브라우저 설정에서 카메라 권한을 허용해 주세요.',
  NotFoundError:      '카메라를 찾을 수 없습니다.\n기기에 카메라가 연결되어 있는지 확인해 주세요.',
  NotReadableError:   '카메라가 다른 앱에서 사용 중입니다.\n다른 앱을 종료 후 다시 시도해 주세요.',
  OverconstrainedError: '요청한 카메라 설정을 지원하지 않습니다.',
  default:            '카메라를 시작할 수 없습니다. 다시 시도해 주세요.',
};

// ─────────────────────────────────────────────
// 내부 수학 유틸
// ─────────────────────────────────────────────

/**
 * 두 랜드마크 사이의 2D 벡터를 반환한다.
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {{x:number,y:number}}
 */
function vec2(a, b) {
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * 두 2D 벡터의 각도(도)를 반환한다.
 * @param {{x:number,y:number}} u
 * @param {{x:number,y:number}} v
 * @returns {number} 0~180
 */
function angleDeg(u, v) {
  const dot  = u.x * v.x + u.y * v.y;
  const magU = Math.hypot(u.x, u.y);
  const magV = Math.hypot(v.x, v.y);
  if (magU === 0 || magV === 0) return 0;
  // 부동소수 오차로 [-1, 1] 범위를 벗어나는 것을 방지
  const cosA = Math.max(-1, Math.min(1, dot / (magU * magV)));
  return Math.acos(cosA) * (180 / Math.PI);
}

/**
 * 각도를 bloom 값(0~1)으로 선형 보간한다.
 * ANGLE_BENT 이하 → 0, ANGLE_STRAIGHT 이상 → 1.
 * @param {number} deg
 * @returns {number}
 */
function angleToBloom(deg) {
  if (deg <= ANGLE_BENT)     return 0;
  if (deg >= ANGLE_STRAIGHT) return 1;
  return (deg - ANGLE_BENT) / (ANGLE_STRAIGHT - ANGLE_BENT);
}

/**
 * 손가락 하나의 bloom 값을 계산한다.
 * MCP→PIP 벡터와 PIP→DIP 벡터의 각도를 사용한다.
 *
 * @param {Array<{x:number,y:number,z:number}>} landmarks - 21개
 * @param {number[]} finger - [MCP, PIP, DIP, TIP] 인덱스
 * @returns {number} 0~1
 */
function fingerBloom(landmarks, finger) {
  const mcp = landmarks[finger[0]];
  const pip = landmarks[finger[1]];
  const dip = landmarks[finger[2]];

  const v1 = vec2(mcp, pip); // MCP → PIP
  const v2 = vec2(pip, dip); // PIP → DIP

  return angleToBloom(angleDeg(v1, v2));
}

// ─────────────────────────────────────────────
// HandTracker
// ─────────────────────────────────────────────

/**
 * HandTracker — MediaPipe Hands 래퍼.
 *
 * 사용법:
 *   const tracker = new HandTracker({ onHandsDetected });
 *   await tracker.init();
 *   await tracker.start('user');   // facingMode
 *   tracker.stop();
 *   await tracker.dispose();
 */
export class HandTracker {
  /**
   * @param {object}   options
   * @param {function} [options.onHandsDetected]  - 매 프레임 결과 콜백
   * @param {number}   [options.maxHands=2]
   * @param {number}   [options.minDetectionConfidence=0.7]
   * @param {number}   [options.minTrackingConfidence=0.5]
   */
  constructor(options = {}) {
    this._onHandsDetected        = options.onHandsDetected        ?? (() => {});
    this._maxHands               = options.maxHands               ?? 2;
    this._minDetectionConfidence = options.minDetectionConfidence ?? 0.7;
    this._minTrackingConfidence  = options.minTrackingConfidence  ?? 0.5;

    /** @type {Hands|null} */
    this._hands = null;

    /** @type {MediaStream|null} */
    this._stream = null;

    /** @type {HTMLVideoElement|null} */
    this._videoEl = null;

    /** @type {Camera|null} */
    this._camera = null;

    /** @type {'user'|'environment'} */
    this._facingMode = 'user';

    this._running = false;

    // 직전 프레임의 bloom 값을 저장해 부드러운 보간(smoothing)에 사용
    /** @type {Map<string, number>} handedness → smoothed bloom */
    this._smoothedBloom = new Map();
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * MediaPipe Hands 인스턴스를 초기화한다.
   * CDN 스크립트가 로드된 이후에 호출해야 한다.
   * @returns {Promise<void>}
   */
  async init() {
    this._hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this._hands.setOptions({
      maxNumHands:              this._maxHands,
      modelComplexity:          IS_MOBILE ? 0 : 1, // 모바일: 0(경량), 데스크탑: 1(고정밀)
      minDetectionConfidence:   this._minDetectionConfidence,
      minTrackingConfidence:    this._minTrackingConfidence,
    });

    this._hands.onResults((results) => this._onMediaPipeResults(results));

    // 모델 바이너리 다운로드 완료까지 대기
    await this._hands.initialize();
  }

  /**
   * 지정한 방향의 카메라를 열고 MediaPipe 추적을 시작한다.
   * @param {'user'|'environment'} [facingMode='user']
   * @returns {Promise<void>}
   */
  async start(facingMode = 'user') {
    this._facingMode = facingMode;
    this._stream = await this._openCamera(facingMode);

    // 히든 video 엘리먼트 생성 (없으면)
    if (!this._videoEl) {
      this._videoEl = document.createElement('video');
      this._videoEl.setAttribute('playsinline', '');
      this._videoEl.muted = true;
      this._videoEl.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(this._videoEl);
    }

    this._videoEl.srcObject = this._stream;
    await this._videoEl.play();

    this._camera = new Camera(this._videoEl, {
      onFrame: async () => {
        if (this._running && this._hands) {
          await this._hands.send({ image: this._videoEl });
        }
      },
      width:  CAM_WIDTH,
      height: CAM_HEIGHT,
    });

    await this._camera.start();
    this._running = true;
  }

  /**
   * 추적을 일시 중지하고 카메라 스트림을 닫는다.
   */
  stop() {
    this._running = false;
    this._camera?.stop();
    this._camera = null;
    this._stopStream();
  }

  /**
   * 전면/후면 카메라를 전환한다.
   * @returns {Promise<void>}
   */
  async switchCamera() {
    const next = this._facingMode === 'user' ? 'environment' : 'user';
    this.stop();
    await this.start(next);
  }

  /**
   * 리소스를 완전히 해제한다.
   * @returns {Promise<void>}
   */
  /** 현재 카메라 방향을 반환한다. */
  get facingMode() { return this._facingMode; }

  async dispose() {
    this.stop();
    await this._hands?.close();
    this._hands = null;
    if (this._videoEl) {
      this._videoEl.remove();
      this._videoEl = null;
    }
    this._smoothedBloom.clear();
  }

  // ─────────────────────────────────────────────
  // Private — Camera
  // ─────────────────────────────────────────────

  /**
   * getUserMedia로 스트림을 열고 반환한다.
   * @param {'user'|'environment'} facingMode
   * @returns {Promise<MediaStream>}
   */
  async _openCamera(facingMode) {
    const constraints = {
      video: {
        facingMode,
        width:  { ideal: CAM_WIDTH  },
        height: { ideal: CAM_HEIGHT },
        frameRate: { ideal: 30 },
      },
      audio: false,
    };

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      const msg = CAM_ERROR_MESSAGES[err.name] ?? CAM_ERROR_MESSAGES.default;
      throw new Error(msg);
    }
  }

  /** 현재 스트림의 모든 트랙을 정지한다. */
  _stopStream() {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
  }

  // ─────────────────────────────────────────────
  // Private — MediaPipe 결과 처리
  // ─────────────────────────────────────────────

  /**
   * MediaPipe가 각 프레임마다 호출하는 results 콜백.
   * 분석 결과를 onHandsDetected 형식으로 변환해 전달한다.
   * @param {object} results
   */
  _onMediaPipeResults(results) {
    const handsData = [];

    const landmarksList   = results.multiHandLandmarks   ?? [];
    const handednessList  = results.multiHandedness       ?? [];

    for (let i = 0; i < landmarksList.length; i++) {
      const landmarks  = landmarksList[i];
      const handedness = handednessList[i]?.label ?? 'Unknown'; // "Left" | "Right"

      const bloom  = this._computeBloom(landmarks, handedness);
      // 손바닥 중심: landmark 9 (중지 MCP) — 손목보다 안정적으로 손 중심을 추적
      const wrist  = { x: landmarks[9].x, y: landmarks[9].y };
      const isOpen = bloom > OPEN_THRESHOLD;

      handsData.push({ handedness, bloom, wrist, landmarks, isOpen });
    }

    // 감지된 손이 없으면 smoothed 맵 초기화
    if (handsData.length === 0) {
      this._smoothedBloom.clear();
    }

    // results.image: MediaPipe가 처리한 입력 프레임 (webcam 렌더링에 사용)
    this._onHandsDetected(handsData, results.image ?? null);
  }

  // ─────────────────────────────────────────────
  // Private — Bloom 계산
  // ─────────────────────────────────────────────

  /**
   * 21개 랜드마크에서 bloom 값(0~1)을 계산한다.
   * 검지~소지 4개 손가락 평균을 지수이동평균으로 부드럽게 한다.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {string} handedness - smoothing 키로 사용
   * @returns {number} 0~1
   */
  _computeBloom(landmarks, handedness) {
    // 4개 손가락의 bloom 평균
    const raw = FINGERS.reduce((sum, finger) => sum + fingerBloom(landmarks, finger), 0) / FINGERS.length;

    // 지수이동평균으로 프레임 간 떨림 제거 (alpha: 0.3 = 부드러움, 0.7 = 반응 빠름)
    const ALPHA   = 0.35;
    const prev    = this._smoothedBloom.get(handedness) ?? raw;
    const smoothed = ALPHA * raw + (1 - ALPHA) * prev;
    this._smoothedBloom.set(handedness, smoothed);

    return Math.max(0, Math.min(1, smoothed));
  }

  // ─────────────────────────────────────────────
  // Public Static — 유틸 (flowerRenderer에서 재사용 가능)
  // ─────────────────────────────────────────────

  /**
   * bloom > OPEN_THRESHOLD 여부를 반환한다.
   * @param {number} bloom
   * @returns {boolean}
   */
  static isOpen(bloom) {
    return bloom > OPEN_THRESHOLD;
  }

  /**
   * 손 랜드마크 전체의 평균 좌표를 반환한다.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {{x:number, y:number}}
   */
  static getHandCenter(landmarks) {
    let sx = 0, sy = 0;
    for (const lm of landmarks) { sx += lm.x; sy += lm.y; }
    return { x: sx / landmarks.length, y: sy / landmarks.length };
  }

  /**
   * 손목(0)~중지 tip(12)의 정규화 좌표 거리를 반환한다.
   * flowerRenderer의 꽃 크기 스케일링에 사용한다.
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {number}
   */
  static getHandScale(landmarks) {
    const wrist = landmarks[LM.WRIST];
    const tip   = landmarks[LM.MIDDLE[3]]; // 중지 TIP
    return Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  }
}
