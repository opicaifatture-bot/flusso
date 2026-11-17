"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { esegui } from "@/lib/azioni";

/** Il cameriere aggiunge un ordine al tavolo. */
export function OrdineSala({ sessione, voci }: { sessione: string; voci: { id: string; nome: string; categoria: string; esaurito: boolean }[] }) {
  const router = useRouter();
  const [righe, setRighe] = useState([{ voce_id: "", quantita: 1, note: "", uscita: 1 }]);
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();
  const set = (i: number, p: Partial<(typeof righe)[0]>) => setRighe(righe.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); avvia(async () => {
      const valide = righe.filter((r) => r.voce_id);
      if (!valide.length) return setEsito({ ok: false, testo: "Scegli almeno un piatto" });
      const r = await esegui("ordina_dalla_sala", { p_sessione_id: sessione, p_righe: valide });
      if (!r.ok) return setEsito({ ok: false, testo: r.errore });
      setRighe([{ voce_id: "", quantita: 1, note: "", uscita: 1 }]); setEsito({ ok: true, testo: "Ordine inviato" }); router.refresh();
    }); }}>
      {righe.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_4rem_4rem_auto] items-end gap-2">
          <div><label className="label" htmlFor={`os-v-${i}`}>Piatto</label>
            <select id={`os-v-${i}`} className="input" value={r.voce_id} onChange={(e) => set(i, { voce_id: e.target.value })}><option value="">Scegli…</option>
              {voci.filter((v) => !v.esaurito).map((v) => <option key={v.id} value={v.id}>{v.categoria} · {v.nome}</option>)}</select></div>
          <div><label className="label" htmlFor={`os-q-${i}`}>Q.tà</label><input id={`os-q-${i}`} type="number" min={1} max={50} value={r.quantita} onChange={(e) => set(i, { quantita: Number(e.target.value) })} className="input num" /></div>
          <div><label className="label" htmlFor={`os-u-${i}`}>Uscita</label><input id={`os-u-${i}`} type="number" min={1} max={5} value={r.uscita} onChange={(e) => set(i, { uscita: Number(e.target.value) })} className="input num" /></div>
          <button type="button" aria-label="Togli" className="btn btn-ghost btn-sm px-1.5" onClick={() => setRighe(righe.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
          <input aria-label="Note" placeholder="Note (cottura, senza…)" value={r.note} onChange={(e) => set(i, { note: e.target.value })} className="input col-span-4 text-sm" />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setRighe([...righe, { voce_id: "", quantita: 1, note: "", uscita: 1 }])}><Plus className="size-3.5" />Riga</button>
        <button disabled={inCorso} className="btn btn-primary btn-sm">Invia in cucina</button>
        {esito && <span role="status" className={esito.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito.testo}</span>}
      </div>
    </form>
  );
}
