-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 1 — Multi-sede, ruoli, RLS rigorosa, audit trail con catena di hash
-- ═══════════════════════════════════════════════════════════════════════════
-- Modello: gruppo → ristoranti (sedi). Catalogo e fornitori sono del gruppo,
-- documenti e prezzi sono della singola sede. Nessuna scrittura diretta dal
-- client: tutte le modifiche passano da RPC con controllo del ruolo.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- La vecchia RPC non conosce le sedi: viene sostituita in Fase 3.
drop function if exists public.registra_documento(jsonb, text, numeric);
drop view if exists public.v_anomalie;

-- ── Struttura organizzativa ────────────────────────────────────────────────
create type public.ruolo_membro as enum ('titolare', 'chef', 'contabile', 'sola_lettura');

create table public.gruppi (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  valuta_report text not null default 'EUR',
  soglia_abbinamento_auto numeric(4,3) not null default 0.850
    check (soglia_abbinamento_auto between 0 and 1),
  soglia_abbinamento_proposta numeric(4,3) not null default 0.500
    check (soglia_abbinamento_proposta between 0 and 1),
  creato_il timestamptz not null default now()
);

create table public.ristoranti (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references public.gruppi(id) on delete restrict,
  nome text not null,
  paese text,
  valuta text not null default 'EUR',
  partita_iva text,
  soglia_anomalia_pct numeric(5,2) not null default 5 check (soglia_anomalia_pct > 0),
  creato_il timestamptz not null default now()
);
create index on public.ristoranti (gruppo_id);

create table public.membri_gruppo (
  gruppo_id uuid not null references public.gruppi(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ruolo public.ruolo_membro not null,
  creato_il timestamptz not null default now(),
  primary key (gruppo_id, user_id)
);
create index on public.membri_gruppo (user_id);

create table public.membri_ristorante (
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ruolo public.ruolo_membro not null,
  creato_il timestamptz not null default now(),
  primary key (ristorante_id, user_id)
);
create index on public.membri_ristorante (user_id);

-- ── Dati esistenti: gruppo e sede iniziali, utenti attuali come titolari ───
do $$
declare v_g uuid; v_r uuid;
begin
  insert into public.gruppi (nome) values ('Gruppo principale') returning id into v_g;
  insert into public.ristoranti (gruppo_id, nome) values (v_g, 'Sede principale') returning id into v_r;
  insert into public.membri_gruppo (gruppo_id, user_id, ruolo)
    select v_g, u.id, 'titolare' from auth.users u;
  insert into public.membri_ristorante (ristorante_id, user_id, ruolo)
    select v_r, u.id, 'titolare' from auth.users u;

  alter table public.fornitori add column gruppo_id uuid references public.gruppi(id) on delete restrict;
  alter table public.articoli add column gruppo_id uuid references public.gruppi(id) on delete restrict;
  alter table public.documenti add column ristorante_id uuid references public.ristoranti(id) on delete restrict;
  alter table public.storico_prezzi add column ristorante_id uuid references public.ristoranti(id) on delete restrict;
  execute format('update public.fornitori set gruppo_id = %L', v_g);
  execute format('update public.articoli set gruppo_id = %L', v_g);
  execute format('update public.documenti set ristorante_id = %L', v_r);
  execute format('update public.storico_prezzi set ristorante_id = %L', v_r);
end $$;

alter table public.fornitori alter column gruppo_id set not null;
alter table public.articoli alter column gruppo_id set not null;
alter table public.documenti alter column ristorante_id set not null;
alter table public.storico_prezzi alter column ristorante_id set not null;

-- Il fornitore è unico nel gruppo (stessa P.IVA = stesso fornitore per tutte le sedi)
alter table public.fornitori drop constraint fornitori_chiave_key;
alter table public.fornitori add constraint fornitori_gruppo_chiave_key unique (gruppo_id, chiave);

create table public.fornitori_ristorante (
  fornitore_id uuid not null references public.fornitori(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  attivo boolean not null default true,
  note text,
  primo_documento_il date,
  ultimo_documento_il date,
  creato_il timestamptz not null default now(),
  primary key (fornitore_id, ristorante_id)
);
create index on public.fornitori_ristorante (ristorante_id);

insert into public.fornitori_ristorante (fornitore_id, ristorante_id, primo_documento_il, ultimo_documento_il)
select d.fornitore_id, d.ristorante_id, min(d.data_documento), max(d.data_documento)
from public.documenti d group by 1, 2;

-- Percorso del file dentro il bucket (senza il prefisso del bucket)
alter table public.documenti rename column file_url to file_path;
update public.documenti set file_path = regexp_replace(file_path, '^documenti/', '') where file_path is not null;

create index on public.documenti (ristorante_id, created_at desc);
create index on public.storico_prezzi (ristorante_id);
create index on public.articoli (gruppo_id);

-- ── Funzioni di accesso (security definer, stable, search_path fisso) ──────
create or replace function app.uuid_sicuro(p text) returns uuid
language sql immutable set search_path = '' as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

-- Ruolo effettivo sulla sede: quello di sede, altrimenti quello di gruppo.
create or replace function app.ruolo_ristorante(p_ristorante_id uuid) returns public.ruolo_membro
language sql stable security definer set search_path = '' as $$
  select x.ruolo from (
    select mr.ruolo, 1 as ordine from public.membri_ristorante mr
     where mr.ristorante_id = p_ristorante_id and mr.user_id = (select auth.uid())
    union all
    select mg.ruolo, 2 from public.membri_gruppo mg
      join public.ristoranti r on r.gruppo_id = mg.gruppo_id
     where r.id = p_ristorante_id and mg.user_id = (select auth.uid())
  ) x order by x.ordine limit 1
$$;

create or replace function app.ha_accesso_ristorante(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.ruolo_ristorante(p_ristorante_id) is not null
$$;

create or replace function app.ha_ruolo(p_ristorante_id uuid, p_ruoli public.ruolo_membro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.ruolo_ristorante(p_ristorante_id) = any (p_ruoli), false)
$$;

-- Accesso al gruppo: membro del gruppo oppure di una qualsiasi sua sede.
create or replace function app.ha_accesso_gruppo(p_gruppo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid()))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid()))
$$;

create or replace function app.ha_ruolo_gruppo(p_gruppo_id uuid, p_ruoli public.ruolo_membro[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid())
                    and mg.ruolo = any (p_ruoli))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid())
                    and mr.ruolo = any (p_ruoli))
$$;

create or replace function app.gruppo_di(p_ristorante_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.gruppo_id from public.ristoranti r where r.id = p_ristorante_id
$$;

create or replace function app.richiedi(p_ok boolean, p_messaggio text default 'Permesso negato') returns void
language plpgsql set search_path = '' as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_messaggio using errcode = '42501';
  end if;
end $$;

revoke all on all functions in schema app from public;
grant execute on all functions in schema app to authenticated, service_role;

-- ── RLS: sola lettura filtrata per sede/gruppo, nessuna scrittura diretta ──
alter table public.gruppi enable row level security;
alter table public.ristoranti enable row level security;
alter table public.membri_gruppo enable row level security;
alter table public.membri_ristorante enable row level security;
alter table public.fornitori_ristorante enable row level security;

drop policy "lettura autenticati" on public.fornitori;
drop policy "lettura autenticati" on public.documenti;
drop policy "lettura autenticati" on public.articoli;
drop policy "lettura autenticati" on public.storico_prezzi;

create policy "gruppi: lettura membri" on public.gruppi for select to authenticated
  using (app.ha_accesso_gruppo(id));
create policy "ristoranti: lettura membri" on public.ristoranti for select to authenticated
  using (app.ha_accesso_ristorante(id));
create policy "membri_gruppo: propri o titolare" on public.membri_gruppo for select to authenticated
  using (user_id = (select auth.uid())
         or app.ha_ruolo_gruppo(gruppo_id, array['titolare']::public.ruolo_membro[]));
create policy "membri_ristorante: propri o titolare" on public.membri_ristorante for select to authenticated
  using (user_id = (select auth.uid())
         or app.ha_ruolo(ristorante_id, array['titolare']::public.ruolo_membro[]));
create policy "fornitori: lettura gruppo" on public.fornitori for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));
create policy "fornitori_ristorante: lettura sede" on public.fornitori_ristorante for select to authenticated
  using (app.ha_accesso_ristorante(ristorante_id));
create policy "documenti: lettura sede" on public.documenti for select to authenticated
  using (app.ha_accesso_ristorante(ristorante_id));
create policy "articoli: lettura gruppo" on public.articoli for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));
create policy "storico_prezzi: lettura sede" on public.storico_prezzi for select to authenticated
  using (app.ha_accesso_ristorante(ristorante_id));

-- Difesa in profondità: oltre alla RLS, niente privilegi di scrittura ai ruoli API.
revoke all on public.gruppi, public.ristoranti, public.membri_gruppo, public.membri_ristorante,
  public.fornitori, public.fornitori_ristorante, public.documenti, public.articoli, public.storico_prezzi
  from anon, authenticated;
grant select on public.gruppi, public.ristoranti, public.membri_gruppo, public.membri_ristorante,
  public.fornitori, public.fornitori_ristorante, public.documenti, public.articoli, public.storico_prezzi
  to authenticated;

-- ── Storage: bucket privato, percorso {ristorante_id}/... ──────────────────
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['application/pdf', 'application/xml', 'text/xml',
                                  'image/jpeg', 'image/png', 'image/webp']
 where id = 'documenti';

drop policy if exists "lettura documenti autenticati" on storage.objects;

create policy "documenti: lettura per sede" on storage.objects for select to authenticated
  using (bucket_id = 'documenti' and (
    app.ha_accesso_ristorante(app.uuid_sicuro((storage.foldername(name))[1]))
    -- file caricati prima della migrazione: accesso tramite il documento collegato
    or exists (select 1 from public.documenti d
                where d.file_path = name and app.ha_accesso_ristorante(d.ristorante_id))));

create policy "documenti: caricamento per sede" on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti'
    and app.ha_ruolo(app.uuid_sicuro((storage.foldername(name))[1]),
                     array['titolare', 'chef', 'contabile']::public.ruolo_membro[]));

-- ── Audit trail immutabile con catena di hash SHA-256 ──────────────────────
-- Una catena per gruppo. Ogni riga contiene l'hash della precedente: qualsiasi
-- modifica o cancellazione a posteriori rompe la catena e viene rilevata da
-- verifica_audit().
create table public.audit_log (
  id bigint generated always as identity primary key,
  gruppo_id uuid not null,
  seq bigint not null,
  ristorante_id uuid,
  tabella text not null,
  riga_id text,
  operazione text not null check (operazione in ('INSERT', 'UPDATE', 'DELETE')),
  prima jsonb,
  dopo jsonb,
  utente_id uuid,
  ruolo_db text,
  origine text not null,
  ip text,
  ip_connessione text,
  creato_il timestamptz not null,
  hash_precedente text not null,
  hash text not null,
  unique (gruppo_id, seq)
);
create index on public.audit_log (gruppo_id, creato_il desc);
create index on public.audit_log (tabella, riga_id);

create or replace function app.audit_hash(
  p_hash_precedente text, p_gruppo_id uuid, p_seq bigint, p_ristorante_id uuid, p_tabella text,
  p_riga_id text, p_operazione text, p_prima jsonb, p_dopo jsonb, p_utente_id uuid, p_ruolo_db text,
  p_origine text, p_ip text, p_ip_connessione text, p_creato_il timestamptz)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(
    p_hash_precedente || '|' || p_gruppo_id::text || '|' || p_seq::text || '|' ||
    coalesce(p_ristorante_id::text, '') || '|' || p_tabella || '|' || coalesce(p_riga_id, '') || '|' ||
    p_operazione || '|' || coalesce(p_prima::text, '') || '|' || coalesce(p_dopo::text, '') || '|' ||
    coalesce(p_utente_id::text, '') || '|' || coalesce(p_ruolo_db, '') || '|' || p_origine || '|' ||
    coalesce(p_ip, '') || '|' || coalesce(p_ip_connessione, '') || '|' ||
    to_char(p_creato_il at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'UTF8')), 'hex')
$$;

create or replace function app.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- colonne tecniche o voluminose escluse dal registro
  c_escluse constant text[] := array['embedding', 'aggiornato_il', 'dati_estratti'];
  v_old jsonb; v_new jsonb; v_riga jsonb; v_prima jsonb; v_dopo jsonb;
  v_gruppo uuid; v_ristorante uuid; v_riga_id text;
  v_headers json; v_uid uuid; v_ruolo text; v_origine text; v_ip text; v_ip_conn text;
  v_seq bigint; v_prec text; v_ts timestamptz := clock_timestamp();
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old) - c_escluse; end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new) - c_escluse; end if;
  v_riga := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
      into v_prima, v_dopo
      from jsonb_each(v_new) n join jsonb_each(v_old) o on o.key = n.key
     where n.value is distinct from o.value;
    if v_dopo is null then return null; end if;   -- nessun cambiamento sostanziale
  else
    v_prima := v_old; v_dopo := v_new;
  end if;

  v_ristorante := app.uuid_sicuro(case when tg_table_name = 'ristoranti' then v_riga->>'id'
                                       else v_riga->>'ristorante_id' end);
  v_gruppo := coalesce(
    app.uuid_sicuro(case when tg_table_name = 'gruppi' then v_riga->>'id' else v_riga->>'gruppo_id' end),
    (select r.gruppo_id from public.ristoranti r where r.id = v_ristorante));
  if v_gruppo is null then
    v_gruppo := '00000000-0000-0000-0000-000000000000';
  end if;
  v_riga_id := coalesce(v_riga->>'id', concat_ws(':', v_riga->>'gruppo_id', v_riga->>'ristorante_id',
                                                 v_riga->>'fornitore_id', v_riga->>'user_id'));

  v_headers := nullif(current_setting('request.headers', true), '')::json;
  v_uid := auth.uid();
  v_ruolo := coalesce(auth.role(), session_user::text);
  v_origine := case
    when v_uid is not null then 'app'
    when v_ruolo = 'service_role' then coalesce(nullif(v_headers->>'x-pg-origine', ''), 'n8n')
    when v_headers is null then 'sql'
    else 'sistema' end;
  v_ip := left(coalesce(nullif(v_headers->>'x-pg-client-ip', ''),
                        nullif(current_setting('app.ip', true), '')), 64);
  v_ip_conn := left(coalesce(nullif(v_headers->>'cf-connecting-ip', ''),
                             nullif(btrim(split_part(v_headers->>'x-forwarded-for', ',', 1)), '')), 64);

  -- Serializza le scritture della stessa catena: senza lock due transazioni
  -- concorrenti leggerebbero lo stesso hash precedente e la catena si biforcherebbe.
  perform pg_advisory_xact_lock(hashtextextended('audit_log:' || v_gruppo::text, 0));

  select a.seq, a.hash into v_seq, v_prec
    from public.audit_log a where a.gruppo_id = v_gruppo order by a.seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prec := coalesce(v_prec, repeat('0', 64));

  insert into public.audit_log (gruppo_id, seq, ristorante_id, tabella, riga_id, operazione, prima, dopo,
                                utente_id, ruolo_db, origine, ip, ip_connessione, creato_il,
                                hash_precedente, hash)
  values (v_gruppo, v_seq, v_ristorante, tg_table_name, v_riga_id, tg_op, v_prima, v_dopo,
          v_uid, v_ruolo, v_origine, v_ip, v_ip_conn, v_ts, v_prec,
          app.audit_hash(v_prec, v_gruppo, v_seq, v_ristorante, tg_table_name, v_riga_id, tg_op,
                         v_prima, v_dopo, v_uid, v_ruolo, v_origine, v_ip, v_ip_conn, v_ts));
  return null;
end $$;

create or replace function app.audit_immutabile() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log è immutabile: operazione % non consentita', tg_op using errcode = '42501';
end $$;

create trigger audit_log_no_modifica before update or delete on public.audit_log
  for each row execute function app.audit_immutabile();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_immutabile();

alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
create policy "audit: lettura titolare e contabile" on public.audit_log for select to authenticated
  using (app.ha_ruolo_gruppo(gruppo_id, array['titolare', 'contabile']::public.ruolo_membro[]));

do $$
declare t text;
begin
  foreach t in array array['gruppi', 'ristoranti', 'membri_gruppo', 'membri_ristorante', 'fornitori',
                           'fornitori_ristorante', 'documenti', 'articoli', 'storico_prezzi'] loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

-- Verifica l'integrità della catena: sequenza continua, concatenazione e hash ricalcolato.
create or replace function public.verifica_audit(p_gruppo_id uuid default null)
returns table (gruppo_id uuid, righe bigint, valida boolean, prima_anomalia_seq bigint, dettaglio text,
               ultimo_hash text)
language plpgsql stable security definer set search_path = '' as $$
declare
  g uuid; r public.audit_log; v_prec text; v_att bigint; v_n bigint; v_err_seq bigint; v_err text;
begin
  if auth.uid() is not null then
    perform app.richiedi(p_gruppo_id is not null
      and app.ha_ruolo_gruppo(p_gruppo_id, array['titolare', 'contabile']::public.ruolo_membro[]));
  elsif coalesce(auth.role(), 'postgres') = 'anon' then
    perform app.richiedi(false);
  end if;

  for g in select distinct a.gruppo_id from public.audit_log a
            where p_gruppo_id is null or a.gruppo_id = p_gruppo_id loop
    v_prec := repeat('0', 64); v_att := 0; v_n := 0; v_err_seq := null; v_err := null;
    for r in select * from public.audit_log a where a.gruppo_id = g order by a.seq loop
      v_n := v_n + 1; v_att := v_att + 1;
      if r.seq <> v_att then
        v_err_seq := v_att; v_err := 'Riga mancante: attesa sequenza ' || v_att || ', trovata ' || r.seq;
      elsif r.hash_precedente <> v_prec then
        v_err_seq := r.seq; v_err := 'Concatenazione interrotta: hash precedente non corrisponde';
      elsif r.hash <> app.audit_hash(r.hash_precedente, r.gruppo_id, r.seq, r.ristorante_id, r.tabella,
              r.riga_id, r.operazione, r.prima, r.dopo, r.utente_id, r.ruolo_db, r.origine, r.ip,
              r.ip_connessione, r.creato_il) then
        v_err_seq := r.seq; v_err := 'Contenuto alterato: hash della riga non corrisponde';
      end if;
      exit when v_err is not null;
      v_prec := r.hash;
    end loop;
    gruppo_id := g;
    righe := (select count(*) from public.audit_log a where a.gruppo_id = g);
    valida := v_err is null; prima_anomalia_seq := v_err_seq; dettaglio := v_err;
    ultimo_hash := (select a.hash from public.audit_log a where a.gruppo_id = g order by a.seq desc limit 1);
    return next;
  end loop;
end $$;

revoke all on function public.verifica_audit(uuid) from public, anon;
grant execute on function public.verifica_audit(uuid) to authenticated, service_role;

-- ── Gestione sede e membri (solo titolare) ─────────────────────────────────
create or replace function public.aggiorna_ristorante(
  p_ristorante_id uuid, p_nome text default null, p_soglia_anomalia_pct numeric default null,
  p_paese text default null, p_valuta text default null, p_partita_iva text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[]));
  update public.ristoranti set
    nome = coalesce(nullif(btrim(p_nome), ''), nome),
    soglia_anomalia_pct = coalesce(p_soglia_anomalia_pct, soglia_anomalia_pct),
    paese = coalesce(upper(nullif(btrim(p_paese), '')), paese),
    valuta = coalesce(upper(nullif(btrim(p_valuta), '')), valuta),
    partita_iva = coalesce(nullif(btrim(p_partita_iva), ''), partita_iva)
  where id = p_ristorante_id;
end $$;

create or replace function public.aggiorna_gruppo(p_gruppo_id uuid, p_nome text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_ruolo_gruppo(p_gruppo_id, array['titolare']::public.ruolo_membro[]));
  update public.gruppi set nome = coalesce(nullif(btrim(p_nome), ''), nome) where id = p_gruppo_id;
end $$;

-- L'utente deve già esistere in Authentication (creato o invitato dalla console).
create or replace function public.imposta_membro(p_ristorante_id uuid, p_email text, p_ruolo public.ruolo_membro)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[]));
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'Nessun utente con email %: crealo prima in Authentication', p_email using errcode = 'P0002';
  end if;
  if v_uid = auth.uid() and p_ruolo <> 'titolare' then
    raise exception 'Non puoi togliere a te stesso il ruolo di titolare' using errcode = '42501';
  end if;
  insert into public.membri_ristorante (ristorante_id, user_id, ruolo) values (p_ristorante_id, v_uid, p_ruolo)
  on conflict (ristorante_id, user_id) do update set ruolo = excluded.ruolo;
end $$;

create or replace function public.rimuovi_membro(p_ristorante_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[]));
  if p_user_id = auth.uid() then
    raise exception 'Non puoi rimuovere te stesso' using errcode = '42501';
  end if;
  delete from public.membri_ristorante where ristorante_id = p_ristorante_id and user_id = p_user_id;
end $$;

create or replace function public.elenco_membri(p_ristorante_id uuid)
returns table (user_id uuid, email text, ruolo public.ruolo_membro, livello text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[]));
  return query
    select mr.user_id, u.email::text, mr.ruolo, 'sede'::text
      from public.membri_ristorante mr join auth.users u on u.id = mr.user_id
     where mr.ristorante_id = p_ristorante_id
    union all
    select mg.user_id, u.email::text, mg.ruolo, 'gruppo'::text
      from public.membri_gruppo mg join auth.users u on u.id = mg.user_id
     where mg.gruppo_id = app.gruppo_di(p_ristorante_id)
       and not exists (select 1 from public.membri_ristorante x
                        where x.ristorante_id = p_ristorante_id and x.user_id = mg.user_id);
end $$;

revoke all on function public.aggiorna_ristorante(uuid, text, numeric, text, text, text),
  public.aggiorna_gruppo(uuid, text), public.imposta_membro(uuid, text, public.ruolo_membro),
  public.rimuovi_membro(uuid, uuid), public.elenco_membri(uuid) from public, anon;
grant execute on function public.aggiorna_ristorante(uuid, text, numeric, text, text, text),
  public.aggiorna_gruppo(uuid, text), public.imposta_membro(uuid, text, public.ruolo_membro),
  public.rimuovi_membro(uuid, uuid), public.elenco_membri(uuid) to authenticated;
