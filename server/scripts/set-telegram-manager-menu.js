import { loadConfig } from '../src/config.js';
import { createTelegramApi } from '../src/telegram.js';

const config = loadConfig();
const telegram = createTelegramApi(config.telegramBotToken);

await telegram.setMyCommands([
  { command: 'admin', description: 'Панель менеджера' },
  { command: 'orders', description: 'Последние заявки' },
  { command: 'find', description: 'Поиск по коду, клиенту или модели' }
], {
  scope: { type: 'chat_administrators', chat_id: config.adminChatId }
});

console.log('Telegram manager menu configured for the admin group.');
