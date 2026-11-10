import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { AlertTriangle } from "lucide-react";
import { data, dataOra } from "@/lib/format";
import { revisione } from "@/lib/controlli";
import type { Documento, Riga } from "@/lib/tipi";
import { RevisioneBadge, StatoBadge } from "@/components/ui";
import { InDiretta } from "@/components/in-diretta";
import { Affiancato } from "./affiancato";
import { Editor } from "./editor";
import { StatoElaborazione } from "./stato-elaborazione";
import { Visualizzatore } from "./visualizzatore";

export const metadata: Metadata = { title: "Documento" };

const CAMPI_AUDIT: Record<string, string> = {
  descrizione: "Descrizione", quantita: "Quantità", unita_misura: "Unità", prezzo_unitario: "Prezzo unitario",
  sconto_percentuale: "Sconto %", totale_riga: "Totale riga", aliquota_iva: "IVA %", peso_netto_kg: "Peso netto",
  contenuto_per_unita: "Contenuto", unita_contenuto: "Unità contenuto", tipo: "Tipo", numero: "Numero",
  data_documento: "Data", imponibile: "Imponibile", iva: "IVA", totale: "Totale", valuta: "Valuta",
  anomalia_stato: "Stato rincaro", anomalia_nota: "Nota",
};
type Audit = {
  seq: number; tabella: string; operazione: string; origine: string; prima: Record<string, unknown> | null;
  dopo: Record<string, unknown> | null; utente_id: string | null; autore: string | null; ip: string | null; creato_il: string;
};
type Evento = { seq: number; quando: string; chi: string; ip: string | null; testo?: string; campi?: { nome: string; prima: string; dopo: string }[] };

export default async function Dettaglio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, user, attivo, permessi } = await sessioneSede();

  const { data: doc } = await supabase.from("documenti").select("*, fornitori(ragione_sociale,paese,partita_iva_o_estera,codice_identificativo_estero)")
    .eq("id", id).maybeSingle<Documento>();
  if (!doc) notFound();

  const completato = doc.stato === "completato";
  const xml = !!doc.mime?.includes("xml");
  const [{ data: righe }, firmato, originale] = await Promise.all([
    completato
      ? supabase.from("v_righe").select("*").eq("documento_id", id).order("numero_riga").returns<Riga[]>()
      : Promise.resolve({ data: [] as Riga[] }),
    doc.file_path && !xml ? supabase.storage.from("documenti").createSignedUrl(doc.file_path, 3600) : Promise.resolve(null),
    doc.file_path && xml ? supabase.storage.from("documenti").download(doc.file_path) : Promise.resolve(null),
  ]);
  const testo = originale?.data ? (await originale.data.text()).slice(0, 200_000) : null;

  // Cronologia dal registro di audit. Si mostrano solo le modifiche fatte da una persona,
  // più il caricamento e l'estrazione automatica: i valori provvisori creati alla
  // prenotazione (tipo "Altro", valuta "EUR") non sono modifiche e non vengono elencati.
  const cronologia: Evento[] = [];
  if (permessi.audit) {
    const { data: a } = await supabase.rpc("registro_audit", {
      p_gruppo_id: attivo.gruppo_id, p_limite: 200, p_righe: [id, ...(righe ?? []).map((r) => r.id)],
    });
    for (const x of ((a ?? []) as Audit[])) {
      const chi = x.utente_id === user.id ? "Tu" : (x.autore ?? "Automazione");
      if (x.tabella === "documenti" && x.operazione === "INSERT") {
        cronologia.push({ seq: x.seq, quando: x.creato_il, chi, ip: x.ip, testo: "File caricato" });
      } else if (x.tabella === "documenti" && x.origine !== "app" && x.dopo?.stato === "completato") {
        cronologia.push({ seq: x.seq, quando: x.creato_il, chi: "Estrazione automatica", ip: null, testo: "Dati estratti e prezzi controllati" });
      } else if (x.origine === "app" && x.operazione === "UPDATE") {
        const campi = Object.keys(x.dopo ?? {}).filter((k) => k in CAMPI_AUDIT)
          .map((k) => ({ nome: CAMPI_AUDIT[k], prima: String(x.prima?.[k] ?? "—"), dopo: String(x.dopo?.[k] ?? "—") }));
        if (campi.length) cronologia.push({ seq: x.seq, quando: x.creato_il, chi, ip: x.ip, campi });
      }
    }
  }
  const rev = revisione({
    stato: doc.stato,
    n_da_validare: (righe ?? []).filter((r) => ["da_abbinare", "proposto"].includes(r.stato_abbinamento) || r.master_stato === "bozza").length,
    n_rincari_aperti: (righe ?? []).filter((r) => r.anomalia_prezzo && r.anomalia_stato === "aperta").length,
  });
  const qualita = doc.dati_estratti?.qualita;
  const piuDocumenti = (qualita?.documenti_nel_file ?? 1) > 1;
  const pocoLeggibile = qualita?.leggibilita === "scarsa" || qualita?.leggibilita === "media";

  const titolo = completato || doc.numero ? `${doc.tipo} ${doc.numero ?? "s.n."}` : (doc.nome_file ?? "Documento");

  return (
    <>
      <InDiretta ristoranteId={doc.ristorante_id} inLavorazione={doc.stato === "in_coda" || doc.stato === "elaborazione"} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/documenti" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna ai documenti"><ArrowLeft className="size-4" /></Link>
        <h1 className="num text-lg font-semibold tracking-tight">{titolo}</h1>
        <StatoBadge stato={doc.stato} fase={doc.fase} />
        {rev && <RevisioneBadge verificato={rev.verificato} dettaglio={rev.dettaglio} />}
        <p className="ml-auto text-xs text-subtle">
          {doc.data_documento ? <>del {data(doc.data_documento)} · </> : null}acquisito il {dataOra(doc.created_at)}
        </p>
      </div>

      <Affiancato
        sinistra={<Visualizzatore url={firmato?.data?.signedUrl ?? null} mime={doc.mime ?? (doc.file_path?.match(/\.(jpe?g|png|webp)$/i) ? "image/jpeg" : doc.file_path?.endsWith(".pdf") ? "application/pdf" : null)} testo={testo} nome={doc.nome_file ?? doc.file_path?.split("/").pop() ?? "Originale"} />}
        destra={completato ? (
          <>
            {rev && !rev.verificato && (
              <p className="mb-3 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[13px] text-warn">
                L&apos;elaborazione automatica è finita, ma serve ancora un controllo: {rev.dettaglio}.{" "}
                <Link href="/validazione" className="underline">Vai alla validazione</Link>
              </p>
            )}
            {(piuDocumenti || pocoLeggibile) && (
              <p className="mb-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-[13px] text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {piuDocumenti && <>Il file sembra contenere {qualita!.documenti_nel_file} documenti: è stato registrato solo il primo. Carica gli altri separatamente. </>}
                  {pocoLeggibile && <>Leggibilità {qualita!.leggibilita} secondo il modello{qualita!.note ? `: ${qualita!.note}` : ""}. Controlla i valori sull&apos;originale.</>}
                </span>
              </p>
            )}
            <Editor documento={doc} righe={righe ?? []}
              permessi={{ righe: permessi.correggereRighe, documento: permessi.correggereDocumento, approvare: permessi.approvareRincari, contestare: permessi.contestare }} />
            {cronologia.length > 0 && (
              <section className="card mt-3 p-4" aria-labelledby="t-cron">
                <h2 id="t-cron" className="text-[13px] font-medium">Cronologia</h2>
                <p className="text-xs text-subtle">Dal registro di audit: caricamento, estrazione e correzioni manuali</p>
                <ol className="mt-3 space-y-2.5">
                  {cronologia.map((e) => (
                    <li key={e.seq} className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[7.5rem_1fr_auto]">
                      <time dateTime={e.quando} className="num text-subtle">{dataOra(e.quando)}</time>
                      <span className="min-w-0">
                        {e.testo}
                        {e.campi?.map((c) => (
                          <span key={c.nome} className="mr-3 inline-block">
                            <span className="text-muted">{c.nome}:</span>{" "}
                            <span className="num text-subtle line-through">{c.prima}</span><span aria-hidden>{" → "}</span><span className="sr-only"> diventa </span>
                            <span className="num">{c.dopo}</span>
                          </span>
                        ))}
                      </span>
                      <span className="col-start-2 truncate text-subtle sm:col-start-3">{e.chi}{e.ip ? <span className="num"> · IP {e.ip}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        ) : (
          <StatoElaborazione documento={doc} puoRiprovare={permessi.caricare} puoEliminare={permessi.correggereDocumento} />
        )}
      />
    </>
  );
}
