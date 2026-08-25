/** Delivery & refund policy — plain, honest, and required by Malaysian
    payment gateways before they approve a store (Stage B readiness).

    v1.3.0 — the PDPA privacy notice joins this page. The Personal Data
    Protection Act 2010 (s.7) requires a written notice, in BOTH English and
    Bahasa Malaysia, telling customers what is collected, why, who it is
    disclosed to, and how to reach us about it. The notice below is written
    to match what the system ACTUALLY does — nothing is promised that the
    code does not enforce, and nothing collected is left unsaid. */
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

        {/* ---- PDPA privacy notice — English, then Bahasa Malaysia (both
            required by s.7(3) of the Act) ---- */}
        <section id="privacy" className="border-t border-stone-200 pt-8">
          <h2 className="text-lg font-bold text-[#7a2648]">Privacy notice (PDPA 2010)</h2>
          <p className="mt-2">
            <strong>What we collect.</strong> When you order: your name, phone
            number, delivery address, and email if you give one — plus your
            payment receipt if you upload it. If you create an account: the
            same details and a password (stored only as a secure hash — we
            cannot read it).
          </p>
          <p className="mt-2">
            <strong>Why.</strong> To deliver your order, confirm payment,
            answer your messages, and keep the business records the law
            requires. We send you promotions <em>only</em> if you tick the
            consent box — it is optional, never pre-ticked, and you can
            withdraw anytime from your account page or by WhatsApp; it takes
            effect immediately.
          </p>
          <p className="mt-2">
            <strong>Website statistics.</strong> Our site counts visits
            anonymously — approximate location (state/city) and pages viewed
            only. No cookies are set for this, no IP address is stored, and
            nothing links a visit to a person; raw counts are deleted after
            60 days.
          </p>
          <p className="mt-2">
            <strong>Who sees it.</strong> Couriers (to deliver), our payment
            provider (to process online payment), and the order-management
            system we use to run the shop. Your data is never sold and never
            used by anyone else for their own marketing.
          </p>
          <p className="mt-2">
            <strong>Your rights.</strong> You may ask to see the personal data
            we hold about you, correct it, or withdraw marketing consent —
            WhatsApp us and we will act on it. Order records are kept as long
            as bookkeeping and tax law require, then no longer.
          </p>
        </section>
        <section lang="ms">
          <h2 className="text-lg font-bold text-[#7a2648]">Notis privasi (APDP 2010)</h2>
          <p className="mt-2">
            <strong>Apa yang kami kumpul.</strong> Semasa anda membuat
            pesanan: nama, nombor telefon, alamat penghantaran, dan emel jika
            diberikan — serta resit pembayaran jika anda muat naik. Jika anda
            membuka akaun: butiran yang sama dan kata laluan (disimpan sebagai
            cincangan selamat sahaja — kami tidak dapat membacanya).
          </p>
          <p className="mt-2">
            <strong>Tujuan.</strong> Untuk menghantar pesanan anda, mengesahkan
            pembayaran, menjawab mesej anda, dan menyimpan rekod perniagaan
            yang dikehendaki undang-undang. Promosi dihantar <em>hanya</em>{" "}
            jika anda menanda kotak persetujuan — ia pilihan, tidak pernah
            ditanda awal, dan boleh ditarik balik bila-bila masa melalui
            halaman akaun atau WhatsApp; berkuat kuasa serta-merta.
          </p>
          <p className="mt-2">
            <strong>Statistik laman.</strong> Laman kami mengira lawatan tanpa
            nama — lokasi anggaran (negeri/bandar) dan halaman yang dilihat
            sahaja. Tiada kuki ditetapkan untuk ini, tiada alamat IP disimpan,
            dan tiada apa-apa yang mengaitkan lawatan dengan seseorang; data
            mentah dipadam selepas 60 hari.
          </p>
          <p className="mt-2">
            <strong>Siapa yang melihatnya.</strong> Kurier (untuk penghantaran),
            penyedia pembayaran kami (untuk pembayaran dalam talian), dan
            sistem pengurusan pesanan yang kami gunakan untuk mengendalikan
            kedai. Data anda tidak pernah dijual dan tidak digunakan oleh
            pihak lain untuk pemasaran mereka sendiri.
          </p>
          <p className="mt-2">
            <strong>Hak anda.</strong> Anda boleh meminta untuk melihat data
            peribadi anda, membetulkannya, atau menarik balik persetujuan
            pemasaran — hubungi kami di WhatsApp dan kami akan melaksanakannya.
            Rekod pesanan disimpan selama tempoh yang dikehendaki oleh
            undang-undang simpan kira dan cukai sahaja.
          </p>
        </section>
      </div>
    </main>
  );
}
