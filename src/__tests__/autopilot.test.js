// ---------------------------------------------------------------------------
// Tests for src/bot/handlers/autopilot.js — Autopilot Mode
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../db/client.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('../db/queries/content.js', () => ({
  updateContentStatus: vi.fn(),
}));

vi.mock('../db/queries/jobs.js', () => ({
  createJob: vi.fn(),
  hasPendingJob: vi.fn(),
}));

vi.mock('../content/publish.js', () => ({
  publishContent: vi.fn(),
}));

vi.mock('../services/ghl.js', () => ({
  sendWhatsAppMessage: vi.fn(),
  lookupContactByPhone: vi.fn(),
}));

const { handleAutopilotPublish, activateAutopilot, deactivateAutopilot } = await import('../bot/handlers/autopilot.js');
const { updateContentStatus } = await import('../db/queries/content.js');
const { publishContent } = await import('../content/publish.js');
const { supabase } = await import('../db/client.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleAutopilotPublish', () => {
  it('returns error when content_id is missing from metadata', async () => {
    const job = { id: 'job-1', metadata: {} };
    const result = await handleAutopilotPublish(job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing_content_id');
  });

  it('skips when content is no longer pending_client (client already responded)', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'c-1', status: 'approved', restaurant_id: 'r-1' },
        error: null,
      }),
    });

    const job = { id: 'job-1', metadata: { content_id: 'c-1' } };
    const result = await handleAutopilotPublish(job);

    expect(result.success).toBe(true);
    expect(updateContentStatus).not.toHaveBeenCalled();
  });

  it('auto-approves and publishes when content is still pending_client', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'c-1', status: 'pending_client', restaurant_id: 'r-1' },
        error: null,
      }),
    });

    updateContentStatus.mockResolvedValueOnce({});
    publishContent.mockResolvedValueOnce({ success: true, ghlPostId: 'ghl-1' });

    // Mock resolveContactId (internal) — returns null for simplicity
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const job = { id: 'job-1', metadata: { content_id: 'c-1' } };
    const result = await handleAutopilotPublish(job);

    expect(result.success).toBe(true);
    expect(updateContentStatus).toHaveBeenCalledWith('c-1', 'approved', expect.objectContaining({
      client_approved_at: expect.any(String),
    }));
    expect(publishContent).toHaveBeenCalledWith('c-1');
  });

  it('returns error when content not found', async () => {
    supabase.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const job = { id: 'job-1', metadata: { content_id: 'c-1' } };
    const result = await handleAutopilotPublish(job);

    expect(result.success).toBe(false);
    expect(result.error).toBe('content_not_found');
  });
});

describe('activateAutopilot', () => {
  it('updates restaurant autopilot to true', async () => {
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const result = await activateAutopilot('r-1');
    expect(result).toBe(true);
  });

  it('returns false on error', async () => {
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: 'db error' } }),
    });

    const result = await activateAutopilot('r-1');
    expect(result).toBe(false);
  });
});

describe('deactivateAutopilot', () => {
  it('updates restaurant autopilot to false', async () => {
    supabase.from.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const result = await deactivateAutopilot('r-1');
    expect(result).toBe(true);
  });
});
