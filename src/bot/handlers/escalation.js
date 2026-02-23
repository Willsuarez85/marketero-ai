// ---------------------------------------------------------------------------
// src/bot/handlers/escalation.js  --  Escalation flow
// ---------------------------------------------------------------------------
// Handles escalation to a human operator when:
//   1. Client explicitly requests a human ("hablar con alguien")
//   2. Bot fails to understand 2 consecutive messages
//   3. System error requires human intervention
// ---------------------------------------------------------------------------

import { setConversationState, clearConversationState } from '../../db/queries/conversation.js';
import { sendWhatsAppMessage } from '../../services/ghl.js';

const OPERATOR_CONTACT_ID = process.env.OPERATOR_GHL_CONTACT_ID;

// ---------------------------------------------------------------------------
// Main escalation handler
// ---------------------------------------------------------------------------

/**
 * Full escalation flow:
 *   1. Acknowledge to client
 *   2. Set conversation state to 'escalation'
 *   3. Notify operator via WhatsApp with context
 *
 * @param {object} restaurant - The restaurant record.
 * @param {object} messageData - { message, mediaUrl, mediaType, contactId }
 * @param {string} [reason='user_requested'] - Escalation reason.
 * @returns {Promise<{ action: string, response: string }>}
 */
export async function handleEscalationFull(restaurant, messageData, reason = 'user_requested') {
  try {
    // 1. Set conversation state
    await setConversationState(restaurant.id, 'escalation', 0, {
      original_message: messageData.message || '',
      escalation_type: reason,
      escalated_at: new Date().toISOString(),
    }, 120); // 2 hour expiry

    // 2. Notify operator
    await notifyOperatorEscalation(restaurant, messageData, reason);

    // 3. Acknowledge to client
    return {
      action: 'escalation',
      response: 'Entiendo. Te conectamos con nuestro equipo en los proximos 5 minutos. Espera aqui.',
    };
  } catch (err) {
    console.error('[escalation] Error in handleEscalationFull:', err.message);
    return {
      action: 'escalation',
      response: 'Te conecto con nuestro equipo. Alguien te contactara pronto.',
    };
  }
}

// ---------------------------------------------------------------------------
// Bot failure escalation
// ---------------------------------------------------------------------------

/**
 * Tracks consecutive unrecognized messages and auto-escalates after 2.
 * Uses conversation_state.flow_data.unrecognized_count to track.
 *
 * @param {object} restaurant - The restaurant record.
 * @param {object} messageData - { message, mediaUrl, mediaType, contactId }
 * @param {object|null} conversationState - Current conversation state, if any.
 * @returns {Promise<{ action: string, response: string }|null>}
 *   Returns an escalation response, a "rephrase" prompt, or null to proceed normally.
 */
export async function handleBotFailureEscalation(restaurant, messageData, conversationState) {
  try {
    const currentCount = conversationState?.flow_data?.unrecognized_count || 0;
    const newCount = currentCount + 1;

    if (newCount >= 2) {
      // Auto-escalate after 2 consecutive failures
      await clearConversationState(restaurant.id);
      return handleEscalationFull(restaurant, messageData, 'bot_failure');
    }

    // First failure: ask to rephrase and track the count
    await setConversationState(restaurant.id, 'bot_confusion', 0, {
      unrecognized_count: newCount,
      last_message: messageData.message || '',
    }, 5); // 5 min expiry — resets counter after inactivity

    return {
      action: 'unrecognized',
      response: 'No entendi bien. Me puedes explicar de otra forma?',
    };
  } catch (err) {
    console.error('[escalation] Error in handleBotFailureEscalation:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// System error escalation
// ---------------------------------------------------------------------------

/**
 * Notifies operator about a system error and offers escalation to client.
 *
 * @param {object} restaurant - The restaurant record.
 * @param {string} errorContext - Description of what failed.
 * @returns {Promise<void>}
 */
export async function notifySystemError(restaurant, errorContext) {
  try {
    if (!OPERATOR_CONTACT_ID) {
      console.warn('[escalation] No OPERATOR_GHL_CONTACT_ID set — cannot notify operator');
      return;
    }

    const msg =
      `⚠️ ERROR DE SISTEMA\n` +
      `Restaurant: ${restaurant.name || restaurant.id}\n` +
      `Error: ${errorContext}\n` +
      `Tiempo: ${new Date().toLocaleString('es-MX')}`;

    await sendWhatsAppMessage(OPERATOR_CONTACT_ID, msg);
  } catch (err) {
    console.error('[escalation] Failed to send system error notification:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends an escalation alert to the operator via WhatsApp.
 */
async function notifyOperatorEscalation(restaurant, messageData, reason) {
  if (!OPERATOR_CONTACT_ID) {
    console.warn('[escalation] No OPERATOR_GHL_CONTACT_ID set — cannot notify operator');
    return;
  }

  const reasonLabel = {
    user_requested: 'Cliente pidio hablar con alguien',
    bot_failure: 'Bot no entendio al cliente (2 intentos)',
    system_error: 'Error del sistema',
    payment_issue: 'Problema de pago',
  }[reason] || reason;

  const msg =
    `⚠️ ESCALACION RECIBIDA\n` +
    `Restaurant: ${restaurant.name || restaurant.id}\n` +
    `Razon: ${reasonLabel}\n` +
    `Mensaje: "${(messageData.message || '').substring(0, 200)}"\n` +
    `Tiempo: ${new Date().toLocaleString('es-MX')}`;

  try {
    await sendWhatsAppMessage(OPERATOR_CONTACT_ID, msg);
    console.log(`[escalation] Operator notified for restaurant ${restaurant.name || restaurant.id}`);
  } catch (err) {
    console.error('[escalation] Failed to notify operator:', err.message);
  }
}
