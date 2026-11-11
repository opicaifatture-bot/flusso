import type { Metadata } from "next";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { dataOra, periodo } from "@/lib/format";
import { ESITI, TIPI_REGISTRAZIONE } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi } from "@/components/modulo";
import { NavAutocontrollo } from "../navigazione";
import { Registra } from "../operatore";

export const metadata: Metadata = { title: "Registri di autocontrollo" };

type Reg = { id: string; tipo: string; eseguita_il: string; esito: string; valore: number | null; unita: string | null; dati: Record<string, unknown>; azione_correttiva: string | null;
  nota: string | null; foto_path: string | null; rettifica_di: string | null; controllo_id: string | null; controlli: { titolo: string } | null; persone: { nome: string } | null };

export default async function Registri({ searchParams }: { searchParams: Promise<{ dal?: string; al?: string; tipo?: string }> }) {
  const q = await searchParams;
  const c = await contestoAutocontrollo();
  const { supabase, attivo, persone, pinObbligatorio, puoRegistrare, oggi } = c;
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(q.dal ?? "") ? q.dal! : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const al = /^\d{4}-\d{2}-\d{2}$/.test(q.al ?? "") ? q.al! : oggi;
  let query = supabase.from("registrazioni").select("id,tipo,eseguita_il,esito,valore,unita,dati,azione_correttiva,nota,foto_path,rettifica_di,controllo_id,controlli(titolo),persone(nome)")
    .eq("ristorante_id", attivo.id).gte("eseguita_il", `${dal}T00:00:00`).lte("eseguita_il", `${al}T23:59:59`).order("eseguita_il", { ascending: false }).limit(300);
  if (q.tipo && TIPI_REGISTRAZIONE[q.tipo]) query = query.eq("tipo", q.tipo);
  const { data: righe } = await query.returns<Reg[]>();
  const rettificate = new Set((righe ?? []).map((r) => r.rettifica_di).filter(Boolean));
  const descr = (r: Reg) => r.controlli?.titolo ?? String(r.dati.prodotto ?? r.dati.area ?? r.dati.fornitore ?? r.dati.trappola ?? TIPI_REGISTRAZIONE[r.tipo]);

  return (
    <>
      <Intestazione titolo="Registri" sottotitolo={<>{attivo.nome} · {periodo(dal, al)}</>} />
      <StatoModulo piano={c.piano} inclusa={c.inclusa} scrivibile={c.scrivibile} nome="Autocontrollo" />
      <NavAutocontrollo attiva="registri" />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <div><label className="label" htmlFor="f-dal">Dal</label><input id="f-dal" name="dal" type="date" defaultValue={dal} className="input" /></div>
        <div><label className="label" htmlFor="f-al">Al</label><input id="f-al" name="al" type="date" defaultValue={al} className="input" /></div>
        <div><label className="label" htmlFor="f-tipo">Tipo</label><select id="f-tipo" name="tipo" defaultValue={q.tipo ?? ""} className="input"><option value="">Tutti</option>{Object.entries(TIPI_REGISTRAZIONE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
        <button className="btn">Filtra</button>
      </form>
      {righe?.length ? (
        <ul className="card divide-y divide-line">{righe.map((r) => (
          <li key={r.id} className={rettificate.has(r.id) ? "p-4 opacity-60" : "p-4"}>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="num text-xs text-muted">{dataOra(r.eseguita_il)}</span>
              <span className="font-medium">{descr(r)}</span>
              <Badge>{TIPI_REGISTRAZIONE[r.tipo]}</Badge>
              <Badge tono={ESITI[r.esito]?.tono}>{ESITI[r.esito]?.etichetta}</Badge>
              {r.valore != null && <span className="num">{r.valore} {r.unita}</span>}
              {r.rettifica_di && <Badge tono="info">Rettifica</Badge>}
              {rettificate.has(r.id) && <Badge>Rettificata</Badge>}
              <span className="text-xs text-subtle">firmato da {r.persone?.nome ?? "utente collegato"}</span>
            </div>
            {(r.azione_correttiva || r.nota) && <p className="mt-1 text-xs text-muted">{r.azione_correttiva && <>Azione correttiva: {r.azione_correttiva}. </>}{r.nota}</p>}
            {r.foto_path && <a className="mt-1 inline-block text-xs underline" target="_blank" rel="noopener" href={`/autocontrollo/documenti/file?p=${encodeURIComponent(r.foto_path)}`}>Foto allegata</a>}
            {puoRegistrare && !rettificate.has(r.id) && <div className="mt-2"><Espandi titolo="Rettifica (errore di registrazione)">
              <Registra sede={attivo.id} persone={persone} obbligatorio={pinObbligatorio} compatto invio="Registra la rettifica"
                base={{ rettifica_di: r.id, tipo: r.tipo, controllo_id: r.controllo_id, dati: r.dati }}
                campi={[{ nome: "valore", etichetta: "Valore corretto", tipo: "numero" },
                  { nome: "esito", etichetta: "Esito", tipo: "select", richiesto: true, iniziale: r.esito, opzioni: [{ valore: "conforme", etichetta: "Conforme" }, { valore: "non_conforme", etichetta: "Non conforme" }] },
                  { nome: "nota", etichetta: "Motivo della rettifica", richiesto: true, tipo: "area" }]} />
              <p className="mt-2 text-[11px] text-subtle">La registrazione originale resta visibile e viene marcata come rettificata.</p>
            </Espandi></div>}
          </li>
        ))}</ul>
      ) : <Vuoto titolo="Nessuna registrazione nel periodo" />}
      <p className="mt-2 text-[11px] text-subtle">Le registrazioni non si modificano né si cancellano e sono conservate per almeno 2 anni. Massimo 300 righe per pagina: restringi il periodo per vederne altre.</p>
    </>
  );
}
