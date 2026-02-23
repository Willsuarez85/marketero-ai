// ---------------------------------------------------------------------------
// src/bot/handlers/emergency.js  --  Emergency post conversation flow
// ---------------------------------------------------------------------------
// Multi-step flow to collect emergency post details from the client:
//   Step 0: Initial prompt (already sent by handleEmergency in conversation.js)
//   Step 1: Client describes topic → ask for price/schedule
//   Step 2: Client gives details → ask for photo
//   Step 3: Client sends photo or "no" → generate content
// ---------------------------------------------------------------------------

import { setConversationState, clearConversationState } from '../../db/queries/conversation.js';
import { generateEmergencyContent } from '../../content/emergency.js';

// Conversation flow expires after 30 minutes
const EMERGENCY_FLOW_EXPIRY_MINUTES = 30;

// ---------------------------------------------------------------------------
// Main step handler
// ---------------------------------------------------------------------------

/**
 * Handles each step of the emergency post conversation flow.
 *
 * @param {object} restaurant - The restaurant record.
 * @param {object} conversationState - Current flow state from DB.
 * @param {object} messageData - { message, mediaUrl, mediaType, contactId }
 * @returns {Promise<{ action: string, response: string }>}
 */
export async function handleEmergencyStep(restaurant, conversationState, messageData) {
  const { flow_step, flow_data = {} } = conversationState;
  const message = messageData.message || '';

  try {
    // Check expiry
    if (conversationState.expires_at && new Date(conversationState.expires_at) < new Date()) {
      await clearConversationState(restaurant.id);
      return {
        action: 'emergency_expired',
        response: 'La solicitud expiro. Dime nuevamente que quieres publicar.',
      };
    }

    switch (flow_step) {
      // Step 0: We already asked "De que se trata?" — waiting for topic
      case 0:
        return await handleTopicStep(restaurant, message, flow_data);

      // Step 1: We asked for price/schedule — waiting for details
      case 1:
        return await handleDetailsStep(restaurant, message, flow_data);

      // Step 2: We asked for photo — waiting for photo or "no"
      case 2:
        return await handlePhotoStep(restaurant, messageData, flow_data);

      default:
        await clearConversationState(restaurant.id);
        return {
          action: 'emergency_error',
          response: 'Algo salio mal. Dime otra vez que quieres publicar.',
        };
    }
  } catch (err) {
    console.error('[emergency:handler] Error in handleEmergencyStep:', err.message);
    await clearConversationState(restaurant.id);
    return {
      action: 'error',
      response: 'Estamos teniendo un problema tecnico, te contactamos pronto.',
    };
  }
}

// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------

/**
 * Step 0 → 1: Client describes the topic.
 */
async function handleTopicStep(restaurant, message, flowData) {
  const updatedData = {
    ...flowData,
    topic: message,
    collected_at: new Date().toISOString(),
  };

  await setConversationState(restaurant.id, 'emergency_post', 1, updatedData, EMERGENCY_FLOW_EXPIRY_MINUTES);

  return {
    action: 'emergency_step_1',
    response: 'Perfecto. Cual es el precio? O el horario? (Si no aplica, responde "listo")',
  };
}

/**
 * Step 1 → 2: Client provides price/schedule details.
 */
async function handleDetailsStep(restaurant, message, flowData) {
  const skipWords = ['listo', 'no', 'nada', 'no aplica', 'siguiente', 'skip'];
  const isSkip = skipWords.some(w => message.toLowerCase().trim().includes(w));

  const updatedData = {
    ...flowData,
    priceOrSchedule: isSkip ? null : message,
  };

  await setConversationState(restaurant.id, 'emergency_post', 2, updatedData, EMERGENCY_FLOW_EXPIRY_MINUTES);

  return {
    action: 'emergency_step_2',
    response: 'Tienes una foto para este post? Enviala ahora, o responde NO para usar imagen generada.',
  };
}

/**
 * Step 2 → generate: Client sends photo or declines.
 */
async function handlePhotoStep(restaurant, messageData, flowData) {
  const message = (messageData.message || '').toLowerCase().trim();
  const hasPhoto = messageData.mediaType === 'image' && messageData.mediaUrl;

  const updatedData = {
    ...flowData,
    photoUrl: hasPhoto ? messageData.mediaUrl : null,
  };

  // Clear conversation state — flow is complete
  await clearConversationState(restaurant.id);

  // Generate emergency content
  console.log(`[emergency:handler] Generating emergency content for ${restaurant.name || restaurant.id}`);

  const result = await generateEmergencyContent(restaurant.id, updatedData);

  if (result.success) {
    return {
      action: 'emergency_generating',
      response: 'Estamos creando tu post de emergencia. Te lo mandamos en unos minutos para que lo apruebes.',
    };
  }

  return {
    action: 'emergency_failed',
    response: 'Hubo un problema creando el post. Nuestro equipo lo revisara y te contactamos pronto.',
  };
}
