# Payments completion, cart, and admin Transactions — design

Date: 2026-10-05
Repos: `varona-academy-backend` (NestJS), `LMS-web` (Next.js app router, buyer), `admin` (Next.js pages router)

## Problem

The platform has a well-built payment ledger (`src/payments`) but three gaps keep money
from actually moving and keep admins from seeing what happened:

1. **Stripe never completes on the web.** `POST /shop/checkout` creates the order + ledger
   row and returns a Stripe `client_secret`, but the buyer UI never collects a card or
   confirms the PaymentIntent (`@stripe/react-stripe-js` is not installed). Intents stay
   unconfirmed, the webhook never fires, orders never reach `paid`.
2. **PSE is an inert stub.** `pse.provider.ts` throws everywhere; no real Colombian PSP is
   wired.
3. **No admin visibility.** Only `GET/PATCH /payments/settings` and `GET /payments/my-balance`
   exist. There is no way for an admin to list transactions, inspect one, refund, or reconcile.
4. **No cart.** The shop is a single-product "Buy Now" modal; selecting a shirt cannot build a
   multi-item cart, and the payment surface is duplicated inside the product modal.

## Decisions (confirmed with user)

- Finish **Stripe card collection** on the web (Stripe Elements / PaymentElement).
- Implement **real PSE via Wompi** (Bancolombia), redirect flow.
- Platform currency stays **USD**; PSE is only selectable when the active currency is **COP**
  (already enforced by `supportedCurrencies = ['COP']`). PSE therefore shows as `unavailable`
  for USD buyers.
- Admin **Transactions** tab reads the **Payment ledger** (covers shop + materials + classes).
- Admin actions: **view + detail + filter + CSV export + refund + reconcile**.
- Refunds move real money → confirm-gated in the UI; only `paid` payments are refundable;
  Stripe refunds supported, Wompi/PSE refunds rejected with a clear message (handled in the
  PSP dashboard).

## Architecture — five streams

### A. Stripe card collection (LMS-web)

- Add dependency `@stripe/react-stripe-js` (keep `@stripe/stripe-js`).
- New `components/payments/StripeCardForm.tsx`:
  - `loadStripe(publishableKey)` memoized at module scope per key.
  - `<Elements stripe options={{ clientSecret }}>` wrapping `<PaymentElement>`.
  - On submit: `stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url } })`.
  - On `{ paymentIntent.status === 'succeeded' | 'processing' }` show the awaiting-confirmation
    state; truth still comes from the webhook.
- The checkout flow becomes two-step: (1) `POST /shop/checkout` → `instruction` with
  `clientSecret` + `publishableKey`; (2) mount `StripeCardForm`; (3) confirm.

### B. PSE via Wompi (backend)

Rewrite `payments/providers/pse.provider.ts` as a Wompi-backed adapter, keeping `id = 'pse'`
and `supportedCurrencies = ['COP']`.

- **Config:** reuse the existing `pse` namespace (`src/config/configuration.ts`):
  `provider='wompi'`, `apiKey=WOMPI public key`, `apiSecret=WOMPI private key`,
  `webhookSecret=WOMPI events secret`, `baseUrl=https://production.wompi.co/v1` (or sandbox).
  Add one field `integritySecret` ← `PSE_INTEGRITY_SECRET`. `isConfigured()` requires
  provider==='wompi' + publicKey + privateKey + eventsSecret + integritySecret.
- **createPayment:** build a Wompi Checkout redirect URL:
  `https://checkout.wompi.co/p/?public-key=&currency=COP&amount-in-cents=&reference=<paymentId>&signature:integrity=SHA256(reference+amountInCents+COP+integritySecret)&redirect-url=<returnUrl>`.
  Return `{ kind: 'redirect', redirectUrl }` and `providerRef = request.paymentId` (deterministic,
  keeps the unique `provider+providerRef` idempotency index intact).
- **parseWebhook:** verify Wompi event signature
  `checksum = SHA256(concat(signature.properties values) + timestamp + eventsSecret)`.
  Map transaction status: `APPROVED→PAID`, `DECLINED|ERROR→FAILED`, `VOIDED→CANCELLED`,
  `PENDING→PROCESSING`. Return `providerRef = transaction.reference`, `amountMinor =
  transaction.amount_in_cents`, and store the Wompi transaction id in `raw` for reconcile.
- **fetchPaymentState:** `GET {baseUrl}/transactions/{wompiTxId}` (id from stored metadata),
  map status the same way. Used by admin reconcile.
- **refund:** throw `BadRequestException('PSE/Wompi refunds are handled in the Wompi dashboard')`.

### C. Admin transaction API (backend, payments module)

New `AdminTransactionsService` + routes on `PaymentsController`, all guarded by
`JwtAuthGuard + RolesGuard + @Roles(ADMIN)`. New `dto/query-transactions.dto.ts`.

- `GET /payments/transactions` — paginated. Filters: `status, area, provider, q`
  (buyer email/name or providerRef), `from`, `to`, `sortBy`, `sortOrder`, `page`, `limit`.
  Populates buyer (`firstName lastName email`) and seller. Returns
  `{ data, total, page, limit, totalPages }`.
- `GET /payments/transactions/summary` — same filters, returns per-status counts and
  gross/net/commission totals (for stat cards) via one aggregation.
- `GET /payments/transactions/:id` — one payment, populated, plus a resolved reference label.
- `POST /payments/transactions/:id/refund` — body `{ reason?, amountMinor? }`. Only `paid`
  refundable. Calls `provider.refund(providerRef, amountMinor?)`. On success: `status=REFUNDED`,
  `payoutStatus=VOID`, `failureReason=reason`, fire optional fulfilment `onRefunded`.
- `POST /payments/transactions/:id/reconcile` — re-poll `provider.fetchPaymentState` and apply
  via `applyProviderState` (+ fulfilment when it newly settles).

**Interface change:** add `refund(providerRef, amountMinor?): Promise<void>` to
`PaymentProvider`. Stripe implements via `refunds.create({ payment_intent })`; PSE throws.

**FulfilmentHandler change:** add optional `onRefunded(referenceId, payment)`. `ShopService`
implements it to set the shop order `status='refunded'`.

### D. Admin Transactions tab (admin, pages router)

- Sidebar: add **Transactions** item (`components/icons/sidebar/payments-icon.tsx` exists) →
  route `/transactions`.
- `services/payments.ts`: `listTransactions(query)`, `getSummary(query)`, `getTransaction(id)`,
  `refund(id, body)`, `reconcile(id)`. Add `Payments` endpoints to `utils/apiConfig`.
- `pages/transactions.tsx` + `components/transactions/` following the `components/teachers`
  table + `components/table/filters.tsx` pattern (react-query + NextUI table).
  - Stat cards from `summary`.
  - Status tabs: all / pending / processing / paid / failed / cancelled / refunded.
  - Filters: area, provider, search, date range.
  - Row click → detail drawer (full ledger fields, buyer, reference label, provider metadata).
  - Refund button (confirm modal; disabled unless `paid` and provider supports it).
  - Reconcile button (for pending/processing).
  - CSV export of the current filtered query.
- `utils/formatMoney.ts`: `formatMinor(amountMinor, currency)` (minor units → display).

### E. Shopping cart (LMS-web)

- `store/cart.ts`: zustand + `persist` (localStorage), mirroring `store/auth.ts`. Line key =
  `productId + '::' + size`. State: `items[]` of `{ productId, title, image, price, size,
  quantity, sizes }`; actions `add/remove/setQty/clear`; selectors `count`, `subtotal`.
- Add-to-cart from product list cards and the product detail page. "Buy Now" = add + route to
  `/cart`. Toast on add.
- Header cart icon with a `count` badge, linking to `/cart` (wired into the existing
  navbar/header; exact file confirmed during implementation).
- `app/cart/page.tsx`: line items (qty steppers, remove), subtotal, shipping form, then the
  payment step (`PaymentMethodPicker` + `StripeCardForm` for Stripe / redirect for PSE), one
  `POST /shop/checkout` with all items. Awaiting-confirmation state after confirm; truth from
  webhook.
- The product-detail modal's checkout is replaced by add-to-cart so there is a single real
  payment surface.

## Cross-cutting

- Amounts stay integer **minor units** end-to-end; formatted only at display.
- Webhook settlement stays the single source of truth and idempotent; nothing the browser
  sends marks a payment paid.
- Tests (mirror existing `*.spec.ts`):
  - Wompi: signature verification (accept valid, reject tampered), status mapping, deterministic
    `providerRef`, integrity signature.
  - `AdminTransactionsService`: filter building, summary aggregation, refund state transition
    (rejects non-`paid`), reconcile apply.
  - Stripe `refund` (mocked client).

## Constraints / limits

- **Wompi live e2e** needs real sandbox credentials. Build + unit-test against mocked HTTP;
  env-gate so PSE stays hidden until keys are set. User supplies keys to test for real.
- **Refund** and **reconcile** are money-movement / irreversible → confirm-gated in the admin UI;
  backend refuses refunds on non-`paid` payments and Wompi refunds outright.

## Out of scope

- PayPal and other providers (only Stripe + PSE/Wompi now).
- Multi-currency pricing UI (platform currency stays a single admin setting).
- Seller payout execution (ledger already tracks `owed`; paying out is separate work).
