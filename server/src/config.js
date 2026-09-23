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
    publicAppUrl: env.PUBLIC_APP_URL || 'https://rentop.com.kg',
    backendPublicUrl: env.BACKEND_PUBLIC_URL || ''
  });
}
