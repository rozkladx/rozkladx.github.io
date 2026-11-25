-- =====================================================================
-- RozkladX: розклади груп і архів розпоряджень у базі (з історією)
-- Виконати один раз після schema.sql: Supabase → SQL Editor → вставити весь файл → Run.
-- Повторний запуск безпечний.
--
-- Пише сюди лише робот GitHub Actions (tools/build-data.mjs) ключем service_role
-- (секрет SUPABASE_SERVICE_ROLE_KEY у репозиторії) — цей ключ обходить правила доступу.
-- Відвідувачі сайту лише читають.
--
--   schedule_groups   — список груп з сайту коледжу й стан останньої перевірки PDF
--   schedule_versions — КОЖНА нова версія розкладу групи (старі не видаляються → історія змін)
--   schedule_current  — поточний розклад кожної групи (остання версія), його читає сайт
--   order_archive     — усі розпорядження про заміни без обмеження кількості
-- =====================================================================

-- ---------- Групи ----------
create table if not exists public.schedule_groups (
  group_name  text primary key,
  course      int  not null,
  pdf         text not null default '',
  sort        int  not null default 0,              -- порядок, як на сайті коледжу
  error       text,                                  -- помилка останнього читання PDF (null — усе добре)
  active      boolean not null default true,         -- false — групи вже немає на сайті коледжу (історія лишається)
  checked_at  timestamptz not null default now()
);
alter table public.schedule_groups add column if not exists active boolean not null default true;

-- ---------- Версії розкладів ----------
create table if not exists public.schedule_versions (
  id          bigint generated always as identity primary key,
  group_name  text not null references public.schedule_groups(group_name) on delete cascade,
  title       text not null default '',
  schedule    jsonb not null,                        -- {"1": {"monday": [{n, t} | null, ...], ...}, "2": {...}}
  hash        text not null,                         -- щоб не записувати ту саму версію двічі поспіль
  fetched_at  timestamptz not null default now()
);
create index if not exists schedule_versions_group_time on public.schedule_versions (group_name, fetched_at desc);

-- ---------- Поточний розклад (остання версія кожної групи) ----------
create or replace view public.schedule_current with (security_invoker = true) as
select g.group_name as name, g.course, g.pdf, g.sort, g.error, g.checked_at,
       v.title, v.schedule, v.hash, v.fetched_at
from public.schedule_groups g
left join lateral (
  select title, schedule, hash, fetched_at
  from public.schedule_versions sv
  where sv.group_name = g.group_name
  order by fetched_at desc, id desc
  limit 1
) v on true
where g.active;

-- ---------- Архів розпоряджень ----------
create table if not exists public.order_archive (
  key            text primary key,                   -- «номер|дата», як у data/orders.json
  csv            text not null,                      -- сирий CSV з «Заміни.xlsx»
  fetched_at     timestamptz not null default now(), -- коли востаннє змінювався
  first_seen_at  timestamptz not null default now()
);
create index if not exists order_archive_time on public.order_archive (fetched_at desc);

-- ---------- Доступ: читають усі, пише лише service_role ----------
alter table public.schedule_groups   enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.order_archive     enable row level security;

drop policy if exists "groups: читають усі" on public.schedule_groups;
create policy "groups: читають усі" on public.schedule_groups for select using (true);
drop policy if exists "versions: читають усі" on public.schedule_versions;
create policy "versions: читають усі" on public.schedule_versions for select using (true);
drop policy if exists "orders: читають усі" on public.order_archive;
create policy "orders: читають усі" on public.order_archive for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.schedule_groups, public.schedule_versions, public.order_archive, public.schedule_current to anon, authenticated;

-- ---------- Корисні запити ----------
-- Історія змін розкладу групи:
--   select fetched_at, hash from schedule_versions where group_name = 'П-42' order by fetched_at desc;
-- Скільки розпоряджень в архіві:
--   select count(*), min(first_seen_at) from order_archive;

-- одразу оновити список таблиць і функцій для сайту (інакше Supabase якийсь час пише «Could not find the function … in the schema cache»)
notify pgrst, 'reload schema';
