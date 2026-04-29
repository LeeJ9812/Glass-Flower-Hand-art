/**
 * flowerRenderer.js
 * bloom(0~1) 값에 따라 꽃 에셋을 전체화면 cover로 렌더링한다.
 *
 *  bloom <= closedThreshold → 오므린 이미지 (assets/closed/image.jpeg)
 *  closedThreshold < bloom < openThreshold → 시퀀스 프레임 (assets/seq/)
 *  bloom >= openThreshold   → 활짝 핀 이미지 (assets/open/image.jpeg)
 */

import { CONFIG } from './config.js';

const IMG_CLOSED = 'assets/closed/image.jpeg';
const IMG_OPEN   = 'assets/open/image.jpeg';

export class FlowerRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._width  = canvas.width;
    this._height = canvas.height;

    /** @type {HTMLImageElement|null} */ this._imgClosed = null;
    /** @type {HTMLImageElement|null} */ this._imgOpen   = null;

    // 1-indexed 객체: preloadedFrames[1] ~ preloadedFrames[totalFrames]
    /** @type {Object.<number, HTMLImageElement>} */
    this._frames = {};

    /** @type {'full'|'seq-only'|'image-only'|'fallback'} */
    this._mode = 'fallback';
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  async init() {
    const [closed, open_] = await Promise.allSettled([
      this._loadImage(IMG_CLOSED),
      this._loadImage(IMG_OPEN),
    ]);
    if (closed.status === 'fulfilled') this._imgClosed = closed.value;
    if (open_.status  === 'fulfilled') this._imgOpen   = open_.value;

    await this._preloadFrames();

    const hasSeq    = Object.keys(this._frames).length > 0;
    const hasImages = this._imgClosed && this._imgOpen;

    if (hasSeq && hasImages)  this._mode = 'full';
    else if (hasSeq)          this._mode = 'seq-only';
    else if (hasImages)       this._mode = 'image-only';
    else                      this._mode = 'fallback';
  }

  /** 렌더링 모드 (디버그용) */
  get mode() { return this._mode; }

  /** @param {number} w @param {number} h */
  resize(w, h) {
    this._width  = w;
    this._height = h;
    this._canvas.width  = w;
    this._canvas.height = h;
  }

  /**
   * @param {number} bloom 0~1 (currentBloom — 이미 lerp 적용된 값)
   */
  render(bloom) {
    this._ctx.clearRect(0, 0, this._width, this._height);

    if (bloom <= CONFIG.bloom.closedThreshold) {
      // ── 오므린 이미지 ─────────────────────────────
      this._drawCover(this._imgClosed);

    } else if (bloom >= CONFIG.bloom.openThreshold) {
      // ── 활짝 핀 이미지 ────────────────────────────
      this._drawCover(this._imgOpen);

    } else {
      // ── 시퀀스 프레임: closedThreshold~openThreshold 구간을 0~1로 정규화 ─
      const range      = CONFIG.bloom.openThreshold - CONFIG.bloom.closedThreshold;
      const t          = (bloom - CONFIG.bloom.closedThreshold) / range;
      const frameIndex = Math.floor(t * (CONFIG.assets.totalFrames - 1)) + 1;
      const frame      = this._frames[frameIndex];

      if (frame && frame.complete) {
        this._drawCover(frame);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Private — 프리로드
  // ─────────────────────────────────────────────

  async _preloadFrames() {
    const { totalFrames, seqDir, seqExtension } = CONFIG.assets;

    const promises = Array.from({ length: totalFrames }, (_, i) => {
      const index = i + 1;  // 1-indexed
      const pad   = String(index).padStart(4, '0');
      return new Promise((resolve) => {
        const img = new Image();
        img.onload  = () => { this._frames[index] = img; resolve(); };
        img.onerror = () => resolve();  // 실패한 프레임은 건너뜀
        img.src = `${seqDir}frame_${pad}${seqExtension}`;
      });
    });

    await Promise.all(promises);
    console.log(`Frames preloaded: ${Object.keys(this._frames).length}`);
  }

  // ─────────────────────────────────────────────
  // Private — 렌더링
  // ─────────────────────────────────────────────

  /**
   * object-fit:cover 방식으로 캔버스 전체를 채운다.
   * @param {HTMLImageElement|null|undefined} source
   */
  _drawCover(source) {
    if (!source) return;

    const sw = source.naturalWidth  || this._width;
    const sh = source.naturalHeight || this._height;

    const srcAspect  = sw / sh;
    const destAspect = this._width / this._height;

    let drawW, drawH, offsetX, offsetY;

    if (srcAspect > destAspect) {
      drawH   = this._height;
      drawW   = drawH * srcAspect;
      offsetX = (this._width - drawW) / 2;
      offsetY = 0;
    } else {
      drawW   = this._width;
      drawH   = drawW / srcAspect;
      offsetX = 0;
      offsetY = (this._height - drawH) / 2;
    }

    this._ctx.drawImage(source, offsetX, offsetY, drawW, drawH);
  }

  // ─────────────────────────────────────────────
  // Private — 에셋 로드
  // ─────────────────────────────────────────────

  /** @param {string} src @returns {Promise<HTMLImageElement>} */
  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
      img.src = src;
    });
  }
}
