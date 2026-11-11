import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Инициализация Supabase клиента
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Резервные данные
export const fallbackLaptops = [
  {
    id: 1,
    title: 'Lenovo ThinkPad X1 Carbon',
    category: 'rent',
    badge: 'Аренда',
    cpu: 'Intel Core i5-1135G7',
    ram: '16 GB',
    storage: '512 GB SSD',
    dailyRate: 650,
    priceText: 'От 650 сом / день',
    image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop'
  },
  {
    id: 2,
    title: 'ASUS ROG Strix (Игровой)',
    category: 'sale',
    badge: 'Продажа',
    cpu: 'AMD Ryzen 7 5800H',
    ram: '16 GB',
    storage: '1 TB SSD',
    dailyRate: 0,
    priceText: '55 000 сом',
    image: 'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&auto=format&fit=crop'
  },
  {
    id: 3,
    title: 'HP ProBook 450 G8',
    category: 'rent',
    badge: 'Аренда',
    cpu: 'Intel Core i3-10110U',
    ram: '8 GB',
    storage: '256 GB SSD',
    dailyRate: 650,
    priceText: 'От 650 сом / день',
    image: 'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=600&auto=format&fit=crop'
  },
  {
    id: 4,
    title: 'Apple MacBook Air M1',
    category: 'sale',
    badge: 'Продажа',
    cpu: 'Apple M1',
    ram: '8 GB',
    storage: '256 GB SSD',
    dailyRate: 0,
    priceText: '62 000 сом',
    image: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop'
  },
  {
    id: 5,
    title: 'Razer Blade 15',
    category: 'rent',
    badge: 'Аренда',
    cpu: 'Intel Core i7-8500U',
    ram: '16 GB',
    storage: '256 GB SSD',
    dailyRate: 1300,
    priceText: 'От 1300 сом / день',
    image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop'
  }
];

export function getFallbackLaptops() {
  // Возвращаем новые объекты, чтобы состояние каталога не меняло резервные
  // данные между повторными рендерами.
  return fallbackLaptops.map((laptop) => ({ ...laptop }));
}

const CATALOG_CACHE_KEY = 'rentop-catalog-cache-v2';
const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

function readCatalogCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null');
    if (!cached || !Array.isArray(cached.items) || Date.now() - Number(cached.savedAt) > CATALOG_CACHE_TTL_MS) return null;
    return cached.items;
  } catch {
    return null;
  }
}

function writeCatalogCache(items) {
  try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ savedAt:Date.now(), items })); } catch { /* cache is optional */ }
}

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
  if (!supabaseClient) return getFallbackLaptops();

  const cached = readCatalogCache();
  if (cached?.length) return cached;

  try {
    const { data, error } = await withTimeout(supabaseClient.from('laptops').select('*'));
    if (error || !data || data.length === 0) {
      return getFallbackLaptops();
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
    writeCatalogCache(normalized);
    return normalized;
  } catch (e) {
    console.warn('Ошибка подключения к Supabase, используем локальные данные:', e);
    return getFallbackLaptops();
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
