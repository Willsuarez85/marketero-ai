// ---------------------------------------------------------------------------
// Tests for src/content/scheduler.js — Daily Content Scheduler
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db/queries/restaurants.js', () => ({
  getActiveRestaurants: vi.fn(),
}));

vi.mock('../db/queries/jobs.js', () => ({
  createJob: vi.fn(),
  hasPendingJob: vi.fn(),
}));

const { scheduleDailyContent } = await import('../content/scheduler.js');
const { getActiveRestaurants } = await import('../db/queries/restaurants.js');
const { createJob, hasPendingJob } = await import('../db/queries/jobs.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scheduleDailyContent', () => {
  it('returns 0/0 when no active restaurants', async () => {
    getActiveRestaurants.mockResolvedValueOnce([]);

    const result = await scheduleDailyContent();
    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(createJob).not.toHaveBeenCalled();
  });

  it('creates a job for an active restaurant with no pending job', async () => {
    getActiveRestaurants.mockResolvedValueOnce([
      { id: 'rest-1', name: 'La Unica', timezone: 'America/New_York', status: 'active' },
    ]);
    hasPendingJob.mockResolvedValueOnce(false);
    createJob.mockResolvedValueOnce({ id: 'job-1' });

    const result = await scheduleDailyContent();
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(createJob).toHaveBeenCalledWith(
      'rest-1',
      'daily_content',
      expect.any(String),
      { source: 'scheduler' },
    );
  });

  it('skips restaurants that already have a pending job', async () => {
    getActiveRestaurants.mockResolvedValueOnce([
      { id: 'rest-1', name: 'La Unica', timezone: 'America/New_York', status: 'active' },
    ]);
    hasPendingJob.mockResolvedValueOnce(true);

    const result = await scheduleDailyContent();
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(createJob).not.toHaveBeenCalled();
  });

  it('handles multiple restaurants: some pending, some new', async () => {
    getActiveRestaurants.mockResolvedValueOnce([
      { id: 'rest-1', name: 'La Unica', timezone: 'America/New_York', status: 'active' },
      { id: 'rest-2', name: 'El Patron', timezone: 'America/Chicago', status: 'active' },
      { id: 'rest-3', name: 'Taqueria Sol', timezone: 'America/Los_Angeles', status: 'active' },
    ]);
    hasPendingJob
      .mockResolvedValueOnce(true)   // rest-1 already has pending
      .mockResolvedValueOnce(false)  // rest-2 needs job
      .mockResolvedValueOnce(false); // rest-3 needs job
    createJob
      .mockResolvedValueOnce({ id: 'job-2' })
      .mockResolvedValueOnce({ id: 'job-3' });

    const result = await scheduleDailyContent();
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(1);
    expect(createJob).toHaveBeenCalledTimes(2);
  });

  it('uses default timezone when restaurant has none', async () => {
    getActiveRestaurants.mockResolvedValueOnce([
      { id: 'rest-1', name: 'No TZ', status: 'active' },
    ]);
    hasPendingJob.mockResolvedValueOnce(false);
    createJob.mockResolvedValueOnce({ id: 'job-1' });

    await scheduleDailyContent();
    expect(createJob).toHaveBeenCalledWith(
      'rest-1',
      'daily_content',
      expect.any(String),
      { source: 'scheduler' },
    );
  });

  it('handles getActiveRestaurants failure gracefully', async () => {
    getActiveRestaurants.mockRejectedValueOnce(new Error('DB down'));

    const result = await scheduleDailyContent();
    expect(result).toEqual({ created: 0, skipped: 0 });
  });
});
