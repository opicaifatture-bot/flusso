"use client";
import { Printer } from "lucide-react";

export function Stampa({ etichetta = "Stampa o salva in PDF" }: { etichetta?: string }) {
  return <button type="button" className="btn btn-sm print:hidden" onClick={() => window.print()}><Printer className="size-3.5" aria-hidden />{etichetta}</button>;
}
