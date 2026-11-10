// Controlli di coerenza e spiegazioni, senza dipendenze: usati dall'interfaccia e coperti da test.

/** "1.234,56" → 1234.56; "12,5" → 12.5; "12.5" → 12.5. undefined se il testo non è un numero. */
export function leggiNumero(testo: string): number | null | undefined {
  let t = testo.trim().replace(/\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

const arrotonda = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Tolleranza sugli arrotondamenti: 2 centesimi oppure lo 0,2% dell'importo. */
const vicino = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.002);

export type RigaCalcolo = {
  quantita: number | null; prezzo_unitario: number | null; sconto_percentuale: number | null; totale_riga: number | null;
};
export type EsitoRiga =
  | { ok: true }
  | { ok: false; tipo: "sconto_non_applicato" | "totale_incoerente"; atteso: number };

/** Verifica che quantità × prezzo × (1 − sconto) dia il totale di riga. */
export function controlloRiga(r: RigaCalcolo): EsitoRiga {
  if (r.quantita == null || r.prezzo_unitario == null || r.totale_riga == null) return { ok: true };
  const lordo = arrotonda(Number(r.quantita) * Number(r.prezzo_unitario));
  const sconto = Number(r.sconto_percentuale ?? 0);
  const atteso = arrotonda(lordo * (1 - sconto / 100));
  const totale = Math.abs(Number(r.totale_riga));
  if (vicino(totale, Math.abs(atteso))) return { ok: true };
  if (sconto > 0 && vicino(totale, Math.abs(lordo))) return { ok: false, tipo: "sconto_non_applicato", atteso };
  return { ok: false, tipo: "totale_incoerente", atteso };
}

export type TestataCalcolo = { imponibile: number | null; iva: number | null; totale: number | null };
export type AvvisoDocumento = { tipo: "somma_righe" | "totale"; atteso: number; trovato: number };

/** Verifica somma delle righe = imponibile e imponibile + IVA = totale. */
export function controlloDocumento(d: TestataCalcolo, righe: { totale_riga: number | null }[]): AvvisoDocumento[] {
  const avvisi: AvvisoDocumento[] = [];
  if (d.imponibile != null && righe.length && righe.every((r) => r.totale_riga != null)) {
    const somma = arrotonda(righe.reduce((s, r) => s + Number(r.totale_riga), 0));
    if (!vicino(somma, Number(d.imponibile))) avvisi.push({ tipo: "somma_righe", atteso: Number(d.imponibile), trovato: somma });
  }
  if (d.imponibile != null && d.iva != null && d.totale != null) {
    const somma = arrotonda(Number(d.imponibile) + Number(d.iva));
    if (!vicino(somma, Number(d.totale))) avvisi.push({ tipo: "totale", atteso: Number(d.totale), trovato: somma });
  }
  return avvisi;
}

export type EsitoConfronto = "confrontato" | "primo_acquisto" | "unita_non_confrontabile" | "valuta_diversa" | "nota_di_credito" | null;

/** Perché una riga non ha una variazione di prezzo. */
export function motivoConfronto(esito: EsitoConfronto, abbinato: boolean): string | null {
  switch (esito) {
    case "confrontato": return null;
    case "primo_acquisto":
      return abbinato
        ? "Primo acquisto di questo articolo da questo fornitore: manca un prezzo precedente."
        : "Nessun acquisto precedente con questa descrizione. Abbinando l'articolo al catalogo lo storico si collega anche se il fornitore cambia codice.";
    case "unita_non_confrontabile":
      return "L'acquisto precedente è in un'unità diversa e manca il dato per convertirla (peso netto, contenuto o fattore di conversione).";
    case "valuta_diversa":
      return "L'acquisto precedente è in un'altra valuta: i prezzi si confrontano solo a parità di valuta.";
    case "nota_di_credito":
      return "Le note di credito non vengono usate per il controllo dei prezzi.";
    default: return null;
  }
}

/** Stato di revisione umana, distinto dallo stato di elaborazione. */
export function revisione(d: { stato: string; n_da_validare: number; n_rincari_aperti: number }) {
  if (d.stato !== "completato") return null;
  const parti: string[] = [];
  if (d.n_da_validare > 0) parti.push(`${d.n_da_validare} ${d.n_da_validare === 1 ? "articolo da validare" : "articoli da validare"}`);
  if (d.n_rincari_aperti > 0) parti.push(`${d.n_rincari_aperti} ${d.n_rincari_aperti === 1 ? "rincaro da gestire" : "rincari da gestire"}`);
  return { verificato: parti.length === 0, dettaglio: parti.join(" · ") };
}

/** Controlli sul file prima dell'invio: evitano un giro a vuoto di caricamento ed elaborazione. */
export function controlloFile(nome: string, inizio: Uint8Array, testo: string): string | null {
  const est = nome.split(".").pop()?.toLowerCase() ?? "";
  if (inizio.length === 0) return "Il file è vuoto";
  if (est === "p7m") return "File firmato .p7m: estrai prima l'XML della fattura e carica quello";
  if (est === "pdf") {
    if (!testo.startsWith("%PDF-")) return "Il file non è un PDF valido o è danneggiato";
    if (/\/Encrypt\b/.test(testo)) return "PDF protetto da password: salvane una copia senza protezione e riprova";
  }
  if (est === "xml") {
    const t = testo.replace(/^﻿/, "").trimStart();
    if (!t.startsWith("<")) return "Il file non è un XML valido";
  }
  return null;
}
