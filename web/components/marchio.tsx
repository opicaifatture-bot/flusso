import { Orbitron } from "next/font/google";
import { cn } from "@/lib/format";

const orbitron = Orbitron({ subsets: ["latin"], weight: ["600", "700"], display: "swap" });

/** Simbolo Kitchen OS: arco dorato con scintilla, nello stile del marchio Opic. */
export function Simbolo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="ko-oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd27a" /><stop offset=".55" stopColor="#e8a23a" /><stop offset="1" stopColor="#a8682a" /></linearGradient>
        <radialGradient id="ko-luce"><stop offset="0" stopColor="#fff6d8" /><stop offset=".4" stopColor="#ffc24d" /><stop offset="1" stopColor="#ffc24d" stopOpacity="0" /></radialGradient>
      </defs>
      <path d="M44 8A26 26 0 1 0 44 56" fill="none" stroke="url(#ko-oro)" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M26 21v22M26 33l12-12M30 30l9 13" fill="none" stroke="url(#ko-oro)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="32" r="7" fill="url(#ko-luce)" /><circle cx="9" cy="32" r="2.2" fill="#fff3cf" />
    </svg>
  );
}

export function Marchio({ grande, className }: { grande?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center", grande ? "gap-3" : "gap-2", className)}>
      <Simbolo className={grande ? "size-11" : "size-6"} />
      <span className={cn(orbitron.className, "font-bold uppercase leading-none tracking-[0.08em] bg-gradient-to-b from-[#ffd98a] via-[#e9a33c] to-[#b0702c] bg-clip-text text-transparent", grande ? "text-2xl" : "text-[13px]")}>
        Kitchen&nbsp;OS
      </span>
    </span>
  );
}
