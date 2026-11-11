-- ═══════════════════════════════════════════════════════════════════════════
-- Autocontrollo · 2–7 — piano dei controlli (CCP, prerequisiti, analisi,
-- infestanti) estratto dal manuale con approvazione, albero delle decisioni,
-- registri firmati con PIN, formazione, firme delle policy, trappole,
-- allergeni ed etichette, scadenzario esteso.
-- ═══════════════════════════════════════════════════════════════════════════
-- Principi: nessun valore normativo inventato (limiti, frequenze, ore di formazione
-- vengono dal manuale, dal consulente o dall'utente, con la fonte); registri immutabili;
-- le correzioni sono nuove registrazioni che rettificano le precedenti.

alter table public.ristoranti add column regione text,
  add column gestione_infestanti text check (gestione_infestanti in ('interna', 'esterna', 'mista'));

-- Il tablet di cucina può caricare foto (bolle, etichette) nella cartella della sede.
alter policy "archivio: caricamento" on storage.objects
  with check (bucket_id = 'archivio'
    and app.ha_ruolo(app.uuid_sicuro((storage.foldername(name))[1]), array['titolare', 'chef', 'consulente', 'cucina']::public.ruolo_membro[]));

create or replace function app.giorni_frequenza(p text) returns int
language sql immutable set search_path = '' as $$
  select case p when 'ogni_servizio' then 1 when 'giornaliera' then 1 when 'settimanale' then 7 when 'quindicinale' then 14
                when 'mensile' then 30 when 'bimestrale' then 61 when 'trimestrale' then 91 when 'semestrale' then 182
                when 'annuale' then 365 end
$$;

-- ── Piano dei controlli ────────────────────────────────────────────────────
create table public.controlli (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  categoria text not null check (categoria in ('ccp', 'prp_pulizia', 'prp_infestanti', 'analisi_acqua', 'analisi_alimenti',
                                               'abbattimento', 'conservazione', 'ricevimento', 'altro')),
  titolo text not null check (btrim(titolo) <> ''),
  fase text, pericolo text,
  tipo_pericolo text check (tipo_pericolo in ('biologico', 'chimico', 'fisico', 'allergeni')),
  misura text,                       -- misura di controllo / procedura
  limite_testo text,                 -- limite critico come scritto nel manuale
  limite_min numeric, limite_max numeric, unita text,
  frequenza text check (frequenza in ('ogni_servizio', 'giornaliera', 'settimanale', 'quindicinale', 'mensile', 'bimestrale',
                                      'trimestrale', 'semestrale', 'annuale', 'ad_ogni_lotto', 'al_bisogno')),
  monitoraggio text, azione_correttiva text, responsabile text, verifica text,
  parametri text,                    -- analisi: parametri da ricercare (es. come indicati dal piano analisi)
  gestione text not null default 'interna' check (gestione in ('interna', 'esterna')),
  ubicazione_id uuid references public.ubicazioni(id) on delete set null,
  fonte text not null check (fonte in ('manuale', 'utente')),
  proposta_id uuid,
  differisce_da_manuale boolean not null default false,
  nota_differenza text,
  albero jsonb, esito_albero text check (esito_albero in ('ccp', 'non_ccp', 'modificare')),
  albero_deciso_da uuid references auth.users(id) on delete set null, albero_deciso_il timestamptz,
  attivo boolean not null default true,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  check (limite_min is null or limite_max is null or limite_min <= limite_max)
);
create trigger controlli_non_cancellabili before delete on public.controlli for each row execute function app.immutabile();

-- Estrazione automatica dal manuale / piano analisi: stato e proposte da approvare.
create table public.estrazioni (
  versione_id uuid primary key references public.archivio_versioni(id) on delete restrict,
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  stato text not null check (stato in ('in_corso', 'completata', 'errore')),
  errore text, n_proposte int,
  avviata_da uuid references auth.users(id) on delete set null,
  avviata_il timestamptz not null default now(), completata_il timestamptz
);
create table public.proposte_estrazione (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  versione_id uuid not null references public.archivio_versioni(id) on delete restrict,
  categoria text not null check (categoria in ('ccp', 'prp_pulizia', 'prp_infestanti', 'analisi_acqua', 'analisi_alimenti',
                                               'abbattimento', 'conservazione', 'ricevimento', 'altro', 'informazione')),
  titolo text not null,
  dati jsonb not null default '{}',
  citazione text, pagina int,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accettata', 'modificata', 'scartata')),
  controllo_id uuid references public.controlli(id) on delete set null,
  nota text,
  deciso_da uuid references auth.users(id) on delete set null, deciso_il timestamptz,
  creato_il timestamptz not null default now()
);
alter table public.controlli add constraint controlli_proposta_fk foreign key (proposta_id) references public.proposte_estrazione(id) on delete set null;

create or replace function app.applica_campi_controllo(p_id uuid, p_dati jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.controlli set
    categoria = coalesce(nullif(p_dati->>'categoria', ''), categoria),
    titolo = coalesce(nullif(btrim(p_dati->>'titolo'), ''), titolo),
    fase = case when p_dati ? 'fase' then nullif(btrim(p_dati->>'fase'), '') else fase end,
    pericolo = case when p_dati ? 'pericolo' then nullif(btrim(p_dati->>'pericolo'), '') else pericolo end,
    tipo_pericolo = case when p_dati ? 'tipo_pericolo' then nullif(p_dati->>'tipo_pericolo', '') else tipo_pericolo end,
    misura = case when p_dati ? 'misura' then nullif(btrim(p_dati->>'misura'), '') else misura end,
    limite_testo = case when p_dati ? 'limite_testo' then nullif(btrim(p_dati->>'limite_testo'), '') else limite_testo end,
    limite_min = case when p_dati ? 'limite_min' then app.num(p_dati->>'limite_min') else limite_min end,
    limite_max = case when p_dati ? 'limite_max' then app.num(p_dati->>'limite_max') else limite_max end,
    unita = case when p_dati ? 'unita' then nullif(btrim(p_dati->>'unita'), '') else unita end,
    frequenza = case when p_dati ? 'frequenza' then nullif(p_dati->>'frequenza', '') else frequenza end,
    monitoraggio = case when p_dati ? 'monitoraggio' then nullif(btrim(p_dati->>'monitoraggio'), '') else monitoraggio end,
    azione_correttiva = case when p_dati ? 'azione_correttiva' then nullif(btrim(p_dati->>'azione_correttiva'), '') else azione_correttiva end,
    responsabile = case when p_dati ? 'responsabile' then nullif(btrim(p_dati->>'responsabile'), '') else responsabile end,
    verifica = case when p_dati ? 'verifica' then nullif(btrim(p_dati->>'verifica'), '') else verifica end,
    parametri = case when p_dati ? 'parametri' then nullif(btrim(p_dati->>'parametri'), '') else parametri end,
    gestione = coalesce(nullif(p_dati->>'gestione', ''), gestione),
    ubicazione_id = case when p_dati ? 'ubicazione_id' then app.uuid_sicuro(p_dati->>'ubicazione_id') else ubicazione_id end,
    attivo = case when p_dati ? 'attivo' then (p_dati->>'attivo')::boolean else attivo end
  where id = p_id;
  if exists (select 1 from public.controlli c where c.id = p_id and c.ubicazione_id is not null
               and not exists (select 1 from public.ubicazioni u where u.id = c.ubicazione_id and u.ristorante_id = c.ristorante_id)) then
    raise exception 'Ubicazione non valida' using errcode = '22023';
  end if;
end $$;

-- Crea o modifica un controllo a mano. Modificare un controllo che viene dal manuale
-- richiede una nota: l'app segnala che il valore differisce da quanto scritto nel manuale.
create or replace function public.salva_controllo(p_ristorante_id uuid, p_dati jsonb, p_controllo_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_controllo_id; c public.controlli;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if v_id is null then
    if coalesce(btrim(p_dati->>'titolo'), '') = '' or coalesce(p_dati->>'categoria', '') = '' then
      raise exception 'Indica tipo e titolo del controllo' using errcode = '22023';
    end if;
    insert into public.controlli (ristorante_id, categoria, titolo, fonte, creato_da)
    values (p_ristorante_id, p_dati->>'categoria', btrim(p_dati->>'titolo'), 'utente', auth.uid()) returning id into v_id;
  else
    select * into c from public.controlli where id = v_id and ristorante_id = p_ristorante_id for update;
    if not found then raise exception 'Controllo non trovato' using errcode = 'P0002'; end if;
    if c.fonte = 'manuale' and (p_dati - 'attivo') <> '{}'::jsonb then
      if coalesce(btrim(p_dati->>'nota_differenza'), '') = '' then
        raise exception 'Questo controllo viene dal manuale: spiega perché lo modifichi' using errcode = '22023';
      end if;
      update public.controlli set differisce_da_manuale = true, nota_differenza = btrim(p_dati->>'nota_differenza') where id = v_id;
    end if;
  end if;
  perform app.applica_campi_controllo(v_id, p_dati - 'nota_differenza');
  return v_id;
end $$;

-- Albero delle decisioni (documento ALL.AD del consulente, rev. 00):
--  D1 misure di controllo possibili? NO → D1b controllo necessario? SI → modificare fase/processo/prodotto; NO → non CCP
--  D1 SI → D2 fase progettata per eliminare/ridurre? SI → CCP
--  D2 NO → D3 contaminazione oltre livelli accettabili? NO → non CCP
--  D3 SI → D4 fase successiva elimina/riduce? NO → CCP; SI → non CCP
create or replace function app.esito_albero(r jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when (r->>'d1') is null then null
    when not (r->>'d1')::boolean then case when (r->>'d1b') is null then null when (r->>'d1b')::boolean then 'modificare' else 'non_ccp' end
    when (r->>'d2') is null then null
    when (r->>'d2')::boolean then 'ccp'
    when (r->>'d3') is null then null
    when not (r->>'d3')::boolean then 'non_ccp'
    when (r->>'d4') is null then null
    when (r->>'d4')::boolean then 'non_ccp' else 'ccp' end
$$;
create or replace function public.valuta_albero(p_controllo_id uuid, p_risposte jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.controlli; v text := app.esito_albero(p_risposte);
begin
  select * into c from public.controlli where id = p_controllo_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(c.ristorante_id, array['titolare', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if v is null then raise exception 'Rispondi a tutte le domande necessarie' using errcode = '22023'; end if;
  update public.controlli set albero = p_risposte, esito_albero = v, albero_deciso_da = auth.uid(), albero_deciso_il = now(),
         categoria = case when v = 'ccp' then 'ccp' when categoria = 'ccp' then 'altro' else categoria end
   where id = c.id;
  return v;
end $$;

-- Avvio dell'estrazione su un documento caricato (manuale, piano analisi, referto, scheda tecnica).
create or replace function public.avvia_estrazione(p_versione_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.archivio_versioni; a public.archivio;
begin
  select * into v from public.archivio_versioni where id = p_versione_id;
  perform app.richiedi(found);
  perform app.richiedi_op(v.ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  select * into a from public.archivio where id = v.archivio_id;
  if v.mime <> 'application/pdf' and v.mime not like 'image/%' then raise exception 'Formato non estraibile' using errcode = '22023'; end if;
  if exists (select 1 from public.estrazioni e where e.versione_id = v.id and e.stato = 'in_corso' and e.avviata_il > now() - interval '15 minutes') then
    raise exception 'Estrazione già in corso' using errcode = '23505';
  end if;
  insert into public.estrazioni (versione_id, ristorante_id, stato, avviata_da) values (v.id, v.ristorante_id, 'in_corso', auth.uid())
  on conflict (versione_id) do update set stato = 'in_corso', errore = null, avviata_da = auth.uid(), avviata_il = now(), completata_il = null;
  return jsonb_build_object('versione_id', v.id, 'file_path', v.file_path, 'mime', v.mime, 'categoria', a.categoria, 'titolo', a.titolo);
end $$;

-- Chiamata dal servizio di estrazione (ruolo di servizio): salva le proposte, non applica nulla.
create or replace function public.registra_proposte(p_versione_id uuid, p_proposte jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v public.archivio_versioni; p jsonb; n int := 0;
  cat_ok text[] := array['ccp', 'prp_pulizia', 'prp_infestanti', 'analisi_acqua', 'analisi_alimenti', 'abbattimento', 'conservazione', 'ricevimento', 'altro', 'informazione'];
begin
  select * into v from public.archivio_versioni where id = p_versione_id;
  if not found then raise exception 'Versione non trovata' using errcode = 'P0002'; end if;
  for p in select * from jsonb_array_elements(coalesce(p_proposte, '[]')) loop
    continue when coalesce(btrim(p->>'titolo'), '') = '';
    insert into public.proposte_estrazione (ristorante_id, versione_id, categoria, titolo, dati, citazione, pagina)
    values (v.ristorante_id, v.id, case when p->>'categoria' = any (cat_ok) then p->>'categoria' else 'altro' end,
            left(btrim(p->>'titolo'), 200), coalesce(p->'dati', '{}'), left(p->>'citazione', 2000), app.num(p->>'pagina')::int);
    n := n + 1;
  end loop;
  update public.estrazioni set stato = 'completata', n_proposte = n, completata_il = now() where versione_id = v.id;
  return n;
end $$;
create or replace function public.segna_errore_estrazione(p_versione_id uuid, p_errore text)
returns void language sql security definer set search_path = '' as $$
  update public.estrazioni set stato = 'errore', errore = left(p_errore, 500), completata_il = now() where versione_id = p_versione_id
$$;

-- Decisione su una proposta: "come da manuale", "modifica" (con nota) o "scarta".
create or replace function public.decidi_proposta(p_proposta_id uuid, p_azione text, p_dati jsonb default '{}', p_nota text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.proposte_estrazione; v_id uuid;
begin
  select * into p from public.proposte_estrazione where id = p_proposta_id for update;
  perform app.richiedi(found);
  perform app.richiedi_op(p.ristorante_id, array['titolare', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if p.stato <> 'in_attesa' then raise exception 'Proposta già decisa' using errcode = '22023'; end if;
  if p_azione = 'scarta' then
    update public.proposte_estrazione set stato = 'scartata', nota = nullif(btrim(p_nota), ''), deciso_da = auth.uid(), deciso_il = now() where id = p.id;
    return null;
  elsif p_azione not in ('accetta', 'modifica') then
    raise exception 'Azione non valida' using errcode = '22023';
  end if;
  if p_azione = 'modifica' and coalesce(btrim(p_nota), '') = '' then
    raise exception 'Spiega perché imposti un valore diverso dal manuale' using errcode = '22023';
  end if;
  if p.categoria <> 'informazione' then
    insert into public.controlli (ristorante_id, categoria, titolo, fonte, proposta_id, differisce_da_manuale, nota_differenza, creato_da)
    values (p.ristorante_id, p.categoria, p.titolo, 'manuale', p.id, p_azione = 'modifica', case when p_azione = 'modifica' then btrim(p_nota) end, auth.uid())
    returning id into v_id;
    perform app.applica_campi_controllo(v_id, case when p_azione = 'modifica' then p.dati || coalesce(p_dati, '{}') else p.dati end);
  end if;
  update public.proposte_estrazione set stato = case when p_azione = 'accetta' then 'accettata' else 'modificata' end,
         controllo_id = v_id, nota = nullif(btrim(p_nota), ''), deciso_da = auth.uid(), deciso_il = now() where id = p.id;
  return v_id;
end $$;

-- ── Registri (firmati con PIN, immutabili) ─────────────────────────────────
create table public.registrazioni (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  controllo_id uuid references public.controlli(id) on delete restrict,
  tipo text not null check (tipo in ('controllo', 'pulizia', 'temperatura', 'abbattimento', 'ricevimento', 'preparazione',
                                     'infestanti', 'analisi', 'altro')),
  persona_id uuid references public.persone(id) on delete restrict,
  utente_id uuid references auth.users(id) on delete set null,
  eseguita_il timestamptz not null,
  esito text not null check (esito in ('conforme', 'non_conforme', 'da_valutare')),
  valore numeric, unita text,
  dati jsonb not null default '{}',
  azione_correttiva text,
  nota text,
  foto_path text,
  usare_entro date,
  rettifica_di uuid references public.registrazioni(id) on delete restrict,
  creato_il timestamptz not null default now(),
  check (esito <> 'non_conforme' or coalesce(btrim(azione_correttiva), '') <> '')
);
create index on public.registrazioni (ristorante_id, eseguita_il desc);
create index on public.registrazioni (controllo_id, eseguita_il desc);
create trigger registrazioni_immutabili before update or delete on public.registrazioni for each row execute function app.immutabile();

-- Registra un controllo. Con l'account Cucina la persona e il PIN sono obbligatori; un PIN errato
-- restituisce { ok: false } senza annullare il conteggio dei tentativi.
create or replace function public.registra(p_ristorante_id uuid, p_persona_id uuid, p_pin text, p_dati jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ruolo public.ruolo_membro := app.ruolo_ristorante(p_ristorante_id); v_op jsonb; c public.controlli; v_id uuid;
  v_tipo text := coalesce(p_dati->>'tipo', 'controllo'); v_val numeric := app.num(p_dati->>'valore');
  v_esito text := nullif(p_dati->>'esito', ''); v_quando timestamptz := coalesce((p_dati->>'eseguita_il')::timestamptz, now());
  v_foto text := nullif(p_dati->>'foto_path', ''); v_rett public.registrazioni;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'cucina', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if p_persona_id is null and v_ruolo = 'cucina' then
    return jsonb_build_object('ok', false, 'motivo', 'Scegli chi sta registrando e inserisci il PIN');
  end if;
  if p_persona_id is not null then
    v_op := app.verifica_operatore(p_ristorante_id, p_persona_id, p_pin);
    if not (v_op->>'ok')::boolean then return v_op; end if;
  end if;
  if v_quando > now() + interval '5 minutes' then raise exception 'La data non può essere nel futuro' using errcode = '22023'; end if;
  if app.uuid_sicuro(p_dati->>'controllo_id') is not null then
    select * into c from public.controlli where id = app.uuid_sicuro(p_dati->>'controllo_id') and ristorante_id = p_ristorante_id and attivo;
    if not found then raise exception 'Controllo non valido' using errcode = '22023'; end if;
  end if;
  if app.uuid_sicuro(p_dati->>'rettifica_di') is not null then
    select * into v_rett from public.registrazioni where id = app.uuid_sicuro(p_dati->>'rettifica_di') and ristorante_id = p_ristorante_id;
    if not found then raise exception 'Registrazione da rettificare non trovata' using errcode = 'P0002'; end if;
    if coalesce(btrim(p_dati->>'nota'), '') = '' then raise exception 'Indica il motivo della rettifica' using errcode = '22023'; end if;
  end if;
  if v_foto is not null and (split_part(v_foto, '/', 1) <> p_ristorante_id::text
      or not exists (select 1 from storage.objects o where o.bucket_id = 'archivio' and o.name = v_foto)) then
    raise exception 'Foto non valida' using errcode = '22023';
  end if;
  -- Esito: dai limiti del controllo se c'è un valore misurato; altrimenti quello dichiarato.
  if v_val is not null and c.id is not null and (c.limite_min is not null or c.limite_max is not null) then
    v_esito := case when (c.limite_min is not null and v_val < c.limite_min) or (c.limite_max is not null and v_val > c.limite_max)
                    then 'non_conforme' else 'conforme' end;
  end if;
  if v_tipo = 'infestanti' and p_dati->>'presenza' in ('presenza', 'danneggiata') then v_esito := 'non_conforme'; end if;
  v_esito := coalesce(v_esito, 'conforme');
  if v_esito = 'non_conforme' and coalesce(btrim(p_dati->>'azione_correttiva'), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'Non conforme: indica l''azione correttiva', 'esito', v_esito,
      'suggerimento', c.azione_correttiva);
  end if;
  insert into public.registrazioni (ristorante_id, controllo_id, tipo, persona_id, utente_id, eseguita_il, esito, valore, unita, dati,
                                    azione_correttiva, nota, foto_path, usare_entro, rettifica_di)
  values (p_ristorante_id, c.id, v_tipo, p_persona_id, auth.uid(), v_quando, v_esito, v_val,
          coalesce(nullif(p_dati->>'unita', ''), c.unita), coalesce(p_dati->'dati', '{}'),
          nullif(btrim(p_dati->>'azione_correttiva'), ''), nullif(btrim(p_dati->>'nota'), ''), v_foto,
          nullif(p_dati->>'usare_entro', '')::date, v_rett.id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'esito', v_esito);
end $$;

-- Controlli del giorno: dovuto se la frequenza è a giorni e l'ultima registrazione è più vecchia del periodo.
create or replace function public.controlli_oggi(p_ristorante_id uuid)
returns table (controllo_id uuid, categoria text, titolo text, frequenza text, limite_testo text, limite_min numeric, limite_max numeric,
               unita text, azione_correttiva text, ubicazione_id uuid, ultima_il timestamptz, ultimo_esito text, dovuto boolean, giorni_ritardo int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.categoria, c.titolo, c.frequenza, c.limite_testo, c.limite_min, c.limite_max, c.unita, c.azione_correttiva, c.ubicazione_id,
         r.eseguita_il, r.esito,
         app.giorni_frequenza(c.frequenza) is not null
           and (r.eseguita_il is null or (r.eseguita_il at time zone 'Europe/Rome')::date <= (now() at time zone 'Europe/Rome')::date - app.giorni_frequenza(c.frequenza)),
         case when app.giorni_frequenza(c.frequenza) is not null and r.eseguita_il is not null
              then greatest(0, (now() at time zone 'Europe/Rome')::date - (r.eseguita_il at time zone 'Europe/Rome')::date - app.giorni_frequenza(c.frequenza)) end
    from public.controlli c
    left join lateral (select x.eseguita_il, x.esito from public.registrazioni x where x.controllo_id = c.id order by x.eseguita_il desc limit 1) r on true
   where c.ristorante_id = p_ristorante_id and c.attivo and c.gestione = 'interna' and app.vede_autocontrollo(p_ristorante_id)
   order by c.categoria, c.titolo
$$;

-- ── Formazione ─────────────────────────────────────────────────────────────
-- Regole regionali: le righe con gruppo_id NULL sono un punto di partenza "da verificare"
-- raccolto da fonti secondarie; il gruppo le conferma (copia verificata) con il testo dell'atto.
create table public.regole_formazione (
  id uuid primary key default gen_random_uuid(),
  gruppo_id uuid references public.gruppi(id) on delete cascade,
  regione text not null,
  codice text not null,
  nome text not null,
  destinatari text,
  ore_minime numeric, validita_anni int, aggiornamento_ore numeric,
  requisiti_docente text, argomenti text,
  atto text, fonte text,
  stato text not null default 'da_verificare' check (stato in ('da_verificare', 'verificata')),
  verificata_da uuid references auth.users(id) on delete set null, verificata_il timestamptz,
  nota text,
  creato_il timestamptz not null default now()
);
insert into public.regole_formazione (regione, codice, nome, destinatari, ore_minime, validita_anni, atto, fonte, nota) values
  ('Liguria', 'UF-A', 'Unità formativa A (base)', 'Tutti gli alimentaristi e gli OSA', 8, 5, 'DGR 793/2012, DGR 1654/2014, DGR 332/2015', 'Fonti secondarie (ASL 5 Liguria citata da enti formativi)', 'Ore di aggiornamento discordanti tra le fonti (4, 6 o non fissate): verificare sul testo della DGR.'),
  ('Liguria', 'OSA', 'Responsabile dell''autocontrollo (OSA)', 'Titolare o responsabile HACCP', 16, 5, 'DGR 793/2012 e successive', 'Fonti secondarie (enti formativi)', 'Verificare composizione dei moduli e requisiti dei docenti.'),
  ('Liguria', 'CEL', 'Modulo celiachia', 'Chi prepara alimenti senza glutine', 2, null, 'DGR 793/2012 e successive', 'Fonti secondarie (enti formativi)', null),
  ('Toscana', 'BASE', 'Moduli da 2, 4 o 8 ore secondo l''attività', 'Alimentaristi', null, null, 'DGR 540/2024', 'Fonti secondarie', 'Aggiornamento minimo 3 ore per alcune categorie.'),
  ('Sicilia', 'BASE', 'Corso alimentaristi', 'Tutti gli alimentaristi', 12, 3, 'D.A. 698/2022', 'Fonti secondarie', 'Aggiornamento almeno 6 ore ogni 3 anni.'),
  ('Umbria', 'TIT', 'Titolare o responsabile dell''autocontrollo', 'Titolare/responsabile', 12, 3, 'DGR 208/2021', 'Fonti secondarie', 'Aggiornamento triennale di almeno 6 ore secondo una fonte.'),
  ('Umbria', 'MAN', 'Addetti alla manipolazione', 'Manipolazione di alimenti', 10, 3, 'DGR 208/2021', 'Fonti secondarie', null),
  ('Calabria', 'A', 'Categoria A (rischio alto)', 'Attività a rischio alto', 8, 3, 'DGR 28/2012', 'Fonti secondarie', 'Aggiornamento 4 ore; possibili atti successivi.'),
  ('Calabria', 'B', 'Categoria B (rischio medio)', 'Attività a rischio medio', 6, 3, 'DGR 28/2012', 'Fonti secondarie', null),
  ('Lazio', 'ADD', 'Addetti alla manipolazione', 'Manipolazione', 6, null, 'DGR 825/2009', 'Fonti secondarie', 'Aggiornamento obbligatorio senza scadenza fissa.'),
  ('Lazio', 'RESP', 'Responsabili della procedura HACCP', 'Responsabili', 20, null, 'DGR 825/2009', 'Fonti secondarie', null),
  ('Piemonte', 'BASE', 'Corso base', 'Alimentaristi', 8, 3, 'Delibere 2001 e 2003', 'Fonti secondarie', 'Aggiornamento 4 ore.'),
  ('Lombardia', 'DL', 'Formazione a cura del datore di lavoro', 'Alimentaristi', null, 2, 'LR 33/2009', 'Fonti secondarie', 'Nessuna durata minima fissata secondo le fonti.'),
  ('Marche', 'BASE', 'Corso base', 'Alimentaristi', 10, 3, 'DGR 2173/2002, DGR 339/2006', 'Fonti secondarie', null),
  ('Abruzzo', 'BASE', 'Corso base (tipo 1)', 'Alimentaristi', 5, 3, 'DGR 463/2007', 'Fonti secondarie', 'Aggiornamento 4 o 8 ore secondo le fonti.'),
  ('Puglia', 'BASE', 'Corso operatori', 'Alimentaristi', null, 4, 'LR 22/2007', 'Fonti secondarie', null),
  ('Campania', 'AGG', 'Aggiornamento', 'Addetti / responsabili', null, 3, 'Decreto 2018', 'Fonti secondarie', '3 ore addetti, 6 ore responsabili.');

create table public.formazioni (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  persona_id uuid not null references public.persone(id) on delete restrict,
  regola_id uuid references public.regole_formazione(id) on delete set null,
  tipo text not null check (tipo in ('corso', 'aggiornamento', 'addestramento_interno')),
  titolo text not null, ente text, docente text, ore numeric check (ore is null or ore > 0),
  data date not null, scadenza date,
  archivio_id uuid references public.archivio(id) on delete set null,
  note text,
  creato_da uuid references auth.users(id) on delete set null, creato_il timestamptz not null default now()
);
create trigger formazioni_non_cancellabili before delete on public.formazioni for each row execute function app.immutabile();

create or replace function public.salva_regola_formazione(p_gruppo_id uuid, p_dati jsonb, p_da_regola uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; b public.regole_formazione;
begin
  perform app.richiedi(exists (select 1 from public.ristoranti r where r.gruppo_id = p_gruppo_id
           and app.ha_ruolo(r.id, array['titolare', 'consulente']::public.ruolo_membro[])));
  if p_da_regola is not null then select * into b from public.regole_formazione where id = p_da_regola and gruppo_id is null; end if;
  if (p_dati->>'verificata')::boolean and coalesce(btrim(p_dati->>'atto'), b.atto, '') = '' then
    raise exception 'Per confermare una regola indica l''atto di riferimento' using errcode = '22023';
  end if;
  insert into public.regole_formazione (gruppo_id, regione, codice, nome, destinatari, ore_minime, validita_anni, aggiornamento_ore,
         requisiti_docente, argomenti, atto, fonte, stato, verificata_da, verificata_il, nota)
  values (p_gruppo_id, coalesce(nullif(btrim(p_dati->>'regione'), ''), b.regione), coalesce(nullif(btrim(p_dati->>'codice'), ''), b.codice, 'MOD'),
          coalesce(nullif(btrim(p_dati->>'nome'), ''), b.nome), coalesce(nullif(btrim(p_dati->>'destinatari'), ''), b.destinatari),
          coalesce(app.num(p_dati->>'ore_minime'), b.ore_minime), coalesce(app.num(p_dati->>'validita_anni')::int, b.validita_anni),
          coalesce(app.num(p_dati->>'aggiornamento_ore'), b.aggiornamento_ore), coalesce(nullif(btrim(p_dati->>'requisiti_docente'), ''), b.requisiti_docente),
          coalesce(nullif(btrim(p_dati->>'argomenti'), ''), b.argomenti), coalesce(nullif(btrim(p_dati->>'atto'), ''), b.atto),
          coalesce(nullif(btrim(p_dati->>'fonte'), ''), b.fonte),
          case when (p_dati->>'verificata')::boolean then 'verificata' else 'da_verificare' end,
          case when (p_dati->>'verificata')::boolean then auth.uid() end, case when (p_dati->>'verificata')::boolean then now() end,
          coalesce(nullif(btrim(p_dati->>'nota'), ''), b.nota))
  returning id into v_id;
  if coalesce(btrim((select nome from public.regole_formazione where id = v_id)), '') = '' or (select regione from public.regole_formazione where id = v_id) is null then
    raise exception 'Indica regione e nome del modulo' using errcode = '22023';
  end if;
  return v_id;
end $$;

-- Registra un corso. La scadenza si calcola dalla regola solo se è stata verificata dal gruppo.
create or replace function public.registra_formazione(p_ristorante_id uuid, p_dati jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; g public.regole_formazione; v_data date := (p_dati->>'data')::date; v_scad date := nullif(p_dati->>'scadenza', '')::date;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if not exists (select 1 from public.persone p where p.id = app.uuid_sicuro(p_dati->>'persona_id') and p.ristorante_id = p_ristorante_id) then
    raise exception 'Persona non valida' using errcode = '22023';
  end if;
  if v_data is null or v_data > (now() at time zone 'Europe/Rome')::date then raise exception 'Data del corso non valida' using errcode = '22023'; end if;
  if app.uuid_sicuro(p_dati->>'regola_id') is not null then
    select * into g from public.regole_formazione where id = app.uuid_sicuro(p_dati->>'regola_id')
       and (gruppo_id is null or gruppo_id = app.gruppo_di(p_ristorante_id));
    if not found then raise exception 'Modulo non valido' using errcode = '22023'; end if;
    if v_scad is null and g.stato = 'verificata' and g.validita_anni is not null then v_scad := v_data + make_interval(years => g.validita_anni); end if;
  end if;
  if app.uuid_sicuro(p_dati->>'archivio_id') is not null and not exists (select 1 from public.archivio a where a.id = app.uuid_sicuro(p_dati->>'archivio_id') and a.ristorante_id = p_ristorante_id) then
    raise exception 'Attestato non valido' using errcode = '22023';
  end if;
  insert into public.formazioni (ristorante_id, persona_id, regola_id, tipo, titolo, ente, docente, ore, data, scadenza, archivio_id, note, creato_da)
  values (p_ristorante_id, app.uuid_sicuro(p_dati->>'persona_id'), g.id, coalesce(p_dati->>'tipo', 'corso'),
          coalesce(nullif(btrim(p_dati->>'titolo'), ''), g.nome, 'Formazione'), nullif(btrim(p_dati->>'ente'), ''), nullif(btrim(p_dati->>'docente'), ''),
          app.num(p_dati->>'ore'), v_data, v_scad, app.uuid_sicuro(p_dati->>'archivio_id'), nullif(btrim(p_dati->>'note'), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Firma annuale delle policy di igiene: PIN + tratto disegnato + impronta del documento firmato.
create table public.firme_policy (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  persona_id uuid not null references public.persone(id) on delete restrict,
  versione_id uuid not null references public.archivio_versioni(id) on delete restrict,
  sha256_documento text not null,
  firma_svg text check (firma_svg is null or length(firma_svg) <= 200000),
  firmata_il timestamptz not null default now(),
  valida_fino date not null,
  utente_id uuid references auth.users(id) on delete set null
);
create trigger firme_immutabili before update or delete on public.firme_policy for each row execute function app.immutabile();

create or replace function public.firma_policy(p_ristorante_id uuid, p_persona_id uuid, p_pin text, p_versione_id uuid, p_firma text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op jsonb; v public.archivio_versioni; v_id uuid;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'cucina']::public.ruolo_membro[], 'autocontrollo');
  select av.* into v from public.archivio_versioni av join public.archivio a on a.id = av.archivio_id
   where av.id = p_versione_id and av.ristorante_id = p_ristorante_id and a.categoria = 'policy_igiene';
  if not found then raise exception 'Documento di policy non trovato' using errcode = 'P0002'; end if;
  if coalesce(length(p_firma), 0) < 50 then return jsonb_build_object('ok', false, 'motivo', 'Traccia la firma nel riquadro'); end if;
  v_op := app.verifica_operatore(p_ristorante_id, p_persona_id, p_pin);
  if not (v_op->>'ok')::boolean then return v_op; end if;
  insert into public.firme_policy (ristorante_id, persona_id, versione_id, sha256_documento, firma_svg, valida_fino, utente_id)
  values (p_ristorante_id, p_persona_id, v.id, v.sha256, p_firma, (now() at time zone 'Europe/Rome')::date + interval '1 year', auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ── Infestanti ─────────────────────────────────────────────────────────────
create table public.trappole (
  id uuid primary key default gen_random_uuid(),
  ristorante_id uuid not null references public.ristoranti(id) on delete restrict,
  codice text not null,
  tipo text not null check (tipo in ('roditori', 'insetti_striscianti', 'insetti_volanti', 'altro')),
  posizione text,
  planimetria_id uuid references public.archivio(id) on delete set null,
  x numeric check (x between 0 and 100), y numeric check (y between 0 and 100),
  gestita_da text not null default 'interna' check (gestita_da in ('interna', 'esterna')),
  attiva boolean not null default true,
  creato_il timestamptz not null default now(),
  unique (ristorante_id, codice)
);
create trigger trappole_non_cancellabili before delete on public.trappole for each row execute function app.immutabile();

create or replace function public.salva_trappola(p_ristorante_id uuid, p_dati jsonb, p_trappola_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_trappola_id;
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  if v_id is null then
    insert into public.trappole (ristorante_id, codice, tipo) values (p_ristorante_id, btrim(p_dati->>'codice'), p_dati->>'tipo') returning id into v_id;
  elsif not exists (select 1 from public.trappole where id = v_id and ristorante_id = p_ristorante_id) then
    raise exception 'Trappola non trovata' using errcode = 'P0002';
  end if;
  if app.uuid_sicuro(p_dati->>'planimetria_id') is not null and not exists (select 1 from public.archivio a where a.id = app.uuid_sicuro(p_dati->>'planimetria_id') and a.ristorante_id = p_ristorante_id) then
    raise exception 'Planimetria non valida' using errcode = '22023';
  end if;
  update public.trappole set
    codice = coalesce(nullif(btrim(p_dati->>'codice'), ''), codice), tipo = coalesce(nullif(p_dati->>'tipo', ''), tipo),
    posizione = case when p_dati ? 'posizione' then nullif(btrim(p_dati->>'posizione'), '') else posizione end,
    planimetria_id = case when p_dati ? 'planimetria_id' then app.uuid_sicuro(p_dati->>'planimetria_id') else planimetria_id end,
    x = case when p_dati ? 'x' then app.num(p_dati->>'x') else x end, y = case when p_dati ? 'y' then app.num(p_dati->>'y') else y end,
    gestita_da = coalesce(nullif(p_dati->>'gestita_da', ''), gestita_da),
    attiva = case when p_dati ? 'attiva' then (p_dati->>'attiva')::boolean else attiva end
  where id = v_id;
  return v_id;
end $$;

create or replace function public.imposta_sede_autocontrollo(p_ristorante_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.richiedi_op(p_ristorante_id, array['titolare', 'consulente']::public.ruolo_membro[], 'autocontrollo');
  update public.ristoranti set
    regione = case when p_dati ? 'regione' then nullif(btrim(p_dati->>'regione'), '') else regione end,
    gestione_infestanti = case when p_dati ? 'gestione_infestanti' then nullif(p_dati->>'gestione_infestanti', '') else gestione_infestanti end
  where id = p_ristorante_id;
end $$;

-- ── Allergeni, schede prodotto, etichette ──────────────────────────────────
-- I 14 allergeni come da tabella fornita dal consulente (Reg. UE 1169/2011, allegato II).
create table public.allergeni (codice text primary key, nome text not null, esempi text, ordine int not null);
insert into public.allergeni values
  ('glutine', 'Cereali contenenti glutine', 'Grano, segale, orzo, avena, farro, kamut, inclusi ibridati derivati', 1),
  ('crostacei', 'Crostacei', 'Marini e d''acqua dolce: gamberi, scampi, aragoste, granchi e simili', 2),
  ('uova', 'Uova', 'Uova e prodotti che le contengono: maionese, emulsionanti, pasta all''uovo', 3),
  ('pesce', 'Pesce', 'Prodotti alimentari in cui è presente il pesce, anche in piccole percentuali', 4),
  ('arachidi', 'Arachidi', 'Snack confezionati, creme e condimenti in cui vi sia anche in piccole dosi', 5),
  ('soia', 'Soia', 'Latte di soia, tofu, spaghetti di soia e simili', 6),
  ('latte', 'Latte', 'Ogni prodotto in cui viene usato il latte: yogurt, biscotti, torte, gelato, creme', 7),
  ('frutta_guscio', 'Frutta a guscio', 'Mandorle, nocciole, noci comuni, noci di acagiù, noci pecan, anacardi, pistacchi', 8),
  ('sedano', 'Sedano', 'In pezzi o in preparati per zuppe, salse e concentrati vegetali', 9),
  ('senape', 'Senape', 'Salse e condimenti, specie nella mostarda', 10),
  ('sesamo', 'Semi di sesamo', 'Semi interi per il pane, farine che lo contengono anche in minima percentuale', 11),
  ('solfiti', 'Anidride solforosa e solfiti', 'Cibi sott''aceto, sott''olio e in salamoia, marmellate, funghi secchi, conserve', 12),
  ('lupini', 'Lupini', 'Cibi vegan: arrosti, salamini, farine e simili', 13),
  ('molluschi', 'Molluschi', 'Canestrello, cannolicchio, capasanta, cozza, ostrica, patella, vongola, tellina', 14);

create table public.info_prodotti (
  master_id uuid primary key references public.articoli_master(id) on delete cascade,
  gruppo_id uuid not null references public.gruppi(id) on delete cascade,
  ingredienti text,                          -- elenco ingredienti come da scheda tecnica
  allergeni text[] not null default '{}',
  tracce text[] not null default '{}',       -- "può contenere tracce di"
  energia_kj numeric, energia_kcal numeric, grassi numeric, grassi_saturi numeric, carboidrati numeric,
  zuccheri numeric, proteine numeric, sale numeric,   -- per 100 g
  fonte text not null check (fonte in ('scheda_tecnica', 'etichetta', 'manuale')),
  archivio_id uuid references public.archivio(id) on delete set null,
  aggiornato_da uuid references auth.users(id) on delete set null, aggiornato_il timestamptz not null default now()
);

create or replace function public.salva_info_prodotto(p_master_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.articoli_master; v_all text[]; v_tr text[]; k text;
begin
  select * into m from public.articoli_master where id = p_master_id;
  perform app.richiedi(found and exists (select 1 from public.ristoranti r where r.gruppo_id = m.gruppo_id
           and app.ha_ruolo(r.id, array['titolare', 'chef', 'consulente']::public.ruolo_membro[])));
  v_all := coalesce(array(select jsonb_array_elements_text(p_dati->'allergeni')), '{}');
  v_tr := coalesce(array(select jsonb_array_elements_text(p_dati->'tracce')), '{}');
  foreach k in array v_all || v_tr loop
    if not exists (select 1 from public.allergeni a where a.codice = k) then raise exception 'Allergene sconosciuto: %', k using errcode = '22023'; end if;
  end loop;
  if coalesce(p_dati->>'fonte', '') not in ('scheda_tecnica', 'etichetta', 'manuale') then raise exception 'Indica la fonte dei dati' using errcode = '22023'; end if;
  insert into public.info_prodotti (master_id, gruppo_id, ingredienti, allergeni, tracce, energia_kj, energia_kcal, grassi, grassi_saturi,
         carboidrati, zuccheri, proteine, sale, fonte, archivio_id, aggiornato_da, aggiornato_il)
  values (m.id, m.gruppo_id, nullif(btrim(p_dati->>'ingredienti'), ''), v_all, array(select distinct x from unnest(v_tr) x where x <> all (v_all)),
          app.num(p_dati->>'energia_kj'), app.num(p_dati->>'energia_kcal'), app.num(p_dati->>'grassi'), app.num(p_dati->>'grassi_saturi'),
          app.num(p_dati->>'carboidrati'), app.num(p_dati->>'zuccheri'), app.num(p_dati->>'proteine'), app.num(p_dati->>'sale'),
          p_dati->>'fonte', app.uuid_sicuro(p_dati->>'archivio_id'), auth.uid(), now())
  on conflict (master_id) do update set ingredienti = excluded.ingredienti, allergeni = excluded.allergeni, tracce = excluded.tracce,
    energia_kj = excluded.energia_kj, energia_kcal = excluded.energia_kcal, grassi = excluded.grassi, grassi_saturi = excluded.grassi_saturi,
    carboidrati = excluded.carboidrati, zuccheri = excluded.zuccheri, proteine = excluded.proteine, sale = excluded.sale,
    fonte = excluded.fonte, archivio_id = excluded.archivio_id, aggiornato_da = excluded.aggiornato_da, aggiornato_il = now();
end $$;

-- Dati di etichetta della ricetta (per i prodotti preconfezionati o da asporto).
alter table public.ricette add column denominazione text, add column conservazione text, add column modalita_uso text,
  add column imballaggio text, add column smaltimento text, add column tracce_aggiuntive text[] not null default '{}',
  add column peso_netto_g numeric check (peso_netto_g is null or peso_netto_g > 0), add column durata_giorni int check (durata_giorni is null or durata_giorni > 0);

create or replace function public.salva_dati_etichetta(p_ricetta_id uuid, p_dati jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.ricette; k text; v_tr text[];
begin
  select * into r from public.ricette where id = p_ricetta_id;
  perform app.richiedi(found);
  perform app.richiedi_op(r.ristorante_id, array['titolare', 'chef']::public.ruolo_membro[], 'ricette');
  v_tr := coalesce(array(select jsonb_array_elements_text(p_dati->'tracce_aggiuntive')), '{}');
  foreach k in array v_tr loop
    if not exists (select 1 from public.allergeni a where a.codice = k) then raise exception 'Allergene sconosciuto: %', k using errcode = '22023'; end if;
  end loop;
  update public.ricette set denominazione = nullif(btrim(p_dati->>'denominazione'), ''), conservazione = nullif(btrim(p_dati->>'conservazione'), ''),
    modalita_uso = nullif(btrim(p_dati->>'modalita_uso'), ''), imballaggio = nullif(btrim(p_dati->>'imballaggio'), ''),
    smaltimento = nullif(btrim(p_dati->>'smaltimento'), ''), tracce_aggiuntive = v_tr,
    peso_netto_g = app.num(p_dati->>'peso_netto_g'), durata_giorni = app.num(p_dati->>'durata_giorni')::int
  where id = r.id;
end $$;

-- Composizione in grammi di una versione, con i semilavorati espansi in proporzione.
-- grammi NULL = quantità non convertibile in peso (serve una conversione dichiarata).
create or replace function app.composizione(p_versione_id uuid, p_fattore numeric default 1, p_prof int default 0)
returns table (master_id uuid, grammi numeric, quid_di text)
language plpgsql stable security definer set search_path = '' as $$
declare i record; s public.ricette_versioni; v_lordo numeric; v_kg numeric; v_resa_kg numeric;
begin
  for i in select x.*, r.nome as sotto_nome from public.ricette_ingredienti x left join public.ricette r on r.id = x.sotto_ricetta_id
            where x.versione_id = p_versione_id loop
    v_lordo := case when i.quantita_tipo = 'netta' and i.resa_pct is not null then i.quantita / (i.resa_pct / 100) else i.quantita end;
    if i.master_id is not null then
      master_id := i.master_id; grammi := app.converti(i.master_id, v_lordo * p_fattore, i.unita, 'kg') * 1000; quid_di := null;
      return next;
    elsif p_prof < 4 then
      select * into s from public.ricette_versioni x where x.ricetta_id = i.sotto_ricetta_id and x.stato = 'attiva';
      if not found then continue; end if;
      v_kg := case when (app.um(i.unita)).base = 'kg' then v_lordo * (app.um(i.unita)).fattore end;
      v_resa_kg := case when (app.um(s.resa_unita)).base = 'kg' then s.resa_quantita * (app.um(s.resa_unita)).fattore end;
      return query select c.master_id, case when v_kg is not null and v_resa_kg > 0 then c.grammi else null end, i.sotto_nome
        from app.composizione(s.id, p_fattore * coalesce(v_kg / nullif(v_resa_kg, 0), 0), p_prof + 1) c;
    end if;
  end loop;
end $$;

-- Etichetta di una ricetta: ingredienti in ordine di peso decrescente (QUID), allergeni, tracce,
-- tabella nutrizionale per 100 g (somma pesata delle schede degli ingredienti, senza perdite di cottura).
create or replace function public.etichetta_ricetta(p_ricetta_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.ricette; v public.ricette_versioni; v_tot numeric; v_ing jsonb; v_all text[]; v_tr text[]; v_manc jsonb; v_nut jsonb;
begin
  select * into r from public.ricette where id = p_ricetta_id;
  perform app.richiedi(found and (app.ha_accesso_ristorante(r.ristorante_id) or app.vede_autocontrollo(r.ristorante_id)));
  select * into v from public.ricette_versioni where ricetta_id = r.id and stato = 'attiva';
  if not found then return null; end if;
  create temp table if not exists _comp (master_id uuid, grammi numeric, quid_di text) on commit drop;
  delete from _comp;
  insert into _comp select * from app.composizione(v.id);
  select sum(grammi) into v_tot from _comp;
  select coalesce(jsonb_agg(jsonb_build_object('master_id', x.master_id, 'nome', m.nome, 'ingredienti', ip.ingredienti, 'grammi', round(x.g, 1),
           'percentuale', case when v_tot > 0 and x.g is not null then round(x.g / v_tot * 100, 1) end, 'allergeni', coalesce(ip.allergeni, '{}'))
           order by x.g desc nulls last), '[]')
    into v_ing
    from (select c.master_id, sum(c.grammi) as g from _comp c group by c.master_id) x
    join public.articoli_master m on m.id = x.master_id left join public.info_prodotti ip on ip.master_id = x.master_id;
  select coalesce(array_agg(distinct a), '{}') into v_all from _comp c join public.info_prodotti ip on ip.master_id = c.master_id, unnest(ip.allergeni) a;
  select coalesce(array_agg(distinct a), '{}') into v_tr from (
    select unnest(ip.tracce) a from _comp c join public.info_prodotti ip on ip.master_id = c.master_id union select unnest(r.tracce_aggiuntive)) t
   where a <> all (v_all);
  select coalesce(jsonb_agg(distinct jsonb_build_object('nome', m.nome, 'motivo',
           case when ip.master_id is null then 'scheda prodotto mancante (allergeni e valori)'
                when c.grammi is null then 'quantità non convertibile in peso'
                else 'valori nutrizionali mancanti' end)), '[]')
    into v_manc
    from _comp c join public.articoli_master m on m.id = c.master_id left join public.info_prodotti ip on ip.master_id = c.master_id
   where ip.master_id is null or c.grammi is null or ip.energia_kcal is null or ip.grassi is null or ip.carboidrati is null or ip.proteine is null or ip.sale is null;
  if jsonb_array_length(v_manc) = 0 and v_tot > 0 then
    select jsonb_build_object(
      'energia_kj', round(sum(c.grammi * ip.energia_kj) / v_tot), 'energia_kcal', round(sum(c.grammi * ip.energia_kcal) / v_tot),
      'grassi', round(sum(c.grammi * ip.grassi) / v_tot, 1), 'grassi_saturi', round(sum(c.grammi * ip.grassi_saturi) / v_tot, 1),
      'carboidrati', round(sum(c.grammi * ip.carboidrati) / v_tot, 1), 'zuccheri', round(sum(c.grammi * ip.zuccheri) / v_tot, 1),
      'proteine', round(sum(c.grammi * ip.proteine) / v_tot, 1), 'sale', round(sum(c.grammi * ip.sale) / v_tot, 2))
      into v_nut from _comp c join public.info_prodotti ip on ip.master_id = c.master_id;
  end if;
  return jsonb_build_object('ricetta', r.nome, 'denominazione', coalesce(r.denominazione, r.nome), 'versione', v.versione,
    'peso_ricetta_g', round(v_tot, 1), 'peso_netto_g', r.peso_netto_g, 'conservazione', r.conservazione, 'modalita_uso', r.modalita_uso,
    'imballaggio', r.imballaggio, 'smaltimento', r.smaltimento, 'durata_giorni', r.durata_giorni,
    'ingredienti', v_ing, 'allergeni', to_jsonb(v_all), 'tracce', to_jsonb(v_tr),
    'nutrizionali', v_nut, 'mancanti', v_manc, 'completa', jsonb_array_length(v_manc) = 0,
    'nota', 'Valori calcolati dalle schede degli ingredienti crudi, senza perdite di cottura. Da verificare prima della stampa.');
end $$;

-- Matrice allergeni dei piatti: solo nomi e allergeni, nessun dato economico (visibile anche a cucina e consulente).
create or replace function public.matrice_allergeni(p_ristorante_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.richiedi(app.ha_accesso_ristorante(p_ristorante_id) or app.vede_autocontrollo(p_ristorante_id));
  return (select coalesce(jsonb_agg(jsonb_build_object('ricetta_id', r.id, 'nome', r.nome, 'categoria', r.categoria, 'tipo', r.tipo,
            'allergeni', coalesce(x.allergeni, '[]'), 'tracce', coalesce(x.tracce, '[]'), 'mancanti', coalesce(x.mancanti, '[]')) order by r.tipo, r.nome), '[]')
    from public.ricette r
    join public.ricette_versioni v on v.ricetta_id = r.id and v.stato = 'attiva'
    left join lateral (
      select (select coalesce(jsonb_agg(distinct a), '[]') from app.composizione(v.id) c join public.info_prodotti ip on ip.master_id = c.master_id, unnest(ip.allergeni) a) as allergeni,
             (select coalesce(jsonb_agg(distinct a), '[]') from (select unnest(ip.tracce) a from app.composizione(v.id) c join public.info_prodotti ip on ip.master_id = c.master_id
                       union select unnest(r.tracce_aggiuntive)) t) as tracce,
             (select coalesce(jsonb_agg(distinct m.nome), '[]') from app.composizione(v.id) c join public.articoli_master m on m.id = c.master_id
               left join public.info_prodotti ip on ip.master_id = c.master_id where ip.master_id is null) as mancanti) x on true
   where r.ristorante_id = p_ristorante_id and r.attiva);
end $$;

-- ── Scadenzario esteso ─────────────────────────────────────────────────────
create or replace view public.v_scadenzario with (security_invoker = true) as
select a.ristorante_id, 'documento'::text as origine, a.id as riferimento_id, a.titolo, a.categoria as dettaglio,
       a.scadenza as data_scadenza, a.scadenza - (now() at time zone 'Europe/Rome')::date as giorni,
       case when a.scadenza < (now() at time zone 'Europe/Rome')::date then 'scaduta'
            when a.scadenza <= (now() at time zone 'Europe/Rome')::date + 30 then 'in_scadenza' else 'in_regola' end as stato
  from public.archivio a where a.scadenza is not null and not a.archiviato
union all
select m.ristorante_id, 'manutenzione', m.attrezzatura_id, m.attrezzatura || ' · ' || m.titolo, m.obbligo,
       m.prossima_data, m.giorni_mancanti,
       case when m.stato_scadenza = 'contatore_non_rilevato' then 'in_regola' else m.stato_scadenza end
  from public.v_scadenze_manutenzione m
union all
-- Ultima formazione di ciascuna persona per modulo
select f.ristorante_id, 'formazione', f.persona_id, p.nome || ' · ' || f.titolo, f.tipo, f.scadenza,
       f.scadenza - (now() at time zone 'Europe/Rome')::date,
       case when f.scadenza < (now() at time zone 'Europe/Rome')::date then 'scaduta'
            when f.scadenza <= (now() at time zone 'Europe/Rome')::date + 60 then 'in_scadenza' else 'in_regola' end
  from (select distinct on (x.persona_id, coalesce(x.regola_id::text, x.titolo)) x.* from public.formazioni x order by x.persona_id, coalesce(x.regola_id::text, x.titolo), x.data desc) f
  join public.persone p on p.id = f.persona_id and p.attiva
 where f.scadenza is not null
union all
-- Firma annuale delle policy per ogni persona attiva (se esiste almeno una policy archiviata)
select p.ristorante_id, 'firma_policy', p.id, p.nome || ' · firma policy di igiene', null,
       coalesce(fp.valida_fino, (now() at time zone 'Europe/Rome')::date), coalesce(fp.valida_fino, (now() at time zone 'Europe/Rome')::date) - (now() at time zone 'Europe/Rome')::date,
       case when fp.valida_fino is null or fp.valida_fino < (now() at time zone 'Europe/Rome')::date then 'scaduta'
            when fp.valida_fino <= (now() at time zone 'Europe/Rome')::date + 30 then 'in_scadenza' else 'in_regola' end
  from public.persone p
  left join lateral (select max(x.valida_fino) as valida_fino from public.firme_policy x where x.persona_id = p.id) fp on true
 where p.attiva and exists (select 1 from public.archivio a where a.ristorante_id = p.ristorante_id and a.categoria = 'policy_igiene' and not a.archiviato)
union all
-- Controlli periodici (analisi, infestanti, ecc.) con frequenza di almeno un mese
select c.ristorante_id, 'controllo', c.id, c.titolo, c.categoria,
       coalesce((r.ultima at time zone 'Europe/Rome')::date + app.giorni_frequenza(c.frequenza), (now() at time zone 'Europe/Rome')::date),
       coalesce((r.ultima at time zone 'Europe/Rome')::date + app.giorni_frequenza(c.frequenza), (now() at time zone 'Europe/Rome')::date) - (now() at time zone 'Europe/Rome')::date,
       case when r.ultima is null or (r.ultima at time zone 'Europe/Rome')::date + app.giorni_frequenza(c.frequenza) < (now() at time zone 'Europe/Rome')::date then 'scaduta'
            when (r.ultima at time zone 'Europe/Rome')::date + app.giorni_frequenza(c.frequenza) <= (now() at time zone 'Europe/Rome')::date + 30 then 'in_scadenza' else 'in_regola' end
  from public.controlli c
  left join lateral (select max(x.eseguita_il) as ultima from public.registrazioni x where x.controllo_id = c.id) r on true
 where c.attivo and app.giorni_frequenza(c.frequenza) >= 30;

-- ── RLS, audit, privilegi ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['controlli', 'estrazioni', 'proposte_estrazione', 'registrazioni', 'formazioni', 'firme_policy', 'trappole'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "%s: lettura autocontrollo" on public.%I for select to authenticated using (app.vede_autocontrollo(ristorante_id))', t, t);
  end loop;
  foreach t in array array['controlli', 'proposte_estrazione', 'formazioni', 'trappole'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function app.audit_trigger()', t);
  end loop;
end $$;
alter table public.regole_formazione enable row level security;
alter table public.allergeni enable row level security;
alter table public.info_prodotti enable row level security;
revoke all on public.regole_formazione, public.allergeni, public.info_prodotti from public, anon, authenticated;
grant select on public.regole_formazione, public.allergeni, public.info_prodotti to authenticated;
create policy "regole_formazione: riferimento o gruppo" on public.regole_formazione for select to authenticated
  using (gruppo_id is null or app.vede_autocontrollo_gruppo(gruppo_id));
create policy "allergeni: lettura" on public.allergeni for select to authenticated using (true);
create policy "info_prodotti: lettura" on public.info_prodotti for select to authenticated
  using (app.ha_accesso_gruppo(gruppo_id) or app.vede_autocontrollo_gruppo(gruppo_id));
create trigger audit after insert or update or delete on public.regole_formazione for each row execute function app.audit_trigger();
create trigger audit after insert or update or delete on public.info_prodotti for each row execute function app.audit_trigger();
revoke all on public.v_scadenzario from anon, authenticated;
grant select on public.v_scadenzario to authenticated;

revoke all on function public.salva_controllo(uuid, jsonb, uuid), public.valuta_albero(uuid, jsonb), public.avvia_estrazione(uuid),
  public.registra_proposte(uuid, jsonb), public.segna_errore_estrazione(uuid, text), public.decidi_proposta(uuid, text, jsonb, text),
  public.registra(uuid, uuid, text, jsonb), public.controlli_oggi(uuid), public.salva_regola_formazione(uuid, jsonb, uuid),
  public.registra_formazione(uuid, jsonb), public.firma_policy(uuid, uuid, text, uuid, text), public.salva_trappola(uuid, jsonb, uuid),
  public.imposta_sede_autocontrollo(uuid, jsonb), public.salva_info_prodotto(uuid, jsonb), public.salva_dati_etichetta(uuid, jsonb),
  public.etichetta_ricetta(uuid), public.matrice_allergeni(uuid)
  from public, anon, authenticated;
grant execute on function public.salva_controllo(uuid, jsonb, uuid), public.valuta_albero(uuid, jsonb), public.avvia_estrazione(uuid),
  public.decidi_proposta(uuid, text, jsonb, text), public.registra(uuid, uuid, text, jsonb), public.controlli_oggi(uuid),
  public.salva_regola_formazione(uuid, jsonb, uuid), public.registra_formazione(uuid, jsonb), public.firma_policy(uuid, uuid, text, uuid, text),
  public.salva_trappola(uuid, jsonb, uuid), public.imposta_sede_autocontrollo(uuid, jsonb), public.salva_info_prodotto(uuid, jsonb),
  public.salva_dati_etichetta(uuid, jsonb), public.etichetta_ricetta(uuid), public.matrice_allergeni(uuid)
  to authenticated;
grant execute on function public.registra_proposte(uuid, jsonb), public.segna_errore_estrazione(uuid, text) to service_role;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on all functions in schema app to service_role;
grant execute on function app.uuid_sicuro(text), app.ruolo_ristorante(uuid), app.ha_accesso_ristorante(uuid),
  app.ha_ruolo(uuid, public.ruolo_membro[]), app.ha_accesso_gruppo(uuid), app.ha_ruolo_gruppo(uuid, public.ruolo_membro[]),
  app.converti(uuid, numeric, text, text), app.membro_ristorante(uuid), app.membro_gruppo(uuid),
  app.vede_autocontrollo(uuid), app.vede_autocontrollo_gruppo(uuid), app.giorni_frequenza(text) to authenticated;
