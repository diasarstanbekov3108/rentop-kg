import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createTelegramApi } from '../server/src/telegram.js';

function quote(laptop, startDate, endDate) {
  const days = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86_400_000);
  const rate = Number(laptop.daily_rate ?? laptop.dailyRate ?? laptop.dailyrate);
  if (!Number.isInteger(days) || days < 2) throw new Error('Минимальный срок аренды — 2 дня.');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Для выбранного ноутбука не указана дневная ставка.');
  const discount = days >= 15 ? 30 : days >= 7 ? 15 : 0;
  return { days, rate, discount, total: Math.round(days * rate * (100 - discount) / 100) };
}

function benefitDiscount(benefits = []) {
  const now = Date.now();
  const approved = benefits.some((item) => item.status === 'approved' && (!item.expires_at || new Date(item.expires_at).getTime() > now));
  return approved ? 10 : 0;
}

function rentalWithDiscount(rental, discount) {
  const cappedDiscount = Math.min(40, Math.max(0, Number(discount) || 0));
  return {
    ...rental,
    discount: cappedDiscount,
    total: Math.round(rental.days * rental.rate * (100 - cappedDiscount) / 100)
  };
}

function normalizePromoCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function samePhone(a, b) {
  return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, '');
}

function usablePromo(promo, phone) {
  if (!promo) throw new Error('Промокод не найден. Проверьте написание.');
  if (promo.status !== 'issued' || promo.redeemed_order_id || promo.redeemed_at) throw new Error('Этот промокод уже использован или больше недоступен.');
  if (!samePhone(promo.recipient_phone, phone)) throw new Error('Этот промокод выдан другому личному кабинету и не может быть применён.');
  if (!promo.expires_at || new Date(promo.expires_at).getTime() <= Date.now()) throw new Error('Срок действия этого промокода закончился.');
  if (![5, 10, 15, 20].includes(Number(promo.discount_percent))) throw new Error('У промокода некорректный размер скидки. Обратитесь в поддержку Rentop.');
  return promo;
}

function readCookie(request, name) {
  return String(request.headers.cookie || '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function sessionHash(secret, token) {
  return createHmac('sha256', secret).update(token).digest('hex');
}

function normalizeFullName(value, required = true) {
  const fullName = String(value || '').trim().replace(/\s+/g, ' ');
  if (!fullName && !required) return null;
  const parts = fullName.split(' ').filter(Boolean);
  if (parts.length < 3 || parts.some((part) => part.length < 2)) {
    throw new Error('Для оформления укажите полные ФИО: фамилию, имя и отчество. На этом шаге документы ещё не проверяются.');
  }
  return fullName;
}

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (request.method === 'OPTIONS') return response.status(204).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const config = loadConfig();
    const database = createSupabaseApi(config);
    const sessionToken = readCookie(request, '__Host-rentop_session');
    const session = config.customerOtpHmacSecret && sessionToken
      ? await database.getCabinetSession(sessionHash(config.customerOtpHmacSecret, sessionToken))
      : null;
    if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) {
      return response.status(401).json({ error: 'Сначала войдите в личный кабинет.', code: 'AUTH_REQUIRED' });
    }
    const payload = request.body || {};
    const profile = await database.getCustomerProfile(session.phone).catch(() => null);
    // Orders are always tied to the verified cabinet profile.  Accepting a
    // name from the modal here was the source of "lost" first applications.
    const fullName = normalizeFullName(profile?.full_name, true);
    const laptopId = Number(payload.laptopId);
    if (!Number.isFinite(laptopId) || !['delivery', 'arca_locker'].includes(payload.deliveryType)) throw new Error('Некорректные данные заявки.');
    const laptop = await database.getLaptop(laptopId);
    if (!laptop || laptop.category !== 'rent') throw new Error('Ноутбук для аренды не найден.');
    const benefits = await database.listBenefitVerifications(session.phone).catch(() => []);
    const tariffRental = quote(laptop, payload.startDate, payload.endDate);
    const baseRental = rentalWithDiscount(tariffRental, tariffRental.discount + benefitDiscount(benefits));
    const promoCode = normalizePromoCode(payload.promoCode);
    const promo = promoCode ? usablePromo(await database.getPromoByCode(promoCode), session.phone) : null;
    const rental = rentalWithDiscount(baseRental, baseRental.discount + Number(promo?.discount_percent || 0));
    // A second tap, a browser back-navigation, or a slow mobile connection
    // must not create a second copy of the same application for the same
    // person, laptop and dates. Future rentals on different dates remain OK.
    const previousOrders = await database.listOrdersByCustomerPhone(session.phone, 30).catch(() => []);
    const duplicate = previousOrders.find(order =>
      Number(order.laptop_id) === laptopId &&
      String(order.rental_start_date) === String(payload.startDate) &&
      String(order.rental_end_date) === String(payload.endDate) &&
      !['cancelled', 'rejected', 'completed'].includes(String(order.status || ''))
    );
    if (duplicate) throw new Error('Такая заявка уже создана. Откройте личный кабинет и загрузите документы — повторно бронировать этот же ноутбук на те же даты не нужно.');
    const token = randomBytes(18).toString('base64url');
    const order = await database.createOrder({
      laptop_id: laptopId,
      customer_name: fullName,
      customer_phone: session.phone,
      rental_start_date: payload.startDate,
      rental_end_date: payload.endDate,
      rental_days: rental.days,
      daily_rate: rental.rate,
      // The personal code is redeemed only after the new order has an ID.
      // The database then verifies the second, repriced update atomically.
      discount_percent: baseRental.discount,
      total_amount: baseRental.total,
      discount_policy: 'stacked_v1',
      status: 'draft',
      delivery_type: payload.deliveryType,
      // The first popup intentionally collects only the delivery method.
      // Address, time and exact ARCHA location are entered in the protected
      // cabinet together with the documents.
      locker_address: null,
      delivery_address: null,
      delivery_contact_name: null,
      delivery_contact_phone: null,
      delivery_preferred_time: null,
      client_token: token
    });
    if (promo) {
      // The update is conditional on an unused code, so a second browser tab
      // cannot spend the same personal code twice.
      const redeemed = await database.redeemPromo(promo.id, order.id);
      if (!redeemed) {
        await database.deleteOrder(order.id).catch(() => {});
        throw new Error('Промокод только что был использован. Обновите кабинет и выберите другой.');
      }
      const repriced = await database.updateOrder(order.id, { discount_percent:rental.discount, total_amount:rental.total });
      if (!repriced) throw new Error('Не удалось закрепить скидку по промокоду. Заявка не создана.');
    }
    const bot = createTelegramApi(config.telegramBotToken);
    await bot.sendMessage(config.adminChatId,
      `🆕 Новая заявка с сайта\n\nЗаявка ${order.id.slice(0, 8).toUpperCase()}\n` +
      `${laptop.title}\nКлиент: ${fullName || 'ФИО заполняется в кабинете'}\nТелефон: ${session.phone}\n` +
      `Срок: ${payload.startDate} — ${payload.endDate}\nСкидка: ${rental.discount}%${promo ? ` (промокод ${promo.code})` : ''}\nСумма: ${rental.total} сом\nПолучение: ${payload.deliveryType === 'arca_locker' ? 'ARCHA POINT (точка будет выбрана в кабинете)' : 'доставка (адрес будет указан в кабинете)'}\nДокументы: ожидаются\n\nОткройте панель: ${config.publicAppUrl}/manager`
    ).catch((error) => console.error('Manager notification failed:', error.message));
    return response.status(201).json({ orderId: order.id, accountUrl: `/account?created=${encodeURIComponent(order.id)}` });
  } catch (error) {
    console.error('Booking creation failed:', error.message);
    return response.status(400).json({ error: error.message || 'Не удалось создать заявку.' });
  }
}
