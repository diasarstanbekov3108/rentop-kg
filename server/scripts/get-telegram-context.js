const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.startsWith('replace_with')) {
  throw new Error('Add TELEGRAM_BOT_TOKEN to server/.env before running this script.');
}

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=25`);
const payload = await response.json();

if (!payload.ok) {
  throw new Error(`Telegram getUpdates failed: ${payload.description || 'unknown error'}`);
}

const contexts = new Map();

for (const update of payload.result || []) {
  const message = update.message || update.edited_message || update.callback_query?.message;
  const sender = update.message?.from || update.edited_message?.from || update.callback_query?.from;
  if (!message?.chat || !sender) continue;

  const key = `${message.chat.id}:${sender.id}`;
  contexts.set(key, {
    chat_id: message.chat.id,
    chat_type: message.chat.type,
    chat_title: message.chat.title || null,
    sender_user_id: sender.id,
    sender_username: sender.username ? `@${sender.username}` : null
  });
}

if (!contexts.size) {
  console.log('Сообщений пока нет. Напишите /start боту лично и /admin в закрытой группе, затем запустите команду ещё раз.');
  process.exit(0);
}

console.log('Найдены следующие безопасные технические идентификаторы:');
console.table([...contexts.values()]);
console.log('Укажите свой sender_user_id как RENTOP_ADMIN_USER_IDS, а chat_id закрытой группы — как RENTOP_ADMIN_CHAT_ID в server/.env.');
