-- ═══════════════════════════════════════════════════════════════════════════
-- Autocontrollo · 1 — accessi per ruolo, persone con PIN, archivio documenti
-- versionato, scadenzario unico, conservazione minima dei registri
-- ═══════════════════════════════════════════════════════════════════════════
-- Nessun dato esistente viene modificato. Le funzioni di accesso vengono ridefinite
-- in modo che i due nuovi ruoli NON vedano dati economici (fatture, prezzi, costi,
-- margini, magazzino); per i ruoli esistenti il comportamento non cambia.

-- ── Accessi ────────────────────────────────────────────────────────────────
-- Membro con qualsiasi ruolo: serve a vedere nome della sede e del gruppo.
create or replace function app.membro_ristorante(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.ruolo_ristorante(p_ristorante_id) is not null
$$;
create or replace function app.membro_gruppo(p_gruppo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid()))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid()))
$$;

-- Accesso "completo" (acquisti, prezzi, magazzino, ricette…): esclude consulente e cucina.
create or replace function app.ha_accesso_ristorante(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.ruolo_ristorante(p_ristorante_id) not in ('consulente', 'cucina'), false)
$$;
create or replace function app.ha_accesso_gruppo(p_gruppo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid())
                    and mg.ruolo not in ('consulente', 'cucina'))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid())
                    and mr.ruolo not in ('consulente', 'cucina'))
$$;

-- Autocontrollo: titolare, chef, sola lettura, consulente, cucina. Il contabile no.
create or replace function app.vede_autocontrollo(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.ruolo_ristorante(p_ristorante_id) in ('titolare', 'chef', 'sola_lettura', 'consulente', 'cucina'), false)
$$;
create or replace function app.vede_autocontrollo_gruppo(p_gruppo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid())
                    and mg.ruolo in ('titolare', 'chef', 'sola_lettura', 'consulente', 'cucina'))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid())
                    and mr.ruolo in ('titolare', 'chef', 'sola_lettura', 'consulente', 'cucina'))
$$;

alter policy "gruppi: lettura membri" on public.gruppi using (app.membro_gruppo(id));
alter policy "ristoranti: lettura membri" on public.ristoranti using (app.membro_ristorante(id));
alter policy "abbonamenti: lettura gruppo" on public.abbonamenti using (app.membro_gruppo(gruppo_id));
-- Anagrafiche senza prezzi, necessarie per collegare schede tecniche e dichiarazioni.
alter policy "fornitori: lettura gruppo" on public.fornitori
  using (app.ha_accesso_gruppo(gruppo_id) or app.vede_autocontrollo_gruppo(gruppo_id));
alter policy "master: lettura gruppo" on public.articoli_master
  using (app.ha_accesso_gruppo(gruppo_id) or app.vede_autocontrollo_gruppo(gruppo_id));
alter policy "categorie: lettura gruppo" on public.categorie_master
  using (app.ha_accesso_gruppo(gruppo_id) or app.vede_autocontrollo_gruppo(gruppo_id));
-- Celle e manutenzione fanno parte dell'autocontrollo: il contabile non le vedeva già per scopo,
-- ora sono esplicitamente riservate ai ruoli dell'autocontrollo.
alter policy "ubicazioni: lettura sede" on public.ubicazioni using (app.vede_autocontrollo(ristorante_id));
alter policy "sensori: lettura sede" on public.sensori using (app.vede_autocontrollo(ristorante_id));
alter policy "letture: lettura sede" on public.letture using (app.vede_autocontrollo(ristorante_id));
alter policy "allarmi: lettura sede" on public.allarmi using (app.vede_autocontrollo(ristorante_id));
alter policy "attrezzature: lettura sede" on public.attrezzature using (app.vede_autocontrollo(ristorante_id));
alter policy "manutenzioni_piani: lettura sede" on public.manutenzioni_piani using (app.vede_autocontrollo(ristorante_id));
alter policy "interventi: lettura sede" on public.interventi using (app.vede_autocontrollo(ristorante_id));

-- Il piano lo vedono tutti i membri (serve a mostrare i moduli disponibili).
create or replace function public.piano_corrente(p_gruppo_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.membro_gruppo(p_gruppo_id));
  return (select jsonb_build_object(
      'piano', a.piano_codice, 'nome', p.nome, 'stato', app.stato_abbonamento(p_gruppo_id),
      'prova_fino_al', a.prova_fino_al, 'periodo_fine', a.periodo_fine, 'provider', a.provider,
      'funzioni', (select coalesce(jsonb_agg(pf.funzionalita_codice), '[]'::jsonb)
                     from public.piano_funzionalita pf where pf.piano_codice = a.piano_codice),
      'limiti', (select coalesce(jsonb_object_agg(pl.chiave, pl.valore), '{}'::jsonb)
                   from public.piano_limiti pl where pl.piano_codice = a.piano_codice),
      'utenti', (select count(distinct x.user_id) from (
                   select mg.user_id from public.membri_gruppo mg where mg.gruppo_id = p_gruppo_id
                   union select mr.user_id from public.membri_ristorante mr
                     join public.ristoranti r on r.id = mr.ristorante_id where r.gruppo_id = p_gruppo_id) x),
      'sedi', (select count(*) from public.ristoranti r where r.gruppo_id = p_gruppo_id))
    from public.abbonamenti a join public.piani p on p.codice = a.piano_codice
   where a.gruppo_id = p_gruppo_id);
end $$;

-- Funzione di piano: inclusa dove ci sono celle e manutenzione.
insert into public.funzionalita (codice, nome, descrizione) values
  ('autocontrollo', 'Autocontrollo HACCP', 'Manuale, documenti, persone e PIN, scadenzario, registri');
insert into public.piano_funzionalita (piano_codice, funzionalita_codice) values
  ('operativo', 'autocontrollo'), ('completo', 'autocontrollo');

-- Conservazione minima dei registri di autocontrollo, in anni. Il valore 2 è l'indicazione
-- ricevuta dal consulente HACCP del titolare; non può essere abbassato sotto 2.
alter table public.gruppi add column conservazione_anni int not null default 2 check (conservazione_anni >= 2);

-- ── Persone (dipendenti, anche senza account) e PIN ───────────────────────
create table public.persone (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  nome text not null check (btrim(nome) <> ''),
  mansione text,
  user_id uuid references auth.users(id) on delete set null,
  attiva boolean not null default true,
  note text,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, nome)
);
-- PIN: solo l'hash; tentativi falliti e blocco temporaneo. Nessun privilegio per i ruoli API.
create table public.persone_pin (
  persona_id uuid primary key references public.persone(id) on delete cascade,
  pin_hash text not null,
  tentativi_falliti int not null default 0,
  bloccato_fino timestamptz,
  impostato_il timestamptz not null default now()
);
-- Le persone non si cancellano: firmano registrazioni che vanno conservate. Si disattivano.
create trigger persone_non_cancellabili before delete on public.persone
  for each row execute function app.immutabile();

create or replace function app.hash_pin(p_persona_id uuid, p_pin text) returns text
language sql immutable set search_path = '' as $$ select app.hash_token(p_persona_id::text || ':' || p_pin) $$;

create or replace function public.salva_persona(p_ristorante_id uuid, p_dati jsonb, p_persona_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_persona_id;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if v_id is null then
    if coalesce(btrim(p_dati->>'nome'), '') = '' then raise exception 'Indica nome e cognome' using errcode = '22023'; end if;
    insert into public.persone (ristorante_id, nome) values (p_ristorante_id, btrim(p_dati->>'nome')) returning id into v_id;
  elsif not exists (select 1 from public.persone where id = v_id and ristorante_id = p_ristorante_id) then
    raise exception 'Persona non trovata' using errcode = 'P0002';
  end if;
  update public.persone set
    nome = coalesce(nullif(btrim(p_dati->>'nome'), ''), nome),
    mansione = case when p_dati ? 'mansione' then nullif(btrim(p_dati->>'mansione'), '') else mansione end,
    note = case when p_dati ? 'note' then nullif(btrim(p_dati->>'note'), '') else note end,
    attiva = case when p_dati ? 'attiva' then (p_dati->>'attiva')::boolean else attiva end
  where id = v_id;
  return v_id;
end $$;

-- Imposta o reimposta il PIN. Il PIN non viene mai restituito né registrato.
create or replace function public.imposta_pin(p_persona_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.persone;
begin
  select * into p from public.persone where id = p_persona_id;
  perform app.richiedi(found);
  perform app.richiedi_op(p.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'autocontrollo');
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then raise exception 'Il PIN deve avere da 4 a 8 cifre' using errcode = '22023'; end if;
  if p_pin ~ '^(.)\1+$' or '0123456789012345678' like '%' || p_pin || '%' or '9876543210987654321' like '%' || p_pin || '%' then
    raise exception 'PIN troppo semplice: evita cifre tutte uguali o in sequenza' using errcode = '22023';
  end if;
  insert into public.persone_pin (persona_id, pin_hash) values (p.id, app.hash_pin(p.id, p_pin))
  on conflict (persona_id) do update set pin_hash = excluded.pin_hash, tentativi_falliti = 0, bloccato_fino = null, impostato_il = now();
end $$;

-- Verifica l'operatore. NON solleva eccezioni sul PIN errato, così il conteggio dei tentativi
-- viene salvato: 5 errori consecutivi bloccano la persona per 15 minuti.
create or replace function app.verifica_operatore(p_ristorante_id uuid, p_persona_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.persone; k public.persone_pin;
begin
  select * into p from public.persone where id = p_persona_id and ristorante_id = p_ristorante_id;
  if not found or not p.attiva then return jsonb_build_object('ok', false, 'motivo', 'Persona non attiva in questa sede'); end if;
  select * into k from public.persone_pin where persona_id = p.id for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'PIN non ancora impostato: chiedi al titolare'); end if;
  if k.bloccato_fino is not null and k.bloccato_fino > now() then
    return jsonb_build_object('ok', false, 'motivo', 'Troppi tentativi: riprova dopo le ' || to_char(k.bloccato_fino at time zone 'Europe/Rome', 'HH24:MI'));
  end if;
  if k.pin_hash <> app.hash_pin(p.id, coalesce(p_pin, '')) then
    update public.persone_pin set tentativi_falliti = tentativi_falliti + 1,
           bloccato_fino = case when tentativi_falliti + 1 >= 5 then now() + interval '15 minutes' end
     where persona_id = p.id;
    return jsonb_build_object('ok', false, 'motivo', 'PIN errato', 'tentativi_rimasti', greatest(0, 4 - k.tentativi_falliti));
  end if;
  update public.persone_pin set tentativi_falliti = 0, bloccato_fino = null where persona_id = p.id;
  return jsonb_build_object('ok', true, 'persona_id', p.id, 'nome', p.nome);
end $$;

create or replace function public.identifica_operatore(p_ristorante_id uuid, p_persona_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'cucina']::public.ruolo_membro[], 'autocontrollo');
  return app.verifica_operatore(p_ristorante_id, p_persona_id, p_pin);
end $$;

-- Chi ha già un PIN (senza esporre l'hash), per l'elenco delle persone.
create or replace function public.stato_pin(p_ristorante_id uuid)
returns table (persona_id uuid, impostato_il timestamptz, bloccato boolean)
language sql stable security definer set search_path = '' as $$
  select k.persona_id, k.impostato_il, coalesce(k.bloccato_fino > now(), false)
    from public.persone_pin k join public.persone p on p.id = k.persona_id
   where p.ristorante_id = p_ristorante_id and app.vede_autocontrollo(p_ristorante_id)
$$;

-- ── Archivio documenti (manuale, schede tecniche, MOCA, chimici, referti, attestati…) ──
create table public.archivio (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  categoria text not null check (categoria in (
    'manuale_autocontrollo', 'piano_analisi', 'referto_analisi', 'scheda_tecnica_prodotto', 'scheda_tecnica_imballaggio',
    'dichiarazione_moca', 'scheda_sicurezza_chimico', 'scheda_tecnica_trappole', 'contratto_infestanti', 'rapporto_infestanti',
    'planimetria', 'attestato_formazione', 'policy_igiene', 'normativa', 'altro')),
  titolo text not null check (btrim(titolo) <> ''),
  fornitore_id uuid references public.fornitori(id) on delete set null,
  master_id uuid references public.articoli_master(id) on delete set null,
  attrezzatura_id uuid references public.attrezzature(id) on delete set null,
  persona_id uuid references public.persone(id) on delete set null,
  scadenza date,
  note text,
  archiviato boolean not null default false,
  archiviato_motivo text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now()
);
create index on public.archivio (ristorante_id, categoria);
create table public.archivio_versioni (
  id uuid primary key default gen_random_uuid(),
  archivio_id uuid not null references public.archivio(id) on delete restrict,
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  versione int not null,
  revisione text,                 -- come la indica il documento (es. "Rev. 3")
  data_documento date,
  file_path text not null unique,
  nome_file text not null,
  mime text not null,
  dimensione bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  caricato_da uuid references auth.users(id) on delete set null,
  caricato_il timestamptz not null default now(),
  unique (archivio_id, versione),
  unique (archivio_id, sha256)
);
-- Le versioni non si modificano né si cancellano: una revisione nuova è una versione nuova.
create trigger archivio_versioni_immutabili before update or delete on public.archivio_versioni
  for each row execute function app.immutabile();
create trigger archivio_non_cancellabile before delete on public.archivio
  for each row execute function app.immutabile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('archivio', 'archivio', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "archivio: lettura autocontrollo" on storage.objects for select to authenticated
  using (bucket_id = 'archivio' and app.vede_autocontrollo(app.uuid_sicuro((storage.foldername(name))[1])));
create policy "archivio: caricamento" on storage.objects for insert to authenticated
  with check (bucket_id = 'archivio'
    and app.ha_ruolo(app.uuid_sicuro((storage.foldername(name))[1]), array['titolare', 'chef', 'consulente']::public.ruolo_membro[]));

-- Registra un file già caricato nello storage come nuova versione di un documento
-- (o crea il documento). Il file deve esistere e trovarsi nella cartella della sede.
create or replace function public.archivia_file(p_ristorante_id uuid, p_dati jsonb, p_archivio_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_archivio_id; v_ver uuid; v_n int; v_file jsonb := p_dati->'file';
  v_path text := v_file->>'path'; v_sha text := lower(v_file->>'sha256'); v_mime text := v_file->>'mime';
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if v_path is null or split_part(v_path, '/', 1) <> p_ristorante_id::text or v_path ~ '\.\.' then
    raise exception 'Percorso del file non valido' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'archivio' and o.name = v_path) then
    raise exception 'Il file non risulta caricato' using errcode = 'P0002';
  end if;
  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Formato non supportato: usa PDF, JPG, PNG o WEBP' using errcode = '22023';
  end if;
  if coalesce(app.num(v_file->>'dimensione'), 0) <= 0 or app.num(v_file->>'dimensione') > 26214400 then
    raise exception 'Dimensione non valida: massimo 25 MB' using errcode = '22023';
  end if;

  if v_id is null then
    if coalesce(btrim(p_dati->>'titolo'), '') = '' then raise exception 'Indica un titolo' using errcode = '22023'; end if;
    insert into public.archivio (ristorante_id, categoria, titolo, creato_da)
    values (p_ristorante_id, p_dati->>'categoria', btrim(p_dati->>'titolo'), auth.uid()) returning id into v_id;
  elsif not exists (select 1 from public.archivio where id = v_id and ristorante_id = p_ristorante_id and not archiviato) then
    raise exception 'Documento non trovato o archiviato' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.archivio_versioni where archivio_id = v_id and sha256 = v_sha) then
    raise exception 'Questo file è già presente tra le versioni del documento' using errcode = '23505';
  end if;
  perform public.aggiorna_archivio(v_id, p_dati - 'file' - 'categoria' - 'archiviato');
  select coalesce(max(versione), 0) + 1 into v_n from public.archivio_versioni where archivio_id = v_id;
  insert into public.archivio_versioni (archivio_id, ristorante_id, versione, revisione, data_documento, file_path, nome_file, mime, dimensione, sha256, caricato_da)
  values (v_id, p_ristorante_id, v_n, nullif(btrim(p_dati->>'revisione'), ''), nullif(p_dati->>'data_documento', '')::date,
          v_path, left(coalesce(nullif(btrim(v_file->>'nome'), ''), 'documento'), 200), v_mime, app.num(v_file->>'dimensione')::bigint, v_sha, auth.uid())
  returning id into v_ver;
  return jsonb_build_object('archivio_id', v_id, 'versione_id', v_ver, 'versione', v_n);
end $$;

create or replace function public.aggiorna_archivio(p_archivio_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.archivio; v_g uuid;
begin
  select * into a from public.archivio where id = p_archivio_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(a.ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  v_g := app.gruppo_di(a.ristorante_id);
  if app.uuid_sicuro(p_dati->>'fornitore_id') is not null and not exists (select 1 from public.fornitori f where f.id = app.uuid_sicuro(p_dati->>'fornitore_id') and f.gruppo_id = v_g)
     or app.uuid_sicuro(p_dati->>'master_id') is not null and not exists (select 1 from public.articoli_master m where m.id = app.uuid_sicuro(p_dati->>'master_id') and m.gruppo_id = v_g)
     or app.uuid_sicuro(p_dati->>'attrezzatura_id') is not null and not exists (select 1 from public.attrezzature x where x.id = app.uuid_sicuro(p_dati->>'attrezzatura_id') and x.ristorante_id = a.ristorante_id)
     or app.uuid_sicuro(p_dati->>'persona_id') is not null and not exists (select 1 from public.persone x where x.id = app.uuid_sicuro(p_dati->>'persona_id') and x.ristorante_id = a.ristorante_id) then
    raise exception 'Collegamento non valido' using errcode = '22023';
  end if;
  if (p_dati->>'archiviato')::boolean and coalesce(btrim(p_dati->>'archiviato_motivo'), '') = '' then
    raise exception 'Indica perché il documento viene archiviato' using errcode = '22023';
  end if;
  update public.archivio set
    titolo = coalesce(nullif(btrim(p_dati->>'titolo'), ''), titolo),
    fornitore_id = case when p_dati ? 'fornitore_id' then app.uuid_sicuro(p_dati->>'fornitore_id') else fornitore_id end,
    master_id = case when p_dati ? 'master_id' then app.uuid_sicuro(p_dati->>'master_id') else master_id end,
    attrezzatura_id = case when p_dati ? 'attrezzatura_id' then app.uuid_sicuro(p_dati->>'attrezzatura_id') else attrezzatura_id end,
    persona_id = case when p_dati ? 'persona_id' then app.uuid_sicuro(p_dati->>'persona_id') else persona_id end,
    scadenza = case when p_dati ? 'scadenza' then nullif(p_dati->>'scadenza', '')::date else scadenza end,
    note = case when p_dati ? 'note' then nullif(btrim(p_dati->>'note'), '') else note end,
    archiviato = case when p_dati ? 'archiviato' then (p_dati->>'archiviato')::boolean else archiviato end,
    archiviato_motivo = case when p_dati ? 'archiviato' then nullif(btrim(p_dati->>'archiviato_motivo'), '') else archiviato_motivo end
  where id = a.id;
end $$;

-- ── Scadenzario unico ──────────────────────────────────────────────────────
-- Documenti con scadenza e piani di manutenzione. Ogni blocco successivo (formazione,
-- analisi, infestanti) aggiunge qui le proprie scadenze.
create view public.v_scadenzario with (security_invoker = true) as
select a.ristorante_id, 'documento'::text as origine, a.id as riferimento_id, a.titolo, a.categoria as dettaglio,
       a.scadenza as data_scadenza, a.scadenza - (now() at time zone 'Europe/Rome')::date as giorni,
       case when a.scadenza < (now() at time zone 'Europe/Rome')::date then 'scaduta'
            when a.scadenza <= (now() at time zone 'Europe/Rome')::date + 30 then 'in_scadenza' else 'in_regola' end as stato
  from public.archivio a where a.scadenza is not null and not a.archiviato
union all
select m.ristorante_id, 'manutenzione', m.attrezzatura_id, m.attrezzatura || ' · ' || m.titolo, m.obbligo,
       m.prossima_data, m.giorni_mancanti,
       case when m.stato_scadenza = 'contatore_non_rilevato' then 'in_regola' else m.stato_scadenza end
  from public.v_scadenze_manutenzione m;

-- ── RLS, audit, privilegi ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['persone', 'archivio', 'archivio_versioni'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "%s: lettura autocontrollo" on public.%I for select to authenticated using (app.vede_autocontrollo(ristorante_id))', t, t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
alter table public.persone_pin enable row level security;
revoke all on public.persone_pin from public, anon, authenticated, service_role;
revoke all on public.v_scadenzario from anon, authenticated;
grant select on public.v_scadenzario to authenticated;

revoke all on function public.salva_persona(uuid, jsonb, uuid), public.imposta_pin(uuid, text), public.stato_pin(uuid),
  public.identifica_operatore(uuid, uuid, text), public.archivia_file(uuid, jsonb, uuid), public.aggiorna_archivio(uuid, jsonb)
  from public, anon;
grant execute on function public.salva_persona(uuid, jsonb, uuid), public.imposta_pin(uuid, text), public.stato_pin(uuid),
  public.identifica_operatore(uuid, uuid, text), public.archivia_file(uuid, jsonb, uuid), public.aggiorna_archivio(uuid, jsonb)
  to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid), app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]),
  app.converti(uuid, numeric, text, text), app.membro_ristorante(uuid), app.membro_gruppo(uuid),
  app.vede_autocontrollo(uuid), app.vede_autocontrollo_gruppo(uuid) to authenticated;
