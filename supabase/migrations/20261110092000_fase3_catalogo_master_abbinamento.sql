-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 3 — Catalogo master, alias, abbinamento a 3 livelli, unità e cambi
-- ═══════════════════════════════════════════════════════════════════════════
-- Livello 1: alias esatto (fornitore + codice/descrizione) → nessun costo IA.
-- Livello 2: candidati per somiglianza (trigrammi + embedding pgvector).
-- Livello 3: Claude come giudice sui soli casi incerti (in n8n).
-- Ogni conferma umana diventa un alias: il sistema impara e non richiede più l'IA.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

-- ── Utilità ────────────────────────────────────────────────────────────────
create or replace function app.norm_testo(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;

create or replace function app.num(p text) returns numeric
language sql immutable set search_path = '' as $$
  select case when p ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then p::numeric end
$$;

-- Unità di misura → unità base e fattore (1 g = 0,001 kg; 1 cl = 0,01 lt …)
create or replace function app.um_base(p_um text, out base text, out fattore numeric)
language sql immutable set search_path = '' as $$
  select v.b, v.f
    from (values ('kg', 'kg', 1), ('g', 'kg', 0.001), ('lt', 'lt', 1), ('l', 'lt', 1), ('cl', 'lt', 0.01),
                 ('ml', 'lt', 0.001), ('pz', 'pz', 1), ('mt', 'mt', 1), ('conf', 'conf', 1)) as v(u, b, f)
   where v.u = lower(btrim(p_um))
$$;

-- Prezzo riportato all'unità base del master. In ordine: conversione diretta
-- dell'unità, peso reale della riga (carne/pesce al taglio), fattore dell'alias
-- ("cartone 6×1 lt" → 6), contenuto per unità letto dal documento.
create or replace function app.prezzo_base(
  p_netto numeric, p_quantita numeric, p_um text, p_peso_kg numeric, p_contenuto numeric,
  p_um_contenuto text, p_fattore numeric, p_target text)
returns numeric language plpgsql immutable set search_path = '' as $$
declare u record; c record;
begin
  if p_netto is null or p_target is null then return null; end if;
  select * into u from app.um_base(p_um);
  if u.base = p_target then return round(p_netto / u.fattore, 4); end if;
  if p_target = 'kg' and p_peso_kg > 0 and p_quantita > 0 then
    return round(p_netto * p_quantita / p_peso_kg, 4);
  end if;
  if p_fattore > 0 then return round(p_netto / p_fattore, 4); end if;
  if p_contenuto > 0 then
    select * into c from app.um_base(p_um_contenuto);
    if c.base = p_target then return round(p_netto / (p_contenuto * c.fattore), 4); end if;
  end if;
  return null;
end $$;

-- ── Tassi di cambio BCE (unità di valuta per 1 EUR) ────────────────────────
create table public.tassi_cambio (
  data date not null,
  valuta text not null check (valuta ~ '^[A-Z]{3}$'),
  tasso numeric(14,6) not null check (tasso > 0),
  primary key (valuta, data)
);
alter table public.tassi_cambio enable row level security;
revoke all on public.tassi_cambio from anon, authenticated;
grant select on public.tassi_cambio to authenticated;
create policy "tassi: lettura autenticati" on public.tassi_cambio for select to authenticated using (true);

-- Ultimo tasso pubblicato fino alla data del documento (la BCE non pubblica nei festivi).
create or replace function app.tasso_bce(p_valuta text, p_data date) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when upper(p_valuta) = 'EUR' then 1::numeric else (
    select t.tasso from public.tassi_cambio t
     where t.valuta = upper(p_valuta) and t.data <= coalesce(p_data, current_date)
     order by t.data desc limit 1) end
$$;

-- ── Catalogo master (di gruppo) ────────────────────────────────────────────
create table public.categorie_master (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references public.gruppi(id) on delete cascade,
  nome text not null,
  creato_il timestamptz not null default now()
);
create unique index categorie_master_nome on public.categorie_master (gruppo_id, lower(nome));

create table public.articoli_master (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references public.gruppi(id) on delete restrict,
  categoria_id uuid references public.categorie_master(id) on delete set null,
  nome text not null check (btrim(nome) <> ''),
  nome_norm text generated always as (lower(regexp_replace(btrim(nome), '\s+', ' ', 'g'))) stored,
  unita_base text not null check (unita_base in ('kg', 'lt', 'pz', 'mt', 'conf')),
  stato text not null default 'bozza' check (stato in ('bozza', 'attivo')),
  note text,
  embedding extensions.vector(384),
  creato_da uuid references auth.users(id) on delete set null,
  approvato_da uuid references auth.users(id) on delete set null,
  approvato_il timestamptz,
  creato_il timestamptz not null default now(),
  unique (gruppo_id, nome_norm)
);
create index on public.articoli_master using gin (nome_norm extensions.gin_trgm_ops);
create index on public.articoli_master using hnsw (embedding extensions.vector_cosine_ops);
create index on public.articoli_master (gruppo_id, stato);

insert into public.categorie_master (gruppo_id, nome)
select g.id, c.nome from public.gruppi g cross join (values
  ('Carni bovine'), ('Carni suine e salumi'), ('Pollame e selvaggina'), ('Pesce e crostacei'),
  ('Frutta e verdura'), ('Latticini e uova'), ('Formaggi'), ('Pane, pasta e farine'),
  ('Dispensa e conserve'), ('Oli e condimenti'), ('Tartufi, funghi e specialità'),
  ('Caviale e prodotti di lusso'), ('Vini e champagne'), ('Distillati e liquori'),
  ('Bevande analcoliche'), ('Caffè, tè e cioccolato'), ('Pasticceria'), ('Non alimentare')) as c(nome);

-- ── Alias: l'articolo così come lo chiama il fornitore ─────────────────────
alter table public.articoli rename to alias_articolo;
alter policy "articoli: lettura gruppo" on public.alias_articolo rename to "alias: lettura gruppo";
alter table public.alias_articolo
  add column master_id uuid references public.articoli_master(id) on delete set null,
  add column master_proposto_id uuid references public.articoli_master(id) on delete set null,
  add column stato_abbinamento text not null default 'da_abbinare'
    check (stato_abbinamento in ('da_abbinare', 'proposto', 'automatico', 'confermato')),
  add column metodo text,
  add column confidenza numeric(4,3),
  add column motivazione text,
  add column fattore_conversione numeric(14,6) check (fattore_conversione > 0),
  add column fattore_proposto numeric(14,6),
  add column confermato_da uuid references auth.users(id) on delete set null,
  add column confermato_il timestamptz,
  add column embedding extensions.vector(384);
create index on public.alias_articolo (master_id);
create index on public.alias_articolo (gruppo_id, stato_abbinamento);
create index on public.alias_articolo using hnsw (embedding extensions.vector_cosine_ops);

-- ── Righe documento / storico prezzi ───────────────────────────────────────
alter table public.storico_prezzi rename column articolo_id to alias_id;
alter table public.storico_prezzi
  add column fornitore_id uuid references public.fornitori(id) on delete restrict,
  add column master_id uuid references public.articoli_master(id) on delete set null,
  add column numero_riga int,
  add column descrizione text,
  add column descrizione_originale text,
  add column peso_netto_kg numeric(14,3),
  add column contenuto_per_unita numeric(14,4),
  add column unita_contenuto text,
  add column prezzo_netto numeric(14,4),
  add column prezzo_base numeric(14,4),
  add column unita_base text,
  add column prezzo_confronto numeric(14,4),
  add column unita_confronto text,
  add column tasso_cambio numeric(14,6),
  add column prezzo_base_eur numeric(14,4),
  add column totale_riga_eur numeric(14,2),
  add column anomalia_stato text check (anomalia_stato in ('aperta', 'accettata', 'contestata')),
  add column anomalia_nota text,
  add column anomalia_gestita_da uuid references auth.users(id) on delete set null,
  add column anomalia_gestita_il timestamptz,
  add column corretto_manualmente boolean not null default false,
  add column creato_il timestamptz not null default now();

update public.storico_prezzi sp
   set fornitore_id = d.fornitore_id,
       descrizione = a.descrizione_normalizzata,
       descrizione_originale = a.descrizione_originale
  from public.documenti d, public.alias_articolo a
 where d.id = sp.documento_id and a.id = sp.alias_id;
alter table public.storico_prezzi alter column fornitore_id set not null;
create index on public.storico_prezzi (ristorante_id, master_id, data_rilevazione desc);
create index on public.storico_prezzi (ristorante_id, alias_id, data_rilevazione desc);
create index on public.storico_prezzi (ristorante_id) where anomalia_prezzo;

alter table public.documenti
  add column tasso_cambio numeric(14,6),
  add column imponibile_eur numeric(14,2),
  add column totale_eur numeric(14,2),
  add column corretto_manualmente boolean not null default false;

alter table public.categorie_master enable row level security;
alter table public.articoli_master enable row level security;
revoke all on public.categorie_master, public.articoli_master, public.alias_articolo from anon, authenticated;
grant select on public.categorie_master, public.articoli_master, public.alias_articolo to authenticated;
create policy "categorie: lettura gruppo" on public.categorie_master for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));
create policy "master: lettura gruppo" on public.articoli_master for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));

create trigger audit after insert or update or delete on public.categorie_master
  for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.articoli_master
  for each row execute function app.audit_trigger();

-- ── Ricalcolo prezzi e anomalie ────────────────────────────────────────────
create or replace function app.aggiorna_eur_documento(p_documento_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.documenti d
     set tasso_cambio = t.tasso,
         imponibile_eur = round(d.imponibile / t.tasso, 2),
         totale_eur = round(d.totale / t.tasso, 2)
    from (select app.tasso_bce(x.valuta, x.data_documento) as tasso
            from public.documenti x where x.id = p_documento_id) t
   where d.id = p_documento_id
$$;

-- Ricalcola in ordine cronologico tutte le righe delle serie indicate (per alias
-- o per master) di una sede: prezzo netto, prezzo in unità base, controvalore in
-- EUR e variazione rispetto all'acquisto precedente dallo stesso fornitore.
-- Il confronto avviene nella valuta originale, così il cambio non genera falsi rincari.
create or replace function app.ricalcola_serie(p_ristorante_id uuid, p_alias uuid[], p_master uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record; p record;
  v_soglia numeric; v_netto numeric; v_target text; v_base numeric; v_tasso numeric;
  v_prec numeric; v_att numeric; v_um text; v_var numeric; v_anom boolean;
  v_docs uuid[] := '{}';
begin
  select soglia_anomalia_pct into v_soglia from public.ristoranti where id = p_ristorante_id;

  for r in
    select sp.id, sp.documento_id, sp.alias_id, sp.master_id, sp.fornitore_id, sp.valuta, sp.quantita,
           sp.unita_misura, sp.prezzo_unitario, sp.sconto_percentuale, sp.peso_netto_kg,
           sp.contenuto_per_unita, sp.unita_contenuto, sp.data_rilevazione, sp.creato_il,
           d.tipo, d.data_documento, a.fattore_conversione, m.unita_base as master_base
      from public.storico_prezzi sp
      join public.documenti d on d.id = sp.documento_id
      join public.alias_articolo a on a.id = sp.alias_id
      left join public.articoli_master m on m.id = sp.master_id
     where sp.ristorante_id = p_ristorante_id
       and (sp.alias_id = any (coalesce(p_alias, '{}')) or sp.master_id = any (coalesce(p_master, '{}')))
     order by sp.data_rilevazione, sp.creato_il, sp.id
  loop
    v_netto := round(r.prezzo_unitario * (1 - coalesce(r.sconto_percentuale, 0) / 100), 4);
    v_target := coalesce(r.master_base, (app.um_base(r.unita_misura)).base, lower(r.unita_misura));
    v_base := app.prezzo_base(v_netto, r.quantita, r.unita_misura, r.peso_netto_kg, r.contenuto_per_unita,
                              r.unita_contenuto, r.fattore_conversione, v_target);
    v_tasso := app.tasso_bce(r.valuta, r.data_documento);
    v_prec := null; v_att := null; v_um := null;

    if r.tipo <> 'Nota di Credito' then
      select s.prezzo_base, s.unita_base, s.prezzo_netto, s.unita_misura into p
        from public.storico_prezzi s
        join public.documenti sd on sd.id = s.documento_id
       where s.ristorante_id = p_ristorante_id
         and s.fornitore_id = r.fornitore_id
         and s.valuta = r.valuta
         and s.documento_id <> r.documento_id
         and sd.stato = 'completato' and sd.tipo <> 'Nota di Credito'
         and ((r.master_id is not null and s.master_id = r.master_id) or s.alias_id = r.alias_id)
         and (s.data_rilevazione, s.creato_il, s.id) < (r.data_rilevazione, r.creato_il, r.id)
       order by s.data_rilevazione desc, s.creato_il desc, s.id desc
       limit 1;
      if found then
        if v_base is not null and p.prezzo_base is not null and p.unita_base = v_target then
          v_prec := p.prezzo_base; v_att := v_base; v_um := v_target;
        elsif lower(p.unita_misura) is not distinct from lower(r.unita_misura) then
          v_prec := p.prezzo_netto; v_att := v_netto; v_um := r.unita_misura;
        end if;
      end if;
    end if;

    v_var := case when v_prec > 0 then round((v_att - v_prec) / v_prec * 100, 2) end;
    v_anom := coalesce(v_var > v_soglia, false);

    update public.storico_prezzi set
      prezzo_netto = v_netto,
      prezzo_base = v_base,
      unita_base = case when v_base is not null then v_target end,
      tasso_cambio = v_tasso,
      prezzo_base_eur = round(v_base / v_tasso, 4),
      totale_riga_eur = round(totale_riga / v_tasso, 2),
      prezzo_precedente = v_prec,
      prezzo_confronto = v_att,
      unita_confronto = v_um,
      variazione_pct = v_var,
      anomalia_prezzo = v_anom,
      anomalia_stato = case when not v_anom then null else coalesce(anomalia_stato, 'aperta') end
    where id = r.id;
    v_docs := v_docs || r.documento_id;
  end loop;

  update public.documenti d
     set n_anomalie = (select count(*) from public.storico_prezzi s
                        where s.documento_id = d.id and s.anomalia_prezzo)
   where d.id = any (v_docs);
end $$;

create or replace function app.ricalcola_documento(p_documento_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rist uuid; v_alias uuid[]; v_master uuid[];
begin
  select d.ristorante_id into v_rist from public.documenti d where d.id = p_documento_id;
  select coalesce(array_agg(distinct s.alias_id), '{}'),
         coalesce(array_agg(distinct s.master_id) filter (where s.master_id is not null), '{}')
    into v_alias, v_master
    from public.storico_prezzi s where s.documento_id = p_documento_id;
  perform app.ricalcola_serie(v_rist, v_alias, v_master);
  update public.documenti d
     set n_anomalie = (select count(*) from public.storico_prezzi s
                        where s.documento_id = d.id and s.anomalia_prezzo)
   where d.id = p_documento_id;
end $$;

-- Dopo un cambio di abbinamento: ricalcola in tutte le sedi che hanno quelle serie.
create or replace function app.ricalcola_alias(p_alias_id uuid, p_master uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rist uuid; v_m uuid[] := array_remove(coalesce(p_master, '{}'), null);
begin
  for v_rist in
    select distinct s.ristorante_id from public.storico_prezzi s
     where s.alias_id = p_alias_id or s.master_id = any (v_m)
  loop
    perform app.ricalcola_serie(v_rist, array[p_alias_id], v_m);
  end loop;
end $$;

-- Collega un alias a un master e allinea le righe storiche. Restituisce il master precedente.
create or replace function app.assegna_master(
  p_alias_id uuid, p_master_id uuid, p_stato text, p_metodo text, p_confidenza numeric,
  p_motivazione text, p_fattore numeric default null, p_utente uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_vecchio uuid;
begin
  select a.master_id into v_vecchio from public.alias_articolo a where a.id = p_alias_id for update;
  update public.alias_articolo set
    master_id = p_master_id,
    master_proposto_id = null,
    stato_abbinamento = p_stato,
    metodo = p_metodo,
    confidenza = least(greatest(p_confidenza, 0), 1),
    motivazione = left(p_motivazione, 500),
    fattore_conversione = coalesce(case when p_fattore > 0 then p_fattore end, fattore_conversione),
    fattore_proposto = null,
    confermato_da = case when p_stato = 'confermato' then p_utente end,
    confermato_il = case when p_stato = 'confermato' then now() end
  where id = p_alias_id;
  update public.storico_prezzi set master_id = p_master_id
   where alias_id = p_alias_id and master_id is distinct from p_master_id;
  return v_vecchio;
end $$;

create or replace function app.categoria_id(p_gruppo_id uuid, p_nome text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_nome text := left(nullif(btrim(p_nome), ''), 80);
begin
  if v_nome is null then return null; end if;
  select c.id into v_id from public.categorie_master c
   where c.gruppo_id = p_gruppo_id and lower(c.nome) = lower(v_nome);
  if v_id is null then
    insert into public.categorie_master (gruppo_id, nome) values (p_gruppo_id, v_nome) returning id into v_id;
  end if;
  return v_id;
end $$;

-- Candidati master per una descrizione: trigrammi su nome e alias già abbinati,
-- più vicinanza vettoriale quando gli embedding sono disponibili.
-- Il punteggio (0-1) è quello dei trigrammi; il vettore serve ad ampliare la rosa.
create or replace function app.candidati_master(
  p_gruppo_id uuid, p_testo text, p_embedding extensions.vector default null, p_limite int default 5)
returns table (master_id uuid, nome text, categoria text, unita_base text, stato text,
               punteggio numeric, sim_vettoriale numeric)
language sql stable security definer set search_path = public, extensions as $$
  with t as (
    select m.id, m.nome, c.nome as categoria, m.unita_base, m.stato,
           greatest(
             similarity(m.nome_norm, app.norm_testo(p_testo)),
             coalesce((select max(similarity(app.norm_testo(a.descrizione_normalizzata), app.norm_testo(p_testo)))
                         from alias_articolo a
                        where a.master_id = m.id and a.stato_abbinamento in ('confermato', 'automatico')), 0)
           )::numeric as s_trgm,
           case when p_embedding is null then null else greatest(
             1 - (m.embedding <=> p_embedding),
             (select max(1 - (a.embedding <=> p_embedding)) from alias_articolo a
               where a.master_id = m.id and a.stato_abbinamento in ('confermato', 'automatico'))
           )::numeric end as s_vec
      from articoli_master m
      left join categorie_master c on c.id = m.categoria_id
     where m.gruppo_id = p_gruppo_id
  ), r as (
    select t.*, row_number() over (order by t.s_trgm desc) as rt,
           row_number() over (order by t.s_vec desc nulls last) as rv
      from t
  )
  select r.id, r.nome, r.categoria, r.unita_base, r.stato, round(r.s_trgm, 3), round(r.s_vec, 3)
    from r
   where (r.rt <= p_limite and r.s_trgm >= 0.15) or (r.rv <= p_limite and r.s_vec is not null)
   order by r.s_trgm desc, r.s_vec desc nulls last
   limit p_limite + 3
$$;

-- ── RPC di servizio: registrazione del documento estratto ──────────────────
-- La sede NON arriva dal client: è quella del documento prenotato con
-- crea_caricamento (che ha già verificato ruolo e sede dell'utente).
create or replace function public.registra_documento(p_documento_id uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_d public.documenti; v_gruppo uuid;
  v_doc jsonb := coalesce(payload->'documento', '{}'::jsonb);
  v_forn jsonb := coalesce(payload->'fornitore', '{}'::jsonb);
  v_tot jsonb := coalesce(payload->'totali', '{}'::jsonb);
  v_valuta text; v_tipo text; v_numero text; v_data date;
  v_chiave_f text; v_fid uuid; v_dup uuid;
  v_alias public.alias_articolo; v_riga jsonb; v_desc text; v_cod text; v_prezzo numeric;
  v_n int := 0; v_i int := 0;
begin
  select * into v_d from public.documenti where id = p_documento_id for update;
  if not found then
    raise exception 'Documento % inesistente', p_documento_id;
  end if;
  if not (v_d.stato = 'elaborazione' or (v_d.stato = 'errore' and v_d.errore_codice = 'timeout')) then
    raise exception 'Documento % non in elaborazione (stato: %)', p_documento_id, v_d.stato;
  end if;
  if coalesce(btrim(v_forn->>'ragione_sociale'), '') = '' then
    raise exception 'Fornitore non riconosciuto nel documento';
  end if;

  v_gruppo := app.gruppo_di(v_d.ristorante_id);
  v_valuta := upper(left(coalesce(nullif(v_doc->>'codice_valuta', ''), nullif(v_tot->>'valuta', ''), 'EUR'), 3));
  v_tipo := case when v_doc->>'tipo' in ('Fattura', 'DDT', 'Nota di Credito') then v_doc->>'tipo' else 'Altro' end;
  v_numero := nullif(btrim(v_doc->>'numero_documento'), '');
  v_data := case when v_doc->>'data_documento' ~ '^\d{4}-\d{2}-\d{2}' then left(v_doc->>'data_documento', 10)::date end;

  v_chiave_f := lower(regexp_replace(coalesce(nullif(v_forn->>'partita_iva_o_estera', ''),
                                              v_forn->>'ragione_sociale'), '[^A-Za-z0-9]', '', 'g'));
  if v_chiave_f = '' then v_chiave_f := md5(lower(v_forn->>'ragione_sociale')); end if;

  insert into public.fornitori (gruppo_id, ragione_sociale, partita_iva_o_estera, paese,
                                codice_identificativo_estero, chiave)
  values (v_gruppo, btrim(v_forn->>'ragione_sociale'), nullif(v_forn->>'partita_iva_o_estera', ''),
          upper(nullif(v_forn->>'paese', '')), nullif(v_forn->>'codice_identificativo_estero', ''), v_chiave_f)
  on conflict (gruppo_id, chiave) do update set
    paese = coalesce(public.fornitori.paese, excluded.paese),
    codice_identificativo_estero = coalesce(public.fornitori.codice_identificativo_estero,
                                            excluded.codice_identificativo_estero)
  returning id into v_fid;

  insert into public.fornitori_ristorante (fornitore_id, ristorante_id, primo_documento_il, ultimo_documento_il)
  values (v_fid, v_d.ristorante_id, v_data, v_data)
  on conflict (fornitore_id, ristorante_id) do update set
    primo_documento_il = least(public.fornitori_ristorante.primo_documento_il, excluded.primo_documento_il),
    ultimo_documento_il = greatest(public.fornitori_ristorante.ultimo_documento_il, excluded.ultimo_documento_il);

  -- Stesso documento contabile già acquisito (es. fotografato due volte): non si duplica.
  if v_numero is not null then
    select d.id into v_dup from public.documenti d
     where d.ristorante_id = v_d.ristorante_id and d.fornitore_id = v_fid and d.tipo = v_tipo
       and d.numero = v_numero and d.data_documento is not distinct from v_data
       and d.stato = 'completato' and d.id <> p_documento_id
     limit 1;
    if v_dup is not null then
      update public.documenti
         set stato = 'duplicato', fase = null, duplicato_di = v_dup, fornitore_id = v_fid, tipo = v_tipo,
             numero = v_numero, data_documento = v_data, dati_estratti = payload, errore_codice = 'duplicato',
             errore = 'Documento già presente in archivio: non è stato registrato una seconda volta.'
       where id = p_documento_id;
      return jsonb_build_object('duplicato', true, 'documento_id', p_documento_id, 'duplicato_di', v_dup);
    end if;
  end if;

  update public.documenti set
    stato = 'elaborazione', fase = 'abbinamento', errore = null, errore_codice = null,
    fornitore_id = v_fid, tipo = v_tipo, numero = v_numero, data_documento = v_data,
    imponibile = app.num(v_tot->>'imponibile'), iva = app.num(v_tot->>'iva'),
    totale = app.num(v_tot->>'totale_documento'), valuta = v_valuta,
    cliente_ragione_sociale = nullif(payload->'cliente'->>'ragione_sociale', ''),
    cliente_partita_iva = nullif(payload->'cliente'->>'partita_iva', ''),
    dati_estratti = payload
  where id = p_documento_id;

  delete from public.storico_prezzi where documento_id = p_documento_id;

  for v_riga in select * from jsonb_array_elements(coalesce(payload->'articoli', '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_desc := btrim(coalesce(nullif(v_riga->>'descrizione_articolo', ''), v_riga->>'descrizione_originale'));
    v_prezzo := app.num(v_riga->>'prezzo_unitario');
    continue when coalesce(v_desc, '') = '' or v_prezzo is null;
    v_cod := nullif(btrim(v_riga->>'codice_articolo_fornitore'), '');

    -- Livello 1: alias esatto. Se esiste, porta con sé il master già confermato.
    insert into public.alias_articolo (gruppo_id, fornitore_id, codice_articolo, descrizione_originale,
                                       descrizione_normalizzata, unita_misura, chiave)
    values (v_gruppo, v_fid, v_cod, nullif(v_riga->>'descrizione_originale', ''), v_desc,
            nullif(v_riga->>'unita_misura', ''), coalesce(lower(v_cod), app.norm_testo(v_desc)))
    on conflict (fornitore_id, chiave) do update set
      unita_misura = coalesce(public.alias_articolo.unita_misura, excluded.unita_misura)
    returning * into v_alias;

    insert into public.storico_prezzi (
      ristorante_id, documento_id, alias_id, master_id, fornitore_id, numero_riga, descrizione,
      descrizione_originale, quantita, unita_misura, prezzo_unitario, sconto_percentuale, totale_riga,
      aliquota_iva, valuta, peso_netto_kg, contenuto_per_unita, unita_contenuto, data_rilevazione)
    values (
      v_d.ristorante_id, p_documento_id, v_alias.id, v_alias.master_id, v_fid, v_i, v_desc,
      nullif(v_riga->>'descrizione_originale', ''), app.num(v_riga->>'quantita'),
      nullif(v_riga->>'unita_misura', ''), v_prezzo, app.num(v_riga->>'sconto_percentuale'),
      app.num(v_riga->>'totale_riga'), app.num(v_riga->>'aliquota_iva_percentuale'), v_valuta,
      app.num(v_riga->>'peso_netto_kg'), app.num(v_riga->>'contenuto_per_unita'),
      nullif(lower(v_riga->>'unita_contenuto'), ''), coalesce(v_data::timestamptz, now()));
    v_n := v_n + 1;
  end loop;

  perform app.aggiorna_eur_documento(p_documento_id);
  perform app.ricalcola_documento(p_documento_id);

  return jsonb_build_object(
    'duplicato', false, 'documento_id', p_documento_id, 'fornitore_id', v_fid, 'righe', v_n,
    'da_abbinare', (select count(distinct a.id) from public.storico_prezzi s
                      join public.alias_articolo a on a.id = s.alias_id
                     where s.documento_id = p_documento_id and a.stato_abbinamento = 'da_abbinare'));
end $$;

-- ── RPC di servizio: embedding ─────────────────────────────────────────────
create or replace function public.embedding_mancanti(p_limite int default 64)
returns table (tipo text, id uuid, testo text)
language sql stable security definer set search_path = '' as $$
  (select 'alias', a.id, a.descrizione_normalizzata from public.alias_articolo a
    where a.embedding is null order by a.created_at desc limit p_limite)
  union all
  (select 'master', m.id, m.nome from public.articoli_master m
    where m.embedding is null order by m.creato_il desc limit p_limite)
$$;

create or replace function public.salva_embedding(p_embedding jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare e jsonb; v_n int := 0;
begin
  for e in select * from jsonb_array_elements(coalesce(p_embedding, '[]'::jsonb)) loop
    continue when jsonb_array_length(e->'embedding') <> 384;
    if e->>'tipo' = 'alias' then
      update alias_articolo set embedding = (e->>'embedding')::vector where id = (e->>'id')::uuid;
    elsif e->>'tipo' = 'master' then
      update articoli_master set embedding = (e->>'embedding')::vector where id = (e->>'id')::uuid;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ── RPC di servizio: livello 2 (somiglianza) ───────────────────────────────
-- Abbina da solo i casi quasi identici e restituisce a n8n i soli casi incerti,
-- ciascuno con la rosa dei candidati da sottoporre al giudice (Claude).
create or replace function public.prepara_abbinamento(p_documento_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  c_auto_similarita constant numeric := 0.92;
  c_distacco constant numeric := 0.05;
  v_d documenti; v_gruppo uuid; a record; v_cand jsonb; v_top record; v_secondo numeric;
  v_incerti jsonb := '[]'::jsonb; v_auto int := 0;
begin
  select * into v_d from documenti where id = p_documento_id;
  if not found then raise exception 'Documento % inesistente', p_documento_id; end if;
  v_gruppo := app.gruppo_di(v_d.ristorante_id);

  for a in
    select distinct on (al.id) al.id, al.descrizione_normalizzata, al.descrizione_originale,
           al.codice_articolo, al.embedding, s.quantita, s.unita_misura, s.prezzo_unitario, s.valuta,
           s.peso_netto_kg, s.contenuto_per_unita, s.unita_contenuto
      from storico_prezzi s join alias_articolo al on al.id = s.alias_id
     where s.documento_id = p_documento_id and al.stato_abbinamento = 'da_abbinare'
     order by al.id, s.numero_riga
  loop
    select c.master_id, c.punteggio into v_top
      from app.candidati_master(v_gruppo, a.descrizione_normalizzata, a.embedding) c
     order by c.punteggio desc limit 1;
    select c.punteggio into v_secondo
      from app.candidati_master(v_gruppo, a.descrizione_normalizzata, a.embedding) c
     order by c.punteggio desc offset 1 limit 1;

    if v_top.master_id is not null and v_top.punteggio >= c_auto_similarita
       and v_top.punteggio - coalesce(v_secondo, 0) >= c_distacco then
      perform app.assegna_master(a.id, v_top.master_id, 'automatico', 'similarita', v_top.punteggio,
                'Descrizione quasi identica a un articolo già presente nel catalogo');
      v_auto := v_auto + 1;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'master_id', c.master_id, 'nome', c.nome, 'categoria', c.categoria,
               'unita_base', c.unita_base, 'somiglianza', c.punteggio)), '[]'::jsonb)
        into v_cand
        from app.candidati_master(v_gruppo, a.descrizione_normalizzata, a.embedding) c;
      v_incerti := v_incerti || jsonb_build_object(
        'alias_id', a.id, 'descrizione', a.descrizione_normalizzata,
        'descrizione_originale', a.descrizione_originale, 'codice_fornitore', a.codice_articolo,
        'riga', jsonb_build_object('quantita', a.quantita, 'unita_misura', a.unita_misura,
                                   'prezzo_unitario', a.prezzo_unitario, 'valuta', a.valuta,
                                   'peso_netto_kg', a.peso_netto_kg,
                                   'contenuto_per_unita', a.contenuto_per_unita,
                                   'unita_contenuto', a.unita_contenuto),
        'candidati', v_cand);
    end if;
  end loop;

  update documenti set fase = 'abbinamento' where id = p_documento_id and stato = 'elaborazione';

  return jsonb_build_object(
    'documento_id', p_documento_id, 'abbinati_per_somiglianza', v_auto,
    'n_incerti', jsonb_array_length(v_incerti), 'incerti', v_incerti,
    'fornitore', (select f.ragione_sociale from fornitori f where f.id = v_d.fornitore_id),
    'categorie', (select coalesce(jsonb_agg(c.nome order by c.nome), '[]'::jsonb)
                    from categorie_master c where c.gruppo_id = v_gruppo));
end $$;

-- ── RPC di servizio: livello 3 (decisioni del giudice) ─────────────────────
-- confidenza ≥ soglia_auto → abbinamento automatico; fascia intermedia → coda
-- "Da validare"; "nuovo" → master in bozza da approvare.
create or replace function public.applica_abbinamenti(p_documento_id uuid, p_decisioni jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_d public.documenti; v_g public.gruppi; d jsonb; v_alias public.alias_articolo;
  v_master uuid; v_conf numeric; v_fatt numeric; v_nuovo jsonb; v_ub text;
  v_auto int := 0; v_prop int := 0; v_nuovi int := 0;
begin
  select * into v_d from public.documenti where id = p_documento_id;
  if not found then raise exception 'Documento % inesistente', p_documento_id; end if;
  select * into v_g from public.gruppi where id = app.gruppo_di(v_d.ristorante_id);

  for d in select * from jsonb_array_elements(coalesce(p_decisioni, '[]'::jsonb)) loop
    select * into v_alias from public.alias_articolo a
     where a.id = app.uuid_sicuro(d->>'alias_id') and a.gruppo_id = v_g.id
       and a.stato_abbinamento = 'da_abbinare'
       and exists (select 1 from public.storico_prezzi s
                    where s.alias_id = a.id and s.documento_id = p_documento_id);
    continue when not found;
    v_conf := least(greatest(coalesce(app.num(d->>'confidenza'), 0), 0), 1);
    v_fatt := app.num(d->>'fattore_conversione');
    if v_fatt is not null and v_fatt <= 0 then v_fatt := null; end if;

    if d->>'decisione' = 'master' then
      select m.id into v_master from public.articoli_master m
       where m.id = app.uuid_sicuro(d->>'master_id') and m.gruppo_id = v_g.id;
      continue when v_master is null;
      if v_conf >= v_g.soglia_abbinamento_auto then
        perform app.assegna_master(v_alias.id, v_master, 'automatico', 'ia', v_conf, d->>'motivazione', v_fatt);
        v_auto := v_auto + 1;
      elsif v_conf >= v_g.soglia_abbinamento_proposta then
        update public.alias_articolo set
          master_proposto_id = v_master, stato_abbinamento = 'proposto', metodo = 'ia',
          confidenza = v_conf, motivazione = left(d->>'motivazione', 500), fattore_proposto = v_fatt
        where id = v_alias.id;
        v_prop := v_prop + 1;
      else
        update public.alias_articolo set
          metodo = 'ia', confidenza = v_conf, motivazione = left(d->>'motivazione', 500)
        where id = v_alias.id;
      end if;

    elsif d->>'decisione' = 'nuovo' then
      v_nuovo := coalesce(d->'nuovo', '{}'::jsonb);
      continue when coalesce(btrim(v_nuovo->>'nome'), '') = '';
      v_ub := case when v_nuovo->>'unita_base' in ('kg', 'lt', 'pz', 'mt', 'conf') then v_nuovo->>'unita_base'
                   else coalesce((app.um_base(v_alias.unita_misura)).base, 'pz') end;
      insert into public.articoli_master (gruppo_id, categoria_id, nome, unita_base, stato)
      values (v_g.id, app.categoria_id(v_g.id, v_nuovo->>'categoria'), left(btrim(v_nuovo->>'nome'), 120), v_ub, 'bozza')
      on conflict (gruppo_id, nome_norm) do update set nome = public.articoli_master.nome
      returning id into v_master;
      perform app.assegna_master(v_alias.id, v_master, 'automatico', 'ia_nuovo', v_conf, d->>'motivazione', v_fatt);
      v_nuovi := v_nuovi + 1;
    end if;
  end loop;

  return jsonb_build_object('documento_id', p_documento_id, 'automatici', v_auto,
                            'proposti', v_prop, 'nuovi_master', v_nuovi);
end $$;

create or replace function public.completa_documento(p_documento_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_d public.documenti;
begin
  select * into v_d from public.documenti where id = p_documento_id for update;
  if not found then raise exception 'Documento % inesistente', p_documento_id; end if;
  if v_d.stato = 'duplicato' then
    return jsonb_build_object('documento_id', p_documento_id, 'stato', 'duplicato');
  end if;
  if not (v_d.stato = 'elaborazione' or (v_d.stato = 'errore' and v_d.errore_codice = 'timeout'))
     or v_d.fornitore_id is null then
    raise exception 'Documento % non completabile (stato: %)', p_documento_id, v_d.stato;
  end if;
  update public.documenti
     set stato = 'completato', fase = null, errore = null, errore_codice = null, completato_il = now()
   where id = p_documento_id;
  perform app.ricalcola_documento(p_documento_id);
  return jsonb_build_object(
    'documento_id', p_documento_id, 'stato', 'completato',
    'n_anomalie', (select d.n_anomalie from public.documenti d where d.id = p_documento_id),
    'da_validare', (select count(distinct a.id) from public.storico_prezzi s
                      join public.alias_articolo a on a.id = s.alias_id
                     where s.documento_id = p_documento_id
                       and a.stato_abbinamento in ('da_abbinare', 'proposto')));
end $$;

-- ── RPC di servizio: tassi BCE ─────────────────────────────────────────────
create or replace function public.registra_tassi(p_tassi jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int; r record;
begin
  insert into public.tassi_cambio (data, valuta, tasso)
  select (t->>'data')::date, upper(t->>'valuta'), (t->>'tasso')::numeric
    from jsonb_array_elements(coalesce(p_tassi, '[]'::jsonb)) t
   where t->>'data' ~ '^\d{4}-\d{2}-\d{2}$' and t->>'valuta' ~ '^[A-Za-z]{3}$' and app.num(t->>'tasso') > 0
  on conflict (valuta, data) do update set tasso = excluded.tasso
   where public.tassi_cambio.tasso is distinct from excluded.tasso;
  get diagnostics v_n = row_count;

  -- Completa i controvalori in EUR rimasti in sospeso per mancanza del tasso.
  for r in select distinct s.ristorante_id, s.documento_id from public.storico_prezzi s
            where s.valuta <> 'EUR' and s.tasso_cambio is null loop
    perform app.aggiorna_eur_documento(r.documento_id);
    perform app.ricalcola_documento(r.documento_id);
  end loop;
  return v_n;
end $$;

-- ── RPC utente: validazione abbinamenti e catalogo ─────────────────────────
create or replace function public.crea_master(
  p_gruppo_id uuid, p_nome text, p_categoria text, p_unita_base text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_titolare boolean;
begin
  perform app.richiedi(app.ha_ruolo_gruppo(p_gruppo_id, array['titolare', 'chef']::public.ruolo_membro[]));
  v_titolare := app.ha_ruolo_gruppo(p_gruppo_id, array['titolare']::public.ruolo_membro[]);
  if coalesce(btrim(p_nome), '') = '' then raise exception 'Il nome è obbligatorio' using errcode = '22023'; end if;
  if p_unita_base is null or p_unita_base not in ('kg', 'lt', 'pz', 'mt', 'conf') then
    raise exception 'Unità base non valida' using errcode = '22023';
  end if;
  -- Il catalogo è del gruppo: lo chef propone (bozza), il titolare approva.
  insert into public.articoli_master (gruppo_id, categoria_id, nome, unita_base, stato, creato_da,
                                      approvato_da, approvato_il)
  values (p_gruppo_id, app.categoria_id(p_gruppo_id, p_categoria), left(btrim(p_nome), 120), p_unita_base,
          case when v_titolare then 'attivo' else 'bozza' end, auth.uid(),
          case when v_titolare then auth.uid() end, case when v_titolare then now() end)
  on conflict (gruppo_id, nome_norm) do update set nome = public.articoli_master.nome
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.conferma_abbinamento(
  p_alias_id uuid, p_master_id uuid, p_fattore numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_alias public.alias_articolo; v_vecchio uuid;
begin
  select * into v_alias from public.alias_articolo where id = p_alias_id;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_alias.gruppo_id,
            array['titolare', 'chef']::public.ruolo_membro[]));
  if not exists (select 1 from public.articoli_master m
                  where m.id = p_master_id and m.gruppo_id = v_alias.gruppo_id) then
    raise exception 'Articolo master non valido' using errcode = '22023';
  end if;
  v_vecchio := app.assegna_master(p_alias_id, p_master_id, 'confermato', 'manuale', 1,
                 'Confermato manualmente', coalesce(p_fattore, v_alias.fattore_proposto), auth.uid());
  perform app.ricalcola_alias(p_alias_id, array[v_vecchio, p_master_id]);
end $$;

create or replace function public.rifiuta_proposta(p_alias_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_alias public.alias_articolo;
begin
  select * into v_alias from public.alias_articolo where id = p_alias_id;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_alias.gruppo_id,
            array['titolare', 'chef']::public.ruolo_membro[]));
  update public.alias_articolo
     set master_proposto_id = null, fattore_proposto = null, stato_abbinamento = 'da_abbinare',
         motivazione = 'Proposta rifiutata'
   where id = p_alias_id and stato_abbinamento = 'proposto';
end $$;

-- Revoca: l'alias torna da abbinare e lo storico collegato viene ricalcolato.
create or replace function public.revoca_abbinamento(p_alias_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_alias public.alias_articolo;
begin
  select * into v_alias from public.alias_articolo where id = p_alias_id;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_alias.gruppo_id, array['titolare']::public.ruolo_membro[]));
  update public.alias_articolo
     set master_id = null, master_proposto_id = null, stato_abbinamento = 'da_abbinare', metodo = null,
         confidenza = null, motivazione = 'Abbinamento revocato', confermato_da = null, confermato_il = null
   where id = p_alias_id;
  update public.storico_prezzi set master_id = null where alias_id = p_alias_id and master_id is not null;
  perform app.ricalcola_alias(p_alias_id, array[v_alias.master_id]);
end $$;

create or replace function public.approva_master(
  p_master_id uuid, p_nome text default null, p_categoria text default null, p_unita_base text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_m public.articoli_master; v_rist uuid;
begin
  select * into v_m from public.articoli_master where id = p_master_id for update;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_m.gruppo_id, array['titolare']::public.ruolo_membro[]));
  if p_unita_base is not null and p_unita_base not in ('kg', 'lt', 'pz', 'mt', 'conf') then
    raise exception 'Unità base non valida' using errcode = '22023';
  end if;
  if nullif(btrim(p_nome), '') is not null and exists (
       select 1 from public.articoli_master x
        where x.gruppo_id = v_m.gruppo_id and x.id <> p_master_id and x.nome_norm = app.norm_testo(p_nome)) then
    raise exception 'Esiste già un articolo master con questo nome: usa "Unisci"' using errcode = '23505';
  end if;
  update public.articoli_master set
    nome = coalesce(left(nullif(btrim(p_nome), ''), 120), nome),
    categoria_id = coalesce(app.categoria_id(v_m.gruppo_id, p_categoria), categoria_id),
    unita_base = coalesce(p_unita_base, unita_base),
    embedding = case when nullif(btrim(p_nome), '') is not null and app.norm_testo(p_nome) <> nome_norm
                     then null else embedding end,
    stato = 'attivo',
    approvato_da = coalesce(approvato_da, auth.uid()),
    approvato_il = coalesce(approvato_il, now())
  where id = p_master_id;
  if p_unita_base is not null and p_unita_base <> v_m.unita_base then
    for v_rist in select distinct s.ristorante_id from public.storico_prezzi s where s.master_id = p_master_id loop
      perform app.ricalcola_serie(v_rist, '{}', array[p_master_id]);
    end loop;
  end if;
end $$;

-- Unisce un master (di solito una bozza doppia) in un altro: alias e storico passano al secondo.
create or replace function public.unisci_master(p_da uuid, p_verso uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_da public.articoli_master; v_rist uuid;
begin
  select * into v_da from public.articoli_master where id = p_da for update;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_da.gruppo_id, array['titolare']::public.ruolo_membro[]));
  if p_da = p_verso or not exists (select 1 from public.articoli_master m
                                    where m.id = p_verso and m.gruppo_id = v_da.gruppo_id) then
    raise exception 'Articolo master di destinazione non valido' using errcode = '22023';
  end if;
  update public.alias_articolo set master_id = p_verso where master_id = p_da;
  update public.alias_articolo set master_proposto_id = p_verso where master_proposto_id = p_da;
  update public.storico_prezzi set master_id = p_verso where master_id = p_da;
  delete from public.articoli_master where id = p_da;
  for v_rist in select distinct s.ristorante_id from public.storico_prezzi s where s.master_id = p_verso loop
    perform app.ricalcola_serie(v_rist, '{}', array[p_verso]);
  end loop;
end $$;

-- ── RPC utente: correzioni manuali (tracciate dall'audit) ──────────────────
create or replace function public.correggi_riga(p_riga_id uuid, p_campi jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c_ammessi constant text[] := array['descrizione', 'quantita', 'unita_misura', 'prezzo_unitario',
    'sconto_percentuale', 'totale_riga', 'aliquota_iva', 'peso_netto_kg', 'contenuto_per_unita', 'unita_contenuto'];
  v_r public.storico_prezzi; k text;
begin
  select * into v_r from public.storico_prezzi where id = p_riga_id for update;
  perform app.richiedi(found and app.ha_ruolo(v_r.ristorante_id,
            array['titolare', 'contabile', 'chef']::public.ruolo_membro[]));
  for k in select jsonb_object_keys(p_campi) loop
    if not (k = any (c_ammessi)) then
      raise exception 'Campo non modificabile: %', k using errcode = '22023';
    end if;
    if k not in ('descrizione', 'unita_misura', 'unita_contenuto')
       and p_campi->>k is not null and app.num(p_campi->>k) is null then
      raise exception 'Valore numerico non valido per %', k using errcode = '22023';
    end if;
  end loop;
  if p_campi ? 'prezzo_unitario' and coalesce(app.num(p_campi->>'prezzo_unitario'), -1) < 0 then
    raise exception 'Il prezzo unitario è obbligatorio' using errcode = '22023';
  end if;

  update public.storico_prezzi set
    descrizione = case when p_campi ? 'descrizione' then coalesce(nullif(btrim(p_campi->>'descrizione'), ''), descrizione) else descrizione end,
    quantita = case when p_campi ? 'quantita' then app.num(p_campi->>'quantita') else quantita end,
    unita_misura = case when p_campi ? 'unita_misura' then nullif(lower(btrim(p_campi->>'unita_misura')), '') else unita_misura end,
    prezzo_unitario = case when p_campi ? 'prezzo_unitario' then app.num(p_campi->>'prezzo_unitario') else prezzo_unitario end,
    sconto_percentuale = case when p_campi ? 'sconto_percentuale' then app.num(p_campi->>'sconto_percentuale') else sconto_percentuale end,
    totale_riga = case when p_campi ? 'totale_riga' then app.num(p_campi->>'totale_riga') else totale_riga end,
    aliquota_iva = case when p_campi ? 'aliquota_iva' then app.num(p_campi->>'aliquota_iva') else aliquota_iva end,
    peso_netto_kg = case when p_campi ? 'peso_netto_kg' then app.num(p_campi->>'peso_netto_kg') else peso_netto_kg end,
    contenuto_per_unita = case when p_campi ? 'contenuto_per_unita' then app.num(p_campi->>'contenuto_per_unita') else contenuto_per_unita end,
    unita_contenuto = case when p_campi ? 'unita_contenuto' then nullif(lower(btrim(p_campi->>'unita_contenuto')), '') else unita_contenuto end,
    corretto_manualmente = true
  where id = p_riga_id;

  perform app.ricalcola_serie(v_r.ristorante_id, array[v_r.alias_id],
                              array_remove(array[v_r.master_id], null));
end $$;

create or replace function public.correggi_documento(p_documento_id uuid, p_campi jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c_ammessi constant text[] := array['tipo', 'numero', 'data_documento', 'imponibile', 'iva', 'totale', 'valuta'];
  v_d public.documenti; k text; v_data date; v_valuta text;
begin
  select * into v_d from public.documenti where id = p_documento_id for update;
  perform app.richiedi(found and app.ha_ruolo(v_d.ristorante_id,
            array['titolare', 'contabile']::public.ruolo_membro[]));
  if v_d.stato <> 'completato' then
    raise exception 'Il documento non è ancora stato elaborato' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_campi) loop
    if not (k = any (c_ammessi)) then
      raise exception 'Campo non modificabile: %', k using errcode = '22023';
    end if;
  end loop;
  if p_campi ? 'tipo' and p_campi->>'tipo' not in ('Fattura', 'DDT', 'Nota di Credito', 'Altro') then
    raise exception 'Tipo documento non valido' using errcode = '22023';
  end if;
  if p_campi ? 'data_documento' and p_campi->>'data_documento' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Data non valida' using errcode = '22023';
  end if;
  if p_campi ? 'valuta' and p_campi->>'valuta' !~ '^[A-Za-z]{3}$' then
    raise exception 'Valuta non valida' using errcode = '22023';
  end if;
  v_data := case when p_campi ? 'data_documento' then (p_campi->>'data_documento')::date else v_d.data_documento end;
  v_valuta := case when p_campi ? 'valuta' then upper(p_campi->>'valuta') else v_d.valuta end;

  update public.documenti set
    tipo = case when p_campi ? 'tipo' then p_campi->>'tipo' else tipo end,
    numero = case when p_campi ? 'numero' then nullif(btrim(p_campi->>'numero'), '') else numero end,
    data_documento = v_data,
    valuta = v_valuta,
    imponibile = case when p_campi ? 'imponibile' then app.num(p_campi->>'imponibile') else imponibile end,
    iva = case when p_campi ? 'iva' then app.num(p_campi->>'iva') else iva end,
    totale = case when p_campi ? 'totale' then app.num(p_campi->>'totale') else totale end,
    corretto_manualmente = true
  where id = p_documento_id;

  update public.storico_prezzi
     set data_rilevazione = coalesce(v_data::timestamptz, data_rilevazione), valuta = v_valuta
   where documento_id = p_documento_id
     and (valuta <> v_valuta or data_rilevazione is distinct from coalesce(v_data::timestamptz, data_rilevazione));
  perform app.aggiorna_eur_documento(p_documento_id);
  perform app.ricalcola_documento(p_documento_id);
end $$;

-- Il titolare approva il rincaro; chef e contabile possono contestarlo o riaprirlo.
create or replace function public.gestisci_anomalia(p_riga_id uuid, p_stato text, p_nota text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.storico_prezzi;
begin
  select * into v_r from public.storico_prezzi where id = p_riga_id for update;
  perform app.richiedi(found and app.ha_ruolo(v_r.ristorante_id,
            case when p_stato = 'accettata' then array['titolare']::public.ruolo_membro[]
                 else array['titolare', 'chef', 'contabile']::public.ruolo_membro[] end),
          case when p_stato = 'accettata' then 'Solo il titolare può approvare un rincaro' else 'Permesso negato' end);
  if p_stato is null or p_stato not in ('aperta', 'accettata', 'contestata') or not v_r.anomalia_prezzo then
    raise exception 'Operazione non valida su questa riga' using errcode = '22023';
  end if;
  update public.storico_prezzi
     set anomalia_stato = p_stato, anomalia_nota = left(nullif(btrim(p_nota), ''), 500),
         anomalia_gestita_da = auth.uid(), anomalia_gestita_il = now()
   where id = p_riga_id;
end $$;

-- ── Archivio mensile dell'audit (cold storage) ─────────────────────────────
insert into storage.buckets (id, name, public) values ('archivio-audit', 'archivio-audit', false)
on conflict (id) do nothing;

create or replace function public.audit_esporta(p_da timestamptz, p_a timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'gruppo_id', g.gruppo_id, 'da', p_da, 'a', p_a, 'righe', g.n,
           'primo_seq', g.primo, 'ultimo_seq', g.ultimo, 'ultimo_hash', g.ultimo_hash, 'registro', g.registro)),
         '[]'::jsonb)
    from (select a.gruppo_id, count(*) as n, min(a.seq) as primo, max(a.seq) as ultimo,
                 (array_agg(a.hash order by a.seq desc))[1] as ultimo_hash,
                 jsonb_agg(to_jsonb(a) order by a.seq) as registro
            from public.audit_log a
           where a.creato_il >= p_da and a.creato_il < p_a
           group by a.gruppo_id) g
$$;

-- ── Viste (security_invoker: vale la RLS delle tabelle) ────────────────────
create view public.v_righe with (security_invoker = true) as
select sp.*, a.codice_articolo, a.stato_abbinamento, a.fattore_conversione, a.master_proposto_id,
       a.confidenza as abbinamento_confidenza, a.metodo as abbinamento_metodo,
       m.nome as master_nome, m.stato as master_stato, m.unita_base as master_unita_base,
       c.nome as categoria, d.numero, d.data_documento, d.tipo, d.stato as documento_stato,
       f.ragione_sociale, f.paese
  from public.storico_prezzi sp
  join public.alias_articolo a on a.id = sp.alias_id
  join public.documenti d on d.id = sp.documento_id
  join public.fornitori f on f.id = sp.fornitore_id
  left join public.articoli_master m on m.id = sp.master_id
  left join public.categorie_master c on c.id = m.categoria_id;

create view public.v_anomalie with (security_invoker = true) as
select *, round(totale_riga_eur * variazione_pct / (100 + variazione_pct), 2) as impatto_eur
  from public.v_righe
 where anomalia_prezzo and documento_stato = 'completato';

-- Coda "Da validare": alias senza abbinamento confermato, con l'ultima riga come esempio.
create view public.v_coda_alias with (security_invoker = true) as
select a.id, a.gruppo_id, a.fornitore_id, a.codice_articolo, a.descrizione_normalizzata,
       a.descrizione_originale, a.unita_misura, a.stato_abbinamento, a.metodo, a.confidenza, a.motivazione,
       a.master_proposto_id, a.fattore_proposto, a.created_at,
       f.ragione_sociale, f.paese,
       mp.nome as proposto_nome, mp.unita_base as proposto_unita_base, cp.nome as proposto_categoria,
       u.ristorante_id, u.documento_id, u.quantita, u.prezzo_unitario, u.valuta, u.peso_netto_kg,
       u.contenuto_per_unita, u.unita_contenuto, u.data_rilevazione
  from public.alias_articolo a
  join public.fornitori f on f.id = a.fornitore_id
  left join public.articoli_master mp on mp.id = a.master_proposto_id
  left join public.categorie_master cp on cp.id = mp.categoria_id
  join lateral (select s.* from public.storico_prezzi s where s.alias_id = a.id
                 order by s.data_rilevazione desc limit 1) u on true
 where a.stato_abbinamento in ('da_abbinare', 'proposto');

create view public.v_catalogo with (security_invoker = true) as
select m.id, m.gruppo_id, m.nome, m.unita_base, m.stato, m.note, m.creato_il, c.nome as categoria,
       (select count(*) from public.alias_articolo a where a.master_id = m.id) as n_alias,
       (select count(distinct a.fornitore_id) from public.alias_articolo a where a.master_id = m.id) as n_fornitori,
       u.ristorante_id, u.prezzo_base as ultimo_prezzo_base, u.prezzo_netto as ultimo_prezzo_netto,
       u.unita_misura as ultima_unita, u.valuta as ultima_valuta, u.variazione_pct as ultima_variazione,
       u.data_rilevazione as ultimo_acquisto, u.fornitore_id as ultimo_fornitore_id
  from public.articoli_master m
  left join public.categorie_master c on c.id = m.categoria_id
  left join lateral (select s.* from public.storico_prezzi s where s.master_id = m.id
                      order by s.data_rilevazione desc, s.creato_il desc limit 1) u on true;

revoke all on public.v_righe, public.v_anomalie, public.v_coda_alias, public.v_catalogo from anon, authenticated;
grant select on public.v_righe, public.v_anomalie, public.v_coda_alias, public.v_catalogo to authenticated;

-- ── Cruscotto esecutivo (security invoker: rispetta la RLS) ────────────────
-- Spesa = imponibile delle fatture meno le note di credito, in EUR. I DDT non
-- vengono sommati per non contare due volte la stessa consegna.
create or replace function public.cruscotto(p_ristorante_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  with doc as (
    select d.*, coalesce(d.data_documento, d.created_at::date) as giorno,
           case d.tipo when 'Fattura' then 1 when 'Nota di Credito' then -1 else 0 end
             * coalesce(d.imponibile_eur, d.totale_eur, 0) as spesa
      from public.documenti d
     where d.ristorante_id = p_ristorante_id and d.stato = 'completato'
  ), anom as (
    select * from public.v_anomalie a where a.ristorante_id = p_ristorante_id
  ), sett as (
    select g::date as inizio,
           coalesce((select sum(doc.spesa) from doc where doc.giorno >= g::date and doc.giorno < g::date + 7), 0) as spesa
      from generate_series(date_trunc('week', current_date) - interval '11 weeks',
                           date_trunc('week', current_date), interval '1 week') g
  )
  select jsonb_build_object(
    'spesa_30g', (select coalesce(sum(spesa), 0) from doc where giorno > current_date - 30),
    'spesa_30g_prec', (select coalesce(sum(spesa), 0) from doc
                        where giorno > current_date - 60 and giorno <= current_date - 30),
    'documenti_30g', (select count(*) from doc where giorno > current_date - 30),
    'in_lavorazione', (select count(*) from public.documenti d
                        where d.ristorante_id = p_ristorante_id and d.stato in ('in_coda', 'elaborazione')),
    'errori', (select count(*) from public.documenti d
                where d.ristorante_id = p_ristorante_id and d.stato = 'errore'),
    'rincari_aperti', (select count(*) from anom where anomalia_stato = 'aperta'),
    'rincari_contestati', (select count(*) from anom where anomalia_stato = 'contestata'),
    'impatto_rincari', (select coalesce(sum(impatto_eur), 0) from anom where anomalia_stato in ('aperta', 'contestata')),
    'risparmi_90g', (select coalesce(sum(-r.totale_riga_eur * r.variazione_pct / (100 + r.variazione_pct)), 0)
                       from public.v_righe r
                      where r.ristorante_id = p_ristorante_id and r.documento_stato = 'completato'
                        and r.variazione_pct < 0 and r.data_rilevazione > now() - interval '90 days'),
    'da_validare', (select count(*) from public.v_coda_alias q where q.ristorante_id = p_ristorante_id),
    'master_in_bozza', (select count(*) from public.articoli_master m
                         where m.stato = 'bozza'
                           and m.gruppo_id = (select r.gruppo_id from public.ristoranti r where r.id = p_ristorante_id)),
    'fornitori_attivi', (select count(*) from public.fornitori_ristorante fr
                          where fr.ristorante_id = p_ristorante_id and fr.attivo),
    'settimane', (select jsonb_agg(jsonb_build_object('inizio', inizio, 'spesa', spesa) order by inizio) from sett),
    'top_fornitori', (select coalesce(jsonb_agg(x order by x.spesa desc), '[]'::jsonb) from (
        select f.ragione_sociale, f.paese, sum(doc.spesa) as spesa, count(*) as documenti
          from doc join public.fornitori f on f.id = doc.fornitore_id
         where doc.giorno > current_date - 90
         group by f.id order by sum(doc.spesa) desc limit 6) x),
    'categorie', (select coalesce(jsonb_agg(x order by x.spesa desc), '[]'::jsonb) from (
        select coalesce(r.categoria, 'Non classificato') as categoria, sum(r.totale_riga_eur) as spesa
          from public.v_righe r
         where r.ristorante_id = p_ristorante_id and r.documento_stato = 'completato'
           and r.tipo = 'Fattura' and r.data_rilevazione > now() - interval '90 days'
         group by 1 order by 2 desc nulls last limit 8) x)
  )
$$;

-- ── Privilegi ──────────────────────────────────────────────────────────────
revoke all on function
  public.registra_documento(uuid, jsonb), public.embedding_mancanti(int), public.salva_embedding(jsonb),
  public.prepara_abbinamento(uuid), public.applica_abbinamenti(uuid, jsonb), public.completa_documento(uuid),
  public.registra_tassi(jsonb), public.audit_esporta(timestamptz, timestamptz),
  public.crea_master(uuid, text, text, text), public.conferma_abbinamento(uuid, uuid, numeric),
  public.rifiuta_proposta(uuid), public.revoca_abbinamento(uuid),
  public.approva_master(uuid, text, text, text), public.unisci_master(uuid, uuid),
  public.correggi_riga(uuid, jsonb), public.correggi_documento(uuid, jsonb),
  public.gestisci_anomalia(uuid, text, text), public.cruscotto(uuid)
  from public, anon, authenticated;
grant execute on function
  public.registra_documento(uuid, jsonb), public.embedding_mancanti(int), public.salva_embedding(jsonb),
  public.prepara_abbinamento(uuid), public.applica_abbinamenti(uuid, jsonb), public.completa_documento(uuid),
  public.registra_tassi(jsonb), public.audit_esporta(timestamptz, timestamptz)
  to service_role;
grant execute on function
  public.crea_master(uuid, text, text, text), public.conferma_abbinamento(uuid, uuid, numeric),
  public.rifiuta_proposta(uuid), public.revoca_abbinamento(uuid),
  public.approva_master(uuid, text, text, text), public.unisci_master(uuid, uuid),
  public.correggi_riga(uuid, jsonb), public.correggi_documento(uuid, jsonb),
  public.gestisci_anomalia(uuid, text, text), public.cruscotto(uuid)
  to authenticated;

-- Schema app: agli utenti servono solo le funzioni usate dalle policy RLS.
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid),
  app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]) to authenticated;

-- ── Dati esistenti: ricalcolo con le nuove regole ──────────────────────────
do $$
declare d record;
begin
  for d in select id from public.documenti where stato = 'completato' order by data_documento nulls last, created_at loop
    perform app.aggiorna_eur_documento(d.id);
    perform app.ricalcola_documento(d.id);
  end loop;
end $$;
