import { loadConfig } from '../src/config.js';

const webhookUrl = process.argv[2];

if (!webhookUrl || !/^https:\/\//i.test(webhookUrl)) {
  throw new Error('Передайте HTTPS-адрес webhook, например: https://your-preview.vercel.app/api/telegram');
}

const config = loadConfig();

if (!config.telegramWebhookSecret) {
  throw new Error('Добавьте TELEGRAM_WEBHOOK_SECRET в server/.env перед настройкой webhook.');
}

const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: config.telegramWebhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false
  })
});

const result = await response.json();
if (!result.ok) throw new Error(`Telegram setWebhook: ${result.description || 'unknown error'}`);

console.log(`Telegram webhook configured: ${webhookUrl}`);
