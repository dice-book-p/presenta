/**
 * 서명 연출 테마 프리셋 정의
 */

const THEMES = {
  gold: {
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
 * 테마명으로 config를 반환.
 * 'custom'이면 signEffect 그대로 반환, 'none'이면 null.
 */
export function getThemeConfig(signEffect) {
  if (!signEffect || signEffect.theme === 'none') return null;
  if (signEffect.theme === 'custom') {
    return { ...signEffect };
  }
  const preset = THEMES[signEffect.theme];
  if (!preset) return null;
  // 프리셋 + 오디오/모드 설정은 signEffect에서 가져옴
  return {
    ...preset,
    mode: signEffect.mode,
    bgmId: signEffect.bgmId,
    bgmMode: signEffect.bgmMode,
    completeSoundId: signEffect.completeSoundId,
    completeSoundVolume: signEffect.completeSoundVolume,
    autoAdvance: signEffect.autoAdvance,
  };
}

export { THEMES };
