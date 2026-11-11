import type { Metadata } from "next";
import Link from "next/link";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data } from "@/lib/format";
import type { Allergene } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi } from "@/components/modulo";
import { Stampa } from "@/components/stampa";
import { NavAutocontrollo } from "../navigazione";
import { SchedaProdotto, type Info } from "./scheda";

export const metadata: Metadata = { title: "Allergeni" };

type Riga = { ricetta_id: string; nome: string; categoria: string | null; tipo: string; allergeni: string[]; tracce: string[]; mancanti: string[] };

export default async function Allergeni() {
  const c = await contestoAutocontrollo();
  const { supabase, attivo, puoGestire, ruolo, oggi } = c;
  const [{ data: elenco }, { data: matrice }, { data: master }, { data: info }, { data: schede }] = await Promise.all([
    supabase.from("allergeni").select("*").order("ordine").returns<Allergene[]>(),
    supabase.rpc("matrice_allergeni", { p_ristorante_id: attivo.id }),
    supabase.from("articoli_master").select("id,nome").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string }[]>(),
    supabase.from("info_prodotti").select("master_id,ingredienti,allergeni,tracce,fonte,archivio_id,energia_kj,energia_kcal,grassi,grassi_saturi,carboidrati,zuccheri,proteine,sale,aggiornato_il")
      .returns<(Info & { master_id: string; aggiornato_il: string })[]>(),
    supabase.from("archivio").select("id,titolo").eq("ristorante_id", attivo.id).eq("categoria", "scheda_tecnica_prodotto").eq("archiviato", false).returns<{ id: string; titolo: string }[]>(),
  ]);
  const all = elenco ?? []; const righe = ((matrice ?? []) as Riga[]).filter((r) => r.tipo === "piatto");
  const infoDi = new Map((info ?? []).map((i) => [i.master_id, i]));
  const senzaScheda = (master ?? []).filter((m) => !infoDi.has(m.id)).length;
  const completo = ruolo === "titolare" || ruolo === "chef";

  return (
    <>
      <Intestazione titolo="Allergeni" sottotitolo={<>{attivo.nome} · aggiornato al {data(oggi)}</>}><Stampa etichetta="Stampa la matrice" /></Intestazione>
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="allergeni" />

      <section className="card mb-4 overflow-x-auto" aria-labelledby="t-mat">
        <div className="px-4 pt-4"><h2 id="t-mat" className="text-[13px] font-medium">Allergeni presenti nei piatti</h2>
          <p className="text-xs text-muted">● contiene · ○ può contenere tracce. Calcolato dalle ricette e dalle schede dei prodotti: un piatto con ingredienti senza scheda è segnalato come incompleto.</p></div>
        {righe.length ? (
          <table className="mt-2 w-full min-w-[900px] text-xs">
            <thead><tr><th scope="col" className="th">Piatto</th>{all.map((a) => <th key={a.codice} scope="col" className="th text-center" title={a.nome}><span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{a.nome}</span></th>)}</tr></thead>
            <tbody>{righe.map((r) => (
              <tr key={r.ricetta_id} className="riga">
                <th scope="row" className="td text-left font-medium">{r.nome}{r.mancanti.length > 0 && <span className="block font-normal text-warn">Incompleto: manca la scheda di {r.mancanti.join(", ")}</span>}</th>
                {all.map((a) => <td key={a.codice} className="td text-center">{r.allergeni.includes(a.codice) ? <span aria-label="contiene">●</span> : r.tracce.includes(a.codice) ? <span aria-label="tracce">○</span> : <span className="text-subtle" aria-label="no">·</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessun piatto">La matrice si compone dalle <Link className="underline" href="/ricette">ricette</Link>.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] text-subtle">Elenco dei 14 allergeni come da tabella fornita dal consulente (Reg. UE 1169/2011, allegato II). Prima di esporre la matrice al pubblico verificate le ricette e le contaminazioni crociate della vostra cucina.</p>
      </section>

      <section className="print:hidden" aria-labelledby="t-schede">
        <h2 id="t-schede" className="eyebrow mb-2">Schede dei prodotti {senzaScheda > 0 && <Badge tono="warn">{senzaScheda} senza scheda</Badge>}</h2>
        <ul className="card divide-y divide-line">{(master ?? []).map((m) => {
          const i = infoDi.get(m.id);
          return (
            <li key={m.id} className="p-4 text-[13px]">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{m.nome}</span>
                {i ? <><span className="text-xs text-muted">{i.allergeni.length ? i.allergeni.map((k) => all.find((a) => a.codice === k)?.nome).join(", ") : "nessun allergene"}{i.tracce.length ? ` · tracce: ${i.tracce.map((k) => all.find((a) => a.codice === k)?.nome).join(", ")}` : ""}</span>
                  <Badge>{{ scheda_tecnica: "Scheda tecnica", etichetta: "Etichetta", manuale: "Manuale" }[i.fonte]}</Badge></> : <Badge tono="warn">Scheda mancante</Badge>}</div>
              {puoGestire && <div className="mt-2"><Espandi titolo={i ? "Modifica la scheda" : "Compila la scheda"}><SchedaProdotto master={m.id} info={i ?? null} allergeni={all} schede={schede ?? []} /></Espandi></div>}
            </li>
          );
        })}</ul>
        {completo && <p className="mt-2 text-[11px] text-subtle">Le etichette dei prodotti preconfezionati o da asporto si generano dalla pagina di ciascuna ricetta.</p>}
      </section>
    </>
  );
}
