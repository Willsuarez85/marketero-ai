// ---------------------------------------------------------------------------
// Tests for src/bot/handlers/emergency.js — Emergency Post Flow
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../db/queries/conversation.js', () => ({
  setConversationState: vi.fn(),
  clearConversationState: vi.fn(),
}));

vi.mock('../content/emergency.js', () => ({
  generateEmergencyContent: vi.fn(),
}));

const { handleEmergencyStep } = await import('../bot/handlers/emergency.js');
const { setConversationState, clearConversationState } = await import('../db/queries/conversation.js');
const { generateEmergencyContent } = await import('../content/emergency.js');

const mockRestaurant = { id: 'rest-1', name: 'El Patron' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleEmergencyStep — flow steps', () => {
  it('step 0: collects topic and advances to step 1', async () => {
    setConversationState.mockResolvedValueOnce({});

    const state = { flow_step: 0, flow_data: {}, expires_at: new Date(Date.now() + 60000).toISOString() };
    const msgData = { message: 'Tacos de birria', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_step_1');
    expect(result.response).toContain('precio');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1', 'emergency_post', 1,
      expect.objectContaining({ topic: 'Tacos de birria' }),
      30
    );
  });

  it('step 1: collects details and advances to step 2', async () => {
    setConversationState.mockResolvedValueOnce({});

    const state = { flow_step: 1, flow_data: { topic: 'Tacos' }, expires_at: new Date(Date.now() + 60000).toISOString() };
    const msgData = { message: '$8.99, 11am-9pm', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_step_2');
    expect(result.response).toContain('foto');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1', 'emergency_post', 2,
      expect.objectContaining({ topic: 'Tacos', priceOrSchedule: '$8.99, 11am-9pm' }),
      30
    );
  });

  it('step 1: skips details when client says "listo"', async () => {
    setConversationState.mockResolvedValueOnce({});

    const state = { flow_step: 1, flow_data: { topic: 'Tacos' }, expires_at: new Date(Date.now() + 60000).toISOString() };
    const msgData = { message: 'listo', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_step_2');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1', 'emergency_post', 2,
      expect.objectContaining({ priceOrSchedule: null }),
      30
    );
  });

  it('step 2: generates emergency content when client sends photo', async () => {
    clearConversationState.mockResolvedValueOnce({});
    generateEmergencyContent.mockResolvedValueOnce({ success: true, contentId: 'c-1' });

    const state = {
      flow_step: 2,
      flow_data: { topic: 'Tacos', priceOrSchedule: '$8.99' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const msgData = { message: '', mediaUrl: 'https://img.com/photo.jpg', mediaType: 'image' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_generating');
    expect(result.response).toContain('creando');
    expect(clearConversationState).toHaveBeenCalledWith('rest-1');
    expect(generateEmergencyContent).toHaveBeenCalledWith('rest-1', expect.objectContaining({
      topic: 'Tacos',
      photoUrl: 'https://img.com/photo.jpg',
    }));
  });

  it('step 2: generates content without photo when client says "no"', async () => {
    clearConversationState.mockResolvedValueOnce({});
    generateEmergencyContent.mockResolvedValueOnce({ success: true, contentId: 'c-2' });

    const state = {
      flow_step: 2,
      flow_data: { topic: 'Especial' },
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const msgData = { message: 'no', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_generating');
    expect(generateEmergencyContent).toHaveBeenCalledWith('rest-1', expect.objectContaining({
      photoUrl: null,
    }));
  });

  it('returns error when generation fails', async () => {
    clearConversationState.mockResolvedValueOnce({});
    generateEmergencyContent.mockResolvedValueOnce({ success: false, error: 'caption_failed' });

    const state = { flow_step: 2, flow_data: { topic: 'Test' }, expires_at: new Date(Date.now() + 60000).toISOString() };
    const msgData = { message: 'no foto', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_failed');
    expect(result.response).toContain('problema');
  });

  it('handles expired conversation', async () => {
    clearConversationState.mockResolvedValueOnce({});

    const state = {
      flow_step: 1,
      flow_data: { topic: 'Tacos' },
      expires_at: new Date(Date.now() - 60000).toISOString(), // expired
    };
    const msgData = { message: 'hello', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_expired');
    expect(result.response).toContain('expiro');
    expect(clearConversationState).toHaveBeenCalledWith('rest-1');
  });

  it('handles invalid step gracefully', async () => {
    clearConversationState.mockResolvedValueOnce({});

    const state = { flow_step: 99, flow_data: {}, expires_at: new Date(Date.now() + 60000).toISOString() };
    const msgData = { message: 'test', mediaUrl: null, mediaType: 'text' };

    const result = await handleEmergencyStep(mockRestaurant, state, msgData);

    expect(result.action).toBe('emergency_error');
    expect(clearConversationState).toHaveBeenCalled();
  });
});
