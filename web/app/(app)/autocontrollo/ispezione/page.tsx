import type { Metadata } from "next";
import { contestoAutocontrollo } from "@/lib/contesto-autocontrollo";
import { data, dataOra, num, periodo } from "@/lib/format";
import { CATEGORIE_CONTROLLO, ESITI, FREQUENZE, TIPI_REGISTRAZIONE } from "@/lib/autocontrollo";
import { Intestazione } from "@/components/ui";
import { Stampa } from "@/components/stampa";
import { NavAutocontrollo } from "../navigazione";

export const metadata: Metadata = { title: "Fascicolo per l'ispezione" };

type Reg = { id: string; tipo: string; eseguita_il: string; esito: string; valore: number | null; unita: string | null; azione_correttiva: string | null; nota: string | null;
  rettifica_di: string | null; dati: Record<string, unknown>; controlli: { titolo: string } | null; persone: { nome: string } | null };

/** Fascicolo stampabile (o salvabile in PDF) con manuale, piano, registri, celle, formazione e firme del periodo. */
export default async function Ispezione({ searchParams }: { searchParams: Promise<{ dal?: string; al?: string }> }) {
  const q = await searchParams;
  const c = await contestoAutocontrollo();
  const { supabase, attivo, oggi, persone } = c;
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(q.dal ?? "") ? q.dal! : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const al = /^\d{4}-\d{2}-\d{2}$/.test(q.al ?? "") ? q.al! : oggi;
  const da = `${dal}T00:00:00`, a = `${al}T23:59:59`;
  const [{ data: manuali }, { data: controlli }, { data: registri }, { data: ubicazioni }, { data: letture }, { data: allarmi }, { data: formazioni }, { data: firme }, { data: trappole }] = await Promise.all([
    supabase.from("archivio").select("titolo,categoria,archivio_versioni(versione,revisione,data_documento,caricato_il,sha256)").eq("ristorante_id", attivo.id)
      .in("categoria", ["manuale_autocontrollo", "piano_analisi", "policy_igiene"]).returns<{ titolo: string; categoria: string; archivio_versioni: { versione: number; revisione: string | null; data_documento: string | null; caricato_il: string; sha256: string }[] }[]>(),
    supabase.from("controlli").select("id,categoria,titolo,fase,pericolo,limite_testo,limite_min,limite_max,unita,frequenza,azione_correttiva,responsabile,fonte,differisce_da_manuale,nota_differenza,esito_albero")
      .eq("ristorante_id", attivo.id).eq("attivo", true).order("categoria").returns<{ id: string; categoria: string; titolo: string; fase: string | null; pericolo: string | null; limite_testo: string | null; limite_min: number | null; limite_max: number | null; unita: string | null; frequenza: string | null; azione_correttiva: string | null; responsabile: string | null; fonte: string; differisce_da_manuale: boolean; nota_differenza: string | null; esito_albero: string | null }[]>(),
    supabase.from("registrazioni").select("id,tipo,eseguita_il,esito,valore,unita,azione_correttiva,nota,rettifica_di,dati,controlli(titolo),persone(nome)").eq("ristorante_id", attivo.id)
      .gte("eseguita_il", da).lte("eseguita_il", a).order("eseguita_il").limit(2000).returns<Reg[]>(),
    supabase.from("ubicazioni").select("id,nome,temp_min,temp_max").eq("ristorante_id", attivo.id).eq("monitorata", true).returns<{ id: string; nome: string; temp_min: number | null; temp_max: number | null }[]>(),
    supabase.from("letture").select("ubicazione_id,valore").eq("ristorante_id", attivo.id).eq("qualita", "valida").gte("rilevata_il", da).lte("rilevata_il", a).limit(20000).returns<{ ubicazione_id: string; valore: number }[]>(),
    supabase.from("allarmi").select("tipo,severita,aperto_il,risolto_il,note,ubicazioni(nome)").eq("ristorante_id", attivo.id).gte("aperto_il", da).lte("aperto_il", a).order("aperto_il")
      .returns<{ tipo: string; severita: string; aperto_il: string; risolto_il: string | null; note: string | null; ubicazioni: { nome: string } | null }[]>(),
    supabase.from("formazioni").select("persona_id,tipo,titolo,data,ore,ente,scadenza").eq("ristorante_id", attivo.id).order("data").returns<{ persona_id: string; tipo: string; titolo: string; data: string; ore: number | null; ente: string | null; scadenza: string | null }[]>(),
    supabase.from("firme_policy").select("persona_id,firmata_il,valida_fino").eq("ristorante_id", attivo.id).order("firmata_il").returns<{ persona_id: string; firmata_il: string; valida_fino: string }[]>(),
    supabase.from("trappole").select("codice,tipo,posizione,gestita_da").eq("ristorante_id", attivo.id).eq("attiva", true).order("codice").returns<{ codice: string; tipo: string; posizione: string | null; gestita_da: string }[]>(),
  ]);
  const nc = (registri ?? []).filter((r) => r.esito === "non_conforme");
  const statLetture = (ubicazioni ?? []).map((u) => { const v = (letture ?? []).filter((l) => l.ubicazione_id === u.id).map((l) => Number(l.valore)); return { ...u, n: v.length, min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null }; });
  const h2 = "mt-6 mb-2 border-b border-line pb-1 text-sm font-semibold";

  return (
    <>
      <div className="print:hidden"><Intestazione titolo="Fascicolo per l'ispezione" sottotitolo={attivo.nome}><Stampa /></Intestazione><NavAutocontrollo attiva="ispezione" />
        <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
          <div><label className="label" htmlFor="i-dal">Dal</label><input id="i-dal" name="dal" type="date" defaultValue={dal} className="input" /></div>
          <div><label className="label" htmlFor="i-al">Al</label><input id="i-al" name="al" type="date" defaultValue={al} className="input" /></div>
          <button className="btn">Aggiorna</button></form></div>

      <article className="card p-6 text-[12px] leading-relaxed print:border-0 print:p-0">
        <header><h1 className="text-lg font-semibold">Registri di autocontrollo · {attivo.nome}</h1>
          <p className="text-muted">Periodo {periodo(dal, al)} · generato il {dataOra(new Date().toISOString())} · registrazioni immutabili, firmate con PIN personale o dall&apos;utente collegato</p></header>

        <h2 className={h2}>1. Documenti di riferimento</h2>
        <ul>{(manuali ?? []).flatMap((m) => [...m.archivio_versioni].sort((x, y) => y.versione - x.versione).slice(0, 1).map((v) => (
          <li key={m.titolo}>{m.titolo} · versione {v.versione}{v.revisione ? ` (${v.revisione})` : ""}{v.data_documento ? ` del ${data(v.data_documento)}` : ""} · caricato il {data(v.caricato_il)} · impronta {v.sha256.slice(0, 12)}…</li>)))}</ul>

        <h2 className={h2}>2. Piano dei controlli ({controlli?.length ?? 0})</h2>
        <table className="w-full"><thead><tr><th className="th">Controllo</th><th className="th">Limite</th><th className="th">Frequenza</th><th className="th">Azione correttiva</th><th className="th">Origine</th></tr></thead>
          <tbody>{(controlli ?? []).map((x) => (
            <tr key={x.id} className="align-top"><td className="td"><strong>{x.titolo}</strong><br /><span className="text-muted">{CATEGORIE_CONTROLLO[x.categoria]}{x.fase ? ` · ${x.fase}` : ""}{x.esito_albero === "ccp" ? " · CCP da albero delle decisioni" : ""}</span></td>
              <td className="td">{x.limite_testo ?? (x.limite_min != null || x.limite_max != null ? `${x.limite_min ?? "—"}/${x.limite_max ?? "—"} ${x.unita ?? ""}` : "—")}</td>
              <td className="td">{x.frequenza ? FREQUENZE[x.frequenza] : "—"}</td><td className="td">{x.azione_correttiva ?? "—"}</td>
              <td className="td">{x.fonte === "manuale" ? "Manuale" : "Impostato"}{x.differisce_da_manuale ? ` (diverso dal manuale: ${x.nota_differenza})` : ""}</td></tr>
          ))}</tbody></table>

        <h2 className={h2}>3. Non conformità e azioni correttive ({nc.length})</h2>
        {nc.length ? <ul>{nc.map((r) => <li key={r.id}>{dataOra(r.eseguita_il)} · {r.controlli?.titolo ?? TIPI_REGISTRAZIONE[r.tipo]} {r.valore != null ? `(${r.valore} ${r.unita ?? ""})` : ""} → {r.azione_correttiva} · {r.persone?.nome ?? "utente"}</li>)}</ul> : <p>Nessuna non conformità registrata nel periodo.</p>}

        <h2 className={h2}>4. Temperature delle celle</h2>
        {statLetture.length ? <table className="w-full"><thead><tr><th className="th">Ubicazione</th><th className="th">Intervallo impostato</th><th className="th">Letture</th><th className="th">Minima</th><th className="th">Massima</th></tr></thead>
          <tbody>{statLetture.map((u) => <tr key={u.id}><td className="td">{u.nome}</td><td className="td num">{u.temp_min ?? "—"} / {u.temp_max ?? "—"} °C</td><td className="td num">{u.n}</td><td className="td num">{u.min != null ? num(u.min, 1) : "—"}</td><td className="td num">{u.max != null ? num(u.max, 1) : "—"}</td></tr>)}</tbody></table> : <p>Nessuna ubicazione monitorata.</p>}
        {(allarmi ?? []).length > 0 && <ul className="mt-2">{allarmi!.map((x, i) => <li key={i}>{dataOra(x.aperto_il)} · {x.ubicazioni?.nome} · {x.tipo} ({x.severita}) · {x.risolto_il ? `risolto il ${dataOra(x.risolto_il)}` : "aperto"}{x.note ? ` · ${x.note}` : ""}</li>)}</ul>}

        <h2 className={h2 + " pagina-stampa"}>5. Registro delle attività ({registri?.length ?? 0})</h2>
        <table className="w-full"><thead><tr><th className="th">Data e ora</th><th className="th">Attività</th><th className="th">Esito</th><th className="th">Valore</th><th className="th">Firma</th></tr></thead>
          <tbody>{(registri ?? []).map((r) => (
            <tr key={r.id}><td className="td num whitespace-nowrap">{dataOra(r.eseguita_il)}</td>
              <td className="td">{r.controlli?.titolo ?? String(r.dati.prodotto ?? r.dati.area ?? r.dati.fornitore ?? r.dati.trappola ?? TIPI_REGISTRAZIONE[r.tipo])}{r.rettifica_di ? " (rettifica)" : ""}{r.nota ? ` · ${r.nota}` : ""}</td>
              <td className="td">{ESITI[r.esito]?.etichetta}</td><td className="td num">{r.valore ?? ""} {r.unita ?? ""}</td><td className="td">{r.persone?.nome ?? "utente"}</td></tr>
          ))}</tbody></table>

        <h2 className={h2 + " pagina-stampa"}>6. Formazione e addestramento</h2>
        <table className="w-full"><thead><tr><th className="th">Persona</th><th className="th">Formazione</th><th className="th">Scadenza</th><th className="th">Firma policy</th></tr></thead>
          <tbody>{persone.map((p) => {
            const f = (formazioni ?? []).filter((x) => x.persona_id === p.id); const fp = (firme ?? []).filter((x) => x.persona_id === p.id).at(-1);
            return <tr key={p.id} className="align-top"><td className="td">{p.nome}</td><td className="td">{f.length ? f.map((x) => `${x.titolo} (${data(x.data)}${x.ore ? `, ${num(x.ore, 0)} h` : ""}${x.ente ? `, ${x.ente}` : ""})`).join("; ") : "—"}</td>
              <td className="td">{f.map((x) => x.scadenza ? data(x.scadenza) : "").filter(Boolean).join("; ") || "—"}</td><td className="td">{fp ? `${data(fp.firmata_il)}, valida fino al ${data(fp.valida_fino)}` : "—"}</td></tr>;
          })}</tbody></table>

        <h2 className={h2}>7. Monitoraggio infestanti</h2>
        <p>Trappole attive: {(trappole ?? []).map((t) => `${t.codice} (${t.posizione ?? t.tipo}, ${t.gestita_da === "esterna" ? "ditta" : "interna"})`).join(", ") || "nessuna"}. Controlli nel periodo: {(registri ?? []).filter((r) => r.tipo === "infestanti").length}.</p>

        <p className="mt-6 text-[10px] text-muted">Documento generato da Kitchen OS dai registri digitali. Le registrazioni non sono modificabili; le correzioni compaiono come rettifiche.</p>
      </article>
    </>
  );
}
