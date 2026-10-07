import { randomBytes } from 'node:crypto';

const SOM_CURRENCY_ID = 417;

function bankError(response, body) {
  const message = body?.message || body?.error || body?.title || `Bakai API returned ${response.status}`;
  return new Error(`Bakai: ${message}`);
}

async function bankRequest(config, path, options = {}) {
  const controller = new AbortController();
  // Keep below the default Vercel serverless limit so the manager receives
  // a useful error instead of a terminated request and a frozen button.
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.bakai.baseUrl}${path}`, {
      ...options,
      signal:controller.signal,
      headers: { 'content-type':'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw bankError(response, body);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Bakai не ответил за 8 секунд на ${path}. Проверьте доступ API у Банка и повторите позже.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createBakaiToken(config) {
  if (!config.bakai.enabled) throw new Error('Интеграция Bakai ещё не настроена: добавьте логин, пароль и расчётный счёт в Vercel.');
  const body = await bankRequest(config, '/Auth/Login', {
    method:'POST',
    body:JSON.stringify({ login:config.bakai.login, password:config.bakai.password })
  });
  if (!body?.token) throw new Error('Bakai не вернул токен авторизации.');
  return body.token;
}

export function makePaymentOperationId(orderId) {
  return `R-${String(orderId).replace(/-/g, '').slice(0, 12)}-${randomBytes(3).toString('hex')}`.slice(0, 25);
}

export async function generateBakaiQr(config, { operationId, amount, comment, ttlHours = 24 }) {
  const token = await createBakaiToken(config);
  const body = await bankRequest(config, '/api/Qr/GenerateQRWithComment', {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}` },
    body:JSON.stringify({
      accountNo:config.bakai.accountNo,
      currencyId:SOM_CURRENCY_ID,
      amount:Number(amount),
      operationID:operationId,
      comment:String(comment).slice(0, 100),
      qrTtlUnits:2,
      qrTtl:Math.max(1, Math.min(Number(ttlHours) || 24, 24))
    })
  });
  if (!body?.qrLink && !body?.qrImage) throw new Error('Bakai не вернул QR-код или ссылку на оплату.');
  return body;
}
