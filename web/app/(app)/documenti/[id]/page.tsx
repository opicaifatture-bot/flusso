import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { data, dataOra } from "@/lib/format";
import type { Documento, Riga } from "@/lib/tipi";
import { StatoBadge } from "@/components/ui";
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
type Audit = { id: number; tabella: string; prima: Record<string, unknown> | null; dopo: Record<string, unknown> | null; utente_id: string | null; ip: string | null; creato_il: string };

export default async function Dettaglio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, user, permessi } = await sessioneSede();

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

  let cronologia: Audit[] = [];
  if (completato && permessi.audit) {
    const { data: a } = await supabase.from("audit_log")
      .select("id,tabella,prima,dopo,utente_id,ip,creato_il").eq("origine", "app")
      .in("riga_id", [id, ...(righe ?? []).map((r) => r.id)]).order("id", { ascending: false }).limit(40).returns<Audit[]>();
    cronologia = (a ?? []).filter((x) => Object.keys(x.dopo ?? {}).some((k) => k in CAMPI_AUDIT)).slice(0, 12);
  }

  const titolo = completato || doc.numero ? `${doc.tipo} ${doc.numero ?? "s.n."}` : (doc.nome_file ?? "Documento");

  return (
    <>
      <InDiretta ristoranteId={doc.ristorante_id} inLavorazione={doc.stato === "in_coda" || doc.stato === "elaborazione"} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/documenti" className="btn btn-ghost btn-sm px-1.5" aria-label="Torna ai documenti"><ArrowLeft className="size-4" /></Link>
        <h1 className="num text-lg font-semibold tracking-tight">{titolo}</h1>
        <StatoBadge stato={doc.stato} fase={doc.fase} />
        <p className="ml-auto text-xs text-subtle">
          {doc.data_documento ? <>del {data(doc.data_documento)} · </> : null}acquisito il {dataOra(doc.created_at)}
        </p>
      </div>

      <Affiancato
        sinistra={<Visualizzatore url={firmato?.data?.signedUrl ?? null} mime={doc.mime ?? (doc.file_path?.match(/\.(jpe?g|png|webp)$/i) ? "image/jpeg" : doc.file_path?.endsWith(".pdf") ? "application/pdf" : null)} testo={testo} nome={doc.nome_file ?? doc.file_path?.split("/").pop() ?? "Originale"} />}
        destra={completato ? (
          <>
            <Editor documento={doc} righe={righe ?? []}
              permessi={{ righe: permessi.correggereRighe, documento: permessi.correggereDocumento, approvare: permessi.approvareRincari, contestare: permessi.contestare }} />
            {cronologia.length > 0 && (
              <section className="card mt-3 p-4">
                <h2 className="text-[13px] font-medium">Cronologia delle modifiche</h2>
                <p className="text-xs text-subtle">Dal registro di audit, non modificabile</p>
                <ul className="mt-3 space-y-2.5">
                  {cronologia.map((a) => (
                    <li key={a.id} className="flex gap-3 text-xs">
                      <span className="num w-28 shrink-0 text-subtle">{dataOra(a.creato_il)}</span>
                      <span className="min-w-0 flex-1">
                        {Object.keys(a.dopo ?? {}).filter((k) => k in CAMPI_AUDIT).map((k) => (
                          <span key={k} className="mr-3 inline-block">
                            <span className="text-muted">{CAMPI_AUDIT[k]}:</span>{" "}
                            <span className="num text-subtle line-through">{String(a.prima?.[k] ?? "—")}</span>{" → "}
                            <span className="num">{String(a.dopo?.[k] ?? "—")}</span>
                          </span>
                        ))}
                      </span>
                      <span className="shrink-0 text-subtle" title={a.ip ? `IP ${a.ip}` : undefined}>{a.utente_id === user.id ? "Tu" : `Utente …${a.utente_id?.slice(-4) ?? ""}`}</span>
                    </li>
                  ))}
                </ul>
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
