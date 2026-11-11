"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { esegui } from "@/lib/azioni";
import { CATEGORIE_CONTROLLO, FREQUENZE } from "@/lib/autocontrollo";
import { avviaEstrazione } from "./actions";

export function PulsanteEstrazione({ versione, etichetta }: { versione: string; etichetta: string }) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" disabled={inCorso} className="btn btn-sm btn-primary" onClick={() => avvia(async () => {
        const r = await avviaEstrazione(versione);
        setEsito(r.ok ? { ok: true, testo: "Lettura avviata: le proposte compariranno qui tra qualche minuto" } : { ok: false, testo: r.errore });
        router.refresh();
      })}>{inCorso ? "Avvio…" : etichetta}</button>
      {esito && <span role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.testo}</span>}
    </span>
  );
}

const CAMPI: [string, string, "testo" | "numero" | "frequenza" | "categoria" | "tipo" | "gestione"][] = [
  ["categoria", "Tipo", "categoria"], ["titolo", "Titolo", "testo"], ["fase", "Fase", "testo"], ["pericolo", "Pericolo", "testo"],
  ["tipo_pericolo", "Tipo di pericolo", "tipo"], ["misura", "Misura di controllo / procedura", "testo"], ["limite_testo", "Limite (come nel manuale)", "testo"],
  ["limite_min", "Limite minimo", "numero"], ["limite_max", "Limite massimo", "numero"], ["unita", "Unità", "testo"], ["frequenza", "Frequenza", "frequenza"],
  ["monitoraggio", "Come si controlla", "testo"], ["azione_correttiva", "Azione correttiva", "testo"], ["responsabile", "Responsabile", "testo"],
  ["verifica", "Verifica", "testo"], ["parametri", "Parametri (analisi)", "testo"], ["gestione", "Gestione", "gestione"],
];
export const ETICHETTE_CAMPI = Object.fromEntries(CAMPI.map(([k, e]) => [k, e]));

function CampiControllo({ valori, prefisso }: { valori: Record<string, unknown>; prefisso: string }) {
  return (
    <>
      {CAMPI.map(([k, et, tipo]) => {
        const id = `${prefisso}-${k}`; const v = valori[k] == null ? "" : String(valori[k]);
        return (
          <div key={k} className={["misura", "azione_correttiva", "monitoraggio", "parametri", "pericolo"].includes(k) ? "sm:col-span-2" : ""}>
            <label className="label" htmlFor={id}>{et}</label>
            {tipo === "frequenza" ? <select id={id} name={k} defaultValue={v} className="input"><option value="">—</option>{Object.entries(FREQUENZE).map(([f, n]) => <option key={f} value={f}>{n}</option>)}</select>
              : tipo === "categoria" ? <select id={id} name={k} defaultValue={v} className="input" required>{Object.entries(CATEGORIE_CONTROLLO).filter(([c]) => c !== "informazione").map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
              : tipo === "tipo" ? <select id={id} name={k} defaultValue={v} className="input"><option value="">—</option>{["biologico", "chimico", "fisico", "allergeni"].map((t) => <option key={t} value={t}>{t}</option>)}</select>
              : tipo === "gestione" ? <select id={id} name={k} defaultValue={v || "interna"} className="input"><option value="interna">Interna</option><option value="esterna">Ditta o laboratorio esterno</option></select>
              : <input id={id} name={k} defaultValue={v} inputMode={tipo === "numero" ? "decimal" : undefined} className={tipo === "numero" ? "input num" : "input"} />}
          </div>
        );
      })}
    </>
  );
}

function leggi(fd: FormData, originale?: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, , tipo] of CAMPI) {
    const t = String(fd.get(k) ?? "").trim();
    const v = tipo === "numero" ? (t === "" ? null : Number(t.replace(",", "."))) : t || null;
    if (!originale || String(originale[k] ?? "") !== String(v ?? "")) out[k] = v;
  }
  return out;
}

/** Proposta estratta dal manuale: "come da manuale", "modifica" (con motivo) oppure "scarta". */
export function Proposta({ id, categoria, dati }: { id: string; categoria: string; dati: Record<string, unknown> }) {
  const router = useRouter();
  const [modifica, setModifica] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  const decidi = (azione: string, extra: Record<string, unknown> = {}, nota?: string) => avvia(async () => {
    const r = await esegui("decidi_proposta", { p_proposta_id: id, p_azione: azione, p_dati: extra, p_nota: nota ?? null });
    if (!r.ok) return setEsito(r.errore);
    router.refresh();
  });
  if (modifica) return (
    <form className="mt-3 grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); decidi("modifica", leggi(fd, dati), String(fd.get("nota") ?? "")); }}>
      <CampiControllo valori={{ ...dati, categoria }} prefisso={`pm-${id}`} />
      <div className="sm:col-span-4"><label className="label" htmlFor={`pm-${id}-nota`}>Perché imposti un valore diverso dal manuale</label><input id={`pm-${id}-nota`} name="nota" required className="input" /></div>
      <div className="flex items-center gap-2 sm:col-span-4"><button disabled={inCorso} className="btn btn-primary btn-sm">Salva come impostazione mia</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setModifica(false)}>Annulla</button>{esito && <span className="text-xs text-danger">{esito}</span>}</div>
    </form>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button disabled={inCorso} className="btn btn-sm btn-primary" onClick={() => decidi("accetta")}>{categoria === "informazione" ? "Presa visione" : "Imposta come da manuale"}</button>
      {categoria !== "informazione" && <button disabled={inCorso} className="btn btn-sm" onClick={() => setModifica(true)}>Imposta manualmente</button>}
      <button disabled={inCorso} className="btn btn-sm btn-ghost" onClick={() => { const n = window.prompt("Perché la scarti? (facoltativo)"); if (n !== null) decidi("scarta", {}, n); }}>Scarta</button>
      {esito && <span role="status" className="text-xs text-danger">{esito}</span>}
    </div>
  );
}

/** Crea o modifica un controllo. Per un controllo che viene dal manuale chiede il motivo della modifica. */
export function ModuloControllo({ controllo, dalManuale }: { controllo?: Record<string, unknown> & { id: string }; dalManuale?: boolean }) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => {
      e.preventDefault(); const fd = new FormData(e.currentTarget); const dati = leggi(fd, controllo);
      if (dalManuale) dati.nota_differenza = String(fd.get("nota_differenza") ?? "");
      avvia(async () => {
        const r = await esegui("salva_controllo", { p_ristorante_id: "@sede", p_dati: dati, p_controllo_id: controllo?.id ?? null });
        setEsito(r.ok ? { ok: true, testo: "Salvato" } : { ok: false, testo: r.errore }); if (r.ok) router.refresh();
      });
    }}>
      <CampiControllo valori={controllo ?? {}} prefisso={`mc-${controllo?.id ?? "nuovo"}`} />
      {dalManuale && <div className="sm:col-span-4"><label className="label" htmlFor={`mc-${controllo?.id}-nd`}>Perché lo modifichi rispetto al manuale</label><input id={`mc-${controllo?.id}-nd`} name="nota_differenza" required className="input" /></div>}
      <div className="flex items-center gap-3 sm:col-span-4"><button disabled={inCorso} className="btn btn-primary btn-sm">{controllo ? "Salva le modifiche" : "Aggiungi il controllo"}</button>
        <span role="status" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</span></div>
    </form>
  );
}

const DOMANDE: Record<string, string> = {
  d1: "È possibile predisporre misure di controllo per il pericolo considerato in corrispondenza di una qualsiasi fase del processo?",
  d1b: "Il controllo in corrispondenza di questa fase è necessario per la sicurezza del prodotto?",
  d2: "La fase è specificatamente progettata per eliminare o ridurre a un livello accettabile il rischio del pericolo considerato?",
  d3: "È possibile che una contaminazione dovuta al pericolo considerato si manifesti a livelli superiori a quelli accettabili o aumenti a livelli inaccettabili?",
  d4: "Una fase successiva può eliminare il pericolo considerato o ridurne il rischio a un livello accettabile?",
};
function prossima(r: Record<string, boolean>): string | null {
  if (r.d1 === undefined) return "d1";
  if (!r.d1) return r.d1b === undefined ? "d1b" : null;
  if (r.d2 === undefined) return "d2";
  if (r.d2) return null;
  if (r.d3 === undefined) return "d3";
  if (!r.d3) return null;
  return r.d4 === undefined ? "d4" : null;
}
function esito(r: Record<string, boolean>) {
  if (!r.d1) return r.d1b ? "modificare" : "non_ccp";
  if (r.d2) return "ccp";
  if (!r.d3) return "non_ccp";
  return r.d4 ? "non_ccp" : "ccp";
}
export const ESITI_ALBERO: Record<string, string> = { ccp: "È un CCP", non_ccp: "Non è un CCP", modificare: "Modificare la fase, il processo o il prodotto" };

/** Albero delle decisioni del consulente (ALL.AD rev. 00), una domanda alla volta. */
export function AlberoDecisioni({ controllo }: { controllo: string }) {
  const router = useRouter();
  const [r, setR] = useState<Record<string, boolean>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, avvia] = useTransition();
  const q = prossima(r);
  return (
    <div className="space-y-2 text-[13px]">
      {Object.entries(r).map(([k, v]) => <p key={k} className="text-muted">{DOMANDE[k]} <strong className="text-fg">{v ? "Sì" : "No"}</strong></p>)}
      {q ? (
        <div className="rounded-md border border-line p-3"><p>{DOMANDE[q]}</p>
          <div className="mt-2 flex gap-2"><button type="button" className="btn btn-sm" onClick={() => setR({ ...r, [q]: true })}>Sì</button><button type="button" className="btn btn-sm" onClick={() => setR({ ...r, [q]: false })}>No</button></div></div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <strong>{ESITI_ALBERO[esito(r)]}</strong>
          <button type="button" disabled={inCorso} className="btn btn-sm btn-primary" onClick={() => avvia(async () => {
            const x = await esegui("valuta_albero", { p_controllo_id: controllo, p_risposte: r });
            if (!x.ok) return setErrore(x.errore); router.refresh();
          })}>Conferma la decisione</button>
        </div>
      )}
      {Object.keys(r).length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setR({})}>Ricomincia</button>}
      {errore && <p className="text-xs text-danger">{errore}</p>}
    </div>
  );
}
