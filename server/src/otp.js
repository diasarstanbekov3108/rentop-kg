import { createNikitaSmsClient } from './sms.js';

export function createOtpService({ provider, nikitaSms, telegram }) {
  const configuredProvider = String(provider || 'telegram').toLowerCase();
  if (!['telegram', 'nikita'].includes(configuredProvider)) {
    throw new Error('OTP_PROVIDER должен быть telegram или nikita.');
  }
  const nikita = createNikitaSmsClient(nikitaSms);

  async function sendTelegramCode({ chatId, code }) {
    await telegram.sendMessage(chatId,
      `Rentop KG: временный код подтверждения ${code}. Он действует 5 минут. Никому не сообщайте код.\n\nВведите 6 цифр одним сообщением в этом чате.`
    );
    return { provider: 'telegram', fallback: configuredProvider === 'nikita' };
  }

  return {
    async sendOfferCode({ chatId, phone, code }) {
      if (configuredProvider === 'telegram') return sendTelegramCode({ chatId, code });
      try {
        await nikita.send({
          phone,
          text: `Rentop KG: код подтверждения ${code}. Действует 5 минут. Никому не сообщайте код.`
        });
        return { provider: 'nikita', fallback: false };
      } catch (error) {
        console.error('Nikita OTP failed; using Telegram fallback:', error.message);
        return sendTelegramCode({ chatId, code });
      }
    }
  };
}
