import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { money } from "@/lib/format";
import type { Allergene } from "@/lib/autocontrollo";
import { Badge, Intestazione, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Azione, Espandi } from "@/components/modulo";
import { ImportaRicette, ModuloVoce, type VoceMenu } from "./voce";

export const metadata: Metadata = { title: "Menu digitale" };

export default async function Menu() {
  const { supabase, attivo, piano, inclusa, scrivibile, ruolo } = await sessioneModulo("sala");
  const gestisce = scrivibile && (ruolo === "titolare" || ruolo === "chef");
  const [{ data: voci }, { data: allergeni }, { data: ricette }] = await Promise.all([
    supabase.from("menu_voci").select("*").eq("ristorante_id", attivo.id).order("categoria").order("ordine").order("nome").returns<(VoceMenu & { id: string; esaurito: boolean })[]>(),
    supabase.from("allergeni").select("*").order("ordine").returns<Allergene[]>(),
    gestisce ? supabase.from("ricette").select("id,nome,categoria,tipo,ricette_versioni(prezzo_vendita,stato)").eq("ristorante_id", attivo.id).eq("attiva", true).order("nome")
      .returns<{ id: string; nome: string; categoria: string | null; tipo: string; ricette_versioni: { prezzo_vendita: number | null; stato: string }[] }[]>() : Promise.resolve({ data: [] }),
  ]);
  const piatti = (ricette ?? []).filter((r) => r.tipo === "piatto");
  const giaInMenu = new Set((voci ?? []).map((v) => v.ricetta_id).filter(Boolean));
  const daImportare = piatti.map((r) => ({ id: r.id, nome: r.nome, categoria: r.categoria, prezzo: r.ricette_versioni.find((v) => v.stato === "attiva")?.prezzo_vendita ?? null }))
    .filter((r): r is { id: string; nome: string; categoria: string | null; prezzo: number } => r.prezzo != null && !giaInMenu.has(r.id));
  const categorie = [...new Set((voci ?? []).map((v) => v.categoria))];

  return (
    <>
      <Intestazione titolo="Menu digitale" sottotitolo={attivo.nome}>{gestisce && <ImportaRicette piatti={daImportare} />}</Intestazione>
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Sala" />
      <p className="mb-4 max-w-3xl text-[13px] text-muted">È il menu che il cliente vede inquadrando il QR. «Esaurito» lo può impostare anche la sala dal telefono: il piatto resta visibile ma non si può ordinare.</p>
      {gestisce && <div className="mb-4"><Espandi titolo="Aggiungi una voce" aperto={!voci?.length}><ModuloVoce ricette={piatti} allergeni={allergeni ?? []} /></Espandi></div>}
      {categorie.length ? categorie.map((cat) => (
        <section key={cat} className="mb-4"><h2 className="eyebrow mb-2">{cat}</h2>
          <ul className="card divide-y divide-line">{(voci ?? []).filter((v) => v.categoria === cat).map((v) => (
            <li key={v.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-medium">{v.nome}</span><span className="num">{money(Number(v.prezzo))}</span>
                {!v.visibile && <Badge>Nascosto</Badge>}{v.esaurito && <Badge tono="danger">Esaurito</Badge>}{v.ricetta_id && <Badge tono="ok">Ricetta collegata</Badge>}
                <span className="text-xs text-subtle">{v.reparto}{Object.keys(v.traduzioni ?? {}).length ? ` · tradotto in ${Object.keys(v.traduzioni).join(", ")}` : " · senza traduzioni"}</span>
                {scrivibile && ruolo !== "sola_lettura" && <span className="ml-auto"><Azione rpc="imposta_esaurito" parametri={{ p_voce_id: v.id, p_esaurito: !v.esaurito }} etichetta={v.esaurito ? "Di nuovo disponibile" : "Esaurito"} stile={v.esaurito ? "btn btn-sm btn-primary" : "btn btn-sm"} /></span>}
              </div>
              {gestisce && <div className="mt-2"><Espandi titolo="Modifica"><ModuloVoce voce={v} ricette={piatti} allergeni={allergeni ?? []} /></Espandi></div>}
            </li>))}</ul>
        </section>
      )) : <Vuoto titolo="Menu vuoto">{gestisce ? "Aggiungi le voci o importa i piatti dalle ricette." : "Il menu lo compila il titolare o lo chef."}</Vuoto>}
    </>
  );
}
