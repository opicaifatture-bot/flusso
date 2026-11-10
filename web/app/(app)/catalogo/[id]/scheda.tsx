"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Unlink } from "lucide-react";
import { UNITA_BASE, type Esito } from "@/lib/tipi";
import { approvaMaster, revocaAbbinamento, unisciMaster } from "../../validazione/actions";

function useAzione() {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  const [messaggio, setMessaggio] = useState<{ ok: boolean; testo: string } | null>(null);
  const esegui = (azione: () => Promise<Esito>, fatto: string, dopo?: () => void) => avvia(async () => {
    setMessaggio(null);
    const r = await azione();
    setMessaggio(r.ok ? { ok: true, testo: fatto } : { ok: false, testo: r.errore });
    if (r.ok) { if (dopo) dopo(); else router.refresh(); }
  });
  return { inCorso, messaggio, esegui };
}

function Esito({ m }: { m: { ok: boolean; testo: string } | null }) {
  return <p role="status" aria-live="polite" className={m?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{m?.testo}</p>;
}

/** Correzione di nome, categoria e unità base (solo titolare). Cambiare l'unità ricalcola i confronti. */
export function ModuloMaster({ master, categorie }: { master: { id: string; nome: string; categoria: string | null; unita_base: string; stato: string }; categorie: string[] }) {
  const [nome, setNome] = useState(master.nome);
  const [categoria, setCategoria] = useState(master.categoria ?? "");
  const [unita, setUnita] = useState(master.unita_base);
  const { inCorso, messaggio, esegui } = useAzione();
  return (
    <form className="grid gap-3 sm:grid-cols-[1fr_14rem_6rem_auto] sm:items-end"
      onSubmit={(e) => { e.preventDefault(); if (!categoria) return; esegui(() => approvaMaster(master.id, { nome, categoria, unita }), master.stato === "bozza" ? "Articolo approvato" : unita !== master.unita_base ? "Salvato: prezzi e confronti ricalcolati con la nuova unità" : "Salvato"); }}>
      <div><label className="label" htmlFor="m-nome">Nome</label><input id="m-nome" className="input" required value={nome} onChange={(e) => setNome(e.target.value)} /></div>
      <div>
        <label className="label" htmlFor="m-cat">Categoria</label>
        <select id="m-cat" className="input" required value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="" disabled>Scegli…</option>
          {categorie.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="m-um">Unità base</label>
        <select id="m-um" className="input" value={unita} onChange={(e) => setUnita(e.target.value)}>{UNITA_BASE.map((u) => <option key={u}>{u}</option>)}</select>
      </div>
      <button disabled={inCorso} className="btn btn-primary">{master.stato === "bozza" ? "Approva" : "Salva"}</button>
      <div className="sm:col-span-4"><Esito m={messaggio} /></div>
    </form>
  );
}

export function RevocaAlias({ aliasId, descrizione }: { aliasId: string; descrizione: string }) {
  const { inCorso, messaggio, esegui } = useAzione();
  return (
    <span className="flex items-center justify-end gap-2">
      <Esito m={messaggio} />
      <button disabled={inCorso} className="btn btn-ghost btn-sm" aria-label={`Scollega ${descrizione} da questo articolo`}
        onClick={() => { if (confirm(`Scollegare «${descrizione}» da questo articolo? Tornerà in «Da validare» e i confronti di prezzo verranno ricalcolati.`)) esegui(() => revocaAbbinamento(aliasId), "Scollegato"); }}>
        <Unlink className="size-3" />Scollega
      </button>
    </span>
  );
}

export function UnisciIn({ da, nomeDa, verso, nomeVerso }: { da: string; nomeDa: string; verso: string; nomeVerso: string }) {
  const router = useRouter();
  const { inCorso, messaggio, esegui } = useAzione();
  return (
    <span className="flex items-center justify-end gap-2">
      <Esito m={messaggio} />
      <button disabled={inCorso} className="btn btn-sm"
        onClick={() => { if (confirm(`Unire «${nomeDa}» in «${nomeVerso}»? Descrizioni e storico prezzi passano a «${nomeVerso}», «${nomeDa}» viene eliminato e l'operazione non si può annullare.`)) esegui(() => unisciMaster(da, verso), "Unito", () => router.push(`/catalogo/${verso}`)); }}>
        <GitMerge className="size-3" />Unisci in questo
      </button>
    </span>
  );
}
