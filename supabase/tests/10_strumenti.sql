-- Strumenti di test: raccolta degli esiti e utilità per impersonare i ruoli.
create schema t;
create table t.esiti (id serial, area text, nome text, ok boolean, dettaglio text);
grant usage on schema t to public; grant all on t.esiti, t.esiti_id_seq to public;

create function t.ok(p_area text, p_nome text, p_ok boolean, p_dettaglio text default null) returns void
language sql as $$ insert into t.esiti (area, nome, ok, dettaglio) values (p_area, p_nome, coalesce(p_ok, false), p_dettaglio) $$;

create function t.uguale(p_area text, p_nome text, p_ottenuto anyelement, p_atteso anyelement) returns void
language sql as $$ select t.ok(p_area, p_nome, p_ottenuto is not distinct from p_atteso,
  'ottenuto ' || coalesce(p_ottenuto::text, 'null') || ', atteso ' || coalesce(p_atteso::text, 'null')) $$;

-- L'istruzione deve fallire (permesso negato, validazione…). Eseguita con il ruolo corrente.
create function t.rifiuta(p_area text, p_nome text, p_sql text, p_contiene text default null) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform t.ok(p_area, p_nome, p_contiene is null or sqlerrm ilike '%' || p_contiene || '%', sqlerrm);
    return;
  end;
  perform t.ok(p_area, p_nome, false, 'l''istruzione è stata accettata');
end $$;

create function t.accetta(p_area text, p_nome text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  perform t.ok(p_area, p_nome, true);
exception when others then
  perform t.ok(p_area, p_nome, false, sqlerrm);
end $$;

-- Registra un documento già estratto (come farebbe n8n) e lo completa. Solo per i test di calcolo.
create function t.documento(p_ristorante uuid, p_payload jsonb) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.documenti (id, ristorante_id, stato, fase, sha256, nome_file, mime, file_path)
  values (v_id, p_ristorante, 'elaborazione', 'estrazione', encode(sha256(v_id::text::bytea), 'hex'), 'test.pdf',
          'application/pdf', p_ristorante || '/' || v_id || '.pdf');
  perform public.registra_documento(v_id, p_payload);
  perform public.completa_documento(v_id);
  return v_id;
end $$;

-- Fattura di una sola riga: il caso più comune nei test di calcolo.
create function t.fattura(p_ristorante uuid, p_numero text, p_data date, p_riga jsonb,
                          p_valuta text default 'EUR', p_tipo text default 'Fattura', p_fornitore text default 'Fornitore Uno')
returns uuid language sql as $$
  select t.documento(p_ristorante, jsonb_build_object(
    'documento', jsonb_build_object('tipo', p_tipo, 'numero_documento', p_numero, 'data_documento', p_data, 'codice_valuta', p_valuta),
    'fornitore', jsonb_build_object('ragione_sociale', p_fornitore, 'paese', 'IT'),
    'totali', jsonb_build_object('imponibile', (p_riga->>'totale_riga')::numeric, 'totale_documento', (p_riga->>'totale_riga')::numeric),
    'articoli', jsonb_build_array(p_riga)))
$$;

create function t.riga(p_documento uuid, p_n int default 1) returns public.storico_prezzi
language sql as $$ select s from public.storico_prezzi s where s.documento_id = p_documento and s.numero_riga = p_n $$;
