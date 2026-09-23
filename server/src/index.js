import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { createSupabaseApi } from './supabase.js';
import { createTelegramApi } from './telegram.js';
import { createRentopBot } from './bot.js';

const config = loadConfig();
const telegram = createTelegramApi(config.telegramBotToken);
const database = createSupabaseApi(config);
const bot = createRentopBot({ config, telegram, database });

function sendJson(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // The public booking endpoint does not use cookies or expose private data.
    // It must work both from the local preview and the production website.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error('Request body is too large.'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON.')); }
    });
    request.on('error', reject);
  });
}

function rentalQuote(laptop, startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000);
  const rate = Number(laptop.daily_rate ?? laptop.dailyRate ?? laptop.dailyrate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Для выбранного ноутбука не указана дневная ставка.');
  if (!Number.isInteger(days) || days < 2) throw new Error('Минимальный срок аренды — 2 дня.');
  const discount = days >= 15 ? 30 : days >= 4 ? 15 : 0;
  return { days, rate, discount, total: Math.round(days * rate * (100 - discount) / 100) };
}

async function createBooking(request, response) {
  const payload = await readJson(request);
  const laptopId = Number(payload.laptopId);
  const allowedDelivery = ['delivery', 'pickup', 'arca_locker'];
  if (!Number.isFinite(laptopId) || !allowedDelivery.includes(payload.deliveryType)) {
    return sendJson(response, 400, { error: 'Некорректные данные заявки.' });
  }
  if (payload.deliveryType === 'arca_locker' && !payload.lockerAddress) {
    return sendJson(response, 400, { error: 'Выберите локацию ARCHA POINT.' });
  }

  const laptop = await database.getLaptop(laptopId);
  if (!laptop || laptop.category !== 'rent') return sendJson(response, 404, { error: 'Ноутбук для аренды не найден.' });
  const quote = rentalQuote(laptop, payload.startDate, payload.endDate);
  const token = randomBytes(18).toString('base64url');
  const order = await database.createOrder({
    laptop_id: laptopId,
    customer_name: String(payload.customerName || '').trim() || null,
    customer_phone: String(payload.customerPhone || '').trim() || null,
    rental_start_date: payload.startDate,
    rental_end_date: payload.endDate,
    rental_days: quote.days,
    daily_rate: quote.rate,
    discount_percent: quote.discount,
    total_amount: quote.total,
    status: 'draft',
    delivery_type: payload.deliveryType,
    locker_address: payload.lockerAddress || null,
    client_token: token
  });
  const botInfo = await telegram.getMe();
  return sendJson(response, 201, {
    orderId: order.id,
    telegramUrl: `https://t.me/${botInfo.username}?start=r_${token}`
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS' && request.url === '/api/bookings') {
    return sendJson(response, 204, {});
  }
  if (request.method === 'POST' && request.url === '/api/bookings') {
    createBooking(request, response).catch((error) => {
      console.error('Could not create booking:', error.message);
      sendJson(response, 400, { error: error.message || 'Не удалось создать заявку.' });
    });
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, service: 'rentop-telegram-mvp' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(config.port, () => {
  console.log(`Rentop MVP server is listening on port ${config.port}`);
});

let updateOffset = 0;

async function pollTelegram() {
  try {
    const updates = await telegram.getUpdates(updateOffset);
    for (const update of updates) {
      updateOffset = update.update_id + 1;
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        console.error(`Failed to process Telegram update ${update.update_id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Telegram polling failed:', error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  setImmediate(pollTelegram);
}

pollTelegram();
