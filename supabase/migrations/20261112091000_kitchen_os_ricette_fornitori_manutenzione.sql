-- ═══════════════════════════════════════════════════════════════════════════
-- Kitchen OS · 2 — ricette e food cost, valutazione fornitori e ordini
-- proposti, attrezzature e manutenzione
-- ═══════════════════════════════════════════════════════════════════════════
-- Nessuna resa, peso o coefficiente viene presunto: quando manca un dato il
-- calcolo è marcato "incompleto" e indica che cosa serve.

-- ── Ricette versionate ─────────────────────────────────────────────────────
create table public.ricette (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  nome text not null check (btrim(nome) <> ''),
  tipo text not null default 'piatto' check (tipo in ('piatto', 'semilavorato')),
  categoria text,
  codice_pos text,                       -- codice dell'articolo sul sistema di cassa, per gli import
  attiva boolean not null default true,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, nome)
);
create table public.ricette_versioni (
  id uuid primary key default gen_random_uuid(),
  ricetta_id uuid not null references public.ricette(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  versione int not null,
  stato text not null default 'attiva' check (stato in ('attiva', 'archiviata')),
  porzioni numeric(10,3) not null check (porzioni > 0),
  resa_quantita numeric(14,3),           -- semilavorati: quanto si ottiene dalla ricetta…
  resa_unita text,                       -- …e in quale unità
  prezzo_vendita numeric(12,2),          -- per porzione, IVA esclusa, in EUR
  note text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  unique (ricetta_id, versione)
);
create unique index ricette_versione_attiva on public.ricette_versioni (ricetta_id) where stato = 'attiva';
create table public.ricette_ingredienti (
  id uuid primary key default gen_random_uuid(),
  versione_id uuid not null references public.ricette_versioni(id) on delete cascade,
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  posizione int not null default 0,
  master_id uuid references public.articoli_master(id) on delete restrict,
  sotto_ricetta_id uuid references public.ricette(id) on delete restrict,
  quantita numeric(14,4) not null check (quantita > 0),
  unita text not null,
  quantita_tipo text not null default 'lorda' check (quantita_tipo in ('lorda', 'netta')),
  resa_pct numeric(5,2) check (resa_pct is null or (resa_pct > 0 and resa_pct <= 100)),   -- netto / lordo × 100
  resa_fonte text,
  nota text,
  check ((master_id is null) <> (sotto_ricetta_id is null))
);
create table public.vendite (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  ricetta_id uuid not null references public.ricette(id) on delete restrict,
  giorno date not null,
  servizio text check (servizio in ('pranzo', 'cena', 'altro')),
  quantita numeric(12,3) not null check (quantita <> 0),
  fonte text not null check (fonte in ('manuale', 'import', 'pos')),
  chiave_idempotenza text,
  storna_vendita_id uuid unique references public.vendite(id) on delete restrict,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, chiave_idempotenza)
);
create index on public.vendite (ristorante_id, giorno);
create trigger vendite_immutabili before update or delete on public.vendite
  for each row execute function app.immutabile();

-- Salva una ricetta creando SEMPRE una nuova versione: la precedente viene archiviata, mai sovrascritta.
create or replace function public.salva_ricetta(p_ristorante_id uuid, p_dati jsonb, p_ricetta_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_ricetta_id; v_ver uuid; v_n int; i jsonb; v_pos int := 0; v_gruppo uuid := app.gruppo_di(p_ristorante_id);
  v_master uuid; v_sotto uuid; v_tipo text := coalesce(p_dati->>'tipo', 'piatto');
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'ricette');
  if coalesce(btrim(p_dati->>'nome'), '') = '' then raise exception 'Il nome della ricetta è obbligatorio' using errcode = '22023'; end if;
  if coalesce(app.num(p_dati->>'porzioni'), 0) <= 0 then raise exception 'Indica il numero di porzioni' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_dati->'ingredienti', '[]'::jsonb)) = 0 then raise exception 'Aggiungi almeno un ingrediente' using errcode = '22023'; end if;
  if v_tipo = 'semilavorato' and (coalesce(app.num(p_dati->>'resa_quantita'), 0) <= 0 or coalesce(btrim(p_dati->>'resa_unita'), '') = '') then
    raise exception 'Per un semilavorato indica quanto si ottiene (quantità e unità)' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.ricette (ristorante_id, nome, tipo, categoria, codice_pos)
    values (p_ristorante_id, btrim(p_dati->>'nome'), v_tipo, nullif(btrim(p_dati->>'categoria'), ''), nullif(btrim(p_dati->>'codice_pos'), ''))
    returning id into v_id;
  else
    update public.ricette set nome = btrim(p_dati->>'nome'), tipo = v_tipo,
           categoria = nullif(btrim(p_dati->>'categoria'), ''), codice_pos = nullif(btrim(p_dati->>'codice_pos'), '')
     where id = v_id and ristorante_id = p_ristorante_id;
    if not found then raise exception 'Ricetta non trovata' using errcode = 'P0002'; end if;
  end if;

  update public.ricette_versioni set stato = 'archiviata' where ricetta_id = v_id and stato = 'attiva';
  select coalesce(max(versione), 0) + 1 into v_n from public.ricette_versioni where ricetta_id = v_id;
  insert into public.ricette_versioni (ricetta_id, ristorante_id, versione, porzioni, resa_quantita, resa_unita, prezzo_vendita, note, creato_da)
  values (v_id, p_ristorante_id, v_n, app.num(p_dati->>'porzioni'), app.num(p_dati->>'resa_quantita'),
          nullif(lower(btrim(p_dati->>'resa_unita')), ''), app.num(p_dati->>'prezzo_vendita'), nullif(btrim(p_dati->>'note'), ''), auth.uid())
  returning id into v_ver;

  for i in select * from jsonb_array_elements(p_dati->'ingredienti') loop
    v_pos := v_pos + 1;
    v_master := app.uuid_sicuro(i->>'master_id'); v_sotto := app.uuid_sicuro(i->>'sotto_ricetta_id');
    if v_master is not null and not exists (select 1 from public.articoli_master m where m.id = v_master and m.gruppo_id = v_gruppo) then
      raise exception 'Ingrediente % non valido', v_pos using errcode = '22023';
    end if;
    if v_sotto is not null and (v_sotto = v_id or not exists (select 1 from public.ricette r where r.id = v_sotto and r.ristorante_id = p_ristorante_id and r.tipo = 'semilavorato')) then
      raise exception 'Il semilavorato dell''ingrediente % non è valido', v_pos using errcode = '22023';
    end if;
    if coalesce(app.num(i->>'quantita'), 0) <= 0 or coalesce(btrim(i->>'unita'), '') = '' then
      raise exception 'Ingrediente %: indica quantità e unità', v_pos using errcode = '22023';
    end if;
    insert into public.ricette_ingredienti (versione_id, ristorante_id, posizione, master_id, sotto_ricetta_id, quantita, unita,
                                            quantita_tipo, resa_pct, resa_fonte, nota)
    values (v_ver, p_ristorante_id, v_pos, v_master, v_sotto, app.num(i->>'quantita'), lower(btrim(i->>'unita')),
            coalesce(i->>'quantita_tipo', 'lorda'), app.num(i->>'resa_pct'), nullif(btrim(i->>'resa_fonte'), ''), nullif(btrim(i->>'nota'), ''));
  end loop;
  return v_id;
end $$;

-- Costo teorico di una versione. Formula per ingrediente:
--   quantità lorda = quantità, oppure quantità netta ÷ resa (se la quantità è dichiarata netta)
--   costo = quantità lorda convertita nell'unità del prezzo × ultimo prezzo netto di acquisto in EUR
-- Fonte del prezzo: l'ultimo acquisto dell'articolo nella sede con prezzo normalizzato e cambio disponibile.
-- Se manca resa, conversione o prezzo, la riga è "incompleta" con il motivo; il totale non la stima.
create or replace function app.costo_versione(p_versione_id uuid, p_profondita int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.ricette_versioni; i record; p record; s public.ricette_versioni; v_sub jsonb;
  v_lordo numeric; v_q numeric; v_costo numeric; v_motivo text; v_fonte jsonb;
  v_righe jsonb := '[]'::jsonb; v_tot numeric := 0; v_completo boolean := true;
begin
  select * into v from public.ricette_versioni where id = p_versione_id;
  if not found then return null; end if;
  for i in select x.*, m.nome as master_nome, m.unita_base, r.nome as sotto_nome
             from public.ricette_ingredienti x
             left join public.articoli_master m on m.id = x.master_id
             left join public.ricette r on r.id = x.sotto_ricetta_id
            where x.versione_id = p_versione_id order by x.posizione loop
    v_costo := null; v_motivo := null; v_fonte := null;
    if i.quantita_tipo = 'netta' and i.resa_pct is null then
      v_lordo := null; v_motivo := 'Quantità netta senza resa: indica la resa dell''ingrediente';
    else
      v_lordo := case when i.quantita_tipo = 'netta' then i.quantita / (i.resa_pct / 100) else i.quantita end;
    end if;

    if v_lordo is not null and i.master_id is not null then
      select sp.prezzo_base_eur, sp.unita_base, sp.prezzo_base, sp.valuta, sp.tasso_cambio, sp.documento_id, d.numero, d.data_documento,
             f.ragione_sociale into p
        from public.storico_prezzi sp
        join public.documenti d on d.id = sp.documento_id
        join public.fornitori f on f.id = sp.fornitore_id
       where sp.master_id = i.master_id and sp.ristorante_id = v.ristorante_id and d.stato = 'completato'
         and d.tipo <> 'Nota di Credito' and sp.prezzo_base_eur is not null
       order by sp.data_rilevazione desc, sp.creato_il desc limit 1;
      if not found then
        v_motivo := case when exists (select 1 from public.storico_prezzi sp where sp.master_id = i.master_id and sp.ristorante_id = v.ristorante_id)
          then 'Prezzo non utilizzabile: unità di acquisto non convertibile o cambio non disponibile'
          else 'Nessun acquisto registrato per questo articolo nella sede' end;
      else
        v_q := app.converti(i.master_id, v_lordo, i.unita, p.unita_base);
        if v_q is null then
          v_motivo := 'Non convertibile: serve una conversione da ' || i.unita || ' a ' || p.unita_base || ' per questo articolo';
        else
          v_costo := round(v_q * p.prezzo_base_eur, 4);
          v_fonte := jsonb_build_object('documento_id', p.documento_id, 'numero', p.numero, 'data', p.data_documento,
            'fornitore', p.ragione_sociale, 'prezzo_eur', p.prezzo_base_eur, 'unita', p.unita_base,
            'prezzo_originale', p.prezzo_base, 'valuta', p.valuta, 'tasso_cambio', p.tasso_cambio);
        end if;
      end if;
    elsif v_lordo is not null then
      select * into s from public.ricette_versioni x where x.ricetta_id = i.sotto_ricetta_id and x.stato = 'attiva';
      if not found or p_profondita >= 4 then
        v_motivo := 'Semilavorato senza versione attiva';
      else
        v_sub := app.costo_versione(s.id, p_profondita + 1);
        v_q := case when (app.um(i.unita)).base = (app.um(s.resa_unita)).base
                    then v_lordo * (app.um(i.unita)).fattore / (app.um(s.resa_unita)).fattore end;
        if not (v_sub->>'completo')::boolean then v_motivo := 'Il costo del semilavorato è incompleto';
        elsif v_q is null or coalesce(s.resa_quantita, 0) <= 0 then v_motivo := 'Unità non compatibile con la resa del semilavorato (' || coalesce(s.resa_unita, '—') || ')';
        else
          v_costo := round(v_q / s.resa_quantita * (v_sub->>'costo_totale')::numeric, 4);
          v_fonte := jsonb_build_object('semilavorato', i.sotto_nome, 'versione', s.versione);
        end if;
      end if;
    end if;

    if v_costo is null then v_completo := false; else v_tot := v_tot + v_costo; end if;
    v_righe := v_righe || jsonb_build_object('ingrediente', coalesce(i.master_nome, i.sotto_nome), 'master_id', i.master_id,
      'sotto_ricetta_id', i.sotto_ricetta_id, 'quantita', i.quantita, 'unita', i.unita, 'quantita_tipo', i.quantita_tipo,
      'resa_pct', i.resa_pct, 'quantita_lorda', round(v_lordo, 4), 'costo', v_costo, 'motivo', v_motivo, 'fonte', v_fonte);
  end loop;
  return jsonb_build_object('versione_id', v.id, 'versione', v.versione, 'porzioni', v.porzioni, 'completo', v_completo,
    'costo_totale', case when v_completo then round(v_tot, 2) end, 'costo_parziale', round(v_tot, 2),
    'costo_porzione', case when v_completo then round(v_tot / v.porzioni, 2) end,
    'prezzo_vendita', v.prezzo_vendita,
    'margine', case when v_completo and v.prezzo_vendita is not null then round(v.prezzo_vendita - v_tot / v.porzioni, 2) end,
    'food_cost_pct', case when v_completo and v.prezzo_vendita > 0 then round(v_tot / v.porzioni / v.prezzo_vendita * 100, 1) end,
    'valuta', 'EUR', 'righe', v_righe);
end $$;

create or replace function public.costo_ricetta(p_ricetta_id uuid, p_versione_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.ricette; v uuid;
begin
  select * into r from public.ricette where id = p_ricetta_id;
  perform app.richiedi(found and app.ha_accesso_ristorante(r.ristorante_id));
  v := coalesce(p_versione_id, (select x.id from public.ricette_versioni x where x.ricetta_id = p_ricetta_id and x.stato = 'attiva'));
  if not exists (select 1 from public.ricette_versioni x where x.id = v and x.ricetta_id = p_ricetta_id) then return null; end if;
  return app.costo_versione(v);
end $$;

-- Vendite: registrazione manuale o import (CSV / adapter POS). Idempotente sulla chiave.
create or replace function public.registra_vendita(
  p_ristorante_id uuid, p_ricetta_id uuid, p_giorno date, p_quantita numeric, p_servizio text default null,
  p_fonte text default 'manuale', p_chiave text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'contabile']::public.ruolo_membro[], 'ricette');
  if p_chiave is not null then
    select x.id into v_id from public.vendite x where x.ristorante_id = p_ristorante_id and x.chiave_idempotenza = p_chiave;
    if v_id is not null then return v_id; end if;
  end if;
  if not exists (select 1 from public.ricette r where r.id = p_ricetta_id and r.ristorante_id = p_ristorante_id and r.tipo = 'piatto') then
    raise exception 'Piatto non trovato' using errcode = 'P0002';
  end if;
  if p_quantita is null or p_quantita <= 0 or p_giorno is null or p_giorno > (now() at time zone 'Europe/Rome')::date then
    raise exception 'Quantità o data non valida' using errcode = '22023';
  end if;
  if p_fonte not in ('manuale', 'import') then raise exception 'Fonte non valida' using errcode = '22023'; end if;
  insert into public.vendite (ristorante_id, ricetta_id, giorno, servizio, quantita, fonte, chiave_idempotenza, creato_da)
  values (p_ristorante_id, p_ricetta_id, p_giorno, p_servizio, p_quantita, p_fonte, p_chiave, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.storna_vendita(p_vendita_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.vendite; v_id uuid;
begin
  select * into v from public.vendite where id = p_vendita_id;
  perform app.richiedi(found);
  perform app.richiedi_op(v.ristorante_id, array['titolare', 'chef', 'contabile']::public.ruolo_membro[], 'ricette');
  if v.storna_vendita_id is not null or exists (select 1 from public.vendite x where x.storna_vendita_id = v.id) then
    raise exception 'Vendita già stornata' using errcode = '23505';
  end if;
  insert into public.vendite (ristorante_id, ricetta_id, giorno, servizio, quantita, fonte, storna_vendita_id, creato_da)
  values (v.ristorante_id, v.ricetta_id, v.giorno, v.servizio, -v.quantita, v.fonte, v.id, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Marginalità per piatto nel periodo: porzioni vendute × (prezzo − costo teorico attuale).
-- Il costo usato è quello della versione attiva oggi, con i prezzi di acquisto più recenti.
create or replace function public.margini_ricette(p_ristorante_id uuid, p_dal date, p_al date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_accesso_ristorante(p_ristorante_id));
  return (select coalesce(jsonb_agg(x order by x.nome), '[]'::jsonb) from (
    select r.id as ricetta_id, r.nome, r.categoria, c.costo->'completo' as completo,
           (c.costo->>'costo_porzione')::numeric as costo_porzione, (c.costo->>'prezzo_vendita')::numeric as prezzo_vendita,
           (c.costo->>'margine')::numeric as margine, (c.costo->>'food_cost_pct')::numeric as food_cost_pct,
           coalesce(v.venduti, 0) as porzioni_vendute, v.per_servizio,
           round(coalesce(v.venduti, 0) * (c.costo->>'prezzo_vendita')::numeric, 2) as ricavo,
           round(coalesce(v.venduti, 0) * (c.costo->>'margine')::numeric, 2) as margine_totale
      from public.ricette r
      left join lateral (select app.costo_versione(rv.id) as costo from public.ricette_versioni rv
                          where rv.ricetta_id = r.id and rv.stato = 'attiva') c on true
      left join lateral (select sum(s.q) as venduti, jsonb_object_agg(s.servizio, s.q) as per_servizio from (
                           select coalesce(x.servizio, 'non indicato') as servizio, sum(x.quantita) as q from public.vendite x
                            where x.ricetta_id = r.id and x.giorno between p_dal and p_al group by 1) s) v on true
     where r.ristorante_id = p_ristorante_id and r.tipo = 'piatto' and r.attiva) x);
end $$;

-- Consumo teorico (dalle vendite × ricetta attiva) contro consumo effettivo (dai movimenti di magazzino),
-- per articolo e nell'unità base dell'articolo. Scarti, rotture e omaggi sono riportati a parte.
-- Ciò che non è convertibile nell'unità base è contato come "non convertibile", non stimato.
create or replace function public.scostamenti_consumo(p_ristorante_id uuid, p_dal date, p_al date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_accesso_ristorante(p_ristorante_id));
  return (
    with teorico as (
      select i.master_id,
             sum(app.converti(i.master_id, v.quantita / rv.porzioni
                 * case when i.quantita_tipo = 'netta' then i.quantita / (i.resa_pct / 100) else i.quantita end, i.unita, m.unita_base)) as q,
             count(*) filter (where app.converti(i.master_id, 1, i.unita, m.unita_base) is null
                                 or (i.quantita_tipo = 'netta' and i.resa_pct is null)) as non_calcolabili
        from public.vendite v
        join public.ricette_versioni rv on rv.ricetta_id = v.ricetta_id and rv.stato = 'attiva'
        join public.ricette_ingredienti i on i.versione_id = rv.id and i.master_id is not null
        join public.articoli_master m on m.id = i.master_id
       where v.ristorante_id = p_ristorante_id and v.giorno between p_dal and p_al
       group by i.master_id
    ), effettivo as (
      select x.master_id,
             -sum(app.converti(x.master_id, x.quantita, x.unita, m.unita_base)) filter (where x.tipo in ('consumo', 'apertura', 'vendita')) as consumo,
             -sum(app.converti(x.master_id, x.quantita, x.unita, m.unita_base)) filter (where x.tipo in ('scarto', 'rottura', 'omaggio')) as perdite,
             count(*) filter (where app.converti(x.master_id, 1, x.unita, m.unita_base) is null) as non_convertibili
        from public.movimenti x join public.articoli_master m on m.id = x.master_id
       where x.ristorante_id = p_ristorante_id and x.tipo in ('consumo', 'apertura', 'vendita', 'scarto', 'rottura', 'omaggio')
         and (x.creato_il at time zone 'Europe/Rome')::date between p_dal and p_al
         and not exists (select 1 from public.movimenti s where s.storna_movimento_id = x.id)
       group by x.master_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'master_id', m.id, 'articolo', m.nome, 'unita', m.unita_base,
        'teorico', round(t.q, 3), 'effettivo', round(e.consumo, 3), 'perdite', round(e.perdite, 3),
        'scostamento', case when t.q is not null and e.consumo is not null then round(e.consumo - t.q, 3) end,
        'scostamento_pct', case when t.q > 0 and e.consumo is not null then round((e.consumo - t.q) / t.q * 100, 1) end,
        'incompleto', coalesce(t.non_calcolabili, 0) > 0 or coalesce(e.non_convertibili, 0) > 0) order by m.nome), '[]'::jsonb)
      from public.articoli_master m
      left join teorico t on t.master_id = m.id
      left join effettivo e on e.master_id = m.id
     where t.master_id is not null or e.master_id is not null);
end $$;

-- ── Fornitori: consegne, non conformità, indicatori, ordini proposti ───────
create table public.consegne (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  fornitore_id uuid not null references public.fornitori(id) on delete cascade,
  documento_id uuid references public.documenti(id) on delete set null,
  giorno date not null,
  puntuale boolean,             -- NULL = non rilevato
  completa boolean,
  temperatura_ricevimento numeric(5,1),
  nota text,
  registrata_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now()
);
create unique index consegne_documento on public.consegne (documento_id) where documento_id is not null;
create table public.non_conformita (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  fornitore_id uuid references public.fornitori(id) on delete set null,
  lotto_id uuid references public.lotti(id) on delete set null,
  consegna_id uuid references public.consegne(id) on delete set null,
  tipo text not null check (tipo in ('qualita', 'quantita', 'ritardo', 'temperatura', 'documenti', 'reclamo', 'altro')),
  gravita text not null default 'minore' check (gravita in ('minore', 'maggiore', 'critica')),
  descrizione text not null check (btrim(descrizione) <> ''),
  stato text not null default 'aperta' check (stato in ('aperta', 'chiusa')),
  esito text,
  aperta_da uuid references auth.users(id) on delete set null,
  aperta_il timestamptz not null default now(),
  chiusa_da uuid references auth.users(id) on delete set null,
  chiusa_il timestamptz
);
create table public.ordini_proposti (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  fornitore_id uuid not null references public.fornitori(id) on delete restrict,
  stato text not null default 'bozza' check (stato in ('bozza', 'approvato', 'annullato')),
  righe jsonb not null,                -- [{master_id, articolo, quantita, unita, nota}]
  nota text,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  deciso_da uuid references auth.users(id) on delete set null,
  deciso_il timestamptz
);
-- Pesi e campione minimo degli indicatori: modificabili dal titolare. I valori iniziali
-- sono pesi uguali e un campione minimo prudente, non una valutazione di merito.
alter table public.gruppi add column scorecard jsonb not null default
  '{"campione_minimo": 5, "pesi": {"puntualita": 1, "completezza": 1, "conformita": 1, "prezzi": 1}}'::jsonb;

create or replace function public.registra_consegna(p_ristorante_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_doc uuid := app.uuid_sicuro(p_dati->>'documento_id'); v_forn uuid := app.uuid_sicuro(p_dati->>'fornitore_id');
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'contabile']::public.ruolo_membro[], 'fornitori');
  if v_doc is not null then
    select d.fornitore_id into v_forn from public.documenti d where d.id = v_doc and d.ristorante_id = p_ristorante_id;
  end if;
  if v_forn is null or not exists (select 1 from public.fornitori f where f.id = v_forn and f.gruppo_id = app.gruppo_di(p_ristorante_id)) then
    raise exception 'Fornitore non valido' using errcode = '22023';
  end if;
  insert into public.consegne (ristorante_id, fornitore_id, documento_id, giorno, puntuale, completa, temperatura_ricevimento, nota, registrata_da)
  values (p_ristorante_id, v_forn, v_doc, coalesce((p_dati->>'giorno')::date, (now() at time zone 'Europe/Rome')::date),
          (p_dati->>'puntuale')::boolean, (p_dati->>'completa')::boolean, app.num(p_dati->>'temperatura_ricevimento'),
          nullif(btrim(p_dati->>'nota'), ''), auth.uid())
  on conflict (documento_id) where documento_id is not null do update set
    puntuale = excluded.puntuale, completa = excluded.completa, temperatura_ricevimento = excluded.temperatura_ricevimento, nota = excluded.nota
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.apri_non_conformita(p_ristorante_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_lotto uuid := app.uuid_sicuro(p_dati->>'lotto_id'); v_forn uuid := app.uuid_sicuro(p_dati->>'fornitore_id');
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'contabile']::public.ruolo_membro[], 'fornitori');
  if v_lotto is not null then
    select l.fornitore_id into v_forn from public.lotti l where l.id = v_lotto and l.ristorante_id = p_ristorante_id;
    if not found then raise exception 'Lotto non trovato' using errcode = 'P0002'; end if;
  end if;
  insert into public.non_conformita (ristorante_id, fornitore_id, lotto_id, consegna_id, tipo, gravita, descrizione, aperta_da)
  values (p_ristorante_id, v_forn, v_lotto, app.uuid_sicuro(p_dati->>'consegna_id'), p_dati->>'tipo',
          coalesce(p_dati->>'gravita', 'minore'), btrim(p_dati->>'descrizione'), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.chiudi_non_conformita(p_id uuid, p_esito text)
returns void language plpgsql security definer set search_path = '' as $$
declare n public.non_conformita;
begin
  select * into n from public.non_conformita where id = p_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(n.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'fornitori');
  if coalesce(btrim(p_esito), '') = '' then raise exception 'Indica come è stata chiusa' using errcode = '22023'; end if;
  update public.non_conformita set stato = 'chiusa', esito = left(btrim(p_esito), 500), chiusa_da = auth.uid(), chiusa_il = now() where id = p_id;
end $$;

create or replace function public.imposta_scorecard(p_gruppo_id uuid, p_config jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  perform app.richiedi(app.ha_ruolo_gruppo(p_gruppo_id, array['titolare']::public.ruolo_membro[]));
  if coalesce(app.num(p_config->>'campione_minimo'), 0) < 1 then raise exception 'Il campione minimo deve essere almeno 1' using errcode = '22023'; end if;
  foreach k in array array['puntualita', 'completezza', 'conformita', 'prezzi'] loop
    if coalesce(app.num(p_config->'pesi'->>k), -1) < 0 then raise exception 'Peso non valido per %', k using errcode = '22023'; end if;
  end loop;
  update public.gruppi set scorecard = jsonb_build_object('campione_minimo', (p_config->>'campione_minimo')::int,
    'pesi', jsonb_build_object('puntualita', app.num(p_config->'pesi'->>'puntualita'), 'completezza', app.num(p_config->'pesi'->>'completezza'),
                               'conformita', app.num(p_config->'pesi'->>'conformita'), 'prezzi', app.num(p_config->'pesi'->>'prezzi')))
   where id = p_gruppo_id;
end $$;

-- Indicatori per fornitore nel periodo, ciascuno da 0 a 100 con il numero di eventi su cui si basa:
--   puntualità  = consegne puntuali ÷ consegne con puntualità rilevata
--   completezza = consegne complete ÷ consegne con completezza rilevata
--   conformità  = 100 − non conformità ÷ consegne (minimo 0)
--   prezzi      = 100 − rincari oltre soglia ÷ prezzi confrontati
-- Il punteggio è la media pesata dei soli indicatori disponibili ed è NULL sotto il campione minimo.
create or replace function public.scorecard_fornitori(p_ristorante_id uuid, p_dal date, p_al date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb;
begin
  perform app.richiedi(app.ha_accesso_ristorante(p_ristorante_id));
  select g.scorecard into v_cfg from public.gruppi g where g.id = app.gruppo_di(p_ristorante_id);
  return jsonb_build_object('dal', p_dal, 'al', p_al, 'config', v_cfg, 'fornitori', (
    select coalesce(jsonb_agg(to_jsonb(z) order by z.punteggio desc nulls last, z.ragione_sociale), '[]'::jsonb) from (
      select y.*, y.n_consegne >= (v_cfg->>'campione_minimo')::int as campione_sufficiente,
             case when y.n_consegne >= (v_cfg->>'campione_minimo')::int and y.peso_tot > 0 then round(y.somma / y.peso_tot, 1) end as punteggio
        from (
          select x.*,
                 coalesce(x.puntualita * (v_cfg->'pesi'->>'puntualita')::numeric, 0) + coalesce(x.completezza * (v_cfg->'pesi'->>'completezza')::numeric, 0)
                 + coalesce(x.conformita * (v_cfg->'pesi'->>'conformita')::numeric, 0) + coalesce(x.prezzi * (v_cfg->'pesi'->>'prezzi')::numeric, 0) as somma,
                 case when x.puntualita is not null then (v_cfg->'pesi'->>'puntualita')::numeric else 0 end
                 + case when x.completezza is not null then (v_cfg->'pesi'->>'completezza')::numeric else 0 end
                 + case when x.conformita is not null then (v_cfg->'pesi'->>'conformita')::numeric else 0 end
                 + case when x.prezzi is not null then (v_cfg->'pesi'->>'prezzi')::numeric else 0 end as peso_tot
            from (
              select f.id as fornitore_id, f.ragione_sociale, f.paese, c.n as n_consegne, c.n_puntualita, c.n_completezza,
                     coalesce(n.n, 0) as n_non_conformita, coalesce(pr.confronti, 0) as n_confronti, coalesce(pr.rincari, 0) as n_rincari,
                     case when c.n_puntualita > 0 then round(c.puntuali * 100.0 / c.n_puntualita, 1) end as puntualita,
                     case when c.n_completezza > 0 then round(c.complete * 100.0 / c.n_completezza, 1) end as completezza,
                     case when c.n > 0 then greatest(0, round(100 - coalesce(n.n, 0) * 100.0 / c.n, 1)) end as conformita,
                     case when pr.confronti > 0 then round(100 - pr.rincari * 100.0 / pr.confronti, 1) end as prezzi
                from public.fornitori f
                join public.fornitori_ristorante fr on fr.fornitore_id = f.id and fr.ristorante_id = p_ristorante_id
                left join lateral (select count(*) as n, count(k.puntuale) as n_puntualita, count(*) filter (where k.puntuale) as puntuali,
                                          count(k.completa) as n_completezza, count(*) filter (where k.completa) as complete
                                     from public.consegne k where k.fornitore_id = f.id and k.ristorante_id = p_ristorante_id
                                      and k.giorno between p_dal and p_al) c on true
                left join lateral (select count(*) as n from public.non_conformita q where q.fornitore_id = f.id and q.ristorante_id = p_ristorante_id
                                      and (q.aperta_il at time zone 'Europe/Rome')::date between p_dal and p_al) n on true
                left join lateral (select count(*) filter (where s.confronto_esito = 'confrontato') as confronti,
                                          count(*) filter (where s.anomalia_prezzo) as rincari
                                     from public.storico_prezzi s join public.documenti d on d.id = s.documento_id
                                    where s.fornitore_id = f.id and s.ristorante_id = p_ristorante_id and d.stato = 'completato'
                                      and d.data_documento between p_dal and p_al) pr on true
            ) x
        ) y
    ) z));
end $$;

-- Confronto tra fornitori per un articolo: ultimo prezzo netto normalizzato di ciascuno.
-- Sono confrontabili solo i prezzi nella stessa unità; l'EUR compare solo se il cambio è disponibile.
create or replace function public.confronta_fornitori(p_ristorante_id uuid, p_master_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_accesso_ristorante(p_ristorante_id));
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.prezzo_eur nulls last), '[]'::jsonb) from (
    select distinct on (s.fornitore_id) s.fornitore_id, f.ragione_sociale, f.paese, s.prezzo_base as prezzo, s.unita_base as unita,
           s.valuta, s.prezzo_base_eur as prezzo_eur, s.tasso_cambio, d.data_documento as data, d.id as documento_id, d.numero,
           s.prezzo_base is not null as confrontabile,
           (select count(*) from public.storico_prezzi z where z.fornitore_id = s.fornitore_id and z.master_id = p_master_id and z.ristorante_id = p_ristorante_id) as n_acquisti
      from public.storico_prezzi s
      join public.documenti d on d.id = s.documento_id and d.stato = 'completato' and d.tipo <> 'Nota di Credito'
      join public.fornitori f on f.id = s.fornitore_id
     where s.master_id = p_master_id and s.ristorante_id = p_ristorante_id
     order by s.fornitore_id, s.data_rilevazione desc, s.creato_il desc) x);
end $$;

-- Ordini: solo proposte. L'approvazione registra la decisione; nulla viene inviato al fornitore.
create or replace function public.proponi_ordine(p_ristorante_id uuid, p_fornitore_id uuid, p_righe jsonb, p_nota text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'fornitori');
  if not exists (select 1 from public.fornitori f where f.id = p_fornitore_id and f.gruppo_id = app.gruppo_di(p_ristorante_id)) then
    raise exception 'Fornitore non valido' using errcode = '22023';
  end if;
  if jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then raise exception 'Aggiungi almeno una riga' using errcode = '22023'; end if;
  insert into public.ordini_proposti (ristorante_id, fornitore_id, righe, nota, creato_da)
  values (p_ristorante_id, p_fornitore_id, p_righe, nullif(btrim(p_nota), ''), auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.decidi_ordine(p_ordine_id uuid, p_stato text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.ordini_proposti;
begin
  select * into o from public.ordini_proposti where id = p_ordine_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(o.ristorante_id, case when p_stato = 'approvato' then array['titolare']::public.ruolo_membro[]
                                                else array['titolare', 'chef']::public.ruolo_membro[] end, 'fornitori');
  if o.stato <> 'bozza' or p_stato not in ('approvato', 'annullato') then raise exception 'L''ordine non è più una bozza' using errcode = '22023'; end if;
  update public.ordini_proposti set stato = p_stato, deciso_da = auth.uid(), deciso_il = now() where id = p_ordine_id;
end $$;

-- ── Attrezzature e manutenzione ────────────────────────────────────────────
create table public.attrezzature (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  nome text not null check (btrim(nome) <> ''),
  codice text,
  marca_modello text,
  matricola text,
  ubicazione_id uuid references public.ubicazioni(id) on delete set null,
  posizione text,
  garanzia_fino date,
  documentazione text,
  stato text not null default 'operativa' check (stato in ('operativa', 'guasta', 'fuori_servizio', 'dismessa')),
  contatore numeric(12,1),               -- ore o cicli di funzionamento, se rilevati
  contatore_unita text check (contatore_unita in ('ore', 'cicli')),
  creato_il timestamptz not null default now()
);
create table public.manutenzioni_piani (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  attrezzatura_id uuid not null references public.attrezzature(id) on delete cascade,
  titolo text not null check (btrim(titolo) <> ''),
  obbligo text not null check (obbligo in ('obbligatoria', 'raccomandata', 'interna')),
  fonte text,                             -- norma, manuale del costruttore o procedura interna da cui deriva
  ogni_giorni int check (ogni_giorni is null or ogni_giorni > 0),
  ogni_contatore numeric(12,1) check (ogni_contatore is null or ogni_contatore > 0),
  prossima_data date,
  prossimo_contatore numeric(12,1),
  responsabile_id uuid references auth.users(id) on delete set null,
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  check (ogni_giorni is not null or ogni_contatore is not null or prossima_data is not null),
  check (obbligo <> 'obbligatoria' or coalesce(btrim(fonte), '') <> '')
);
create table public.interventi (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete cascade,
  attrezzatura_id uuid not null references public.attrezzature(id) on delete cascade,
  piano_id uuid references public.manutenzioni_piani(id) on delete set null,
  tipo text not null check (tipo in ('manutenzione', 'guasto')),
  stato text not null default 'aperto' check (stato in ('aperto', 'in_corso', 'completato', 'annullato')),
  descrizione text not null check (btrim(descrizione) <> ''),
  aperto_il timestamptz not null default now(),
  indisponibile_dal timestamptz,
  indisponibile_al timestamptz,
  eseguito_da text,
  ricambi text,
  costo numeric(12,2),
  valuta text,
  esito text,
  completato_il timestamptz,
  aperto_da uuid references auth.users(id) on delete set null,
  chiuso_da uuid references auth.users(id) on delete set null
);

create or replace function public.salva_attrezzatura(p_ristorante_id uuid, p_dati jsonb, p_attrezzatura_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_attrezzatura_id;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'manutenzione');
  if v_id is null then
    insert into public.attrezzature (ristorante_id, nome) values (p_ristorante_id, btrim(p_dati->>'nome')) returning id into v_id;
  elsif not exists (select 1 from public.attrezzature where id = v_id and ristorante_id = p_ristorante_id) then
    raise exception 'Attrezzatura non trovata' using errcode = 'P0002';
  end if;
  update public.attrezzature set
    nome = coalesce(nullif(btrim(p_dati->>'nome'), ''), nome),
    codice = case when p_dati ? 'codice' then nullif(btrim(p_dati->>'codice'), '') else codice end,
    marca_modello = case when p_dati ? 'marca_modello' then nullif(btrim(p_dati->>'marca_modello'), '') else marca_modello end,
    matricola = case when p_dati ? 'matricola' then nullif(btrim(p_dati->>'matricola'), '') else matricola end,
    posizione = case when p_dati ? 'posizione' then nullif(btrim(p_dati->>'posizione'), '') else posizione end,
    garanzia_fino = case when p_dati ? 'garanzia_fino' then nullif(p_dati->>'garanzia_fino', '')::date else garanzia_fino end,
    documentazione = case when p_dati ? 'documentazione' then nullif(btrim(p_dati->>'documentazione'), '') else documentazione end,
    stato = coalesce(p_dati->>'stato', stato),
    contatore = case when p_dati ? 'contatore' then app.num(p_dati->>'contatore') else contatore end,
    contatore_unita = case when p_dati ? 'contatore_unita' then nullif(p_dati->>'contatore_unita', '') else contatore_unita end
  where id = v_id;
  return v_id;
end $$;

create or replace function public.salva_piano_manutenzione(p_attrezzatura_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.attrezzature; v_id uuid;
begin
  select * into a from public.attrezzature where id = p_attrezzatura_id;
  perform app.richiedi(found);
  perform app.richiedi_op(a.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'manutenzione');
  if p_dati->>'obbligo' = 'obbligatoria' and coalesce(btrim(p_dati->>'fonte'), '') = '' then
    raise exception 'Per una scadenza obbligatoria indica la norma o il documento da cui deriva' using errcode = '22023';
  end if;
  insert into public.manutenzioni_piani (ristorante_id, attrezzatura_id, titolo, obbligo, fonte, ogni_giorni, ogni_contatore, prossima_data, prossimo_contatore)
  values (a.ristorante_id, a.id, btrim(p_dati->>'titolo'), p_dati->>'obbligo', nullif(btrim(p_dati->>'fonte'), ''),
          app.num(p_dati->>'ogni_giorni')::int, app.num(p_dati->>'ogni_contatore'),
          coalesce(nullif(p_dati->>'prossima_data', '')::date,
                   case when app.num(p_dati->>'ogni_giorni') is not null then (now() at time zone 'Europe/Rome')::date + app.num(p_dati->>'ogni_giorni')::int end),
          case when app.num(p_dati->>'ogni_contatore') is not null then coalesce(a.contatore, 0) + app.num(p_dati->>'ogni_contatore') end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.apri_intervento(p_attrezzatura_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.attrezzature; v_id uuid; v_tipo text := coalesce(p_dati->>'tipo', 'manutenzione');
begin
  select * into a from public.attrezzature where id = p_attrezzatura_id;
  perform app.richiedi(found);
  perform app.richiedi_op(a.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'manutenzione');
  insert into public.interventi (ristorante_id, attrezzatura_id, piano_id, tipo, descrizione, indisponibile_dal, aperto_da)
  values (a.ristorante_id, a.id, app.uuid_sicuro(p_dati->>'piano_id'), v_tipo, btrim(p_dati->>'descrizione'),
          case when (p_dati->>'indisponibile')::boolean then now() end, auth.uid())
  returning id into v_id;
  if v_tipo = 'guasto' then update public.attrezzature set stato = 'guasta' where id = a.id; end if;
  return v_id;
end $$;

-- Chiude un intervento. Se deriva da un piano, sposta in avanti la prossima scadenza.
create or replace function public.chiudi_intervento(p_intervento_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.interventi; p public.manutenzioni_piani; v_cont numeric := app.num(p_dati->>'contatore'); v_annulla boolean := coalesce((p_dati->>'annulla')::boolean, false);
begin
  select * into i from public.interventi where id = p_intervento_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(i.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'manutenzione');
  if i.stato in ('completato', 'annullato') then raise exception 'Intervento già chiuso' using errcode = '22023'; end if;
  if not v_annulla and coalesce(btrim(p_dati->>'esito'), '') = '' then raise exception 'Descrivi l''esito dell''intervento' using errcode = '22023'; end if;
  update public.interventi set stato = case when v_annulla then 'annullato' else 'completato' end,
    esito = nullif(btrim(p_dati->>'esito'), ''), eseguito_da = nullif(btrim(p_dati->>'eseguito_da'), ''),
    ricambi = nullif(btrim(p_dati->>'ricambi'), ''), costo = app.num(p_dati->>'costo'),
    valuta = case when app.num(p_dati->>'costo') is not null then coalesce(upper(nullif(btrim(p_dati->>'valuta'), '')), 'EUR') end,
    indisponibile_al = case when indisponibile_dal is not null then now() end, completato_il = now(), chiuso_da = auth.uid()
  where id = i.id;
  if v_annulla then return; end if;
  update public.attrezzature set stato = case when stato = 'guasta' and i.tipo = 'guasto' then 'operativa' else stato end,
         contatore = coalesce(v_cont, contatore) where id = i.attrezzatura_id;
  if i.piano_id is not null then
    select * into p from public.manutenzioni_piani where id = i.piano_id;
    update public.manutenzioni_piani set
      prossima_data = case when p.ogni_giorni is not null then (now() at time zone 'Europe/Rome')::date + p.ogni_giorni end,
      prossimo_contatore = case when p.ogni_contatore is not null then coalesce(v_cont, (select a.contatore from public.attrezzature a where a.id = i.attrezzatura_id), 0) + p.ogni_contatore end
    where id = p.id;
  end if;
end $$;

-- Scadenze di manutenzione con lo stato calcolato alla data di oggi (Europe/Rome).
create view public.v_scadenze_manutenzione with (security_invoker = true) as
select p.*, a.nome as attrezzatura, a.stato as attrezzatura_stato, a.contatore, a.contatore_unita,
       p.prossima_data - (now() at time zone 'Europe/Rome')::date as giorni_mancanti,
       case when (p.prossima_data is not null and p.prossima_data < (now() at time zone 'Europe/Rome')::date)
              or (p.prossimo_contatore is not null and a.contatore is not null and a.contatore >= p.prossimo_contatore) then 'scaduta'
            when p.prossima_data is not null and p.prossima_data <= (now() at time zone 'Europe/Rome')::date + 14 then 'in_scadenza'
            when p.prossimo_contatore is not null and a.contatore is null then 'contatore_non_rilevato'
            else 'in_regola' end as stato_scadenza,
       exists (select 1 from public.interventi i where i.piano_id = p.id and i.stato in ('aperto', 'in_corso')) as intervento_aperto
  from public.manutenzioni_piani p join public.attrezzature a on a.id = p.attrezzatura_id
 where p.attivo and a.stato <> 'dismessa';

-- ── RLS, audit, privilegi ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['ricette', 'ricette_versioni', 'ricette_ingredienti', 'vendite', 'consegne', 'non_conformita',
                           'ordini_proposti', 'attrezzature', 'manutenzioni_piani', 'interventi'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "%s: lettura sede" on public.%I for select to authenticated using (app.ha_accesso_ristorante(ristorante_id))', t, t);
  end loop;
  foreach t in array array['ricette', 'ricette_versioni', 'consegne', 'non_conformita', 'ordini_proposti',
                           'attrezzature', 'manutenzioni_piani', 'interventi'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
revoke all on public.v_scadenze_manutenzione from anon, authenticated;
grant select on public.v_scadenze_manutenzione to authenticated;

revoke all on function
  public.salva_ricetta(uuid, jsonb, uuid), public.costo_ricetta(uuid, uuid),
  public.registra_vendita(uuid, uuid, date, numeric, text, text, text), public.storna_vendita(uuid),
  public.margini_ricette(uuid, date, date), public.scostamenti_consumo(uuid, date, date),
  public.registra_consegna(uuid, jsonb), public.apri_non_conformita(uuid, jsonb), public.chiudi_non_conformita(uuid, text),
  public.imposta_scorecard(uuid, jsonb), public.scorecard_fornitori(uuid, date, date), public.confronta_fornitori(uuid, uuid),
  public.proponi_ordine(uuid, uuid, jsonb, text), public.decidi_ordine(uuid, text),
  public.salva_attrezzatura(uuid, jsonb, uuid), public.salva_piano_manutenzione(uuid, jsonb),
  public.apri_intervento(uuid, jsonb), public.chiudi_intervento(uuid, jsonb)
  from public, anon;
grant execute on function
  public.salva_ricetta(uuid, jsonb, uuid), public.costo_ricetta(uuid, uuid),
  public.registra_vendita(uuid, uuid, date, numeric, text, text, text), public.storna_vendita(uuid),
  public.margini_ricette(uuid, date, date), public.scostamenti_consumo(uuid, date, date),
  public.registra_consegna(uuid, jsonb), public.apri_non_conformita(uuid, jsonb), public.chiudi_non_conformita(uuid, text),
  public.imposta_scorecard(uuid, jsonb), public.scorecard_fornitori(uuid, date, date), public.confronta_fornitori(uuid, uuid),
  public.proponi_ordine(uuid, uuid, jsonb, text), public.decidi_ordine(uuid, text),
  public.salva_attrezzatura(uuid, jsonb, uuid), public.salva_piano_manutenzione(uuid, jsonb),
  public.apri_intervento(uuid, jsonb), public.chiudi_intervento(uuid, jsonb)
  to authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid),
  app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]), app.converti(uuid, numeric, text, text) to authenticated;
