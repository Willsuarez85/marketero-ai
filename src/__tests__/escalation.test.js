// ---------------------------------------------------------------------------
// Tests for src/bot/handlers/escalation.js — Escalation Flow
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../db/queries/conversation.js', () => ({
  setConversationState: vi.fn(),
  clearConversationState: vi.fn(),
}));

vi.mock('../services/ghl.js', () => ({
  sendWhatsAppMessage: vi.fn(),
}));

// Set env before import
process.env.OPERATOR_GHL_CONTACT_ID = 'op-contact-123';

const { handleEscalationFull, handleBotFailureEscalation, notifySystemError } = await import('../bot/handlers/escalation.js');
const { setConversationState, clearConversationState } = await import('../db/queries/conversation.js');
const { sendWhatsAppMessage } = await import('../services/ghl.js');

const mockRestaurant = { id: 'rest-1', name: 'El Patron' };
const mockMessageData = { message: 'necesito hablar con alguien', mediaUrl: null, mediaType: 'text', contactId: 'contact-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleEscalationFull', () => {
  it('sets conversation state and notifies operator', async () => {
    setConversationState.mockResolvedValueOnce({});
    sendWhatsAppMessage.mockResolvedValue({});

    const result = await handleEscalationFull(mockRestaurant, mockMessageData, 'user_requested');

    expect(result.action).toBe('escalation');
    expect(result.response).toContain('5 minutos');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1', 'escalation', 0,
      expect.objectContaining({ escalation_type: 'user_requested' }),
      120
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('ESCALACION')
    );
  });

  it('includes restaurant name in operator notification', async () => {
    setConversationState.mockResolvedValueOnce({});
    sendWhatsAppMessage.mockResolvedValue({});

    await handleEscalationFull(mockRestaurant, mockMessageData, 'user_requested');

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('El Patron')
    );
  });

  it('includes client message in operator notification', async () => {
    setConversationState.mockResolvedValueOnce({});
    sendWhatsAppMessage.mockResolvedValue({});

    await handleEscalationFull(mockRestaurant, mockMessageData, 'user_requested');

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('necesito hablar con alguien')
    );
  });

  it('returns escalation response even when operator notification fails', async () => {
    setConversationState.mockResolvedValueOnce({});
    sendWhatsAppMessage.mockRejectedValueOnce(new Error('GHL down'));

    const result = await handleEscalationFull(mockRestaurant, mockMessageData);

    expect(result.action).toBe('escalation');
    expect(result.response).toContain('equipo');
  });
});

describe('handleBotFailureEscalation', () => {
  it('first failure: asks to rephrase and sets counter to 1', async () => {
    setConversationState.mockResolvedValueOnce({});

    const result = await handleBotFailureEscalation(mockRestaurant, mockMessageData, null);

    expect(result.action).toBe('unrecognized');
    expect(result.response).toContain('No entendi');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1', 'bot_confusion', 0,
      expect.objectContaining({ unrecognized_count: 1 }),
      5
    );
  });

  it('second failure: auto-escalates after 2 consecutive unrecognized messages', async () => {
    setConversationState.mockResolvedValue({});
    clearConversationState.mockResolvedValueOnce({});
    sendWhatsAppMessage.mockResolvedValue({});

    const state = { flow_data: { unrecognized_count: 1 } };
    const result = await handleBotFailureEscalation(mockRestaurant, mockMessageData, state);

    expect(result.action).toBe('escalation');
    expect(result.response).toContain('5 minutos');
    expect(clearConversationState).toHaveBeenCalledWith('rest-1');
  });

  it('returns null on error', async () => {
    setConversationState.mockRejectedValueOnce(new Error('db error'));

    const result = await handleBotFailureEscalation(mockRestaurant, mockMessageData, null);

    expect(result).toBeNull();
  });
});

describe('notifySystemError', () => {
  it('sends error notification to operator', async () => {
    sendWhatsAppMessage.mockResolvedValueOnce({});

    await notifySystemError(mockRestaurant, 'fal.ai image generation failed 3x');

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('ERROR DE SISTEMA')
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('fal.ai image generation failed 3x')
    );
  });
});
