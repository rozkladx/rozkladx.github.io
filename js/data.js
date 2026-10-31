/* =========================================================
   НАЛАШТУВАННЯ САЙТУ
   Розклади всіх груп сайт бере сам: GitHub Actions щодня читає PDF
   на сайті коледжу й зберігає їх у data/schedules.json.
   Тут — лише те, чого в PDF немає: посилання на онлайн-пари,
   порядок робочих субот, дзвінки.
========================================================= */

window.SCHEDULE_CONFIG = {
  siteName: 'RozkladX',
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

    /* Посилання на онлайн-пари (у PDF коледжу їх немає).
       lessons[група] = { 'Прізвище': посилання } — для всіх пар цього викладача в групі,
       або 'Прізвище|Початок назви предмета' — якщо в одного викладача різні посилання на різні предмети.
       Назва групи — як у списку на сайті: 'П-42', 'К-33, К-30'… */
    lessons: {
      'П-42': {
        'Ціпоренко': 'https://meet.google.com/jqc-kbdh-zht',
        'Карачун': 'https://meet.google.com/scq-juja-jof?authuser=0&hs=179',
        'Висоцька': 'https://us04web.zoom.us/j/74242342298?pwd=dnM9aGhJAB69ZPpcV2CobUm27ObhCb.1',
        'Круш': 'https://discord.gg/',
        'Кравець': 'https://us04web.zoom.us/j/73546234078?pwd=KFR9jpmiTLHivmhKV4dGTwnfos6Ea4.1',
        'Бєлая': 'https://us04web.zoom.us/j/8604144124?pwd=NeVvcz73KPV3mT1AccDZ3IPFqZP8ab.1',
      },
      'П-21': {
        'Савіна': 'https://us04web.zoom.us/j/4424345889?pwd=yPqeiASgYJmdadhgqgEBbkVmhS4b2i.1&omn=79018831484',
        'Бардишев': 'https://meet.google.com/ymz-mjtt-duq',
        'Бардишев|Історія України (факультатив)': 'https://meet.google.com/fhn-empk-wuu',
        'Якобчук': 'https://meet.google.com/crp-stbg-sxa',
        'Гусак': 'https://meet.google.com/uha-xsnj-rjw',
        'Гусак|Українська література': 'https://meet.google.com/egu-ruxm-prk',
        'Базильчук': 'https://meet.google.com/zsf-ymkv-bkh',
        'Портна': 'https://us04web.zoom.us/j/7930619599?pwd=WWhUUGVwS0RkK08yUjRFY0kxU1JHdz09',
        'Чуйков': 'https://meet.google.com/ncm-rtnn-eiw',
        'Чуйков|Математичний аналіз': 'https://meet.google.com/ewb-wxmt-vfr',
        'Майдан': 'https://us04web.zoom.us/j/9725123788?pwd=R001Z3BpcFNhZ0tKL2xvNHJSWFdoQT09&omn=77180326621',
        'Ганненко': 'https://us05web.zoom.us/j/6185246444?pwd=Zy9zYXBNZU1JSEE4UGY3b0FxSnVlZz09',
        'Ціпоренко': 'https://meet.google.com/awz-sprz-gbi',
      },
    },
  },
};
