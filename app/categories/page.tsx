"use client";

/**
 * Collections — /categories (v1.4.0).
 *
 * The CEO's fourth screen. Her reference showed six named categories with item
 * counts; ELFIA's real catalogue is one Bawal range plus a Shawl category, so
 * the groups here are DERIVED from the live products (lib/config.ts, GROUPS)
 * and a group with nothing in it is simply not drawn. A shop that lists
 * "Bawal Cotton — 28 items" and then shows an empty shelf costs more trust
 * than it buys.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { collectionsOf, fmtRM, imageUrl, type Product } from "@/lib/config";

import { EmptyState, Icon } from "./../ui";

export default function CategoriesPage() {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products))
      .catch(() => setProducts([]));
  }, []);

  const all = products ?? [];
  const rows = collectionsOf(all).map((g) => ({ g, items: all.filter(g.match) })).filter((r) => r.items.length > 0);
  const from = (items: Product[]) => Math.min(...items.map((p) => p.price_cents));

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        {/* the blush banner from her layout */}
        <div className="relative overflow-hidden rounded-3xl bg-elfia-blush ring-1 ring-elfia-line">
          <div className="flex items-center gap-4 p-5 sm:p-7">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl leading-tight font-bold text-elfia-ink sm:text-2xl">
                Pilih koleksi kegemaran anda
              </h1>
              <p className="mt-1.5 text-sm text-elfia-body">
                Browse the ELFIA range by the way it is worn — plain, printed, or long-cut.
              </p>
            </div>
            <div className="hidden h-24 w-20 shrink-0 overflow-hidden rounded-2xl sm:block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/collection/campaign-studio.jpg" alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 20%" }} />
            </div>
          </div>
        </div>

        {products === null && (
          <div className="mt-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-elfia-line">
                <div className="h-14 w-14 rounded-xl bg-elfia-blush/70" />
                <div className="flex-1">
                  <div className="h-3.5 w-1/3 rounded bg-elfia-blush/70" />
                  <div className="mt-2 h-3 w-1/4 rounded bg-elfia-blush/70" />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 space-y-3">
          {rows.map(({ g, items }) => (
            <Link key={g.key} href={`/shop?c=${g.key}`}
              className="group flex items-center gap-3.5 rounded-2xl border border-elfia-line bg-white p-3 transition-colors hover:border-elfia-rose">
              <span className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-elfia-veil">
                {items[0]?.image_key && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(items[0].image_key)} alt="" className="h-full w-full object-cover object-top" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-semibold text-elfia-ink group-hover:text-elfia-deep">{g.label}</span>
                  {g.key === "featured" && (
                    <span className="shrink-0 rounded-full bg-elfia-gold/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-elfia-gold uppercase">
                      Pick
                    </span>
                  )}
                </span>
                {/* v1.10.0 — a collection named in the portal carries no
                    blurb, and inventing one for it would be the shop putting
                    words in her mouth. The count line below says enough. */}
                {g.blurb && <span className="mt-0.5 block truncate text-xs text-elfia-muted">{g.blurb}</span>}
                <span className="mt-1 block text-xs text-elfia-body">
                  {items.length} item{items.length === 1 ? "" : "s"} · from <span className="font-semibold text-elfia-deep">{fmtRM(from(items))}</span>
                </span>
              </span>
              <Icon name="chevron" size={17} className="shrink-0 text-elfia-muted" />
            </Link>
          ))}
        </div>

        {products !== null && rows.length === 0 && (
          <div className="mt-5">
            <EmptyState icon="grid" title="No collections yet"
              note="Products appear here as soon as they are added in the admin."
              cta={{ href: "/shop", label: "Open the shop" }} />
          </div>
        )}

        {rows.length > 0 && (
          <Link href="/shop"
            className="mt-5 flex h-12 w-full items-center justify-center rounded-full border border-elfia-line bg-white text-sm font-semibold text-elfia-deep transition-colors hover:border-elfia-rose">
            Browse everything ({all.length})
          </Link>
        )}
      </div>
    </main>
  );
}
