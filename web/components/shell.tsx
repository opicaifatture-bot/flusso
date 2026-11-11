"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BookOpen, ChefHat, ClipboardCheck, ChevronsUpDown, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Package, Settings, Sun, Thermometer, TrendingUp, Truck, Upload, Wine, Wrench } from "lucide-react";
import { cn } from "@/lib/format";
import { RUOLI, type Ruolo } from "@/lib/tipi";
import { limitato } from "@/lib/aree";
import { cambiaSede } from "@/app/(app)/azioni";
import { esci } from "@/app/login/actions";

type Sede = { id: string; nome: string };
type Props = {
  email: string; ruolo: Ruolo | null; sedi: Sede[]; attiva: Sede | null; gruppo: string | null;
  conteggi: { validazione: number; rincari: number; lavorazione: number; allarmi: number };
  funzioni: string[];
  children: React.ReactNode;
};

type Voce = { href: string; etichetta: string; icona: typeof LayoutDashboard; chiave?: "validazione" | "rincari" | "lavorazione" | "allarmi"; funzione?: string };
const VOCI: Voce[] = [
  { href: "/", etichetta: "Panoramica", icona: LayoutDashboard },
  { href: "/documenti", etichetta: "Documenti", icona: FileText, chiave: "lavorazione" },
  { href: "/carica", etichetta: "Carica", icona: Upload },
  { href: "/validazione", etichetta: "Da validare", icona: ListChecks, chiave: "validazione" },
  { href: "/anomalie", etichetta: "Rincari", icona: TrendingUp, chiave: "rincari" },
  { href: "/catalogo", etichetta: "Catalogo", icona: BookOpen },
];
const OPERATIVE: Voce[] = [
  { href: "/celle", etichetta: "Celle", icona: Thermometer, chiave: "allarmi", funzione: "celle" },
  { href: "/magazzino", etichetta: "Magazzino", icona: Package, funzione: "magazzino" },
  { href: "/ricette", etichetta: "Ricette", icona: ChefHat, funzione: "ricette" },
  { href: "/fornitori", etichetta: "Fornitori", icona: Truck, funzione: "fornitori" },
  { href: "/cantina", etichetta: "Cantina", icona: Wine, funzione: "cantina" },
  { href: "/manutenzione", etichetta: "Manutenzione", icona: Wrench, funzione: "manutenzione" },
];
const AUTOCONTROLLO: Voce[] = [
  { href: "/autocontrollo", etichetta: "Autocontrollo", icona: ClipboardCheck, funzione: "autocontrollo" },
];
const FINALI: Voce[] = [{ href: "/impostazioni", etichetta: "Impostazioni", icona: Settings }];

/** Gruppi del menu per ruolo: consulente e cucina vedono solo l'autocontrollo e le celle. */
function gruppi(ruolo: Ruolo | null): { titolo: string | null; voci: Voce[] }[] {
  if (limitato(ruolo)) {
    const voci = [...AUTOCONTROLLO, OPERATIVE[0], ...(ruolo === "consulente" ? [OPERATIVE[5]] : [])];
    return [{ titolo: "Autocontrollo", voci }];
  }
  return [{ titolo: "Acquisti", voci: VOCI }, { titolo: "Operations", voci: OPERATIVE }, { titolo: "Sicurezza alimentare", voci: AUTOCONTROLLO }, { titolo: null, voci: FINALI }];
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-6 place-items-center rounded-md bg-inverse text-[11px] font-bold text-inverse-fg">P</span>
      <span className="text-[13px] font-semibold tracking-tight">Price Guardian</span>
    </Link>
  );
}

function Tema() {
  const [tema, setTema] = useState<"dark" | "light">("dark");
  useEffect(() => { setTema(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const cambia = () => {
    const nuovo = tema === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nuovo;
    document.cookie = `pg_tema=${nuovo}; path=/; max-age=31536000; samesite=lax`;
    setTema(nuovo);
  };
  return (
    <button type="button" onClick={cambia} className="btn btn-ghost size-8 px-0" aria-label={tema === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}>
      {tema === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function SelettoreSede({ sedi, attiva, gruppo }: { sedi: Sede[]; attiva: Sede | null; gruppo: string | null }) {
  const router = useRouter();
  const [inCorso, avvia] = useTransition();
  if (!attiva) return null;
  if (sedi.length < 2) {
    return (
      <div className="rounded-lg border border-line bg-bg px-3 py-2">
        <p className="truncate text-[13px] font-medium">{attiva.nome}</p>
        {gruppo && <p className="truncate text-[11px] text-subtle">{gruppo}</p>}
      </div>
    );
  }
  return (
    <label className={cn("relative block rounded-lg border border-line bg-bg px-3 py-2 transition-opacity", inCorso && "opacity-60")}>
      <span className="block truncate pr-5 text-[13px] font-medium">{attiva.nome}</span>
      {gruppo && <span className="block truncate text-[11px] text-subtle">{gruppo}</span>}
      <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
      <select aria-label="Sede attiva" value={attiva.id} className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => avvia(async () => { await cambiaSede(e.target.value); router.refresh(); })}>
        {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
    </label>
  );
}

export function Shell({ email, ruolo, sedi, attiva, gruppo, conteggi, funzioni, children }: Props) {
  const percorso = usePathname();
  const attivo = (href: string) => (href === "/" ? percorso === "/" : percorso.startsWith(href));

  return (
    <div className="min-h-dvh">
      {/* Barra laterale (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-14 items-center px-4"><Logo /></div>
        <div className="px-3"><SelettoreSede sedi={sedi} attiva={attiva} gruppo={gruppo} /></div>
        <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-3" aria-label="Navigazione principale">
          {gruppi(ruolo).map((g, gi) => (
            <div key={gi} className={gi ? "mt-4" : ""}>
              {g.titolo && <p className="eyebrow mb-1 px-2.5">{g.titolo}</p>}
              <div className="space-y-0.5">
                {g.voci.map((v) => {
                  const n = v.chiave ? conteggi[v.chiave] : 0;
                  const esclusa = !!v.funzione && !funzioni.includes(v.funzione);
                  return (
                    <Link key={v.href} href={v.href} aria-current={attivo(v.href) ? "page" : undefined}
                      className={cn("flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150",
                        attivo(v.href) ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/60 hover:text-fg", esclusa && "opacity-50")}>
                      <v.icona className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">{v.etichetta}{esclusa && <span className="sr-only"> (non incluso nel piano)</span>}</span>
                      {n > 0 && (
                        <span className={cn("num rounded-full px-1.5 text-[11px] leading-[18px]",
                          v.chiave === "rincari" || v.chiave === "allarmi" ? "bg-danger-soft text-danger" : v.chiave === "lavorazione" ? "bg-info-soft text-info" : "bg-warn-soft text-warn")}>{n}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-fg" title={email}>{email}</p>
              <p className="text-[11px] text-subtle">{ruolo ? RUOLI[ruolo] : "Nessuna sede"}</p>
            </div>
            <Tema />
            <form action={esci}>
              <button className="btn btn-ghost size-8 px-0" aria-label="Esci"><LogOut className="size-4" /></button>
            </form>
          </div>
        </div>
      </aside>

      {/* Barra superiore (mobile) */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <span className="ml-1 min-w-0 flex-1 truncate text-xs text-subtle">{attiva?.nome}</span>

        <Tema />
      </header>

      <main className="mx-auto w-full max-w-[1480px] px-4 pb-24 pt-6 lg:pb-12 lg:pl-[calc(232px+2rem)] lg:pr-8 lg:pt-8">
        <div key={percorso} className="animate-in">{children}</div>
      </main>

      {/* Barra inferiore (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navigazione principale">
        {(limitato(ruolo) ? gruppi(ruolo)[0].voci : [VOCI[0], VOCI[1], OPERATIVE[0], OPERATIVE[1]]).concat({ href: "/menu", etichetta: "Menu", icona: Menu } as Voce).map((v) => {
          const n = v.chiave ? conteggi[v.chiave] : v.href === "/menu" ? conteggi.validazione + conteggi.rincari : 0;
          return (
            <Link key={v.href} href={v.href} aria-current={attivo(v.href) ? "page" : undefined}
              className={cn("relative flex h-14 flex-col items-center justify-center gap-1 text-[10px]", attivo(v.href) ? "text-fg" : "text-subtle")}>
              <v.icona className="size-[18px]" aria-hidden />
              {v.etichetta}
              {n > 0 && <span className="absolute right-[calc(50%-18px)] top-2 size-1.5 rounded-full bg-danger" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Elenco completo delle sezioni, per gli schermi piccoli. */
export function MenuCompleto({ funzioni, ruolo }: { funzioni: string[]; ruolo: Ruolo | null }) {
  return (
    <div className="space-y-6">
      {gruppi(ruolo).map((g) => (
        <section key={g.titolo ?? "altro"}>
          <h2 className="eyebrow mb-2">{g.titolo ?? "Altro"}</h2>
          <ul className="card divide-y divide-line">
            {g.voci.map((v) => (
              <li key={v.href}><Link href={v.href} className="flex items-center gap-3 px-4 py-3 text-sm">
                <v.icona className="size-4 text-muted" aria-hidden />{v.etichetta}
                {v.funzione && !funzioni.includes(v.funzione) && <span className="ml-auto text-xs text-subtle">non incluso nel piano</span>}
              </Link></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
