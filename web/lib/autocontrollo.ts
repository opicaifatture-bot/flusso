export const CATEGORIE_ARCHIVIO: Record<string, string> = {
  manuale_autocontrollo: "Manuale di autocontrollo",
  piano_analisi: "Piano analisi",
  referto_analisi: "Referto di analisi",
  scheda_tecnica_prodotto: "Scheda tecnica prodotto",
  scheda_tecnica_imballaggio: "Scheda tecnica imballaggio",
  dichiarazione_moca: "Dichiarazione di conformità MOCA",
  scheda_sicurezza_chimico: "Scheda di sicurezza prodotto chimico",
  scheda_tecnica_trappole: "Scheda tecnica trappole infestanti",
  contratto_infestanti: "Contratto ditta infestanti",
  rapporto_infestanti: "Rapporto intervento infestanti",
  planimetria: "Planimetria",
  attestato_formazione: "Attestato di formazione",
  policy_igiene: "Policy di igiene interna",
  normativa: "Normativa e delibere",
  altro: "Altro",
};
export const STATI_SCADENZA: Record<string, { etichetta: string; tono: "danger" | "warn" | "ok" }> = {
  scaduta: { etichetta: "Scaduta", tono: "danger" },
  in_scadenza: { etichetta: "In scadenza", tono: "warn" },
  in_regola: { etichetta: "In regola", tono: "ok" },
};

export const CATEGORIE_CONTROLLO: Record<string, string> = {
  ccp: "Punto critico di controllo (CCP)",
  prp_pulizia: "Pulizia e sanificazione",
  prp_infestanti: "Monitoraggio infestanti",
  analisi_acqua: "Analisi dell'acqua",
  analisi_alimenti: "Analisi degli alimenti",
  abbattimento: "Abbattimento (es. pesce crudo)",
  conservazione: "Conservazione",
  ricevimento: "Ricevimento merci",
  altro: "Altro controllo",
  informazione: "Informazione dal manuale",
};
export const FREQUENZE: Record<string, string> = {
  ogni_servizio: "Ogni servizio", giornaliera: "Giornaliera", settimanale: "Settimanale", quindicinale: "Quindicinale",
  mensile: "Mensile", bimestrale: "Bimestrale", trimestrale: "Trimestrale", semestrale: "Semestrale", annuale: "Annuale",
  ad_ogni_lotto: "A ogni lotto", al_bisogno: "Al bisogno",
};
export const TIPI_REGISTRAZIONE: Record<string, string> = {
  controllo: "Controllo", pulizia: "Pulizia", temperatura: "Temperatura", abbattimento: "Abbattimento", ricevimento: "Ricevimento merci",
  preparazione: "Preparazione / apertura", infestanti: "Infestanti", analisi: "Analisi", altro: "Altro",
};
export const ESITI: Record<string, { etichetta: string; tono: "ok" | "danger" | "warn" }> = {
  conforme: { etichetta: "Conforme", tono: "ok" }, non_conforme: { etichetta: "Non conforme", tono: "danger" }, da_valutare: { etichetta: "Da valutare", tono: "warn" },
};
export const REGIONI = ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli Venezia Giulia", "Lazio", "Liguria", "Lombardia",
  "Marche", "Molise", "Piemonte", "Provincia di Bolzano", "Provincia di Trento", "Puglia", "Sardegna", "Sicilia", "Toscana", "Umbria", "Valle d'Aosta", "Veneto"];
export type Allergene = { codice: string; nome: string; esempi: string | null; ordine: number };
