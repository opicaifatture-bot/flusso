import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const SUPABASE = { id: 'f1J62kcTZ1O057Wb', name: 'Supabase account' };
const ANTHROPIC = { id: 'fipL8XkNarm3odbX', name: 'Anthropic account' };
const HEADER = { id: 'oqF44eC2zECiEbPo', name: 'Price Guardian token' };
const BASE = 'https://zbvmkrgxwwjritdarvzh.supabase.co';
const PROMPT = "Sei un tecnologo alimentare che aiuta un ristorante a trasformare il proprio manuale di autocontrollo HACCP (o il piano analisi, o un altro documento del consulente) in un piano di controlli digitale.\n\nREGOLE ASSOLUTE\n- Estrai SOLO ci\u00f2 che il documento scrive esplicitamente. Non aggiungere valori, limiti, frequenze, temperature, parametri o norme che non compaiono nel testo, anche se li conosci.\n- Se un campo non \u00e8 scritto nel documento, omettilo (non scrivere null, non stimare).\n- \"citazione\" deve riportare testualmente la frase o la riga di tabella del documento da cui ricavi la proposta (massimo 400 caratteri). \"pagina\" \u00e8 il numero di pagina del PDF, se lo conosci.\n- Non dare giudizi di conformit\u00e0 normativa.\n\nCOSA ESTRARRE (una proposta per ogni controllo distinto)\n- ccp: punti critici di controllo (fase, pericolo, limite critico, monitoraggio, frequenza, azione correttiva, responsabile, verifica)\n- prp_pulizia: piano di pulizia e sanificazione (cosa, come, con che prodotto, frequenza)\n- prp_infestanti: monitoraggio infestanti (interno o ditta esterna, frequenza, punti)\n- analisi_acqua / analisi_alimenti: piano analisi (parametri, frequenza, laboratorio esterno)\n- abbattimento: trattamenti di abbattimento (es. pesce da consumare crudo per il rischio Anisakis): temperatura e durata come scritte\n- conservazione: temperature di conservazione per tipo di prodotto, tempi di utilizzo dopo apertura o preparazione\n- ricevimento: controlli al ricevimento merci (temperature, integrit\u00e0, documenti)\n- altro: altri controlli registrabili\n- informazione: requisiti non registrabili come controllo (es. durata di conservazione dei registri, obblighi di formazione con ore e moduli, gestione allergeni, rintracciabilit\u00e0)\n\nFORMATO DI RISPOSTA: solo JSON valido, senza testo prima o dopo:\n{\"proposte\":[{\"categoria\":\"ccp\",\"titolo\":\"breve titolo\",\"pagina\":12,\"citazione\":\"testo letterale\",\n \"dati\":{\"fase\":\"...\",\"pericolo\":\"...\",\"tipo_pericolo\":\"biologico|chimico|fisico|allergeni\",\"misura\":\"...\",\"limite_testo\":\"come scritto\",\n \"limite_min\":0,\"limite_max\":4,\"unita\":\"\u00b0C\",\"frequenza\":\"ogni_servizio|giornaliera|settimanale|quindicinale|mensile|bimestrale|trimestrale|semestrale|annuale|ad_ogni_lotto|al_bisogno\",\n \"monitoraggio\":\"...\",\"azione_correttiva\":\"...\",\"responsabile\":\"...\",\"verifica\":\"...\",\"parametri\":\"...\",\"gestione\":\"interna|esterna\"}}]}\nUsa limite_min/limite_max solo quando il documento indica numeri; \"frequenza\" solo con uno dei valori elencati, scegliendo quello che corrisponde al testo (altrimenti omettila e riporta la frequenza in \"monitoraggio\").\n";

const ricevi = trigger({
  type: 'n8n-nodes-base.webhook', version: 2,
  config: { name: 'Ricevi richiesta di estrazione', parameters: { httpMethod: 'POST', path: 'price-guardian/estrazione', authentication: 'headerAuth', responseMode: 'onReceived', responseCode: 202, options: {} },
    credentials: { httpHeaderAuth: HEADER } },
  output: [{ body: { versione_id: '00000000-0000-0000-0000-000000000000', url: 'https://example.invalid/f.pdf', mime: 'application/pdf', categoria: 'manuale_autocontrollo', titolo: 'Manuale' } }]
});

const scarica = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Scarica documento', onError: 'continueRegularOutput',
    parameters: { method: 'GET', url: expr('{{ $json.body.url }}'), options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } }, timeout: 120000 } } },
  output: [{}]
});

const prepara = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Prepara richiesta', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `// Costruisce la richiesta a Claude con il documento allegato. Non applica nulla: produce solo proposte.
const req = $('Ricevi richiesta di estrazione').first().json.body;
const item = $input.first();
if (item.json.error || !item.binary || !item.binary.data) return [{ json: { versione_id: req.versione_id, errore: 'Download del documento non riuscito' } }];
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
const mime = req.mime || 'application/pdf';
let blocco;
if (mime === 'application/pdf') blocco = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } };
else if (mime.startsWith('image/')) blocco = { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } };
else return [{ json: { versione_id: req.versione_id, errore: 'Formato non supportato' } }];
return [{ json: { versione_id: req.versione_id, richiesta: {
  model: 'claude-sonnet-5-5', max_tokens: 16000, system: ${JSON.stringify(PROMPT)},
  messages: [{ role: 'user', content: [blocco, { type: 'text', text: 'Documento: ' + (req.titolo || '') + ' (' + (req.categoria || '') + '). Estrai le proposte. Solo JSON.' }] }]
} } }];` } },
  output: [{ versione_id: 'x', richiesta: {} }]
});

const erroreDownload = ifElse({ version: 2.2, config: { name: 'Errore prima della lettura?', parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr('{{ $json.errore }}'), operator: { type: 'string', operation: 'exists', singleValue: true } }], combinator: 'and' } } } });

const claude = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Leggi con Claude', onError: 'continueRegularOutput',
    parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true, specifyBody: 'json', jsonBody: expr('{{ JSON.stringify($json.richiesta) }}'), options: { timeout: 300000 } },
    credentials: { anthropicApi: ANTHROPIC } },
  output: [{ content: [{ type: 'text', text: '{"proposte":[]}' }] }]
});

const interpreta = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Interpreta proposte', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: `// Valida la risposta: categorie e frequenze ammesse, numeri veri, testi limitati. Nessun valore aggiunto.
const versione_id = $('Prepara richiesta').first().json.versione_id;
const res = $input.first().json;
if (res.error) return [{ json: { versione_id, errore: 'Lettura non riuscita: ' + String(res.error.message || res.error).slice(0, 200) } }];
if (res.stop_reason === 'max_tokens') return [{ json: { versione_id, errore: 'Documento troppo lungo: dividilo in parti e riprova' } }];
const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
let dati;
try { const raw = text.replace(/^\\x60\\x60\\x60(?:json)?\\s*/i, '').replace(/\\x60\\x60\\x60\\s*$/, ''); dati = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
catch (e) { return [{ json: { versione_id, errore: 'Risposta non leggibile' } }]; }
const FREQ = ['ogni_servizio','giornaliera','settimanale','quindicinale','mensile','bimestrale','trimestrale','semestrale','annuale','ad_ogni_lotto','al_bisogno'];
const TESTI = ['fase','pericolo','misura','limite_testo','unita','monitoraggio','azione_correttiva','responsabile','verifica','parametri'];
const proposte = (Array.isArray(dati.proposte) ? dati.proposte : []).slice(0, 200).map(p => {
  const d = p.dati || {}; const out = {};
  for (const k of TESTI) if (typeof d[k] === 'string' && d[k].trim()) out[k] = d[k].trim().slice(0, 500);
  for (const k of ['limite_min', 'limite_max']) if (typeof d[k] === 'number' && isFinite(d[k])) out[k] = d[k];
  if (FREQ.includes(d.frequenza)) out.frequenza = d.frequenza;
  if (['biologico','chimico','fisico','allergeni'].includes(d.tipo_pericolo)) out.tipo_pericolo = d.tipo_pericolo;
  if (['interna','esterna'].includes(d.gestione)) out.gestione = d.gestione;
  return { categoria: String(p.categoria || 'altro'), titolo: String(p.titolo || '').slice(0, 200), pagina: Number.isInteger(p.pagina) ? p.pagina : null,
           citazione: typeof p.citazione === 'string' ? p.citazione.slice(0, 2000) : null, dati: out };
}).filter(p => p.titolo);
return [{ json: { versione_id, proposte } }];` } },
  output: [{ versione_id: 'x', proposte: [] }]
});

const erroreLettura = ifElse({ version: 2.2, config: { name: 'Lettura riuscita?', parameters: { conditions: {
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
  conditions: [{ leftValue: expr('{{ $json.errore }}'), operator: { type: 'string', operation: 'notExists', singleValue: true } }], combinator: 'and' } } } });

const salva = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Salva proposte', parameters: { method: 'POST', url: BASE + '/rest/v1/rpc/registra_proposte', authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
    sendBody: true, specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ p_versione_id: $json.versione_id, p_proposte: $json.proposte }) }}'), options: {} },
    credentials: { supabaseApi: SUPABASE } },
  output: [{}]
});

const segnaErrore = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Segna errore', parameters: { method: 'POST', url: BASE + '/rest/v1/rpc/segna_errore_estrazione', authentication: 'predefinedCredentialType', nodeCredentialType: 'supabaseApi',
    sendBody: true, specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ p_versione_id: $json.versione_id, p_errore: $json.errore }) }}'), options: {} },
    credentials: { supabaseApi: SUPABASE } },
  output: [{}]
});

export default workflow('kitchen-os-estrazione', 'Kitchen OS: lettura manuale HACCP e piano analisi')
  .add(ricevi)
  .to(scarica)
  .to(prepara)
  .to(erroreDownload
    .onTrue(segnaErrore)
    .onFalse(claude.to(interpreta).to(erroreLettura.onTrue(salva).onFalse(segnaErrore))));
