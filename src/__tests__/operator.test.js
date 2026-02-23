// ---------------------------------------------------------------------------
// Tests for src/bot/operator.js — Operator Review Flow
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../bot/classifier.js', () => ({
  classifyIntent: vi.fn(),
}));

vi.mock('../db/queries/content.js', () => ({
  getOldestHumanReview: vi.fn(),
  countByStatus: vi.fn(),
  updateContentStatus: vi.fn(),
}));

vi.mock('../content/publish.js', () => ({
  sendContentForApproval: vi.fn(),
}));

vi.mock('../services/ghl.js', () => ({
  sendWhatsAppMessage: vi.fn(),
  sendWhatsAppImage: vi.fn(),
}));

vi.mock('../db/queries/jobs.js', () => ({
  createJob: vi.fn(),
}));

// Set env before import
process.env.OPERATOR_GHL_CONTACT_ID = 'op-contact-123';

const { handleOperatorMessage } = await import('../bot/operator.js');
const { classifyIntent } = await import('../bot/classifier.js');
const { getOldestHumanReview, countByStatus, updateContentStatus } = await import('../db/queries/content.js');
const { sendContentForApproval } = await import('../content/publish.js');
const { sendWhatsAppMessage } = await import('../services/ghl.js');
const { createJob } = await import('../db/queries/jobs.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleOperatorMessage — approval flow', () => {
  it('approves oldest human_review content and sends to client', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'approval', confidence: 'high', method: 'regex' });
    getOldestHumanReview.mockResolvedValueOnce({
      id: 'content-1',
      restaurant_id: 'rest-1',
      restaurants: { name: 'La Unica' },
      caption: 'Post chido',
    });
    updateContentStatus.mockResolvedValueOnce({});
    sendContentForApproval.mockResolvedValueOnce({});
    countByStatus.mockResolvedValueOnce(0);

    await handleOperatorMessage({ message: 'dale' });

    expect(updateContentStatus).toHaveBeenCalledWith(
      'content-1',
      'pending_client',
      expect.objectContaining({ human_approved_at: expect.any(String) }),
    );
    expect(sendContentForApproval).toHaveBeenCalledWith('content-1');
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('Aprobado para La Unica'),
    );
  });

  it('reports "no pending" when approving with empty queue', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'approval', confidence: 'high', method: 'regex' });
    getOldestHumanReview.mockResolvedValueOnce(null);

    await handleOperatorMessage({ message: 'si' });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      'No hay posts pendientes de revision.',
    );
    expect(updateContentStatus).not.toHaveBeenCalled();
  });
});

describe('handleOperatorMessage — rejection flow', () => {
  it('rejects content and schedules regeneration', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'rejection', confidence: 'high', method: 'regex' });
    getOldestHumanReview.mockResolvedValueOnce({
      id: 'content-2',
      restaurant_id: 'rest-1',
      restaurants: { name: 'El Patron' },
    });
    updateContentStatus.mockResolvedValueOnce({});
    createJob.mockResolvedValueOnce({ id: 'job-1' });
    countByStatus.mockResolvedValueOnce(2);

    await handleOperatorMessage({ message: 'no' });

    expect(updateContentStatus).toHaveBeenCalledWith('content-2', 'generating');
    expect(createJob).toHaveBeenCalledWith(
      'rest-1',
      'daily_content',
      expect.any(String),
      expect.objectContaining({ regeneration: true, previous_content_id: 'content-2' }),
    );
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('Rechazado para El Patron'),
    );
  });

  it('reports "no pending" when rejecting with empty queue', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'rejection', confidence: 'high', method: 'regex' });
    getOldestHumanReview.mockResolvedValueOnce(null);

    await handleOperatorMessage({ message: 'no' });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      'No hay posts pendientes de revision.',
    );
  });
});

describe('handleOperatorMessage — unknown command', () => {
  it('shows pending count when there are items to review', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'greeting', confidence: 'high', method: 'regex' });
    countByStatus.mockResolvedValueOnce(3);

    await handleOperatorMessage({ message: 'hola' });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('3 post(s) pendientes'),
    );
  });

  it('shows "no pending" when queue is empty', async () => {
    classifyIntent.mockResolvedValueOnce({ intent: 'greeting', confidence: 'high', method: 'regex' });
    countByStatus.mockResolvedValueOnce(0);

    await handleOperatorMessage({ message: 'hola' });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      'No hay posts pendientes de revision.',
    );
  });

  it('asks for clarification when message is empty', async () => {
    await handleOperatorMessage({ message: null });

    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'op-contact-123',
      expect.stringContaining('No entendi'),
    );
  });
});
