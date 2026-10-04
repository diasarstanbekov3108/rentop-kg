import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createNikitaSmsClient, normalizeKyrgyzPhone } from '../server/src/sms.js';

const COOKIE = '__Host-rentop_session';
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = ['awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup', 'issued', 'in_use', 'return_requested'];

function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function json(response, status, body) { response.status(status).json(body); }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function code() { return String(randomInt(100000, 1_000_000)); }
function clientIp(request) { return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); }
function allowOrigin(request, response) { const origin = request.headers.origin; if (origin && /^https:\/\/(?:[a-z0-9-]+\.)?rentop(?:\.com\.kg|-[-a-z0-9]+\.vercel\.app)$/i.test(origin)) response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
function label(delivery) { return ({ arca_locker:'ARCHA POINT 24/7', delivery:'Доставка', pickup:'Самовывоз' }[delivery] || 'Уточняется'); }

export default async function handler(request, response) {
  allowOrigin(request, response);
  if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); response.setHeader('Access-Control-Allow-Headers', 'content-type'); return response.status(204).end(); }
  let config;
  try { config = loadConfig(); } catch (error) { return json(response, 503, { error:'Сервис кабинета временно настраивается.' }); }
  const secret = config.customerOtpHmacSecret;
  if (!secret) return json(response, 503, { error:'Вход в кабинет скоро будет доступен. Настраиваем защищённое подтверждение номера.' });
  const database = createSupabaseApi(config);
  const now = new Date();
  const hydrate = async (phone) => {
    const orders = await database.listOrdersByCustomerPhone(phone);
    const laptops = await Promise.all(orders.map(order => database.getLaptop(order.laptop_id)));
    return orders.map((order, index) => ({ ...order, laptop_title:laptops[index]?.title || laptops[index]?.name || 'Ноутбук Rentop', reference: order.id.slice(0, 8).toUpperCase(), delivery_label:label(order.delivery_type) }));
  };
  const verifySession = async () => {
    const raw = readCookie(request, COOKIE); if (!raw) return null;
    const session = await database.getCabinetSession(hash(secret, raw));
    if (!session || session.revoked_at || new Date(session.expires_at) <= now) return null;
    database.touchCabinetSession(session.id).catch(() => {});
    return session;
  };
  try {
    if (request.method === 'GET') { const session = await verifySession(); if (!session) return json(response, 200, { authenticated:false }); return json(response, 200, { authenticated:true, phone:session.phone, orders:await hydrate(session.phone) }); }
    if (request.method !== 'POST') return json(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action === 'logout') { const raw = readCookie(request, COOKIE); if (raw) await database.revokeCabinetSession(hash(secret, raw)); response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`); return json(response, 200, { ok:true }); }
    const phone = `+${normalizeKyrgyzPhone(payload.phone)}`;
    if (payload.action === 'request_code') {
      if (!config.nikitaSms.enabled) return json(response, 503, { error:'SMS-подтверждение ещё подключается. Попробуйте после запуска Nikita SMS.' });
      const recent = await database.getRecentCabinetChallenge(phone);
      if (recent && new Date(recent.created_at).getTime() > Date.now() - 60_000) return json(response, 429, { error:'Код уже отправлен. Подождите минуту перед повторной отправкой.' });
      const otp = code();
      await database.createCabinetChallenge({ phone, code_hash:hash(secret, `${phone}:${otp}`), expires_at:new Date(Date.now()+OTP_TTL_MS).toISOString() });
      await createNikitaSmsClient(config.nikitaSms).send({ phone, text:`RENTOP.KG: код входа ${otp}. Никому не сообщайте код. Он действует 10 минут.` });
      return json(response, 200, { ok:true });
    }
    if (payload.action === 'verify_code') {
      const otp = String(payload.code || '').replace(/\D/g, ''); if (!/^\d{6}$/.test(otp)) return json(response, 400, { error:'Код должен состоять из 6 цифр.' });
      const challenge = await database.getRecentCabinetChallenge(phone); if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= now) return json(response, 400, { error:'Код истёк. Запросите новый.' });
      if (Number(challenge.attempts) >= 5) return json(response, 429, { error:'Слишком много попыток. Запросите новый код.' });
      const expected = Buffer.from(challenge.code_hash, 'hex'); const received = Buffer.from(hash(secret, `${phone}:${otp}`), 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) { await database.incrementCabinetChallenge(challenge.id, Number(challenge.attempts || 0) + 1); return json(response, 400, { error:'Неверный код. Проверьте SMS и попробуйте снова.' }); }
      await database.consumeCabinetChallenge(challenge.id);
      const raw = randomBytes(32).toString('base64url');
      await database.createCabinetSession({ phone, token_hash:hash(secret, raw), expires_at:new Date(Date.now()+SESSION_TTL_MS).toISOString(), user_agent:String(request.headers['user-agent'] || '').slice(0, 300), ip:clientIp(request) || null });
      response.setHeader('Set-Cookie', `${COOKIE}=${raw}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}; HttpOnly; Secure; SameSite=Lax`);
      return json(response, 200, { authenticated:true, phone, orders:await hydrate(phone) });
    }
    return json(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Cabinet API failed:', error.message); return json(response, 400, { error:error.message || 'Не удалось обработать запрос.' }); }
}
