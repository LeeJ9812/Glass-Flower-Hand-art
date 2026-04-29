/**
 * handTracker.js
 * MediaPipe Hands 초기화 및 손 상태(bloom 값) 분석을 담당한다.
 *
 * bloom 계산 방식: 손가락 tip y좌표 vs 손목 y좌표 비교
 *  - tip.y < wrist.y - OPEN_Y_THRESHOLD → 손가락 펼쳐짐
 *  - openCount / 4 = bloom (0 | 0.25 | 0.5 | 0.75 | 1.0)
 */

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────

// 검지(8) 중지(12) 약지(16) 소지(20) tip 인덱스
const FINGER_TIPS = [8, 12, 16, 20];

// tip.y 가 wrist.y 보다 이 값 이상 위에 있으면 펼쳐진 것으로 판정
// (정규화 좌표 기준, 위가 0 아래가 1)
const OPEN_Y_THRESHOLD = 0.05;

// 모바일 감지
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// 카메라 해상도 (모바일 640×360, PC 1280×720)
const CAM_WIDTH  = IS_MOBILE ?  640 : 1280;
const CAM_HEIGHT = IS_MOBILE ?  360 :  720;

// ─────────────────────────────────────────────
// 카메라 권한 에러 메시지
// ─────────────────────────────────────────────

const CAM_ERROR_MESSAGES = {
  NotAllowedError:      '카메라 접근 권한이 거부되었습니다.\n브라우저 설정에서 카메라 권한을 허용해 주세요.',
  NotFoundError:        '카메라를 찾을 수 없습니다.\n기기에 카메라가 연결되어 있는지 확인해 주세요.',
  NotReadableError:     '카메라가 다른 앱에서 사용 중입니다.\n다른 앱을 종료 후 다시 시도해 주세요.',
  OverconstrainedError: '요청한 카메라 설정을 지원하지 않습니다.',
  default:              '카메라를 시작할 수 없습니다. 다시 시도해 주세요.',
};

// ─────────────────────────────────────────────
// HandTracker
// ─────────────────────────────────────────────

export class HandTracker {
  /**
   * @param {object}   options
   * @param {function} [options.onHandsDetected]
   * @param {number}   [options.maxHands=2]
   * @param {number}   [options.minDetectionConfidence=0.3]
   * @param {number}   [options.minTrackingConfidence=0.3]
   */
  constructor(options = {}) {
    this._onHandsDetected        = options.onHandsDetected        ?? (() => {});
    this._maxHands               = options.maxHands               ?? 2;
    this._minDetectionConfidence = options.minDetectionConfidence ?? 0.3;
    this._minTrackingConfidence  = options.minTrackingConfidence  ?? 0.3;

    /** @type {any} */          this._hands    = null;
    /** @type {MediaStream|null} */ this._stream = null;
    /** @type {HTMLVideoElement|null} */ this._videoEl = null;
    /** @type {any} */          this._camera   = null;
    /** @type {'user'|'environment'} */ this._facingMode = 'user';
    this._running = false;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  async init() {
    this._hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this._hands.setOptions({
      maxNumHands:            this._maxHands,
      modelComplexity:        IS_MOBILE ? 0 : 1,
      minDetectionConfidence: this._minDetectionConfidence,
      minTrackingConfidence:  this._minTrackingConfidence,
    });

    this._hands.onResults((results) => this._onMediaPipeResults(results));
    await this._hands.initialize();
  }

  /** @param {'user'|'environment'} [facingMode='user'] */
  async start(facingMode = 'user') {
    this._facingMode = facingMode;
    this._stream = await this._openCamera(facingMode);

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

  stop() {
    this._running = false;
    this._camera?.stop();
    this._camera = null;
    this._stopStream();
  }

  async switchCamera() {
    const next = this._facingMode === 'user' ? 'environment' : 'user';
    this.stop();
    await this.start(next);
  }

  get facingMode() { return this._facingMode; }

  async dispose() {
    this.stop();
    await this._hands?.close();
    this._hands = null;
    if (this._videoEl) { this._videoEl.remove(); this._videoEl = null; }
  }

  // ─────────────────────────────────────────────
  // Private — Camera
  // ─────────────────────────────────────────────

  async _openCamera(facingMode) {
    const constraints = {
      video: {
        facingMode,
        width:     { ideal: CAM_WIDTH  },
        height:    { ideal: CAM_HEIGHT },
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

  _stopStream() {
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
  }

  // ─────────────────────────────────────────────
  // Private — MediaPipe 결과 처리
  // ─────────────────────────────────────────────

  _onMediaPipeResults(results) {
    const handsData      = [];
    const landmarksList  = results.multiHandLandmarks  ?? [];
    const handednessList = results.multiHandedness     ?? [];

    for (let i = 0; i < landmarksList.length; i++) {
      const landmarks  = landmarksList[i];
      const handedness = handednessList[i]?.label ?? 'Unknown';

      // 디버그: 첫 번째 손의 랜드마크·bloom 출력
      if (i === 0) {
        console.log('landmarks:', landmarks);
      }

      const { bloom, fingerStates } = this._computeBloom(landmarks);

      if (i === 0) {
        console.log('bloom:', bloom, '| fingers:', fingerStates.map(f => f ? 'O' : 'X').join(' '));
      }

      handsData.push({
        handedness,
        bloom,
        fingerStates,  // [검지, 중지, 약지, 소지] 각 true=open
        wrist:  { x: landmarks[9].x, y: landmarks[9].y },
        isOpen: bloom >= 0.5,
        landmarks,
      });
    }

    this._onHandsDetected(handsData, results.image ?? null);
  }

  // ─────────────────────────────────────────────
  // Private — Bloom 계산 (y좌표 기반)
  // ─────────────────────────────────────────────

  /**
   * 손가락 tip의 y좌표가 손목보다 위에 있으면 펼쳐진 것으로 판정.
   * MediaPipe 정규화 좌표: 위=0, 아래=1.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @returns {{ bloom: number, fingerStates: boolean[] }}
   */
  _computeBloom(landmarks) {
    const wrist        = landmarks[0];
    const fingerStates = FINGER_TIPS.map(tipIdx => landmarks[tipIdx].y < wrist.y - OPEN_Y_THRESHOLD);
    const openCount    = fingerStates.filter(Boolean).length;
    const bloom        = openCount / FINGER_TIPS.length;  // 0 | 0.25 | 0.5 | 0.75 | 1.0

    return { bloom, fingerStates };
  }
}
