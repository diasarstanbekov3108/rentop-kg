import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../server/src/config.js';
import { createSupabaseApi } from '../../server/src/supabase.js';
import { createNikitaSmsClient } from '../../server/src/sms.js';

const TIME_ZONE = 'Asia/Bishkek';

function json(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json(body);
}

function localIsoDate(now = new Date()) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(isoDate, days) {
  const result = new Date(`${isoDate}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function authorized(request, secret) {
  if (!secret) return false;
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expected = Buffer.from(secret);
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function reference(order) { return String(order.id || '').slice(0, 8).toUpperCase(); }

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error:'Method not allowed.' });

  let config;
  try { config = loadConfig(); } catch { return json(response, 503, { error:'Сервис напоминаний временно настраивается.' }); }
  if (!authorized(request, config.cronSecret)) return json(response, 401, { error:'Unauthorized.' });
  if (!config.nikitaSms.enabled) return json(response, 503, { error:'SMS-провайдер не настроен.' });

  const today = localIsoDate();
  const tomorrow = addDays(today, 1);
  const database = createSupabaseApi(config);
  const sms = createNikitaSmsClient(config.nikitaSms);
  const candidates = await database.listRentalReminderCandidates(tomorrow);
  const sent = [];
  const failed = [];

  for (const order of candidates) {
    const isTomorrow = order.rental_end_date === tomorrow;
    const isDue = order.rental_end_date <= today;
    if (!isTomorrow && !isDue) continue;
    const eventType = isTomorrow ? 'rental_due_tomorrow_sms_sent_from_cron' : 'rental_due_today_sms_sent_from_cron';
    if (await database.hasOrderEvent(order.id, eventType)) continue;
    const text = isTomorrow
      ? `RENTOP.KG: срок аренды по заявке ${reference(order)} заканчивается завтра. Подготовьте ноутбук, зарядку и комплект. В личном кабинете выберите «Продлить аренду» или «Оформить возврат».`
      : `RENTOP.KG: срок аренды по заявке ${reference(order)} наступил. Сегодня оформите возврат в личном кабинете или запросите продление. Не оставляйте ноутбук в постамате без кода ARCHA POINT.`;
    try {
      await sms.send({ phone:order.customer_phone, text });
      await database.createEvent({
        order_id:order.id,
        event_type:eventType,
        actor_type:'system',
        metadata:{ rental_end_date:order.rental_end_date, sent_at:new Date().toISOString(), channel:'sms' }
      });
      sent.push(reference(order));
    } catch (error) {
      console.error(`Rental reminder failed for ${order.id}:`, error.message);
      failed.push(reference(order));
    }
  }

  return json(response, 200, { ok:true, date:today, checked:candidates.length, sent, failed });
}
