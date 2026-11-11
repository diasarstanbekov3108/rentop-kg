import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createNikitaSmsClient, normalizeKyrgyzPhone } from '../server/src/sms.js';
import { createTelegramApi } from '../server/src/telegram.js';

// Keep the original host-only cookie, but also issue a compatible HttpOnly
// cookie. Some mobile browsers were rejecting the __Host-prefixed value on
// preview deployments, even though the SMS login itself succeeded. Both are
// secure, host-only, SameSite=Lax cookies; the second is only a compatibility
// name, not a client-readable token.
const COOKIE = '__Host-rentop_session';
const COMPAT_COOKIE = 'rentop_session';
const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EXTENDABLE_STATUSES = new Set(['issued', 'in_use']);
const RETURNABLE_STATUSES = new Set(['issued', 'in_use']);
const DOCUMENT_TYPES = new Set(['identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video', 'benefit_proof']);
const BENEFIT_TYPES = new Set(['student', 'pensioner', 'disability']);
const DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime']);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function sessionCookie(name, value, maxAge) { return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`; }
function json(response, status, body) { response.setHeader('Cache-Control', 'private, no-store, max-age=0'); response.status(status).json(body); }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function code() { return String(randomInt(100000, 1_000_000)); }
function clientIp(request) { return String(request.headers['x-forwarded-for'] || '').split(',')[0].trim(); }
function allowOrigin(request, response) { const origin = request.headers.origin; if (origin && /^https:\/\/(?:[a-z0-9-]+\.)?rentop(?:\.com\.kg|-[-a-z0-9]+\.vercel\.app)$/i.test(origin)) response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
function label(delivery) { return ({ arca_locker:'ARCHA POINT 24/7', delivery:'Доставка курьером', pickup:'Архивный способ получения' }[delivery] || 'Уточняется'); }
function addDays(isoDate, days) { const date = new Date(`${isoDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function discountForTerm(days, benefits = []) {
  const tariff = days >= 15 ? 30 : days >= 7 ? 15 : 0;
  const benefit = benefits.some(item => item.status === 'approved' && (!item.expires_at || new Date(item.expires_at) > new Date())) ? 10 : 0;
  return Math.max(tariff, benefit);
}
function orderRef(order) { return String(order.id || '').slice(0, 8).toUpperCase(); }
function documentLabel(kind) { return ({ identity:'Паспорт или ID-карта', identity_front:'Паспорт или ID-карта — лицевая сторона', identity_back:'Паспорт или ID-карта — обратная сторона', selfie:'Селфи с документом', supporting:'Официальный подтверждающий документ', issue_video:'Видео до получения', return_video:'Видео возврата', benefit_proof:'Документ для социальной скидки' }[kind] || 'Документ'); }
function printableMoment(value) { return new Intl.DateTimeFormat('ru-RU', { timeZone:'Asia/Bishkek', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)); }

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
    // Do not sign every historic image/video while opening the account. On a
    // phone that becomes dozens of Storage requests; a link is created only
    // after the customer explicitly opens one file.
    // Fetch independent sections together. Previously these six batches ran
    // one after another, so a customer with test/history orders could wait long
    // enough for a mobile request to time out. One missing old asset must not
    // make the entire cabinet unavailable either.
    const [laptops, requests, documents, payments, feedback, supportCases] = await Promise.all([
      Promise.all(orders.map(order => database.getLaptop(order.laptop_id).catch(() => null))),
      Promise.all(orders.map(order => database.listCustomerRequests(order.id).catch(() => []))),
      Promise.all(orders.map(order => database.listOrderDocuments(order.id).catch(() => []))),
      Promise.all(orders.map(order => database.listOrderPayments(order.id).catch(() => []))),
      Promise.all(orders.map(order => database.getOrderFeedback(order.id).catch(() => null))),
      Promise.all(orders.map(order => database.listOrderSupportCases(order.id).catch(() => [])))
    ]);
    return orders.map((order, index) => ({
      ...order,
      laptop_title:laptops[index]?.title || laptops[index]?.name || 'Ноутбук Rentop',
      reference: orderRef(order),
      delivery_label:label(order.delivery_type),
      requests:requests[index],
      documents:documents[index],
      feedback:feedback[index],
      supportCases:supportCases[index],
      payment:(payments[index] || []).find(payment => payment.purpose !== 'extension') || null,
      extensionPayment:(payments[index] || []).find(payment => payment.purpose === 'extension' && ['awaiting_payment', 'paid'].includes(payment.status)) || null
    }));
  };
  const accountData = async (phone) => {
    const [profile, promos, benefits, orders] = await Promise.all([
      database.getCustomerProfile(phone).catch(() => null),
      database.listPromosByPhone(phone).catch(() => []),
      database.listBenefitVerifications(phone).catch(() => []),
      hydrate(phone)
    ]);
    return { phone, whatsappUrl: config.rentopWhatsappPhone ? `https://wa.me/${config.rentopWhatsappPhone}` : '', offerSmsConsentRequired:config.offerSmsConsentRequired, profile, promos, benefits, orders };
  };
  const verifySession = async () => {
    const raw = readCookie(request, COOKIE) || readCookie(request, COMPAT_COOKIE); if (!raw) return null;
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
    if (payload.action === 'logout') {
      const raw = readCookie(request, COOKIE) || readCookie(request, COMPAT_COOKIE);
      if (raw) await database.revokeCabinetSession(hash(secret, raw));
      response.setHeader('Set-Cookie', [sessionCookie(COOKIE, '', 0), sessionCookie(COMPAT_COOKIE, '', 0)]);
      return json(response, 200, { ok:true });
    }
    if (payload.action === 'create_document_upload' || payload.action === 'register_document' || payload.action === 'delete_draft_document' || payload.action === 'create_document_download' || payload.action === 'document_correction_request' || payload.action === 'accept_offer' || payload.action === 'request_offer_sms_consent' || payload.action === 'verify_offer_sms_consent' || payload.action === 'save_profile' || payload.action === 'save_residence_address' || payload.action === 'save_delivery_preferences' || payload.action === 'extension_request' || payload.action === 'replacement_request' || payload.action === 'cancel_extension_request' || payload.action === 'early_return_request' || payload.action === 'support_request' || payload.action === 'save_order_comment' || payload.action === 'confirm_pickup_access_received' || payload.action === 'confirm_pickup' || payload.action === 'confirm_return_access_received' || payload.action === 'confirm_return_dropoff' || payload.action === 'submit_feedback') {
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
      if (payload.action === 'create_document_download') {
        const document = await database.getOrderDocument(String(payload.documentId || ''));
        if (!document || document.order_id !== order.id) return json(response, 404, { error:'Файл не найден.' });
        const signed = await database.createSignedDocumentDownload(document.storage_path);
        const path = signed?.signedURL || signed?.signedUrl || signed?.url || '';
        if (!path) throw new Error('Не удалось подготовить защищённый просмотр файла.');
        return json(response, 200, { ok:true, url:path.startsWith('http') ? path : `${config.supabaseUrl}/storage/v1${path}` });
      }
      if (payload.action === 'save_residence_address') {
        if (order.status !== 'draft') return json(response, 409, { error:'Адрес уже зафиксирован в заявке. Для исправления обратитесь к менеджеру.' });
        const residenceAddress = String(payload.residenceAddress || '').trim().replace(/\s+/g, ' ').slice(0, 500);
        const supportingDocumentType = String(payload.supportingDocumentType || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        if (residenceAddress.length < 15 || !/\d/.test(residenceAddress)) return json(response, 400, { error:'Укажите полный адрес проживания: город, район, улицу, номер дома и квартиру.' });
        if (supportingDocumentType.length < 3) return json(response, 400, { error:'Выберите тип официального подтверждающего документа.' });
        const profile = await database.getCustomerProfile(session.phone).catch(() => null);
        const updated = await database.updateOrder(order.id, { residence_address:residenceAddress, supporting_document_type:supportingDocumentType, customer_name:profile?.full_name || order.customer_name || null });
        await database.createEvent({ order_id:order.id, event_type:'customer_saved_residence_address_from_cabinet', actor_type:'customer', metadata:{ supporting_document_type:supportingDocumentType, address_length:residenceAddress.length } });
        return json(response, 200, { ok:true, order:updated });
      }
      if (payload.action === 'save_delivery_preferences') {
        if (order.status !== 'draft') return json(response, 409, { error:'Данные доставки уже переданы менеджеру. Для изменения обратитесь в поддержку.' });
        if (order.delivery_type === 'arca_locker') {
          const lockerAddress = String(payload.lockerAddress || '').trim().replace(/\s+/g, ' ').slice(0, 300);
          if (lockerAddress.length < 8) return json(response, 400, { error:'Выберите удобную точку ARCHA POINT.' });
          const updated = await database.updateOrder(order.id, { locker_address:lockerAddress });
          await database.createEvent({ order_id:order.id, event_type:'customer_selected_archa_location_from_cabinet', actor_type:'customer', metadata:{ locker_address:lockerAddress } });
          return json(response, 200, { ok:true, order:updated });
        }
        if (order.delivery_type !== 'delivery') return json(response, 200, { ok:true, order });
        const deliveryAddress = String(payload.deliveryAddress || '').trim().replace(/\s+/g, ' ').slice(0, 500);
        const deliveryPreferredTime = String(payload.deliveryPreferredTime || '').trim().replace(/\s+/g, ' ').slice(0, 300);
        if (deliveryAddress.length < 8) return json(response, 400, { error:'Укажите полный адрес доставки.' });
        if (deliveryPreferredTime.length < 3) return json(response, 400, { error:'Укажите удобное время доставки.' });
        const profile = await database.getCustomerProfile(session.phone).catch(() => null);
        const updated = await database.updateOrder(order.id, {
          delivery_address:deliveryAddress,
          delivery_contact_name:profile?.full_name || order.customer_name || null,
          delivery_contact_phone:session.phone,
          delivery_preferred_time:deliveryPreferredTime
        });
        await database.createEvent({ order_id:order.id, event_type:'customer_saved_delivery_preferences_from_cabinet', actor_type:'customer', metadata:{ address_length:deliveryAddress.length, preferred_time:deliveryPreferredTime } });
        return json(response, 200, { ok:true, order:updated });
      }
      if (payload.action === 'accept_offer') {
        const profile = await database.getCustomerProfile(session.phone).catch(() => null);
        const nameParts = String(profile?.full_name || '').trim().split(/\s+/).filter(Boolean);
        if (nameParts.length < 3 || nameParts.some((part) => part.length < 2)) return json(response, 409, { error:'Перед отправкой документов заполните ФИО в верхней части личного кабинета.' });
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
        if (!config.offerOtpHmacSecret || !config.nikitaSms.enabled) return json(response, 503, { error:'Подтверждение оферты одноразовым кодом ещё настраивается. Менеджер не сможет перевести заявку к выдаче без этого шага после его включения.' });
        if (order.offer_otp_expires_at && new Date(order.offer_otp_expires_at).getTime() > Date.now() - (OTP_TTL_MS - 60_000)) return json(response, 429, { error:'Код уже отправлен. Подождите минуту перед повторной отправкой.' });
        const otp = code();
        const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
        await database.updateOrder(order.id, { offer_otp_hash:hash(config.offerOtpHmacSecret, `${order.id}:${otp}`), offer_otp_expires_at:expiresAt, offer_otp_attempts:0 });
        await createNikitaSmsClient(config.nikitaSms).send({ phone:session.phone, text:`RENTOP.KG: код подтверждения оферты ${otp}. Код действует 10 минут. Никому не сообщайте его.` });
        await database.createEvent({ order_id:order.id, event_type:'offer_sms_code_sent_from_cabinet', actor_type:'customer', metadata:{ offer_version:order.offer_version || config.offerVersion, expires_at:expiresAt, delivery_channel:config.nikitaOtpChannel } });
        return json(response, 200, { ok:true, expiresAt, deliveryChannel:config.nikitaOtpChannel });
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
          return json(response, 400, { error:'Неверный код. Проверьте сообщение с кодом и попробуйте снова.' });
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
      if (payload.action === 'delete_draft_document') {
        if (order.status !== 'draft') return json(response, 409, { error:'После отправки на проверку документ нельзя удалить самостоятельно. Запросите замену у менеджера.' });
        const documentId = String(payload.documentId || '');
        const document = (await database.listOrderDocuments(order.id)).find(item => item.id === documentId);
        if (!document) return json(response, 404, { error:'Документ не найден.' });
        await database.deleteOrderDocument(document.id);
        await database.deleteDocumentFile(document.storage_path).catch(error => console.error('Draft document storage cleanup failed:', error.message));
        await database.createEvent({ order_id:order.id, event_type:'customer_deleted_draft_document_from_cabinet', actor_type:'customer', metadata:{ kind:document.kind } });
        return json(response, 200, { ok:true, message:'Файл удалён. Можете выбрать другой.' });
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
        if (kind !== 'benefit_proof' && !order.offer_accepted_at) return json(response, 409, { error:'Перед отправкой документов ознакомьтесь и согласитесь с публичной офертой.' });
        if (kind !== 'benefit_proof' && config.offerSmsConsentRequired && !order.offer_otp_verified_at) return json(response, 409, { error:'Подтвердите согласие с офертой одноразовым кодом.' });
        if (!DOCUMENT_TYPES.has(kind) || !path.startsWith(`${order.id}/${kind}/`) || !DOCUMENT_MIME_TYPES.has(contentType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_DOCUMENT_BYTES) {
          return json(response, 400, { error:'Не удалось зарегистрировать документ.' });
        }
        const benefitType = String(payload.benefitType || '');
        if (kind === 'benefit_proof' && !BENEFIT_TYPES.has(benefitType)) return json(response, 400, { error:'Выберите категорию социальной скидки.' });
        const orderDocuments = await database.listOrderDocuments(order.id);
        const sameUpload = orderDocuments.find(document => document.kind === kind && document.storage_path === path);
        // A connection can fail after the database accepted a file but before
        // the browser received the response. An exact retry is safe to accept.
        if (sameUpload) return json(response, 200, { ok:true, document:sameUpload, message:'Файл уже был безопасно сохранён в заявке.' });
        const latestOfKind = orderDocuments.find(document => document.kind === kind);
        if (latestOfKind && latestOfKind.status !== 'rejected') return json(response, 409, { error:`В раздел «${documentLabel(kind)}» уже отправлен файл и он ждёт проверки. Это не запрет на одинаковые файлы в разных разделах: повторно загружать нельзя только тот же раздел. Для замены попросите исправление у менеджера.` });
        const document = await database.registerOrderDocument({ order_id:order.id, kind, storage_path:path, file_name:fileName, content_type:contentType, byte_size:byteSize });
        let benefit = null;
        if (kind === 'benefit_proof') {
          benefit = await database.createBenefitVerification({ phone:session.phone, benefit_type:benefitType, document_id:document.id });
          await database.updateOrder(order.id, { benefit_requested_type:benefitType });
          await database.createEvent({ order_id:order.id, event_type:'customer_submitted_benefit_verification_from_cabinet', actor_type:'customer', metadata:{ benefit_type:benefitType, verification_id:benefit.id } });
        }
        await database.createEvent({ order_id:order.id, event_type:'customer_uploaded_document_from_cabinet', actor_type:'customer', metadata:{ kind } });
        const uploaded = await database.listOrderDocuments(order.id);
        const latestKinds = new Set(uploaded.filter(item => item.status !== 'rejected').map(item => item.kind));
        const hasFront = latestKinds.has('identity_front') || latestKinds.has('identity');
        if (hasFront && ['identity_back', 'selfie', 'supporting'].every(requiredKind => latestKinds.has(requiredKind)) && String(order.residence_address || '').trim().length >= 8 && String(order.supporting_document_type || '').trim().length >= 3 && order.status === 'draft') {
          await database.updateOrder(order.id, { status:'pending_review' });
        }
        await notifyDocumentManager(order, document);
        return json(response, 201, { ok:true, document, benefit, message:kind === 'benefit_proof' ? 'Документ отправлен. После проверки льготная скидка появится в кабинете и будет применяться вместо меньшей тарифной скидки.' : undefined });
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
        const pickupReady = order.status === 'awaiting_pickup' && (
          (order.delivery_type === 'arca_locker' && ['access_sent','loaded'].includes(String(order.locker_status || '')))
          || (order.delivery_type === 'delivery' && String(order.locker_status || '') === 'delivery_dispatched')
        );
        if (!pickupReady) return json(response, 409, { error:'Подтверждение доступно после готовности выдачи: закладки в постамат или согласованной передачи курьеру.' });
        const evidence = await database.listOrderDocuments(order.id);
        const issueVideo = evidence.find(document => document.kind === 'issue_video' && document.status !== 'rejected');
        if (!issueVideo) return json(response, 409, { error:'Сначала прикрепите короткое видео получения: ноутбук, экран, корпус, зарядку и комплект.' });
        const startedAt = new Date().toISOString();
        const endsAt = new Date(Date.parse(startedAt) + Math.max(1, Number(order.rental_days) || 1) * 86_400_000).toISOString();
        const updated = await database.updateOrder(order.id, { status:'in_use', locker_status:'client_picked_up', rental_started_at:startedAt, rental_ends_at:endsAt });
        await database.createEvent({ order_id:order.id, event_type:'customer_confirmed_pickup_from_cabinet', actor_type:'customer', metadata:{ rental_started_at:startedAt, rental_ends_at:endsAt } });
        if (config.nikitaSms?.enabled) {
          try {
            await createNikitaSmsClient(config.nikitaSms).send({ phone:session.phone, text:`RENTOP.KG: получение по заявке ${orderRef(order)} подтверждено. Аренда началась ${printableMoment(startedAt)} и действует до ${printableMoment(endsAt)} (Бишкек).` });
            await database.createEvent({ order_id:order.id, event_type:'rental_exact_deadline_sms_sent_after_pickup', actor_type:'system', metadata:{ rental_started_at:startedAt, rental_ends_at:endsAt, channel:'sms' } });
          } catch (error) { console.error('Rental-start SMS failed:', error.message); }
        }
        return json(response, 200, { ok:true, order:updated, message:'Получение подтверждено. Аренда началась сейчас; срок и уведомление рассчитаны от фактической выдачи.' });
      }
      if (payload.action === 'confirm_pickup_access_received') {
        if (order.status !== 'awaiting_pickup' || !['loaded','access_sent'].includes(String(order.locker_status || ''))) return json(response, 409, { error:'Этот этап выдачи уже обновлён. Нажмите «Обновить заявки».' });
        const receivedAt = new Date().toISOString();
        const updated = await database.updateOrder(order.id, { locker_status:'access_sent', customer_access_sent_at:receivedAt });
        await database.createEvent({ order_id:order.id, event_type:'customer_confirmed_archa_pickup_code_received_from_cabinet', actor_type:'customer', metadata:{} });
        await notifyManager(`📩 Клиент подтвердил получение кода выдачи ARCHA POINT\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент может забрать ноутбук, прикрепить видео получения и подтвердить выдачу самостоятельно.`);
        return json(response, 200, { ok:true, order:updated, message:'Код отмечен. Заберите ноутбук, снимите видео комплекта и подтвердите получение.' });
      }
      if (payload.action === 'confirm_return_access_received') {
        if (order.status !== 'awaiting_return_reservation' || order.return_method !== 'arca_locker' || !['return_pending','return_access_sent'].includes(String(order.locker_status || ''))) return json(response, 409, { error:'Этот этап возврата уже обновлён. Нажмите «Обновить заявки».' });
        const receivedAt = new Date().toISOString();
        const updated = await database.updateOrder(order.id, { status:'awaiting_return_dropoff', locker_status:'return_access_received', return_access_sent_at:receivedAt });
        await database.createEvent({ order_id:order.id, event_type:'customer_confirmed_archa_return_code_received_from_cabinet', actor_type:'customer', metadata:{} });
        await notifyManager(`📩 Клиент подтвердил получение кода возврата ARCHA POINT\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент переходит к видео возврата и помещению устройства в ячейку.`);
        return json(response, 200, { ok:true, order:updated, message:'Код отмечен. Снимите и прикрепите видео возврата, затем поместите ноутбук в ячейку.' });
      }
      if (payload.action === 'confirm_return_dropoff') {
        if (order.status !== 'awaiting_return_dropoff' || order.return_method !== 'arca_locker' || !['return_access_sent','return_access_received'].includes(String(order.locker_status || ''))) return json(response, 409, { error:'Подтверждение доступно только после получения кода возврата ARCHA POINT.' });
        const evidence = await database.listOrderDocuments(order.id);
        const returnVideo = evidence.find(document => document.kind === 'return_video');
        if (!returnVideo) return json(response, 409, { error:'Сначала прикрепите короткое видео состояния ноутбука и комплекта.' });
        if (returnVideo.status !== 'accepted') return json(response, 409, { error:'Видео возврата ещё не проверено менеджером. Не помещайте ноутбук в ячейку до подтверждения.' });
        const returnedAt = new Date().toISOString();
        const updated = await database.updateOrder(order.id, { status:'returned', locker_status:'returned', returned_at:returnedAt });
        await database.createEvent({ order_id:order.id, event_type:'customer_confirmed_return_dropoff_from_cabinet', actor_type:'customer', metadata:{ return_method:'arca_locker' } });
        return json(response, 200, { ok:true, order:updated, message:'Отметка сохранена. Менеджер проверит видео, заберёт ноутбук и завершит аренду после осмотра.' });
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
        if (conflict) {
          const allLaptops = await database.listRentableLaptops();
          const candidates = [];
          for (const candidate of allLaptops) {
            if (String(candidate.id) === String(order.laptop_id)) continue;
            const candidateConflict = await database.findOverlappingBlockingOrder(order.id, candidate.id, order.rental_end_date, newEndDate);
            if (candidateConflict) continue;
            const benefits = await database.listBenefitVerifications(session.phone).catch(() => []);
            const discount = discountForTerm(Number(order.rental_days || 0) + days, benefits);
            const replacementTotal = Math.round(Number(candidate.daily_rate || 0) * days * (100 - discount) / 100);
            const currentTotal = Math.round(Number(order.daily_rate || 0) * days * (100 - discount) / 100);
            candidates.push({ id:candidate.id, title:candidate.title, daily_rate:Number(candidate.daily_rate || 0), estimated_amount:replacementTotal, difference:replacementTotal - currentTotal, discount_percent:discount });
            if (candidates.length >= 4) break;
          }
          return json(response, 409, { code:'LAPTOP_UNAVAILABLE', error:`Продление недоступно: этот ноутбук уже забронирован с ${conflict.rental_start_date}.`, alternatives:candidates, days, proposedReturnDate:newEndDate });
        }
        const benefits = await database.listBenefitVerifications(session.phone).catch(() => []);
        const totalDays = Number(order.rental_days || 0) + days;
        const discount = discountForTerm(totalDays, benefits);
        const recalculatedTotal = Math.round(Number(order.daily_rate || 0) * totalDays * (100 - discount) / 100);
        const amount = Math.max(0, recalculatedTotal - Number(order.total_amount || 0));
        const customerRequest = await database.createCustomerRequest({ order_id:order.id, kind:'extension', requested_days:days, estimated_amount:amount, proposed_return_date:newEndDate });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_extension_from_cabinet', actor_type:'customer', metadata:{ extra_days:days, estimated_extra_amount:amount, proposed_end_date:newEndDate, discount_percent:discount } });
        await notifyManager(`📅 Запрос на продление с сайта\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\n+${days} дн. · до ${newEndDate}\nПредварительная доплата: ${amount} сом · скидка ${discount}%`);
        return json(response, 201, { ok:true, request:customerRequest, message:`Запрос передан менеджеру. Предварительная доплата: ${amount.toLocaleString('ru-RU')} сом, скидка ${discount}%.` });
      }
      if (payload.action === 'replacement_request') {
        const days = Number(payload.days);
        const replacementLaptopId = Number(payload.replacementLaptopId);
        if (!EXTENDABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Замену для продления можно выбрать только при активной аренде.' });
        if (!Number.isInteger(days) || days < 1 || days > 30 || !Number.isFinite(replacementLaptopId)) return json(response, 400, { error:'Не удалось определить срок или выбранную модель.' });
        const replacementLaptop = await database.getLaptop(replacementLaptopId);
        if (!replacementLaptop || replacementLaptop.category !== 'rent' || String(replacementLaptop.id) === String(order.laptop_id)) return json(response, 400, { error:'Выберите доступный ноутбук для замены.' });
        const proposedReturnDate = addDays(order.rental_end_date, days);
        const conflict = await database.findOverlappingBlockingOrder(order.id, replacementLaptop.id, order.rental_end_date, proposedReturnDate);
        if (conflict) return json(response, 409, { error:'Эту модель уже успели забронировать. Выберите другой вариант.' });
        const existing = (await database.listCustomerRequests(order.id)).find(item => ['extension','replacement'].includes(item.kind) && ['open','in_progress'].includes(item.status));
        if (existing) return json(response, 409, { error:'По продлению уже есть активный запрос. Дождитесь решения менеджера или отмените прежний запрос.' });
        const benefits = await database.listBenefitVerifications(session.phone).catch(() => []);
        const discount = discountForTerm(Number(order.rental_days || 0) + days, benefits);
        const amount = Math.round(Number(replacementLaptop.daily_rate || 0) * days * (100 - discount) / 100);
        const currentAmount = Math.round(Number(order.daily_rate || 0) * days * (100 - discount) / 100);
        const difference = amount - currentAmount;
        const customerRequest = await database.createCustomerRequest({ order_id:order.id, kind:'replacement', requested_days:days, estimated_amount:amount, proposed_return_date:proposedReturnDate, replacement_laptop_id:replacementLaptop.id, replacement_difference:difference, replacement_note:`Замена на ${replacementLaptop.title}; скидка ${discount}%` });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_replacement_for_extension_from_cabinet', actor_type:'customer', metadata:{ replacement_laptop_id:replacementLaptop.id, requested_days:days, estimated_amount:amount, difference, proposed_return_date:proposedReturnDate, discount_percent:discount } });
        await notifyManager(`🔁 Замена ноутбука для продления\n\nЗаявка ${orderRef(order)}\n${laptop?.title || 'Текущий ноутбук'} → ${replacementLaptop.title}\n+${days} дн. · до ${proposedReturnDate}\nДоплата за продление: ${amount} сом\nРазница относительно текущей модели: ${difference >= 0 ? '+' : ''}${difference} сом`);
        return json(response, 201, { ok:true, request:customerRequest, message:`Вариант замены отправлен менеджеру. Доплата за продление: ${amount.toLocaleString('ru-RU')} сом; разница по модели: ${difference >= 0 ? '+' : ''}${difference.toLocaleString('ru-RU')} сом.` });
      }
      if (payload.action === 'cancel_extension_request') {
        if (!EXTENDABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Отменить продление можно только для активной аренды.' });
        const requestId = String(payload.requestId || '');
        const extension = (await database.listCustomerRequests(order.id)).find(item => item.id === requestId && ['extension', 'replacement'].includes(item.kind) && item.status === 'open');
        if (!extension) return json(response, 409, { error:'Этот запрос уже обрабатывается или для него создан счёт. Свяжитесь с менеджером, чтобы отменить его безопасно.' });
        await database.updateCustomerRequest(extension.id, { status:'cancelled' });
        await database.createEvent({ order_id:order.id, event_type:'customer_cancelled_extension_from_cabinet', actor_type:'customer', metadata:{ request_id:extension.id } });
        await notifyManager(`↩️ Клиент отменил запрос продления\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nТеперь можно оформить возврат, если он нужен.`);
        return json(response, 200, { ok:true, message:'Запрос продления отменён. Теперь можно выбрать возврат ноутбука.' });
      }
      if (payload.action === 'early_return_request') {
        const note = String(payload.message || '').trim().slice(0, 500);
        const returnMethod = ['arca_locker','rentop_courier','customer_courier','self_delivery'].includes(payload.returnMethod) ? payload.returnMethod : '';
        const returnLockerAddress = String(payload.returnLockerAddress || '').trim().slice(0, 300);
        const returnCollectionAddress = String(payload.returnCollectionAddress || '').trim().slice(0, 500);
        const returnContactName = String(payload.returnContactName || '').trim().slice(0, 160);
        const returnContactPhone = String(payload.returnContactPhone || '').trim().slice(0, 40);
        const returnPreferredTime = String(payload.returnPreferredTime || '').trim().slice(0, 300);
        if (!RETURNABLE_STATUSES.has(order.status)) return json(response, 400, { error:'Досрочный возврат доступен только для активной аренды.' });
        if (!returnMethod) return json(response, 400, { error:'Выберите удобный способ возврата.' });
        if (returnMethod === 'arca_locker' && !returnLockerAddress) return json(response, 400, { error:'Выберите постамат для возврата.' });
        if (returnMethod === 'rentop_courier' && (!returnContactName || !returnContactPhone || !returnPreferredTime || !returnCollectionAddress)) return json(response, 400, { error:'Укажите адрес, контакт и желаемое время для курьера Rentop.' });
        if (returnMethod === 'customer_courier' && (!returnContactName || !returnContactPhone || !returnPreferredTime)) return json(response, 400, { error:'Укажите контакт и желаемое время. Адрес приёма для вашей курьерской службы сообщит менеджер.' });
        if (returnMethod === 'self_delivery' && !returnPreferredTime) return json(response, 400, { error:'Укажите желаемое время самопривоза. Адрес приёма сообщит менеджер.' });
        const payer = 'customer';
        const requestData = { order_id:order.id, kind:'early_return', customer_message:note || null, return_method:returnMethod, return_locker_address:returnMethod === 'arca_locker' ? returnLockerAddress : null, return_collection_address:returnMethod === 'rentop_courier' ? returnCollectionAddress : null, return_contact_name:['rentop_courier','customer_courier'].includes(returnMethod) ? returnContactName : null, return_contact_phone:['rentop_courier','customer_courier'].includes(returnMethod) ? returnContactPhone : null, return_preferred_time:returnMethod === 'arca_locker' ? null : returnPreferredTime, return_delivery_payer:payer };
        const customerRequest = await database.createCustomerRequest(requestData);
        const nextStatus = returnMethod === 'arca_locker' ? 'awaiting_return_reservation' : 'awaiting_return_collection';
        await database.updateOrder(order.id, { status:nextStatus, return_method:returnMethod, return_locker_address:returnMethod === 'arca_locker' ? returnLockerAddress : null, return_collection_address:requestData.return_collection_address, return_contact_name:requestData.return_contact_name, return_contact_phone:requestData.return_contact_phone, return_preferred_time:requestData.return_preferred_time, return_delivery_payer:payer, return_destination_address:null, return_destination_note:null, locker_status:returnMethod === 'arca_locker' ? 'return_pending' : order.locker_status });
        await database.createEvent({ order_id:order.id, event_type:'customer_requested_early_return_from_cabinet', actor_type:'customer', metadata:{ reason_provided:Boolean(note), return_method:returnMethod, delivery_payer:payer, has_return_locker:Boolean(returnLockerAddress), has_collection_address:Boolean(returnCollectionAddress) } });
        const methodLabel = ({ arca_locker:'через постамат ARCHA POINT', rentop_courier:'курьером Rentop (платная услуга)', customer_courier:'курьерской службой клиента', self_delivery:'самопривозом по согласованию' })[returnMethod];
        const destinationTask = returnMethod === 'customer_courier' ? 'Сообщите клиенту адрес приёма для его курьерской службы в панели.' : returnMethod === 'self_delivery' ? 'Сообщите клиенту адрес приёма для самопривоза в панели.' : '';
        await notifyManager(`↩️ Досрочный возврат с сайта\n\nЗаявка ${orderRef(order)} · ${laptop?.title || 'Ноутбук'}\nКлиент: ${order.customer_name || '—'}\nСпособ: ${methodLabel}\n${returnLockerAddress ? `Постамат: ${returnLockerAddress}\n` : ''}${requestData.return_collection_address ? `Адрес забора: ${requestData.return_collection_address}\n` : ''}${returnContactName ? `Контакт: ${returnContactName} · ${returnContactPhone}\n` : ''}${returnPreferredTime ? `Время: ${returnPreferredTime}\n` : ''}${destinationTask ? `${destinationTask}\n` : ''}Причина: ${note || 'не указана'}\n\nВидео — только предварительная проверка. Аренду завершайте после физического получения устройства.`);
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
      if (!config.nikitaSms.enabled) return json(response, 503, { error:'Подтверждение одноразовым кодом ещё подключается. Попробуйте после запуска Nikita.' });
      const recent = await database.getRecentCabinetChallenge(phone);
      if (recent && new Date(recent.created_at).getTime() > Date.now() - 60_000) return json(response, 429, { error:'Код уже отправлен. Подождите минуту перед повторной отправкой.' });
      const otp = code();
      await database.createCabinetChallenge({ phone, code_hash:hash(secret, `${phone}:${otp}`), expires_at:new Date(Date.now()+OTP_TTL_MS).toISOString() });
      await createNikitaSmsClient(config.nikitaSms).send({ phone, text:`RENTOP.KG: код входа ${otp}. Никому не сообщайте код. Он действует 10 минут.` });
      return json(response, 200, { ok:true, deliveryChannel:config.nikitaOtpChannel });
    }
    if (payload.action === 'verify_code') {
      const otp = String(payload.code || '').replace(/\D/g, ''); if (!/^\d{6}$/.test(otp)) return json(response, 400, { error:'Код должен состоять из 6 цифр.' });
      const challenge = await database.getRecentCabinetChallenge(phone); if (!challenge || challenge.consumed_at || new Date(challenge.expires_at) <= now) return json(response, 400, { error:'Код истёк. Запросите новый.' });
      if (Number(challenge.attempts) >= 5) return json(response, 429, { error:'Слишком много попыток. Запросите новый код.' });
      const expected = Buffer.from(challenge.code_hash, 'hex'); const received = Buffer.from(hash(secret, `${phone}:${otp}`), 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) { await database.incrementCabinetChallenge(challenge.id, Number(challenge.attempts || 0) + 1); return json(response, 400, { error:'Неверный код. Проверьте сообщение с кодом и попробуйте снова.' }); }
      await database.consumeCabinetChallenge(challenge.id);
      const raw = randomBytes(32).toString('base64url');
      const sessionTtl = payload.remember === false ? SHORT_SESSION_TTL_MS : SESSION_TTL_MS;
      await database.createCabinetSession({ phone, token_hash:hash(secret, raw), expires_at:new Date(Date.now()+sessionTtl).toISOString(), user_agent:String(request.headers['user-agent'] || '').slice(0, 300), ip:clientIp(request) || null });
      const maxAge = Math.floor(sessionTtl / 1000);
      response.setHeader('Set-Cookie', [sessionCookie(COOKIE, raw, maxAge), sessionCookie(COMPAT_COOKIE, raw, maxAge)]);
      return json(response, 200, { authenticated:true, ...(await accountData(phone)) });
    }
    return json(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Cabinet API failed:', error.message); return json(response, 400, { error:error.message || 'Не удалось обработать запрос.' }); }
}
