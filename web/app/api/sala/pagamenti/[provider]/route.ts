import { NextResponse, type NextRequest } from "next/server";
import { servizio, type Provider } from "@/lib/sala/pagamenti";

/**
 * Notifiche dei servizi di pagamento (webhook). Un pagamento online diventa "pagato" solo da qui,
 * dopo la verifica della firma del servizio, tramite la funzione conferma_pagamento (ruolo di servizio).
 * Nessun adattatore è ancora realizzato: la rotta risponde 501 e non modifica nulla.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!["stripe", "nexi", "sumup", "satispay"].includes(provider)) return new NextResponse("Servizio sconosciuto", { status: 404 });
  const s = servizio(provider as Provider);
  if (!s) return new NextResponse("Servizio di pagamento non ancora collegato", { status: 501 });
  void req;
  return new NextResponse("Non implementato", { status: 501 });
}
