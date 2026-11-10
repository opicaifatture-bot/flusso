-- ═══════════════════════════════════════════════════════════════════════════
-- Audit di coerenza — motivo dei confronti, soglia minima, cruscotto per
-- periodo, stato di revisione, catalogo per sede, IP dell'audit ristretto
-- ═══════════════════════════════════════════════════════════════════════════
-- Migrazione additiva. Non corregge dati inseriti da persone o dall'estrazione:
-- alla fine ricalcola soltanto i campi derivati (prezzi normalizzati, esito
-- del confronto), che dipendono in modo deterministico dalle righe esistenti.

-- ── Sede: soglia minima assoluta e validazione di paese e valuta ───────────
alter table public.ristoranti
  add column soglia_anomalia_min_eur numeric(10,2) not null default 0 check (soglia_anomalia_min_eur >= 0);
alter table public.ristoranti
  add constraint ristoranti_paese_check check (paese is null or paese in ('IT', 'FR', 'MC', 'CH')) not valid,
  add constraint ristoranti_valuta_check check (valuta in ('EUR', 'CHF')) not valid;

drop function public.aggiorna_ristorante(uuid, text, numeric, text, text, text);
create function public.aggiorna_ristorante(
  p_ristorante_id uuid, p_nome text default null, p_soglia_anomalia_pct numeric default null,
  p_paese text default null, p_valuta text default null, p_partita_iva text default null,
  p_soglia_anomalia_min_eur numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_paese text := upper(nullif(btrim(p_paese), '')); v_valuta text := upper(nullif(btrim(p_valuta), ''));
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare']::public.ruolo_membro[]));
  if v_paese is not null and v_paese not in ('IT', 'FR', 'MC', 'CH') then
    raise exception 'Paese non supportato: scegli Italia, Francia, Monaco o Svizzera' using errcode = '22023';
  end if;
  if v_valuta is not null and v_valuta not in ('EUR', 'CHF') then
    raise exception 'Valuta non supportata: scegli EUR o CHF' using errcode = '22023';
  end if;
  if p_soglia_anomalia_pct is not null and (p_soglia_anomalia_pct <= 0 or p_soglia_anomalia_pct > 100) then
    raise exception 'La soglia percentuale deve essere tra 0 e 100' using errcode = '22023';
  end if;
  if p_soglia_anomalia_min_eur is not null and p_soglia_anomalia_min_eur < 0 then
    raise exception 'La soglia minima non può essere negativa' using errcode = '22023';
  end if;
  update public.ristoranti set
    nome = coalesce(nullif(btrim(p_nome), ''), nome),
    soglia_anomalia_pct = coalesce(p_soglia_anomalia_pct, soglia_anomalia_pct),
    soglia_anomalia_min_eur = coalesce(p_soglia_anomalia_min_eur, soglia_anomalia_min_eur),
    paese = coalesce(v_paese, paese),
    valuta = coalesce(v_valuta, valuta),
    partita_iva = coalesce(nullif(btrim(p_partita_iva), ''), partita_iva)
  where id = p_ristorante_id;
  -- Soglie cambiate: i rincari vanno ricalcolati con le nuove regole.
  if p_soglia_anomalia_pct is not null or p_soglia_anomalia_min_eur is not null then
    perform app.ricalcola_serie(p_ristorante_id,
      (select coalesce(array_agg(distinct s.alias_id), '{}') from public.storico_prezzi s where s.ristorante_id = p_ristorante_id), '{}');
  end if;
end $$;
revoke all on function public.aggiorna_ristorante(uuid, text, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.aggiorna_ristorante(uuid, text, numeric, text, text, text, numeric) to authenticated;

-- ── Cambio: un tasso troppo vecchio non è un tasso valido ──────────────────
-- La BCE non pubblica nei festivi, quindi si accetta l'ultimo tasso entro i
-- 10 giorni precedenti la data del documento. Oltre, il controvalore resta
-- vuoto e l'interfaccia lo dichiara, invece di usare un cambio non pertinente.
create or replace function app.tasso_bce(p_valuta text, p_data date) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when upper(p_valuta) = 'EUR' then 1::numeric else (
    select t.tasso from public.tassi_cambio t
     where t.valuta = upper(p_valuta)
       and t.data <= coalesce(p_data, current_date)
       and t.data >= coalesce(p_data, current_date) - 10
     order by t.data desc limit 1) end
$$;

-- ── Righe: esito del confronto e riga di riferimento ───────────────────────
alter table public.storico_prezzi
  add column riga_precedente_id uuid references public.storico_prezzi(id) on delete set null,
  add column confronto_esito text check (confronto_esito in
    ('confrontato', 'primo_acquisto', 'unita_non_confrontabile', 'valuta_diversa', 'nota_di_credito'));

-- Ricalcolo in ordine cronologico. Rispetto alla versione precedente:
-- salva la riga con cui è avvenuto il confronto, spiega perché un confronto
-- manca e applica la soglia minima assoluta (maggior costo in EUR della riga).
create or replace function app.ricalcola_serie(p_ristorante_id uuid, p_alias uuid[], p_master uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record; p record;
  v_soglia numeric; v_min numeric; v_netto numeric; v_target text; v_base numeric; v_tasso numeric;
  v_prec numeric; v_att numeric; v_um text; v_var numeric; v_anom boolean; v_esito text; v_prec_id uuid;
  v_impatto numeric;
  v_docs uuid[] := '{}';
begin
  select soglia_anomalia_pct, soglia_anomalia_min_eur into v_soglia, v_min
    from public.ristoranti where id = p_ristorante_id;

  for r in
    select sp.id, sp.documento_id, sp.alias_id, sp.master_id, sp.fornitore_id, sp.valuta, sp.quantita,
           sp.unita_misura, sp.prezzo_unitario, sp.sconto_percentuale, sp.totale_riga, sp.peso_netto_kg,
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
    v_prec := null; v_att := null; v_um := null; v_prec_id := null;

    if r.tipo = 'Nota di Credito' then
      v_esito := 'nota_di_credito';
    else
      select s.id, s.prezzo_base, s.unita_base, s.prezzo_netto, s.unita_misura into p
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
          v_prec := p.prezzo_base; v_att := v_base; v_um := v_target; v_prec_id := p.id;
        elsif lower(p.unita_misura) is not distinct from lower(r.unita_misura) then
          v_prec := p.prezzo_netto; v_att := v_netto; v_um := r.unita_misura; v_prec_id := p.id;
        end if;
        v_esito := case when v_prec > 0 then 'confrontato' else 'unita_non_confrontabile' end;
      elsif exists (
        select 1 from public.storico_prezzi s join public.documenti sd on sd.id = s.documento_id
         where s.ristorante_id = p_ristorante_id and s.fornitore_id = r.fornitore_id and s.valuta <> r.valuta
           and s.documento_id <> r.documento_id and sd.stato = 'completato' and sd.tipo <> 'Nota di Credito'
           and ((r.master_id is not null and s.master_id = r.master_id) or s.alias_id = r.alias_id)
           and (s.data_rilevazione, s.creato_il, s.id) < (r.data_rilevazione, r.creato_il, r.id)) then
        v_esito := 'valuta_diversa';
      else
        v_esito := 'primo_acquisto';
      end if;
    end if;

    v_var := case when v_prec > 0 then round((v_att - v_prec) / v_prec * 100, 2) end;
    -- Maggior costo della riga, in EUR quando il cambio è disponibile.
    v_impatto := case when v_var > 0 then r.totale_riga * v_var / (100 + v_var) / coalesce(v_tasso, 1) end;
    v_anom := coalesce(v_var > v_soglia, false)
              and (coalesce(v_min, 0) = 0 or v_impatto is null or v_impatto >= v_min);

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
      riga_precedente_id = v_prec_id,
      confronto_esito = v_esito,
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

-- ── Viste ──────────────────────────────────────────────────────────────────
drop view public.v_anomalie;
drop view public.v_righe;

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

-- Rincari con il dettaglio dell'acquisto di confronto. L'impatto è nella valuta
-- del documento; quello in EUR esiste solo se il cambio BCE è disponibile.
create view public.v_anomalie with (security_invoker = true) as
select r.*,
       round(r.totale_riga * r.variazione_pct / (100 + r.variazione_pct), 2) as impatto,
       round(r.totale_riga_eur * r.variazione_pct / (100 + r.variazione_pct), 2) as impatto_eur,
       r.prezzo_confronto - r.prezzo_precedente as variazione_assoluta,
       p.documento_id as prec_documento_id, pd.numero as prec_numero, pd.data_documento as prec_data,
       p.quantita as prec_quantita, p.unita_misura as prec_unita_misura
  from public.v_righe r
  left join public.storico_prezzi p on p.id = r.riga_precedente_id
  left join public.documenti pd on pd.id = p.documento_id
 where r.anomalia_prezzo and r.documento_stato = 'completato';

-- Documento con lo stato di revisione umana, distinto dallo stato di elaborazione:
-- "completato" significa solo che l'estrazione è finita.
create view public.v_documenti with (security_invoker = true) as
select d.id, d.ristorante_id, d.fornitore_id, d.tipo, d.numero, d.data_documento, d.imponibile, d.iva,
       d.totale, d.valuta, d.tasso_cambio, d.imponibile_eur, d.totale_eur, d.stato, d.fase, d.errore,
       d.errore_codice, d.n_anomalie, d.nome_file, d.mime, d.dimensione, d.duplicato_di,
       d.corretto_manualmente, d.created_at, d.aggiornato_il, d.completato_il,
       f.ragione_sociale, f.paese,
       coalesce(x.n_righe, 0) as n_righe,
       coalesce(x.n_da_validare, 0) as n_da_validare,
       coalesce(x.n_rincari_aperti, 0) as n_rincari_aperti
  from public.documenti d
  left join public.fornitori f on f.id = d.fornitore_id
  left join lateral (
    select count(*) as n_righe,
           count(*) filter (where a.stato_abbinamento in ('da_abbinare', 'proposto') or m.stato = 'bozza') as n_da_validare,
           count(*) filter (where s.anomalia_prezzo and s.anomalia_stato = 'aperta') as n_rincari_aperti
      from public.storico_prezzi s
      join public.alias_articolo a on a.id = s.alias_id
      left join public.articoli_master m on m.id = s.master_id
     where s.documento_id = d.id) x on true;

revoke all on public.v_righe, public.v_anomalie, public.v_documenti from anon, authenticated;
grant select on public.v_righe, public.v_anomalie, public.v_documenti to authenticated;

-- ── Catalogo visto da una sede ─────────────────────────────────────────────
-- L'ultimo prezzo è quello della sede indicata, non di un'altra sede del gruppo.
create or replace function public.catalogo_sede(p_ristorante_id uuid)
returns table (id uuid, nome text, unita_base text, stato text, categoria text, n_alias bigint, n_fornitori bigint,
               n_acquisti bigint, n_rincari_aperti bigint, ultimo_prezzo numeric, ultima_unita text,
               ultima_valuta text, ultima_variazione numeric, ultimo_acquisto timestamptz, ultimo_fornitore text)
language sql stable set search_path = '' as $$
  select m.id, m.nome, m.unita_base, m.stato, c.nome,
         (select count(*) from public.alias_articolo a where a.master_id = m.id),
         (select count(distinct a.fornitore_id) from public.alias_articolo a where a.master_id = m.id),
         (select count(*) from public.storico_prezzi s where s.master_id = m.id and s.ristorante_id = p_ristorante_id),
         (select count(*) from public.storico_prezzi s where s.master_id = m.id and s.ristorante_id = p_ristorante_id
             and s.anomalia_prezzo and s.anomalia_stato = 'aperta'),
         coalesce(u.prezzo_base, u.prezzo_netto), case when u.prezzo_base is not null then u.unita_base else u.unita_misura end,
         u.valuta, u.variazione_pct, u.data_rilevazione, f.ragione_sociale
    from public.articoli_master m
    left join public.categorie_master c on c.id = m.categoria_id
    left join lateral (select s.* from public.storico_prezzi s
                        where s.master_id = m.id and s.ristorante_id = p_ristorante_id
                        order by s.data_rilevazione desc, s.creato_il desc limit 1) u on true
    left join public.fornitori f on f.id = u.fornitore_id
   where m.gruppo_id = (select r.gruppo_id from public.ristoranti r where r.id = p_ristorante_id)
$$;

-- Possibili doppioni di un articolo master (nome simile), da valutare a mano.
create or replace function public.master_simili(p_master_id uuid)
returns table (id uuid, nome text, unita_base text, stato text, categoria text, somiglianza numeric)
language sql stable set search_path = public, extensions as $$
  select o.id, o.nome, o.unita_base, o.stato, c.nome, round(similarity(o.nome_norm, m.nome_norm)::numeric, 2)
    from articoli_master m
    join articoli_master o on o.gruppo_id = m.gruppo_id and o.id <> m.id
    left join categorie_master c on c.id = o.categoria_id
   where m.id = p_master_id and similarity(o.nome_norm, m.nome_norm) >= 0.35
   order by 6 desc limit 5
$$;

drop view public.v_catalogo;

-- ── Cruscotto per periodo ──────────────────────────────────────────────────
-- Tutte le metriche usano la DATA DEL DOCUMENTO (non quella di caricamento) e
-- lo stesso periodo [dal, al]. "Oggi" è calcolato sul fuso Europe/Rome, comune
-- a Italia, Francia, Monaco e Svizzera. La spesa è l'imponibile delle fatture
-- meno le note di credito. Gli importi senza cambio BCE non vengono sommati:
-- sono riportati a parte, nella loro valuta.
drop function public.cruscotto(uuid);
create function public.cruscotto(p_ristorante_id uuid, p_giorni int default 90)
returns jsonb language sql stable set search_path = '' as $$
  with par as (
    select (now() at time zone 'Europe/Rome')::date as oggi,
           least(greatest(coalesce(p_giorni, 90), 7), 730) as giorni
  ), lim as (
    select oggi, giorni, oggi - (giorni - 1) as dal, oggi - (2 * giorni - 1) as dal_prec from par
  ), doc as (
    select d.id, d.fornitore_id, d.tipo, d.valuta,
           coalesce(d.data_documento, (d.created_at at time zone 'Europe/Rome')::date) as giorno,
           case d.tipo when 'Fattura' then 1 when 'Nota di Credito' then -1 else 0 end as segno,
           d.imponibile, d.imponibile_eur
      from public.documenti d
     where d.ristorante_id = p_ristorante_id and d.stato = 'completato'
  ), per as (
    select doc.* from doc, lim where doc.giorno between lim.dal and lim.oggi
  ), prec as (
    select doc.* from doc, lim where doc.giorno >= lim.dal_prec and doc.giorno < lim.dal
  ), righe as (
    select r.* from public.v_righe r, lim
     where r.ristorante_id = p_ristorante_id and r.documento_stato = 'completato'
       and coalesce(r.data_documento, (r.creato_il at time zone 'Europe/Rome')::date) between lim.dal and lim.oggi
  ), anom as (
    select a.* from public.v_anomalie a where a.ristorante_id = p_ristorante_id
  ), serie as (
    select g::date as inizio,
           (case when (select giorni from lim) <= 100 then g + interval '6 days' else g + interval '1 month - 1 day' end)::date as fine
      from lim, generate_series(
        case when lim.giorni <= 100 then date_trunc('week', lim.dal::timestamp) else date_trunc('month', lim.dal::timestamp) end,
        lim.oggi::timestamp,
        case when lim.giorni <= 100 then interval '1 week' else interval '1 month' end) g
  )
  select jsonb_build_object(
    'oggi', (select oggi from lim), 'dal', (select dal from lim), 'giorni', (select giorni from lim),
    'passo', case when (select giorni from lim) <= 100 then 'settimana' else 'mese' end,
    -- periodo selezionato
    'n_documenti', (select count(*) from per),
    'n_fatture', (select count(*) from per where segno <> 0),
    'spesa', (select sum(segno * imponibile_eur) from per where segno <> 0 and imponibile_eur is not null),
    'spesa_prec', (select sum(segno * imponibile_eur) from prec where segno <> 0 and imponibile_eur is not null),
    'non_convertiti', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select valuta, count(*) as documenti, sum(segno * imponibile) as importo
          from per where segno <> 0 and imponibile_eur is null group by valuta) x),
    'n_confronti', (select count(*) from righe where confronto_esito = 'confrontato'),
    'risparmi', (select sum(-totale_riga_eur * variazione_pct / (100 + variazione_pct)) from righe where variazione_pct < 0),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('inizio', s.inizio, 'fine', s.fine,
                'spesa', coalesce((select sum(per.segno * per.imponibile_eur) from per
                                    where per.giorno between s.inizio and s.fine and per.imponibile_eur is not null), 0),
                'documenti', (select count(*) from per where per.giorno between s.inizio and s.fine and per.segno <> 0))
              order by s.inizio), '[]'::jsonb) from serie s),
    'top_fornitori', (select coalesce(jsonb_agg(x order by x.spesa desc nulls last), '[]'::jsonb) from (
        select f.ragione_sociale, f.paese, sum(per.segno * per.imponibile_eur) as spesa, count(*) as documenti,
               count(*) filter (where per.imponibile_eur is null) as non_convertiti
          from per join public.fornitori f on f.id = per.fornitore_id
         where per.segno <> 0 group by f.id order by 3 desc nulls last limit 6) x),
    'categorie', (select coalesce(jsonb_agg(x order by x.spesa desc nulls last), '[]'::jsonb) from (
        select coalesce(categoria, 'Non classificato') as categoria, sum(totale_riga_eur) as spesa
          from righe where tipo = 'Fattura' and totale_riga_eur is not null
         group by 1 order by 2 desc nulls last limit 8) x),
    -- stato attuale, indipendente dal periodo
    'totale_documenti', (select count(*) from doc),
    'primo_documento', (select min(giorno) from doc), 'ultimo_documento', (select max(giorno) from doc),
    'in_lavorazione', (select count(*) from public.documenti d
                        where d.ristorante_id = p_ristorante_id and d.stato in ('in_coda', 'elaborazione')),
    'errori', (select count(*) from public.documenti d where d.ristorante_id = p_ristorante_id and d.stato = 'errore'),
    'rincari_aperti', (select count(*) from anom where anomalia_stato = 'aperta'),
    'rincari_contestati', (select count(*) from anom where anomalia_stato = 'contestata'),
    'impatto_rincari', (select sum(impatto_eur) from anom where anomalia_stato in ('aperta', 'contestata')),
    'da_validare', (select count(*) from public.v_coda_alias q where q.ristorante_id = p_ristorante_id),
    'master_in_bozza', (select count(*) from public.articoli_master m
                         where m.stato = 'bozza'
                           and m.gruppo_id = (select r.gruppo_id from public.ristoranti r where r.id = p_ristorante_id)),
    'documenti_da_rivedere', (select count(*) from public.v_documenti v
                               where v.ristorante_id = p_ristorante_id and v.stato = 'completato'
                                 and (v.n_da_validare > 0 or v.n_rincari_aperti > 0)),
    'fornitori', (select count(*) from public.fornitori_ristorante fr where fr.ristorante_id = p_ristorante_id and fr.attivo)
  )
$$;

-- ── Audit: IP e autore solo a chi serve ────────────────────────────────────
-- L'IP è un dato personale: lo vede solo il titolare. La lettura passa da una
-- RPC; ai ruoli API vengono tolte le colonne ip e ip_connessione della tabella.
revoke select on public.audit_log from authenticated;
grant select (id, gruppo_id, seq, ristorante_id, tabella, riga_id, operazione, prima, dopo, utente_id,
              ruolo_db, origine, creato_il, hash_precedente, hash) on public.audit_log to authenticated;

create or replace function public.registro_audit(
  p_gruppo_id uuid, p_limite int default 50, p_prima_di bigint default null, p_tabella text default null,
  p_origine text default null, p_righe text[] default null, p_operazione text default null)
returns table (seq bigint, creato_il timestamptz, tabella text, riga_id text, operazione text, origine text,
               prima jsonb, dopo jsonb, utente_id uuid, autore text, ip text)
language plpgsql stable security definer set search_path = '' as $$
declare v_titolare boolean;
begin
  perform app.richiedi(app.ha_ruolo_gruppo(p_gruppo_id, array['titolare', 'contabile']::public.ruolo_membro[]));
  v_titolare := app.ha_ruolo_gruppo(p_gruppo_id, array['titolare']::public.ruolo_membro[]);
  return query
    select a.seq, a.creato_il, a.tabella, a.riga_id, a.operazione, a.origine, a.prima, a.dopo, a.utente_id,
           u.email::text, case when v_titolare then a.ip end
      from public.audit_log a
      left join auth.users u on u.id = a.utente_id
     where a.gruppo_id = p_gruppo_id
       and (p_prima_di is null or a.seq < p_prima_di)
       and (p_tabella is null or a.tabella = p_tabella)
       and (p_origine is null or a.origine = p_origine)
       and (p_operazione is null or a.operazione = p_operazione)
       and (p_righe is null or a.riga_id = any (p_righe))
     order by a.seq desc
     limit least(greatest(coalesce(p_limite, 50), 1), 200);
end $$;

revoke all on function public.cruscotto(uuid, int), public.catalogo_sede(uuid), public.master_simili(uuid),
  public.registro_audit(uuid, int, bigint, text, text, text[], text) from public, anon;
grant execute on function public.cruscotto(uuid, int), public.catalogo_sede(uuid), public.master_simili(uuid),
  public.registro_audit(uuid, int, bigint, text, text, text[], text) to authenticated;

-- ── Campi derivati: ricalcolo con le nuove regole ──────────────────────────
do $$
declare d record;
begin
  for d in select id from public.documenti where stato = 'completato' order by data_documento nulls last, created_at loop
    perform app.aggiorna_eur_documento(d.id);
    perform app.ricalcola_documento(d.id);
  end loop;
end $$;
