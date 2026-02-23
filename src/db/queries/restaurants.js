import { supabase } from '../client.js';

/**
 * Finds a restaurant by the owner's or authorized contact's phone number.
 * First checks the authorized_contacts table, then falls back to restaurants.phone_owner.
 * @param {string} phone - The phone number to search for.
 * @returns {Promise<object|null>} The restaurant record, or null if not found.
 */
export async function findRestaurantByPhone(phone) {
  try {
    // First, check authorized_contacts
    const { data: contact, error: contactError } = await supabase
      .from('authorized_contacts')
      .select('restaurant_id')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (contactError) {
      console.error('[db:authorized_contacts] Error looking up contact by phone:', contactError.message);
    }

    if (contact?.restaurant_id) {
      const { data: restaurant, error: restError } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', contact.restaurant_id)
        .single();

      if (restError) {
        console.error('[db:restaurants] Error fetching restaurant by contact:', restError.message);
        return null;
      }

      return restaurant;
    }

    // Fallback: check restaurants.phone_owner
    const { data: restaurant, error: restError } = await supabase
      .from('restaurants')
      .select('*')
      .eq('phone_owner', phone)
      .limit(1)
      .maybeSingle();

    if (restError) {
      console.error('[db:restaurants] Error looking up restaurant by phone_owner:', restError.message);
      return null;
    }

    return restaurant || null;
  } catch (err) {
    console.error('[db:restaurants] Exception in findRestaurantByPhone:', err.message);
    return null;
  }
}

/**
 * Finds a restaurant by its primary key ID.
 * @param {string} id - The UUID of the restaurant.
 * @returns {Promise<object|null>} The restaurant record, or null if not found.
 */
export async function findRestaurantById(id) {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[db:restaurants] Error in findRestaurantById:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:restaurants] Exception in findRestaurantById:', err.message);
    return null;
  }
}

/**
 * Fetches a restaurant along with its associated client brain data.
 * @param {string} restaurantId - The UUID of the restaurant.
 * @returns {Promise<object|null>} An object with restaurant fields and a nested `brain` property, or null on failure.
 */
export async function getRestaurantWithBrain(restaurantId) {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*, client_brains(*)')
      .eq('id', restaurantId)
      .single();

    if (error) {
      console.error('[db:restaurants] Error in getRestaurantWithBrain:', error.message);
      return null;
    }

    if (!data) return null;

    const { client_brains, ...restaurant } = data;
    return {
      ...restaurant,
      brain: client_brains || null,
    };
  } catch (err) {
    console.error('[db:restaurants] Exception in getRestaurantWithBrain:', err.message);
    return null;
  }
}

/**
 * Updates the status field of a restaurant.
 * @param {string} id - The UUID of the restaurant.
 * @param {string} status - The new status value.
 * @returns {Promise<object|null>} The updated restaurant record, or null on failure.
 */
export async function updateRestaurantStatus(id, status) {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[db:restaurants] Error in updateRestaurantStatus:', error.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[db:restaurants] Exception in updateRestaurantStatus:', err.message);
    return null;
  }
}

/**
 * Creates a new restaurant record.
 * @param {object} data - The fields for the new restaurant.
 * @returns {Promise<object|null>} The created restaurant record, or null on failure.
 */
/**
 * Returns all restaurants with status 'active'.
 * @returns {Promise<object[]>} Array of active restaurant records, or empty array on failure.
 */
export async function getActiveRestaurants() {
  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('[db:restaurants] Error in getActiveRestaurants:', error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('[db:restaurants] Exception in getActiveRestaurants:', err.message);
    return [];
  }
}

export async function createRestaurant(data) {
  try {
    const { data: created, error } = await supabase
      .from('restaurants')
      .insert(data)
      .select()
      .single();

    if (error) {
      console.error('[db:restaurants] Error in createRestaurant:', error.message);
      return null;
    }

    return created;
  } catch (err) {
    console.error('[db:restaurants] Exception in createRestaurant:', err.message);
    return null;
  }
}
