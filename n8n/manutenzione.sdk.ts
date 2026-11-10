import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const SUPABASE = { id: 'f1J62kcTZ1O057Wb', name: 'Supabase account' };
const BASE = 'https://zbvmkrgxwwjritdarvzh.supabase.co';

const ogniGiorno = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Ogni giorno alle 17:30',
    parameters: { rule: { interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 17, triggerAtMinute: 30 }] } }
  },
  output: [{ timestamp: '2026-11-10T17:30:00.000+01:00' }]
});

const scaricaTassi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Scarica tassi BCE',
    parameters: {
      method: 'GET',
      url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml',
      options: { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } }, timeout: 60000 }
    }
  },
  output: [{ data: '<Cube time="2026-11-06"><Cube currency="CHF" rate="0.9312"/></Cube>' }]
});

const leggiTassi = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Leggi tassi',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Estrae i tassi di riferimento BCE (unità di valuta per 1 EUR) dallo storico completo.
// Si tengono gli ultimi tre anni per le valute usate dai fornitori: così anche un
// documento caricato in ritardo trova il cambio della propria data.
const VALUTE = ['CHF', 'USD', 'GBP'];
const dal = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
const xml = String($input.first().json.data || '');
const tassi = [];
const giorni = xml.split('<Cube time="').slice(1);
for (const g of giorni) {
  const data = g.slice(0, 10);
  if (data < dal) continue;
  const re = /currency="([A-Z]{3})"\\s+rate="([0-9.]+)"/g;
  let m;
  while ((m = re.exec(g)) !== null) if (VALUTE.includes(m[1])) tassi.push({ data, valuta: m[1], tasso: Number(m[2]) });
}
if (!tassi.length) throw new Error('Nessun tasso trovato nella risposta della BCE');
return [{ json: { p_tassi: tassi, n: tassi.length } }];`
    }
  },
  output: [{ p_tassi: [{ data: '2026-11-06', valuta: 'CHF', tasso: 0.9312 }], n: 1 }]
});

const salvaTassi = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Salva tassi',
    parameters: {
      method: 'POST',
      url: BASE + '/rest/v1/rpc/registra_tassi',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ p_tassi: $json.p_tassi }) }}')
    },
    credentials: { supabaseApi: SUPABASE }
  },
  output: [{ registrati: 30 }]
});

const primoDelMese = ifElse({
  version: 2.2,
  config: {
    name: 'Primo del mese?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $now.day }}'), operator: { type: 'number', operation: 'equals' }, rightValue: 1 }],
        combinator: 'and'
      }
    }
  }
});

const esportaAudit = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Esporta audit del mese scorso',
    parameters: {
      method: 'POST',
      url: BASE + '/rest/v1/rpc/audit_esporta',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ p_da: $now.minus({ months: 1 }).startOf('month').toISO(), p_a: $now.startOf('month').toISO() }) }}")
    },
    credentials: { supabaseApi: SUPABASE }
  },
  output: [{ gruppo_id: '00000000-0000-0000-0000-000000000000', da: '2026-10-01T00:00:00+00:00', righe: 120, ultimo_hash: 'abc', registro: [] }]
});

const preparaArchivio = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepara file di archivio',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Un file JSON per gruppo e per mese: contiene le righe del registro e l'ultimo hash
// della catena, che fa da ancora esterna per le verifiche future.
const out = [];
for (const item of $input.all()) {
  const g = item.json;
  if (!g.gruppo_id || !g.righe) continue;
  const mese = String(g.da).slice(0, 7);
  out.push({
    json: { percorso: g.gruppo_id + '/' + mese + '.json', righe: g.righe, ultimo_hash: g.ultimo_hash },
    binary: { data: await this.helpers.prepareBinaryData(Buffer.from(JSON.stringify(g)), mese + '.json', 'application/json') }
  });
}
return out;`
    }
  },
  output: [{ percorso: '00000000-0000-0000-0000-000000000000/2026-10.json', righe: 120, ultimo_hash: 'abc' }]
});

const archivia = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Archivia in cold storage',
    parameters: {
      method: 'POST',
      url: expr(BASE + '/storage/v1/object/archivio-audit/{{ $json.percorso }}'),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'x-upsert', value: 'true' }] },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'data'
    },
    credentials: { supabaseApi: SUPABASE }
  },
  output: [{ Key: 'archivio-audit/x/2026-10.json' }]
});

export default workflow('price-guardian-manutenzione', 'Price Guardian: manutenzione (tassi BCE e archivio audit)')
  .add(ogniGiorno)
  .to(scaricaTassi)
  .to(leggiTassi)
  .to(salvaTassi)
  .to(primoDelMese.onTrue(esportaAudit.to(preparaArchivio).to(archivia)))
  .group('Tassi di cambio BCE', [scaricaTassi, leggiTassi, salvaTassi], { description: 'Scarica i tassi di riferimento degli ultimi 90 giorni e li salva in tassi_cambio' })
  .group('Archivio mensile audit', [esportaAudit, preparaArchivio, archivia], { description: 'Il primo del mese esporta il registro di audit del mese precedente nel bucket archivio-audit' });
