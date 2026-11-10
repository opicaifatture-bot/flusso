// Valida la risposta di Claude e normalizza numeri, date e unità di misura.
const res = $input.first().json;
if (res.stop_reason === 'max_tokens') throw new Error('Documento troppo lungo: dividilo in più file e riprova');
const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
if (!text) throw new Error('Il modello non ha restituito dati');
const raw = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
if (s < 0 || e < 0) throw new Error('Risposta del modello non interpretabile');
let data;
try { data = JSON.parse(raw.slice(s, e + 1)); } catch (err) { throw new Error('Risposta del modello non valida: ' + err.message); }

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/[^0-9,.\-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};
const UM = { kg: 'kg', kilo: 'kg', kgs: 'kg', g: 'g', gr: 'g', grammi: 'g', lt: 'lt', l: 'lt', litre: 'lt', litro: 'lt', litri: 'lt', cl: 'cl', ml: 'ml', pz: 'pz', pc: 'pz', pce: 'pz', pcs: 'pz', u: 'pz', un: 'pz', unite: 'pz', 'unité': 'pz', nr: 'pz', st: 'pz', stk: 'pz', conf: 'conf', cf: 'conf', ct: 'conf', crt: 'conf', colis: 'conf', carton: 'conf', mt: 'mt', m: 'mt' };
const um = v => { const k = String(v || '').toLowerCase().replace(/\./g, '').trim(); return UM[k] || (k || null); };
const date = v => (v && /^\d{4}-\d{2}-\d{2}/.test(v)) ? String(v).slice(0, 10) : null;

const doc = data.documento || {};
doc.tipo = ['Fattura', 'DDT', 'Nota di Credito', 'Altro'].includes(doc.tipo) ? doc.tipo : 'Altro';
doc.data_documento = date(doc.data_documento);
doc.codice_valuta = String(doc.codice_valuta || (data.totali || {}).valuta || 'EUR').toUpperCase().slice(0, 3);

const forn = data.fornitore || {};
if (!forn.ragione_sociale) throw new Error('Fornitore non riconosciuto nel documento');
forn.paese = forn.paese ? String(forn.paese).toUpperCase().slice(0, 2) : null;

const tot = data.totali || {};
['imponibile', 'iva', 'totale_documento'].forEach(k => { tot[k] = num(tot[k]); });
tot.valuta = doc.codice_valuta;

const articoli = (data.articoli || []).map(a => {
  const uc = um(a.unita_contenuto);
  return {
    codice_articolo_fornitore: a.codice_articolo_fornitore ? String(a.codice_articolo_fornitore).trim() : null,
    descrizione_originale: a.descrizione_originale || a.descrizione_articolo || null,
    descrizione_articolo: a.descrizione_articolo || a.descrizione_originale || null,
    quantita: num(a.quantita),
    unita_misura: um(a.unita_misura),
    prezzo_unitario: num(a.prezzo_unitario),
    sconto_percentuale: num(a.sconto_percentuale),
    totale_riga: num(a.totale_riga),
    aliquota_iva_percentuale: num(a.aliquota_iva_percentuale),
    peso_netto_kg: num(a.peso_netto_kg),
    contenuto_per_unita: num(a.contenuto_per_unita),
    unita_contenuto: ['kg', 'g', 'lt', 'cl', 'ml', 'pz'].includes(uc) ? uc : null
  };
}).filter(a => a.descrizione_articolo && a.prezzo_unitario !== null);

const q = data.qualita || {};
const qualita = {
  leggibilita: ['buona', 'media', 'scarsa'].includes(q.leggibilita) ? q.leggibilita : null,
  note: q.note ? String(q.note).slice(0, 200) : null,
  documenti_nel_file: Number.isInteger(q.documenti_nel_file) && q.documenti_nel_file > 0 ? q.documenti_nel_file : null
};

return [{ json: {
  p_documento_id: $('Avvia elaborazione').first().json.documento_id,
  payload: { documento: doc, fornitore: forn, cliente: data.cliente || {}, totali: tot, qualita, articoli }
} }];
