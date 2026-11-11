import type { Metadata } from "next";
import Link from "next/link";
import { sessioneModulo } from "@/lib/sessione";
import { data } from "@/lib/format";
import { CATEGORIE_ARCHIVIO, STATI_SCADENZA } from "@/lib/autocontrollo";
import { Badge, Intestazione, Kpi, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { NavAutocontrollo } from "./navigazione";

export const metadata: Metadata = { title: "Autocontrollo" };

type Scadenza = { ristorante_id: string; origine: string; riferimento_id: string; titolo: string; dettaglio: string | null; data_scadenza: string; giorni: number; stato: string };

export default async function Scadenzario() {
  const { supabase, attivo, piano, inclusa, scrivibile } = await sessioneModulo("autocontrollo");
  const [{ data: righe }, { count: nDoc }, { count: nPersone }, { data: manuale }] = await Promise.all([
    supabase.from("v_scadenzario").select("*").eq("ristorante_id", attivo.id).order("data_scadenza").returns<Scadenza[]>(),
    supabase.from("archivio").select("id", { count: "exact", head: true }).eq("ristorante_id", attivo.id).eq("archiviato", false),
    supabase.from("persone").select("id", { count: "exact", head: true }).eq("ristorante_id", attivo.id).eq("attiva", true),
    supabase.from("archivio").select("id,titolo").eq("ristorante_id", attivo.id).eq("categoria", "manuale_autocontrollo").eq("archiviato", false).limit(1).maybeSingle<{ id: string; titolo: string }>(),
  ]);
  const scadenze = righe ?? [];
  const scadute = scadenze.filter((s) => s.stato === "scaduta").length;
  const inScadenza = scadenze.filter((s) => s.stato === "in_scadenza").length;

  return (
    <>
      <Intestazione titolo="Autocontrollo" sottotitolo={attivo.nome} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="scadenzario" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi etichetta="Scadute" valore={scadute} tono={scadute ? "danger" : undefined} />
        <Kpi etichetta="In scadenza" valore={inScadenza} tono={inScadenza ? "warn" : undefined} nota="Documenti entro 30 giorni, manutenzioni entro 14" />
        <Kpi etichetta="Documenti in archivio" valore={nDoc ?? 0} href="/autocontrollo/documenti" nota={manuale ? "Manuale caricato" : "Manuale non ancora caricato"} />
        <Kpi etichetta="Persone attive" valore={nPersone ?? 0} href="/autocontrollo/persone" />
      </div>
      <section className="card overflow-x-auto" aria-labelledby="t-scad">
        <div className="px-4 pt-4"><h2 id="t-scad" className="text-[13px] font-medium">Scadenzario</h2></div>
        {scadenze.length ? (
          <table className="mt-2 w-full min-w-[620px] text-[13px]">
            <thead><tr><th scope="col" className="th">Scadenza</th><th scope="col" className="th">Cosa</th><th scope="col" className="th">Tipo</th><th scope="col" className="th">Stato</th></tr></thead>
            <tbody>{scadenze.map((s) => (
              <tr key={s.origine + s.riferimento_id + s.titolo} className="riga">
                <td className="td num whitespace-nowrap">{data(s.data_scadenza)}<span className="block text-xs text-subtle">{s.giorni < 0 ? `${-s.giorni} giorni fa` : s.giorni === 0 ? "oggi" : `tra ${s.giorni} giorni`}</span></td>
                <td className="td"><Link className="hover:underline" href={s.origine === "documento" ? "/autocontrollo/documenti" : "/manutenzione"}>{s.titolo}</Link></td>
                <td className="td text-xs text-muted">{s.origine === "documento" ? CATEGORIE_ARCHIVIO[s.dettaglio ?? ""] ?? "Documento" : `Manutenzione ${s.dettaglio ?? ""}`}</td>
                <td className="td"><Badge tono={STATI_SCADENZA[s.stato]?.tono}>{STATI_SCADENZA[s.stato]?.etichetta ?? s.stato}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto compatto titolo="Nessuna scadenza">Indica una scadenza sui documenti (attestati, contratti, schede) o crea piani di manutenzione: compariranno qui.</Vuoto>}
        <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-subtle">Formazione, analisi e controlli infestanti si aggiungeranno qui con i prossimi moduli. Le date sono quelle inserite o estratte dai documenti: l&apos;app non stabilisce scadenze di legge.</p>
      </section>
    </>
  );
}
