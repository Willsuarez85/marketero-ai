// ---------------------------------------------------------------------------
// Tests for src/bot/handlers/faq.js — FAQ Bot
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../db/client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('../bot/handlers/autopilot.js', () => ({
  activateAutopilot: vi.fn().mockResolvedValue(true),
  deactivateAutopilot: vi.fn().mockResolvedValue(true),
}));

vi.mock('../db/queries/restaurants.js', () => ({
  updateRestaurantStatus: vi.fn(),
}));

const { handleFaqIntent } = await import('../bot/handlers/faq.js');
const { activateAutopilot, deactivateAutopilot } = await import('../bot/handlers/autopilot.js');
const { updateRestaurantStatus } = await import('../db/queries/restaurants.js');
const { supabase } = await import('../db/client.js');

const mockRestaurant = { id: 'rest-1', name: 'La Unica', autopilot: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleFaqIntent — sub-classification', () => {
  it('responds to "que se publico esta semana" with published posts', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [
          { caption: 'Tacos al pastor hoy!', published_at: '2026-02-22T15:00:00Z', image_url: 'img.jpg' },
          { caption: 'Especial del viernes!', published_at: '2026-02-21T14:00:00Z', image_url: 'img2.jpg' },
        ],
        error: null,
      }),
    });

    const result = await handleFaqIntent(mockRestaurant, { message: 'que se publico esta semana' });

    expect(result.action).toBe('faq_published');
    expect(result.response).toContain('2 post(s)');
  });

  it('responds to "cuando sale mi proximo post" with next job info', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { scheduled_for: '2026-02-24T14:00:00Z', metadata: {} },
        error: null,
      }),
    });

    const result = await handleFaqIntent(mockRestaurant, { message: 'cuando sale mi proximo post' });

    expect(result.action).toBe('faq_next_post');
    expect(result.response).toContain('programado');
  });

  it('responds to "activar piloto automatico" by enabling autopilot', async () => {
    activateAutopilot.mockResolvedValueOnce(true);

    const result = await handleFaqIntent(mockRestaurant, { message: 'quiero activar piloto automatico' });

    expect(result.action).toBe('faq_autopilot');
    expect(result.response).toContain('activado');
    expect(activateAutopilot).toHaveBeenCalledWith('rest-1');
  });

  it('responds to "desactivar automatico" by disabling autopilot', async () => {
    deactivateAutopilot.mockResolvedValueOnce(true);

    const result = await handleFaqIntent(mockRestaurant, { message: 'desactivar automatico' });

    expect(result.action).toBe('faq_autopilot');
    expect(result.response).toContain('desactivado');
    expect(deactivateAutopilot).toHaveBeenCalledWith('rest-1');
  });

  it('responds to "piloto automatico" with current status', async () => {
    const result = await handleFaqIntent(
      { ...mockRestaurant, autopilot: true },
      { message: 'piloto automatico' }
    );

    expect(result.action).toBe('faq_autopilot');
    expect(result.response).toContain('activado');
  });

  it('responds to "cuanto cuesta" with pricing info', async () => {
    const result = await handleFaqIntent(mockRestaurant, { message: 'cuanto cuesta el servicio' });

    expect(result.action).toBe('faq_pricing');
    expect(result.response).toContain('$99');
  });

  it('responds to "como funciona" with how-it-works info', async () => {
    const result = await handleFaqIntent(mockRestaurant, { message: 'como funciona esto' });

    expect(result.action).toBe('faq_how_it_works');
    expect(result.response).toContain('post');
  });

  it('responds to "pausar servicio" by pausing restaurant', async () => {
    updateRestaurantStatus.mockResolvedValueOnce({});

    const result = await handleFaqIntent(mockRestaurant, { message: 'quiero pausar servicio' });

    expect(result.action).toBe('faq_pause');
    expect(result.response).toContain('pausa');
    expect(updateRestaurantStatus).toHaveBeenCalledWith('rest-1', 'paused');
  });

  it('responds to "cambiar el post" with change request prompt', async () => {
    const result = await handleFaqIntent(mockRestaurant, { message: 'quiero cambiar el post de manana' });

    expect(result.action).toBe('faq_change_post');
    expect(result.response).toContain('cambios');
  });

  it('responds to unrecognized FAQ with general help', async () => {
    const result = await handleFaqIntent(mockRestaurant, { message: 'algo que no matchea nada' });

    expect(result.action).toBe('faq_general');
    expect(result.response).toContain('preguntar');
  });

  it('returns no posts when nothing published this week', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await handleFaqIntent(mockRestaurant, { message: 'que salio esta semana' });

    expect(result.action).toBe('faq_published');
    expect(result.response).toContain('No hay posts');
  });

  it('handles engagement with no data', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await handleFaqIntent(mockRestaurant, { message: 'como estuvo el engagement' });

    expect(result.action).toBe('faq_engagement');
    expect(result.response).toContain('no hay datos');
  });
});
