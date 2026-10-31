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
  },

  /* Акаунти старост і посилання на пари — у Supabase (див. supabase/schema.sql).
     Посилання на пари більше НЕ зберігаються в цьому файлі: їх вносить староста,
     а студенти бачать лише за секретним посиланням своєї групи.
     anonKey — публічний ключ (так задумано Supabase), доступ обмежують правила в базі. */
  supabase: {
    url: 'https://tfhpyqgopvapnnwppksm.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmaHB5cWdvcHZhcG5ud3Bwa3NtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0NDgyMjUsImV4cCI6MjEwOTAyNDIyNX0.-L5upy-9-y1kfvfoiLSBpGC7j1xyWAPsIaD-6rMiPfc',
  },
};
