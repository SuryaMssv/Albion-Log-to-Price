import LootCalculator from "@/components/LootCalculator";
import { itemIndexMeta } from "@/lib/resolver";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          ⚔️ Albion Guild Loot Calculator
        </h1>
        <p className="mt-1 text-sm text-gold">by suryamssv</p>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Paste a guild chest log, value every stack at current market prices, and split the total
          evenly between the players who ran it. Nothing is stored — logs are processed and discarded.
        </p>
      </header>

      <LootCalculator />

      <footer className="mt-12 border-t border-border-soft pt-6 text-xs text-muted">
        <p>
          Market data from the{" "}
          <a
            href="https://www.albion-online-data.com/"
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline"
          >
            Albion Online Data Project
          </a>
          , contributed by players — prices are as fresh as the last client upload.
        </p>
        <p className="mt-1">
          Item metadata: {itemIndexMeta.names.toLocaleString()} names from the official binary dumps
          (built {itemIndexMeta.generatedAt.slice(0, 10)}).
        </p>
        <p className="mt-4 text-muted">© {new Date().getFullYear()} suryamssv. All rights reserved.</p>
      </footer>
    </main>
  );
}
