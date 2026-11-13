"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Cartoncino con il QR del tavolo, da stampare. L'indirizzo usa il dominio da cui si sta usando l'app. */
export function CartoncinoQR({ codice, token, sede }: { codice: string; token: string; sede: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = `${window.location.origin}/t/${token}`; setUrl(u);
    QRCode.toDataURL(u, { margin: 1, width: 360, errorCorrectionLevel: "M" }).then(setSrc).catch(() => setSrc(null));
  }, [token]);
  return (
    <div className="card flex break-inside-avoid flex-col items-center p-4 text-center print:border-black">
      <p className="text-xs text-muted">{sede}</p>
      <p className="text-2xl font-semibold">Tavolo {codice}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt={`QR del tavolo ${codice}`} className="my-2 size-40" /> : <div className="my-2 size-40 bg-raised" />}
      <p className="text-xs">Inquadra per menu, ordini, cameriere e conto</p>
      <p className="mt-1 text-[11px] text-muted">Scan for menu · Menu · Speisekarte</p>
      <a href={url} target="_blank" rel="noopener" className="mt-1 text-[10px] text-subtle underline print:hidden">prova</a>
    </div>
  );
}
