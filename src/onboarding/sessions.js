// ---------------------------------------------------------------------------
// src/onboarding/sessions.js  --  Micro-session onboarding flow
// ---------------------------------------------------------------------------
// 4 sessions × ~5 min each, spread over 3-4 days.
// Uses conversation_state for in-session tracking and
// client_brains.onboarding_session as the durable cross-session counter.
// ---------------------------------------------------------------------------

import { setConversationState, advanceConversationStep, clearConversationState } from '../db/queries/conversation.js';
import { updateBrain, incrementOnboardingSession } from '../db/queries/brains.js';
import { updateRestaurantStatus } from '../db/queries/restaurants.js';
import { createJob } from '../db/queries/jobs.js';
import { sendWhatsAppMessage } from '../services/ghl.js';
import { logMemory } from '../db/queries/memory.js';

// ---------------------------------------------------------------------------
// Session definitions — questions per session
// ---------------------------------------------------------------------------

const SESSIONS = {
  1: {
    name: 'Basics',
    questions: [
      { key: 'name', ask: 'Hola! Soy Marketero, tu asistente de redes sociales. Para empezar, como se llama tu restaurante?' },
      { key: 'cuisine_type', ask: 'Que tipo de comida sirven? (mexicana, salvadorena, colombiana, etc.)' },
      { key: 'menu_highlights', ask: 'Cuales son tus 3-5 platillos estrella? Los que mas pide la gente' },
      { key: 'logo_url', ask: 'Tienes logo del restaurante? Si si, mandame una foto. Si no, escribe NO y seguimos', optional: true },
    ],
  },
  2: {
    name: 'Brand Voice',
    questions: [
      { key: 'brand_voice', ask: 'Como quieres que suene tu restaurante en redes? Ejemplo: "familiar y casero" o "moderno y trendy"' },
      { key: 'dos', ask: 'Hay algo que SIEMPRE quieras mencionar en tus posts? (ej: "somos familia", "ingredientes frescos")' },
      { key: 'donts', ask: 'Hay algo que NUNCA quieras que se diga? (ej: "no mencionar precios", "no comparar con otros")' },
      { key: 'photos', ask: 'Mandame 3-5 fotos de tus mejores platillos. Estas las voy a usar para crear tus posts', optional: true },
      { key: 'brand_colors', ask: 'Cuales son los colores de tu restaurante/marca? (ej: "rojo y amarillo", "verde y blanco"). Si no tienes, escribe NO', optional: true },
    ],
  },
  3: {
    name: 'Strategy',
    questions: [
      { key: 'important_dates', ask: 'Tienes fechas importantes? (aniversario, especiales semanales, eventos). Mandame las que quieras y las agendo' },
      { key: 'monthly_goals', ask: 'Cual es tu meta principal con redes sociales? (mas clientes, mas pedidos, darte a conocer, etc.)' },
      { key: 'content_themes', ask: 'Que tipo de contenido te gustaria? Elige los que quieras:\n1. Platillos del dia\n2. Ofertas y promos\n3. Historias del equipo\n4. Detras de cocina\n5. Eventos y fechas especiales' },
      { key: 'competitor_notes', ask: 'Hay algun restaurante que admires sus redes sociales? Para inspiracion (o escribe NO)', optional: true },
    ],
  },
  4: {
    name: 'Setup & Test',
    questions: [
      { key: 'platforms', ask: 'En que plataformas publico? Confirma cuales tienes:\n1. Instagram\n2. Facebook\n3. Las dos' },
      { key: 'delivery_time', ask: 'A que hora quieres recibir tu post para aprobar? (ej: "9am", "por la manana")' },
      { key: 'test_post', ask: 'Listo! Voy a crear un post de prueba con todo lo que me diste. Dame unos minutos...' },
    ],
  },
};

const TOTAL_SESSIONS = Object.keys(SESSIONS).length;
const SESSION_EXPIRY_MINUTES = 120;

// ---------------------------------------------------------------------------
// Main router — called by conversation.js when flow === 'onboarding'
// ---------------------------------------------------------------------------

export async function handleOnboardingStep(restaurant, conversationState, messageData) {
  const flowData = conversationState.flow_data || {};
  const sessionNumber = flowData.sessionNumber || 1;
  const stepIndex = conversationState.flow_step || 0;
  const { message, mediaUrl, mediaType } = messageData;

  const session = SESSIONS[sessionNumber];
  if (!session) {
    await clearConversationState(restaurant.id);
    return { action: 'onboarding_error', response: 'Hubo un error en el onboarding. Contacta a soporte.' };
  }

  const questions = session.questions;

  // Process the response to the current question
  if (stepIndex > 0 && stepIndex <= questions.length) {
    const currentQ = questions[stepIndex - 1];
    const responseData = processResponse(currentQ.key, message, mediaUrl, mediaType);

    // Store the response in flow_data
    flowData[currentQ.key] = responseData;
  }

  // Check if session is complete
  if (stepIndex >= questions.length) {
    return completeSession(restaurant, sessionNumber, flowData);
  }

  // Ask next question
  const nextQ = questions[stepIndex];
  await advanceConversationStep(restaurant.id, stepIndex + 1, flowData);

  return { action: 'onboarding_question', response: nextQ.ask };
}

// ---------------------------------------------------------------------------
// Start a new onboarding session
// ---------------------------------------------------------------------------

export async function startSession(restaurant, sessionNumber) {
  const session = SESSIONS[sessionNumber];
  if (!session) {
    return { action: 'onboarding_complete', response: 'Tu onboarding esta completo! Ahora vamos a crear contenido increible para tu restaurante.' };
  }

  // Set conversation state for this session
  await setConversationState(
    restaurant.id,
    'onboarding',
    0,
    { sessionNumber, sessionName: session.name },
    SESSION_EXPIRY_MINUTES
  );

  const intro = sessionNumber === 1
    ? session.questions[0].ask
    : `Sesion ${sessionNumber} de ${TOTAL_SESSIONS}: ${session.name}. Vamos con unas preguntas rapidas!\n\n${session.questions[0].ask}`;

  // Advance to step 1 (waiting for first answer)
  await advanceConversationStep(restaurant.id, 1, { sessionNumber, sessionName: session.name });

  return { action: 'onboarding_session_started', response: intro };
}

// ---------------------------------------------------------------------------
// Complete a session — flush data to client_brains
// ---------------------------------------------------------------------------

async function completeSession(restaurant, sessionNumber, flowData) {
  try {
    // Map collected data to brain fields based on session
    const brainUpdate = mapSessionDataToBrain(sessionNumber, flowData);

    if (Object.keys(brainUpdate).length > 0) {
      await updateBrain(restaurant.id, brainUpdate);
      console.log(`[onboarding] Session ${sessionNumber} data saved for restaurant ${restaurant.id}`);
    }

    // Increment the durable session counter
    await incrementOnboardingSession(restaurant.id);

    // Log memory
    logMemory(restaurant.id, 'interaction', `Onboarding session ${sessionNumber} completed`, {
      session: sessionNumber,
      dataKeys: Object.keys(flowData),
    }).catch(() => {});

    // Clear conversation state
    await clearConversationState(restaurant.id);

    const nextSession = sessionNumber + 1;

    if (nextSession > TOTAL_SESSIONS) {
      // All sessions complete — activate the restaurant
      await updateRestaurantStatus(restaurant.id, 'active');

      return {
        action: 'onboarding_complete',
        response: 'Listo! Tu onboarding esta completo. Ahora si vamos a crear contenido chido para tu restaurante. Manana recibes tu primer post!',
      };
    }

    // Schedule a reminder for the next session in 48h
    const reminderTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await createJob(restaurant.id, 'reminder', reminderTime, {
      type: 'onboarding_next_session',
      nextSession,
    });

    return {
      action: 'onboarding_session_complete',
      response: `Sesion ${sessionNumber} completa! Ya guarde toda tu info. La siguiente sesion la hacemos manana o cuando tu quieras. Escribe SEGUIR cuando estes listo.`,
    };
  } catch (err) {
    console.error(`[onboarding] Error completing session ${sessionNumber}:`, err.message);
    return { action: 'error', response: 'Estamos teniendo un problema tecnico, te contactamos pronto.' };
  }
}

// ---------------------------------------------------------------------------
// Process a response based on question key
// ---------------------------------------------------------------------------

function processResponse(key, message, mediaUrl, mediaType) {
  // Photo handling — store media URLs
  if (key === 'photos' || key === 'logo_url') {
    if (mediaUrl) {
      return { url: mediaUrl, type: mediaType || 'image' };
    }
    if (message?.toLowerCase() === 'no') return null;
    return message || null;
  }

  // Menu highlights — split into array
  if (key === 'menu_highlights') {
    if (!message) return [];
    return message.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  }

  // Content themes — parse numbered selection
  if (key === 'content_themes') {
    if (!message) return [];
    const themeMap = {
      '1': 'platillos_del_dia',
      '2': 'ofertas_promos',
      '3': 'historias_equipo',
      '4': 'detras_de_cocina',
      '5': 'eventos_fechas',
    };
    const numbers = message.match(/[1-5]/g) || [];
    return numbers.map(n => themeMap[n]).filter(Boolean);
  }

  // Platforms — parse selection
  if (key === 'platforms') {
    if (!message) return ['instagram', 'facebook'];
    const lower = message.toLowerCase();
    if (lower.includes('3') || lower.includes('dos') || lower.includes('las dos') || lower.includes('ambas')) {
      return ['instagram', 'facebook'];
    }
    if (lower.includes('1') || lower.includes('insta')) return ['instagram'];
    if (lower.includes('2') || lower.includes('face')) return ['facebook'];
    return ['instagram', 'facebook'];
  }

  // Important dates — try to parse structured dates
  if (key === 'important_dates') {
    if (!message || message.toLowerCase() === 'no') return [];
    // Store raw text for now — operator can refine later
    return [{ name: message, date: null, raw: true }];
  }

  // Brand colors — parse into structured format
  if (key === 'brand_colors') {
    if (!message || message.toLowerCase() === 'no') return {};
    return { raw: message };
  }

  // Dos / donts — split into array
  if (key === 'dos' || key === 'donts') {
    if (!message || message.toLowerCase() === 'no') return [];
    return message.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  }

  // Default — return raw text
  if (!message || message.toLowerCase() === 'no') return null;
  return message;
}

// ---------------------------------------------------------------------------
// Map session flow_data to client_brains fields
// ---------------------------------------------------------------------------

function mapSessionDataToBrain(sessionNumber, data) {
  const update = {};

  switch (sessionNumber) {
    case 1:
      if (data.menu_highlights) update.menu_items = data.menu_highlights;
      if (data.logo_url?.url) update.logo_url = data.logo_url.url;
      break;

    case 2:
      if (data.brand_voice) update.brand_voice = data.brand_voice;
      if (data.dos || data.donts) {
        update.dos_and_donts = {
          dos: Array.isArray(data.dos) ? data.dos : [],
          donts: Array.isArray(data.donts) ? data.donts : [],
        };
      }
      if (data.photos?.url) {
        update.photo_library = [{ url: data.photos.url, approved: true, source: 'onboarding' }];
      }
      if (data.brand_colors && typeof data.brand_colors === 'object') {
        update.brand_colors = data.brand_colors;
      }
      break;

    case 3:
      if (data.important_dates) update.important_dates = data.important_dates;
      if (data.monthly_goals) update.monthly_goals = data.monthly_goals;
      if (data.content_themes) update.content_themes = data.content_themes;
      if (data.competitor_notes) update.competitor_notes = data.competitor_notes;
      break;

    case 4:
      if (data.delivery_time) {
        update.onboarding_notes = `Preferred delivery time: ${data.delivery_time}`;
      }
      break;
  }

  return update;
}

// ---------------------------------------------------------------------------
// Check if a restaurant needs to start/continue onboarding
// ---------------------------------------------------------------------------

export function shouldStartOnboarding(restaurant) {
  return restaurant.status === 'onboarding';
}

export function getNextSessionNumber(brain) {
  return (brain?.onboarding_session || 0) + 1;
}
