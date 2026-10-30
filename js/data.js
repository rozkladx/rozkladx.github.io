/* =========================================================
   НАЛАШТУВАННЯ, ГРУПИ ТА РОЗКЛАДИ
   Це єдиний файл, який треба редагувати: розклад, посилання
   на пари, нові групи, порядок робочих субот.
========================================================= */

window.SCHEDULE_CONFIG = {
  siteName: 'НаПару',
  college: 'КАІ ТЕХ',
  // група, яка відкривається за замовчуванням (поки людина не вибрала свою)
  defaultGroup: 'П-42',

  // понеділок, з якого починається I тиждень (тижні I/II далі чергуються)
  week1Monday: '2026-08-31',

  // розклад пар — у київському часі; на пристрої в іншому часовому поясі сайт перерахує сам
  timeZone: 'Europe/Kyiv',
  bells: [
    { start: '08:00', end: '09:35' },
    { start: '09:50', end: '11:25' },
    { start: '11:40', end: '13:15' },
    { start: '13:30', end: '15:05' },
    { start: '15:20', end: '16:55' },
  ],

  /* Робочі суботи йдуть по колу: ПН I → ВТ I → … → ПТ I → ПН II → … → ПТ II → знову ПН I.
     Досить однієї відомої суботи для кожного курсу — решту сайт рахує сам.
     Якщо в розпорядженні про заміни написано інакше — береться розпорядження. */
  saturdayAnchors: {
    1: { date: '2026-10-31', day: 'wednesday', week: 1 },
    2: { date: '2026-10-31', day: 'wednesday', week: 2 },
    3: { date: '2026-10-31', day: 'wednesday', week: 2 },
    4: { date: '2026-10-31', day: 'wednesday', week: 2 },
  },
  // ручні винятки для всіх: '2026-12-26': null — субота неробоча; або { day: 'monday', week: 1 }
  specialDays: {},

  /* Усі групи коледжу (як на сторінці «Розклад занять»).
     Для груп без записаного тут розкладу сайт показує офіційний PDF і заміни з розпоряджень. */
  pdfBase: 'https://ccte.nau.edu.ua/Розклад/2026-2027/1 семестр/',
  groups: {
    1: ['А-11', 'БОС-11', 'БОС-12', 'БП-11', 'Д-11', 'К-11', 'К-12', 'О-11', 'П-11', 'П-12', 'Р-11', 'Ф-ІТ-11', 'МЕП-11'],
    2: ['А-20', 'А-21', 'БОС-20', 'БОС-21', 'БП-20', 'БП-21', 'Д-20', 'Д-21', 'К-20', 'К-21', 'К-22', 'К-23', 'МЕП-20', 'МЕП-21', 'О-20', 'О-21', 'П-21', 'П-22', 'Р-20', 'Р-21', 'Ф-21', 'ФІТ-20', 'ФІТ-21'],
    3: ['А-31, А-30', 'БОС-31, БОС-30', 'БП-31, БП-30', 'Д-31, Д-30', 'Е-31, МЕП-30', 'К-31', 'К-32', 'К-33, К-30', 'О-31, О-30', 'П-31', 'П-32', 'Р-31, Р-30', 'Ф-31, Ф-30', 'ФІТ-31, ФІТ-30'],
    4: ['А-41', 'БП-41', 'Д-41', 'К-41', 'К-42', 'К-43', 'О-41, О-40', 'П-41', 'П-42', 'Р-41'],
  },
  // назви PDF, що відрізняються від «Розклад <група>.pdf»
  pdfFiles: {
    'Ф-ІТ-11': 'Розклад Ф-ІТ-11  МЕП-11.pdf',
    'МЕП-11': 'Розклад Ф-ІТ-11  МЕП-11.pdf',
    'ФІТ-20': 'Розклад Ф-ІТ-20.pdf',
    'ФІТ-21': 'Розклад Ф-ІТ-21.pdf',
    'А-31, А-30': 'Розклад А-31,  А-30.pdf',
  },

  /* Повні розклади груп.
     subjects: n — назва, t — викладач, l — посилання на онлайн-пару ('' = немає)
     schedule[тиждень][день] = [1 пара, 2 пара, 3, 4, 5]; null — пари немає */
  schedules: {
    'П-42': {
      title: 'П-782-42',
      subjects: {
        nac: { n: 'Основи національного спротиву', t: 'Масло В.М.', l: '' },
        fiz: { n: 'Фізичне виховання', t: 'Ціпоренко Я.І.', l: 'https://meet.google.com/jqc-kbdh-zht' },
        upr: { n: 'Основи управлінської та підприємницької діяльності', t: 'Карачун Л.Л.', l: 'https://meet.google.com/scq-juja-jof?authuser=0&hs=179' },
        arh: { n: 'Архітектура та проектування ПЗ', t: 'Висоцька О.І.', l: 'https://us04web.zoom.us/j/74242342298?pwd=dnM9aGhJAB69ZPpcV2CobUm27ObhCb.1' },
        kon: { n: 'Конструювання ПЗ', t: 'Круш О.Є.', l: 'https://discord.gg/' },
        emp: { n: 'Емпіричні методи програмної інженерії', t: 'Кравець С.М.', l: 'https://us04web.zoom.us/j/73546234078?pwd=KFR9jpmiTLHivmhKV4dGTwnfos6Ea4.1' },
        oh:  { n: 'Охорона праці', t: 'Бєлая В.В.', l: 'https://us04web.zoom.us/j/8604144124?pwd=NeVvcz73KPV3mT1AccDZ3IPFqZP8ab.1' },
        dis: { n: 'Числові методи', t: 'Чуйков А.С.', l: 'https://meet.google.com/gwy-gjon-jyd?authuser=0&hs=179' },
      },
      schedule: {
        1: {
          monday:    [null, 'nac', 'fiz', 'upr', 'arh'],
          tuesday:   [null, 'kon', 'arh', 'emp', 'oh'],
          wednesday: [null, null, 'upr', 'oh', 'nac'],
          thursday:  ['kon', 'arh', 'dis', null, null],
          friday:    ['emp', 'emp', 'dis', null, null],
        },
        2: {
          monday:    [null, 'nac', 'fiz', 'upr', 'arh'],
          tuesday:   [null, 'kon', 'arh', 'emp', 'arh'],
          wednesday: [null, null, 'upr', 'oh', 'nac'],
          thursday:  ['dis', 'arh', 'dis', 'nac', null],
          friday:    ['emp', 'upr', 'dis', null, null],
        },
      },
    },

    'П-21': {
      subjects: {
        mat: { n: 'Математика', t: 'Савіна Л.П.', l: 'https://us04web.zoom.us/j/4424345889?pwd=yPqeiASgYJmdadhgqgEBbkVmhS4b2i.1&omn=79018831484' },
        ist: { n: 'Історія України', t: 'Бардишев М.М.', l: 'https://meet.google.com/ymz-mjtt-duq' },
        ifk: { n: 'Історія України (факультатив)', t: 'Бардишев М.М.', l: 'https://meet.google.com/fhn-empk-wuu' },
        pra: { n: 'Правознавство', t: 'Якобчук О.М.', l: 'https://meet.google.com/crp-stbg-sxa' },
        ukm: { n: 'Українська мова', t: 'Гусак І.В.', l: 'https://meet.google.com/uha-xsnj-rjw' },
        ukl: { n: 'Українська література', t: 'Гусак І.В.', l: 'https://meet.google.com/egu-ruxm-prk' },
        eko: { n: 'Економічна теорія', t: 'Базильчук Т.Г.', l: 'https://meet.google.com/zsf-ymkv-bkh' },
        lag: { n: 'Лінійна алгебра та аналітична геометрія', t: 'Савіна Л.П.', l: 'https://us04web.zoom.us/j/4424345889?pwd=yPqeiASgYJmdadhgqgEBbkVmhS4b2i.1&omn=79018831484' },
        ekl: { n: 'Екологія', t: 'Портна М.Г.', l: 'https://us04web.zoom.us/j/7930619599?pwd=WWhUUGVwS0RkK08yUjRFY0kxU1JHdz09' },
        man: { n: 'Математичний аналіз', t: 'Чуйков А.С.', l: 'https://meet.google.com/ewb-wxmt-vfr' },
        opr: { n: 'Основи програмування', t: 'Майдан А.В.', l: 'https://us04web.zoom.us/j/9725123788?pwd=R001Z3BpcFNhZ0tKL2xvNHJSWFdoQT09&omn=77180326621' },
        fiz: { n: 'Фізика (вибрані розділи)', t: 'Ганненко Л.В.', l: 'https://us05web.zoom.us/j/6185246444?pwd=Zy9zYXBNZU1JSEE4UGY3b0FxSnVlZz09' },
        mlo: { n: 'Математична логіка', t: 'Чуйков А.С.', l: 'https://meet.google.com/ncm-rtnn-eiw' },
        inm: { n: 'Іноземна мова', t: 'Крещанова С.Л., Чепур О.О.', l: '' },
        fkl: { n: 'Фізична культура', t: 'Ціпоренко Я.І.', l: 'https://meet.google.com/awz-sprz-gbi' },
      },
      schedule: {
        1: {
          monday:    [null, 'mat', 'ist', 'pra', 'ukm'],
          tuesday:   [null, 'eko', 'lag', 'ifk', null],
          wednesday: [null, 'lag', 'ekl', 'man', null],
          thursday:  [null, 'opr', 'fiz', 'mlo', 'ukl'],
          friday:    [null, 'inm', 'fkl', 'opr', null],
        },
        2: {
          monday:    [null, 'mat', 'ist', 'pra', 'ukm'],
          tuesday:   [null, 'eko', 'lag', 'ifk', null],
          wednesday: [null, 'lag', 'ekl', 'man', null],
          thursday:  [null, 'opr', 'fiz', 'mlo', 'ukl'],
          friday:    [null, 'inm', 'fkl', 'opr', null],
        },
      },
    },
  },

  // Заміни: файл «Заміни.xlsx» з Google Drive коледжу (сайт читає його як таблицю через Google)
  substitutions: {
    driveFileId: '1WfqBmM996nKjzw6655q1ulLFlqXXR61m',
    page: 'https://sites.google.com/kfccte-nau.ukr.education/students-information',
    refreshMin: 10,
  },

  alerts: {
    // публічне API повітряних тривог по областях (без ключа)
    url: 'https://ubilling.net.ua/aerialalerts/',
    region: 'м. Київ',
    pollSec: 30,
  },

  links: {
    college: 'https://ccte.nau.edu.ua/',
    schedule: 'https://ccte.nau.edu.ua/Розклад%20занять.html',
  },
};
