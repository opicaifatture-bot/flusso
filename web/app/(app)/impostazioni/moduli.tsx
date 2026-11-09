"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { RUOLI, type Esito, type Ristorante, type Ruolo } from "@/lib/tipi";
import { Badge } from "@/components/ui";
import { aggiungiMembro, rimuoviMembro, salvaSede, verificaAudit, type EsitoAudit } from "./actions";

function Messaggio({ esito, ok }: { esito: Esito | null; ok: string }) {
  if (!esito) return null;
  return <p role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.ok ? ok : esito.errore}</p>;
}

export function ModuloSede({ sede }: { sede: Ristorante }) {
  const [esito, azione, inCorso] = useActionState(salvaSede, null);
  return (
    <form action={azione} className="grid gap-4 sm:grid-cols-2">
      <div><label className="label" htmlFor="nome">Nome della sede</label><input id="nome" name="nome" required defaultValue={sede.nome} className="input" /></div>
      <div><label className="label" htmlFor="gruppo">Gruppo</label><input id="gruppo" name="gruppo" defaultValue={sede.gruppi?.nome ?? ""} className="input" /></div>
      <div>
        <label className="label" htmlFor="paese">Paese</label>
        <select id="paese" name="paese" defaultValue={sede.paese ?? ""} className="input">
          <option value="">—</option><option value="IT">Italia</option><option value="FR">Francia</option><option value="MC">Monaco</option><option value="CH">Svizzera</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="valuta">Valuta della sede</label>
        <select id="valuta" name="valuta" defaultValue={sede.valuta} className="input"><option>EUR</option><option>CHF</option></select>
      </div>
      <div><label className="label" htmlFor="partita_iva">Partita IVA</label><input id="partita_iva" name="partita_iva" defaultValue={sede.partita_iva ?? ""} className="input num" /></div>
      <div>
        <label className="label" htmlFor="soglia">Soglia rincari (%)</label>
        <input id="soglia" name="soglia" inputMode="decimal" required defaultValue={String(Number(sede.soglia_anomalia_pct)).replace(".", ",")} className="input num" />
        <p className="mt-1 text-[11px] text-subtle">Un prezzo che sale oltre questa soglia viene segnalato come rincaro.</p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={inCorso} className="btn btn-primary">Salva</button>
        <Messaggio esito={esito} ok="Impostazioni salvate" />
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
      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Titolare: accesso completo, approva rincari e catalogo. Chef: carica, corregge le righe, valida gli abbinamenti.
        Contabile: carica, corregge documenti e righe, consulta l&apos;audit. Sola lettura: consultazione.
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
            {esito.valida ? <>Catena integra: <span className="num">{esito.righe}</span> registrazioni verificate</> : <>Manomissione rilevata alla registrazione <span className="num">n. {esito.prima_anomalia_seq}</span></>}
          </p>
          {esito.dettaglio && <p className="mt-1 text-xs">{esito.dettaglio}</p>}
          {esito.ultimo_hash && <p className="num mt-1 break-all text-[11px] opacity-80">Ultimo hash: {esito.ultimo_hash}</p>}
        </div>
      )}
    </div>
  );
}
