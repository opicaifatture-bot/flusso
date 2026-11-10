\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set chef      '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
\set lettore   '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}'
\set estraneo  '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}'
\set servizio  '{"role":"service_role"}'

-- ── Dati di partenza: una seconda sede nello stesso gruppo e un secondo gruppo ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'chef@test.invalid'), ('00000000-0000-0000-0000-00000000000c', 'contabile@test.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'lettore@test.invalid'), ('00000000-0000-0000-0000-00000000000e', 'estraneo@test.invalid');
select id as r1 from ristoranti limit 1 \gset
select gruppo_id as g1 from ristoranti limit 1 \gset
insert into ristoranti (gruppo_id, nome) values (:'g1', 'Seconda sede') returning id as r2 \gset
insert into gruppi (nome) values ('Altro gruppo') returning id as g2 \gset
insert into ristoranti (gruppo_id, nome) values (:'g2', 'Sede estranea') returning id as r3 \gset
insert into membri_ristorante (ristorante_id, user_id, ruolo) values
  (:'r1', '00000000-0000-0000-0000-00000000000b', 'chef'), (:'r1', '00000000-0000-0000-0000-00000000000c', 'contabile'),
  (:'r1', '00000000-0000-0000-0000-00000000000d', 'sola_lettura'), (:'r3', '00000000-0000-0000-0000-00000000000e', 'titolare');
insert into tassi_cambio (data, valuta, tasso) values ('2026-03-02', 'CHF', 0.9500), ('2026-03-06', 'CHF', 0.9400);

-- ═══ CALCOLI ═══════════════════════════════════════════════════════════════
-- Sconto di riga: il confronto usa il prezzo netto.
select t.fattura(:'r1', 'A1', '2026-01-10', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":4,"unita_misura":"lt","prezzo_unitario":40,"sconto_percentuale":5,"totale_riga":152}') as a1 \gset
select t.uguale('calcoli', 'prezzo netto = prezzo × (1 − sconto)', (t.riga(:'a1')).prezzo_netto, 38.0000);
select t.uguale('calcoli', 'primo acquisto: nessuna variazione', (t.riga(:'a1')).variazione_pct, null::numeric);
select t.uguale('calcoli', 'primo acquisto: esito dichiarato', (t.riga(:'a1')).confronto_esito, 'primo_acquisto');
-- Stesso listino, sconto tolto: è un rincaro reale del 5,26% → oltre soglia (5%).
select t.fattura(:'r1', 'A2', '2026-01-20', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":4,"unita_misura":"lt","prezzo_unitario":40,"totale_riga":160}') as a2 \gset
select t.uguale('calcoli', 'sconto rimosso = rincaro sul netto', (t.riga(:'a2')).variazione_pct, 5.26);
select t.ok('calcoli', 'rincaro oltre soglia segnalato', (t.riga(:'a2')).anomalia_prezzo);
select t.uguale('calcoli', 'riga di confronto salvata', (t.riga(:'a2')).riga_precedente_id, (t.riga(:'a1')).id);
select t.uguale('calcoli', 'n_anomalie del documento', (select n_anomalie from documenti where id = :'a2'), 1);
-- Esattamente sulla soglia: non è un rincaro (la regola è "oltre").
select t.fattura(:'r1', 'A3', '2026-01-25', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":42,"totale_riga":42}') as a3 \gset
select t.uguale('calcoli', 'variazione esattamente 5%', (t.riga(:'a3')).variazione_pct, 5.00);
select t.ok('calcoli', 'variazione pari alla soglia non segnalata', not (t.riga(:'a3')).anomalia_prezzo);
-- Ribasso.
select t.fattura(:'r1', 'A4', '2026-01-28', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":39.9,"totale_riga":39.9}') as a4 \gset
select t.uguale('calcoli', 'ribasso con arrotondamento a 2 decimali', (t.riga(:'a4')).variazione_pct, -5.00);

-- Unità: grammi → kg, pezzi a peso variabile, confezioni con contenuto.
select t.fattura(:'r1', 'B1', '2026-02-01', '{"codice_articolo_fornitore":"ZAF","descrizione_articolo":"Zafferano","quantita":50,"unita_misura":"g","prezzo_unitario":12,"totale_riga":600}') as b1 \gset
select t.uguale('unità', 'g → kg', (t.riga(:'b1')).prezzo_base, 12000.0000);
select t.uguale('unità', 'unità base kg', (t.riga(:'b1')).unita_base, 'kg');
select t.fattura(:'r1', 'B2', '2026-02-01', '{"codice_articolo_fornitore":"ACQ","descrizione_articolo":"Acqua minerale","quantita":4,"unita_misura":"conf","prezzo_unitario":6,"totale_riga":24,"contenuto_per_unita":6,"unita_contenuto":"lt"}') as b2 \gset
select t.uguale('unità', 'confezione senza master: resta a confezione', (t.riga(:'b2')).unita_base, 'conf');
select t.fattura(:'r1', 'B3', '2026-02-02', '{"codice_articolo_fornitore":"COS","descrizione_articolo":"Costata frollata","quantita":2,"unita_misura":"pz","prezzo_unitario":60,"totale_riga":120,"peso_netto_kg":2.4}') as b3 \gset
select t.uguale('unità', 'senza master il pezzo non diventa kg', (t.riga(:'b3')).unita_base, 'pz');
set role authenticated; select set_config('request.jwt.claims', :'titolare', false) \g /dev/null
select crea_master(:'g1', 'Costata di manzo', 'Carni bovine', 'kg') as m_costata \gset
select conferma_abbinamento((t.riga(:'b3')).alias_id, :'m_costata');
reset role; select set_config('request.jwt.claims', '', false) \g /dev/null
select t.uguale('unità', 'peso reale: 2 pz × 60 / 2,4 kg', (t.riga(:'b3')).prezzo_base, 50.0000);
select t.fattura(:'r1', 'B4', '2026-02-09', '{"codice_articolo_fornitore":"COS","descrizione_articolo":"Costata frollata","quantita":1,"unita_misura":"pz","prezzo_unitario":80,"totale_riga":80,"peso_netto_kg":1.5}') as b4 \gset
select t.uguale('unità', 'confronto a €/kg tra pezzi di peso diverso', (t.riga(:'b4')).variazione_pct, 6.67);
select t.uguale('unità', 'unità del confronto', (t.riga(:'b4')).unita_confronto, 'kg');
-- Pezzo senza peso con master a kg: non confrontabile, e lo dichiara.
select t.fattura(:'r1', 'B5', '2026-02-16', '{"codice_articolo_fornitore":"COS","descrizione_articolo":"Costata frollata","quantita":1,"unita_misura":"conf","prezzo_unitario":90,"totale_riga":90}') as b5 \gset
select t.uguale('unità', 'unità non convertibile: nessuna variazione', (t.riga(:'b5')).variazione_pct, null::numeric);
select t.uguale('unità', 'unità non convertibile: esito dichiarato', (t.riga(:'b5')).confronto_esito, 'unita_non_confrontabile');
select t.uguale('unità', 'fattore dell''alias', app.prezzo_base(6, 4, 'conf', null, null, null, 6, 'lt'), 1.0000);
select t.uguale('unità', 'contenuto in cl', app.prezzo_base(15, 1, 'pz', null, 75, 'cl', null, 'lt'), 20.0000);
select t.uguale('unità', 'target sconosciuto', app.prezzo_base(15, 1, 'pz', null, null, null, null, 'kg'), null::numeric);

-- Nota di credito: non genera rincari e non fa da riferimento.
select t.fattura(:'r1', 'C1', '2026-02-20', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":80,"totale_riga":80}', 'EUR', 'Nota di Credito') as c1 \gset
select t.uguale('note di credito', 'nessuna variazione', (t.riga(:'c1')).variazione_pct, null::numeric);
select t.uguale('note di credito', 'esito dichiarato', (t.riga(:'c1')).confronto_esito, 'nota_di_credito');
select t.fattura(:'r1', 'C2', '2026-02-21', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":40,"totale_riga":40}') as c2 \gset
select t.uguale('note di credito', 'la fattura successiva ignora la nota', (t.riga(:'c2')).prezzo_precedente, 39.9000);

-- Documento caricato in ritardo: il confronto è cronologico e le righe successive si riallineano.
select t.fattura(:'r1', 'D1', '2026-01-15', '{"codice_articolo_fornitore":"OLIO","descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":39,"totale_riga":39}') as d1 \gset
select t.uguale('cronologia', 'documento in ritardo confrontato col precedente per data', (t.riga(:'d1')).prezzo_precedente, 38.0000);
select t.uguale('cronologia', 'riga successiva riallineata', (t.riga(:'a2')).prezzo_precedente, 39.0000);
select t.uguale('cronologia', 'variazione ricalcolata', (t.riga(:'a2')).variazione_pct, 2.56);
select t.ok('cronologia', 'rincaro non più oltre soglia', not (t.riga(:'a2')).anomalia_prezzo);
select t.uguale('cronologia', 'n_anomalie riallineato', (select n_anomalie from documenti where id = :'a2'), 0);

-- Fornitori diversi non si confrontano tra loro.
select t.fattura(:'r1', 'E1', '2026-03-01', '{"descrizione_articolo":"Olio extravergine","quantita":1,"unita_misura":"lt","prezzo_unitario":99,"totale_riga":99}', 'EUR', 'Fattura', 'Fornitore Due') as e1 \gset
select t.uguale('regola', 'altro fornitore: primo acquisto', (t.riga(:'e1')).confronto_esito, 'primo_acquisto');

-- Valute: il confronto è nella valuta originale; il controvalore usa il tasso BCE entro 10 giorni.
select t.fattura(:'r1', 'F1', '2026-03-03', '{"codice_articolo_fornitore":"GRU","descrizione_articolo":"Gruyère","quantita":5,"unita_misura":"kg","prezzo_unitario":38,"totale_riga":190}', 'CHF', 'Fattura', 'Fromagerie') as f1 \gset
select t.uguale('valute', 'tasso del giorno precedente disponibile', (select tasso_cambio from documenti where id = :'f1'), 0.950000);
select t.uguale('valute', 'imponibile in EUR', (select imponibile_eur from documenti where id = :'f1'), 200.00);
select t.uguale('valute', 'riga in EUR', (t.riga(:'f1')).totale_riga_eur, 200.00);
select t.fattura(:'r1', 'F2', '2026-03-07', '{"codice_articolo_fornitore":"GRU","descrizione_articolo":"Gruyère","quantita":5,"unita_misura":"kg","prezzo_unitario":38,"totale_riga":190}', 'CHF', 'Fattura', 'Fromagerie') as f2 \gset
select t.uguale('valute', 'cambio diverso, stesso prezzo in CHF: variazione zero', (t.riga(:'f2')).variazione_pct, 0.00);
select t.fattura(:'r1', 'F3', '2026-05-20', '{"codice_articolo_fornitore":"GRU","descrizione_articolo":"Gruyère","quantita":1,"unita_misura":"kg","prezzo_unitario":38,"totale_riga":38}', 'CHF', 'Fattura', 'Fromagerie') as f3 \gset
select t.uguale('valute', 'tasso più vecchio di 10 giorni: nessun controvalore', (select imponibile_eur from documenti where id = :'f3'), null::numeric);
select registra_tassi('[{"data":"2026-05-19","valuta":"CHF","tasso":0.9}]') \g /dev/null
select t.uguale('valute', 'all''arrivo del tasso il controvalore si completa', (select imponibile_eur from documenti where id = :'f3'), 42.22);
select t.fattura(:'r1', 'F4', '2026-03-10', '{"codice_articolo_fornitore":"GRU","descrizione_articolo":"Gruyère","quantita":1,"unita_misura":"kg","prezzo_unitario":40,"totale_riga":40}', 'EUR', 'Fattura', 'Fromagerie') as f4 \gset
select t.uguale('valute', 'stesso articolo in altra valuta: non confrontato', (t.riga(:'f4')).confronto_esito, 'valuta_diversa');

-- Soglia minima assoluta.
select t.fattura(:'r2', 'G1', '2026-04-01', '{"codice_articolo_fornitore":"SALE","descrizione_articolo":"Sale","quantita":1,"unita_misura":"kg","prezzo_unitario":1,"totale_riga":1}') as g1d \gset
select t.fattura(:'r2', 'G2', '2026-04-02', '{"codice_articolo_fornitore":"SALE","descrizione_articolo":"Sale","quantita":1,"unita_misura":"kg","prezzo_unitario":1.5,"totale_riga":1.5}') as g2d \gset
select t.ok('soglie', 'senza soglia minima +50% su 1,50 € è un rincaro', (t.riga(:'g2d')).anomalia_prezzo);
update ristoranti set soglia_anomalia_min_eur = 5 where id = :'r2';
select app.ricalcola_documento(:'g2d');
select t.ok('soglie', 'con soglia minima 5 € non lo è più', not (t.riga(:'g2d')).anomalia_prezzo);
select t.uguale('soglie', 'la variazione resta visibile', (t.riga(:'g2d')).variazione_pct, 50.00);

-- ═══ STATI E DUPLICATI ═════════════════════════════════════════════════════
set role authenticated; select set_config('request.jwt.claims', :'chef', false) \g /dev/null
select crea_caricamento(:'r1', 'foto.JPG', 1000, repeat('a', 64)) as c \gset
select (:'c'::jsonb)->>'documento_id' as up1, (:'c'::jsonb)->>'file_path' as path1 \gset
select t.ok('caricamento', 'percorso {sede}/{documento}.ext', :'path1' = :'r1' || '/' || :'up1' || '.jpg');
select t.uguale('caricamento', 'prenotazione senza file: stessa prenotazione riusata', crea_caricamento(:'r1', 'foto.JPG', 1000, repeat('a', 64))->>'documento_id', :'up1');
select t.accetta('caricamento', 'lo chef può scrivere nella cartella della sua sede', format('insert into storage.objects (bucket_id, name) values (''documenti'', %L)', :'path1'));
select t.uguale('caricamento', 'stesso file dopo l''upload: duplicato', crea_caricamento(:'r1', 'altro-nome.jpg', 1000, repeat('a', 64))->>'duplicato', 'true');
select t.rifiuta('caricamento', 'formato non ammesso', format('select crea_caricamento(%L, ''x.exe'', 10, repeat(''b'', 64))', :'r1'), 'Formato non supportato');
select t.rifiuta('caricamento', 'oltre 25 MB', format('select crea_caricamento(%L, ''x.pdf'', 26214401, repeat(''b'', 64))', :'r1'), '25 MB');
select t.rifiuta('caricamento', 'impronta non valida', format('select crea_caricamento(%L, ''x.pdf'', 10, ''zz'')', :'r1'), 'Impronta');
select t.rifiuta('caricamento', 'sede di cui non è membro', format('select crea_caricamento(%L, ''x.pdf'', 10, repeat(''c'', 64))', :'r2'), 'Permesso negato');
select t.rifiuta('caricamento', 'cartella di un''altra sede nello storage', format('insert into storage.objects (bucket_id, name) values (''documenti'', %L)', :'r3' || '/x.pdf'));
reset role; set role service_role; select set_config('request.jwt.claims', :'servizio', false) \g /dev/null
select t.uguale('stati', 'presa in carico', avvia_elaborazione(:'up1')->>'ok', 'true');
select t.uguale('stati', 'seconda presa in carico rifiutata (webhook doppio)', avvia_elaborazione(:'up1')->>'ok', 'false');
select t.uguale('stati', 'stesso documento contabile: duplicato', registra_documento(:'up1', '{"documento":{"tipo":"Fattura","numero_documento":"A1","data_documento":"2026-01-10"},"fornitore":{"ragione_sociale":"Fornitore Uno"},"articoli":[]}')->>'duplicato', 'true');
select t.uguale('stati', 'stato duplicato', (select stato from documenti where id = :'up1'), 'duplicato');
select t.uguale('stati', 'nessuna riga registrata due volte', (select count(*) from storico_prezzi where documento_id = :'up1'), 0::bigint);
select t.rifiuta('stati', 'documento non in elaborazione', format('select registra_documento(%L, ''{"fornitore":{"ragione_sociale":"X"}}'')', :'a1'), 'non in elaborazione');
reset role; select set_config('request.jwt.claims', '', false) \g /dev/null
alter table documenti disable trigger documenti_aggiornato_il;
insert into documenti (ristorante_id, stato, aggiornato_il) values (:'r1', 'elaborazione', now() - interval '6 minutes') returning id as lento \gset
insert into documenti (ristorante_id, stato, aggiornato_il) values (:'r1', 'elaborazione', now() - interval '4 minutes') returning id as recente \gset
select scadenza_documenti() \g /dev/null
alter table documenti enable trigger documenti_aggiornato_il;
select t.uguale('stati', 'fermo da 6 minuti: errore per timeout', (select stato || '/' || errore_codice from documenti where id = :'lento'), 'errore/timeout');
select t.uguale('stati', 'fermo da 4 minuti: ancora in elaborazione', (select stato from documenti where id = :'recente'), 'elaborazione');
select t.uguale('revisione', 'documento con articoli non validati: da rivedere', (select n_da_validare > 0 from v_documenti where id = :'a1'), true);

-- ═══ AUTORIZZAZIONI ════════════════════════════════════════════════════════
select (t.riga(:'d1')).id as riga_d1 \gset
update storico_prezzi set prezzo_unitario = 60 where id = :'riga_d1';
select app.ricalcola_documento(:'d1');
select t.ok('permessi', 'premessa: esiste un rincaro da gestire', (t.riga(:'d1')).anomalia_prezzo);

set role authenticated; select set_config('request.jwt.claims', :'estraneo', false) \g /dev/null
select t.uguale('permessi', 'estraneo: nessun documento di altri gruppi', (select count(*) from documenti where ristorante_id <> :'r3'), 0::bigint);
select t.uguale('permessi', 'estraneo: nessuna riga, fornitore, master, alias', (select count(*) from storico_prezzi) + (select count(*) from fornitori) + (select count(*) from articoli_master) + (select count(*) from alias_articolo), 0::bigint);
select t.uguale('permessi', 'estraneo: nessun file', (select count(*) from storage.objects), 0::bigint);
select t.uguale('permessi', 'estraneo: nessuna riga di audit altrui', (select count(*) from audit_log where gruppo_id = :'g1'), 0::bigint);
select t.uguale('permessi', 'estraneo: cruscotto vuoto', (cruscotto(:'r1')->>'totale_documenti'), '0');
select t.rifiuta('permessi', 'estraneo: correzione riga', format('select correggi_riga(%L, ''{"quantita":1}'')', :'riga_d1'), 'Permesso negato');
select t.rifiuta('permessi', 'estraneo: registro audit', format('select * from registro_audit(%L)', :'g1'), 'Permesso negato');
select t.rifiuta('permessi', 'estraneo: verifica audit', format('select * from verifica_audit(%L)', :'g1'), 'Permesso negato');
select t.rifiuta('permessi', 'scrittura diretta sulle tabelle', 'update documenti set numero = ''x''', 'permission denied');
select t.rifiuta('permessi', 'funzioni di servizio', format('select registra_documento(%L, ''{}'')', :'a1'), 'permission denied');
select t.rifiuta('permessi', 'funzioni di servizio: tassi', 'select registra_tassi(''[]'')', 'permission denied');

select set_config('request.jwt.claims', :'lettore', false) \g /dev/null
select t.ok('permessi', 'sola lettura: vede i documenti della sede', (select count(*) from documenti where ristorante_id = :'r1') > 0);
select t.uguale('permessi', 'sola lettura: non vede l''altra sede del gruppo', (select count(*) from documenti where ristorante_id = :'r2'), 0::bigint);
select t.rifiuta('permessi', 'sola lettura: caricamento', format('select crea_caricamento(%L, ''x.pdf'', 10, repeat(''d'', 64))', :'r1'), 'Permesso negato');
select t.rifiuta('permessi', 'sola lettura: correzione riga', format('select correggi_riga(%L, ''{"quantita":1}'')', :'riga_d1'), 'Permesso negato');
select t.rifiuta('permessi', 'sola lettura: contestazione', format('select gestisci_anomalia(%L, ''contestata'')', :'riga_d1'), 'Permesso negato');
select t.rifiuta('permessi', 'sola lettura: audit', format('select * from registro_audit(%L)', :'g1'), 'Permesso negato');
select t.uguale('permessi', 'sola lettura: nessuna riga di audit', (select count(*) from audit_log), 0::bigint);

select set_config('request.jwt.claims', :'chef', false) \g /dev/null
select t.rifiuta('permessi', 'chef: approvazione rincaro', format('select gestisci_anomalia(%L, ''accettata'')', :'riga_d1'), 'Solo il titolare');
select t.accetta('permessi', 'chef: contestazione rincaro', format('select gestisci_anomalia(%L, ''contestata'', ''prezzo non concordato'')', :'riga_d1'));
select t.rifiuta('permessi', 'chef: testata del documento', format('select correggi_documento(%L, ''{"numero":"X"}'')', :'d1'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: approvazione master', format('select approva_master(%L)', :'m_costata'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: unione master', format('select unisci_master(%L, %L)', :'m_costata', :'m_costata'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: impostazioni sede', format('select aggiorna_ristorante(%L, ''X'')', :'r1'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: gestione team', format('select imposta_membro(%L, ''lettore@test.invalid'', ''titolare'')', :'r1'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: elenco membri', format('select * from elenco_membri(%L)', :'r1'), 'Permesso negato');
select t.rifiuta('permessi', 'chef: campo non modificabile', format('select correggi_riga(%L, ''{"master_id":null}'')', :'riga_d1'), 'Campo non modificabile');
select t.rifiuta('permessi', 'chef: valore non numerico', format('select correggi_riga(%L, ''{"quantita":"abc"}'')', :'riga_d1'), 'non valido');
select crea_master(:'g1', 'Proposta dello chef', 'Formaggi', 'kg') as m_chef \gset
select t.uguale('permessi', 'chef: il nuovo master nasce in bozza', (select stato from articoli_master where id = :'m_chef'), 'bozza');

select set_config('request.jwt.claims', :'contabile', false) \g /dev/null
select t.accetta('permessi', 'contabile: testata del documento', format('select correggi_documento(%L, ''{"numero":"D1-bis"}'')', :'d1'));
select t.rifiuta('permessi', 'contabile: conferma abbinamento', format('select conferma_abbinamento(%L, %L)', (t.riga(:'d1')).alias_id, :'m_costata'), 'Permesso negato');
select t.rifiuta('permessi', 'contabile: tipo documento non valido', format('select correggi_documento(%L, ''{"tipo":"Scontrino"}'')', :'d1'), 'non valido');
select t.ok('audit', 'contabile: legge il registro', (select count(*) from registro_audit(:'g1')) > 0);
select t.uguale('audit', 'contabile: non vede gli IP', (select count(*) from registro_audit(:'g1', 200) where ip is not null), 0::bigint);
select t.rifiuta('audit', 'contabile: colonna ip della tabella', 'select ip from audit_log limit 1', 'permission denied');

select set_config('request.jwt.claims', :'titolare', false) \g /dev/null
select set_config('request.headers', '{"x-pg-client-ip":"203.0.113.9","x-forwarded-for":"198.51.100.1, 10.0.0.1"}', false) \g /dev/null
select t.accetta('permessi', 'titolare: approvazione rincaro', format('select gestisci_anomalia(%L, ''accettata'')', :'riga_d1'));
select t.accetta('permessi', 'titolare: correzione riga', format('select correggi_riga(%L, ''{"prezzo_unitario":"39"}'')', :'riga_d1'));
select t.ok('correzioni', 'correzione: rincaro rientrato e stato azzerato', (select not anomalia_prezzo and anomalia_stato is null and corretto_manualmente from storico_prezzi where id = :'riga_d1'));
select t.rifiuta('validazione', 'paese non supportato', format('select aggiorna_ristorante(%L, p_paese => ''DE'')', :'r1'), 'Paese non supportato');
select t.rifiuta('validazione', 'valuta non supportata', format('select aggiorna_ristorante(%L, p_valuta => ''USD'')', :'r1'), 'Valuta non supportata');
select t.rifiuta('validazione', 'soglia fuori intervallo', format('select aggiorna_ristorante(%L, p_soglia_anomalia_pct => 0)', :'r1'), 'tra 0 e 100');
select t.accetta('validazione', 'sede svizzera in CHF', format('select aggiorna_ristorante(%L, p_paese => ''ch'', p_valuta => ''chf'')', :'r1'));
select t.rifiuta('permessi', 'titolare: non può declassare se stesso', format('select imposta_membro(%L, ''titolare@test.invalid'', ''chef'')', :'r1'), 'te stesso');
select t.rifiuta('permessi', 'utente inesistente', format('select imposta_membro(%L, ''nessuno@test.invalid'', ''chef'')', :'r1'), 'Nessun utente');
select rimuovi_membro(:'r1', '00000000-0000-0000-0000-00000000000d');
select t.ok('audit', 'titolare: vede IP e autore', (select bool_and(ip = '203.0.113.9' and autore = 'titolare@test.invalid') from registro_audit(:'g1', 1)));
select t.ok('audit', 'registro: filtro per tabella e riga', (select count(*) > 0 and bool_and(tabella = 'storico_prezzi') from registro_audit(:'g1', 50, null, 'storico_prezzi', 'app', array[:'riga_d1'])));
select t.ok('catalogo', 'catalogo per sede: prezzo della sede attiva', (select ultimo_prezzo = 90 and ultima_unita = 'conf' and n_acquisti = 3 from catalogo_sede(:'r1') where id = :'m_costata'));
select t.ok('catalogo', 'catalogo per sede: nessun prezzo preso da un''altra sede', (select ultimo_prezzo is null and n_acquisti = 0 from catalogo_sede(:'r2') where id = :'m_costata'));
select set_config('request.headers', '', false) \g /dev/null

select set_config('request.jwt.claims', :'lettore', false) \g /dev/null
select t.uguale('permessi', 'utente rimosso: perde subito l''accesso', (select count(*) from documenti), 0::bigint);
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false) \g /dev/null
select t.rifiuta('permessi', 'anonimo: tabelle', 'select count(*) from documenti', 'permission denied');
select t.rifiuta('permessi', 'anonimo: cruscotto', format('select cruscotto(%L)', :'r1'), 'permission denied');
reset role; select set_config('request.jwt.claims', '', false) \g /dev/null

-- ═══ CRUSCOTTO ═════════════════════════════════════════════════════════════
select (now() at time zone 'Europe/Rome')::date as oggi \gset
select t.fattura(:'r3', 'H1', (:'oggi'::date - 10), '{"descrizione_articolo":"Farina","quantita":10,"unita_misura":"kg","prezzo_unitario":10,"totale_riga":100}') \g /dev/null
select t.fattura(:'r3', 'H2', (:'oggi'::date - 100), '{"descrizione_articolo":"Farina","quantita":10,"unita_misura":"kg","prezzo_unitario":10,"totale_riga":100}') \g /dev/null
select t.fattura(:'r3', 'H3', (:'oggi'::date - 5), '{"descrizione_articolo":"Farina","quantita":2,"unita_misura":"kg","prezzo_unitario":10,"totale_riga":20}', 'EUR', 'Nota di Credito') \g /dev/null
select t.fattura(:'r3', 'H4', (:'oggi'::date - 3), '{"descrizione_articolo":"Farina","quantita":2,"unita_misura":"kg","prezzo_unitario":10,"totale_riga":500}', 'EUR', 'DDT') \g /dev/null
select t.fattura(:'r3', 'H5', (:'oggi'::date - 2), '{"descrizione_articolo":"Burro","quantita":1,"unita_misura":"kg","prezzo_unitario":70,"totale_riga":70}', 'GBP') \g /dev/null
select cruscotto(:'r3', 30) as k30 \gset
select cruscotto(:'r3', 365) as k365 \gset
select t.uguale('cruscotto', '30 giorni: fatture − note di credito, DDT esclusi', ((:'k30'::jsonb)->>'spesa')::numeric, 80.00);
select t.uguale('cruscotto', '30 giorni: importo senza cambio non sommato', (:'k30'::jsonb)->'non_convertiti'->0->>'valuta', 'GBP');
select t.uguale('cruscotto', '30 giorni: importo senza cambio riportato nella sua valuta', ((:'k30'::jsonb)->'non_convertiti'->0->>'importo')::numeric, 70::numeric);
select t.uguale('cruscotto', '365 giorni: include il documento di 100 giorni fa', ((:'k365'::jsonb)->>'spesa')::numeric, 180.00);
select t.uguale('cruscotto', 'periodo dichiarato', ((:'k30'::jsonb)->>'dal')::date, :'oggi'::date - 29);
select t.uguale('cruscotto', 'serie settimanale fino a 100 giorni', (:'k30'::jsonb)->>'passo', 'settimana');
select t.uguale('cruscotto', 'serie mensile oltre', (:'k365'::jsonb)->>'passo', 'mese');
select t.uguale('cruscotto', 'la serie somma quanto la spesa', (select sum((s->>'spesa')::numeric) from jsonb_array_elements((:'k365'::jsonb)->'serie') s), 180.00);
select t.uguale('cruscotto', 'sede senza documenti: spesa assente, non zero', cruscotto(gen_random_uuid(), 30)->>'spesa', null::text);

-- ═══ AUDIT ═════════════════════════════════════════════════════════════════
select t.ok('audit', 'catena integra dopo tutte le operazioni', (select bool_and(valida) from verifica_audit()));
select t.uguale('audit', 'origini distinte: app, automazione, sql', (select count(distinct origine) from audit_log where gruppo_id = :'g1'), 3::bigint);
select t.ok('audit', 'modifica manuale: valori prima e dopo', (select prima->>'numero' = 'D1' and dopo->>'numero' = 'D1-bis' and utente_id is not null from audit_log where tabella = 'documenti' and origine = 'app' and dopo ? 'numero' order by id desc limit 1));
select t.rifiuta('audit', 'UPDATE del registro', 'update audit_log set origine = ''x''', 'immutabile');
select t.rifiuta('audit', 'DELETE dal registro', 'delete from audit_log', 'immutabile');
select t.rifiuta('audit', 'TRUNCATE del registro', 'truncate audit_log', 'immutabile');
set role service_role;
select t.rifiuta('audit', 'il ruolo di servizio non scrive nel registro', 'insert into audit_log (gruppo_id, seq, tabella, operazione, origine, creato_il, hash_precedente, hash) values (gen_random_uuid(), 1, ''x'', ''INSERT'', ''x'', now(), ''x'', ''x'')', 'permission denied');
reset role;
alter table audit_log disable trigger audit_log_no_modifica;
update audit_log set dopo = '{"manomesso": true}' where gruppo_id = :'g1' and seq = 7;
select t.uguale('audit', 'contenuto alterato: rilevato alla riga giusta', (select prima_anomalia_seq from verifica_audit(:'g1')), 7::bigint);
delete from audit_log where gruppo_id = :'g2' and seq = 3;
select t.uguale('audit', 'riga intermedia cancellata: rilevata', (select prima_anomalia_seq from verifica_audit(:'g2')), 3::bigint);
alter table audit_log enable trigger audit_log_no_modifica;

-- ═══ ESITO ═════════════════════════════════════════════════════════════════
\pset format aligned
\pset tuples_only off
select area, nome, dettaglio from t.esiti where not ok order by id;
select count(*) filter (where ok) as superati, count(*) filter (where not ok) as falliti from t.esiti;
select case when bool_and(ok) then 'TUTTI I TEST SUPERATI' else 'TEST FALLITI' end as esito from t.esiti \gset
\echo :esito
