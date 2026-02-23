// ---------------------------------------------------------------------------
// src/bot/operator.js  --  Operator review flow via WhatsApp
// ---------------------------------------------------------------------------
// The operator (StarLord) reviews content via WhatsApp instead of a web UI.
// Messages from OPERATOR_PHONE are routed here before restaurant lookup.
// ---------------------------------------------------------------------------

import { classifyIntent } from './classifier.js';
import { getOldestHumanReview, countByStatus, updateContentStatus } from '../db/queries/content.js';
import { sendContentForApproval } from '../content/publish.js';
import { sendWhatsAppMessage, sendWhatsAppImage } from '../services/ghl.js';
import { createJob } from '../db/queries/jobs.js';

const OPERATOR_CONTACT_ID = process.env.OPERATOR_GHL_CONTACT_ID;

// ---------------------------------------------------------------------------
// Main router for operator messages
// ---------------------------------------------------------------------------

export async function handleOperatorMessage(messageData) {
  const { message } = messageData;

  if (!message) {
    await sendOperatorReply('No entendi tu mensaje. Responde DALE para aprobar o NO para rechazar el post pendiente.');
    return;
  }

  const intent = await classifyIntent(message);
  console.log(`[bot:operator] Operator intent: ${intent.intent} (${intent.method})`);

  if (intent.intent === 'approval') {
    return handleOperatorApproval();
  }

  if (intent.intent === 'rejection') {
    return handleOperatorRejection();
  }

  // Unknown operator command — show help
  const pendingCount = await countByStatus('human_review');
  if (pendingCount > 0) {
    await sendOperatorReply(`Hay ${pendingCount} post(s) pendientes de revision. Responde DALE para aprobar o NO para rechazar.`);
  } else {
    await sendOperatorReply('No hay posts pendientes de revision.');
  }
}

// ---------------------------------------------------------------------------
// Approve the oldest human_review content item
// ---------------------------------------------------------------------------

async function handleOperatorApproval() {
  const content = await getOldestHumanReview();

  if (!content) {
    await sendOperatorReply('No hay posts pendientes de revision.');
    return;
  }

  try {
    // Move from human_review → pending_client
    await updateContentStatus(content.id, 'pending_client', {
      human_approved_at: new Date().toISOString(),
    });

    // Send to restaurant client for their approval
    await sendContentForApproval(content.id);

    const remaining = await countByStatus('human_review');
    const restaurantName = content.restaurants?.name || 'restaurante';
    await sendOperatorReply(
      `Aprobado para ${restaurantName}. Enviado al cliente.` +
      (remaining > 0 ? ` Quedan ${remaining} post(s) por revisar.` : ' No quedan mas posts.')
    );
  } catch (err) {
    console.error('[bot:operator] Error in handleOperatorApproval:', err.message);
    await sendOperatorReply('Error al aprobar el post. Revisa los logs.');
  }
}

// ---------------------------------------------------------------------------
// Reject the oldest human_review content item → re-generate
// ---------------------------------------------------------------------------

async function handleOperatorRejection() {
  const content = await getOldestHumanReview();

  if (!content) {
    await sendOperatorReply('No hay posts pendientes de revision.');
    return;
  }

  try {
    // Move back to generating for re-generation
    await updateContentStatus(content.id, 'generating');

    // Schedule re-generation job
    await createJob(
      content.restaurant_id,
      'daily_content',
      new Date().toISOString(),
      { regeneration: true, previous_content_id: content.id }
    );

    const remaining = await countByStatus('human_review');
    const restaurantName = content.restaurants?.name || 'restaurante';
    await sendOperatorReply(
      `Rechazado para ${restaurantName}. Se va a regenerar.` +
      (remaining > 0 ? ` Quedan ${remaining} post(s) por revisar.` : ' No quedan mas posts.')
    );
  } catch (err) {
    console.error('[bot:operator] Error in handleOperatorRejection:', err.message);
    await sendOperatorReply('Error al rechazar el post. Revisa los logs.');
  }
}

// ---------------------------------------------------------------------------
// Notify operator when new content is ready for review
// ---------------------------------------------------------------------------

export async function notifyOperatorNewContent(contentId) {
  if (!OPERATOR_CONTACT_ID) {
    console.warn('[bot:operator] OPERATOR_GHL_CONTACT_ID not set — skipping operator notification');
    return;
  }

  try {
    // Load the content item to get caption + image
    const { supabase } = await import('../db/client.js');
    const { data: content } = await supabase
      .from('content_items')
      .select('*, restaurants(name)')
      .eq('id', contentId)
      .single();

    if (!content) {
      console.error(`[bot:operator] Content ${contentId} not found for operator notification`);
      return;
    }

    const restaurantName = content.restaurants?.name || 'restaurante';
    const pendingCount = await countByStatus('human_review');

    // Send image + caption if available
    if (content.image_url) {
      await sendWhatsAppImage(
        OPERATOR_CONTACT_ID,
        content.image_url,
        `Nuevo post para ${restaurantName}:\n\n${content.caption || '(sin caption)'}`
      );
    } else {
      await sendWhatsAppMessage(
        OPERATOR_CONTACT_ID,
        `Nuevo post para ${restaurantName}:\n\n${content.caption || '(sin caption)'}`
      );
    }

    await sendWhatsAppMessage(
      OPERATOR_CONTACT_ID,
      `Responde DALE para aprobar o NO para rechazar. (${pendingCount} en cola)`
    );
  } catch (err) {
    console.error('[bot:operator] Error in notifyOperatorNewContent:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Helper — send message to operator
// ---------------------------------------------------------------------------

async function sendOperatorReply(message) {
  if (!OPERATOR_CONTACT_ID) {
    console.warn('[bot:operator] OPERATOR_GHL_CONTACT_ID not set — cannot reply to operator');
    return;
  }
  await sendWhatsAppMessage(OPERATOR_CONTACT_ID, message);
}
