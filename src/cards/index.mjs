// 圖卡繪製：把 post.slides（資料）畫成 1080×1350 PNG（IG 建議的 4:5 直式）。
//
// 版型（slide.type）：
//   cover  { kicker, title（\n 換行）, subtitle, note }
//   list   { header, page, pages, footnote, columns: [{ label, width, align? }], rows: Cell[][] }
//   cta    { lines: string[] }                         下方顯示網址與 brand.disclaimer
// Cell：字串，或 { text, sub?, size?=40, weight?=700, tone?='ink'|'muted'|'brand', subSize?=24 }
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { FONTS_DIR } from '../env.mjs';
import { slideFile } from '../post/index.mjs';

export const W = 1080;
export const H = 1350;

export const DEFAULT_COLORS = {
  bg: '#0d3b35', // 封面／結尾底色
  bgSoft: '#14524a', // 清單裡強調的數字
  paper: '#f6f4ee', // 清單頁底色、封面文字
  ink: '#1c2430',
  muted: '#6b7280',
  accent: '#f2b84b', // 封面小標、網址按鈕
  line: '#e3ded2',
  coverSub: '#cfe3df',
  coverNote: '#9cc3bc',
};

let fontsPromise;
export function loadFonts() {
  fontsPromise ??= Promise.all(
    [['Regular', 400], ['Bold', 700], ['Black', 900]].map(async ([name, weight]) => ({
      name: 'Noto Sans TC', weight, style: 'normal',
      data: await readFile(path.join(FONTS_DIR, `NotoSansTC-${name}.otf`)),
    })),
  );
  return fontsPromise;
}

/** satori 元素：多個子元素的 div 必須明確 display:flex，所以預設就給 */
export const h = (style, ...children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) },
});

/** 任意 satori 樹 → PNG Buffer */
export async function renderPng(tree, width = W, height = H) {
  const svg = await satori(tree, { width, height, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const host = (site) => new URL(site).host;

function cover(s, brand, C) {
  return h(
    { width: W, height: H, background: C.bg, color: C.paper, flexDirection: 'column', padding: 90, fontFamily: 'Noto Sans TC' },
    h({ fontSize: 36, color: C.accent, fontWeight: 700, letterSpacing: 2 }, s.kicker),
    h({ flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' },
      h({ fontSize: 112, fontWeight: 900, lineHeight: 1.15, flexDirection: 'column' }, ...s.title.split('\n').map((t) => h({}, t))),
      s.subtitle && h({ fontSize: 44, marginTop: 40, color: C.coverSub, lineHeight: 1.5 }, s.subtitle),
    ),
    h({ justifyContent: 'space-between', alignItems: 'flex-end', fontSize: 30, color: C.coverNote },
      h({}, s.note ?? ''),
      h({ fontWeight: 700, color: C.paper }, brand.name),
    ),
  );
}

function cell(c, C) {
  if (typeof c === 'string' || typeof c === 'number') c = { text: String(c) };
  const color = { ink: C.ink, muted: C.muted, brand: C.bgSoft }[c.tone ?? 'ink'];
  const main = h({ fontSize: c.size ?? 40, fontWeight: c.weight ?? 700, color }, c.text);
  return c.sub == null ? main : h({ flexDirection: 'column' }, main, h({ fontSize: c.subSize ?? 24, color: C.muted }, c.sub));
}

function list(s, brand, C) {
  const align = (col) => (col.align === 'right' ? 'flex-end' : 'flex-start');
  return h(
    { width: W, height: H, background: C.paper, color: C.ink, flexDirection: 'column', padding: '80px 72px', fontFamily: 'Noto Sans TC' },
    h({ justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 },
      h({ fontSize: 52, fontWeight: 900 }, s.header),
      s.pages > 1 && h({ fontSize: 30, color: C.muted }, `${s.page} / ${s.pages}`),
    ),
    h({ fontSize: 26, color: C.muted, paddingBottom: 14, borderBottom: `3px solid ${C.ink}` },
      ...s.columns.map((col) => h({ width: col.width, justifyContent: align(col) }, col.label)),
    ),
    ...s.rows.map((r) =>
      h({ alignItems: 'center', minHeight: 116, borderBottom: `2px solid ${C.line}` },
        ...r.map((c, i) => h({ width: s.columns[i].width, justifyContent: align(s.columns[i]) }, cell(c, C))),
      ),
    ),
    h({ marginTop: 'auto', justifyContent: 'space-between', fontSize: 24, color: C.muted },
      h({}, s.footnote ?? ''),
      h({ fontWeight: 700, color: C.bg }, brand.name),
    ),
  );
}

function cta(s, brand, C) {
  return h(
    { width: W, height: H, background: C.bg, color: C.paper, flexDirection: 'column', padding: 90, fontFamily: 'Noto Sans TC' },
    h({ marginTop: 'auto', fontSize: 72, fontWeight: 900, lineHeight: 1.3, flexDirection: 'column' }, ...s.lines.map((t) => h({}, t))),
    h({ marginTop: 56, fontSize: 44, fontWeight: 700, color: C.bg, background: C.accent, padding: '20px 36px', borderRadius: 16, alignSelf: 'flex-start' }, host(brand.site)),
    h({ marginTop: 'auto', fontSize: 26, color: C.coverNote, lineHeight: 1.6 }, brand.disclaimer ?? ''),
  );
}

export const LAYOUTS = { cover, list, cta };

export const colorsOf = (brand) => ({ ...DEFAULT_COLORS, ...brand?.colors });

/** 把 post.slides 全部畫成 dir/01.png、02.png…，回傳檔名清單 */
export async function renderSlides(post, dir) {
  await mkdir(dir, { recursive: true });
  const C = colorsOf(post.brand);
  const files = [];
  for (const [i, s] of post.slides.entries()) {
    const layout = LAYOUTS[s.type];
    if (!layout) throw new Error(`未知的圖卡版型：${s.type}`);
    const file = slideFile(i);
    await writeFile(path.join(dir, file), await renderPng(layout(s, post.brand, C)));
    files.push(file);
  }
  return files;
}
