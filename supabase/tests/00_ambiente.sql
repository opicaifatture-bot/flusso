-- Ambiente minimo che imita Supabase (ruoli, auth, storage, cron, realtime) per
-- eseguire le migrazioni su un PostgreSQL locale. Il tipo "vector" è sostituito
-- da un segnaposto: i test non coprono la ricerca vettoriale.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema storage; create schema extensions; create schema cron;
grant usage on schema auth, storage, extensions, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true), '')::json->>'role' $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated; grant all on storage.objects to service_role;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create function cron.schedule(text, text, text) returns bigint language sql as $$ select 1::bigint $$;
create publication supabase_realtime;
create domain extensions.vector as text;
create function extensions.vdist(extensions.vector, extensions.vector) returns float8 language sql immutable as $$ select 0.4::float8 $$;
create operator extensions.<=> (leftarg = extensions.vector, rightarg = extensions.vector, function = extensions.vdist);
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- L'utente presente prima delle migrazioni diventa titolare, come in produzione.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'titolare@test.invalid');
