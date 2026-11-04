import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../server/src/config.js';
import { createSupabaseApi } from '../../server/src/supabase.js';
import { createNikitaSmsClient } from '../../server/src/sms.js';

const TIME_ZONE = 'Asia/Bishkek';

function json(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  response.status(status).json(body);
}

function printableMoment(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone:TIME_ZONE, day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'
  }).format(new Date(value));
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

  const now = new Date();
  const database = createSupabaseApi(config);
  const sms = createNikitaSmsClient(config.nikitaSms);
  const candidates = await database.listRentalReminderCandidates();
  const sent = [];
  const failed = [];

  for (const order of candidates) {
    const deadline = order.rental_ends_at ? new Date(order.rental_ends_at) : null;
    // Старые заявки без точного срока продолжают работать по прежней логике,
    // но все новые используют момент оплаты плюс число оплаченных суток.
    const hoursLeft = deadline ? (deadline.getTime() - now.getTime()) / 3_600_000 : null;
    // На бесплатном Vercel задача запускается раз в сутки. Окно 48 часов
    // гарантирует, что предупреждение придёт заранее при любом времени оплаты.
    const isSoon = hoursLeft !== null && hoursLeft > 0 && hoursLeft <= 48;
    const isDue = hoursLeft !== null && hoursLeft <= 0;
    if (!isSoon && !isDue) continue;
    const eventType = isSoon ? 'rental_due_24h_sms_sent_from_cron' : 'rental_due_at_time_sms_sent_from_cron';
    if (await database.hasOrderEvent(order.id, eventType)) continue;
    const text = isSoon
      ? `RENTOP.KG: аренда по заявке ${reference(order)} заканчивается ${printableMoment(deadline)}. Подготовьте ноутбук, зарядку и комплект. В личном кабинете выберите «Продлить аренду» или «Оформить возврат».`
      : `RENTOP.KG: срок аренды по заявке ${reference(order)} закончился ${printableMoment(deadline)}. Оформите возврат в личном кабинете или запросите продление. Не оставляйте ноутбук в постамате без кода ARCHA POINT.`;
    try {
      await sms.send({ phone:order.customer_phone, text });
      await database.createEvent({
        order_id:order.id,
        event_type:eventType,
        actor_type:'system',
        metadata:{ rental_ends_at:order.rental_ends_at, sent_at:now.toISOString(), channel:'sms' }
      });
      sent.push(reference(order));
    } catch (error) {
      console.error(`Rental reminder failed for ${order.id}:`, error.message);
      failed.push(reference(order));
    }
  }

  return json(response, 200, { ok:true, checked:candidates.length, sent, failed });
}
