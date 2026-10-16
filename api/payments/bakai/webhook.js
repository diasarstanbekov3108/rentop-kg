import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../../server/src/config.js';
import { createSupabaseApi } from '../../../server/src/supabase.js';

function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(body);
}

function sameAccount(left, right) {
  const normalize = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const expected = normalize(left);
  const received = normalize(right);
  if (!expected || !received) return false;
  return expected === received || expected.replace(/^KGS/, '') === received.replace(/^KGS/, '');
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return reply(response, 405, { error:'Method not allowed.' });
  }
  let config;
  try { config = loadConfig(); } catch { return reply(response, 503, { error:'Service unavailable.' }); }
  const received = String(request.headers.authorization || '').replace(/^(?:Bearer\s+)+/i, '').trim();
  if (!config.bakai.webhookBearerToken || !equal(received, config.bakai.webhookBearerToken)) {
    console.warn('Bakai webhook rejected: bearer token does not match the configured secret.');
    return reply(response, 401, { error:'Unauthorized.' });
  }

  try {
    const payload = request.body && typeof request.body === 'object' ? request.body : {};
    const operationId = String(payload.operationID || payload.transactionID || '').trim();
    const state = String(payload.operationState || '').toLowerCase();
    const amount = Number(payload.amount);
    if (!operationId || state !== 'success' || !Number.isFinite(amount) || amount <= 0) return reply(response, 400, { error:'Invalid payment payload.' });
    if (config.bakai.accountNo && !sameAccount(payload.accountNo, config.bakai.accountNo)) return reply(response, 400, { error:'Unexpected account.' });

    const database = createSupabaseApi(config);
    const payment = await database.getPaymentByOperationId(operationId);
    if (!payment) return reply(response, 404, { error:'Payment not found.' });
    if (Math.round(Number(payment.amount) * 100) !== Math.round(amount * 100)) return reply(response, 400, { error:'Unexpected amount.' });
    if (payment.status === 'paid') return reply(response, 200, { ok:true, duplicate:true });
    if (payment.status !== 'awaiting_payment') {
      await database.createEvent({ order_id:payment.order_id, event_type:'bakai_payment_received_after_revocation', actor_type:'bank', metadata:{ operation_id:operationId, payment_status:payment.status, amount } }).catch(error => console.error('Bakai revoked payment audit event failed:', error.message));
      return reply(response, 200, { ok:true, ignored:true });
    }

    const now = new Date().toISOString();
    const bankElqrId = String(payload.elqrID || payload.elqrId || payload.qrTransactionID || '').trim() || null;
    await database.updateOrderPayment(payment.id, {
      status:'paid',
      bank_elqr_id:bankElqrId,
      bank_transaction_id:String(payload.qrTransactionID || payload.transactionID || '').trim() || null,
      bank_payload:payload,
      paid_at:now
    });
    const order = await database.getOrder(payment.order_id);
    if (payment.purpose === 'extension' && order && payment.proposed_return_date) {
      const start = new Date(`${order.rental_start_date}T00:00:00Z`);
      const end = new Date(`${payment.proposed_return_date}T00:00:00Z`);
      const rentalDays = Math.max(1, Math.round((end - start) / 86_400_000));
      await database.updateOrder(order.id, { rental_end_date:payment.proposed_return_date, rental_days:rentalDays });
      if (payment.request_id) await database.updateCustomerRequest(payment.request_id, { status:'resolved', resolved_at:now });
      await database.createEvent({ order_id:payment.order_id, event_type:'bakai_extension_payment_confirmed_webhook', actor_type:'bank', metadata:{ operation_id:operationId, elqr_id:bankElqrId, amount, proposed_return_date:payment.proposed_return_date } }).catch(error => console.error('Bakai extension payment audit failed:', error.message));
    } else {
      if (order?.status === 'awaiting_payment') await database.updateOrder(order.id, { status:'confirmed', payment_channel:'bakai', payment_receipt_received_at:now, payment_confirmed_at:now });
      await database.createEvent({ order_id:payment.order_id, event_type:'bakai_payment_confirmed_webhook', actor_type:'bank', metadata:{ operation_id:operationId, elqr_id:bankElqrId, amount } }).catch(error => console.error('Bakai webhook audit event failed:', error.message));
    }
    return reply(response, 200, { ok:true });
  } catch (error) {
    console.error('Bakai webhook failed:', error.message);
    return reply(response, 500, { error:'Temporary processing error.' });
  }
}
