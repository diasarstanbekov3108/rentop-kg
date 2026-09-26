import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeKyrgyzPhone } from './sms.js';
import { createOtpService } from './otp.js';

const adminKeyboard = (buttons) => ({ reply_markup: { inline_keyboard: [buttons] } });
const contactKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: 'Отправить подтверждённый номер', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  }
});
const removeReplyKeyboard = () => ({ reply_markup: { remove_keyboard: true } });
const customerMenuKeyboard = () => ({
  reply_markup: {
    keyboard: [
      [{ text: '✅ Ноутбук получил' }, { text: '💬 У меня вопрос' }],
      [{ text: '🛠 Проблема с ARCHA POINT' }, { text: '⭐ Оставить отзыв' }]
    ],
    resize_keyboard: true,
    is_persistent: true
  }
});
const isOfficialDocument = (message) => Boolean(message?.document || message?.photo?.length);
const isSelfiePhoto = (message) => Boolean(message?.photo?.length);
const isDocumentMessage = (message) => Boolean(message?.document || message?.photo?.length);
const orderRef = (order) => String(order.id).slice(0, 8).toUpperCase();
const laptopTitle = (laptop) => String(laptop?.title || laptop?.name || `Ноутбук #${laptop?.id || '—'}`);
const addDaysToIso = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function orderDetails(order, laptop) {
  const delivery = order.delivery_type === 'arca_locker'
    ? 'ARCHA POINT 24/7'
    : order.delivery_type === 'pickup'
      ? 'Самовывоз'
      : 'Доставка';
  return [
    `Заявка ${orderRef(order)}`,
    `Ноутбук: ${laptopTitle(laptop)}`,
    `Аренда: ${order.rental_start_date} — ${order.rental_end_date} (${order.rental_days} дн.)`,
    `Стоимость: ${order.total_amount} сом · скидка ${order.discount_percent}%`,
    `Получение: ${delivery}`,
    order.locker_address ? `Локация: ${order.locker_address}` : null
  ].filter(Boolean).join('\n');
}

export function createRentopBot({ config, telegram, database }) {
  const isAdmin = (userId) => config.adminUserIds.has(String(userId));
  const otp = createOtpService({ provider: config.otpProvider, nikitaSms: config.nikitaSms, telegram });

  const recordEvent = (event) => database.createEvent?.(event).catch((error) => {
    console.error('Could not write rental order audit event:', error.message);
  });

  const otpHash = (orderId, code) => createHmac('sha256', config.offerOtpHmacSecret)
    .update(`${orderId}:${code}`).digest('hex');

  function documentOptions() {
    return {
      reply_markup: { inline_keyboard: [
        [{ text: 'Паспорт КР / Tunduk', callback_data: 'document_type:kr_passport' }],
        [{ text: 'Загранпаспорт', callback_data: 'document_type:foreign_passport' }],
        [{ text: 'Иностранный паспорт / ВНЖ', callback_data: 'document_type:foreign_resident' }]
      ] }
    };
  }

  const helpKeyboard = (orderId) => ({
    reply_markup: { inline_keyboard: [
      [{ text: 'Поддержка Rentop', callback_data: `support:${orderId}` }],
      [{ text: 'Проблема с ARCHA POINT', callback_data: `archa_support:${orderId}` }]
    ] }
  });

  const pickupAccessKeyboard = (orderId) => ({
    reply_markup: { inline_keyboard: [
      [{ text: '🔑 Код от ARCHA POINT получен', callback_data: `pickup_ready:${orderId}` }],
      [{ text: 'Проблема с ARCHA POINT', callback_data: `archa_support:${orderId}` }]
    ] }
  });

  const pickupConfirmationKeyboard = (orderId) => ({
    reply_markup: { inline_keyboard: [
      [{ text: '✅ Ноутбук получил', callback_data: `pickup_received:${orderId}` }],
      [{ text: 'Проблема с ARCHA POINT', callback_data: `archa_support:${orderId}` }]
    ] }
  });

  const activeRentalKeyboard = (orderId) => ({
    reply_markup: { inline_keyboard: [
      [{ text: '📅 Хочу продлить аренду', callback_data: `extend_request:${orderId}` }],
      [{ text: 'Поддержка Rentop', callback_data: `support:${orderId}` }],
      [{ text: 'Проблема с ARCHA POINT', callback_data: `archa_support:${orderId}` }]
    ] }
  });

  async function sendCustomerServiceMenu(chatId, text) {
    return telegram.sendMessage(chatId, text, customerMenuKeyboard());
  }

  async function confirmPickup(order, session, chatId, source) {
    if (!['awaiting_pickup', 'issued'].includes(order.status)) {
      return telegram.sendMessage(chatId, `Выдача по заявке ${orderRef(order)} уже отмечена или пока не готова.`);
    }
    await database.updateOrder(order.id, { status: 'in_use', locker_status: 'client_picked_up' });
    await saveStep(session, { step: 'in_use' });
    await recordEvent({ order_id: order.id, event_type: 'pickup_confirmed', actor_type: source, metadata: {} });
    await telegram.sendMessage(session.telegram_chat_id,
      '✅ Получение ноутбука подтверждено. Хорошего пользования! Если потребуется продление, поддержка Rentop или помощь с ARCHA POINT — используйте кнопки ниже.',
      activeRentalKeyboard(order.id)
    );
    await sendCustomerServiceMenu(session.telegram_chat_id, 'Быстрое меню: здесь можно сообщить о получении, задать вопрос, обратиться по ARCHA POINT или оставить отзыв.');
    return telegram.sendMessage(chatId, `Выдача по заявке ${orderRef(order)} подтверждена. Аренда теперь активна.`);
  }

  async function sendOpenSupportCases(chatId) {
    let cases;
    try {
      cases = await database.listOpenSupportCases(12);
    } catch (error) {
      console.error('Unable to load support cases:', error.message);
      return telegram.sendMessage(chatId, 'Панель обращений станет доступна после применения миграции базы данных. Остальные кнопки бота продолжают работать.');
    }
    if (!cases.length) return telegram.sendMessage(chatId, '✅ Открытых обращений нет.');
    const lines = await Promise.all(cases.map(async (supportCase, index) => {
      const order = await database.getOrder(supportCase.order_id);
      const laptop = order && await database.getLaptop(order.laptop_id);
      return `${index + 1}. ${supportCase.kind === 'archa' ? 'ARCHA POINT' : 'Rentop'} · ${order ? orderRef(order) : 'заказ удалён'}\n${order ? laptopTitle(laptop) : ''} · ${supportCase.opened_at}`;
    }));
    const buttons = cases.slice(0, 8).map((supportCase) => ([
      { text: `✅ Решить ${supportCase.kind === 'archa' ? 'ARCHA' : 'Rentop'} · ${String(supportCase.order_id).slice(0, 8).toUpperCase()}`, callback_data: `case_resolve:${supportCase.order_id}:${supportCase.kind}` }
    ]));
    return telegram.sendMessage(chatId, `🆘 Открытые обращения\n\n${lines.join('\n\n')}`, { reply_markup: { inline_keyboard: buttons } });
  }

  async function openSupportCaseSafely(supportCase) {
    try {
      return await database.openSupportCase(supportCase);
    } catch (error) {
      // The bot must still notify the manager while a new database migration is being applied.
      console.error('Unable to save support case:', error.message);
      return null;
    }
  }

  async function resolveSupportCaseSafely(orderId, kind, resolvedBy) {
    try {
      return await database.resolveSupportCase(orderId, kind, resolvedBy);
    } catch (error) {
      console.error('Unable to resolve support case:', error.message);
      return null;
    }
  }

  async function openCustomerSupportCase(order, session, userId, kind) {
    const isArchaSupport = kind === 'archa';
    await openSupportCaseSafely({ order_id: order.id, kind, status: 'open', opened_at: new Date().toISOString(), opened_by: String(userId), resolved_at: null, resolved_by: null });
    await recordEvent({ order_id: order.id, event_type: isArchaSupport ? 'customer_requested_archa_support' : 'customer_requested_rentop_support', actor_type: 'customer', actor_telegram_id: userId, metadata: {} });
    await sendAdmin(
      `${isArchaSupport ? '🆘 Клиент сообщил о проблеме с ARCHA POINT' : '🆘 Клиент запросил поддержку Rentop'}\n\n${orderDetails(order, await database.getLaptop(order.laptop_id))}\n` +
      `Клиент: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\n` +
      `Текущий этап: ${session.step}\n\nОтветьте клиенту через Telegram-диалог с ботом или свяжитесь по подтверждённому номеру.`,
      { reply_markup: { inline_keyboard: [[{ text: '✅ Проблема решена', callback_data: `case_resolve:${order.id}:${kind}` }]] } }
    );
    const contact = isArchaSupport && config.archaPointSupportContact
      ? `\nКонтакт поддержки ARCHA POINT: ${config.archaPointSupportContact}`
      : '';
    await telegram.sendMessage(session.telegram_chat_id, `${isArchaSupport ? 'Запрос по ARCHA POINT' : 'Запрос в Rentop'} передан менеджеру. Мы свяжемся с вами в ближайшее рабочее время.${contact}`, {
      reply_markup: { inline_keyboard: [[{ text: '✅ Проблема решена, спасибо', callback_data: `caseok:${order.id}:${kind}` }]] }
    });
  }

  async function sendArchaPointRequest(order, chatId) {
    if (!order.offer_otp_verified_at) {
      return telegram.sendMessage(chatId, `Нельзя передать заявку ${orderRef(order)} в ARCHA POINT: клиент ещё не завершил подтверждение оферты.`);
    }
    const laptop = await database.getLaptop(order.laptop_id);
    const sharedFields = ['customer_name', 'customer_phone', 'locker_address', 'order_reference', 'laptop_model', 'rental_period'];
    try {
      await database.updateOrder(order.id, {
        archa_data_shared_at: new Date().toISOString(),
        archa_data_shared_fields: sharedFields
      });
    } catch (error) {
      // Keeps Preview handoff usable until its SQL migration is installed.
      // Production launch must apply the migration to retain this audit field.
      console.error('Could not save ARCHA POINT handoff audit:', error.message);
    }
    await recordEvent({
      order_id: order.id,
      event_type: 'archa_point_handoff_prepared',
      actor_type: 'manager',
      metadata: { shared_fields: sharedFields }
    });
    return telegram.sendMessage(chatId,
      `📦 ARCHA POINT — заявка на подготовку выдачи\n\n` +
      `Заказ Rentop: ${orderRef(order)}\n` +
      `Клиент: ${order.customer_name || '—'}\n` +
      `Телефон для SMS-кода: ${order.customer_phone || '—'}\n` +
      `Ноутбук: ${laptopTitle(laptop)}\n` +
      `Период: ${order.rental_start_date} — ${order.rental_end_date}\n` +
      `Локация: ${order.locker_address || 'уточняется'}\n\n` +
      `Просьба: подготовить ячейку и отправить клиенту код/PIN или QR для получения. После выдачи сообщите статус Rentop.\n\n` +
      `Это готовый текст: перешлите его в рабочую группу ARCHA POINT.`
    );
  }

  async function captureDocument(session, message, field) {
    return saveStep(session, { [field]: message.message_id });
  }

  async function sendDocumentPacket(order, session) {
    const packet = [
      session.id_document_first_message_id,
      session.id_document_second_message_id,
      session.selfie_message_id,
      session.supporting_document_message_id
    ].filter(Boolean);
    if (!packet.length) return;
    try {
      await telegram.forwardMessages(config.adminChatId, session.telegram_chat_id, packet);
    } catch (error) {
      console.error('Could not forward document packet as a batch:', error.message);
      for (const messageId of packet) {
        await telegram.forwardMessage(config.adminChatId, session.telegram_chat_id, messageId);
      }
    }
  }

  const depositKeyboard = (orderId) => ({
    reply_markup: { inline_keyboard: [
      [
        { text: 'Без залога', callback_data: `deposit_pick:${orderId}:0` },
        { text: '5 000 сом', callback_data: `deposit_pick:${orderId}:5000` },
        { text: '10 000 сом', callback_data: `deposit_pick:${orderId}:10000` }
      ],
      [
        { text: '15 000 сом', callback_data: `deposit_pick:${orderId}:15000` },
        { text: '20 000 сом', callback_data: `deposit_pick:${orderId}:20000` }
      ],
      [{ text: 'Другая сумма', callback_data: `deposit_custom:${orderId}` }]
    ] }
  });

  async function applyDeposit(order, session, amount, chatId) {
    await database.updateOrder(order.id, {
      status: 'awaiting_payment',
      deposit_amount: amount,
      hold_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    await saveStep(session, { step: 'awaiting_payment_method' });
    await recordEvent({ order_id: order.id, event_type: 'deposit_assigned', actor_type: 'manager', metadata: { amount } });
    await telegram.sendMessage(session.telegram_chat_id,
      `Заявка одобрена. Аренда: ${order.total_amount} сом. Залог: ${amount} сом.\nВыберите банк для оплаты общей суммы:`,
      adminKeyboard([
        { text: 'MBANK', callback_data: `bank:${order.id}:mbank` },
        { text: 'SIMBANK', callback_data: `bank:${order.id}:simbank` }
      ])
    );
    return telegram.sendMessage(chatId, `Залог ${amount} сом назначен по заявке ${orderRef(order)}. Клиенту отправлены способы оплаты.`);
  }

  async function cancelOrder(order, session, chatId) {
    const cancellable = new Set(['draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup']);
    if (!cancellable.has(order.status)) {
      return telegram.sendMessage(chatId, 'Эту заявку уже нельзя отменить автоматически: техника может быть выдана. Используйте обработку возврата через менеджера.');
    }
    await database.updateOrder(order.id, { status: 'cancelled', hold_expires_at: new Date().toISOString() });
    await recordEvent({ order_id: order.id, event_type: 'order_cancelled_by_manager', actor_type: 'manager', metadata: {} });
    if (session?.telegram_chat_id) {
      await telegram.sendMessage(session.telegram_chat_id, `Заявка ${orderRef(order)} отменена менеджером Rentop. Ноутбук снова доступен для бронирования.`);
    }
    return telegram.sendMessage(chatId, `Заявка ${orderRef(order)} отменена. Даты ноутбука сразу освобождены на сайте.`);
  }

  async function extendOrder(order, session, extraDays, chatId) {
    const extendable = new Set(['awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup', 'issued', 'in_use']);
    if (!extendable.has(order.status)) return telegram.sendMessage(chatId, 'Продлить можно только активную или подтверждённую заявку.');
    const newEndDate = addDaysToIso(order.rental_end_date, extraDays);
    const conflict = await database.findOverlappingBlockingOrder(order.id, order.laptop_id, order.rental_end_date, newEndDate);
    if (conflict) return telegram.sendMessage(chatId, `Продление недоступно: с ${conflict.rental_start_date} этот ноутбук уже забронирован в другой заявке.`);
    const totalDays = Math.round((new Date(`${newEndDate}T00:00:00Z`) - new Date(`${order.rental_start_date}T00:00:00Z`)) / 86_400_000);
    const discount = totalDays >= 15 ? 30 : totalDays >= 4 ? 15 : 0;
    const newTotal = Math.round(totalDays * Number(order.daily_rate) * (100 - discount) / 100);
    const extraAmount = Math.max(0, newTotal - Number(order.total_amount));
    await database.updateOrder(order.id, {
      rental_end_date: newEndDate,
      rental_days: totalDays,
      discount_percent: discount,
      total_amount: newTotal
    });
    await recordEvent({ order_id: order.id, event_type: 'rental_extended_by_manager', actor_type: 'manager', metadata: { extra_days: extraDays, extra_amount: extraAmount, new_end_date: newEndDate } });
    if (session?.telegram_chat_id) {
      await telegram.sendMessage(session.telegram_chat_id,
        `Аренда продлена до ${newEndDate}. Доплата за продление: ${extraAmount} сом. Менеджер сообщит способ оплаты.`
      );
    }
    return telegram.sendMessage(chatId, `Заявка ${orderRef(order)} продлена на ${extraDays} дн. Новая дата возврата: ${newEndDate}. Доплата: ${extraAmount} сом.`);
  }

  const dashboardFilters = {
    all: { title: 'Все последние заявки', statuses: [] },
    review: { title: 'Ожидают проверки', statuses: ['pending_review'] },
    payment: { title: 'Ожидают оплаты', statuses: ['awaiting_payment', 'payment_review'] },
    active: { title: 'Активные аренды', statuses: ['awaiting_pickup', 'issued', 'in_use', 'return_requested'] },
    closed: { title: 'Завершённые и отклонённые', statuses: ['returned', 'completed', 'rejected', 'cancelled', 'expired'] }
  };

  async function sendManagerDashboard(chatId, filterKey = 'all') {
    const filter = dashboardFilters[filterKey] || dashboardFilters.all;
    const orders = await database.listRecentOrders(12, filter.statuses);
    const lines = await Promise.all(orders.map(async (order, index) => {
      const laptop = await database.getLaptop(order.laptop_id);
      return `${index + 1}. ${orderRef(order)} · ${laptopTitle(laptop)}\n${order.status} · ${order.rental_start_date}—${order.rental_end_date} · ${order.total_amount} сом`;
    }));
    const orderButtons = orders.slice(0, 8).map((order) => ([
      { text: `Открыть ${orderRef(order)}`, callback_data: `admin_order:${order.id}` }
    ]));
    return telegram.sendMessage(chatId,
      `⚙️ Меню менеджера\n${filter.title}\n\n${lines.length ? lines.join('\n\n') : 'Заявок в этом разделе нет.'}`,
      { reply_markup: { inline_keyboard: [
        [
          { text: 'Все', callback_data: 'dashboard:all' },
          { text: 'На проверке', callback_data: 'dashboard:review' },
          { text: 'Оплата', callback_data: 'dashboard:payment' }
        ],
        [
          { text: 'Активные', callback_data: 'dashboard:active' },
          { text: 'Закрытые', callback_data: 'dashboard:closed' },
          { text: 'Проблемы', callback_data: 'cases:open' }
        ],
        ...orderButtons
      ] } }
    );
  }

  async function sendAdmin(text, extra = {}) {
    return telegram.sendMessage(config.adminChatId, text, extra);
  }

  async function saveStep(session, patch) {
    return database.saveSession({ ...session, ...patch, updated_at: new Date().toISOString() });
  }

  async function startClient(message, token) {
    if (!token) {
      await telegram.sendMessage(message.chat.id, 'Здравствуйте! Откройте Rentop KG, выберите ноутбук и продолжите оформление через кнопку Telegram на сайте.');
      return;
    }

    const order = await database.getOrderByToken(token);
    if (!order || ['cancelled', 'rejected', 'expired', 'completed'].includes(order.status)) {
      await telegram.sendMessage(message.chat.id, 'Ссылка на заявку недействительна. Пожалуйста, создайте новую заявку на сайте Rentop KG.');
      return;
    }
    if (order.telegram_user_id && String(order.telegram_user_id) !== String(message.from.id)) {
      await telegram.sendMessage(message.chat.id, 'Эта заявка уже открыта в другом Telegram-аккаунте.');
      return;
    }

    await database.updateOrder(order.id, { telegram_user_id: message.from.id, telegram_chat_id: message.chat.id });
    const existing = await database.getSession(order.id);
    const initialStep = order.customer_name ? 'awaiting_phone_contact' : 'awaiting_name';
    const session = existing || await database.saveSession({
      order_id: order.id,
      telegram_user_id: message.from.id,
      telegram_chat_id: message.chat.id,
      step: initialStep
    });

    if (!existing) {
      const laptop = await database.getLaptop(order.laptop_id);
      await sendAdmin(
        `Новая заявка — документы ожидаются\n\n${orderDetails(order, laptop)}\n` +
        `Клиент: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\n` +
        `Залог: определить после проверки документов.`
      );
    }

    if (session.step === 'awaiting_phone_contact') {
      await telegram.sendMessage(message.chat.id,
        `${orderDetails(order, await database.getLaptop(order.laptop_id))}\n\n` +
        'Шаг 1 из 6. Подтвердите номер телефона системной кнопкой Telegram. Ручной ввод номера не принимается.',
        contactKeyboard()
      );
      return;
    }
    if (session.step === 'awaiting_document_type') {
      await telegram.sendMessage(message.chat.id, 'Шаг 2 из 6. Выберите тип документа:', documentOptions());
      return;
    }
    if (session.step === 'awaiting_id') {
      const awaitingSecondSide = Boolean(session.id_document_received_at);
      await telegram.sendMessage(
        message.chat.id,
        awaitingSecondSide
          ? 'Продолжим заявку. Отправьте вторую сторону ID-карты/паспорта файлом или качественным фото.'
          : `${orderDetails(order, await database.getLaptop(order.laptop_id))}\n\n` +
            `Залог определяется менеджером после проверки документов — с учётом выбранного ноутбука.\n\n` +
            `Шаг 3 из 6. Пришлите первую сторону ID-карты или паспорта как файл либо обычное качественное фото.\n\n` +
            `Для иностранного гражданина: паспорт и документ, подтверждающий право проживания/регистрацию в Кыргызстане.`,
        helpKeyboard(order.id)
      );
      return;
    }
    if (session.step !== 'awaiting_name') {
      await telegram.sendMessage(message.chat.id, 'Ваша заявка уже в обработке. Мы напишем вам здесь, когда потребуется следующий шаг.');
      return;
    }

    await telegram.sendMessage(message.chat.id, `Заявка ${orderRef(order)} принята. Напишите, пожалуйста, ваши имя и фамилию — как в документе.`);
  }

  async function sendForReview(order, session) {
    await database.updateOrder(order.id, { status: 'pending_review', documents_received_at: new Date().toISOString() });
    await saveStep(session, { step: 'under_review' });
    await telegram.sendMessage(session.telegram_chat_id, 'Спасибо. Документы и подтверждение оферты переданы менеджеру Rentop на проверку. Мы сообщим решение в этом чате.');
    const laptop = await database.getLaptop(order.laptop_id);
    await sendAdmin(
      `📁 Заявка ${orderRef(order)} · документы готовы к проверке\n\n${orderDetails(order, laptop)}\n` +
      `Клиент: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\n` +
      `Документы: ${[session.id_document_first_message_id, session.id_document_second_message_id, session.selfie_message_id, session.supporting_document_message_id].filter(Boolean).length} из 4\n` +
      `Залог: определить после решения.\n\nНиже — оригиналы документов одним пакетом.`,
      adminKeyboard([
        { text: '✅ Одобрить документы', callback_data: `approve:${order.id}` },
        { text: '❌ Отклонить', callback_data: `reject:${order.id}` }
      ])
    );
    await sendDocumentPacket(order, session);
  }

  async function handleClientMessage(message) {
    const session = await database.getSessionByUser(message.from.id);
    if (!session || String(session.telegram_chat_id) !== String(message.chat.id)) return;
    const order = await database.getOrder(session.order_id);
    if (!order) return;

    const text = message.text?.trim();
    if (session.step === 'awaiting_name') {
      if (!text || text.length < 2) return telegram.sendMessage(message.chat.id, 'Напишите имя и фамилию текстом, как в документе.');
      await database.updateOrder(order.id, { customer_name: text });
      await saveStep(session, { step: 'awaiting_phone_contact' });
      return telegram.sendMessage(message.chat.id, 'Теперь подтвердите номер системной кнопкой Telegram.', contactKeyboard());
    }
    if (session.step === 'awaiting_phone_contact') {
      const contact = message.contact;
      if (!contact || String(contact.user_id) !== String(message.from.id)) {
        return telegram.sendMessage(message.chat.id, 'Используйте кнопку «Отправить подтверждённый номер». Номер другого человека не принимается.', contactKeyboard());
      }
      let phone;
      try { phone = normalizeKyrgyzPhone(contact.phone_number); } catch (error) {
        return telegram.sendMessage(message.chat.id, error.message, contactKeyboard());
      }
      const previousPhone = order.customer_phone;
      await database.updateOrder(order.id, { customer_phone: `+${phone}`, phone_verified_at: new Date().toISOString() });
      await saveStep(session, { step: 'awaiting_document_type' });
      await recordEvent({ order_id: order.id, event_type: 'phone_verified', actor_type: 'customer', actor_telegram_id: message.from.id, metadata: { mismatched_site_phone: Boolean(previousPhone && previousPhone.replace(/\D/g, '') !== phone) } });
      await telegram.sendMessage(message.chat.id, 'Номер подтверждён. Кнопка отправки контакта больше не нужна — убираю её.', removeReplyKeyboard());
      return telegram.sendMessage(message.chat.id, 'Шаг 2 из 6: выберите тип документа.', documentOptions());
    }
    if (text === '✅ Ноутбук получил') {
      return confirmPickup(order, session, message.chat.id, 'customer');
    }
    if (text === '💬 У меня вопрос') {
      await openCustomerSupportCase(order, session, message.from.id, 'rentop');
      return;
    }
    if (text === '🛠 Проблема с ARCHA POINT') {
      await openCustomerSupportCase(order, session, message.from.id, 'archa');
      return;
    }
    if (text === '⭐ Оставить отзыв') {
      if (!['in_use', 'completed'].includes(order.status)) {
        return telegram.sendMessage(message.chat.id, 'Отзыв можно оставить после получения ноутбука. Сейчас по заявке доступна поддержка — выберите «У меня вопрос» или «Проблема с ARCHA POINT».');
      }
      await saveStep(session, { step: 'awaiting_feedback' });
      return telegram.sendMessage(message.chat.id, 'Напишите отзыв одним сообщением. Его увидит команда Rentop. Не указывайте в тексте паспортные данные, PIN-коды или банковские реквизиты.');
    }
    if (session.step === 'awaiting_feedback') {
      if (!text || text.length < 2) return telegram.sendMessage(message.chat.id, 'Напишите, пожалуйста, короткий отзыв текстом.');
      await recordEvent({ order_id: order.id, event_type: 'customer_feedback_received', actor_type: 'customer', actor_telegram_id: message.from.id, metadata: { feedback: text.slice(0, 1500) } });
      await sendAdmin(`⭐ Новый отзыв по заявке ${orderRef(order)}\n\n${text.slice(0, 1500)}`);
      await saveStep(session, { step: order.status === 'completed' ? 'completed' : 'in_use' });
      return sendCustomerServiceMenu(message.chat.id, 'Спасибо за отзыв! Он передан команде Rentop.');
    }
    if (session.step === 'awaiting_id') {
      if (!isOfficialDocument(message)) {
        return telegram.sendMessage(message.chat.id, 'Пришлите документ файлом или обычным качественным фото.');
      }
      if (!session.id_document_received_at) {
        await captureDocument(session, message, 'id_document_first_message_id');
        await saveStep(session, { id_document_received_at: new Date().toISOString() });
        return telegram.sendMessage(message.chat.id, 'Первая сторона получена. Шаг 4 из 6: отправьте вторую сторону ID-карты/паспорта файлом или качественным фото.', helpKeyboard(order.id));
      }
      const updatedSession = await captureDocument(session, message, 'id_document_second_message_id');
      await saveStep(updatedSession, { step: 'awaiting_selfie' });
      return telegram.sendMessage(message.chat.id, 'Шаг 5 из 6: отправьте селфи как обычную фотографию. Лицо должно быть хорошо видно.', helpKeyboard(order.id));
    }
    if (session.step === 'awaiting_selfie') {
      if (!isSelfiePhoto(message)) return telegram.sendMessage(message.chat.id, 'Нужно отправить селфи именно как фотографию, не файлом и не скриншотом.');
      const updatedSession = await captureDocument(session, message, 'selfie_message_id');
      await saveStep(updatedSession, { step: 'awaiting_supporting_document', selfie_received_at: new Date().toISOString() });
      return telegram.sendMessage(message.chat.id,
        'Шаг 6 из 6: отправьте справку с места жительства или работы файлом либо качественным фото. Документ обязателен для рассмотрения заявки.\n\n' +
        'Подделка, изменение или использование чужих документов недопустимы. При наличии оснований это может повлечь отказ в заявке и ответственность, установленную законодательством Кыргызской Республики.',
        helpKeyboard(order.id)
      );
    }
    if (session.step === 'awaiting_supporting_document') {
      if (!isOfficialDocument(message)) return telegram.sendMessage(message.chat.id, 'Справка обязательна. Пришлите её файлом или качественным фото.', helpKeyboard(order.id));
      const updatedSession = await captureDocument(session, message, 'supporting_document_message_id');
      await saveStep(updatedSession, { supporting_document_received_at: new Date().toISOString(), step: 'awaiting_offer_acceptance' });
      const offerLink = config.offerUrl ? `\n\nОферта: ${config.offerUrl}` : '';
      return telegram.sendMessage(message.chat.id,
        `Документы получены. Шаг 5 из 6: ознакомьтесь с публичной офертой${offerLink}\n\nПосле ознакомления подтвердите согласие кнопкой ниже. Затем мы отправим одноразовый код подтверждения.`,
        { reply_markup: { inline_keyboard: [
          [{ text: 'Я прочитал и принимаю оферту Rentop.KG', callback_data: `offer_accept:${order.id}` }],
          [{ text: 'Нужна помощь менеджера', callback_data: `support:${order.id}` }]
        ] } }
      );
    }
    if (session.step === 'awaiting_offer_otp') {
      if (!/^\d{6}$/.test(text || '')) return telegram.sendMessage(message.chat.id, 'Введите 6 цифр из SMS одним сообщением.');
      if (!order.offer_otp_hash || !order.offer_otp_expires_at || new Date(order.offer_otp_expires_at) < new Date()) {
        return telegram.sendMessage(message.chat.id, 'Срок действия кода истёк. Нажмите кнопку принятия оферты ещё раз, чтобы запросить новый код.');
      }
      const attempts = Number(order.offer_otp_attempts || 0);
      if (attempts >= 5) return telegram.sendMessage(message.chat.id, 'Лимит попыток исчерпан. Нажмите кнопку принятия оферты ещё раз, чтобы запросить новый код.');
      const expected = Buffer.from(order.offer_otp_hash, 'hex');
      const received = Buffer.from(otpHash(order.id, text), 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        await database.updateOrder(order.id, { offer_otp_attempts: attempts + 1 });
        return telegram.sendMessage(message.chat.id, `Код не совпал. Осталось попыток: ${4 - attempts}.`);
      }
      const now = new Date().toISOString();
      await database.updateOrder(order.id, { offer_otp_verified_at: now, offer_otp_hash: null, offer_otp_expires_at: null });
      await recordEvent({ order_id: order.id, event_type: 'offer_otp_verified', actor_type: 'customer', actor_telegram_id: message.from.id, metadata: { offer_version: order.offer_version } });
      return sendForReview(await database.getOrder(order.id), await database.getSession(order.id));
    }
    if (session.step === 'awaiting_receipt') {
      if (!isDocumentMessage(message)) return telegram.sendMessage(message.chat.id, 'Отправьте чек оплаты как фото или файл.');
      await telegram.forwardMessage(config.adminChatId, message.chat.id, message.message_id);
      await database.updateOrder(order.id, { status: 'payment_review', payment_receipt_received_at: new Date().toISOString() });
      await saveStep(session, { step: 'payment_review', payment_receipt_received_at: new Date().toISOString() });
      await telegram.sendMessage(message.chat.id, 'Чек получен и передан менеджеру на проверку.');
      return sendAdmin(`Проверьте оплату по заявке ${orderRef(order)}.`, adminKeyboard([
        { text: '✅ Оплата подтверждена', callback_data: `paid:${order.id}` },
        { text: '❌ Чек отклонён', callback_data: `payment_reject:${order.id}` }
      ]));
    }
  }

  async function handleAdminCommand(message) {
    if (!isAdmin(message.from.id)) return;
    const [rawCommand, orderId, rawValue] = (message.text || '').trim().split(/\s+/, 3);
    const command = rawCommand?.toLowerCase().split('@')[0];
    const pendingAction = await database.getAdminActionByUser(message.from.id);
    if (pendingAction?.action === 'deposit' && /^\d+(?:[.,]\d{1,2})?$/.test((message.text || '').trim())) {
      const order = await database.getOrder(pendingAction.order_id);
      const session = order && await database.getSession(order.id);
      const amount = Number((message.text || '').trim().replace(',', '.'));
      if (!order || !session || !Number.isFinite(amount) || amount < 0) return telegram.sendMessage(message.chat.id, 'Не удалось применить сумму. Нажмите «Другая сумма» ещё раз.');
      await database.clearAdminAction(order.id);
      return applyDeposit(order, session, amount, message.chat.id);
    }
    if (pendingAction?.action === 'pickup_pin' && (message.text || '').trim() && !message.text.trim().startsWith('/')) {
      const order = await database.getOrder(pendingAction.order_id);
      const session = order && await database.getSession(order.id);
      const pickupCode = message.text.trim();
      if (!order || !session || pickupCode.length > 200) return telegram.sendMessage(message.chat.id, 'Не удалось сохранить PIN/QR. Нажмите «Ввести PIN/QR» ещё раз.');
      await database.clearAdminAction(order.id);
      return sendPickupPin(order, session, pickupCode, message.chat.id);
    }
    if (command === '/admin' || command === '/orders') {
      return sendManagerDashboard(message.chat.id);
    }
    if (command === '/deposit') {
      const amount = Number(rawValue?.replace(',', '.'));
      if (!orderId || !Number.isFinite(amount) || amount < 0) {
        return telegram.sendMessage(message.chat.id, 'Формат: /deposit <полный_ID_заказа> <сумма>. Пример: /deposit 11111111-1111-1111-1111-111111111111 5000');
      }
      const order = await database.getOrder(orderId);
      const session = order && await database.getSession(order.id);
      if (!order || !session) return telegram.sendMessage(message.chat.id, 'Заказ не найден. Используйте полный ID из сообщения бота.');
      return applyDeposit(order, session, amount, message.chat.id);
    }
    if (command === '/pin') {
      if (!orderId || !rawValue) return telegram.sendMessage(message.chat.id, 'Формат: /pin <полный_ID_заказа> <PIN_или_QR>.');
      const order = await database.getOrder(orderId);
      const session = order && await database.getSession(order.id);
      if (!order || !session) return telegram.sendMessage(message.chat.id, 'Заказ не найден.');
      return sendPickupPin(order, session, rawValue, message.chat.id);
    }
  }

  async function sendPickupPin(order, session, pickupCode, chatId) {
    await database.updateOrder(order.id, { status: 'awaiting_pickup', pickup_pin: pickupCode, pickup_ready_at: new Date().toISOString(), locker_status: 'loaded' });
    await saveStep(session, { step: 'awaiting_pickup' });
    await recordEvent({ order_id: order.id, event_type: 'pickup_code_sent', actor_type: 'manager', metadata: {} });
    await telegram.sendMessage(session.telegram_chat_id,
      `Ноутбук готов к получению.\nЛокация: ${order.locker_address || 'указанная при оформлении'}\nКод: ${pickupCode}\nПолучите технику через ARCHA POINT в удобное время. После получения обязательно подтвердите это кнопкой ниже.`,
      pickupConfirmationKeyboard(order.id)
    );
    return telegram.sendMessage(chatId, `PIN/QR отправлен клиенту по заявке ${orderRef(order)}.`, adminKeyboard([{ text: '✅ Клиент получил ноутбук', callback_data: `issued:${order.id}` }]));
  }

  async function handleCallback(callback) {
    const [action, orderId, value] = callback.data.split(':');
    const clientActions = new Set(['bank', 'document_type', 'offer_accept', 'support', 'archa_support', 'caseok', 'pickup_ready', 'pickup_received', 'extend_request']);
    if (!isAdmin(callback.from.id) && !clientActions.has(action)) {
      return telegram.answerCallback(callback.id, 'Нет прав. Проверьте RENTOP_ADMIN_USER_IDS в настройках сервера.');
    }
    if (action === 'dashboard') {
      await sendManagerDashboard(callback.message.chat.id, orderId);
      return telegram.answerCallback(callback.id, 'Список обновлён.');
    }
    if (action === 'cases') {
      await sendOpenSupportCases(callback.message.chat.id);
      return telegram.answerCallback(callback.id, 'Список обращений отправлен.');
    }
    const order = action === 'document_type'
      ? await database.getSessionByUser(callback.from.id).then(async (session) => session ? database.getOrder(session.order_id) : null)
      : await database.getOrder(orderId);
    const session = order && await database.getSession(order.id);
    if (!order || !session) return telegram.answerCallback(callback.id, 'Заявка не найдена.');

    if (clientActions.has(action) && String(callback.from.id) !== String(session.telegram_user_id)) {
      return telegram.answerCallback(callback.id, 'Эта кнопка не для вашей заявки.');
    }

    if (action === 'document_type') {
      const documentType = orderId;
      if (session.step !== 'awaiting_document_type') {
        return telegram.answerCallback(callback.id, 'Этот этап уже пройден.');
      }
      const instructions = documentType === 'foreign_passport' || documentType === 'foreign_resident'
        ? 'Пришлите загранпаспорт файлом или качественным фото. Затем бот запросит документ о регистрации/ВНЖ в Кыргызстане.'
        : 'Пришлите первую сторону ID-карты или паспорта файлом либо качественным фото.';
      await saveStep(session, { step: 'awaiting_id', document_type: documentType });
      await recordEvent({ order_id: order.id, event_type: 'document_type_selected', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: { document_type: documentType } });
      await telegram.sendMessage(session.telegram_chat_id, `Шаг 3 из 6. ${instructions}`, helpKeyboard(order.id));
      return telegram.answerCallback(callback.id, 'Тип документа сохранён.');
    }

    if (action === 'support' || action === 'archa_support') {
      const isArchaSupport = action === 'archa_support';
      const kind = isArchaSupport ? 'archa' : 'rentop';
      await openCustomerSupportCase(order, session, callback.from.id, kind);
      return telegram.answerCallback(callback.id, 'Менеджер получил запрос.');
    }

    if (action === 'caseok') {
      await resolveSupportCaseSafely(order.id, value, callback.from.id);
      await recordEvent({ order_id: order.id, event_type: 'support_case_resolved_by_customer', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: { kind: value } });
      await sendAdmin(`✅ Клиент отметил обращение как решённое\nЗаявка ${orderRef(order)} · ${value === 'archa' ? 'ARCHA POINT' : 'Rentop'}.`);
      await sendCustomerServiceMenu(session.telegram_chat_id, '✅ Вопрос решён. Спасибо! Быстрое меню остаётся ниже — оно пригодится, если понадобится помощь или вы захотите оставить отзыв.');
      return telegram.answerCallback(callback.id, 'Спасибо, обращение закрыто.');
    }

    if (action === 'case_resolve') {
      await resolveSupportCaseSafely(order.id, value, callback.from.id);
      await recordEvent({ order_id: order.id, event_type: 'support_case_resolved_by_manager', actor_type: 'manager', actor_telegram_id: callback.from.id, metadata: { kind: value } });
      await sendCustomerServiceMenu(
        session.telegram_chat_id,
        `✅ ${value === 'archa' ? 'Вопрос с ARCHA POINT' : 'Обращение в Rentop'} решён. Спасибо! Если понадобится помощь, используйте понятное меню ниже.`
      );
      return telegram.answerCallback(callback.id, 'Обращение закрыто.');
    }

    if (action === 'pickup_ready') {
      if (!['awaiting_pickup', 'issued'].includes(order.status)) {
        return telegram.answerCallback(callback.id, 'Выдача пока не готова или уже подтверждена.');
      }
      await telegram.sendMessage(session.telegram_chat_id, 'Когда откроете ячейку и заберёте ноутбук, подтвердите получение кнопкой ниже.', pickupConfirmationKeyboard(order.id));
      return telegram.answerCallback(callback.id, 'Подтвердите получение после открытия ячейки.');
    }

    if (action === 'pickup_received') {
      await confirmPickup(order, session, callback.message.chat.id, 'customer');
      await sendAdmin(`✅ Клиент подтвердил получение ноутбука\n${orderDetails(order, await database.getLaptop(order.laptop_id))}`);
      return telegram.answerCallback(callback.id, 'Получение подтверждено.');
    }

    if (action === 'extend_request') {
      await recordEvent({ order_id: order.id, event_type: 'customer_requested_extension', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: {} });
      await sendAdmin(`📅 Клиент запросил продление аренды\n\n${orderDetails(order, await database.getLaptop(order.laptop_id))}\n\nОткройте заявку через /admin и выберите срок продления.`);
      await telegram.sendMessage(session.telegram_chat_id, 'Запрос на продление передан менеджеру Rentop. Мы проверим доступность ноутбука и сообщим решение.');
      return telegram.answerCallback(callback.id, 'Запрос передан менеджеру.');
    }

    if (action === 'admin_order') {
      const laptop = await database.getLaptop(order.laptop_id);
      const controlRows = [];
      if (['draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup'].includes(order.status)) {
        controlRows.push([{ text: '🗑 Отменить заявку', callback_data: `cancel_confirm:${order.id}` }]);
      }
      if (['awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup', 'issued', 'in_use'].includes(order.status)) {
        controlRows.push([
          { text: '+1 день', callback_data: `extend:${order.id}:1` },
          { text: '+3 дня', callback_data: `extend:${order.id}:3` },
          { text: '+7 дней', callback_data: `extend:${order.id}:7` }
        ]);
      }
      if (order.status === 'awaiting_pickup' && order.delivery_type === 'arca_locker') {
        controlRows.push([{ text: '📦 ARCHA подтвердил выдачу', callback_data: `archa_issued:${order.id}` }]);
      }
      if (['awaiting_pickup', 'issued', 'in_use'].includes(order.status) && order.delivery_type === 'arca_locker') {
        controlRows.push([{ text: '📦 Текст для ARCHA POINT', callback_data: `archa_request:${order.id}` }]);
      }
      await telegram.sendMessage(callback.message.chat.id,
        `${orderDetails(order, laptop)}\n\n` +
        `Статус: ${order.status}\n` +
        `Клиент: ${order.customer_name || '—'} · ${order.customer_phone || '—'}\n` +
        `Залог: ${order.deposit_amount ?? 'не назначен'}\n` +
        `Создана: ${order.created_at}\n` +
        `Обновлена: ${order.updated_at}\n` +
        `Полный ID: ${order.id}`,
        { reply_markup: { inline_keyboard: [
          ...(order.status === 'awaiting_payment' ? [[{ text: '💳 Назначить залог', callback_data: `deposit_menu:${order.id}` }]] : []),
          ...controlRows
        ] } }
      );
      return telegram.answerCallback(callback.id, 'Карточка отправлена.');
    }

    if (action === 'cancel_confirm') {
      await telegram.sendMessage(callback.message.chat.id, `Отменить заявку ${orderRef(order)}? Даты ноутбука сразу станут свободными.`, {
        reply_markup: { inline_keyboard: [[
          { text: 'Да, отменить', callback_data: `cancel_apply:${order.id}` },
          { text: 'Не отменять', callback_data: `admin_order:${order.id}` }
        ]] }
      });
      return telegram.answerCallback(callback.id, 'Подтвердите отмену.');
    }

    if (action === 'cancel_apply') {
      await cancelOrder(order, session, callback.message.chat.id);
      return telegram.answerCallback(callback.id, 'Заявка отменена.');
    }

    if (action === 'extend') {
      const extraDays = Number(value);
      if (![1, 3, 7].includes(extraDays)) return telegram.answerCallback(callback.id, 'Некорректный срок продления.');
      await extendOrder(order, session, extraDays, callback.message.chat.id);
      return telegram.answerCallback(callback.id, 'Срок продлён.');
    }

    if (action === 'deposit_menu') {
      await telegram.sendMessage(callback.message.chat.id, `Выберите сумму залога для заявки ${orderRef(order)}:`, depositKeyboard(order.id));
      return telegram.answerCallback(callback.id, 'Выберите сумму.');
    }

    if (action === 'deposit_pick') {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) return telegram.answerCallback(callback.id, 'Некорректная сумма.');
      await applyDeposit(order, session, amount, callback.message.chat.id);
      return telegram.answerCallback(callback.id, 'Залог назначен.');
    }

    if (action === 'deposit_custom') {
      await database.setAdminAction({ order_id: order.id, action: 'deposit', admin_user_id: callback.from.id });
      await telegram.sendMessage(callback.message.chat.id, `Введите только сумму залога цифрами для заявки ${orderRef(order)}. Например: 7500`);
      return telegram.answerCallback(callback.id, 'Жду сумму одним сообщением.');
    }

    if (action === 'pin_custom') {
      await database.setAdminAction({ order_id: order.id, action: 'pickup_pin', admin_user_id: callback.from.id });
      await telegram.sendMessage(callback.message.chat.id, `Отправьте PIN-код или QR-ссылку для заявки ${orderRef(order)} одним сообщением.`);
      return telegram.answerCallback(callback.id, 'Жду PIN/QR.');
    }

    if (action === 'archa_request') {
      if (order.delivery_type !== 'arca_locker') return telegram.answerCallback(callback.id, 'Эта заявка не на выдачу через ARCHA POINT.');
      await sendArchaPointRequest(order, callback.message.chat.id);
      return telegram.answerCallback(callback.id, 'Готовый текст отправлен.');
    }

    if (action === 'archa_issued') {
      await confirmPickup(order, session, callback.message.chat.id, 'archa_point');
      return telegram.answerCallback(callback.id, 'Выдача подтверждена.');
    }

    if (action === 'offer_accept') {
      if (session.step !== 'awaiting_offer_acceptance') {
        return telegram.answerCallback(callback.id, 'Этот этап уже пройден.');
      }
      if (!config.offerOtpHmacSecret || !config.offerUrl) {
        const missing = [
          !config.offerOtpHmacSecret ? 'OFFER_OTP_HMAC_SECRET' : null,
          !config.offerUrl ? 'OFFER_URL' : null
        ].filter(Boolean);
        console.error(`OTP is not configured: ${missing.join(', ')}`);
        await sendAdmin(`⚠️ OTP-подписание недоступно для заявки ${orderRef(order)}. Добавьте в Vercel Preview: ${missing.join(', ')}.`);
        return telegram.answerCallback(callback.id, 'Подтверждение временно недоступно. Менеджер уведомлён.');
      }
      const code = String(randomInt(100000, 1_000_000));
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const acceptedAt = new Date().toISOString();
      let delivery;
      try {
        delivery = await otp.sendOfferCode({
          chatId: session.telegram_chat_id,
          phone: order.customer_phone,
          code
        });
      } catch (error) {
        console.error('Could not deliver offer OTP:', error.message);
        await sendAdmin(
          `⚠️ Не удалось отправить OTP для заявки ${orderRef(order)}.\n` +
          `Техническая причина: ${error.message}\n\n` +
          'Проверьте настройки OTP-провайдера. Секреты и код не отображаются.'
        );
        return telegram.answerCallback(callback.id, 'Не удалось отправить код. Попробуйте позже.');
      }
      await database.updateOrder(order.id, {
        offer_version: config.offerVersion,
        offer_accepted_at: acceptedAt,
        offer_otp_hash: otpHash(order.id, code),
        offer_otp_expires_at: expiresAt,
        offer_otp_attempts: 0
      });
      await saveStep(session, { step: 'awaiting_offer_otp' });
      await recordEvent({ order_id: order.id, event_type: 'offer_accepted', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: { offer_version: config.offerVersion, otp_provider: delivery.provider, telegram_fallback: delivery.fallback } });
      if (delivery.provider === 'nikita') {
        await telegram.sendMessage(session.telegram_chat_id, 'SMS-код отправлен на подтверждённый номер. Введите 6 цифр одним сообщением. Код действует 5 минут.');
      }
      return telegram.answerCallback(callback.id, delivery.provider === 'nikita' ? 'SMS-код отправлен.' : 'Код отправлен в Telegram.');
    }

    if (action === 'approve') {
      await database.updateOrder(order.id, {
        status: 'awaiting_payment',
        hold_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      await telegram.sendMessage(session.telegram_chat_id, 'Документы одобрены. Менеджер определяет сумму залога и пришлёт реквизиты для оплаты.');
      await telegram.sendMessage(callback.message.chat.id, `Документы одобрены. Выберите залог для заявки ${orderRef(order)}:`, depositKeyboard(order.id));
    } else if (action === 'reject') {
      await database.updateOrder(order.id, { status: 'rejected' });
      await saveStep(session, { step: 'completed' });
      await telegram.sendMessage(session.telegram_chat_id, 'К сожалению, заявку не удалось одобрить. По вопросам напишите в поддержку Rentop KG.');
    } else if (action === 'bank') {
      if (String(callback.from.id) !== String(session.telegram_user_id)) return telegram.answerCallback(callback.id, 'Эта кнопка не для вашей заявки.');
      const details = value === 'mbank' ? config.mbankPaymentDetails : config.simbankPaymentDetails;
      await database.updateOrder(order.id, { payment_channel: value });
      await saveStep(session, { step: 'awaiting_receipt' });
      await telegram.sendMessage(session.telegram_chat_id, `Оплатите аренду и залог одной суммой через ${value === 'mbank' ? 'MBANK' : 'SIMBANK'}:\n\n${details}\n\nПосле оплаты отправьте сюда чек.`);
      if (value === 'mbank' && config.mbankQrImageSource) {
        try {
          await telegram.sendPhoto(session.telegram_chat_id, config.mbankQrImageSource, 'QR-код для оплаты через MBANK. После оплаты отправьте сюда чек.');
        } catch (error) {
          console.error('Could not send MBANK QR image:', error.message);
        }
      }
    } else if (action === 'paid') {
      await database.updateOrder(order.id, { status: 'awaiting_pickup', payment_confirmed_at: new Date().toISOString() });
      await telegram.sendMessage(session.telegram_chat_id,
        order.delivery_type === 'arca_locker'
          ? 'Оплата подтверждена. Rentop передаёт заявку в ARCHA POINT. Они отправят код/PIN или QR на ваш номер. После получения кода и ноутбука подтвердите выдачу кнопками в этом чате.'
          : 'Оплата подтверждена. Rentop готовит ноутбук к выдаче. PIN/QR придёт сюда после загрузки в постамат.',
        order.delivery_type === 'arca_locker' ? pickupAccessKeyboard(order.id) : helpKeyboard(order.id)
      );
      const paidButtons = [[{ text: '🔐 Резервно отправить PIN / QR', callback_data: `pin_custom:${order.id}` }]];
      if (order.delivery_type === 'arca_locker') paidButtons.unshift([{ text: '📦 Текст для ARCHA POINT', callback_data: `archa_request:${order.id}` }]);
      await telegram.sendMessage(callback.message.chat.id, `Оплата подтверждена по заявке ${orderRef(order)}. Для ARCHA POINT используйте готовый текст ниже. Если их SMS с кодом не дойдёт клиенту, используйте резервную отправку PIN/QR.`, {
        reply_markup: { inline_keyboard: paidButtons }
      });
    } else if (action === 'payment_reject') {
      await database.updateOrder(order.id, { status: 'awaiting_payment' });
      await saveStep(session, { step: 'awaiting_receipt' });
      await telegram.sendMessage(session.telegram_chat_id, 'Чек не удалось подтвердить. Проверьте оплату и отправьте корректный чек ещё раз.');
    } else if (action === 'issued') {
      await confirmPickup(order, session, callback.message.chat.id, 'manager');
    }
    return telegram.answerCallback(callback.id, 'Готово');
  }

  return {
    async handleUpdate(update) {
      if (update.callback_query) return handleCallback(update.callback_query);
      const message = update.message;
      if (!message?.from) return;
      if (message.text?.startsWith('/start')) {
        const [, payload] = message.text.split(/\s+/, 2);
        return startClient(message, payload?.replace(/^r_/, ''));
      }
      if (isAdmin(message.from.id) && String(message.chat.id) === String(config.adminChatId)) {
        try {
          return await handleAdminCommand(message);
        } catch (error) {
          console.error('Manager command failed:', error.message);
          return telegram.sendMessage(message.chat.id, 'Не удалось выполнить это действие. Откройте /admin и попробуйте ещё раз.');
        }
      }
      return handleClientMessage(message);
    }
  };
}
