import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createNikitaSmsClient, normalizeKyrgyzPhone } from '../server/src/sms.js';
import { createTelegramApi } from '../server/src/telegram.js';

const COOKIE = '__Host-rentop_session';
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EXTENDABLE_STATUSES = new Set(['issued', 'in_use']);
const RETURNABLE_STATUSES = new Set(['issued', 'in_use']);

function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function json(response, status, body) { response.status(status).json(body); }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function code() { return String(randomInt(100000, 1_000_000)); }
function clientIp(request) { return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); }
function allowOrigin(request, response) { const origin = request.headers.origin; if (origin && /^https:\/\/(?:[a-z0-9-]+\.)?rentop(?:\.com\.kg|-[-a-z0-9]+\.vercel\.app)$/i.test(origin)) response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
function label(delivery) { return ({ arca_locker:'ARCHA POINT 24/7', delivery:'Доставка', pickup:'Самовывоз' }[delivery] || 'Уточняется'); }
function addDays(isoDate, days) { const date = new Date(`${isoDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function orderRef(order) { return String(order.id || '').slice(0, 8).toUpperCase(); }

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
    const requests = await Promise.all(orders.map((order) => database.listCustomerRequests(order.id).catch(() => [])));
    return orders.map((order, index) => ({
      ...order,
      laptop_title:laptops[index]?.title || laptops[index]?.name || 'Ноутбук Rentop',
      reference: orderRef(order),
      delivery_label:label(order.delivery_type),
      requests:requests[index]
    }));
  };
  const accountData = async (phone) => ({
    phone,
    profile:await database.getCustomerProfile(phone).catch(() => null),
    orders:await hydrate(phone)
  });
  const verifySession = async () => {
    const raw = readCookie(request, COOKIE); if (!raw) return null;
    const session = await database.getCabinetSession(hash(secret, raw));
    if (!session || session.revoked_at || new Date(session.expires_at) <= now) return null;
    database.touchCabinetSession(session.id).catch(() => {});
    return session;
  };
  try {
    if (request.method === 'GET') { const session = await verifySession(); if (!session) return json(response, 200, { authenticated:false }); return json(response, 200, { authenticated:true, ...(await accountData(session.phone)) }); }
    if (request.method !== 'POST') return json(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action === 'logout') { const raw = readCookie(request, COOKIE); if (raw) await database.revokeCabinetSession(hash(secret, raw)); response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`); return json(response, 200, { ok:true }); }
    if (payload.action === 'save_profile' || payload.action === 'extension_request' || payload.action === 'early_return_request' || payload.action === 'support_request') {
      const session = await verifySession();
      if (!session) return json(response, 401, { error:'Сессия истекла. Войдите в кабинет снова.', code:'AUTH_REQUIRED' });
      if (payload.action === 'save_profile') {
        const fullName = String(payload.fullName || '').trim().replace(/\s+/g, ' ');
        const parts = fullName.split(' ').filter(Boolean);
        if (parts.length < 3 || parts.some((part) => part.length < 2)) return json(response, 400, { error:'Укажите фамилию, имя и отчество — как в документе.' });
        const profile = await database.saveCustomerProfile({ phone:session.phone, full_name:fullName });
        return json(response, 200, { ok:true, profile });
      }
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.customer_phone !== session.phone) return json(response, 404, { error:'Заявка не найдена.' });
      const laptop = await database.getLaptop(order.laptop_id);
      const notifyManager = async (text) => {
        try { await createTelegramApi(config.telegramBotToken).sendMessage(config.adminChatId, text); } catch (error) { console.error('Cabinet manager notification failed:', error.message); }
      };
      if (payload.action === 'extension_request') {
        const days = Number(payload.days);
        if (!EXTENDABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Продление доступно только для активной аренды.' });
        if (!Number.isInteger(days) || days < 1 || days > 30) return json(response, 400, { error:'Выберите целое количество дней: от 1 до 30.' });
        const newEndDate = addDays(order.rental_end_date, days);
        const conflict = await database.findOverlappingBlockingOrder(order.id, order.laptop_id, order.rental_end_date, newEndDate);
        if (conflict) return json(response, 409, { error:`Продление недоступно: ноутбук уже забронирован с ${conflict.rental_start_date}.` });
        const amount = Math.round(Number(order.daily_rate || 0) * days);
        const customerRequest = await database.createCustomerRequest({ order_id:order.id, kind:'extension', requested_days:days, estimated_amount:amount, proposed_return_date:newEndDate });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_extension_from_cabinet', actor_type:'customer', metadata:{ extra_days:days, estimated_extra_amount:amount, proposed_end_date:newEndDate } });
        await notifyManager(`📅 Запрос на продление с сайта\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\n+${days} дн. · до ${newEndDate}\nПредварительная доплата: ${amount} сом`);
        return json(response, 201, { ok:true, request:customerRequest, message:`Запрос передан менеджеру. Предварительная доплата: ${amount.toLocaleString('ru-RU')} сом.` });
      }
      if (payload.action === 'early_return_request') {
        const note = String(payload.message || '').trim().slice(0, 500);
        if (!RETURNABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Досрочный возврат доступен только для активной аренды.' });
        const customerRequest = await database.createCustomerRequest({ order_id:order.id, kind:'early_return', customer_message:note || null });
        await database.updateOrder(order.id, { status:'return_requested', locker_status:order.delivery_type === 'arca_locker' ? 'return_pending' : order.locker_status });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_early_return_from_cabinet', actor_type:'customer', metadata:{ reason_provided:Boolean(note) } });
        await notifyManager(`↩️ Досрочный возврат с сайта\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\nПричина: ${note || 'не указана'}\n\nПодготовьте следующий шаг возврата.`);
        return json(response, 201, { ok:true, request:customerRequest, message:'Запрос принят. Менеджер подготовит дальнейшие инструкции по возврату.' });
      }
      const kind = payload.kind === 'archa' ? 'archa' : 'rentop';
      const note = String(payload.message || '').trim().slice(0, 1000);
      if (note.length < 3) return json(response, 400, { error:'Опишите вопрос хотя бы несколькими словами.' });
      await database.openSupportCase({ order_id:order.id, kind, status:'open', customer_message:note });
      await database.createEvent({ order_id:order.id, event_type:kind === 'archa' ? 'customer_requested_archa_support_from_cabinet' : 'customer_requested_rentop_support_from_cabinet', actor_type:'customer', metadata:{} });
      await notifyManager(`🆘 Обращение с сайта · ${kind === 'archa' ? 'ARCHA POINT' : 'Rentop'}\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\n${note}`);
      return json(response, 201, { ok:true, message:'Обращение передано менеджеру. Ответ появится в кабинете и придёт в Telegram.' });
    }
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
      return json(response, 200, { authenticated:true, ...(await accountData(phone)) });
    }
    return json(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Cabinet API failed:', error.message); return json(response, 400, { error:error.message || 'Не удалось обработать запрос.' }); }
}
