import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// Инициализация Supabase клиента
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Резервные данные
const fallbackLaptops = [
  {
    id: 1,
    title: 'Lenovo ThinkPad X1 Carbon',
    category: 'rent',
    badge: 'Аренда',
    cpu: 'Intel Core i5-1135G7',
    ram: '16 GB',
    storage: '512 GB SSD',
    dailyRate: 600,
    priceText: 'От 600 сом / день',
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
    dailyRate: 400,
    priceText: 'От 400 сом / день',
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
    dailyRate: 1200,
    priceText: 'От 1200 сом / день',
    image: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600&auto=format&fit=crop'
  }
];

export async function fetchLaptops() {
  if (!supabaseClient) return fallbackLaptops;

  try {
    const { data, error } = await supabaseClient.from('laptops').select('*');
    if (error || !data || data.length === 0) {
      return fallbackLaptops;
    }
    return data;
  } catch (e) {
    console.warn('Ошибка подключения к Supabase, используем локальные данные:', e);
    return fallbackLaptops;
  }
}