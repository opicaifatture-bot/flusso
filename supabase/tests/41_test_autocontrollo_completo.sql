\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\set titolare  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}'
\set contabile '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}'
\set consul    '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}'
\set cucina    '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}'
select id as r1 from ristoranti where nome = 'Sede principale' \gset
select gruppo_id as g1 from ristoranti where id = :'r1' \gset
select id as m_costata from articoli_master where nome = 'Costata di manzo' \gset
select id as a1 from archivio where titolo = 'Manuale di autocontrollo' \gset
select id as v1 from archivio_versioni where archivio_id = :'a1' and versione = 2 \gset

-- Una persona attiva con PIN per le firme
set role authenticated; select t.come(:'titolare');
select salva_persona(:'r1', '{"nome":"Anna Bianchi","mansione":"Cuoca"}') as p2 \gset
select imposta_pin(:'p2', '2580');

-- ═══ ESTRAZIONE E PROPOSTE ═════════════════════════════════════════════════
select t.come(:'cucina');
select t.rifiuta('estrazione', 'la cucina non avvia estrazioni', format('select avvia_estrazione(%L)', :'v1'), 'Permesso negato');
select t.come(:'consul');
select t.uguale('estrazione', 'avvio: restituisce il file', avvia_estrazione(:'v1')->>'categoria', 'manuale_autocontrollo');
select t.rifiuta('estrazione', 'doppio avvio bloccato', format('select avvia_estrazione(%L)', :'v1'), 'già in corso');
select t.rifiuta('estrazione', 'solo il servizio registra le proposte', format('select registra_proposte(%L, ''[]'')', :'v1'), 'permission denied');
reset role; select t.come('');
select t.uguale('estrazione', 'il servizio registra le proposte', registra_proposte(:'v1', jsonb_build_array(
  jsonb_build_object('categoria', 'ccp', 'titolo', 'Conservazione in cella positiva', 'pagina', 12, 'citazione', 'Temperatura cella 0/+4 °C, controllo giornaliero',
    'dati', jsonb_build_object('fase', 'Conservazione', 'pericolo', 'Proliferazione batterica', 'tipo_pericolo', 'biologico', 'limite_testo', '0/+4 °C', 'limite_min', 0, 'limite_max', 4, 'unita', '°C', 'frequenza', 'giornaliera', 'azione_correttiva', 'Spostare i prodotti e valutarne l''idoneità')),
  jsonb_build_object('categoria', 'analisi_acqua', 'titolo', 'Analisi acqua potabile', 'pagina', 30, 'citazione', 'Analisi annuale dell''acqua',
    'dati', jsonb_build_object('frequenza', 'annuale', 'parametri', 'Come da piano analisi', 'gestione', 'esterna')),
  jsonb_build_object('categoria', 'inventata', 'titolo', 'Categoria sconosciuta'),
  jsonb_build_object('categoria', 'ccp', 'titolo', ''))), 3);
select t.uguale('estrazione', 'categoria sconosciuta → altro', (select categoria from proposte_estrazione where titolo = 'Categoria sconosciuta'), 'altro');
select t.uguale('estrazione', 'estrazione completata', (select stato || '/' || n_proposte from estrazioni where versione_id = :'v1'), 'completata/3');
select id as pr1 from proposte_estrazione where titolo = 'Conservazione in cella positiva' \gset
select id as pr2 from proposte_estrazione where titolo = 'Analisi acqua potabile' \gset
select id as pr3 from proposte_estrazione where titolo = 'Categoria sconosciuta' \gset
set role authenticated; select t.come(:'consul');
select decidi_proposta(:'pr1', 'accetta') as c1 \gset
select t.uguale('estrazione', 'come da manuale: limiti copiati', (select limite_min || '/' || limite_max || '/' || fonte || '/' || differisce_da_manuale from controlli where id = :'c1'), '0/4/manuale/false');
select t.rifiuta('estrazione', 'modifica senza motivo', format('select decidi_proposta(%L, ''modifica'', ''{"frequenza":"semestrale"}'')', :'pr2'), 'Spiega');
select decidi_proposta(:'pr2', 'modifica', '{"frequenza":"semestrale"}', 'Il consulente consiglia due analisi l''anno') as c2 \gset
select t.uguale('estrazione', 'modifica: valore utente e segnalazione', (select frequenza || '/' || differisce_da_manuale from controlli where id = :'c2'), 'semestrale/true');
select decidi_proposta(:'pr3', 'scarta', '{}', 'Non pertinente');
select t.rifiuta('estrazione', 'una proposta si decide una volta', format('select decidi_proposta(%L, ''accetta'')', :'pr1'), 'già decisa');
select t.rifiuta('piano', 'modificare un controllo del manuale richiede motivo', format('select salva_controllo(%L, ''{"limite_max":5}'', %L)', :'r1', :'c1'), 'spiega');
select salva_controllo(:'r1', '{"limite_max":3, "nota_differenza":"Più restrittivo per i prodotti ittici"}', :'c1');
select t.uguale('piano', 'modifica motivata registrata', (select limite_max || '/' || differisce_da_manuale from controlli where id = :'c1'), '3/true');
select salva_controllo(:'r1', '{"categoria":"prp_pulizia","titolo":"Pulizia piani di lavoro","frequenza":"giornaliera"}') as c3 \gset
select t.uguale('piano', 'controllo aggiunto a mano', (select fonte from controlli where id = :'c3'), 'utente');
select t.come(:'cucina');
select t.rifiuta('piano', 'la cucina non modifica il piano', format('select salva_controllo(%L, ''{"categoria":"altro","titolo":"X"}'')', :'r1'), 'Permesso negato');

-- ═══ ALBERO DELLE DECISIONI ════════════════════════════════════════════════
reset role; select t.come('');
select t.uguale('albero', 'D1 no, D1b sì → modificare', app.esito_albero('{"d1":false,"d1b":true}'), 'modificare');
select t.uguale('albero', 'D1 no, D1b no → non CCP', app.esito_albero('{"d1":false,"d1b":false}'), 'non_ccp');
select t.uguale('albero', 'D2 sì → CCP', app.esito_albero('{"d1":true,"d2":true}'), 'ccp');
select t.uguale('albero', 'D3 no → non CCP', app.esito_albero('{"d1":true,"d2":false,"d3":false}'), 'non_ccp');
select t.uguale('albero', 'D4 no → CCP', app.esito_albero('{"d1":true,"d2":false,"d3":true,"d4":false}'), 'ccp');
select t.uguale('albero', 'D4 sì → non CCP', app.esito_albero('{"d1":true,"d2":false,"d3":true,"d4":true}'), 'non_ccp');
select t.uguale('albero', 'risposte incomplete', app.esito_albero('{"d1":true,"d2":false}'), null::text);
set role authenticated; select t.come(:'consul');
select t.uguale('albero', 'decisione salvata', valuta_albero(:'c3', '{"d1":true,"d2":false,"d3":true,"d4":false}'), 'ccp');
select t.uguale('albero', 'il controllo diventa CCP', (select categoria from controlli where id = :'c3'), 'ccp');

-- ═══ REGISTRI ══════════════════════════════════════════════════════════════
select t.come(:'cucina');
select t.uguale('registri', 'cucina senza persona: rifiutato', registra(:'r1', null, null, jsonb_build_object('controllo_id', :'c1', 'valore', 2))->>'motivo', 'Scegli chi sta registrando e inserisci il PIN');
select t.uguale('registri', 'PIN errato: niente registrazione', registra(:'r1', :'p2', '1111', jsonb_build_object('controllo_id', :'c1', 'valore', 2))->>'motivo', 'PIN errato');
select t.uguale('registri', 'valore nei limiti: conforme', registra(:'r1', :'p2', '2580', jsonb_build_object('controllo_id', :'c1', 'valore', 2.5))->>'esito', 'conforme');
select t.uguale('registri', 'fuori limite senza azione: chiede l''azione correttiva', registra(:'r1', :'p2', '2580', jsonb_build_object('controllo_id', :'c1', 'valore', 6))->>'motivo', 'Non conforme: indica l''azione correttiva');
select registra(:'r1', :'p2', '2580', jsonb_build_object('controllo_id', :'c1', 'valore', 6, 'azione_correttiva', 'Prodotti spostati in altra cella')) as reg \gset
select t.uguale('registri', 'fuori limite con azione: non conforme registrato', (:'reg'::jsonb)->>'esito', 'non_conforme');
select t.uguale('registri', 'firma: persona registrata', (select persona_id from registrazioni where id = ((:'reg'::jsonb)->>'id')::uuid), :'p2'::uuid);
select t.rifiuta('registri', 'registrazioni immutabili', format('update registrazioni set valore = 3 where id = %L', (:'reg'::jsonb)->>'id'), 'permission denied');
select t.rifiuta('registri', 'rettifica senza motivo', format('select registra(%L, %L, ''2580'', %L::jsonb)', :'r1', :'p2', jsonb_build_object('controllo_id', :'c1', 'valore', 3, 'rettifica_di', (:'reg'::jsonb)->>'id')), 'motivo della rettifica');
select t.uguale('registri', 'rettifica motivata', registra(:'r1', :'p2', '2580', jsonb_build_object('controllo_id', :'c1', 'valore', 3, 'rettifica_di', (:'reg'::jsonb)->>'id', 'nota', 'Lettura trascritta male'))->>'ok', 'true');
select t.uguale('registri', 'preparazione con data di utilizzo', registra(:'r1', :'p2', '2580', jsonb_build_object('tipo', 'preparazione', 'dati', jsonb_build_object('prodotto', 'Verdure tagliate', 'azione', 'preparato'), 'usare_entro', current_date + 1))->>'ok', 'true');
select t.rifiuta('registri', 'data nel futuro', format('select registra(%L, %L, ''2580'', %L::jsonb)', :'r1', :'p2', jsonb_build_object('tipo', 'pulizia', 'eseguita_il', now() + interval '1 day')), 'futuro');
select t.uguale('registri', 'controlli di oggi: CCP fatto, pulizia da fare',
  (select string_agg(titolo || '=' || dovuto, ',' order by titolo) from controlli_oggi(:'r1')), 'Conservazione in cella positiva=false,Pulizia piani di lavoro=true');
select t.come(:'contabile');
select t.uguale('registri', 'contabile: nessun registro', (select count(*) from registrazioni), 0::bigint);
select t.rifiuta('registri', 'contabile: non registra', format('select registra(%L, null, null, ''{"tipo":"pulizia"}'')', :'r1'), 'Permesso negato');

-- ═══ INFESTANTI ════════════════════════════════════════════════════════════
select t.come(:'consul');
select salva_trappola(:'r1', '{"codice":"T1","tipo":"roditori","posizione":"Magazzino secco","x":20,"y":30}') as tr1 \gset
select t.rifiuta('infestanti', 'coordinate fuori planimetria', format('select salva_trappola(%L, ''{"x":150}'', %L)', :'r1', :'tr1'), 'check');
select t.come(:'cucina');
select t.uguale('infestanti', 'presenza: chiede azione', registra(:'r1', :'p2', '2580', jsonb_build_object('tipo', 'infestanti', 'presenza', 'presenza', 'dati', jsonb_build_object('trappola_id', :'tr1')))->>'esito', 'non_conforme');
select t.uguale('infestanti', 'assenza: conforme', registra(:'r1', :'p2', '2580', jsonb_build_object('tipo', 'infestanti', 'presenza', 'assenza', 'dati', jsonb_build_object('trappola_id', :'tr1')))->>'esito', 'conforme');
select t.come(:'consul');
select imposta_sede_autocontrollo(:'r1', '{"regione":"Liguria","gestione_infestanti":"mista"}');
select t.uguale('infestanti', 'gestione e regione della sede', (select regione || '/' || gestione_infestanti from ristoranti where id = :'r1'), 'Liguria/mista');

-- ═══ FORMAZIONE E FIRME ════════════════════════════════════════════════════
select id as rf from regole_formazione where regione = 'Liguria' and codice = 'UF-A' and gruppo_id is null \gset
select registra_formazione(:'r1', jsonb_build_object('persona_id', :'p2', 'regola_id', :'rf', 'data', current_date - 10, 'ore', 8)) as f1 \gset
select t.uguale('formazione', 'regola da verificare: nessuna scadenza calcolata', (select scadenza from formazioni where id = :'f1'), null::date);
select t.rifiuta('formazione', 'conferma senza atto', format('select salva_regola_formazione(%L, ''{"regione":"Liguria","nome":"X","verificata":true}'')', :'g1'), 'atto');
select salva_regola_formazione(:'g1', '{"verificata":true,"validita_anni":5}', :'rf') as rfv \gset
select registra_formazione(:'r1', jsonb_build_object('persona_id', :'p2', 'regola_id', :'rfv', 'data', current_date - 10, 'ore', 8)) as f2 \gset
select t.uguale('formazione', 'regola verificata: scadenza calcolata', (select scadenza from formazioni where id = :'f2'), (current_date - 10 + interval '5 years')::date);
select t.ok('formazione', 'riferimenti regionali condivisi in sola lettura', (select count(*) from regole_formazione where gruppo_id is null) >= 10);
select t.rifiuta('formazione', 'riferimenti non modificabili', 'update regole_formazione set ore_minime = 1', 'permission denied');
reset role; select t.come('');
insert into storage.objects (bucket_id, name) values ('archivio', :'r1' || '/policy.pdf');
set role authenticated; select t.come(:'titolare');
select archivia_file(:'r1', jsonb_build_object('categoria', 'policy_igiene', 'titolo', 'Policy igiene 2026', 'file',
  jsonb_build_object('path', :'r1' || '/policy.pdf', 'nome', 'policy.pdf', 'mime', 'application/pdf', 'dimensione', 500, 'sha256', repeat('f', 64))))->>'versione_id' as vp \gset
select t.come(:'cucina');
select t.uguale('firme', 'firma senza tratto', firma_policy(:'r1', :'p2', '2580', :'vp', 'x')->>'motivo', 'Traccia la firma nel riquadro');
select t.uguale('firme', 'firma con PIN e tratto', firma_policy(:'r1', :'p2', '2580', :'vp', repeat('M10 10 L20 20 ', 10))->>'ok', 'true');
select t.uguale('firme', 'firma valida un anno', (select valida_fino from firme_policy where persona_id = :'p2'), (current_date + interval '1 year')::date);
select t.uguale('firme', 'firma legata all''impronta del documento', (select sha256_documento from firme_policy where persona_id = :'p2'), repeat('f', 64));
select t.rifiuta('firme', 'solo documenti di policy', format('select firma_policy(%L, %L, ''2580'', %L, %L)', :'r1', :'p2', :'v1', repeat('M1 1 ', 20)), 'non trovato');

-- ═══ SCADENZARIO ═══════════════════════════════════════════════════════════
select t.come(:'consul');
select t.uguale('scadenzario', 'formazione nello scadenzario', (select stato from v_scadenzario where origine = 'formazione' and riferimento_id = :'p2' limit 1), 'in_regola');
select t.uguale('scadenzario', 'analisi semestrale mai fatta: scaduta', (select stato from v_scadenzario where origine = 'controllo' and riferimento_id = :'c2'), 'scaduta');
select salva_persona(:'r1', '{"nome":"Luca Verdi"}') as p3 \gset
select t.uguale('scadenzario', 'persona senza firma: scaduta', (select stato from v_scadenzario where origine = 'firma_policy' and riferimento_id = :'p3'), 'scaduta');
select t.uguale('scadenzario', 'persona con firma: in regola', (select stato from v_scadenzario where origine = 'firma_policy' and riferimento_id = :'p2'), 'in_regola');

-- ═══ ALLERGENI ED ETICHETTE ═══════════════════════════════════════════════
reset role; select t.come('');
insert into articoli_master (gruppo_id, nome, unita_base) values (:'g1', 'Farina 00', 'kg') returning id as m_farina \gset
set role authenticated; select t.come(:'titolare');
select salva_ricetta(:'r1', jsonb_build_object('nome', 'Pasta fresca', 'tipo', 'piatto', 'porzioni', 4, 'ingredienti', jsonb_build_array(
  jsonb_build_object('master_id', :'m_farina', 'quantita', 400, 'unita', 'g'), jsonb_build_object('master_id', :'m_costata', 'quantita', 100, 'unita', 'g')))) as ric \gset
select t.uguale('allergeni', 'etichetta incompleta senza schede', (etichetta_ricetta(:'ric')->>'completa'), 'false');
select t.rifiuta('allergeni', 'allergene inesistente', format('select salva_info_prodotto(%L, ''{"allergeni":["zucchero"],"fonte":"manuale"}'')', :'m_farina'), 'sconosciuto');
select t.rifiuta('allergeni', 'fonte obbligatoria', format('select salva_info_prodotto(%L, ''{"allergeni":["glutine"]}'')', :'m_farina'), 'fonte');
select salva_info_prodotto(:'m_farina', '{"ingredienti":"Farina di grano tenero tipo 00","allergeni":["glutine"],"tracce":["soia","glutine"],"fonte":"scheda_tecnica","energia_kj":1450,"energia_kcal":340,"grassi":1,"grassi_saturi":0.2,"carboidrati":70,"zuccheri":1,"proteine":11,"sale":0}');
select salva_info_prodotto(:'m_costata', '{"allergeni":[],"fonte":"etichetta","energia_kj":800,"energia_kcal":190,"grassi":10,"grassi_saturi":4,"carboidrati":0,"zuccheri":0,"proteine":20,"sale":0.1}');
select etichetta_ricetta(:'ric') as et \gset
select t.uguale('etichette', 'completa con le schede', (:'et'::jsonb)->>'completa', 'true');
select t.uguale('etichette', 'ingredienti in ordine di peso', (:'et'::jsonb)->'ingredienti'->0->>'nome', 'Farina 00');
select t.uguale('etichette', 'QUID farina 80%', (:'et'::jsonb)->'ingredienti'->0->>'percentuale', '80.0');
select t.uguale('etichette', 'allergeni', (:'et'::jsonb)->>'allergeni', '["glutine"]');
select t.uguale('etichette', 'tracce senza duplicare gli allergeni', (:'et'::jsonb)->>'tracce', '["soia"]');
select t.uguale('etichette', 'energia pesata per 100 g', (:'et'::jsonb)->'nutrizionali'->>'energia_kcal', '310');
select salva_dati_etichetta(:'ric', '{"tracce_aggiuntive":["sesamo"],"conservazione":"In frigorifero a temperatura indicata dal manuale"}');
select t.uguale('etichette', 'tracce aggiunte per contaminazione crociata', (etichetta_ricetta(:'ric')->>'tracce'), '["sesamo", "soia"]');
select t.come(:'cucina');
select t.uguale('allergeni', 'cucina: vede la matrice allergeni', (select count(*) from jsonb_array_elements(matrice_allergeni(:'r1')) x where x->>'nome' = 'Pasta fresca'), 1::bigint);
select t.ok('allergeni', 'cucina: la matrice non contiene prezzi', matrice_allergeni(:'r1')::text not like '%prezzo%');
select t.come(:'contabile');
select t.rifiuta('allergeni', 'contabile: niente etichette', format('select salva_dati_etichetta(%L, ''{}'')', :'ric'), 'Permesso negato');
reset role; select t.come('');
