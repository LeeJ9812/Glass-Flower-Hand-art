/**
 * main.js
 * HandTracker와 FlowerRenderer를 연결하는 앱 진입점.
 */

import { HandTracker }    from './handTracker.js';
import { FlowerRenderer } from './flowerRenderer.js';
import { CONFIG }         from './config.js';

// ─────────────────────────────────────────────
// 환경 감지
// ─────────────────────────────────────────────

const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const MOBILE_MAX_LONG = 1280;

// ─────────────────────────────────────────────
// MediaPipe 대체 CDN 목록
// ─────────────────────────────────────────────

const MEDIAPIPE_FALLBACK_SCRIPTS = [
  'https://unpkg.com/@mediapipe/camera_utils/camera_utils.js',
  'https://unpkg.com/@mediapipe/drawing_utils/drawing_utils.js',
  'https://unpkg.com/@mediapipe/hands/hands.js',
];

// ─────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────

const canvasWrapper   = /** @type {HTMLElement}       */ (document.getElementById('canvas-wrapper'));
const flowerCanvas    = /** @type {HTMLCanvasElement} */ (document.getElementById('flower-canvas'));
const guideOverlay    = /** @type {HTMLElement}       */ (document.getElementById('guide-overlay'));
const loadingOverlay  = /** @type {HTMLElement}       */ (document.getElementById('loading-overlay'));
const loadingText     = /** @type {HTMLElement}       */ (document.getElementById('loading-text'));
const errorOverlay    = /** @type {HTMLElement}       */ (document.getElementById('error-overlay'));
const errorText       = /** @type {HTMLElement}       */ (document.getElementById('error-text'));
const btnCameraSwitch = /** @type {HTMLButtonElement} */ (document.getElementById('btn-camera-switch'));
const btnFullscreen   = /** @type {HTMLButtonElement} */ (document.getElementById('btn-fullscreen'));
const btnRetry        = /** @type {HTMLButtonElement} */ (document.getElementById('btn-retry'));
const appEl           = /** @type {HTMLElement}       */ (document.getElementById('app'));

// ─────────────────────────────────────────────
// App State
// ─────────────────────────────────────────────

/** @type {HandTracker|null}    */ let tracker  = null;
/** @type {FlowerRenderer|null} */ let renderer = null;

let debugVisible = false;

// FPS
let lastFpsTime = performance.now();
let fpsCount    = 0;
let currentFps  = 0;

// ── 배터리 절약: idle 시 렌더링 주기 제한 ────────
let lastHandTime = 0;
let lastDrawTime = 0;
const IDLE_AFTER = 500;
const IDLE_FPS   = 10;
const IDLE_GAP   = 1000 / IDLE_FPS;

// ── 가이드 상태 ──────────────────────────────────
let guideVisible = false;
let guideTimerId = null;

// ── bloom lerp 상태 ──────────────────────────────
let targetBloom  = 0;   // 입력 목표값 (손/데모가 설정)
let currentBloom = 0;   // lerp로 수렴하는 실제 렌더링 값

// ── 데모 모드 ────────────────────────────────────
let demoMode      = false;
let demoMouseDown = false;
let demoKeyDown   = false;
let demoRafId     = null;

// ─────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────

async function main() {
  stopPreviousTracker();
  resizeCanvases();

  renderer = new FlowerRenderer(flowerCanvas);
  setLoadingText('이미지 시퀀스 프리로드 중... (210 프레임)');
  await renderer.init();

  if (demoMode) { hideLoading(); return; }

  setLoadingText('MediaPipe 로드 중...');
  await ensureMediaPipe();

  tracker = new HandTracker({
    onHandsDetected:        handleHandsDetected,
    maxHands:               2,
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.5,
  });

  setLoadingText('손 인식 모델 로드 중...');
  await tracker.init();

  setLoadingText('카메라 시작 중...');
  await tracker.start('user');

  setMirrorMode(tracker.facingMode === 'user');
  updateCameraIcon();
  hideLoading();
  showGuide();
}

// ─────────────────────────────────────────────
// Hand Detection Callback
// ─────────────────────────────────────────────

/**
 * @param {Array<{handedness:string,bloom:number,wrist:{x:number,y:number},isOpen:boolean}>} handsData
 * @param {CanvasImageSource|null} _image  (미사용 — 꽃이 전체화면을 가림)
 */
function handleHandsDetected(handsData, _image) {
  const now = performance.now();

  // ── FPS 계산 ─────────────────────────────────────
  fpsCount++;
  const elapsed = now - lastFpsTime;
  if (elapsed >= 1000) {
    currentFps  = Math.round((fpsCount * 1000) / elapsed);
    fpsCount    = 0;
    lastFpsTime = now;
    if (debugVisible) {
      const el = document.getElementById('dbg-fps');
      if (el) el.textContent = currentFps;
    }
  }

  // ── 가이드 숨기기 ────────────────────────────────
  if (handsData.length > 0) {
    lastHandTime = now;
    if (guideVisible) hideGuide();
  }

  // ── idle 시 10fps 제한 ────────────────────────────
  const isIdle = handsData.length === 0 && (now - lastHandTime) > IDLE_AFTER;
  if (isIdle && (now - lastDrawTime) < IDLE_GAP) return;
  lastDrawTime = now;

  // ── targetBloom 설정 (손 미감지 시 마지막 값 유지) ─
  if (handsData.length > 0) {
    targetBloom = Math.max(...handsData.map(h => h.bloom));
  }

  // ── lerp + 렌더링 ────────────────────────────────
  renderBloom(false, handsData.length);

  // ── 디버그 UI ─────────────────────────────────────
  if (debugVisible) updateDebugUI(handsData, currentBloom);
}

// ─────────────────────────────────────────────
// Guide Overlay
// ─────────────────────────────────────────────

function showGuide() {
  if (!guideOverlay) return;
  guideOverlay.classList.remove('hidden');
  guideVisible = true;
  clearTimeout(guideTimerId);
  guideTimerId = setTimeout(hideGuide, 3000);
}

function hideGuide() {
  if (!guideOverlay) return;
  clearTimeout(guideTimerId);
  guideOverlay.classList.add('hidden');
  guideVisible = false;
}

// ─────────────────────────────────────────────
// Mirror Mode
// ─────────────────────────────────────────────

/** @param {boolean} isMirror */
function setMirrorMode(isMirror) {
  canvasWrapper.style.transform = isMirror ? 'scaleX(-1)' : '';
}

// ─────────────────────────────────────────────
// Camera Switch
// ─────────────────────────────────────────────

async function switchCamera() {
  if (!tracker) return;
  btnCameraSwitch.disabled = true;
  try {
    await tracker.switchCamera();
    setMirrorMode(tracker.facingMode === 'user');
    updateCameraIcon();
  } catch (err) {
    showError(err);
  } finally {
    btnCameraSwitch.disabled = false;
  }
}

function updateCameraIcon() {
  const isFront = tracker?.facingMode === 'user';
  btnCameraSwitch.innerHTML =
    `<span style="font-size:1.2rem;line-height:1;">${isFront ? '🤳' : '📷'}</span>`;
  btnCameraSwitch.title = isFront ? '후면 카메라로 전환' : '전면 카메라로 전환';
  btnCameraSwitch.setAttribute('aria-label', btnCameraSwitch.title);
}

// ─────────────────────────────────────────────
// Fullscreen
// ─────────────────────────────────────────────

function toggleFullscreen() {
  const el  = document.documentElement;
  const any = /** @type {any} */ (document);
  if (!document.fullscreenElement && !any.webkitFullscreenElement) {
    (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch?.(() => {});
  } else {
    (document.exitFullscreen?.() ?? any.webkitExitFullscreen?.())?.catch?.(() => {});
  }
}

// ─────────────────────────────────────────────
// Canvas Resize
// ─────────────────────────────────────────────

function resizeCanvases() {
  let bufW = window.innerWidth;
  let bufH = window.innerHeight;

  if (IS_MOBILE) {
    const longSide = Math.max(bufW, bufH);
    if (longSide > MOBILE_MAX_LONG) {
      const scale = MOBILE_MAX_LONG / longSide;
      bufW = Math.round(bufW * scale);
      bufH = Math.round(bufH * scale);
    }
  }

  // renderer 미초기화 시에도 canvas 크기를 미리 확보
  flowerCanvas.width  = bufW;
  flowerCanvas.height = bufH;
  renderer?.resize(bufW, bufH);
}

// ─────────────────────────────────────────────
// MediaPipe 로드 보장
// ─────────────────────────────────────────────

async function ensureMediaPipe() {
  if (typeof Hands !== 'undefined') return;
  setLoadingText('MediaPipe 재로드 중 (대체 CDN)...');
  for (const url of MEDIAPIPE_FALLBACK_SCRIPTS) {
    await loadScript(url).catch(() => {});
  }
  if (typeof Hands === 'undefined') {
    throw new Error('MediaPipe를 로드할 수 없습니다.\n인터넷 연결을 확인하거나 페이지를 새로고침해 주세요.');
  }
}

/** @param {string} url @returns {Promise<void>} */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(); s.onerror = () => reject();
    document.head.appendChild(s);
  });
}

// ─────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────

function stopPreviousTracker() {
  tracker?.dispose();
  tracker = null;
}

// ─────────────────────────────────────────────
// Demo Mode
// ─────────────────────────────────────────────

function createDemoLabel() {
  const el = document.createElement('div');
  el.id = 'demo-label';
  el.textContent = 'DEMO MODE';
  el.style.cssText = [
    'display:none', 'position:absolute', 'top:14px', 'left:50%',
    'transform:translateX(-50%)', 'background:rgba(255,50,0,0.82)',
    'color:#fff', 'font-family:monospace', 'font-size:0.8rem',
    'font-weight:bold', 'letter-spacing:0.14em', 'padding:4px 16px',
    'border-radius:4px', 'z-index:200', 'pointer-events:none',
    'user-select:none',
  ].join(';');
  appEl.appendChild(el);
}

function startDemoMode() {
  demoMode      = true;
  demoMouseDown = false;
  demoKeyDown   = false;
  targetBloom   = 0;

  tracker?.stop();
  tracker?.dispose();
  tracker = null;

  hideLoading();
  errorOverlay.style.display = 'none';
  hideGuide();
  setMirrorMode(false);

  document.getElementById('demo-label').style.display = 'block';

  if (demoRafId) cancelAnimationFrame(demoRafId);
  demoRafId = requestAnimationFrame(demoLoop);
}

function stopDemoMode() {
  demoMode = false;
  if (demoRafId) { cancelAnimationFrame(demoRafId); demoRafId = null; }
  document.getElementById('demo-label').style.display = 'none';
  loadingOverlay.style.display = 'flex';
  loadingOverlay.style.opacity = '1';
  main().catch(showError);
}

function demoLoop() {
  if (!demoMode || !renderer) return;

  targetBloom = (demoMouseDown || demoKeyDown) ? 1 : 0;
  renderBloom(true, 0);

  demoRafId = requestAnimationFrame(demoLoop);
}

// ─────────────────────────────────────────────
// Bloom Lerp + Render (데모/실제 공통)
// ─────────────────────────────────────────────

/**
 * targetBloom → currentBloom lerp 후 렌더링 + 콘솔 로그.
 * @param {boolean} isDemo
 * @param {number}  handCount  감지된 손 수 (로그용)
 */
function renderBloom(isDemo, handCount) {
  currentBloom += (targetBloom - currentBloom) * CONFIG.bloom.lerpSpeed;
  currentBloom  = Math.max(0, Math.min(1, currentBloom));

  renderer.render(currentBloom);

  const frameIndex = Math.floor(currentBloom * (CONFIG.assets.totalFrames - 1)) + 1;
  console.log(
    `mode: ${isDemo ? 'DEMO' : 'HAND'} | hands: ${handCount}` +
    ` | targetBloom: ${targetBloom.toFixed(2)}` +
    ` | currentBloom: ${currentBloom.toFixed(2)}` +
    ` | frame: ${frameIndex}`
  );
}

// ─────────────────────────────────────────────
// Debug UI
// ─────────────────────────────────────────────

function createDebugPanel() {
  const panel = document.createElement('div');
  panel.id    = 'debug-panel';
  panel.innerHTML = `
    <div class="debug-header">
      <span class="debug-label">DEBUG</span>
      <button id="btn-debug-toggle">OFF</button>
    </div>
    <div id="debug-body" style="display:none;">
      <div class="dbg-row">
        <span class="dbg-key">FPS</span>
        <span class="dbg-val" id="dbg-fps">--</span>
      </div>
      <div class="dbg-row">
        <span class="dbg-key">모드</span>
        <span class="dbg-val" id="dbg-mode">--</span>
      </div>
      <div class="dbg-row">
        <span class="dbg-key">해상도</span>
        <span class="dbg-val" id="dbg-res">--</span>
      </div>
      <div class="dbg-row">
        <span class="dbg-key">bloom</span>
        <span class="dbg-val" id="dbg-bloom">0.00</span>
      </div>
      <div class="dbg-row">
        <span class="dbg-key">손</span>
        <span class="dbg-val" id="dbg-hands">0</span>
      </div>
    </div>
  `;
  appEl.appendChild(panel);

  document.getElementById('btn-debug-toggle').addEventListener('click', () => {
    debugVisible = !debugVisible;
    const body = document.getElementById('debug-body');
    const btn  = document.getElementById('btn-debug-toggle');
    body.style.display = debugVisible ? 'flex' : 'none';
    btn.textContent    = debugVisible ? 'ON'   : 'OFF';
    btn.classList.toggle('on', debugVisible);

    if (debugVisible) {
      document.getElementById('dbg-fps').textContent  = currentFps;
      document.getElementById('dbg-mode').textContent = renderer?.mode ?? '--';
      document.getElementById('dbg-res').textContent  =
        `${flowerCanvas.width}×${flowerCanvas.height}${IS_MOBILE ? ' (mob)' : ''}`;
    }
  });
}

/**
 * @param {Array} handsData
 * @param {number} bloom
 */
function updateDebugUI(handsData, bloom) {
  const handsEl = document.getElementById('dbg-hands');
  const bloomEl = document.getElementById('dbg-bloom');
  if (!handsEl || !bloomEl) return;

  handsEl.textContent = handsData.length;
  const hue = Math.round(bloom * 120);
  bloomEl.style.color = `hsl(${hue},80%,65%)`;
  bloomEl.textContent = bloom.toFixed(2);
}

// ─────────────────────────────────────────────
// Loading / Error UI
// ─────────────────────────────────────────────

function hideLoading() {
  loadingOverlay.style.opacity = '0';
  setTimeout(() => { loadingOverlay.style.display = 'none'; }, 500);
}

/** @param {unknown} err */
function showError(err) {
  errorText.textContent        = categorizeError(err);
  errorOverlay.style.display   = 'flex';
  loadingOverlay.style.display = 'none';
}

/** @param {unknown} err @returns {string} */
function categorizeError(err) {
  const name = /** @type {any} */ (err)?.name ?? '';
  const msg  = err instanceof Error ? err.message : String(err);

  if (IS_MOBILE && !['localhost','127.0.0.1'].includes(location.hostname)
      && location.protocol !== 'https:') {
    return '모바일에서 카메라를 사용하려면 HTTPS가 필요합니다.\nhttps:// 주소로 접속해 주세요.';
  }

  return ({
    NotAllowedError:      '카메라 권한이 거부되었습니다.\n브라우저 주소창의 카메라 아이콘을 클릭해 허용한 뒤 재시도해 주세요.',
    NotFoundError:        '카메라를 찾을 수 없습니다.\n기기에 카메라가 연결되어 있는지 확인해 주세요.',
    NotReadableError:     '카메라가 다른 앱에서 사용 중입니다.\n다른 앱을 종료 후 재시도해 주세요.',
    OverconstrainedError: '요청한 카메라 설정을 지원하지 않습니다.',
  })[name] ?? msg;
}

/** @param {string} msg */
function setLoadingText(msg) { loadingText.textContent = msg; }

// ─────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────

btnCameraSwitch.addEventListener('click', () => switchCamera());
btnFullscreen.addEventListener('click', toggleFullscreen);

btnRetry.addEventListener('click', () => {
  errorOverlay.style.display   = 'none';
  loadingOverlay.style.display = 'flex';
  loadingOverlay.style.opacity = '1';
  main().catch(showError);
});

window.addEventListener('resize', resizeCanvases);

// ── 데모 모드: 마우스 클릭 ───────────────────────
appEl.addEventListener('mousedown', () => { if (demoMode) demoMouseDown = true; });
window.addEventListener('mouseup',  () => { demoMouseDown = false; });

// ── 데모 모드: 스페이스바 ────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && demoMode) { e.preventDefault(); demoKeyDown = true; }
  if ((e.key === 'd' || e.key === 'D') && !e.repeat) {
    if (demoMode) stopDemoMode(); else startDemoMode();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') demoKeyDown = false;
});

// ─────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────

createDemoLabel();
createDebugPanel();
main().catch(showError);
