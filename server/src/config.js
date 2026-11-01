const required = [
  'TELEGRAM_BOT_TOKEN',
  'RENTOP_ADMIN_USER_IDS',
  'RENTOP_ADMIN_CHAT_ID',
  'SUPABASE_URL',
  'MBANK_PAYMENT_DETAILS',
  'SIMBANK_PAYMENT_DETAILS'
];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key] || env[key].startsWith('replace_with'));
  const supabaseServerKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServerKey || supabaseServerKey.startsWith('replace_with')) missing.push('SUPABASE_SECRET_KEY');
  if (missing.length) {
    throw new Error(`Missing private server configuration: ${missing.join(', ')}`);
  }

  const adminUserIds = new Set(
    env.RENTOP_ADMIN_USER_IDS
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (!adminUserIds.size) {
    throw new Error('RENTOP_ADMIN_USER_IDS must contain at least one Telegram user ID.');
  }
  const otpProvider = String(env.OTP_PROVIDER || 'telegram').trim().toLowerCase();
  if (!['telegram', 'nikita'].includes(otpProvider)) {
    throw new Error('OTP_PROVIDER должен быть telegram или nikita.');
  }
  const nikitaLogin = env.NIKITA_LOGIN || env.NIKITA_SMS_LOGIN || '';
  const nikitaPassword = env.NIKITA_PASSWORD || env.NIKITA_SMS_PASSWORD || '';
  const nikitaSender = env.NIKITA_SENDER_ID || env.NIKITA_SMS_SENDER || '';
  const nikitaOtpChannel = String(env.NIKITA_OTP_CHANNEL || 'sms').trim().toLowerCase();
  if (!['sms', 'whatsapp'].includes(nikitaOtpChannel)) {
    throw new Error('NIKITA_OTP_CHANNEL должен быть sms или whatsapp.');
  }

  return Object.freeze({
    port: Number(env.PORT || 3000),
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    adminUserIds,
    adminChatId: env.RENTOP_ADMIN_CHAT_ID,
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
    supabaseServerKey,
    mbankPaymentDetails: env.MBANK_PAYMENT_DETAILS,
    simbankPaymentDetails: env.SIMBANK_PAYMENT_DETAILS,
    mbankQrImageSource: env.MBANK_QR_IMAGE_URL || env.MBANK_QR_IMAGE_PATH || '',
    archaPointSupportContact: env.ARCHA_POINT_SUPPORT_CONTACT || '',
    publicAppUrl: env.PUBLIC_APP_URL || 'https://rentop.com.kg',
    backendPublicUrl: env.BACKEND_PUBLIC_URL || '',
    otpProvider,
    nikitaSms: {
      endpoint: env.NIKITA_SMS_ENDPOINT || 'https://smspro.nikita.kg/api/message',
      login: nikitaLogin,
      password: nikitaPassword,
      sender: nikitaSender,
      enabled: Boolean(nikitaLogin && nikitaPassword && nikitaSender)
    },
    // Nikita configures WhatsApp routing on its side. The existing delivery
    // request remains unchanged unless the provider supplies another endpoint.
    nikitaOtpChannel,
    // Vercel sends this value in Authorization when it invokes a configured
    // cron route. It must never be exposed to browser code.
    cronSecret: String(env.CRON_SECRET || '').trim(),
    offerOtpHmacSecret: env.OFFER_OTP_HMAC_SECRET || '',
    customerOtpHmacSecret: env.CUSTOMER_OTP_HMAC_SECRET || '',
    managerPhone: String(env.RENTOP_MANAGER_PHONE || '').replace(/[^0-9+]/g, ''),
    // The chief administrator may be separated from day-to-day managers later.
    // Until then the configured manager retains the responsibility and access.
    adminManagerPhone: String(env.RENTOP_ADMIN_MANAGER_PHONE || env.RENTOP_MANAGER_PHONE || '').replace(/[^0-9+]/g, ''),
    rentopWhatsappPhone: String(env.RENTOP_WHATSAPP_PHONE || '').replace(/\D/g, ''),
    offerVersion: env.OFFER_VERSION || 'draft-2026-09-25',
    offerUrl: env.OFFER_URL || '',
    // Keep the customer journey testable until Nikita SMS credentials are verified.
    // Set to "true" only when the live offer-confirmation SMS is ready.
    offerSmsConsentRequired: String(env.OFFER_SMS_CONSENT_REQUIRED || '').trim().toLowerCase() === 'true',
    bakai: {
      baseUrl: (env.BAKAI_API_BASE_URL || 'https://openbanking-api.bakai.kg').replace(/\/$/, ''),
      // Login/password from Bakai Business are used once in Swagger to obtain
      // this bearer token. The application must never try to consume them again.
      apiToken: String(env.BAKAI_API_TOKEN || '').trim(),
      accountNo: String(env.BAKAI_ACCOUNT_NO || '').trim(),
      webhookBearerToken: env.BAKAI_WEBHOOK_BEARER_TOKEN || '',
      enabled: Boolean(String(env.BAKAI_API_TOKEN || '').trim() && env.BAKAI_ACCOUNT_NO)
    }
  });
}
