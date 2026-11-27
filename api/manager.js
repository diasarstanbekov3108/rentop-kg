import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { verifyBakaiToken, generateBakaiQr, makePaymentOperationId } from '../server/src/bakai.js';
import { createNikitaSmsClient } from '../server/src/sms.js';
import { createTelegramApi } from '../server/src/telegram.js';

const COOKIE = '__Host-rentop_session';
const allowedDocumentStates = new Set(['accepted', 'rejected']);
const statusTransitions = Object.freeze({
  pending_review:['awaiting_payment']
});
const ALTERNATIVE_SECURITY_REQUIREMENTS = new Set(['alternative_security_video', 'alternative_security_address', 'alternative_security_work', 'alternative_security_study']);
const TIME_ZONE = 'Asia/Bishkek';
function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function reply(response, status, body) { response.setHeader('Cache-Control', 'private, no-store, max-age=0'); response.status(status).json(body); }
function samePhone(a, b) { return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, ''); }
function paymentPayloadObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function exactDeadline(paidAt, days) { return new Date(Date.parse(paidAt) + Math.max(1, Number(days) || 1) * 86_400_000).toISOString(); }
function extendExactDeadline(currentEnd, oldDate, newDate) {
  if (!currentEnd) return null;
  const extraDays = Math.round((new Date(`${newDate}T00:00:00Z`) - new Date(`${oldDate}T00:00:00Z`)) / 86_400_000);
  return extraDays > 0 ? new Date(Date.parse(currentEnd) + extraDays * 86_400_000).toISOString() : currentEnd;
}
function discountForTerm(days, hasApprovedBenefit = false) {
  const tariff = Number(days) >= 15 ? 30 : Number(days) >= 7 ? 15 : 0;
  return Math.min(40, tariff + (hasApprovedBenefit ? 10 : 0));
}
function catalogText(value, maxLength) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength); }
function catalogPayload(payload) {
  const category = String(payload.category || 'rent');
  const dailyRate = Number(payload.dailyRate);
  const sortOrder = Number(payload.sortOrder || 0);
  const imageUrl = catalogText(payload.imageUrl, 2000);
  if (!['rent', 'sale'].includes(category)) throw new Error('Выберите «Аренда» или «Продажа».');
  const record = {
    title:catalogText(payload.title, 140), category, badge:catalogText(payload.badge, 32) || (category === 'rent' ? 'АРЕНДА' : 'ПРОДАЖА'),
    cpu:catalogText(payload.cpu, 160), ram:catalogText(payload.ram, 80), storage:catalogText(payload.storage, 160),
    daily_rate:category === 'rent' ? dailyRate : 0,
    price_text:catalogText(payload.priceText, 80), image_url:imageUrl || '/assets/catalog-placeholder.svg',
    description:catalogText(payload.description, 500), use_cases:catalogText(payload.useCases, 400), is_visible:Boolean(payload.isVisible), sort_order:Number.isInteger(sortOrder) ? Math.max(-10000, Math.min(10000, sortOrder)) : 0
  };
  if (record.title.length < 3 || record.cpu.length < 2 || record.ram.length < 2 || record.storage.length < 2) throw new Error('Заполните модель, процессор, память и накопитель.');
  if (category === 'rent' && (!Number.isFinite(dailyRate) || dailyRate < 100 || dailyRate > 100000)) throw new Error('Укажите корректную ставку аренды от 100 до 100 000 сом в день.');
  if (category === 'rent' && !record.price_text) record.price_text = `От ${dailyRate} сом / день`;
  if (category === 'sale' && !record.price_text) throw new Error('Для продажи укажите цену или текст цены.');
  return record;
}
async function invoiceOrders(database, order) {
  if (!order?.order_group_id) return [order];
  const grouped = await database.listOrdersByGroupId(order.order_group_id).catch(() => []);
  return grouped.length ? grouped : [order];
}
async function mapWithConcurrency(items, limit, mapper) {
  const result = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length:Math.min(Math.max(1, limit), items.length) }, worker));
  return result;
}
function archaMessage(order, laptop, mode = 'issue') {
  const reference = String(order.id || '').slice(0, 8).toUpperCase();
  const location = mode === 'return' ? order.return_locker_address : order.locker_address;
  const title = mode === 'return' ? 'ВОЗВРАТ RENTOP.KG' : 'ВЫДАЧА RENTOP.KG';
  const asset = [laptop?.title || laptop?.name || '—', laptop?.serial_number ? `S/N ${laptop.serial_number}` : '', laptop?.inventory_code ? `Инв. ${laptop.inventory_code}` : ''].filter(Boolean).join(' · ');
  return `${title}\nЗаявка: ${reference}\nФИО: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\nПостамат: ${location || '—'}\nНоутбук: ${asset}\n${mode === 'return' ? 'Просим зарезервировать ячейку возврата и направить клиенту SMS-код доступа.' : `Срок аренды: ${order.rental_start_date || '—'} — ${order.rental_end_date || '—'}\nПросим зарезервировать ячейку и направить данные для закладки устройства.`}`;
}

export default async function handler(request, response) {
  let config;
  try { config = loadConfig(); } catch { return reply(response, 503, { error:'Панель менеджера временно настраивается.' }); }
  if (!config.customerOtpHmacSecret || !/^\+?996\d{9}$/.test(config.managerPhone)) return reply(response, 503, { error:'Для панели укажите RENTOP_MANAGER_PHONE в настройках Vercel.' });
  const database = createSupabaseApi(config);
  const raw = readCookie(request, COOKIE);
  const session = raw ? await database.getCabinetSession(hash(config.customerOtpHmacSecret, raw)) : null;
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date() || !samePhone(session.phone, config.managerPhone)) return reply(response, 401, { error:'Войдите в кабинет с номером менеджера.', code:'MANAGER_AUTH_REQUIRED' });
  const isChiefAdmin = samePhone(session.phone, config.adminManagerPhone);
  try {
    if (request.method === 'GET') {
      if (String(request.query?.access || '') === '1') return reply(response, 200, { manager:true });
      if (String(request.query?.catalog || '') === '1') {
        if (!isChiefAdmin) return reply(response, 403, { error:'Управление каталогом доступно только главному администратору.' });
        return reply(response, 200, { ok:true, catalog:await database.listCatalogLaptops() });
      }
      // The dashboard used to sign every attachment for up to fifty orders on
      // every refresh. That can mean hundreds of storage calls and makes the
      // whole panel look stuck. Documents are now signed only when opened.
      // Keep the first manager screen focused on the working queue. Promo and
      // B2B data are loaded only when their own section is opened; fetching
      // every auxiliary list delayed the queue noticeably on mobile networks.
      const include = new Set(String(request.query?.include || '').split(',').map(value => value.trim()));
      const [orders, rentableLaptops, promos, b2bLeads] = await Promise.all([
        // Keep enough history that abandoned drafts cannot push live work out
        // of the default queue; the client renders drafts in their own tab.
        database.listRecentOrders(40),
        database.listRentableLaptops(),
        include.has('promos') ? database.listRecentPromos().catch(() => []) : Promise.resolve(null),
        include.has('b2b') ? database.listB2BLeads().catch(() => []) : Promise.resolve(null)
      ]);
      // Fetch every related row in a small fixed number of requests. The old
      // dashboard made seven database reads for each order on every 5-second
      // refresh, which could starve the panel right after a document upload.
      const orderIds = orders.map(order => order.id);
      const [laptops, allDocuments, allRequests, allPayments, allSupportCases, returnHandoffEvents, testOrderEvents, allBenefits] = await Promise.all([
        database.listLaptopsByIds(orders.map(order => order.laptop_id)).catch(() => []),
        database.listOrderDocumentsForOrders(orderIds).catch(() => []),
        database.listCustomerRequestsForOrders(orderIds).catch(() => []),
        database.listOrderPaymentsForOrders(orderIds).catch(() => []),
        database.listOrderSupportCasesForOrders(orderIds).catch(() => []),
        database.listOrdersWithEvent(orderIds, 'manager_prepared_archa_return_handoff_from_web').catch(() => []),
        database.listOrdersWithEvent(orderIds, 'chief_admin_marked_test_order_from_web').catch(() => []),
        database.listBenefitVerificationsForPhones(orders.map(order => order.customer_phone)).catch(() => [])
      ]);
      const by = (items, key) => (items || []).reduce((map, item) => {
        const value = String(item?.[key] || '');
        if (!map.has(value)) map.set(value, []);
        map.get(value).push(item);
        return map;
      }, new Map());
      const laptopById = new Map((laptops || []).map(laptop => [String(laptop.id), laptop]));
      const documentsByOrder = by(allDocuments, 'order_id');
      const requestsByOrder = by(allRequests, 'order_id');
      const paymentsByOrder = by(allPayments, 'order_id');
      const supportCasesByOrder = by(allSupportCases, 'order_id');
      const benefitsByPhone = by(allBenefits, 'phone');
      const returnHandoffOrders = new Set((returnHandoffEvents || []).map(event => String(event.order_id)));
      const testOrderIds = new Set((testOrderEvents || []).map(event => String(event.order_id)));
      const hydrated = orders.map(order => {
        const laptop = laptopById.get(String(order.laptop_id));
        const documents = documentsByOrder.get(String(order.id)) || [];
        const requests = requestsByOrder.get(String(order.id)) || [];
        const payments = paymentsByOrder.get(String(order.id)) || [];
        const supportCases = supportCasesByOrder.get(String(order.id)) || [];
        const benefits = benefitsByPhone.get(String(order.customer_phone || '')) || [];
        return {
          ...order,
          laptop_title:laptop?.title || laptop?.name || 'Ноутбук Rentop',
          laptop_serial_number:laptop?.serial_number || '',
          laptop_inventory_code:laptop?.inventory_code || '',
          documents,
          requests,
          reservationPayment:payments.find(payment => payment.purpose === 'reservation') || null,
          balancePayment:payments.find(payment => payment.purpose === 'balance') || null,
          payment:payments.find(payment => payment.purpose === 'balance') || payments.find(payment => payment.purpose === 'rental') || payments.find(payment => payment.purpose === 'reservation') || null,
          payments,
          benefits,
          supportCases,
          is_test:testOrderIds.has(String(order.id)),
          returnHandoffPrepared:returnHandoffOrders.has(String(order.id))
        };
      });
      return reply(response, 200, {
        authenticated:true,
        managerPhone:session.phone,
        isChiefAdmin,
        orders:hydrated,
        rentableLaptops,
        ...(promos ? { promos } : {}),
        ...(b2bLeads ? { b2bLeads } : {})
      });
    }
    if (request.method !== 'POST') return reply(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action === 'test_manager_notification') {
      try {
        await createTelegramApi(config.telegramBotToken).sendMessage(
          config.adminChatId,
          `🔔 Проверка уведомлений Rentop\n\nСообщение отправлено из панели менеджера. Новые заявки будут приходить сюда сразу после создания.\n\nПанель: ${config.publicAppUrl}/manager`
        );
        return reply(response, 200, { ok:true, message:'Тест отправлен в Telegram. Проверьте чат Rentop.' });
      } catch (error) {
        console.error('Manager Telegram notification test failed:', error.message);
        return reply(response, 502, { error:'Telegram не принял тест. Проверьте токен бота, ID чата и что вы начали диалог с ботом.' });
      }
    }
    if (payload.action === 'update_b2b_lead') {
      const id = String(payload.leadId || '');
      const status = String(payload.status || '');
      const managerNote = String(payload.managerNote || '').trim().slice(0, 2000);
      if (!id || !['new', 'contacted', 'proposal_sent', 'contract', 'closed', 'lost'].includes(status)) return reply(response, 400, { error:'Укажите корректный статус B2B-заявки.' });
      const lead = await database.updateB2BLead(id, { status, manager_note:managerNote || null });
      if (!lead) return reply(response, 404, { error:'B2B-заявка не найдена.' });
      return reply(response, 200, { ok:true, lead, message:'Статус корпоративной заявки сохранён.' });
    }
    if (payload.action === 'save_catalog_laptop' || payload.action === 'set_catalog_visibility' || payload.action === 'create_catalog_image_upload') {
      if (!isChiefAdmin) return reply(response, 403, { error:'Управление каталогом доступно только главному администратору.' });
      if (payload.action === 'save_catalog_laptop') {
        const laptop = catalogPayload(payload);
        const laptopId = String(payload.laptopId || '');
        const saved = laptopId ? await database.updateLaptop(laptopId, laptop) : await database.createLaptop(laptop);
        if (!saved) return reply(response, 500, { error:'Не удалось сохранить модель.' });
        return reply(response, laptopId ? 200 : 201, { ok:true, laptop:saved, message:laptopId ? 'Карточка ноутбука обновлена.' : 'Ноутбук добавлен в каталог.' });
      }
      if (payload.action === 'set_catalog_visibility') {
        const laptopId = String(payload.laptopId || '');
        const laptop = await database.getLaptop(laptopId);
        if (!laptop) return reply(response, 404, { error:'Ноутбук не найден.' });
        const updated = await database.updateLaptop(laptopId, { is_visible:Boolean(payload.isVisible) });
        return reply(response, 200, { ok:true, laptop:updated, message:payload.isVisible ? 'Модель снова видна в каталоге.' : 'Модель скрыта из витрины. История заявок сохранена.' });
      }
      const contentType = String(payload.contentType || '').toLowerCase();
      const byteSize = Number(payload.byteSize);
      const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowedImageTypes.has(contentType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 8 * 1024 * 1024) return reply(response, 400, { error:'Загрузите JPG, PNG или WEBP до 8 МБ.' });
      const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const path = `catalog/${randomBytes(18).toString('hex')}.${extension}`;
      const signed = await database.createSignedCatalogImageUpload(path);
      const signedPath = signed?.url || signed?.signedURL || signed?.signedUrl;
      if (!signedPath || !signed?.token) throw new Error('Не удалось подготовить загрузку изображения.');
      const uploadUrl = signedPath.startsWith('http') ? signedPath : `${config.supabaseUrl}/storage/v1${signedPath}`;
      const publicUrl = `${config.supabaseUrl}/storage/v1/object/public/catalog-images/${path}`;
      return reply(response, 200, { ok:true, uploadUrl, token:signed.token, publicUrl });
    }
    if (payload.action === 'create_document_download') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const document = await database.getOrderDocument(String(payload.documentId || ''));
      if (!order || !document || String(document.order_id) !== String(order.id)) return reply(response, 404, { error:'Документ не найден.' });
      const signed = await database.createSignedDocumentDownload(document.storage_path);
      const path = signed?.signedURL || signed?.signedUrl || signed?.url || '';
      if (!path) return reply(response, 502, { error:'Не удалось подготовить защищённый просмотр документа.' });
      return reply(response, 200, { ok:true, viewUrl:path.startsWith('http') ? path : `${config.supabaseUrl}/storage/v1${path}`, fileName:document.file_name || 'Документ', contentType:document.content_type || '' });
    }
    if (payload.action === 'send_delivery_message') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const message = String(payload.message || '').trim().slice(0, 1500);
      if (!order || order.delivery_type !== 'delivery') return reply(response, 400, { error:'Сообщение о доставке доступно только для заявки с курьерской доставкой.' });
      if (message.length < 3) return reply(response, 400, { error:'Напишите клиенту сообщение хотя бы несколькими словами.' });
      const existingCases = await database.listOrderSupportCases(order.id);
      const existing = (existingCases || []).find(item => item.kind === 'delivery_status');
      const supportCase = existing
        ? await database.replyToSupportCase(order.id, 'delivery_status', message, session.phone)
        : await database.openSupportCase({ order_id:order.id, kind:'delivery_status', status:'open', customer_message:null, opened_at:new Date().toISOString(), opened_by:session.phone, manager_reply:message, replied_at:new Date().toISOString(), replied_by:session.phone });
      if (!supportCase) return reply(response, 502, { error:'Не удалось сохранить сообщение для клиента. Попробуйте ещё раз.' });
      await database.createEvent({ order_id:order.id, event_type:'manager_sent_delivery_message_from_web', actor_type:'manager', metadata:{ length:message.length } }).catch(error => console.error('Manager delivery message audit event failed:', error.message));
      return reply(response, 200, { ok:true, supportCase, message:'Сообщение сохранено — клиент увидит его в личном кабинете.' });
    }
    if (payload.action === 'reply_support_case') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const kind = String(payload.kind || '');
      const message = String(payload.message || '').trim().slice(0, 1500);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!['rentop','archa','archa_code_missing','archa_locker_issue','rental_issue','delivery_status','delivery_change','address_change','order_cancel'].includes(kind) || message.length < 3) return reply(response, 400, { error:'Напишите клиенту ответ хотя бы несколькими словами.' });
      const supportCase = await database.replyToSupportCase(order.id, kind, message, session.phone);
      if (!supportCase) return reply(response, 404, { error:'Обращение не найдено.' });
      await database.createEvent({ order_id:order.id, event_type:'manager_replied_support_case_from_web', actor_type:'manager', metadata:{ kind, length:message.length } }).catch(error => console.error('Manager support reply audit event failed:', error.message));
      return reply(response, 200, { ok:true, supportCase, message:'Ответ сохранён — клиент увидит его в личном кабинете.' });
    }
    if (payload.action === 'resolve_support_case') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const kind = String(payload.kind || '');
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!['rentop','archa','archa_code_missing','archa_locker_issue','rental_issue','delivery_status','delivery_change','address_change','order_cancel'].includes(kind)) return reply(response, 400, { error:'Некорректный тип обращения.' });
      const resolved = await database.resolveSupportCase(order.id, kind, session.phone);
      if (!resolved) return reply(response, 404, { error:'Открытое обращение не найдено.' });
      await database.createEvent({ order_id:order.id, event_type:'manager_resolved_support_case_from_web', actor_type:'manager', metadata:{ kind } }).catch(error => console.error('Manager support audit event failed:', error.message));
      return reply(response, 200, { ok:true, supportCase:resolved, message:'Обращение отмечено как решённое.' });
    }
    if (payload.action === 'offer_alternative_security' || payload.action === 'decide_alternative_security' || payload.action === 'settle_early_return') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (payload.action === 'offer_alternative_security') {
        if (!['pending_review', 'draft'].includes(order.status)) return reply(response, 409, { error:'Дополнительную проверку можно запросить только до выставления счёта.' });
        const requested = Array.isArray(payload.requirements) ? payload.requirements.map(value => String(value || '')).filter(value => ALTERNATIVE_SECURITY_REQUIREMENTS.has(value)) : [];
        const requirements = [...new Set(['alternative_security_video', ...requested])];
        const note = String(payload.note || '').trim().replace(/\s+/g, ' ').slice(0, 700);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const updated = await database.updateOrder(order.id, {
          alternative_security_status:'requested', alternative_security_requirements:requirements,
          alternative_security_note:note || null, alternative_security_expires_at:expiresAt,
          alternative_security_decided_at:null, alternative_security_decided_by:null
        });
        await database.createEvent({ order_id:order.id, event_type:'manager_requested_alternative_security_from_web', actor_type:'manager', metadata:{ requirements, expires_at:expiresAt, note:note || null, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:'Клиенту открыт защищённый этап дополнительной проверки на 24 часа.' });
      }
      if (payload.action === 'decide_alternative_security') {
        if (!['requested', 'submitted'].includes(order.alternative_security_status)) return reply(response, 409, { error:'По этой заявке сейчас нет активной дополнительной проверки.' });
        if (order.status !== 'pending_review') return reply(response, 409, { error:'Решение по залогу принимается до выставления счёта.' });
        const decision = String(payload.decision || '');
        const note = String(payload.note || '').trim().replace(/\s+/g, ' ').slice(0, 700);
        if (!['approved', 'rejected'].includes(decision) || note.length < 3) return reply(response, 400, { error:'Выберите решение и укажите короткий комментарий для журнала.' });
        if (decision === 'approved') {
          const requirements = Array.isArray(order.alternative_security_requirements) ? order.alternative_security_requirements : [];
          const documents = await database.listOrderDocuments(order.id);
          const latest = new Map(); for (const item of documents) if (!latest.has(item.kind)) latest.set(item.kind, item);
          const missing = requirements.filter(kind => latest.get(kind)?.status !== 'accepted');
          if (missing.length) return reply(response, 409, { error:'Сначала примите все запрошенные видео и документы дополнительной проверки.' });
        }
        const updated = await database.updateOrder(order.id, {
          alternative_security_status:decision, alternative_security_note:note,
          alternative_security_decided_at:new Date().toISOString(), alternative_security_decided_by:session.phone,
          ...(decision === 'approved' ? { deposit_amount:0 } : {})
        });
        await database.createEvent({ order_id:order.id, event_type:`manager_${decision}_alternative_security_from_web`, actor_type:'manager', metadata:{ note, manager_phone:session.phone, deposit_amount:decision === 'approved' ? 0 : order.deposit_amount } });
        return reply(response, 200, { ok:true, order:updated, message:decision === 'approved' ? 'Аренда без денежного залога одобрена. Теперь можно выставить счёт только за аренду и согласованные услуги.' : 'Дополнительная проверка отклонена. Согласуйте с клиентом обычный залог или иной вариант.' });
      }
      if (order.status !== 'completed') return reply(response, 409, { error:'Итог досрочного возврата фиксируется после физической приёмки и завершения аренды.' });
      const type = String(payload.settlementType || '');
      const amount = Number(payload.amount || 0);
      const note = String(payload.note || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
      if (!['freeze_days', 'partial_refund', 'no_compensation'].includes(type) || note.length < 3 || !Number.isFinite(amount) || amount < 0) return reply(response, 400, { error:'Выберите итог, укажите сумму (0, если нет выплаты) и пояснение для клиента.' });
      const updated = await database.updateOrder(order.id, { early_return_settlement_type:type, early_return_settlement_amount:amount, early_return_settlement_note:note, early_return_settled_at:new Date().toISOString(), early_return_settled_by:session.phone });
      await database.createEvent({ order_id:order.id, event_type:'manager_settled_early_return_from_web', actor_type:'manager', metadata:{ type, amount, note, manager_phone:session.phone } });
      return reply(response, 200, { ok:true, order:updated, message:'Итог досрочного возврата записан. Клиент увидит его в архиве заявки.' });
    }
    if (payload.action === 'save_order_registry') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      const rentalPurpose = String(payload.rentalPurpose || '').trim().replace(/\s+/g, ' ').slice(0, 600);
      const managerNote = String(payload.managerNote || '').trim().slice(0, 2000);
      const returnConditionNote = String(payload.returnConditionNote || '').trim().slice(0, 2000);
      const residenceAddress = String(payload.residenceAddress || '').trim().replace(/\s+/g, ' ').slice(0, 500);
      const supportingDocumentType = String(payload.supportingDocumentType || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const identityDocumentNumber = String(payload.identityDocumentNumber || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const identityDocumentIssuer = String(payload.identityDocumentIssuer || '').trim().replace(/\s+/g, ' ').slice(0, 240);
      const hasIdentityPair = Boolean(identityDocumentNumber) || Boolean(identityDocumentIssuer);
      if (hasIdentityPair && (identityDocumentNumber.length < 3 || identityDocumentIssuer.length < 3)) return reply(response, 400, { error:'Для проверки личности укажите и номер документа, и кем он выдан — строго по загруженному документу.' });
      const hasResidencePair = Boolean(residenceAddress) || Boolean(supportingDocumentType);
      if (hasResidencePair && (residenceAddress.length < 15 || !/\d/.test(residenceAddress) || supportingDocumentType.length < 3)) return reply(response, 400, { error:'Для адреса укажите полный адрес проживания (город, улица, номер дома) и выберите тип подтверждающего документа.' });
      const patch = { rental_purpose:rentalPurpose || null, manager_note:managerNote || null, return_condition_note:returnConditionNote || null, ...(hasResidencePair ? { residence_address:residenceAddress, supporting_document_type:supportingDocumentType } : {}) };
      if (hasIdentityPair) Object.assign(patch, { identity_document_number:identityDocumentNumber, identity_document_issuer:identityDocumentIssuer, identity_verified_at:new Date().toISOString(), identity_verified_by:session.phone });
      const updated = await database.updateOrder(order.id, patch);
      await database.createEvent({ order_id:order.id, event_type:'manager_updated_rental_registry_from_web', actor_type:'manager', metadata:{ has_residence_address:hasResidencePair, has_rental_purpose:Boolean(rentalPurpose), has_manager_note:Boolean(managerNote), has_return_condition_note:Boolean(returnConditionNote), identity_verified:hasIdentityPair } }).catch(error => console.error('Manager registry audit event failed:', error.message));
      return reply(response, 200, { ok:true, order:updated, message:'Сверка документов и внутренний реестр сохранены. После приёма обязательных файлов можно перейти к выставлению оплаты.' });
    }
    if (payload.action === 'issue_loyalty_promo') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const percent = Number(payload.discountPercent);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'completed') return reply(response, 409, { error:'Промокод лояльности можно выдать только после завершённой аренды.' });
      if (!order.customer_phone) return reply(response, 409, { error:'У этой аренды не указан номер клиента.' });
      if (![5, 10, 15, 20].includes(percent)) return reply(response, 400, { error:'Выберите скидку 5%, 10%, 15% или 20%.' });
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      let promo;
      for (let attempt = 0; attempt < 3 && !promo; attempt += 1) {
        const code = `RENTOP${percent}-${randomBytes(3).toString('hex').toUpperCase()}`;
        try { promo = await database.createPromo({ code, discount_percent:percent, status:'issued', issued_from_order_id:order.id, recipient_telegram_user_id:null, recipient_phone:order.customer_phone, expires_at:expiresAt }); } catch (error) { if (attempt === 2) throw error; }
      }
      await database.createEvent({ order_id:order.id, event_type:'manager_issued_loyalty_promo_from_web', actor_type:'manager', metadata:{ promo_id:promo?.id || null, discount_percent:percent, expires_at:expiresAt } }).catch(error => console.error('Manager promo audit event failed:', error.message));
      return reply(response, 201, { ok:true, promo, message:'Персональный промокод создан и появится в кабинете клиента.' });
    }
    if (payload.action === 'issue_personal_promo') {
      const phone = String(payload.phone || '').replace(/\D/g, '');
      const percent = Number(payload.discountPercent);
      if (!/^996\d{9}$/.test(phone)) return reply(response, 400, { error:'Укажите номер клиента Кыргызстана в формате +996XXXXXXXXX.' });
      if (![5, 10, 15, 20].includes(percent)) return reply(response, 400, { error:'Выберите скидку 5%, 10%, 15% или 20%.' });
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      let promo;
      for (let attempt = 0; attempt < 3 && !promo; attempt += 1) {
        const code = `RENTOP${percent}-${randomBytes(3).toString('hex').toUpperCase()}`;
        try { promo = await database.createPromo({ code, discount_percent:percent, status:'issued', issued_from_order_id:null, recipient_telegram_user_id:null, recipient_phone:`+${phone}`, expires_at:expiresAt }); } catch (error) { if (attempt === 2) throw error; }
      }
      return reply(response, 201, { ok:true, promo, message:'Персональный промокод создан на 30 дней и появится в кабинете клиента.' });
    }
    if (payload.action === 'revoke_personal_promo') {
      const promo = await database.revokePromo(String(payload.promoId || ''));
      if (!promo) return reply(response, 409, { error:'Промокод уже использован, отозван или не найден.' });
      return reply(response, 200, { ok:true, promo, message:'Промокод отозван. В новой заявке он больше не сработает.' });
    }
    if (payload.action === 'admin_close_rental_early' || payload.action === 'admin_cancel_unissued_order' || payload.action === 'admin_replace_pre_payment_laptop' || payload.action === 'admin_offer_pre_payment_replacement' || payload.action === 'admin_open_incident' || payload.action === 'admin_resolve_incident' || payload.action === 'admin_offer_incident_replacement' || payload.action === 'admin_update_laptop_asset') {
      if (!isChiefAdmin) return reply(response, 403, { error:'Это действие доступно только главному администратору.' });
      if (payload.action === 'admin_update_laptop_asset') {
        const laptopId = String(payload.laptopId || '');
        const serialNumber = String(payload.serialNumber || '').trim().replace(/\s+/g, ' ').slice(0, 160);
        const inventoryCode = String(payload.inventoryCode || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (!laptopId || (!serialNumber && !inventoryCode)) return reply(response, 400, { error:'Укажите заводской серийный номер или внутренний инвентарный код.' });
        const laptop = await database.getLaptop(laptopId);
        if (!laptop) return reply(response, 404, { error:'Ноутбук не найден.' });
        const updated = await database.updateLaptop(laptopId, { serial_number:serialNumber || null, inventory_code:inventoryCode || null });
        return reply(response, 200, { ok:true, laptop:updated, message:'Идентификаторы ноутбука сохранены. Они войдут в досье и сообщения ARCHA POINT.' });
      }
      const order = await database.getOrder(String(payload.orderId || ''));
      const reason = String(payload.reason || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (reason.length < 5) return reply(response, 400, { error:'Укажите понятную причину действия — минимум 5 символов.' });
      if (payload.action === 'admin_cancel_unissued_order') {
        if (!['draft','pending_review','awaiting_payment','payment_review','reserved','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status)) return reply(response, 409, { error:'Эта заявка уже выдана или закрыта. Для неё используйте обычный сценарий возврата.' });
        const updated = await database.updateOrder(order.id, { status:'cancelled', admin_note:`Отменена менеджером до начала аренды: ${reason}` });
        await database.createEvent({ order_id:order.id, event_type:'chief_admin_cancelled_unissued_order_from_web', actor_type:'chief_admin', metadata:{ reason, previous_status:order.status, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:'Заявка отменена и сохранена в истории. Она больше не считается готовой к выдаче.' });
      }
      if (payload.action === 'admin_replace_pre_payment_laptop') {
        if (!['draft','pending_review'].includes(order.status)) return reply(response, 409, { error:'Заменить модель автоматически можно только до выставления счёта. После QR или оплаты сначала согласуйте изменение с клиентом.' });
        const laptopId = Number(payload.laptopId);
        const replacement = await database.getLaptop(laptopId);
        if (!Number.isInteger(laptopId) || !replacement || replacement.category !== 'rent' || String(replacement.id) === String(order.laptop_id)) return reply(response, 400, { error:'Выберите другую доступную модель из аренды.' });
        const conflict = await database.findOverlappingBlockingOrder(order.id, replacement.id, order.rental_start_date, order.rental_end_date);
        if (conflict) return reply(response, 409, { error:`Эта модель занята на выбранные даты: заявка с ${conflict.rental_start_date}. Выберите другую.` });
        const rate = Number(replacement.daily_rate || replacement.dailyRate || replacement.dailyrate || 0);
        if (!Number.isFinite(rate) || rate <= 0) return reply(response, 409, { error:'У выбранной модели не указана корректная ставка аренды.' });
        const total = Math.round(Number(order.rental_days || 0) * rate * (100 - Number(order.discount_percent || 0)) / 100);
        const updated = await database.updateOrder(order.id, { laptop_id:replacement.id, daily_rate:rate, total_amount:total, admin_note:`Модель заменена до счёта: ${reason}` });
        await database.createEvent({ order_id:order.id, event_type:'chief_admin_replaced_pre_payment_laptop_from_web', actor_type:'chief_admin', metadata:{ previous_laptop_id:order.laptop_id, replacement_laptop_id:replacement.id, daily_rate:rate, total_amount:total, reason, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:`Модель заменена на «${replacement.title}». Сумма аренды пересчитана до счёта.` });
      }
      if (payload.action === 'admin_offer_pre_payment_replacement') {
        if (!['draft','pending_review'].includes(order.status)) return reply(response, 409, { error:'Предложить замену можно только до выставления счёта.' });
        const laptopId = Number(payload.laptopId);
        const replacement = await database.getLaptop(laptopId);
        if (!Number.isInteger(laptopId) || !replacement || replacement.category !== 'rent' || String(replacement.id) === String(order.laptop_id)) return reply(response, 400, { error:'Выберите другую доступную модель из аренды.' });
        const conflict = await database.findOverlappingBlockingOrder(order.id, replacement.id, order.rental_start_date, order.rental_end_date);
        if (conflict) return reply(response, 409, { error:'Эта модель занята на выбранные даты. Выберите вариант из доступного каталога.' });
        const rate = Number(replacement.daily_rate || replacement.dailyRate || replacement.dailyrate || 0);
        if (!Number.isFinite(rate) || rate <= 0) return reply(response, 409, { error:'У выбранной модели не указана корректная ставка аренды.' });
        const reason = String(payload.reason || '').trim().replace(/\s+/g, ' ').slice(0, 700) || 'Предлагаем доступную альтернативу на ваши даты.';
        const total = Math.round(Number(order.rental_days || 0) * rate * (100 - Number(order.discount_percent || 0)) / 100);
        const updated = await database.updateOrder(order.id, { prepayment_replacement_offer_laptop_id:replacement.id, prepayment_replacement_offer_reason:reason, prepayment_replacement_offer_total_amount:total, prepayment_replacement_offer_created_at:new Date().toISOString() });
        await database.createEvent({ order_id:order.id, event_type:'manager_offered_prepayment_replacement', actor_type:'chief_admin', metadata:{ previous_laptop_id:order.laptop_id, replacement_laptop_id:replacement.id, daily_rate:rate, total_amount:total, reason, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:`Клиенту отправлено предложение: «${replacement.title}» за ${total.toLocaleString('ru-RU')} сом. Заявка изменится только после его согласия.` });
      }
      if (payload.action === 'admin_open_incident') {
        if (['completed','cancelled','rejected'].includes(order.status)) return reply(response, 409, { error:'По завершённой или отменённой заявке инцидент не открывается.' });
        const updated = await database.updateOrder(order.id, { status:'incident', admin_note:`Инцидент: ${reason}` });
        await database.createEvent({ order_id:order.id, event_type:'chief_admin_opened_incident_from_web', actor_type:'chief_admin', metadata:{ reason, previous_status:order.status, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:'Инцидент открыт. Ноутбук остаётся заблокированным в учёте до разрешения ситуации.' });
      }
      if (payload.action === 'admin_resolve_incident') {
        if (order.status !== 'incident') return reply(response, 409, { error:'Разрешение доступно только для открытого инцидента.' });
        const outcome = String(payload.outcome || '');
        if (!['in_use','returned','cancelled'].includes(outcome)) return reply(response, 400, { error:'Выберите корректный результат инцидента.' });
        if (outcome === 'cancelled' && order.locker_loaded_at) return reply(response, 409, { error:'Нельзя отменить заявку после закладки ноутбука. Верните устройство или оставьте его в инциденте.' });
        if (outcome === 'returned') {
          const documents = await database.listOrderDocuments(order.id);
          const returnVideo = documents.find(document => document.kind === 'return_video');
          if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'До отметки возврата примите видео состояния устройства.' });
        }
        const updated = await database.updateOrder(order.id, { status:outcome, admin_note:`Инцидент разрешён: ${reason}` });
        await database.createEvent({ order_id:order.id, event_type:'chief_admin_resolved_incident_from_web', actor_type:'chief_admin', metadata:{ reason, outcome, manager_phone:session.phone } });
        return reply(response, 200, { ok:true, order:updated, message:'Инцидент разрешён, решение и причина записаны в журнал.' });
      }
      if (payload.action === 'admin_offer_incident_replacement') {
        if (order.status !== 'incident') return reply(response, 409, { error:'Замену по инциденту можно предложить только при открытом инциденте.' });
        const laptopId = Number(payload.replacementLaptopId);
        const method = String(payload.method || 'rentop_courier');
        const faultParty = String(payload.faultParty || 'rentop');
        if (!Number.isInteger(laptopId) || !['arca_locker', 'rentop_courier', 'customer_courier', 'self_delivery'].includes(method) || !['rentop', 'customer'].includes(faultParty)) return reply(response, 400, { error:'Выберите модель, способ передачи и сторону ответственности.' });
        const replacement = await database.getLaptop(laptopId);
        if (!replacement || replacement.category !== 'rent' || String(replacement.id) === String(order.laptop_id)) return reply(response, 400, { error:'Выберите другую доступную арендную модель.' });
        if (Number(replacement.daily_rate || 0) < Number(order.daily_rate || 0)) return reply(response, 409, { error:'Для замены доступна только равная или более дорогая модель.' });
        const today = new Intl.DateTimeFormat('en-CA', { timeZone:TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
        const conflict = await database.findOverlappingBlockingOrder(order.id, replacement.id, today, order.rental_end_date);
        if (conflict) return reply(response, 409, { error:`Эта модель занята с ${conflict.rental_start_date}. Выберите другую.` });
        const updated = await database.updateOrder(order.id, { replacement_pending_laptop_id:replacement.id, replacement_exchange_method:method, replacement_exchange_status:'awaiting_exchange', replacement_incident_reason:`${faultParty === 'rentop' ? 'По вине Rentop' : 'По вине клиента'}: ${reason}` });
        await database.createEvent({ order_id:order.id, event_type:'chief_admin_offered_incident_replacement_from_web', actor_type:'chief_admin', metadata:{ replacement_laptop_id:replacement.id, method, fault_party:faultParty, reason } });
        return reply(response, 200, { ok:true, order:updated, message:faultParty === 'rentop' ? 'Замена предложена за счёт Rentop. Подтвердите физическую передачу после обмена.' : 'Замена предложена. Условия доплаты и залога согласуйте с клиентом до физической передачи.' });
      }
      if (order.status !== 'returned') return reply(response, 409, { error:'Досрочно завершить можно только после физической приёмки ноутбука. Сначала проведите возврат в статус «Проверка возврата».' });
      const documents = await database.listOrderDocuments(order.id);
      const returnVideo = documents.find(document => document.kind === 'return_video');
      if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'Сначала примите видео состояния устройства при возврате. Это защищает Rentop и клиента.' });
      if (String(order.return_condition_note || '').trim().length < 3) return reply(response, 409, { error:'Сначала заполните состояние ноутбука после физического осмотра в реестре.' });
      const updated = await database.updateOrder(order.id, { status:'completed', admin_note:`Досрочно завершено: ${reason}` });
      await database.createEvent({ order_id:order.id, event_type:'chief_admin_closed_rental_early_from_web', actor_type:'chief_admin', metadata:{ reason, previous_status:order.status, manager_phone:session.phone } });
      return reply(response, 200, { ok:true, order:updated, message:'Аренда досрочно завершена и действие записано в журнал.' });
    }
    if (payload.action === 'review_document') {
      const state = String(payload.status || '');
      if (!allowedDocumentStates.has(state)) return reply(response, 400, { error:'Некорректный статус документа.' });
      const document = await database.getOrderDocument(String(payload.documentId || ''));
      if (!document) return reply(response, 404, { error:'Документ не найден.' });
      const note = String(payload.note || '').trim().slice(0, 500);
      const reviewed = await database.reviewOrderDocument(document.id, { status:state, reviewed_at:new Date().toISOString(), reviewer_note:note || null });
      await database.createEvent({ order_id:document.order_id, event_type:`manager_${state}_document_from_web`, actor_type:'manager', metadata:{ document_kind:document.kind, reviewer_note:note || null } }).catch(error => console.error('Manager document audit event failed:', error.message));
      let benefitMessage = '';
      if (document.kind === 'benefit_proof') {
        const verification = await database.getBenefitVerificationByDocument(document.id);
        if (verification) {
          const patch = state === 'accepted'
            ? { status:'approved', reviewer_note:note || null, approved_at:new Date().toISOString(), expires_at:null }
            : { status:'rejected', reviewer_note:note || 'Документ не подтверждает право на социальную скидку.' };
          await database.updateBenefitVerification(verification.id, patch);
          if (state === 'accepted') {
            const benefitOrder = await database.getOrder(document.order_id);
            // The amount may only change before payment is issued. A paid
            // order is a financial record and requires a manager decision.
            if (benefitOrder && ['draft','pending_review'].includes(benefitOrder.status)) {
              const discount = discountForTerm(benefitOrder.rental_days, true);
              const total = Math.round(Number(benefitOrder.rental_days || 0) * Number(benefitOrder.daily_rate || 0) * (100 - discount) / 100);
              if (Number(benefitOrder.discount_percent || 0) !== discount || Number(benefitOrder.total_amount || 0) !== total) {
                await database.updateOrder(benefitOrder.id, { discount_percent:discount, total_amount:total });
                await database.createEvent({ order_id:benefitOrder.id, event_type:'manager_applied_approved_social_discount_from_web', actor_type:'manager', metadata:{ discount_percent:discount, total_amount:total, benefit_type:verification.benefit_type } });
                benefitMessage = `Льгота 10% одобрена, сумма заявки пересчитана. Общая скидка: ${discount}%.`;
              } else benefitMessage = `Льгота 10% одобрена и уже учтена в сумме заявки. Общая скидка: ${discount}%.`;
            } else benefitMessage = 'Льгота одобрена. Для уже выставленного или оплаченного счёта изменение суммы согласуйте отдельно.';
          }
        }
      }
      let updatedOrder = null;
      if (state === 'accepted') {
        const documents = await database.listOrderDocuments(document.order_id);
        const latest = new Map();
        for (const item of documents) if (!latest.has(item.kind)) latest.set(item.kind, item);
        const identityFrontAccepted = latest.get('identity_front')?.status === 'accepted' || latest.get('identity')?.status === 'accepted';
        if (identityFrontAccepted && ['identity_back','selfie','supporting'].every(kind => latest.get(kind)?.status === 'accepted')) {
          const order = await database.getOrder(document.order_id);
          if (['draft','pending_review'].includes(order?.status)) {
            if (config.offerSmsConsentRequired && !order.offer_otp_verified_at) {
              await database.createEvent({ order_id:order.id, event_type:'manager_waiting_for_offer_sms_consent_from_web', actor_type:'manager', metadata:{} }).catch(() => {});
              return reply(response, 200, { ok:true, document:reviewed, order:null, message:'Документы приняты. Заявка ждёт, пока клиент подтвердит оферту кодом из SMS.' });
            }
            // Acceptance of files is deliberately not an approval for payment.
            // The manager must first save the ID registry fields and then use the
            // explicit "Перевести к оплате" transition below. This prevents an
            // incomplete identity check from being bypassed by the last document.
            updatedOrder = order;
            await database.createEvent({ order_id:order.id, event_type:'documents_accepted_waiting_identity_registry_from_web', actor_type:'manager', metadata:{} }).catch(error => console.error('Manager order audit event failed:', error.message));
          }
        }
      }
      return reply(response, 200, { ok:true, document:reviewed, order:updatedOrder, message:updatedOrder ? 'Документы приняты. Сверьте ID, сохраните реестр и только затем переведите заявку к оплате.' : benefitMessage });
    }
    if (payload.action === 'reject_all_documents') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const note = String(payload.note || '').trim().slice(0, 500);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (note.length < 3) return reply(response, 400, { error:'Укажите причину отклонения для клиента.' });
      const documents = await database.listOrderDocuments(order.id);
      const pending = documents.filter(document => document.status === 'pending_review');
      if (!pending.length) return reply(response, 409, { error:'В этой заявке нет документов на проверке.' });
      const reviewed = await Promise.all(pending.map(document => database.reviewOrderDocument(document.id, { status:'rejected', reviewed_at:new Date().toISOString(), reviewer_note:note })));
      await database.createEvent({ order_id:order.id, event_type:'manager_rejected_all_documents_from_web', actor_type:'manager', metadata:{ count:pending.length, reviewer_note:note } }).catch(error => console.error('Manager rejection audit event failed:', error.message));
      return reply(response, 200, { ok:true, documents:reviewed, note });
    }
    if (payload.action === 'mark_test_order') {
      if (!isChiefAdmin) return reply(response, 403, { error:'Помечать тестовые заявки может только главный администратор.' });
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (['awaiting_pickup','issued','in_use','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status)) return reply(response, 409, { error:'Нельзя пометить как тестовую заявку с выданным или активным ноутбуком.' });
      const alreadyMarked = await database.hasOrderEvent(order.id, 'chief_admin_marked_test_order_from_web');
      if (!alreadyMarked) await database.createEvent({ order_id:order.id, event_type:'chief_admin_marked_test_order_from_web', actor_type:'chief_admin', metadata:{ manager_phone:session.phone } });
      return reply(response, 200, { ok:true, message:'Заявка помечена как тестовая. Теперь её можно удалить отдельным действием.' });
    }
    if (payload.action === 'archive_draft_order') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'draft') return reply(response, 409, { error:'Отложить можно только незавершённую заявку без документов.' });
      const documents = await database.listOrderDocuments(order.id);
      if (documents.length) return reply(response, 409, { error:'В заявке уже есть документы: она вернётся в рабочую очередь.' });
      const updated = await database.updateOrder(order.id, { draft_archived_at:new Date().toISOString(), draft_archived_by:session.phone });
      await database.createEvent({ order_id:order.id, event_type:'manager_archived_draft_until_documents_from_web', actor_type:'manager', metadata:{ manager_phone:session.phone } });
      return reply(response, 200, { ok:true, order:updated, message:'Заявка отложена до загрузки документов. После загрузки она сама вернётся в рабочую очередь.' });
    }
    if (payload.action === 'delete_test_order') {
      if (!isChiefAdmin) return reply(response, 403, { error:'Удалять тестовые заявки может только главный администратор.' });
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка уже удалена или не найдена.' });
      const expectedReference = String(order.id).slice(0, 8).toUpperCase();
      if (String(payload.confirmation || '').trim().toUpperCase() !== expectedReference) return reply(response, 400, { error:`Для удаления введите номер заявки: ${expectedReference}` });
      const markedTest = await database.hasOrderEvent(order.id, 'chief_admin_marked_test_order_from_web');
      if (!markedTest) return reply(response, 409, { error:'Сначала явно пометьте эту заявку как тестовую.' });
      if (['awaiting_pickup','issued','in_use','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status)) return reply(response, 409, { error:'Нельзя удалить заявку с выданным или активным ноутбуком.' });
      const documents = await database.listOrderDocuments(order.id);
      await Promise.all(documents.map(document => document.storage_path ? database.deleteDocumentFile(document.storage_path).catch(error => console.error('Test document storage cleanup failed:', error.message)) : Promise.resolve()));
      await database.deleteOrder(order.id);
      return reply(response, 200, { ok:true, message:'Тестовая заявка и её прикреплённые файлы удалены.' });
    }
    if (payload.action === 'check_bakai_connection') {
      await verifyBakaiToken(config);
      return reply(response, 200, { ok:true, message:'Токен Bakai сохранён. Для проверки доступа создайте тестовый QR на 1 сом.' });
    }
    if (payload.action === 'advance_order') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const nextStatus = String(payload.nextStatus || '');
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!statusTransitions[order.status]?.includes(nextStatus)) return reply(response, 409, { error:'Этот переход недоступен для текущего статуса заявки.' });
      if (nextStatus === 'awaiting_payment') {
        const documents = await database.listOrderDocuments(order.id);
        const latest = new Map();
        for (const item of documents) if (!latest.has(item.kind)) latest.set(item.kind, item);
        const identityFrontAccepted = latest.get('identity_front')?.status === 'accepted' || latest.get('identity')?.status === 'accepted';
        if (!identityFrontAccepted || !['identity_back','selfie','supporting'].every(kind => latest.get(kind)?.status === 'accepted')) return reply(response, 409, { error:'Сначала примите все четыре обязательных документа клиента.' });
        if (latest.get('benefit_proof')?.status === 'pending_review') return reply(response, 409, { error:'Клиент запросил социальную скидку. Сначала примите или отклоните льготный документ — сумма должна быть окончательно рассчитана до выставления счёта.' });
        if (String(order.residence_address || '').trim().length < 8 || String(order.supporting_document_type || '').trim().length < 3) return reply(response, 409, { error:'До оплаты клиент должен указать адрес проживания и загрузить обязательное подтверждение адреса, работы или учёбы.' });
        if (String(order.identity_document_number || '').trim().length < 3 || String(order.identity_document_issuer || '').trim().length < 3 || !order.identity_verified_at) return reply(response, 409, { error:'Сначала сверьте паспорт/ID по файлам и сохраните в реестре номер документа и кем он выдан.' });
        if (['requested', 'submitted'].includes(order.alternative_security_status)) return reply(response, 409, { error:'Сначала примите решение по дополнительной проверке без залога.' });
      }
      if (['returned', 'completed'].includes(nextStatus)) {
        const documents = await database.listOrderDocuments(order.id);
        const returnVideo = documents.find(document => document.kind === 'return_video');
        if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'До завершения возврата менеджер должен принять видео состояния устройства.' });
      }
      if (nextStatus === 'completed' && String(order.return_condition_note || '').trim().length < 3) return reply(response, 409, { error:'После физического осмотра заполните в реестре «Состояние при возврате» и сохраните его. Затем завершите аренду.' });
      const patch = nextStatus === 'awaiting_payment'
        ? { status:nextStatus, hold_expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        : { status:nextStatus };
      const groupedOrders = nextStatus === 'awaiting_payment' ? await invoiceOrders(database, order) : [order];
      let updated = order;
      for (const item of groupedOrders) {
        if (item.status !== order.status && item.status !== 'draft' && item.status !== 'pending_review') continue;
        const changed = await database.updateOrder(item.id, patch);
        if (String(item.id) === String(order.id)) updated = changed || item;
        await database.createEvent({ order_id:item.id, event_type:`manager_changed_status_to_${nextStatus}_from_web`, actor_type:'manager', metadata:{ previous_status:item.status, order_group_id:order.order_group_id || null } }).catch(error => console.error('Manager transition audit event failed:', error.message));
      }
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'complete_return_acceptance') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const returnConditionNote = String(payload.returnConditionNote || '').trim().replace(/\s+/g, ' ').slice(0, 2000);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'returned') return reply(response, 409, { error:'Акт приёма доступен только после фактического получения ноутбука.' });
      if (returnConditionNote.length < 3) return reply(response, 400, { error:'Опишите состояние ноутбука после физического осмотра: корпус, экран, зарядка и комплектность.' });
      const documents = await database.listOrderDocuments(order.id);
      const returnVideo = documents.find(document => document.kind === 'return_video');
      if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'Сначала примите видео возврата. Затем проверьте ноутбук физически.' });
      const returnedAt = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'completed', return_condition_note:returnConditionNote, returned_at:returnedAt });
      const returnRequests = (await database.listCustomerRequests(order.id)).filter(request => request.kind === 'early_return' && ['open','in_progress'].includes(request.status));
      await Promise.all(returnRequests.map(request => database.updateCustomerRequest(request.id, { status:'resolved', resolved_at:returnedAt })));
      await database.createEvent({ order_id:order.id, event_type:'manager_completed_return_with_acceptance_act_from_web', actor_type:'manager', metadata:{ previous_status:order.status, return_condition_note:returnConditionNote, accepted_at:returnedAt, manager_phone:session.phone, resolved_return_requests:returnRequests.map(request => request.id) } });
      return reply(response, 200, { ok:true, order:updated, message:'Приём ноутбука и акт зафиксированы. Аренда завершена.' });
    }
    if (payload.action === 'prepare_archa_handoff') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.delivery_type !== 'arca_locker') return reply(response, 400, { error:'Эта заявка не использует ARCHA POINT.' });
      // The bank webhook and the order status are written independently.  A
      // successfully paid QR must not leave an ARCHA order stuck just because
      // its status update was delayed or missed after the payment arrived.
      // Extension payments do not authorise issuing the original order.
      const payments = await database.listOrderPayments(order.id).catch(() => []);
      const hasPaidRental = payments.some(payment => payment.status === 'paid' && ['rental', 'balance'].includes(payment.purpose || 'rental'));
      if (order.status !== 'confirmed' && !hasPaidRental) return reply(response, 409, { error:'Заявку можно передать в ARCHA POINT только после подтверждения оплаты.' });
      const laptop = await database.getLaptop(order.laptop_id);
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_archa_reservation', locker_status:'reservation_requested', archa_handoff_sent_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_prepared_archa_issue_handoff_from_web', actor_type:'manager', metadata:{ locker:order.locker_address, recovered_from_stale_payment_status:order.status !== 'confirmed' && hasPaidRental } });
      return reply(response, 200, { ok:true, order:updated, message:archaMessage(order, laptop) });
    }
    if (payload.action === 'record_archa_reservation') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const loadingCode = String(payload.loadingCode || '').trim().slice(0, 200);
      const reference = String(payload.reference || '').trim().slice(0, 200);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status === 'awaiting_locker_loading' || order.status === 'awaiting_pickup') return reply(response, 200, { ok:true, order, message:'Код закладки уже сохранён. Продолжайте со следующим этапом — фактической закладкой ноутбука.' });
      if (order.status !== 'awaiting_archa_reservation') return reply(response, 409, { error:'Для этой заявки сейчас не ожидается резервирование ячейки. Обновите панель: возможно, предыдущий клик уже сохранил этап.' });
      if (loadingCode.length < 3) return reply(response, 400, { error:'Введите код закладки от ARCHA POINT.' });
      const updated = await database.updateOrder(order.id, { status:'awaiting_locker_loading', locker_status:'reserved', locker_loading_code:loadingCode, locker_loading_reference:reference || null });
      await database.createEvent({ order_id:order.id, event_type:'manager_recorded_archa_reservation_from_web', actor_type:'manager', metadata:{ has_reference:Boolean(reference) } });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'mark_locker_loaded') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status === 'awaiting_pickup') return reply(response, 200, { ok:true, order, message:'Закладка уже отмечена. Ожидайте отправку кода доступа клиенту.' });
      if (order.status !== 'awaiting_locker_loading') return reply(response, 409, { error:'Сначала получите и сохраните код закладки ARCHA POINT. Если уже сохранили, обновите панель — этап не нужно повторять.' });
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_pickup', locker_status:'loaded', locker_loaded_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_marked_locker_loaded_from_web', actor_type:'manager', metadata:{} });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'mark_delivery_dispatched') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const dispatchMode = ['rentop_courier','third_party_courier'].includes(String(payload.dispatchMode || '')) ? String(payload.dispatchMode) : '';
      if (!order || order.delivery_type !== 'delivery') return reply(response, 400, { error:'Эта заявка не использует доставку курьером.' });
      if (order.status === 'awaiting_pickup' && order.locker_status === 'delivery_dispatched') return reply(response, 200, { ok:true, order, message:'Передача курьеру уже отмечена. Клиенту доступна видеофиксация и подтверждение фактического получения.' });
      if (order.status !== 'confirmed') return reply(response, 409, { error:'Передачу курьеру можно отметить только после подтверждения оплаты.' });
      if (!dispatchMode) return reply(response, 400, { error:'Выберите способ доставки: курьер Rentop или сторонняя служба.' });
      if (String(order.delivery_address || '').trim().length < 8 || String(order.delivery_preferred_time || '').trim().length < 3) return reply(response, 409, { error:'В заявке нет полного адреса или желаемого времени доставки. Уточните их у клиента перед передачей курьеру.' });
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_pickup', locker_status:'delivery_dispatched', locker_loaded_at:now, delivery_dispatch_mode:dispatchMode, delivery_dispatched_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_marked_delivery_dispatched_from_web', actor_type:'manager', metadata:{ delivery_address:order.delivery_address, preferred_time:order.delivery_preferred_time, dispatch_mode:dispatchMode } });
      return reply(response, 200, { ok:true, order:updated, message:dispatchMode === 'third_party_courier' ? 'Передача стороннему курьеру отмечена. Клиент увидит статус «Ноутбук в пути» и подтвердит получение после передачи.' : 'Передача курьеру Rentop отмечена. Клиент увидит статус «Ноутбук в пути» и подтвердит получение после передачи.' });
    }
    if (payload.action === 'mark_archa_access_sent' || payload.action === 'send_manual_pickup_code') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.delivery_type !== 'arca_locker' || order.status !== 'awaiting_pickup') return reply(response, 409, { error:'Код ARCHA POINT доступен только для выдачи через постамат после закладки ноутбука.' });
      const now = new Date().toISOString();
      let patch = { locker_status:'access_sent', customer_access_sent_at:now };
      if (payload.action === 'send_manual_pickup_code') {
        const code = String(payload.code || '').trim().slice(0, 120);
        if (code.length < 3) return reply(response, 400, { error:'Введите код доступа, полученный у ARCHA POINT.' });
        if (!config.nikitaSms.enabled) return reply(response, 503, { error:'Nikita SMS не настроен: нельзя безопасно отправить ручной код клиенту.' });
        await createNikitaSmsClient(config.nikitaSms).send({ phone:order.customer_phone, text:`RENTOP.KG: код доступа к постамату ARCHA POINT: ${code}. Не передавайте его третьим лицам.` });
        patch = { ...patch, pickup_pin:code };
      }
      const updated = await database.updateOrder(order.id, patch);
      await database.createEvent({ order_id:order.id, event_type:payload.action === 'send_manual_pickup_code' ? 'manager_sent_manual_archa_pickup_code_from_web' : 'manager_confirmed_archa_pickup_sms_from_web', actor_type:'manager', metadata:{} });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'prepare_archa_return_handoff') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_return_reservation' || !['arca_locker', 'arca_courier'].includes(order.return_method)) return reply(response, 409, { error:'Нет активного запроса на возврат через постамат.' });
      const laptop = await database.getLaptop(order.laptop_id);
      await database.createEvent({ order_id:order.id, event_type:'manager_prepared_archa_return_handoff_from_web', actor_type:'manager', metadata:{ locker:order.return_locker_address } });
      return reply(response, 200, { ok:true, message:archaMessage(order, laptop, 'return') });
    }
    if (payload.action === 'save_return_handoff') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_return_collection' || !['customer_courier','self_delivery'].includes(order.return_method)) return reply(response, 409, { error:'Адрес приёма нужен только для самопривоза или курьерской службы клиента на этапе согласования возврата.' });
      const destinationAddress = String(payload.destinationAddress || '').trim().slice(0, 500);
      const destinationNote = String(payload.destinationNote || '').trim().slice(0, 1000);
      if (destinationAddress.length < 8) return reply(response, 400, { error:'Укажите полный адрес приёма — не менее 8 символов.' });
      const updated = await database.updateOrder(order.id, { return_destination_address:destinationAddress, return_destination_note:destinationNote || null });
      const openRequest = (await database.listCustomerRequests(order.id)).find(item => item.kind === 'early_return' && item.status === 'open');
      if (openRequest) await database.updateCustomerRequest(openRequest.id, { return_destination_address:destinationAddress, return_destination_note:destinationNote || null });
      await database.createEvent({ order_id:order.id, event_type:'manager_saved_return_handoff_destination_from_web', actor_type:'manager', metadata:{ return_method:order.return_method, has_note:Boolean(destinationNote) } });
      return reply(response, 200, { ok:true, order:updated, message:'Адрес приёма сохранён и уже виден клиенту в личном кабинете.' });
    }
    if (payload.action === 'confirm_return_collected') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_return_collection') return reply(response, 409, { error:'Эта заявка сейчас не ожидает физического получения.' });
      const documents = await database.listOrderDocuments(order.id);
      const returnVideo = documents.find(document => document.kind === 'return_video');
      if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'Сначала откройте и примите видео возврата.' });
      if (['customer_courier','self_delivery'].includes(order.return_method) && String(order.return_destination_address || '').trim().length < 8) return reply(response, 409, { error:'Сначала сообщите клиенту адрес приёма и инструкции для передачи ноутбука.' });
      const returnedAt = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'returned', returned_at:returnedAt });
      await database.createEvent({ order_id:order.id, event_type:'manager_confirmed_physical_return_collection_from_web', actor_type:'manager', metadata:{ return_method:order.return_method, manager_phone:session.phone } });
      return reply(response, 200, { ok:true, order:updated, message:'Физическое получение отмечено. Теперь проведите итоговый осмотр и акт.' });
    }
    if (payload.action === 'mark_return_access_sent') {
      return reply(response, 409, { error:'Код возврата ARCHA POINT отправляет напрямую клиенту. Этап видео откроет сам клиент после получения SMS.' });
    }
    if (payload.action === 'confirm_archa_courier_return_dropoff') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_return_dropoff' || order.return_method !== 'arca_courier' || order.locker_status !== 'return_courier_code_sent') return reply(response, 409, { error:'Подтверждение доступно только после отправки кода назначенному курьеру.' });
      const documents = await database.listOrderDocuments(order.id);
      const returnVideo = documents.find(document => document.kind === 'return_video');
      if (!returnVideo || returnVideo.status === 'rejected') return reply(response, 409, { error:'Сначала дождитесь загруженного, не отклонённого видео состояния ноутбука от клиента.' });
      const returnedAt = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'returned', locker_status:'returned_by_courier', returned_at:returnedAt });
      await database.createEvent({ order_id:order.id, event_type:'manager_confirmed_archa_courier_return_dropoff_from_web', actor_type:'manager', metadata:{ manager_phone:session.phone } });
      return reply(response, 200, { ok:true, order:updated, message:'Помещение в ячейку отмечено. Заберите ноутбук из постамата и проведите итоговый осмотр перед актом.' });
    }
    if (payload.action === 'send_manual_return_code') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const code = String(payload.code || '').trim().slice(0, 120);
      const courierPhone = String(payload.courierPhone || '').trim().slice(0, 40);
      if (!order || order.status !== 'awaiting_return_reservation' || !['arca_locker','arca_courier'].includes(order.return_method)) return reply(response, 409, { error:'Резервный код доступен только для возврата через ARCHA POINT, ожидающего ячейку.' });
      if (code.length < 3) return reply(response, 400, { error:'Введите код возврата, подтверждённый у ARCHA POINT.' });
      if (order.return_method === 'arca_courier' && courierPhone.replace(/\D/g, '').length < 10) return reply(response, 400, { error:'Укажите полный номер фактически назначенного курьера.' });
      if (!config.nikitaSms.enabled) return reply(response, 503, { error:'Nikita SMS не настроен: нельзя безопасно отправить резервный код клиенту.' });
      const recipient = order.return_method === 'arca_courier' ? courierPhone : order.customer_phone;
      await createNikitaSmsClient(config.nikitaSms).send({ phone:recipient, text:`RENTOP.KG: резервный код возврата в постамат ARCHA POINT: ${code}. Используйте его только для возврата по заявке ${String(order.id).slice(0, 8).toUpperCase()}. Не передавайте код третьим лицам.` });
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, order.return_method === 'arca_courier'
        ? { status:'awaiting_return_dropoff', locker_status:'return_courier_code_sent', return_access_code:code, return_access_sent_at:now, return_contact_phone:courierPhone }
        : { locker_status:'return_access_sent', return_access_code:code, return_access_sent_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_sent_manual_archa_return_code_from_web', actor_type:'manager', metadata:{ recipient:'arca_courier' === order.return_method ? 'courier' : 'customer' } });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'create_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'awaiting_payment') return reply(response, 409, { error:'QR можно создать только для заявки, ожидающей оплату.' });
      const groupedOrders = await invoiceOrders(database, order);
      if (groupedOrders.some(item => item.status !== 'awaiting_payment')) return reply(response, 409, { error:'Не все ноутбуки в этом заказе готовы к оплате. Сначала завершите проверку документов по каждой позиции.' });
      const groupPayments = (await Promise.all(groupedOrders.map(item => database.getOrderPayment(item.id).catch(() => null)))).filter(Boolean);
      const existing = groupPayments.find(item => item.status === 'paid');
      if (existing) return reply(response, 409, { error:'Этот заказ уже оплачен.' });
      const activeInvoice = groupPayments.find(item => item.status === 'awaiting_payment' && new Date(item.expires_at) > new Date());
      if (activeInvoice) return reply(response, 409, { error:'Для этого заказа уже создан активный QR. Сначала отзовите его, если нужен новый счёт.' });
      const defaultRentalAmount = groupedOrders.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
      const defaultDepositAmount = groupedOrders.reduce((sum, item) => sum + Number(item.deposit_amount || 0), 0);
      const hasSeparateAmounts = Object.prototype.hasOwnProperty.call(payload, 'rentalAmount') || Object.prototype.hasOwnProperty.call(payload, 'depositAmount');
      const legacyCombinedAmount = Number(payload.amount || defaultRentalAmount + defaultDepositAmount);
      const rentalAmount = hasSeparateAmounts ? Number(payload.rentalAmount ?? defaultRentalAmount) : Math.max(0, legacyCombinedAmount - defaultDepositAmount);
      const depositAmount = hasSeparateAmounts ? Number(payload.depositAmount ?? defaultDepositAmount) : Math.min(defaultDepositAmount, legacyCombinedAmount);
      const rentalAndDepositAmount = hasSeparateAmounts ? rentalAmount + depositAmount : legacyCombinedAmount;
      const deliveryChargeMode = order.delivery_type === 'delivery' && payload.deliveryChargeMode === 'rentop' ? 'rentop' : 'external';
      const deliveryFee = deliveryChargeMode === 'rentop' ? Number(payload.deliveryFee || 0) : 0;
      if (!Number.isFinite(rentalAmount) || rentalAmount < 0 || !Number.isFinite(depositAmount) || depositAmount < 0) return reply(response, 400, { error:'Укажите корректные суммы аренды и возвратного залога.' });
      if (!Number.isFinite(deliveryFee) || deliveryFee < 0 || deliveryFee > 100_000) return reply(response, 400, { error:'Укажите корректную стоимость доставки.' });
      const amount = rentalAndDepositAmount + deliveryFee;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return reply(response, 400, { error:'Укажите корректную сумму оплаты.' });
      const operationId = makePaymentOperationId(order.id);
      const reference = String(order.id).slice(0, 8).toUpperCase();
      const comment = `Rentop ${reference}${groupedOrders.length > 1 ? ` · ${groupedOrders.length} laptops` : ''}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
      const itemBreakdown = groupedOrders.map(item => ({ order_id:item.id, laptop_id:item.laptop_id, rental_amount:Number(item.total_amount || 0), deposit_amount:Number(item.deposit_amount || 0) }));
      const payment = await database.createOrderPayment({
        order_id:order.id,
        provider:'bakai',
        operation_id:operationId,
        amount,
        currency_id:417,
        comment,
        qr_image:qr.qrImage || null,
        qr_image_with_frame:qr.qrImageWithFrame || null,
        qr_link:qr.qrLink || null,
        bank_payload:{ source:'manager_invoice', breakdown:{ rental_amount:rentalAmount, deposit_amount:depositAmount, rental_and_deposit_amount:rentalAndDepositAmount, delivery_fee:deliveryFee, delivery_charge_mode:deliveryChargeMode, items:itemBreakdown, order_group_id:order.order_group_id || null, order_ids:groupedOrders.map(item => item.id) } },
        status:'awaiting_payment',
        expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      await Promise.all(groupedOrders.map(item => database.createEvent({ order_id:item.id, event_type:'bakai_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount, rental_amount:rentalAmount, deposit_amount:depositAmount, rental_and_deposit_amount:rentalAndDepositAmount, delivery_fee:deliveryFee, delivery_charge_mode:deliveryChargeMode, order_group_id:order.order_group_id || null, order_ids:groupedOrders.map(grouped => grouped.id) } }).catch(error => console.error('Bakai payment audit event failed:', error.message))));
      return reply(response, 201, { ok:true, payment });
    }
    if (payload.action === 'create_reservation_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_payment') return reply(response, 409, { error:'Предоплату можно выставить только после проверки документов и до полной оплаты.' });
      const groupedOrders = await invoiceOrders(database, order);
      if (groupedOrders.some(item => item.status !== 'awaiting_payment')) return reply(response, 409, { error:'Не все позиции заказа готовы к предоплате.' });
      const groupPayments = (await Promise.all(groupedOrders.map(item => database.listOrderPayments(item.id).catch(() => [])))).flat();
      if (groupPayments.some(item => item.purpose === 'reservation' && item.status === 'paid')) return reply(response, 409, { error:'Предоплата по этому заказу уже подтверждена.' });
      if (groupPayments.some(item => item.status === 'awaiting_payment' && new Date(item.expires_at) > new Date())) return reply(response, 409, { error:'Для этого заказа уже есть активный QR. Отзовите его перед созданием нового.' });
      const rentalTotal = groupedOrders.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
      const oneDayRate = groupedOrders.reduce((sum, item) => sum + Number(item.daily_rate || 0), 0);
      const amount = Number(payload.amount ?? Math.min(rentalTotal, oneDayRate || rentalTotal));
      if (!Number.isFinite(amount) || amount <= 0 || amount > rentalTotal) return reply(response, 400, { error:'Предоплата должна быть больше нуля и не превышать стоимость аренды.' });
      const operationId = makePaymentOperationId(order.id);
      const comment = `Rentop reservation ${String(order.id).slice(0, 8).toUpperCase()}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
      const payment = await database.createOrderPayment({ order_id:order.id, purpose:'reservation', provider:'bakai', operation_id:operationId, amount, currency_id:417, comment, qr_image:qr.qrImage || null, qr_image_with_frame:qr.qrImageWithFrame || null, qr_link:qr.qrLink || null, bank_payload:{ source:'manager_reservation_invoice', breakdown:{ rental_amount:rentalTotal, reservation_amount:amount, remaining_rental_amount:Math.max(0, rentalTotal - amount), items:groupedOrders.map(item => ({ order_id:item.id, laptop_id:item.laptop_id, rental_amount:Number(item.total_amount || 0) })), order_group_id:order.order_group_id || null, order_ids:groupedOrders.map(item => item.id) } }, status:'awaiting_payment', expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      await Promise.all(groupedOrders.map(item => database.createEvent({ order_id:item.id, event_type:'bakai_reservation_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount, order_group_id:order.order_group_id || null } })));
      return reply(response, 201, { ok:true, payment });
    }
    if (payload.action === 'create_balance_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'reserved') return reply(response, 409, { error:'Доплату можно выставить только по оплаченной брони.' });
      const groupedOrders = await invoiceOrders(database, order);
      if (groupedOrders.some(item => item.status !== 'reserved')) return reply(response, 409, { error:'Не все позиции заказа находятся в статусе брони.' });
      const allPayments = (await Promise.all(groupedOrders.map(item => database.listOrderPayments(item.id).catch(() => [])))).flat();
      const reservation = allPayments.find(item => item.purpose === 'reservation' && item.status === 'paid');
      if (!reservation) return reply(response, 409, { error:'Подтверждённая предоплата по заказу не найдена.' });
      if (allPayments.some(item => item.purpose === 'balance' && item.status === 'paid')) return reply(response, 409, { error:'Остаток по этому заказу уже оплачен.' });
      if (allPayments.some(item => item.purpose === 'balance' && item.status === 'awaiting_payment' && new Date(item.expires_at) > new Date())) return reply(response, 409, { error:'QR доплаты уже создан.' });
      const rentalTotal = groupedOrders.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
      const depositAmount = Number(payload.depositAmount ?? groupedOrders.reduce((sum, item) => sum + Number(item.deposit_amount || 0), 0));
      const deliveryChargeMode = order.delivery_type === 'delivery' && payload.deliveryChargeMode === 'rentop' ? 'rentop' : 'external';
      const deliveryFee = deliveryChargeMode === 'rentop' ? Number(payload.deliveryFee || 0) : 0;
      const rentalBalance = Math.max(0, rentalTotal - Number(reservation.amount || 0));
      const amount = rentalBalance + depositAmount + deliveryFee;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || !Number.isFinite(depositAmount) || depositAmount < 0 || !Number.isFinite(deliveryFee) || deliveryFee < 0) return reply(response, 400, { error:'Проверьте сумму остатка, залога и доставки.' });
      const operationId = makePaymentOperationId(order.id);
      const comment = `Rentop balance ${String(order.id).slice(0, 8).toUpperCase()}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
      const payment = await database.createOrderPayment({ order_id:order.id, purpose:'balance', provider:'bakai', operation_id:operationId, amount, currency_id:417, comment, qr_image:qr.qrImage || null, qr_image_with_frame:qr.qrImageWithFrame || null, qr_link:qr.qrLink || null, bank_payload:{ source:'manager_balance_invoice', breakdown:{ rental_amount:rentalBalance, reservation_amount:Number(reservation.amount || 0), deposit_amount:depositAmount, delivery_fee:deliveryFee, delivery_charge_mode:deliveryChargeMode, order_group_id:order.order_group_id || null, order_ids:groupedOrders.map(item => item.id) } }, status:'awaiting_payment', expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      await Promise.all(groupedOrders.map(item => database.createEvent({ order_id:item.id, event_type:'bakai_balance_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount, reservation_amount:Number(reservation.amount || 0), order_group_id:order.order_group_id || null } })));
      return reply(response, 201, { ok:true, payment });
    }
    if (payload.action === 'create_extension_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const requestId = String(payload.requestId || '');
      if (!order || !['issued', 'in_use'].includes(order.status)) return reply(response, 409, { error:'Продление можно оплатить только для активной аренды.' });
      const extension = (await database.listCustomerRequests(order.id)).find(item => item.id === requestId && ['extension', 'replacement'].includes(item.kind) && ['open', 'in_progress'].includes(item.status));
      if (!extension) return reply(response, 404, { error:'Активный запрос продления не найден.' });
      const targetLaptopId = extension.kind === 'replacement' ? extension.replacement_laptop_id : order.laptop_id;
      const conflict = await database.findOverlappingBlockingOrder(order.id, targetLaptopId, order.rental_end_date, extension.proposed_return_date);
      if (conflict) return reply(response, 409, { error:`Ноутбук уже занят с ${conflict.rental_start_date}; продление нельзя оплатить.` });
      const active = (await database.listOrderPayments(order.id)).find(item => item.purpose === 'extension' && item.request_id === extension.id && item.status === 'awaiting_payment' && new Date(item.expires_at) > new Date());
      if (active) return reply(response, 409, { error:'Для этого продления уже создан активный QR.' });
      const amount = Number(payload.amount || extension.estimated_amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return reply(response, 400, { error:'Укажите корректную сумму продления.' });
      const operationId = makePaymentOperationId(order.id);
      const comment = `Rentop ${extension.kind === 'replacement' ? 'replacement' : 'extension'} ${String(order.id).slice(0, 8).toUpperCase()}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
      const payment = await database.createOrderPayment({ order_id:order.id, request_id:extension.id, purpose:'extension', proposed_return_date:extension.proposed_return_date, provider:'bakai', operation_id:operationId, amount, currency_id:417, comment, qr_image:qr.qrImage || null, qr_image_with_frame:qr.qrImageWithFrame || null, qr_link:qr.qrLink || null, status:'awaiting_payment', expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      await database.updateCustomerRequest(extension.id, { status:'in_progress', estimated_amount:amount });
      await database.createEvent({ order_id:order.id, event_type:'bakai_extension_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount, request_id:extension.id, request_kind:extension.kind, proposed_return_date:extension.proposed_return_date } });
      return reply(response, 201, { ok:true, payment });
    }
    if (payload.action === 'approve_free_extension') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const requestId = String(payload.requestId || '');
      if (!order || !['issued', 'in_use'].includes(order.status)) return reply(response, 409, { error:'Продление можно подтвердить только для активной аренды.' });
      const extension = (await database.listCustomerRequests(order.id)).find(item => item.id === requestId && ['extension', 'replacement'].includes(item.kind) && ['open', 'in_progress'].includes(item.status));
      if (!extension) return reply(response, 404, { error:'Активный запрос продления не найден.' });
      if (Number(extension.estimated_amount || 0) > 0) return reply(response, 409, { error:'Для этого продления требуется QR доплаты.' });
      const targetLaptopId = extension.kind === 'replacement' ? extension.replacement_laptop_id : order.laptop_id;
      const conflict = await database.findOverlappingBlockingOrder(order.id, targetLaptopId, order.rental_end_date, extension.proposed_return_date);
      if (conflict) return reply(response, 409, { error:`Ноутбук уже занят с ${conflict.rental_start_date}; подтвердить продление нельзя.` });
      const start = new Date(`${order.rental_start_date}T00:00:00Z`);
      const end = new Date(`${extension.proposed_return_date}T00:00:00Z`);
      const rentalDays = Math.round((end - start) / 86_400_000);
      if (!Number.isFinite(rentalDays) || rentalDays <= Number(order.rental_days || 0)) return reply(response, 400, { error:'Дата продления должна быть позже текущей даты возврата.' });
      const now = new Date().toISOString();
      const rentalEndsAt = extendExactDeadline(order.rental_ends_at, order.rental_end_date, extension.proposed_return_date);
      const patch = {
        rental_end_date:extension.proposed_return_date,
        rental_days:rentalDays,
        ...(rentalEndsAt ? { rental_ends_at:rentalEndsAt } : {})
      };
      if (extension.kind === 'replacement') {
        const replacementLaptop = await database.getLaptop(extension.replacement_laptop_id);
        if (!replacementLaptop || replacementLaptop.category !== 'rent') return reply(response, 409, { error:'Выбранная модель для замены больше недоступна.' });
        patch.replacement_pending_laptop_id = replacementLaptop.id;
        patch.replacement_exchange_status = 'awaiting_exchange';
      }
      const updatedOrder = await database.updateOrder(order.id, patch);
      const updatedRequest = await database.updateCustomerRequest(extension.id, extension.kind === 'replacement' ? { status:'in_progress' } : { status:'resolved', resolved_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_approved_free_extension_from_web', actor_type:'manager', metadata:{ request_id:extension.id, request_kind:extension.kind, proposed_return_date:extension.proposed_return_date, replacement_laptop_id:extension.replacement_laptop_id || null } });
      return reply(response, 200, { ok:true, order:updatedOrder, request:updatedRequest, message:extension.kind === 'replacement' ? 'Замена согласована. Подтвердите физическую передачу ноутбуков отдельным действием.' : 'Продление без доплаты подтверждено.' });
    }
    if (payload.action === 'reject_extension_request') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const requestId = String(payload.requestId || '');
      const reason = String(payload.reason || '').trim().slice(0, 1200);
      if (!order || !['issued', 'in_use'].includes(order.status)) return reply(response, 409, { error:'Продление можно отклонить только для активной аренды.' });
      const extension = (await database.listCustomerRequests(order.id)).find(item => item.id === requestId && ['extension', 'replacement'].includes(item.kind) && ['open', 'in_progress'].includes(item.status));
      if (!extension) return reply(response, 404, { error:'Активный запрос продления не найден.' });
      const message = reason || 'Продление не согласовано: ноутбук уже забронирован на последующие даты. Нажмите «Подобрать замену / повторить», чтобы сайт показал свободные модели.';
      const updatedRequest = await database.updateCustomerRequest(extension.id, { status:'cancelled', customer_message:message });
      await database.createEvent({ order_id:order.id, event_type:'manager_rejected_extension_from_web', actor_type:'manager', metadata:{ request_id:extension.id, reason:message } });
      return reply(response, 200, { ok:true, request:updatedRequest });
    }
    if (payload.action === 'confirm_replacement_exchange') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const method = String(payload.method || 'rentop_courier');
      const note = String(payload.note || '').trim().slice(0, 1000);
      if (!order || !['issued', 'in_use', 'incident'].includes(order.status)) return reply(response, 409, { error:'Физическую замену можно подтвердить только для действующей аренды.' });
      if (!order.replacement_pending_laptop_id || order.replacement_exchange_status !== 'awaiting_exchange') return reply(response, 409, { error:'Нет ожидающей физической замены.' });
      if (!['arca_locker', 'rentop_courier', 'customer_courier', 'self_delivery'].includes(method)) return reply(response, 400, { error:'Выберите способ передачи.' });
      const replacement = await database.getLaptop(order.replacement_pending_laptop_id);
      if (!replacement || replacement.category !== 'rent') return reply(response, 409, { error:'Новая модель больше недоступна.' });
      const today = new Intl.DateTimeFormat('en-CA', { timeZone:TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
      const conflict = await database.findOverlappingBlockingOrder(order.id, replacement.id, today, order.rental_end_date);
      if (conflict) return reply(response, 409, { error:`Новая модель занята в период физической замены (заявка с ${conflict.rental_start_date}). Выберите другую модель.` });
      const request = (await database.listCustomerRequests(order.id)).find(item => item.kind === 'replacement' && item.status === 'in_progress' && String(item.replacement_laptop_id) === String(replacement.id));
      const now = new Date().toISOString();
      const updatedOrder = await database.updateOrder(order.id, {
        laptop_id:replacement.id,
        replacement_pending_laptop_id:null,
        replacement_exchange_method:method,
        replacement_exchange_status:'completed',
        replacement_incident_reason:note || null
      });
      if (request) await database.updateCustomerRequest(request.id, { status:'resolved', resolved_at:now, customer_message:`Замена выполнена: ${replacement.title}.` });
      await database.createEvent({ order_id:order.id, event_type:'manager_confirmed_physical_replacement_exchange_from_web', actor_type:'manager', metadata:{ previous_laptop_id:order.laptop_id, replacement_laptop_id:replacement.id, method, note:note || null, request_id:request?.id || null } });
      return reply(response, 200, { ok:true, order:updatedOrder, message:'Физическая замена подтверждена. В аренде теперь отражена новая модель.' });
    }
    if (payload.action === 'revoke_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      const payment = await database.getOrderPayment(order.id).catch(() => null);
      if (!payment || payment.status !== 'awaiting_payment') return reply(response, 409, { error:'Активный QR для этой заявки не найден.' });
      const revoked = await database.updateOrderPayment(payment.id, { status:'revoked' });
      await database.createEvent({ order_id:order.id, event_type:'bakai_payment_revoked_from_web', actor_type:'manager', metadata:{ operation_id:payment.operation_id } }).catch(error => console.error('Bakai revocation audit event failed:', error.message));
      return reply(response, 200, { ok:true, payment:revoked });
    }
    if (payload.action === 'confirm_bakai_payment_manually') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      const payment = await database.getOrderPayment(order.id).catch(() => null);
      if (!payment || payment.status !== 'awaiting_payment') return reply(response, 409, { error:'Для этой заявки нет активного QR-счёта, ожидающего оплаты.' });
      const reference = String(payload.reference || '').trim().slice(0, 200);
      if (reference.length < 3) return reply(response, 400, { error:'Укажите номер банковской операции или понятную служебную пометку.' });
      const now = new Date().toISOString();
      const updatedPayment = await database.updateOrderPayment(payment.id, {
        status:'paid',
        bank_transaction_id:reference,
        bank_payload:{ ...paymentPayloadObject(payment.bank_payload), manual_confirmation:{ source:'manager_manual_confirmation', reference } },
        paid_at:now
      });
      let updatedOrder = order;
      if (payment.purpose === 'extension' && payment.proposed_return_date) {
        const start = new Date(`${order.rental_start_date}T00:00:00Z`);
        const end = new Date(`${payment.proposed_return_date}T00:00:00Z`);
        const rentalDays = Math.max(1, Math.round((end - start) / 86_400_000));
        const rentalEndsAt = extendExactDeadline(order.rental_ends_at, order.rental_end_date, payment.proposed_return_date);
        const customerRequest = payment.request_id ? (await database.listCustomerRequests(order.id)).find(item => item.id === payment.request_id) : null;
        const patch = { rental_end_date:payment.proposed_return_date, rental_days:rentalDays, total_amount:Number(order.total_amount || 0) + Number(payment.amount || 0), ...(rentalEndsAt ? { rental_ends_at:rentalEndsAt } : {}) };
        if (customerRequest?.kind === 'replacement') {
          const replacementLaptop = await database.getLaptop(customerRequest.replacement_laptop_id);
          if (!replacementLaptop || replacementLaptop.category !== 'rent') return reply(response, 409, { error:'Выбранная модель для замены больше недоступна. Не подтверждайте оплату до согласования новой модели.' });
          patch.replacement_pending_laptop_id = replacementLaptop.id;
          patch.replacement_exchange_status = 'awaiting_exchange';
        }
        updatedOrder = await database.updateOrder(order.id, patch);
        if (payment.request_id) await database.updateCustomerRequest(payment.request_id, customerRequest?.kind === 'replacement' ? { status:'in_progress' } : { status:'resolved', resolved_at:now });
        await database.createEvent({ order_id:order.id, event_type:'bakai_extension_payment_manually_confirmed_from_web', actor_type:'manager', metadata:{ operation_id:payment.operation_id, reference, amount:payment.amount, proposed_return_date:payment.proposed_return_date, request_kind:customerRequest?.kind || 'extension', replacement_laptop_id:customerRequest?.replacement_laptop_id || null } }).catch(error => console.error('Manual Bakai extension payment audit failed:', error.message));
      } else {
        const groupId = String(paymentPayloadObject(payment.bank_payload).breakdown?.order_group_id || '').trim();
        const groupedOrders = groupId ? await database.listOrdersByGroupId(groupId).catch(() => []) : [];
        const paidOrders = groupedOrders.length ? groupedOrders : [order];
        for (const item of paidOrders) {
          if (payment.purpose === 'reservation' && item.status === 'awaiting_payment') {
            const reserved = await database.updateOrder(item.id, { status:'reserved', reservation_amount:Number(payment.amount || 0), reservation_paid_at:now, reservation_balance_due_at:`${item.rental_start_date}T00:00:00+06:00`, payment_channel:'bakai_manual_review', payment_receipt_received_at:now, payment_confirmed_at:now, hold_expires_at:null });
            if (String(item.id) === String(order.id)) updatedOrder = reserved || item;
          } else if (payment.purpose !== 'reservation' && ['awaiting_payment','reserved'].includes(item.status)) {
            const confirmed = await database.updateOrder(item.id, { status:'confirmed', payment_channel:'bakai_manual_review', payment_receipt_received_at:now, payment_confirmed_at:now, hold_expires_at:null });
            if (String(item.id) === String(order.id)) updatedOrder = confirmed || item;
          }
          await database.createEvent({ order_id:item.id, event_type:payment.purpose === 'reservation' ? 'bakai_reservation_manually_confirmed_from_web' : 'bakai_payment_manually_confirmed_from_web', actor_type:'manager', metadata:{ operation_id:payment.operation_id, reference, amount:payment.amount, purpose:payment.purpose || 'rental', order_group_id:groupId || null, order_ids:paidOrders.map(grouped => grouped.id) } }).catch(error => console.error('Manual Bakai payment audit event failed:', error.message));
        }
      }
      return reply(response, 200, { ok:true, payment:updatedPayment, order:updatedOrder });
    }
    return reply(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Manager API failed:', error.message); return reply(response, 400, { error:error.message || 'Не удалось загрузить панель менеджера.' }); }
}
