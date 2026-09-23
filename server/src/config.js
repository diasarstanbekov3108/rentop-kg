const required = [
  'TELEGRAM_BOT_TOKEN',
  'RENTOP_ADMIN_USER_IDS',
  'RENTOP_ADMIN_CHAT_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MBANK_PAYMENT_DETAILS',
  'SYNBANK_PAYMENT_DETAILS'
];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key] || env[key].startsWith('replace_with'));
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
    adminUserIds,
    adminChatId: env.RENTOP_ADMIN_CHAT_ID,
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    mbankPaymentDetails: env.MBANK_PAYMENT_DETAILS,
    synbankPaymentDetails: env.SYNBANK_PAYMENT_DETAILS,
    mbankQrImagePath: env.MBANK_QR_IMAGE_PATH || '',
    publicAppUrl: env.PUBLIC_APP_URL || 'https://rentop.com.kg',
    backendPublicUrl: env.BACKEND_PUBLIC_URL || ''
  });
}
