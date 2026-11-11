import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneModulo } from "@/lib/sessione";
import { num } from "@/lib/format";
import type { Allergene } from "@/lib/autocontrollo";
import { Avviso } from "@/components/ui";
import { Espandi } from "@/components/modulo";
import { Stampa } from "@/components/stampa";
import { ModuloEtichetta, type DatiEtichetta } from "./dati";

export const metadata: Metadata = { title: "Etichetta" };

type Ing = { master_id: string; nome: string; ingredienti: string | null; grammi: number | null; percentuale: number | null; allergeni: string[] };
type Et = { denominazione: string; ricetta: string; peso_netto_g: number | null; conservazione: string | null; modalita_uso: string | null; imballaggio: string | null; smaltimento: string | null;
  durata_giorni: number | null; ingredienti: Ing[]; allergeni: string[]; tracce: string[]; nutrizionali: Record<string, number> | null; mancanti: { nome: string; motivo: string }[]; completa: boolean; nota: string };

export default async function Etichetta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, attivo, operativo } = await sessioneModulo("ricette");
  const [{ data: r }, { data: et }, { data: allergeni }] = await Promise.all([
    supabase.from("ricette").select("id,nome,denominazione,conservazione,modalita_uso,imballaggio,smaltimento,tracce_aggiuntive,peso_netto_g,durata_giorni").eq("id", id).eq("ristorante_id", attivo.id).maybeSingle<DatiEtichetta & { id: string; nome: string }>(),
    supabase.rpc("etichetta_ricetta", { p_ricetta_id: id }),
    supabase.from("allergeni").select("*").order("ordine").returns<Allergene[]>(),
  ]);
  if (!r) notFound();
  const e = et as Et | null;
  const nome = (k: string) => (allergeni ?? []).find((a) => a.codice === k)?.nome.toUpperCase() ?? k;
  // Ingredienti: allergeni in grassetto, percentuale (QUID) accanto agli ingredienti.
  const elenco = e?.ingredienti.map((i, n) => (
    <span key={i.master_id}>{n > 0 && ", "}{i.allergeni.length ? <strong>{i.ingredienti ?? i.nome}</strong> : i.ingredienti ?? i.nome}{i.percentuale != null && ` (${num(i.percentuale, 0)}%)`}</span>
  ));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/ricette/${id}`} className="btn btn-ghost btn-sm px-1.5" aria-label="Torna alla ricetta"><ArrowLeft className="size-4" /></Link>
        <h1 className="text-lg font-semibold tracking-tight">Etichetta · {r.nome}</h1>
        <span className="ml-auto"><Stampa /></span>
      </div>
      {e && !e.completa && <div className="mb-4 print:hidden"><Avviso tono="warn">Etichetta incompleta: {e.mancanti.map((m) => `${m.nome} (${m.motivo})`).join("; ")}. Completa le schede in Autocontrollo → Allergeni.</Avviso></div>}
      {e && (
        <div className="etichetta mx-auto max-w-md rounded-md border-2 border-fg p-4 text-[12px] leading-snug text-fg">
          <p className="text-base font-semibold">{e.denominazione}</p>
          <p className="mt-2"><strong>Ingredienti:</strong> {elenco}.</p>
          {e.tracce.length > 0 && <p className="mt-1">Può contenere tracce di {e.tracce.map(nome).join(", ").toLowerCase()}.</p>}
          {e.nutrizionali && (
            <table className="mt-2 w-full border-t border-fg text-[11px]"><caption className="text-left font-semibold">Dichiarazione nutrizionale per 100 g</caption><tbody>
              {[["Energia", `${e.nutrizionali.energia_kj} kJ / ${e.nutrizionali.energia_kcal} kcal`], ["Grassi", `${num(e.nutrizionali.grassi, 1)} g`], ["di cui acidi grassi saturi", `${num(e.nutrizionali.grassi_saturi, 1)} g`],
                ["Carboidrati", `${num(e.nutrizionali.carboidrati, 1)} g`], ["di cui zuccheri", `${num(e.nutrizionali.zuccheri, 1)} g`], ["Proteine", `${num(e.nutrizionali.proteine, 1)} g`], ["Sale", `${num(e.nutrizionali.sale, 2)} g`]]
                .map(([k, v]) => <tr key={k} className="border-b border-line"><th scope="row" className="py-0.5 text-left font-normal">{k}</th><td className="num py-0.5 text-right">{v}</td></tr>)}
            </tbody></table>
          )}
          {e.peso_netto_g && <p className="mt-2">Peso netto: <span className="num">{num(e.peso_netto_g, 0)} g</span></p>}
          {e.conservazione && <p>Conservazione: {e.conservazione}</p>}
          {e.modalita_uso && <p>Modalità d&apos;uso: {e.modalita_uso}</p>}
          <p>Da consumarsi entro: ____________ {e.durata_giorni ? <span className="text-[10px] text-muted">({e.durata_giorni} giorni dalla preparazione)</span> : null}</p>
          <p>Lotto: ____________</p>
          {(e.imballaggio || e.smaltimento) && <p className="mt-1 text-[10px]">{e.imballaggio}{e.imballaggio && e.smaltimento ? " · " : ""}{e.smaltimento}</p>}
          <p className="mt-1 text-[10px]">{attivo.nome}</p>
        </div>
      )}
      <p className="mt-3 text-[11px] text-subtle print:hidden">{e?.nota} Le diciture obbligatorie (sede del produttore, lotto, data) vanno completate prima della stampa secondo le indicazioni del consulente.</p>
      {operativo && <div className="mt-4 print:hidden"><Espandi titolo="Dati dell'etichetta" aperto={!r.denominazione}><ModuloEtichetta ricetta={id} valori={r} allergeni={allergeni ?? []} /></Espandi></div>}
    </div>
  );
}
