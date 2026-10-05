# Payments Completion, Cart, and Admin Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payments actually complete (Stripe card collection + real PSE via Wompi), give the shop a real cart, and give admins a Transactions tab with detail, filters, CSV, refund, and reconcile.

**Architecture:** The backend `payments` module already owns the ledger, provider abstraction, and webhook-only settlement. We extend the provider interface with `refund`, replace the inert PSE stub with a Wompi adapter, and add an admin transactions service + controller routes over the existing `Payment` collection. The `admin` app (Next.js pages router) gets a Transactions page reading those routes. The `LMS-web` app (Next.js app router) gets Stripe Elements card collection and a zustand cart feeding the existing multi-item `POST /shop/checkout`.

**Tech Stack:** NestJS + Mongoose + Stripe SDK + Jest (backend); Next.js pages router + NextUI + react-query + Vitest (admin); Next.js app router + zustand + @stripe/react-stripe-js (web, no unit runner — verify with `typecheck` + browser).

## Global Constraints

- All monetary amounts are **integer minor units** end-to-end; format only at display. Use `src/payments/money.ts` helpers on the backend.
- **Only a verified webhook may mark a payment `paid`.** Never settle from a browser call.
- The `provider + providerRef` unique index makes webhooks idempotent — never break its determinism.
- Payment statuses: `pending | processing | paid | failed | cancelled | refunded` (`PaymentStatus`). Payout: `owed | paid_out | void` (`PayoutStatus`).
- PSE keeps provider id `'pse'` and `supportedCurrencies = ['COP']`; it must stay hidden (`isConfigured()` false) until all Wompi creds are set.
- Three separate git repos: `varona-academy-backend`, `admin`, `LMS-web`. Commit in the repo you touch. Pre-commit hooks run a build — expect it.
- Commit message trailer on every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

**Backend (`varona-academy-backend`)**
- Modify `src/payments/providers/payment-provider.interface.ts` — add `refund()`.
- Modify `src/payments/providers/stripe.provider.ts` — implement `refund()`.
- Rewrite `src/payments/providers/pse.provider.ts` — Wompi adapter.
- Modify `src/config/configuration.ts` — add `pse.integritySecret`.
- Modify `env.example` — document `PSE_INTEGRITY_SECRET` + Wompi values.
- Modify `src/payments/services/fulfilment.registry.ts` — add optional `onRefunded`.
- Modify `src/shop/shop.service.ts` — implement `onRefunded`.
- Create `src/payments/dto/query-transactions.dto.ts`.
- Create `src/payments/services/admin-transactions.service.ts` (+ `.spec.ts`).
- Modify `src/payments/payments.controller.ts` — admin transaction routes.
- Modify `src/payments/payments.module.ts` — register the new service.

**Admin (`admin`)**
- Modify `utils/apiConfig.ts` — `Payments` endpoints.
- Create `services/payments.ts`.
- Create `utils/formatMoney.ts`.
- Modify `components/sidebar/sidebar.tsx` — Transactions item.
- Create `pages/transactions.tsx`.
- Create `components/transactions/index.tsx`, `table.tsx`, `filters.tsx`, `stat-cards.tsx`, `detail-drawer.tsx`.

**Web (`LMS-web`)**
- Add dep `@stripe/react-stripe-js`.
- Create `components/payments/StripeCardForm.tsx`.
- Create `store/cart.ts`.
- Create `components/molecules/shop/cart-button/index.tsx` (header icon).
- Modify header/navbar to mount the cart button.
- Modify `components/molecules/shop/product-list/index.tsx` and `components/molecules/shop/product-card/index.tsx` — add-to-cart.
- Create `app/cart/page.tsx`.
- Modify `services/payments.ts` — add `checkout()` typing if needed.

---

## Task 1: Add `refund` to the provider interface + Stripe + PSE stub-refund

**Files:**
- Modify: `src/payments/providers/payment-provider.interface.ts`
- Modify: `src/payments/providers/stripe.provider.ts`
- Modify: `src/payments/providers/pse.provider.ts` (temporary throw; rewritten in Task 2)
- Test: `src/payments/providers/stripe.provider.spec.ts` (create)

**Interfaces:**
- Produces: `PaymentProvider.refund(providerRef: string, amountMinor?: number): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `src/payments/providers/stripe.provider.spec.ts`

```typescript
import { StripeProvider } from './stripe.provider';
import { ConfigService } from '@nestjs/config';

describe('StripeProvider.refund', () => {
  function makeProvider(refundsCreate: jest.Mock) {
    const config = { get: (k: string) => (k === 'stripe.secretKey' ? 'sk_test_x' : undefined) } as unknown as ConfigService;
    const provider = new StripeProvider(config);
    // Replace the real client with a stub.
    (provider as any).stripe = { refunds: { create: refundsCreate } };
    return provider;
  }

  it('refunds the whole payment intent when no amount is given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_1' });
    const provider = makeProvider(create);
    await provider.refund('pi_123');
    expect(create).toHaveBeenCalledWith({ payment_intent: 'pi_123' });
  });

  it('refunds a partial amount in minor units when given', async () => {
    const create = jest.fn().mockResolvedValue({ id: 're_2' });
    const provider = makeProvider(create);
    await provider.refund('pi_123', 500);
    expect(create).toHaveBeenCalledWith({ payment_intent: 'pi_123', amount: 500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stripe.provider.spec`
Expected: FAIL — `provider.refund is not a function`.

- [ ] **Step 3: Add the interface method** — in `payment-provider.interface.ts`, add to `PaymentProvider`:

```typescript
  /**
   * Refunds a settled payment. Full refund when `amountMinor` is omitted,
   * partial otherwise. Providers that cannot refund programmatically throw.
   */
  refund(providerRef: string, amountMinor?: number): Promise<void>;
```

- [ ] **Step 4: Implement in `stripe.provider.ts`** — add method:

```typescript
  async refund(providerRef: string, amountMinor?: number): Promise<void> {
    await this.client().refunds.create(
      amountMinor === undefined
        ? { payment_intent: providerRef }
        : { payment_intent: providerRef, amount: amountMinor },
    );
  }
```

- [ ] **Step 5: Add a throwing `refund` to `pse.provider.ts`** (keeps the build green until Task 2 rewrites it) — add inside `PseProvider`:

```typescript
  async refund(_providerRef: string, _amountMinor?: number): Promise<void> {
    throw new Error('PSE refunds are handled in the PSP dashboard, not via API');
  }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- stripe.provider.spec && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/payments/providers/payment-provider.interface.ts src/payments/providers/stripe.provider.ts src/payments/providers/pse.provider.ts src/payments/providers/stripe.provider.spec.ts
git commit -m "feat(payments): add refund() to provider interface with Stripe implementation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Wompi PSE provider

**Files:**
- Modify: `src/config/configuration.ts` (add `integritySecret`)
- Rewrite: `src/payments/providers/pse.provider.ts`
- Test: `src/payments/providers/pse.provider.spec.ts` (create)

**Interfaces:**
- Consumes: `PaymentProvider` (incl. `refund` from Task 1), `pse` config namespace.
- Produces: a configured Wompi-backed `PseProvider` with id `'pse'`, redirect `createPayment`, signature-verifying `parseWebhook`, polling `fetchPaymentState`.

- [ ] **Step 1: Add the config field** — in `src/config/configuration.ts`, inside `pseConfig`, add:

```typescript
  integritySecret: process.env.PSE_INTEGRITY_SECRET,
```

- [ ] **Step 2: Write the failing test** — `src/payments/providers/pse.provider.spec.ts`

```typescript
import { PseProvider } from './pse.provider';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '../schemas/payment.schema';
import { createHash } from 'crypto';

const CFG: Record<string, string> = {
  'pse.provider': 'wompi',
  'pse.apiKey': 'pub_test_abc',
  'pse.apiSecret': 'prv_test_abc',
  'pse.webhookSecret': 'events_secret',
  'pse.integritySecret': 'integrity_secret',
  'pse.baseUrl': 'https://sandbox.wompi.co/v1',
  'app.frontendUrl': 'https://app.test',
};

function provider() {
  const config = { get: (k: string) => CFG[k] } as unknown as ConfigService;
  return new PseProvider(config);
}

describe('PseProvider (Wompi)', () => {
  it('is configured only when all Wompi creds are present', () => {
    expect(provider().isConfigured()).toBe(true);
    const partial = new PseProvider({ get: (k: string) => (k === 'pse.provider' ? 'wompi' : undefined) } as any);
    expect(partial.isConfigured()).toBe(false);
  });

  it('creates a redirect instruction with a deterministic reference and integrity signature', async () => {
    const res = await provider().createPayment({
      amountMinor: 50000, currency: 'COP', paymentId: 'pay_1',
      description: 'Order', returnUrl: 'https://app.test/cart/confirm',
    });
    expect(res.providerRef).toBe('pay_1');
    expect(res.instruction.kind).toBe('redirect');
    const url = (res.instruction as any).redirectUrl as string;
    expect(url).toContain('reference=pay_1');
    expect(url).toContain('amount-in-cents=50000');
    expect(url).toContain('currency=COP');
    const expectedSig = createHash('sha256').update('pay_150000COPintegrity_secret').digest('hex');
    expect(url).toContain(`signature%3Aintegrity=${expectedSig}`);
  });

  it('accepts a webhook with a valid checksum and maps APPROVED to PAID', async () => {
    const timestamp = 1700000000;
    const transaction = { id: 'wtx_9', reference: 'pay_1', status: 'APPROVED', amount_in_cents: 50000, currency: 'COP' };
    // Wompi concatenates the values named in signature.properties, then the timestamp, then the events secret.
    const checksum = createHash('sha256')
      .update(`${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}events_secret`)
      .digest('hex');
    const body = JSON.stringify({
      event: 'transaction.updated',
      data: { transaction },
      timestamp,
      signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum },
    });
    const state = await provider().parseWebhook(body, {});
    expect(state).toMatchObject({ providerRef: 'pay_1', status: PaymentStatus.PAID, amountMinor: 50000 });
  });

  it('rejects a webhook whose checksum does not match', async () => {
    const body = JSON.stringify({
      data: { transaction: { id: 'wtx_9', reference: 'pay_1', status: 'APPROVED', amount_in_cents: 50000 } },
      timestamp: 1700000000,
      signature: { properties: ['transaction.id'], checksum: 'deadbeef' },
    });
    await expect(provider().parseWebhook(body, {})).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- pse.provider.spec`
Expected: FAIL (current stub throws `notImplemented`).

- [ ] **Step 4: Rewrite `src/payments/providers/pse.provider.ts`**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentProvider,
  ProviderPaymentState,
} from './payment-provider.interface';
import { PaymentStatus } from '../schemas/payment.schema';

/**
 * PSE (Colombian bank transfer) via Wompi (Bancolombia).
 *
 * Redirect flow: we send the buyer to Wompi's hosted checkout with an integrity
 * signature, Wompi redirects them to their bank, and the outcome arrives as a
 * signed events webhook. `providerRef` is our own paymentId (the Wompi
 * `reference`), which is deterministic and keeps the ledger's unique
 * provider+providerRef index intact.
 *
 * Stays hidden (`isConfigured()` false) until every Wompi credential is set.
 */
@Injectable()
export class PseProvider implements PaymentProvider {
  readonly id = 'pse';
  readonly displayName = 'PSE — transferencia bancaria';
  readonly supportedCurrencies = ['COP'];

  private readonly logger = new Logger(PseProvider.name);
  private readonly psp?: string;
  private readonly publicKey?: string;
  private readonly privateKey?: string;
  private readonly eventsSecret?: string;
  private readonly integritySecret?: string;
  private readonly apiBaseUrl: string;
  private readonly checkoutUrl = 'https://checkout.wompi.co/p/';

  constructor(private readonly configService: ConfigService) {
    this.psp = this.configService.get<string>('pse.provider');
    this.publicKey = this.configService.get<string>('pse.apiKey');
    this.privateKey = this.configService.get<string>('pse.apiSecret');
    this.eventsSecret = this.configService.get<string>('pse.webhookSecret');
    this.integritySecret = this.configService.get<string>('pse.integritySecret');
    this.apiBaseUrl =
      this.configService.get<string>('pse.baseUrl') || 'https://production.wompi.co/v1';
  }

  isConfigured(): boolean {
    return (
      this.psp === 'wompi' &&
      Boolean(this.publicKey) &&
      Boolean(this.privateKey) &&
      Boolean(this.eventsSecret) &&
      Boolean(this.integritySecret)
    );
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) {
      throw new Error('Wompi (PSE) is not configured');
    }
    const amountInCents = request.amountMinor;
    const reference = request.paymentId;
    const currency = request.currency.toUpperCase();
    const integrity = createHash('sha256')
      .update(`${reference}${amountInCents}${currency}${this.integritySecret}`)
      .digest('hex');

    const params = new URLSearchParams({
      'public-key': this.publicKey!,
      currency,
      'amount-in-cents': String(amountInCents),
      reference,
      'signature:integrity': integrity,
    });
    if (request.returnUrl) params.set('redirect-url', request.returnUrl);

    return {
      providerRef: reference,
      instruction: { kind: 'redirect', redirectUrl: `${this.checkoutUrl}?${params.toString()}` },
    };
  }

  async parseWebhook(
    rawBody: Buffer | string,
    _headers: Record<string, any>,
  ): Promise<ProviderPaymentState | null> {
    if (!this.eventsSecret) {
      throw new Error('PSE_WEBHOOK_SECRET is not configured; refusing to trust webhook');
    }
    const payload = JSON.parse(rawBody.toString());
    const signature = payload?.signature;
    const transaction = payload?.data?.transaction;
    if (!signature?.checksum || !Array.isArray(signature.properties) || !transaction) {
      throw new Error('Malformed Wompi webhook');
    }

    // Wompi signs the concatenation of the values named in signature.properties
    // (dot-paths into the payload), then the event timestamp, then the events secret.
    const concatenated = signature.properties
      .map((path: string) => this.valueAt(payload, path))
      .join('');
    const computed = createHash('sha256')
      .update(`${concatenated}${payload.timestamp}${this.eventsSecret}`)
      .digest('hex');

    if (computed !== signature.checksum) {
      throw new Error('Wompi webhook signature verification failed');
    }

    return {
      providerRef: String(transaction.reference),
      status: this.mapStatus(transaction.status),
      amountMinor: transaction.amount_in_cents,
      currency: transaction.currency,
      failureReason: transaction.status_message,
      raw: { wompiId: transaction.id, status: transaction.status, reference: transaction.reference },
    };
  }

  async fetchPaymentState(providerRef: string): Promise<ProviderPaymentState> {
    // providerRef is our reference; Wompi's public API looks transactions up by
    // its own id, so reconcile needs the Wompi id stored on the payment's
    // providerMetadata.wompiId. The admin service passes that through raw.
    const res = await fetch(`${this.apiBaseUrl}/transactions/${providerRef}`, {
      headers: { Authorization: `Bearer ${this.privateKey}` },
    });
    if (!res.ok) throw new Error(`Wompi transaction lookup failed: ${res.status}`);
    const body = await res.json();
    const t = body?.data;
    return {
      providerRef: String(t.reference ?? providerRef),
      status: this.mapStatus(t.status),
      amountMinor: t.amount_in_cents,
      currency: t.currency,
      raw: { wompiId: t.id, status: t.status },
    };
  }

  async refund(_providerRef: string, _amountMinor?: number): Promise<void> {
    throw new Error('PSE/Wompi refunds are handled in the Wompi dashboard, not via API');
  }

  private mapStatus(status: string): PaymentStatus {
    switch (status) {
      case 'APPROVED':
        return PaymentStatus.PAID;
      case 'DECLINED':
      case 'ERROR':
        return PaymentStatus.FAILED;
      case 'VOIDED':
        return PaymentStatus.CANCELLED;
      default:
        return PaymentStatus.PROCESSING;
    }
  }

  /** Resolves a dot-path like "transaction.amount_in_cents" against the payload. */
  private valueAt(payload: any, path: string): string {
    const value = path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), payload.data);
    return String(value);
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- pse.provider.spec && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Document env** — in `env.example`, under the PSE block, add:

```
# Wompi integrity secret (PSE). Required for the checkout integrity signature.
PSE_INTEGRITY_SECRET=
# For Wompi: PSE_PROVIDER=wompi, PSE_API_KEY=<public key>, PSE_API_SECRET=<private key>,
# PSE_WEBHOOK_SECRET=<events secret>, PSE_BASE_URL=https://production.wompi.co/v1
```

- [ ] **Step 7: Commit**

```bash
git add src/config/configuration.ts src/payments/providers/pse.provider.ts src/payments/providers/pse.provider.spec.ts env.example
git commit -m "feat(payments): implement real PSE provider via Wompi

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `onRefunded` fulfilment hook + shop handler

**Files:**
- Modify: `src/payments/services/fulfilment.registry.ts`
- Modify: `src/shop/shop.service.ts`
- Test: `src/shop/shop.service.spec.ts` (extend existing)

**Interfaces:**
- Produces: optional `FulfilmentHandler.onRefunded(referenceId: string, payment: PaymentDocument): Promise<void>`; `FulfilmentRegistry.refund(payment)`.

- [ ] **Step 1: Write the failing test** — append to `src/shop/shop.service.spec.ts` a case asserting `onRefunded(orderId)` sets the order's `status` to `'refunded'`. Follow the existing spec's model-mocking style in that file (reuse its `shopOrderModel` mock; have `findById` return an order whose `save` is a jest mock, then assert `order.status === 'refunded'`).

- [ ] **Step 2: Run it** — `npm test -- shop.service.spec` → FAIL (`onRefunded` undefined).

- [ ] **Step 3: Extend the interface** — in `fulfilment.registry.ts`, add to `FulfilmentHandler`:

```typescript
  /** A refunded payment reverses whatever `onPaid` granted. */
  onRefunded?(referenceId: string, payment: PaymentDocument): Promise<void>;
```

And add to `FulfilmentRegistry`:

```typescript
  /** Runs the refund handler for a payment, if the area registered one. */
  async refund(payment: PaymentDocument): Promise<void> {
    const handler = this.handlers.get(payment.area);
    if (!handler?.onRefunded) return;
    try {
      await handler.onRefunded(payment.referenceId.toString(), payment);
    } catch (error) {
      this.logger.error(
        `Refund fulfilment failed for payment ${payment._id}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
```

- [ ] **Step 4: Implement in `shop.service.ts`** — add:

```typescript
  /** FulfilmentHandler — a refunded payment marks its order refunded. */
  async onRefunded(referenceId: string): Promise<void> {
    const order = await this.shopOrderModel.findById(referenceId);
    if (!order) return;
    order.status = 'refunded';
    await order.save();
    this.logger.log(`Order ${referenceId} marked refunded`);
  }
```

- [ ] **Step 5: Run tests** — `npm test -- shop.service.spec` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/payments/services/fulfilment.registry.ts src/shop/shop.service.ts src/shop/shop.service.spec.ts
git commit -m "feat(payments): add onRefunded fulfilment hook; shop reverses order on refund

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Transactions query DTO

**Files:**
- Create: `src/payments/dto/query-transactions.dto.ts`

**Interfaces:**
- Produces: `QueryTransactionsDto { status?, area?, provider?, q?, from?, to?, page?, limit?, sortBy?, sortOrder? }` and `RefundTransactionDto { reason?, amountMinor? }`.

- [ ] **Step 1: Create the DTO file**

```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { PaymentStatus } from '../schemas/payment.schema';
import { RevenueArea } from '../schemas/platform-settings.schema';

export class QueryTransactionsDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: RevenueArea })
  @IsOptional() @IsEnum(RevenueArea)
  area?: RevenueArea;

  @ApiPropertyOptional({ description: 'Provider id, e.g. stripe or pse' })
  @IsOptional() @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Search buyer email/name or providerRef' })
  @IsOptional() @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound on createdAt' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound on createdAt' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional() @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional() @IsString()
  sortOrder?: 'asc' | 'desc';
}

export class RefundTransactionDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Partial refund amount in minor units; omit for full' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  amountMinor?: number;
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/payments/dto/query-transactions.dto.ts
git commit -m "feat(payments): add admin transactions query + refund DTOs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AdminTransactionsService

**Files:**
- Create: `src/payments/services/admin-transactions.service.ts`
- Test: `src/payments/services/admin-transactions.service.spec.ts`
- Modify: `src/payments/payments.module.ts` (register + export)

**Interfaces:**
- Consumes: `Payment` model, `PaymentProviderRegistry`, `PaymentsService` (`applyProviderState`), `FulfilmentRegistry`, `QueryTransactionsDto`, `RefundTransactionDto`.
- Produces: `list(query)`, `summary(query)`, `getOne(id)`, `refund(id, dto)`, `reconcile(id)`.

- [ ] **Step 1: Write the failing test** — `admin-transactions.service.spec.ts`. Cover: (a) `refund` throws `BadRequestException` when the payment is not `paid`; (b) `refund` on a `paid` payment calls `provider.refund(providerRef, amountMinor)` and sets `status=REFUNDED`, `payoutStatus=VOID`. Mock the payment model's `findById` to return a doc with a jest `save`, and the registry's `get` to return `{ refund: jest.fn() }`.

```typescript
import { AdminTransactionsService } from './admin-transactions.service';
import { PaymentStatus, PayoutStatus } from '../schemas/payment.schema';
import { BadRequestException } from '@nestjs/common';

describe('AdminTransactionsService.refund', () => {
  function setup(status: PaymentStatus) {
    const payment: any = {
      _id: 'p1', provider: 'stripe', providerRef: 'pi_1', status,
      payoutStatus: PayoutStatus.OWED, area: 'shop', referenceId: 'o1',
      save: jest.fn().mockResolvedValue(undefined),
    };
    const model: any = { findById: jest.fn().mockResolvedValue(payment) };
    const refund = jest.fn().mockResolvedValue(undefined);
    const registry: any = { get: jest.fn().mockReturnValue({ refund }) };
    const fulfilment: any = { refund: jest.fn().mockResolvedValue(undefined) };
    const payments: any = {};
    const svc = new AdminTransactionsService(model, registry, payments, fulfilment);
    return { svc, payment, refund, fulfilment };
  }

  it('rejects refunding a payment that is not paid', async () => {
    const { svc } = setup(PaymentStatus.PENDING);
    await expect(svc.refund('p1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refunds a paid payment and voids the payout', async () => {
    const { svc, payment, refund, fulfilment } = setup(PaymentStatus.PAID);
    await svc.refund('p1', { reason: 'duplicate', amountMinor: 500 });
    expect(refund).toHaveBeenCalledWith('pi_1', 500);
    expect(payment.status).toBe(PaymentStatus.REFUNDED);
    expect(payment.payoutStatus).toBe(PayoutStatus.VOID);
    expect(fulfilment.refund).toHaveBeenCalledWith(payment);
  });
});
```

- [ ] **Step 2: Run it** — `npm test -- admin-transactions.service.spec` → FAIL.

- [ ] **Step 3: Implement the service**

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Payment, PaymentDocument, PaymentStatus, PayoutStatus } from '../schemas/payment.schema';
import { PaymentProviderRegistry } from '../providers/provider.registry';
import { PaymentsService } from './payments.service';
import { FulfilmentRegistry } from './fulfilment.registry';
import { QueryTransactionsDto } from '../dto/query-transactions.dto';
import { RefundTransactionDto } from '../dto/query-transactions.dto';

@Injectable()
export class AdminTransactionsService {
  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<PaymentDocument>,
    private readonly registry: PaymentProviderRegistry,
    private readonly payments: PaymentsService,
    private readonly fulfilment: FulfilmentRegistry,
  ) {}

  private buildFilter(query: QueryTransactionsDto): FilterQuery<PaymentDocument> {
    const filter: FilterQuery<PaymentDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.area) filter.area = query.area;
    if (query.provider) filter.provider = query.provider;
    if (query.q) filter.providerRef = { $regex: query.q, $options: 'i' };
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) (filter.createdAt as any).$gte = new Date(query.from);
      if (query.to) (filter.createdAt as any).$lte = new Date(query.to);
    }
    return filter;
  }

  async list(query: QueryTransactionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort: Record<string, 1 | -1> = {
      [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1,
    };
    const filter = this.buildFilter(query);
    const [data, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .populate('buyerId', 'firstName lastName email')
        .populate('sellerId', 'firstName lastName email')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async summary(query: QueryTransactionsDto) {
    const filter = this.buildFilter(query);
    const rows = await this.paymentModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          grossMinor: { $sum: '$grossMinor' },
          netMinor: { $sum: '$netMinor' },
          commissionMinor: { $sum: '$commissionMinor' },
        },
      },
    ]);
    const byStatus: Record<string, any> = {};
    let totalCount = 0;
    let totalGrossMinor = 0;
    for (const r of rows) {
      byStatus[r._id] = { count: r.count, grossMinor: r.grossMinor, netMinor: r.netMinor, commissionMinor: r.commissionMinor };
      totalCount += r.count;
      totalGrossMinor += r.grossMinor;
    }
    return { byStatus, totalCount, totalGrossMinor };
  }

  async getOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Transaction not found');
    const payment = await this.paymentModel
      .findById(id)
      .populate('buyerId', 'firstName lastName email')
      .populate('sellerId', 'firstName lastName email')
      .lean();
    if (!payment) throw new NotFoundException('Transaction not found');
    return payment;
  }

  async refund(id: string, dto: RefundTransactionDto) {
    const payment = await this.paymentModel.findById(id);
    if (!payment) throw new NotFoundException('Transaction not found');
    if (payment.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Only a paid transaction can be refunded');
    }
    if (!payment.providerRef) {
      throw new BadRequestException('Transaction has no provider reference to refund');
    }

    const provider = this.registry.get(payment.provider);
    await provider.refund(payment.providerRef, dto.amountMinor);

    payment.status = PaymentStatus.REFUNDED;
    payment.payoutStatus = PayoutStatus.VOID;
    payment.failureReason = dto.reason ?? 'Refunded by admin';
    await payment.save();

    await this.fulfilment.refund(payment);
    return payment.toObject();
  }

  async reconcile(id: string) {
    const payment = await this.paymentModel.findById(id);
    if (!payment) throw new NotFoundException('Transaction not found');
    if (!payment.providerRef) {
      throw new BadRequestException('Transaction has no provider reference to reconcile');
    }
    const provider = this.registry.get(payment.provider);
    const lookupRef = (payment.providerMetadata?.wompiId as string) || payment.providerRef;
    const state = await provider.fetchPaymentState(lookupRef);
    const settled = await this.payments.applyProviderState(state);
    if (settled) await this.fulfilment.fulfil(settled);
    return this.getOne(id);
  }
}
```

- [ ] **Step 4: Run tests** — `npm test -- admin-transactions.service.spec` → PASS.

- [ ] **Step 5: Register in the module** — in `payments.module.ts`, import `AdminTransactionsService`, add it to `providers` and `exports`.

- [ ] **Step 6: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/payments/services/admin-transactions.service.ts src/payments/services/admin-transactions.service.spec.ts src/payments/payments.module.ts
git commit -m "feat(payments): add AdminTransactionsService (list, summary, detail, refund, reconcile)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Admin transaction controller routes

**Files:**
- Modify: `src/payments/payments.controller.ts`

**Interfaces:**
- Consumes: `AdminTransactionsService`.
- Produces: `GET /payments/transactions`, `/transactions/summary`, `/transactions/:id`, `POST /transactions/:id/refund`, `/transactions/:id/reconcile` (all ADMIN-guarded).

- [ ] **Step 1: Inject the service** — add `private readonly transactions: AdminTransactionsService` to the controller constructor and import it + the DTOs.

- [ ] **Step 2: Add the routes** (place above the webhook route so `:provider` cannot shadow them — they are under `/transactions`, so no collision, but keep them grouped with the other admin routes):

```typescript
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('transactions')
  @ApiOperation({ summary: '[Admin] List transactions (the payment ledger)' })
  listTransactions(@Query() query: QueryTransactionsDto) {
    return this.transactions.list(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('transactions/summary')
  @ApiOperation({ summary: '[Admin] Transaction totals by status' })
  transactionsSummary(@Query() query: QueryTransactionsDto) {
    return this.transactions.summary(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('transactions/:id')
  @ApiOperation({ summary: '[Admin] One transaction' })
  getTransaction(@Param('id') id: string) {
    return this.transactions.getOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post('transactions/:id/refund')
  @ApiOperation({ summary: '[Admin] Refund a paid transaction' })
  refundTransaction(@Param('id') id: string, @Body() dto: RefundTransactionDto) {
    return this.transactions.refund(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post('transactions/:id/reconcile')
  @ApiOperation({ summary: '[Admin] Re-poll the provider and sync status' })
  reconcileTransaction(@Param('id') id: string) {
    return this.transactions.reconcile(id);
  }
```

Add the needed imports: `Query` from `@nestjs/common`, `QueryTransactionsDto`, `RefundTransactionDto`, `AdminTransactionsService`.

- [ ] **Step 3: Typecheck + build** — `npm run typecheck && npm run build` → PASS.

- [ ] **Step 4: Manual smoke** — start the API (`npm run start:dev`), open Swagger at `/docs` (or the configured path), confirm the five `transactions` routes appear under Payments and require a bearer token.

- [ ] **Step 5: Commit**

```bash
git add src/payments/payments.controller.ts
git commit -m "feat(payments): expose admin transaction routes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Admin — API config, service, money helper

**Files (`admin` repo):**
- Modify: `utils/apiConfig.ts`
- Create: `services/payments.ts`
- Create: `utils/formatMoney.ts`
- Test: `utils/formatMoney.test.ts`

**Interfaces:**
- Produces: `paymentsService.{ listTransactions, getSummary, getTransaction, refund, reconcile }`; `formatMinor(amountMinor, currency)`.

- [ ] **Step 1: Read `utils/apiConfig.ts`** to match its exact structure, then add a `Payments` section:

```typescript
  Payments: {
    TRANSACTIONS: `${API_V1}/payments/transactions`,
    TRANSACTIONS_SUMMARY: `${API_V1}/payments/transactions/summary`,
    TRANSACTION_BY_ID: (id: string) => `${API_V1}/payments/transactions/${id}`,
    REFUND: (id: string) => `${API_V1}/payments/transactions/${id}/refund`,
    RECONCILE: (id: string) => `${API_V1}/payments/transactions/${id}/reconcile`,
  },
```

(Use the same base-path constant the file already uses — match `Shop`/`Admin` entries.)

- [ ] **Step 2: Write `utils/formatMoney.test.ts`** (Vitest):

```typescript
import { describe, it, expect } from 'vitest';
import { formatMinor } from './formatMoney';

describe('formatMinor', () => {
  it('formats USD minor units as dollars', () => {
    expect(formatMinor(12345, 'USD')).toBe('$123.45');
  });
  it('formats zero-decimal COP without cents', () => {
    expect(formatMinor(50000, 'COP')).toContain('50.000');
  });
});
```

- [ ] **Step 3: Run it** — `npm test -- formatMoney` → FAIL.

- [ ] **Step 4: Implement `utils/formatMoney.ts`**

```typescript
/** Currencies Intl treats as having no minor unit. Keep in sync with the backend. */
const ZERO_DECIMAL = new Set(['COP', 'JPY', 'KRW', 'CLP', 'VND']);

export function formatMinor(amountMinor: number, currency: string): string {
  const code = (currency || 'USD').toUpperCase();
  const divisor = ZERO_DECIMAL.has(code) ? 1 : 100;
  const major = amountMinor / divisor;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(major);
  } catch {
    return `${major.toFixed(ZERO_DECIMAL.has(code) ? 0 : 2)} ${code}`;
  }
}
```

- [ ] **Step 5: Run it** — `npm test -- formatMoney` → PASS. (If the COP assertion is locale-sensitive, relax it to check the numeric part.)

- [ ] **Step 6: Create `services/payments.ts`** (mirror `services/admin.ts` style):

```typescript
import apiEndpoints from "../utils/apiConfig";
import { HTTP_CLIENT } from "../utils/axiosClient";

export interface TransactionQuery {
  status?: string; area?: string; provider?: string; q?: string;
  from?: string; to?: string; page?: number; limit?: number;
  sortBy?: string; sortOrder?: "asc" | "desc";
}

class PaymentsService {
  async listTransactions(query: TransactionQuery = {}): Promise<any> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
    });
    const { data } = await HTTP_CLIENT.get(`${apiEndpoints.Payments.TRANSACTIONS}?${params.toString()}`);
    return data;
  }
  async getSummary(query: TransactionQuery = {}): Promise<any> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
    });
    const { data } = await HTTP_CLIENT.get(`${apiEndpoints.Payments.TRANSACTIONS_SUMMARY}?${params.toString()}`);
    return data;
  }
  async getTransaction(id: string): Promise<any> {
    const { data } = await HTTP_CLIENT.get(apiEndpoints.Payments.TRANSACTION_BY_ID(id));
    return data;
  }
  async refund(id: string, body: { reason?: string; amountMinor?: number } = {}): Promise<any> {
    const { data } = await HTTP_CLIENT.post(apiEndpoints.Payments.REFUND(id), body);
    return data;
  }
  async reconcile(id: string): Promise<any> {
    const { data } = await HTTP_CLIENT.post(apiEndpoints.Payments.RECONCILE(id));
    return data;
  }
}

export default new PaymentsService();
```

- [ ] **Step 7: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 8: Commit**

```bash
git add utils/apiConfig.ts services/payments.ts utils/formatMoney.ts utils/formatMoney.test.ts
git commit -m "feat(admin): payments API config, service, and money formatting

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Admin — Transactions page, table, filters, stat cards, detail drawer

**Files (`admin` repo):**
- Modify: `components/sidebar/sidebar.tsx`
- Create: `pages/transactions.tsx`
- Create: `components/transactions/index.tsx`
- Create: `components/transactions/stat-cards.tsx`
- Create: `components/transactions/filters.tsx`
- Create: `components/transactions/table.tsx`
- Create: `components/transactions/detail-drawer.tsx`

**Interfaces:**
- Consumes: `paymentsService`, `formatMinor`, existing NextUI + react-query setup.

- [ ] **Step 1: Add the sidebar item** — in `components/sidebar/sidebar.tsx`, import `PaymentsIcon` from `../icons/sidebar/payments-icon` and add inside `<SidebarMenu>`:

```tsx
              <SidebarItem
                isActive={router.pathname === "/transactions"}
                title="Transactions"
                icon={<PaymentsIcon />}
                href="/transactions"
              />
```

- [ ] **Step 2: Create `pages/transactions.tsx`** — mirror another page (e.g. `pages/shop.tsx`) for the layout wrapper and auth guard, rendering `<TransactionsView />` from `components/transactions`.

- [ ] **Step 3: Build `components/transactions/index.tsx`** — owns filter state, runs two `useQuery` calls (`listTransactions`, `getSummary`) keyed by the filter object, and composes `<StatCards>`, `<Filters>`, `<TransactionsTable>`, `<DetailDrawer>`. Include a **CSV export** button that converts the currently loaded `data` rows to CSV (columns: date, buyer email, area, provider, status, gross, currency, providerRef) and triggers a client download via a `Blob` + anchor.

- [ ] **Step 4: Build `components/transactions/stat-cards.tsx`** — render cards from `summary.byStatus`: Paid, Pending, Processing, Failed, Refunded (count + `formatMinor(grossMinor, 'USD')`; currency comes from each row — use the row currency in the table, and a neutral total in cards).

- [ ] **Step 5: Build `components/transactions/filters.tsx`** — status tabs (`all, pending, processing, paid, failed, cancelled, refunded`), area select (`shop, materials, classes`), provider select (`stripe, pse`), search input (debounced), and a date-range (from/to) pair. Follow `components/table/filters.tsx` for styling. Lift changes up via an `onChange(partialQuery)` callback.

- [ ] **Step 6: Build `components/transactions/table.tsx`** — NextUI table following `components/teachers/table.tsx`: columns Date, Buyer, Area, Provider, Amount (`formatMinor(row.grossMinor, row.currency)`), Status (color-coded chip), Actions. Row click opens the drawer. Include pagination wired to `page`/`totalPages`.

- [ ] **Step 7: Build `components/transactions/detail-drawer.tsx`** — a NextUI modal/drawer showing all ledger fields, buyer/seller, provider metadata, and two actions:
  - **Refund** — shown only when `status === 'paid'`; opens a confirm modal ("This refunds real money and cannot be undone"), optional reason + optional partial amount, calls `paymentsService.refund(id, body)`, invalidates the queries, toasts the result. Disable for `provider === 'pse'` with a tooltip "Refund PSE in the Wompi dashboard".
  - **Reconcile** — shown for `pending`/`processing`; calls `paymentsService.reconcile(id)`, invalidates, toasts.

- [ ] **Step 8: Typecheck + lint** — `npm run typecheck && npm run lint` → PASS.

- [ ] **Step 9: Browser verify** — run the admin dev server, log in as admin, open `/transactions`: confirm the table loads, filters narrow results, a row opens the drawer, and the refund button only appears on paid Stripe rows. Screenshot for the user.

- [ ] **Step 10: Commit**

```bash
git add components/sidebar/sidebar.tsx pages/transactions.tsx components/transactions
git commit -m "feat(admin): Transactions tab with filters, detail, refund, reconcile, CSV

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Web — Stripe card form

**Files (`LMS-web` repo):**
- Modify: `package.json` (add `@stripe/react-stripe-js`)
- Create: `components/payments/StripeCardForm.tsx`

**Interfaces:**
- Consumes: `clientSecret`, `publishableKey`, `returnUrl`, `onProcessing()` from the checkout flow.
- Produces: a self-contained card form that confirms the PaymentIntent.

- [ ] **Step 1: Install the dependency**

```bash
npm install @stripe/react-stripe-js
```

- [ ] **Step 2: Create `components/payments/StripeCardForm.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";

interface Props {
  clientSecret: string;
  publishableKey: string;
  returnUrl: string;
  /** Called once the intent is confirmed and now succeeded/processing. */
  onProcessing: () => void;
}

/** Cache one Stripe instance per publishable key. */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string) {
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(key));
  return stripeCache.get(key)!;
}

function CardInner({ returnUrl, onProcessing }: { returnUrl: string; onProcessing: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: returnUrl },
    });
    if (error) {
      setError(error.message || "Payment could not be completed.");
      setSubmitting(false);
      return;
    }
    if (paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status)) {
      onProcessing();
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handlePay}
        disabled={!stripe || submitting}
        className="w-full bg-primary text-white h-12 rounded-xl font-bold flex items-center justify-center disabled:opacity-50"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Pay now"}
      </button>
    </div>
  );
}

export default function StripeCardForm({ clientSecret, publishableKey, returnUrl, onProcessing }: Props) {
  const stripePromise = useMemo(() => stripeFor(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <CardInner returnUrl={returnUrl} onProcessing={onProcessing} />
    </Elements>
  );
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/payments/StripeCardForm.tsx
git commit -m "feat(web): Stripe Elements card form that confirms the PaymentIntent

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Web — cart store

**Files (`LMS-web` repo):**
- Create: `store/cart.ts`

**Interfaces:**
- Produces: `useCart` zustand hook — `items`, `add(item)`, `remove(key)`, `setQty(key, qty)`, `clear()`, `count()`, `subtotal()`; line key = `productId + '::' + size`.

- [ ] **Step 1: Create `store/cart.ts`** (mirror `store/auth.ts` persist setup)

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartLine {
  productId: string;
  title: string;
  image?: string;
  price: number; // major units, as stored on Product
  size: string;
  quantity: number;
  sizes?: string[];
}

function keyOf(productId: string, size: string) {
  return `${productId}::${size}`;
}

interface CartState {
  items: CartLine[];
  add: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => void;
  remove: (key: string) => void;
  setQty: (key: string, quantity: number) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (line) =>
        set((state) => {
          const key = keyOf(line.productId, line.size);
          const existing = state.items.find((i) => keyOf(i.productId, i.size) === key);
          const addQty = line.quantity ?? 1;
          if (existing) {
            return {
              items: state.items.map((i) =>
                keyOf(i.productId, i.size) === key ? { ...i, quantity: i.quantity + addQty } : i,
              ),
            };
          }
          return { items: [...state.items, { ...line, quantity: addQty }] };
        }),
      remove: (key) =>
        set((state) => ({ items: state.items.filter((i) => keyOf(i.productId, i.size) !== key) })),
      setQty: (key, quantity) =>
        set((state) => ({
          items: state.items
            .map((i) => (keyOf(i.productId, i.size) === key ? { ...i, quantity: Math.max(1, quantity) } : i))
            .filter((i) => i.quantity > 0),
        })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((n, i) => n + i.quantity, 0),
      subtotal: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    { name: "varona-cart" },
  ),
);

export const cartKey = keyOf;
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add store/cart.ts
git commit -m "feat(web): persistent shopping cart store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Web — add-to-cart + header cart button

**Files (`LMS-web` repo):**
- Create: `components/molecules/shop/cart-button/index.tsx`
- Modify: the header/navbar component (locate with `grep -rl "nav" components/molecules | head`; mount the cart button in the shared header used by `/shop`)
- Modify: `components/molecules/shop/product-list/index.tsx` (add-to-cart on each card)
- Modify: `components/molecules/shop/product-card/index.tsx` (product detail: "Add to Cart" + "Buy Now" → add then `router.push('/cart')`)

**Interfaces:**
- Consumes: `useCart`.

- [ ] **Step 1: Create `cart-button/index.tsx`** — a client component showing a `ShoppingBag` icon with a count badge from `useCart((s) => s.count())`, wrapped in `<Link href="/cart">`. Guard for hydration (render the badge only after mount to avoid SSR mismatch — `useEffect` set `mounted`).

- [ ] **Step 2: Mount it in the header** — add `<CartButton />` to the shared site header so it shows across shop pages.

- [ ] **Step 3: Add "Add to Cart" to list cards** — in `product-list`, each card gets a button calling `useCart().add({ productId, title, image, price, size: defaultSize })` and a `toast.success("Added to cart")`. Use the product's first size as default, or open the size picker if sizes exist.

- [ ] **Step 4: Rework the product-detail actions** — in `product-card/index.tsx`, replace the direct-checkout modal path: "Add to Cart" adds the current `selectedSize`/`quantity` and toasts; "Buy Now" adds then `router.push('/cart')`. Remove the inline checkout `handleSubmit`/`PaymentMethodPicker` block (payment now lives on the cart page). Keep the size/quantity UI.

- [ ] **Step 5: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 6: Browser verify** — dev server: add a shirt from the list and from the detail page; confirm the header badge increments and the cart persists across reload.

- [ ] **Step 7: Commit**

```bash
git add components/molecules/shop
git commit -m "feat(web): add-to-cart on shop + header cart button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Web — cart page with real checkout

**Files (`LMS-web` repo):**
- Create: `app/cart/page.tsx`

**Interfaces:**
- Consumes: `useCart`, `PaymentMethodPicker`, `StripeCardForm`, `HTTP_CLIENT`.

- [ ] **Step 1: Build `app/cart/page.tsx`** — a client page with three regions:
  1. **Line items** — map `items`, each with image, title, size, qty steppers (`setQty`), remove, and line total; show `subtotal()`. Empty-cart state links back to `/shop`.
  2. **Shipping form** — name, line1, city, state, zip, country (default `CO`), matching the `ShippingAddressDto` fields.
  3. **Payment** — `<PaymentMethodPicker value={method} onChange={setMethod}>`; the flow:
     - On "Continue to payment": `POST /api/v1/shop/checkout` with `items` (mapped from cart: `{ productId, size, quantity }`), `paymentMethod: method`, and `shipping`. Store the returned payload.
     - If `instruction.kind === 'client_secret'` (Stripe): render `<StripeCardForm clientSecret publishableKey returnUrl={`${location.origin}/cart/confirm`} onProcessing={() => { clear(); setAwaiting(true); }} />`.
     - If `instruction.kind === 'redirect'` (PSE): `window.location.href = instruction.redirectUrl` (clear the cart first).
  4. **Awaiting state** — same honest "reserved, confirmed by webhook" copy as the old modal.

```tsx
// Checkout trigger (inside the page component):
async function startCheckout() {
  setError(null);
  setStarting(true);
  try {
    const res = await HTTP_CLIENT.post("/api/v1/shop/checkout", {
      items: items.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity })),
      paymentMethod: method,
      shipping,
    });
    const payload = res.data?.data ?? res.data;
    setPending(payload);
    if (payload.instruction?.kind === "redirect") {
      clear();
      window.location.href = payload.instruction.redirectUrl;
    }
  } catch (e: any) {
    const m = e?.response?.data?.message || "We couldn't start your payment.";
    setError(Array.isArray(m) ? m.join(" · ") : m);
  } finally {
    setStarting(false);
  }
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 3: Browser verify (Stripe test mode)** — with backend `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` test keys set, add items, go to `/cart`, fill shipping, choose card, enter Stripe test card `4242 4242 4242 4242`, pay. Confirm: `confirmPayment` succeeds, the awaiting state shows, and (with the Stripe CLI forwarding `payment_intent.succeeded` to `/payments/webhook/stripe`) the order flips to `paid` and the ledger row becomes `paid`. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add app/cart/page.tsx
git commit -m "feat(web): cart page with Stripe Elements + PSE redirect checkout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: End-to-end verification + docs

- [ ] **Step 1: Backend full test + build** — in `varona-academy-backend`: `npm test && npm run build` → all green.
- [ ] **Step 2: Admin build** — in `admin`: `npm run typecheck && npm run build`.
- [ ] **Step 3: Web build** — in `LMS-web`: `npm run typecheck && npm run build`.
- [ ] **Step 4: Stripe happy path** — documented in Task 12 Step 3; capture that the ledger row reaches `paid` and appears in the admin Transactions tab as Paid.
- [ ] **Step 5: Refund path** — in the admin tab, refund that paid Stripe transaction (Stripe test mode); confirm status flips to `refunded`, `payoutStatus` to `void`, and the shop order to `refunded`.
- [ ] **Step 6: PSE gating** — with no Wompi creds, confirm PSE shows as "coming soon"/"unavailable" and is not selectable; with sandbox creds + currency `COP`, confirm the redirect URL builds. (Live Wompi settlement requires real sandbox credentials from the user.)
- [ ] **Step 7: Update `env.example` note** (already in Task 2) and commit any doc tweaks.

---

## Self-Review

**Spec coverage:**
- Stream A (Stripe card) → Tasks 9, 12. ✓
- Stream B (PSE/Wompi) → Tasks 1 (stub refund), 2. ✓
- Stream C (admin API, refund, reconcile) → Tasks 1, 3, 4, 5, 6. ✓
- Stream D (admin tab) → Tasks 7, 8. ✓
- Stream E (cart) → Tasks 10, 11, 12. ✓
- Refund interface change → Task 1. ✓  onRefunded hook → Task 3. ✓
- Minor-units display helper → Task 7. ✓

**Type consistency:** `PaymentProvider.refund(providerRef, amountMinor?)` defined in Task 1, used in Tasks 2, 5. `AdminTransactionsService` constructor `(paymentModel, registry, payments, fulfilment)` matches its spec test (Task 5) and controller injection (Task 6). `FulfilmentRegistry.refund(payment)` defined in Task 3, called in Task 5. `formatMinor(amountMinor, currency)` defined in Task 7, used in Task 8. `useCart` selectors match across Tasks 10–12. Cart line maps to `CheckoutItemDto { productId, size, quantity }` in Task 12.

**Placeholder scan:** UI tasks (8, 11, 12) describe components with concrete code for the non-obvious logic (checkout trigger, cart store, Stripe form) and reference exact existing files to mirror for layout; no `TBD`/`TODO`.
