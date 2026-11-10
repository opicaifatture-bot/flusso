\set QUIET 1
\pset tuples_only on
\pset format unaligned
select id as r1 from ristoranti where nome = 'Sede principale' \gset
select gruppo_id as g1 from ristoranti where id = :'r1' \gset
select gruppo_id as g2 from ristoranti where nome = 'Sede estranea' \gset
-- Manomissioni: per ultime, perché rompono volutamente la catena.
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
