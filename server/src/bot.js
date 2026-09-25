import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { createNikitaSmsClient, normalizeKyrgyzPhone } from './sms.js';

const adminKeyboard = (buttons) => ({ reply_markup: { inline_keyboard: [buttons] } });
const contactKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: 'Отправить подтверждённый номер', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  }
});
const isOfficialDocument = (message) => Boolean(message?.document || message?.photo?.length);
const isSelfiePhoto = (message) => Boolean(message?.photo?.length);
const isDocumentMessage = (message) => Boolean(message?.document || message?.photo?.length);
const orderRef = (order) => String(order.id).slice(0, 8).toUpperCase();
const laptopTitle = (laptop) => String(laptop?.title || laptop?.name || `Ноутбук #${laptop?.id || '—'}`);

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
  const sms = createNikitaSmsClient(config.nikitaSms);

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

  const helpKeyboard = (orderId) => adminKeyboard([
    { text: 'Нужна помощь менеджера', callback_data: `support:${orderId}` }
  ]);

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
          { text: 'Закрытые', callback_data: 'dashboard:closed' }
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
      return telegram.sendMessage(message.chat.id, 'Номер подтверждён. Шаг 2 из 6: выберите тип документа.', documentOptions());
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
        `Документы получены. Шаг 5 из 6: ознакомьтесь с публичной офертой${offerLink}\n\nПосле ознакомления подтвердите согласие кнопкой ниже. Затем мы отправим одноразовый SMS-код на подтверждённый номер.`,
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
    const [command, orderId, rawValue] = (message.text || '').trim().split(/\s+/, 3);
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
      `Ноутбук готов к получению.\nЛокация: ${order.locker_address || 'указанная при оформлении'}\nКод: ${pickupCode}\nПолучите технику через ARCHA POINT в удобное время.`
    );
    return telegram.sendMessage(chatId, `PIN/QR отправлен клиенту по заявке ${orderRef(order)}.`, adminKeyboard([{ text: '✅ Клиент получил ноутбук', callback_data: `issued:${order.id}` }]));
  }

  async function handleCallback(callback) {
    const [action, orderId, value] = callback.data.split(':');
    const clientActions = new Set(['bank', 'document_type', 'offer_accept', 'support']);
    if (!isAdmin(callback.from.id) && !clientActions.has(action)) {
      return telegram.answerCallback(callback.id, 'Нет прав. Проверьте RENTOP_ADMIN_USER_IDS в настройках сервера.');
    }
    if (action === 'dashboard') {
      await sendManagerDashboard(callback.message.chat.id, orderId);
      return telegram.answerCallback(callback.id, 'Список обновлён.');
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

    if (action === 'support') {
      await recordEvent({ order_id: order.id, event_type: 'customer_requested_help', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: {} });
      await sendAdmin(
        `🆘 Клиент запросил помощь\n\n${orderDetails(order, await database.getLaptop(order.laptop_id))}\n` +
        `Клиент: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\n` +
        `Текущий этап: ${session.step}\n\nОтветьте клиенту через Telegram-диалог с ботом или свяжитесь по подтверждённому номеру.`
      );
      await telegram.sendMessage(session.telegram_chat_id, 'Запрос передан менеджеру Rentop. Мы свяжемся с вами в ближайшее рабочее время.');
      return telegram.answerCallback(callback.id, 'Менеджер получил запрос.');
    }

    if (action === 'admin_order') {
      const laptop = await database.getLaptop(order.laptop_id);
      await telegram.sendMessage(callback.message.chat.id,
        `${orderDetails(order, laptop)}\n\n` +
        `Статус: ${order.status}\n` +
        `Клиент: ${order.customer_name || '—'} · ${order.customer_phone || '—'}\n` +
        `Залог: ${order.deposit_amount ?? 'не назначен'}\n` +
        `Создана: ${order.created_at}\n` +
        `Обновлена: ${order.updated_at}\n` +
        `Полный ID: ${order.id}`,
        order.status === 'awaiting_payment'
          ? { reply_markup: { inline_keyboard: [[{ text: '💳 Назначить залог', callback_data: `deposit_menu:${order.id}` }]] } }
          : undefined
      );
      return telegram.answerCallback(callback.id, 'Карточка отправлена.');
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

    if (action === 'offer_accept') {
      if (session.step !== 'awaiting_offer_acceptance') {
        return telegram.answerCallback(callback.id, 'Этот этап уже пройден.');
      }
      if (!config.nikitaSms.enabled || !config.offerOtpHmacSecret || !config.offerUrl) {
        const missing = [
          !config.nikitaSms.enabled ? 'NIKITA_SMS_LOGIN / NIKITA_SMS_PASSWORD / NIKITA_SMS_SENDER' : null,
          !config.offerOtpHmacSecret ? 'OFFER_OTP_HMAC_SECRET' : null,
          !config.offerUrl ? 'OFFER_URL' : null
        ].filter(Boolean);
        console.error(`OTP is not configured: ${missing.join(', ')}`);
        await sendAdmin(`⚠️ SMS-подписание недоступно для заявки ${orderRef(order)}. Добавьте в Vercel Preview: ${missing.join(', ')}.`);
        return telegram.answerCallback(callback.id, 'SMS-подписание временно недоступно. Менеджер уведомлён.');
      }
      const code = String(randomInt(100000, 1_000_000));
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const acceptedAt = new Date().toISOString();
      try {
        await sms.send({
          phone: order.customer_phone,
          text: `Rentop KG: код подтверждения ${code}. Действует 5 минут. Никому не сообщайте код.`
        });
      } catch (error) {
        console.error('Could not send offer OTP:', error.message);
        await sendAdmin(
          `⚠️ Nikita SMS не принял OTP для заявки ${orderRef(order)}.\n` +
          `Техническая причина: ${error.message}\n\n` +
          'Проверьте номер клиента, Sender ID и IP-ограничения в кабинете Nikita. Секреты и код SMS не отображаются.'
        );
        return telegram.answerCallback(callback.id, 'Не удалось отправить SMS. Проверьте номер и попробуйте позже.');
      }
      await database.updateOrder(order.id, {
        offer_version: config.offerVersion,
        offer_accepted_at: acceptedAt,
        offer_otp_hash: otpHash(order.id, code),
        offer_otp_expires_at: expiresAt,
        offer_otp_attempts: 0
      });
      await saveStep(session, { step: 'awaiting_offer_otp' });
      await recordEvent({ order_id: order.id, event_type: 'offer_accepted', actor_type: 'customer', actor_telegram_id: callback.from.id, metadata: { offer_version: config.offerVersion } });
      await telegram.sendMessage(session.telegram_chat_id, 'SMS-код отправлен на подтверждённый номер. Введите 6 цифр одним сообщением. Код действует 5 минут.');
      return telegram.answerCallback(callback.id, 'SMS-код отправлен.');
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
      await telegram.sendMessage(session.telegram_chat_id, 'Оплата подтверждена. Rentop готовит ноутбук к выдаче. PIN/QR придёт сюда после загрузки в постамат.');
      await telegram.sendMessage(callback.message.chat.id, `Оплата подтверждена по заявке ${orderRef(order)}. После закладки нажмите кнопку и отправьте PIN или QR-ссылку.`, adminKeyboard([
        { text: '🔐 Ввести PIN / QR', callback_data: `pin_custom:${order.id}` }
      ]));
    } else if (action === 'payment_reject') {
      await database.updateOrder(order.id, { status: 'awaiting_payment' });
      await saveStep(session, { step: 'awaiting_receipt' });
      await telegram.sendMessage(session.telegram_chat_id, 'Чек не удалось подтвердить. Проверьте оплату и отправьте корректный чек ещё раз.');
    } else if (action === 'issued') {
      await database.updateOrder(order.id, { status: 'in_use', locker_status: 'client_picked_up' });
      await telegram.sendMessage(session.telegram_chat_id, 'Спасибо! Заказ отмечен как выданный. По вопросам аренды и возврата напишите в поддержку Rentop KG.');
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
        return handleAdminCommand(message);
      }
      return handleClientMessage(message);
    }
  };
}
