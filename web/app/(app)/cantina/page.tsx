import type { Metadata } from "next";
import { sessioneModulo } from "@/lib/sessione";
import { data, num } from "@/lib/format";
import { Badge, Intestazione, Kpi, Vuoto } from "@/components/ui";
import { StatoModulo } from "@/components/modulo-stato";
import { Espandi, Modulo } from "@/components/modulo";
import { AzioniLotto, CostoStorico, StatoLotto, type Giacenza } from "@/components/lotti";

export const metadata: Metadata = { title: "Cantina" };

/** Finestra di consumo: un'indicazione inserita da una persona, con la sua fonte. Non è una valutazione dell'app. */
function Finestra({ g, anno }: { g: Giacenza; anno: number }) {
  if (g.consumo_dal == null && g.consumo_al == null) return <span className="text-xs text-subtle">non indicata</span>;
  const stato = g.consumo_dal != null && anno < g.consumo_dal ? { t: "Non ancora", tono: "neutro" as const }
    : g.consumo_al != null && anno > g.consumo_al ? { t: "Oltre la finestra", tono: "warn" as const }
    : g.consumo_al != null && anno === g.consumo_al ? { t: "Ultimo anno", tono: "warn" as const } : { t: "Nella finestra", tono: "ok" as const };
  return (
    <span className="text-xs">
      <span className="num">{g.consumo_dal ?? "…"}–{g.consumo_al ?? "…"}</span> <Badge tono={stato.tono} className="ml-1">{stato.t}</Badge>
      <span className="mt-0.5 block text-subtle">{g.consumo_fonte ? `Fonte: ${g.consumo_fonte}` : "Fonte non indicata"}{g.consumo_note ? ` · ${g.consumo_note}` : ""}</span>
    </span>
  );
}

export default async function Cantina() {
  const { supabase, attivo, piano, inclusa, scrivibile, operativo } = await sessioneModulo("cantina");
  const [{ data: tutte }, { data: master }, { data: ubicazioni }] = await Promise.all([
    supabase.from("v_giacenze").select("*").eq("ristorante_id", attivo.id).eq("tipo", "cantina").order("master_nome").order("annata").limit(1000).returns<Giacenza[]>(),
    supabase.from("articoli_master").select("id,nome").eq("gruppo_id", attivo.gruppo_id).order("nome").returns<{ id: string; nome: string }[]>(),
    supabase.from("ubicazioni").select("id,nome").eq("ristorante_id", attivo.id).eq("attiva", true).order("nome").returns<{ id: string; nome: string }[]>(),
  ]);
  const bottiglie = (tutte ?? []).filter((g) => Number(g.quantita_residua) > 0);
  const anno = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Rome" }).format(new Date()));
  const oltre = bottiglie.filter((g) => g.consumo_al != null && anno >= g.consumo_al);

  return (
    <>
      <Intestazione titolo="Cantina" sottotitolo={<>{attivo.nome} · quantità in bottiglie · anno di riferimento {anno}</>} />
      <StatoModulo piano={piano} inclusa={inclusa} scrivibile={scrivibile} nome="Cantina" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi etichetta="Bottiglie in cantina" valore={num(bottiglie.reduce((t, g) => t + Number(g.quantita_residua), 0), 0)} nota={`${bottiglie.length} lotti · ${new Set(bottiglie.map((g) => g.master_id)).size} etichette`} />
        <Kpi etichetta="All'ultimo anno o oltre" valore={oltre.length} tono={oltre.length ? "warn" : undefined} nota="Secondo le finestre indicate" />
        <Kpi etichetta="Senza finestra di consumo" valore={bottiglie.filter((g) => g.consumo_dal == null && g.consumo_al == null).length} nota="Indicazione non inserita" />
      </div>

      <div className="card overflow-x-auto">
        {bottiglie.length ? (
          <table className="w-full min-w-[900px] text-[13px]">
            <caption className="sr-only">Bottiglie in cantina</caption>
            <thead><tr><th scope="col" className="th">Vino</th><th scope="col" className="th">Annata</th><th scope="col" className="th">Posizione</th><th scope="col" className="th text-right">Bottiglie</th><th scope="col" className="th">Finestra di consumo</th><th scope="col" className="th text-right">Prezzo d&apos;acquisto</th><th className="th"><span className="sr-only">Azioni</span></th></tr></thead>
            <tbody>{bottiglie.map((g) => (
              <tr key={g.id} className="riga">
                <td className="td"><span className="font-medium">{g.master_nome}</span><StatoLotto g={g} />
                  <span className="block text-xs text-subtle">{[g.produttore, g.provenienza, g.formato].filter(Boolean).join(" · ") || "produttore non indicato"} · acquistato il {data(g.ricevuto_il)}{g.fornitore ? ` da ${g.fornitore}` : ""}</span></td>
                <td className="td num">{g.annata ?? <span className="text-subtle">s.a.</span>}</td>
                <td className="td text-xs text-muted">{g.ubicazione_nome ?? "non indicata"}{g.codice_lotto ? ` · ${g.codice_lotto}` : ""}</td>
                <td className="td num text-right">{num(g.quantita_residua, 0)}<span className="block text-xs text-subtle">di {num(g.quantita_iniziale, 0)}</span></td>
                <td className="td"><Finestra g={g} anno={anno} /></td>
                <td className="td text-right"><CostoStorico g={g} /></td>
                <td className="td">{operativo && <AzioniLotto g={g} cantina />}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Vuoto titolo="La cantina è vuota">Aggiungi le bottiglie qui sotto. L&apos;etichetta deve esistere nel catalogo master.</Vuoto>}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Il prezzo indicato è quello storico di acquisto, nella valuta della fattura: non è una stima del valore attuale, che l&apos;app non calcola.
        La finestra di consumo è un&apos;indicazione inserita e modificabile da chi gestisce la cantina, mostrata insieme alla sua fonte.
      </p>

      {operativo && (
        <div className="mt-4"><Espandi titolo="Aggiungi bottiglie" aperto={!bottiglie.length}>
          <Modulo rpc="ricevi_lotto" fissi={{ p_ristorante_id: "@sede" }} inDati="p_dati" invio="Aggiungi alla cantina" fatto="Bottiglie aggiunte" datiFissi={{ tipo: "cantina", unita: "pz" }} campi={[
            { nome: "master_id", etichetta: "Etichetta (dal catalogo)", tipo: "select", richiesto: true, opzioni: (master ?? []).map((m) => ({ valore: m.id, etichetta: m.nome })) },
            { nome: "quantita", etichetta: "Bottiglie", tipo: "numero", richiesto: true },
            { nome: "annata", etichetta: "Annata", tipo: "numero" }, { nome: "produttore", etichetta: "Produttore" }, { nome: "provenienza", etichetta: "Provenienza" }, { nome: "formato", etichetta: "Formato", segnaposto: "es. 0,75 lt" },
            { nome: "ubicazione_id", etichetta: "Posizione", tipo: "select", opzioni: (ubicazioni ?? []).map((u) => ({ valore: u.id, etichetta: u.nome })) }, { nome: "codice_lotto", etichetta: "Scaffale o riferimento" },
            { nome: "costo_unitario", etichetta: "Prezzo d'acquisto per bottiglia", tipo: "numero" }, { nome: "valuta", etichetta: "Valuta", tipo: "select", opzioni: ["EUR", "CHF", "USD", "GBP"].map((v) => ({ valore: v, etichetta: v })) },
            { nome: "consumo_dal", etichetta: "Da bere dal (anno)", tipo: "numero" }, { nome: "consumo_al", etichetta: "Entro il (anno)", tipo: "numero" },
            { nome: "consumo_fonte", etichetta: "Fonte dell'indicazione", segnaposto: "es. scheda del produttore, sommelier", largo: true },
            { nome: "consumo_note", etichetta: "Assunzioni e note", tipo: "area", largo: true }]} />
        </Espandi></div>
      )}
    </>
  );
}
