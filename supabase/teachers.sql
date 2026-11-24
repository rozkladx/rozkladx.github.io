-- =====================================================================
-- RozkladX: роль «викладач» — бачить усе, що й адмін, але нічого не змінює
-- Виконати один раз після schema.sql: Supabase → SQL Editor → вставити весь файл → Run.
-- Повторний запуск безпечний.
--
-- Як людина стає викладачем:
--   адмін копіює в кабінеті «Посилання для викладачів» (…/#teach=код) і надсилає його;
--   людина відкриває посилання, реєструється або входить — і одразу отримує роль teacher.
-- «Нове посилання» в кабінеті адміна робить старе недійсним (ті, хто вже став викладачем, лишаються).
-- Забрати доступ — у «👥 Акаунти» змінити роль або видалити акаунт.
--
-- Що бачить викладач (лише читання — це забезпечують правила бази, не лише сайт):
--   посилання на пари всіх груп, секретні посилання груп для студентів, правки розкладу, список акаунтів.
-- =====================================================================

-- ---------- Нова роль ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('pending', 'starosta', 'admin', 'teacher', 'rejected'));

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'teacher' from public.profiles where id = auth.uid()), false)
$$;

-- ---------- Читання для викладача (лише select — змінювати нічого не може) ----------
drop policy if exists "profiles: свій або адмін" on public.profiles;
create policy "profiles: свій або адмін" on public.profiles
  for select using (id = auth.uid() or public.is_admin() or public.is_teacher());

drop policy if exists "links: викладач читає" on public.lesson_links;
create policy "links: викладач читає" on public.lesson_links
  for select using (public.is_teacher());

drop policy if exists "tokens: викладач читає" on public.group_tokens;
create policy "tokens: викладач читає" on public.group_tokens
  for select using (public.is_teacher());

-- ---------- Запрошення для викладачів (одне на весь сайт) ----------
create table if not exists public.teacher_invite (
  id          int primary key default 1 check (id = 1),
  code        text not null,
  updated_at  timestamptz not null default now()
);
alter table public.teacher_invite enable row level security;
-- напряму таблицю не читає ніхто: код видає лише функція нижче, і лише адміну
revoke all on public.teacher_invite from anon, authenticated;

-- адмін: поточний код запрошення (створює, якщо ще немає)
create or replace function public.admin_teacher_invite() returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_admin() then raise exception 'Лише адмін'; end if;
  select code into c from public.teacher_invite where id = 1;
  if c is null then
    c := replace(gen_random_uuid()::text, '-', '');
    insert into public.teacher_invite (id, code) values (1, c);
  end if;
  return c;
end $$;

-- адмін: новий код — старе посилання перестає працювати
create or replace function public.admin_rotate_teacher_invite() returns text
language plpgsql security definer set search_path = public as $$
declare c text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_admin() then raise exception 'Лише адмін'; end if;
  insert into public.teacher_invite (id, code, updated_at) values (1, c, now())
  on conflict (id) do update set code = excluded.code, updated_at = now();
  return c;
end $$;

-- людина з посиланням: стати викладачем. Лише з ролі «pending» (нова реєстрація):
-- адмін і староста свою роль не втрачають, а відхилені адміном доступ не отримують.
create or replace function public.claim_teacher(p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Спершу увійдіть'; end if;
  if not exists (select 1 from public.teacher_invite where id = 1 and code = p_code) then return false; end if;
  perform public.ensure_profile();
  update public.profiles
     set role = 'teacher', group_name = null, approved_at = now()
   where id = auth.uid() and role = 'pending';
  return exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
end $$;

-- ---------- Адмін може призначати й знімати роль викладача вручну ----------
create or replace function public.admin_set_role(p_user uuid, p_role text, p_group text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Лише адмін'; end if;
  if p_role not in ('pending', 'starosta', 'admin', 'teacher', 'rejected') then raise exception 'Невідома роль'; end if;
  if (select is_owner from public.profiles where id = p_user) then raise exception 'Головного адміна змінювати не можна'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'Не можна зняти роль адміна з самого себе'; end if;
  if p_role = 'starosta' and nullif(p_group, '') is null
     and (select group_name from public.profiles where id = p_user) is null then
    raise exception 'Для старости потрібна група';
  end if;
  update public.profiles
     set role = p_role,
         group_name = case when p_role in ('admin', 'teacher') then null else coalesce(nullif(p_group, ''), group_name) end,
         approved_at = case when p_role in ('starosta', 'admin', 'teacher') then now() else approved_at end
   where id = p_user;
end $$;

-- ---------- Права ----------
grant execute on function public.is_teacher() to anon, authenticated;
grant execute on function public.claim_teacher(text), public.admin_teacher_invite(), public.admin_rotate_teacher_invite() to authenticated;
revoke execute on function public.claim_teacher(text), public.admin_teacher_invite(), public.admin_rotate_teacher_invite() from anon, public;
