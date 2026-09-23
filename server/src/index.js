import http from 'node:http';
import { loadConfig } from './config.js';
import { createSupabaseApi } from './supabase.js';
import { createTelegramApi } from './telegram.js';
import { createRentopBot } from './bot.js';

const config = loadConfig();
const telegram = createTelegramApi(config.telegramBotToken);
const database = createSupabaseApi(config);
const bot = createRentopBot({ config, telegram, database });

const server = http.createServer((request, response) => {
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
