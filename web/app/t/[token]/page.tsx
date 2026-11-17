import type { Metadata } from "next";
import { Tavolo } from "./tavolo";

export const metadata: Metadata = { title: "Menu del tavolo", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PaginaTavolo({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Tavolo token={token} />;
}
