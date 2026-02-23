// ---------------------------------------------------------------------------
// src/services/whisper.js  --  OpenAI Whisper transcription for voice notes
// ---------------------------------------------------------------------------
// Downloads audio from a URL, sends to Whisper API with language='es'.
// Returns { text, language } on success, null on failure.
// 30-second timeout, 1 retry on failure.
// ---------------------------------------------------------------------------

import OpenAI from 'openai';

const openai = new OpenAI(); // reads OPENAI_API_KEY from env automatically

const WHISPER_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Download audio from URL → Buffer
// ---------------------------------------------------------------------------

async function downloadAudio(audioUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);

  try {
    const response = await fetch(audioUrl, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Transcribe audio buffer via Whisper API
// ---------------------------------------------------------------------------

async function transcribeBuffer(buffer, filename = 'audio.ogg') {
  const file = new File([buffer], filename, { type: 'audio/ogg' });

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'es',
  });

  return response.text || null;
}

// ---------------------------------------------------------------------------
// Public API — transcribe audio from URL (with 1 retry)
// ---------------------------------------------------------------------------

export async function transcribeAudio(audioUrl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      console.log(`[services:whisper] Transcribing audio (attempt ${attempt + 1}): ${audioUrl}`);

      const buffer = await downloadAudio(audioUrl);

      if (!buffer || buffer.length === 0) {
        console.error('[services:whisper] Downloaded audio is empty');
        return null;
      }

      // Guess filename from URL extension
      const urlPath = new URL(audioUrl).pathname;
      const ext = urlPath.split('.').pop()?.toLowerCase() || 'ogg';
      const filename = `voice.${ext}`;

      const text = await transcribeBuffer(buffer, filename);

      if (text) {
        console.log(`[services:whisper] Transcription successful: "${text.substring(0, 80)}..."`);
        return { text, language: 'es' };
      }

      console.warn('[services:whisper] Whisper returned empty text');
      return null;
    } catch (err) {
      console.error(`[services:whisper] Attempt ${attempt + 1} failed:`, err.message);

      if (attempt === 0) {
        // Wait 1 second before retry
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      return null;
    }
  }

  return null;
}
