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

// A controlled export for a verified incident, insurer, or authorised body.
// The source files stay private in Supabase; temporary links expire after 24 h.
export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error:'Method not allowed.' });
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
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
    const attachments = await Promise.all(documents.map(async document => {
      const signed = await database.createSignedDocumentDownload(document.storage_path, 86400);
      const value = signed?.signedURL || signed?.signedUrl || signed?.url || '';
      return {
        kind: document.kind,
        file_name: document.file_name,
        content_type: document.content_type,
        byte_size: document.byte_size,
        status: document.status,
        uploaded_at: document.uploaded_at,
        reviewed_at: document.reviewed_at,
        reviewer_note: document.reviewer_note,
        download_url: value ? (value.startsWith('http') ? value : `${config.supabaseUrl}/storage/v1${value}`) : null,
        url_expires_at: new Date(Date.now() + 86400_000).toISOString()
      };
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
    await database.createEvent({ order_id:order.id, event_type:'chief_admin_downloaded_case_dossier_from_web', actor_type:'chief_admin', metadata:{ manager_phone:session.phone, exported_at:exportedAt, attachment_count:attachments.length } });
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="rentop-case-${safeName(order.id)}.json"`);
    return response.status(200).send(JSON.stringify(dossier, null, 2));
  } catch (error) {
    console.error('Case dossier export failed:', error.message);
    return response.status(400).json({ error:'Не удалось подготовить досье.' });
  }
}
