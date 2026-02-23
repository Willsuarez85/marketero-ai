// ---------------------------------------------------------------------------
// Tests for src/onboarding/sessions.js — Micro-session Onboarding Flow
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../db/queries/conversation.js', () => ({
  setConversationState: vi.fn(),
  advanceConversationStep: vi.fn(),
  clearConversationState: vi.fn(),
}));

vi.mock('../db/queries/brains.js', () => ({
  updateBrain: vi.fn(),
  incrementOnboardingSession: vi.fn(),
}));

vi.mock('../db/queries/restaurants.js', () => ({
  updateRestaurantStatus: vi.fn(),
}));

vi.mock('../db/queries/jobs.js', () => ({
  createJob: vi.fn(),
}));

vi.mock('../services/ghl.js', () => ({
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock('../db/queries/memory.js', () => ({
  logMemory: vi.fn().mockResolvedValue(null),
}));

const {
  handleOnboardingStep,
  startSession,
  shouldStartOnboarding,
  getNextSessionNumber,
} = await import('../onboarding/sessions.js');

const { setConversationState, advanceConversationStep, clearConversationState } = await import('../db/queries/conversation.js');
const { updateBrain, incrementOnboardingSession } = await import('../db/queries/brains.js');
const { updateRestaurantStatus } = await import('../db/queries/restaurants.js');
const { createJob } = await import('../db/queries/jobs.js');

const mockRestaurant = { id: 'rest-1', name: 'La Unica', status: 'onboarding' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shouldStartOnboarding', () => {
  it('returns true when status is onboarding', () => {
    expect(shouldStartOnboarding({ status: 'onboarding' })).toBe(true);
  });

  it('returns false when status is active', () => {
    expect(shouldStartOnboarding({ status: 'active' })).toBe(false);
  });

  it('returns false when status is paused', () => {
    expect(shouldStartOnboarding({ status: 'paused' })).toBe(false);
  });
});

describe('getNextSessionNumber', () => {
  it('returns 1 when brain has no onboarding_session', () => {
    expect(getNextSessionNumber({})).toBe(1);
    expect(getNextSessionNumber(null)).toBe(1);
  });

  it('returns session + 1', () => {
    expect(getNextSessionNumber({ onboarding_session: 1 })).toBe(2);
    expect(getNextSessionNumber({ onboarding_session: 3 })).toBe(4);
  });
});

describe('startSession', () => {
  it('starts session 1 with first question', async () => {
    setConversationState.mockResolvedValueOnce({});
    advanceConversationStep.mockResolvedValueOnce({});

    const result = await startSession(mockRestaurant, 1);

    expect(result.action).toBe('onboarding_session_started');
    expect(result.response).toContain('como se llama tu restaurante');
    expect(setConversationState).toHaveBeenCalledWith(
      'rest-1',
      'onboarding',
      0,
      expect.objectContaining({ sessionNumber: 1 }),
      120,
    );
  });

  it('starts session 2 with session header', async () => {
    setConversationState.mockResolvedValueOnce({});
    advanceConversationStep.mockResolvedValueOnce({});

    const result = await startSession(mockRestaurant, 2);

    expect(result.action).toBe('onboarding_session_started');
    expect(result.response).toContain('Sesion 2');
    expect(result.response).toContain('Brand Voice');
  });

  it('returns complete when session number exceeds 4', async () => {
    const result = await startSession(mockRestaurant, 5);

    expect(result.action).toBe('onboarding_complete');
    expect(setConversationState).not.toHaveBeenCalled();
  });
});

describe('handleOnboardingStep', () => {
  it('asks next question when session is in progress', async () => {
    advanceConversationStep.mockResolvedValueOnce({});

    const state = { flow_data: { sessionNumber: 1 }, flow_step: 0 };
    const result = await handleOnboardingStep(mockRestaurant, state, { message: null });

    expect(result.action).toBe('onboarding_question');
    expect(result.response).toContain('como se llama tu restaurante');
  });

  it('stores response and advances to next question', async () => {
    advanceConversationStep.mockResolvedValueOnce({});

    const state = { flow_data: { sessionNumber: 1 }, flow_step: 1 };
    const result = await handleOnboardingStep(
      mockRestaurant,
      state,
      { message: 'La Unica Supermarket' },
    );

    expect(result.action).toBe('onboarding_question');
    // Should ask about cuisine type (second question)
    expect(result.response).toContain('tipo de comida');
  });

  it('completes session when all questions answered', async () => {
    updateBrain.mockResolvedValueOnce({});
    incrementOnboardingSession.mockResolvedValueOnce({});
    clearConversationState.mockResolvedValueOnce({});
    createJob.mockResolvedValueOnce({});

    // Session 1 has 4 questions, so step 4 means all answered
    const state = {
      flow_data: { sessionNumber: 1, name: 'La Unica', cuisine_type: 'mexicana', menu_highlights: 'tacos, burritos' },
      flow_step: 4,
    };
    const result = await handleOnboardingStep(
      mockRestaurant,
      state,
      { message: 'no' }, // logo = no
    );

    expect(result.action).toBe('onboarding_session_complete');
    expect(updateBrain).toHaveBeenCalled();
    expect(incrementOnboardingSession).toHaveBeenCalledWith('rest-1');
    expect(clearConversationState).toHaveBeenCalledWith('rest-1');
  });

  it('activates restaurant when all 4 sessions complete', async () => {
    updateBrain.mockResolvedValueOnce({});
    incrementOnboardingSession.mockResolvedValueOnce({});
    clearConversationState.mockResolvedValueOnce({});
    updateRestaurantStatus.mockResolvedValueOnce({});

    const state = {
      flow_data: { sessionNumber: 4, platforms: 'instagram', delivery_time: '9am' },
      flow_step: 3, // session 4 has 3 questions
    };
    const result = await handleOnboardingStep(
      mockRestaurant,
      state,
      { message: 'listo' },
    );

    expect(result.action).toBe('onboarding_complete');
    expect(updateRestaurantStatus).toHaveBeenCalledWith('rest-1', 'active');
    expect(result.response).toContain('onboarding esta completo');
  });

  it('returns error when invalid session number', async () => {
    clearConversationState.mockResolvedValueOnce({});

    const state = { flow_data: { sessionNumber: 99 }, flow_step: 0 };
    const result = await handleOnboardingStep(mockRestaurant, state, { message: 'hola' });

    expect(result.action).toBe('onboarding_error');
  });
});

describe('processResponse via handleOnboardingStep', () => {
  it('splits menu_highlights into array', async () => {
    advanceConversationStep.mockResolvedValueOnce({});

    // Step 3 in session 1 is menu_highlights
    const state = { flow_data: { sessionNumber: 1, name: 'Test', cuisine_type: 'mexicana' }, flow_step: 3 };
    await handleOnboardingStep(
      mockRestaurant,
      state,
      { message: 'Tacos al pastor, Burritos, Quesadillas' },
    );

    // The advanceConversationStep should receive the parsed data in flow_data
    expect(advanceConversationStep).toHaveBeenCalledWith(
      'rest-1',
      4,
      expect.objectContaining({
        menu_highlights: ['Tacos al pastor', 'Burritos', 'Quesadillas'],
      }),
    );
  });

  it('handles photo upload with media URL', async () => {
    advanceConversationStep.mockResolvedValueOnce({});

    // Step 4 in session 1 is logo_url
    const state = { flow_data: { sessionNumber: 1, name: 'Test', cuisine_type: 'mexicana', menu_highlights: [] }, flow_step: 4 };

    // This is the last question in session 1, so it will trigger completeSession
    updateBrain.mockResolvedValueOnce({});
    incrementOnboardingSession.mockResolvedValueOnce({});
    clearConversationState.mockResolvedValueOnce({});
    createJob.mockResolvedValueOnce({});

    await handleOnboardingStep(
      mockRestaurant,
      state,
      { message: null, mediaUrl: 'https://example.com/logo.jpg', mediaType: 'image' },
    );

    // Session should complete and brain should be updated with logo
    expect(updateBrain).toHaveBeenCalledWith(
      'rest-1',
      expect.objectContaining({
        logo_url: 'https://example.com/logo.jpg',
      }),
    );
  });
});
