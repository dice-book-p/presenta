/**
 * 서명 연출 테마 프리셋 정의
 *
 * 테마는 "빠른 적용" 용도 — 선택 시 개별 값이 채워지고, 이후 자유롭게 수정 가능.
 */

const THEMES = {
  gold: {
    label: '골드 클래식',
    color: '#c9a84c',
    penParticle: true,
    penColor: '#c9a84c',
    penSize: 'medium',
    penDensity: 'normal',
    ambientParticle: true,
    ambientColor: '#c9a84c',
    ambientDensity: 'low',
    sealEffect: true,
    sealColor: '#c9a84c',
    sealDuration: 6,
    transition: 'diamond',
  },
  silver: {
    label: '실버 엘레강스',
    color: '#c0c0c0',
    penParticle: true,
    penColor: '#c0c0c0',
    penSize: 'medium',
    penDensity: 'normal',
    ambientParticle: true,
    ambientColor: '#c0c0c0',
    ambientDensity: 'low',
    sealEffect: true,
    sealColor: '#c0c0c0',
    sealDuration: 6,
    transition: 'fade',
  },
  rosegold: {
    label: '로즈골드',
    color: '#b76e79',
    penParticle: true,
    penColor: '#b76e79',
    penSize: 'medium',
    penDensity: 'normal',
    ambientParticle: true,
    ambientColor: '#b76e79',
    ambientDensity: 'low',
    sealEffect: true,
    sealColor: '#b76e79',
    sealDuration: 6,
    transition: 'zoom',
  },
};

/**
 * signEffect → effectConfig 반환.
 * 시각/오디오 효과가 하나라도 켜져 있으면 config 반환, 아니면 null.
 */
export function getEffectConfig(signEffect) {
  if (!signEffect) return null;
  // 시각 효과나 오디오가 하나라도 켜져 있으면 활성
  const hasVisual = signEffect.penParticle || signEffect.ambientParticle || signEffect.sealEffect;
  const hasAudio = signEffect.bgmId || signEffect.completeSoundId;
  const hasTransition = signEffect.transition && signEffect.transition !== 'none';
  const hasVideo = signEffect.mode === 'video';
  if (!hasVisual && !hasAudio && !hasTransition && !hasVideo && !signEffect.autoAdvance) return null;
  return { ...signEffect };
}

export { THEMES };
