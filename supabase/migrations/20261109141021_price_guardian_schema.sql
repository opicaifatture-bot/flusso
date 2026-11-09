-- Price Guardian: schema, RLS, ingestion RPC and storage bucket
-- Applied to project zbvmkrgxwwjritdarvzh on 2026-11-09

create extension if not exists pgcrypto;

create table public.fornitori (
  id uuid primary key default gen_random_uuid(),
  ragione_sociale text not null,
  partita_iva_o_estera text,
  paese text,
  codice_identificativo_estero text,
  chiave text not null unique, -- normalized P.IVA or name
  created_at timestamptz not null default now()
);

create table public.documenti (
  id uuid primary key default gen_random_uuid(),
  fornitore_id uuid not null references public.fornitori(id) on delete restrict,
  tipo text not null check (tipo in ('Fattura','DDT','Nota di Credito','Altro')),
  numero text,
  data_documento date,
  imponibile numeric(14,2),
  iva numeric(14,2),
  totale numeric(14,2),
  valuta text not null default 'EUR',
  cliente_ragione_sociale text,
  cliente_partita_iva text,
  file_url text,
  stato text not null default 'elaborato',
  n_anomalie int not null default 0,
  dati_estratti jsonb,
  created_at timestamptz not null default now()
);
create unique index documenti_univoco on public.documenti
  (fornitore_id, tipo, coalesce(numero,''), coalesce(data_documento,'1900-01-01'::date));

create table public.articoli (
  id uuid primary key default gen_random_uuid(),
  fornitore_id uuid not null references public.fornitori(id) on delete cascade,
  codice_articolo text,
  descrizione_originale text,
  descrizione_normalizzata text not null,
  unita_misura text,
  chiave text not null, -- codice or normalized description
  created_at timestamptz not null default now(),
  unique (fornitore_id, chiave)
);

create table public.storico_prezzi (
  id uuid primary key default gen_random_uuid(),
  articolo_id uuid not null references public.articoli(id) on delete cascade,
  documento_id uuid not null references public.documenti(id) on delete cascade,
  quantita numeric(14,3),
  unita_misura text,
  prezzo_unitario numeric(14,4) not null,
  sconto_percentuale numeric(6,2),
  totale_riga numeric(14,2),
  aliquota_iva numeric(5,2),
  valuta text not null default 'EUR',
  prezzo_precedente numeric(14,4),
  variazione_pct numeric(8,2),
  anomalia_prezzo boolean not null default false,
  data_rilevazione timestamptz not null default now()
);
create index on public.storico_prezzi (articolo_id, data_rilevazione desc);
create index on public.storico_prezzi (documento_id);
create index on public.documenti (fornitore_id);
create index on public.documenti (created_at desc);

-- RLS: authenticated users read; writes only via service role / RPC
alter table public.fornitori enable row level security;
alter table public.documenti enable row level security;
alter table public.articoli enable row level security;
alter table public.storico_prezzi enable row level security;
create policy "lettura autenticati" on public.fornitori for select to authenticated using (true);
create policy "lettura autenticati" on public.documenti for select to authenticated using (true);
create policy "lettura autenticati" on public.articoli for select to authenticated using (true);
create policy "lettura autenticati" on public.storico_prezzi for select to authenticated using (true);

create or replace view public.v_anomalie with (security_invoker = true) as
select sp.*, a.descrizione_normalizzata, a.codice_articolo, d.numero, d.data_documento,
       d.tipo, f.ragione_sociale
from public.storico_prezzi sp
join public.articoli a on a.id = sp.articolo_id
join public.documenti d on d.id = sp.documento_id
join public.fornitori f on f.id = d.fornitore_id
where sp.anomalia_prezzo;

-- Main ingestion RPC: one transaction, idempotent on re-sent documents
create or replace function public.registra_documento(
  payload jsonb, p_file_url text default null, p_soglia numeric default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc jsonb := payload->'documento';
  v_forn jsonb := payload->'fornitore';
  v_tot jsonb := payload->'totali';
  v_valuta text := upper(coalesce(v_doc->>'codice_valuta', v_tot->>'valuta', 'EUR'));
  v_chiave_f text;
  v_fid uuid; v_did uuid; v_aid uuid;
  v_riga jsonb; v_chiave_a text; v_desc text;
  v_prezzo numeric; v_prec numeric; v_var numeric; v_anom boolean;
  v_n int := 0; v_out jsonb := '[]'::jsonb;
begin
  if v_forn is null or coalesce(v_forn->>'ragione_sociale','') = '' then
    raise exception 'fornitore.ragione_sociale mancante';
  end if;
  v_chiave_f := lower(regexp_replace(coalesce(nullif(v_forn->>'partita_iva_o_estera',''),
                     v_forn->>'ragione_sociale'), '[^A-Za-z0-9]', '', 'g'));

  insert into fornitori (ragione_sociale, partita_iva_o_estera, paese, codice_identificativo_estero, chiave)
  values (v_forn->>'ragione_sociale', nullif(v_forn->>'partita_iva_o_estera',''),
          upper(nullif(v_forn->>'paese','')), nullif(v_forn->>'codice_identificativo_estero',''), v_chiave_f)
  on conflict (chiave) do update set
    ragione_sociale = excluded.ragione_sociale,
    paese = coalesce(excluded.paese, fornitori.paese),
    codice_identificativo_estero = coalesce(excluded.codice_identificativo_estero, fornitori.codice_identificativo_estero)
  returning id into v_fid;

  -- re-sent document: replace it (and its price rows)
  delete from documenti d where d.fornitore_id = v_fid
    and d.tipo = coalesce(v_doc->>'tipo','Altro')
    and coalesce(d.numero,'') = coalesce(v_doc->>'numero_documento','')
    and coalesce(d.data_documento,'1900-01-01') = coalesce((v_doc->>'data_documento')::date,'1900-01-01');

  insert into documenti (fornitore_id, tipo, numero, data_documento, imponibile, iva, totale, valuta,
                         cliente_ragione_sociale, cliente_partita_iva, file_url, dati_estratti)
  values (v_fid, coalesce(v_doc->>'tipo','Altro'), v_doc->>'numero_documento',
          (v_doc->>'data_documento')::date, (v_tot->>'imponibile')::numeric, (v_tot->>'iva')::numeric,
          (v_tot->>'totale_documento')::numeric, v_valuta,
          payload->'cliente'->>'ragione_sociale', payload->'cliente'->>'partita_iva', p_file_url, payload)
  returning id into v_did;

  for v_riga in select * from jsonb_array_elements(coalesce(payload->'articoli','[]'::jsonb)) loop
    v_desc := coalesce(nullif(v_riga->>'descrizione_articolo',''), v_riga->>'descrizione_originale');
    continue when v_desc is null or v_riga->>'prezzo_unitario' is null;
    v_chiave_a := lower(coalesce(nullif(v_riga->>'codice_articolo_fornitore',''),
                   regexp_replace(v_desc, '\s+', ' ', 'g')));

    insert into articoli (fornitore_id, codice_articolo, descrizione_originale, descrizione_normalizzata, unita_misura, chiave)
    values (v_fid, nullif(v_riga->>'codice_articolo_fornitore',''), v_riga->>'descrizione_originale', v_desc,
            v_riga->>'unita_misura', v_chiave_a)
    on conflict (fornitore_id, chiave) do update set
      descrizione_normalizzata = excluded.descrizione_normalizzata,
      unita_misura = coalesce(excluded.unita_misura, articoli.unita_misura)
    returning id into v_aid;

    v_prezzo := (v_riga->>'prezzo_unitario')::numeric;
    select sp.prezzo_unitario into v_prec from storico_prezzi sp
      where sp.articolo_id = v_aid and sp.valuta = v_valuta
      order by sp.data_rilevazione desc limit 1;

    v_var := case when v_prec is not null and v_prec > 0
                  then round((v_prezzo - v_prec) / v_prec * 100, 2) end;
    v_anom := coalesce(v_var > p_soglia, false);
    if v_anom then v_n := v_n + 1; end if;

    insert into storico_prezzi (articolo_id, documento_id, quantita, unita_misura, prezzo_unitario,
        sconto_percentuale, totale_riga, aliquota_iva, valuta, prezzo_precedente, variazione_pct,
        anomalia_prezzo, data_rilevazione)
    values (v_aid, v_did, (v_riga->>'quantita')::numeric, v_riga->>'unita_misura', v_prezzo,
        (v_riga->>'sconto_percentuale')::numeric, (v_riga->>'totale_riga')::numeric,
        (v_riga->>'aliquota_iva_percentuale')::numeric, v_valuta, v_prec, v_var, v_anom,
        coalesce((v_doc->>'data_documento')::timestamptz, now()));

    if v_anom then
      v_out := v_out || jsonb_build_object('articolo', v_desc, 'prezzo_precedente', v_prec,
                 'prezzo_attuale', v_prezzo, 'variazione_pct', v_var, 'anomalia_prezzo', true);
    end if;
  end loop;

  update documenti set n_anomalie = v_n where id = v_did;

  return jsonb_build_object('documento_id', v_did, 'fornitore_id', v_fid,
    'n_anomalie', v_n, 'anomalia_prezzo', v_n > 0, 'anomalie', v_out);
end $$;

revoke all on function public.registra_documento(jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.registra_documento(jsonb, text, numeric) to service_role;

insert into storage.buckets (id, name, public) values ('documenti', 'documenti', false)
on conflict (id) do nothing;
create policy "lettura documenti autenticati" on storage.objects for select to authenticated
  using (bucket_id = 'documenti');
