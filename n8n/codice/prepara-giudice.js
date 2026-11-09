// Livello 3: prepara la richiesta al giudice (Claude) per i soli casi incerti.
const prep = $input.first().json;
const SYSTEM = __PROMPT_GIUDICE__;
return [{ json: {
  documento_id: prep.documento_id,
  richiesta: {
    model: 'claude-sonnet-5-5',
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ fornitore: prep.fornitore, categorie: prep.categorie, righe: prep.incerti }) + '\n\nRestituisci solo il JSON delle decisioni.' }]
  }
} }];
