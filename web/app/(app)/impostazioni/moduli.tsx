"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { RUOLI, type Esito, type Ristorante, type Ruolo } from "@/lib/tipi";
import { Badge } from "@/components/ui";
import { dataOra } from "@/lib/format";
import { aggiungiMembro, leggiAudit, rimuoviMembro, salvaSede, verificaAudit, type EsitoAudit, type VoceAudit } from "./actions";

function Messaggio({ esito, ok }: { esito: Esito | null; ok: string }) {
  if (!esito) return null;
  return <p role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.ok ? ok : esito.errore}</p>;
}

const VALUTA_PAESE: Record<string, string> = { IT: "EUR", FR: "EUR", MC: "EUR", CH: "CHF" };

export function ModuloSede({ sede }: { sede: Ristorante }) {
  const [esito, azione, inCorso] = useActionState(salvaSede, null);
  const [paese, setPaese] = useState(sede.paese ?? "");
  const [valuta, setValuta] = useState(sede.valuta);
  return (
    <form action={azione} className="grid gap-4 sm:grid-cols-2">
      <div><label className="label" htmlFor="nome">Nome della sede</label><input id="nome" name="nome" required defaultValue={sede.nome} className="input" /></div>
      <div><label className="label" htmlFor="gruppo">Gruppo</label><input id="gruppo" name="gruppo" defaultValue={sede.gruppi?.nome ?? ""} className="input" /></div>
      <div>
        <label className="label" htmlFor="paese">Paese</label>
        <select id="paese" name="paese" required value={paese} className="input" aria-describedby="paese-nota"
          onChange={(e) => { setPaese(e.target.value); if (VALUTA_PAESE[e.target.value]) setValuta(VALUTA_PAESE[e.target.value]); }}>
          <option value="" disabled>Scegli…</option><option value="IT">Italia</option><option value="FR">Francia</option><option value="MC">Monaco</option><option value="CH">Svizzera</option>
        </select>
        <p id="paese-nota" className="mt-1 text-[11px] text-subtle">{!sede.paese ? "Non ancora indicato. " : ""}Scegliendo il paese viene proposta la sua valuta.</p>
      </div>
      <div>
        <label className="label" htmlFor="valuta">Valuta della sede</label>
        <select id="valuta" name="valuta" value={valuta} onChange={(e) => setValuta(e.target.value)} className="input"><option>EUR</option><option>CHF</option></select>
        <p className="mt-1 text-[11px] text-subtle">
          {paese && VALUTA_PAESE[paese] !== valuta ? <span className="text-warn">Diversa dalla valuta abituale del paese. </span> : null}
          I documenti restano nella loro valuta; i riepiloghi sono in EUR al cambio BCE. Le aliquote IVA sono lette dal documento, non calcolate.
        </p>
      </div>
      <div><label className="label" htmlFor="partita_iva">Partita IVA</label><input id="partita_iva" name="partita_iva" defaultValue={sede.partita_iva ?? ""} className="input num" /></div>
      <div>
        <label className="label" htmlFor="soglia">Soglia rincari (%)</label>
        <input id="soglia" name="soglia" inputMode="decimal" required defaultValue={String(Number(sede.soglia_anomalia_pct)).replace(".", ",")} className="input num" />
        <p className="mt-1 text-[11px] text-subtle">Un prezzo netto che sale oltre questa percentuale viene segnalato come rincaro.</p>
      </div>
      <div>
        <label className="label" htmlFor="soglia_min">Maggior costo minimo (€)</label>
        <input id="soglia_min" name="soglia_min" inputMode="decimal" defaultValue={String(Number(sede.soglia_anomalia_min_eur ?? 0)).replace(".", ",")} className="input num" />
        <p className="mt-1 text-[11px] text-subtle">Facoltativo. Sotto questo importo sulla riga il rincaro non viene segnalato, così gli aumenti di pochi centesimi non creano rumore. Zero = nessun minimo.</p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={inCorso} className="btn btn-primary">Salva</button>
        <Messaggio esito={esito} ok="Impostazioni salvate. Se hai cambiato le soglie, i rincari sono stati ricalcolati." />
      </div>
    </form>
  );
}

export function ModuloTeam({ membri, io }: { membri: { user_id: string; email: string; ruolo: Ruolo; livello: string }[]; io: string }) {
  const router = useRouter();
  const [esito, azione, inCorso] = useActionState(aggiungiMembro, null);
  const [errore, setErrore] = useState<string | null>(null);
  const [rimuovo, avvia] = useTransition();
  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {membri.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{m.email}{m.user_id === io && <span className="text-subtle"> · tu</span>}</span>
            {m.livello === "gruppo" && <Badge>Gruppo</Badge>}
            <span className="w-24 text-right text-xs text-muted">{RUOLI[m.ruolo]}</span>
            {m.user_id !== io && m.livello === "sede" ? (
              <button disabled={rimuovo} aria-label={`Rimuovi ${m.email}`} className="btn btn-ghost btn-sm px-1.5"
                onClick={() => avvia(async () => { const r = await rimuoviMembro(m.user_id); if (!r.ok) setErrore(r.errore); router.refresh(); })}>
                <Trash2 className="size-3.5" />
              </button>
            ) : <span className="w-7" />}
          </li>
        ))}
      </ul>
      {errore && <p role="alert" className="mt-2 text-xs text-danger">{errore}</p>}
      <form action={azione} className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1"><label className="label" htmlFor="email">Email di un utente già creato</label><input id="email" name="email" type="email" required placeholder="nome@ristorante.com" className="input" /></div>
        <div>
          <label className="label" htmlFor="ruolo">Ruolo</label>
          <select id="ruolo" name="ruolo" defaultValue="chef" className="input w-36">
            {(Object.keys(RUOLI) as Ruolo[]).map((r) => <option key={r} value={r}>{RUOLI[r]}</option>)}
          </select>
        </div>
        <button disabled={inCorso} className="btn">Aggiungi o cambia ruolo</button>
      </form>
      <div className="mt-2"><Messaggio esito={esito} ok="Team aggiornato" /></div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-xs">
          <caption className="sr-only">Cosa può fare ogni ruolo</caption>
          <thead><tr><th scope="col" className="th">Azione</th>{["Titolare", "Chef", "Contabile", "Sola lettura"].map((r) => <th key={r} scope="col" className="th text-center">{r}</th>)}</tr></thead>
          <tbody>
            {([
              ["Consultare documenti, prezzi e catalogo della sede", 1, 1, 1, 1],
              ["Caricare documenti, correggere le righe, contestare un rincaro", 1, 1, 1, 0],
              ["Correggere numero, data, valuta e totali del documento", 1, 0, 1, 0],
              ["Validare gli abbinamenti al catalogo", 1, 1, 0, 0],
              ["Approvare rincari e articoli master, unire, scollegare", 1, 0, 0, 0],
              ["Impostazioni della sede e team", 1, 0, 0, 0],
              ["Consultare e verificare il registro di audit", 1, 0, 1, 0],
              ["Vedere gli indirizzi IP nel registro", 1, 0, 0, 0],
            ] as [string, number, number, number, number][]).map(([azione, ...p]) => (
              <tr key={azione} className="riga"><th scope="row" className="td text-left font-normal text-muted">{azione}</th>
                {p.map((x, i) => <td key={i} className="td text-center">{x ? <span className="text-ok" aria-label="sì">✓</span> : <span className="text-subtle" aria-label="no">—</span>}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-subtle">
        I permessi sono applicati dal database, non solo dall&apos;interfaccia. L&apos;accesso vale per questa sede: le altre sedi del gruppo restano invisibili, salvo il catalogo che è comune.
        Un cambio di ruolo o una rimozione hanno effetto immediato, alla successiva azione dell&apos;utente; ciò che ha fatto resta nel registro di audit.
      </p>
    </div>
  );
}

export function VerificaAudit() {
  const [esito, setEsito] = useState<EsitoAudit | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <div>
      <button disabled={inCorso} className="btn"
        onClick={() => avvia(async () => { setErrore(null); const r = await verificaAudit(); if (r.ok) setEsito(r.dati!); else setErrore(r.errore); })}>
        <ShieldCheck className="size-3.5" />{inCorso ? "Verifica in corso…" : "Verifica l'integrità del registro"}
      </button>
      {errore && <p role="alert" className="mt-2 text-xs text-danger">{errore}</p>}
      {esito && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 text-[13px] ${esito.valida ? "border-ok/25 bg-ok-soft text-ok" : "border-danger/25 bg-danger-soft text-danger"}`}>
          <p className="flex items-center gap-2 font-medium">
            {esito.valida ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
            {esito.valida ? <>Catena integra: <span className="num">{esito.righe}</span> registrazioni ricalcolate, nessuna alterata o mancante</> : <>Incoerenza rilevata alla registrazione <span className="num">n. {esito.prima_anomalia_seq}</span></>}
          </p>
          {esito.dettaglio && <p className="mt-1 text-xs">{esito.dettaglio}</p>}
          {esito.ultimo_hash && <p className="num mt-1 break-all text-[11px] opacity-80">Ultimo hash: {esito.ultimo_hash}</p>}
        </div>
      )}
    </div>
  );
}

const TABELLE: Record<string, string> = {
  documenti: "Documento", storico_prezzi: "Riga", alias_articolo: "Abbinamento", articoli_master: "Catalogo",
  categorie_master: "Categoria", fornitori: "Fornitore", fornitori_ristorante: "Fornitore", ristoranti: "Sede",
  gruppi: "Gruppo", membri_ristorante: "Team", membri_gruppo: "Team",
};
const OPERAZIONI: Record<string, string> = { INSERT: "Creazione", UPDATE: "Modifica", DELETE: "Eliminazione" };
const ORIGINI: Record<string, string> = { app: "Web app", n8n: "Automazione", sql: "Database", sistema: "Sistema" };

/** Registro consultabile: filtri per origine e tipo di dato, caricamento a pagine. */
export function RegistroAudit({ iniziali, io, vedeIp }: { iniziali: VoceAudit[]; io: string; vedeIp: boolean }) {
  const [voci, setVoci] = useState(iniziali);
  const [origine, setOrigine] = useState("");
  const [tabella, setTabella] = useState("");
  const [finito, setFinito] = useState(iniziali.length < 25);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();

  const carica = (f: { origine: string; tabella: string }, accoda: boolean) => avvia(async () => {
    setErrore(null);
    const r = await leggiAudit({ ...f, primaDi: accoda ? voci[voci.length - 1]?.seq : undefined });
    if (!r.ok) return setErrore(r.errore);
    setVoci(accoda ? [...voci, ...r.dati!] : r.dati!);
    setFinito(r.dati!.length < 50);
  });

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="a-origine">Origine</label>
          <select id="a-origine" className="input w-40" value={origine} onChange={(e) => { setOrigine(e.target.value); carica({ origine: e.target.value, tabella }, false); }}>
            <option value="">Tutte</option><option value="app">Persone (web app)</option><option value="n8n">Automazione</option><option value="sql">Database</option>
          </select></div>
        <div><label className="label" htmlFor="a-tabella">Tipo di dato</label>
          <select id="a-tabella" className="input w-40" value={tabella} onChange={(e) => { setTabella(e.target.value); carica({ origine, tabella: e.target.value }, false); }}>
            <option value="">Tutti</option><option value="documenti">Documenti</option><option value="storico_prezzi">Righe</option>
            <option value="alias_articolo">Abbinamenti</option><option value="articoli_master">Catalogo</option><option value="ristoranti">Sede</option><option value="membri_ristorante">Team</option>
          </select></div>
        <p className="pb-1.5 text-xs text-subtle" aria-live="polite">{inCorso ? "Caricamento…" : `${voci.length} registrazioni mostrate`}</p>
      </div>
      {errore && <p role="alert" className="mt-2 text-xs text-danger">{errore}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[600px] text-xs">
          <caption className="sr-only">Registro di audit</caption>
          <thead><tr><th scope="col" className="th">N.</th><th scope="col" className="th">Quando</th><th scope="col" className="th">Cosa</th><th scope="col" className="th">Origine</th><th scope="col" className="th">Autore</th>{vedeIp && <th scope="col" className="th">IP</th>}</tr></thead>
          <tbody>
            {voci.map((v) => (
              <tr key={v.seq} className="riga">
                <td className="td num text-subtle">{v.seq}</td>
                <td className="td num whitespace-nowrap text-muted">{dataOra(v.creato_il)}</td>
                <td className="td">{OPERAZIONI[v.operazione] ?? v.operazione} · <span className="text-muted">{TABELLE[v.tabella] ?? v.tabella}</span>
                  {v.operazione === "UPDATE" && v.dopo && <span className="text-subtle"> ({Object.keys(v.dopo).slice(0, 3).join(", ")}{Object.keys(v.dopo).length > 3 ? "…" : ""})</span>}</td>
                <td className="td"><Badge tono={v.origine === "app" ? "info" : "neutro"}>{ORIGINI[v.origine] ?? v.origine}</Badge></td>
                <td className="td max-w-[180px] truncate text-muted">{v.utente_id ? (v.utente_id === io ? "Tu" : (v.autore ?? "Utente rimosso")) : "—"}</td>
                {vedeIp && <td className="td num text-subtle">{v.ip ?? "—"}</td>}
              </tr>
            ))}
            {!voci.length && <tr><td colSpan={vedeIp ? 6 : 5} className="px-4 py-8 text-center text-muted">Nessuna registrazione con questi filtri.</td></tr>}
          </tbody>
        </table>
      </div>
      {!finito && <button disabled={inCorso} onClick={() => carica({ origine, tabella }, true)} className="btn mt-3">Mostra le precedenti</button>}
    </div>
  );
}
