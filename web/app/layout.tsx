import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export const metadata: Metadata = {
  title: { default: "Price Guardian", template: "%s · Price Guardian" },
  description: "Contabilità invisibile e controllo prezzi per la ristorazione di lusso",
};
export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tema = (await cookies()).get("pg_tema")?.value === "light" ? "light" : "dark";
  return (
    <html lang="it" data-theme={tema} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
