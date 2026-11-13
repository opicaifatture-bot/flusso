/**
 * Adattatore della cassa fiscale (registratore telematico o cassa in cloud).
 * In Italia ogni incasso deve diventare un documento commerciale (scontrino) emesso da un
 * registratore telematico. L'app non lo emette da sola: finché nessuna cassa è collegata,
 * ogni pagamento resta "scontrino da emettere" e la sala deve batterlo sulla cassa e
 * annotarne il numero.
 */
export type RigaScontrino = { descrizione: string; quantita: number; prezzoCentesimi: number; aliquotaIva: number };

export interface CassaFiscale {
  nome: string;
  /** Emette il documento commerciale e restituisce il numero assegnato dal registratore. */
  emetti(righe: RigaScontrino[], pagato: { metodo: "contanti" | "elettronico"; importoCentesimi: number }): Promise<{ numero: string; data: string }>;
}

export function cassaCollegata(): CassaFiscale | null {
  // Da collegare in base al modello usato dal ristorante (es. registratori con interfaccia di rete o casse in cloud).
  return null;
}
