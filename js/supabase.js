import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Инициализация Supabase клиента
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

function withTimeout(promise, timeoutMs = 4500) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve({
      data: null,
      error: { message: 'REQUEST_TIMEOUT' }
    }), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

export async function fetchLaptops() {
  if (!supabaseClient) return [];

  try {
    const { data, error } = await withTimeout(supabaseClient.from('laptops').select('*'));
    if (error || !data || data.length === 0) {
      return [];
    }
    const normalized = data
      .filter((laptop) => laptop.is_visible !== false)
      .map((laptop) => ({
        ...laptop,
        dailyRate: Number(laptop.daily_rate ?? laptop.dailyRate ?? laptop.dailyrate ?? 0),
        priceText: laptop.price_text || laptop.priceText || laptop.pricetext || '',
        image: laptop.image_url || laptop.image || '/assets/catalog-placeholder.svg'
      }))
      .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || Number(left.id || 0) - Number(right.id || 0));
    return normalized.length ? normalized : [];
  } catch (e) {
    console.warn('Не удалось загрузить каталог из Supabase:', e);
    return [];
  }
}

export async function fetchBlockingRentals() {
  if (!supabaseClient) return { ok: true, rows: [] };

  try {
    const { data, error } = await withTimeout(supabaseClient
      .from('laptop_availability')
      .select('laptop_id, rental_start_date, rental_end_date, status, hold_expires_at'));

    if (error) {
      console.warn('Не удалось загрузить занятость ноутбуков:', error.message);
      return { ok: false, rows: [] };
    }

    return { ok: true, rows: data || [] };
  } catch (error) {
    console.warn('Не удалось загрузить занятость ноутбуков:', error);
    return { ok: false, rows: [] };
  }
}

export async function createRentalOrder(order) {
  if (!supabaseClient) {
    return { order: null, error: { message: 'NO_SUPABASE' } };
  }

  const { data, error } = await supabaseClient
    .from('rental_orders')
    .insert(order)
    .select('id')
    .single();

  if (error) return { order: null, error };
  return { order: data, error: null };
}
