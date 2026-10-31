// Збирає дані для сайту (запускається GitHub Actions за розкладом):
//   data/schedules.json — розклади всіх груп, розібрані з PDF на сайті коледжу
//   data/orders.json    — архів розпоряджень про заміни (сирий CSV з Google Drive коледжу)
// Запуск вручну: node tools/build-data.mjs [--only-orders]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseSchedulePdf } from './parse-pdf.mjs';

const COLLEGE = 'https://ccte.nau.edu.ua/';
const SCHEDULE_PAGE = COLLEGE + 'Розклад занять.html';
const DRIVE_ID = '1WfqBmM996nKjzw6655q1ulLFlqXXR61m';   // «Заміни.xlsx»
const ORDERS_KEEP = 80;
const UA = { 'User-Agent': 'RozkladX schedule bot (+https://rozkladx.github.io/)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'text') {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(encodeURI(decodeURI(url)), { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return as === 'buffer' ? new Uint8Array(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * attempt);
    }
  }
}

// список груп і PDF — з об'єкта scheduleData на сторінці «Розклад занять»
function extractGroups(html) {
  const block = html.slice(html.indexOf('scheduleData'));
  const groups = [];
  const courseRe = /"(\d)"\s*:\s*\[([\s\S]*?)\]/g;
  let cm;
  while ((cm = courseRe.exec(block))) {
    const itemRe = /\{\s*name:\s*"([^"]+)"\s*,\s*file:\s*"([^"]+)"\s*\}/g;
    let im;
    while ((im = itemRe.exec(cm[2]))) groups.push({ name: im[1].trim(), course: Number(cm[1]), file: im[2] });
    if (Number(cm[1]) >= 6) break;
  }
  return groups;
}

async function buildSchedules() {
  const html = await get(SCHEDULE_PAGE);
  const groups = extractGroups(html);
  if (groups.length < 10) throw new Error(`на сторінці знайдено лише ${groups.length} груп — макет сайту змінився?`);
  let prev = {};
  try { prev = Object.fromEntries((JSON.parse(await readFile('data/schedules.json', 'utf8')).groups || []).map((g) => [g.name, g])); } catch (e) { /* перший запуск */ }

  const parsedByFile = new Map();
  const out = [];
  for (const g of groups) {
    const pdf = COLLEGE + g.file;
    const entry = { name: g.name, course: g.course, pdf: encodeURI(pdf) };
    try {
      if (!parsedByFile.has(g.file)) {
        parsedByFile.set(g.file, parseSchedulePdf(await get(pdf, 'buffer')));
        await sleep(400);   // не навантажуємо сайт коледжу
      }
      const { title, schedule } = await parsedByFile.get(g.file);
      const lessons = Object.values(schedule).flatMap((w) => Object.values(w).flat()).filter(Boolean).length;
      if (!lessons) throw new Error('у розкладі не знайдено жодної пари');
      Object.assign(entry, { title, schedule });
      console.log(`✓ ${g.name}: ${lessons} клітинок`);
    } catch (e) {
      // лишаємо попередню вдалу версію, якщо вона була
      const old = prev[g.name];
      if (old && old.schedule) Object.assign(entry, { title: old.title, schedule: old.schedule, stale: true });
      entry.error = String(e.message || e);
      console.log(`✗ ${g.name}: ${entry.error}`);
    }
    out.push(entry);
  }
  const ok = out.filter((g) => g.schedule && !g.error).length;
  if (ok < groups.length / 2) throw new Error(`розібрано лише ${ok} із ${groups.length} — не перезаписуємо файл`);
  await writeFile('data/schedules.json', JSON.stringify({ generatedAt: new Date().toISOString(), source: SCHEDULE_PAGE, groups: out }, null, 1));
  console.log(`Готово: ${ok}/${groups.length} груп`);
}

// архів розпоряджень: файл на Drive щоразу перезаписують, тож зберігаємо кожну нову версію
async function buildOrders() {
  let store = { orders: [] };
  try { store = JSON.parse(await readFile('data/orders.json', 'utf8')); } catch (e) { /* перший запуск */ }
  const base = `https://docs.google.com/spreadsheets/d/${DRIVE_ID}/gviz/tq?tqx=out:csv&headers=0`;
  let added = 0;
  for (const sheet of ['', 'Лист2', 'Лист3']) {
    let csv;
    try { csv = await get(base + (sheet ? '&sheet=' + sheet : '')); } catch (e) { console.log('заміни: ' + e.message); continue; }
    if (!/РОЗПОРЯДЖЕННЯ|ЗАМІНА/i.test(csv)) continue;
    const key = (csv.match(/РОЗПОРЯДЖЕННЯ\s*№\s*(\d+)/i) || [])[1] + '|' + (csv.match(/на\s+(\d{1,2}\s+[а-яіїєґ']+\s+\d{4})/i) || [])[1];
    const i = store.orders.findIndex((o) => o.key === key);
    if (i >= 0) { if (store.orders[i].csv !== csv) { store.orders[i] = { key, csv, fetchedAt: new Date().toISOString() }; added++; } }
    else { store.orders.unshift({ key, csv, fetchedAt: new Date().toISOString() }); added++; }
  }
  store.orders = store.orders.slice(0, ORDERS_KEEP);
  store.updatedAt = new Date().toISOString();
  if (added) await writeFile('data/orders.json', JSON.stringify(store, null, 1));
  console.log(`Розпорядження: нових/змінених ${added}, усього ${store.orders.length}`);
}

await mkdir('data', { recursive: true });
await buildOrders();
if (!process.argv.includes('--only-orders')) await buildSchedules();
