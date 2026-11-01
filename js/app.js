/* Розклад групи: розклад з двох тижнів, що чергуються, робочі суботи, заміни з розпоряджень,
 * повітряні тривоги, мікшер звуків і кілька стилів.
 * Час береться лише з годинника пристрою — параметри в адресі на нього не впливають.
 */
(() => {
  'use strict';

  const C = window.SCHEDULE_CONFIG;
  const TZ = C.timeZone || 'Europe/Kyiv';      // час коледжу: у ньому записані пари
  // старі системи називають Київ «Europe/Kiev»
  const DEVICE_TZ = (() => { try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || TZ).replace('Europe/Kiev', 'Europe/Kyiv'); } catch (e) { return TZ; } })();
  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WORK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const DAY_SHORT = { monday: 'ПН', tuesday: 'ВТ', wednesday: 'СР', thursday: 'ЧТ', friday: 'ПТ', saturday: 'СБ', sunday: 'НД' };
  const DAY_FULL = { monday: 'понеділок', tuesday: 'вівторок', wednesday: 'середа', thursday: 'четвер', friday: "п'ятниця", saturday: 'субота', sunday: 'неділя' };
  const DAY_ACC = { monday: 'в понеділок', tuesday: 'у вівторок', wednesday: 'у середу', thursday: 'у четвер', friday: "у п'ятницю", saturday: 'у суботу', sunday: 'у неділю' };
  const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const ROMAN = { 1: 'I', 2: 'II' };
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* не критично */ } };

  /* ---------- Налаштування користувача ---------- */
  const savedSettings = load('rz_settings', {});
  const settings = Object.assign({
    theme: 'neon',
    region: C.alerts.region,
    alertProxy: '',
    alertRepeat: false,
    notify: false,
    soonMin: 5,
    group: C.defaultGroup,
    tz: 'auto',               // 'auto' — часовий пояс пристрою, або назва поясу
    satOverride: {},          // 'YYYY-MM-DD' -> {day, week} | 'off'
  }, savedSettings);
  delete settings.groupCode;
  const saveSettings = () => save('rz_settings', settings);

  /* ---------- Час (київський «настінний» час як UTC-мс) ---------- */
  function nowWallMs() {
    const d = new Date();
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(d).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    } catch (e) {
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    }
  }


  const dateKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const secOfDay = (ms) => Math.floor((((ms % DAY_MS) + DAY_MS) % DAY_MS) / 1000);
  const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (key, n) => dateKeyOf(parseKey(key) + n * DAY_MS);
  const weekdayOf = (key) => DAY_KEYS[new Date(parseKey(key)).getUTCDay()];
  const mondayOf = (key) => addDays(key, -((new Date(parseKey(key)).getUTCDay() + 6) % 7));
  const hmToSec = (s) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
  const shortDate = (key) => key.slice(8) + '.' + key.slice(5, 7);
  const longDate = (key) => Number(key.slice(8)) + ' ' + MONTHS_GEN[Number(key.slice(5, 7)) - 1];
  const hm = (ms) => new Date(ms).toISOString().slice(11, 16);

  /* ---------- Часовий пояс пристрою ---------- */
  // Розклад рахується в часі коледжу, а показується в поясі пристрою (або вибраному в налаштуваннях).
  const viewTZ = () => (settings.tz === 'auto' ? DEVICE_TZ : settings.tz);
  const fmtCache = new Map();
  function fmt(tz, opts) {
    const k = tz + JSON.stringify(opts);
    if (!fmtCache.has(k)) {
      try { fmtCache.set(k, new Intl.DateTimeFormat('uk-UA', { timeZone: tz, ...opts })); }
      catch (e) { fmtCache.set(k, new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, ...opts })); }
    }
    return fmtCache.get(k);
  }
  // зсув поясу (мс) у момент utc
  function tzOffsetMs(tz, utc) {
    const p = Object.fromEntries(fmt(tz, { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utc / 1000) * 1000;
  }
  // «настінний» час коледжу → справжній момент UTC (двічі — на випадок переходу на літній час)
  function wallToUtc(wall) {
    const u = wall - tzOffsetMs(TZ, wall);
    return wall - tzOffsetMs(TZ, u);
  }
  const nowUtc = () => Date.now();
  const HM = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const fmtHM = (utc) => fmt(viewTZ(), HM).format(new Date(utc));
  // час пари дати key (у часі коледжу) → як він виглядає на пристрої
  const localHM = (key, hmStr) => fmtHM(wallToUtc(parseKey(key) + hmToSec(hmStr) * 1000));
  const tzDiffers = () => tzOffsetMs(viewTZ(), nowUtc()) !== tzOffsetMs(TZ, nowUtc());
  const CITY_UK = { Kyiv: 'Київ', Warsaw: 'Варшава', Berlin: 'Берлін', Prague: 'Прага', London: 'Лондон', Lisbon: 'Лісабон', 'New York': 'Нью-Йорк', Toronto: 'Торонто' };
  const tzLabel = (tz) => { const c = tz.split('/').pop().replace(/_/g, ' '); return CITY_UK[c] || c; };

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h} год ${String(m).padStart(2, '0')} хв`;
    return `${m} хв ${String(s).padStart(2, '0')} с`;
  }

  /* ---------- Групи ---------- */
  // Розклади всіх груп збирає GitHub Actions з PDF на сайті коледжу → data/schedules.json
  let ALL_GROUPS = [];        // [{name, course, title, pdf, schedule, error}]
  let schedulesMeta = { generatedAt: null, error: null };
  const courseOf = (name) => { const m = String(name).match(/(\d)\d\b/); return m ? Number(m[1]) : 4; };
  // «група П-782-42» → «П-782-42»
  const titleOf = (g) => (g.title || '').replace(/^груп[аи]\s+/i, '').trim() || g.name;

  async function loadSchedules() {
    const ver = (document.querySelector('meta[name="app-version"]') || {}).content || '';
    try {
      const r = await fetch('data/schedules.json?v=' + encodeURIComponent(ver) + '&t=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      save('rz_schedules', j);
      applySchedules(j);
    } catch (e) {
      schedulesMeta.error = String(e.message || e);
      applySchedules(load('rz_schedules', { groups: [] }));   // офлайн — остання збережена копія
    }
  }
  function applySchedules(j) {
    ALL_GROUPS = (j.groups || []).map((g) => ({ ...g, title: titleOf(g) }));
    schedulesMeta.generatedAt = j.generatedAt || null;
  }

  let G = null;   // поточна група
  function setGroup(name) {
    const g = ALL_GROUPS.find((x) => x.name === name) || { name, course: courseOf(name), title: name };
    G = {
      name: g.name,
      course: g.course,
      title: g.title || name,
      sch: g.schedule ? { schedule: g.schedule } : null,
      stale: !!g.error,
      // як група пишеться в розпорядженнях: «П42»; спільний розклад «А-31, А-30» → обидві
      codes: name.split(/[,;]/).map((s) => normGroup(s)).filter(Boolean),
      pdf: g.pdf || C.links.schedule,
    };
    settings.group = name;
    saveSettings();
  }

  // приватні посилання на пари поточної групи (з Supabase: за секретним посиланням групи або для старости)
  let privateLinks = {};
  // правки розкладу від старости (публічні)
  let overrides = [];

  // посилання на пару; ключ «Прізвище» або «Прізвище|початок назви предмета»
  function linkFor(subject, teacher) {
    const map = privateLinks;
    const sn = surname(teacher);
    if (!sn) return '';
    let best = '';
    for (const [key, url] of Object.entries(map)) {
      const [ks, kSubj] = key.split('|');
      if (norm(ks) !== sn) continue;
      if (kSubj) { if (norm(subject).startsWith(norm(kSubj))) return url; }
      else if (!best) best = url;
    }
    return best;
  }
  // усі предмети групи (для підбору повних назв у замінах)
  const groupSubjects = () => {
    if (!G.sch) return [];
    const seen = new Map();
    for (const w of Object.values(G.sch.schedule)) for (const day of Object.values(w)) for (const l of day) {
      if (l && !seen.has(l.n + '|' + l.t)) seen.set(l.n + '|' + l.t, { n: l.n, t: l.t, l: linkFor(l.n, l.t) });
    }
    return [...seen.values()];
  };

  /* ---------- Тижні та робочі суботи ---------- */
  function weekNumberFor(key) {
    const diff = Math.round((parseKey(mondayOf(key)) - parseKey(mondayOf(C.week1Monday))) / (7 * DAY_MS));
    return ((diff % 2) + 2) % 2 === 0 ? 1 : 2;
  }

  // коло субот: ПН I, ВТ I … ПТ I, ПН II … ПТ II
  const cycleIndex = (o) => (o.week - 1) * 5 + WORK_DAYS.indexOf(o.day);
  const fromCycle = (i) => { i = ((i % 10) + 10) % 10; return { day: WORK_DAYS[i % 5], week: i < 5 ? 1 : 2 }; };

  const satAnchor = () => C.saturdayAnchors[G.course] || C.saturdayAnchors[4];

  // джерело правди для суботи: ручне налаштування → data.js → розпорядження → коло від відомої суботи
  function saturdayPlan(key) {
    const man = settings.satOverride[key];
    if (man === 'off') return { off: true, source: 'manual' };
    if (man) return { ...man, source: 'manual' };
    if (Object.prototype.hasOwnProperty.call(C.specialDays, key)) {
      const v = C.specialDays[key];
      return v ? { ...v, source: 'config' } : { off: true, source: 'config' };
    }
    const ord = ordersByDate().get(key);
    const rule = ord && ord.satNote ? parseSatRule(ord.satNote, G.course) : null;
    if (rule) return { ...rule, source: 'order', order: ord };
    const a = satAnchor();
    const n = Math.round((parseKey(key) - parseKey(a.date)) / (7 * DAY_MS));
    return { ...fromCycle(cycleIndex(a) + n), source: 'auto' };
  }

  // за яким днем/тижнем іде дата
  function dayPlan(key) {
    const wd = weekdayOf(key);
    if (wd === 'sunday') return null;
    if (wd === 'saturday') {
      const p = saturdayPlan(key);
      return p.off ? null : { day: p.day, week: p.week, saturday: p };
    }
    return { day: wd, week: weekNumberFor(key) };
  }

  /* ---------- Предмети: підбір повної назви з розкладу ---------- */
  const norm = (s) => String(s || '').toLowerCase().replace(/[’`ʼ]/g, "'").replace(/\s+/g, ' ').trim();
  const words = (s) => norm(s).split(/[^a-zа-яіїєґ0-9']+/u).filter(Boolean);
  const surname = (t) => words(t)[0] || '';

  function subjectByTeacher(teacher) {
    const sn = surname(teacher);
    if (!sn) return [];
    return groupSubjects().filter((s) => surname(s.t) === sn);
  }

  // «основи нац.спротиву» → «Основи національного спротиву»: кожне слово — початок слова повної назви
  function subjectScore(raw, full) {
    const a = words(raw);
    const b = words(full);
    if (!a.length) return 0;
    if (a.join(' ') === b.join(' ')) return 3;
    let j = 0;
    for (const w of a) {
      while (j < b.length && !b[j].startsWith(w)) j++;
      if (j >= b.length) return 0;
      j++;
    }
    return 1;
  }

  function resolveSubject(rawSubject, teacher) {
    const own = subjectByTeacher(teacher);
    const pick = (list) => {
      const scored = list.map((s) => ({ s, sc: subjectScore(rawSubject, s.n) })).filter((x) => x.sc > 0);
      scored.sort((x, y) => y.sc - x.sc);
      return scored.length && (scored.length === 1 || scored[0].sc > scored[1].sc) ? scored[0].s : null;
    };
    const hit = (rawSubject ? pick(own) : null) || (!rawSubject && own.length === 1 ? own[0] : null) ||
      (rawSubject && words(rawSubject).length > 1 ? pick(groupSubjects()) : null);
    if (hit) return { name: hit.n, link: surname(hit.t) === surname(teacher) ? hit.l : '' };
    const t = String(rawSubject || '').trim();
    const name = t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Заняття';
    return { name, link: linkFor(name, teacher) };
  }

  /* ---------- Пари на дату ---------- */
  function getLessons(key) {
    const plan = dayPlan(key);
    const out = new Map();
    if (plan && G.sch) {
      const day = (G.sch.schedule[plan.week] || {})[plan.day] || [];
      day.forEach((s, i) => {
        if (s) out.set(i + 1, { no: i + 1, subject: s.n, teacher: s.t, link: linkFor(s.n, s.t) });
      });
    }
    // правки старости поверх розкладу з PDF
    if (plan) {
      for (const o of overrides) {
        if (o.week !== plan.week || o.day !== plan.day) continue;
        if (o.removed) out.delete(o.pair);
        else out.set(o.pair, { no: o.pair, subject: o.subject, teacher: o.teacher, link: linkFor(o.subject, o.teacher), edited: true });
      }
    }

    for (const r of mySubRows(key)) {
      for (const no of r.pairs) {
        const base = out.get(no);
        const orig = base ? { subject: base.subject, teacher: base.teacher } :
          (r.fromTeacher || r.fromSubject ? { subject: r.fromSubject, teacher: r.fromTeacher } : null);
        if (r.cancelled) {
          out.set(no, { no, subject: base ? base.subject : (r.fromSubject || 'Пару'), teacher: base ? base.teacher : r.fromTeacher,
            link: '', change: 'cancel', note: r.toTeacher || r.toSubject, order: r.order });
        } else {
          const res = resolveSubject(r.toSubject, r.toTeacher);
          out.set(no, { no, subject: res.name, teacher: r.toTeacher, link: res.link,
            change: base ? 'replace' : 'add', orig, order: r.order });
        }
      }
    }

    return [...out.values()].sort((a, b) => a.no - b.no).map((l) => {
      const bell = C.bells[l.no - 1];
      // startStr/endStr — у поясі пристрою; start/end — секунди дня в часі коледжу (для таймерів)
      return { ...l, startStr: bell ? localHM(key, bell.start) : '', endStr: bell ? localHM(key, bell.end) : '',
        collegeStart: bell ? bell.start : '', collegeEnd: bell ? bell.end : '',
        start: bell ? hmToSec(bell.start) : null, end: bell ? hmToSec(bell.end) : null };
    });
  }
  const activeLessons = (key) => getLessons(key).filter((l) => l.change !== 'cancel' && l.start != null);

  /* ---------- Розпорядження (Заміни.xlsx з Google Drive) ---------- */
  // Google віддає таблицю з Drive як CSV через gviz — з дозволом CORS, тож проксі не потрібен.
  let orders = load('rz_orders', []);       // [{id, number, dateKey, title, satNote, satRule, rows, fetchedAt}]
  let ordersMeta = { at: load('rz_orders_at', 0), error: null, loading: false };

  function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()));
  }

  // латиниця, схожа на кирилицю, → кирилиця (у файлах трапляється «A41» замість «А41»)
  const LAT2CYR = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' };
  const normGroup = (s) => String(s || '').toUpperCase().replace(/[\s\-–_.]/g, '').replace(/[ABCEHIKMOPTXY]/g, (c) => LAT2CYR[c]);

  // «І», «ІІ», «ІУ» (кирилицею), «IV», «1», «1-2», «I,II»
  function parsePairs(s) {
    const t = String(s || '').toUpperCase().replace(/І/g, 'I').replace(/[УU]/g, 'V').replace(/Х/g, 'X').replace(/[\s.]/g, '');
    const rom = (x) => {
      if (/^\d+$/.test(x)) return Number(x);
      const map = { I: 1, V: 5, X: 10 };
      let n = 0;
      for (let i = 0; i < x.length; i++) {
        const v = map[x[i]], nx = map[x[i + 1]] || 0;
        if (!v) return null;
        n += v < nx ? -v : v;
      }
      return n || null;
    };
    const out = [];
    for (const part of t.split(/[,;+]/)) {
      const rng = part.split(/[-–]/).map(rom);
      if (rng.length === 2 && rng[0] && rng[1]) for (let i = rng[0]; i <= rng[1]; i++) out.push(i);
      else if (rng[0]) out.push(rng[0]);
    }
    return out.filter((n) => n >= 1 && n <= 8);
  }

  const DAY_STEMS = [['понеділ', 'monday'], ['вівтор', 'tuesday'], ['серед', 'wednesday'], ['четвер', 'thursday'], ["п'ятниц", 'friday'], ['пятниц', 'friday']];

  // «субота ( 1курс середа І тиждень; 2,3,4 курсии середа ІІ тиждень)» → {day, week} для свого курсу
  function parseSatRule(text, course) {
    const inner = (text.match(/\((.*)\)/) || [null, text])[1];
    const parts = inner.split(/;/);
    let fallback = null;
    for (const p of parts) {
      const low = norm(p);
      const ds = DAY_STEMS.find(([stem]) => low.includes(stem));
      const wk = low.match(/(іі|ii|2|і|i|1)\s*тиж/);
      if (!ds || !wk) continue;
      const rule = { day: ds[1], week: /іі|ii|2/.test(wk[1]) ? 2 : 1 };
      const cm = low.match(/^([\d,\s\-–та і]+)\s*курс/);
      if (!cm) { fallback = fallback || rule; continue; }
      const courses = [];
      cm[1].replace(/(\d)\s*[-–]\s*(\d)/g, (_, a, b) => { for (let i = +a; i <= +b; i++) courses.push(i); return ''; })
        .replace(/\d/g, (d) => { courses.push(+d); return ''; });
      if (courses.includes(course)) return rule;
    }
    return fallback;
  }

  function parseOrder(rows) {
    const flat = rows.map((r) => r.filter(Boolean).join(' '));
    const all = flat.join('\n');
    const numM = all.match(/РОЗПОРЯДЖЕННЯ\s*№\s*(\d+)/i);
    let dateKey = null;
    const dm = all.match(/на\s+(\d{1,2})\s+([а-яіїєґ']+)\s+(\d{4})/i);
    if (dm) {
      const mi = MONTHS_GEN.indexOf(dm[2].toLowerCase());
      if (mi >= 0) dateKey = `${dm[3]}-${String(mi + 1).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
    }
    if (!dateKey) {
      const dn = all.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (dn) dateKey = `${dn[3]}-${dn[2].padStart(2, '0')}-${dn[1].padStart(2, '0')}`;
    }
    const titleLine = flat.find((l) => /заміна\s+занять/i.test(l)) || '';
    const satLine = flat.find((l) => /субот/i.test(l) && /тиж/i.test(l)) || '';
    const signer = flat.find((l) => /заступник|директор/i.test(l) && !/коледж/i.test(l)) || '';

    // шапка таблиці
    let hi = rows.findIndex((r) => r.some((c) => /^група$/i.test(c)));
    const out = [];
    if (hi >= 0) {
      const h = rows[hi];
      const gi = h.findIndex((c) => /^група$/i.test(c));
      const pi = h.findIndex((c) => /^пара$/i.test(c));
      const sub = rows[hi + 1] || [];
      const tIdx = sub.map((c, i) => (/виклад/i.test(c) ? i : -1)).filter((i) => i >= 0);
      const sIdx = sub.map((c, i) => (/предмет|дисципл/i.test(c) ? i : -1)).filter((i) => i >= 0);
      const col = {
        fromT: tIdx[0] ?? pi + 1, fromS: sIdx[0] ?? pi + 2,
        toT: tIdx[1] ?? pi + 3, toS: sIdx[1] ?? pi + 4,
      };
      let lastGroup = '';
      for (let i = hi + (tIdx.length ? 2 : 1); i < rows.length; i++) {
        const r = rows[i];
        if (/заступник|директор/i.test(r.join(' '))) break;
        const g = r[gi] || '';
        const p = r[pi] || '';
        if (!g && !p) continue;
        if (g) lastGroup = g;
        const row = {
          group: g || lastGroup, pairsText: p, pairs: parsePairs(p),
          fromTeacher: r[col.fromT] || '', fromSubject: r[col.fromS] || '',
          toTeacher: r[col.toT] || '', toSubject: r[col.toS] || '',
        };
        row.cancelled = /перенес|скасов|не\s*буде|відмін|вільн/i.test(row.toTeacher + ' ' + row.toSubject);
        out.push(row);
      }
    }

    return {
      id: (numM ? numM[1] : '?') + '|' + (dateKey || all.length),
      number: numM ? numM[1] : null,
      dateKey,
      title: titleLine,
      satNote: satLine,
      signer,
      rows: out,
    };
  }

  const ordersByDate = () => {
    const m = new Map();
    for (const o of orders) if (o.dateKey && !m.has(o.dateKey)) m.set(o.dateKey, o);
    return m;
  };

  function mySubRows(key) {
    const o = ordersByDate().get(key);
    if (!o) return [];
    return o.rows.filter(isMine).map((r) => ({ ...r, order: o }));
  }
  const isMine = (r) => r.group.split(/[,;/]/).some((g) => G.codes.includes(normGroup(g)));

  // спільний архів розпоряджень (його веде GitHub Actions у data/orders.json) — видно й старі, які вже зникли з Drive
  async function loadOrderArchive() {
    try {
      const r = await fetch('data/orders.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
      if (!r.ok) return;
      const j = await r.json();
      const map = new Map(orders.map((o) => [o.id, o]));
      for (const a of j.orders || []) {
        const o = parseOrder(parseCSV(a.csv));
        if ((o.rows.length || o.dateKey) && !map.has(o.id)) map.set(o.id, { ...o, fetchedAt: Date.parse(a.fetchedAt) || 0 });
      }
      orders = [...map.values()].sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || '') || (Number(b.number) || 0) - (Number(a.number) || 0)).slice(0, 80);
      save('rz_orders', orders);
    } catch (e) { /* архів необов'язковий */ }
  }

  const SHEETS = ['', 'Лист2', 'Лист3'];
  async function fetchOrders(manual) {
    if (ordersMeta.loading) return;
    ordersMeta.loading = true;
    ordersMeta.error = null;
    renderOrders();
    const base = `https://docs.google.com/spreadsheets/d/${C.substitutions.driveFileId}/gviz/tq?tqx=out:csv&headers=0`;
    try {
      const texts = await Promise.all(SHEETS.map(async (sh) => {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 12000);
        try {
          const r = await fetch(base + (sh ? '&sheet=' + encodeURIComponent(sh) : '') + '&t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return await r.text();
        } finally { clearTimeout(tm); }
      }).map((p) => p.catch((e) => { if (!manual) console.warn(e); return ''; })));
      if (!texts[0]) throw new Error('файл замін недоступний');

      const fresh = [];
      for (const t of texts) {
        if (!t.trim()) continue;
        const o = parseOrder(parseCSV(t));
        if (!o.rows.length && !o.dateKey) continue;
        if (!fresh.some((x) => x.id === o.id)) fresh.push({ ...o, fetchedAt: Date.now() });
      }
      // історія: нові зверху, старі розпорядження лишаються (файл на Drive щоразу перезаписують)
      const prevSig = changesSignature();
      const map = new Map(orders.map((o) => [o.id, o]));
      for (const o of fresh) map.set(o.id, o);
      orders = [...map.values()].sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || '') || (Number(b.number) || 0) - (Number(a.number) || 0)).slice(0, 40);
      save('rz_orders', orders);
      ordersMeta.at = Date.now();
      save('rz_orders_at', ordersMeta.at);
      const sig = changesSignature();
      const seen = load('rz_seen_sig', null);
      if (seen !== null && sig !== seen && sig !== prevSig) {
        playSound('sub');
        toast('📄 Нові зміни в розкладі для ' + G.title);
        notify('Нові заміни', 'Є зміни в розкладі для групи ' + G.title);
      }
      save('rz_seen_sig', sig);
    } catch (e) {
      ordersMeta.error = String(e.message || e);
      if (manual) toast('Не вдалося оновити заміни: ' + ordersMeta.error);
    } finally {
      ordersMeta.loading = false;
      renderAll();
    }
  }

  // підпис моїх змін на сьогодні й далі — щоб помітити нові
  function changesSignature() {
    const today = dateKeyOf(nowWallMs());
    return orders.filter((o) => o.dateKey && o.dateKey >= today)
      .map((o) => o.dateKey + ':' + mySubRows(o.dateKey).map((r) => r.pairsText + r.toTeacher + r.toSubject).join('|')).join(';');
  }

  /* ---------- Тривога ---------- */
  const alert = { active: null, since: null, at: 0, regions: [], source: '', error: null };
  let testAlertUntil = 0;
  let alertSilenced = false;

  function alertSources() {
    const list = [];
    if (settings.alertProxy) list.push({ url: settings.alertProxy, name: 'власне API' });
    list.push({ url: 'https://r.jina.ai/' + C.alerts.url, name: 'ubilling.net.ua (через r.jina.ai)', jina: true });
    list.push({ url: C.alerts.url, name: 'ubilling.net.ua' });
    return list;
  }

  async function pollAlert() {
    for (const src of alertSources()) {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 10000);
      try {
        const r = await fetch(src.url, { cache: 'no-store', signal: ctl.signal, headers: src.jina ? { Accept: 'application/json', 'X-No-Cache': 'true' } : {} });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let j = await r.json();
        if (j && j.data && typeof j.data.content === 'string') j = JSON.parse(j.data.content);
        if (!j || !j.states) throw new Error('немає даних');
        alert.regions = Object.keys(j.states);
        const st = j.states[settings.region];
        if (!st) throw new Error('регіон не знайдено');
        alert.active = !!st.alertnow;
        alert.since = st.changed && !/^1970/.test(st.changed) ? st.changed : null;
        alert.at = Date.now();
        alert.source = src.name;
        alert.error = null;
        return;
      } catch (e) {
        alert.error = String(e.message || e);
      } finally { clearTimeout(tm); }
    }
  }

  const alertNow = () => Date.now() < testAlertUntil ||
    (alert.active === true && Date.now() - alert.at < 5 * 60 * 1000);
  const alertKnown = () => Date.now() < testAlertUntil || (alert.active !== null && Date.now() - alert.at < 5 * 60 * 1000);

  /* ---------- Звук: мікшер ---------- */
  const CHANNELS = [
    { id: 'alert', label: 'Тривога', icon: '🚨' },
    { id: 'clear', label: 'Відбій', icon: '✅' },
    { id: 'start', label: 'Початок пари', icon: '🔔' },
    { id: 'end', label: 'Кінець пари', icon: '🏁' },
    { id: 'soon', label: 'Скоро пара', icon: '⏰' },
    { id: 'sub', label: 'Нова заміна', icon: '📄' },
    { id: 'ui', label: 'Інтерфейс', icon: '🖱️' },
  ];
  const mix = Object.assign({ master: { vol: 80, mute: false } },
    Object.fromEntries(CHANNELS.map((c) => [c.id, { vol: c.id === 'ui' ? 30 : 70, mute: false }])),
    load('rz_mixer', {}));
  const saveMix = () => save('rz_mixer', mix);

  let actx = null, masterGain = null, analyser = null, noiseBuf = null;
  const chGain = {};
  const curve = (v) => Math.pow(v / 100, 2);   // квадратична шкала: на слух рівніше
  // скільки кожного каналу йде в реверберацію: зовсім трохи — лише щоб звук не був «сухим»
  const REVERB_SEND = { alert: 0.05, clear: 0.12, start: 0.1, end: 0.1, soon: 0.08, sub: 0.08, ui: 0 };

  // імпульс реверберації: стерео-шум, що згасає; високі частоти згасають швидше — звук «теплий»
  function makeImpulse(c, seconds) {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.45 * t);
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  // Ланцюжок: канал → (сухий сигнал + реверб) → компресор → загальна гучність → вихід
  function ctx() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    masterGain = actx.createGain();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    const verb = actx.createConvolver();
    verb.buffer = makeImpulse(actx, 0.9);
    const wet = actx.createGain();
    wet.gain.value = 0.6;
    verb.connect(wet);
    wet.connect(comp);
    // фільтр «тембру»: прибирає різкі верхні частоти, щоб звук не різав вуха
    const tone = actx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3600;
    tone.Q.value = 0.5;
    // легка сатурація: додає звуку «зерна» й ваги — трохи грубіше, без хрипу
    const drive = actx.createWaveShaper();
    const dc = new Float32Array(2048);
    for (let i = 0; i < dc.length; i++) { const x = i / 1024 - 1; dc[i] = Math.tanh(1.8 * x) / Math.tanh(1.8); }
    drive.curve = dc;
    drive.oversample = '2x';
    // і зайвий низ, щоб звук був легким, а не гучним «бумом»
    const lowCut = actx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 180;
    lowCut.Q.value = 0.5;
    // компенсація гучності після компресора
    const makeup = actx.createGain();
    makeup.gain.value = 1.6;
    comp.connect(drive);
    drive.connect(tone);
    tone.connect(lowCut);
    lowCut.connect(makeup);
    makeup.connect(masterGain);
    masterGain.connect(analyser);
    analyser.connect(actx.destination);
    for (const c of CHANNELS) {
      const g = actx.createGain();
      const send = actx.createGain();
      send.gain.value = REVERB_SEND[c.id] || 0.3;
      g.connect(comp);
      g.connect(send);
      send.connect(verb);
      chGain[c.id] = g;
    }
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    applyMix();
    return actx;
  }

  function applyMix() {
    if (!actx) return;
    const t = actx.currentTime;
    masterGain.gain.setTargetAtTime(mix.master.mute ? 0 : curve(mix.master.vol), t, 0.02);
    for (const c of CHANNELS) chGain[c.id].gain.setTargetAtTime(mix[c.id].mute ? 0 : curve(mix[c.id].vol), t, 0.02);
  }

  const unlockAudio = () => { const c = ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };

  /* --- будівельні блоки звуку --- */
  // джерело (осцилятор/шум) з позначкою «відіграло» — по ній видно, що сирена закінчилась
  function track(src, out) {
    src.onended = () => { src.__done = true; };
    out.push(src);
    return src;
  }
  function osc(type, f, t0, t1, out, detune = 0) {
    const o = actx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    o.detune.value = detune;
    o.start(t0);
    o.stop(t1 + 0.05);
    return track(o, out);
  }
  // огинаюча: швидка атака → експоненційне згасання
  function envGain(dest, t0, peak, attack, dur) {
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(dest);
    return g;
  }

  // м'який «клік» — короткий відфільтрований шум
  function click(dest, at, vol, freq, out) {
    const t0 = actx.currentTime + at + 0.01;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 2.5;
    const g = envGain(dest, t0, vol, 0.001, 0.035);
    src.connect(bp);
    bp.connect(g);
    src.start(t0);
    src.stop(t0 + 0.06);
    track(src, out);
  }

  // ноти (Гц)
  const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880,
    B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98 };

  /* --- Тембри: у кожної теми свій «інструмент» ---
     Нота: voice(dest, f, t0, dur, vol, out, hold) — hold=true тримає рівну гучність (для тривоги),
     інакше нота згасає. Мелодії сигналів однакові для всіх тем, міняється лише звучання. */

  // нота через фільтр: набір осциляторів → lowpass (з можливим «відкриттям») → огинаюча
  function synthNote(dest, f, t0, dur, vol, out, hold, o) {
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = o.q || 0.7;
    lp.frequency.setValueAtTime(o.cutoff, t0);
    if (o.sweepTo) lp.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + Math.max(0.05, dur * 0.8));
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + (o.attack || 0.006));
    if (hold) {
      g.gain.setValueAtTime(vol, t0 + dur - 0.04);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    }
    lp.connect(g);
    g.connect(dest);
    for (const [type, ratio, amp, det] of o.layers) {
      const lg = actx.createGain();
      lg.gain.value = amp;
      osc(type, f * ratio, t0, t0 + dur, out, det || 0).connect(lg);
      lg.connect(lp);
    }
  }

  // «8-біт»: сходинки замість плавної хвилі
  let crushCurve = null;
  function crusher() {
    if (!crushCurve) {
      crushCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) crushCurve[i] = Math.round((i / 512 - 1) * 6) / 6;
    }
    const w = actx.createWaveShaper();
    w.curve = crushCurve;
    return w;
  }

  const VOICES = {
    // Неон: теплий синт — трикутник + розстроєний квадрат, фільтр трохи відкривається
    neon: (d, f, t0, dur, vol, out, hold) => synthNote(d, f, t0, dur, vol, out, hold, {
      cutoff: 1400, sweepTo: hold ? 0 : 2200, q: 1.2, attack: 0.008,
      layers: [['triangle', 1, 0.8], ['square', 1, 0.18, 7], ['sine', 0.5, 0.25]],
    }),
    // Кіберпанк: агресивна пилка з «8-біт» зерном і фільтром, що закривається
    cyber: (d, f, t0, dur, vol, out, hold) => {
      const cr = crusher();
      const g = actx.createGain();
      g.gain.value = 0.8;
      cr.connect(g);
      g.connect(d);
      synthNote(cr, f, t0, dur, vol, out, hold, {
        cutoff: 3200, sweepTo: hold ? 0 : 700, q: 4, attack: 0.003,
        layers: [['sawtooth', 1, 0.6, -9], ['sawtooth', 1, 0.6, 9], ['square', 0.5, 0.3]],
      });
    },
    // Термінал: «пищик» комп'ютера — чистий квадрат, рівна гучність, октавою вище
    terminal: (d, f, t0, dur, vol, out) => synthNote(d, f * 2, t0, Math.min(dur, 0.22), vol * 0.7, out, true, {
      cutoff: 3000, q: 0.5, attack: 0.002,
      layers: [['square', 1, 0.6]],
    }),
    // Синтвейв: дві розстроєні пилки + саб, повільна атака, резонансний фільтр — ретро-80-ті
    synth: (d, f, t0, dur, vol, out, hold) => synthNote(d, f, t0, dur * 1.3, vol, out, hold, {
      cutoff: 600, sweepTo: hold ? 0 : 2400, q: 5, attack: 0.03,
      layers: [['sawtooth', 1, 0.5, -12], ['sawtooth', 1, 0.5, 12], ['sine', 0.5, 0.45]],
    }),
    // Світлий: маримба — дерев'яний короткий удар
    light: (d, f, t0, dur, vol, out, hold) => {
      synthNote(d, f, t0, hold ? dur : dur * 0.7, vol * 0.75, out, hold, {
        cutoff: 2600, q: 0.5, attack: 0.002,
        layers: [['sine', 1, 0.9], ['triangle', 1, 0.25], ['sine', 4, 0.12]],
      });
      if (!hold) click(d, t0 - actx.currentTime - 0.01, vol * 0.6, 1800, out);
    },
    // OLED: мінімалізм — коротка приглушена нота
    mono: (d, f, t0, dur, vol, out, hold) => synthNote(d, f, t0, hold ? dur : dur * 0.6, vol * 1.4, out, hold, {
      cutoff: 1800, q: 0.5, attack: 0.004,
      layers: [['triangle', 1, 1]],
    }),
  };

  // мелодії сигналів: [нота, коли, тривалість, гучність]
  const B4 = 493.88;
  const PATTERNS = {
    alert: { hold: true, notes: [0, 0.6, 1.2].flatMap((k) => [[N.E5, k, 0.24, 0.18], [B4, k + 0.27, 0.24, 0.18]]) },
    clear: { notes: [[N.C5, 0, 0.5, 0.22], [N.E5, 0.12, 0.5, 0.22], [N.G5, 0.24, 0.9, 0.22]] },
    start: { notes: [[N.C5, 0, 0.5, 0.24], [N.G5, 0.14, 0.8, 0.22]] },
    end: { notes: [[N.G5, 0, 0.5, 0.22], [N.C5, 0.15, 0.8, 0.24]] },
    soon: { notes: [[N.A5, 0, 0.35, 0.18], [N.A5, 0.18, 0.5, 0.16]] },
    sub: { notes: [[N.D5, 0, 0.35, 0.2], [N.A5, 0.11, 0.55, 0.18]] },
    ui: { notes: [[1100, 0, 0.06, 0.06]] },
  };

  function playPattern(id, dest) {
    const out = [];
    const voice = VOICES[settings.theme] || VOICES.neon;
    const p = PATTERNS[id];
    const now = actx.currentTime + 0.02;
    for (const [f, at, dur, vol] of p.notes) voice(dest, f, now + at, dur, vol, out, !!p.hold);
    if (id === 'ui' && settings.theme !== 'terminal') click(dest, 0, 0.2, 1500, out);
    return out;
  }

  const voices = {};   // id -> [oscillators], щоб зупинити повтор сирени
  async function playSound(id) {
    const c = ctx();
    if (!c) return;
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) { return; } }
    if (c.state !== 'running') return;
    if (mix.master.mute || mix[id].mute || !mix[id].vol || !mix.master.vol) return;
    stopSound(id);
    voices[id] = playPattern(id, chGain[id]);
  }
  function stopSound(id) {
    for (const o of voices[id] || []) { try { o.stop(); } catch (e) { /* вже зупинено */ } }
    voices[id] = [];
  }

  /* ---------- Сповіщення ---------- */
  function notify(title, body) {
    if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, tag: title }); } catch (e) { /* мобільні браузери без SW */ }
  }

  function toast(text) {
    const t = el('div', 'toast', text);
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('is-out'), 4200);
    setTimeout(() => t.remove(), 4800);
  }

  /* ---------- Стилі ---------- */
  const THEMES = [
    { id: 'neon', name: 'Неон', desc: 'Скло, світіння, частинки', sw: ['#05070f', '#477cff', '#ff315a'] },
    { id: 'cyber', name: 'Кіберпанк', desc: 'Жовтий неон, гліч, рубані кути', sw: ['#0a0a12', '#fcee0a', '#00f0ff'] },
    { id: 'terminal', name: 'Термінал', desc: 'Зелений моноширинний CRT', sw: ['#030803', '#33ff66', '#1f9d45'] },
    { id: 'synth', name: 'Синтвейв', desc: 'Ретро-80-ті, сонце й сітка', sw: ['#1a0533', '#ff3cac', '#2bd2ff'] },
    { id: 'light', name: 'Світлий', desc: 'Чисто й спокійно вдень', sw: ['#f5f2ea', '#0f8f80', '#7c4dcc'] },
    { id: 'mono', name: 'OLED', desc: 'Чорний мінімалізм, економить батарею', sw: ['#000000', '#ffffff', '#8a8a8a'] },
  ];
  const THEME_COLOR = { neon: '#05070f', cyber: '#0a0a12', terminal: '#030803', synth: '#1a0533', light: '#f5f2ea', mono: '#000000' };

  function applyTheme(id) {
    if (!THEMES.some((t) => t.id === id)) id = 'neon';
    settings.theme = id;
    saveSettings();
    document.documentElement.setAttribute('data-theme', id);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLOR[id]);
    document.querySelectorAll('.theme').forEach((b) => b.classList.toggle('is-active', b.dataset.theme === id));
  }

  /* ---------- Стан перегляду ---------- */
  const state = { viewMonday: null, selectedKey: null, view: 'day', filter: 'mine', openOrders: new Set() };

  function homeKey() {
    const today = dateKeyOf(nowWallMs());
    if (weekdayOf(today) === 'sunday') return addDays(today, 1);
    if (!dayPlan(today)) return addDays(mondayOf(today), 7);
    return today;
  }
  function goHome() {
    state.selectedKey = homeKey();
    state.viewMonday = mondayOf(state.selectedKey);
  }

  /* ---------- Рендер: верх, тривога, головна картка ---------- */
  function renderClock() {
    const utc = nowUtc();
    const tz = viewTZ();
    const key = dateKeyOf(nowWallMs());
    $('clock').textContent = fmt(tz, { ...HM, second: '2-digit' }).format(new Date(utc));
    $('dateText').textContent = fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(utc));
    const plan = dayPlan(key);
    $('weekBadge').textContent = plan && plan.saturday
      ? `субота за ${DAY_SHORT[plan.day]} ${ROMAN[plan.week]}`
      : `${ROMAN[weekNumberFor(key)]} тиждень`;
    const differs = tzDiffers();
    $('tzNote').textContent = differs
      ? `🌍 ${tzLabel(tz)} · у коледжі (${tzLabel(TZ)}) ${fmt(TZ, HM).format(new Date(utc))}`
      : `🌍 ${tzLabel(tz)}`;
    $('tzNote').classList.toggle('is-diff', differs);
  }

  // ubilling пише час зміни статусу в київському часі
  function sinceText(s) {
    if (!s) return '';
    const m = s.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) return '';
    const start = wallToUtc(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    const mins = Math.max(0, Math.floor((nowUtc() - start) / 60000));
    const dur = mins >= 60 ? `${Math.floor(mins / 60)} год ${mins % 60} хв` : `${mins} хв`;
    return `з ${fmtHM(start)} (${dur})`;
  }

  function renderAlert() {
    const bar = $('alertBar');
    const on = alertNow();
    const known = alertKnown();
    bar.classList.toggle('is-alarm', on);
    bar.classList.toggle('is-calm', known && !on);
    bar.classList.toggle('is-unknown', !known);
    document.body.classList.toggle('alarm', on);
    const region = settings.region;
    if (on) {
      $('alertTitle').textContent = 'Повітряна тривога — ' + region;
      const test = Date.now() < testAlertUntil;
      $('alertMeta').textContent = test ? 'Тестовий режим' : ['Пройдіть в укриття', sinceText(alert.since)].filter(Boolean).join(' · ');
    } else if (known) {
      $('alertTitle').textContent = 'Тривоги немає — ' + region;
      $('alertMeta').textContent = 'Оновлено о ' + fmtHM(alert.at);
    } else {
      $('alertTitle').textContent = alert.error ? 'Статус тривоги невідомий' : 'Перевіряю статус тривоги…';
      $('alertMeta').textContent = alert.error ? 'Немає звʼязку з джерелом даних' : '';
    }
    $('alertMute').hidden = !(on && (voices.alert || []).length);
  }

  function nextLessonText(todayKey) {
    for (let i = 1; i <= 14; i++) {
      const key = addDays(todayKey, i);
      const first = activeLessons(key)[0];
      if (first) return `Наступна пара ${i === 1 ? 'завтра' : DAY_ACC[weekdayOf(key)] + ', ' + longDate(key)} о ${first.startStr} — ${first.subject}`;
    }
    return '';
  }

  function renderHero() {
    const now = nowWallMs();
    const key = dateKeyOf(now);
    const sec = secOfDay(now);
    const lessons = activeLessons(key);
    const hero = $('hero');
    const on = alertNow();
    hero.classList.remove('is-live', 'is-idle');
    hero.classList.toggle('is-alarm', on);
    $('heroProgress').hidden = true;
    $('joinBtn').hidden = true;

    const current = lessons.find((l) => sec >= l.start && sec < l.end);
    const next = lessons.find((l) => l.start > sec);
    const target = current || next;

    if (!target) {
      hero.classList.add('is-idle');
      $('heroLabel').textContent = 'Сьогодні';
      $('heroSubject').textContent = lessons.length ? 'Пари закінчились' : 'Пар немає';
      $('heroMeta').textContent = nextLessonText(key) || 'Можна відпочити';
      $('heroTimer').textContent = '';
      return;
    }

    $('heroSubject').textContent = target.subject;
    $('heroMeta').textContent = `${target.no} пара · ${target.startStr}–${target.endStr}` +
      (target.teacher ? ` · ${target.teacher}` : '') + (target.change ? ' · заміна' : '');
    const timer = $('heroTimer');
    timer.textContent = '';
    if (current) {
      hero.classList.add('is-live');
      $('heroLabel').textContent = on ? 'Зараз іде · тривога' : 'Зараз іде';
      timer.append('До кінця: ', el('strong', null, fmtDuration(current.end - sec)));
      $('heroProgress').hidden = false;
      $('heroProgressBar').style.width = (((sec - current.start) / (current.end - current.start)) * 100).toFixed(1) + '%';
    } else {
      $('heroLabel').textContent = 'Наступна пара';
      timer.append('Початок через: ', el('strong', null, fmtDuration(next.start - sec)));
    }
    if (target.link && sec >= target.start - 15 * 60) {
      $('joinBtn').href = target.link;
      $('joinBtn').hidden = false;
    }
  }

  /* ---------- Рендер: розклад ---------- */
  function lessonCard(l, key) {
    const now = nowWallMs();
    const isToday = key === dateKeyOf(now);
    const sec = secOfDay(now);
    const card = el('div', 'lesson');
    if (l.change) card.classList.add('is-' + l.change);
    if (isToday && l.change !== 'cancel' && sec >= l.start && sec < l.end) card.classList.add(alertNow() ? 'is-alarm' : 'is-now');
    if (isToday && sec >= l.end) card.classList.add('is-past');

    card.appendChild(el('div', 'lesson__num', String(l.no)));
    const when = el('div', 'lesson__when');
    when.append(el('span', null, l.startStr), el('span', 'lesson__end', l.endStr));
    if (l.startStr !== l.collegeStart) when.title = `У коледжі: ${l.collegeStart}–${l.collegeEnd}`;
    card.appendChild(when);

    const body = el('div', 'lesson__body');
    const title = el('div', 'lesson__subject', l.subject);
    if (l.change === 'cancel') title.appendChild(el('span', 'badge badge--bad', 'Скасовано'));
    if (l.change === 'replace') title.appendChild(el('span', 'badge', 'Заміна'));
    if (l.change === 'add') title.appendChild(el('span', 'badge', 'Додано'));
    if (l.edited && !l.change) title.appendChild(el('span', 'badge badge--muted', 'Правка старости'));
    body.appendChild(title);
    if (l.teacher) body.appendChild(el('div', 'lesson__teacher', l.teacher));
    if (l.change === 'replace' && l.orig && l.orig.subject && l.orig.subject !== l.subject) {
      body.appendChild(el('div', 'lesson__orig', 'замість: ' + l.orig.subject));
    }
    if (l.change === 'cancel' && l.note) body.appendChild(el('div', 'lesson__orig', l.note));
    card.appendChild(body);

    if (l.link && l.change !== 'cancel') {
      const a = el('a', 'lesson__link', '↗');
      a.href = l.link;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = 'Відкрити пару';
      a.addEventListener('click', (e) => e.stopPropagation());
      card.appendChild(a);
    }
    card.addEventListener('click', () => openLesson(l, key));
    return card;
  }

  function renderWeekNav() {
    const mon = state.viewMonday;
    $('weekLabel').textContent = `${ROMAN[weekNumberFor(mon)]} тиждень`;
    $('weekRange').textContent = `${shortDate(mon)} – ${shortDate(addDays(mon, 5))}`;
    $('todayBtn').disabled = state.selectedKey === homeKey() && state.viewMonday === mondayOf(homeKey());
  }

  function renderDays() {
    const box = $('days');
    box.textContent = '';
    const today = dateKeyOf(nowWallMs());
    for (let i = 0; i < 6; i++) {
      const key = addDays(state.viewMonday, i);
      const plan = dayPlan(key);
      const b = el('button', 'day');
      b.type = 'button';
      b.appendChild(el('span', 'day__name', DAY_SHORT[weekdayOf(key)]));
      b.appendChild(el('span', 'day__num', String(Number(key.slice(8)))));
      if (plan && plan.saturday) b.appendChild(el('span', 'day__sub', `${DAY_SHORT[plan.day]} ${ROMAN[plan.week]}`));
      if (!plan) b.classList.add('is-off');
      if (key === state.selectedKey) b.classList.add('is-active');
      if (key === today) b.classList.add('is-today');
      if (mySubRows(key).length) b.classList.add('has-subs');
      b.addEventListener('click', () => { state.selectedKey = key; playSound('ui'); renderSchedule(); });
      box.appendChild(b);
    }
  }

  function renderDayNote() {
    const key = state.selectedKey;
    const note = $('dayNote');
    note.textContent = '';
    if (weekdayOf(key) !== 'saturday') { note.hidden = true; return; }
    const p = saturdayPlan(key);
    note.hidden = false;
    const src = { manual: 'встановлено вручну', config: 'з налаштувань', order: `з розпорядження №${p.order ? p.order.number : ''}`, auto: 'розраховано автоматично' }[p.source];
    note.appendChild(el('span', null, p.off
      ? 'Субота неробоча'
      : `Робоча субота: розклад — ${DAY_FULL[p.day]}, ${ROMAN[p.week]} тиждень`));
    note.appendChild(el('span', 'day-note__src', ' · ' + src));
    const sel = satSelect(key);
    note.appendChild(sel);
  }

  // вибір «за який день ця субота» (ручна поправка)
  function satSelect(key) {
    const sel = el('select', 'sat-select');
    sel.title = 'Змінити, за який день ця субота';
    const cur = settings.satOverride[key];
    const opts = [['', 'Авто']];
    for (const w of [1, 2]) for (const d of WORK_DAYS) opts.push([d + '|' + w, `${DAY_SHORT[d]} ${ROMAN[w]}`]);
    opts.push(['off', 'Неробоча']);
    for (const [v, t] of opts) {
      const o = el('option', null, t);
      o.value = v;
      sel.appendChild(o);
    }
    sel.value = cur === 'off' ? 'off' : cur ? cur.day + '|' + cur.week : '';
    sel.addEventListener('change', () => {
      if (!sel.value) delete settings.satOverride[key];
      else if (sel.value === 'off') settings.satOverride[key] = 'off';
      else { const [day, week] = sel.value.split('|'); settings.satOverride[key] = { day, week: Number(week) }; }
      saveSettings();
      renderAll();
    });
    return sel;
  }

  function renderLessons() {
    const box = $('lessons');
    box.textContent = '';
    const key = state.selectedKey;
    const lessons = getLessons(key);
    if (!lessons.length) {
      box.appendChild(el('div', 'empty', weekdayOf(key) === 'sunday' || !dayPlan(key) ? 'Вихідний 😴'
        : G.sch ? 'Пар немає' : 'Змін для групи на цей день немає'));
      return;
    }
    for (const l of lessons) box.appendChild(lessonCard(l, key));
  }

  function renderWeekGrid() {
    const t = $('weekGrid');
    t.textContent = '';
    const keys = [0, 1, 2, 3, 4, 5].map((i) => addDays(state.viewMonday, i));
    const today = dateKeyOf(nowWallMs());
    const sec = secOfDay(nowWallMs());
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', 'grid__no', '№'));
    for (const k of keys) {
      const th = el('th', k === today ? 'is-today' : '');
      th.appendChild(el('div', null, DAY_SHORT[weekdayOf(k)] + ' ' + shortDate(k)));
      const p = dayPlan(k);
      if (p && p.saturday) th.appendChild(el('div', 'grid__sub', `за ${DAY_SHORT[p.day]} ${ROMAN[p.week]}`));
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    t.appendChild(thead);
    const tb = el('tbody');
    const byDay = keys.map((k) => new Map(getLessons(k).map((l) => [l.no, l])));
    C.bells.forEach((b, i) => {
      const tr = el('tr');
      const no = el('td', 'grid__no');
      no.append(el('strong', null, String(i + 1)), el('span', null, localHM(state.viewMonday, b.start)), el('span', null, localHM(state.viewMonday, b.end)));
      tr.appendChild(no);
      keys.forEach((k, d) => {
        const l = byDay[d].get(i + 1);
        const td = el('td');
        if (k === today) td.classList.add('is-today');
        if (l) {
          if (l.change) td.classList.add('is-' + l.change);
          if (k === today && l.change !== 'cancel' && sec >= l.start && sec < l.end) td.classList.add('is-now');
          td.append(el('div', 'grid__subj', l.subject), el('div', 'grid__teacher', l.teacher || ''));
          if (l.change) td.appendChild(el('span', 'badge' + (l.change === 'cancel' ? ' badge--bad' : ''), l.change === 'cancel' ? 'Скасовано' : 'Заміна'));
          td.addEventListener('click', () => openLesson(l, k));
        } else td.classList.add('is-empty');
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
  }

  // звідки розклад: PDF коледжу (і коли його востаннє розбирали) або попередження, якщо розібрати не вдалося
  function renderNoSchedule() {
    const box = $('noSchedule');
    box.hidden = false;
    box.textContent = '';
    box.classList.toggle('no-sch--ok', !!G.sch && !G.stale);
    const upd = schedulesMeta.generatedAt ? fmt(viewTZ(), { day: '2-digit', month: '2-digit', ...HM }).format(new Date(schedulesMeta.generatedAt)) : '';
    let text;
    if (!G.sch) text = `Не вдалося прочитати розклад ${G.title} з сайту коледжу — тут видно лише заміни з розпоряджень.`;
    else if (G.stale) text = `Розклад ${G.title} — з попередньої перевірки: свіжий PDF коледжу не вдалося прочитати.`;
    else text = `Розклад з офіційного PDF коледжу${upd ? ' · перевірено ' + upd : ''}`;
    box.appendChild(el('div', null, text));
    const a = el('a', G.sch && !G.stale ? 'no-sch__link' : 'btn btn--accent btn--sm', G.sch && !G.stale ? 'PDF ↗' : 'Офіційний розклад (PDF) ↗');
    a.href = G.pdf;
    a.target = '_blank';
    a.rel = 'noopener';
    box.appendChild(a);
  }

  function renderSchedule() {
    renderWeekNav();
    renderNoSchedule();
    $('dayView').hidden = state.view !== 'day';
    $('weekView').hidden = state.view !== 'week';
    document.querySelectorAll('.sched .seg__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === state.view));
    if (state.view === 'day') { renderDays(); renderDayNote(); renderLessons(); }
    else renderWeekGrid();
  }

  /* ---------- Рендер: розпорядження ---------- */
  function renderOrderNote() {
    const today = dateKeyOf(nowWallMs());
    const upcoming = orders.filter((o) => o.dateKey && o.dateKey >= today).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const btn = $('orderNote');
    if (!upcoming.length) { btn.hidden = true; return; }
    const o = upcoming[0];
    const mine = mySubRows(o.dateKey);
    btn.hidden = false;
    btn.classList.toggle('has-mine', mine.length > 0);
    const when = o.dateKey === today ? 'сьогодні' : o.dateKey === addDays(today, 1) ? 'завтра' : longDate(o.dateKey);
    $('orderNoteText').textContent = `Розпорядження №${o.number || '?'} — заміни на ${when}: ` +
      (mine.length ? `для ${G.title} ${mine.length} ${mine.length === 1 ? 'зміна' : mine.length < 5 ? 'зміни' : 'змін'}` : `для ${G.title} змін немає`);
  }

  function renderOrders() {
    const st = $('ordersStatus');
    if (ordersMeta.loading) st.textContent = 'Завантажую розпорядження з сайту коледжу…';
    else if (ordersMeta.error) st.textContent = `⚠️ Не вдалося оновити (${ordersMeta.error}). Показано збережені копії.`;
    else if (ordersMeta.at) st.textContent = 'Оновлено о ' + fmtHM(ordersMeta.at) + ' · джерело: «Заміни» на Google Drive коледжу';
    else st.textContent = '';

    const list = $('ordersList');
    list.textContent = '';
    if (!orders.length) {
      list.appendChild(el('div', 'empty', ordersMeta.loading ? '…' : 'Розпоряджень поки немає'));
      return;
    }
    const today = dateKeyOf(nowWallMs());
    orders.forEach((o, idx) => {
      const det = el('details', 'order');
      if (state.openOrders.has(o.id) || (idx === 0 && !state.openOrders.size)) det.open = true;
      det.addEventListener('toggle', () => { if (det.open) state.openOrders.add(o.id); else state.openOrders.delete(o.id); });
      if (o.dateKey && o.dateKey < today) det.classList.add('is-old');
      const sum = el('summary', 'order__head');
      const myCount = o.rows.filter(isMine).length;
      sum.appendChild(el('span', 'order__num', '№' + (o.number || '?')));
      sum.appendChild(el('span', 'order__title', o.dateKey ? `Заміна занять на ${longDate(o.dateKey)} (${DAY_FULL[weekdayOf(o.dateKey)]})` : (o.title || 'Розпорядження')));
      sum.appendChild(el('span', 'badge' + (myCount ? '' : ' badge--muted'), myCount ? `${G.title}: ${myCount}` : 'без змін для нас'));
      det.appendChild(sum);

      if (o.satNote) {
        const sn = el('div', 'order__sat', '📅 ' + o.satNote);
        const rule = parseSatRule(o.satNote, G.course);
        if (rule) sn.appendChild(el('strong', null, ` → для ${G.course} курсу: ${DAY_FULL[rule.day]}, ${ROMAN[rule.week]} тиждень`));
        det.appendChild(sn);
      }

      const rows = state.filter === 'mine' ? o.rows.filter(isMine) : o.rows;
      if (!rows.length) {
        det.appendChild(el('div', 'empty empty--sm', state.filter === 'mine' ? 'Для вашої групи змін немає' : 'Таблиця порожня'));
      } else {
        const wrap = el('div', 'table-wrap');
        const t = el('table', 'otable');
        const h = el('tr');
        ['Група', 'Пара', 'За розкладом', 'Заміна'].forEach((x) => h.appendChild(el('th', null, x)));
        const th = el('thead');
        th.appendChild(h);
        t.appendChild(th);
        const tb = el('tbody');
        for (const r of rows) {
          const tr = el('tr');
          if (isMine(r)) tr.classList.add('is-mine');
          if (r.cancelled) tr.classList.add('is-cancel');
          tr.appendChild(el('td', 'otable__g', r.group));
          tr.appendChild(el('td', null, r.pairs.length ? r.pairs.join(', ') : r.pairsText));
          tr.appendChild(el('td', null, [r.fromTeacher, r.fromSubject].filter(Boolean).join(' · ') || '—'));
          tr.appendChild(el('td', null, [r.toTeacher, r.toSubject].filter(Boolean).join(' · ') || '—'));
          tb.appendChild(tr);
        }
        t.appendChild(tb);
        wrap.appendChild(t);
        det.appendChild(wrap);
      }
      if (o.signer) det.appendChild(el('div', 'order__sign', o.signer.replace(/_{3,}/g, ' ')));
      list.appendChild(det);
    });
  }

  function renderAll() {
    renderClock();
    renderAlert();
    renderHero();
    renderOrderNote();
    renderSchedule();
    renderOrders();
  }

  /* ---------- Модальні вікна ---------- */
  function openModal(node, wide) {
    const body = $('modalBody');
    body.textContent = '';
    body.appendChild(node);
    $('modal').classList.toggle('is-wide', !!wide);
    $('modal').hidden = false;
  }
  const closeModal = () => { $('modal').hidden = true; $('modalBody').textContent = ''; };

  function openLesson(l, key) {
    const box = el('div');
    box.appendChild(el('div', 'modal__kicker', `${DAY_FULL[weekdayOf(key)]}, ${longDate(key)} · ${l.no} пара`));
    box.appendChild(el('h3', 'modal__title', l.subject));
    const info = el('div', 'modal__rows');
    const row = (k, v) => { if (!v) return; const r = el('div', 'modal__row'); r.append(el('span', null, k), el('strong', null, v)); info.appendChild(r); };
    row('Час' + (l.startStr !== l.collegeStart ? ` (${tzLabel(viewTZ())})` : ''), `${l.startStr} – ${l.endStr}`);
    if (l.startStr !== l.collegeStart) row(`У коледжі (${tzLabel(TZ)})`, `${l.collegeStart} – ${l.collegeEnd}`);
    row('Викладач', l.teacher);
    if (l.change === 'replace' && l.orig) row('За розкладом', [l.orig.subject, l.orig.teacher].filter(Boolean).join(' · '));
    if (l.change === 'cancel') row('Статус', 'Скасовано / перенесено' + (l.note ? ` (${l.note})` : ''));
    if (l.order) row('Підстава', `Розпорядження №${l.order.number || '?'}`);
    box.appendChild(info);
    if (l.link && l.change !== 'cancel') {
      const a = el('a', 'btn btn--accent', 'Підключитися ↗');
      a.href = l.link;
      a.target = '_blank';
      a.rel = 'noopener';
      box.appendChild(a);
    }
    openModal(box);
  }

  /* ---------- Вибір групи ---------- */
  function openGroupPicker() {
    const box = el('div');
    // сайт закріплений за групою (секретне посилання старости або акаунт старости) — вибору немає
    if (lockedGroup) {
      box.appendChild(el('div', 'modal__kicker', C.college));
      box.appendChild(el('h3', 'modal__title', '🔒 Група ' + G.title));
      box.appendChild(el('p', null, isStarosta()
        ? 'Ви староста цієї групи, тож сайт показує саме її.'
        : 'Сайт відкрито за посиланням вашого старости, тому він показує лише вашу групу разом із посиланнями на пари.'));
      openModal(box);
      return;
    }
    box.appendChild(el('div', 'modal__kicker', C.college));
    box.appendChild(el('h3', 'modal__title', 'Оберіть групу'));
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'gp__search';
    search.placeholder = 'Пошук: П-42, К-3…';
    box.appendChild(search);
    const seg = el('div', 'seg seg--sm gp__courses');
    let course = G.course;
    const list = el('div', 'gp__list');
    const draw = () => {
      seg.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.c) === course && !search.value));
      list.textContent = '';
      const q = normGroup(search.value);
      const groups = q ? ALL_GROUPS.filter((g) => normGroup(g.name + g.title).includes(q)) : ALL_GROUPS.filter((g) => g.course === course);
      if (!groups.length) list.appendChild(el('div', 'empty empty--sm', ALL_GROUPS.length ? 'Нічого не знайдено' : 'Список груп ще завантажується…'));
      for (const g of groups) {
        const b = el('button', 'gp__item');
        b.type = 'button';
        b.appendChild(el('strong', null, g.name));
        b.appendChild(el('span', null, g.schedule ? g.title : 'лише PDF + заміни'));
        if (g.schedule) b.classList.add('has-sch');
        if (g.name === G.name) b.classList.add('is-active');
        b.addEventListener('click', () => chooseGroup(g.name));
        list.appendChild(b);
      }
    };
    for (const c of [...new Set(ALL_GROUPS.map((g) => g.course))].sort()) {
      const b = el('button', 'seg__btn', `${c} курс`);
      b.type = 'button';
      b.dataset.c = c;
      b.addEventListener('click', () => { course = Number(c); search.value = ''; draw(); });
      seg.appendChild(b);
    }
    search.addEventListener('input', draw);
    box.append(seg, list);
    box.appendChild(el('p', 'hint gp__hint', 'Розклади беруться з офіційних PDF на сайті коледжу й оновлюються автоматично щодня.'));
    draw();
    openModal(box);
  }

  function chooseGroup(name) {
    if (lockedGroup) return;
    setGroup(name);
    save('rz_seen_sig', changesSignature());
    closeModal();
    goHome();
    renderAll();
    renderBrand();
    playSound('ui');
    toast('Група: ' + G.title);
    refreshAccess().then(() => { if (isAdmin() && reopenAdminAfterPick) { reopenAdminAfterPick = false; openAccount(); } });
  }
  let reopenAdminAfterPick = false;   // адмін перейшов до вибору групи з панелі — повернути його в панель

  function renderBrand() {
    $('groupName').textContent = (lockedGroup ? '🔒 ' : '') + G.title;
    $('groupName').classList.toggle('is-locked', !!lockedGroup);
    document.title = `${C.siteName} · ${G.title}`;
    $('openAccount').classList.toggle('is-on', !!(auth.profile && (isStarosta() || isAdmin())));
  }

  function openOriginal() {
    const box = el('div');
    box.appendChild(el('h3', 'modal__title', 'Заміни — оригінал'));
    const f = el('iframe', 'modal__frame');
    f.src = `https://drive.google.com/file/d/${C.substitutions.driveFileId}/preview`;
    f.title = 'Заміни.xlsx';
    f.loading = 'lazy';
    box.appendChild(f);
    const a = el('a', 'btn btn--ghost btn--sm', 'Відкрити сторінку замін ↗');
    a.href = C.substitutions.page;
    a.target = '_blank';
    a.rel = 'noopener';
    box.appendChild(a);
    openModal(box, true);
  }

  /* ---------- Панель налаштувань ---------- */
  function openDrawer(tab) {
    $('drawer').classList.add('is-open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('drawerBg').hidden = false;
    if (tab) selectTab(tab);
    if (state.drawerTab === 'other') renderSatList();
  }
  function closeDrawer() {
    $('drawer').classList.remove('is-open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('drawerBg').hidden = true;
  }
  function selectTab(tab) {
    state.drawerTab = tab;
    document.querySelectorAll('.tabs__btn').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.dataset.tab !== tab; });
    if (tab === 'alerts') renderRegions();
    if (tab === 'other') renderSatList();
  }

  function buildThemes() {
    const box = $('themes');
    for (const t of THEMES) {
      const b = el('button', 'theme');
      b.type = 'button';
      b.dataset.theme = t.id;
      const sw = el('span', 'theme__sw');
      t.sw.forEach((c) => { const s = el('i'); s.style.background = c; sw.appendChild(s); });
      b.appendChild(sw);
      const txt = el('span', 'theme__txt');
      txt.append(el('strong', null, t.name), el('span', null, t.desc));
      b.appendChild(txt);
      b.addEventListener('click', () => { applyTheme(t.id); playSound('ui'); });
      box.appendChild(b);
    }
  }

  function buildMixer() {
    const box = $('mixer');
    const strips = [{ id: 'master', label: 'Загальна', icon: '🔊' }, ...CHANNELS];
    for (const c of strips) {
      const s = el('div', 'strip' + (c.id === 'master' ? ' strip--master' : ''));
      const val = el('div', 'strip__val');
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.step = '1';
      range.className = 'fader';
      range.setAttribute('aria-label', 'Гучність: ' + c.label);
      const mute = el('button', 'strip__mute');
      mute.type = 'button';
      const sync = () => {
        range.value = String(mix[c.id].vol);
        range.style.setProperty('--v', mix[c.id].vol + '%');
        val.textContent = mix[c.id].mute ? 'M' : String(mix[c.id].vol);
        mute.textContent = mix[c.id].mute ? '🔇' : '🔈';
        mute.title = mix[c.id].mute ? 'Увімкнути' : 'Вимкнути';
        s.classList.toggle('is-muted', mix[c.id].mute);
      };
      range.addEventListener('input', () => { mix[c.id].vol = Number(range.value); saveMix(); applyMix(); sync(); });
      range.addEventListener('change', () => { if (c.id !== 'master' && c.id !== 'alert') playSound(c.id); });
      mute.addEventListener('click', () => { mix[c.id].mute = !mix[c.id].mute; saveMix(); applyMix(); sync(); });
      s.append(val, range, el('div', 'strip__icon', c.icon), el('div', 'strip__label', c.label), mute);
      if (c.id !== 'master') {
        const play = el('button', 'strip__play', '▶');
        play.type = 'button';
        play.title = 'Прослухати';
        play.addEventListener('click', () => {
          if ((voices[c.id] || []).length && c.id === 'alert') { stopSound(c.id); return; }
          playSound(c.id);
        });
        s.appendChild(play);
      }
      sync();
      box.appendChild(s);
    }
  }

  // індикатор рівня на виході мікшера
  function meterLoop() {
    const bar = $('meterBar');
    const buf = new Uint8Array(128);
    const tick = () => {
      if (analyser && $('drawer').classList.contains('is-open')) {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        bar.style.width = Math.min(100, (peak / 128) * 160) + '%';
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  function renderRegions() {
    const sel = $('regionSelect');
    const list = alert.regions.length ? alert.regions : [settings.region];
    if (sel.options.length === list.length) { sel.value = settings.region; return; }
    sel.textContent = '';
    for (const r of [...list].sort((a, b) => (a.startsWith('м.') ? -1 : 0) - (b.startsWith('м.') ? -1 : 0) || a.localeCompare(b, 'uk'))) {
      const o = el('option', null, r);
      o.value = r;
      sel.appendChild(o);
    }
    sel.value = settings.region;
    $('alertSource').textContent = alert.source ? `Джерело: ${alert.source}. Оновлення кожні ${C.alerts.pollSec} с.` :
      alert.error ? `Помилка: ${alert.error}` : '';
  }

  function renderSatList() {
    const a = satAnchor();
    $('satInfo').textContent = `Суботи йдуть по колу ПН I → … → ПТ II. Відома точка для ${G.course} курсу: ${shortDate(a.date)} — ${DAY_FULL[a.day]}, ${ROMAN[a.week]} тиждень. Розпорядження коледжу мають пріоритет; кожну суботу можна виправити вручну.`;
    const box = $('satList');
    box.textContent = '';
    let key = addDays(mondayOf(dateKeyOf(nowWallMs())), 5);
    for (let i = 0; i < 6; i++, key = addDays(key, 7)) {
      const p = saturdayPlan(key);
      const r = el('div', 'sat-row');
      r.appendChild(el('span', 'sat-row__date', `СБ ${shortDate(key)}`));
      r.appendChild(el('span', 'sat-row__plan', p.off ? 'неробоча' : `${DAY_FULL[p.day]}, ${ROMAN[p.week]}`));
      r.appendChild(satSelect(key));
      box.appendChild(r);
    }
  }

  function initSettings() {
    buildThemes();
    buildMixer();
    applyTheme(settings.theme);

    $('openSettings').addEventListener('click', () => openDrawer('style'));
    $('openMixer').addEventListener('click', () => openDrawer('sound'));
    $('closeDrawer').addEventListener('click', closeDrawer);
    $('drawerBg').addEventListener('click', closeDrawer);
    document.querySelectorAll('.tabs__btn').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
    $('themeQuick').addEventListener('click', () => {
      const i = THEMES.findIndex((t) => t.id === settings.theme);
      applyTheme(THEMES[(i + 1) % THEMES.length].id);
      toast('Стиль: ' + THEMES[(i + 1) % THEMES.length].name);
      playSound('ui');
    });

    $('regionSelect').addEventListener('change', (e) => {
      settings.region = e.target.value;
      saveSettings();
      prevAlert = undefined;
      pollAlert().then(renderAlert);
    });
    $('alertRepeat').checked = settings.alertRepeat;
    $('alertRepeat').addEventListener('change', (e) => { settings.alertRepeat = e.target.checked; saveSettings(); });
    $('alertProxy').value = settings.alertProxy;
    $('alertProxy').addEventListener('change', (e) => { settings.alertProxy = e.target.value.trim(); saveSettings(); pollAlert().then(renderAll); });
    $('testAlert').addEventListener('click', () => { testAlertUntil = Date.now() + 10000; alertSilenced = false; });
    $('alertMute').addEventListener('click', () => { alertSilenced = true; stopSound('alert'); renderAlert(); });

    $('notifyToggle').checked = settings.notify && 'Notification' in window && Notification.permission === 'granted';
    $('notifyToggle').addEventListener('change', async (e) => {
      if (e.target.checked && 'Notification' in window) {
        const p = await Notification.requestPermission();
        e.target.checked = p === 'granted';
        if (p !== 'granted') toast('Браузер не дозволив сповіщення');
      }
      settings.notify = e.target.checked;
      saveSettings();
    });
    $('soonMin').value = settings.soonMin;
    $('soonMin').addEventListener('change', (e) => { settings.soonMin = Math.max(0, Math.min(30, Number(e.target.value) || 0)); e.target.value = settings.soonMin; saveSettings(); });
    $('groupName').addEventListener('click', openGroupPicker);
    $('openAccount').addEventListener('click', () => openAccount());
    $('changeGroup').addEventListener('click', () => { closeDrawer(); openGroupPicker(); });

    // часовий пояс показу
    const tzSel = $('tzSelect');
    const zones = [...new Set([DEVICE_TZ, TZ, 'Europe/Warsaw', 'Europe/Berlin', 'Europe/Prague', 'Europe/London', 'Europe/Lisbon', 'America/New_York', 'America/Toronto'])];
    const auto = el('option', null, `Авто — як на пристрої (${tzLabel(DEVICE_TZ)})`);
    auto.value = 'auto';
    tzSel.appendChild(auto);
    for (const z of zones) {
      const o = el('option', null, z === TZ ? `${tzLabel(z)} — час коледжу` : tzLabel(z));
      o.value = z;
      tzSel.appendChild(o);
    }
    tzSel.value = zones.includes(settings.tz) || settings.tz === 'auto' ? settings.tz : 'auto';
    tzSel.addEventListener('change', () => { settings.tz = tzSel.value; saveSettings(); renderAll(); });

    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('modal').hidden) closeModal();
      else closeDrawer();
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
    meterLoop();
  }

  /* ---------- Звукові події ---------- */
  let prevAlert;               // undefined — ще не знаємо: перший стан не озвучуємо
  let lastDay = null, lastSec = null;
  const LATE = 70;             // якщо вкладка спала довше — старий звук не граємо

  function checkEvents() {
    const on = alertKnown() ? alertNow() : prevAlert;
    if (prevAlert === undefined) {
      if (alertKnown()) prevAlert = on;
    } else if (on !== prevAlert) {
      prevAlert = on;
      if (on) {
        alertSilenced = false;
        playSound('alert');
        notify('🚨 Повітряна тривога', settings.region + ' — пройдіть в укриття');
      } else {
        stopSound('alert');
        playSound('clear');
        notify('✅ Відбій тривоги', settings.region);
      }
    }
    // повтор сирени, доки не натиснуто «Тихо»
    if (on && settings.alertRepeat && !alertSilenced && !(voices.alert || []).length) playSound('alert');
    if (voices.alert && voices.alert.length && actx && voices.alert.every((o) => o.__done)) voices.alert = [];

    const now = nowWallMs();
    const day = dateKeyOf(now);
    const sec = secOfDay(now);
    if (lastDay === day && lastSec !== null) {
      const crossed = (t) => lastSec < t && t <= sec && sec - t <= LATE;
      for (const l of activeLessons(day)) {
        if (crossed(l.start)) { playSound('start'); notify('🔔 Почалась пара', `${l.no} пара — ${l.subject}`); }
        if (crossed(l.end)) { playSound('end'); }
        if (settings.soonMin > 0 && crossed(l.start - settings.soonMin * 60)) {
          playSound('soon');
          notify(`⏰ Через ${settings.soonMin} хв пара`, `${l.no} пара — ${l.subject}` + (l.link ? ' (є посилання)' : ''));
        }
      }
    }
    lastDay = day;
    lastSec = sec;
  }

  // таймер у Web Worker не гальмує у фоновій вкладці, тож звуки й тривога спрацьовують вчасно
  function startTicker(cb, ms) {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`setInterval(function(){postMessage(0)},${ms})`], { type: 'text/javascript' })));
      w.onmessage = cb;
      return;
    } catch (e) { /* без Worker */ }
    setInterval(cb, ms);
  }

  /* =====================================================================
     АКАУНТИ (Supabase)
     - староста реєструється, вказує групу → адмін підтверджує → староста редагує лише свою групу;
     - студенти без акаунтів: секретне посилання групи #g=… закріплює сайт за групою й відкриває посилання на пари;
     - без секретного посилання видно розклад і заміни, але не посилання на пари.
     ===================================================================== */
  const sb = (() => {
    const cfg = C.supabase || {};
    if (!cfg.url || !cfg.anonKey || !window.supabase) return null;
    try { return window.supabase.createClient(cfg.url, cfg.anonKey); } catch (e) { return null; }
  })();
  const auth = { user: null, profile: null };
  let lockedGroup = null;        // група, закріплена секретним посиланням або акаунтом старости
  const isStarosta = () => auth.profile && auth.profile.role === 'starosta';
  const isAdmin = () => auth.profile && auth.profile.role === 'admin';
  const groupLink = (token) => location.origin + location.pathname + '#g=' + token;
  // посилання для старости: одразу відкриває реєстрацію з уже вибраною групою
  const starostaLink = (group) => location.origin + location.pathname + '#reg=' + encodeURIComponent(group);
  let regFromUrl = null;

  // з адреси: #g=… — секретне посилання групи (для студентів), #reg=… — реєстрація старости
  function takeTokenFromUrl() {
    const g = location.hash.match(/(?:^#|&)g=([a-f0-9]{16,64})/i);
    const reg = location.hash.match(/(?:^#|&)reg=([^&]+)/);
    if (!g && !reg) return;
    if (g) save('rz_group_token', g[1]);
    if (reg) { try { regFromUrl = decodeURIComponent(reg[1]); } catch (e) { regFromUrl = null; } }
    history.replaceState(null, '', location.pathname + location.search);
  }

  async function loadAccess() {
    privateLinks = {};
    lockedGroup = null;
    if (!sb) return;
    // адмін не прив'язаний до групи: бачить і редагує ту, яку зараз відкрив
    if (isAdmin()) {
      const { data } = await sb.from('lesson_links').select('teacher_key,url').eq('group_name', G.name);
      privateLinks = Object.fromEntries((data || []).map((r) => [r.teacher_key, r.url]));
      return;
    }
    // староста бачить і редагує свою групу
    if (isStarosta()) {
      lockedGroup = auth.profile.group_name;
      const { data } = await sb.from('lesson_links').select('teacher_key,url').eq('group_name', lockedGroup);
      privateLinks = Object.fromEntries((data || []).map((r) => [r.teacher_key, r.url]));
      return;
    }
    const token = load('rz_group_token', null);
    if (!token) return;
    // кеш на 30 хв: студент не звертається до бази при кожному відкритті сторінки
    const cached = load('rz_group_cache', null);
    const fresh = cached && cached.token === token && Date.now() - cached.at < 30 * 60 * 1000;
    if (cached && cached.token === token) { lockedGroup = cached.group_name; privateLinks = cached.links || {}; }
    if (fresh) return;
    const { data, error } = await sb.rpc('group_by_token', { p_token: token });
    if (error) return;   // немає зв'язку — лишаємо збережене
    if (!data) {
      save('rz_group_token', null);
      save('rz_group_cache', null);
      lockedGroup = null;
      privateLinks = {};
      toast('Посилання групи застаріло — попросіть нове у старости');
      return;
    }
    lockedGroup = data.group_name;
    privateLinks = data.links || {};
    save('rz_group_cache', { token, at: Date.now(), group_name: data.group_name, links: privateLinks });
  }

  // Правки розкладу. Звичайні відвідувачі читають файл data/overrides.json (його кожні 30 хв вивантажує
  // робот GitHub Actions) — так база не навантажується від кожного відкриття сторінки.
  // Старости й адмін бачать живі дані з бази, щоб одразу бачити свої зміни.
  let overridesFile = null;
  async function loadOverrides() {
    overrides = [];
    if (!G) return;
    if (sb && (isStarosta() || isAdmin())) {
      const { data } = await sb.from('schedule_overrides').select('week,day,pair,subject,teacher,removed').eq('group_name', G.name);
      overrides = data || [];
      return;
    }
    if (!overridesFile) {
      try {
        const r = await fetch('data/overrides.json?t=' + Math.floor(Date.now() / 600000), { cache: 'no-cache' });
        overridesFile = r.ok ? await r.json() : { overrides: [] };
      } catch (e) { overridesFile = { overrides: [] }; }
    }
    overrides = (overridesFile.overrides || []).filter((o) => o.group_name === G.name);
  }

  // застосувати доступ: закріплена група, посилання, правки → перемалювати
  async function refreshAccess() {
    await loadAccess();
    if (lockedGroup && lockedGroup !== settings.group) { setGroup(lockedGroup); goHome(); }
    await loadOverrides();
    renderBrand();
    renderAll();
  }

  // профіль читаємо функцією бази: вона сама знаходить (і за потреби створює) профіль того, хто ввійшов.
  // Якщо база на мить не відповіла — до 3 спроб, а попередній профіль того самого користувача не скидаємо.
  async function loadProfile() {
    auth.profileError = null;
    if (!sb || !auth.user) { auth.profile = null; return; }
    const keep = auth.profile && auth.profile.id === auth.user.id ? auth.profile : null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await sb.rpc('my_profile');
      if (data) { auth.profile = data; return; }
      auth.profileError = error ? error.message : null;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 700 * attempt));
    }
    if (keep) { auth.profile = keep; auth.profileError = null; return; }
    auth.profile = null;
    if (!auth.profileError) {
      const w = await sb.rpc('whoami');
      auth.profileError = w.error ? w.error.message
        : !w.data || !w.data.uid ? 'база не отримала токен входу — вийдіть і увійдіть знову'
        : 'профіль не знайдено для uid ' + w.data.uid;
    }
  }

  async function initAuth() {
    takeTokenFromUrl();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    auth.user = data.session ? data.session.user : null;
    await loadProfile();
    // Увага: всередині цього обробника НЕ можна чекати інших запитів Supabase — бібліотека тримає блокування
    // сесії, і запит повертається порожнім. Тому вся робота — через setTimeout, уже після обробника.
    sb.auth.onAuthStateChange((event, session) => {
      const prevId = auth.user && auth.user.id;
      auth.user = session ? session.user : null;
      if (event === 'PASSWORD_RECOVERY') { setTimeout(() => openAccount('newpass'), 0); return; }
      // при поверненні на вкладку Supabase повторно надсилає SIGNED_IN — той самий користувач, нічого не робимо
      if (event === 'SIGNED_IN' && session && prevId === session.user.id && auth.profile) return;
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT' && event !== 'USER_UPDATED') return;
      setTimeout(async () => {
        await loadProfile();
        await refreshAccess();
        if (!$('modal').hidden && $('modalBody').querySelector('.acc')) openAccount();
      }, 0);
    });
  }

  /* ---------- Вікно акаунта ---------- */
  const field = (label, input) => { const l = el('label', 'field'); l.append(el('span', null, label), input); return l; };
  const inp = (type, ph, val) => { const i = document.createElement('input'); i.type = type; if (ph) i.placeholder = ph; if (val != null) i.value = val; return i; };
  const btn = (text, cls, onClick) => { const b = el('button', 'btn ' + (cls || ''), text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
  const msgBox = () => el('div', 'acc__msg');
  const say = (box, text, bad) => { box.textContent = text; box.classList.toggle('is-bad', !!bad); };
  async function busy(b, fn) {
    b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  }

  function groupSelect(value) {
    const s = document.createElement('select');
    const empty = el('option', null, '— оберіть групу —');
    empty.value = '';
    s.appendChild(empty);
    for (const g of ALL_GROUPS) {
      const o = el('option', null, `${g.name} (${g.course} курс)`);
      o.value = g.name;
      s.appendChild(o);
    }
    s.value = value || '';
    return s;
  }

  function openAccount(mode, presetGroup, retried) {
    const box = el('div', 'acc');
    box.appendChild(el('div', 'modal__kicker', C.siteName + ' · кабінет старости'));
    if (!sb) {
      box.appendChild(el('h3', 'modal__title', 'Акаунти ще не підключені'));
      box.appendChild(el('p', 'hint', 'Власник сайту має вказати проєкт Supabase у js/data.js.'));
      openModal(box);
      return;
    }
    // увійшли, але профіль ще не підвантажився — тихо дочитуємо, а не лякаємо помилкою
    if (auth.user && !auth.profile && !retried && mode !== 'newpass') {
      box.appendChild(el('h3', 'modal__title', 'Завантаження профілю…'));
      openModal(box);
      loadProfile().then(() => refreshAccess()).then(() => openAccount(mode, presetGroup, true));
      return;
    }
    if (mode === 'newpass') renderNewPassword(box);
    else if (!auth.user) renderLogin(box, mode === 'register', presetGroup);
    else if (!auth.profile) renderNoProfile(box);
    else if (isAdmin()) renderAdmin(box);
    else if (isStarosta()) renderStarosta(box);
    else renderPending(box);
    openModal(box, isStarosta() || isAdmin());
  }

  // не більше 5 спроб входу/реєстрації за 10 хв з цього браузера (решту обмежує сам Supabase за IP)
  const ATTEMPT_MAX = 5, ATTEMPT_WINDOW = 10 * 60 * 1000;
  const recentAttempts = () => (load('rz_attempts', []) || []).filter((t) => Date.now() - t < ATTEMPT_WINDOW);
  const noteAttempt = () => save('rz_attempts', [...recentAttempts(), Date.now()]);
  function attemptWait() {
    const a = recentAttempts();
    return a.length < ATTEMPT_MAX ? 0 : Math.ceil((a[0] + ATTEMPT_WINDOW - Date.now()) / 1000);
  }

  function renderLogin(box, register, presetGroup) {
    box.appendChild(el('h3', 'modal__title', register ? 'Реєстрація старости' : 'Вхід для старост'));
    const tabs = el('div', 'seg seg--sm acc__tabs');
    const tLogin = btn('Вхід', 'seg__btn' + (register ? '' : ' is-active'), () => openAccount());
    const tReg = btn('Реєстрація', 'seg__btn' + (register ? ' is-active' : ''), () => openAccount('register', presetGroup));
    tabs.append(tLogin, tReg);
    box.appendChild(tabs);
    const email = inp('email', 'пошта@приклад.com');
    email.autocomplete = 'email';
    const pass = inp('password', register ? 'щонайменше 8 символів' : '');
    pass.autocomplete = register ? 'new-password' : 'current-password';
    const msg = msgBox();
    if (register) {
      const name = inp('text', 'Прізвище Ім\'я');
      const grp = groupSelect(presetGroup || (G ? G.name : ''));
      if (presetGroup) grp.disabled = true;   // прийшов за посиланням для старости конкретної групи
      box.append(field('ПІБ', name), field('Ваша група', grp), field('Пошта', email), field('Пароль', pass));
      box.appendChild(el('p', 'hint', 'Після реєстрації заявку підтверджує адміністратор сайту. Редагувати можна буде лише вибрану групу.'));
      const go = btn('Надіслати заявку', 'btn--accent');
      go.addEventListener('click', () => busy(go, async () => {
        if (!name.value.trim() || !grp.value) return say(msg, 'Вкажіть ПІБ і групу', true);
        if (pass.value.length < 8) return say(msg, 'Пароль — щонайменше 8 символів', true);
        const wait = attemptWait();
        if (wait) return say(msg, `Забагато спроб. Зачекайте ${wait} с`, true);
        noteAttempt();
        const { data, error } = await sb.auth.signUp({
          email: email.value.trim(), password: pass.value,
          options: { data: { full_name: name.value.trim(), group_name: grp.value }, emailRedirectTo: location.origin + location.pathname },
        });
        if (error) return say(msg, 'Помилка: ' + error.message, true);
        say(msg, data.session ? 'Заявку надіслано. Чекайте підтвердження адміністратора.' :
          'Майже готово: підтвердьте пошту за посиланням у листі, потім увійдіть. Заявка вже чекає на підтвердження.');
      }));
      box.append(go, msg);
    } else {
      box.append(field('Пошта', email), field('Пароль', pass));
      const go = btn('Увійти', 'btn--accent');
      go.addEventListener('click', () => busy(go, async () => {
        const wait = attemptWait();
        if (wait) return say(msg, `Забагато спроб. Зачекайте ${wait} с`, true);
        noteAttempt();
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        if (error) return say(msg, error.message === 'Invalid login credentials' ? 'Невірна пошта або пароль' : 'Помилка: ' + error.message, true);
        save('rz_attempts', []);
      }));
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
      const forgot = btn('Забули пароль?', 'btn--ghost btn--sm', async () => {
        if (!email.value.trim()) return say(msg, 'Спершу впишіть пошту', true);
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
        say(msg, error ? 'Помилка: ' + error.message : 'Лист для зміни пароля надіслано', !!error);
      });
      const row = el('div', 'row-btns');
      row.append(go, forgot);
      box.append(row, msg);
    }
  }

  function renderNewPassword(box) {
    box.appendChild(el('h3', 'modal__title', 'Новий пароль'));
    const pass = inp('password', 'щонайменше 8 символів');
    const msg = msgBox();
    const go = btn('Зберегти', 'btn--accent');
    go.addEventListener('click', () => busy(go, async () => {
      if (pass.value.length < 8) return say(msg, 'Щонайменше 8 символів', true);
      const { error } = await sb.auth.updateUser({ password: pass.value });
      say(msg, error ? 'Помилка: ' + error.message : 'Пароль змінено', !!error);
    }));
    box.append(field('Пароль', pass), go, msg);
  }

  // вихід завжди спрацьовує: спершу локально (без сервера), сесію на сервері закриваємо «у фоні»
  async function logout() {
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* все одно чистимо нижче */ }
    try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* не критично */ }
    auth.user = null;
    auth.profile = null;
    closeModal();
    toast('Ви вийшли');
    await refreshAccess();
  }
  const logoutBtn = () => btn('Вийти', 'btn--ghost btn--sm', logout);

  function renderNoProfile(box) {
    box.appendChild(el('h3', 'modal__title', 'Не вдалося завантажити профіль'));
    box.appendChild(el('p', 'hint', `Ви ввійшли як ${auth.user.email}, але база не віддала ваш профіль.`));
    if (auth.profileError) box.appendChild(el('p', 'acc__msg is-bad', 'Відповідь бази: ' + auth.profileError));
    const row = el('div', 'row-btns');
    row.append(btn('Спробувати ще раз', 'btn--accent btn--sm', async () => { await loadProfile(); await refreshAccess(); openAccount(); }), logoutBtn());
    box.appendChild(row);
  }

  function renderPending(box) {
    const p = auth.profile;
    const rejected = p.role === 'rejected';
    box.appendChild(el('h3', 'modal__title', rejected ? 'Заявку відхилено' : 'Заявка на розгляді'));
    box.appendChild(el('p', null, rejected
      ? `Заявку на роль старости групи ${p.group_name} відхилено. Якщо це помилка — напишіть адміністратору сайту.`
      : `Ви подали заявку на роль старости групи ${p.group_name}. Щойно адміністратор її підтвердить, тут з'явиться панель редагування.`));
    box.appendChild(logoutBtn());
  }

  /* ---------- Панель старости ---------- */
  function renderStarosta(box) {
    const p = auth.profile;
    const head = el('div', 'acc__head');
    head.append(el('h3', 'modal__title', `Староста ${p.group_name}`), logoutBtn());
    box.appendChild(head);
    box.appendChild(el('p', 'hint', `${p.full_name || p.email} · редагувати можна лише свою групу.`));
    renderGroupTools(box, p.group_name);
  }

  // інструменти групи (староста — своєї, адмін — будь-якої): секретне посилання, посилання на пари, правки
  function renderGroupTools(box, groupName, linkTitle) {
    const sec = el('section', 'acc__sec');
    sec.appendChild(el('h4', 'h3', linkTitle || '🔗 Посилання для студентів групи'));
    sec.appendChild(el('p', 'hint', 'Надішліть його в чат групи. Хто відкриє — побачить посилання на пари саме цієї групи, а сайт закріпиться за нею.'));
    const linkOut = inp('text', 'завантаження…');
    linkOut.readOnly = true;
    const lmsg = msgBox();
    const copy = btn('Копіювати', 'btn--accent btn--sm', async () => {
      try { await navigator.clipboard.writeText(linkOut.value); say(lmsg, 'Скопійовано ✓'); } catch (e) { linkOut.select(); say(lmsg, 'Скопіюйте вручну (Ctrl+C)'); }
    });
    const rotate = btn('Нове посилання', 'btn--ghost btn--sm', () => busy(rotate, async () => {
      if (!confirm('Старе посилання перестане працювати. Створити нове?')) return;
      const { data, error } = await sb.rpc('rotate_group_token_for', { p_group: groupName });
      if (error) return say(lmsg, 'Помилка: ' + error.message, true);
      linkOut.value = groupLink(data);
      say(lmsg, 'Нове посилання створено — надішліть його групі');
    }));
    sb.rpc('get_group_token', { p_group: groupName }).then(({ data, error }) => {
      linkOut.value = error ? '' : groupLink(data);
      if (error) say(lmsg, 'Помилка: ' + error.message, true);
    });
    const lr = el('div', 'row-btns');
    lr.append(copy, rotate);
    sec.append(linkOut, lr, lmsg);
    box.appendChild(sec);
    box.appendChild(renderLinksEditor(groupName));
    box.appendChild(renderOverridesEditor(groupName));
  }

  // список «викладач → посилання» для всіх викладачів групи
  function renderLinksEditor(groupName) {
    const sec = el('section', 'acc__sec');
    sec.appendChild(el('h4', 'h3', '🎥 Посилання на пари'));
    sec.appendChild(el('p', 'hint', 'Одне посилання на всі пари викладача. Якщо в нього різні посилання на різні предмети — заповніть рядки окремих предметів.'));
    const teachers = new Map();   // прізвище → Set(предмети)
    const add = (n, t) => {
      const sn = (t || '').split(',')[0].trim().split(/\s+/)[0];
      if (!sn) return;
      if (!teachers.has(sn)) teachers.set(sn, { full: t.split(',')[0].trim(), subjects: new Set() });
      teachers.get(sn).subjects.add(n);
    };
    if (G.sch) for (const w of Object.values(G.sch.schedule)) for (const d of Object.values(w)) for (const l of d) if (l) add(l.n, l.t);
    for (const o of overrides) if (!o.removed) add(o.subject, o.teacher);

    const rows = [];
    const list = el('div', 'acc__links');
    for (const [sn, info] of [...teachers.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'))) {
      const mk = (key, label, sub) => {
        const r = el('div', 'acc__link' + (sub ? ' is-sub' : ''));
        const i = inp('url', 'https://… (порожньо — без посилання)', privateLinks[key] || '');
        r.append(el('span', 'acc__who', label), i);
        rows.push({ key, i });
        list.appendChild(r);
      };
      mk(sn, `${info.full} — усі пари`);
      if (info.subjects.size > 1) for (const s of info.subjects) mk(`${sn}|${s}`, `↳ ${s}`, true);
    }
    if (!rows.length) list.appendChild(el('div', 'empty empty--sm', 'У розкладі групи немає викладачів'));
    const msg = msgBox();
    const saveBtn = btn('Зберегти посилання', 'btn--accent btn--sm');
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      const bad = rows.find((r) => r.i.value.trim() && !/^https?:\/\//i.test(r.i.value.trim()));
      if (bad) { bad.i.focus(); return say(msg, 'Посилання має починатися з https://', true); }
      const up = rows.filter((r) => r.i.value.trim()).map((r) => ({ group_name: groupName, teacher_key: r.key, url: r.i.value.trim(), updated_by: auth.user.id, updated_at: new Date().toISOString() }));
      const del = rows.filter((r) => !r.i.value.trim() && privateLinks[r.key]).map((r) => r.key);
      if (up.length) { const { error } = await sb.from('lesson_links').upsert(up); if (error) return say(msg, 'Помилка: ' + error.message, true); }
      if (del.length) { const { error } = await sb.from('lesson_links').delete().eq('group_name', groupName).in('teacher_key', del); if (error) return say(msg, 'Помилка: ' + error.message, true); }
      await refreshAccess();
      say(msg, 'Збережено ✓');
    }));
    sec.append(list, saveBtn, msg);
    return sec;
  }

  // правка окремої пари: інший предмет/викладач або «пари немає»
  function renderOverridesEditor(groupName) {
    const sec = el('section', 'acc__sec');
    sec.appendChild(el('h4', 'h3', '✏️ Правки розкладу'));
    sec.appendChild(el('p', 'hint', 'Якщо в PDF коледжу помилка або розклад змінився — виправте пару тут. Правки бачать усі, поверх офіційного розкладу.'));
    const mkSel = (opts) => { const s = document.createElement('select'); for (const [v, t] of opts) { const o = el('option', null, t); o.value = v; s.appendChild(o); } return s; };
    const wk = mkSel([['1', 'I тиждень'], ['2', 'II тиждень']]);
    const dy = mkSel(WORK_DAYS.map((d) => [d, DAY_FULL[d]]));
    const pr = mkSel(C.bells.map((b, i) => [String(i + 1), `${i + 1} пара (${b.start})`]));
    const subj = inp('text', 'Назва предмета');
    const teach = inp('text', 'Прізвище І.Б.');
    const removed = inp('checkbox');
    const cur = el('div', 'hint acc__cur');
    const sync = () => {
      const w = Number(wk.value), d = dy.value, p = Number(pr.value);
      const o = overrides.find((x) => x.week === w && x.day === d && x.pair === p);
      const base = G.sch && ((G.sch.schedule[w] || {})[d] || [])[p - 1];
      cur.textContent = 'У PDF коледжу: ' + (base ? `${base.n}${base.t ? ' · ' + base.t : ''}` : 'пари немає') + (o ? ' · є ваша правка' : '');
      subj.value = o ? o.subject : base ? base.n : '';
      teach.value = o ? o.teacher : base ? base.t : '';
      removed.checked = !!(o && o.removed);
    };
    [wk, dy, pr].forEach((s) => s.addEventListener('change', sync));
    const grid = el('div', 'acc__grid');
    grid.append(field('Тиждень', wk), field('День', dy), field('Пара', pr));
    const rm = el('label', 'switch-row');
    rm.append(removed, el('span', null, 'Пари немає (прибрати з розкладу)'));
    const msg = msgBox();
    const saveBtn = btn('Зберегти правку', 'btn--accent btn--sm');
    saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
      if (!removed.checked && !subj.value.trim()) return say(msg, 'Вкажіть предмет або позначте «Пари немає»', true);
      const { error } = await sb.from('schedule_overrides').upsert({
        group_name: groupName, week: Number(wk.value), day: dy.value, pair: Number(pr.value),
        subject: removed.checked ? '' : subj.value.trim(), teacher: removed.checked ? '' : teach.value.trim(),
        removed: removed.checked, updated_by: auth.user.id, updated_at: new Date().toISOString(),
      });
      if (error) return say(msg, 'Помилка: ' + error.message, true);
      await refreshAccess();
      drawList();
      sync();
      say(msg, 'Збережено ✓');
    }));
    const list = el('div', 'acc__olist');
    const drawList = () => {
      list.textContent = '';
      if (!overrides.length) { list.appendChild(el('div', 'hint', 'Правок поки немає.')); return; }
      for (const o of [...overrides].sort((a, b) => a.week - b.week || WORK_DAYS.indexOf(a.day) - WORK_DAYS.indexOf(b.day) || a.pair - b.pair)) {
        const r = el('div', 'acc__orow');
        r.appendChild(el('span', null, `${ROMAN[o.week]} · ${DAY_SHORT[o.day]} · ${o.pair} пара: ${o.removed ? 'пари немає' : o.subject + (o.teacher ? ' · ' + o.teacher : '')}`));
        const x = btn('✕', 'btn--ghost btn--sm', () => busy(x, async () => {
          const { error } = await sb.from('schedule_overrides').delete().match({ group_name: groupName, week: o.week, day: o.day, pair: o.pair });
          if (error) return say(msg, 'Помилка: ' + error.message, true);
          await refreshAccess();
          drawList();
          sync();
        }));
        x.title = 'Скасувати правку';
        r.appendChild(x);
        list.appendChild(r);
      }
    };
    sync();
    drawList();
    sec.append(grid, cur, field('Предмет', subj), field('Викладач', teach), rm, saveBtn, msg, el('h4', 'acc__sub', 'Ваші правки'), list);
    return sec;
  }

  /* ---------- Панель адміністратора ---------- */
  let adminTab = 'group';
  const ROLE_LABEL = { pending: 'Заявка', starosta: 'Староста', admin: 'Адмін', rejected: 'Відхилено' };

  // адмін: без прив'язки до групи; інструменти старости для будь-якої групи + керування всіма акаунтами
  function renderAdmin(box) {
    const head = el('div', 'acc__head');
    head.append(el('h3', 'modal__title', 'Адміністратор'), logoutBtn());
    box.appendChild(head);
    box.appendChild(el('p', 'hint', `${auth.profile.full_name || auth.profile.email} · без прив'язки до групи, доступ до всіх груп`));
    const tabs = el('div', 'seg seg--sm acc__tabs');
    tabs.append(
      btn('🏫 Група', 'seg__btn' + (adminTab === 'group' ? ' is-active' : ''), () => { adminTab = 'group'; openAccount(); }),
      btn('👥 Акаунти', 'seg__btn' + (adminTab === 'users' ? ' is-active' : ''), () => { adminTab = 'users'; openAccount(); }),
    );
    box.appendChild(tabs);
    if (adminTab === 'group') renderAdminGroup(box);
    else renderAdminUsers(box);
  }

  function renderAdminGroup(box) {
    const pick = el('div', 'acc__orow');
    pick.appendChild(el('span', null, `Редагуєте групу: ${G.title}`));
    pick.appendChild(btn('Змінити групу', 'btn--ghost btn--sm', () => { reopenAdminAfterPick = true; closeModal(); openGroupPicker(); }));
    box.appendChild(pick);
    // посилання №1 — для старости: відкриває реєстрацію з уже вибраною групою (заявку все одно підтверджуєте ви)
    const sec = el('section', 'acc__sec');
    sec.appendChild(el('h4', 'h3', '1️⃣ Посилання для старости'));
    sec.appendChild(el('p', 'hint', `Надішліть старості ${G.title}: відкриється реєстрація з уже вибраною групою. Заявка з'явиться у «👥 Акаунти».`));
    const out = inp('text', '', starostaLink(G.name));
    out.readOnly = true;
    const m = msgBox();
    const copy = btn('Копіювати', 'btn--accent btn--sm', async () => {
      try { await navigator.clipboard.writeText(out.value); say(m, 'Скопійовано ✓'); } catch (e) { out.select(); say(m, 'Скопіюйте вручну (Ctrl+C)'); }
    });
    sec.append(out, copy, m);
    box.appendChild(sec);
    // посилання №2 — для студентів (секретне посилання групи) + посилання на пари й правки
    renderGroupTools(box, G.name, '2️⃣ Посилання для студентів');
  }

  function renderAdminUsers(box) {
    const msg = msgBox();
    const pend = el('section', 'acc__sec');
    pend.appendChild(el('h4', 'h3', '📝 Нові заявки'));
    const pendList = el('div', 'acc__olist');
    const all = el('section', 'acc__sec');
    all.appendChild(el('h4', 'h3', '👥 Усі акаунти'));
    all.appendChild(el('p', 'hint', 'Роль і групу можна змінити будь-кому, крім зняття адмінки з самого себе.'));
    const allList = el('div', 'acc__olist');
    const roleSelect = (value) => {
      const s = document.createElement('select');
      for (const [v, t] of Object.entries(ROLE_LABEL)) { const o = el('option', null, t); o.value = v; s.appendChild(o); }
      s.value = value;
      return s;
    };
    const setRole = async (p, role, group) => {
      const { error } = await sb.rpc('admin_set_role', { p_user: p.id, p_role: role, p_group: group || null });
      if (error) { say(msg, 'Помилка: ' + error.message, true); return false; }
      say(msg, `${p.full_name || p.email}: ${ROLE_LABEL[role]}${role === 'starosta' ? ' ' + (group || p.group_name) : ''}`);
      if (p.id === auth.user.id) { await loadProfile(); await refreshAccess(); }
      draw();
      return true;
    };
    const draw = async () => {
      const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) return say(msg, 'Помилка: ' + error.message, true);
      pendList.textContent = '';
      allList.textContent = '';
      const pending = (data || []).filter((p) => p.role === 'pending');
      if (!pending.length) pendList.appendChild(el('div', 'hint', 'Нових заявок немає.'));
      for (const p of pending) {
        const r = el('div', 'acc__orow acc__orow--wrap');
        const info = el('div');
        info.append(el('strong', null, p.full_name || '—'), el('div', 'hint', `${p.email} · ${new Date(p.created_at).toLocaleDateString('uk-UA')}`));
        const grp = groupSelect(p.group_name);
        const ok = btn('Підтвердити', 'btn--accent btn--sm', () => busy(ok, async () => {
          if (!grp.value) return say(msg, 'Оберіть групу', true);
          await setRole(p, 'starosta', grp.value);
        }));
        const no = btn('Відхилити', 'btn--ghost btn--sm', () => busy(no, () => setRole(p, 'rejected')));
        r.append(info, grp, ok, no);
        pendList.appendChild(r);
      }
      for (const p of data || []) {
        const me = p.id === auth.user.id;
        const r = el('div', 'acc__orow acc__orow--wrap');
        const info = el('div');
        info.append(el('strong', null, (p.full_name || '—') + (me ? ' (ви)' : '')), el('div', 'hint', p.email));
        // власний рядок — просто підпис: себе не змінюємо
        if (me) {
          r.append(info, el('span', 'badge', ROLE_LABEL[p.role]));
          allList.appendChild(r);
          continue;
        }
        // роль і група зберігаються одразу при виборі — без окремої кнопки
        const role = roleSelect(p.role);
        const grp = groupSelect(p.group_name || '');
        grp.disabled = p.role === 'admin';
        const apply = async () => {
          if (role.value === 'starosta' && !grp.value) { grp.disabled = false; grp.focus(); return say(msg, 'Оберіть групу для старости', true); }
          if (role.value === 'admin' && p.role !== 'admin' && !confirm(`Дати ${p.full_name || p.email} повні права адміністратора?`)) { role.value = p.role; return; }
          role.disabled = grp.disabled = true;
          const ok = await setRole(p, role.value, role.value === 'admin' ? null : grp.value);
          if (!ok) { role.value = p.role; grp.value = p.group_name || ''; role.disabled = false; grp.disabled = p.role === 'admin'; }
        };
        role.addEventListener('change', apply);
        grp.addEventListener('change', apply);
        r.append(info, role, grp);
        {
          const delB = btn('Видалити', 'btn--ghost btn--sm', () => busy(delB, async () => {
            if (!confirm(`Повністю видалити акаунт ${p.email}? Відновити не можна.`)) return;
            const { error: e } = await sb.rpc('admin_delete_user', { p_user: p.id });
            if (e) return say(msg, 'Помилка: ' + e.message, true);
            say(msg, `Акаунт ${p.email} видалено`);
            draw();
          }));
          r.appendChild(delB);
        }
        allList.appendChild(r);
      }
    };
    pend.appendChild(pendList);
    all.appendChild(allList);
    box.append(msg, pend, all);
    draw();
  }

  /* ---------- Старт ---------- */
  async function main() {
    applySchedules(load('rz_schedules', { groups: [] }));   // миттєво — збережена копія, свіжа підтягнеться нижче
    setGroup(settings.group);
    renderBrand();
    $('collegeLink').href = C.links.college;
    $('subsLink').href = C.substitutions.page;

    initSettings();
    goHome();

    document.querySelectorAll('.sched .seg__btn').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; playSound('ui'); renderSchedule(); }));
    document.querySelectorAll('#ordersFilter .seg__btn').forEach((b) => b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('#ordersFilter .seg__btn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderOrders();
    }));
    $('prevWeek').addEventListener('click', () => shiftWeek(-1));
    $('nextWeek').addEventListener('click', () => shiftWeek(1));
    $('todayBtn').addEventListener('click', () => { goHome(); renderSchedule(); });
    $('reloadOrders').addEventListener('click', () => fetchOrders(true));
    $('openOriginal').addEventListener('click', openOriginal);
    $('orderNote').addEventListener('click', () => $('orders').scrollIntoView({ behavior: 'smooth' }));

    renderAll();
    pollAlert().then(() => { renderAlert(); renderHero(); });
    loadOrderArchive().then(() => fetchOrders(false));
    await Promise.all([loadSchedules(), initAuth()]);
    setGroup(settings.group);
    await refreshAccess();   // секретне посилання групи / акаунт старости → закріплена група й посилання на пари
    // прийшли за посиланням для старости — одразу форма реєстрації з вибраною групою
    if (regFromUrl && !auth.user && ALL_GROUPS.some((g) => g.name === regFromUrl)) openAccount('register', regFromUrl);
    // перший візит без посилання старости: хай людина вибере свою групу
    else if (!savedSettings.group && !lockedGroup) openGroupPicker();

    let lastMinute = -1;
    let lastAlertPoll = Date.now();
    let lastOrdersPoll = Date.now();
    startTicker(() => {
      if (Date.now() - lastAlertPoll > C.alerts.pollSec * 1000) { lastAlertPoll = Date.now(); pollAlert(); }
      if (Date.now() - lastOrdersPoll > C.substitutions.refreshMin * 60000) { lastOrdersPoll = Date.now(); fetchOrders(false); }
      checkEvents();
      if (document.hidden) return;
      renderClock();
      renderAlert();
      renderHero();
      const minute = Math.floor(nowWallMs() / 60000);
      if (minute !== lastMinute) { lastMinute = minute; renderSchedule(); renderOrderNote(); }
    }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); checkForUpdate(); } });
    setInterval(checkForUpdate, 5 * 60 * 1000);
  }

  /* ---------- Оновлення сайту ---------- */
  // Відкрита вкладка продовжує виконувати старий код, навіть коли на сервері вже нова версія.
  // Тому періодично дивимось версію в index.html і, якщо вона змінилась, перезавантажуємо сторінку.
  const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || '';
  async function checkForUpdate() {
    if (!APP_VERSION) return;
    try {
      const html = await (await fetch('index.html?check=' + Date.now(), { cache: 'no-store' })).text();
      const m = html.match(/name="app-version" content="([^"]+)"/);
      if (m && m[1] !== APP_VERSION) location.reload();
    } catch (e) { /* офлайн — перевіримо пізніше */ }
  }

  function shiftWeek(n) {
    const idx = (new Date(parseKey(state.selectedKey)).getUTCDay() + 6) % 7;
    state.viewMonday = addDays(state.viewMonday, 7 * n);
    state.selectedKey = addDays(state.viewMonday, Math.min(idx, 5));
    playSound('ui');
    renderSchedule();
  }

  main();
})();
