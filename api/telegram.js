import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createTelegramApi } from '../server/src/telegram.js';
import { createRentopBot } from '../server/src/bot.js';

async function readTelegramUpdate(request) {
  const body = request.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return JSON.parse(body || '{}');
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8') || '{}');

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).end();
  const config = loadConfig();
  const secret = request.headers['x-telegram-bot-api-secret-token'];
  if (!config.telegramWebhookSecret || secret !== config.telegramWebhookSecret) return response.status(401).end();
  try {
    const bot = createRentopBot({ config, telegram: createTelegramApi(config.telegramBotToken), database: createSupabaseApi(config) });
    await bot.handleUpdate(await readTelegramUpdate(request));
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook failed:', error.message);
    return response.status(500).json({ ok: false });
  }
}
