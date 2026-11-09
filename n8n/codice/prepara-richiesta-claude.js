// Costruisce la richiesta di estrazione per Claude a partire dal file scaricato dallo storage.
const meta = $('Avvia elaborazione').first().json;
const buf = await this.helpers.getBinaryDataBuffer(0, 'data');
const ext = String(meta.file_path || '').split('.').pop().toLowerCase();
const mime = meta.mime || 'application/pdf';

let blocco;
if (ext === 'xml' || mime.includes('xml')) {
  blocco = { type: 'text', text: 'Documento XML (FatturaPA o simile):\n' + buf.toString('utf8').slice(0, 300000) };
} else if (mime === 'application/pdf') {
  blocco = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } };
} else if (mime.startsWith('image/')) {
  blocco = { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } };
} else {
  throw new Error('Formato non supportato: ' + mime);
}

const SYSTEM = __PROMPT_ESTRAZIONE__;

return [{ json: {
  documento_id: meta.documento_id,
  claudeRequest: {
    model: 'claude-sonnet-5-5',
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: [blocco, { type: 'text', text: 'Analizza il documento allegato ed estrai i dati seguendo rigorosamente la struttura. Solo JSON.' }] }]
  }
} }];
