\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set chef      '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
\set estraneo  '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}'
\set nuovo     '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}'
select id as r1 from ristoranti where nome = 'Sede principale' \gset
select id as r2 from ristoranti where nome = 'Seconda sede' \gset
select id as r3 from ristoranti where nome = 'Sede estranea' \gset
select gruppo_id as g1 from ristoranti where id = :'r1' \gset
select gruppo_id as g2 from ristoranti where id = :'r3' \gset
select (now() at time zone 'Europe/Rome')::date as oggi \gset
\set come 'select set_config(''request.jwt.claims'','
-- comodità: impersona un utente
create or replace function t.come(p text) returns void language sql as $$ select set_config('request.jwt.claims', p, false) $$;
grant execute on function t.come(text) to public;

-- ═══ PIANI ED ENTITLEMENTS ═════════════════════════════════════════════════
select t.uguale('piani', 'gruppo esistente: piano completo attivo', (select piano_codice || '/' || stato from abbonamenti where gruppo_id = :'g1'), 'completo/attivo');
select t.uguale('piani', 'nuovo gruppo: prova senza scadenza', (select stato || '/' || coalesce(prova_fino_al::text, 'aperta') from abbonamenti where gruppo_id = :'g2'), 'prova/aperta');
select imposta_abbonamento(:'g2', 'essenziale', 'attivo');
set role authenticated; select t.come(:'estraneo');
select t.rifiuta('piani', 'funzione non inclusa: celle', format('select salva_ubicazione(%L, ''{"nome":"Cella","tipo":"cella"}'')', :'r3'), 'non inclusa nel piano');
select t.rifiuta('piani', 'funzione non inclusa: ricette', format('select salva_ricetta(%L, ''{"nome":"X","porzioni":1,"ingredienti":[{}]}'')', :'r3'), 'non inclusa nel piano');
select t.rifiuta('piani', 'funzione non inclusa: magazzino', format('select ricevi_lotto(%L, ''{}'')', :'r3'), 'non inclusa nel piano');
select t.accetta('piani', 'funzione base ancora disponibile', format('select crea_caricamento(%L, ''a.pdf'', 10, repeat(''1'', 64))', :'r3'));
select t.rifiuta('piani', 'un utente non può cambiare il proprio piano', format('select imposta_abbonamento(%L, ''completo'', ''attivo'')', :'g2'), 'permission denied');
select t.rifiuta('piani', 'scrittura diretta sugli abbonamenti', 'update abbonamenti set piano_codice = ''completo''', 'permission denied');
reset role; select t.come('');
select imposta_abbonamento(:'g2', 'completo', 'prova', null, now() - interval '1 day');
set role authenticated; select t.come(:'estraneo');
select t.uguale('piani', 'prova scaduta: stato effettivo', piano_corrente(:'g2')->>'stato', 'scaduto');
select t.rifiuta('piani', 'prova scaduta: niente nuovi caricamenti', format('select crea_caricamento(%L, ''b.pdf'', 10, repeat(''2'', 64))', :'r3'), 'Abbonamento non attivo');
select t.rifiuta('piani', 'prova scaduta: niente nuove operazioni', format('select salva_ubicazione(%L, ''{"nome":"D","tipo":"dispensa"}'')', :'r3'), 'Abbonamento non attivo');
select t.ok('piani', 'prova scaduta: i dati restano leggibili', (select count(*) from documenti where ristorante_id = :'r3') > 0);
select t.rifiuta('piani', 'prova scaduta: niente inviti', format('select crea_invito(%L, ''x@test.invalid'', ''chef'')', :'r3'), 'Abbonamento non attivo');
reset role; select t.come('');
select imposta_abbonamento(:'g2', 'completo', 'attivo', now() + interval '30 days');

-- ═══ INVITI ════════════════════════════════════════════════════════════════
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f1', 'Nuovo@Test.invalid', null);
set role authenticated; select t.come(:'chef');
select t.rifiuta('inviti', 'lo chef non può invitare', format('select crea_invito(%L, ''nuovo@test.invalid'', ''chef'')', :'r1'), 'Solo il titolare');
select t.come(:'estraneo');
select t.rifiuta('inviti', 'titolare di un altro gruppo non può invitare qui', format('select crea_invito(%L, ''nuovo@test.invalid'', ''chef'')', :'r1'), 'Solo il titolare');
select t.come(:'titolare');
select t.rifiuta('inviti', 'email non valida', format('select crea_invito(%L, ''non-una-email'', ''chef'')', :'r1'), 'non valido');
select t.rifiuta('inviti', 'chi ha già accesso non si invita di nuovo', format('select crea_invito(%L, ''chef@test.invalid'', ''contabile'')', :'r1'), 'ha già accesso');
select crea_invito(:'r1', ' NUOVO@test.invalid ', 'sola_lettura') as inv1 \gset
select (:'inv1'::jsonb)->>'token' as tok1, (:'inv1'::jsonb)->>'invito_id' as invito \gset
select crea_invito(:'r1', 'nuovo@test.invalid', 'chef') as inv2 \gset
select (:'inv2'::jsonb)->>'token' as tok2 \gset
select t.uguale('inviti', 'invito duplicato: rinnovato, non doppio', ((:'inv2'::jsonb)->>'rinnovato') || '/' || (select count(*) from inviti where email = 'nuovo@test.invalid'), 'true/1');
select t.uguale('inviti', 'il vecchio token non vale più', anteprima_invito(:'tok1')->>'stato', 'non_valido');
select t.uguale('inviti', 'stato iniziale: non inviato', (select invio_stato from inviti where id = :'invito'), 'non_inviato');
select segna_invio_invito(:'invito', false, 'provider non configurato');
select t.uguale('inviti', 'invio fallito registrato come tale', (select invio_stato || '/' || invii from inviti where id = :'invito'), 'fallito/1');
select t.rifiuta('inviti', 'l''hash del token non è leggibile', 'select * from inviti_segreti', 'permission denied');
reset role; set role anon; select t.come('{"role":"anon"}');
select t.uguale('inviti', 'anteprima senza sessione', anteprima_invito(:'tok2')->>'stato' || '/' || (anteprima_invito(:'tok2')->>'ruolo'), 'valido/chef');
select t.rifiuta('inviti', 'accettazione senza sessione', format('select accetta_invito(%L)', :'tok2'), 'permission denied');
reset role; set role authenticated; select t.come(:'estraneo');
select t.rifiuta('inviti', 'un altro utente non può usare il link', format('select accetta_invito(%L)', :'tok2'), 'altro indirizzo');
select t.come(:'nuovo');
select t.rifiuta('inviti', 'email non verificata', format('select accetta_invito(%L)', :'tok2'), 'Conferma prima');
select t.uguale('inviti', 'prima di accettare: nessun accesso', (select count(*) from documenti), 0::bigint);
reset role; select t.come('');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000f1';
set role authenticated; select t.come(:'nuovo');
select t.uguale('inviti', 'accettazione: ruolo assegnato', accetta_invito(:'tok2')->>'ruolo', 'chef');
select t.ok('inviti', 'dopo l''accettazione: accesso alla sola sede invitata', (select count(*) from documenti where ristorante_id = :'r1') > 0 and (select count(*) from documenti where ristorante_id <> :'r1') = 0);
select t.rifiuta('inviti', 'token non riutilizzabile', format('select accetta_invito(%L)', :'tok2'), 'non valido o già utilizzato');
select t.come(:'titolare');
select t.uguale('inviti', 'stato accettato', (select stato from inviti where id = :'invito'), 'accettato');
select t.rifiuta('inviti', 'invito accettato non revocabile', format('select revoca_invito(%L)', :'invito'), 'non è più in attesa');
select (crea_invito(:'r1', 'scaduto@test.invalid', 'chef'))->>'token' as tok3 \gset
select (crea_invito(:'r1', 'revocato@test.invalid', 'chef')) as inv4 \gset
select revoca_invito(((:'inv4'::jsonb)->>'invito_id')::uuid);
select t.uguale('inviti', 'invito revocato: link non valido', anteprima_invito((:'inv4'::jsonb)->>'token')->>'stato', 'non_valido');
reset role; select t.come('');
update inviti set scade_il = now() - interval '1 hour' where email = 'scaduto@test.invalid';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'scaduto@test.invalid');
set role authenticated; select t.come('{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}');
select t.uguale('inviti', 'anteprima di un invito scaduto', anteprima_invito(:'tok3')->>'stato', 'scaduto');
select t.rifiuta('inviti', 'invito scaduto non accettabile', format('select accetta_invito(%L)', :'tok3'), 'scaduto');
reset role; select t.come('');
select t.ok('inviti', 'audit: creazione, invio, accettazione e revoca registrati', (select count(*) >= 6 from audit_log where tabella = 'inviti'));
select t.uguale('inviti', 'audit: nessun token o hash registrato', (select count(*) from audit_log where tabella like 'inviti%' and (dopo::text ilike '%token%' or prima::text ilike '%token%')), 0::bigint);
update piano_limiti set valore = (select (piano_corrente(:'g1')->>'utenti')::int from (select set_config('request.jwt.claims', :'titolare', true)) x) where piano_codice = 'completo' and chiave = 'utenti';
set role authenticated; select t.come(:'titolare');
select t.rifiuta('piani', 'limite utenti del piano raggiunto', format('select crea_invito(%L, ''oltre@test.invalid'', ''chef'')', :'r1'), 'piano superiore');
reset role; select t.come('');
update piano_limiti set valore = null where piano_codice = 'completo';
set role authenticated; select t.come(:'titolare');
select imposta_membro(:'r1', 'nuovo@test.invalid', 'sola_lettura');
select salva_ubicazione(:'r1', '{"nome":"Dispensa","tipo":"dispensa"}') as dispensa \gset
select t.come(:'nuovo');
select t.rifiuta('inviti', 'cambio di ruolo: effetto immediato', format('select salva_ubicazione(%L, ''{"nome":"Altra","tipo":"dispensa"}'')', :'r1'), 'Permesso negato');

-- ═══ UNITÀ E CONVERSIONI ═══════════════════════════════════════════════════
select id as m_costata from articoli_master where nome = 'Costata di manzo' \gset
select t.come(:'titolare');
select t.uguale('conversioni', 'g → kg (fisica)', app.converti(:'m_costata', 250, 'g', 'kg'), 0.25);
select t.uguale('conversioni', 'cl → lt (fisica)', app.converti(:'m_costata', 75, 'cl', 'lt'), 0.75);
select t.uguale('conversioni', 'pz → kg senza dato: non convertibile', app.converti(:'m_costata', 4, 'pz', 'kg'), null::numeric);
select t.rifiuta('conversioni', 'la conversione fisica non si dichiara', format('select imposta_conversione(%L, ''g'', ''kg'', 0.5)', :'m_costata'), 'fisica');
select t.rifiuta('conversioni', 'fattore non valido', format('select imposta_conversione(%L, ''pz'', ''kg'', 0)', :'m_costata'), 'maggiore di zero');
select imposta_conversione(:'m_costata', 'pz', 'kg', 1.2, 'Peso medio dichiarato dal fornitore', 'fornitore') \g /dev/null
select t.uguale('conversioni', 'pz → kg dichiarata', app.converti(:'m_costata', 2, 'pz', 'kg'), 2.4);
select t.uguale('conversioni', 'verso inverso', round(app.converti(:'m_costata', 600, 'g', 'pz'), 3), 0.500);
select imposta_conversione(:'m_costata', 'pz', 'kg', 1.25, 'Pesata in cucina') \g /dev/null
select t.uguale('conversioni', 'nuova versione: la precedente resta, disattivata', (select string_agg(versione || ':' || attiva || ':' || provenienza, ',' order by versione) from conversioni_unita where master_id = :'m_costata'), '1:false:fornitore,2:true:manuale');
select t.uguale('conversioni', 'vale la versione attiva', app.converti(:'m_costata', 2, 'pz', 'kg'), 2.5);
select t.come(:'contabile');
select t.rifiuta('conversioni', 'il contabile non dichiara conversioni', format('select imposta_conversione(%L, ''conf'', ''kg'', 5)', :'m_costata'), 'Permesso negato');

-- ═══ MAGAZZINO: LOTTI, FEFO/FIFO, MOVIMENTI ════════════════════════════════
select t.come(:'chef');
select t.rifiuta('magazzino', 'le soglie di una cella spettano al titolare', format('select salva_ubicazione(%L, ''{"nome":"Cella 1","tipo":"cella"}'')', :'r1'), 'Permesso negato');
select id as riga_costata from storico_prezzi where master_id = :'m_costata' and numero_riga = 1 order by data_rilevazione limit 1 \gset
select ricevi_lotto(:'r1', jsonb_build_object('riga_id', :'riga_costata', 'ubicazione_id', :'dispensa', 'scadenza', :'oggi'::date + 10)) as l1 \gset
select t.uguale('magazzino', 'ricevimento dalla stessa riga: idempotente', ricevi_lotto(:'r1', jsonb_build_object('riga_id', :'riga_costata')), :'l1'::uuid);
select t.uguale('magazzino', 'un solo lotto e un solo movimento', (select count(*) from lotti where riga_id = :'riga_costata') + (select count(*) from movimenti where lotto_id = :'l1'), 2::bigint);
select t.uguale('magazzino', 'costo storico e valuta dalla riga', (select costo_unitario || ' ' || valuta || '/' || unita from lotti where id = :'l1'), '60.0000 EUR/pz');
select ricevi_lotto(:'r1', jsonb_build_object('master_id', :'m_costata', 'quantita', 3, 'unita', 'kg', 'scadenza', :'oggi'::date + 3, 'codice_lotto', 'B', 'chiave', 'man-2')) as l2 \gset
select ricevi_lotto(:'r1', jsonb_build_object('master_id', :'m_costata', 'quantita', 5, 'unita', 'kg', 'ricevuto_il', :'oggi'::date - 20, 'codice_lotto', 'C')) as l3 \gset
select ricevi_lotto(:'r1', jsonb_build_object('master_id', :'m_costata', 'quantita', 5, 'unita', 'kg', 'ricevuto_il', :'oggi'::date - 40, 'codice_lotto', 'D')) as l4 \gset
select t.uguale('magazzino', 'costo non indicato: resta vuoto, non stimato', (select costo_unitario from lotti where id = :'l2'), null::numeric);
select t.uguale('fefo', 'ordine: scadenza più vicina, poi le altre, poi senza scadenza per arrivo', (select string_agg(coalesce(codice_lotto, 'A') || ':' || criterio, ',') from suggerisci_prelievo(:'r1', :'m_costata', 100, 'kg')), 'B:FEFO,A:FEFO,D:FIFO,C:FIFO');
select t.uguale('fefo', 'quantità ripartita sui lotti, nell''unità di ciascuno', (select string_agg(da_prelevare::text, ',') from suggerisci_prelievo(:'r1', :'m_costata', 4, 'kg')), '3.000,0.800');
select t.rifiuta('magazzino', 'consumo oltre la giacenza', format('select registra_movimento(%L, ''consumo'', 99)', :'l2'), 'superiore alla giacenza');
select t.rifiuta('magazzino', 'scarto senza motivo', format('select registra_movimento(%L, ''scarto'', 1)', :'l2'), 'motivo è obbligatorio');
select registra_movimento(:'l2', 'consumo', 1, null, 'servizio-1') as mov1 \gset
select t.uguale('magazzino', 'stesso movimento inviato due volte: uno solo', registra_movimento(:'l2', 'consumo', 1, null, 'servizio-1'), :'mov1'::uuid);
select registra_movimento(:'l2', 'scarto', 0.5, 'Rifilatura non recuperabile') \g /dev/null
select t.uguale('magazzino', 'giacenza = somma dei movimenti', (select quantita_residua from v_giacenze where id = :'l2'), 1.500);
select t.rifiuta('magazzino', 'storno senza motivo', format('select storna_movimento(%L, '''')', :'mov1'), 'motivo dello storno');
select storna_movimento(:'mov1', 'Registrato sul lotto sbagliato') \g /dev/null
select t.uguale('magazzino', 'storno: giacenza ripristinata, originale conservato', (select quantita_residua::text || '/' || (select count(*) from movimenti where lotto_id = :'l2') from v_giacenze where id = :'l2'), '2.500/4');
select t.rifiuta('magazzino', 'doppio storno', format('select storna_movimento(%L, ''di nuovo'')', :'mov1'), 'già stornato');
select conta_lotto(:'l2', 2.2, 'Inventario di fine mese') \g /dev/null
select t.uguale('inventario', 'conteggio: rettifica pari alla differenza', (select quantita::text || '/' || (motivo like 'Inventario di fine mese%')::text from movimenti where lotto_id = :'l2' and tipo = 'rettifica'), '-0.300/true');
select t.uguale('inventario', 'conteggio uguale al registro: nessun movimento', conta_lotto(:'l2', 2.2), null::uuid);
select imposta_stato_lotto(:'l2', 'richiamato', 'Richiamo del fornitore');
select t.rifiuta('lotti', 'lotto richiamato: non utilizzabile', format('select registra_movimento(%L, ''consumo'', 1)', :'l2'), 'richiamato');
select t.accetta('lotti', 'lotto richiamato: reso consentito', format('select registra_movimento(%L, ''reso'', 2.2, ''Reso per richiamo'')', :'l2'));
select t.ok('fefo', 'lotto richiamato escluso dai suggerimenti', (select count(*) = 0 from suggerisci_prelievo(:'r1', :'m_costata', 100, 'kg') where codice_lotto = 'B'));
select trasferisci_lotto(:'l3', 2, :'dispensa') as l3b \gset
select t.uguale('trasferimenti', 'parziale: nuovo lotto, quantità conservata', (select string_agg(quantita_residua::text, '+' order by quantita_residua) from v_giacenze where id in (:'l3', :'l3b')), '2.000+3.000');
select t.rifiuta('trasferimenti', 'tra sedi: lo chef non può', format('select trasferisci_lotto(%L, 1, null, %L)', :'l3', :'r2'), 'Permesso negato');
select t.rifiuta('magazzino', 'registro immutabile: UPDATE', 'update movimenti set quantita = 1', 'permission denied');
select t.come(:'titolare');
select t.accetta('trasferimenti', 'tra sedi dello stesso gruppo: il titolare può', format('select trasferisci_lotto(%L, 1, null, %L)', :'l3', :'r2'));
select t.rifiuta('trasferimenti', 'verso un altro gruppo: mai', format('select trasferisci_lotto(%L, 1, null, %L)', :'l3', :'r3'), 'Permesso negato');
select t.uguale('trasferimenti', 'uscita ed entrata si compensano', (select sum(quantita) from movimenti where riferimento like 'trasferimento:%'), 0.000);
reset role; select t.come('');
select t.rifiuta('magazzino', 'registro immutabile anche per l''amministratore', format('delete from movimenti where lotto_id = %L', :'l2'), 'immutabile');
set role authenticated; select t.come(:'estraneo');
select t.uguale('magazzino', 'altro gruppo: nessun lotto, movimento o ubicazione', (select count(*) from lotti) + (select count(*) from movimenti) + (select count(*) from ubicazioni) + (select count(*) from conversioni_unita), 0::bigint);
select t.rifiuta('magazzino', 'altro gruppo: nessun movimento su lotti altrui', format('select registra_movimento(%L, ''consumo'', 1)', :'l3'), 'Permesso negato');

-- ═══ CELLE, SENSORI, ALLARMI ═══════════════════════════════════════════════
select t.come(:'titolare');
select t.rifiuta('celle', 'monitoraggio senza soglie', format('select salva_ubicazione(%L, ''{"nome":"Cella X","tipo":"cella","monitorata":true}'')', :'r1'), 'almeno una soglia');
select salva_ubicazione(:'r1', '{"nome":"Cella carni","tipo":"cella","monitorata":true,"temp_max":4,"allarme_dopo_min":20,"isteresi":1,"critico_dopo_min":60,"silenzio_dopo_min":90}') as cella \gset
select t.uguale('celle', 'nessuna lettura: non è "ok"', (select stato_temperatura from v_ubicazioni where id = :'cella'), 'nessun_dato');
reset role; select t.come('');
select controlla_ubicazioni() \g /dev/null
set role authenticated; select t.come(:'titolare');
select t.uguale('celle', 'nessuna lettura: allarme dati mancanti', (select tipo || '/' || stato from allarmi where ubicazione_id = :'cella'), 'dati_mancanti/aperto');
select t.come(:'chef');
select registra_lettura(:'cella', 3.0, now() - interval '80 minutes') \g /dev/null
select t.uguale('celle', 'lettura valida: dati mancanti chiuso da solo', (select stato || '/' || risolto_auto from allarmi where ubicazione_id = :'cella' and tipo = 'dati_mancanti'), 'risolto/true');
select t.uguale('celle', 'lettura in intervallo: ok', (select stato_temperatura from v_ubicazioni where id = :'cella'), 'ok');
select registra_lettura(:'cella', 6.0, now() - interval '30 minutes') \g /dev/null
select t.uguale('celle', 'fuori intervallo da poco: nessun allarme, ma non "ok"', (select (select count(*) from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta') || '/' || stato_temperatura from v_ubicazioni where id = :'cella'), '0/fuori_intervallo');
select registra_lettura(:'cella', 6.8, now() - interval '5 minutes') \g /dev/null
select t.uguale('celle', 'fuori intervallo oltre la durata: allarme', (select stato || '/' || severita || '/' || valore_estremo from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta'), 'aperto/attenzione/6.80');
select registra_lettura(:'cella', 3.5, now() - interval '2 minutes') \g /dev/null
select t.uguale('celle', 'isteresi: rientro insufficiente, allarme ancora aperto', (select stato from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta'), 'aperto');
select t.rifiuta('celle', 'chiusura senza nota', format('select gestisci_allarme(%L, ''risolvi'')', (select id from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta')), 'cosa è stato fatto');
select gestisci_allarme((select id from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta'), 'prendi', 'Controllo la porta');
select t.uguale('celle', 'presa in carico', (select stato || '/' || (preso_da is not null) from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta'), 'in_carico/true');
select registra_lettura(:'cella', 2.9, now()) \g /dev/null
select t.uguale('celle', 'rientro oltre l''isteresi: chiusura automatica', (select stato || '/' || risolto_auto from allarmi where ubicazione_id = :'cella' and tipo = 'temperatura_alta'), 'risolto/true');
select t.rifiuta('celle', 'lettura nel futuro', format('select registra_lettura(%L, 3, now() + interval ''1 hour'')', :'cella'), 'nel futuro');
select t.rifiuta('celle', 'valore implausibile a mano', format('select registra_lettura(%L, 300)', :'cella'), 'fuori dalla scala');
select t.rifiuta('celle', 'lo chef non collega sensori', format('select crea_sensore(%L, ''Sonda'')', :'cella'), 'Permesso negato');
select t.come(:'contabile');
select t.rifiuta('celle', 'il contabile non registra letture', format('select registra_lettura(%L, 3)', :'cella'), 'Permesso negato');
select t.come(:'titolare');
select crea_sensore(:'cella', 'Sonda 1', 'EXT-1') as sens \gset
select (:'sens'::jsonb)->>'chiave' as chiave, (:'sens'::jsonb)->>'sensore_id' as sensore \gset
reset role; set role anon; select t.come('{"role":"anon"}');
select t.uguale('sensori', 'ingestione con la chiave del sensore', ingest_lettura(:'chiave', 3.1, now(), 'evt-1')->>'qualita', 'valida');
select ingest_lettura(:'chiave', 3.1, now(), 'evt-1') \g /dev/null
select t.rifiuta('sensori', 'chiave errata', 'select ingest_lettura(''ks_sbagliata'', 3)', 'non valida');
select t.uguale('sensori', 'valore fuori scala: marcato, non scartato', ingest_lettura(:'chiave', 999, now(), 'evt-2')->>'qualita', 'fuori_scala');
reset role; select t.come('');
select t.uguale('sensori', 'letture idempotenti: due eventi, due righe', (select count(*) from letture where sensore_id = :'sensore'), 2::bigint);
select t.uguale('sensori', 'fuori scala: allarme dedicato, temperatura invariata', (select (select count(*) from allarmi where ubicazione_id = :'cella' and tipo = 'fuori_scala' and stato = 'aperto') || '/' || ultima_temperatura from v_ubicazioni where id = :'cella'), '1/3.10');
select t.rifiuta('sensori', 'letture immutabili', 'update letture set valore = 0', 'immutabile');
insert into letture (ristorante_id, ubicazione_id, valore, rilevata_il, fonte) select :'r1', :'cella', 9, now() - interval '200 minutes', 'manuale';
-- riconnessione dopo silenzio: le vecchie letture non contano come recenti
update ubicazioni set silenzio_dopo_min = 1 where id = :'cella';
select pg_sleep(0); select controlla_ubicazioni() \g /dev/null
select t.uguale('sensori', 'ultima lettura recente: nessun silenzio', (select count(*) from allarmi where ubicazione_id = :'cella' and tipo = 'dati_mancanti' and stato <> 'risolto'), 0::bigint);
set role authenticated; select t.come(:'titolare');
select imposta_stato_sensore(:'sensore', 'da_calibrare');
reset role; set role anon; select t.come('{"role":"anon"}');
select t.uguale('sensori', 'sensore da calibrare: lettura marcata', ingest_lettura(:'chiave', 3.3, now(), 'evt-3')->>'qualita', 'sensore_da_calibrare');
reset role; set role authenticated; select t.come(:'titolare');
select imposta_stato_sensore(:'sensore', 'disattivato');
reset role; set role anon; select t.come('{"role":"anon"}');
select t.rifiuta('sensori', 'sensore disattivato: chiave revocata', format('select ingest_lettura(%L, 3)', :'chiave'), 'non valida');
reset role;

-- ═══ RICETTE E FOOD COST ═══════════════════════════════════════════════════
set role authenticated; select t.come(:'titolare');
select crea_master(:'g1', 'Olio extravergine', 'Oli e condimenti', 'lt') as m_olio \gset
select conferma_abbinamento((select alias_id from storico_prezzi where descrizione = 'Olio extravergine' and fornitore_id = (select id from fornitori where ragione_sociale = 'Fornitore Uno') limit 1), :'m_olio');
select t.come(:'contabile');
select t.rifiuta('ricette', 'il contabile non modifica le ricette', format('select salva_ricetta(%L, ''{"nome":"X","porzioni":1,"ingredienti":[{}]}'')', :'r1'), 'Permesso negato');
select t.come(:'chef');
select t.rifiuta('ricette', 'ricetta senza ingredienti', format('select salva_ricetta(%L, ''{"nome":"Vuota","porzioni":1,"ingredienti":[]}'')', :'r1'), 'almeno un ingrediente');
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Costata alla brace', 'porzioni', 2, 'prezzo_vendita', 30, 'ingredienti', jsonb_build_array(
  jsonb_build_object('master_id', :'m_costata', 'quantita', 300, 'unita', 'g'),
  jsonb_build_object('master_id', :'m_olio', 'quantita', 20, 'unita', 'ml')))) as ric \gset
select costo_ricetta(:'ric') as c \gset
-- costata: ultimo prezzo normalizzato 80 €/1,5 kg = 53,3333 €/kg × 0,3 kg = 16,00; olio: 40 €/lt × 0,02 lt = 0,80
select t.uguale('ricette', 'costo totale = Σ quantità × ultimo prezzo netto', ((:'c'::jsonb)->>'costo_totale')::numeric, 16.80);
select t.uguale('ricette', 'costo per porzione', ((:'c'::jsonb)->>'costo_porzione')::numeric, 8.40);
select t.uguale('ricette', 'margine e incidenza', ((:'c'::jsonb)->>'margine') || '/' || ((:'c'::jsonb)->>'food_cost_pct'), '21.60/28.0');
select t.ok('ricette', 'ogni riga cita il documento da cui viene il prezzo', (:'c'::jsonb)->'righe'->0->'fonte'->>'numero' is not null);
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Costata alla brace', 'porzioni', 2, 'prezzo_vendita', 30, 'ingredienti', jsonb_build_array(
  jsonb_build_object('master_id', :'m_costata', 'quantita', 240, 'unita', 'g', 'quantita_tipo', 'netta'),
  jsonb_build_object('master_id', :'m_olio', 'quantita', 20, 'unita', 'ml'))), :'ric') \g /dev/null
select costo_ricetta(:'ric') as c \gset
select t.uguale('ricette', 'quantità netta senza resa: calcolo incompleto, non stimato', ((:'c'::jsonb)->>'completo') || '/' || coalesce((:'c'::jsonb)->>'costo_totale', 'null'), 'false/null');
select t.ok('ricette', 'il motivo dice quale dato manca', (:'c'::jsonb)->'righe'->0->>'motivo' like '%resa%');
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Costata alla brace', 'porzioni', 2, 'prezzo_vendita', 30, 'ingredienti', jsonb_build_array(
  jsonb_build_object('master_id', :'m_costata', 'quantita', 240, 'unita', 'g', 'quantita_tipo', 'netta', 'resa_pct', 80, 'resa_fonte', 'Prova di cucina'),
  jsonb_build_object('master_id', :'m_olio', 'quantita', 1, 'unita', 'pz'))), :'ric') \g /dev/null
select costo_ricetta(:'ric') as c \gset
select t.uguale('ricette', 'resa dichiarata: 240 g netti ÷ 80% = 300 g lordi', ((:'c'::jsonb)->'righe'->0->>'quantita_lorda') || '/' || ((:'c'::jsonb)->'righe'->0->>'costo'), '300.0000/16.0000');
select t.ok('ricette', 'unità incompatibile: non convertibile, con la conversione che serve', (:'c'::jsonb)->'righe'->1->>'motivo' like 'Non convertibile%pz%lt%');
select t.uguale('ricette', 'versioni: tre salvataggi, una sola attiva', (select count(*) || '/' || count(*) filter (where stato = 'attiva') from ricette_versioni where ricetta_id = :'ric'), '3/1');
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Salsa verde', 'tipo', 'semilavorato', 'porzioni', 1, 'resa_quantita', 0.5, 'resa_unita', 'lt',
  'ingredienti', jsonb_build_array(jsonb_build_object('master_id', :'m_olio', 'quantita', 100, 'unita', 'ml')))) as salsa \gset
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Costata alla brace', 'porzioni', 2, 'prezzo_vendita', 30, 'codice_pos', 'P01', 'ingredienti', jsonb_build_array(
  jsonb_build_object('master_id', :'m_costata', 'quantita', 300, 'unita', 'g'),
  jsonb_build_object('sotto_ricetta_id', :'salsa', 'quantita', 50, 'unita', 'ml'))), :'ric') \g /dev/null
-- salsa: 0,1 lt × 40 = 4,00 € per 0,5 lt → 50 ml = 0,40 €
select t.uguale('ricette', 'semilavorato: costo in proporzione alla resa', (costo_ricetta(:'ric')->>'costo_totale')::numeric, 16.40);
select registra_vendita(:'r1', :'ric', :'oggi'::date - 1, 10, 'cena', 'import', 'pos-2026-1') as vend \gset
select t.uguale('vendite', 'import ripetuto: nessun doppione', registra_vendita(:'r1', :'ric', :'oggi'::date - 1, 10, 'cena', 'import', 'pos-2026-1'), :'vend'::uuid);
select t.rifiuta('vendite', 'data futura', format('select registra_vendita(%L, %L, %L, 1)', :'r1', :'ric', :'oggi'::date + 1), 'non valida');
select margini_ricette(:'r1', :'oggi'::date - 7, :'oggi'::date)->0 as mg \gset
select t.uguale('vendite', 'margine del periodo = porzioni × margine unitario', ((:'mg'::jsonb)->>'porzioni_vendute') || '/' || ((:'mg'::jsonb)->>'margine_totale') || '/' || ((:'mg'::jsonb)->'per_servizio'->>'cena'), '10.000/218.00/10.000');
select registra_movimento(:'l1', 'consumo', 1.5, null, 'cons-costata') \g /dev/null
select scostamenti_consumo(:'r1', :'oggi'::date - 7, :'oggi'::date) as sc \gset
-- teorico: 10 porzioni × 300 g ÷ 2 = 1,5 kg; effettivo: 1,5 pz × 1,25 kg = 1,875 kg (più gli scarti a parte)
select t.uguale('scostamenti', 'teorico dalle vendite, effettivo dai movimenti, nella stessa unità', (select (x->>'teorico') || '/' || (x->>'effettivo') || '/' || (x->>'scostamento') || '/' || (x->>'unita') from jsonb_array_elements(:'sc'::jsonb) x where x->>'articolo' = 'Costata di manzo'), '1.500/1.875/0.375/kg');
select t.uguale('scostamenti', 'movimenti stornati esclusi dal consumo effettivo', (select x->>'perdite' from jsonb_array_elements(:'sc'::jsonb) x where x->>'articolo' = 'Costata di manzo'), '0.500');
select storna_vendita(:'vend') \g /dev/null
select t.uguale('vendite', 'storno: porzioni a zero, registrazione conservata', (margini_ricette(:'r1', :'oggi'::date - 7, :'oggi'::date)->0->>'porzioni_vendute') || '/' || (select count(*) from vendite), '0.000/2');
select t.come(:'estraneo');
select t.rifiuta('ricette', 'altro gruppo: costo non consultabile', format('select costo_ricetta(%L)', :'ric'), 'Permesso negato');
select t.uguale('ricette', 'altro gruppo: nessuna ricetta o vendita', (select count(*) from ricette) + (select count(*) from vendite) + (select count(*) from ricette_ingredienti), 0::bigint);

-- ═══ FORNITORI ═════════════════════════════════════════════════════════════
select t.come(:'chef');
select id as forn from fornitori where ragione_sociale = 'Fornitore Uno' \gset
select registra_consegna(:'r1', jsonb_build_object('fornitore_id', :'forn', 'giorno', :'oggi'::date - 3, 'puntuale', true, 'completa', true)) \g /dev/null
select scorecard_fornitori(:'r1', :'oggi'::date - 30, :'oggi'::date)->'fornitori' as sc \gset
select t.uguale('scorecard', 'campione insufficiente: nessun punteggio', (select (x->>'campione_sufficiente') || '/' || coalesce(x->>'punteggio', 'null') from jsonb_array_elements(:'sc'::jsonb) x where x->>'ragione_sociale' = 'Fornitore Uno'), 'false/null');
select registra_consegna(:'r1', jsonb_build_object('fornitore_id', :'forn', 'giorno', :'oggi'::date - g, 'puntuale', g <> 4, 'completa', true)) from generate_series(4, 7) g \g /dev/null
select apri_non_conformita(:'r1', jsonb_build_object('lotto_id', :'l1', 'tipo', 'qualita', 'descrizione', 'Colore non conforme')) as nc \gset
select scorecard_fornitori(:'r1', :'oggi'::date - 30, :'oggi'::date)->'fornitori' as sc \gset
-- 5 consegne: 4 puntuali (80), 5 complete (100), 1 non conformità (80); nessun prezzo confrontato nel periodo → escluso
select t.uguale('scorecard', 'indicatori con il numero di eventi', (select concat_ws('/', x->>'n_consegne', x->>'puntualita', x->>'completezza', x->>'conformita', coalesce(x->>'prezzi', 'n.d.')) from jsonb_array_elements(:'sc'::jsonb) x where x->>'ragione_sociale' = 'Fornitore Uno'), '5/80.0/100.0/80.0/n.d.');
select t.uguale('scorecard', 'punteggio = media pesata dei soli indicatori disponibili', (select (x->>'punteggio')::numeric from jsonb_array_elements(:'sc'::jsonb) x where x->>'ragione_sociale' = 'Fornitore Uno'), 86.7);
select t.rifiuta('scorecard', 'lo chef non cambia i pesi', format('select imposta_scorecard(%L, ''{"campione_minimo":1,"pesi":{"puntualita":1,"completezza":1,"conformita":1,"prezzi":1}}'')', :'g1'), 'Permesso negato');
select t.come(:'titolare');
select t.rifiuta('scorecard', 'configurazione non valida', format('select imposta_scorecard(%L, ''{"campione_minimo":0,"pesi":{}}'')', :'g1'), 'almeno 1');
select imposta_scorecard(:'g1', '{"campione_minimo":5,"pesi":{"puntualita":3,"completezza":0,"conformita":1,"prezzi":1}}');
select t.uguale('scorecard', 'pesi configurabili: il punteggio cambia', (select (x->>'punteggio')::numeric from jsonb_array_elements(scorecard_fornitori(:'r1', :'oggi'::date - 30, :'oggi'::date)->'fornitori') x where x->>'ragione_sociale' = 'Fornitore Uno'), 80.0);
select t.ok('fornitori', 'confronto solo tra prezzi nella stessa unità', (select bool_and((x->>'confrontabile')::boolean = (x->>'prezzo' is not null)) and count(*) >= 1 from jsonb_array_elements(confronta_fornitori(:'r1', :'m_olio')) x));
select t.come(:'chef');
select proponi_ordine(:'r1', :'forn', jsonb_build_array(jsonb_build_object('master_id', :'m_olio', 'quantita', 10, 'unita', 'lt'))) as ord \gset
select t.rifiuta('ordini', 'lo chef propone ma non approva', format('select decidi_ordine(%L, ''approvato'')', :'ord'), 'Permesso negato');
select chiudi_non_conformita(:'nc', 'Sostituito dal fornitore');
select t.come(:'titolare');
select decidi_ordine(:'ord', 'approvato');
select t.rifiuta('ordini', 'decisione già presa', format('select decidi_ordine(%L, ''annullato'')', :'ord'), 'non è più una bozza');
select t.uguale('ordini', 'approvazione registrata con autore', (select stato || '/' || (deciso_da is not null) from ordini_proposti where id = :'ord'), 'approvato/true');

-- ═══ MANUTENZIONE ══════════════════════════════════════════════════════════
select t.come(:'contabile');
select t.rifiuta('manutenzione', 'il contabile non gestisce le attrezzature', format('select salva_attrezzatura(%L, ''{"nome":"Forno"}'')', :'r1'), 'Permesso negato');
select t.come(:'chef');
select salva_attrezzatura(:'r1', '{"nome":"Abbattitore","marca_modello":"Modello di prova","contatore":100,"contatore_unita":"ore"}') as att \gset
select t.rifiuta('manutenzione', 'scadenza obbligatoria senza fonte', format('select salva_piano_manutenzione(%L, ''{"titolo":"Verifica","obbligo":"obbligatoria","ogni_giorni":365}'')', :'att'), 'norma o il documento');
select salva_piano_manutenzione(:'att', '{"titolo":"Pulizia condensatore","obbligo":"raccomandata","fonte":"Manuale del costruttore","ogni_giorni":30,"ogni_contatore":500}') as piano \gset
select t.uguale('manutenzione', 'prossima scadenza a data e a contatore', (select (prossima_data - :'oggi'::date) || '/' || prossimo_contatore from manutenzioni_piani where id = :'piano'), '30/600.0');
select apri_intervento(:'att', '{"tipo":"guasto","descrizione":"Non raggiunge la temperatura","indisponibile":true}') as guasto \gset
select t.uguale('manutenzione', 'guasto: attrezzatura non disponibile', (select stato from attrezzature where id = :'att'), 'guasta');
select t.rifiuta('manutenzione', 'chiusura senza esito', format('select chiudi_intervento(%L, ''{}'')', :'guasto'), 'esito');
select chiudi_intervento(:'guasto', '{"esito":"Sostituita la ventola","ricambi":"Ventola","costo":120,"eseguito_da":"Tecnico esterno"}');
select t.uguale('manutenzione', 'chiusura: di nuovo operativa, costo e fermo registrati', (select a.stato || '/' || i.costo || ' ' || i.valuta || '/' || (i.indisponibile_al is not null) from interventi i join attrezzature a on a.id = i.attrezzatura_id where i.id = :'guasto'), 'operativa/120.00 EUR/true');
reset role; select t.come('');
update manutenzioni_piani set prossima_data = :'oggi'::date - 2 where id = :'piano';
set role authenticated; select t.come(:'chef');
select t.uguale('manutenzione', 'scadenza superata', (select stato_scadenza from v_scadenze_manutenzione where id = :'piano'), 'scaduta');
select apri_intervento(:'att', jsonb_build_object('piano_id', :'piano', 'descrizione', 'Pulizia programmata')) as interv \gset
select chiudi_intervento(:'interv', '{"esito":"Eseguita","contatore":650}');
select t.uguale('manutenzione', 'intervento chiuso: scadenza spostata in avanti', (select (prossima_data - :'oggi'::date) || '/' || prossimo_contatore || '/' || stato_scadenza from v_scadenze_manutenzione where id = :'piano'), '30/1150.0/in_regola');
select t.come(:'estraneo');
select t.uguale('manutenzione', 'altro gruppo: nessun dato', (select count(*) from attrezzature) + (select count(*) from interventi) + (select count(*) from consegne) + (select count(*) from non_conformita) + (select count(*) from ordini_proposti) + (select count(*) from allarmi) + (select count(*) from letture) + (select count(*) from inviti), 0::bigint);
reset role; select t.come('');
select t.ok('audit', 'catena integra con i nuovi moduli', (select bool_and(valida) from verifica_audit()));
select t.ok('audit', 'i nuovi moduli sono registrati', (select count(distinct tabella) >= 9 from audit_log where tabella in ('inviti','abbonamenti','conversioni_unita','ubicazioni','sensori','allarmi','lotti','ricette','ricette_versioni','consegne','non_conformita','ordini_proposti','attrezzature','manutenzioni_piani','interventi')));
