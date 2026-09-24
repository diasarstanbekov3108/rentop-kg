import { loadConfig } from '../src/config.js';
import { createNikitaSmsClient } from '../src/sms.js';

const phone = process.env.NIKITA_SMS_TEST_PHONE;
if (!phone) {
  throw new Error('Set NIKITA_SMS_TEST_PHONE to your own +996 number before running this test.');
}

const config = loadConfig();
if (!config.nikitaSms.enabled) {
  throw new Error('Set NIKITA_SMS_LOGIN, NIKITA_SMS_PASSWORD and NIKITA_SMS_SENDER first.');
}

const result = await createNikitaSmsClient(config.nikitaSms).send({
  phone,
  text: 'Rentop KG: тест подключения SMS. Это сообщение не отправляется и не тарифицируется.',
  test: true
});

console.log(`Nikita SMS test accepted. Request ID: ${result.id}; SMS parts: ${result.smsCount}.`);
