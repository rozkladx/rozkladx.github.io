-- =====================================================================
-- RozkladX: акаунти старост, посилання на пари, правки розкладу
-- Виконати один раз: Supabase → SQL Editor → вставити весь файл → Run.
-- Повторний запуск безпечний.
--
-- Ролі:
--   pending  — зареєструвався, чекає підтвердження адміна
--   starosta — підтверджений староста СВОЄЇ групи (редагує лише її)
--   admin    — власник сайту: підтверджує старост
-- Студенти акаунтів не мають: посилання на пари бачать лише за
-- секретним посиланням групи, яке роздає староста.
-- =====================================================================

-- ---------- Профілі ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null default '',
  group_name  text not null,                     -- група, яку людина вказала при реєстрації
  role        text not null default 'pending' check (role in ('pending', 'starosta', 'admin', 'rejected')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- профіль створюється автоматично при реєстрації (група й ПІБ — з форми реєстрації)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, group_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data->>'group_name', ''), '?')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- допоміжні функції для правил доступу
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_group() returns text
language sql stable security definer set search_path = public as $$
  select group_name from public.profiles where id = auth.uid() and role = 'starosta'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

alter table public.profiles enable row level security;
drop policy if exists "profiles: свій або адмін" on public.profiles;
create policy "profiles: свій або адмін" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
-- змінювати роль і групу може лише адмін (через функції нижче); напряму — ніхто
drop policy if exists "profiles: адмін змінює" on public.profiles;
create policy "profiles: адмін змінює" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- Посилання на пари (приватні) ----------
-- teacher_key: «Прізвище» або «Прізвище|Початок назви предмета»
create table if not exists public.lesson_links (
  group_name  text not null,
  teacher_key text not null,
  url         text not null check (url ~ '^https?://'),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (group_name, teacher_key)
);
alter table public.lesson_links enable row level security;
drop policy if exists "links: староста своєї групи" on public.lesson_links;
create policy "links: староста своєї групи" on public.lesson_links
  for all using (group_name = public.my_group() or public.is_admin())
  with check (group_name = public.my_group() or public.is_admin());

-- ---------- Правки розкладу (публічні: розклад бачать усі, без посилань) ----------
create table if not exists public.schedule_overrides (
  group_name  text not null,
  week        int  not null check (week in (1, 2)),
  day         text not null check (day in ('monday','tuesday','wednesday','thursday','friday')),
  pair        int  not null check (pair between 1 and 8),
  subject     text not null default '',           -- порожньо + removed = пари немає
  teacher     text not null default '',
  removed     boolean not null default false,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (group_name, week, day, pair)
);
alter table public.schedule_overrides enable row level security;
drop policy if exists "overrides: читають усі" on public.schedule_overrides;
create policy "overrides: читають усі" on public.schedule_overrides for select using (true);
drop policy if exists "overrides: пише староста своєї групи" on public.schedule_overrides;
create policy "overrides: пише староста своєї групи" on public.schedule_overrides
  for insert with check (group_name = public.my_group() or public.is_admin());
drop policy if exists "overrides: змінює староста своєї групи" on public.schedule_overrides;
create policy "overrides: змінює староста своєї групи" on public.schedule_overrides
  for update using (group_name = public.my_group() or public.is_admin())
  with check (group_name = public.my_group() or public.is_admin());
drop policy if exists "overrides: видаляє староста своєї групи" on public.schedule_overrides;
create policy "overrides: видаляє староста своєї групи" on public.schedule_overrides
  for delete using (group_name = public.my_group() or public.is_admin());

-- ---------- Секретні посилання груп ----------
create table if not exists public.group_tokens (
  group_name text primary key,
  token      text not null unique,
  updated_at timestamptz not null default now()
);
alter table public.group_tokens enable row level security;
drop policy if exists "tokens: староста бачить свій" on public.group_tokens;
create policy "tokens: староста бачить свій" on public.group_tokens
  for select using (group_name = public.my_group() or public.is_admin());

-- староста отримує (або створює) секретний код своєї групи
create or replace function public.my_group_token() returns text
language plpgsql security definer set search_path = public as $$
declare g text := public.my_group(); t text;
begin
  if g is null then raise exception 'Лише підтверджений староста'; end if;
  select token into t from public.group_tokens where group_name = g;
  if t is null then
    t := replace(gen_random_uuid()::text, '-', '');
    insert into public.group_tokens (group_name, token) values (g, t);
  end if;
  return t;
end $$;

-- нове секретне посилання: старе перестає працювати
create or replace function public.rotate_group_token() returns text
language plpgsql security definer set search_path = public as $$
declare g text := public.my_group(); t text := replace(gen_random_uuid()::text, '-', '');
begin
  if g is null then raise exception 'Лише підтверджений староста'; end if;
  insert into public.group_tokens (group_name, token, updated_at) values (g, t, now())
  on conflict (group_name) do update set token = excluded.token, updated_at = now();
  return t;
end $$;

-- студент за секретним кодом отримує свою групу й посилання на пари (без акаунта)
create or replace function public.group_by_token(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare g text;
begin
  select group_name into g from public.group_tokens where token = p_token;
  if g is null then return null; end if;
  return json_build_object(
    'group_name', g,
    'links', coalesce((select json_object_agg(teacher_key, url) from public.lesson_links where group_name = g), '{}'::json)
  );
end $$;

-- ---------- Секретне посилання будь-якої групи: староста — своєї, адмін — будь-якої ----------
create or replace function public.get_group_token(p_group text default null) returns text
language plpgsql security definer set search_path = public as $$
declare g text := coalesce(nullif(p_group, ''), public.my_group()); t text;
begin
  if g is null or not (public.is_admin() or g = public.my_group()) then raise exception 'Немає доступу до цієї групи'; end if;
  select token into t from public.group_tokens where group_name = g;
  if t is null then
    t := replace(gen_random_uuid()::text, '-', '');
    insert into public.group_tokens (group_name, token) values (g, t);
  end if;
  return t;
end $$;

create or replace function public.rotate_group_token_for(p_group text default null) returns text
language plpgsql security definer set search_path = public as $$
declare g text := coalesce(nullif(p_group, ''), public.my_group()); t text := replace(gen_random_uuid()::text, '-', '');
begin
  if g is null or not (public.is_admin() or g = public.my_group()) then raise exception 'Немає доступу до цієї групи'; end if;
  insert into public.group_tokens (group_name, token, updated_at) values (g, t, now())
  on conflict (group_name) do update set token = excluded.token, updated_at = now();
  return t;
end $$;

-- ---------- Адмін: керування акаунтами без обмежень ----------
-- адмін не прив'язаний до групи
alter table public.profiles alter column group_name drop not null;
update public.profiles set group_name = null where role = 'admin';

drop function if exists public.admin_set_role(uuid, text, text);
create or replace function public.admin_set_role(p_user uuid, p_role text, p_group text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Лише адмін'; end if;
  if p_role not in ('pending', 'starosta', 'admin', 'rejected') then raise exception 'Невідома роль'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'Не можна зняти роль адміна з самого себе'; end if;
  if p_role = 'starosta' and nullif(p_group, '') is null
     and (select group_name from public.profiles where id = p_user) is null then
    raise exception 'Для старости потрібна група';
  end if;
  update public.profiles
     set role = p_role,
         group_name = case when p_role = 'admin' then null else coalesce(nullif(p_group, ''), group_name) end,
         approved_at = case when p_role in ('starosta', 'admin') then now() else approved_at end
   where id = p_user;
end $$;

-- видалити акаунт повністю (окрім власного)
create or replace function public.admin_delete_user(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Лише адмін'; end if;
  if p_user = auth.uid() then raise exception 'Не можна видалити власний акаунт'; end if;
  delete from auth.users where id = p_user;
end $$;

-- якщо профілю немає (акаунт створено раніше за тригер) — створити з даних реєстрації
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.profiles (id, email, full_name, group_name)
  select u.id, u.email,
         coalesce(u.raw_user_meta_data->>'full_name', ''),
         coalesce(nullif(u.raw_user_meta_data->>'group_name', ''), '?')
    from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
end $$;

-- права на таблиці (у нових проєктах Supabase їх не завжди видає автоматично); доступ далі обмежує RLS
grant usage on schema public to anon, authenticated;
grant select on public.schedule_overrides to anon;
grant select, insert, update, delete on public.profiles, public.lesson_links, public.schedule_overrides, public.group_tokens to authenticated;

-- права для ролей Supabase
grant execute on function public.ensure_profile() to authenticated;
grant execute on function public.my_role(), public.my_group(), public.is_admin() to anon, authenticated;
grant execute on function public.group_by_token(text) to anon, authenticated;
grant execute on function public.my_group_token(), public.rotate_group_token(), public.admin_set_role(uuid, text, text),
  public.get_group_token(text), public.rotate_group_token_for(text), public.admin_delete_user(uuid) to authenticated;
revoke execute on function public.my_group_token(), public.rotate_group_token(), public.admin_set_role(uuid, text, text),
  public.get_group_token(text), public.rotate_group_token_for(text), public.admin_delete_user(uuid) from anon, public;

-- =====================================================================
-- ПІСЛЯ того, як ви самі зареєструєтесь на сайті, зробіть себе адміном
-- (замініть пошту на свою і виконайте лише цей рядок):
--   update public.profiles set role = 'admin' where email = 'ваша@пошта';
-- =====================================================================
