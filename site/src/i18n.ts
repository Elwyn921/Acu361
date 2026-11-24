// Interface strings of the explorer. The static page text lives in index.html in both languages
// (elements marked data-l="en" / data-l="zh"; CSS shows one set).
export type Lang = 'en' | 'zh';

const S = {
  en: {
    tagline: 'Expert-consensus locations of the 361 WHO standard acupoints',
    search: 'Search points',
    searchPlaceholder: 'LU7, Lieque, 列缺',
    noResults: 'No matching point',
    meridians: 'Meridians',
    showAll: 'Show all',
    layers: 'Anatomy',
    skinOpacity: 'Skin opacity',
    overlays: 'Overlays',
    points: 'Points',
    lines: 'Meridian lines',
    rulers: 'B-cun rulers',
    layer_skin: 'Skin', layer_muscle: 'Muscles', layer_bone: 'Bones', layer_ligament: 'Ligaments & cartilage',
    layer_organ: 'Organs', layer_vessel: 'Vessels', layer_nerve: 'Nerves',
    loading: 'Loading', loadingBody: 'Loading the body', failed: 'Could not load',
    front: 'Front', back: 'Back', left: 'Left', right: 'Right', reset: 'Reset view',
    leftTitle: "View the body's left side", rightTitle: "View the body's right side",
    hint: 'Drag to rotate · scroll or pinch to zoom · right-drag to pan',
    hintTouch: 'Drag to rotate · pinch to zoom · two fingers to pan',
    side_L: 'Left', side_R: 'Right', side_M: 'Midline',
    meridian: 'Meridian', side: 'Side', position: 'Position', nearestBone: 'Nearest bone', boneDistance: 'Distance to bone',
    copy: 'Copy', copied: 'Copied', copyLink: 'Copy link', close: 'Close', mirror: 'Other side',
    prev: 'Previous point', next: 'Next point',
    lifted: 'Drawn on the garment surface; the coordinate is on the skin beneath it.',
    boneNote: 'Straight-line distance in this model, not a needling depth.',
    controls: 'Layers & meridians', about: 'About', theme: 'Switch colour theme', github: 'GitHub repository',
    explorer: '3D explorer', webglFail: 'Your browser could not start WebGL, so the 3D explorer is shown as a still image.',
    pointsCount: (n: number) => `${n} points`,
    cun: 'cun',
    rulerFrom: 'B-cun',
    skip: 'Skip to the dataset description',
    layerBusy: (p: number) => `${p}%`,
  },
  zh: {
    tagline: '361 个 WHO 标准经穴的专家共识定位',
    search: '搜索穴位',
    searchPlaceholder: 'LU7、Lieque、列缺',
    noResults: '没有匹配的穴位',
    meridians: '经脉',
    showAll: '全部显示',
    layers: '解剖层',
    skinOpacity: '皮肤不透明度',
    overlays: '叠加',
    points: '穴位点',
    lines: '经线',
    rulers: '骨度分寸尺',
    layer_skin: '皮肤', layer_muscle: '肌肉', layer_bone: '骨骼', layer_ligament: '韧带与软骨',
    layer_organ: '内脏', layer_vessel: '血管', layer_nerve: '神经',
    loading: '加载中', loadingBody: '正在加载人体', failed: '加载失败',
    front: '前', back: '后', left: '左', right: '右', reset: '复位视角',
    leftTitle: '查看身体左侧', rightTitle: '查看身体右侧',
    hint: '拖动旋转 · 滚轮或双指缩放 · 右键拖动平移',
    hintTouch: '单指旋转 · 双指缩放 · 双指拖动平移',
    side_L: '左', side_R: '右', side_M: '中线',
    meridian: '经脉', side: '侧别', position: '坐标', nearestBone: '最近骨', boneDistance: '到骨距离',
    copy: '复制', copied: '已复制', copyLink: '复制链接', close: '关闭', mirror: '对侧',
    prev: '上一穴', next: '下一穴',
    lifted: '此点画在衣物表面；坐标位于其下方的皮肤上。',
    boneNote: '模型中的直线几何距离，不是进针深度。',
    controls: '图层与经脉', about: '项目说明', theme: '切换明暗主题', github: 'GitHub 仓库',
    explorer: '三维浏览器', webglFail: '浏览器未能启动 WebGL，三维浏览器以静态图代替。',
    pointsCount: (n: number) => `${n} 个点`,
    cun: '寸',
    rulerFrom: '骨度',
    skip: '跳到数据集说明',
    layerBusy: (p: number) => `${p}%`,
  },
};
export type Strings = typeof S.en;

let lang: Lang = 'en';
const listeners = new Set<(l: Lang) => void>();

export function initLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  let saved: string | null = null;
  try { saved = localStorage.getItem('acu361.lang'); } catch { /* storage unavailable */ }
  const pick = q === 'zh' || q === 'en' ? q : saved === 'zh' || saved === 'en' ? saved : 'en';
  setLang(pick as Lang, false);
  return lang;
}
export function setLang(l: Lang, persist = true) {
  lang = l;
  document.documentElement.lang = l === 'zh' ? 'zh-Hans' : 'en';
  document.documentElement.dataset.lang = l;
  if (persist) { try { localStorage.setItem('acu361.lang', l); } catch { /* storage unavailable */ } }
  for (const f of listeners) f(l);
}
export const getLang = () => lang;
export const t = (): Strings => S[lang] as Strings;
export const onLang = (f: (l: Lang) => void) => { listeners.add(f); };
