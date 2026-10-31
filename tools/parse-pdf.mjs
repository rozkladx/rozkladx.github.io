// Розбір PDF-розкладу групи з сайту коледжу.
// Макет: стовпці «День / Пара / Час / І тиждень / ІІ тиждень». Пара, однакова для обох тижнів,
// записана однією широкою клітинкою посередині, тож тиждень визначаємо за центром рядка тексту.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const BELL_STARTS = ['08.00', '09.50', '11.40', '13.30', '15.20', '17.10', '19.00'];
const TIME_RE = /^(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})$/;
// терпимо до друкарських помилок у PDF: «ДудникВ.М.», «Малахов Є М.», «Остапенко Н,Б.», «Єрмоленко М.»
const NAME = "[А-ЯІЇЄҐ][а-яіїєґ'’ʼ`-]+\\s*[А-ЯІЇЄҐ](?:[.,]\\s?[А-ЯІЇЄҐ][.,]?|\\s+[А-ЯІЇЄҐ]\\.|\\.)";
// «ДудникВ.М.» → «Дудник В.М.», «Н,Б.» → «Н.Б.»
const tidyTeacher = (t) => t.split(/\s*,\s*(?=[А-ЯІЇЄҐ][а-яіїєґ])/u).map((one) => one
  .replace(/^([А-ЯІЇЄҐ][а-яіїєґ'’ʼ`-]+)\s*/u, '$1 ')
  .replace(/([А-ЯІЇЄҐ])[,\s]+(?=[А-ЯІЇЄҐ])/gu, '$1.')
  .replace(/([А-ЯІЇЄҐ])$/u, '$1.')
  .replace(/\s+/g, ' ').trim()).join(', ');
// викладач(і) наприкінці клітинки: «Масло В.М.» або «Мизрова А.М., Миронець Д.К.»
const TEACHER_RE = new RegExp(`(${NAME}(?:\\s*,\\s*${NAME})*)\\s*$`, 'u');

export async function parseSchedulePdf(data) {
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      // сторінки «складаємо» одна під одною
      items.push({ x: it.transform[4], y: (p - 1) * 2000 + (vp.height - it.transform[5]), w: it.width, s: it.str });
    }
  }
  await doc.destroy();

  // назва групи може бути розбита на кілька шматків в одному рядку: «групи А-7» + «76-41»
  const titleItem = items.find((i) => /^груп[аи](\s|$)/i.test(i.s.trim()));
  let title = '';
  if (titleItem) {
    const parts = items.filter((i) => Math.abs(i.y - titleItem.y) <= 2).sort((a, b) => a.x - b.x);
    let x2 = null;
    for (const p of parts) {
      title += (x2 !== null && p.x - x2 > 1.5 ? ' ' : '') + p.s;
      x2 = p.x + p.w;
    }
    title = title.replace(/\s+/g, ' ').trim();
  }
  const hI = items.find((i) => /^І\s*тиждень$/.test(i.s.trim()));
  const hII = items.find((i) => /^ІІ\s*тиждень$/.test(i.s.trim()));
  const cI = hI ? hI.x + hI.w / 2 : 276;
  const cII = hII ? hII.x + hII.w / 2 : 473;
  const mid = (cI + cII) / 2;
  const span = cII - cI;
  const headerY = hI ? hI.y : 0;

  // рядки пар — за записами часу «08.00-09.35»; новий день починається, коли номер пари «скидається»
  const times = items.filter((i) => TIME_RE.test(i.s.trim())).sort((a, b) => a.y - b.y);
  if (!times.length) throw new Error('у PDF не знайдено часу пар');
  const timeX = Math.max(...times.map((t) => t.x + t.w));
  const rows = [];
  let day = -1, prevPair = 99;
  for (const t of times) {
    const m = t.s.trim().match(TIME_RE);
    let pair = BELL_STARTS.indexOf(m[1].padStart(2, '0') + '.' + m[2]) + 1;
    if (!pair) pair = prevPair + 1;
    if (pair <= prevPair) day++;
    prevPair = pair;
    rows.push({ y: t.y, day, pair });
  }

  // вміст праворуч від часу; склеюємо шматки тексту в рядки
  const content = items.filter((i) => i.x > timeX + 5 && i.y > headerY + 6).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of content) {
    const last = lines.find((l) => Math.abs(l.y - it.y) <= 3 && it.x - l.x2 < 14 && it.x - l.x2 > -3);
    if (last) {
      const gap = it.x - last.x2;
      last.s += (gap > 1.5 && !/[’'ʼ]$/.test(last.s) && !/^[’'ʼ]/.test(it.s) ? ' ' : '') + it.s;
      last.x2 = Math.max(last.x2, it.x + it.w);
    } else {
      lines.push({ y: it.y, x1: it.x, x2: it.x + it.w, s: it.s });
    }
  }

  // клітинка = рядок пари × тиждень (1, 2 або обидва)
  const cells = new Map();
  for (const l of lines) {
    if (!/[\p{L}\d]/u.test(l.s)) continue;   // окремі крапки/риски — не текст
    let best = null;
    for (const r of rows) if (!best || Math.abs(r.y - l.y) < Math.abs(best.y - l.y)) best = r;
    if (!best || Math.abs(best.y - l.y) > 30) continue;
    const cx = (l.x1 + l.x2) / 2;
    const wk = Math.abs(cx - mid) < span * 0.22 ? 'both' : cx < mid ? '1' : '2';
    const key = `${best.day}|${best.pair}|${wk}`;
    if (!cells.has(key)) cells.set(key, { day: best.day, pair: best.pair, wk, lines: [] });
    cells.get(key).lines.push(l);
  }

  const nDays = Math.min(6, Math.max(...rows.map((r) => r.day + 1)));
  const nPairs = Math.max(5, ...rows.map((r) => r.pair));
  const schedule = { 1: {}, 2: {} };
  for (const w of [1, 2]) for (let d = 0; d < nDays; d++) schedule[w][DAYS[d]] = Array(nPairs).fill(null);
  for (const c of cells.values()) {
    const dayKey = DAYS[c.day];
    if (!dayKey) continue;
    const text = c.lines.sort((a, b) => a.y - b.y || a.x1 - b.x1).map((l) => l.s.trim()).join(' ')
      .replace(/\s+/g, ' ').replace(/\.{2,}/g, '.').trim();
    const m = text.match(TEACHER_RE);
    const lesson = {
      n: (m ? text.slice(0, m.index) : text).trim().replace(/[,;]$/, ''),
      t: m ? tidyTeacher(m[1].trim()) : '',
    };
    if (!lesson.n) { lesson.n = lesson.t; lesson.t = ''; }
    for (const w of c.wk === 'both' ? [1, 2] : [Number(c.wk)]) schedule[w][dayKey][c.pair - 1] = lesson;
  }
  return { title, schedule };
}
