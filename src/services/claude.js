// ---------------------------------------------------------------------------
// src/services/claude.js  --  Thin Claude API client (classify, caption, image)
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env automatically

// ---------------------------------------------------------------------------
// Bot Personality — used in client-facing messages (Phase 3 generateBotResponse)
// NOT injected into classifier, caption, or image prompt functions.
// ---------------------------------------------------------------------------
export const BOT_PERSONALITY = `
Nombre: Marketero
Tono: casual, warm, friendly — como un compa que sabe de redes sociales
Idioma: Spanish Latino casual. Spanglish OK. NUNCA corporativo ni formal.

Reglas:
- Max 2-3 oraciones por mensaje
- 1-2 emojis max (no parecer robot)
- Nunca mencionar AI, inteligencia artificial, ni que eres un bot
- Tutear siempre, nunca de "usted"
- Usar expresiones latinas naturales: dale, va, listo, orale, sale

Tono correcto: "Dale, tu post quedo bien chido! Lo mando a publicar?"
Tono incorrecto: "Estimado cliente, su publicacion ha sido procesada exitosamente."

Tono correcto: "Listo! Ya se publico en tu Insta y Face"
Tono incorrecto: "La publicacion fue realizada satisfactoriamente en las plataformas seleccionadas."
`.trim();

const VALID_INTENTS = new Set([
  'approval',
  'rejection',
  'faq',
  'emergency',
  'escalation',
  'change_request',
  'cancel',
  'greeting',
  'other',
]);

// ---------------------------------------------------------------------------
// 1. Intent classification (fallback when regex classifier misses)
// ---------------------------------------------------------------------------

export async function classifyWithClaude(text, context = {}) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const contextBlock = Object.keys(context).length > 0
      ? `\nContext: ${JSON.stringify(context)}`
      : '';

    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: [
          'You are an intent classifier for a WhatsApp-based social media service for Latino restaurants.',
          'Classify the user\'s message into exactly one intent.',
          'Respond with ONLY a JSON object, no other text.',
          `Valid intents: ${[...VALID_INTENTS].join(', ')}`,
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: `Message: "${text}"${contextBlock}`,
          },
        ],
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const raw = response.content?.[0]?.text?.trim();
    if (!raw) return { intent: 'other', confidence: 'low' };

    const parsed = JSON.parse(raw);
    const intent = parsed.intent?.toLowerCase();

    if (intent && VALID_INTENTS.has(intent)) {
      return { intent, confidence: 'high' };
    }

    return { intent: 'other', confidence: 'low' };
  } catch (err) {
    console.error('[services:claude] classifyWithClaude error:', err.message || err);
    return { intent: 'other', confidence: 'low' };
  }
}

// ---------------------------------------------------------------------------
// 2. Social media caption generation (Spanish / Spanglish)
// ---------------------------------------------------------------------------

export async function generateCaption(restaurant, contentType, brain, industryInsight = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const menuItems = brain?.menu_items?.length
      ? `\nMenu items to feature: ${brain.menu_items.join(', ')}`
      : '';

    const goals = brain?.monthly_goals
      ? `\nMonthly goals: ${brain.monthly_goals}`
      : '';

    const brandVoice = brain?.brand_voice
      ? `\nBrand voice: ${brain.brand_voice}`
      : '';

    // Brand memory fields (from Phase 2 schema)
    const dos = brain?.dos_and_donts?.dos?.length
      ? `\nBrand DO's: ${brain.dos_and_donts.dos.join(', ')}`
      : '';

    const donts = brain?.dos_and_donts?.donts?.length
      ? `\nBrand DON'Ts: ${brain.dos_and_donts.donts.join(', ')}`
      : '';

    const themes = brain?.content_themes?.length
      ? `\nContent themes: ${brain.content_themes.join(', ')}`
      : '';

    // Check for upcoming important dates
    let dateContext = '';
    if (brain?.important_dates?.length) {
      const now = new Date();
      const upcoming = brain.important_dates.filter(d => {
        if (!d.date) return false;
        const diff = new Date(d.date) - now;
        return diff > 0 && diff < 14 * 24 * 60 * 60 * 1000; // within 14 days
      });
      if (upcoming.length) {
        dateContext = `\nUpcoming dates: ${upcoming.map(d => `${d.name} (${d.date})`).join(', ')}`;
      }
    }

    const insightContext = industryInsight
      ? `\nIndustry insight for inspiration: ${industryInsight}`
      : '';

    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        temperature: 0.8,
        system: [
          'You are Marketero AI, a social media content engine for Latino restaurants in the USA.',
          'Generate captions in Spanish or Spanglish that are culturally relevant.',
          'Include emojis, relevant hashtags, and a call to action.',
          'Keep the tone warm, authentic, and engaging for the Latino food community.',
        ].join(' '),
        messages: [
          {
            role: 'user',
            content: [
              `Restaurant: ${restaurant.name || 'Unknown'}`,
              `Cuisine: ${restaurant.cuisine_type || 'Latino'}`,
              `Content type: ${contentType}`,
              brandVoice,
              menuItems,
              goals,
              dos,
              donts,
              themes,
              dateContext,
              insightContext,
              '',
              'Generate one social media caption.',
            ].filter(Boolean).join('\n'),
          },
        ],
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);
    return response.content?.[0]?.text?.trim() || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[services:claude] generateCaption error:', err.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Image prompt generation for fal.ai
// ---------------------------------------------------------------------------

export async function generateImagePrompt(restaurant, contentType, brain, hasRealPhotos = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const visualProfile = brain?.visual_profile
      ? `\nVisual profile: ${JSON.stringify(brain.visual_profile)}`
      : '';

    // Brand colors for visual consistency
    const brandColors = brain?.brand_colors && Object.keys(brain.brand_colors).length
      ? `\nBrand colors: ${Object.entries(brain.brand_colors).map(([k, v]) => `${k}: ${v}`).join(', ')}`
      : '';

    // Visual dos and donts
    const visualDos = brain?.dos_and_donts?.dos?.length
      ? `\nVisual DO's: ${brain.dos_and_donts.dos.join(', ')}`
      : '';
    const visualDonts = brain?.dos_and_donts?.donts?.length
      ? `\nVisual DON'Ts: ${brain.dos_and_donts.donts.join(', ')}`
      : '';

    // Logo reference
    const logoRef = brain?.logo_url
      ? `\nRestaurant logo available — include branding elements if appropriate`
      : '';

    const systemPrompt = hasRealPhotos
      ? [
          'Generate a prompt to edit/enhance existing reference photos for a restaurant social media post.',
          'The photos are real images from the restaurant. Enhance them with better lighting, colors, and composition.',
          'Keep the authentic feel — do NOT make them look artificial or overly processed.',
          'Output ONLY the edit prompt text, nothing else.',
        ].join(' ')
      : [
          'Generate a detailed image prompt for an AI image generator (fal.ai).',
          'The image should look like professional food photography.',
          'Output ONLY the image prompt text, nothing else.',
        ].join(' ');

    const response = await client.messages.create(
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              `Restaurant: ${restaurant.name || 'Unknown'}`,
              `Cuisine: ${restaurant.cuisine_type || 'Latino'}`,
              `Content type: ${contentType}`,
              hasRealPhotos ? 'Mode: editing real restaurant photos' : 'Mode: generating from scratch',
              visualProfile,
              brandColors,
              visualDos,
              visualDonts,
              logoRef,
              '',
              hasRealPhotos ? 'Generate the edit prompt for these photos.' : 'Generate the image prompt.',
            ].filter(Boolean).join('\n'),
          },
        ],
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);
    return response.content?.[0]?.text?.trim() || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[services:claude] generateImagePrompt error:', err.message || err);
    return null;
  }
}
