import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { sessioneSede } from "@/lib/sessione";
import { data, money } from "@/lib/format";
import { Badge, Intestazione, Variazione, Vuoto } from "@/components/ui";

export const metadata: Metadata = { title: "Catalogo" };

type Voce = {
  id: string; nome: string; unita_base: string; stato: string; categoria: string | null; n_alias: number; n_fornitori: number;
  ristorante_id: string | null; ultimo_prezzo_base: number | null; ultimo_prezzo_netto: number | null; ultima_unita: string | null;
  ultima_valuta: string | null; ultima_variazione: number | null; ultimo_acquisto: string | null;
};

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, attivo } = await sessioneSede();
  let query = supabase.from("v_catalogo").select("*").eq("gruppo_id", attivo.gruppo_id).order("nome").limit(1000);
  const cerca = q?.trim().replace(/[%,()]/g, " ");
  if (cerca) query = query.ilike("nome", `%${cerca}%`);
  const { data: voci } = await query.returns<Voce[]>();

  const gruppi = new Map<string, Voce[]>();
  for (const v of voci ?? []) {
    const c = v.categoria ?? "Senza categoria";
    gruppi.set(c, [...(gruppi.get(c) ?? []), v]);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Intestazione titolo="Catalogo master"
        sottotitolo="Gli articoli standard del gruppo: ogni riga dei documenti viene ricondotta qui, in qualunque lingua e da qualunque fornitore.">
        <form className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input name="q" defaultValue={q} placeholder="Cerca articolo…" aria-label="Cerca nel catalogo" className="input w-56 pl-8" />
        </form>
      </Intestazione>

      {!voci?.length ? (
        <div className="card"><Vuoto titolo={q ? "Nessun articolo trovato" : "Il catalogo è ancora vuoto"}>
          {q ? "Prova con un altro termine." : <>Si popola da solo con i documenti caricati. Gli articoli in attesa sono in <Link href="/validazione" className="text-fg underline">Da validare</Link>.</>}
        </Vuoto></div>
      ) : (
        <div className="space-y-6">
          {[...gruppi.entries()].sort(([a], [b]) => a.localeCompare(b, "it")).map(([categoria, righe]) => (
            <section key={categoria}>
              <h2 className="eyebrow mb-2">{categoria} <span className="num">· {righe.length}</span></h2>
              <div className="card overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <tbody>
                    {righe.map((v, i) => {
                      const qui = v.ristorante_id === attivo.id;
                      const prezzo = v.ultimo_prezzo_base ?? v.ultimo_prezzo_netto;
                      return (
                        <tr key={v.id} className={i ? "riga" : "transition-colors hover:bg-hover/60"}>
                          <td className="td">
                            <span className="font-medium">{v.nome}</span>
                            {v.stato === "bozza" && <Badge tono="warn" className="ml-2">Bozza</Badge>}
                          </td>
                          <td className="td w-40 text-xs text-muted">
                            <span className="num">{v.n_alias}</span> {Number(v.n_alias) === 1 ? "descrizione" : "descrizioni"} · <span className="num">{v.n_fornitori}</span> {Number(v.n_fornitori) === 1 ? "fornitore" : "fornitori"}
                          </td>
                          <td className="td num w-36 whitespace-nowrap text-right">
                            {qui && prezzo != null ? <>{money(prezzo, v.ultima_valuta ?? "EUR")}<span className="text-subtle">/{v.ultimo_prezzo_base != null ? v.unita_base : v.ultima_unita}</span></> : <span className="text-subtle">—</span>}
                          </td>
                          <td className="td w-20 text-right">{qui ? <Variazione v={v.ultima_variazione} /> : null}</td>
                          <td className="td w-28 whitespace-nowrap text-right text-xs text-subtle">{qui ? data(v.ultimo_acquisto) : "Altra sede"}</td>
                        </tr>
                      );
                    })}
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
