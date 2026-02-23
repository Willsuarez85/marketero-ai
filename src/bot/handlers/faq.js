// ---------------------------------------------------------------------------
// src/bot/handlers/faq.js  --  FAQ Bot (top 8 questions)
// ---------------------------------------------------------------------------
// Sub-classifies FAQ intents and returns data-driven responses.
// The classifier sends `intent: 'faq'` — this handler determines
// which specific FAQ the client is asking about.
// ---------------------------------------------------------------------------

import { supabase } from '../../db/client.js';
import { activateAutopilot, deactivateAutopilot } from './autopilot.js';
import { updateRestaurantStatus } from '../../db/queries/restaurants.js';

// ---------------------------------------------------------------------------
// FAQ sub-classification patterns
// ---------------------------------------------------------------------------

const FAQ_PATTERNS = [
  {
    key: 'published',
    patterns: [/que se publico/, /que publicamos/, /esta semana/, /que salio/, /posts? de esta semana/],
  },
  {
    key: 'next_post',
    patterns: [/proximo post/, /cuando sale/, /cuando publican/, /manana sale/, /siguiente post/],
  },
  {
    key: 'autopilot_off',
    patterns: [/desactivar.*(?:automatico|autopilot)/, /quitar.*automatico/, /apagar.*automatico/],
  },
  {
    key: 'autopilot_on',
    patterns: [/\bactivar.*(?:automatico|autopilot)/, /piloto automatico.*activar/, /quiero.*automatico/],
  },
  {
    key: 'autopilot',
    patterns: [/piloto automatico/, /autopilot/, /automatico/],
  },
  {
    key: 'engagement',
    patterns: [/engagement/, /estadisticas/, /como estuvo/, /cuantos likes/, /resultados/, /rendimiento/],
  },
  {
    key: 'pause',
    patterns: [/pausar/, /pausa/, /descanso/, /pausar servicio/],
  },
  {
    key: 'change_post',
    patterns: [/cambiar el post/, /post de manana/, /cambiar manana/, /modificar post/],
  },
  {
    key: 'pricing',
    patterns: [/cuanto cuesta/, /precio/, /how much/, /cuantos posts/],
  },
  {
    key: 'how_it_works',
    patterns: [/como funciona/, /que incluye/, /how does it work/],
  },
];

/**
 * Sub-classifies a FAQ message into a specific category.
 * @param {string} message - The normalized message text.
 * @returns {string} The FAQ sub-category key.
 */
function subClassifyFaq(message) {
  const stripped = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  for (const { key, patterns } of FAQ_PATTERNS) {
    if (patterns.some(p => p.test(stripped))) {
      return key;
    }
  }

  return 'general';
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handles a FAQ intent by sub-classifying and returning the appropriate response.
 *
 * @param {object} restaurant - The restaurant record.
 * @param {object} messageData - { message, mediaUrl, mediaType, contactId }
 * @returns {Promise<{ action: string, response: string }>}
 */
export async function handleFaqIntent(restaurant, messageData) {
  const message = messageData.message || '';
  const faqType = subClassifyFaq(message);

  try {
    switch (faqType) {
      case 'published':
        return await getPublishedThisWeek(restaurant);

      case 'next_post':
        return await getNextScheduledPost(restaurant);

      case 'autopilot_on':
        return await toggleAutopilot(restaurant, true);

      case 'autopilot_off':
        return await toggleAutopilot(restaurant, false);

      case 'autopilot':
        return await autopilotStatus(restaurant);

      case 'engagement':
        return await getEngagementSummary(restaurant);

      case 'pause':
        return await handlePauseRequest(restaurant);

      case 'change_post':
        return {
          action: 'faq_change_post',
          response: 'Que cambios quieres hacer? Puedo ajustar imagen, texto o ambos.',
        };

      case 'pricing':
        return {
          action: 'faq_pricing',
          response: 'El servicio cuesta $99/mes. Incluye un post diario para Instagram y Facebook, todo manejado via WhatsApp. 30 dias de garantia.',
        };

      case 'how_it_works':
        return {
          action: 'faq_how_it_works',
          response: 'Cada dia creamos un post para tus redes. Te lo mandamos aqui para que lo apruebes, y despues lo publicamos. Facil!',
        };

      default:
        return {
          action: 'faq_general',
          response: 'No entendi bien tu pregunta. Puedes preguntar sobre: posts publicados, proximo post, piloto automatico, estadisticas, o pausar servicio.',
        };
    }
  } catch (err) {
    console.error('[faq:handler] Error handling FAQ:', err.message);
    return {
      action: 'faq_error',
      response: 'Estamos teniendo un problema tecnico, te contactamos pronto.',
    };
  }
}

// ---------------------------------------------------------------------------
// FAQ sub-handlers
// ---------------------------------------------------------------------------

/**
 * Returns posts published in the last 7 days.
 */
async function getPublishedThisWeek(restaurant) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: posts, error } = await supabase
      .from('content_items')
      .select('caption, published_at, image_url')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'published')
      .gte('published_at', weekAgo)
      .order('published_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[faq:published] Error fetching published posts:', error.message);
      return { action: 'faq_published', response: 'Hubo un error buscando tus posts. Intenta de nuevo.' };
    }

    if (!posts || posts.length === 0) {
      return { action: 'faq_published', response: 'No hay posts publicados esta semana todavia.' };
    }

    const lines = posts.map((p, i) => {
      const date = new Date(p.published_at).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
      const caption = (p.caption || '').substring(0, 50);
      return `${i + 1}. ${date}: "${caption}..."`;
    });

    return {
      action: 'faq_published',
      response: `Esta semana publicamos ${posts.length} post(s):\n${lines.join('\n')}`,
    };
  } catch (err) {
    console.error('[faq:published] Exception:', err.message);
    return { action: 'faq_published', response: 'Error buscando posts. Intenta de nuevo.' };
  }
}

/**
 * Returns info about the next scheduled post.
 */
async function getNextScheduledPost(restaurant) {
  try {
    const { data: job, error } = await supabase
      .from('scheduled_jobs')
      .select('scheduled_for, metadata')
      .eq('restaurant_id', restaurant.id)
      .eq('job_type', 'daily_content')
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[faq:next_post] Error fetching next job:', error.message);
      return { action: 'faq_next_post', response: 'Error buscando tu proximo post.' };
    }

    if (!job) {
      return { action: 'faq_next_post', response: 'No tienes un post programado todavia. Se crea uno automaticamente cada dia.' };
    }

    const dateStr = new Date(job.scheduled_for).toLocaleString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      action: 'faq_next_post',
      response: `Tu proximo post esta programado para ${dateStr}. Te lo mandamos para que lo apruebes antes de publicar.`,
    };
  } catch (err) {
    console.error('[faq:next_post] Exception:', err.message);
    return { action: 'faq_next_post', response: 'Error buscando el proximo post.' };
  }
}

/**
 * Toggles autopilot mode.
 */
async function toggleAutopilot(restaurant, enable) {
  const success = enable
    ? await activateAutopilot(restaurant.id)
    : await deactivateAutopilot(restaurant.id);

  if (!success) {
    return { action: 'faq_autopilot', response: 'Hubo un problema. Intenta de nuevo.' };
  }

  return {
    action: 'faq_autopilot',
    response: enable
      ? 'Listo! Piloto automatico activado. Si no respondes en 2 horas, tus posts se publicaran solos.'
      : 'Piloto automatico desactivado. Ahora necesitas aprobar cada post antes de publicar.',
  };
}

/**
 * Returns current autopilot status.
 */
async function autopilotStatus(restaurant) {
  const status = restaurant.autopilot ? 'activado' : 'desactivado';
  return {
    action: 'faq_autopilot',
    response: `Tu piloto automatico esta ${status}. Responde "activar automatico" o "desactivar automatico" para cambiarlo.`,
  };
}

/**
 * Returns engagement summary for the last 7 days.
 */
async function getEngagementSummary(restaurant) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: posts, error } = await supabase
      .from('content_items')
      .select('engagement')
      .eq('restaurant_id', restaurant.id)
      .eq('status', 'published')
      .gte('published_at', weekAgo);

    if (error) {
      console.error('[faq:engagement] Error fetching engagement:', error.message);
      return { action: 'faq_engagement', response: 'Error buscando estadisticas.' };
    }

    if (!posts || posts.length === 0) {
      return { action: 'faq_engagement', response: 'Todavia no hay datos de engagement esta semana.' };
    }

    // Aggregate engagement across all posts
    let totalLikes = 0;
    let totalComments = 0;
    let totalReach = 0;

    for (const post of posts) {
      const eng = post.engagement || {};
      totalLikes += eng.likes || 0;
      totalComments += eng.comments || 0;
      totalReach += eng.reach || 0;
    }

    const parts = [`Esta semana (${posts.length} posts):`];
    if (totalLikes > 0) parts.push(`${totalLikes} likes`);
    if (totalComments > 0) parts.push(`${totalComments} comentarios`);
    if (totalReach > 0) parts.push(`${totalReach} alcance`);

    if (parts.length === 1) {
      return { action: 'faq_engagement', response: 'Estamos recopilando datos de engagement. Te mandamos el reporte completo el viernes.' };
    }

    return {
      action: 'faq_engagement',
      response: parts.join('\n'),
    };
  } catch (err) {
    console.error('[faq:engagement] Exception:', err.message);
    return { action: 'faq_engagement', response: 'Error buscando estadisticas.' };
  }
}

/**
 * Handles pause service request.
 */
async function handlePauseRequest(restaurant) {
  try {
    await updateRestaurantStatus(restaurant.id, 'paused');

    return {
      action: 'faq_pause',
      response: 'Tu servicio esta en pausa. No se publicaran posts hasta que lo reactives. Escribe "reactivar" cuando estes listo.',
    };
  } catch (err) {
    console.error('[faq:pause] Exception:', err.message);
    return { action: 'faq_pause', response: 'Hubo un problema pausando el servicio. Intenta de nuevo.' };
  }
}
