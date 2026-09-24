import { randomBytes } from 'node:crypto';

const MAX_SMS_LENGTH = 800;

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getTag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? match[1].trim() : '';
}

export function normalizeKyrgyzPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^996\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `996${digits.slice(1)}`;
  throw new Error('Номер телефона должен быть в формате +996XXXXXXXXX.');
}

export function createNikitaSmsClient(options) {
  const config = options || {};

  async function send({ phone, text, test = false }) {
    if (!config.enabled) throw new Error('SMS-подтверждение пока не настроено на сервере.');
    if (!text || text.length > MAX_SMS_LENGTH) throw new Error(`SMS должно содержать от 1 до ${MAX_SMS_LENGTH} символов.`);
    const normalizedPhone = normalizeKyrgyzPhone(phone);
    // Nikita's specification permits both variants. In production some routes
    // reject the digits-only form, so send the explicit international format.
    const providerPhone = `+${normalizedPhone}`;
    // Nikita limits message IDs to 12 Latin letters/numbers. It also protects
    // against accidental duplicate sends, so each request gets a fresh ID.
    const id = randomBytes(6).toString('hex').toUpperCase();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<message>\n` +
      `  <login>${xmlEscape(config.login)}</login>\n` +
      `  <pwd>${xmlEscape(config.password)}</pwd>\n` +
      `  <id>${id}</id>\n` +
      `  <sender>${xmlEscape(config.sender)}</sender>\n` +
      `  <text>${xmlEscape(text)}</text>\n` +
      `  <phones><phone>${providerPhone}</phone></phones>\n` +
      (test ? '  <test>1</test>\n' : '') +
      `</message>`;

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/xml; charset=utf-8', accept: 'application/xml,text/xml,*/*' },
      body: xml,
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Nikita SMS HTTP ${response.status}`);
    const status = getTag(body, 'status');
    const message = getTag(body, 'message');
    if (status !== '0' && !(test && status === '11')) {
      throw new Error(`Nikita SMS отклонил запрос (код ${status || 'неизвестен'}): ${message || 'без описания'}`);
    }
    return { id, phone: providerPhone, accepted: status === '0', test, smsCount: Number(getTag(body, 'smscnt') || 0) };
  }

  return { send };
}
