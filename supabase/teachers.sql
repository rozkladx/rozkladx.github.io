-- =====================================================================
-- RozkladX: роль «викладач» і обмеження для адмінів
-- Виконати один раз після schema.sql: Supabase → SQL Editor → вставити весь файл → Run.
-- Повторний запуск безпечний.
--
-- Хто що може:
--   головний адмін (is_owner) — усе; ЄДИНИЙ, хто призначає/знімає/видаляє адмінів і викладачів
--                               і підтверджує заявки викладачів;
--   адмін і викладач          — однакові права: редагують усі групи (посилання на пари, правки,
--                               посилання для студентів), керують старостами й заявками старост;
--                               адмінів і викладачів НЕ можуть ні призначити, ні змінити, ні видалити;
--   староста                  — лише свою групу.
--
-- Як людина стає викладачем:
--   головний адмін копіює в кабінеті «Посилання для викладачів» (…/#teach=код) і надсилає його;
--   людина відкриває посилання й реєструється → з'являється заявка «викладач»;
--   головний адмін підтверджує її в «👥 Акаунти». Перехоплене посилання само по собі прав не дає.
--
-- ВАЖЛИВО: головний адмін має бути позначений (інакше адмінів і викладачів не зможе призначати ніхто):
--   update public.profiles set is_owner = true, role = 'admin', group_name = null where email = 'ваша@пошта';
-- =====================================================================

-- ---------- Нова роль ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'starosta', 'admin', 'teacher', 'rejected'));
alter table public.profiles add column if not exists is_owner boolean not null default false;
-- заявка, на яку роль людина претендує: null — староста (як раніше), 'teacher' — викладач
alter table public.profiles add column if not exists requested_role text check (requested_role in ('teacher'));

-- Права адміна мають і адміни, і викладачі. Усі правила доступу й функції з schema.sql
-- перевіряють is_admin(), тож достатньо розширити її — і викладач отримує ті самі права на групи.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'teacher') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false)
$$;

-- ---------- Зміна ролей ----------
create or replace function public.admin_set_role(p_user uuid, p_role text, p_group text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t public.profiles;
begin
  if not public.is_admin() then raise exception 'Лише адмін або викладач'; end if;
  if p_role not in ('pending', 'starosta', 'admin', 'teacher', 'rejected') then raise exception 'Невідома роль'; end if;
  select * into t from public.profiles where id = p_user;
  if t.id is null then raise exception 'Акаунт не знайдено'; end if;
  if t.is_owner then raise exception 'Головного адміна змінювати не можна'; end if;
  if not public.is_owner() then
    if p_role in ('admin', 'teacher') then raise exception 'Призначати адмінів і викладачів може лише головний адмін'; end if;
    if t.role in ('admin', 'teacher') then raise exception 'Змінювати адмінів і викладачів може лише головний адмін'; end if;
  end if;
  if p_role = 'starosta' and nullif(p_group, '') is null and t.group_name is null then
    raise exception 'Для старости потрібна група';
  end if;
  update public.profiles
     set role = p_role,
         group_name = case when p_role in ('admin', 'teacher') then null else coalesce(nullif(p_group, ''), group_name) end,
         approved_at = case when p_role in ('starosta', 'admin', 'teacher') then now() else approved_at end,
         requested_role = case when p_role = 'pending' then requested_role else null end
   where id = p_user;
end $$;

create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare t public.profiles;
begin
  if not public.is_admin() then raise exception 'Лише адмін або викладач'; end if;
  if p_user = auth.uid() then raise exception 'Не можна видалити власний акаунт'; end if;
  select * into t from public.profiles where id = p_user;
  if t.is_owner then raise exception 'Головного адміна видалити не можна'; end if;
  if t.role in ('admin', 'teacher') and not public.is_owner() then
    raise exception 'Видаляти адмінів і викладачів може лише головний адмін';
  end if;
  delete from auth.users where id = p_user;
end $$;

-- ---------- Запрошення для викладачів (одне на весь сайт, керує лише головний адмін) ----------
create table if not exists public.teacher_invite (
  id          int primary key default 1 check (id = 1),
  code        text not null,
  updated_at  timestamptz not null default now()
);
alter table public.teacher_invite enable row level security;
revoke all on public.teacher_invite from anon, authenticated;   -- код видають лише функції нижче

create or replace function public.admin_teacher_invite() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_owner() then raise exception 'Лише головний адмін'; end if;
  select code into c from public.teacher_invite where id = 1;
  if c is null then
    c := replace(gen_random_uuid()::text, '-', '');
    insert into public.teacher_invite (id, code) values (1, c);
  end if;
  return c;
end $$;

create or replace function public.admin_rotate_teacher_invite() returns text
language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_owner() then raise exception 'Лише головний адмін'; end if;
  insert into public.teacher_invite (id, code, updated_at) values (1, c, now())
  on conflict (id) do update set code = excluded.code, updated_at = now();
  return c;
end $$;

-- людина з посиланням: подати заявку «викладач» (лише нова реєстрація, що чекає розгляду).
-- Роль не змінюється — її дає головний адмін, підтвердивши заявку.
create or replace function public.claim_teacher(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Спершу увійдіть'; end if;
  if not exists (select 1 from public.teacher_invite where id = 1 and code = p_code) then return false; end if;
  perform public.ensure_profile();
  update public.profiles set requested_role = 'teacher', group_name = null
   where id = auth.uid() and role = 'pending';
  return exists (select 1 from public.profiles where id = auth.uid() and role = 'pending' and requested_role = 'teacher');
end $$;

-- прибрати залишки першої версії цього файлу (роль «лише перегляд»), якщо її встигли виконати
drop policy if exists "links: викладач читає" on public.lesson_links;
drop policy if exists "tokens: викладач читає" on public.group_tokens;
drop policy if exists "profiles: свій або адмін" on public.profiles;
create policy "profiles: свій або адмін" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop function if exists public.is_teacher();

-- ---------- Права ----------
grant execute on function public.is_admin(), public.is_owner() to anon, authenticated;
grant execute on function public.admin_set_role(uuid, text, text), public.admin_delete_user(uuid),
  public.claim_teacher(text), public.admin_teacher_invite(), public.admin_rotate_teacher_invite() to authenticated;
revoke execute on function public.admin_set_role(uuid, text, text), public.admin_delete_user(uuid),
  public.claim_teacher(text), public.admin_teacher_invite(), public.admin_rotate_teacher_invite() from anon, public;

-- одразу оновити список таблиць і функцій для сайту (інакше Supabase якийсь час пише «Could not find the function … in the schema cache»)
notify pgrst, 'reload schema';
