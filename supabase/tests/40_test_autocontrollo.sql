\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set chef      '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
\set estraneo  '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}'
\set consul    '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set cucina    '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
select id as r1 from ristoranti where nome = 'Sede principale' \gset
select id as r2 from ristoranti where nome = 'Seconda sede' \gset
select gruppo_id as g1 from ristoranti where id = :'r1' \gset

-- Consulente e account cucina, solo sulla sede principale.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'consulente@test.invalid', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'cucina@test.invalid', now());
insert into membri_ristorante (ristorante_id, user_id, ruolo) values
  (:'r1', '00000000-0000-0000-0000-0000000000c1', 'consulente'),
  (:'r1', '00000000-0000-0000-0000-0000000000c2', 'cucina');
-- Dati di riferimento creati dal titolare: una cella e un documento d'acquisto esistono già dai test precedenti.

-- ═══ ACCESSI PER RUOLO ═════════════════════════════════════════════════════
set role authenticated;
select t.come(:'consul');
select t.uguale('ruoli', 'consulente: vede la sede', (select count(*) from ristoranti where id = :'r1'), 1::bigint);
select t.uguale('ruoli', 'consulente: non vede le altre sedi', (select count(*) from ristoranti where id = :'r2'), 0::bigint);
select t.uguale('ruoli', 'consulente: nessun documento d''acquisto', (select count(*) from documenti), 0::bigint);
select t.uguale('ruoli', 'consulente: nessun prezzo', (select count(*) from storico_prezzi), 0::bigint);
select t.uguale('ruoli', 'consulente: nessun lotto o movimento', (select count(*) from lotti) + (select count(*) from movimenti), 0::bigint);
select t.uguale('ruoli', 'consulente: nessuna ricetta', (select count(*) from ricette), 0::bigint);
select t.uguale('ruoli', 'consulente: cruscotto senza importi né documenti',
  (select (k->>'n_documenti') || '/' || coalesce(k->>'spesa', 'null') || '/' || jsonb_array_length(k->'top_fornitori') from (select cruscotto(:'r1', 90) k) x), '0/null/0');
select t.rifiuta('ruoli', 'consulente: niente margini', format('select margini_ricette(%L, current_date - 30, current_date)', :'r1'), 'Permesso negato');
select t.ok('ruoli', 'consulente: vede le celle', (select count(*) from ubicazioni where ristorante_id = :'r1') > 0);
select t.ok('ruoli', 'consulente: vede i fornitori (anagrafica)', (select count(*) from fornitori) > 0);
select t.uguale('ruoli', 'consulente: vede il piano', piano_corrente(:'g1')->>'stato', 'attivo');
select t.rifiuta('ruoli', 'consulente: non può caricare fatture', format('select crea_caricamento(%L, ''c.pdf'', 10, repeat(''c'', 64))', :'r1'), 'Permesso negato');
select t.come(:'cucina');
select t.uguale('ruoli', 'cucina: nessun prezzo', (select count(*) from storico_prezzi), 0::bigint);
select t.ok('ruoli', 'cucina: vede le celle', (select count(*) from ubicazioni where ristorante_id = :'r1') > 0);
select t.rifiuta('ruoli', 'cucina: non gestisce le persone', format('select salva_persona(%L, ''{"nome":"X"}'')', :'r1'), 'Permesso negato');
select t.come(:'contabile');
select t.uguale('ruoli', 'contabile: non vede le celle', (select count(*) from ubicazioni), 0::bigint);
select t.ok('ruoli', 'contabile: vede ancora i documenti d''acquisto', (select count(*) from documenti) > 0);
select t.come(:'titolare');
select t.ok('ruoli', 'titolare: vede tutto come prima', (select count(*) from documenti) > 0 and (select count(*) from ubicazioni) > 0);

-- ═══ PERSONE E PIN ═════════════════════════════════════════════════════════
select t.come(:'consul');
select salva_persona(:'r1', '{"nome":"Mario Rossi","mansione":"Cuoco"}') as p1 \gset
select t.ok('pin', 'il consulente aggiunge una persona', :'p1' is not null);
select t.rifiuta('pin', 'il consulente non imposta PIN', format('select imposta_pin(%L, ''4826'')', :'p1'), 'Permesso negato');
select t.come(:'titolare');
select t.rifiuta('pin', 'PIN troppo corto', format('select imposta_pin(%L, ''123'')', :'p1'), '4 a 8 cifre');
select t.rifiuta('pin', 'PIN banale: cifre uguali', format('select imposta_pin(%L, ''7777'')', :'p1'), 'troppo semplice');
select t.rifiuta('pin', 'PIN banale: sequenza', format('select imposta_pin(%L, ''3456'')', :'p1'), 'troppo semplice');
select imposta_pin(:'p1', '4826');
select t.uguale('pin', 'stato del PIN visibile senza hash', (select count(*) from stato_pin(:'r1') where persona_id = :'p1'), 1::bigint);
select t.come(:'cucina');
select t.uguale('pin', 'PIN giusto: operatore identificato', identifica_operatore(:'r1', :'p1', '4826')->>'nome', 'Mario Rossi');
select t.uguale('pin', 'PIN errato: rifiutato senza eccezione', identifica_operatore(:'r1', :'p1', '0000')->>'motivo', 'PIN errato');
select t.uguale('pin', 'PIN errato: tentativi rimasti', identifica_operatore(:'r1', :'p1', '0001')->>'tentativi_rimasti', '3');
select identifica_operatore(:'r1', :'p1', '0002'), identifica_operatore(:'r1', :'p1', '0003'), identifica_operatore(:'r1', :'p1', '0004');
select t.ok('pin', 'dopo 5 errori: bloccato anche con il PIN giusto', identifica_operatore(:'r1', :'p1', '4826')->>'motivo' like 'Troppi tentativi%');
select t.rifiuta('pin', 'hash del PIN non leggibile', 'select * from persone_pin', 'permission denied');
select t.rifiuta('pin', 'persona di un''altra sede', format('select identifica_operatore(%L, %L, ''4826'')', :'r2', :'p1'), 'Permesso negato');
reset role; select t.come('');
select t.ok('pin', 'il PIN non è salvato in chiaro', not exists (select 1 from persone_pin where pin_hash like '%4826%'));
select t.ok('pin', 'il PIN non compare nell''audit', not exists (select 1 from audit_log where tabella = 'persone_pin' or coalesce(dopo, '{}') ?| array['pin', 'pin_hash'] or coalesce(prima, '{}') ?| array['pin', 'pin_hash']));
set role authenticated; select t.come(:'titolare');
select imposta_pin(:'p1', '5937');
select t.come(:'cucina');
select t.uguale('pin', 'nuovo PIN sblocca la persona', identifica_operatore(:'r1', :'p1', '5937')->>'ok', 'true');
select t.come(:'titolare');
select t.rifiuta('pin', 'una persona non si cancella', format('delete from persone where id = %L', :'p1'), 'permission denied');
select salva_persona(:'r1', '{"attiva":false}', :'p1');
select t.come(:'cucina');
select t.uguale('pin', 'persona disattivata: non firma più', identifica_operatore(:'r1', :'p1', '5937')->>'ok', 'false');

-- ═══ ARCHIVIO DOCUMENTI ═══════════════════════════════════════════════════
reset role; select t.come('');
insert into storage.objects (bucket_id, name) values
  ('archivio', :'r1' || '/man-v1.pdf'), ('archivio', :'r1' || '/man-v2.pdf'), ('archivio', :'r2' || '/altro.pdf');
set role authenticated; select t.come(:'consul');
select archivia_file(:'r1', jsonb_build_object('categoria', 'manuale_autocontrollo', 'titolo', 'Manuale di autocontrollo', 'revisione', 'Rev. 1',
  'scadenza', current_date + 10, 'file', jsonb_build_object('path', :'r1' || '/man-v1.pdf', 'nome', 'manuale.pdf', 'mime', 'application/pdf', 'dimensione', 1000, 'sha256', repeat('a', 64))))->>'archivio_id' as a1 \gset
select t.ok('archivio', 'il consulente carica il manuale', :'a1' is not null);
select t.rifiuta('archivio', 'stesso file due volte', format('select archivia_file(%L, %L::jsonb, %L)', :'r1',
  jsonb_build_object('file', jsonb_build_object('path', :'r1' || '/man-v2.pdf', 'nome', 'm.pdf', 'mime', 'application/pdf', 'dimensione', 1000, 'sha256', repeat('a', 64))), :'a1'), 'già presente');
select t.uguale('archivio', 'nuova revisione = nuova versione', (archivia_file(:'r1', jsonb_build_object('revisione', 'Rev. 2',
  'file', jsonb_build_object('path', :'r1' || '/man-v2.pdf', 'nome', 'manuale-rev2.pdf', 'mime', 'application/pdf', 'dimensione', 1200, 'sha256', repeat('b', 64))), :'a1')->>'versione'), '2');
select t.rifiuta('archivio', 'file di un''altra sede', format('select archivia_file(%L, %L::jsonb)', :'r1',
  jsonb_build_object('categoria', 'altro', 'titolo', 'X', 'file', jsonb_build_object('path', :'r2' || '/altro.pdf', 'nome', 'x.pdf', 'mime', 'application/pdf', 'dimensione', 10, 'sha256', repeat('c', 64)))), 'Percorso del file non valido');
select t.rifiuta('archivio', 'file mai caricato', format('select archivia_file(%L, %L::jsonb)', :'r1',
  jsonb_build_object('categoria', 'altro', 'titolo', 'X', 'file', jsonb_build_object('path', :'r1' || '/fantasma.pdf', 'nome', 'x.pdf', 'mime', 'application/pdf', 'dimensione', 10, 'sha256', repeat('d', 64)))), 'non risulta caricato');
select t.rifiuta('archivio', 'formato non ammesso', format('select archivia_file(%L, %L::jsonb)', :'r1',
  jsonb_build_object('categoria', 'altro', 'titolo', 'X', 'file', jsonb_build_object('path', :'r1' || '/man-v1.pdf', 'nome', 'x.exe', 'mime', 'application/x-msdownload', 'dimensione', 10, 'sha256', repeat('e', 64)))), 'Formato non supportato');
select t.rifiuta('archivio', 'versioni immutabili', format('update archivio_versioni set revisione = ''x'' where archivio_id = %L', :'a1'), 'permission denied');
select t.rifiuta('archivio', 'archiviare senza motivo', format('select aggiorna_archivio(%L, ''{"archiviato":true}'')', :'a1'), 'perché');
select t.come(:'contabile');
select t.uguale('archivio', 'contabile: non vede l''archivio HACCP', (select count(*) from archivio), 0::bigint);
select t.come(:'cucina');
select t.uguale('archivio', 'cucina: vede le versioni', (select count(*) from archivio_versioni where archivio_id = :'a1'), 2::bigint);
select t.rifiuta('archivio', 'cucina: non carica documenti', format('select aggiorna_archivio(%L, ''{"note":"x"}'')', :'a1'), 'Permesso negato');
select t.come(:'estraneo');
select t.uguale('archivio', 'estraneo: non vede nulla', (select count(*) from archivio) + (select count(*) from persone), 0::bigint);
reset role; select t.come('');
select t.rifiuta('archivio', 'nemmeno l''amministratore cancella una versione', format('delete from archivio_versioni where archivio_id = %L', :'a1'), 'immutabile');

-- ═══ SCADENZARIO E CONSERVAZIONE ═══════════════════════════════════════════
set role authenticated; select t.come(:'consul');
select t.uguale('scadenzario', 'documento in scadenza entro 30 giorni', (select stato from v_scadenzario where riferimento_id = :'a1'), 'in_scadenza');
select aggiorna_archivio(:'a1', jsonb_build_object('scadenza', current_date - 1));
select t.uguale('scadenzario', 'documento scaduto', (select stato from v_scadenzario where riferimento_id = :'a1'), 'scaduta');
select t.come(:'contabile');
select t.uguale('scadenzario', 'contabile: scadenzario HACCP non visibile', (select count(*) from v_scadenzario where origine = 'documento'), 0::bigint);
reset role; select t.come('');
select t.rifiuta('conservazione', 'non si scende sotto i 2 anni', format('update gruppi set conservazione_anni = 1 where id = %L', :'g1'), 'conservazione_anni');
select t.uguale('conservazione', 'valore predefinito', (select conservazione_anni from gruppi where id = :'g1'), 2);
