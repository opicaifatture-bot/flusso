"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { esegui } from "@/lib/azioni";
import { CATEGORIE_ARCHIVIO } from "@/lib/autocontrollo";

type Voce = { id: string; nome: string };
const ESTENSIONI: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function impronta(file: File) {
  const h = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Carica un file nell'archivio: nuovo documento, oppure nuova versione di uno esistente. */
export function CaricaDocumento({ sede, documento, collegamenti }: {
  sede: string; documento?: { id: string; titolo: string };
  collegamenti: { fornitori: Voce[]; articoli: Voce[]; persone: Voce[]; attrezzature: Voce[] };
}) {
  const router = useRouter();
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null);
  const [inCorso, avvia] = useTransition();

  const invia = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    const file = fd.get("file") as File | null;
    if (!file || !file.size) return setEsito({ ok: false, testo: "Scegli un file" });
    const ext = ESTENSIONI[file.type];
    if (!ext) return setEsito({ ok: false, testo: "Formato non supportato: usa PDF, JPG, PNG o WEBP" });
    if (file.size > 25 * 1024 * 1024) return setEsito({ ok: false, testo: "File troppo grande: massimo 25 MB" });
    avvia(async () => {
      setEsito(null);
      const percorso = `${sede}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabaseBrowser().storage.from("archivio").upload(percorso, file, { contentType: file.type });
      if (error) return setEsito({ ok: false, testo: "Caricamento non riuscito: " + error.message });
      const v = (k: string) => String(fd.get(k) ?? "").trim();
      const dati: Record<string, unknown> = {
        revisione: v("revisione"), data_documento: v("data_documento"), scadenza: v("scadenza"), note: v("note"),
        file: { path: percorso, nome: file.name, mime: file.type, dimensione: file.size, sha256: await impronta(file) },
      };
      if (!documento) Object.assign(dati, { categoria: v("categoria"), titolo: v("titolo"), fornitore_id: v("fornitore_id"), master_id: v("master_id"), persona_id: v("persona_id"), attrezzatura_id: v("attrezzatura_id") });
      for (const k of Object.keys(dati)) if (dati[k] === "") delete dati[k];
      const r = await esegui<{ versione: number }>("archivia_file", { p_ristorante_id: "@sede", p_dati: dati, p_archivio_id: documento?.id ?? null });
      if (!r.ok) return setEsito({ ok: false, testo: r.errore });
      setEsito({ ok: true, testo: documento ? `Versione ${r.dati?.versione} caricata` : "Documento archiviato" });
      form.reset(); router.refresh();
    });
  };

  const sel = (nome: string, etichetta: string, voci: Voce[]) => voci.length > 0 && (
    <div><label className="label" htmlFor={`cd-${nome}`}>{etichetta} <span className="font-normal text-subtle">· facoltativo</span></label>
      <select id={`cd-${nome}`} name={nome} className="input" defaultValue=""><option value="">—</option>{voci.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select></div>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); invia(e.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
      {!documento && (
        <>
          <div><label className="label" htmlFor="cd-cat">Tipo di documento</label>
            <select id="cd-cat" name="categoria" required className="input" defaultValue=""><option value="" disabled>Scegli…</option>
              {Object.entries(CATEGORIE_ARCHIVIO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          <div><label className="label" htmlFor="cd-tit">Titolo</label><input id="cd-tit" name="titolo" required className="input" placeholder="es. Scheda tecnica mozzarella" /></div>
        </>
      )}
      <div className="sm:col-span-2"><label className="label" htmlFor="cd-file">File (PDF o foto, massimo 25 MB)</label>
        <input id="cd-file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="block text-xs file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-fg" /></div>
      <div><label className="label" htmlFor="cd-rev">Revisione <span className="font-normal text-subtle">· facoltativo</span></label><input id="cd-rev" name="revisione" className="input" placeholder="es. Rev. 03" /></div>
      <div><label className="label" htmlFor="cd-data">Data del documento <span className="font-normal text-subtle">· facoltativo</span></label><input id="cd-data" name="data_documento" type="date" className="input" /></div>
      <div><label className="label" htmlFor="cd-scad">Scadenza o prossimo rinnovo <span className="font-normal text-subtle">· facoltativo</span></label><input id="cd-scad" name="scadenza" type="date" className="input" /></div>
      {!documento && (
        <>
          {sel("fornitore_id", "Fornitore", collegamenti.fornitori)}
          {sel("master_id", "Prodotto", collegamenti.articoli)}
          {sel("persona_id", "Persona", collegamenti.persone)}
          {sel("attrezzatura_id", "Attrezzatura", collegamenti.attrezzature)}
        </>
      )}
      <div className="sm:col-span-2"><label className="label" htmlFor="cd-note">Note <span className="font-normal text-subtle">· facoltativo</span></label><input id="cd-note" name="note" className="input" /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={inCorso} className="btn btn-primary">{inCorso ? "Caricamento…" : documento ? "Carica nuova versione" : "Archivia"}</button>
        <p role="status" aria-live="polite" className={esito?.ok ? "text-xs text-ok" : "text-xs text-danger"}>{esito?.testo}</p>
      </div>
      <p className="text-[11px] leading-relaxed text-subtle sm:col-span-2">Ogni file resta conservato: una revisione nuova si aggiunge come versione, le precedenti non si cancellano. L&apos;estrazione automatica dei contenuti (CCP, analisi, scadenze) arriverà con il prossimo blocco.</p>
    </form>
  );
}
