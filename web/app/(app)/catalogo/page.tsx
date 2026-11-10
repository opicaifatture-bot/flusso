import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { cn, data, money } from "@/lib/format";
import { Badge, Intestazione, Schede, Variazione, Vuoto } from "@/components/ui";

export const metadata: Metadata = { title: "Catalogo" };

export type VoceCatalogo = {
  id: string; nome: string; unita_base: string; stato: string; categoria: string | null; n_alias: number; n_fornitori: number;
  n_acquisti: number; n_rincari_aperti: number; ultimo_prezzo: number | null; ultima_unita: string | null;
  ultima_valuta: string | null; ultima_variazione: number | null; ultimo_acquisto: string | null; ultimo_fornitore: string | null;
};

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ q?: string; stato?: string; categoria?: string }> }) {
  const { q, stato = "tutti", categoria } = await searchParams;
  const { supabase, attivo } = await sessioneSede();
  const { data: tutte } = await supabase.rpc("catalogo_sede", { p_ristorante_id: attivo.id });
  const voci = ((tutte ?? []) as VoceCatalogo[]).sort((a, b) => a.nome.localeCompare(b.nome, "it"));

  const cerca = q?.trim().toLowerCase();
  const filtrate = voci.filter((v) =>
    (stato === "tutti" || v.stato === stato) && (!categoria || (v.categoria ?? "Senza categoria") === categoria)
    && (!cerca || v.nome.toLowerCase().includes(cerca)));
  const categorie = [...new Set(voci.map((v) => v.categoria ?? "Senza categoria"))].sort((a, b) => a.localeCompare(b, "it"));
  const gruppi = new Map<string, VoceCatalogo[]>();
  for (const v of filtrate) {
    const c = v.categoria ?? "Senza categoria";
    gruppi.set(c, [...(gruppi.get(c) ?? []), v]);
  }
  const url = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const tutti = { q, stato: stato === "tutti" ? undefined : stato, categoria, ...p };
    for (const [k, v] of Object.entries(tutti)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/catalogo?${s}` : "/catalogo";
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Intestazione titolo="Catalogo master"
        sottotitolo={<>Gli articoli standard del gruppo. Prezzi e acquisti si riferiscono a <span className="text-fg">{attivo.nome}</span>.</>}>
        <form className="relative" role="search">
          {stato !== "tutti" && <input type="hidden" name="stato" value={stato} />}
          {categoria && <input type="hidden" name="categoria" value={categoria} />}
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Cerca articolo…" aria-label="Cerca nel catalogo" className="input w-56 pl-8" />
        </form>
      </Intestazione>

      <Schede attiva={stato} voci={[
        { chiave: "tutti", etichetta: "Tutti", href: url({ stato: undefined }), conteggio: voci.length },
        { chiave: "attivo", etichetta: "Approvati", href: url({ stato: "attivo" }), conteggio: voci.filter((v) => v.stato === "attivo").length },
        { chiave: "bozza", etichetta: "Bozze da approvare", href: url({ stato: "bozza" }), conteggio: voci.filter((v) => v.stato === "bozza").length },
      ]} />
      {categorie.length > 1 && (
        <nav aria-label="Categoria" className="mt-3 flex flex-wrap gap-1.5">
          <Link href={url({ categoria: undefined })} aria-current={!categoria ? "true" : undefined}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", !categoria ? "border-fg/40 text-fg" : "border-line text-muted hover:text-fg")}>Tutte le categorie</Link>
          {categorie.map((c) => (
            <Link key={c} href={url({ categoria: c })} aria-current={categoria === c ? "true" : undefined}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors", categoria === c ? "border-fg/40 text-fg" : "border-line text-muted hover:text-fg")}>{c}</Link>
          ))}
        </nav>
      )}

      {!filtrate.length ? (
        <div className="card mt-4"><Vuoto titolo={voci.length ? "Nessun articolo con questi filtri" : "Il catalogo è ancora vuoto"}>
          {voci.length ? <Link href="/catalogo" className="text-fg underline">Azzera i filtri</Link>
            : <>Si popola da solo con i documenti caricati. Gli articoli in attesa sono in <Link href="/validazione" className="text-fg underline">Da validare</Link>.</>}
        </Vuoto></div>
      ) : (
        <div className="mt-5 space-y-6">
          {[...gruppi.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([cat, righe]) => (
            <section key={cat} aria-label={cat}>
              <h2 className="eyebrow mb-2">{cat} <span className="num">· {righe.length}</span></h2>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[680px] text-[13px]">
                  <thead className="sr-only"><tr><th>Articolo</th><th>Descrizioni e fornitori</th><th>Ultimo prezzo</th><th>Variazione</th><th>Ultimo acquisto</th></tr></thead>
                  <tbody>
                    {righe.map((v, i) => (
                      <tr key={v.id} className={i ? "riga" : "transition-colors hover:bg-hover/60"}>
                        <td className="td">
                          <Link href={`/catalogo/${v.id}`} className="font-medium hover:underline">{v.nome}</Link>
                          {v.stato === "bozza" ? <Badge tono="warn" className="ml-2">Bozza</Badge> : null}
                          {v.n_rincari_aperti > 0 && <Badge tono="danger" className="ml-2">{v.n_rincari_aperti} {v.n_rincari_aperti === 1 ? "rincaro" : "rincari"}</Badge>}
                        </td>
                        <td className="td w-44 text-xs text-muted">
                          <span className="num">{v.n_alias}</span> {Number(v.n_alias) === 1 ? "descrizione" : "descrizioni"} · <span className="num">{v.n_fornitori}</span> {Number(v.n_fornitori) === 1 ? "fornitore" : "fornitori"}
                        </td>
                        <td className="td num w-36 whitespace-nowrap text-right">
                          {v.ultimo_prezzo != null ? <>{money(v.ultimo_prezzo, v.ultima_valuta ?? "EUR")}<span className="text-subtle">/{v.ultima_unita}</span></> : <span className="text-subtle">—</span>}
                        </td>
                        <td className="td w-20 text-right"><Variazione v={v.ultima_variazione} /></td>
                        <td className="td w-32 whitespace-nowrap text-right text-xs text-subtle">{v.ultimo_acquisto ? data(v.ultimo_acquisto) : "Mai in questa sede"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
