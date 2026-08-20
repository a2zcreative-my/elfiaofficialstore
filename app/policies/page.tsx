/** Delivery & refund policy — plain, honest, and required by Malaysian
    payment gateways before they approve a store (Stage B readiness). */
export default function Policies() {
  return (
    <main className="px-6 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-8 text-sm leading-relaxed text-stone-700">
        <section>
          <h1 className="text-2xl font-bold text-[#7a2648]">Delivery &amp; returns</h1>
          <p className="mt-3">
            Orders are packed within 1–2 working days after payment is
            confirmed, and delivered by courier across Malaysia (typically
            2–5 working days, East Malaysia may take longer). You receive a
            tracking number on your order page the moment we ship.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-bold text-[#7a2648]">Payment</h2>
          <p className="mt-2">
            We accept online bank transfer. Your order reserves the stock
            immediately; if payment is not received within 48 hours the order
            may be cancelled and the stock released. Upload your transfer
            receipt on the order page, or send it to us on WhatsApp — we
            confirm manually, usually within a few hours.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-bold text-[#7a2648]">Returns &amp; refunds</h2>
          <p className="mt-2">
            Wrong item or arrived damaged? WhatsApp us a photo within 3 days
            of delivery and we will replace it or refund in full — return
            postage on us. For change-of-mind returns, contact us within 7
            days; items must be unworn, unwashed and in original packaging;
            postage is borne by the customer. Refunds go back by bank
            transfer within 7 working days of us receiving the return.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-bold text-[#7a2648]">Contact</h2>
          <p className="mt-2">
            The fastest channel is WhatsApp — the button on your order page
            opens a chat with your order number already filled in.
          </p>
        </section>
      </div>
    </main>
  );
}
