// Colours of the 14 meridians and the 7 anatomical layers.
//
// Meridian colours: 14 enamel tones with OKLab lightness 0.42-0.69, so that every one stands out against the light
// body in both page themes. They were assigned to meridians by minimising, over all pairs of meridians, the
// spatial closeness of their lines on the body divided by the smallest colour difference (OKLab) of the pair under
// normal vision and simulated protanopia, deuteranopia and tritanopia (Machado et al. 2009). Meridians that run side
// by side (HT-SI, LU-PC, SP-LR, SI-TE ...) therefore get the most different colours.

export interface MeridianInfo { code: string; en: string; zh: string; color: string }

export const MERIDIANS: MeridianInfo[] = [
  { code: 'LU', en: 'Lung', zh: '手太阴肺经', color: '#d9648a' },
  { code: 'LI', en: 'Large Intestine', zh: '手阳明大肠经', color: '#a63c8c' },
  { code: 'ST', en: 'Stomach', zh: '足阳明胃经', color: '#8b5a2e' },
  { code: 'SP', en: 'Spleen', zh: '足太阴脾经', color: '#b5880f' },
  { code: 'HT', en: 'Heart', zh: '手少阴心经', color: '#d2453b' },
  { code: 'SI', en: 'Small Intestine', zh: '手太阳小肠经', color: '#3d8fd6' },
  { code: 'BL', en: 'Bladder', zh: '足太阳膀胱经', color: '#1f5e55' },
  { code: 'KI', en: 'Kidney', zh: '足少阴肾经', color: '#2c4fa8' },
  { code: 'PC', en: 'Pericardium', zh: '手厥阴心包经', color: '#3f4e5e' },
  { code: 'TE', en: 'Triple Energizer', zh: '手少阳三焦经', color: '#e57a2e' },
  { code: 'GB', en: 'Gallbladder', zh: '足少阳胆经', color: '#6e4bb3' },
  { code: 'LR', en: 'Liver', zh: '足厥阴肝经', color: '#1e9aa0' },
  { code: 'GV', en: 'Governor Vessel', zh: '督脉', color: '#3e9a5e' },
  { code: 'CV', en: 'Conception Vessel', zh: '任脉', color: '#7a8b2a' },
];
export const MERIDIAN = new Map(MERIDIANS.map((m) => [m.code, m]));
export const meridianName = (code: string, lang: 'en' | 'zh') => {
  const m = MERIDIAN.get(code);
  if (!m) return code;
  if (lang === 'zh') return m.zh;
  return m.code === 'GV' || m.code === 'CV' ? m.en : `${m.en} Meridian`;
};

export type LayerId = 'skin' | 'muscle' | 'bone' | 'ligament' | 'organ' | 'vessel' | 'nerve';
export interface LayerStyle { id: LayerId; color: string; roughness: number }

// Outside in. Quiet, atlas-like tones.
export const LAYERS: LayerStyle[] = [
  { id: 'skin', color: '#e6d8c6', roughness: 0.82 },
  { id: 'muscle', color: '#ad5a4c', roughness: 0.62 },
  { id: 'bone', color: '#e9e0cb', roughness: 0.72 },
  { id: 'ligament', color: '#9db1ba', roughness: 0.6 },
  { id: 'organ', color: '#c48a72', roughness: 0.55 },
  { id: 'vessel', color: '#a3343c', roughness: 0.5 },
  { id: 'nerve', color: '#d6b04a', roughness: 0.55 },
];
export const LAYER = new Map(LAYERS.map((l) => [l.id, l]));
export const GARMENT_COLOR = '#a9a39b';
