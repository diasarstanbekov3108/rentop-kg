import { createHmac } from 'node:crypto';
import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';

const COOKIE = '__Host-rentop_session';
const allowedDocumentStates = new Set(['accepted', 'rejected']);
function readCookie(request, name) { const source = String(request.headers.cookie || ''); return source.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function hash(secret, value) { return createHmac('sha256', secret).update(value).digest('hex'); }
function reply(response, status, body) { response.setHeader('Cache-Control', 'private, no-store, max-age=0'); response.status(status).json(body); }
function samePhone(a, b) { return String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, ''); }

export default async function handler(request, response) {
  let config;
  try { config = loadConfig(); } catch { return reply(response, 503, { error:'Панель менеджера временно настраивается.' }); }
  if (!config.customerOtpHmacSecret || !/^\+?996\d{9}$/.test(config.managerPhone)) return reply(response, 503, { error:'Для панели укажите RENTOP_MANAGER_PHONE в настройках Vercel.' });
  const database = createSupabaseApi(config);
  const raw = readCookie(request, COOKIE);
  const session = raw ? await database.getCabinetSession(hash(config.customerOtpHmacSecret, raw)) : null;
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date() || !samePhone(session.phone, config.managerPhone)) return reply(response, 401, { error:'Войдите в кабинет с номером менеджера.', code:'MANAGER_AUTH_REQUIRED' });
  try {
    if (request.method === 'GET') {
      const orders = await database.listRecentOrders(50);
      const hydrated = await Promise.all(orders.map(async order => {
        const [laptop, documents, requests] = await Promise.all([
          database.getLaptop(order.laptop_id),
          database.listOrderDocuments(order.id).catch(() => []),
          database.listCustomerRequests(order.id).catch(() => [])
        ]);
        const documentsWithLinks = await Promise.all(documents.map(async document => {
          const signed = await database.createSignedDocumentDownload(document.storage_path).catch(() => null);
          const path = signed?.signedURL || signed?.signedUrl || signed?.url || '';
          return { ...document, view_url:path ? (path.startsWith('http') ? path : `${config.supabaseUrl}/storage/v1${path}`) : '' };
        }));
        return { ...order, laptop_title:laptop?.title || laptop?.name || 'Ноутбук Rentop', documents:documentsWithLinks, requests };
      }));
      return reply(response, 200, { authenticated:true, managerPhone:session.phone, orders:hydrated });
    }
    if (request.method !== 'POST') return reply(response, 405, { error:'Method not allowed.' });
    const payload = request.body || {};
    if (payload.action !== 'review_document') return reply(response, 400, { error:'Неизвестное действие.' });
    const state = String(payload.status || '');
    if (!allowedDocumentStates.has(state)) return reply(response, 400, { error:'Некорректный статус документа.' });
    const document = await database.getOrderDocument(String(payload.documentId || ''));
    if (!document) return reply(response, 404, { error:'Документ не найден.' });
    const note = String(payload.note || '').trim().slice(0, 500);
    const reviewed = await database.reviewOrderDocument(document.id, { status:state, reviewed_at:new Date().toISOString(), reviewer_note:note || null });
    await database.createEvent({ order_id:document.order_id, event_type:`manager_${state}_document_from_web`, actor_type:'manager', metadata:{ document_kind:document.kind } });
    return reply(response, 200, { ok:true, document:reviewed });
  } catch (error) { console.error('Manager API failed:', error.message); return reply(response, 400, { error:error.message || 'Не удалось загрузить панель менеджера.' }); }
}
