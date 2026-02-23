// ---------------------------------------------------------------------------
// Tests for src/bot/classifier.js — Hybrid Intent Classifier
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Claude service before importing classifier
vi.mock('../services/claude.js', () => ({
  classifyWithClaude: vi.fn(),
}));

const { classifyIntent, normalizeText } = await import('../bot/classifier.js');
const { classifyWithClaude } = await import('../services/claude.js');

describe('normalizeText', () => {
  it('lowercases and trims text', () => {
    expect(normalizeText('  HOLA Mundo  ')).toBe('hola mundo');
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('')).toBe('');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeText('hola   mundo')).toBe('hola mundo');
  });
});

describe('classifyIntent — regex approval patterns', () => {
  const approvalWords = [
    'si', 'sí', 'dale', 'ok', 'okay', 'va', 'sale', 'listo', 'lista',
    'perfecto', 'perfecta', 'publícalo', 'adelante', 'mándalo', 'órale',
    'ándale', 'jalo', 'está bien', 'claro', 'por supuesto', 'hazlo',
    'de acuerdo', 'bueno', 'súbelo', 'yes', 'yeah', 'yep', 'sure',
    'go ahead', 'post it', 'looks good', 'love it', 'me gusta', 'me encanta',
  ];

  for (const word of approvalWords) {
    it(`classifies "${word}" as approval`, async () => {
      const result = await classifyIntent(word);
      expect(result.intent).toBe('approval');
      expect(result.method).toBe('regex');
    });
  }

  it('classifies thumbs up emoji as approval', async () => {
    const result = await classifyIntent('\u{1F44D}');
    expect(result.intent).toBe('approval');
    expect(result.method).toBe('regex');
  });

  it('classifies check mark emoji as approval', async () => {
    const result = await classifyIntent('\u2705');
    expect(result.intent).toBe('approval');
    expect(result.method).toBe('regex');
  });

  it('classifies fire emoji as approval', async () => {
    const result = await classifyIntent('\u{1F525}');
    expect(result.intent).toBe('approval');
    expect(result.method).toBe('regex');
  });
});

describe('classifyIntent — regex rejection patterns', () => {
  const rejectionWords = ['no', 'cambialo', 'otra vez', 'cambiar', 'nel', 'nah', 'nope', 'feo', 'mal', 'horrible'];

  for (const word of rejectionWords) {
    it(`classifies "${word}" as rejection`, async () => {
      const result = await classifyIntent(word);
      expect(result.intent).toBe('rejection');
      expect(result.method).toBe('regex');
    });
  }

  it('classifies thumbs down emoji as rejection', async () => {
    const result = await classifyIntent('\u{1F44E}');
    expect(result.intent).toBe('rejection');
    expect(result.method).toBe('regex');
  });

  it('classifies "no me gusta" as rejection (not approval)', async () => {
    const result = await classifyIntent('no me gusta');
    expect(result.intent).toBe('rejection');
  });

  it('classifies "no está bien" as rejection (not approval)', async () => {
    const result = await classifyIntent('no esta bien');
    expect(result.intent).toBe('rejection');
  });
});

describe('classifyIntent — cancel patterns', () => {
  it('classifies "cancelar" as cancel', async () => {
    const result = await classifyIntent('cancelar');
    expect(result.intent).toBe('cancel');
  });

  it('classifies "no publiques" as cancel', async () => {
    const result = await classifyIntent('no publiques');
    expect(result.intent).toBe('cancel');
  });
});

describe('classifyIntent — other intents', () => {
  it('classifies "hola" as greeting', async () => {
    const result = await classifyIntent('hola');
    expect(result.intent).toBe('greeting');
    expect(result.method).toBe('regex');
  });

  it('classifies "cuanto cuesta" as faq', async () => {
    const result = await classifyIntent('cuanto cuesta');
    expect(result.intent).toBe('faq');
  });

  it('classifies "emergencia" as emergency', async () => {
    const result = await classifyIntent('emergencia');
    expect(result.intent).toBe('emergency');
  });

  it('classifies "hablar con alguien" as escalation', async () => {
    const result = await classifyIntent('hablar con alguien');
    expect(result.intent).toBe('escalation');
  });
});

describe('classifyIntent — Claude fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to Claude for ambiguous messages', async () => {
    classifyWithClaude.mockResolvedValueOnce({ intent: 'approval', confidence: 'high' });

    const result = await classifyIntent('creo que puede funcionar, aunque no estoy seguro');
    expect(result.intent).toBe('approval');
    expect(result.method).toBe('claude');
    expect(classifyWithClaude).toHaveBeenCalled();
  });

  it('returns other/low when Claude fails', async () => {
    classifyWithClaude.mockRejectedValueOnce(new Error('API timeout'));

    const result = await classifyIntent('algo completamente aleatorio sin patron');
    expect(result.intent).toBe('other');
    expect(result.confidence).toBe('low');
    expect(result.method).toBe('claude_fallback');
  });

  it('returns other/low when Claude returns malformed response', async () => {
    classifyWithClaude.mockResolvedValueOnce({ bad: 'data' });

    const result = await classifyIntent('mensaje sin patron conocido xyz');
    expect(result.intent).toBe('other');
    expect(result.confidence).toBe('low');
  });
});

describe('classifyIntent — empty input', () => {
  it('returns other for empty string', async () => {
    const result = await classifyIntent('');
    expect(result.intent).toBe('other');
    expect(result.confidence).toBe('low');
  });

  it('returns other for null', async () => {
    const result = await classifyIntent(null);
    expect(result.intent).toBe('other');
  });
});
