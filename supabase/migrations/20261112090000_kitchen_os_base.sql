-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen OS · 1 — piani ed entitlements, inviti, conversioni di unità,
-- magazzino a registro di movimenti, celle e temperature
-- ═══════════════════════════════════════════════════════════════════════════
-- Migrazione additiva: nessun dato esistente viene modificato, salvo
-- l'assegnazione di un abbonamento ai gruppi già presenti (vedi sotto).
-- Regole comuni a tutti i moduli:
--  · lettura con RLS per sede; nessuna scrittura diretta dal client;
--  · ogni RPC verifica RUOLO e PIANO (app.richiedi_op);
--  · movimenti e letture sono immutabili: si correggono con uno storno.

-- ── Piani ed entitlements (nessun prezzo: solo struttura) ──────────────────
create table public.piani (
  codice text primary key,
  nome text not null,
  ordine int not null default 0,
  descrizione text,
  attivo boolean not null default true
);
create table public.funzionalita (
  codice text primary key,
  nome text not null,
  descrizione text
);
create table public.piano_funzionalita (
  piano_codice text not null references public.piani(codice) on delete cascade,
  funzionalita_codice text not null references public.funzionalita(codice) on delete cascade,
  primary key (piano_codice, funzionalita_codice)
);
-- valore NULL = nessun limite impostato. I limiti commerciali vanno decisi dal titolare del prodotto.
create table public.piano_limiti (
  piano_codice text not null references public.piani(codice) on delete cascade,
  chiave text not null check (chiave in ('sedi', 'utenti')),
  valore int check (valore is null or valore > 0),
  primary key (piano_codice, chiave)
);
create table public.abbonamenti (
  gruppo_id uuid primary key references public.gruppi(id) on delete cascade,
  piano_codice text not null references public.piani(codice),
  stato text not null check (stato in ('prova', 'attivo', 'scaduto', 'sospeso', 'annullato')),
  prova_fino_al timestamptz,
  periodo_fine timestamptz,
  provider text not null default 'manuale' check (provider in ('manuale', 'test', 'stripe')),
  provider_cliente_id text,
  provider_abbonamento_id text,
  aggiornato_il timestamptz not null default now()
);

insert into public.funzionalita (codice, nome, descrizione) values
  ('acquisti', 'Acquisti e prezzi', 'Documenti, catalogo master, validazione e rincari'),
  ('magazzino', 'Magazzino e lotti', 'Lotti, scadenze, movimenti, inventario, trasferimenti'),
  ('celle', 'Celle e temperature', 'Ubicazioni refrigerate, letture, sensori e allarmi'),
  ('manutenzione', 'Attrezzature e manutenzione', 'Anagrafica, piani e interventi'),
  ('ricette', 'Ricette e food cost', 'Ricette versionate, costi, vendite e scostamenti'),
  ('fornitori', 'Valutazione fornitori', 'Consegne, non conformità, indicatori e ordini proposti'),
  ('cantina', 'Cantina', 'Bottiglie, annate e finestre di consumo');
insert into public.piani (codice, nome, ordine, descrizione) values
  ('essenziale', 'Essenziale', 1, 'Controllo degli acquisti e dei prezzi'),
  ('operativo', 'Operativo', 2, 'Acquisti, magazzino, celle e manutenzione'),
  ('completo', 'Completo', 3, 'Tutti i moduli');
insert into public.piano_funzionalita (piano_codice, funzionalita_codice) values
  ('essenziale', 'acquisti'),
  ('operativo', 'acquisti'), ('operativo', 'magazzino'), ('operativo', 'celle'), ('operativo', 'manutenzione'),
  ('completo', 'acquisti'), ('completo', 'magazzino'), ('completo', 'celle'), ('completo', 'manutenzione'),
  ('completo', 'ricette'), ('completo', 'fornitori'), ('completo', 'cantina');
insert into public.piano_limiti (piano_codice, chiave, valore)
  select p.codice, k.chiave, null from public.piani p cross join (values ('sedi'), ('utenti')) k(chiave);

-- I gruppi esistenti ricevono il piano più ampio, assegnato a mano e senza scadenza:
-- nessuna funzione viene tolta a chi già usa l'app prima che esistano prezzi e condizioni.
insert into public.abbonamenti (gruppo_id, piano_codice, stato, provider)
  select g.id, 'completo', 'attivo', 'manuale' from public.gruppi g;

-- Un nuovo gruppo parte in prova sul piano più ampio. La durata della prova è una
-- scelta commerciale: finché prova_fino_al è vuoto la prova non scade.
create or replace function app.abbonamento_iniziale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.abbonamenti (gruppo_id, piano_codice, stato)
  select new.id, p.codice, 'prova' from public.piani p where p.attivo order by p.ordine desc limit 1
  on conflict do nothing;
  return new;
end $$;
create trigger gruppi_abbonamento after insert on public.gruppi
  for each row execute function app.abbonamento_iniziale();

-- Stato effettivo: una prova o un periodo oltre la data di fine valgono come scaduti.
create or replace function app.stato_abbonamento(p_gruppo_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when a.stato = 'prova' and a.prova_fino_al is not null and a.prova_fino_al < now() then 'scaduto'
    when a.stato = 'attivo' and a.periodo_fine is not null and a.periodo_fine < now() then 'scaduto'
    else a.stato end
  from public.abbonamenti a where a.gruppo_id = p_gruppo_id
$$;

-- Vero se il piano include la funzione E l'abbonamento consente di scrivere.
-- Alla scadenza o sospensione i dati restano leggibili (RLS), ma nessun modulo accetta scritture.
create or replace function app.ha_funzione(p_gruppo_id uuid, p_funzione text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.stato_abbonamento(p_gruppo_id) in ('prova', 'attivo'), false)
     and exists (select 1 from public.abbonamenti a
                   join public.piano_funzionalita pf on pf.piano_codice = a.piano_codice
                  where a.gruppo_id = p_gruppo_id and pf.funzionalita_codice = p_funzione)
$$;

create or replace function app.limite_piano(p_gruppo_id uuid, p_chiave text) returns int
language sql stable security definer set search_path = '' as $$
  select pl.valore from public.abbonamenti a
    join public.piano_limiti pl on pl.piano_codice = a.piano_codice and pl.chiave = p_chiave
   where a.gruppo_id = p_gruppo_id
$$;

-- Controllo unico per le operazioni dei moduli: il piano non aggira il ruolo e viceversa.
create or replace function app.richiedi_op(p_ristorante_id uuid, p_ruoli public.ruolo_membro[], p_funzione text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_gruppo uuid := app.gruppo_di(p_ristorante_id);
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, p_ruoli));
  if not app.ha_funzione(v_gruppo, p_funzione) then
    raise exception '%', case when app.stato_abbonamento(v_gruppo) in ('prova', 'attivo')
        then 'Funzione non inclusa nel piano attuale'
        else 'Abbonamento non attivo: i dati restano consultabili, ma non si possono registrare nuove operazioni' end
      using errcode = 'P0403';
  end if;
end $$;

-- Aggiornamento dell'abbonamento: solo dal backend (webhook del provider di pagamento o operatore).
create or replace function public.imposta_abbonamento(
  p_gruppo_id uuid, p_piano text, p_stato text, p_periodo_fine timestamptz default null,
  p_prova_fino_al timestamptz default null, p_provider text default 'manuale',
  p_provider_cliente_id text default null, p_provider_abbonamento_id text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.abbonamenti (gruppo_id, piano_codice, stato, periodo_fine, prova_fino_al, provider,
                                  provider_cliente_id, provider_abbonamento_id, aggiornato_il)
  values (p_gruppo_id, p_piano, p_stato, p_periodo_fine, p_prova_fino_al, p_provider,
          p_provider_cliente_id, p_provider_abbonamento_id, now())
  on conflict (gruppo_id) do update set
    piano_codice = excluded.piano_codice, stato = excluded.stato, periodo_fine = excluded.periodo_fine,
    prova_fino_al = excluded.prova_fino_al, provider = excluded.provider,
    provider_cliente_id = coalesce(excluded.provider_cliente_id, public.abbonamenti.provider_cliente_id),
    provider_abbonamento_id = coalesce(excluded.provider_abbonamento_id, public.abbonamenti.provider_abbonamento_id),
    aggiornato_il = now()
$$;

create or replace function public.piano_corrente(p_gruppo_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_accesso_gruppo(p_gruppo_id));
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

-- Il caricamento di documenti è la funzione base: richiede un abbonamento che consenta scritture.
create or replace function app.blocca_caricamento_senza_piano() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not app.ha_funzione(app.gruppo_di(new.ristorante_id), 'acquisti') then
    raise exception 'Abbonamento non attivo: i dati restano consultabili, ma non si possono caricare nuovi documenti'
      using errcode = 'P0403';
  end if;
  return new;
end $$;
create trigger documenti_piano before insert on public.documenti
  for each row execute function app.blocca_caricamento_senza_piano();

alter table public.piani enable row level security;
alter table public.funzionalita enable row level security;
alter table public.piano_funzionalita enable row level security;
alter table public.piano_limiti enable row level security;
alter table public.abbonamenti enable row level security;
revoke all on public.piani, public.funzionalita, public.piano_funzionalita, public.piano_limiti, public.abbonamenti from anon, authenticated;
grant select on public.piani, public.funzionalita, public.piano_funzionalita, public.piano_limiti, public.abbonamenti to authenticated;
create policy "piani: lettura" on public.piani for select to authenticated using (true);
create policy "funzionalita: lettura" on public.funzionalita for select to authenticated using (true);
create policy "piano_funzionalita: lettura" on public.piano_funzionalita for select to authenticated using (true);
create policy "piano_limiti: lettura" on public.piano_limiti for select to authenticated using (true);
create policy "abbonamenti: lettura gruppo" on public.abbonamenti for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));
create trigger audit after insert or update or delete on public.abbonamenti
  for each row execute function app.audit_trigger();

-- ── Inviti ─────────────────────────────────────────────────────────────────
-- Il token viaggia solo nel link. In database resta il suo hash, in una tabella
-- a parte senza audit e senza alcun privilegio per i ruoli API.
create table public.inviti (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references public.gruppi(id) on delete cascade,
  ristorante_id uuid references public.ristoranti(id) on delete cascade,   -- NULL = tutte le sedi del gruppo
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ruolo public.ruolo_membro not null,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accettato', 'revocato')),
  scade_il timestamptz not null,
  invio_stato text not null default 'non_inviato' check (invio_stato in ('non_inviato', 'inviato', 'fallito')),
  invio_errore text,
  invii int not null default 0,
  ultimo_invio_il timestamptz,
  invitato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  accettato_da uuid references auth.users(id) on delete set null,
  accettato_il timestamptz,
  revocato_da uuid references auth.users(id) on delete set null,
  revocato_il timestamptz
);
create unique index inviti_pendenti on public.inviti
  (gruppo_id, coalesce(ristorante_id, '00000000-0000-0000-0000-000000000000'::uuid), email) where stato = 'in_attesa';
create table public.inviti_segreti (
  invito_id uuid primary key references public.inviti(id) on delete cascade,
  token_hash text not null unique
);
alter table public.inviti enable row level security;
alter table public.inviti_segreti enable row level security;
revoke all on public.inviti, public.inviti_segreti from public, anon, authenticated, service_role;
grant select on public.inviti to authenticated;
create policy "inviti: lettura titolare" on public.inviti for select to authenticated
  using (app.ha_ruolo_gruppo(gruppo_id, array['titolare']::public.ruolo_membro[]));
create trigger audit after insert or update or delete on public.inviti
  for each row execute function app.audit_trigger();

create or replace function app.hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex') $$;

create or replace function app.puo_gestire_inviti(p_gruppo_id uuid, p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_ristorante_id is null
    then exists (select 1 from public.membri_gruppo mg where mg.gruppo_id = p_gruppo_id
                    and mg.user_id = (select auth.uid()) and mg.ruolo = 'titolare')
    else app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[])
         and app.gruppo_di(p_ristorante_id) = p_gruppo_id end
$$;

-- Crea (o rinnova) un invito. Restituisce il token UNA sola volta: serve a comporre il link.
-- Un invito già pendente per la stessa email e lo stesso ambito viene rinnovato, non duplicato.
create or replace function public.crea_invito(
  p_ristorante_id uuid, p_email text, p_ruolo public.ruolo_membro, p_intero_gruppo boolean default false,
  p_giorni_validita int default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_gruppo uuid := app.gruppo_di(p_ristorante_id);
  v_rist uuid := case when p_intero_gruppo then null else p_ristorante_id end;
  v_email text := lower(btrim(p_email));
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid; v_limite int; v_occupati int; v_uid uuid; v_rinnovo boolean := false;
begin
  perform app.richiedi(v_gruppo is not null and app.puo_gestire_inviti(v_gruppo, v_rist),
    case when p_intero_gruppo then 'Solo il titolare del gruppo può invitare su tutte le sedi' else 'Solo il titolare può invitare collaboratori' end);
  if app.stato_abbonamento(v_gruppo) not in ('prova', 'attivo') then
    raise exception 'Abbonamento non attivo: non si possono invitare nuovi collaboratori' using errcode = 'P0403';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indirizzo email non valido' using errcode = '22023';
  end if;
  if p_giorni_validita is null or p_giorni_validita < 1 or p_giorni_validita > 30 then
    raise exception 'La validità deve essere tra 1 e 30 giorni' using errcode = '22023';
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = v_email;
  if v_uid is not null and (
       (v_rist is not null and exists (select 1 from public.membri_ristorante m where m.ristorante_id = v_rist and m.user_id = v_uid))
    or (v_rist is null and exists (select 1 from public.membri_gruppo m where m.gruppo_id = v_gruppo and m.user_id = v_uid))) then
    raise exception 'Questa persona ha già accesso: cambia il ruolo dal team' using errcode = '23505';
  end if;

  select i.id into v_id from public.inviti i
   where i.gruppo_id = v_gruppo and i.email = v_email and i.stato = 'in_attesa'
     and i.ristorante_id is not distinct from v_rist for update;
  if v_id is not null then
    v_rinnovo := true;
    update public.inviti set ruolo = p_ruolo, scade_il = now() + make_interval(days => p_giorni_validita),
           invio_stato = 'non_inviato', invio_errore = null where id = v_id;
    update public.inviti_segreti set token_hash = app.hash_token(v_token) where invito_id = v_id;
  else
    -- Limite utenti del piano: contano i membri e gli inviti ancora validi.
    v_limite := app.limite_piano(v_gruppo, 'utenti');
    if v_limite is not null then
      select count(*) into v_occupati from (
        select mg.user_id::text from public.membri_gruppo mg where mg.gruppo_id = v_gruppo
        union select mr.user_id::text from public.membri_ristorante mr
          join public.ristoranti r on r.id = mr.ristorante_id where r.gruppo_id = v_gruppo
        union select i.email from public.inviti i where i.gruppo_id = v_gruppo and i.stato = 'in_attesa' and i.scade_il > now()) x;
      if v_occupati >= v_limite then
        raise exception 'Il piano attuale consente % utenti: per invitarne altri serve un piano superiore', v_limite using errcode = 'P0403';
      end if;
    end if;
    insert into public.inviti (gruppo_id, ristorante_id, email, ruolo, scade_il, invitato_da)
    values (v_gruppo, v_rist, v_email, p_ruolo, now() + make_interval(days => p_giorni_validita), auth.uid())
    returning id into v_id;
    insert into public.inviti_segreti (invito_id, token_hash) values (v_id, app.hash_token(v_token));
  end if;
  return jsonb_build_object('invito_id', v_id, 'token', v_token, 'rinnovato', v_rinnovo, 'ha_gia_un_account', v_uid is not null,
                            'scade_il', (select i.scade_il from public.inviti i where i.id = v_id));
end $$;

-- Esito dell'invio dell'email, registrato dall'app: un invio non riuscito non viene mai mostrato come riuscito.
create or replace function public.segna_invio_invito(p_invito_id uuid, p_riuscito boolean, p_errore text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.inviti;
begin
  select * into v from public.inviti where id = p_invito_id for update;
  perform app.richiedi(found and app.puo_gestire_inviti(v.gruppo_id, v.ristorante_id));
  update public.inviti set invio_stato = case when p_riuscito then 'inviato' else 'fallito' end,
         invio_errore = case when p_riuscito then null else left(coalesce(p_errore, 'Invio non riuscito'), 300) end,
         invii = invii + 1, ultimo_invio_il = now()
   where id = p_invito_id;
end $$;

create or replace function public.revoca_invito(p_invito_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.inviti;
begin
  select * into v from public.inviti where id = p_invito_id for update;
  perform app.richiedi(found and app.puo_gestire_inviti(v.gruppo_id, v.ristorante_id));
  if v.stato <> 'in_attesa' then raise exception 'L''invito non è più in attesa' using errcode = '22023'; end if;
  update public.inviti set stato = 'revocato', revocato_da = auth.uid(), revocato_il = now() where id = p_invito_id;
  delete from public.inviti_segreti where invito_id = p_invito_id;
end $$;

-- Mostrato a chi apre il link, anche senza sessione: nessun dato oltre a ciò che serve per accettare.
create or replace function public.anteprima_invito(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'stato', case when i.stato <> 'in_attesa' then i.stato when i.scade_il < now() then 'scaduto' else 'valido' end,
      'email', i.email, 'ruolo', i.ruolo, 'scade_il', i.scade_il,
      'sede', (select r.nome from public.ristoranti r where r.id = i.ristorante_id),
      'gruppo', (select g.nome from public.gruppi g where g.id = i.gruppo_id))
      from public.inviti_segreti s join public.inviti i on i.id = s.invito_id
     where s.token_hash = app.hash_token(p_token)),
    jsonb_build_object('stato', 'non_valido'))
$$;

-- Accettazione: solo l'utente con QUELLA email, verificata, e una sola volta.
create or replace function public.accetta_invito(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.inviti; v_utente record;
begin
  if auth.uid() is null then raise exception 'Accedi per accettare l''invito' using errcode = '42501'; end if;
  select i.* into v from public.inviti_segreti s join public.inviti i on i.id = s.invito_id
   where s.token_hash = app.hash_token(p_token) for update of i;
  if not found then raise exception 'Invito non valido o già utilizzato' using errcode = 'P0002'; end if;
  if v.stato <> 'in_attesa' then raise exception 'Invito non valido o già utilizzato' using errcode = 'P0002'; end if;
  if v.scade_il < now() then raise exception 'Invito scaduto: chiedi al titolare di inviarne uno nuovo' using errcode = 'P0002'; end if;
  select u.email, u.email_confirmed_at into v_utente from auth.users u where u.id = auth.uid();
  if lower(v_utente.email) <> v.email then
    raise exception 'Questo invito è per un altro indirizzo email' using errcode = '42501';
  end if;
  if v_utente.email_confirmed_at is null then
    raise exception 'Conferma prima il tuo indirizzo email dal messaggio che hai ricevuto' using errcode = '42501';
  end if;

  if v.ristorante_id is null then
    insert into public.membri_gruppo (gruppo_id, user_id, ruolo) values (v.gruppo_id, auth.uid(), v.ruolo)
    on conflict (gruppo_id, user_id) do update set ruolo = excluded.ruolo;
  else
    insert into public.membri_ristorante (ristorante_id, user_id, ruolo) values (v.ristorante_id, auth.uid(), v.ruolo)
    on conflict (ristorante_id, user_id) do update set ruolo = excluded.ruolo;
  end if;
  update public.inviti set stato = 'accettato', accettato_da = auth.uid(), accettato_il = now() where id = v.id;
  delete from public.inviti_segreti where invito_id = v.id;   -- il token non è riutilizzabile
  return jsonb_build_object('ristorante_id', v.ristorante_id, 'gruppo_id', v.gruppo_id, 'ruolo', v.ruolo);
end $$;

-- ── Unità di misura: conversioni esplicite, versionate, con provenienza ────
-- L'unità base del master resta quella dei confronti di prezzo. Magazzino e
-- ricette possono usare altre unità, purché esista una conversione dichiarata.
alter table public.articoli_master add column unita_magazzino text;

create table public.conversioni_unita (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid not null references public.gruppi(id) on delete cascade,
  master_id uuid not null references public.articoli_master(id) on delete cascade,
  da_unita text not null,
  a_unita text not null,
  fattore numeric(18,6) not null check (fattore > 0),          -- 1 da_unita = fattore a_unita
  provenienza text not null check (provenienza in ('manuale', 'documento', 'fornitore', 'migrazione')),
  nota text,
  versione int not null default 1,
  attiva boolean not null default true,
  sostituisce uuid references public.conversioni_unita(id) on delete set null,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  check (lower(da_unita) <> lower(a_unita))
);
create unique index conversioni_attive on public.conversioni_unita (master_id, lower(da_unita), lower(a_unita)) where attiva;
alter table public.conversioni_unita enable row level security;
revoke all on public.conversioni_unita from anon, authenticated;
grant select on public.conversioni_unita to authenticated;
create policy "conversioni: lettura gruppo" on public.conversioni_unita for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id));
create trigger audit after insert or update or delete on public.conversioni_unita
  for each row execute function app.audit_trigger();

-- I fattori già dichiarati sugli alias diventano conversioni. Nessun peso viene dedotto.
insert into public.conversioni_unita (gruppo_id, master_id, da_unita, a_unita, fattore, provenienza, nota)
select distinct on (a.master_id, lower(a.unita_misura)) a.gruppo_id, a.master_id, lower(a.unita_misura), m.unita_base,
       a.fattore_conversione, 'migrazione', 'Dal fattore di conversione dell''abbinamento'
  from public.alias_articolo a join public.articoli_master m on m.id = a.master_id
 where a.fattore_conversione is not null and a.unita_misura is not null and lower(a.unita_misura) <> m.unita_base;

-- Unità → (dimensione, fattore). Un'unità sconosciuta è una dimensione a sé.
create or replace function app.um(p_um text, out base text, out fattore numeric)
language sql immutable set search_path = '' as $$
  select coalesce((app.um_base(p_um)).base, lower(btrim(p_um))), coalesce((app.um_base(p_um)).fattore, 1)
$$;

-- Converte una quantità tra due unità per un articolo. NULL = non convertibile:
-- tra dimensioni diverse serve una conversione dichiarata, non viene mai dedotta.
create or replace function app.converti(p_master_id uuid, p_quantita numeric, p_da text, p_a text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare d record; a record; c record;
begin
  if p_quantita is null or coalesce(btrim(p_da), '') = '' or coalesce(btrim(p_a), '') = '' then return null; end if;
  select * into d from app.um(p_da);
  select * into a from app.um(p_a);
  if d.base = a.base then return p_quantita * d.fattore / a.fattore; end if;
  for c in select x.da_unita, x.a_unita, x.fattore from public.conversioni_unita x
            where x.master_id = p_master_id and x.attiva loop
    if (app.um(c.da_unita)).base = d.base and (app.um(c.a_unita)).base = a.base then
      return p_quantita * d.fattore / (app.um(c.da_unita)).fattore * c.fattore * (app.um(c.a_unita)).fattore / a.fattore;
    elsif (app.um(c.da_unita)).base = a.base and (app.um(c.a_unita)).base = d.base then
      return p_quantita * d.fattore / (app.um(c.a_unita)).fattore / c.fattore * (app.um(c.da_unita)).fattore / a.fattore;
    end if;
  end loop;
  return null;
end $$;

create or replace function public.imposta_conversione(
  p_master_id uuid, p_da text, p_a text, p_fattore numeric, p_nota text default null, p_provenienza text default 'manuale')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_m public.articoli_master; v_vecchia public.conversioni_unita; v_id uuid;
  v_da text := lower(btrim(p_da)); v_a text := lower(btrim(p_a));
begin
  select * into v_m from public.articoli_master where id = p_master_id;
  perform app.richiedi(found and app.ha_ruolo_gruppo(v_m.gruppo_id, array['titolare', 'chef']::public.ruolo_membro[]));
  if coalesce(v_da, '') = '' or coalesce(v_a, '') = '' or p_fattore is null or p_fattore <= 0 then
    raise exception 'Indica le due unità e un fattore maggiore di zero' using errcode = '22023';
  end if;
  if (app.um(v_da)).base = (app.um(v_a)).base then
    raise exception 'Tra % e % la conversione è fisica e non va dichiarata', v_da, v_a using errcode = '22023';
  end if;
  if p_provenienza not in ('manuale', 'documento', 'fornitore') then
    raise exception 'Provenienza non valida' using errcode = '22023';
  end if;
  select * into v_vecchia from public.conversioni_unita c
   where c.master_id = p_master_id and c.attiva
     and ((lower(c.da_unita) = v_da and lower(c.a_unita) = v_a) or (lower(c.da_unita) = v_a and lower(c.a_unita) = v_da))
   for update;
  if found then update public.conversioni_unita set attiva = false where id = v_vecchia.id; end if;
  insert into public.conversioni_unita (gruppo_id, master_id, da_unita, a_unita, fattore, provenienza, nota, versione, sostituisce, creato_da)
  values (v_m.gruppo_id, p_master_id, v_da, v_a, p_fattore, p_provenienza, left(nullif(btrim(p_nota), ''), 300),
          coalesce(v_vecchia.versione, 0) + 1, v_vecchia.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ── Ubicazioni (celle, frigoriferi, congelatori, dispense, cantina) ────────
-- Gli intervalli di temperatura sono SOGLIE OPERATIVE scelte dal ristorante in base
-- al proprio piano HACCP: l'app non propone valori e non attesta conformità.
create table public.ubicazioni (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  nome text not null check (btrim(nome) <> ''),
  codice text,
  tipo text not null check (tipo in ('cella', 'frigorifero', 'congelatore', 'dispensa', 'cantina', 'altro')),
  posizione text,
  capacita text,
  responsabile_id uuid references auth.users(id) on delete set null,
  monitorata boolean not null default false,
  temp_min numeric(5,1),
  temp_max numeric(5,1),
  allarme_dopo_min int not null default 0 check (allarme_dopo_min >= 0),    -- durata minima fuori intervallo
  isteresi numeric(4,1) not null default 0 check (isteresi >= 0),           -- rientro richiesto per chiudere
  critico_dopo_min int check (critico_dopo_min is null or critico_dopo_min > 0),
  silenzio_dopo_min int check (silenzio_dopo_min is null or silenzio_dopo_min > 0),
  attiva boolean not null default true,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, nome),
  check (temp_min is null or temp_max is null or temp_min < temp_max)
);
create table public.sensori (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ubicazione_id uuid not null references public.ubicazioni(id) on delete cascade,
  nome text not null,
  identificativo_esterno text,
  stato text not null default 'attivo' check (stato in ('attivo', 'disattivato', 'da_calibrare')),
  ultima_calibrazione date,
  scala_min numeric(6,1) not null default -60,   -- limiti di plausibilità dello strumento, non soglie alimentari
  scala_max numeric(6,1) not null default 80,
  ultima_lettura_il timestamptz,
  creato_il timestamptz not null default now()
);
create table public.sensori_segreti (
  sensore_id uuid primary key references public.sensori(id) on delete cascade,
  chiave_hash text not null unique
);
create table public.letture (
  id bigint generated always as identity primary key,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ubicazione_id uuid not null references public.ubicazioni(id) on delete cascade,
  sensore_id uuid references public.sensori(id) on delete set null,
  valore numeric(6,2) not null,
  unita text not null default '°C' check (unita = '°C'),
  rilevata_il timestamptz not null,
  fonte text not null check (fonte in ('manuale', 'sensore')),
  qualita text not null default 'valida' check (qualita in ('valida', 'fuori_scala', 'sensore_da_calibrare')),
  nota text,
  registrata_da uuid references auth.users(id) on delete set null,
  chiave_idempotenza text,
  creato_il timestamptz not null default now(),
  unique (ubicazione_id, chiave_idempotenza)
);
create index on public.letture (ubicazione_id, rilevata_il desc);
create table public.allarmi (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ubicazione_id uuid not null references public.ubicazioni(id) on delete cascade,
  tipo text not null check (tipo in ('temperatura_alta', 'temperatura_bassa', 'dati_mancanti', 'fuori_scala')),
  severita text not null default 'attenzione' check (severita in ('attenzione', 'critico')),
  stato text not null default 'aperto' check (stato in ('aperto', 'in_carico', 'risolto')),
  aperto_il timestamptz not null default now(),
  inizio_il timestamptz,
  valore_estremo numeric(6,2),
  dettaglio text,
  preso_da uuid references auth.users(id) on delete set null,
  preso_il timestamptz,
  assegnato_a uuid references auth.users(id) on delete set null,
  risolto_da uuid references auth.users(id) on delete set null,
  risolto_il timestamptz,
  risolto_auto boolean not null default false,
  note text
);
create unique index allarmi_aperti on public.allarmi (ubicazione_id, tipo) where stato <> 'risolto';
create index on public.allarmi (ristorante_id, stato);

create or replace function app.immutabile() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% è un registro immutabile: usa un''operazione di storno o una nuova registrazione', tg_table_name
    using errcode = '42501';
end $$;
create trigger letture_immutabili before update or delete on public.letture
  for each row execute function app.immutabile();

-- Valuta lo stato di un'ubicazione dopo una lettura o a intervalli (dati mancanti).
--  · apre un allarme solo se il valore resta fuori intervallo per la durata configurata;
--  · lo chiude da solo solo quando il valore rientra oltre l'isteresi;
--  · una lettura mancante non è mai "tutto bene": dopo il silenzio configurato apre "dati mancanti".
create or replace function app.valuta_ubicazione(p_ubicazione_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u public.ubicazioni; l record; v_inizio timestamptz; v_tipo text; v_fuori boolean; v_durata interval;
  a public.allarmi;
begin
  select * into u from public.ubicazioni where id = p_ubicazione_id;
  if not found or not u.monitorata or not u.attiva then return; end if;

  select x.valore, x.rilevata_il into l from public.letture x
   where x.ubicazione_id = u.id and x.qualita = 'valida' order by x.rilevata_il desc limit 1;

  -- Dati mancanti
  if u.silenzio_dopo_min is not null then
    if l.rilevata_il is null or l.rilevata_il < now() - make_interval(mins => u.silenzio_dopo_min) then
      insert into public.allarmi (ristorante_id, ubicazione_id, tipo, inizio_il, dettaglio)
      values (u.ristorante_id, u.id, 'dati_mancanti', l.rilevata_il,
              case when l.rilevata_il is null then 'Nessuna lettura valida registrata'
                   else 'Nessuna lettura valida da più di ' || u.silenzio_dopo_min || ' minuti' end)
      on conflict (ubicazione_id, tipo) where stato <> 'risolto' do nothing;
    else
      update public.allarmi set stato = 'risolto', risolto_il = now(), risolto_auto = true,
             note = concat_ws(' · ', note, 'Letture riprese')
       where ubicazione_id = u.id and tipo = 'dati_mancanti' and stato <> 'risolto';
    end if;
  end if;
  if l.rilevata_il is null then return; end if;

  foreach v_tipo in array array['temperatura_alta', 'temperatura_bassa'] loop
    continue when (v_tipo = 'temperatura_alta' and u.temp_max is null) or (v_tipo = 'temperatura_bassa' and u.temp_min is null);
    v_fuori := case when v_tipo = 'temperatura_alta' then l.valore > u.temp_max else l.valore < u.temp_min end;
    select * into a from public.allarmi x where x.ubicazione_id = u.id and x.tipo = v_tipo and x.stato <> 'risolto';

    if v_fuori then
      -- inizio dell'escursione: la prima lettura fuori intervallo dopo l'ultima rientrata
      select min(x.rilevata_il) into v_inizio from public.letture x
       where x.ubicazione_id = u.id and x.qualita = 'valida'
         and x.rilevata_il > coalesce((select max(y.rilevata_il) from public.letture y
               where y.ubicazione_id = u.id and y.qualita = 'valida'
                 and case when v_tipo = 'temperatura_alta' then y.valore <= u.temp_max else y.valore >= u.temp_min end), '-infinity');
      v_durata := l.rilevata_il - v_inizio;
      if a.id is null and v_durata >= make_interval(mins => u.allarme_dopo_min) then
        insert into public.allarmi (ristorante_id, ubicazione_id, tipo, inizio_il, valore_estremo, dettaglio)
        values (u.ristorante_id, u.id, v_tipo, v_inizio, l.valore,
                case when v_tipo = 'temperatura_alta' then 'Sopra ' || u.temp_max else 'Sotto ' || u.temp_min end
                  || ' °C da ' || greatest(0, round(extract(epoch from v_durata) / 60)) || ' minuti')
        on conflict (ubicazione_id, tipo) where stato <> 'risolto' do nothing;
      elsif a.id is not null then
        update public.allarmi set
          valore_estremo = case when v_tipo = 'temperatura_alta' then greatest(valore_estremo, l.valore) else least(valore_estremo, l.valore) end,
          severita = case when u.critico_dopo_min is not null and v_durata >= make_interval(mins => u.critico_dopo_min) then 'critico' else severita end
        where id = a.id;
      end if;
    elsif a.id is not null and (
         (v_tipo = 'temperatura_alta' and l.valore <= u.temp_max - u.isteresi)
      or (v_tipo = 'temperatura_bassa' and l.valore >= u.temp_min + u.isteresi)) then
      update public.allarmi set stato = 'risolto', risolto_il = now(), risolto_auto = true,
             note = concat_ws(' · ', note, 'Temperatura rientrata a ' || l.valore || ' °C')
       where id = a.id;
    end if;
  end loop;
end $$;

create or replace function app.inserisci_lettura(
  p_ubicazione_id uuid, p_valore numeric, p_rilevata_il timestamptz, p_fonte text, p_sensore_id uuid,
  p_nota text, p_chiave text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare u public.ubicazioni; s public.sensori; v_id bigint; v_qualita text := 'valida';
begin
  select * into u from public.ubicazioni where id = p_ubicazione_id;
  if p_valore is null then raise exception 'Valore mancante' using errcode = '22023'; end if;
  if p_rilevata_il is null or p_rilevata_il > now() + interval '5 minutes' then
    raise exception 'Data della lettura non valida (nel futuro)' using errcode = '22023';
  end if;
  if p_chiave is not null then
    select x.id into v_id from public.letture x where x.ubicazione_id = u.id and x.chiave_idempotenza = p_chiave;
    if v_id is not null then return v_id; end if;   -- stessa lettura inviata due volte
  end if;
  if p_sensore_id is not null then
    select * into s from public.sensori where id = p_sensore_id;
    if p_valore < s.scala_min or p_valore > s.scala_max then v_qualita := 'fuori_scala';
    elsif s.stato = 'da_calibrare' then v_qualita := 'sensore_da_calibrare'; end if;
    update public.sensori set ultima_lettura_il = greatest(coalesce(ultima_lettura_il, p_rilevata_il), p_rilevata_il) where id = s.id;
  elsif p_valore < -60 or p_valore > 80 then
    raise exception 'Valore fuori dalla scala plausibile: controlla la lettura' using errcode = '22023';
  end if;
  insert into public.letture (ristorante_id, ubicazione_id, sensore_id, valore, rilevata_il, fonte, qualita, nota, registrata_da, chiave_idempotenza)
  values (u.ristorante_id, u.id, p_sensore_id, p_valore, p_rilevata_il, p_fonte, v_qualita, left(nullif(btrim(p_nota), ''), 300), auth.uid(), p_chiave)
  returning id into v_id;
  if v_qualita = 'fuori_scala' then
    insert into public.allarmi (ristorante_id, ubicazione_id, tipo, inizio_il, valore_estremo, dettaglio)
    values (u.ristorante_id, u.id, 'fuori_scala', p_rilevata_il, p_valore, 'Il sensore ha trasmesso un valore fuori dalla propria scala: possibile guasto o scollegamento')
    on conflict (ubicazione_id, tipo) where stato <> 'risolto' do nothing;
  end if;
  perform app.valuta_ubicazione(u.id);
  return v_id;
end $$;

create or replace function public.salva_ubicazione(p_ristorante_id uuid, p_dati jsonb, p_ubicazione_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_ubicazione_id; v_refrigerata boolean := p_dati->>'tipo' in ('cella', 'frigorifero', 'congelatore');
begin
  -- Le soglie di una cella sono una decisione del titolare; lo chef gestisce dispense e posizioni.
  perform app.richiedi_op(p_ristorante_id, case when v_refrigerata or (p_dati ? 'temp_max') or (p_dati ? 'temp_min')
      then array['titolare']::public.ruolo_membro[] else array['titolare', 'chef']::public.ruolo_membro[] end,
    case when v_refrigerata then 'celle' else 'magazzino' end);
  if v_id is null then
    insert into public.ubicazioni (ristorante_id, nome, tipo) values (p_ristorante_id, btrim(p_dati->>'nome'), p_dati->>'tipo') returning id into v_id;
  elsif not exists (select 1 from public.ubicazioni where id = v_id and ristorante_id = p_ristorante_id) then
    raise exception 'Ubicazione non trovata' using errcode = 'P0002';
  end if;
  update public.ubicazioni set
    nome = coalesce(nullif(btrim(p_dati->>'nome'), ''), nome),
    tipo = coalesce(p_dati->>'tipo', tipo),
    codice = case when p_dati ? 'codice' then nullif(btrim(p_dati->>'codice'), '') else codice end,
    posizione = case when p_dati ? 'posizione' then nullif(btrim(p_dati->>'posizione'), '') else posizione end,
    capacita = case when p_dati ? 'capacita' then nullif(btrim(p_dati->>'capacita'), '') else capacita end,
    monitorata = case when p_dati ? 'monitorata' then (p_dati->>'monitorata')::boolean else monitorata end,
    temp_min = case when p_dati ? 'temp_min' then app.num(p_dati->>'temp_min') else temp_min end,
    temp_max = case when p_dati ? 'temp_max' then app.num(p_dati->>'temp_max') else temp_max end,
    allarme_dopo_min = case when p_dati ? 'allarme_dopo_min' then coalesce(app.num(p_dati->>'allarme_dopo_min'), 0)::int else allarme_dopo_min end,
    isteresi = case when p_dati ? 'isteresi' then coalesce(app.num(p_dati->>'isteresi'), 0) else isteresi end,
    critico_dopo_min = case when p_dati ? 'critico_dopo_min' then app.num(p_dati->>'critico_dopo_min')::int else critico_dopo_min end,
    silenzio_dopo_min = case when p_dati ? 'silenzio_dopo_min' then app.num(p_dati->>'silenzio_dopo_min')::int else silenzio_dopo_min end,
    attiva = case when p_dati ? 'attiva' then (p_dati->>'attiva')::boolean else attiva end
  where id = v_id;
  if exists (select 1 from public.ubicazioni where id = v_id and monitorata and temp_min is null and temp_max is null) then
    raise exception 'Per monitorare l''ubicazione indica almeno una soglia di temperatura' using errcode = '22023';
  end if;
  return v_id;
end $$;

create or replace function public.registra_lettura(p_ubicazione_id uuid, p_valore numeric, p_rilevata_il timestamptz default now(), p_nota text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare u public.ubicazioni;
begin
  select * into u from public.ubicazioni where id = p_ubicazione_id;
  perform app.richiedi(found);
  perform app.richiedi_op(u.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'celle');
  return app.inserisci_lettura(p_ubicazione_id, p_valore, coalesce(p_rilevata_il, now()), 'manuale', null, p_nota, null);
end $$;

-- Collega un sensore e restituisce la sua chiave UNA sola volta (in database resta l'hash).
create or replace function public.crea_sensore(p_ubicazione_id uuid, p_nome text, p_identificativo_esterno text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.ubicazioni; v_id uuid; v_chiave text := 'ks_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select * into u from public.ubicazioni where id = p_ubicazione_id;
  perform app.richiedi(found);
  perform app.richiedi_op(u.ristorante_id, array['titolare']::public.ruolo_membro[], 'celle');
  insert into public.sensori (ristorante_id, ubicazione_id, nome, identificativo_esterno)
  values (u.ristorante_id, u.id, btrim(p_nome), nullif(btrim(p_identificativo_esterno), '')) returning id into v_id;
  insert into public.sensori_segreti (sensore_id, chiave_hash) values (v_id, app.hash_token(v_chiave));
  return jsonb_build_object('sensore_id', v_id, 'chiave', v_chiave);
end $$;

create or replace function public.imposta_stato_sensore(p_sensore_id uuid, p_stato text, p_calibrato_il date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sensori;
begin
  select * into s from public.sensori where id = p_sensore_id;
  perform app.richiedi(found);
  perform app.richiedi_op(s.ristorante_id, array['titolare']::public.ruolo_membro[], 'celle');
  update public.sensori set stato = p_stato, ultima_calibrazione = coalesce(p_calibrato_il, ultima_calibrazione) where id = p_sensore_id;
  if p_stato = 'disattivato' then delete from public.sensori_segreti where sensore_id = p_sensore_id; end if;
end $$;

-- Punto d'ingresso per i sensori (adapter IoT): si autentica con la chiave del sensore, non con un utente.
create or replace function public.ingest_lettura(p_chiave text, p_valore numeric, p_rilevata_il timestamptz default now(), p_idempotenza text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sensori; v_id bigint;
begin
  select x.* into s from public.sensori_segreti k join public.sensori x on x.id = k.sensore_id
   where k.chiave_hash = app.hash_token(p_chiave);
  if not found or s.stato = 'disattivato' then raise exception 'Chiave del sensore non valida' using errcode = '42501'; end if;
  if not app.ha_funzione(app.gruppo_di(s.ristorante_id), 'celle') then
    raise exception 'Funzione non attiva per questa sede' using errcode = 'P0403';
  end if;
  v_id := app.inserisci_lettura(s.ubicazione_id, p_valore, coalesce(p_rilevata_il, now()), 'sensore', s.id, null, p_idempotenza);
  return jsonb_build_object('lettura_id', v_id, 'qualita', (select l.qualita from public.letture l where l.id = v_id));
end $$;

create or replace function public.gestisci_allarme(p_allarme_id uuid, p_azione text, p_nota text default null, p_assegnato_a uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.allarmi;
begin
  select * into a from public.allarmi where id = p_allarme_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(a.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'celle');
  if a.stato = 'risolto' then raise exception 'L''allarme è già chiuso' using errcode = '22023'; end if;
  if p_azione = 'prendi' then
    update public.allarmi set stato = 'in_carico', preso_da = auth.uid(), preso_il = now(),
           assegnato_a = coalesce(p_assegnato_a, auth.uid()), note = concat_ws(' · ', note, nullif(btrim(p_nota), '')) where id = a.id;
  elsif p_azione = 'assegna' then
    if p_assegnato_a is null or not exists (select 1 from public.membri_ristorante m where m.ristorante_id = a.ristorante_id and m.user_id = p_assegnato_a) then
      raise exception 'Scegli un collaboratore della sede' using errcode = '22023';
    end if;
    update public.allarmi set assegnato_a = p_assegnato_a, note = concat_ws(' · ', note, nullif(btrim(p_nota), '')) where id = a.id;
  elsif p_azione = 'risolvi' then
    if coalesce(btrim(p_nota), '') = '' then raise exception 'Indica cosa è stato fatto per risolvere l''allarme' using errcode = '22023'; end if;
    update public.allarmi set stato = 'risolto', risolto_da = auth.uid(), risolto_il = now(), note = concat_ws(' · ', note, btrim(p_nota)) where id = a.id;
  else
    raise exception 'Azione non valida' using errcode = '22023';
  end if;
end $$;

create or replace function public.controlla_ubicazioni() returns int
language plpgsql security definer set search_path = '' as $$
declare u record; n int := 0;
begin
  for u in select id from public.ubicazioni where monitorata and attiva loop
    perform app.valuta_ubicazione(u.id); n := n + 1;
  end loop;
  return n;
end $$;
select cron.schedule('kitchen-os-controllo-celle', '*/5 * * * *', 'select public.controlla_ubicazioni()');

-- Stato sintetico di ogni ubicazione: "ok" solo con una lettura valida, recente e in intervallo.
create view public.v_ubicazioni with (security_invoker = true) as
select u.*, l.valore as ultima_temperatura, l.rilevata_il as ultima_lettura_il, l.fonte as ultima_fonte,
       (select count(*) from public.allarmi a where a.ubicazione_id = u.id and a.stato <> 'risolto') as allarmi_aperti,
       (select count(*) from public.sensori s where s.ubicazione_id = u.id and s.stato <> 'disattivato') as n_sensori,
       case
         when not u.monitorata then 'non_monitorata'
         when l.rilevata_il is null then 'nessun_dato'
         when u.silenzio_dopo_min is not null and l.rilevata_il < now() - make_interval(mins => u.silenzio_dopo_min) then 'dati_mancanti'
         when exists (select 1 from public.allarmi a where a.ubicazione_id = u.id and a.stato <> 'risolto' and a.tipo like 'temperatura%') then 'allarme'
         when (u.temp_max is not null and l.valore > u.temp_max) or (u.temp_min is not null and l.valore < u.temp_min) then 'fuori_intervallo'
         else 'ok' end as stato_temperatura
  from public.ubicazioni u
  left join lateral (select x.valore, x.rilevata_il, x.fonte from public.letture x
                      where x.ubicazione_id = u.id and x.qualita = 'valida' order by x.rilevata_il desc limit 1) l on true;

-- ── Lotti e registro dei movimenti ─────────────────────────────────────────
create table public.lotti (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  master_id uuid not null references public.articoli_master(id) on delete restrict,
  fornitore_id uuid references public.fornitori(id) on delete set null,
  documento_id uuid references public.documenti(id) on delete set null,
  riga_id uuid references public.storico_prezzi(id) on delete set null,
  ubicazione_id uuid references public.ubicazioni(id) on delete set null,
  tipo text not null default 'alimentare' check (tipo in ('alimentare', 'cantina')),
  codice_lotto text,
  ricevuto_il date not null,
  scadenza date,
  unita text not null,
  quantita_iniziale numeric(14,3) not null check (quantita_iniziale > 0),
  -- costo storico di acquisto, nella valuta del documento; l'EUR usa il cambio BCE della data indicata
  costo_unitario numeric(14,4),
  valuta text,
  costo_unitario_eur numeric(14,4),
  tasso_cambio numeric(14,6),
  cambio_del date,
  stato text not null default 'attivo' check (stato in ('attivo', 'bloccato', 'richiamato')),
  stato_motivo text,
  origine_lotto_id uuid references public.lotti(id) on delete set null,
  -- cantina: dati descrittivi e finestra di consumo (indicazione modificabile, con fonte)
  produttore text, annata int, provenienza text, formato text,
  consumo_dal int, consumo_al int, consumo_fonte text, consumo_note text,
  note text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now()
);
create index on public.lotti (ristorante_id, master_id, scadenza);
create table public.movimenti (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  lotto_id uuid not null references public.lotti(id) on delete restrict,
  master_id uuid not null references public.articoli_master(id) on delete restrict,
  tipo text not null check (tipo in ('ricevimento', 'consumo', 'scarto', 'reso', 'rottura', 'omaggio', 'apertura',
                                     'vendita', 'rettifica', 'trasferimento_uscita', 'trasferimento_entrata', 'storno')),
  quantita numeric(14,3) not null check (quantita <> 0),      -- con segno: positivo entra, negativo esce
  unita text not null,
  motivo text,
  riferimento text,
  storna_movimento_id uuid unique references public.movimenti(id) on delete restrict,
  chiave_idempotenza text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, chiave_idempotenza)
);
create index on public.movimenti (lotto_id);
create index on public.movimenti (ristorante_id, master_id, creato_il);
create trigger movimenti_immutabili before update or delete on public.movimenti
  for each row execute function app.immutabile();

create view public.v_giacenze with (security_invoker = true) as
select l.*, m.nome as master_nome, m.unita_base as master_unita_base, c.nome as categoria,
       u.nome as ubicazione_nome, u.tipo as ubicazione_tipo, f.ragione_sociale as fornitore,
       coalesce((select sum(x.quantita) from public.movimenti x where x.lotto_id = l.id), 0) as quantita_residua,
       l.scadenza - (now() at time zone 'Europe/Rome')::date as giorni_alla_scadenza
  from public.lotti l
  join public.articoli_master m on m.id = l.master_id
  left join public.categorie_master c on c.id = m.categoria_id
  left join public.ubicazioni u on u.id = l.ubicazione_id
  left join public.fornitori f on f.id = l.fornitore_id;

create or replace function app.residuo(p_lotto_id uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(x.quantita), 0) from public.movimenti x where x.lotto_id = p_lotto_id
$$;

-- Ricevimento: crea il lotto e il movimento d'ingresso. Idempotente sulla chiave
-- (per una riga di documento la chiave è la riga stessa: non si riceve due volte).
create or replace function public.ricevi_lotto(p_ristorante_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_tipo text := coalesce(p_dati->>'tipo', 'alimentare');
  v_riga public.storico_prezzi; v_master uuid := app.uuid_sicuro(p_dati->>'master_id');
  v_unita text := lower(btrim(p_dati->>'unita')); v_q numeric := app.num(p_dati->>'quantita');
  v_chiave text; v_id uuid; v_costo numeric; v_valuta text; v_tasso numeric; v_data date; v_fatt numeric;
  v_forn uuid := app.uuid_sicuro(p_dati->>'fornitore_id'); v_doc uuid; v_ub uuid := app.uuid_sicuro(p_dati->>'ubicazione_id');
  v_ricevuto date := coalesce((p_dati->>'ricevuto_il')::date, (now() at time zone 'Europe/Rome')::date);
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], case when v_tipo = 'cantina' then 'cantina' else 'magazzino' end);
  if p_dati ? 'riga_id' and p_dati->>'riga_id' is not null then
    select * into v_riga from public.storico_prezzi where id = app.uuid_sicuro(p_dati->>'riga_id') and ristorante_id = p_ristorante_id;
    if not found then raise exception 'Riga del documento non trovata' using errcode = 'P0002'; end if;
    if v_riga.master_id is null then raise exception 'Abbina prima l''articolo al catalogo: un lotto appartiene a un articolo master' using errcode = '22023'; end if;
    v_master := v_riga.master_id; v_forn := v_riga.fornitore_id; v_doc := v_riga.documento_id;
    v_unita := coalesce(nullif(v_unita, ''), lower(v_riga.unita_misura)); v_q := coalesce(v_q, v_riga.quantita);
    v_chiave := 'riga:' || v_riga.id;
  else
    v_chiave := nullif(btrim(p_dati->>'chiave'), '');
  end if;
  if v_chiave is not null then
    select m.lotto_id into v_id from public.movimenti m where m.ristorante_id = p_ristorante_id and m.chiave_idempotenza = v_chiave;
    if v_id is not null then return v_id; end if;
  end if;
  if v_master is null or not exists (select 1 from public.articoli_master m where m.id = v_master and m.gruppo_id = app.gruppo_di(p_ristorante_id)) then
    raise exception 'Articolo master non valido' using errcode = '22023';
  end if;
  if v_q is null or v_q <= 0 or coalesce(v_unita, '') = '' then raise exception 'Indica quantità e unità del lotto' using errcode = '22023'; end if;
  if v_ub is not null and not exists (select 1 from public.ubicazioni u where u.id = v_ub and u.ristorante_id = p_ristorante_id) then
    raise exception 'Ubicazione non valida' using errcode = '22023';
  end if;

  -- Costo unitario nell'unità del lotto: dalla riga, se le unità sono convertibili; altrimenti resta vuoto.
  if v_riga.id is not null then
    v_fatt := app.converti(v_master, 1, v_riga.unita_misura, v_unita);
    v_costo := case when v_fatt > 0 then round(v_riga.prezzo_netto / v_fatt, 4) end;
    v_valuta := v_riga.valuta; v_tasso := v_riga.tasso_cambio;
    v_data := (select d.data_documento from public.documenti d where d.id = v_riga.documento_id);
  else
    v_costo := app.num(p_dati->>'costo_unitario'); v_valuta := upper(nullif(btrim(p_dati->>'valuta'), ''));
    if v_costo is not null then v_valuta := coalesce(v_valuta, 'EUR'); v_data := v_ricevuto; v_tasso := app.tasso_bce(v_valuta, v_data); end if;
  end if;

  insert into public.lotti (ristorante_id, master_id, fornitore_id, documento_id, riga_id, ubicazione_id, tipo, codice_lotto,
      ricevuto_il, scadenza, unita, quantita_iniziale, costo_unitario, valuta, costo_unitario_eur, tasso_cambio, cambio_del,
      produttore, annata, provenienza, formato, consumo_dal, consumo_al, consumo_fonte, consumo_note, note, creato_da)
  values (p_ristorante_id, v_master, v_forn, v_doc, v_riga.id, v_ub, v_tipo, nullif(btrim(p_dati->>'codice_lotto'), ''),
      v_ricevuto, (p_dati->>'scadenza')::date, v_unita, v_q, v_costo, v_valuta, round(v_costo / v_tasso, 4), v_tasso,
      case when v_tasso is not null then v_data end,
      nullif(btrim(p_dati->>'produttore'), ''), app.num(p_dati->>'annata')::int, nullif(btrim(p_dati->>'provenienza'), ''),
      nullif(btrim(p_dati->>'formato'), ''), app.num(p_dati->>'consumo_dal')::int, app.num(p_dati->>'consumo_al')::int,
      nullif(btrim(p_dati->>'consumo_fonte'), ''), nullif(btrim(p_dati->>'consumo_note'), ''), nullif(btrim(p_dati->>'note'), ''), auth.uid())
  returning id into v_id;
  insert into public.movimenti (ristorante_id, lotto_id, master_id, tipo, quantita, unita, chiave_idempotenza, riferimento, creato_da)
  values (p_ristorante_id, v_id, v_master, 'ricevimento', v_q, v_unita, v_chiave, case when v_doc is not null then 'documento:' || v_doc end, auth.uid());
  return v_id;
end $$;

-- Uscite e rettifiche. La quantità è sempre positiva, tranne per la rettifica che ha il segno.
create or replace function public.registra_movimento(
  p_lotto_id uuid, p_tipo text, p_quantita numeric, p_motivo text default null, p_chiave text default null, p_riferimento text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.lotti; v_q numeric; v_id uuid; v_res numeric;
begin
  select * into l from public.lotti where id = p_lotto_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(l.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], case when l.tipo = 'cantina' then 'cantina' else 'magazzino' end);
  if p_chiave is not null then
    select m.id into v_id from public.movimenti m where m.ristorante_id = l.ristorante_id and m.chiave_idempotenza = p_chiave;
    if v_id is not null then return v_id; end if;
  end if;
  if p_tipo not in ('consumo', 'scarto', 'reso', 'rottura', 'omaggio', 'apertura', 'vendita', 'rettifica') then
    raise exception 'Tipo di movimento non valido' using errcode = '22023';
  end if;
  if p_quantita is null or p_quantita = 0 or (p_tipo <> 'rettifica' and p_quantita < 0) then
    raise exception 'Quantità non valida' using errcode = '22023';
  end if;
  if p_tipo in ('scarto', 'reso', 'rottura', 'omaggio', 'rettifica') and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Per questo movimento il motivo è obbligatorio' using errcode = '22023';
  end if;
  if l.stato <> 'attivo' and p_tipo in ('consumo', 'apertura', 'vendita', 'omaggio') then
    raise exception 'Lotto %: non può essere utilizzato', l.stato using errcode = '22023';
  end if;
  v_q := case when p_tipo = 'rettifica' then p_quantita else -p_quantita end;
  v_res := app.residuo(l.id);
  if v_res + v_q < 0 then
    raise exception 'Quantità superiore alla giacenza del lotto (% %)', v_res, l.unita using errcode = '22023';
  end if;
  insert into public.movimenti (ristorante_id, lotto_id, master_id, tipo, quantita, unita, motivo, riferimento, chiave_idempotenza, creato_da)
  values (l.ristorante_id, l.id, l.master_id, p_tipo, v_q, l.unita, left(nullif(btrim(p_motivo), ''), 300), p_riferimento, p_chiave, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Annulla un movimento con uno storno di segno opposto: l'originale resta nel registro.
create or replace function public.storna_movimento(p_movimento_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.movimenti; v_id uuid;
begin
  select * into m from public.movimenti where id = p_movimento_id;
  perform app.richiedi(found);
  perform app.richiedi_op(m.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'magazzino');
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Indica il motivo dello storno' using errcode = '22023'; end if;
  if m.tipo in ('storno', 'trasferimento_uscita', 'trasferimento_entrata') then raise exception 'Questo movimento non si può stornare' using errcode = '22023'; end if;
  if exists (select 1 from public.movimenti x where x.storna_movimento_id = m.id) then raise exception 'Movimento già stornato' using errcode = '23505'; end if;
  if app.residuo(m.lotto_id) - m.quantita < 0 then raise exception 'Lo storno porterebbe la giacenza sotto zero' using errcode = '22023'; end if;
  insert into public.movimenti (ristorante_id, lotto_id, master_id, tipo, quantita, unita, motivo, storna_movimento_id, creato_da)
  values (m.ristorante_id, m.lotto_id, m.master_id, 'storno', -m.quantita, m.unita, left(btrim(p_motivo), 300), m.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Inventario: si dichiara la quantità contata, il sistema registra la differenza come rettifica.
create or replace function public.conta_lotto(p_lotto_id uuid, p_quantita_contata numeric, p_motivo text default 'Inventario')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_res numeric := app.residuo(p_lotto_id);
begin
  if p_quantita_contata is null or p_quantita_contata < 0 then raise exception 'Quantità contata non valida' using errcode = '22023'; end if;
  if p_quantita_contata = v_res then return null; end if;
  return public.registra_movimento(p_lotto_id, 'rettifica', p_quantita_contata - v_res,
    coalesce(nullif(btrim(p_motivo), ''), 'Inventario') || ' · contati ' || p_quantita_contata || ', a registro ' || v_res);
end $$;

-- Blocco, richiamo o sblocco di un lotto: un lotto non attivo non può essere consumato.
create or replace function public.imposta_stato_lotto(p_lotto_id uuid, p_stato text, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.lotti;
begin
  select * into l from public.lotti where id = p_lotto_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(l.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], case when l.tipo = 'cantina' then 'cantina' else 'magazzino' end);
  if p_stato not in ('attivo', 'bloccato', 'richiamato') or coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica lo stato e il motivo' using errcode = '22023';
  end if;
  update public.lotti set stato = p_stato, stato_motivo = left(btrim(p_motivo), 300) where id = p_lotto_id;
end $$;

-- Sposta tutto o parte di un lotto in un'altra ubicazione o in un'altra sede dello stesso gruppo.
create or replace function public.trasferisci_lotto(p_lotto_id uuid, p_quantita numeric, p_ubicazione_id uuid default null, p_ristorante_dest uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.lotti; v_dest uuid; v_nuovo uuid; v_res numeric; v_chiave text := gen_random_uuid()::text;
begin
  select * into l from public.lotti where id = p_lotto_id for update;
  perform app.richiedi(found);
  v_dest := coalesce(p_ristorante_dest, l.ristorante_id);
  perform app.richiedi_op(l.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'magazzino');
  if v_dest <> l.ristorante_id then
    -- tra sedi: serve essere titolare in entrambe, e devono essere dello stesso gruppo
    perform app.richiedi_op(l.ristorante_id, array['titolare']::public.ruolo_membro[], 'magazzino');
    perform app.richiedi_op(v_dest, array['titolare']::public.ruolo_membro[], 'magazzino');
    if app.gruppo_di(v_dest) <> app.gruppo_di(l.ristorante_id) then raise exception 'Le sedi non appartengono allo stesso gruppo' using errcode = '42501'; end if;
  end if;
  if p_ubicazione_id is not null and not exists (select 1 from public.ubicazioni u where u.id = p_ubicazione_id and u.ristorante_id = v_dest) then
    raise exception 'Ubicazione di destinazione non valida' using errcode = '22023';
  end if;
  v_res := app.residuo(l.id);
  if p_quantita is null or p_quantita <= 0 or p_quantita > v_res then raise exception 'Quantità non disponibile (giacenza % %)', v_res, l.unita using errcode = '22023'; end if;

  if v_dest = l.ristorante_id and p_quantita = v_res then
    update public.lotti set ubicazione_id = p_ubicazione_id where id = l.id;   -- spostamento intero: tracciato dall'audit
    return l.id;
  end if;
  insert into public.lotti (ristorante_id, master_id, fornitore_id, documento_id, riga_id, ubicazione_id, tipo, codice_lotto, ricevuto_il,
      scadenza, unita, quantita_iniziale, costo_unitario, valuta, costo_unitario_eur, tasso_cambio, cambio_del, origine_lotto_id,
      produttore, annata, provenienza, formato, consumo_dal, consumo_al, consumo_fonte, consumo_note, creato_da)
  values (v_dest, l.master_id, l.fornitore_id, case when v_dest = l.ristorante_id then l.documento_id end,
      case when v_dest = l.ristorante_id then l.riga_id end, p_ubicazione_id, l.tipo, l.codice_lotto, l.ricevuto_il,
      l.scadenza, l.unita, p_quantita, l.costo_unitario, l.valuta, l.costo_unitario_eur, l.tasso_cambio, l.cambio_del, l.id,
      l.produttore, l.annata, l.provenienza, l.formato, l.consumo_dal, l.consumo_al, l.consumo_fonte, l.consumo_note, auth.uid())
  returning id into v_nuovo;
  insert into public.movimenti (ristorante_id, lotto_id, master_id, tipo, quantita, unita, riferimento, creato_da)
  values (l.ristorante_id, l.id, l.master_id, 'trasferimento_uscita', -p_quantita, l.unita, 'trasferimento:' || v_chiave, auth.uid()),
         (v_dest, v_nuovo, l.master_id, 'trasferimento_entrata', p_quantita, l.unita, 'trasferimento:' || v_chiave, auth.uid());
  return v_nuovo;
end $$;

-- Suggerimento di prelievo: FEFO (prima ciò che scade prima); senza scadenza vale FIFO (prima ciò che è arrivato prima).
-- È solo un suggerimento: nessun movimento viene registrato.
create or replace function public.suggerisci_prelievo(p_ristorante_id uuid, p_master_id uuid, p_quantita numeric, p_unita text)
returns table (lotto_id uuid, codice_lotto text, ubicazione text, scadenza date, ricevuto_il date, unita text,
               disponibile numeric, da_prelevare numeric, criterio text, convertibile boolean)
language plpgsql stable set search_path = '' as $$
declare r record; v_resto numeric := p_quantita; v_disp numeric; v_presa numeric;
begin
  for r in select g.* from public.v_giacenze g
            where g.ristorante_id = p_ristorante_id and g.master_id = p_master_id and g.stato = 'attivo' and g.quantita_residua > 0
            order by g.scadenza nulls last, g.ricevuto_il, g.creato_il loop
    exit when v_resto <= 0;
    v_disp := app.converti(p_master_id, r.quantita_residua, r.unita, p_unita);   -- giacenza nell'unità richiesta
    lotto_id := r.id; codice_lotto := r.codice_lotto; ubicazione := r.ubicazione_nome; scadenza := r.scadenza;
    ricevuto_il := r.ricevuto_il; unita := r.unita; disponibile := r.quantita_residua;
    criterio := case when r.scadenza is not null then 'FEFO' else 'FIFO' end;
    convertibile := v_disp is not null;
    if v_disp is null then da_prelevare := null; return next; continue; end if;
    v_presa := least(v_disp, v_resto);
    da_prelevare := round(app.converti(p_master_id, v_presa, p_unita, r.unita), 3);
    v_resto := v_resto - v_presa;
    return next;
  end loop;
end $$;

-- ── RLS e audit dei nuovi dati ─────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ubicazioni', 'sensori', 'letture', 'allarmi', 'lotti', 'movimenti'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "%s: lettura sede" on public.%I for select to authenticated using (app.ha_accesso_ristorante(ristorante_id))', t, t);
  end loop;
  -- letture e movimenti sono già registri immutabili con autore: non passano dall'audit generico
  foreach t in array array['ubicazioni', 'sensori', 'allarmi', 'lotti'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
alter table public.sensori_segreti enable row level security;
revoke all on public.sensori_segreti from public, anon, authenticated, service_role;
revoke all on public.v_ubicazioni, public.v_giacenze from anon, authenticated;
grant select on public.v_ubicazioni, public.v_giacenze to authenticated;
alter publication supabase_realtime add table public.allarmi;

-- ── Privilegi ──────────────────────────────────────────────────────────────
revoke all on function
  public.imposta_abbonamento(uuid, text, text, timestamptz, timestamptz, text, text, text), public.piano_corrente(uuid),
  public.crea_invito(uuid, text, public.ruolo_membro, boolean, int), public.segna_invio_invito(uuid, boolean, text),
  public.revoca_invito(uuid), public.anteprima_invito(text), public.accetta_invito(text),
  public.imposta_conversione(uuid, text, text, numeric, text, text), public.salva_ubicazione(uuid, jsonb, uuid),
  public.registra_lettura(uuid, numeric, timestamptz, text), public.crea_sensore(uuid, text, text),
  public.imposta_stato_sensore(uuid, text, date), public.ingest_lettura(text, numeric, timestamptz, text),
  public.gestisci_allarme(uuid, text, text, uuid), public.controlla_ubicazioni(), public.ricevi_lotto(uuid, jsonb),
  public.registra_movimento(uuid, text, numeric, text, text, text), public.storna_movimento(uuid, text),
  public.conta_lotto(uuid, numeric, text), public.imposta_stato_lotto(uuid, text, text),
  public.trasferisci_lotto(uuid, numeric, uuid, uuid), public.suggerisci_prelievo(uuid, uuid, numeric, text)
  from public, anon, authenticated;
grant execute on function
  public.piano_corrente(uuid), public.crea_invito(uuid, text, public.ruolo_membro, boolean, int),
  public.segna_invio_invito(uuid, boolean, text), public.revoca_invito(uuid), public.accetta_invito(text),
  public.imposta_conversione(uuid, text, text, numeric, text, text), public.salva_ubicazione(uuid, jsonb, uuid),
  public.registra_lettura(uuid, numeric, timestamptz, text), public.crea_sensore(uuid, text, text),
  public.imposta_stato_sensore(uuid, text, date), public.gestisci_allarme(uuid, text, text, uuid),
  public.ricevi_lotto(uuid, jsonb), public.registra_movimento(uuid, text, numeric, text, text, text),
  public.storna_movimento(uuid, text), public.conta_lotto(uuid, numeric, text), public.imposta_stato_lotto(uuid, text, text),
  public.trasferisci_lotto(uuid, numeric, uuid, uuid), public.suggerisci_prelievo(uuid, uuid, numeric, text)
  to authenticated;
grant execute on function public.anteprima_invito(text), public.ingest_lettura(text, numeric, timestamptz, text) to anon, authenticated;
grant execute on function public.imposta_abbonamento(uuid, text, text, timestamptz, timestamptz, text, text, text),
  public.controlla_ubicazioni() to service_role;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid),
  app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]), app.converti(uuid, numeric, text, text) to authenticated;
