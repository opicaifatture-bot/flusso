-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 2 — Caricamento diretto su Storage, stati del documento, idempotenza
-- ═══════════════════════════════════════════════════════════════════════════
-- Flusso: crea_caricamento (utente) → upload diretto con URL firmato →
-- webhook n8n {documento_id} → avvia_elaborazione (n8n) → … → completato/errore.
-- Un documento fermo da più di 5 minuti passa a "errore" (pg_cron, ogni minuto).

create extension if not exists pg_cron;

alter table public.documenti
  alter column fornitore_id drop not null,
  alter column tipo set default 'Altro',
  add column fase text,
  add column errore text,
  add column errore_codice text,
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column nome_file text,
  add column mime text,
  add column dimensione bigint,
  add column caricato_da uuid references auth.users(id) on delete set null,
  add column duplicato_di uuid references public.documenti(id) on delete set null,
  add column tentativi int not null default 0,
  add column elaborazione_iniziata_il timestamptz,
  add column completato_il timestamptz,
  add column aggiornato_il timestamptz not null default now();

update public.documenti set stato = 'completato', completato_il = created_at where stato = 'elaborato';
alter table public.documenti alter column stato set default 'in_coda';
alter table public.documenti add constraint documenti_stato_check
  check (stato in ('in_coda', 'elaborazione', 'completato', 'errore', 'duplicato'));

-- Il vecchio vincolo di unicità lascia il posto alla gestione esplicita dei duplicati.
drop index if exists public.documenti_univoco;
create index documenti_chiave_contabile on public.documenti (ristorante_id, fornitore_id, tipo, numero, data_documento);

-- Idempotenza: lo stesso file (SHA-256) non entra due volte nella stessa sede.
create unique index documenti_sha256_univoco on public.documenti (ristorante_id, sha256)
  where sha256 is not null and stato in ('in_coda', 'elaborazione', 'completato');
create index documenti_in_lavorazione on public.documenti (aggiornato_il)
  where stato in ('in_coda', 'elaborazione');

create or replace function app.tocca_aggiornato_il() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.aggiornato_il := now();
  return new;
end $$;
create trigger documenti_aggiornato_il before update on public.documenti
  for each row execute function app.tocca_aggiornato_il();

-- Aggiornamenti in tempo reale dello stato verso la web app (filtrati dalla RLS).
alter publication supabase_realtime add table public.documenti;

-- ── RPC utente: prenota il caricamento ─────────────────────────────────────
create or replace function public.crea_caricamento(
  p_ristorante_id uuid, p_nome_file text, p_dimensione bigint, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_ext text := lower(substring(p_nome_file from '\.([A-Za-z0-9]{1,5})$'));
  v_mime text;
  v_dup public.documenti;
begin
  perform app.richiedi(app.ha_ruolo(p_ristorante_id, array['titolare', 'chef', 'contabile']::public.ruolo_membro[]));
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Impronta del file non valida' using errcode = '22023';
  end if;
  if p_dimensione is null or p_dimensione <= 0 or p_dimensione > 26214400 then
    raise exception 'Dimensione non valida: massimo 25 MB' using errcode = '22023';
  end if;
  v_mime := case v_ext
    when 'pdf' then 'application/pdf' when 'xml' then 'application/xml'
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png' when 'webp' then 'image/webp' end;
  if v_mime is null then
    raise exception 'Formato non supportato: usa PDF, XML, JPG, PNG o WEBP' using errcode = '22023';
  end if;

  select * into v_dup from public.documenti d
   where d.ristorante_id = p_ristorante_id and d.sha256 = p_sha256
     and d.stato in ('in_coda', 'elaborazione', 'completato')
   limit 1;
  if found then
    -- Prenotazione rimasta senza file (upload interrotto): si riusa lo stesso documento.
    if v_dup.stato = 'in_coda' and not exists (
         select 1 from storage.objects o where o.bucket_id = 'documenti' and o.name = v_dup.file_path) then
      update public.documenti set nome_file = left(p_nome_file, 200) where id = v_dup.id;
      return jsonb_build_object('duplicato', false, 'documento_id', v_dup.id,
                                'file_path', v_dup.file_path, 'mime', v_dup.mime);
    end if;
    return jsonb_build_object('duplicato', true, 'documento_id', v_dup.id, 'stato', v_dup.stato);
  end if;

  insert into public.documenti (id, ristorante_id, tipo, stato, sha256, nome_file, mime, dimensione,
                                caricato_da, file_path)
  values (v_id, p_ristorante_id, 'Altro', 'in_coda', p_sha256, left(p_nome_file, 200), v_mime, p_dimensione,
          auth.uid(), p_ristorante_id::text || '/' || v_id::text || '.' || v_ext);
  return jsonb_build_object('duplicato', false, 'documento_id', v_id,
                            'file_path', p_ristorante_id::text || '/' || v_id::text || '.' || v_ext,
                            'mime', v_mime);
end $$;

create or replace function public.riprova_documento(p_documento_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc public.documenti;
begin
  select * into v_doc from public.documenti where id = p_documento_id for update;
  perform app.richiedi(found and app.ha_ruolo(v_doc.ristorante_id,
            array['titolare', 'chef', 'contabile']::public.ruolo_membro[]));
  if v_doc.stato <> 'errore' then
    raise exception 'Si possono rielaborare solo i documenti in errore' using errcode = '22023';
  end if;
  update public.documenti set stato = 'in_coda', fase = null, errore = null, errore_codice = null
   where id = p_documento_id;
end $$;

create or replace function public.elimina_documento(p_documento_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc public.documenti;
begin
  select * into v_doc from public.documenti where id = p_documento_id for update;
  perform app.richiedi(found and app.ha_ruolo(v_doc.ristorante_id,
            array['titolare', 'contabile']::public.ruolo_membro[]));
  if v_doc.stato not in ('errore', 'duplicato') then
    raise exception 'Si possono eliminare solo documenti in errore o duplicati' using errcode = '22023';
  end if;
  delete from public.documenti where id = p_documento_id;
end $$;

-- ── RPC di servizio (n8n) ──────────────────────────────────────────────────
-- Transizione atomica in_coda → elaborazione: se il webhook arriva due volte,
-- la seconda chiamata non trova nulla da avviare.
create or replace function public.avvia_elaborazione(p_documento_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.documenti;
begin
  update public.documenti
     set stato = 'elaborazione', fase = 'estrazione', elaborazione_iniziata_il = now(),
         tentativi = tentativi + 1, errore = null, errore_codice = null
   where id = p_documento_id and stato = 'in_coda'
  returning * into v_doc;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Documento inesistente o già in lavorazione');
  end if;
  if v_doc.file_path is null or not exists (
       select 1 from storage.objects o where o.bucket_id = 'documenti' and o.name = v_doc.file_path) then
    update public.documenti
       set stato = 'errore', fase = null, errore_codice = 'file_mancante',
           errore = 'File non trovato: il caricamento non è stato completato. Riprova.'
     where id = p_documento_id;
    return jsonb_build_object('ok', false, 'motivo', 'File non trovato nello storage');
  end if;
  return jsonb_build_object('ok', true, 'documento_id', v_doc.id, 'ristorante_id', v_doc.ristorante_id,
                            'file_path', v_doc.file_path, 'mime', v_doc.mime, 'nome_file', v_doc.nome_file);
end $$;

create or replace function public.segna_errore(p_documento_id uuid, p_messaggio text, p_codice text default 'elaborazione')
returns void language sql security definer set search_path = '' as $$
  update public.documenti
     set stato = 'errore', fase = null, errore_codice = p_codice,
         errore = left(coalesce(nullif(btrim(p_messaggio), ''), 'Errore durante l''elaborazione'), 500)
   where id = p_documento_id and stato in ('in_coda', 'elaborazione');
$$;

create or replace function public.scadenza_documenti()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.documenti
     set stato = 'errore', fase = null, errore_codice = 'timeout',
         errore = 'Tempo massimo di elaborazione superato (5 minuti). Puoi riprovare.'
   where stato in ('in_coda', 'elaborazione') and aggiornato_il < now() - interval '5 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.crea_caricamento(uuid, text, bigint, text), public.riprova_documento(uuid),
  public.elimina_documento(uuid), public.avvia_elaborazione(uuid), public.segna_errore(uuid, text, text),
  public.scadenza_documenti() from public, anon, authenticated;
grant execute on function public.crea_caricamento(uuid, text, bigint, text), public.riprova_documento(uuid),
  public.elimina_documento(uuid) to authenticated;
grant execute on function public.avvia_elaborazione(uuid), public.segna_errore(uuid, text, text),
  public.scadenza_documenti() to service_role;

select cron.schedule('price-guardian-scadenza-documenti', '* * * * *', 'select public.scadenza_documenti()');
