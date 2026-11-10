import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneModulo } from "@/lib/sessione";
import { data, dataOra, money, num } from "@/lib/format";
import { Badge, Kpi } from "@/components/ui";
import { Espandi } from "@/components/modulo";
import { EditorRicetta, type Ingrediente } from "../editor";

export const metadata: Metadata = { title: "Ricetta" };

type Fonte = { documento_id?: string; numero?: string | null; data?: string | null; fornitore?: string; prezzo_eur?: number; unita?: string; prezzo_originale?: number; valuta?: string; tasso_cambio?: number | null; semilavorato?: string; versione?: number };
type RigaCosto = { ingrediente: string; master_id: string | null; sotto_ricetta_id: string | null; quantita: number; unita: string; quantita_tipo: string; resa_pct: number | null; quantita_lorda: number | null; costo: number | null; motivo: string | null; fonte: Fonte | null };
type Costo = { versione: number; porzioni: number; completo: boolean; costo_totale: number | null; costo_parziale: number; costo_porzione: number | null; prezzo_vendita: number | null; margine: number | null; food_cost_pct: number | null; righe: RigaCosto[] };
type Versione = { id: string; versione: number; stato: string; porzioni: number; resa_quantita: number | null; resa_unita: string | null; prezzo_vendita: number | null; creato_il: string };
type IngDb = { master_id: string | null; sotto_ricetta_id: string | null; quantita: number; unita: string; quantita_tipo: "lorda" | "netta"; resa_pct: number | null; resa_fonte: string | null; posizione: number };

export default async function Ricetta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, attivo, operativo } = await sessioneModulo("ricette");
  const { data: r } = await supabase.from("ricette").select("id,nome,tipo,categoria,codice_pos").eq("id", id).eq("ristorante_id", attivo.id).maybeSingle<{ id: string; nome: string; tipo: "piatto" | "semilavorato"; categoria: string | null; codice_pos: string | null }>();
  if (!r) notFound();
  const [{ data: costo }, { data: versioni }, { data: master }, { data: semi }] = await Promise.all([
    supabase.rpc("costo_ricetta", { p_ricetta_id: id }),
    supabase.from("ricette_versioni").select("id,versione,stato,porzioni,resa_quantita,resa_unita,prezzo_vendita,creato_il").eq("ricetta_id", id).order("versione", { ascending: false }).returns<Versione[]>(),
    supabase.from("articoli_master").select("id,nome,unita_base").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string; unita_base: string }[]>(),
    supabase.from("ricette").select("id,nome").eq("ristorante_id", attivo.id).eq("tipo", "semilavorato").eq("attiva", true).order("nome").returns<{ id: string; nome: string }[]>(),
  ]);
  const c = costo as Costo | null;
  const attiva = (versioni ?? []).find((v) => v.stato === "attiva");
  const { data: ingredienti } = attiva ? await supabase.from("ricette_ingredienti").select("master_id,sotto_ricetta_id,quantita,unita,quantita_tipo,resa_pct,resa_fonte,posizione").eq("versione_id", attiva.id).order("posizione").returns<IngDb[]>() : { data: [] as IngDb[] };
  const testo = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/ricette" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna alle ricette"><ArrowLeft className="size-4" /></Link>
        <h1 className="text-lg font-semibold tracking-tight">{r.nome}</h1>
        <Badge>{r.tipo === "piatto" ? "Piatto" : "Semilavorato"}</Badge>
        {c && <span className="text-xs text-muted">versione {c.versione} · {num(c.porzioni, 2)} porzioni{attiva?.resa_quantita ? ` · resa ${num(attiva.resa_quantita, 3)} ${attiva.resa_unita}` : ""}</span>}
      </div>

      {c && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi etichetta="Costo per porzione" valore={c.costo_porzione != null ? money(c.costo_porzione) : "Incompleto"} tono={c.completo ? undefined : "warn"} nota={c.completo ? `Totale ricetta ${money(c.costo_totale)}` : `Calcolabili finora ${money(c.costo_parziale)}: non è il costo totale`} />
            <Kpi etichetta="Prezzo di vendita" valore={c.prezzo_vendita != null ? money(c.prezzo_vendita) : "—"} nota="Per porzione, IVA esclusa" />
            <Kpi etichetta="Incidenza del costo" valore={c.food_cost_pct != null ? `${num(c.food_cost_pct, 1)}%` : "—"} nota="Costo ÷ prezzo" />
            <Kpi etichetta="Margine per porzione" valore={c.margine != null ? money(c.margine) : "—"} tono={c.margine != null && c.margine > 0 ? "ok" : undefined} nota="Prezzo − costo teorico" />
          </div>
          <section className="card mt-3 overflow-x-auto" aria-labelledby="t-costo">
            <div className="px-4 pt-4"><h2 id="t-costo" className="text-[13px] font-medium">Come si forma il costo</h2></div>
            <table className="mt-2 w-full min-w-[780px] text-[13px]">
              <thead><tr><th scope="col" className="th">Ingrediente</th><th scope="col" className="th text-right">In ricetta</th><th scope="col" className="th text-right">Quantità lorda</th><th scope="col" className="th">Prezzo usato e fonte</th><th scope="col" className="th text-right">Costo</th></tr></thead>
              <tbody>{c.righe.map((x, i) => (
                <tr key={i} className="riga align-top">
                  <td className="td">{x.master_id ? <Link href={`/catalogo/${x.master_id}`} className="hover:underline">{x.ingrediente}</Link> : <Link href={`/ricette/${x.sotto_ricetta_id}`} className="hover:underline">{x.ingrediente} <span className="text-xs text-subtle">(semilavorato)</span></Link>}</td>
                  <td className="td num whitespace-nowrap text-right">{num(x.quantita, 3)} {x.unita}<span className="block text-xs text-subtle">{x.quantita_tipo === "netta" ? `netta${x.resa_pct != null ? ` · resa ${num(x.resa_pct, 1)}%` : ""}` : "lorda"}</span></td>
                  <td className="td num text-right">{x.quantita_lorda != null ? `${num(x.quantita_lorda, 3)} ${x.unita}` : "—"}</td>
                  <td className="td text-xs text-muted">{x.fonte?.documento_id ? (
                    <><span className="num text-fg">{money(x.fonte.prezzo_eur, "EUR", 4)}/{x.fonte.unita}</span> · {x.fonte.fornitore} · <Link href={`/documenti/${x.fonte.documento_id}`} className="underline">{x.fonte.numero ?? "s.n."} del {data(x.fonte.data)}</Link>
                      {x.fonte.valuta && x.fonte.valuta !== "EUR" && <span className="block">in origine {money(x.fonte.prezzo_originale, x.fonte.valuta, 4)} · cambio BCE {num(x.fonte.tasso_cambio, 4)}</span>}</>
                  ) : x.fonte?.semilavorato ? <>dal costo di «{x.fonte.semilavorato}», versione {x.fonte.versione}</> : <span className="text-warn">{x.motivo}</span>}</td>
                  <td className="td num text-right">{x.costo != null ? money(x.costo, "EUR", 4) : <Badge tono="warn">Non calcolabile</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        </>
      )}

      {operativo && attiva && (
        <div className="mt-4"><Espandi titolo="Modifica la ricetta (crea una nuova versione)">
          <EditorRicetta articoli={(master ?? []).map((m) => ({ id: m.id, nome: m.nome, unita: m.unita_base }))} semilavorati={semi ?? []}
            iniziale={{ id: r.id, nome: r.nome, tipo: r.tipo, categoria: r.categoria ?? "", codice_pos: r.codice_pos ?? "", porzioni: testo(attiva.porzioni), resa_quantita: testo(attiva.resa_quantita), resa_unita: attiva.resa_unita ?? "kg", prezzo_vendita: testo(attiva.prezzo_vendita),
              ingredienti: (ingredienti ?? []).map((x): Ingrediente => ({ master_id: x.master_id, sotto_ricetta_id: x.sotto_ricetta_id, quantita: testo(x.quantita), unita: x.unita, quantita_tipo: x.quantita_tipo, resa_pct: testo(x.resa_pct), resa_fonte: x.resa_fonte ?? "" })) }} />
        </Espandi></div>
      )}

      <section className="card mt-3 p-4" aria-labelledby="t-ver">
        <h2 id="t-ver" className="text-[13px] font-medium">Versioni</h2>
        <ul className="mt-2 space-y-1.5 text-xs">{(versioni ?? []).map((v) => (
          <li key={v.id} className="flex flex-wrap items-center gap-3 text-muted"><span className="num text-fg">v{v.versione}</span><span>{dataOra(v.creato_il)}</span><span className="num">{num(v.porzioni, 2)} porzioni{v.prezzo_vendita != null ? ` · ${money(v.prezzo_vendita)}` : ""}</span>{v.stato === "attiva" ? <Badge tono="ok">Attiva</Badge> : <Badge>Archiviata</Badge>}</li>
        ))}</ul>
      </section>
    </div>
  );
}
