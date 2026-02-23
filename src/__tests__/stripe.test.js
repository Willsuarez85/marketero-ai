// ---------------------------------------------------------------------------
// Tests for src/services/stripe.js — Stripe Service
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the stripe module — Stripe is imported as `import Stripe from 'stripe'`
// and called with `new Stripe(key)`, so the default export must be a class/constructor.
const mockStripe = {
  customers: {
    create: vi.fn(),
  },
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  subscriptions: {
    update: vi.fn(),
  },
  refunds: {
    create: vi.fn(),
  },
  webhooks: {
    constructEvent: vi.fn(),
  },
};

vi.mock('stripe', () => {
  function StripeMock() {
    return mockStripe;
  }
  return { default: StripeMock };
});

// Set env before import
process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
process.env.STRIPE_PRICE_MONTHLY = 'price_test_xxx';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_xxx';
process.env.BASE_URL = 'http://localhost:3000';

const { createCustomer, createCheckoutSession, cancelSubscription, createRefund, constructWebhookEvent } = await import('../services/stripe.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createCustomer', () => {
  it('creates a Stripe customer with restaurant metadata', async () => {
    mockStripe.customers.create.mockResolvedValueOnce({ id: 'cus_123' });

    const result = await createCustomer('rest-1', 'La Unica', 'owner@test.com', '+1234567890');

    expect(result).toEqual({ customerId: 'cus_123' });
    expect(mockStripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'La Unica',
        email: 'owner@test.com',
        metadata: { restaurant_id: 'rest-1' },
      })
    );
  });

  it('returns null on error', async () => {
    mockStripe.customers.create.mockRejectedValueOnce(new Error('API error'));

    const result = await createCustomer('rest-1', 'Test', null, null);

    expect(result).toBeNull();
  });
});

describe('createCheckoutSession', () => {
  it('creates a checkout session with correct price and URLs', async () => {
    mockStripe.checkout.sessions.create.mockResolvedValueOnce({
      id: 'cs_123',
      url: 'https://checkout.stripe.com/cs_123',
    });

    const result = await createCheckoutSession('cus_123', 'rest-1');

    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/cs_123',
      sessionId: 'cs_123',
    });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        line_items: [{ price: 'price_test_xxx', quantity: 1 }],
        mode: 'subscription',
      })
    );
  });

  it('returns null on error', async () => {
    mockStripe.checkout.sessions.create.mockRejectedValueOnce(new Error('API error'));

    const result = await createCheckoutSession('cus_123', 'rest-1');

    expect(result).toBeNull();
  });
});

describe('cancelSubscription', () => {
  it('cancels subscription at period end', async () => {
    mockStripe.subscriptions.update.mockResolvedValueOnce({});

    const result = await cancelSubscription('sub_123');

    expect(result).toBe(true);
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith('sub_123', {
      cancel_at_period_end: true,
    });
  });

  it('returns false on error', async () => {
    mockStripe.subscriptions.update.mockRejectedValueOnce(new Error('API error'));

    const result = await cancelSubscription('sub_123');

    expect(result).toBe(false);
  });
});

describe('createRefund', () => {
  it('creates a refund for a payment intent', async () => {
    mockStripe.refunds.create.mockResolvedValueOnce({ id: 're_123' });

    const result = await createRefund('pi_123');

    expect(result).toEqual({ refundId: 're_123' });
    expect(mockStripe.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_123',
      reason: 'requested_by_customer',
    });
  });

  it('returns null on error', async () => {
    mockStripe.refunds.create.mockRejectedValueOnce(new Error('API error'));

    const result = await createRefund('pi_123');

    expect(result).toBeNull();
  });
});

describe('constructWebhookEvent', () => {
  it('constructs event from raw body and signature', () => {
    const mockEvent = { type: 'customer.subscription.created', data: {} };
    mockStripe.webhooks.constructEvent.mockReturnValueOnce(mockEvent);

    const result = constructWebhookEvent(Buffer.from('{}'), 'sig_test');

    expect(result).toEqual({ event: mockEvent });
    expect(mockStripe.webhooks.constructEvent).toHaveBeenCalledWith(
      Buffer.from('{}'), 'sig_test', 'whsec_test_xxx'
    );
  });

  it('returns null on invalid signature', () => {
    mockStripe.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });

    const result = constructWebhookEvent(Buffer.from('{}'), 'bad_sig');

    expect(result).toBeNull();
  });
});
