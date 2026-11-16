\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set chef      '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
select id as r1 from ristoranti where nome = 'Sede principale' \gset

set role authenticated; select t.come(:'titolare');
select salva_ubicazione(:'r1', '{"nome":"Frigo prova chiamate","tipo":"cella","monitorata":true,"temp_max":5,"allarme_dopo_min":0,"isteresi":1}') as frigo \gset
select t.rifiuta('chiamate', 'attivazione senza numeri', format('select imposta_chiamate(%L, ''{"attive":true}'')', :'r1'), 'almeno un numero');
select t.rifiuta('chiamate', 'numero non valido', format('select salva_contatto_allarme(%L, null, ''Prova'', ''12ab'', 1)', :'r1'), 'non valido');
select salva_contatto_allarme(:'r1', null, 'Responsabile prova', '333 000 0001', 1) as c1 \gset
select salva_contatto_allarme(:'r1', null, 'Riserva prova', '+39 333 000 0002', 2) as c2 \gset
select t.uguale('chiamate', 'cellulare italiano normalizzato', (select telefono from contatti_allarme where id = :'c1'), '+393330000001');
select imposta_chiamate(:'r1', '{"attive":true,"attesa_min":5,"giri":1,"sms_riserva":true}');
select t.come(:'contabile');
select t.uguale('chiamate', 'il contabile non vede i numeri', (select count(*) from contatti_allarme), 0::bigint);
select t.rifiuta('chiamate', 'il contabile non modifica i numeri', format('select salva_contatto_allarme(%L, null, ''X'', ''+393330000009'', 1)', :'r1'), 'Permesso negato');
reset role; select t.come('');
select t.rifiuta('chiamate', 'le API non avviano il motore', 'set local role authenticated; select gestisci_chiamate()', 'permission denied');

-- Senza indirizzo dell'app: nessuna chiamata dichiarata partita
set role authenticated; select t.come(:'chef');
select registra_lettura(:'frigo', 9.0, now() - interval '1 minute') \g /dev/null
reset role; select t.come('');
select id as al from allarmi where ubicazione_id = :'frigo' and tipo = 'temperatura_alta' \gset
select gestisci_chiamate() \g /dev/null
select t.uguale('chiamate', 'senza configurazione: non_configurato', (select stato from chiamate_allarme where allarme_id = :'al'), 'non_configurato');
delete from chiamate_allarme where allarme_id = :'al';
insert into app.configurazione values ('url_app', 'https://app.test.invalid');

select t.uguale('chiamate', 'primo giro: chiama il primo numero', gestisci_chiamate(), 1);
select t.uguale('chiamate', 'chiamata in coda al responsabile', (select nome || '/' || canale || '/' || stato from chiamate_allarme where allarme_id = :'al'), 'Responsabile prova/voce/in_coda');
select t.uguale('chiamate', 'richiesta all''app con id e token', (select url from net.richieste order by id desc limit 1), 'https://app.test.invalid/api/allarmi/chiama');
select (body->>'id') as k1, (body->>'token') as tk1 from net.richieste order by id desc limit 1 \gset
select t.uguale('chiamate', 'entro l''attesa non richiama', gestisci_chiamate(), 0);

set role anon; select t.come('{"role":"anon"}');
select t.uguale('chiamate', 'token errato: nessun dato', dati_chiamata(:'k1', 'sbagliato') is null, true);
select t.uguale('chiamate', 'token giusto: numero e testo', dati_chiamata(:'k1', :'tk1')->>'telefono', '+393330000001');
select t.uguale('chiamate', 'esito invio', esito_chiamata(:'k1', :'tk1', 'inviata', 'CA123'), true);
select t.uguale('chiamate', 'dopo l''invio i dati non si rileggono', dati_chiamata(:'k1', :'tk1') is null, true);
select t.uguale('chiamate', 'invio non ripetibile', esito_chiamata(:'k1', :'tk1', 'errore'), false);
select t.uguale('chiamate', 'esito inventato rifiutato', esito_chiamata(:'k1', :'tk1', 'hackerata'), false);
select t.uguale('chiamate', 'anon non vede le chiamate', (select count(*) from chiamate_allarme), 0::bigint);
reset role; select t.come('');

-- Nessuna risposta: dopo l'attesa la riserva, poi SMS a tutti
update chiamate_allarme set creato_il = now() - interval '6 minutes' where allarme_id = :'al';
select t.uguale('chiamate', 'dopo l''attesa: chiama la riserva', gestisci_chiamate(), 1);
select t.uguale('chiamate', 'seconda chiamata alla riserva', (select nome from chiamate_allarme where allarme_id = :'al' order by creato_il desc limit 1), 'Riserva prova');
update chiamate_allarme set creato_il = creato_il - interval '6 minutes' where allarme_id = :'al';
select t.uguale('chiamate', 'giri finiti: SMS a tutti', gestisci_chiamate(), 2);
select t.uguale('chiamate', 'SMS una volta sola', gestisci_chiamate(), 0);
select t.uguale('chiamate', 'due SMS in totale', (select count(*) from chiamate_allarme where allarme_id = :'al' and canale = 'sms'), 2::bigint);

-- Conferma con il tasto 1: allarme preso in carico, niente più chiamate
select id as k2 from chiamate_allarme where allarme_id = :'al' and nome = 'Riserva prova' and canale = 'voce' \gset
update chiamate_allarme set token_hash = app.hash_token('tok-prova'), stato = 'inviata' where id = :'k2';
set role anon; select t.come('{"role":"anon"}');
select esito_chiamata(:'k2', 'tok-prova', 'confermata') \g /dev/null
reset role; select t.come('');
select t.uguale('chiamate', 'confermata: allarme in carico con il nome', (select stato || '/' || (note like '%Riserva prova%') from allarmi where id = :'al'), 'in_carico/true');
update chiamate_allarme set creato_il = creato_il - interval '1 hour' where allarme_id = :'al';
select t.uguale('chiamate', 'dopo la conferma non chiama più', gestisci_chiamate(), 0);
