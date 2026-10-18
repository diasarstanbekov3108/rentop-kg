import { createHmac } from 'node:crypto';
import { loadConfig } from '../../server/src/config.js';
import { createSupabaseApi } from '../../server/src/supabase.js';

const COOKIE = '__Host-rentop_session';

function readCookie(request, name) {
  const source = String(request.headers.cookie || '');
  return source.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function samePhone(a, b) { return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, ''); }
function safeName(value) { return String(value || 'order').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'order'; }
function escapeHtml(value) { return String(value ?? '—').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char])); }
function printableDate(value) { return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Bishkek' }).format(new Date(value)) : '—'; }
function statusLabel(value) { return ({ draft:'Новая', pending_review:'Проверка документов', awaiting_payment:'Ожидает оплаты', confirmed:'Оплата подтверждена', awaiting_pickup:'Готово к получению', in_use:'Активна', return_requested:'Возврат', awaiting_return_reservation:'Резервируем возврат', awaiting_return_dropoff:'Ожидаем возврат в ячейку', returned:'Проверка возврата', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена', incident:'Инцидент' }[value] || value || '—'); }
function row(label, value) { return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`; }
function buildPrintableDossier({ order, asset, payments, requests, feedback, attachments, events, exportedAt, session }) {
  const evidenceRows = attachments.length ? attachments.map(item => `<tr><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.file_name)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(printableDate(item.uploaded_at))}</td><td>${escapeHtml(item.byte_size ? `${Math.ceil(item.byte_size / 1024)} КБ` : '—')}</td></tr>`).join('') : '<tr><td colspan="5">Файлы не прикреплены</td></tr>';
  const eventRows = events.length ? events.map(item => `<tr><td>${escapeHtml(printableDate(item.created_at))}</td><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.actor_type)}</td></tr>`).join('') : '<tr><td colspan="3">Событий пока нет</td></tr>';
  const requestRows = requests.length ? requests.map(item => `<li>${escapeHtml(item.kind)} · ${escapeHtml(item.status)}${item.customer_message ? ` — ${escapeHtml(item.customer_message)}` : ''}</li>`).join('') : '<li>Нет</li>';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Защищённое досье Rentop · ${escapeHtml(String(order.id).slice(0, 8).toUpperCase())}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#f2f6f8;color:#132433;font-family:Arial,sans-serif;font-size:12px;line-height:1.45}.page{max-width:190mm;margin:0 auto;background:#fff;padding:16mm;box-shadow:0 3px 18px #abc4d155}.head{display:flex;justify-content:space-between;gap:18px;border-bottom:3px solid #127daf;padding-bottom:12px}.brand{color:#08729f;font-weight:800;letter-spacing:1px}.confidential{display:inline-block;padding:5px 8px;background:#5b2029;color:#fff;border-radius:5px;font-weight:700;font-size:10px}.note{margin:14px 0;padding:10px 12px;border-left:4px solid #d18c2d;background:#fff7e9}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.section{margin-top:16px;break-inside:avoid}.section h2{margin:0 0 7px;font-size:14px;color:#075f88}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border:1px solid #cad9e1;text-align:left;vertical-align:top}th{width:34%;background:#edf5f8;font-weight:700}thead th{width:auto;background:#0b6e99;color:#fff}ul{margin:0;padding-left:18px}.footer{margin-top:20px;padding-top:8px;border-top:1px solid #cad9e1;color:#587080;font-size:10px}@media print{body{background:#fff}.page{max-width:none;margin:0;padding:0;box-shadow:none}}</style></head><body><main class="page"><header class="head"><div><div class="brand">RENTOP.KG · ЗАЩИЩЁННОЕ ДОСЬЕ</div><h1>Заявка ${escapeHtml(String(order.id).slice(0, 8).toUpperCase())}</h1></div><div><span class="confidential">КОНФИДЕНЦИАЛЬНО</span><p>Сформировано: ${escapeHtml(printableDate(exportedAt))}</p></div></header><aside class="note">Содержит персональные данные. Передача допускается только уполномоченным лицам. Вложенные документы и видео в этот файл не встраиваются и доступны только через защищённую панель Rentop.</aside><div class="grid"><section class="section"><h2>Клиент и аренда</h2><table>${row('Клиент', order.customer_name)}${row('Телефон', order.customer_phone)}${row('Адрес проживания', order.residence_address)}${row('Подтверждающий документ', order.supporting_document_type)}${row('Статус', statusLabel(order.status))}${row('Срок', `${order.rental_start_date || '—'} — ${order.rental_end_date || '—'}`)}${row('Сумма аренды', `${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом`)}${row('Залог', `${Number(order.deposit_amount || 0).toLocaleString('ru-RU')} сом`)}</table></section><section class="section"><h2>Личность, оферта и устройство</h2><table>${row('Номер паспорта / ID', order.identity_document_number)}${row('Кем выдан', order.identity_document_issuer)}${row('Проверено менеджером', order.identity_verified_at ? `${printableDate(order.identity_verified_at)}${order.identity_verified_by ? ` · ${order.identity_verified_by}` : ''}` : '—')}${row('Версия оферты', order.offer_version)}${row('Оферта принята', printableDate(order.offer_accepted_at))}${row('SMS-подтверждение', printableDate(order.offer_otp_verified_at))}${row('Модель', asset?.title)}${row('Заводской S/N', asset?.serial_number)}${row('Инвентарный код', asset?.inventory_code)}${row('Способ выдачи', order.delivery_type)}${row('Точка / адрес', order.return_locker_address || order.locker_address)}${row('Состояние при возврате', order.return_condition_note)}</table></section></div><section class="section"><h2>Финансы и запросы</h2><table>${row('Платёж', payments?.status || '—')}${row('Операция', payments?.operation_id || payments?.provider_reference || '—')}${row('Отзыв', feedback?.review || '—')}</table><h3>Запросы клиента</h3><ul>${requestRows}</ul></section><section class="section"><h2>Перечень доказательств</h2><table><thead><tr><th>Тип</th><th>Файл</th><th>Статус</th><th>Получен</th><th>Размер</th></tr></thead><tbody>${evidenceRows}</tbody></table></section><section class="section"><h2>Журнал действий</h2><table><thead><tr><th>Время</th><th>Событие</th><th>Исполнитель</th></tr></thead><tbody>${eventRows}</tbody></table></section><footer class="footer">Сформировал главный администратор: ${escapeHtml(session.phone)}. Документ не содержит активных ссылок на вложения. Для печати используйте «Печать» браузера и «Сохранить как PDF».</footer></main></body></html>`;
}

// A controlled export for a verified incident, insurer, or authorised body.
// Source files remain private in Supabase and are never exposed as links in an export.
export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error:'Method not allowed.' });
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  let config;
  try { config = loadConfig(); } catch { return response.status(503).json({ error:'Панель менеджера временно настраивается.' }); }
  const database = createSupabaseApi(config);
  const raw = readCookie(request, COOKIE);
  const session = raw ? await database.getCabinetSession(hash(config.customerOtpHmacSecret, raw)) : null;
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date() || !samePhone(session.phone, config.adminManagerPhone)) {
    return response.status(403).json({ error:'Скачивание досье доступно только главному администратору.' });
  }
  const orderId = String(request.query?.order || '');
  if (!orderId) return response.status(400).json({ error:'Не указана заявка.' });
  try {
    const order = await database.getOrder(orderId);
    if (!order) return response.status(404).json({ error:'Заявка не найдена.' });
    const [laptop, documents, payments, events, requests, feedback] = await Promise.all([
      database.getLaptop(order.laptop_id),
      database.listOrderDocuments(order.id),
      database.getOrderPayment(order.id),
      database.listOrderEvents(order.id),
      database.listCustomerRequests(order.id),
      database.getOrderFeedback(order.id)
    ]);
    const attachments = documents.map(document => ({
        kind: document.kind,
        file_name: document.file_name,
        content_type: document.content_type,
        byte_size: document.byte_size,
        status: document.status,
        uploaded_at: document.uploaded_at,
        reviewed_at: document.reviewed_at,
        reviewer_note: document.reviewer_note,
        retrieval:'Доступно только через защищённую панель Rentop'
      }));
    const exportedAt = new Date().toISOString();
    const dossier = {
      format:'rentop-case-dossier/v1',
      confidential:true,
      warning:'Содержит персональные данные. Передавайте только уполномоченным лицам и храните защищённо. Ссылки на вложения действуют 24 часа.',
      exported_at:exportedAt,
      exported_by:{ manager_phone:session.phone, role:'chief_admin' },
      order,
      asset:laptop ? { id:laptop.id, title:laptop.title || laptop.name || null, serial_number:laptop.serial_number || null, inventory_code:laptop.inventory_code || null } : null,
      payment:payments,
      customer_requests:requests,
      feedback,
      evidence:attachments,
      event_log:events
    };
    const format = String(request.query?.format || 'html').toLowerCase();
    await database.createEvent({ order_id:order.id, event_type:format === 'json' ? 'chief_admin_downloaded_case_dossier_json_from_web' : 'chief_admin_opened_case_dossier_print_from_web', actor_type:'chief_admin', metadata:{ manager_phone:session.phone, exported_at:exportedAt, attachment_count:attachments.length } });
    if (format === 'json') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="rentop-case-${safeName(order.id)}.json"`);
      return response.status(200).send(JSON.stringify(dossier, null, 2));
    }
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.status(200).send(buildPrintableDossier({ order, asset:laptop ? { title:laptop.title || laptop.name || null, serial_number:laptop.serial_number || null, inventory_code:laptop.inventory_code || null } : null, payments, requests, feedback, attachments, events, exportedAt, session }));
  } catch (error) {
    console.error('Case dossier export failed:', error.message);
    return response.status(400).json({ error:'Не удалось подготовить досье.' });
  }
}
