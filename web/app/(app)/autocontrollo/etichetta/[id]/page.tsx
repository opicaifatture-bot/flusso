import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data, dataOra } from "@/lib/format";
import { Stampa } from "@/components/stampa";

export const metadata: Metadata = { title: "Etichetta di preparazione" };

/** Etichetta interna di una preparazione o di una confezione aperta, da stampare. */
export default async function EtichettaPreparazione({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, attivo } = await contestoAutocontrollo();
  const { data: r } = await supabase.from("registrazioni").select("id,eseguita_il,usare_entro,dati,persone(nome)").eq("id", id).eq("ristorante_id", attivo.id)
    .eq("tipo", "preparazione").maybeSingle<{ id: string; eseguita_il: string; usare_entro: string | null; dati: { prodotto?: string; azione?: string; lotto?: string }; persone: { nome: string } | null }>();
  if (!r) notFound();
  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex justify-end print:hidden"><Stampa /></div>
      <div className="etichetta rounded-md border-2 border-fg p-4 text-fg">
        <p className="text-lg font-semibold leading-tight">{r.dati.prodotto}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">{r.dati.azione === "aperto" ? "Aperto il" : r.dati.azione === "scongelato" ? "Scongelato il" : "Preparato il"}</dt><dd className="num">{dataOra(r.eseguita_il)}</dd>
          <dt className="text-muted">Da usare entro</dt><dd className="num font-semibold">{r.usare_entro ? data(r.usare_entro) : "—"}</dd>
          {r.dati.lotto && <><dt className="text-muted">Lotto</dt><dd className="num">{r.dati.lotto}</dd></>}
          <dt className="text-muted">Operatore</dt><dd>{r.persone?.nome ?? "—"}</dd>
        </dl>
        <p className="mt-2 text-[10px] text-muted">{attivo.nome} · rif. {r.id.slice(0, 8)}</p>
      </div>
    </div>
  );
}
