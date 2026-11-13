import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { cn } from "@/lib/format";
import { Intestazione, Vuoto } from "@/components/ui";
import { Azione } from "@/components/modulo";
import { TempoReale } from "../tempo-reale";

export const metadata: Metadata = { title: "Display cucina" };
export const dynamic = "force-dynamic";

type Riga = { id: string; nome: string; quantita: number; note: string | null; uscita: number; stato: string; reparto: string; aggiornato_il: string; sessione_id: string;
  ordini_tavolo: { numero: number; creato_il: string } | null };
const REPARTI = ["tutti", "cucina", "pasticceria", "bar", "pizzeria"];

export default async function Cucina({ searchParams }: { searchParams: Promise<{ reparto?: string }> }) {
  const { reparto = "tutti" } = await searchParams;
  const { supabase, attivo } = await sessioneModulo("sala");
  let q = supabase.from("ordini_righe").select("id,nome,quantita,note,uscita,stato,reparto,aggiornato_il,sessione_id,ordini_tavolo(numero,creato_il)")
    .eq("ristorante_id", attivo.id).in("stato", ["inviato", "in_preparazione", "pronto"]).order("aggiornato_il");
  if (reparto !== "tutti") q = q.eq("reparto", reparto);
  const [{ data: righe }, { data: sessioni }] = await Promise.all([
    q.returns<Riga[]>(),
    supabase.from("sessioni_tavolo").select("id,tavoli(codice)").eq("ristorante_id", attivo.id).neq("stato", "chiusa").returns<{ id: string; tavoli: { codice: string } | null }[]>(),
  ]);
  const tavolo = new Map((sessioni ?? []).map((s) => [s.id, s.tavoli?.codice ?? "?"]));
  // Una "comanda" per tavolo e numero d'ordine, in ordine di arrivo.
  const comande = new Map<string, Riga[]>();
  for (const r of righe ?? []) { const k = `${r.sessione_id}|${r.ordini_tavolo?.numero}`; comande.set(k, [...(comande.get(k) ?? []), r]); }
  const minuti = (iso?: string) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

  return (
    <>
      <Intestazione titolo="Display cucina" sottotitolo={attivo.nome}><TempoReale sede={attivo.id} tabelle={["ordini_righe"]} /></Intestazione>
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Reparto">{REPARTI.map((r) => (
        <Link key={r} href={`/sala/cucina?reparto=${r}`} aria-current={r === reparto ? "page" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm capitalize", r === reparto ? "border-fg bg-fg text-bg" : "border-line")}>{r}</Link>))}</nav>
      {comande.size ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[...comande.entries()].map(([k, rr]) => {
          const att = minuti(rr[0].ordini_tavolo?.creato_il);
          return (
            <section key={k} className={cn("card p-3", att >= 20 && "border-danger")}>
              <header className="mb-2 flex items-baseline justify-between"><span className="text-xl font-semibold">Tavolo {tavolo.get(rr[0].sessione_id)}</span>
                <span className={cn("num text-sm", att >= 20 ? "text-danger" : "text-muted")}>{att} min · #{rr[0].ordini_tavolo?.numero}</span></header>
              <ul className="space-y-2">{rr.sort((a, b) => a.uscita - b.uscita).map((r) => (
                <li key={r.id} className={cn("rounded-md border p-2", r.stato === "pronto" ? "border-ok bg-ok-soft" : r.stato === "in_preparazione" ? "border-warn" : "border-line")}>
                  <p className="text-base font-medium"><span className="num">{r.quantita}×</span> {r.nome}</p>
                  {r.note && <p className="text-sm font-medium text-warn">{r.note}</p>}
                  <p className="text-[11px] text-subtle">uscita {r.uscita} · {r.reparto}</p>
                  <div className="mt-1.5 flex gap-2">
                    {r.stato === "inviato" && <Azione rpc="avanza_riga" parametri={{ p_riga_id: r.id, p_stato: "in_preparazione" }} etichetta="Inizia" stile="btn btn-sm" />}
                    {r.stato !== "pronto" && <Azione rpc="avanza_riga" parametri={{ p_riga_id: r.id, p_stato: "pronto" }} etichetta="Pronto" stile="btn btn-sm btn-primary" />}
                    {r.stato === "pronto" && <span className="text-sm font-medium text-ok">Pronto: in attesa della sala</span>}
                  </div>
                </li>))}</ul>
            </section>);
        })}</div>
      ) : <Vuoto titolo="Nessun ordine in corso">I nuovi ordini compaiono qui da soli, con un suono.</Vuoto>}
    </>
  );
}
