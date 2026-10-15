import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createNikitaSmsClient, normalizeKyrgyzPhone } from '../server/src/sms.js';
import { createTelegramApi } from '../server/src/telegram.js';

const COOKIE = '__Host-rentop_session';
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EXTENDABLE_STATUSES = new Set(['issued', 'in_use']);
const RETURNABLE_STATUSES = new Set(['issued', 'in_use']);
const DOCUMENT_TYPES = new Set(['identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video']);
const DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime']);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function json(response, status, body) { response.setHeader('Cache-Control', 'private, no-store, max-age=0'); response.status(status).json(body); }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function code() { return String(randomInt(100000, 1_000_000)); }
function clientIp(request) { return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); }
function allowOrigin(request, response) { const origin = request.headers.origin; if (origin && /^https:\/\/(?:[a-z0-9-]+\.)?rentop(?:\.com\.kg|-[-a-z0-9]+\.vercel\.app)$/i.test(origin)) response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
function label(delivery) { return ({ arca_locker:'ARCHA POINT 24/7', delivery:'Доставка', pickup:'Самовывоз' }[delivery] || 'Уточняется'); }
function addDays(isoDate, days) { const date = new Date(`${isoDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function orderRef(order) { return String(order.id || '').slice(0, 8).toUpperCase(); }
function documentLabel(kind) { return ({ identity:'Паспорт или ID-карта', identity_front:'Паспорт или ID-карта — лицевая сторона', identity_back:'Паспорт или ID-карта — обратная сторона', selfie:'Селфи с документом', supporting:'Официальный подтверждающий документ', issue_video:'Видео до получения', return_video:'Видео возврата' }[kind] || 'Документ'); }

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
    const documents = await Promise.all(orders.map(async (order) => {
      const items = await database.listOrderDocuments(order.id).catch(() => []);
      return Promise.all(items.map(async (document) => {
        const signed = await database.createSignedDocumentDownload(document.storage_path).catch(() => null);
        const path = signed?.signedURL || signed?.signedUrl || signed?.url || '';
        return { ...document, view_url:path ? (path.startsWith('http') ? path : `${config.supabaseUrl}/storage/v1${path}`) : '' };
      }));
    }));
    const payments = await Promise.all(orders.map((order) => database.getOrderPayment(order.id).catch(() => null)));
    const feedback = await Promise.all(orders.map((order) => database.getOrderFeedback(order.id).catch(() => null)));
    return orders.map((order, index) => ({
      ...order,
      laptop_title:laptops[index]?.title || laptops[index]?.name || 'Ноутбук Rentop',
      reference: orderRef(order),
      delivery_label:label(order.delivery_type),
      requests:requests[index],
      documents:documents[index],
      feedback:feedback[index],
      payment:payments[index] && {
        amount:payments[index].amount,
        currency_id:payments[index].currency_id,
        qr_image:payments[index].qr_image,
        qr_image_with_frame:payments[index].qr_image_with_frame,
        qr_link:payments[index].qr_link,
        status:payments[index].status,
        expires_at:payments[index].expires_at,
        paid_at:payments[index].paid_at
      }
    }));
  };
  const accountData = async (phone) => ({
    phone,
    whatsappUrl: config.rentopWhatsappPhone ? `https://wa.me/${config.rentopWhatsappPhone}` : '',
    offerSmsConsentRequired: config.offerSmsConsentRequired,
    profile:await database.getCustomerProfile(phone).catch(() => null),
    promos:await database.listPromosByPhone(phone).catch(() => []),
    orders:await hydrate(phone)
  });
  const verifySession = async () => {
    const raw = readCookie(request, COOKIE); if (!raw) return null;
    const session = await database.getCabinetSession(hash(secret, raw));
    if (!session || session.revoked_at || new Date(session.expires_at) <= now) return null;
    database.touchCabinetSession(session.id).catch(() => {});
    return session;
  };
  const notifyDocumentManager = async (order, document) => {
    try {
      const signed = await database.createSignedDocumentDownload(document.storage_path);
      const signedPath = signed.signedURL || signed.signedUrl || signed.url;
      if (!signedPath) throw new Error('Не удалось получить временную ссылку на документ.');
      const documentUrl = signedPath.startsWith('http') ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
      const kindLabel = documentLabel(document.kind);
      await createTelegramApi(config.telegramBotToken).sendDocument(
        config.adminChatId,
        documentUrl,
        `📄 Документ из личного кабинета\nЗаявка ${orderRef(order)}\nТип: ${kindLabel}`
      );
    } catch (error) {
      console.error('Cabinet document Telegram copy failed:', error.message);
    }
  };
  try {
    if (request.method === 'GET') { const session = await verifySession(); if (!session) return json(response, 200, { authenticated:false }); return json(response, 200, { authenticated:true, ...(await accountData(session.phone)) }); }
    if (request.method !== 'POST') return json(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action === 'logout') { const raw = readCookie(request, COOKIE); if (raw) await database.revokeCabinetSession(hash(secret, raw)); response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`); return json(response, 200, { ok:true }); }
    if (payload.action === 'create_document_upload' || payload.action === 'register_document' || payload.action === 'document_correction_request' || payload.action === 'accept_offer' || payload.action === 'request_offer_sms_consent' || payload.action === 'verify_offer_sms_consent' || payload.action === 'save_profile' || payload.action === 'extension_request' || payload.action === 'early_return_request' || payload.action === 'support_request' || payload.action === 'save_order_comment' || payload.action === 'confirm_pickup' || payload.action === 'submit_feedback') {
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
      if (payload.action === 'accept_offer') {
        if (order.offer_accepted_at) return json(response, 200, { ok:true, acceptedAt:order.offer_accepted_at, offerVersion:order.offer_version, smsRequired:config.offerSmsConsentRequired, smsVerified:Boolean(order.offer_otp_verified_at) });
        const acceptedAt = new Date().toISOString();
        const offerVersion = String(config.offerVersion || '2026-09-30').slice(0, 80);
        await database.updateOrder(order.id, { offer_version:offerVersion, offer_accepted_at:acceptedAt });
        await database.createEvent({ order_id:order.id, event_type:'offer_accepted_from_cabinet', actor_type:'customer', metadata:{ offer_version:offerVersion, ip:clientIp(request) || null, user_agent:String(request.headers['user-agent'] || '').slice(0, 300) } });
        return json(response, 200, { ok:true, acceptedAt, offerVersion, smsRequired:config.offerSmsConsentRequired, smsVerified:false });
      }
      if (payload.action === 'request_offer_sms_consent') {
        if (!order.offer_accepted_at) return json(response, 409, { error:'Сначала откройте оферту и подтвердите, что ознакомились с её условиями.' });
        if (order.offer_otp_verified_at) return json(response, 200, { ok:true, alreadyVerified:true });
        if (!config.offerOtpHmacSecret || !config.nikitaSms.enabled) return json(response, 503, { error:'SMS-подтверждение оферты ещё настраивается. Менеджер не сможет перевести заявку к выдаче без этого шага после его включения.' });
        if (order.offer_otp_expires_at && new Date(order.offer_otp_expires_at).getTime() > Date.now() - (OTP_TTL_MS - 60_000)) return json(response, 429, { error:'Код уже отправлен. Подождите минуту перед повторной отправкой.' });
        const otp = code();
        const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
        await database.updateOrder(order.id, { offer_otp_hash:hash(config.offerOtpHmacSecret, `${order.id}:${otp}`), offer_otp_expires_at:expiresAt, offer_otp_attempts:0 });
        await createNikitaSmsClient(config.nikitaSms).send({ phone:session.phone, text:`RENTOP.KG: код подтверждения оферты ${otp}. Код действует 10 минут. Никому не сообщайте его.` });
        await database.createEvent({ order_id:order.id, event_type:'offer_sms_code_sent_from_cabinet', actor_type:'customer', metadata:{ offer_version:order.offer_version || config.offerVersion, expires_at:expiresAt } });
        return json(response, 200, { ok:true, expiresAt });
      }
      if (payload.action === 'verify_offer_sms_consent') {
        const otp = String(payload.code || '').replace(/\D/g, '');
        if (!/^\d{6}$/.test(otp)) return json(response, 400, { error:'Код должен состоять из 6 цифр.' });
        if (order.offer_otp_verified_at) return json(response, 200, { ok:true, verifiedAt:order.offer_otp_verified_at });
        if (!config.offerOtpHmacSecret || !order.offer_otp_hash || !order.offer_otp_expires_at || new Date(order.offer_otp_expires_at) <= now) return json(response, 400, { error:'Код истёк. Запросите новый.' });
        if (Number(order.offer_otp_attempts || 0) >= 5) return json(response, 429, { error:'Слишком много попыток. Запросите новый код.' });
        const expected = Buffer.from(order.offer_otp_hash, 'hex');
        const received = Buffer.from(hash(config.offerOtpHmacSecret, `${order.id}:${otp}`), 'hex');
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
          await database.updateOrder(order.id, { offer_otp_attempts:Number(order.offer_otp_attempts || 0) + 1 });
          return json(response, 400, { error:'Неверный код. Проверьте SMS и попробуйте снова.' });
        }
        const verifiedAt = new Date().toISOString();
        await database.updateOrder(order.id, { offer_otp_verified_at:verifiedAt, offer_otp_hash:null, offer_otp_expires_at:null, offer_consent_ip:clientIp(request) || null, offer_consent_user_agent:String(request.headers['user-agent'] || '').slice(0, 300) || null });
        await database.createEvent({ order_id:order.id, event_type:'offer_sms_consent_verified_from_cabinet', actor_type:'customer', metadata:{ offer_version:order.offer_version || config.offerVersion, phone:session.phone, ip:clientIp(request) || null, user_agent:String(request.headers['user-agent'] || '').slice(0, 300) } });
        return json(response, 200, { ok:true, verifiedAt });
      }
      if (payload.action === 'document_correction_request') {
        const documents = await database.listOrderDocuments(order.id);
        if (!documents.length) return json(response, 400, { error:'Сначала прикрепите документы.' });
        if (await database.hasOrderEvent(order.id, 'customer_requested_document_correction_from_cabinet')) return json(response, 409, { error:'Запрос на исправление уже отправлен менеджеру. Дождитесь ответа.' });
        const note = String(payload.message || '').trim().slice(0, 400);
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_document_correction_from_cabinet', actor_type:'customer', metadata:{ note:note || null } });
        try { await createTelegramApi(config.telegramBotToken).sendMessage(config.adminChatId, `⚠️ Клиент просит заменить документ с сайта\n\nЗаявка ${orderRef(order)}\n${note || 'Причина не указана'}\n\nПроверьте документы и отклоните неверный файл в панели менеджера — клиент сможет прикрепить замену.`); } catch (error) { console.error('Document correction notification failed:', error.message); }
        return json(response, 201, { ok:true, message:'Запрос на исправление передан менеджеру. После отклонения неверного файла появится загрузка замены.' });
      }
      if (payload.action === 'create_document_upload') {
        const kind = String(payload.kind || '');
        const contentType = String(payload.contentType || '').toLowerCase();
        const byteSize = Number(payload.byteSize);
        const rawName = String(payload.fileName || '').slice(0, 180);
        if (!DOCUMENT_TYPES.has(kind) || !DOCUMENT_MIME_TYPES.has(contentType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_DOCUMENT_BYTES) {
          return json(response, 400, { error:'Допустимы JPG, PNG, PDF, MP4 или MOV. Фото/документы — до 8 МБ, короткое видео — до 50 МБ.' });
        }
        const extension = contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : contentType === 'video/mp4' ? 'mp4' : contentType === 'video/quicktime' ? 'mov' : 'jpg';
        const path = `${order.id}/${kind}/${randomBytes(18).toString('hex')}.${extension}`;
        const signed = await database.createSignedDocumentUpload(path);
        const signedPath = signed.url || signed.signedURL || signed.signedUrl;
        if (!signedPath || !signed.token) throw new Error('Не удалось подготовить безопасную загрузку файла.');
        const uploadUrl = signedPath.startsWith('http') ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
        return json(response, 200, { ok:true, path, uploadUrl, token:signed.token, fileName:rawName });
      }
      if (payload.action === 'register_document') {
        const kind = String(payload.kind || '');
        const path = String(payload.path || '');
        const contentType = String(payload.contentType || '').toLowerCase();
        const byteSize = Number(payload.byteSize);
        const fileName = String(payload.fileName || 'document').replace(/[\\/\0]/g, '_').slice(0, 180);
        if (!order.offer_accepted_at) return json(response, 409, { error:'Перед отправкой документов ознакомьтесь и согласитесь с публичной офертой.' });
        if (config.offerSmsConsentRequired && !order.offer_otp_verified_at) return json(response, 409, { error:'Подтвердите согласие с офертой одноразовым SMS-кодом.' });
        if (!DOCUMENT_TYPES.has(kind) || !path.startsWith(`${order.id}/${kind}/`) || !DOCUMENT_MIME_TYPES.has(contentType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_DOCUMENT_BYTES) {
          return json(response, 400, { error:'Не удалось зарегистрировать документ.' });
        }
        const latestOfKind = (await database.listOrderDocuments(order.id)).find(document => document.kind === kind);
        if (latestOfKind && latestOfKind.status !== 'rejected') return json(response, 409, { error:'Этот документ уже отправлен. Дождитесь проверки или запросите исправление.' });
        const document = await database.registerOrderDocument({ order_id:order.id, kind, storage_path:path, file_name:fileName, content_type:contentType, byte_size:byteSize });
        await database.createEvent({ order_id:order.id, event_type:'customer_uploaded_document_from_cabinet', actor_type:'customer', metadata:{ kind } });
        const uploaded = await database.listOrderDocuments(order.id);
        const latestKinds = new Set(uploaded.filter(item => item.status !== 'rejected').map(item => item.kind));
        const hasFront = latestKinds.has('identity_front') || latestKinds.has('identity');
        if (hasFront && ['identity_back', 'selfie', 'supporting'].every(requiredKind => latestKinds.has(requiredKind)) && order.status === 'draft') {
          await database.updateOrder(order.id, { status:'pending_review' });
        }
        await notifyDocumentManager(order, document);
        return json(response, 201, { ok:true, document });
      }
      const laptop = await database.getLaptop(order.laptop_id);
      const notifyManager = async (text) => {
        try { await createTelegramApi(config.telegramBotToken).sendMessage(config.adminChatId, text); } catch (error) { console.error('Cabinet manager notification failed:', error.message); }
      };
      if (payload.action === 'save_order_comment') {
        const note = String(payload.message || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
        if (note.length < 3) return json(response, 400, { error:'Напишите комментарий хотя бы несколькими словами.' });
        await database.updateOrder(order.id, { customer_note:note });
        await database.createEvent({ order_id:order.id, event_type:'customer_saved_order_comment_from_cabinet', actor_type:'customer', metadata:{ length:note.length } });
        return json(response, 200, { ok:true, message:'Комментарий сохранён. Менеджер увидит его при подготовке заказа.' });
      }
      if (payload.action === 'confirm_pickup') {
        if (order.status !== 'awaiting_pickup' || !['access_sent','loaded'].includes(String(order.locker_status || ''))) return json(response, 409, { error:'Подтверждение доступно после помещения ноутбука в ячейку и отправки инструкции.' });
        const evidence = await database.listOrderDocuments(order.id);
        const issueVideo = evidence.find(document => document.kind === 'issue_video');
        if (issueVideo?.status !== 'accepted') return json(response, 409, { error:'Сначала прикрепите короткое видео до получения и дождитесь его проверки менеджером.' });
        const updated = await database.updateOrder(order.id, { status:'in_use', locker_status:'client_picked_up' });
        await database.createEvent({ order_id:order.id, event_type:'customer_confirmed_pickup_from_cabinet', actor_type:'customer', metadata:{} });
        return json(response, 200, { ok:true, order:updated, message:'Получение подтверждено. Аренда стала активной.' });
      }
      if (payload.action === 'submit_feedback') {
        if (order.status !== 'completed') return json(response, 409, { error:'Отзыв доступен после завершения аренды.' });
        if (await database.getOrderFeedback(order.id)) return json(response, 409, { error:'Спасибо, ваш отзыв уже получен.' });
        const rating = payload.rating === '' || payload.rating == null ? null : Number(payload.rating);
        const review = String(payload.review || '').trim().slice(0, 1500) || null;
        const suggestion = String(payload.suggestion || '').trim().slice(0, 1500) || null;
        if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return json(response, 400, { error:'Оцените сервис от 1 до 5 или оставьте поле пустым.' });
        if (!review && !suggestion) return json(response, 400, { error:'Напишите отзыв или предложение по улучшению сервиса.' });
        const created = await database.createOrderFeedback({ order_id:order.id, rating, review, suggestion });
        await database.createEvent({ order_id:order.id, event_type:'customer_submitted_feedback_from_cabinet', actor_type:'customer', metadata:{ rating, has_review:Boolean(review), has_suggestion:Boolean(suggestion) } });
        await notifyManager(`⭐ Отзыв Rentop.KG\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nОценка: ${rating || 'не указана'}\nОтзыв: ${review || '—'}\nПредложение: ${suggestion || '—'}`);
        return json(response, 201, { ok:true, feedback:created, message:'Спасибо! Ваш отзыв и предложения переданы команде Rentop.' });
      }
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
        const returnMethod = ['arca_locker','courier','warehouse'].includes(payload.returnMethod) ? payload.returnMethod : '';
        const returnLockerAddress = String(payload.returnLockerAddress || '').trim().slice(0, 300);
        if (!RETURNABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Досрочный возврат доступен только для активной аренды.' });
        if (!returnMethod) return json(response, 400, { error:'Выберите удобный способ возврата.' });
        if (returnMethod === 'arca_locker' && !returnLockerAddress) return json(response, 400, { error:'Выберите постамат для возврата.' });
        const customerRequest = await database.createCustomerRequest({ order_id:order.id, kind:'early_return', customer_message:note || null, return_method:returnMethod, return_locker_address:returnMethod === 'arca_locker' ? returnLockerAddress : null });
        const nextStatus = returnMethod === 'arca_locker' ? 'awaiting_return_reservation' : 'return_requested';
        await database.updateOrder(order.id, { status:nextStatus, return_method:returnMethod, return_locker_address:returnMethod === 'arca_locker' ? returnLockerAddress : null, locker_status:returnMethod === 'arca_locker' ? 'return_pending' : order.locker_status });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_early_return_from_cabinet', actor_type:'customer', metadata:{ reason_provided:Boolean(note), return_method:returnMethod, has_return_locker:Boolean(returnLockerAddress) } });
        const methodLabel = ({ arca_locker:'через постамат ARCHA POINT', courier:'курьером Rentop', warehouse:'на склад Rentop' })[returnMethod];
        await notifyManager(`↩️ Досрочный возврат с сайта\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\nСпособ: ${methodLabel}\n${returnLockerAddress ? `Постамат: ${returnLockerAddress}\n` : ''}Причина: ${note || 'не указана'}\n\nПодготовьте следующий шаг возврата.`);
        return json(response, 201, { ok:true, request:customerRequest, message:'Запрос принят. Менеджер подготовит дальнейшие инструкции по возврату.' });
      }
      const supportKinds = new Set(['rentop','archa','archa_code_missing','archa_locker_issue','rental_issue']);
      const kind = supportKinds.has(payload.kind) ? payload.kind : 'rentop';
      const note = String(payload.message || '').trim().slice(0, 1000);
      if (note.length < 3) return json(response, 400, { error:'Опишите вопрос хотя бы несколькими словами.' });
      await database.openSupportCase({ order_id:order.id, kind, status:'open', customer_message:note });
      await database.createEvent({ order_id:order.id, event_type:'customer_opened_support_case_from_cabinet', actor_type:'customer', metadata:{ kind } });
      const kindLabel = ({ rentop:'Вопрос к Rentop', archa:'Проблема с ARCHA POINT', archa_code_missing:'Не пришёл код ARCHA POINT', archa_locker_issue:'Постамат не выдаёт / не открывается', rental_issue:'Проблема с ноутбуком или комплектностью' })[kind];
      await notifyManager(`🆘 Обращение с сайта · ${kindLabel}\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\n${note}`);
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
      const sessionTtl = payload.remember === false ? SHORT_SESSION_TTL_MS : SESSION_TTL_MS;
      await database.createCabinetSession({ phone, token_hash:hash(secret, raw), expires_at:new Date(Date.now()+sessionTtl).toISOString(), user_agent:String(request.headers['user-agent'] || '').slice(0, 300), ip:clientIp(request) || null });
      response.setHeader('Set-Cookie', `${COOKIE}=${raw}; Path=/; Max-Age=${Math.floor(sessionTtl/1000)}; HttpOnly; Secure; SameSite=Lax`);
      return json(response, 200, { authenticated:true, ...(await accountData(phone)) });
    }
    return json(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Cabinet API failed:', error.message); return json(response, 400, { error:error.message || 'Не удалось обработать запрос.' }); }
}
