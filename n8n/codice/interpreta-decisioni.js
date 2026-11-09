// Legge le decisioni del giudice. In caso di risposta non valida non blocca il documento:
// le righe restano "da abbinare" e finiscono nella coda di validazione.
let decisioni = [];
try {
  const res = $input.first().json;
  const text = (res.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const raw = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (Array.isArray(data.decisioni)) decisioni = data.decisioni;
} catch (err) {
  decisioni = [];
}
return [{ json: {
  p_documento_id: $('Ricevi documento').first().json.body.documento_id,
  p_decisioni: decisioni
} }];
