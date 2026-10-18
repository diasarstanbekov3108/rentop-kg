import { createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { verifyBakaiToken, generateBakaiQr, makePaymentOperationId } from '../server/src/bakai.js';
import { createNikitaSmsClient } from '../server/src/sms.js';

const COOKIE = '__Host-rentop_session';
const allowedDocumentStates = new Set(['accepted', 'rejected']);
const removableStatuses = new Set(['draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup', 'cancelled', 'rejected']);
const statusTransitions = Object.freeze({
  pending_review:['awaiting_payment'],
  return_requested:['returned'],
  returned:['completed']
});
function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function reply(response, status, body) { response.setHeader('Cache-Control', 'private, no-store, max-age=0'); response.status(status).json(body); }
function samePhone(a, b) { return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, ''); }
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
      const orders = await database.listRecentOrders(50);
      const hydrated = await Promise.all(orders.map(async order => {
        const [laptop, documents, requests, payments, supportCases, returnHandoffEvent] = await Promise.all([
          database.getLaptop(order.laptop_id),
          database.listOrderDocuments(order.id).catch(() => []),
          database.listCustomerRequests(order.id).catch(() => []),
          database.listOrderPayments(order.id).catch(() => []),
          database.listOrderSupportCases(order.id).catch(() => []),
          database.hasOrderEvent(order.id, 'manager_prepared_archa_return_handoff_from_web').catch(() => null)
        ]);
        const documentsWithLinks = await Promise.all(documents.map(async document => {
          const signed = await database.createSignedDocumentDownload(document.storage_path).catch(() => null);
          const path = signed?.signedURL || signed?.signedUrl || signed?.url || '';
          return { ...document, view_url:path ? (path.startsWith('http') ? path : `${config.supabaseUrl}/storage/v1${path}`) : '' };
        }));
        return {
          ...order,
          laptop_title:laptop?.title || laptop?.name || 'Ноутбук Rentop',
          laptop_serial_number:laptop?.serial_number || '',
          laptop_inventory_code:laptop?.inventory_code || '',
          documents:documentsWithLinks,
          requests,
          payment:(payments || []).find(payment => payment.purpose !== 'extension') || null,
          payments,
          supportCases,
          returnHandoffPrepared:Boolean(returnHandoffEvent)
        };
      }));
      return reply(response, 200, { authenticated:true, managerPhone:session.phone, isChiefAdmin, orders:hydrated });
    }
    if (request.method !== 'POST') return reply(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action === 'reply_support_case') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const kind = String(payload.kind || '');
      const message = String(payload.message || '').trim().slice(0, 1500);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!['rentop','archa','archa_code_missing','archa_locker_issue','rental_issue'].includes(kind) || message.length < 3) return reply(response, 400, { error:'Напишите клиенту ответ хотя бы несколькими словами.' });
      const supportCase = await database.replyToSupportCase(order.id, kind, message, session.phone);
      if (!supportCase) return reply(response, 404, { error:'Обращение не найдено.' });
      await database.createEvent({ order_id:order.id, event_type:'manager_replied_support_case_from_web', actor_type:'manager', metadata:{ kind, length:message.length } }).catch(error => console.error('Manager support reply audit event failed:', error.message));
      return reply(response, 200, { ok:true, supportCase, message:'Ответ сохранён — клиент увидит его в личном кабинете.' });
    }
    if (payload.action === 'resolve_support_case') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const kind = String(payload.kind || '');
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!['rentop','archa','archa_code_missing','archa_locker_issue','rental_issue'].includes(kind)) return reply(response, 400, { error:'Некорректный тип обращения.' });
      const resolved = await database.resolveSupportCase(order.id, kind, session.phone);
      if (!resolved) return reply(response, 404, { error:'Открытое обращение не найдено.' });
      await database.createEvent({ order_id:order.id, event_type:'manager_resolved_support_case_from_web', actor_type:'manager', metadata:{ kind } }).catch(error => console.error('Manager support audit event failed:', error.message));
      return reply(response, 200, { ok:true, supportCase:resolved, message:'Обращение отмечено как решённое.' });
    }
    if (payload.action === 'save_order_registry') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      const rentalPurpose = String(payload.rentalPurpose || '').trim().replace(/\s+/g, ' ').slice(0, 600);
      const managerNote = String(payload.managerNote || '').trim().slice(0, 2000);
      const returnConditionNote = String(payload.returnConditionNote || '').trim().slice(0, 2000);
      const updated = await database.updateOrder(order.id, { rental_purpose:rentalPurpose || null, manager_note:managerNote || null, return_condition_note:returnConditionNote || null });
      await database.createEvent({ order_id:order.id, event_type:'manager_updated_rental_registry_from_web', actor_type:'manager', metadata:{ has_rental_purpose:Boolean(rentalPurpose), has_manager_note:Boolean(managerNote), has_return_condition_note:Boolean(returnConditionNote) } }).catch(error => console.error('Manager registry audit event failed:', error.message));
      return reply(response, 200, { ok:true, order:updated, message:'Внутренний реестр аренды сохранён.' });
    }
    if (payload.action === 'issue_loyalty_promo') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const percent = Number(payload.discountPercent);
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'completed') return reply(response, 409, { error:'Промокод лояльности можно выдать только после завершённой аренды.' });
      if (!order.customer_phone) return reply(response, 409, { error:'У этой аренды не указан номер клиента.' });
      if (![5, 10, 15, 20].includes(percent)) return reply(response, 400, { error:'Выберите скидку 5%, 10%, 15% или 20%.' });
      const expiresAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
      let promo;
      for (let attempt = 0; attempt < 3 && !promo; attempt += 1) {
        const code = `RENTOP${percent}-${randomBytes(3).toString('hex').toUpperCase()}`;
        try { promo = await database.createPromo({ code, discount_percent:percent, status:'issued', issued_from_order_id:order.id, recipient_telegram_user_id:null, recipient_phone:order.customer_phone, expires_at:expiresAt }); } catch (error) { if (attempt === 2) throw error; }
      }
      await database.createEvent({ order_id:order.id, event_type:'manager_issued_loyalty_promo_from_web', actor_type:'manager', metadata:{ promo_id:promo?.id || null, discount_percent:percent, expires_at:expiresAt } }).catch(error => console.error('Manager promo audit event failed:', error.message));
      return reply(response, 201, { ok:true, promo, message:'Персональный промокод создан и появится в кабинете клиента.' });
    }
    if (payload.action === 'admin_close_rental_early' || payload.action === 'admin_open_incident' || payload.action === 'admin_resolve_incident' || payload.action === 'admin_update_laptop_asset') {
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
      if (!['in_use','return_requested','awaiting_return_reservation','awaiting_return_dropoff','returned'].includes(order.status)) return reply(response, 409, { error:'Досрочно завершить можно только активную аренду или оформленный возврат.' });
      const documents = await database.listOrderDocuments(order.id);
      const returnVideo = documents.find(document => document.kind === 'return_video');
      if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'Сначала примите видео состояния устройства при возврате. Это защищает Rentop и клиента.' });
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
      let updatedOrder = null;
      if (state === 'accepted') {
        const documents = await database.listOrderDocuments(document.order_id);
        const latest = new Map();
        for (const item of documents) if (!latest.has(item.kind)) latest.set(item.kind, item);
        const identityFrontAccepted = latest.get('identity_front')?.status === 'accepted' || latest.get('identity')?.status === 'accepted';
        if (identityFrontAccepted && ['identity_back','selfie','supporting'].every(kind => latest.get(kind)?.status === 'accepted')) {
          const order = await database.getOrder(document.order_id);
          if (['draft','pending_review'].includes(order?.status)) {
            updatedOrder = await database.updateOrder(order.id, { status:'awaiting_payment', hold_expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
            await database.createEvent({ order_id:order.id, event_type:'documents_accepted_waiting_payment_from_web', actor_type:'manager', metadata:{} }).catch(error => console.error('Manager order audit event failed:', error.message));
          }
        }
      }
      return reply(response, 200, { ok:true, document:reviewed, order:updatedOrder });
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
    if (payload.action === 'delete_test_order') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (!removableStatuses.has(order.status)) return reply(response, 409, { error:'Активную или завершённую аренду удалять нельзя. Для неё используйте штатный статус.' });
      const documents = await database.listOrderDocuments(order.id).catch(() => []);
      const cleanup = await Promise.allSettled(documents.map(document => database.deleteDocumentFile(document.storage_path)));
      cleanup.filter(result => result.status === 'rejected').forEach(result => console.error('Test document cleanup failed:', result.reason?.message || result.reason));
      await database.deleteOrder(order.id);
      return reply(response, 200, { ok:true, deletedOrderId:order.id });
    }
    if (payload.action === 'clear_test_orders') {
      const orders = await database.listRecentOrders(100);
      const testOrders = orders.filter(order => removableStatuses.has(order.status));
      const deletedOrderIds = [];
      for (const order of testOrders) {
        const documents = await database.listOrderDocuments(order.id).catch(() => []);
        const cleanup = await Promise.allSettled(documents.map(document => database.deleteDocumentFile(document.storage_path)));
        cleanup.filter(result => result.status === 'rejected').forEach(result => console.error('Bulk test document cleanup failed:', result.reason?.message || result.reason));
        await database.deleteOrder(order.id);
        deletedOrderIds.push(order.id);
      }
      return reply(response, 200, { ok:true, deletedOrderIds, preserved:orders.length - deletedOrderIds.length });
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
      if (['returned', 'completed'].includes(nextStatus)) {
        const documents = await database.listOrderDocuments(order.id);
        const returnVideo = documents.find(document => document.kind === 'return_video');
        if (returnVideo?.status !== 'accepted') return reply(response, 409, { error:'До завершения возврата менеджер должен принять видео состояния устройства.' });
      }
      const updated = await database.updateOrder(order.id, nextStatus === 'awaiting_payment'
        ? { status:nextStatus, hold_expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        : { status:nextStatus });
      await database.createEvent({ order_id:order.id, event_type:`manager_changed_status_to_${nextStatus}_from_web`, actor_type:'manager', metadata:{ previous_status:order.status } }).catch(error => console.error('Manager transition audit event failed:', error.message));
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'prepare_archa_handoff') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.delivery_type !== 'arca_locker') return reply(response, 400, { error:'Эта заявка не использует ARCHA POINT.' });
      if (order.status !== 'confirmed') return reply(response, 409, { error:'Заявку можно передать в ARCHA POINT только после подтверждения оплаты.' });
      const laptop = await database.getLaptop(order.laptop_id);
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_archa_reservation', locker_status:'reservation_requested', archa_handoff_sent_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_prepared_archa_issue_handoff_from_web', actor_type:'manager', metadata:{ locker:order.locker_address } });
      return reply(response, 200, { ok:true, order:updated, message:archaMessage(order, laptop) });
    }
    if (payload.action === 'record_archa_reservation') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const loadingCode = String(payload.loadingCode || '').trim().slice(0, 200);
      const reference = String(payload.reference || '').trim().slice(0, 200);
      if (!order || order.status !== 'awaiting_archa_reservation') return reply(response, 409, { error:'Для этой заявки сейчас не ожидается резервирование ячейки.' });
      if (loadingCode.length < 3) return reply(response, 400, { error:'Введите код закладки от ARCHA POINT.' });
      const updated = await database.updateOrder(order.id, { status:'awaiting_locker_loading', locker_status:'reserved', locker_loading_code:loadingCode, locker_loading_reference:reference || null });
      await database.createEvent({ order_id:order.id, event_type:'manager_recorded_archa_reservation_from_web', actor_type:'manager', metadata:{ has_reference:Boolean(reference) } });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'mark_locker_loaded') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_locker_loading') return reply(response, 409, { error:'Сначала получите и сохраните код закладки ARCHA POINT.' });
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_pickup', locker_status:'loaded', locker_loaded_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_marked_locker_loaded_from_web', actor_type:'manager', metadata:{} });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'mark_archa_access_sent' || payload.action === 'send_manual_pickup_code') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_pickup') return reply(response, 409, { error:'Сначала ноутбук должен быть помещён в ячейку.' });
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
      if (!order || order.status !== 'awaiting_return_reservation' || order.return_method !== 'arca_locker') return reply(response, 409, { error:'Нет активного запроса на возврат через постамат.' });
      const laptop = await database.getLaptop(order.laptop_id);
      await database.createEvent({ order_id:order.id, event_type:'manager_prepared_archa_return_handoff_from_web', actor_type:'manager', metadata:{ locker:order.return_locker_address } });
      return reply(response, 200, { ok:true, message:archaMessage(order, laptop, 'return') });
    }
    if (payload.action === 'mark_return_access_sent') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order || order.status !== 'awaiting_return_reservation') return reply(response, 409, { error:'Нет ожидающего резервирования возврата.' });
      if (!await database.hasOrderEvent(order.id, 'manager_prepared_archa_return_handoff_from_web')) return reply(response, 409, { error:'Сначала подготовьте и отправьте сообщение о возврате в рабочую группу ARCHA POINT.' });
      const now = new Date().toISOString();
      const updated = await database.updateOrder(order.id, { status:'awaiting_return_dropoff', locker_status:'return_access_sent', return_access_sent_at:now });
      await database.createEvent({ order_id:order.id, event_type:'manager_confirmed_archa_return_sms_from_web', actor_type:'manager', metadata:{} });
      return reply(response, 200, { ok:true, order:updated });
    }
    if (payload.action === 'create_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      if (!order) return reply(response, 404, { error:'Заявка не найдена.' });
      if (order.status !== 'awaiting_payment') return reply(response, 409, { error:'QR можно создать только для заявки, ожидающей оплату.' });
      const existing = await database.getOrderPayment(order.id).catch(() => null);
      if (existing?.status === 'paid') return reply(response, 409, { error:'Эта заявка уже оплачена.' });
      if (existing?.status === 'awaiting_payment' && new Date(existing.expires_at) > new Date()) return reply(response, 409, { error:'Для этой заявки уже создан активный QR. Сначала отзовите его, если нужен новый счёт.' });
      const defaultAmount = Number(order.total_amount || 0) + Number(order.deposit_amount || 0);
      const amount = Number(payload.amount || defaultAmount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return reply(response, 400, { error:'Укажите корректную сумму оплаты.' });
      const operationId = makePaymentOperationId(order.id);
      const reference = String(order.id).slice(0, 8).toUpperCase();
      const comment = `Rentop ${reference}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
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
        status:'awaiting_payment',
        expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      await database.createEvent({ order_id:order.id, event_type:'bakai_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount } }).catch(error => console.error('Bakai payment audit event failed:', error.message));
      return reply(response, 201, { ok:true, payment });
    }
    if (payload.action === 'create_extension_bakai_payment') {
      const order = await database.getOrder(String(payload.orderId || ''));
      const requestId = String(payload.requestId || '');
      if (!order || !['issued', 'in_use'].includes(order.status)) return reply(response, 409, { error:'Продление можно оплатить только для активной аренды.' });
      const extension = (await database.listCustomerRequests(order.id)).find(item => item.id === requestId && item.kind === 'extension' && ['open', 'in_progress'].includes(item.status));
      if (!extension) return reply(response, 404, { error:'Активный запрос продления не найден.' });
      const conflict = await database.findOverlappingBlockingOrder(order.id, order.laptop_id, order.rental_end_date, extension.proposed_return_date);
      if (conflict) return reply(response, 409, { error:`Ноутбук уже занят с ${conflict.rental_start_date}; продление нельзя оплатить.` });
      const active = (await database.listOrderPayments(order.id)).find(item => item.purpose === 'extension' && item.request_id === extension.id && item.status === 'awaiting_payment' && new Date(item.expires_at) > new Date());
      if (active) return reply(response, 409, { error:'Для этого продления уже создан активный QR.' });
      const amount = Number(payload.amount || extension.estimated_amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return reply(response, 400, { error:'Укажите корректную сумму продления.' });
      const operationId = makePaymentOperationId(order.id);
      const comment = `Rentop extension ${String(order.id).slice(0, 8).toUpperCase()}`;
      const qr = await generateBakaiQr(config, { operationId, amount, comment, ttlHours:24 });
      const payment = await database.createOrderPayment({ order_id:order.id, request_id:extension.id, purpose:'extension', proposed_return_date:extension.proposed_return_date, provider:'bakai', operation_id:operationId, amount, currency_id:417, comment, qr_image:qr.qrImage || null, qr_image_with_frame:qr.qrImageWithFrame || null, qr_link:qr.qrLink || null, status:'awaiting_payment', expires_at:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      await database.updateCustomerRequest(extension.id, { status:'in_progress', estimated_amount:amount });
      await database.createEvent({ order_id:order.id, event_type:'bakai_extension_qr_created_from_web', actor_type:'manager', metadata:{ operation_id:operationId, amount, request_id:extension.id, proposed_return_date:extension.proposed_return_date } });
      return reply(response, 201, { ok:true, payment });
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
        bank_payload:{ source:'manager_manual_confirmation', reference },
        paid_at:now
      });
      let updatedOrder = order;
      if (payment.purpose === 'extension' && payment.proposed_return_date) {
        const start = new Date(`${order.rental_start_date}T00:00:00Z`);
        const end = new Date(`${payment.proposed_return_date}T00:00:00Z`);
        const rentalDays = Math.max(1, Math.round((end - start) / 86_400_000));
        updatedOrder = await database.updateOrder(order.id, { rental_end_date:payment.proposed_return_date, rental_days:rentalDays });
        if (payment.request_id) await database.updateCustomerRequest(payment.request_id, { status:'resolved', resolved_at:now });
        await database.createEvent({ order_id:order.id, event_type:'bakai_extension_payment_manually_confirmed_from_web', actor_type:'manager', metadata:{ operation_id:payment.operation_id, reference, amount:payment.amount, proposed_return_date:payment.proposed_return_date } }).catch(error => console.error('Manual Bakai extension payment audit failed:', error.message));
      } else {
        updatedOrder = order.status === 'awaiting_payment'
          ? await database.updateOrder(order.id, { status:'confirmed', payment_channel:'bakai_manual_review', payment_receipt_received_at:now, payment_confirmed_at:now })
          : order;
        await database.createEvent({ order_id:order.id, event_type:'bakai_payment_manually_confirmed_from_web', actor_type:'manager', metadata:{ operation_id:payment.operation_id, reference, amount:payment.amount } }).catch(error => console.error('Manual Bakai payment audit event failed:', error.message));
      }
      return reply(response, 200, { ok:true, payment:updatedPayment, order:updatedOrder });
    }
    return reply(response, 400, { error:'Неизвестное действие.' });
  } catch (error) { console.error('Manager API failed:', error.message); return reply(response, 400, { error:error.message || 'Не удалось загрузить панель менеджера.' }); }
}
