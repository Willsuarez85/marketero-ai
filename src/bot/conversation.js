// ---------------------------------------------------------------------------
// src/bot/conversation.js  --  Conversation Router
// ---------------------------------------------------------------------------
// Takes a classified intent and routes it to the appropriate handler,
// managing conversation state throughout the exchange.
// ---------------------------------------------------------------------------

import { getConversationState, setConversationState, clearConversationState } from '../db/queries/conversation.js';
import { getPendingApproval, updateContentStatus, getContentByStatus } from '../db/queries/content.js';
import { schedulePublishBuffer } from '../content/publish.js';
import { logMemory } from '../db/queries/memory.js';
import { handleOnboardingStep, startSession, shouldStartOnboarding, getNextSessionNumber } from '../onboarding/sessions.js';
import { handleEmergencyStep } from './handlers/emergency.js';
import { handleFaqIntent } from './handlers/faq.js';
import { handleEscalationFull, handleBotFailureEscalation } from './handlers/escalation.js';

// ---------------------------------------------------------------------------
// Flow handler stub — actual flow handlers are built in later days
// ---------------------------------------------------------------------------

/**
 * Routes active conversation flows to the appropriate handler.
 * @param {object} restaurant       - The restaurant record.
 * @param {object} conversationState - The active conversation state from DB.
 * @param {object} messageData      - { message, mediaUrl, mediaType, contactId, ghlEventId }
 * @returns {Promise<{ action: string, response: string }>}
 */
export async function handleFlowStep(restaurant, conversationState, messageData) {
  if (conversationState.current_flow === 'onboarding') {
    return handleOnboardingStep(restaurant, conversationState, messageData);
  }

  if (conversationState.current_flow === 'emergency_post') {
    return handleEmergencyStep(restaurant, conversationState, messageData);
  }

  // Other flows — stub for future phases
  return { action: 'flow_continue', response: 'Procesando...' };
}

// ---------------------------------------------------------------------------
// Intent handlers — each wrapped in its own try-catch
// ---------------------------------------------------------------------------

/**
 * Handle approval intent — approve the most recent pending content.
 */
async function handleApproval(restaurant) {
  try {
    const pending = await getPendingApproval(restaurant.id);

    if (!pending) {
      return { action: 'no_pending', response: 'No tienes ning\u00fan post pendiente de aprobaci\u00f3n en este momento.' };
    }

    await updateContentStatus(pending.id, 'approved', {
      client_approved_at: new Date().toISOString(),
    });

    // Schedule the publish buffer so the post goes live after the delay
    await schedulePublishBuffer(pending.id, restaurant.id);

    // Log memory
    logMemory(restaurant.id, 'approval', 'Post aprobado por cliente', { contentId: pending.id }).catch(() => {});

    return {
      action: 'approval_accepted',
      contentId: pending.id,
      response: '\u00a1Perfecto! Tu post ser\u00e1 publicado en 15 minutos. Si cambias de opini\u00f3n, responde CANCELAR.',
    };
  } catch (err) {
    console.error('[bot:conversation] Error in handleApproval:', err.message);
    return { action: 'error', response: 'Estamos teniendo un problema t\u00e9cnico, te contactamos pronto.' };
  }
}

/**
 * Handle rejection intent — send pending content back to regeneration.
 */
async function handleRejection(restaurant) {
  try {
    const pending = await getPendingApproval(restaurant.id);

    if (!pending) {
      return { action: 'no_pending', response: 'No tienes ning\u00fan post pendiente.' };
    }

    await updateContentStatus(pending.id, 'generating');

    // Log memory
    logMemory(restaurant.id, 'rejection', 'Post rechazado por cliente', { contentId: pending.id }).catch(() => {});

    return {
      action: 'rejection_accepted',
      contentId: pending.id,
      response: 'Entendido, vamos a crear algo nuevo para ti. \u00bfTienes alguna sugerencia de qu\u00e9 te gustar\u00eda?',
    };
  } catch (err) {
    console.error('[bot:conversation] Error in handleRejection:', err.message);
    return { action: 'error', response: 'Estamos teniendo un problema t\u00e9cnico, te contactamos pronto.' };
  }
}

/**
 * Handle cancel intent — cancel an approved-but-not-yet-published post.
 * Also clears any active conversation flow.
 */
async function handleCancel(restaurant) {
  try {
    // Clear any active conversation flow
    await clearConversationState(restaurant.id);

    // Look for approved content that hasn't been published yet
    const approvedItems = await getContentByStatus('approved');
    const restaurantApproved = approvedItems.find((item) => item.restaurant_id === restaurant.id);

    if (!restaurantApproved) {
      return { action: 'no_pending', response: 'No tienes ning\u00fan post pendiente.' };
    }

    // Check if publish deadline has passed
    if (restaurantApproved.publish_deadline && new Date(restaurantApproved.publish_deadline) < new Date()) {
      return { action: 'too_late', response: 'Lo siento, el post ya fue publicado.' };
    }

    await updateContentStatus(restaurantApproved.id, 'cancelled');

    return { action: 'cancelled', response: 'Listo, cancelamos la publicaci\u00f3n.' };
  } catch (err) {
    console.error('[bot:conversation] Error in handleCancel:', err.message);
    return { action: 'error', response: 'Estamos teniendo un problema t\u00e9cnico, te contactamos pronto.' };
  }
}

/**
 * Handle escalation intent — full escalation with operator notification.
 */
async function handleEscalation(restaurant, messageData) {
  return handleEscalationFull(restaurant, messageData, 'user_requested');
}

/**
 * Handle emergency intent — start an emergency post flow.
 */
async function handleEmergency(restaurant) {
  try {
    await setConversationState(restaurant.id, 'emergency_post', 0, {});
    return {
      action: 'emergency_started',
      response: '\u00a1Post de emergencia! \u00bfDe qu\u00e9 se trata? Describe lo que quieres publicar.',
    };
  } catch (err) {
    console.error('[bot:conversation] Error in handleEmergency:', err.message);
    return { action: 'error', response: 'Estamos teniendo un problema t\u00e9cnico, te contactamos pronto.' };
  }
}

/**
 * Handle greeting intent.
 */
function handleGreeting() {
  return { action: 'greeting', response: '\u00a1Hola! \ud83d\udc4b Soy el asistente de Marketero AI. \u00bfEn qu\u00e9 te puedo ayudar?' };
}

/**
 * Handle FAQ intent — delegates to the full FAQ handler.
 */
async function handleFaq(restaurant, messageData) {
  return handleFaqIntent(restaurant, messageData);
}

/**
 * Handle change_request intent.
 */
function handleChangeRequest() {
  return { action: 'change_request', response: 'Entendido. \u00bfQu\u00e9 cambios te gustar\u00eda hacer?' };
}

/**
 * Handle unrecognized / other intent — tracks consecutive failures for auto-escalation.
 */
async function handleOther(restaurant, messageData) {
  // Check if we should auto-escalate after consecutive failures
  const conversationState = await getConversationState(restaurant.id);
  if (conversationState?.current_flow === 'bot_confusion') {
    const result = await handleBotFailureEscalation(restaurant, messageData, conversationState);
    if (result) return result;
  }

  // First unrecognized message — track it
  const escalationResult = await handleBotFailureEscalation(restaurant, messageData, null);
  if (escalationResult) return escalationResult;

  // Fallback if escalation tracking fails
  return {
    action: 'unrecognized',
    response: 'No entendi tu mensaje. Puedes responder SI para aprobar un post, NO para rechazarlo, o AYUDA si necesitas hablar con alguien.',
  };
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

/**
 * Routes an incoming message to the appropriate handler based on the
 * classified intent and current conversation state.
 *
 * @param {object} restaurant  - The restaurant record from the database.
 * @param {object} messageData - { message, mediaUrl, mediaType, contactId, ghlEventId }
 * @param {object} intent      - { intent, confidence, method } from the classifier.
 * @returns {Promise<{ action: string, response: string|null, contentId?: string }>}
 */
export async function routeMessage(restaurant, messageData, intent) {
  try {
    // 1. Check for active conversation flow first
    const conversationState = await getConversationState(restaurant.id);

    if (conversationState) {
      // Escalation and cancel ALWAYS override an active flow
      if (intent.intent === 'escalation') {
        return await handleEscalation(restaurant, messageData);
      }
      if (intent.intent === 'cancel') {
        return await handleCancel(restaurant);
      }

      // Delegate to the active flow handler
      return await handleFlowStep(restaurant, conversationState, messageData);
    }

    // 2. Check if restaurant needs onboarding
    if (shouldStartOnboarding(restaurant)) {
      // "SEGUIR" or any message starts/continues onboarding
      const brain = restaurant.brain || null;
      const nextSession = getNextSessionNumber(brain);
      return startSession(restaurant, nextSession);
    }

    // 3. Route by intent
    switch (intent.intent) {
      case 'approval':
        return await handleApproval(restaurant);

      case 'rejection':
        return await handleRejection(restaurant);

      case 'cancel':
        return await handleCancel(restaurant);

      case 'escalation':
        return await handleEscalation(restaurant, messageData);

      case 'emergency':
        return await handleEmergency(restaurant);

      case 'greeting':
        return handleGreeting();

      case 'faq':
        return await handleFaq(restaurant, messageData);

      case 'change_request':
        return handleChangeRequest();

      case 'other':
      default:
        return await handleOther(restaurant, messageData);
    }
  } catch (err) {
    console.error('[bot:conversation] Unexpected error in routeMessage:', err.message);
    return { action: 'error', response: 'Estamos teniendo un problema t\u00e9cnico, te contactamos pronto.' };
  }
}
