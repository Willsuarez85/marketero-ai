// ---------------------------------------------------------------------------
// Tests for src/services/whisper.js — Whisper Audio Transcription
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OpenAI
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: class OpenAI {
      constructor() {
        this.audio = {
          transcriptions: {
            create: mockCreate,
          },
        };
      }
    },
    __mockCreate: mockCreate,
  };
});

// Mock global fetch for audio download
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { transcribeAudio } = await import('../services/whisper.js');
const { __mockCreate } = await import('openai');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transcribeAudio', () => {
  it('returns transcription on success', async () => {
    // Mock audio download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    // Mock Whisper API
    __mockCreate.mockResolvedValueOnce({ text: 'Dale publicalo' });

    const result = await transcribeAudio('https://example.com/audio.ogg');

    expect(result).toEqual({ text: 'Dale publicalo', language: 'es' });
    expect(__mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'whisper-1',
        language: 'es',
      }),
    );
  });

  it('returns null when audio download fails', async () => {
    // Both attempts fail
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' })
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await transcribeAudio('https://example.com/missing.ogg');
    expect(result).toBeNull();
  });

  it('returns null when Whisper returns empty text', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    __mockCreate.mockResolvedValueOnce({ text: '' });

    const result = await transcribeAudio('https://example.com/audio.ogg');
    expect(result).toBeNull();
  });

  it('retries once on failure then returns null', async () => {
    // First attempt: download OK, Whisper fails
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    __mockCreate
      .mockRejectedValueOnce(new Error('API Error'))
      .mockRejectedValueOnce(new Error('API Error'));

    const result = await transcribeAudio('https://example.com/audio.ogg');
    expect(result).toBeNull();
    expect(__mockCreate).toHaveBeenCalledTimes(2);
  });

  it('succeeds on retry after first failure', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    __mockCreate
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce({ text: 'Hola amigo' });

    const result = await transcribeAudio('https://example.com/audio.ogg');
    expect(result).toEqual({ text: 'Hola amigo', language: 'es' });
    expect(__mockCreate).toHaveBeenCalledTimes(2);
  });

  it('returns null when downloaded audio is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const result = await transcribeAudio('https://example.com/empty.ogg');
    expect(result).toBeNull();
  });
});
