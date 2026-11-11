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
