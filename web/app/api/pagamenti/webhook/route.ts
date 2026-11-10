import { NextResponse } from "next/server";
import { pagamentiConfigurati } from "@/lib/pagamenti";

// Punto d'arrivo degli eventi del provider di pagamento. NON ATTIVO: senza chiavi risponde 501
// e non modifica alcun abbonamento. La verifica della firma e la chiamata a `imposta_abbonamento`
// vanno completate quando il provider e i prezzi saranno stati scelti (vedi lib/pagamenti.ts).
export async function POST() {
  if (!pagamentiConfigurati()) return NextResponse.json({ errore: "Pagamenti non configurati" }, { status: 501 });
  return NextResponse.json({ errore: "Verifica della firma non ancora implementata per il provider scelto" }, { status: 501 });
}
