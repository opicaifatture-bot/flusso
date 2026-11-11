export type Ruolo = "titolare" | "chef" | "contabile" | "sola_lettura" | "consulente" | "cucina";
export type StatoDocumento = "in_coda" | "elaborazione" | "completato" | "errore" | "duplicato";
export type StatoAnomalia = "aperta" | "accettata" | "contestata";
export type Esito<T = undefined> = { ok: true; dati?: T } | { ok: false; errore: string };

export const RUOLI: Record<Ruolo, string> = {
  titolare: "Titolare",
  chef: "Chef",
  contabile: "Contabile",
  sola_lettura: "Sola lettura",
  consulente: "Consulente HACCP",
  cucina: "Cucina (tablet)",
};
export const UNITA_BASE = ["kg", "lt", "pz", "conf", "mt"] as const;
export const UNITA = ["kg", "g", "lt", "cl", "ml", "pz", "conf", "mt"] as const;
export const TIPI_DOCUMENTO = ["Fattura", "DDT", "Nota di Credito", "Altro"] as const;

export type Ristorante = {
  id: string; nome: string; paese: string | null; valuta: string; partita_iva: string | null;
  soglia_anomalia_pct: number; soglia_anomalia_min_eur: number; gruppo_id: string; gruppi: { id: string; nome: string } | null;
};

export type Documento = {
  id: string; ristorante_id: string; fornitore_id: string | null; tipo: string; numero: string | null;
  data_documento: string | null; imponibile: number | null; iva: number | null; totale: number | null;
  valuta: string; totale_eur: number | null; imponibile_eur: number | null; tasso_cambio: number | null;
  stato: StatoDocumento; fase: string | null; errore: string | null; errore_codice: string | null;
  n_anomalie: number; nome_file: string | null; mime: string | null; file_path: string | null;
  duplicato_di: string | null; corretto_manualmente: boolean; created_at: string; aggiornato_il: string;
  cliente_ragione_sociale: string | null; cliente_partita_iva: string | null;
  dati_estratti?: { qualita?: { leggibilita?: string; note?: string | null; documenti_nel_file?: number | null } } | null;
  fornitori?: { ragione_sociale: string; paese: string | null; partita_iva_o_estera: string | null; codice_identificativo_estero: string | null } | null;
};

/** Riga della vista v_documenti: documento, fornitore e stato di revisione. */
export type DocumentoElenco = {
  id: string; ristorante_id: string; tipo: string; numero: string | null; data_documento: string | null;
  totale: number | null; valuta: string; totale_eur: number | null; stato: StatoDocumento; fase: string | null;
  errore: string | null; n_anomalie: number; nome_file: string | null; created_at: string;
  ragione_sociale: string | null; paese: string | null; n_righe: number; n_da_validare: number; n_rincari_aperti: number;
};

export type Riga = {
  id: string; documento_id: string; ristorante_id: string; alias_id: string; master_id: string | null;
  numero_riga: number | null; descrizione: string | null; descrizione_originale: string | null;
  codice_articolo: string | null; quantita: number | null; unita_misura: string | null;
  prezzo_unitario: number; sconto_percentuale: number | null; totale_riga: number | null;
  aliquota_iva: number | null; valuta: string; peso_netto_kg: number | null;
  contenuto_per_unita: number | null; unita_contenuto: string | null;
  prezzo_netto: number | null; prezzo_base: number | null; unita_base: string | null;
  prezzo_precedente: number | null; prezzo_confronto: number | null; unita_confronto: string | null;
  variazione_pct: number | null; anomalia_prezzo: boolean; anomalia_stato: StatoAnomalia | null;
  anomalia_nota: string | null; corretto_manualmente: boolean; totale_riga_eur: number | null;
  stato_abbinamento: string; fattore_conversione: number | null; master_nome: string | null; master_stato: string | null;
  master_unita_base: string | null; categoria: string | null; numero: string | null;
  data_documento: string | null; tipo: string; ragione_sociale: string; paese: string | null;
  data_rilevazione: string; riga_precedente_id: string | null;
  confronto_esito: "confrontato" | "primo_acquisto" | "unita_non_confrontabile" | "valuta_diversa" | "nota_di_credito" | null;
  anomalia_gestita_il: string | null;
  // solo in v_anomalie
  impatto?: number | null; impatto_eur?: number | null; variazione_assoluta?: number | null;
  prec_documento_id?: string | null; prec_numero?: string | null; prec_data?: string | null;
  prec_quantita?: number | null; prec_unita_misura?: string | null;
};

export type Master = { id: string; nome: string; unita_base: string; stato: string; categoria: string | null };

export type Cruscotto = {
  oggi: string; dal: string; giorni: number; passo: "settimana" | "mese";
  n_documenti: number; n_fatture: number; spesa: number | null; spesa_prec: number | null;
  non_convertiti: { valuta: string; documenti: number; importo: number }[];
  n_confronti: number; risparmi: number | null;
  serie: { inizio: string; fine: string; spesa: number; documenti: number }[];
  top_fornitori: { ragione_sociale: string; paese: string | null; spesa: number | null; documenti: number; non_convertiti: number }[];
  categorie: { categoria: string; spesa: number }[];
  totale_documenti: number; primo_documento: string | null; ultimo_documento: string | null;
  in_lavorazione: number; errori: number; rincari_aperti: number; rincari_contestati: number;
  impatto_rincari: number | null; da_validare: number; master_in_bozza: number; documenti_da_rivedere: number; fornitori: number;
};
