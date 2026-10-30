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
  const COURSE_ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
  const ALL_GROUPS = Object.entries(C.groups).flatMap(([course, list]) => list.map((name) => ({ name, course: Number(course) })));
  const courseOf = (name) => { const m = String(name).match(/(\d)\d\b/); return m ? Number(m[1]) : 4; };

  let G = null;   // поточна група
  function setGroup(name) {
    const g = ALL_GROUPS.find((x) => x.name === name) || { name, course: courseOf(name) };
    const sch = C.schedules[name] || null;
    G = {
      ...g,
      title: (sch && sch.title) || name,
      sch,
      // як група пишеться в розпорядженнях: «П42»; спільний розклад «А-31, А-30» → обидві
      codes: name.split(/[,;]/).map((s) => normGroup(s)).filter(Boolean),
      pdf: encodeURI(C.pdfBase + COURSE_ROMAN[g.course] + ' курс/' + (C.pdfFiles[name] || `Розклад ${name}.pdf`)),
    };
    settings.group = name;
    saveSettings();
  }
  const groupSubjects = () => (G.sch ? Object.values(G.sch.subjects) : []);

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
    return { name: t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Заняття', link: '' };
  }

  /* ---------- Пари на дату ---------- */
  function getLessons(key) {
    const plan = dayPlan(key);
    const out = new Map();
    if (plan && G.sch) {
      const day = (G.sch.schedule[plan.week] || {})[plan.day] || [];
      day.forEach((code, i) => {
        const s = code && G.sch.subjects[code];
        if (s) out.set(i + 1, { no: i + 1, subject: s.n, teacher: s.t, link: s.l });
      });
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
    tone.frequency.value = 3000;
    tone.Q.value = 0.5;
    // і зайвий низ, щоб звук був легким, а не гучним «бумом»
    const lowCut = actx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.value = 180;
    lowCut.Q.value = 0.5;
    // компенсація гучності після компресора
    const makeup = actx.createGain();
    makeup.gain.value = 1.6;
    comp.connect(tone);
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

  // м'яка нота: основний тон і ледь чутні обертони, верхні згасають швидше — легко, без дзвону й гулу
  const BELL_PARTIALS = [[1, 1], [2, 0.1], [3, 0.025]];
  function bell(dest, f, at, dur, vol, out, partials = BELL_PARTIALS) {
    const t0 = actx.currentTime + at + 0.02;
    partials.forEach(([ratio, amp], i) => {
      const d = dur / (1 + i * 0.55);
      const g = envGain(dest, t0, vol * amp, 0.012 + i * 0.002, d);   // м'яка атака без «удару»
      osc('sine', f * ratio, t0, t0 + d, out, (Math.random() - 0.5) * 6).connect(g);
    });
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

  // рівна нота з м'якими краями (для тривоги): трикутна хвиля через фільтр — чітко, але не різко
  function beep(dest, f, at, dur, vol, out) {
    const t0 = actx.currentTime + at + 0.02;
    const lp = actx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    lp.Q.value = 0.6;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.setValueAtTime(vol, t0 + dur - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    lp.connect(g);
    g.connect(dest);
    osc('triangle', f, t0, t0 + dur, out).connect(lp);
    osc('sine', f, t0, t0 + dur, out).connect(lp);
  }

  const SYNTH = {
    // тривога: коротке «ті-ту» тричі (~1,8 с) — помітно, але без виття сирени
    alert: (d) => {
      const out = [];
      for (let k = 0; k < 3; k++) {
        beep(d, N.E5, k * 0.6, 0.24, 0.22, out);
        beep(d, 493.88, k * 0.6 + 0.27, 0.24, 0.22, out);
      }
      return out;
    },
    // відбій: три легкі ноти вгору
    clear: (d) => {
      const out = [];
      [N.C5, N.E5, N.G5].forEach((f, i) => bell(d, f, i * 0.12, i === 2 ? 0.9 : 0.5, 0.2, out));
      return out;
    },
    // початок пари: дві ноти вгору
    start: (d) => {
      const out = [];
      bell(d, N.C5, 0, 0.5, 0.22, out);
      bell(d, N.G5, 0.14, 0.8, 0.2, out);
      return out;
    },
    // кінець пари: дві ноти вниз
    end: (d) => {
      const out = [];
      bell(d, N.G5, 0, 0.5, 0.2, out);
      bell(d, N.C5, 0.15, 0.8, 0.22, out);
      return out;
    },
    // скоро пара: подвійний легкий «дзинь»
    soon: (d) => {
      const out = [];
      bell(d, N.A5, 0, 0.35, 0.16, out);
      bell(d, N.A5, 0.18, 0.5, 0.14, out);
      return out;
    },
    // нова заміна: коротке «пім-пім» вгору
    sub: (d) => {
      const out = [];
      bell(d, N.D5, 0, 0.35, 0.18, out);
      bell(d, N.A5, 0.11, 0.55, 0.16, out);
      return out;
    },
    // інтерфейс: ледь чутний «тік»
    ui: (d) => {
      const out = [];
      click(d, 0, 0.25, 1500, out);
      bell(d, 1100, 0, 0.06, 0.05, out, [[1, 1]]);
      return out;
    },
  };

  const voices = {};   // id -> [oscillators], щоб зупинити повтор сирени
  async function playSound(id) {
    const c = ctx();
    if (!c) return;
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) { return; } }
    if (c.state !== 'running') return;
    if (mix.master.mute || mix[id].mute || !mix[id].vol || !mix.master.vol) return;
    stopSound(id);
    voices[id] = SYNTH[id](chGain[id]);
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

  function renderNoSchedule() {
    const box = $('noSchedule');
    box.hidden = !!G.sch;
    if (G.sch) return;
    box.textContent = '';
    box.appendChild(el('div', null, `Повного розкладу ${G.name} на сайті ще немає — тут видно лише заміни з розпоряджень коледжу.`));
    const a = el('a', 'btn btn--accent btn--sm', 'Офіційний розклад (PDF) ↗');
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
      const groups = q ? ALL_GROUPS.filter((g) => normGroup(g.name).includes(q)) : ALL_GROUPS.filter((g) => g.course === course);
      if (!groups.length) list.appendChild(el('div', 'empty empty--sm', 'Нічого не знайдено'));
      for (const g of groups) {
        const b = el('button', 'gp__item');
        b.type = 'button';
        b.appendChild(el('strong', null, (C.schedules[g.name] && C.schedules[g.name].title) || g.name));
        b.appendChild(el('span', null, C.schedules[g.name] ? '★ повний розклад' : 'PDF + заміни'));
        if (C.schedules[g.name]) b.classList.add('has-sch');
        if (g.name === G.name) b.classList.add('is-active');
        b.addEventListener('click', () => chooseGroup(g.name));
        list.appendChild(b);
      }
    };
    for (const c of Object.keys(C.groups)) {
      const b = el('button', 'seg__btn', `${c} курс`);
      b.type = 'button';
      b.dataset.c = c;
      b.addEventListener('click', () => { course = Number(c); search.value = ''; draw(); });
      seg.appendChild(b);
    }
    search.addEventListener('input', draw);
    box.append(seg, list);
    box.appendChild(el('p', 'hint gp__hint', '★ — розклад уже записаний на сайті. Для інших груп показуються заміни з розпоряджень і посилання на офіційний PDF.'));
    draw();
    openModal(box);
  }

  function chooseGroup(name) {
    setGroup(name);
    save('rz_seen_sig', changesSignature());
    closeModal();
    goHome();
    renderAll();
    renderBrand();
    playSound('ui');
    toast('Група: ' + G.title);
  }

  function renderBrand() {
    $('groupName').textContent = G.title;
    document.title = `${C.siteName} · ${G.title}`;
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

  /* ---------- Старт ---------- */
  function main() {
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
    if (!savedSettings.group) openGroupPicker();   // перший візит: хай людина вибере свою групу
    fetchOrders(false);
    pollAlert().then(() => { renderAlert(); renderHero(); });

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
    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderAll(); });
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
