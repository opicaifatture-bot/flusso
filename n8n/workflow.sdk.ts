import { workflow, node, trigger, sticky, newCredential, expr } from '@n8n/workflow-sdk';

const riceviDocumento = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.2,
  config: {
    name: 'Ricevi documento',
    parameters: {
      httpMethod: 'POST',
      path: 'price-guardian/documento',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: { binaryPropertyName: 'data' }
    },
    credentials: { httpHeaderAuth: newCredential('Price Guardian Webhook Token') }
  },
  output: [{ body: { filename: 'fattura.pdf', mime_type: 'application/pdf', file_base64: 'JVBERi0x' } }]
});

const preparaRichiesta = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepara richiesta Claude',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "\nconst item = $input.first();\nconst body = item.json.body || item.json || {};\nlet b64 = null, mime = null, name = null;\nconst binKeys = Object.keys(item.binary || {});\nif (binKeys.length) {\n  const k = binKeys[0];\n  const buf = await this.helpers.getBinaryDataBuffer(0, k);\n  b64 = buf.toString('base64');\n  mime = item.binary[k].mimeType;\n  name = item.binary[k].fileName;\n} else {\n  b64 = body.file_base64;\n  mime = body.mime_type;\n  name = body.filename;\n}\nif (!b64) throw new Error('Nessun file ricevuto: invia multipart (campo file) oppure JSON {file_base64, mime_type, filename}');\nb64 = String(b64).replace(/^data:[^;]+;base64,/, '');\nname = name || 'documento';\nconst ext = (name.split('.').pop() || '').toLowerCase();\nconst byExt = { pdf: 'application/pdf', xml: 'application/xml', p7m: 'application/pkcs7-mime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };\nif (!mime || mime === 'application/octet-stream') mime = byExt[ext] || mime || 'application/pdf';\n\nlet block;\nif (mime.includes('xml') || ext === 'xml') {\n  const xml = Buffer.from(b64, 'base64').toString('utf8');\n  block = { type: 'text', text: 'Documento XML (FatturaPA o simile):\\n' + xml.slice(0, 180000) };\n} else if (mime === 'application/pdf') {\n  block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };\n} else if (mime.startsWith('image/')) {\n  block = { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } };\n} else {\n  throw new Error('Formato non supportato: ' + mime + ' (' + name + ')');\n}\n\nconst safe = name.replace(/[^A-Za-z0-9._-]/g, '_');\nconst storagePath = new Date().toISOString().slice(0, 10) + '/' + Date.now() + '_' + safe;\n\nconst claudeRequest = {\n  model: 'claude-sonnet-5-5',\n  max_tokens: 8000,\n  system: \"Sei un sistema di Document Intelligence di livello enterprise specializzato nella contabilit\\u00e0 cross-border (Italia, Francia, Monaco, Svizzera) per la ristorazione e il retail di lusso. Estrai con precisione dati da documenti commerciali multilingue (Fatture, DDT, Note di Credito in italiano, francese o inglese, anche FatturaPA XML).\\n\\nREGOLE RIGIDE:\\n1. Restituisci ESCLUSIVAMENTE un oggetto JSON valido, senza testo introduttivo, senza commenti, senza blocchi markdown.\\n2. Se un campo non \\u00e8 presente, usa null. Non inventare dati.\\n3. Date nel formato YYYY-MM-DD.\\n4. Unit\\u00e0 di misura normalizzate: kg, pz, lt, conf, g, mt.\\n5. Traduci e normalizza la descrizione articolo in italiano (es. \\\"Filet de b\\u0153uf\\\" -> \\\"Filetto di manzo\\\"), mantenendo l'originale in descrizione_originale.\\n6. Codice valuta corretto (EUR, CHF, USD). Numeri come numeri JSON con punto decimale.\\n7. Paese fornitore: IT, FR, MC, CH o altro. Per FR/MC metti SIRET/SIREN in codice_identificativo_estero.\\n8. prezzo_unitario \\u00e8 il prezzo per unit\\u00e0 di misura PRIMA di eventuali sconti di riga.\\n\\nSTRUTTURA:\\n{\\\"documento\\\":{\\\"tipo\\\":\\\"Fattura|DDT|Nota di Credito|Altro\\\",\\\"numero_documento\\\":null,\\\"data_documento\\\":null,\\\"codice_valuta\\\":\\\"EUR\\\"},\\n\\\"fornitore\\\":{\\\"ragione_sociale\\\":\\\"\\\",\\\"partita_iva_o_estera\\\":null,\\\"paese\\\":\\\"IT\\\",\\\"codice_identificativo_estero\\\":null},\\n\\\"cliente\\\":{\\\"ragione_sociale\\\":null,\\\"partita_iva\\\":null},\\n\\\"totali\\\":{\\\"imponibile\\\":0,\\\"iva\\\":0,\\\"totale_documento\\\":0,\\\"valuta\\\":\\\"EUR\\\"},\\n\\\"articoli\\\":[{\\\"codice_articolo_fornitore\\\":null,\\\"descrizione_originale\\\":\\\"\\\",\\\"descrizione_articolo\\\":\\\"\\\",\\\"quantita\\\":0,\\\"unita_misura\\\":\\\"kg\\\",\\\"prezzo_unitario\\\":0,\\\"sconto_percentuale\\\":0,\\\"totale_riga\\\":0,\\\"aliquota_iva_percentuale\\\":0}]}\\n\",\n  messages: [{ role: 'user', content: [block, { type: 'text', text: 'Analizza il documento allegato ed estrai i dati seguendo rigorosamente la struttura. Solo JSON.' }] }]\n};\n\nreturn [{\n  json: { filename: name, mime_type: mime, storage_path: storagePath, claudeRequest },\n  binary: { file: { data: b64, mimeType: mime, fileName: safe } }\n}];\n" }
  },
  output: [{ filename: 'fattura.pdf', mime_type: 'application/pdf', storage_path: '2026-11-09/1_fattura.pdf', claudeRequest: { model: 'claude-sonnet-5-5' } }]
});

const archiviaFile = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Archivia file originale',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr('https://zbvmkrgxwwjritdarvzh.supabase.co/storage/v1/object/documenti/{{ $json.storage_path }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'x-upsert', value: 'true' }] },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'file'
    },
    credentials: { supabaseApi: newCredential('Supabase Price Guardian') }
  },
  output: [{ Key: 'documenti/2026-11-09/1_fattura.pdf' }]
});

const estraiConClaude = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Estrai dati con Claude',
    parameters: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'anthropicApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify($('Prepara richiesta Claude').item.json.claudeRequest) }}"),
      options: { timeout: 180000 }
    },
    credentials: { anthropicApi: { id: 'fipL8XkNarm3odbX', name: 'Anthropic account' } }
  },
  output: [{ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn' }]
});

const validaJson = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Valida e normalizza JSON',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "\nconst res = $input.first().json;\nconst text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();\nif (!text) throw new Error('Risposta Claude vuota: ' + JSON.stringify(res).slice(0, 500));\nlet raw = text.replace(/^```(?:json)?\\s*/i, '').replace(/```\\s*$/, '');\nconst s = raw.indexOf('{'), e = raw.lastIndexOf('}');\nif (s < 0 || e < 0) throw new Error('JSON non trovato nella risposta: ' + text.slice(0, 300));\nlet data;\ntry { data = JSON.parse(raw.slice(s, e + 1)); } catch (err) { throw new Error('JSON non valido da Claude: ' + err.message); }\n\nconst num = v => {\n  if (v === null || v === undefined || v === '') return null;\n  if (typeof v === 'number') return v;\n  let t = String(v).replace(/[^0-9,.\\-]/g, '');\n  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\\./g, '').replace(',', '.') : t.replace(/,/g, '');\n  else if (t.includes(',')) t = t.replace(',', '.');\n  const n = parseFloat(t);\n  return isNaN(n) ? null : n;\n};\nconst UM = { kg: 'kg', kilo: 'kg', kgs: 'kg', g: 'g', gr: 'g', grammi: 'g', lt: 'lt', l: 'lt', litre: 'lt', litro: 'lt', litri: 'lt', pz: 'pz', pc: 'pz', pce: 'pz', pcs: 'pz', u: 'pz', un: 'pz', unite: 'pz', 'unit\u00e9': 'pz', nr: 'pz', conf: 'conf', cf: 'conf', ct: 'conf', colis: 'conf', mt: 'mt', m: 'mt' };\nconst date = v => (v && /^\\d{4}-\\d{2}-\\d{2}/.test(v)) ? v.slice(0, 10) : null;\n\nconst doc = data.documento || {};\nconst tipi = ['Fattura', 'DDT', 'Nota di Credito', 'Altro'];\ndoc.tipo = tipi.includes(doc.tipo) ? doc.tipo : 'Altro';\ndoc.data_documento = date(doc.data_documento);\ndoc.codice_valuta = String(doc.codice_valuta || (data.totali || {}).valuta || 'EUR').toUpperCase().slice(0, 3);\n\nconst forn = data.fornitore || {};\nif (!forn.ragione_sociale) throw new Error('Fornitore non riconosciuto nel documento');\nforn.paese = forn.paese ? String(forn.paese).toUpperCase() : null;\n\nconst tot = data.totali || {};\n['imponibile', 'iva', 'totale_documento'].forEach(k => tot[k] = num(tot[k]));\ntot.valuta = doc.codice_valuta;\n\nconst articoli = (data.articoli || []).map(a => ({\n  codice_articolo_fornitore: a.codice_articolo_fornitore || null,\n  descrizione_originale: a.descrizione_originale || a.descrizione_articolo || null,\n  descrizione_articolo: a.descrizione_articolo || a.descrizione_originale || null,\n  quantita: num(a.quantita),\n  unita_misura: UM[String(a.unita_misura || '').toLowerCase().replace(/\\./g, '').trim()] || (a.unita_misura || null),\n  prezzo_unitario: num(a.prezzo_unitario),\n  sconto_percentuale: num(a.sconto_percentuale),\n  totale_riga: num(a.totale_riga),\n  aliquota_iva_percentuale: num(a.aliquota_iva_percentuale)\n})).filter(a => a.descrizione_articolo && a.prezzo_unitario !== null);\n\nconst prep = $('Prepara richiesta Claude').first().json;\nconst up = $('Archivia file originale').first().json || {};\nconst fileUrl = up.Key ? 'documenti/' + prep.storage_path : null;\n\nreturn [{ json: {\n  payload: { documento: doc, fornitore: forn, cliente: data.cliente || {}, totali: tot, articoli },\n  p_file_url: fileUrl,\n  filename: prep.filename\n} }];\n" }
  },
  output: [{ payload: { documento: { tipo: 'Fattura' } }, p_file_url: 'documenti/x.pdf', filename: 'fattura.pdf' }]
});

const salvaSupabase = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Salva e controlla prezzi',
    parameters: {
      method: 'POST',
      url: 'https://zbvmkrgxwwjritdarvzh.supabase.co/rest/v1/rpc/registra_documento',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ payload: $json.payload, p_file_url: $json.p_file_url, p_soglia: 5 }) }}')
    },
    credentials: { supabaseApi: newCredential('Supabase Price Guardian') }
  },
  output: [{ documento_id: 'uuid', n_anomalie: 1, anomalia_prezzo: true, anomalie: [] }]
});

const rispondi = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Rispondi con esito',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ JSON.stringify({ ok: true, file: $('Valida e normalizza JSON').item.json.filename, documento_id: $json.documento_id, anomalia_prezzo: $json.anomalia_prezzo, n_anomalie: $json.n_anomalie, anomalie: $json.anomalie, estratto: $('Valida e normalizza JSON').item.json.payload }) }}")
    }
  },
  output: [{ ok: true }]
});

const nota = sticky('## Price Guardian\nPOST multipart (campo `data`) oppure JSON `{file_base64, mime_type, filename}` con header token.\nXML FatturaPA → testo; PDF → document; immagini → vision.\nSoglia anomalia: +5% (parametro p_soglia).', [], { color: 4 });

export default workflow('price-guardian', 'Price Guardian: acquisizione documenti')
  .add(riceviDocumento)
  .to(preparaRichiesta)
  .to(archiviaFile)
  .to(estraiConClaude)
  .to(validaJson)
  .to(salvaSupabase)
  .to(rispondi)
  .add(nota)
  .group('Estrazione AI', [preparaRichiesta, archiviaFile, estraiConClaude, validaJson], { description: 'Prepara il file, lo archivia su Supabase Storage e estrae il JSON normalizzato con Claude' })
  .group('Salvataggio e controllo prezzi', [salvaSupabase, rispondi], { description: 'Upsert fornitore/articoli/storico via RPC e segnalazione rincari oltre +5%' });
