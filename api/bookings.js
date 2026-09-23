import { randomBytes } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createTelegramApi } from '../server/src/telegram.js';

function quote(laptop, startDate, endDate) {
  const days = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86_400_000);
  const rate = Number(laptop.daily_rate ?? laptop.dailyRate ?? laptop.dailyrate);
  if (!Number.isInteger(days) || days < 2) throw new Error('Минимальный срок аренды — 2 дня.');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Для выбранного ноутбука не указана дневная ставка.');
  const discount = days >= 15 ? 30 : days >= 4 ? 15 : 0;
  return { days, rate, discount, total: Math.round(days * rate * (100 - discount) / 100) };
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const config = loadConfig();
    const database = createSupabaseApi(config);
    const payload = request.body || {};
    const laptopId = Number(payload.laptopId);
    if (!Number.isFinite(laptopId) || !['delivery', 'pickup', 'arca_locker'].includes(payload.deliveryType)) throw new Error('Некорректные данные заявки.');
    if (payload.deliveryType === 'arca_locker' && !payload.lockerAddress) throw new Error('Выберите локацию ARCHA POINT.');
    const laptop = await database.getLaptop(laptopId);
    if (!laptop || laptop.category !== 'rent') throw new Error('Ноутбук для аренды не найден.');
    const rental = quote(laptop, payload.startDate, payload.endDate);
    const token = randomBytes(18).toString('base64url');
    const order = await database.createOrder({
      laptop_id: laptopId,
      customer_name: String(payload.customerName || '').trim() || null,
      customer_phone: String(payload.customerPhone || '').trim() || null,
      rental_start_date: payload.startDate,
      rental_end_date: payload.endDate,
      rental_days: rental.days,
      daily_rate: rental.rate,
      discount_percent: rental.discount,
      total_amount: rental.total,
      status: 'draft',
      delivery_type: payload.deliveryType,
      locker_address: payload.lockerAddress || null,
      client_token: token
    });
    const bot = createTelegramApi(config.telegramBotToken);
    const botInfo = await bot.getMe();
    return response.status(201).json({ orderId: order.id, telegramUrl: `https://t.me/${botInfo.username}?start=r_${token}` });
  } catch (error) {
    console.error('Booking creation failed:', error.message);
    return response.status(400).json({ error: error.message || 'Не удалось создать заявку.' });
  }
}
