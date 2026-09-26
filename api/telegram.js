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
  const config = loadConfig();
  const secret = request.headers['x-telegram-bot-api-secret-token'];
  if (!config.telegramWebhookSecret || secret !== config.telegramWebhookSecret) return response.status(401).end();
  if (request.method === 'GET') {
    // Private deployment diagnostic: values are deliberately not exposed, only
    // booleans so an operator can tell which Vercel environment is incomplete.
    return response.status(200).json({
      ok: true,
      sms_configured: config.nikitaSms.enabled,
      otp_provider: config.otpProvider,
      otp_ready: config.otpProvider === 'telegram' || config.nikitaSms.enabled,
      offer_otp_secret_configured: Boolean(config.offerOtpHmacSecret),
      offer_url_configured: Boolean(config.offerUrl),
      offer_version_configured: Boolean(config.offerVersion)
    });
  }
  if (request.method !== 'POST') return response.status(405).end();
  let updateId = null;
  let claimed = false;
  const database = createSupabaseApi(config);
  try {
    const update = await readTelegramUpdate(request);
    updateId = Number.isInteger(update?.update_id) ? update.update_id : null;
    if (updateId !== null) {
      try {
        claimed = await database.claimWebhookUpdate(updateId);
        if (!claimed) return response.status(200).json({ ok: true, duplicate: true });
      } catch (error) {
        // The migration may not yet be installed on a Preview. The bot still
        // works; production launch requires the table for duplicate protection.
        console.error('Telegram idempotency store unavailable:', error.message);
      }
    }
    const bot = createRentopBot({ config, telegram: createTelegramApi(config.telegramBotToken), database });
    await bot.handleUpdate(update);
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook failed:', error.message);
    if (claimed && updateId !== null) {
      await database.releaseWebhookUpdate(updateId).catch((releaseError) => {
        console.error('Could not release failed Telegram update:', releaseError.message);
      });
    }
    return response.status(500).json({ ok: false });
  }
}
