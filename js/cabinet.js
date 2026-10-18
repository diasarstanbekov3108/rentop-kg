const login = document.getElementById('cabinet-login');
const loading = document.getElementById('cabinet-loading');
const dashboard = document.getElementById('cabinet-dashboard');
const phoneForm = document.getElementById('phone-form');
const codeForm = document.getElementById('code-form');
const phoneInput = document.getElementById('cabinet-phone');
const codeInput = document.getElementById('cabinet-code');
const statusEl = document.getElementById('cabinet-status');
const rentalsEl = document.getElementById('cabinet-rentals');
const emptyEl = document.getElementById('cabinet-empty');
const profileEl = document.getElementById('cabinet-profile');
const dashboardNotice = document.getElementById('cabinet-dashboard-notice');
const loyaltyPanelEl = document.getElementById('cabinet-loyalty-panel');
const loyaltyToggle = document.getElementById('cabinet-loyalty-toggle');
const documentViewer = document.getElementById('cabinet-document-viewer');
const documentViewerContent = document.getElementById('cabinet-document-viewer-content');
const paymentDialog = document.getElementById('cabinet-payment-dialog');
const paymentDialogQr = document.getElementById('cabinet-payment-dialog-qr');
const paymentDialogAmount = document.getElementById('cabinet-payment-dialog-amount');
const paymentDialogExpiry = document.getElementById('cabinet-payment-dialog-expiry');
const paymentDialogLink = document.getElementById('cabinet-payment-dialog-link');
let pendingPhone = '';
let currentPreviewUrl = '';
let paymentByOrder = new Map();
let paymentPollingTimer = null;
let orderPollingTimer = null;
let activePaymentOrderId = '';
let supportWhatsappUrl = '';
let offerSmsConsentRequired = false;
let customerPromos = [];
let cabinetOrders = [];
let customerProfile = null;
// Prevent an older "check session" response from replacing a newer SMS login.
let sessionViewEpoch = 0;
const ARCHA_LOCATIONS = [
  { value:'Bishkek Park — Киевская улица, 148, этаж B2', hours:'ежедневно 10:00–22:00', map:'https://2gis.kg/bishkek/search/%D0%9F%D0%BE%D1%81%D1%82%D0%B0%D0%BC%D0%B0%D1%82%D1%8B/rubricId/95584/firm/70000001092731465/74.589874%2C42.874488' },
  { value:'Гипермаркет «Азия» — ул. Максима Горького, 1/2а', hours:'круглосуточно', map:'https://2gis.kg/bishkek/firm/70000001092731520' },
  { value:'ТЦ DK — ул. Нуркамала Жетикашкаевой, 29', hours:'ежедневно 08:00–21:00', map:'https://2gis.kg/bishkek/geo/70000001092731290' },
  { value:'ТРЦ Tommi Mall — ул. Аалы Токомбаева, 17/2', hours:'круглосуточно', map:'https://2gis.kg/bishkek/geo/70000001092731396' }
];

const formatPhone = (value, masked = false) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (!masked) return digits.length === 9 ? `+996${digits}` : '';
  const first = digits.slice(0, 3); const second = digits.slice(3, 5); const third = digits.slice(5, 7); const fourth = digits.slice(7, 9);
  return `+996${first ? ` (${first}${second ? `) ${second}` : ''}${third ? `-${third}` : ''}${fourth ? `-${fourth}` : ''}` : ' '}`;
};
function bindPhoneMask(input) { if (!input) return; const update = () => { input.value = formatPhone(input.value, true); }; input.addEventListener('focus', update); input.addEventListener('input', update); input.addEventListener('keydown', event => { if (input.selectionStart <= 4 && ['Backspace', 'Delete'].includes(event.key)) event.preventDefault(); }); update(); }
const message = (text = '', kind = '') => { statusEl.textContent = text; statusEl.className = `cabinet-status${kind ? ` is-${kind}` : ''}`; };
const request = async (method, payload) => {
  const response = await fetch('/api/account', { method, credentials: 'same-origin', cache: 'no-store', headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
};
const statusInfo = (status) => ({
  draft:{ title:'Нужны документы', text:'Отправьте документы и подтвердите условия аренды, чтобы менеджер мог проверить заявку.', step:1 },
  pending_review:{ title:'Проверяем документы', text:'Документы получены. Менеджер проверяет их перед созданием счёта.', step:1 },
  awaiting_payment:{ title:'Ожидает оплаты', text:'Оплатите счёт в этом кабинете. После банковского подтверждения менеджер подготовит выдачу.', step:1 },
  payment_review:{ title:'Проверяем оплату', text:'Менеджер проверяет поступление оплаты.', step:2 },
  confirmed:{ title:'Оплата подтверждена', text:'Менеджер передаёт заявку в ARCHA POINT для резервирования ячейки.', step:2 },
  awaiting_archa_reservation:{ title:'Резервируем ячейку', text:'ARCHA POINT готовит ячейку. Пока не приезжайте к постамату.', step:2 },
  awaiting_locker_loading:{ title:'Готовим закладку', text:'Ячейка зарезервирована. Менеджер помещает ноутбук, зарядку и комплект в постамат.', step:3 },
  awaiting_pickup:{ title:'Готово к получению', text:'Ноутбук помещён в ячейку. Проверьте SMS от ARCHA POINT с кодом доступа.', step:3 },
  issued:{ title:'Ожидаем подтверждение получения', text:'Подтвердите получение только после того, как заберёте ноутбук из ячейки.', step:4 },
  in_use:{ title:'Аренда активна', text:'Здесь можно продлить аренду или начать возврат.', step:4 },
  return_requested:{ title:'Возврат оформляется', text:'Менеджер подтвердит выбранный способ возврата и пришлёт дальнейшие инструкции.', step:5 },
  awaiting_return_reservation:{ title:'Резервируем ячейку возврата', text:'ARCHA POINT готовит ячейку для возврата. Дождитесь SMS с кодом.', step:5 },
  awaiting_return_dropoff:{ title:'Можно вернуть ноутбук', text:'Проверьте инструкцию, снимите видео состояния и положите устройство в назначенную ячейку.', step:5 },
  returned:{ title:'Возврат на проверке', text:'Мы проверяем технику и сообщим о завершении.', step:5 },
  completed:{ title:'Аренда завершена', text:'Спасибо, что выбрали Rentop.', step:5 },
  cancelled:{ title:'Заявка отменена', text:'Эти даты снова доступны для бронирования.', step:0 },
  rejected:{ title:'Заявка не подтверждена', text:'Свяжитесь с поддержкой, если остались вопросы.', step:0 }
}[status] || { title:'Заявка обрабатывается', text:'Мы сообщим, когда потребуется действие.', step:1 });
const date = (value) => value ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`)) : '—';
const escape = (value) => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const archaLocation = (value) => ARCHA_LOCATIONS.find(location => location.value === value) || null;
const isValidFullName = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).filter(part => part.length >= 2).length >= 3;
const contentTypeForFile = (file) => {
  const type = String(file?.type || '').toLowerCase();
  if (type) return type;
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.mp4')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return '';
};

function closeDocumentViewer() {
  if (!documentViewer) return;
  documentViewer.hidden = true;
  if (documentViewerContent) documentViewerContent.innerHTML = '';
  document.body.style.overflow = '';
  if (currentPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = '';
}

function openDocumentViewer(url, name = 'Документ', contentType = '') {
  if (!documentViewer || !documentViewerContent || !url) return;
  currentPreviewUrl = url;
  const isFrame = contentType === 'application/pdf' || contentType === 'text/html' || /\.pdf(?:[?#]|$)/i.test(name);
  const isVideo = contentType.startsWith('video/') || /\.(?:mp4|mov)(?:[?#]|$)/i.test(name);
  documentViewerContent.innerHTML = isVideo
    ? `<video controls preload="metadata" src="${escape(url)}">Ваш браузер не поддерживает просмотр видео.</video>`
    : isFrame ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>` : `<img src="${escape(url)}" alt="${escape(name)}">`;
  documentViewer.hidden = false;
  document.body.style.overflow = 'hidden';
}

function openPaymentDialog(payment) {
  if (!paymentDialog || !paymentDialogQr || !payment) return;
  const rawImage = String(payment.qr_image || payment.qr_image_with_frame || '');
  const image = rawImage && !rawImage.startsWith('data:') && !rawImage.startsWith('http') ? `data:image/png;base64,${rawImage}` : rawImage;
  if (!image) return;
  const expires = payment.expires_at ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date(payment.expires_at)) : '—';
  paymentDialogQr.src = image;
  paymentDialogAmount.textContent = `${Number(payment.amount || 0).toLocaleString('ru-RU')} сом`;
  paymentDialogExpiry.textContent = `Счёт действует до ${expires}`;
  if (paymentDialogLink) {
    paymentDialogLink.hidden = !payment.qr_link;
    if (payment.qr_link) paymentDialogLink.href = payment.qr_link;
  }
  paymentDialog.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closePaymentDialog() {
  if (!paymentDialog) return;
  paymentDialog.hidden = true;
  if (paymentDialogQr) paymentDialogQr.removeAttribute('src');
  if (paymentDialogLink) { paymentDialogLink.hidden = true; paymentDialogLink.removeAttribute('href'); }
  document.body.style.overflow = '';
  activePaymentOrderId = '';
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  paymentPollingTimer = null;
}

function hasOpenCabinetForm() {
  return Boolean(rentalsEl?.querySelector('.cabinet-request-panel:not([hidden]) form'));
}

function watchPayment(orderId) {
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  activePaymentOrderId = String(orderId);
  const epoch = sessionViewEpoch;
  paymentPollingTimer = window.setInterval(async () => {
    try {
      if (hasOpenCabinetForm()) return;
      const fresh = await request('GET');
      if (epoch === sessionViewEpoch && fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
    } catch { /* The customer can continue scanning; the next poll will retry. */ }
  }, 8000);
}
function watchOrderUpdates(orders) {
  if (orderPollingTimer) window.clearInterval(orderPollingTimer);
  const needsLiveUpdates = orders.some(order => ['awaiting_payment', 'payment_review', 'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup', 'in_use', 'return_requested', 'awaiting_return_reservation', 'awaiting_return_dropoff', 'returned'].includes(order.status));
  if (!needsLiveUpdates) return;
  const epoch = sessionViewEpoch;
  orderPollingTimer = window.setInterval(async () => {
    try {
      // A mobile file chooser temporarily hides the page. Re-rendering while a
      // document/video form is open would erase the selected local file.
      if (hasOpenCabinetForm()) return;
      const fresh = await request('GET');
      if (epoch !== sessionViewEpoch) return;
      if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
      else showLogin();
    } catch { /* A manual refresh remains available if the network is offline. */ }
  }, 15000);
}

function requestLabel(request) {
  if (request.kind === 'extension') return `Продление: +${request.requested_days} дн. до ${date(request.proposed_return_date)}`;
  return 'Досрочный возврат';
}
function latestDocuments(order) {
  const latest = new Map();
  for (const document of order.documents || []) if (!latest.has(document.kind)) latest.set(document.kind, document);
  return latest;
}
function documentSummary(order) {
  const latest = latestDocuments(order);
  const visibleKinds = latest.size
    ? ['identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video'].filter(kind => latest.has(kind))
    : [];
  const state = (kind, label) => {
    const document = latest.get(kind);
    const symbol = !document ? '○' : document.status === 'rejected' ? '↺' : document.status === 'accepted' ? '✓' : '⌛';
    const text = `${symbol} ${label}`;
    const remove = order.status === 'draft' && document?.id
      ? `<button type="button" class="cabinet-doc-remove" data-document-delete="${escape(document.id)}" data-document-order="${escape(order.id)}" aria-label="Удалить ${escape(label)}">Удалить</button>`
      : '';
    return document?.view_url
      ? `<span class="cabinet-doc-saved"><button type="button" class="cabinet-doc-chip" data-document-view="${escape(document.view_url)}" data-document-name="${escape(document.file_name || label)}" data-document-type="${escape(document.content_type || '')}">${text}</button>${remove}</span>`
      : `<span>${text}</span>`;
  };
  const reasons = [...latest.values()].filter(document => document.status === 'rejected' && document.reviewer_note).map(document => `<li><strong>${escape(({ identity:'Документ', identity_front:'Лицевая сторона', identity_back:'Обратная сторона', selfie:'Селфи', supporting:'Подтверждение' }[document.kind] || 'Документ'))}:</strong> ${escape(document.reviewer_note)}</li>`).join('');
  const labels = { identity:'Документ', identity_front:'Лицевая сторона', identity_back:'Обратная сторона', selfie:'Селфи', supporting:'Подтверждение', issue_video:'Видео до получения', return_video:'Видео возврата' };
  const summary = visibleKinds.length ? visibleKinds.map(kind => state(kind, labels[kind])).join('') : '<span>○ Документы ещё не загружены</span>';
  return `<div class="cabinet-doc-summary">${summary}</div>${reasons ? `<div class="cabinet-document-reasons"><strong>Нужно исправить</strong><ul>${reasons}</ul></div>` : ''}`;
}
function documentMode(order) {
  const latest = latestDocuments(order);
  const required = ['identity_front', 'identity_back', 'selfie', 'supporting'];
  const hasDocument = kind => kind === 'identity_front' ? latest.has('identity_front') || latest.has('identity') : latest.has(kind);
  const isRejected = kind => kind === 'identity_front' ? latest.get('identity_front')?.status === 'rejected' || latest.get('identity')?.status === 'rejected' : latest.get(kind)?.status === 'rejected';
  const missing = required.filter(kind => !hasDocument(kind));
  const rejected = required.filter(isRejected);
  if (rejected.length) return { mode:'replacement', kinds:rejected };
  if (missing.length) return { mode:'upload', kinds:missing };
  if (required.every(kind => latest.get(kind)?.status === 'accepted')) return { mode:'approved', kinds:[] };
  return { mode:'submitted', kinds:[] };
}
function supportUpdates(order) {
  const replies = (order.supportCases || []).filter(item => item.manager_reply);
  if (!replies.length) return '';
  return `<section class="cabinet-support-updates"><strong>Ответ Rentop</strong>${replies.map(item => `<div><span>${escape(item.manager_reply)}</span><small>${date(item.replied_at)}</small></div>`).join('')}</section>`;
}
function paymentPanel(order) {
  const isExtension = Boolean(order.extensionPayment);
  const payment = order.extensionPayment || order.payment;
  const documentsApproved = documentMode(order).mode === 'approved';
  const documentNotice = !isExtension && documentsApproved ? `<div class="cabinet-payment-docs-success"><strong>✓ Документы проверены</strong><span>Можно переходить к оплате, как только появится защищённый QR-счёт.</span></div>` : '';
  if (!isExtension && order.status !== 'awaiting_payment') return '';
  if (!payment) return `<div class="cabinet-payment waiting"><strong>Готовим способ оплаты</strong><p>Менеджер формирует защищённый QR-счёт. Обновите страницу через несколько минут — платить по реквизитам в переписке не нужно.</p>${documentNotice}</div>`;
  if (payment.status === 'paid') return `<div class="cabinet-payment success"><strong>${isExtension ? 'Продление оплачено' : 'Оплата получена'}</strong><p>${isExtension ? `Банк подтвердил доплату. Новый срок аренды: до ${date(order.rental_end_date)}.` : 'Банк подтвердил платёж. Мы готовим следующий шаг выдачи.'}</p>${documentNotice}</div>`;
  if (['revoked', 'expired', 'failed'].includes(payment.status)) return `<div class="cabinet-payment waiting"><strong>Счёт обновляется</strong><p>Предыдущий QR больше не используйте. Менеджер подготовит новый защищённый счёт, если оплата ещё нужна.</p>${documentNotice}</div>`;
  const rawImage = String(payment.qr_image || payment.qr_image_with_frame || '');
  const image = rawImage && !rawImage.startsWith('data:') && !rawImage.startsWith('http') ? `data:image/png;base64,${rawImage}` : rawImage;
  const expires = payment.expires_at ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(payment.expires_at)) : '—';
  return `<section class="cabinet-payment"><div><strong>${isExtension ? 'Оплата продления' : 'Оплата аренды'}</strong><span>${Number(payment.amount || 0).toLocaleString('ru-RU')} сом · до ${escape(expires)}</span></div><p>${image ? 'Нажмите «Оплатить по QR»: код откроется крупно на весь экран. Платёжная ссылка Банка доступна как дополнительный способ, но её поддержка зависит от приложения банка.' : 'Банк создал ссылку на QR. Откройте её в поддерживаемом банковском приложении или попросите менеджера перевыпустить счёт.'} Не переводите сумму вручную на другие реквизиты.</p>${documentNotice}${image ? `<button class="cabinet-action cabinet-payment-open" type="button" data-open-payment="${escape(order.id)}">Оплатить по QR</button>` : ''}${payment.qr_link ? `<a class="cabinet-action cabinet-payment-link secondary" href="${escape(payment.qr_link)}" target="_blank" rel="noopener">Открыть платёжную ссылку Банка</a>` : ''}</section>`;
}
function pickupInstruction(order) {
  if (order.delivery_type !== 'arca_locker') return '';
  if (order.status === 'awaiting_pickup') return '';
  if (!['confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'issued'].includes(order.status)) return '';
  const location = order.locker_address || 'локация, выбранная при оформлении';
  const point = archaLocation(location);
  const copy = {
    awaiting_payment:'Оплатите QR-счёт. После подтверждения Банка менеджер подготовит ноутбук и передаст заявку в ARCHA POINT.',
    confirmed:'Оплата подтверждена. Rentop передаёт заявку в ARCHA POINT. Пока не приезжайте к постамату: дождитесь следующего статуса.',
    awaiting_archa_reservation:'ARCHA POINT резервирует ячейку. Мы сообщим, когда менеджер сможет разместить ноутбук.',
    awaiting_locker_loading:'Ячейка готова. Менеджер размещает ноутбук в постамате и проверяет комплектацию.',
    awaiting_pickup: order.locker_status === 'access_sent'
      ? 'SMS-код доступа отправлен. Получите ноутбук, снимите короткое видео и подтвердите получение.'
      : 'Ноутбук помещён в ячейку. ARCHA POINT отправляет SMS-код на номер из заявки. Если код не пришёл, сразу сообщите нам.',
    issued:'Подтвердите получение только после того, как заберёте ноутбук из ячейки.',
    in_use:'Ноутбук получен. Для продления или возврата используйте действия ниже.'
  }[order.status] || 'Rentop координирует выдачу через ARCHA POINT.';
  const accessSent = order.locker_status === 'access_sent';
  return `<section class="cabinet-pickup-instruction ${accessSent ? 'is-access-sent' : ''}"><strong>${accessSent ? '✓ Код доступа отправлен' : 'Получение через ARCHA POINT'}</strong><p class="cabinet-pickup-location">${escape(location)}${point ? ` · ${escape(point.hours)}` : ''}</p>${point ? `<a class="cabinet-map-link" href="${escape(point.map)}" target="_blank" rel="noopener">Открыть маршрут в 2ГИС ↗</a>` : ''}<p>${copy}</p><ol><li>Откройте ячейку только кодом из SMS ARCHA POINT или по инструкции менеджера.</li><li>После открытия снимите короткое видео ноутбука, корпуса, экрана, зарядки и комплекта.</li><li>Прикрепите видео ниже и подтвердите получение. При проблеме не подтверждайте получение — откройте обращение.</li></ol></section>`;
}
function actionPanel(order) {
  const canAct = order.status === 'in_use';
  const paidExtension = order.extensionPayment?.status === 'paid';
  const openExtension = paidExtension ? null : order.requests?.find(request => request.kind === 'extension' && ['open','in_progress'].includes(request.status));
  const openReturn = order.requests?.find(request => request.kind === 'early_return' && ['open','in_progress'].includes(request.status));
  const docState = documentMode(order);
  const documentText = docState.mode === 'approved' ? 'Документы проверены' : docState.mode === 'submitted' ? 'Документы на проверке' : docState.mode === 'replacement' ? 'Заменить документ' : 'Документы и договор';
  const documents = docState.mode === 'approved' ? '' : `<button class="cabinet-action secondary" data-panel="documents" data-document-mode="${docState.mode}" data-document-kinds="${docState.kinds.join(',')}" data-order="${order.id}">${documentText}</button>`;
  const whatsapp = supportWhatsappUrl ? `<a class="cabinet-action ghost" href="${escape(supportWhatsappUrl)}?text=${encodeURIComponent(`Здравствуйте! Нужна помощь по заявке ${order.reference}.`)}" target="_blank" rel="noopener">Написать в WhatsApp</a>` : '';
  if (docState.mode === 'upload') return `<div class="cabinet-documents-cta"><strong>Следующий шаг — документы</strong><p>Четыре файла: ID с двух сторон, селфи с ID и подтверждающий документ.</p>${documents}</div><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button>${whatsapp}</div>`;
  if (order.status === 'awaiting_pickup') {
    const accessSent = order.locker_status === 'access_sent';
    const issueVideo = (order.documents || []).find(document => document.kind === 'issue_video' && document.status !== 'rejected');
    const point = archaLocation(order.locker_address);
    const location = order.locker_address || 'выбранная локация ARCHA POINT';
    const title = accessSent ? 'Код доступа отправлен' : 'Ожидаем код доступа';
    const lead = accessSent
      ? 'Откройте ячейку кодом из SMS ARCHA POINT, осмотрите комплект и снимите короткое видео.'
      : 'Ноутбук помещён в ячейку. ARCHA POINT отправляет код на номер из заявки. Экран обновится автоматически.';
    const steps = accessSent
      ? `<ol><li>Откройте ячейку кодом из SMS.</li><li>Снимите видео ноутбука, экрана, зарядки и комплекта.</li><li>Прикрепите видео и подтвердите получение.</li></ol>`
      : '';
    const primary = !accessSent
      ? ''
      : issueVideo
        ? `<button class="cabinet-action" data-confirm-pickup="${order.id}">Подтвердить получение</button>`
        : `<button class="cabinet-action" data-panel="issue-video" data-order="${order.id}">Прикрепить видео получения</button>`;
    return `<section class="cabinet-pickup-flow ${accessSent ? 'is-ready' : ''}"><div><strong>${accessSent ? '✓ ' : ''}${title}</strong><span>${escape(location)}${point ? ` · ${escape(point.hours)}` : ''}</span></div>${point ? `<a class="cabinet-map-link" href="${escape(point.map)}" target="_blank" rel="noopener">Маршрут в 2ГИС ↗</a>` : ''}<p>${lead}${issueVideo ? ' Видео получено — подтвердите получение.' : ''}</p>${steps}<div class="cabinet-actions">${primary}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Помощь</button></div></section>`;
  }
  const returnVideo = (order.documents || []).find(document => document.kind === 'return_video' && document.status !== 'rejected');
  const returnMethod = openReturn?.return_method || order.return_method;
  if (order.status === 'awaiting_return_reservation') return `${documents}<section class="cabinet-pickup-flow"><strong>Резервируем ячейку для возврата</strong><p>ARCHA POINT готовит ячейку в точке ${escape(order.return_locker_address || order.locker_address || 'из вашей заявки')}. Код придёт отдельным SMS напрямую на номер из заявки — не в личный кабинет. Как только SMS с кодом действительно пришла, нажмите кнопку ниже: откроется загрузка видео возврата.</p><div class="cabinet-actions"><button class="cabinet-action" data-return-access-received="${order.id}">Код из SMS получен</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Код не приходит / помощь</button>${whatsapp}</div></section>`;
  if (order.status === 'awaiting_return_dropoff') return `${documents}<section class="cabinet-pickup-flow is-ready"><strong>✓ Код возврата отправлен</strong><p>До помещения в ячейку снимите короткое видео ноутбука, корпуса, экрана, зарядки и комплекта. Затем используйте только код из сообщения ARCHA POINT и положите технику в назначенную ячейку.</p><ol><li>Снимите видео состояния и комплекта.</li><li>Прикрепите видео ниже.</li><li>Поместите устройство в ячейку по коду ARCHA POINT.</li><li>Только после закрытия ячейки нажмите «Ноутбук помещён».</li></ol><div class="cabinet-actions">${returnVideo ? `<span class="cabinet-request-state is-success">✓ Видео отправлено. После помещения ноутбука подтвердите это ниже.</span><button class="cabinet-action" data-confirm-return-dropoff="${order.id}">Ноутбук помещён в ячейку</button>` : `<button class="cabinet-action secondary" data-panel="return-video" data-order="${order.id}">Прикрепить видео возврата</button>`}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button></div></section>`;
  if (order.status === 'returned') return `${documents}<section class="cabinet-pickup-flow"><strong>Возврат подтверждён</strong><p>Мы получили вашу отметку о помещении ноутбука. Менеджер проверит видео, заберёт устройство из ячейки и проведёт итоговый осмотр. Аренда будет завершена только после этой проверки.</p><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button>${whatsapp}</div></section>`;
  if (order.status === 'return_requested') {
    const methodText = returnMethod === 'courier'
      ? 'Курьер: менеджер согласует время и контакт для передачи. До передачи снимите видео состояния и комплекта.'
      : returnMethod === 'warehouse'
        ? 'Склад Rentop: менеджер пришлёт адрес и время приёма. До передачи снимите видео состояния и комплекта.'
        : 'Менеджер согласует выбранный способ возврата. До передачи снимите видео состояния и комплекта.';
    return `${documents}<section class="cabinet-pickup-flow"><strong>Возврат оформляется</strong><p>${methodText}</p><div class="cabinet-actions">${returnVideo ? '<span class="cabinet-request-state is-success">✓ Видео возврата отправлено. Ожидайте приёмку Rentop.</span>' : `<button class="cabinet-action secondary" data-panel="return-video" data-order="${order.id}">Прикрепить видео возврата</button>`}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button>${whatsapp}</div></section>`;
  }
  if (openExtension || openReturn) {
    const pending = openExtension || openReturn;
    const cancelExtension = openExtension?.status === 'open' ? `<button class="cabinet-action secondary" data-panel="cancel-extension" data-order="${order.id}" data-request-id="${openExtension.id}">Отменить запрос продления</button>` : '';
    return `${documents}<div class="cabinet-request-state">⌛ ${escape(requestLabel(pending))}: ожидает решения менеджера</div><div class="cabinet-actions">${cancelExtension}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button>${whatsapp}</div>`;
  }
  if (order.status === 'completed') return `${documents}${order.feedback ? '<div class="cabinet-request-state">Спасибо — ваш отзыв уже получен.</div>' : '<div class="cabinet-actions"><button class="cabinet-action" data-panel="feedback" data-order="' + order.id + '">Оставить отзыв</button><button class="cabinet-action ghost" data-panel="support" data-order="' + order.id + '">Предложить улучшение</button></div>'}`;
  if (!canAct) return `${documents}<div class="cabinet-action-disabled">Продление и досрочный возврат станут доступны после выдачи ноутбука.</div><div class="cabinet-actions"><button class="cabinet-action secondary" data-panel="support" data-order="${order.id}">Помощь</button>${whatsapp}</div>`;
  return `<div class="cabinet-active-actions"><strong>Управление арендой</strong><p>До ${date(order.rental_end_date)}. Продление проверяется по доступности ноутбука, возврат — после выбора удобного способа.</p><div class="cabinet-actions"><button class="cabinet-action" data-panel="extend" data-order="${order.id}">Продлить аренду</button><button class="cabinet-action secondary" data-panel="return" data-order="${order.id}">Вернуть раньше</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Помощь</button>${whatsapp}</div></div>`;
}
function requestForm(order) {
  return `<div class="cabinet-request-panel" id="panel-${order.id}" hidden></div>`;
}
function promoStatus(promo) {
  if (promo.status === 'redeemed') return 'Использован';
  if (promo.status === 'revoked') return 'Отозван';
  if (promo.status === 'expired' || new Date(promo.expires_at) <= new Date()) return 'Истёк';
  return 'Активен';
}
function loyaltyPanel(promos) {
  if (!promos.length) return '<section class="cabinet-loyalty"><strong>Мои промокоды и скидки</strong><p>После успешной аренды здесь появятся персональные промокоды и история скидок.</p></section>';
  return `<section class="cabinet-loyalty"><strong>Мои промокоды и скидки</strong><div class="cabinet-promo-list">${promos.map(promo => `<div class="cabinet-promo"><b>${escape(promo.code)}</b><span>−${Number(promo.discount_percent || 0)}%</span><small>${escape(promoStatus(promo))} · до ${date(promo.expires_at)}</small></div>`).join('')}</div><p>Промокоды персональные, одноразовые и не уменьшают залог. Применение к следующей аренде будет проверяться на сервере.</p></section>`;
}
function panelMarkup(kind, orderId, documentState = {}) {
  if (kind === 'documents') {
    if (documentState.mode === 'approved') return `<div class="cabinet-document-wait is-approved"><strong>Документы проверены</strong><p>Спасибо. Заявка перешла к оплате или подготовке выдачи — следующий шаг показан выше.</p></div>`;
    if (documentState.mode === 'submitted') return `<div class="cabinet-document-wait"><strong>Документы отправлены</strong><p>Ваша заявка обрабатывается. Ожидайте ответа менеджера — повторная отправка заблокирована.</p><button class="cabinet-action ghost" type="button" data-document-correction="${orderId}">Я отправил(а) неверный документ</button></div>`;
    const replacement = documentState.mode === 'replacement';
    const kinds = replacement ? String(documentState.kinds || '').split(',').filter(Boolean) : ['identity_front', 'identity_back', 'selfie', 'supporting'];
    const requiredKinds = replacement ? kinds : ['identity_front', 'identity_back', 'selfie', 'supporting'];
    const smsConsent = !replacement && offerSmsConsentRequired && !documentState.offerSmsVerified ? `<div class="cabinet-offer-box"><strong>Подтверждение оферты одноразовым кодом</strong><p>После ознакомления подтвердите согласие кодом, отправленным на номер из заявки.</p><button class="cabinet-action secondary" type="button" data-request-offer-sms="${orderId}">Получить код согласия</button><div class="cabinet-inline-row" data-offer-sms-verify hidden><input inputmode="numeric" maxlength="6" placeholder="Код из сообщения" aria-label="Код согласия"><button class="cabinet-action" type="button" data-verify-offer-sms="${orderId}">Подтвердить оферту</button></div></div>` : '';
    const offer = replacement ? '' : `<div class="cabinet-offer-compact"><button class="cabinet-action secondary" type="button" data-open-offer="true">Открыть договор-оферту</button><label class="cabinet-document-consent"><input name="offerConsent" type="checkbox" required><span>Я ознакомился(лась) с публичной офертой и принимаю её условия.</span></label>${smsConsent}</div>`;
    const warnings = replacement ? '' : `<details class="cabinet-safety-notice"><summary>Важно о документах и технике</summary><p>Подделка, использование чужих или заведомо недостоверных документов может повлечь ответственность по законодательству Кыргызской Республики. Rentop проверяет документы до выдачи.</p><p>На выдаваемом оборудовании установлены средства контроля местонахождения и целостности, включая GPS-трекеры и гарантийные пломбы. Несанкционированное вскрытие, нарушение пломб или попытка отключить средства контроля считаются нарушением правил эксплуатации и могут повлечь штраф, возмещение ущерба и обращение в уполномоченные органы.</p></details>`;
    const residence = replacement ? '' : `<label>Адрес проживания <span>обязательно</span></label><textarea name="residenceAddress" required minlength="8" maxlength="500" placeholder="Город, район, улица, дом, квартира (если есть)"></textarea><p class="cabinet-form-hint">Адрес фиксируется в заявке и в защищённом досье. Менеджер сверит его с официальным подтверждающим документом.</p>`;
    const orderComment = replacement ? '' : `<label>Комментарий к заявке <span>необязательно</span></label><textarea name="orderComment" maxlength="1000" placeholder="Например: цель аренды, пожелания по комплектации или вопрос менеджеру"></textarea>`;
    const profileField = replacement || isValidFullName(customerProfile?.full_name) ? '' : `<label>ФИО для договора <span>заполняется один раз</span></label><input name="fullName" autocomplete="name" placeholder="Фамилия Имя Отчество">`;
    return `<form class="cabinet-inline-form cabinet-documents-form" novalidate data-document-upload="true" data-document-replacement="${replacement ? '1' : ''}" data-required-kinds="${requiredKinds.join(',')}" data-order="${orderId}"><label>${replacement ? 'Прикрепите исправленный документ' : 'Подтвердите данные для заявки'}</label><p>${replacement ? 'Менеджер открыл замену для отмеченного файла. После повторной загрузки заявка снова уйдёт на проверку.' : 'Документы увидит только команда Rentop для проверки заявки. Допустимы JPG, PNG или PDF до 8 МБ.'}</p>${profileField}${residence}${kinds.map(fileControl).join('')}${orderComment}${offer}${warnings}<label class="cabinet-document-consent"><input name="documentConsent" type="checkbox"><span>Согласен(на) на передачу документов команде Rentop исключительно для проверки заявки и оформления договора.</span></label><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">${replacement ? 'Отправить замену' : 'Загрузить документы'}</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>После отправки повторная загрузка будет заблокирована до решения менеджера.</p></form>`;
  }
  if (kind === 'issue-video' || kind === 'return-video') {
    const documentKind = kind === 'issue-video' ? 'issue_video' : 'return_video';
    const title = kind === 'issue-video' ? 'Видео до получения' : 'Видео возврата';
    return `<form class="cabinet-inline-form cabinet-evidence-form" data-document-upload="true" data-evidence-upload="true" data-required-kinds="${documentKind}" data-order="${orderId}"><label>${title}</label><p>Снимите одно непрерывное видео до 30 секунд. Допустимы MP4 или MOV до 50 МБ; для iPhone выберите 720p или 1080p/30 fps. До отправки видео можно открыть, удалить и снять заново.</p>${videoControl(documentKind)}<div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить видео</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  }
  if (kind === 'extend') return `<form class="cabinet-inline-form" data-request="extension_request" data-order="${orderId}"><label>На сколько дней продлить?</label><div class="cabinet-inline-row"><input name="days" type="number" min="1" max="30" value="3" required><button class="cabinet-action" type="submit">Отправить запрос</button></div><p>Менеджер проверит доступность и пришлёт сумму к оплате.</p></form>`;
  if (kind === 'cancel-extension') return `<form class="cabinet-inline-form" data-request="cancel_extension_request" data-order="${orderId}"><input name="requestId" type="hidden" value="${escape(documentState.requestId || '')}"><label>Отменить запрос продления?</label><p>Это отменит только ещё не оплаченный запрос. После отмены можно сразу оформить возврат ноутбука.</p><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Отменить продление</button><button class="cabinet-cancel-panel" type="button">Назад</button></div></form>`;
  if (kind === 'return') return `<form class="cabinet-inline-form" data-request="early_return_request" data-order="${orderId}"><label>Как вам удобнее вернуть ноутбук?</label><select name="returnMethod" required><option value="">Выберите способ</option><option value="arca_locker">Через постамат ARCHA POINT</option><option value="courier">Заказать курьера Rentop</option><option value="warehouse">Привезти на склад Rentop</option></select><div class="cabinet-return-locker" hidden><label>Выберите постамат возврата</label><select name="returnLockerAddress"><option value="">Выберите постамат</option>${ARCHA_LOCATIONS.map(location => `<option value="${escape(location.value)}">${escape(location.value)} · ${escape(location.hours)}</option>`).join('')}</select></div><label>Коротко опишите причину (необязательно)</label><textarea name="message" maxlength="500" placeholder="Например: изменились планы, хочу вернуть сегодня"></textarea><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Запросить возврат</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Перед возвратом снимите короткое видео состояния ноутбука и комплекта. Не кладите устройство в ячейку, пока не придёт инструкция.</p></form>`;
  if (kind === 'comment') return `<form class="cabinet-inline-form cabinet-comment-form" data-request="save_order_comment" data-order="${orderId}"><label>Комментарий к заявке</label><textarea name="message" minlength="3" maxlength="1000" placeholder="Например: цель аренды, важные пожелания по комплектации или вопрос менеджеру"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Сохранить комментарий</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Комментарий увидит менеджер ещё до проверки документов.</p></form>`;
  if (kind === 'feedback') return `<form class="cabinet-inline-form" data-request="submit_feedback" data-order="${orderId}"><label>Спасибо, что выбрали Rentop</label><select name="rating"><option value="">Оценка — по желанию</option><option value="5">5 — отлично</option><option value="4">4 — хорошо</option><option value="3">3 — нормально</option><option value="2">2 — есть проблемы</option><option value="1">1 — плохо</option></select><label>Ваш отзыв</label><textarea name="review" maxlength="1500" placeholder="Что вам понравилось?"></textarea><label>Предложение по улучшению</label><textarea name="suggestion" maxlength="1500" placeholder="Что сделать удобнее?"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить отзыв</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  return `<form class="cabinet-inline-form cabinet-support-form" data-request="support_request" data-order="${orderId}"><strong>Поддержка Rentop</strong><p>Опишите проблему — обращение появится в рабочей панели менеджера и будет продублировано в Telegram.</p><label>Тема обращения</label><select name="kind"><option value="rentop">Вопрос к Rentop</option><option value="archa_code_missing">Не пришёл код ARCHA POINT</option><option value="archa_locker_issue">Постамат не открывается или не выдаёт ноутбук</option><option value="archa">Другая проблема с ARCHA POINT</option><option value="rental_issue">Проблема с ноутбуком или комплектностью</option></select><label>Сообщение</label><textarea name="message" minlength="3" maxlength="1000" placeholder="Например: не могу открыть постамат, код не пришёл, нужна помощь"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить обращение</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}
function fileControl(kind) {
  const [title, hint] = ({ identity_front:['Паспорт или ID-карта — лицевая сторона', 'обязательно'], identity_back:['Паспорт или ID-карта — обратная сторона', 'обязательно'], selfie:['Селфи с документом', 'обязательно: откроется фронтальная камера'], supporting:['Официальное подтверждение', 'обязательно: выберите тип документа ниже'] }[kind] || ['Документ', '']);
  const typeChoice = kind === 'supporting' ? `<select name="supportingType" class="cabinet-document-type"><option value="">Выберите документ</option><option value="Справка с места жительства">Справка с места жительства</option><option value="Справка с места работы">Справка с места работы</option><option value="Справка с места учёбы">Справка с места учёбы</option><option value="Тундук">Документ / скрин из Тундук</option><option value="Иной официальный документ">Иной официальный документ</option></select>` : '';
  const selfie = kind === 'selfie';
  return `<div class="cabinet-file-control"><label for="document-${kind}">${title} <span>${hint}</span></label>${typeChoice}<input id="document-${kind}" name="${kind}" type="file" accept="${selfie ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'}" ${selfie ? 'capture="user"' : ''} hidden><div><button class="cabinet-file-choose" type="button" data-file-trigger="${kind}">${selfie ? 'Снять селфи камерой' : 'Выбрать из галереи / файлов'}</button><button class="cabinet-file-preview" type="button" data-file-preview="${kind}" disabled>Файл не выбран</button><button class="cabinet-file-remove" type="button" data-file-remove="${kind}" hidden>Удалить</button></div></div>`;
}
function videoControl(kind) {
  return `<div class="cabinet-file-control"><input id="document-${kind}" name="${kind}" type="file" accept="video/mp4,video/quicktime" capture="environment" hidden><div><button class="cabinet-file-choose" type="button" data-file-trigger="${kind}">Снять или выбрать видео</button><button class="cabinet-file-preview" type="button" data-file-preview="${kind}" disabled>Видео не выбрано</button><button class="cabinet-file-remove" type="button" data-file-remove="${kind}" hidden>Удалить</button></div><p class="cabinet-video-hint" data-video-hint="${kind}"></p></div>`;
}

function showRentals(orders, phone, profile = null, whatsappUrl = '', smsRequired = false, promos = []) {
  customerProfile = profile;
  offerSmsConsentRequired = Boolean(smsRequired);
  customerPromos = Array.isArray(promos) ? promos : [];
  cabinetOrders = Array.isArray(orders) ? orders : [];
  supportWhatsappUrl = whatsappUrl || '';
  paymentByOrder = new Map(cabinetOrders.filter(order => order.payment || order.extensionPayment).map(order => [String(order.id), order.extensionPayment || order.payment]));
  if (activePaymentOrderId && paymentByOrder.get(activePaymentOrderId)?.status !== 'awaiting_payment') closePaymentDialog();
  loading.hidden = true; login.hidden = true; dashboard.hidden = false;
  const fullName = String(profile?.full_name || '').trim();
  const hasValidProfileName = isValidFullName(fullName);
  document.getElementById('cabinet-greeting').textContent = fullName ? `Здравствуйте, ${fullName.split(' ')[1] || fullName}!` : 'Здравствуйте!';
  profileEl.innerHTML = hasValidProfileName
    ? `<p class="cabinet-profile-name">Личный кабинет · ${escape(fullName)} · ${phone}</p>`
    : `<form class="cabinet-profile-form" id="profile-form"><label for="profile-full-name">Заполните ФИО для договора</label><div><input id="profile-full-name" name="fullName" autocomplete="name" placeholder="Фамилия Имя Отчество" required><button class="cabinet-action" type="submit">Сохранить</button></div><p>Указывайте данные так же, как в документе.</p></form>`;
  const created = new URLSearchParams(window.location.search).get('created');
  dashboardNotice.hidden = !created;
  if (created) dashboardNotice.textContent = 'Заявка создана и уже появилась в кабинете. Следующий шаг покажем здесь.';
  const codeSent = cabinetOrders.find(order => order.status === 'awaiting_pickup' && order.locker_status === 'access_sent');
  if (codeSent) { dashboardNotice.hidden = false; dashboardNotice.textContent = 'Код доступа ARCHA POINT отмечен как отправленный. Откройте заявку и пройдите получение.'; }
  if (loyaltyPanelEl) loyaltyPanelEl.innerHTML = loyaltyPanel(customerPromos);
  rentalsEl.innerHTML = cabinetOrders.map(order => {
    const state = statusInfo(order.status);
    return `<article class="cabinet-rental" data-rental="${order.id}"><div class="cabinet-rental-top"><div><h3>${escape(order.laptop_title || 'Ноутбук Rentop')}</h3><p class="cabinet-rental-ref">Заявка ${escape(order.reference)}</p></div><span class="cabinet-badge">${escape(state.title)}</span></div><div class="cabinet-progress" aria-label="Этап ${state.step} из 5"><span class="is-done"></span><span class="${state.step >= 2 ? 'is-done' : ''}"></span><span class="${state.step >= 3 ? 'is-done' : ''}"></span><span class="${state.step >= 4 ? 'is-done' : ''}"></span><span class="${state.step >= 5 ? 'is-done' : ''}"></span></div><p class="cabinet-next-step">${escape(state.text)}</p>${documentSummary(order)}${supportUpdates(order)}<div class="cabinet-rental-grid"><div>Срок<strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div>Получение<strong>${escape(order.delivery_label)}</strong></div><div>Сумма<strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div><div>Скидка<strong>${Number(order.discount_percent || 0)}%</strong></div></div>${pickupInstruction(order)}${paymentPanel(order)}${actionPanel(order)}${requestForm(order)}</article>`;
  }).join('');
  emptyEl.hidden = cabinetOrders.length !== 0;
  watchOrderUpdates(cabinetOrders);
  if (new URLSearchParams(window.location.search).get('return') === 'booking') {
    window.setTimeout(() => window.location.assign('/?resume_booking=1'), 250);
  }
}
function showLogin() {
  sessionViewEpoch += 1;
  if (orderPollingTimer) window.clearInterval(orderPollingTimer);
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  orderPollingTimer = null; paymentPollingTimer = null;
  dashboard.hidden = true;
  loading.hidden = true;
  login.hidden = false;
}
async function loadSession() {
  const epoch = ++sessionViewEpoch;
  // The account and the login screen must never be visible together.
  dashboard.hidden = true;
  login.hidden = true;
  loading.hidden = false;
  try {
    const data = await request('GET');
    if (epoch !== sessionViewEpoch) return;
    if (data.authenticated) { showRentals(data.orders || [], data.phone, data.profile, data.whatsappUrl, data.offerSmsConsentRequired, data.promos); return; }
    showLogin();
  } catch {
    if (epoch !== sessionViewEpoch) return;
    showLogin();
  }
}

document.getElementById('cabinet-refresh')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const initialText = button.textContent;
  button.disabled = true;
  button.textContent = 'Обновляем…';
  try {
    const fresh = await request('GET');
    if (fresh.authenticated) {
      showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
      message('Заявки обновлены.', 'success');
    } else {
      dashboard.hidden = true;
      login.hidden = false;
      message('Сессия закончилась. Войдите повторно.', 'error');
    }
  } catch (error) {
    message(error.message || 'Не удалось обновить заявки. Попробуйте ещё раз.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = initialText;
  }
});

phoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = formatPhone(phoneInput.value); if (!phone) return message('Введите номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = phoneForm.querySelector('button'); button.disabled = true; message('Отправляем код…'); try { await request('POST', { action:'request_code', phone }); pendingPhone = phone; phoneForm.hidden = true; codeForm.hidden = false; codeInput.focus(); message('Код отправлен. Введите 6 цифр из сообщения.', 'success'); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
codeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = codeInput.value.replace(/\D/g, ''); if (code.length !== 6) return message('Введите все 6 цифр кода.', 'error'); const button = codeForm.querySelector('button'); button.disabled = true; message('Проверяем код…'); try { const remember = document.getElementById('cabinet-remember')?.checked !== false; const data = await request('POST', { action:'verify_code', phone:pendingPhone, code, remember }); sessionViewEpoch += 1; showRentals(data.orders || [], data.phone, data.profile, data.whatsappUrl, data.offerSmsConsentRequired, data.promos); message(''); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('change-phone')?.addEventListener('click', () => { codeForm.hidden = true; phoneForm.hidden = false; codeInput.value = ''; message(''); phoneInput.focus(); });
document.getElementById('cabinet-logout')?.addEventListener('click', async () => { await request('POST', { action:'logout' }).catch(() => {}); showLogin(); phoneForm.hidden = false; codeForm.hidden = true; phoneInput.value = ''; codeInput.value = ''; pendingPhone = ''; message('Вы вышли из кабинета.'); });
rentalsEl?.addEventListener('click', event => {
  const paymentButton = event.target.closest('[data-open-payment]');
  if (paymentButton) {
    openPaymentDialog(paymentByOrder.get(String(paymentButton.dataset.openPayment)));
    watchPayment(paymentButton.dataset.openPayment);
    return;
  }
  const offerButton = event.target.closest('[data-open-offer]');
  if (offerButton) {
    openDocumentViewer('/offer', 'Публичная оферта Rentop KG', 'text/html');
    return;
  }
  const requestOfferSms = event.target.closest('[data-request-offer-sms]');
  if (requestOfferSms) {
    if (!requestOfferSms.closest('form')?.elements.offerConsent?.checked) return message('Сначала отметьте согласие с условиями оферты.', 'error');
    requestOfferSms.disabled = true;
    request('POST', { action:'accept_offer', orderId:requestOfferSms.dataset.requestOfferSms })
      .then(() => request('POST', { action:'request_offer_sms_consent', orderId:requestOfferSms.dataset.requestOfferSms }))
      .then(() => {
        const verify = requestOfferSms.closest('.cabinet-offer-box')?.querySelector('[data-offer-sms-verify]');
        if (verify) verify.hidden = false;
        requestOfferSms.textContent = 'Код отправлен';
        message('Код согласия отправлен.', 'success');
      })
      .catch(error => { requestOfferSms.disabled = false; message(error.message, 'error'); });
    return;
  }
  const verifyOfferSms = event.target.closest('[data-verify-offer-sms]');
  if (verifyOfferSms) {
    const code = verifyOfferSms.closest('.cabinet-offer-box')?.querySelector('[data-offer-sms-verify] input')?.value?.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code || '')) return message('Введите 6 цифр из сообщения.', 'error');
    verifyOfferSms.disabled = true;
    request('POST', { action:'verify_offer_sms_consent', orderId:verifyOfferSms.dataset.verifyOfferSms, code })
      .then(async () => { const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos); message('Согласие с офертой подтверждено и зафиксировано.', 'success'); })
      .catch(error => { verifyOfferSms.disabled = false; message(error.message, 'error'); });
    return;
  }
  const fileTrigger = event.target.closest('[data-file-trigger]');
  if (fileTrigger) {
    event.preventDefault();
    const form = fileTrigger.closest('form');
    form?.elements[fileTrigger.dataset.fileTrigger]?.click();
    return;
  }
  const filePreview = event.target.closest('[data-file-preview]');
  if (filePreview && !filePreview.disabled) {
    const form = filePreview.closest('form');
    const file = form?.elements[filePreview.dataset.filePreview]?.files?.[0];
    if (file) openDocumentViewer(URL.createObjectURL(file), file.name, file.type);
    return;
  }
  const fileRemove = event.target.closest('[data-file-remove]');
  if (fileRemove) {
    const form = fileRemove.closest('form');
    const input = form?.elements[fileRemove.dataset.fileRemove];
    const preview = fileRemove.closest('.cabinet-file-control')?.querySelector('[data-file-preview]');
    if (input) input.value = '';
    if (preview) { preview.disabled = true; preview.textContent = 'Файл не выбран'; }
    fileRemove.hidden = true;
    return;
  }
  const deleteSavedDocument = event.target.closest('[data-document-delete]');
  if (deleteSavedDocument) {
    if (!window.confirm('Удалить этот файл? До отправки документов на проверку вы сможете выбрать другой.')) return;
    deleteSavedDocument.disabled = true;
    request('POST', { action:'delete_draft_document', orderId:deleteSavedDocument.dataset.documentOrder, documentId:deleteSavedDocument.dataset.documentDelete })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos); })
      .catch(error => { message(error.message, 'error'); deleteSavedDocument.disabled = false; });
    return;
  }
  const savedDocument = event.target.closest('[data-document-view]');
  if (savedDocument) {
    openDocumentViewer(savedDocument.dataset.documentView, savedDocument.dataset.documentName, savedDocument.dataset.documentType);
    return;
  }
  const pickupConfirm = event.target.closest('[data-confirm-pickup]');
  if (pickupConfirm) {
    if (!window.confirm('Подтвердите только после того, как вы забрали ноутбук из ячейки и проверили комплектность.')) return;
    pickupConfirm.disabled = true;
    request('POST', { action:'confirm_pickup', orderId:pickupConfirm.dataset.confirmPickup })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos); })
      .catch(error => { message(error.message, 'error'); pickupConfirm.disabled = false; });
    return;
  }
  const returnDropoffConfirm = event.target.closest('[data-confirm-return-dropoff]');
  if (returnDropoffConfirm) {
    if (!window.confirm('Подтвердите только после того, как ноутбук, зарядка и комплект действительно помещены в ячейку ARCHA POINT и ячейка закрылась.')) return;
    returnDropoffConfirm.disabled = true;
    request('POST', { action:'confirm_return_dropoff', orderId:returnDropoffConfirm.dataset.confirmReturnDropoff })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos); })
      .catch(error => { message(error.message, 'error'); returnDropoffConfirm.disabled = false; });
    return;
  }
  const returnAccessReceived = event.target.closest('[data-return-access-received]');
  if (returnAccessReceived) {
    if (!window.confirm('Нажимайте только если ARCHA POINT действительно прислал SMS с кодом возврата. После этого откроется загрузка видео.')) return;
    returnAccessReceived.disabled = true;
    request('POST', { action:'confirm_return_access_received', orderId:returnAccessReceived.dataset.returnAccessReceived })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos); })
      .catch(error => { message(error.message, 'error'); returnAccessReceived.disabled = false; });
    return;
  }
  const button = event.target.closest('[data-panel]');
  if (button) {
    const panel = document.getElementById(`panel-${button.dataset.order}`);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    const sourceOrder = cabinetOrders.find(order => String(order.id) === String(button.dataset.order));
    panel.innerHTML = panel.hidden ? '' : panelMarkup(button.dataset.panel, button.dataset.order, { mode:button.dataset.documentMode, kinds:button.dataset.documentKinds, requestId:button.dataset.requestId, offerSmsVerified:Boolean(sourceOrder?.offer_otp_verified_at) });
    if (!panel.hidden) {
      window.requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior:'smooth', block:'start' });
        panel.querySelector('input, select, textarea, button')?.focus({ preventScroll:true });
      });
    }
    return;
  }
  const correction = event.target.closest('[data-document-correction]');
  if (correction) {
    correction.disabled = true;
    request('POST', { action:'document_correction_request', orderId:correction.dataset.documentCorrection })
      .then(result => { message(result.message, 'success'); correction.textContent = 'Запрос на исправление отправлен'; })
      .catch(error => { message(error.message, 'error'); correction.disabled = false; });
    return;
  }
  if (event.target.closest('.cabinet-cancel-panel')) {
    const panel = event.target.closest('.cabinet-request-panel');
    panel.hidden = true; panel.innerHTML = '';
  }
});
document.getElementById('cabinet-document-viewer-close')?.addEventListener('click', closeDocumentViewer);
documentViewer?.addEventListener('click', event => { if (event.target === documentViewer) closeDocumentViewer(); });
document.getElementById('cabinet-payment-dialog-close')?.addEventListener('click', closePaymentDialog);
paymentDialog?.addEventListener('click', event => { if (event.target === paymentDialog) closePaymentDialog(); });
document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!documentViewer?.hidden) closeDocumentViewer(); if (!paymentDialog?.hidden) closePaymentDialog(); });
rentalsEl?.addEventListener('change', event => {
  const returnMethod = event.target.closest('select[name="returnMethod"]');
  if (returnMethod) {
    const locker = returnMethod.closest('form')?.querySelector('.cabinet-return-locker');
    if (locker) locker.hidden = returnMethod.value !== 'arca_locker';
    return;
  }
  const input = event.target.closest('input[type="file"]');
  if (!input) return;
  const preview = input.closest('.cabinet-file-control')?.querySelector('[data-file-preview]');
  if (!preview) return;
  const file = input.files?.[0];
  preview.disabled = !file;
  preview.textContent = file ? `Открыть: ${file.name}` : 'Файл не выбран';
  const remove = input.closest('.cabinet-file-control')?.querySelector('[data-file-remove]');
  if (remove) remove.hidden = !file;
  const hint = input.closest('.cabinet-file-control')?.querySelector('[data-video-hint]');
  delete input.dataset.videoTooLong;
  if (hint) hint.textContent = '';
  if (file?.type?.startsWith('video/')) {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const seconds = Math.round(video.duration || 0);
      URL.revokeObjectURL(objectUrl);
      if (!seconds) return;
      if (seconds > 30) {
        input.dataset.videoTooLong = '1';
        if (hint) hint.textContent = `Видео длится ${seconds} сек. Снимите ролик до 30 секунд.`;
      } else if (hint) {
        hint.textContent = `Длительность: ${seconds} сек. · Размер: ${(file.size / 1024 / 1024).toFixed(1)} МБ из 50 МБ.`;
      }
    };
    video.onerror = () => { URL.revokeObjectURL(objectUrl); if (hint) hint.textContent = 'Не удалось определить длительность — проверьте, что ролик короткий и меньше 50 МБ.'; };
    video.src = objectUrl;
  }
});
rentalsEl?.addEventListener('submit', async event => {
  const documentForm = event.target.closest('[data-document-upload]');
  if (documentForm) {
    event.preventDefault();
    const button = documentForm.querySelector('[type="submit"]');
    const requiredKinds = String(documentForm.dataset.requiredKinds || '').split(',').filter(Boolean);
    const files = ['identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video'].map(kind => ({ kind, file:documentForm.elements[kind]?.files?.[0] })).filter(item => item.file);
    const isReplacement = documentForm.dataset.documentReplacement === '1';
    const isEvidence = documentForm.dataset.evidenceUpload === 'true';
    const formError = (text) => {
      const output = documentForm.querySelector('.cabinet-form-error') || document.createElement('p');
      output.className = 'cabinet-form-error'; output.textContent = text;
      if (!output.parentElement) documentForm.append(output);
      output.scrollIntoView({ behavior:'smooth', block:'nearest' });
    };
    const titles = { identity_front:'лицевую сторону паспорта / ID', identity_back:'обратную сторону паспорта / ID', selfie:'селфи с документом', supporting:'официальное подтверждение', issue_video:'видео получения', return_video:'видео возврата' };
    const missingKinds = requiredKinds.filter(kind => !files.some(item => item.kind === kind));
    if (missingKinds.length) return formError(`Выберите: ${missingKinds.map(kind => titles[kind] || kind).join(', ')}.`);
    if (!isEvidence && !documentForm.elements.documentConsent?.checked) return formError('Отметьте согласие на передачу документов Rentop.');
    if (!isEvidence && !isReplacement && !documentForm.elements.offerConsent?.checked) return formError('Отметьте согласие с публичной офертой.');
    const supporting = files.find(item => item.kind === 'supporting');
    if (supporting && !documentForm.elements.supportingType?.value) return formError('Выберите тип официального подтверждающего документа.');
    const residenceAddress = String(documentForm.elements.residenceAddress?.value || '').trim();
    if (!isReplacement && residenceAddress.length < 8) return formError('Укажите полный адрес проживания: город, улица, дом и квартира (если есть).');
    const fullName = String(documentForm.elements.fullName?.value || '').trim();
    if (!isReplacement && !isValidFullName(customerProfile?.full_name) && !isValidFullName(fullName)) return formError('Укажите фамилию, имя и отчество — как в документе.');
    const unsupported = files.find(({ file }) => !['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime'].includes(contentTypeForFile(file)));
    if (unsupported) return formError(`Файл «${unsupported.file.name}» имеет неподдерживаемый формат. Нужен JPG, PNG или PDF.`);
    button.disabled = true;
    button.textContent = 'Подготавливаем загрузку…';
    try {
      if (!isReplacement && !isValidFullName(customerProfile?.full_name)) {
        const saved = await request('POST', { action:'save_profile', fullName });
        customerProfile = saved.profile || { full_name:fullName };
      }
      if (!isReplacement) await request('POST', { action:'save_residence_address', orderId:documentForm.dataset.order, residenceAddress, supportingDocumentType:documentForm.elements.supportingType?.value || '' });
      const orderComment = String(documentForm.elements.orderComment?.value || '').trim();
      if (orderComment.length >= 3) await request('POST', { action:'save_order_comment', orderId:documentForm.dataset.order, message:orderComment });
      if (!isReplacement) await request('POST', { action:'accept_offer', orderId:documentForm.dataset.order });
      for (let index = 0; index < files.length; index += 1) {
        const { kind, file } = files[index];
        const input = documentForm.elements[kind];
        if (['issue_video', 'return_video'].includes(kind) && input?.dataset.videoTooLong === '1') throw new Error('Снимите видео короче 30 секунд и выберите его заново.');
        const selectedType = kind === 'supporting' ? documentForm.elements.supportingType.value : '';
        const fileName = selectedType ? `${selectedType} — ${file.name}` : file.name;
        button.textContent = `Загружаем ${index + 1}/${files.length}…`;
        const contentType = contentTypeForFile(file);
        const isVideo = ['video/mp4', 'video/quicktime'].includes(contentType);
        if (file.size > (isVideo ? 50 : 8) * 1024 * 1024) throw new Error('Фото или документ «' + file.name + '» больше 8 МБ. Уменьшите размер и выберите файл заново.');
        const ticket = await request('POST', { action:'create_document_upload', orderId:documentForm.dataset.order, kind, fileName, contentType, byteSize:file.size });
        const upload = await fetch(ticket.uploadUrl, { method:'PUT', headers:{ Authorization:`Bearer ${ticket.token}`, 'x-upsert':'false', 'content-type':contentType }, body:file });
        if (!upload.ok) throw new Error('Не удалось загрузить файл. Проверьте соединение и попробуйте снова.');
        await request('POST', { action:'register_document', orderId:documentForm.dataset.order, kind, path:ticket.path, fileName, contentType, byteSize:file.size });
      }
      message('Документы загружены. Менеджер проверит их и сообщит следующий шаг.', 'success');
      const fresh = await request('GET');
      if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
    } catch (error) {
      const output = documentForm.querySelector('.cabinet-form-error') || document.createElement('p');
      output.className = 'cabinet-form-error'; output.textContent = error.message; documentForm.append(output);
      button.disabled = false; button.textContent = isEvidence ? 'Отправить на проверку' : 'Загрузить документы';
    }
    return;
  }
  const form = event.target.closest('[data-request]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true; button.textContent = 'Отправляем…';
  const data = new FormData(form);
  try {
    const result = await request('POST', { action:form.dataset.request, orderId:form.dataset.order, requestId:data.get('requestId'), days:data.get('days'), kind:data.get('kind'), message:data.get('message'), returnMethod:data.get('returnMethod'), returnLockerAddress:data.get('returnLockerAddress'), rating:data.get('rating'), review:data.get('review'), suggestion:data.get('suggestion') });
    message(result.message || 'Запрос отправлен.', 'success');
    const fresh = await request('GET');
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
  } catch (error) {
    const output = form.querySelector('.cabinet-form-error') || document.createElement('p');
    output.className = 'cabinet-form-error'; output.textContent = error.message; form.append(output);
    button.disabled = false; button.textContent = 'Попробовать снова';
  }
});
profileEl?.addEventListener('submit', async event => {
  if (event.target.id !== 'profile-form') return;
  event.preventDefault();
  const form = event.target; const button = form.querySelector('button'); button.disabled = true;
  try {
    await request('POST', { action:'save_profile', fullName:new FormData(form).get('fullName') });
    const fresh = await request('GET');
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos);
  } catch (error) {
    const output = document.createElement('p'); output.className = 'cabinet-form-error'; output.textContent = error.message; form.append(output); button.disabled = false;
  }
});
loyaltyToggle?.addEventListener('click', () => {
  if (!loyaltyPanelEl) return;
  loyaltyPanelEl.hidden = !loyaltyPanelEl.hidden;
  loyaltyToggle.setAttribute('aria-expanded', String(!loyaltyPanelEl.hidden));
  if (!loyaltyPanelEl.hidden) loyaltyPanelEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
});
bindPhoneMask(phoneInput);
loadSession();
