// ---------------------------------------------------------------------------
// src/services/claude.js  --  Thin Claude API client (classify, caption, image)
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env automatically

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

export async function generateCaption(restaurant, contentType, brain) {
  try {
    const menuItems = brain?.menuItems?.length
      ? `\nMenu items to feature: ${brain.menuItems.join(', ')}`
      : '';

    const goals = brain?.monthlyGoals
      ? `\nMonthly goals: ${brain.monthlyGoals}`
      : '';

    const brandVoice = brain?.brandVoice
      ? `\nBrand voice: ${brain.brandVoice}`
      : '';

    const response = await client.messages.create({
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
            '',
            'Generate one social media caption.',
          ].join('\n'),
        },
      ],
    });

    return response.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('[services:claude] generateCaption error:', err.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. Image prompt generation for fal.ai
// ---------------------------------------------------------------------------

export async function generateImagePrompt(restaurant, contentType, brain) {
  try {
    const visualProfile = brain?.visualProfile
      ? `\nVisual profile: ${JSON.stringify(brain.visualProfile)}`
      : '';

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.7,
      system: [
        'Generate a detailed image prompt for an AI image generator (fal.ai).',
        'The image should look like professional food photography.',
        'Output ONLY the image prompt text, nothing else.',
      ].join(' '),
      messages: [
        {
          role: 'user',
          content: [
            `Restaurant: ${restaurant.name || 'Unknown'}`,
            `Cuisine: ${restaurant.cuisine_type || 'Latino'}`,
            `Content type: ${contentType}`,
            visualProfile,
            '',
            'Generate the image prompt.',
          ].join('\n'),
        },
      ],
    });

    return response.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('[services:claude] generateImagePrompt error:', err.message || err);
    return null;
  }
}
