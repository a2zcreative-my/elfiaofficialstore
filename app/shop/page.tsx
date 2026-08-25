"use client";

/**
 * Product listing — /shop (v1.4.0).
 *
 * The CEO's third screen: a count, a filter and a sort above a two-column
 * grid. Query params keep the site fully static and make every view of the
 * shop a link she can send: /shop?c=printed, /shop?q=rose, /shop?sort=price_asc.
 *
 * Filtering happens in the browser over the one /api/v1/products response —
 * ten to a few hundred products is nothing to filter client-side, and it keeps
 * the Worker out of a job it does not need to do.
 */
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  GROUPS, SORTS, inGroup, isSoldOut, sortProducts, splitName,
  type Product, type SortKey,
} from "@/lib/config";

import { CardSkeleton, EmptyState, Icon, ProductCard } from "./../ui";

function ShopInner() {
  const params = useSearchParams();
  const router = useRouter();
  const group = params.get("c");
  const q = (params.get("q") ?? "").trim();
  const sort = (params.get("sort") ?? "featured") as SortKey;

  const [products, setProducts] = useState<Product[] | null>(null);
  const [sheet, setSheet] = useState<null | "filter" | "sort">(null);
  const [inStockOnly, setInStock] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products))
      .catch(() => setProducts([]));
  }, []);

  /** Change one query param and keep the rest. */
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k); else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `/shop?${s}` : "/shop", { scroll: false });
    setSheet(null);
  };

  const shown = useMemo(() => {
    let list = inGroup(products ?? [], group);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.sku ?? "").toLowerCase().includes(needle) ||
        (p.description ?? "").toLowerCase().includes(needle));
    }
    if (inStockOnly) list = list.filter((p) => !isSoldOut(p));
    return sortProducts(list, sort);
  }, [products, group, q, sort, inStockOnly]);

  const groupLabel = GROUPS.find((g) => g.key === group)?.label;
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? "Featured";
  const counts = (key: string | null) => inGroup(products ?? [], key).length;

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-6xl">
        {/* title row */}
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="Back to home"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-elfia-ink hover:bg-elfia-veil sm:hidden">
            <Icon name="back" size={19} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-elfia-ink sm:text-2xl">
              {q ? `“${q}”` : (groupLabel ?? "All products")}
            </h1>
            <p className="text-xs text-elfia-muted">
              {products === null ? "Loading…" : `${shown.length} product${shown.length === 1 ? "" : "s"} found`}
            </p>
          </div>
        </div>

        {/* collection chips — the same groups as /categories, one tap away */}
        <div className="rail -mx-4 mt-4 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <button type="button" onClick={() => go({ c: null })}
            className={`rail-item h-9 rounded-full px-4 text-[13px] font-medium transition-colors ${
              !group ? "bg-elfia-deep text-white" : "bg-white text-elfia-body ring-1 ring-elfia-line hover:ring-elfia-rose"}`}>
            All <span className="ml-1 text-[11px] opacity-70">{counts(null)}</span>
          </button>
          {GROUPS.map((g) => {
            const n = counts(g.key);
            if (products !== null && n === 0) return null;   // never offer an empty shelf
            return (
              <button key={g.key} type="button" onClick={() => go({ c: g.key })}
                className={`rail-item h-9 rounded-full px-4 text-[13px] font-medium transition-colors ${
                  group === g.key ? "bg-elfia-deep text-white" : "bg-white text-elfia-body ring-1 ring-elfia-line hover:ring-elfia-rose"}`}>
                {g.label} <span className="ml-1 text-[11px] opacity-70">{n}</span>
              </button>
            );
          })}
        </div>

        {/* filter + sort */}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => setSheet(sheet === "filter" ? null : "filter")}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ring-1 transition-colors ${
              inStockOnly ? "bg-elfia-veil text-elfia-deep ring-elfia-rose" : "bg-white text-elfia-body ring-elfia-line"}`}>
            <Icon name="filter" size={15} /> Filter{inStockOnly ? " · 1" : ""}
          </button>
          <button type="button" onClick={() => setSheet(sheet === "sort" ? null : "sort")}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-medium text-elfia-body ring-1 ring-elfia-line">
            <Icon name="sort" size={15} /> {sortLabel}
          </button>
          {(q || group || inStockOnly) && (
            <button type="button" onClick={() => { setInStock(false); go({ c: null, q: null }); }}
              className="ml-auto text-[13px] font-medium text-elfia-deep underline-offset-2 hover:underline">
              Clear
            </button>
          )}
        </div>

        {sheet === "sort" && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-elfia-line bg-white">
            {SORTS.map((s) => (
              <button key={s.key} type="button" onClick={() => go({ sort: s.key === "featured" ? null : s.key })}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${
                  sort === s.key ? "font-semibold text-elfia-deep" : "text-elfia-body hover:bg-elfia-cream"}`}>
                {s.label}
                {sort === s.key && <Icon name="check" size={16} strokeWidth={2.2} />}
              </button>
            ))}
          </div>
        )}

        {sheet === "filter" && (
          <div className="mt-2 rounded-2xl border border-elfia-line bg-white p-4">
            <label className="flex items-center gap-2.5">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStock(e.target.checked)}
                className="h-4 w-4 rounded border-elfia-line accent-[#7a2648]" />
              <span className="text-sm text-elfia-body">Hide sold-out shades</span>
            </label>
            <button type="button" onClick={() => setSheet(null)}
              className="mt-4 h-10 w-full rounded-full bg-elfia-deep text-sm font-semibold text-white hover:bg-elfia-deeper">
              Show {shown.length} product{shown.length === 1 ? "" : "s"}
            </button>
          </div>
        )}

        {/* the grid */}
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-grid">
          {products === null ? <CardSkeleton n={6} /> : shown.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>

        {products !== null && shown.length === 0 && (
          <div className="mt-8">
            <EmptyState icon="search"
              title={q ? `Nothing matches “${q}”` : "Nothing in this collection yet"}
              note={q ? "Try a shade name like Dusty Rose, or an SKU like LUMI001." : "Check back after the next live — new shades land here first."}
              cta={{ href: "/shop", label: "See everything" }} />
          </div>
        )}

        {/* a quiet hint that search matched an SKU, not a name */}
        {q && shown.length > 0 && shown.every((p) => !splitName(p.name).shade.toLowerCase().includes(q.toLowerCase())) && (
          <p className="mt-4 text-center text-xs text-elfia-muted">Matched on product code or description.</p>
        )}
      </div>
    </main>
  );
}

export default function ShopPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-elfia-muted">Loading…</main>}>
      <ShopInner />
    </Suspense>
  );
}
