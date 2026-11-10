import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { cn, money, num, pct, periodo } from "@/lib/format";
import { Badge, Intestazione, Kpi, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi, Modulo } from "@/components/modulo";
import { EditorRicetta, ImportVendite } from "./editor";

export const metadata: Metadata = { title: "Ricette e food cost" };

type Margine = { ricetta_id: string; nome: string; categoria: string | null; completo: boolean | null; costo_porzione: number | null; prezzo_vendita: number | null; margine: number | null; food_cost_pct: number | null; porzioni_vendute: number; per_servizio: Record<string, number> | null; ricavo: number | null; margine_totale: number | null };
type Scostamento = { master_id: string; articolo: string; unita: string; teorico: number | null; effettivo: number | null; perdite: number | null; scostamento: number | null; scostamento_pct: number | null; incompleto: boolean };

export default async function Ricette() {
  const { supabase, attivo, piano, inclusa, scrivibile, operativo, ruolo } = await sessioneModulo("ricette");
  const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
  const dal = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(Date.now() - 29 * 86400000));
  const [{ data: margini }, { data: scost }, { data: ricette }, { data: master }] = await Promise.all([
    supabase.rpc("margini_ricette", { p_ristorante_id: attivo.id, p_dal: dal, p_al: oggi }),
    supabase.rpc("scostamenti_consumo", { p_ristorante_id: attivo.id, p_dal: dal, p_al: oggi }),
    supabase.from("ricette").select("id,nome,tipo,codice_pos").eq("ristorante_id", attivo.id).eq("attiva", true).order("nome").returns<{ id: string; nome: string; tipo: string; codice_pos: string | null }[]>(),
    supabase.from("articoli_master").select("id,nome,unita_base").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string; unita_base: string }[]>(),
  ]);
  const piatti = (margini ?? []) as Margine[]; const scostamenti = (scost ?? []) as Scostamento[];
  const semilavorati = (ricette ?? []).filter((r) => r.tipo === "semilavorato");
  const incompleti = piatti.filter((p) => p.completo === false).length;
  const venduti = piatti.reduce((t, p) => t + Number(p.porzioni_vendute), 0);
  const margineTot = piatti.reduce((t, p) => t + Number(p.margine_totale ?? 0), 0);
  const puoVendite = scrivibile && ruolo !== "sola_lettura";

  return (
    <>
      <Intestazione titolo="Ricette e food cost" sottotitolo={<>{attivo.nome} · vendite dal {periodo(dal, oggi)} · importi in EUR, IVA esclusa</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Ricette e food cost" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Piatti" valore={piatti.length} nota={`${semilavorati.length} semilavorati`} />
        <Kpi etichetta="Costo incompleto" valore={incompleti} tono={incompleti ? "warn" : undefined} nota={incompleti ? "Manca resa, conversione o prezzo" : "Tutti i costi calcolabili"} />
        <Kpi etichetta="Porzioni vendute · 30 giorni" valore={venduti ? num(venduti, 0) : "—"} nota={venduti ? "Da vendite registrate o importate" : "Nessuna vendita registrata"} />
        <Kpi etichetta="Margine teorico · 30 giorni" valore={venduti ? money(margineTot) : "—"} tono={venduti && margineTot > 0 ? "ok" : undefined} nota="Porzioni × (prezzo − costo teorico attuale)" />
      </div>

      <section className="card overflow-x-auto" aria-labelledby="t-piatti">
        <div className="px-4 pt-4"><h2 id="t-piatti" className="text-[13px] font-medium">Marginalità per piatto</h2></div>
        {piatti.length ? (
          <table className="mt-2 w-full min-w-[820px] text-[13px]">
            <thead><tr><th scope="col" className="th">Piatto</th><th scope="col" className="th text-right">Costo per porzione</th><th scope="col" className="th text-right">Prezzo</th><th scope="col" className="th text-right">Incidenza</th><th scope="col" className="th text-right">Margine</th><th scope="col" className="th text-right">Vendute (pranzo / cena)</th><th scope="col" className="th text-right">Margine del periodo</th></tr></thead>
            <tbody>{piatti.map((p) => (
              <tr key={p.ricetta_id} className="riga">
                <td className="td"><Link href={`/ricette/${p.ricetta_id}`} className="font-medium hover:underline">{p.nome}</Link>{p.categoria && <span className="block text-xs text-subtle">{p.categoria}</span>}</td>
                <td className="td num text-right">{p.costo_porzione != null ? money(p.costo_porzione) : <Badge tono="warn">Incompleto</Badge>}</td>
                <td className="td num text-right">{p.prezzo_vendita != null ? money(p.prezzo_vendita) : <span className="text-subtle">non indicato</span>}</td>
                <td className="td num text-right">{p.food_cost_pct != null ? `${num(p.food_cost_pct, 1)}%` : "—"}</td>
                <td className="td num text-right">{p.margine != null ? money(p.margine) : "—"}</td>
                <td className="td num text-right">{Number(p.porzioni_vendute) ? <>{num(p.porzioni_vendute, 0)} <span className="text-xs text-subtle">({num(p.per_servizio?.pranzo ?? 0, 0)} / {num(p.per_servizio?.cena ?? 0, 0)})</span></> : <span className="text-subtle">—</span>}</td>
                <td className={cn("td num text-right", Number(p.margine_totale) > 0 && "text-ok")}>{p.margine_totale != null && Number(p.porzioni_vendute) ? money(p.margine_totale) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessuna ricetta">Crea la prima ricetta qui sotto: gli ingredienti si scelgono dal catalogo master.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-subtle">
          Costo teorico = somma degli ingredienti (quantità lorda × ultimo prezzo netto di acquisto nella sede, al cambio BCE della fattura). Incidenza = costo ÷ prezzo. Il margine del periodo usa il costo della versione attiva oggi, non quello del giorno della vendita.
        </p>
      </section>

      <section className="card mt-3 overflow-x-auto" aria-labelledby="t-scost">
        <div className="px-4 pt-4"><h2 id="t-scost" className="text-[13px] font-medium">Consumo teorico ed effettivo · {periodo(dal, oggi)}</h2></div>
        {scostamenti.length ? (
          <table className="mt-2 w-full min-w-[720px] text-[13px]">
            <thead><tr><th scope="col" className="th">Articolo</th><th scope="col" className="th text-right">Teorico (dalle vendite)</th><th scope="col" className="th text-right">Effettivo (dai movimenti)</th><th scope="col" className="th text-right">Scostamento</th><th scope="col" className="th text-right">Scarti e omaggi</th></tr></thead>
            <tbody>{scostamenti.map((s) => (
              <tr key={s.master_id} className="riga">
                <td className="td">{s.articolo}{s.incompleto && <Badge tono="warn" className="ml-2">Parziale: unità non convertibili</Badge>}</td>
                <td className="td num text-right">{s.teorico != null ? `${num(s.teorico, 3)} ${s.unita}` : <span className="text-subtle">nessuna vendita</span>}</td>
                <td className="td num text-right">{s.effettivo != null ? `${num(s.effettivo, 3)} ${s.unita}` : <span className="text-subtle">nessun consumo registrato</span>}</td>
                <td className={cn("td num text-right", Number(s.scostamento) > 0 ? "text-warn" : Number(s.scostamento) < 0 ? "text-ok" : "")}>{s.scostamento != null ? <>{Number(s.scostamento) > 0 ? "+" : ""}{num(s.scostamento, 3)} {s.unita}{s.scostamento_pct != null && <span className="text-xs text-subtle"> ({pct(s.scostamento_pct)})</span>}</> : "—"}</td>
                <td className="td num text-right text-muted">{s.perdite != null ? `${num(s.perdite, 3)} ${s.unita}` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Dati insufficienti">Servono vendite registrate e movimenti di consumo a magazzino nello stesso periodo.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-subtle">Uno scostamento positivo significa che si è consumato più di quanto le vendite giustifichino. Le cause possibili sono porzioni abbondanti, scarti non registrati, vendite mancanti o ricette non aggiornate: l&apos;app mostra il dato, la causa va verificata.</p>
      </section>

      <div className="mt-4 space-y-2">
        {operativo && <Espandi titolo="Nuova ricetta" aperto={!piatti.length && !semilavorati.length}>
          <EditorRicetta articoli={(master ?? []).map((m) => ({ id: m.id, nome: m.nome, unita: m.unita_base }))} semilavorati={semilavorati}
            iniziale={{ nome: "", tipo: "piatto", categoria: "", codice_pos: "", porzioni: "1", resa_quantita: "", resa_unita: "kg", prezzo_vendita: "", ingredienti: [{ master_id: null, sotto_ricetta_id: null, quantita: "", unita: "g", quantita_tipo: "lorda", resa_pct: "", resa_fonte: "" }] }} />
        </Espandi>}
        {puoVendite && piatti.length > 0 && (
          <>
            <Espandi titolo="Registra le vendite di un servizio">
              <Modulo rpc="registra_vendita" fissi={{ p_ristorante_id: "@sede", p_fonte: "manuale" }} compatto invio="Registra" fatto="Vendita registrata" campi={[
                { nome: "p_ricetta_id", etichetta: "Piatto", tipo: "select", richiesto: true, opzioni: piatti.map((p) => ({ valore: p.ricetta_id, etichetta: p.nome })) },
                { nome: "p_giorno", etichetta: "Giorno", tipo: "data", richiesto: true, iniziale: oggi }, { nome: "p_quantita", etichetta: "Porzioni", tipo: "numero", richiesto: true },
                { nome: "p_servizio", etichetta: "Servizio", tipo: "select", opzioni: [{ valore: "pranzo", etichetta: "Pranzo" }, { valore: "cena", etichetta: "Cena" }] }]} />
            </Espandi>
            <Espandi titolo="Importa le vendite da file (esportazione della cassa)"><ImportVendite ricette={(ricette ?? []).filter((r) => r.tipo === "piatto")} /></Espandi>
          </>
        )}
      </div>
    </>
  );
}
