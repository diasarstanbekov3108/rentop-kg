const adminKeyboard = (buttons) => ({ reply_markup: { inline_keyboard: [buttons] } });
const isOfficialFile = (message) => Boolean(message?.document);
const isSelfiePhoto = (message) => Boolean(message?.photo?.length);
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

  async function sendAdmin(text, extra = {}) {
    return telegram.sendMessage(config.adminChatId, text, extra);
  }

  async function saveStep(session, patch) {
    return database.saveSession({ ...session, ...patch, updated_at: new Date().toISOString() });
  }

  async function forwardForReview(message, order, label) {
    await sendAdmin(`Документ по заявке ${orderRef(order)}\n${label}`);
    await telegram.forwardMessage(config.adminChatId, message.chat.id, message.message_id);
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
    const initialStep = order.customer_name && order.customer_phone ? 'awaiting_id' : 'awaiting_name';
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

    if (session.step === 'awaiting_id') {
      const awaitingSecondSide = Boolean(session.id_document_received_at);
      await telegram.sendMessage(
        message.chat.id,
        awaitingSecondSide
          ? 'Продолжим заявку. Отправьте вторую сторону ID-карты/паспорта как ФАЙЛ из Tunduk (скрепка → Файл).'
          : `${orderDetails(order, await database.getLaptop(order.laptop_id))}\n\n` +
            `Залог определяется менеджером после проверки документов — с учётом выбранного ноутбука.\n\n` +
            `Шаг 1 из 4. Пришлите первую сторону ID-карты или паспорта как ФАЙЛ из Tunduk ` +
            `(скрепка → Файл). Скриншоты и обычные фотографии не принимаются.\n\n` +
            `Для иностранного гражданина: официальный файл паспорта и документ, подтверждающий право проживания/регистрацию в Кыргызстане.`
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
    await telegram.sendMessage(session.telegram_chat_id, 'Спасибо. Документы отправлены менеджеру Rentop на проверку. Мы сообщим решение в этом чате.');
    const laptop = await database.getLaptop(order.laptop_id);
    await sendAdmin(
      `Документы получены — заявка готова к проверке\n\n${orderDetails(order, laptop)}\n` +
      `Клиент: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\n` +
      `Залог: определить после решения.\n\nПроверьте пересланные материалы.`,
      adminKeyboard([
        { text: '✅ Одобрить документы', callback_data: `approve:${order.id}` },
        { text: '❌ Отклонить', callback_data: `reject:${order.id}` }
      ])
    );
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
      await saveStep(session, { step: 'awaiting_phone' });
      return telegram.sendMessage(message.chat.id, 'Теперь отправьте номер телефона для связи в формате +996…');
    }
    if (session.step === 'awaiting_phone') {
      if (!text || text.replace(/\D/g, '').length < 8) return telegram.sendMessage(message.chat.id, 'Проверьте номер телефона и отправьте его ещё раз.');
      await database.updateOrder(order.id, { customer_phone: text });
      await saveStep(session, { step: 'awaiting_id' });
      return telegram.sendMessage(message.chat.id, 'Отправьте фото ID-карты или паспорта. Если сторон две — отправьте обе фотографии.');
    }
    if (session.step === 'awaiting_id') {
      if (!isOfficialFile(message)) {
        return telegram.sendMessage(message.chat.id, 'Нужен официальный документ как ФАЙЛ из Tunduk (скрепка → Файл). Скриншот или обычное фото не подойдут.');
      }
      if (!session.id_document_received_at) {
        await forwardForReview(message, order, 'ID/паспорт — первая сторона.');
        await saveStep(session, { id_document_received_at: new Date().toISOString() });
        return telegram.sendMessage(message.chat.id, 'Первая сторона получена. Шаг 2 из 4: отправьте вторую сторону ID-карты/паспорта также как ФАЙЛ из Tunduk.');
      }
      await forwardForReview(message, order, 'ID/паспорт — вторая сторона.');
      await saveStep(session, { step: 'awaiting_selfie' });
      return telegram.sendMessage(message.chat.id, 'Шаг 3 из 4: отправьте селфи как обычную ФОТОГРАФИЮ. На фото должно быть хорошо видно лицо.');
    }
    if (session.step === 'awaiting_selfie') {
      if (!isSelfiePhoto(message)) return telegram.sendMessage(message.chat.id, 'Нужно отправить селфи именно как фотографию, не файлом и не скриншотом.');
      await forwardForReview(message, order, 'Селфи для сверки личности.');
      await saveStep(session, { step: 'awaiting_supporting_document', selfie_received_at: new Date().toISOString() });
      return telegram.sendMessage(message.chat.id, 'Шаг 4 из 4: отправьте справку с места жительства как официальный ФАЙЛ из Tunduk. Этот документ обязателен для рассмотрения заявки.');
    }
    if (session.step === 'awaiting_supporting_document') {
      if (!isOfficialFile(message)) return telegram.sendMessage(message.chat.id, 'Справка с места жительства обязательна. Отправьте её как официальный ФАЙЛ из Tunduk (скрепка → Файл).');
      await forwardForReview(message, order, 'Справка с места жительства из Tunduk.');
      await saveStep(session, { supporting_document_received_at: new Date().toISOString() });
      return sendForReview(order, session);
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
    if (command === '/deposit') {
      const amount = Number(rawValue?.replace(',', '.'));
      if (!orderId || !Number.isFinite(amount) || amount < 0) {
        return telegram.sendMessage(message.chat.id, 'Формат: /deposit <полный_ID_заказа> <сумма>. Пример: /deposit 11111111-1111-1111-1111-111111111111 5000');
      }
      const order = await database.getOrder(orderId);
      const session = order && await database.getSession(order.id);
      if (!order || !session) return telegram.sendMessage(message.chat.id, 'Заказ не найден. Используйте полный ID из сообщения бота.');
      await database.updateOrder(order.id, { status: 'awaiting_payment', deposit_amount: amount, hold_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      await saveStep(session, { step: 'awaiting_payment_method' });
      return telegram.sendMessage(session.telegram_chat_id,
        `Заявка одобрена. Аренда: ${order.total_amount} сом. Залог: ${amount} сом.\nВыберите банк для оплаты общей суммы:`,
        adminKeyboard([
          { text: 'Оплатить через MBANK', callback_data: `bank:${order.id}:mbank` },
          { text: 'Оплатить через SIMBANK', callback_data: `bank:${order.id}:simbank` }
        ])
      );
    }
    if (command === '/pin') {
      if (!orderId || !rawValue) return telegram.sendMessage(message.chat.id, 'Формат: /pin <полный_ID_заказа> <PIN_или_QR>.');
      const order = await database.getOrder(orderId);
      const session = order && await database.getSession(order.id);
      if (!order || !session) return telegram.sendMessage(message.chat.id, 'Заказ не найден.');
      await database.updateOrder(order.id, { status: 'awaiting_pickup', pickup_pin: rawValue, pickup_ready_at: new Date().toISOString(), locker_status: 'loaded' });
      await saveStep(session, { step: 'awaiting_pickup' });
      await telegram.sendMessage(session.telegram_chat_id,
        `Ноутбук готов к получению.\nЛокация: ${order.locker_address || 'указанная при оформлении'}\nКод: ${rawValue}\nПолучите технику через ARCHA POINT в удобное время.`
      );
      return telegram.sendMessage(message.chat.id, `PIN/QR отправлен клиенту по заявке ${orderRef(order)}.`, adminKeyboard([{ text: '✅ Клиент получил ноутбук', callback_data: `issued:${order.id}` }]));
    }
  }

  async function handleCallback(callback) {
    const [action, orderId, value] = callback.data.split(':');
    if (!isAdmin(callback.from.id) && action !== 'bank') {
      return telegram.answerCallback(callback.id, 'Нет прав. Проверьте RENTOP_ADMIN_USER_IDS в настройках сервера.');
    }
    const order = await database.getOrder(orderId);
    const session = order && await database.getSession(order.id);
    if (!order || !session) return telegram.answerCallback(callback.id, 'Заявка не найдена.');

    if (action === 'approve') {
      await database.updateOrder(order.id, {
        status: 'awaiting_payment',
        hold_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      await telegram.sendMessage(session.telegram_chat_id, 'Документы одобрены. Менеджер определяет сумму залога и пришлёт реквизиты для оплаты.');
      await telegram.sendMessage(config.adminChatId, `Документы одобрены. Укажите залог командой:\n/deposit ${order.id} <сумма>`);
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
      await telegram.sendMessage(config.adminChatId, `Оплата подтверждена. После закладки отправьте PIN/QR:\n/pin ${order.id} <PIN_или_QR>`);
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
