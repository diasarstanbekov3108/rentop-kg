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

  return {
    getUpdates: (offset) => call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] }),
    sendMessage: (chatId, text, extra = {}) => call('sendMessage', { chat_id: chatId, text, ...extra }),
    forwardMessage: (chatId, fromChatId, messageId) => call('forwardMessage', {
      chat_id: chatId, from_chat_id: fromChatId, message_id: messageId
    }),
    answerCallback: (callbackId, text = '') => call('answerCallbackQuery', { callback_query_id: callbackId, text })
  };
}
