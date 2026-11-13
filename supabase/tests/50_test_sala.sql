\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
\set consul    '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set cucina    '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
\set cameriere '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}'
select id as r1 from ristoranti where nome = 'Sede principale' \gset
select id as r3 from ristoranti where nome = 'Sede estranea' \gset
select id as ric from ricette where nome = 'Pasta fresca' \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'cameriere@test.invalid');
insert into membri_ristorante (ristorante_id, user_id, ruolo) values (:'r1', '00000000-0000-0000-0000-0000000000d1', 'sala');

-- ═══ CONFIGURAZIONE ════════════════════════════════════════════════════════
set role authenticated; select t.come(:'titolare');
select imposta_sala(:'r1', '{"lingue":["it","en"],"coperto":3,"mance":true}');
select t.rifiuta('sala', 'incassi reali non attivabili dall''app', format('select imposta_sala(%L, ''{"pagamento_modalita":"attivo"}'')', :'r1'), 'solo dopo');
select t.rifiuta('sala', 'lingua non supportata', format('select imposta_sala(%L, ''{"lingue":["xx"]}'')', :'r1'), 'Lingua');
select salva_tavolo(:'r1', '{"codice":"T1","posti":4,"sala":"Sala principale"}') as tv \gset
select qr_token as tok from tavoli where id = :'tv' \gset
select salva_voce_menu(:'r1', jsonb_build_object('nome', 'Pasta fresca al burro', 'prezzo', 18, 'categoria', 'Primi', 'ricetta_id', :'ric', 'traduzioni', '{"en":{"nome":"Fresh pasta with butter"}}'::jsonb)) as v1 \gset
select salva_voce_menu(:'r1', '{"nome":"Acqua naturale","prezzo":3,"categoria":"Bevande","reparto":"bar"}') as v2 \gset
select salva_voce_menu(:'r1', '{"nome":"Tiramisù","prezzo":9,"categoria":"Dolci","reparto":"pasticceria","allergeni":["uova","latte","glutine"]}') as v3 \gset
select t.rifiuta('sala', 'allergene sconosciuto sulla voce', format('select salva_voce_menu(%L, ''{"nome":"X","prezzo":1,"allergeni":["zucchero"]}'')', :'r1'), 'sconosciuto');
select t.come(:'cameriere');
select t.rifiuta('sala', 'il cameriere non modifica il menu', format('select salva_voce_menu(%L, ''{"nome":"X","prezzo":1}'')', :'r1'), 'Permesso negato');
select t.uguale('sala', 'il cameriere non vede le fatture', (select count(*) from documenti), 0::bigint);
select t.uguale('sala', 'il cameriere non vede i prezzi d''acquisto', (select count(*) from storico_prezzi), 0::bigint);

-- ═══ CLIENTE CON TAVOLO CHIUSO ════════════════════════════════════════════
reset role; select t.come('');
set role anon;
select t.uguale('cliente', 'QR sconosciuto', tavolo_cliente('inesistente')->>'stato', 'non_valido');
select t.uguale('cliente', 'tavolo chiuso: niente menu', tavolo_cliente(:'tok')->>'stato', 'chiuso');
select t.rifiuta('cliente', 'tavolo chiuso: niente ordini', format('select ordina_dal_tavolo(%L, %L::jsonb)', :'tok', jsonb_build_array(jsonb_build_object('voce_id', :'v2'))), 'non è aperto');
select t.rifiuta('cliente', 'nessun accesso diretto alle tabelle', 'select * from tavoli', 'permission denied');

-- ═══ SERVIZIO ══════════════════════════════════════════════════════════════
reset role; set role authenticated; select t.come(:'cameriere');
select apri_tavolo(:'tv', 2) as ses \gset
select t.rifiuta('servizio', 'tavolo già aperto', format('select apri_tavolo(%L)', :'tv'), 'già aperto');
reset role; set role anon;
select tavolo_cliente(:'tok') as tc \gset
select t.uguale('cliente', 'menu visibile a tavolo aperto', jsonb_array_length((:'tc'::jsonb)->'menu'), 3);
select t.uguale('cliente', 'allergeni della voce dalla ricetta', (select x->'allergeni'->>'contiene' from jsonb_array_elements((:'tc'::jsonb)->'menu') x where x->>'nome' = 'Pasta fresca al burro'), '["glutine"]');
select t.uguale('cliente', 'allergeni dichiarati sulla voce', (select jsonb_array_length(x->'allergeni'->'contiene') from jsonb_array_elements((:'tc'::jsonb)->'menu') x where x->>'nome' = 'Tiramisù'), 3);
select t.uguale('cliente', 'traduzione disponibile', (select x->'traduzioni'->'en'->>'nome' from jsonb_array_elements((:'tc'::jsonb)->'menu') x where x->>'nome' = 'Pasta fresca al burro'), 'Fresh pasta with butter');
select t.uguale('cliente', 'ordine dal tavolo', ordina_dal_tavolo(:'tok', jsonb_build_array(jsonb_build_object('voce_id', :'v1', 'quantita', 2, 'note', 'una senza parmigiano'), jsonb_build_object('voce_id', :'v2', 'quantita', 1)), 'it')->>'righe', '2');
select t.uguale('cliente', 'chiamata al cameriere', chiama_dal_tavolo(:'tok', 'cameriere')->>'ok', 'true');
select chiama_dal_tavolo(:'tok', 'cameriere');
select t.rifiuta('cliente', 'richiesta non valida', format('select chiama_dal_tavolo(%L, ''altro'')', :'tok'), 'non valida');
reset role; set role authenticated; select t.come(:'cameriere');
select t.uguale('servizio', 'chiamate ripetute non si moltiplicano', (select count(*) from chiamate_tavolo where sessione_id = :'ses'), 1::bigint);
select imposta_esaurito(:'v2', true);
reset role; set role anon;
select t.rifiuta('cliente', 'piatto esaurito non ordinabile', format('select ordina_dal_tavolo(%L, %L::jsonb)', :'tok', jsonb_build_array(jsonb_build_object('voce_id', :'v2'))), 'esaurito');

-- ═══ CUCINA ════════════════════════════════════════════════════════════════
reset role; set role authenticated; select t.come(:'cucina');
select t.uguale('cucina', 'la cucina vede le righe da preparare', (select count(*) from ordini_righe where sessione_id = :'ses'), 2::bigint);
select t.uguale('cucina', 'la cucina vede il numero del tavolo', (select t2.codice from sessioni_tavolo s join tavoli t2 on t2.id = s.tavolo_id where s.id = :'ses'), 'T1');
select t.uguale('cucina', 'la cucina non vede i pagamenti', (select count(*) from pagamenti_tavolo), 0::bigint);
select id as riga1 from ordini_righe where sessione_id = :'ses' and nome = 'Pasta fresca al burro' \gset
select avanza_riga(:'riga1', 'in_preparazione'); select avanza_riga(:'riga1', 'pronto');
select t.come(:'cameriere');
select t.uguale('cucina', 'la sala vede il piatto pronto', (select righe_pronte from v_tavoli where id = :'tv'), 1::bigint);
select avanza_riga(:'riga1', 'servito');
select t.uguale('food cost', 'il cameriere non vede le vendite', (select count(*) from vendite), 0::bigint);
select t.come(:'titolare');
select t.uguale('food cost', 'piatto servito → vendita registrata', (select quantita from vendite where chiave_idempotenza = 'riga:' || :'riga1'), 2::numeric);
select t.come(:'cameriere');
select t.rifiuta('cucina', 'riga servita non torna indietro', format('select avanza_riga(%L, ''pronto'')', :'riga1'), 'già');
select id as riga2 from ordini_righe where sessione_id = :'ses' and nome = 'Acqua naturale' \gset
select t.rifiuta('cucina', 'annullare senza motivo', format('select avanza_riga(%L, ''annullato'')', :'riga2'), 'motivo');
select ordina_dalla_sala(:'ses', jsonb_build_array(jsonb_build_object('voce_id', :'v3', 'quantita', 2)));

-- ═══ CONTO E PAGAMENTO ═════════════════════════════════════════════════════
-- conto: 2×18 + 1×3 + 2×9 + coperto 2×3 = 63
reset role; set role anon;
select t.uguale('conto', 'totale con coperto', (tavolo_cliente(:'tok')->'conto'->>'totale')::numeric, 63::numeric);
select t.rifiuta('conto', 'non si paga più del dovuto', format('select paga_dal_tavolo(%L, 100)', :'tok'), 'supera');
select paga_dal_tavolo(:'tok', 31.5, 3, '{"modo":"uguale","parti":2}') as pg \gset
select t.uguale('conto', 'pagamento in prova', (:'pg'::jsonb)->>'prova', 'true');
select t.uguale('conto', 'resta metà conto', ((:'pg'::jsonb)->'conto'->>'da_pagare')::numeric, 31.5::numeric);
reset role; set role authenticated; select t.come(:'cameriere');
select t.uguale('conto', 'pagamento simulato senza scontrino', (select provider || '/' || fiscale_stato from pagamenti_tavolo where sessione_id = :'ses'), 'prova/da_emettere');
select t.rifiuta('conto', 'chiusura con saldo aperto senza motivo', format('select chiudi_tavolo(%L)', :'ses'), 'Restano');
select t.uguale('conto', 'il cameriere vede il conto', (conto_sessione(:'ses')->>'da_pagare')::numeric, 31.5::numeric);
select t.come(:'contabile');
select t.rifiuta('conto', 'il contabile non vede il conto del tavolo', format('select conto_sessione(%L)', :'ses'), 'Permesso negato');
select t.come(:'cameriere');
select registra_pagamento_sala(:'ses', 31.5, 'carta_pos') as pg2 \gset
select t.rifiuta('conto', 'scontrino senza numero', format('select segna_scontrino(%L, '''')', :'pg2'), 'numero');
select segna_scontrino(:'pg2', '0042-0007');
select t.uguale('conto', 'chiusura: uno scontrino ancora da emettere', (chiudi_tavolo(:'ses')->>'scontrini_da_emettere'), '1');
reset role; set role anon;
select t.uguale('cliente', 'dopo la chiusura il QR non funziona più', tavolo_cliente(:'tok')->>'stato', 'chiuso');
reset role; select t.rifiuta('conto', 'solo il servizio conferma i pagamenti reali', 'set local role authenticated; select conferma_pagamento(gen_random_uuid(), ''pagato'', ''x'')', 'permission denied');
reset role;
select t.rifiuta('conto', 'pagamenti non cancellabili', format('delete from pagamenti_tavolo where id = %L', :'pg2'), 'immutabile');

-- ═══ ISOLAMENTO E QR ═══════════════════════════════════════════════════════
set role authenticated; select t.come(:'contabile');
select t.uguale('isolamento', 'contabile: non vede la sala', (select count(*) from tavoli) + (select count(*) from ordini_righe), 0::bigint);
select t.come(:'consul');
select t.uguale('isolamento', 'consulente: non vede la sala', (select count(*) from tavoli), 0::bigint);
select t.come(:'titolare');
select rigenera_qr(:'tv');
reset role; set role anon;
select t.uguale('qr', 'vecchio QR disattivato dopo la rigenerazione', tavolo_cliente(:'tok')->>'stato', 'non_valido');
reset role; select t.come('');
