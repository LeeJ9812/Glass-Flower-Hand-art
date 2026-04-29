/**
 * config.js
 * 에셋·bloom 동작 설정. 값만 바꾸면 전체에 반영된다.
 */

export const CONFIG = {
  bloom: {
    lerpSpeed:       0.08,  // 매 프레임 currentBloom이 targetBloom에 수렴하는 속도
    closedThreshold: 0.3,   // 이하: 오므린 이미지
    openThreshold:   0.7,   // 이상: 활짝 핀 이미지
  },
  assets: {
    totalFrames:  239,           // 시퀀스 프레임 수 (교체 시 여기만 수정)
    seqDir:       'assets/seq/', // 시퀀스 폴더 경로
    seqExtension: '.jpg',        // 시퀀스 파일 확장자
  },
};

console.log(`Config loaded: totalFrames = ${CONFIG.assets.totalFrames}`);
