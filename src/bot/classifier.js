// ---------------------------------------------------------------------------
// src/bot/classifier.js  --  Hybrid Intent Classifier (regex-first, Claude fallback)
// ---------------------------------------------------------------------------
// Architecture: ALWAYS try regex first (<100ms). Only call Claude API when
// regex cannot resolve the intent. Claude timeout: 10 seconds.
// ---------------------------------------------------------------------------

import { classifyWithClaude } from '../services/claude.js';

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise incoming text for intent matching.
 * Lowercase, trim, collapse whitespace, strip accents for matching.
 * Preserves emojis.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Strip diacritics / accents for regex word-boundary matching.
 * "sí" → "si", "órale" → "orale", "públicalo" → "publicalo"
 * This is used internally so `\b` word boundaries work correctly.
 * Emojis are preserved.
 */
function stripAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---------------------------------------------------------------------------
// Regex pattern sets — ordered by classification priority
// ---------------------------------------------------------------------------
// Priority order: cancel > rejection-negation > approval > rejection > escalation > emergency > faq > greeting
//
// Cancel first because "cancelar" must override approval context.
// Rejection-negation (e.g. "no me gusta") must come before approval so that
// "no me gusta" is not mis-classified by the "me gusta" approval pattern.
// ---------------------------------------------------------------------------

// --- Cancel ----------------------------------------------------------------
const CANCEL_TEXT = [
  /\bcancelar\b/,
  /\bcancela\b/,
  /\bcancel\b/,
  /\bstop\b/,
  /\bdetener\b/,
  /\bno publiques\b/,
  /\bya no\b/,
];
// "para" alone is too ambiguous (Spanish word for "for"/"stop"), so we require
// it to appear as the entire message.
const CANCEL_EXACT = [
  /^para$/,
];

// --- Rejection: negation phrases (checked BEFORE approval) -----------------
// These patterns start with "no" and would otherwise be swallowed by approval
// patterns that match their positive form (e.g. "me gusta", "esta bien").
const REJECTION_NEGATION = [
  /\bno me gusta\b/,
  /\bno esta bien\b/,
  /\bno asi\b/,
];

// --- Approval --------------------------------------------------------------
// NOTE: patterns use pre-stripped (accent-free) text so \b works correctly.
const APPROVAL_TEXT = [
  /\bsi\b/,
  /\bok\b/,
  /\bokay\b/,
  /\bdale\b/,
  /\bva\b/,
  /\bsale\b/,
  /\blisto\b/,
  /\blista\b/,
  /\bperfecto\b/,
  /\bperfecta\b/,
  /\bpublicalo\b/,
  /\badelante\b/,
  /\bmandalo\b/,
  /\borale\b/,
  /\bandale\b/,
  /\bjalo\b/,
  /\besta bien\b/,
  /\bclaro\b/,
  /\bpor supuesto\b/,
  /\bhazlo\b/,
  /\bhazmelo\b/,
  /\bde acuerdo\b/,
  /\bbueno\b/,
  /\bsubelo\b/,
  /\byes\b/,
  /\byeah\b/,
  /\byep\b/,
  /\bsure\b/,
  /\bgo ahead\b/,
  /\bpost it\b/,
  /\blooks good\b/,
  /\blove it\b/,
  /\bme gusta\b/,
  /\bme encanta\b/,
];
const APPROVAL_EMOJI = /[\u2705\u2714\uFE0F?\u{1F44D}\u{1F44C}\u{1F64C}\u{1F4AF}\u{1F525}][\u{1F3FB}-\u{1F3FF}]?/u;

// --- Rejection (remaining patterns) ----------------------------------------
// NOTE: also uses accent-stripped text for \b compatibility.
const REJECTION_TEXT = [
  /\bcambialo\b/,
  /\botra vez\b/,
  /\bcambiar\b/,
  /\brehaz\b/,
  /\bhazme otro\b/,
  /\bnel\b/,
  /\bnah\b/,
  /\bnope\b/,
  /\bfeo\b/,
  /\bmal\b/,
  /\bhorrible\b/,
  /\botro\b/,
];
// Bare "no" — only when it appears alone or at clear boundaries.
const REJECTION_BARE_NO = /^no$|^no[.,!?\s]|[.,!?\s]no$/;
const REJECTION_EMOJI = /[\u274C\u{1F44E}][\u{1F3FB}-\u{1F3FF}]?/u;

// --- Escalation ------------------------------------------------------------
const ESCALATION_TEXT = [
  /\bhablar con alguien\b/,
  /\bpersona real\b/,
  /\bhumano\b/,
  /\bagente\b/,
  /\boperador\b/,
  /\bayuda urgente\b/,
  /\bhelp\b/,
  /\bneed a person\b/,
  /\bsoporte\b/,
];

// --- Emergency -------------------------------------------------------------
const EMERGENCY_TEXT = [
  /\bemergencia\b/,
  /\burgente\b/,
  /\bevento\b/,
  /\bespecial\b/,
  /\bpost urgente\b/,
  /\bnecesito un post\b/,
  /\bquiero publicar algo\b/,
  /\bemergency\b/,
];
// "ya" and "ahora" are only emergency when they appear as the dominant intent,
// not buried in a longer sentence. Match them only when the message is short.
const EMERGENCY_SHORT = [
  /^ya$/,
  /^ahora$/,
  /^ya\b/,
  /^ahora\b/,
];

// --- FAQ -------------------------------------------------------------------
// Uses accent-stripped text.
const FAQ_TEXT = [
  /\bcuanto cuesta\b/,
  /\bprecio\b/,
  /\bcomo funciona\b/,
  /\bque incluye\b/,
  /\bcuantos posts\b/,
  /\bcomo cancelo\b/,
  /\bhow much\b/,
  /\bhow does it work\b/,
];

// --- Greeting --------------------------------------------------------------
// Uses accent-stripped text.
const GREETING_TEXT = [
  /\bhola\b/,
  /\bhey\b/,
  /\bbuenos dias\b/,
  /\bbuenas tardes\b/,
  /\bbuenas noches\b/,
  /\bque tal\b/,
  /\bcomo estas\b/,
  /\bhi\b/,
  /\bhello\b/,
  /\bwhat'?s up\b/,
];

// ---------------------------------------------------------------------------
// Regex matcher helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if any pattern in the array matches the text.
 */
function matchesAny(text, patterns) {
  return patterns.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Core regex classification
// ---------------------------------------------------------------------------

/**
 * Attempt to classify intent using regex patterns.
 * Returns the result object or null if no match.
 *
 * Two text variants are used:
 *   - `normalised` — lowercased, trimmed (preserves accents + emojis)
 *   - `stripped`   — normalised + accents removed (for \b word-boundary matching)
 *
 * Emoji patterns run against `normalised` (accents don't matter for emoji).
 * Text patterns run against `stripped` so \b works with Spanish words.
 * Rejection-negation runs against `stripped` since the phrases are all ASCII
 * after stripping.
 *
 * @param {string} normalised - already normalised text (with accents)
 * @param {string} stripped   - normalised + accent-stripped text
 * @returns {{ intent: string, confidence: string, method: string } | null}
 */
function classifyWithRegex(normalised, stripped) {
  // 1. Cancel (highest priority — must beat approval)
  if (matchesAny(stripped, CANCEL_TEXT) || matchesAny(stripped, CANCEL_EXACT)) {
    return { intent: 'cancel', confidence: 'high', method: 'regex' };
  }

  // 2. Rejection negation phrases (before approval to prevent "no me gusta"
  //    from matching the "me gusta" approval pattern)
  if (matchesAny(stripped, REJECTION_NEGATION)) {
    return { intent: 'rejection', confidence: 'high', method: 'regex' };
  }

  // 3. Approval
  if (matchesAny(stripped, APPROVAL_TEXT) || APPROVAL_EMOJI.test(normalised)) {
    return { intent: 'approval', confidence: 'high', method: 'regex' };
  }

  // 4. Rejection (remaining patterns, bare "no", emoji)
  if (
    matchesAny(stripped, REJECTION_TEXT) ||
    REJECTION_BARE_NO.test(stripped) ||
    REJECTION_EMOJI.test(normalised)
  ) {
    return { intent: 'rejection', confidence: 'high', method: 'regex' };
  }

  // 5. Escalation
  if (matchesAny(stripped, ESCALATION_TEXT)) {
    return { intent: 'escalation', confidence: 'high', method: 'regex' };
  }

  // 6. Emergency
  if (matchesAny(stripped, EMERGENCY_TEXT)) {
    return { intent: 'emergency', confidence: 'high', method: 'regex' };
  }
  // Short-form emergency ("ya", "ahora") only in brief messages (≤ 20 chars)
  if (stripped.length <= 20 && matchesAny(stripped, EMERGENCY_SHORT)) {
    return { intent: 'emergency', confidence: 'low', method: 'regex' };
  }

  // 7. FAQ
  if (matchesAny(stripped, FAQ_TEXT)) {
    return { intent: 'faq', confidence: 'high', method: 'regex' };
  }

  // 8. Greeting
  if (matchesAny(stripped, GREETING_TEXT)) {
    return { intent: 'greeting', confidence: 'high', method: 'regex' };
  }

  // No regex match
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the intent of an incoming message.
 *
 * Strategy:
 *   1. Normalise text
 *   2. Try regex patterns (< 100ms, no network)
 *   3. If regex fails → call Claude API (10s timeout)
 *   4. If Claude fails → return { intent: 'other', confidence: 'low', method: 'claude_fallback' }
 *
 * @param {string}  text              - raw message text
 * @param {object}  [context={}]      - conversation context (passed to Claude)
 * @returns {Promise<{ intent: string, confidence: string, method: string }>}
 */
export async function classifyIntent(text, context = {}) {
  const normalised = normalizeText(text);

  // Empty / non-string input
  if (!normalised) {
    return { intent: 'other', confidence: 'low', method: 'regex' };
  }

  const stripped = stripAccents(normalised);

  // --- Step 1: Regex (fast path) -------------------------------------------
  const regexResult = classifyWithRegex(normalised, stripped);
  if (regexResult) {
    return regexResult;
  }

  // --- Step 2: Claude API (slow path, 10s timeout) -------------------------
  try {
    const claudeResult = await classifyWithClaude(normalised, context);

    // Validate Claude response shape
    if (
      claudeResult &&
      typeof claudeResult.intent === 'string' &&
      typeof claudeResult.confidence === 'string'
    ) {
      return {
        intent:     claudeResult.intent,
        confidence: claudeResult.confidence,
        method:     'claude',
      };
    }

    // Malformed Claude response
    console.error('[bot:classifier] Malformed Claude response:', claudeResult);
    return { intent: 'other', confidence: 'low', method: 'claude_fallback' };
  } catch (err) {
    console.error('[bot:classifier] Claude classification failed:', err.message ?? err);
    return { intent: 'other', confidence: 'low', method: 'claude_fallback' };
  }
}
