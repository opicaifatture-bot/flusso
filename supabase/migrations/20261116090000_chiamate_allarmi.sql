-- Chiamate telefoniche agli allarmi di temperatura (Twilio).
-- Il database decide chi chiamare e quando; l'invio vero lo fa l'app (Vercel) con le chiavi Twilio
-- inserite dal titolare nelle impostazioni Vercel. Senza chiavi la chiamata risulta "non_configurato":
-- nessuna telefonata viene dichiarata partita.
create extension if not exists pg_net with schema extensions;

create table public.contatti_allarme (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  telefono text not null check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  ordine int not null default 1 check (ordine between 1 and 20),
  attivo boolean not null default true,
  creato_il timestamptz not null default now()
);
create index on public.contatti_allarme (ristorante_id, ordine);

create table public.impostazioni_chiamate (
  ristorante_id uuid primary key references public.ristoranti(id) on delete cascade,
  attive boolean not null default false,
  solo_critici boolean not null default false,
  attesa_min int not null default 5 check (attesa_min between 2 and 60),
  giri int not null default 2 check (giri between 1 and 5),
  sms_riserva boolean not null default true,
  aggiornato_il timestamptz not null default now()
);

create table public.chiamate_allarme (
  id uuid primary key default gen_random_uuid(),
  allarme_id uuid not null references public.allarmi(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  contatto_id uuid references public.contatti_allarme(id) on delete set null,
  nome text not null,
  telefono text not null,
  giro int not null default 1,
  canale text not null check (canale in ('voce', 'sms')),
  stato text not null default 'in_coda' check (stato in ('in_coda', 'inviata', 'confermata', 'senza_risposta', 'errore', 'non_configurato')),
  token_hash text not null,
  provider_sid text,
  errore text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index on public.chiamate_allarme (allarme_id, creato_il);

-- Configurazione non segreta (indirizzo dell'app per i richiami).
create table app.configurazione (chiave text primary key, valore text not null);

alter table public.contatti_allarme enable row level security;
alter table public.impostazioni_chiamate enable row level security;
alter table public.chiamate_allarme enable row level security;
-- I numeri di telefono sono dati personali: solo titolare e chef.
create policy "contatti_allarme: titolare e chef" on public.contatti_allarme for select to authenticated
  using (app.ha_ruolo(ristorante_id, array['titolare', 'chef']::public.ruolo_membro[]));
create policy "impostazioni_chiamate: titolare e chef" on public.impostazioni_chiamate for select to authenticated
  using (app.ha_ruolo(ristorante_id, array['titolare', 'chef']::public.ruolo_membro[]));
create policy "chiamate_allarme: titolare e chef" on public.chiamate_allarme for select to authenticated
  using (app.ha_ruolo(ristorante_id, array['titolare', 'chef']::public.ruolo_membro[]));

-- ── Gestione dall'app ────────────────────────────────────────────────
create or replace function public.salva_contatto_allarme(p_ristorante_id uuid, p_id uuid, p_nome text, p_telefono text, p_ordine int, p_attivo boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tel text := regexp_replace(coalesce(p_telefono, ''), '[\s\-\.\(\)]', '', 'g');
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'celle');
  if v_tel ~ '^00' then v_tel := '+' || substr(v_tel, 3); end if;
  if v_tel ~ '^3[0-9]{8,9}$' then v_tel := '+39' || v_tel; end if;   -- cellulare italiano senza prefisso
  if v_tel !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Numero di telefono non valido (es. +39 333 1234567)' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.contatti_allarme (ristorante_id, nome, telefono, ordine, attivo)
    values (p_ristorante_id, btrim(p_nome), v_tel, coalesce(p_ordine, 1), coalesce(p_attivo, true)) returning id into v_id;
  else
    update public.contatti_allarme set nome = btrim(p_nome), telefono = v_tel, ordine = coalesce(p_ordine, ordine), attivo = coalesce(p_attivo, attivo)
     where id = p_id and ristorante_id = p_ristorante_id returning id into v_id;
    perform app.richiedi(v_id is not null);
  end if;
  return v_id;
end $$;

create or replace function public.elimina_contatto_allarme(p_ristorante_id uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'celle');
  delete from public.contatti_allarme where id = p_id and ristorante_id = p_ristorante_id;  -- lo storico chiamate conserva nome e numero
end $$;

create or replace function public.imposta_chiamate(p_ristorante_id uuid, p_dati jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'celle');
  if coalesce((p_dati->>'attive')::boolean, false)
     and not exists (select 1 from public.contatti_allarme where ristorante_id = p_ristorante_id and attivo) then
    raise exception 'Aggiungi almeno un numero da chiamare prima di attivare le chiamate' using errcode = '22023';
  end if;
  insert into public.impostazioni_chiamate as i (ristorante_id, attive, solo_critici, attesa_min, giri, sms_riserva)
  values (p_ristorante_id, coalesce((p_dati->>'attive')::boolean, false), coalesce((p_dati->>'solo_critici')::boolean, false),
          coalesce((p_dati->>'attesa_min')::int, 5), coalesce((p_dati->>'giri')::int, 2), coalesce((p_dati->>'sms_riserva')::boolean, true))
  on conflict (ristorante_id) do update set attive = excluded.attive, solo_critici = excluded.solo_critici,
     attesa_min = excluded.attesa_min, giri = excluded.giri, sms_riserva = excluded.sms_riserva, aggiornato_il = now();
end $$;

-- ── Motore (cron ogni minuto) ───────────────────────────────────────
-- Crea la chiamata e chiede all'app di farla partire, passando solo id e token monouso.
create or replace function app.accoda_chiamata(a public.allarmi, c public.contatti_allarme, p_giro int, p_canale text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); v_id uuid; v_url text;
begin
  select valore into v_url from app.configurazione where chiave = 'url_app';
  insert into public.chiamate_allarme (allarme_id, ristorante_id, contatto_id, nome, telefono, giro, canale, token_hash, stato, errore)
  values (a.id, a.ristorante_id, c.id, c.nome, c.telefono, p_giro, p_canale, app.hash_token(v_token),
          case when v_url is null then 'non_configurato' else 'in_coda' end,
          case when v_url is null then 'Indirizzo dell''app non configurato' end)
  returning id into v_id;
  if v_url is not null then
    perform net.http_post(url := v_url || '/api/allarmi/chiama', body := jsonb_build_object('id', v_id, 'token', v_token),
                          headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 20000);
  end if;
end $$;

create or replace function public.gestisci_chiamate() returns int
language plpgsql security definer set search_path = '' as $$
declare a public.allarmi; imp public.impostazioni_chiamate; c public.contatti_allarme;
  ultima public.chiamate_allarme; v_giro int; v_n int := 0;
begin
  for a in select x.* from public.allarmi x where x.stato = 'aperto' loop
    select * into imp from public.impostazioni_chiamate where ristorante_id = a.ristorante_id and attive;
    continue when not found;
    continue when imp.solo_critici and a.severita <> 'critico';
    -- chiamata confermata = qualcuno se ne occupa
    continue when exists (select 1 from public.chiamate_allarme where allarme_id = a.id and stato = 'confermata');
    select * into ultima from public.chiamate_allarme where allarme_id = a.id and canale = 'voce' order by creato_il desc limit 1;
    if ultima.id is not null and ultima.creato_il > now() - make_interval(mins => imp.attesa_min) then continue; end if;
    -- prossimo contatto in ordine dopo l'ultimo chiamato, poi giro successivo
    v_giro := coalesce(ultima.giro, 1);
    select * into c from public.contatti_allarme k
     where k.ristorante_id = a.ristorante_id and k.attivo
       and (ultima.id is null or (k.ordine, k.id::text) > (select o.ordine, o.id::text from public.contatti_allarme o where o.id = ultima.contatto_id))
     order by k.ordine, k.id::text limit 1;
    if c.id is null and ultima.id is not null then
      v_giro := v_giro + 1;
      select * into c from public.contatti_allarme k where k.ristorante_id = a.ristorante_id and k.attivo order by k.ordine, k.id::text limit 1;
    end if;
    if c.id is null then continue; end if;
    if v_giro > imp.giri then
      -- giri esauriti: SMS di riserva a tutti, una volta sola
      if imp.sms_riserva and not exists (select 1 from public.chiamate_allarme where allarme_id = a.id and canale = 'sms') then
        for c in select * from public.contatti_allarme k where k.ristorante_id = a.ristorante_id and k.attivo order by k.ordine loop
          perform app.accoda_chiamata(a, c, v_giro, 'sms'); v_n := v_n + 1;
        end loop;
      end if;
      continue;
    end if;
    perform app.accoda_chiamata(a, c, v_giro, 'voce'); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.gestisci_chiamate() from public, anon, authenticated;
select cron.schedule('kitchen-os-chiamate-allarmi', '* * * * *', 'select public.gestisci_chiamate()');

-- ── Interfaccia per l'app, autenticata dal token monouso ─────────────
create or replace function app.chiamata_da_token(p_id uuid, p_token text) returns public.chiamate_allarme
language sql stable security definer set search_path = '' as $$
  select * from public.chiamate_allarme
   where id = p_id and token_hash = app.hash_token(coalesce(p_token, ''))
     and creato_il > now() - interval '24 hours'
$$;

-- Dati per comporre la chiamata (solo per la chiamata in coda).
create or replace function public.dati_chiamata(p_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k public.chiamate_allarme := app.chiamata_da_token(p_id, p_token); a public.allarmi; r text; u text;
begin
  if k.id is null or k.stato <> 'in_coda' then return null; end if;
  select * into a from public.allarmi where id = k.allarme_id;
  select nome into r from public.ristoranti where id = a.ristorante_id;
  select nome into u from public.ubicazioni where id = a.ubicazione_id;
  return jsonb_build_object('telefono', k.telefono, 'canale', k.canale, 'nome', k.nome, 'ristorante', r, 'ubicazione', u,
    'tipo', a.tipo, 'dettaglio', a.dettaglio, 'valore', a.valore_estremo, 'severita', a.severita, 'stato_allarme', a.stato);
end $$;

-- Esiti: 'inviata' (con sid), 'errore', 'non_configurato', 'senza_risposta', 'confermata'.
create or replace function public.esito_chiamata(p_id uuid, p_token text, p_esito text, p_sid text default null, p_errore text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare k public.chiamate_allarme := app.chiamata_da_token(p_id, p_token);
begin
  if k.id is null or p_esito not in ('inviata', 'errore', 'non_configurato', 'senza_risposta', 'confermata') then return false; end if;
  if k.stato = 'confermata' then return true; end if;
  -- ogni esito vale solo dallo stato giusto: un token non può riscrivere la storia
  if p_esito in ('inviata', 'errore', 'non_configurato') and k.stato <> 'in_coda' then return false; end if;
  if p_esito = 'confermata' and k.stato not in ('inviata', 'senza_risposta') or k.canale <> 'voce' and p_esito = 'confermata' then return false; end if;
  if p_esito = 'senza_risposta' and k.stato <> 'inviata' then return true; end if;
  update public.chiamate_allarme set stato = p_esito, provider_sid = coalesce(left(p_sid, 64), provider_sid),
         errore = left(p_errore, 300), aggiornato_il = now() where id = k.id;
  if p_esito = 'confermata' then
    update public.allarmi set stato = 'in_carico', preso_il = now(),
           note = concat_ws(' · ', note, 'Preso in carico al telefono da ' || k.nome || ' alle ' || to_char(now() at time zone 'Europe/Rome', 'HH24:MI'))
     where id = k.allarme_id and stato = 'aperto';
  end if;
  return true;
end $$;
grant execute on function public.dati_chiamata(uuid, text), public.esito_chiamata(uuid, text, text, text, text) to anon, authenticated;
