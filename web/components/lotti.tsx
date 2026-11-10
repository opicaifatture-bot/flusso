import Link from "next/link";
import { cn, data, money, num } from "@/lib/format";
import { Badge } from "./ui";
import { Azione } from "./modulo";

export type Giacenza = {
  id: string; master_id: string; master_nome: string; categoria: string | null; tipo: string; codice_lotto: string | null;
  ricevuto_il: string; scadenza: string | null; giorni_alla_scadenza: number | null; unita: string; quantita_iniziale: number;
  quantita_residua: number; ubicazione_nome: string | null; fornitore: string | null; documento_id: string | null;
  costo_unitario: number | null; valuta: string | null; costo_unitario_eur: number | null; cambio_del: string | null;
  stato: string; stato_motivo: string | null; produttore: string | null; annata: number | null; provenienza: string | null;
  formato: string | null; consumo_dal: number | null; consumo_al: number | null; consumo_fonte: string | null; consumo_note: string | null;
};

export function Scadenza({ g }: { g: Giacenza }) {
  if (!g.scadenza) return <span className="text-xs text-subtle">senza scadenza</span>;
  const d = g.giorni_alla_scadenza ?? 0;
  return (
    <span className={cn("whitespace-nowrap text-xs", d < 0 ? "text-danger" : d <= 3 ? "text-warn" : "text-muted")}>
      {data(g.scadenza)} · {d < 0 ? `scaduto da ${-d} g` : d === 0 ? "scade oggi" : `tra ${d} g`}
    </span>
  );
}

/** Azioni su un lotto. Le uscite chiedono la quantità; scarti, resi e rettifiche chiedono anche il motivo. */
export function AzioniLotto({ g, cantina }: { g: Giacenza; cantina?: boolean }) {
  const q = { parametro: "p_quantita", domanda: `Quantità in ${g.unita} (giacenza ${num(g.quantita_residua, 3)}):` };
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {g.stato === "attivo" && <AzioneQuantita lotto={g.id} tipo={cantina ? "apertura" : "consumo"} etichetta={cantina ? "Apri" : "Consumo"} domanda={q.domanda} />}
      {cantina && g.stato === "attivo" && <AzioneQuantita lotto={g.id} tipo="vendita" etichetta="Vendita" domanda={q.domanda} />}
      <AzioneQuantita lotto={g.id} tipo={cantina ? "rottura" : "scarto"} etichetta={cantina ? "Rottura" : "Scarto"} domanda={q.domanda} conMotivo />
      <Azione rpc="imposta_stato_lotto" parametri={{ p_lotto_id: g.id, p_stato: g.stato === "attivo" ? "bloccato" : "attivo" }} etichetta={g.stato === "attivo" ? "Blocca" : "Sblocca"} stile="btn btn-ghost btn-sm"
        motivo={{ parametro: "p_motivo", domanda: g.stato === "attivo" ? "Perché blocchi il lotto? (obbligatorio)" : "Perché sblocchi il lotto? (obbligatorio)" }} />
      {g.stato !== "richiamato" && <Azione rpc="imposta_stato_lotto" parametri={{ p_lotto_id: g.id, p_stato: "richiamato" }} etichetta="Richiama" stile="btn btn-ghost btn-sm"
        motivo={{ parametro: "p_motivo", domanda: "Motivo del richiamo (obbligatorio):" }} conferma="Un lotto richiamato non può più essere utilizzato: restano possibili solo reso e scarto. Confermi?" />}
    </div>
  );
}

// Componente client separato: serve chiedere due valori (quantità ed eventuale motivo).
import { AzioneQuantita } from "./lotti-azioni";

export function StatoLotto({ g }: { g: Giacenza }) {
  if (g.stato === "attivo") return null;
  return <Badge tono="danger" className="ml-2"><span title={g.stato_motivo ?? undefined}>{g.stato === "richiamato" ? "Richiamato" : "Bloccato"}</span></Badge>;
}

export function CostoStorico({ g }: { g: Giacenza }) {
  if (g.costo_unitario == null) return <span className="text-xs text-subtle">non indicato</span>;
  return (
    <span className="num whitespace-nowrap">
      {money(g.costo_unitario, g.valuta ?? "EUR")}<span className="text-subtle">/{g.unita}</span>
      {g.valuta && g.valuta !== "EUR" && <span className="block text-xs text-subtle">{g.costo_unitario_eur != null ? `≈ ${money(g.costo_unitario_eur)} · cambio BCE del ${data(g.cambio_del)}` : "cambio non disponibile"}</span>}
    </span>
  );
}

export function LinkDocumento({ g }: { g: Giacenza }) {
  return g.documento_id ? <Link href={`/documenti/${g.documento_id}`} className="underline hover:text-fg">documento</Link> : <>inserito a mano</>;
}
