/**
 * Adattatore dei pagamenti al tavolo. Ogni ristorante collega il proprio servizio
 * (Stripe, Nexi, SumUp, Satispay…). Le credenziali stanno solo nelle variabili del server,
 * mai nel database o nel browser.
 *
 * Stato attuale: nessun servizio è collegato. Il database registra i pagamenti dal tavolo
 * come "prova" (nessun addebito) finché `sala_impostazioni.pagamento_modalita` non è "attivo",
 * e quel valore non è impostabile dall'app: si attiva solo dopo aver collegato e verificato un servizio.
 */
export type Provider = "stripe" | "nexi" | "sumup" | "satispay";

export type RichiestaPagamento = {
  pagamentoId: string; importoCentesimi: number; manciaCentesimi: number; valuta: "EUR";
  descrizione: string; urlRitorno: string;
};
export type AvvioPagamento = { urlPagamento: string; riferimento: string };

export interface ServizioPagamento {
  provider: Provider;
  /** Crea la sessione di pagamento presso il servizio e restituisce la pagina su cui mandare il cliente. */
  avvia(r: RichiestaPagamento): Promise<AvvioPagamento>;
  /** Verifica la firma del webhook e restituisce l'esito; mai fidarsi del browser per dire "pagato". */
  verificaNotifica(corpo: string, intestazioni: Headers): Promise<{ pagamentoId: string; stato: "pagato" | "fallito" | "annullato" | "rimborsato"; riferimento: string } | null>;
}

const VARIABILI: Record<Provider, string[]> = {
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  nexi: ["NEXI_API_KEY", "NEXI_WEBHOOK_SECRET"],
  sumup: ["SUMUP_API_KEY", "SUMUP_MERCHANT_CODE"],
  satispay: ["SATISPAY_KEY_ID", "SATISPAY_PRIVATE_KEY"],
};

/** Quali servizi hanno le credenziali sul server. Nessuno è ancora implementato: restituisce solo lo stato. */
export function statoProvider(p: Provider) {
  const mancanti = VARIABILI[p].filter((k) => !process.env[k]);
  return { provider: p, configurato: mancanti.length === 0, implementato: false, mancanti };
}

export function servizio(p: Provider): ServizioPagamento | null {
  // Gli adattatori reali si aggiungono qui, uno per servizio, quando un ristorante sceglie il proprio.
  void p;
  return null;
}
