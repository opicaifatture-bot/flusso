// Adapter per abbonamenti e pagamenti.
// Stato: PREDISPOSTO, nessun provider collegato e nessun incasso possibile.
//
// Il piano di un gruppo vive nella tabella `abbonamenti` e si modifica solo dal backend
// con la RPC `imposta_abbonamento` (ruolo di servizio). Per collegare un provider:
//   1. creare prodotti e prezzi sul provider (i prezzi NON stanno nel codice né nel database);
//   2. mappare l'identificativo di ogni prezzo a un codice di `piani`;
//   3. nel webhook, verificare la firma e tradurre gli eventi con `daEventoProvider`,
//      poi chiamare `imposta_abbonamento` con la chiave di servizio.
// Regole già applicate dal database: a scadenza o sospensione i dati restano leggibili
// e le scritture si bloccano; il downgrade toglie le funzioni ma non cancella dati.
export type StatoAbbonamento = "prova" | "attivo" | "scaduto" | "sospeso" | "annullato";
export type AggiornamentoAbbonamento = {
  gruppoId: string; piano: string; stato: StatoAbbonamento; periodoFine: string | null; provaFinoAl: string | null;
  provider: "test" | "stripe"; clienteId?: string; abbonamentoId?: string;
};

export function pagamentiConfigurati() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Stati del provider → stati dell'app. Un pagamento in ritardo sospende, non cancella. */
export function statoDaProvider(stato: string): StatoAbbonamento {
  switch (stato) {
    case "trialing": return "prova";
    case "active": return "attivo";
    case "past_due": case "unpaid": case "paused": return "sospeso";
    case "canceled": case "incomplete_expired": return "annullato";
    default: return "sospeso";
  }
}

export const ETICHETTE_STATO: Record<StatoAbbonamento, string> = {
  prova: "In prova", attivo: "Attivo", scaduto: "Scaduto", sospeso: "Sospeso", annullato: "Annullato",
};
