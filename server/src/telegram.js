import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export function createTelegramApi(token) {
  const baseUrl = `https://api.telegram.org/bot${token}`;

  async function call(method, payload) {
    const response = await fetch(`${baseUrl}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram ${method}: ${result.description || 'unknown error'}`);
    return result.result;
  }

  async function sendPhoto(chatId, imagePath, caption) {
    if (/^https:\/\//i.test(imagePath)) {
      return call('sendPhoto', { chat_id: chatId, photo: imagePath, caption });
    }
    const image = await readFile(imagePath);
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption);
    form.set('photo', new Blob([image]), basename(imagePath));

    const response = await fetch(`${baseUrl}/sendPhoto`, { method: 'POST', body: form });
    const result = await response.json();
    if (!result.ok) throw new Error(`Telegram sendPhoto: ${result.description || 'unknown error'}`);
    return result.result;
  }

  return {
    getUpdates: (offset) => call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }),
    getMe: () => call('getMe', {}),
    setMyCommands: (commands, extra = {}) => call('setMyCommands', { commands, ...extra }),
    sendMessage: (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, ...extra }),
    sendPhoto,
    forwardMessage: (chatId, fromChatId, messageId) => call('forwardMessage', {
      chat_id: chatId, from_chat_id: fromChatId, message_id: messageId
    }),
    forwardMessages: (chatId, fromChatId, messageIds) => call('forwardMessages', {
      chat_id: chatId, from_chat_id: fromChatId, message_ids: messageIds
    }),
    answerCallback: (callbackId, text = '') => call('answerCallbackQuery', { callback_query_id: callbackId, text })
  };
}
