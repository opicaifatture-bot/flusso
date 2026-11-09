import type { Metadata } from "next";
import { sessioneSede } from "@/lib/sessione";
import { Intestazione } from "@/components/ui";
import { Coda, type AliasInCoda, type Bozza } from "./coda";

export const metadata: Metadata = { title: "Da validare" };

type MasterRiga = { id: string; nome: string; unita_base: string; stato: string; categorie_master: { nome: string } | null };

export default async function Validazione() {
  const { supabase, attivo, permessi } = await sessioneSede();
  const [{ data: alias }, { data: master }, { data: categorie }] = await Promise.all([
    supabase.from("v_coda_alias").select("*").eq("ristorante_id", attivo.id)
      .order("stato_abbinamento", { ascending: false }).order("created_at", { ascending: false }).limit(200).returns<AliasInCoda[]>(),
    supabase.from("articoli_master").select("id,nome,unita_base,stato,categorie_master(nome)").eq("gruppo_id", attivo.gruppo_id)
      .order("nome").returns<MasterRiga[]>(),
    supabase.from("categorie_master").select("nome").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ nome: string }[]>(),
  ]);

  const tutti = (master ?? []).map((m) => ({ id: m.id, nome: m.nome, unita_base: m.unita_base, stato: m.stato, categoria: m.categorie_master?.nome ?? null }));
  const idBozze = tutti.filter((m) => m.stato === "bozza").map((m) => m.id);
  const { data: esempi } = idBozze.length
    ? await supabase.from("alias_articolo").select("master_id,descrizione_normalizzata").in("master_id", idBozze).returns<{ master_id: string; descrizione_normalizzata: string }[]>()
    : { data: [] };
  const bozze: Bozza[] = tutti.filter((m) => m.stato === "bozza")
    .map((m) => ({ ...m, esempi: (esempi ?? []).filter((e) => e.master_id === m.id).map((e) => e.descrizione_normalizzata) }));

  return (
    <div className="mx-auto max-w-5xl">
      <Intestazione titolo="Da validare" sottotitolo="Conferma a quale articolo del catalogo corrisponde ciò che è entrato in cucina." />
      <Coda alias={alias ?? []} bozze={bozze} master={tutti} categorie={(categorie ?? []).map((c) => c.nome)}
        permessi={{ validare: permessi.validare, approvare: permessi.approvareMaster }} />
    </div>
  );
}
