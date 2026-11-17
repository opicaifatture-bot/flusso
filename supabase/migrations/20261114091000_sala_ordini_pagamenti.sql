-- ═══════════════════════════════════════════════════════════════════════════
-- Sala — tavoli con QR, menu digitale, ordini dal tavolo, display di cucina,
-- chiamate al cameriere, conto e pagamento (adattatori; solo modalità di prova
-- finché un servizio di pagamento e la cassa fiscale non sono collegati).
-- ═══════════════════════════════════════════════════════════════════════════
-- Regole: il QR funziona solo mentre il tavolo è aperto dal cameriere; il cliente
-- non ha account e non lascia dati personali; nessun incasso reale senza un
-- servizio configurato; nessuno scontrino dichiarato emesso se la cassa non lo conferma.

-- Chi vede e gestisce la sala: titolare, chef, sala (il contabile e il consulente no).
create or replace function app.vede_sala(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.ruolo_ristorante(p_ristorante_id) in ('titolare', 'chef', 'sala', 'sola_lettura'), false)
$$;
-- Il ruolo sala non vede i dati economici dell'azienda (come consulente e cucina).
create or replace function app.ha_accesso_ristorante(p_ristorante_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.ruolo_ristorante(p_ristorante_id) not in ('consulente', 'cucina', 'sala'), false)
$$;
create or replace function app.ha_accesso_gruppo(p_gruppo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membri_gruppo mg
                  where mg.gruppo_id = p_gruppo_id and mg.user_id = (select auth.uid())
                    and mg.ruolo not in ('consulente', 'cucina', 'sala'))
      or exists (select 1 from public.membri_ristorante mr
                   join public.ristoranti r on r.id = mr.ristorante_id
                  where r.gruppo_id = p_gruppo_id and mr.user_id = (select auth.uid())
                    and mr.ruolo not in ('consulente', 'cucina', 'sala'))
$$;

insert into public.funzionalita (codice, nome, descrizione) values
  ('sala', 'Sala e ordini al tavolo', 'QR sui tavoli, menu digitale, ordini, cucina, chiamate, conto e pagamento');
insert into public.piano_funzionalita (piano_codice, funzionalita_codice) values ('completo', 'sala');

-- ── Configurazione della sede ──────────────────────────────────────────────
-- Nessun segreto qui: chiavi e credenziali dei servizi stanno nelle variabili del server.
create table public.sala_impostazioni (
  ristorante_id uuid primary key references public.ristoranti(id) on delete cascade,
  lingue text[] not null default '{it,en}',
  coperto numeric(8,2) check (coperto is null or coperto >= 0),         -- per persona, se previsto
  ordini_cliente boolean not null default true,                         -- il cliente può ordinare da solo
  pagamento_provider text check (pagamento_provider in ('stripe', 'nexi', 'sumup', 'satispay')),
  pagamento_modalita text not null default 'prova' check (pagamento_modalita in ('prova', 'attivo')),
  cassa_provider text,                                                  -- registratore telematico o cassa in cloud collegata
  mance boolean not null default true,
  aggiornato_il timestamptz not null default now()
);

-- ── Sale e tavoli ──────────────────────────────────────────────────────────
create table public.sale (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  nome text not null check (btrim(nome) <> ''),
  ordine int not null default 0,
  unique (ristorante_id, nome)
);
create table public.tavoli (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  sala_id uuid references public.sale(id) on delete set null,
  codice text not null check (btrim(codice) <> ''),
  posti int check (posti is null or posti > 0),
  qr_token text not null unique,
  attivo boolean not null default true,
  unique (ristorante_id, codice)
);
create or replace function app.nuovo_token_qr() returns text
language sql volatile set search_path = '' as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

-- ── Menu ───────────────────────────────────────────────────────────────────
create table public.menu_voci (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ricetta_id uuid references public.ricette(id) on delete set null,
  categoria text not null default 'Altro',
  nome text not null check (btrim(nome) <> ''),
  descrizione text,
  prezzo numeric(10,2) not null check (prezzo >= 0),
  reparto text not null default 'cucina' check (reparto in ('cucina', 'pasticceria', 'bar', 'pizzeria')),
  allergeni text[] not null default '{}',     -- per le voci senza ricetta (es. bevande); con ricetta si calcolano
  traduzioni jsonb not null default '{}',     -- {"en": {"nome": "...", "descrizione": "..."}, "fr": {...}}
  foto_path text,
  ordine int not null default 0,
  visibile boolean not null default true,
  esaurito boolean not null default false,
  creato_il timestamptz not null default now()
);
create index on public.menu_voci (ristorante_id, categoria, ordine);

-- ── Sessioni del tavolo, ordini, chiamate ──────────────────────────────────
create table public.sessioni_tavolo (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  tavolo_id uuid not null references public.tavoli(id) on delete restrict,
  stato text not null default 'aperta' check (stato in ('aperta', 'conto_richiesto', 'chiusa')),
  coperti int check (coperti is null or coperti > 0),
  aperta_da uuid references auth.users(id) on delete set null,
  aperta_il timestamptz not null default now(),
  chiusa_da uuid references auth.users(id) on delete set null,
  chiusa_il timestamptz,
  nota_chiusura text
);
create unique index sessioni_tavolo_aperta on public.sessioni_tavolo (tavolo_id) where stato <> 'chiusa';

create table public.ordini_tavolo (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  sessione_id uuid not null references public.sessioni_tavolo(id) on delete restrict,
  numero int not null,
  fonte text not null check (fonte in ('tavolo', 'sala')),
  lingua text,
  nota text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  unique (sessione_id, numero)
);
create table public.ordini_righe (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ordine_id uuid not null references public.ordini_tavolo(id) on delete restrict,
  sessione_id uuid not null references public.sessioni_tavolo(id) on delete restrict,
  voce_id uuid references public.menu_voci(id) on delete set null,
  nome text not null,             -- copia al momento dell'ordine: il conto non cambia se il menu cambia
  prezzo numeric(10,2) not null,
  quantita int not null check (quantita between 1 and 50),
  note text,
  uscita int not null default 1 check (uscita between 1 and 5),
  reparto text not null,
  stato text not null default 'inviato' check (stato in ('inviato', 'in_preparazione', 'pronto', 'servito', 'annullato')),
  motivo_annullamento text,
  aggiornato_il timestamptz not null default now(),
  check (stato <> 'annullato' or coalesce(btrim(motivo_annullamento), '') <> '')
);
create index on public.ordini_righe (ristorante_id, stato);
create index on public.ordini_righe (sessione_id);

create table public.chiamate_tavolo (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  sessione_id uuid not null references public.sessioni_tavolo(id) on delete restrict,
  tipo text not null check (tipo in ('cameriere', 'conto', 'acqua', 'pane')),
  stato text not null default 'aperta' check (stato in ('aperta', 'presa', 'chiusa')),
  creata_il timestamptz not null default now(),
  presa_da uuid references auth.users(id) on delete set null, presa_il timestamptz
);
create index on public.chiamate_tavolo (ristorante_id, stato);

-- ── Pagamenti ──────────────────────────────────────────────────────────────
-- Un pagamento non si cancella: si annulla o si rimborsa con un nuovo stato tracciato.
create table public.pagamenti_tavolo (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  sessione_id uuid not null references public.sessioni_tavolo(id) on delete restrict,
  importo numeric(10,2) not null check (importo > 0),
  mancia numeric(10,2) not null default 0 check (mancia >= 0),
  metodo text not null check (metodo in ('online', 'carta_pos', 'contanti')),
  provider text not null check (provider in ('prova', 'stripe', 'nexi', 'sumup', 'satispay', 'cassa')),
  stato text not null check (stato in ('in_attesa', 'pagato', 'fallito', 'annullato', 'rimborsato')),
  provider_rif text,
  quota jsonb not null default '{}',          -- {"modo": "uguale|righe|importo", "righe": [...], "parti": 4}
  fiscale_stato text not null default 'da_emettere' check (fiscale_stato in ('da_emettere', 'emesso', 'non_dovuto')),
  fiscale_rif text,
  registrato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create trigger pagamenti_non_cancellabili before delete on public.pagamenti_tavolo for each row execute function app.immutabile();
create trigger ordini_non_cancellabili before delete on public.ordini_righe for each row execute function app.immutabile();
create trigger sessioni_non_cancellabili before delete on public.sessioni_tavolo for each row execute function app.immutabile();

-- ── Funzioni di calcolo ────────────────────────────────────────────────────
create or replace function app.sessione_da_token(p_token text) returns public.sessioni_tavolo
language sql stable security definer set search_path = '' as $$
  select s.* from public.tavoli t join public.sessioni_tavolo s on s.tavolo_id = t.id and s.stato <> 'chiusa'
   where t.qr_token = p_token and t.attivo limit 1
$$;

-- Totale del conto: righe non annullate + coperto per persona, meno quanto già pagato.
create or replace function app.conto(p_sessione_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.sessioni_tavolo where id = p_sessione_id),
  righe as (select r.id, r.nome, r.prezzo, r.quantita, r.stato, r.prezzo * r.quantita as totale
              from public.ordini_righe r where r.sessione_id = p_sessione_id and r.stato <> 'annullato'),
  cop as (select coalesce(i.coperto, 0) * coalesce(s.coperti, 0) as coperto from s left join public.sala_impostazioni i on i.ristorante_id = s.ristorante_id),
  pag as (select coalesce(sum(importo), 0) as pagato, coalesce(sum(mancia), 0) as mance from public.pagamenti_tavolo where sessione_id = p_sessione_id and stato = 'pagato')
  select jsonb_build_object(
    'righe', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'prezzo', prezzo, 'quantita', quantita, 'totale', totale, 'stato', stato) order by nome) from righe), '[]'),
    'coperti', (select coperti from s), 'coperto', (select coperto from cop),
    'totale', (select coalesce(sum(totale), 0) from righe) + (select coperto from cop),
    'pagato', (select pagato from pag), 'mance', (select mance from pag),
    'da_pagare', greatest(0, (select coalesce(sum(totale), 0) from righe) + (select coperto from cop) - (select pagato from pag)),
    'righe_pagate', coalesce((select jsonb_agg(distinct x) from public.pagamenti_tavolo p, jsonb_array_elements_text(coalesce(p.quota->'righe', '[]')) x
                               where p.sessione_id = p_sessione_id and p.stato = 'pagato'), '[]'))
$$;

-- Allergeni di una voce di menu: dalla ricetta (se collegata) più quelli dichiarati sulla voce.
create or replace function app.allergeni_voce(p_voce public.menu_voci) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'contiene', coalesce((select jsonb_agg(distinct a) from (
        select unnest(p_voce.allergeni) a
        union select unnest(ip.allergeni) from public.ricette_versioni v, app.composizione(v.id) c join public.info_prodotti ip on ip.master_id = c.master_id
         where v.ricetta_id = p_voce.ricetta_id and v.stato = 'attiva') x), '[]'),
    'tracce', coalesce((select jsonb_agg(distinct a) from (
        select unnest(ip.tracce) a from public.ricette_versioni v, app.composizione(v.id) c join public.info_prodotti ip on ip.master_id = c.master_id
         where v.ricetta_id = p_voce.ricetta_id and v.stato = 'attiva'
        union select unnest(r.tracce_aggiuntive) from public.ricette r where r.id = p_voce.ricetta_id) x), '[]'),
    'incompleto', p_voce.ricetta_id is not null and exists (
        select 1 from public.ricette_versioni v, app.composizione(v.id) c left join public.info_prodotti ip on ip.master_id = c.master_id
         where v.ricetta_id = p_voce.ricetta_id and v.stato = 'attiva' and ip.master_id is null))
$$;

-- ── Funzioni pubbliche per il cliente al tavolo (senza account) ────────────
create or replace function public.tavolo_cliente(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t public.tavoli; s public.sessioni_tavolo; i public.sala_impostazioni;
begin
  select * into t from public.tavoli where qr_token = p_token and attivo;
  if not found then return jsonb_build_object('stato', 'non_valido'); end if;
  s := app.sessione_da_token(p_token);
  select * into i from public.sala_impostazioni where ristorante_id = t.ristorante_id;
  if s.id is null then
    return jsonb_build_object('stato', 'chiuso', 'sede', (select nome from public.ristoranti where id = t.ristorante_id), 'tavolo', t.codice);
  end if;
  return jsonb_build_object(
    'stato', s.stato, 'sede', (select nome from public.ristoranti where id = t.ristorante_id), 'tavolo', t.codice,
    'lingue', coalesce(i.lingue, '{it,en}'), 'ordini_cliente', coalesce(i.ordini_cliente, true), 'mance', coalesce(i.mance, true),
    'pagamento', case when i.pagamento_provider is not null and i.pagamento_modalita = 'attivo' then 'attivo' else 'prova' end,
    'menu', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'categoria', v.categoria, 'nome', v.nome, 'descrizione', v.descrizione,
                'prezzo', v.prezzo, 'esaurito', v.esaurito, 'traduzioni', v.traduzioni, 'foto', v.foto_path, 'allergeni', app.allergeni_voce(v))
              order by v.categoria, v.ordine, v.nome)
              from public.menu_voci v where v.ristorante_id = t.ristorante_id and v.visibile), '[]'),
    'ordini', coalesce((select jsonb_agg(jsonb_build_object('nome', r.nome, 'quantita', r.quantita, 'stato', r.stato, 'uscita', r.uscita) order by o.numero, r.uscita)
              from public.ordini_righe r join public.ordini_tavolo o on o.id = r.ordine_id where r.sessione_id = s.id and r.stato <> 'annullato'), '[]'),
    'conto', app.conto(s.id));
end $$;

create or replace function public.ordina_dal_tavolo(p_token text, p_righe jsonb, p_lingua text default null, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo; i public.sala_impostazioni; v_ord uuid; v_num int; r jsonb; v public.menu_voci; n int := 0;
begin
  s := app.sessione_da_token(p_token);
  if s.id is null then raise exception 'Il tavolo non è aperto: chiedi al personale' using errcode = 'P0002'; end if;
  if s.stato = 'conto_richiesto' then raise exception 'Il conto è già stato richiesto: chiedi al personale per altri ordini' using errcode = '22023'; end if;
  select * into i from public.sala_impostazioni where ristorante_id = s.ristorante_id;
  if not coalesce(i.ordini_cliente, true) then raise exception 'Gli ordini si fanno con il personale di sala' using errcode = '42501'; end if;
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 or jsonb_array_length(p_righe) > 40 then
    raise exception 'Ordine vuoto o troppo lungo' using errcode = '22023';
  end if;
  -- Freno contro invii ripetuti: al massimo 6 ordini dal tavolo ogni 10 minuti.
  if (select count(*) from public.ordini_tavolo o where o.sessione_id = s.id and o.fonte = 'tavolo' and o.creato_il > now() - interval '10 minutes') >= 6 then
    raise exception 'Troppi ordini in poco tempo: chiama il cameriere' using errcode = '22023';
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.ordini_tavolo where sessione_id = s.id;
  insert into public.ordini_tavolo (ristorante_id, sessione_id, numero, fonte, lingua, nota)
  values (s.ristorante_id, s.id, v_num, 'tavolo', left(p_lingua, 5), left(nullif(btrim(p_nota), ''), 300)) returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v from public.menu_voci where id = app.uuid_sicuro(r->>'voce_id') and ristorante_id = s.ristorante_id and visibile;
    if not found then raise exception 'Piatto non disponibile' using errcode = '22023'; end if;
    if v.esaurito then raise exception '«%» è esaurito', v.nome using errcode = '22023'; end if;
    insert into public.ordini_righe (ristorante_id, ordine_id, sessione_id, voce_id, nome, prezzo, quantita, note, uscita, reparto)
    values (s.ristorante_id, v_ord, s.id, v.id, v.nome, v.prezzo, greatest(1, least(50, coalesce(app.num(r->>'quantita')::int, 1))),
            left(nullif(btrim(r->>'note'), ''), 200), greatest(1, least(5, coalesce(app.num(r->>'uscita')::int, 1))), v.reparto);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ordine', v_num, 'righe', n);
end $$;

create or replace function public.chiama_dal_tavolo(p_token text, p_tipo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo;
begin
  s := app.sessione_da_token(p_token);
  if s.id is null then raise exception 'Il tavolo non è aperto' using errcode = 'P0002'; end if;
  if p_tipo not in ('cameriere', 'conto', 'acqua', 'pane') then raise exception 'Richiesta non valida' using errcode = '22023'; end if;
  -- Una sola chiamata aperta per tipo: premere più volte non moltiplica gli avvisi.
  if not exists (select 1 from public.chiamate_tavolo c where c.sessione_id = s.id and c.tipo = p_tipo and c.stato <> 'chiusa') then
    insert into public.chiamate_tavolo (ristorante_id, sessione_id, tipo) values (s.ristorante_id, s.id, p_tipo);
  end if;
  if p_tipo = 'conto' then update public.sessioni_tavolo set stato = 'conto_richiesto' where id = s.id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- Pagamento dal tavolo. In modalità di prova registra un pagamento simulato (provider "prova"):
-- nessun denaro passa. Con un servizio attivo, il pagamento nasce "in_attesa" e diventa "pagato"
-- solo con la conferma firmata del servizio (webhook, lato server).
create or replace function public.paga_dal_tavolo(p_token text, p_importo numeric, p_mancia numeric default 0, p_quota jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo; i public.sala_impostazioni; c jsonb; v_id uuid; v_attivo boolean;
begin
  s := app.sessione_da_token(p_token);
  if s.id is null then raise exception 'Il tavolo non è aperto' using errcode = 'P0002'; end if;
  select * into i from public.sala_impostazioni where ristorante_id = s.ristorante_id;
  c := app.conto(s.id);
  if p_importo is null or p_importo <= 0 then raise exception 'Importo non valido' using errcode = '22023'; end if;
  if p_importo > (c->>'da_pagare')::numeric + 0.005 then raise exception 'L''importo supera quanto resta da pagare (%)', c->>'da_pagare' using errcode = '22023'; end if;
  if coalesce(p_mancia, 0) < 0 or coalesce(p_mancia, 0) > p_importo then raise exception 'Mancia non valida' using errcode = '22023'; end if;
  if coalesce(p_mancia, 0) > 0 and not coalesce(i.mance, true) then raise exception 'Mance non previste' using errcode = '22023'; end if;
  v_attivo := i.pagamento_provider is not null and i.pagamento_modalita = 'attivo';
  insert into public.pagamenti_tavolo (ristorante_id, sessione_id, importo, mancia, metodo, provider, stato, quota)
  values (s.ristorante_id, s.id, round(p_importo, 2), round(coalesce(p_mancia, 0), 2), 'online',
          case when v_attivo then i.pagamento_provider else 'prova' end, case when v_attivo then 'in_attesa' else 'pagato' end,
          coalesce(p_quota, '{}'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'pagamento_id', v_id, 'prova', not v_attivo, 'conto', app.conto(s.id));
end $$;

-- Conferma dal servizio di pagamento (solo ruolo di servizio, chiamata dal webhook verificato).
create or replace function public.conferma_pagamento(p_pagamento_id uuid, p_stato text, p_provider_rif text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_stato not in ('pagato', 'fallito', 'annullato', 'rimborsato') then raise exception 'Stato non valido' using errcode = '22023'; end if;
  update public.pagamenti_tavolo set stato = p_stato, provider_rif = p_provider_rif, aggiornato_il = now()
   where id = p_pagamento_id and provider <> 'prova';
  if not found then raise exception 'Pagamento non trovato' using errcode = 'P0002'; end if;
end $$;

-- ── Funzioni per il personale ──────────────────────────────────────────────
create or replace function public.imposta_sala(p_ristorante_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_lingue text[];
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare']::public.ruolo_membro[], 'sala');
  v_lingue := coalesce(array(select jsonb_array_elements_text(p_dati->'lingue')), '{it}');
  if not (v_lingue <@ array['it', 'en', 'fr', 'de', 'es']) then raise exception 'Lingua non supportata' using errcode = '22023'; end if;
  -- L'attivazione degli incassi reali non si fa da qui: richiede la configurazione del servizio sul server.
  if p_dati->>'pagamento_modalita' = 'attivo' then
    raise exception 'Gli incassi reali si attivano solo dopo aver collegato e verificato il servizio di pagamento' using errcode = '42501';
  end if;
  insert into public.sala_impostazioni (ristorante_id, lingue, coperto, ordini_cliente, mance, pagamento_provider)
  values (p_ristorante_id, v_lingue, app.num(p_dati->>'coperto'), coalesce((p_dati->>'ordini_cliente')::boolean, true),
          coalesce((p_dati->>'mance')::boolean, true), nullif(p_dati->>'pagamento_provider', ''))
  on conflict (ristorante_id) do update set lingue = excluded.lingue, coperto = excluded.coperto, ordini_cliente = excluded.ordini_cliente,
    mance = excluded.mance, pagamento_provider = excluded.pagamento_provider, aggiornato_il = now();
end $$;

create or replace function public.salva_tavolo(p_ristorante_id uuid, p_dati jsonb, p_tavolo_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_tavolo_id; v_sala uuid;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'sala');
  if coalesce(btrim(p_dati->>'sala'), '') <> '' then
    insert into public.sale (ristorante_id, nome) values (p_ristorante_id, btrim(p_dati->>'sala'))
    on conflict (ristorante_id, nome) do update set nome = excluded.nome returning id into v_sala;
  end if;
  if v_id is null then
    insert into public.tavoli (ristorante_id, sala_id, codice, posti, qr_token)
    values (p_ristorante_id, v_sala, btrim(p_dati->>'codice'), app.num(p_dati->>'posti')::int, app.nuovo_token_qr()) returning id into v_id;
  else
    update public.tavoli set codice = coalesce(nullif(btrim(p_dati->>'codice'), ''), codice), sala_id = coalesce(v_sala, sala_id),
      posti = case when p_dati ? 'posti' then app.num(p_dati->>'posti')::int else posti end,
      attivo = case when p_dati ? 'attivo' then (p_dati->>'attivo')::boolean else attivo end
    where id = v_id and ristorante_id = p_ristorante_id;
    if not found then raise exception 'Tavolo non trovato' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Nuovo QR (es. adesivo rovinato o fotografato): il vecchio smette di funzionare.
create or replace function public.rigenera_qr(p_tavolo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tavoli;
begin
  select * into t from public.tavoli where id = p_tavolo_id;
  perform app.richiedi(found);
  perform app.richiedi_op(t.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'sala');
  update public.tavoli set qr_token = app.nuovo_token_qr() where id = t.id;
end $$;

create or replace function public.apri_tavolo(p_tavolo_id uuid, p_coperti int default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t public.tavoli; v_id uuid;
begin
  select * into t from public.tavoli where id = p_tavolo_id and attivo;
  perform app.richiedi(found);
  perform app.richiedi_op(t.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if exists (select 1 from public.sessioni_tavolo where tavolo_id = t.id and stato <> 'chiusa') then
    raise exception 'Il tavolo è già aperto' using errcode = '23505';
  end if;
  insert into public.sessioni_tavolo (ristorante_id, tavolo_id, coperti, aperta_da) values (t.ristorante_id, t.id, p_coperti, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.imposta_coperti(p_sessione_id uuid, p_coperti int)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo;
begin
  select * into s from public.sessioni_tavolo where id = p_sessione_id and stato <> 'chiusa';
  perform app.richiedi(found);
  perform app.richiedi_op(s.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if p_coperti is null or p_coperti < 1 then raise exception 'Coperti non validi' using errcode = '22023'; end if;
  update public.sessioni_tavolo set coperti = p_coperti where id = s.id;
end $$;

-- Chiusura: a conto saldato, oppure con un motivo (es. "pagato alla cassa"). Il QR smette di funzionare.
create or replace function public.chiudi_tavolo(p_sessione_id uuid, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo; c jsonb;
begin
  select * into s from public.sessioni_tavolo where id = p_sessione_id and stato <> 'chiusa' for update;
  perform app.richiedi(found);
  perform app.richiedi_op(s.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  c := app.conto(s.id);
  if (c->>'da_pagare')::numeric > 0 and coalesce(btrim(p_nota), '') = '' then
    raise exception 'Restano % € da pagare: registra il pagamento o indica il motivo della chiusura', c->>'da_pagare' using errcode = '22023';
  end if;
  update public.sessioni_tavolo set stato = 'chiusa', chiusa_da = auth.uid(), chiusa_il = now(), nota_chiusura = nullif(btrim(p_nota), '') where id = s.id;
  update public.chiamate_tavolo set stato = 'chiusa' where sessione_id = s.id and stato <> 'chiusa';
  return jsonb_build_object('ok', true, 'scontrini_da_emettere', (select count(*) from public.pagamenti_tavolo where sessione_id = s.id and stato = 'pagato' and fiscale_stato = 'da_emettere'));
end $$;

create or replace function public.salva_voce_menu(p_ristorante_id uuid, p_dati jsonb, p_voce_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_voce_id; k text; v_all text[];
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'sala');
  v_all := case when p_dati ? 'allergeni' then coalesce(array(select jsonb_array_elements_text(p_dati->'allergeni')), '{}') end;
  foreach k in array coalesce(v_all, '{}') loop
    if not exists (select 1 from public.allergeni a where a.codice = k) then raise exception 'Allergene sconosciuto: %', k using errcode = '22023'; end if;
  end loop;
  if app.uuid_sicuro(p_dati->>'ricetta_id') is not null and not exists (select 1 from public.ricette r where r.id = app.uuid_sicuro(p_dati->>'ricetta_id') and r.ristorante_id = p_ristorante_id) then
    raise exception 'Ricetta non valida' using errcode = '22023';
  end if;
  if v_id is null then
    if coalesce(btrim(p_dati->>'nome'), '') = '' or app.num(p_dati->>'prezzo') is null then raise exception 'Indica nome e prezzo' using errcode = '22023'; end if;
    insert into public.menu_voci (ristorante_id, nome, prezzo) values (p_ristorante_id, btrim(p_dati->>'nome'), app.num(p_dati->>'prezzo')) returning id into v_id;
  elsif not exists (select 1 from public.menu_voci where id = v_id and ristorante_id = p_ristorante_id) then
    raise exception 'Voce non trovata' using errcode = 'P0002';
  end if;
  update public.menu_voci set
    nome = coalesce(nullif(btrim(p_dati->>'nome'), ''), nome), prezzo = coalesce(app.num(p_dati->>'prezzo'), prezzo),
    categoria = coalesce(nullif(btrim(p_dati->>'categoria'), ''), categoria),
    descrizione = case when p_dati ? 'descrizione' then nullif(btrim(p_dati->>'descrizione'), '') else descrizione end,
    ricetta_id = case when p_dati ? 'ricetta_id' then app.uuid_sicuro(p_dati->>'ricetta_id') else ricetta_id end,
    reparto = coalesce(nullif(p_dati->>'reparto', ''), reparto), allergeni = coalesce(v_all, allergeni),
    traduzioni = case when p_dati ? 'traduzioni' and jsonb_typeof(p_dati->'traduzioni') = 'object' then p_dati->'traduzioni' else traduzioni end,
    ordine = coalesce(app.num(p_dati->>'ordine')::int, ordine),
    visibile = case when p_dati ? 'visibile' then (p_dati->>'visibile')::boolean else visibile end
  where id = v_id;
  return v_id;
end $$;

-- Esaurito / di nuovo disponibile: anche il cameriere, dal telefono.
create or replace function public.imposta_esaurito(p_voce_id uuid, p_esaurito boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.menu_voci;
begin
  select * into v from public.menu_voci where id = p_voce_id;
  perform app.richiedi(found);
  perform app.richiedi_op(v.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  update public.menu_voci set esaurito = coalesce(p_esaurito, false) where id = v.id;
end $$;

-- Ordine inserito dal cameriere (stessa struttura dell'ordine dal tavolo).
create or replace function public.ordina_dalla_sala(p_sessione_id uuid, p_righe jsonb, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo; v_ord uuid; v_num int; r jsonb; v public.menu_voci; n int := 0;
begin
  select * into s from public.sessioni_tavolo where id = p_sessione_id and stato <> 'chiusa';
  perform app.richiedi(found);
  perform app.richiedi_op(s.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then raise exception 'Ordine vuoto' using errcode = '22023'; end if;
  select coalesce(max(numero), 0) + 1 into v_num from public.ordini_tavolo where sessione_id = s.id;
  insert into public.ordini_tavolo (ristorante_id, sessione_id, numero, fonte, nota, creato_da)
  values (s.ristorante_id, s.id, v_num, 'sala', left(nullif(btrim(p_nota), ''), 300), auth.uid()) returning id into v_ord;
  for r in select * from jsonb_array_elements(p_righe) loop
    select * into v from public.menu_voci where id = app.uuid_sicuro(r->>'voce_id') and ristorante_id = s.ristorante_id;
    if not found then raise exception 'Piatto non valido' using errcode = '22023'; end if;
    insert into public.ordini_righe (ristorante_id, ordine_id, sessione_id, voce_id, nome, prezzo, quantita, note, uscita, reparto)
    values (s.ristorante_id, v_ord, s.id, v.id, v.nome, v.prezzo, greatest(1, least(50, coalesce(app.num(r->>'quantita')::int, 1))),
            left(nullif(btrim(r->>'note'), ''), 200), greatest(1, least(5, coalesce(app.num(r->>'uscita')::int, 1))), v.reparto);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ordine', v_num, 'righe', n);
end $$;

-- Avanzamento di una riga: cucina (in preparazione, pronto), sala (servito). Annullare richiede un motivo.
create or replace function public.avanza_riga(p_riga_id uuid, p_stato text, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.ordini_righe;
begin
  select * into r from public.ordini_righe where id = p_riga_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(r.ristorante_id, array['titolare', 'chef', 'sala', 'cucina']::public.ruolo_membro[], 'sala');
  if r.stato in ('servito', 'annullato') and p_stato <> r.stato then raise exception 'La riga è già %', r.stato using errcode = '22023'; end if;
  if p_stato not in ('inviato', 'in_preparazione', 'pronto', 'servito', 'annullato') then raise exception 'Stato non valido' using errcode = '22023'; end if;
  if p_stato = 'annullato' and coalesce(btrim(p_motivo), '') = '' then raise exception 'Indica il motivo dell''annullamento' using errcode = '22023'; end if;
  update public.ordini_righe set stato = p_stato, motivo_annullamento = case when p_stato = 'annullato' then btrim(p_motivo) end, aggiornato_il = now()
   where id = r.id;
end $$;

create or replace function public.gestisci_chiamata(p_chiamata_id uuid, p_azione text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.chiamate_tavolo;
begin
  select * into c from public.chiamate_tavolo where id = p_chiamata_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(c.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if p_azione = 'prendi' then update public.chiamate_tavolo set stato = 'presa', presa_da = auth.uid(), presa_il = now() where id = c.id and stato = 'aperta';
  elsif p_azione = 'chiudi' then update public.chiamate_tavolo set stato = 'chiusa' where id = c.id;
  else raise exception 'Azione non valida' using errcode = '22023'; end if;
end $$;

-- Pagamento ricevuto in sala (carta sul POS o contanti).
create or replace function public.registra_pagamento_sala(p_sessione_id uuid, p_importo numeric, p_metodo text, p_mancia numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.sessioni_tavolo; c jsonb; v_id uuid;
begin
  select * into s from public.sessioni_tavolo where id = p_sessione_id and stato <> 'chiusa';
  perform app.richiedi(found);
  perform app.richiedi_op(s.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if p_metodo not in ('carta_pos', 'contanti') then raise exception 'Metodo non valido' using errcode = '22023'; end if;
  c := app.conto(s.id);
  if p_importo is null or p_importo <= 0 or p_importo > (c->>'da_pagare')::numeric + 0.005 then
    raise exception 'Importo non valido: restano % €', c->>'da_pagare' using errcode = '22023';
  end if;
  insert into public.pagamenti_tavolo (ristorante_id, sessione_id, importo, mancia, metodo, provider, stato, registrato_da)
  values (s.ristorante_id, s.id, round(p_importo, 2), round(coalesce(p_mancia, 0), 2), p_metodo, 'cassa', 'pagato', auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Scontrino emesso: lo dichiara chi l'ha battuto sulla cassa, con il numero. Con una cassa
-- collegata lo farà l'adattatore. L'app non lo dà mai per emesso da sola.
create or replace function public.segna_scontrino(p_pagamento_id uuid, p_riferimento text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.pagamenti_tavolo;
begin
  select * into p from public.pagamenti_tavolo where id = p_pagamento_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(p.ristorante_id, array['titolare', 'chef', 'sala']::public.ruolo_membro[], 'sala');
  if p.stato <> 'pagato' then raise exception 'Il pagamento non risulta incassato' using errcode = '22023'; end if;
  if coalesce(btrim(p_riferimento), '') = '' then raise exception 'Indica il numero dello scontrino' using errcode = '22023'; end if;
  update public.pagamenti_tavolo set fiscale_stato = 'emesso', fiscale_rif = left(btrim(p_riferimento), 60), aggiornato_il = now() where id = p.id;
end $$;

-- Ogni piatto servito con una ricetta collegata diventa una vendita (food cost e scostamenti).
create or replace function app.vendita_da_riga() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ric uuid;
begin
  if new.stato = 'servito' and old.stato <> 'servito' then
    select ricetta_id into v_ric from public.menu_voci where id = new.voce_id;
    if v_ric is not null and exists (select 1 from public.ricette where id = v_ric and tipo = 'piatto') then
      insert into public.vendite (ristorante_id, ricetta_id, giorno, servizio, quantita, fonte, chiave_idempotenza, creato_da)
      values (new.ristorante_id, v_ric, (now() at time zone 'Europe/Rome')::date,
              case when extract(hour from now() at time zone 'Europe/Rome') < 17 then 'pranzo' else 'cena' end,
              new.quantita, 'pos', 'riga:' || new.id, auth.uid())
      on conflict (ristorante_id, chiave_idempotenza) do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger ordini_righe_vendita after update of stato on public.ordini_righe for each row execute function app.vendita_da_riga();

-- Conto di un tavolo per il personale di sala.
create or replace function public.conto_sessione(p_sessione_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.sessioni_tavolo;
begin
  select * into s from public.sessioni_tavolo where id = p_sessione_id;
  perform app.richiedi(found and app.vede_sala(s.ristorante_id));
  return app.conto(s.id);
end $$;

-- Stato dei tavoli per la sala.
create view public.v_tavoli with (security_invoker = true) as
select t.id, t.ristorante_id, t.codice, t.posti, t.attivo, t.qr_token, sa.nome as sala, sa.ordine as sala_ordine,
       s.id as sessione_id, s.stato as sessione_stato, s.coperti, s.aperta_il,
       (select count(*) from public.chiamate_tavolo c where c.sessione_id = s.id and c.stato = 'aperta') as chiamate_aperte,
       (select count(*) from public.ordini_righe r where r.sessione_id = s.id and r.stato = 'pronto') as righe_pronte,
       (select count(*) from public.ordini_righe r where r.sessione_id = s.id and r.stato in ('inviato', 'in_preparazione')) as righe_in_corso
  from public.tavoli t
  left join public.sale sa on sa.id = t.sala_id
  left join public.sessioni_tavolo s on s.tavolo_id = t.id and s.stato <> 'chiusa';

-- ── RLS, audit, realtime, privilegi ────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['sala_impostazioni', 'sale', 'tavoli', 'menu_voci', 'sessioni_tavolo', 'ordini_tavolo', 'ordini_righe', 'chiamate_tavolo', 'pagamenti_tavolo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "%s: lettura sala" on public.%I for select to authenticated using (app.vede_sala(ristorante_id))', t, t);
  end loop;
  foreach t in array array['sala_impostazioni', 'tavoli', 'menu_voci', 'sessioni_tavolo', 'pagamenti_tavolo'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
-- La cucina (tablet) vede gli ordini da preparare, non i pagamenti.
create policy "ordini_righe: cucina" on public.ordini_righe for select to authenticated using (app.ruolo_ristorante(ristorante_id) = 'cucina');
create policy "sessioni_tavolo: cucina" on public.sessioni_tavolo for select to authenticated using (app.ruolo_ristorante(ristorante_id) = 'cucina');
create policy "tavoli: cucina" on public.tavoli for select to authenticated using (app.ruolo_ristorante(ristorante_id) = 'cucina');
create policy "ordini_tavolo: cucina" on public.ordini_tavolo for select to authenticated using (app.ruolo_ristorante(ristorante_id) = 'cucina');
revoke all on public.v_tavoli from anon, authenticated;
grant select on public.v_tavoli to authenticated;
alter publication supabase_realtime add table public.ordini_righe, public.chiamate_tavolo, public.sessioni_tavolo, public.pagamenti_tavolo;

revoke all on function public.tavolo_cliente(text), public.ordina_dal_tavolo(text, jsonb, text, text), public.chiama_dal_tavolo(text, text),
  public.paga_dal_tavolo(text, numeric, numeric, jsonb), public.conferma_pagamento(uuid, text, text), public.imposta_sala(uuid, jsonb),
  public.salva_tavolo(uuid, jsonb, uuid), public.rigenera_qr(uuid), public.apri_tavolo(uuid, int), public.imposta_coperti(uuid, int),
  public.chiudi_tavolo(uuid, text), public.salva_voce_menu(uuid, jsonb, uuid), public.imposta_esaurito(uuid, boolean),
  public.ordina_dalla_sala(uuid, jsonb, text), public.avanza_riga(uuid, text, text), public.gestisci_chiamata(uuid, text),
  public.registra_pagamento_sala(uuid, numeric, text, numeric), public.segna_scontrino(uuid, text), public.conto_sessione(uuid)
  from public, anon, authenticated;
grant execute on function public.tavolo_cliente(text), public.ordina_dal_tavolo(text, jsonb, text, text), public.chiama_dal_tavolo(text, text),
  public.paga_dal_tavolo(text, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.imposta_sala(uuid, jsonb), public.salva_tavolo(uuid, jsonb, uuid), public.rigenera_qr(uuid), public.apri_tavolo(uuid, int),
  public.imposta_coperti(uuid, int), public.chiudi_tavolo(uuid, text), public.salva_voce_menu(uuid, jsonb, uuid), public.imposta_esaurito(uuid, boolean),
  public.ordina_dalla_sala(uuid, jsonb, text), public.avanza_riga(uuid, text, text), public.gestisci_chiamata(uuid, text),
  public.registra_pagamento_sala(uuid, numeric, text, numeric), public.segna_scontrino(uuid, text), public.conto_sessione(uuid) to authenticated;
grant execute on function public.conferma_pagamento(uuid, text, text) to service_role;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid), app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]),
  app.converti(uuid, numeric, text, text), app.membro_ristorante(uuid), app.membro_gruppo(uuid),
  app.vede_autocontrollo(uuid), app.vede_autocontrollo_gruppo(uuid), app.giorni_frequenza(text), app.vede_sala(uuid) to authenticated;
