import { supabase } from '../client.js';

/**
 * Creates a new scheduled job.
 * @param {string} restaurantId - The UUID of the restaurant this job belongs to.
 * @param {string} jobType - The type/category of the job.
 * @param {string} scheduledFor - ISO 8601 timestamp for when the job should be executed.
 * @param {object} [metadata={}] - Optional metadata to attach to the job.
 * @returns {Promise<object|null>} The created job record, or null on failure.
 */
export async function createJob(restaurantId, jobType, scheduledFor, metadata = {}) {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .insert({
        restaurant_id: restaurantId,
        job_type: jobType,
        scheduled_for: scheduledFor,
        metadata,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('[db:jobs] Error in createJob:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:jobs] Exception in createJob:', err.message);
    return null;
  }
}

/**
 * Retrieves pending jobs that are due for execution (scheduled_for <= now).
 * @param {number} [limit=10] - Maximum number of jobs to return.
 * @returns {Promise<object[]>} An array of pending job records, or empty array on failure.
 */
export async function getPendingJobs(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('[db:jobs] Error in getPendingJobs:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:jobs] Exception in getPendingJobs:', err.message);
    return [];
  }
}

/**
 * Attempts to claim a pending job for processing using optimistic locking.
 * Only succeeds if the job's current status is 'pending'.
 * @param {string} id - The UUID of the job to claim.
 * @returns {Promise<object|null>} The claimed job record, or null if already claimed or not found.
 */
export async function claimJob(id) {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .update({ status: 'processing' })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (error) {
      console.error('[db:jobs] Error in claimJob:', error.message);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('[db:jobs] Exception in claimJob:', err.message);
    return null;
  }
}

/**
 * Marks a job as completed with a completion timestamp.
 * @param {string} id - The UUID of the job.
 * @returns {Promise<object|null>} The updated job record, or null on failure.
 */
export async function completeJob(id) {
  try {
    const { data, error } = await supabase
      .from('scheduled_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:jobs] Error in completeJob:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:jobs] Exception in completeJob:', err.message);
    return null;
  }
}

/**
 * Handles a failed job. If attempts >= 3, marks as permanently 'failed'.
 * Otherwise, resets status to 'pending' for retry.
 * @param {string} id - The UUID of the job.
 * @param {string} errorMessage - A description of the error that occurred.
 * @param {number} attempts - The current number of processing attempts.
 * @returns {Promise<object|null>} The updated job record, or null on failure.
 */
export async function failJob(id, errorMessage, attempts) {
  try {
    const status = attempts >= 3 ? 'failed' : 'pending';

    const { data, error } = await supabase
      .from('scheduled_jobs')
      .update({
        status,
        last_error: errorMessage,
        attempts,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:jobs] Error in failJob:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:jobs] Exception in failJob:', err.message);
    return null;
  }
}
