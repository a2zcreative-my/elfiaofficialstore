"use client";

/**
 * Wishlist — /wishlist (v1.4.0).
 *
 * The heart on every product card lands here. Saved on the device, like the
 * cart: no sign-up, nothing sent anywhere. A saved shade that sells out is
 * still shown — with its Sold out badge — because that is the one a customer
 * most wants to be told about, and the product page collects the restock
 * waitlist (v0.6.0).
 *
 * Prices come from /api/v1/products on every visit, so a wishlist opened a
 * month later never shows yesterday's price.
 */
import { useEffect, useState } from "react";

import { addToCart, isSoldOut, readWishlist, type Product } from "@/lib/config";

import { CardSkeleton, EmptyState, ProductCard, Skel, useDataRefresh, useWishlist } from "./../ui";

export default function WishlistPage() {
  const ids = useWishlist();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [added, setAdded] = useState(false);

  /* v1.16.0 — re-priced when the tab comes back, not only on mount. */
  const refresh = useDataRefresh();
  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products))
      .catch(() => setProducts([]));
  }, [refresh]);

  /* Keep the customer's own order (newest saved first), and drop anything
     that has since been removed from the shop. */
  const saved = (products ?? []).length
    ? readWishlist().map((id) => (products ?? []).find((p) => p.id === id)).filter((p): p is Product => Boolean(p))
    : [];
  const buyable = saved.filter((p) => !isSoldOut(p));

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="text-xl font-bold text-elfia-ink sm:text-2xl">Wishlist</h1>
        {/* v1.44.0 — skeleton until the first fetch lands: the count is a
            small block, not a word, until the products are in. */}
        {products === null
          ? <Skel className="mt-1 h-3 w-40" />
          : <p className="text-xs text-elfia-muted">
              {saved.length === 0 ? "Nothing saved yet"
                : `${saved.length} shade${saved.length === 1 ? "" : "s"} saved on this device`}
            </p>}

        {products === null && (
          <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"><CardSkeleton n={4} /></div>
        )}

        {products !== null && ids.length === 0 && (
          <div className="mt-6">
            <EmptyState icon="heart" title="No saved shades yet"
              note="Tap the heart on any product and it waits for you here — no sign-up needed."
              cta={{ href: "/shop", label: "Browse the shop" }} />
          </div>
        )}

        {saved.length > 0 && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {saved.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>

            {buyable.length > 0 && (
              <div className="mt-8 rounded-2xl border border-elfia-line bg-white p-4 text-center">
                <button type="button"
                  onClick={() => { buyable.forEach((p) => addToCart(p.id, 1)); setAdded(true); }}
                  className="h-12 w-full rounded-full bg-elfia-deep text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper sm:w-auto sm:px-8">
                  Add all {buyable.length} available to cart
                </button>
                {added && <p className="mt-2.5 text-xs font-medium text-elfia-deep">Added — open the cart when you are ready.</p>}
              </div>
            )}
          </>
        )}

        {/* Honest about where this lives. An account does not yet carry it. */}
        {saved.length > 0 && (
          <p className="mt-6 text-center text-[11px] text-elfia-muted">
            Saved in this browser only — clearing your browser data clears the list.
          </p>
        )}
      </div>
    </main>
  );
}
