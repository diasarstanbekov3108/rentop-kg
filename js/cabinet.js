const login = document.getElementById('cabinet-login');
const loading = document.getElementById('cabinet-loading');
const dashboard = document.getElementById('cabinet-dashboard');
const phoneForm = document.getElementById('phone-form');
const codeForm = document.getElementById('code-form');
const loginTitle = document.getElementById('cabinet-login-title');
const loginCopy = document.getElementById('cabinet-login-copy');
const phoneInput = document.getElementById('cabinet-phone');
const codeInput = document.getElementById('cabinet-code');
const statusEl = document.getElementById('cabinet-status');
const rentalsEl = document.getElementById('cabinet-rentals');
const emptyEl = document.getElementById('cabinet-empty');
const profileEl = document.getElementById('cabinet-profile');
const dashboardNotice = document.getElementById('cabinet-dashboard-notice');
const loyaltyPanelEl = document.getElementById('cabinet-loyalty-panel');
const loyaltyToggle = document.getElementById('cabinet-loyalty-toggle');
const archiveToggle = document.getElementById('cabinet-archive-toggle');
const cabinetHero = document.getElementById('cabinet-hero');
const documentViewer = document.getElementById('cabinet-document-viewer');
const documentViewerContent = document.getElementById('cabinet-document-viewer-content');
const paymentDialog = document.getElementById('cabinet-payment-dialog');
const paymentDialogQr = document.getElementById('cabinet-payment-dialog-qr');
const paymentDialogAmount = document.getElementById('cabinet-payment-dialog-amount');
const paymentDialogExpiry = document.getElementById('cabinet-payment-dialog-expiry');
const paymentDialogLink = document.getElementById('cabinet-payment-dialog-link');
const cabinetTopik = document.getElementById('cabinet-topik');
const cabinetTopikToggle = document.getElementById('cabinet-topik-toggle');
const cabinetTopikClose = document.getElementById('cabinet-topik-close');
const cabinetTopikPanel = document.getElementById('cabinet-topik-panel');
const cabinetTopikMessage = document.getElementById('cabinet-topik-message');
const cabinetTopikOpenOrder = document.getElementById('cabinet-topik-open-order');
const cabinetTopikSupport = document.getElementById('cabinet-topik-support');
const cabinetTopikHide = document.getElementById('cabinet-topik-hide');
const cabinetTopikRestore = document.getElementById('cabinet-topik-restore');
const cabinetTopikConfetti = document.getElementById('cabinet-topik-confetti');
const cabinetCelebration = document.getElementById('cabinet-celebration');
const cabinetCelebrationClose = document.getElementById('cabinet-celebration-close');
const cabinetCelebrationContinue = document.getElementById('cabinet-celebration-continue');
const cabinetCelebrationEyebrow = document.getElementById('cabinet-celebration-eyebrow');
const cabinetCelebrationTitle = document.getElementById('cabinet-celebration-title');
const cabinetCelebrationText = document.getElementById('cabinet-celebration-text');
const FORM_TARGET_LABELS = Object.freeze({
  identity_front:'лицевую сторону ID', identity_back:'обратную сторону ID', selfie:'селфи с документом', supporting:'подтверждающий документ', benefit_proof:'документ для льготы', issue_video:'видео получения', return_video:'видео возврата',
  alternative_security_video:'видеообращение', alternative_security_address:'подтверждение адреса', alternative_security_work:'справку с работы', alternative_security_study:'справку с учёбы',
  fullName:'ФИО', deliveryAddress:'адрес доставки', deliveryPreferredTime:'время доставки', lockerAddress:'точку ARCHA POINT', residenceAddress:'адрес проживания', supportingType:'тип подтверждающего документа', documentConsent:'согласие на передачу документов', offerConsent:'согласие с офертой', offerSms:'подтверждение оферты по SMS', operationCity:'город использования', emergencyContactName:'ФИО близкого родственника', emergencyContactRelationship:'родство', emergencyContactPhone:'номер близкого родственника', emergencyContactConsent:'согласие на передачу контакта'
});
const ALTERNATIVE_SECURITY_LABELS = Object.freeze({
  alternative_security_video:'видеообращение арендатора',
  alternative_security_address:'подтверждение адреса проживания',
  alternative_security_work:'справка с места работы',
  alternative_security_study:'справка с места учёбы'
});
let pendingPhone = '';
let currentPreviewUrl = '';
let paymentByOrder = new Map();
let paymentPollingTimer = null;
let orderPollingTimer = null;
let activePaymentOrderId = '';
let supportWhatsappUrl = '';
let offerSmsConsentRequired = false;
let customerPromos = [];
let customerBenefits = [];
let cabinetOrders = [];
let customerProfile = null;
let orderRefreshInFlight = false;
const HIDDEN_COMPLETIONS_KEY = 'rentop_hidden_completions_v1';
const HIDDEN_CABINET_TOPIK_KEY = 'rentop_cabinet_topik_hidden_v1';
const CABINET_TOPIK_POSITION_KEY = 'rentop_cabinet_topik_position_v1';
const hiddenCompletionOrders = new Set((() => { try { return JSON.parse(localStorage.getItem(HIDDEN_COMPLETIONS_KEY) || '[]'); } catch { return []; } })());
function persistHiddenCompletions() { localStorage.setItem(HIDDEN_COMPLETIONS_KEY, JSON.stringify([...hiddenCompletionOrders].slice(-100))); }
let showingArchivedOrders = false;
const canArchiveOrder = order => ['completed', 'cancelled', 'rejected'].includes(String(order?.status || ''));
const activeWorkspaceOrderId = () => String(rentalsEl?.querySelector('#cabinet-order-workspace')?.dataset.orderWorkspace || '');
const PENDING_BOOKING_KEY = 'rentop-pending-booking-v1';
// Prevent an older "check session" response from replacing a newer SMS login.
let sessionViewEpoch = 0;
const ARCHA_LOCATIONS = [
  { value:'Bishkek Park — Киевская улица, 148, этаж B2', hours:'ежедневно 10:00–22:00', map:'https://2gis.kg/bishkek/search/%D0%9F%D0%BE%D1%81%D1%82%D0%B0%D0%BC%D0%B0%D1%82%D1%8B/rubricId/95584/firm/70000001092731465/74.589874%2C42.874488' },
  { value:'Гипермаркет «Азия» — ул. Максима Горького, 1/2а', hours:'круглосуточно', map:'https://2gis.kg/bishkek/firm/70000001092731520' },
  { value:'ТЦ DK — ул. Нуркамала Жетикашкаевой, 29', hours:'ежедневно 08:00–21:00', map:'https://2gis.kg/bishkek/geo/70000001092731290' },
  { value:'ТРЦ Tommi Mall — ул. Аалы Токомбаева, 17/2', hours:'круглосуточно', map:'https://2gis.kg/bishkek/geo/70000001092731396' }
];
const BENEFIT_LABELS = { student:'Студент', pensioner:'Пенсионер', disability:'Инвалидность / ОВЗ' };
const BENEFIT_OPTIONS = [
  ['student', 'Студент — студенческий билет или справка с места учёбы'],
  ['pensioner', 'Пенсионер — пенсионное удостоверение'],
  ['disability', 'Инвалидность / ОВЗ — удостоверение или справка']
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
function focusDocumentFormTarget(form, targetName) {
  if (!form || !targetName) return;
  const target = targetName === 'offerSms'
    ? form.querySelector('[data-request-offer-sms]')
    : form.elements[targetName];
  if (!target) return;
  const holder = target.closest('.cabinet-file-control, .cabinet-offer-sms, .cabinet-document-consent, .cabinet-delivery-inline, .cabinet-benefit-inline, label') || target;
  holder.classList.add('is-attention');
  holder.scrollIntoView({ behavior:'smooth', block:'center' });
  window.setTimeout(() => holder.classList.remove('is-attention'), 1800);
  if (target.type !== 'file' && typeof target.focus === 'function') window.setTimeout(() => target.focus({ preventScroll:true }), 280);
}
const request = async (method, payload, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/api/account', { method, credentials: 'include', cache: 'no-store', signal:controller.signal, headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(body.error || 'Не удалось выполнить запрос.'); error.data = body; throw error; }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Загрузка заняла слишком много времени. Проверьте интернет и попробуйте ещё раз.');
    throw error;
  } finally { window.clearTimeout(timer); }
};
const uploadDocumentFile = (uploadUrl, token, contentType, file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', uploadUrl, true);
  xhr.timeout = 90_000;
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.setRequestHeader('x-upsert', 'false');
  xhr.setRequestHeader('content-type', contentType);
  xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded, event.total); };
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Хранилище ответило ${xhr.status || 'без статуса'}`)));
  xhr.onerror = () => reject(new Error('Сеть оборвала загрузку файла.'));
  xhr.ontimeout = () => reject(new Error('Загрузка файла слишком долго не отвечает.'));
  xhr.send(file);
});
async function stabilizeAccountSnapshot(data) {
  // A just-created SMS session can occasionally reach a replica before its
  // order history is visible. Make one short re-read before rendering an
  // empty cabinet, rather than flashing an apparently lost rental.
  if (!data?.authenticated || (Array.isArray(data.orders) && data.orders.length)) return data;
  try {
    await new Promise(resolve => window.setTimeout(resolve, 350));
    const retry = await request('GET', undefined, 8000);
    return retry?.authenticated ? retry : data;
  } catch {
    return data;
  }
}
const statusInfo = (status) => ({
  draft:{ title:'Нужны документы', text:'Отправьте документы и подтвердите условия аренды, чтобы менеджер мог проверить заявку.', step:1 },
  pending_review:{ title:'Проверяем документы', text:'Документы получены. Менеджер проверяет их перед созданием счёта.', step:1 },
  awaiting_payment:{ title:'Ожидает оплаты', text:'Оплатите счёт в этом кабинете. После банковского подтверждения менеджер подготовит выдачу.', step:1 },
  payment_review:{ title:'Проверяем оплату', text:'Менеджер проверяет поступление оплаты.', step:2 },
  confirmed:{ title:'Оплата подтверждена', text:'Менеджер готовит выбранный способ выдачи. Срок аренды начнётся только после фактического получения ноутбука.', step:2 },
  awaiting_archa_reservation:{ title:'Резервируем ячейку', text:'ARCHA POINT готовит ячейку. Пока не приезжайте к постамату.', step:2 },
  awaiting_locker_loading:{ title:'Готовим закладку', text:'Ячейка зарезервирована. Менеджер помещает ноутбук, зарядку и комплект в постамат.', step:3 },
  awaiting_pickup:{ title:'Готово к получению', text:'Ноутбук подготовлен к передаче. Выполните действия ниже только после фактического получения.', step:3 },
  issued:{ title:'Ожидаем подтверждение получения', text:'Подтвердите получение только после того, как заберёте ноутбук из ячейки.', step:4 },
  in_use:{ title:'Аренда активна', text:'Здесь можно продлить аренду или начать возврат.', step:4 },
  return_requested:{ title:'Возврат оформляется', text:'Менеджер подтвердит выбранный способ возврата и пришлёт дальнейшие инструкции.', step:5 },
  awaiting_return_collection:{ title:'Согласовываем возврат', text:'Видео фиксирует состояние, но аренда завершится только после фактического получения ноутбука Rentop.', step:5 },
  awaiting_return_reservation:{ title:'Резервируем ячейку возврата', text:'ARCHA POINT готовит ячейку для возврата. Дождитесь SMS с кодом.', step:5 },
  awaiting_return_dropoff:{ title:'Можно вернуть ноутбук', text:'Проверьте инструкцию, снимите видео состояния и положите устройство в назначенную ячейку.', step:5 },
  returned:{ title:'Возврат на проверке', text:'Мы проверяем технику и сообщим о завершении.', step:5 },
  completed:{ title:'Аренда завершена', text:'Спасибо, что выбрали Rentop.', step:5 },
  cancelled:{ title:'Заявка отменена', text:'Эти даты снова доступны для бронирования.', step:0 },
  rejected:{ title:'Заявка не подтверждена', text:'Свяжитесь с поддержкой, если остались вопросы.', step:0 }
}[status] || { title:'Заявка обрабатывается', text:'Мы сообщим, когда потребуется действие.', step:1 });
function parseDate(value, assumeCalendarDate = false) {
  if (!value) return null;
  const source = assumeCalendarDate && !String(value).includes('T') ? `${value}T00:00:00` : value;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const date = (value) => {
  const parsed = parseDate(value, true);
  if (!parsed) return '—';
  try { return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(parsed); } catch { return '—'; }
};
const moment = (value) => {
  const parsed = parseDate(value);
  if (!parsed) return '—';
  try { return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Bishkek',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(parsed); } catch { return '—'; }
};
const dateTime = (value, options = {}) => {
  const parsed = parseDate(value);
  if (!parsed) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', options).format(parsed); } catch { return '—'; }
};
function bishkekIsoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bishkek', year:'numeric', month:'2-digit', day:'2-digit' })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]:part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addIsoDays(isoDate, days) {
  const result = new Date(`${isoDate}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
function rentalDeadline(order) {
  if (order.status !== 'in_use') return null;
  if (order.rental_ends_at) {
    const deadline = new Date(order.rental_ends_at);
    const hoursLeft = (deadline.getTime() - Date.now()) / 3_600_000;
    if (hoursLeft <= 0) return { due:true, title:'Срок аренды закончился', text:`Срок возврата был ${moment(order.rental_ends_at)}. Оформите возврат или запросите продление.` };
    if (hoursLeft <= 30) return { due:false, title:'Аренда скоро заканчивается', text:`Срок возврата: ${moment(order.rental_ends_at)}. Подготовьте ноутбук, зарядку и комплект заранее.` };
    return null;
  }
  if (!order.rental_end_date) return null;
  const today = bishkekIsoDate();
  if (order.rental_end_date <= today) return { due:true, title:'Срок возврата наступил', text:'Оформите возврат сегодня или запросите продление. Не оставляйте технику в постамате без SMS-кода ARCHA POINT.' };
  if (order.rental_end_date === addIsoDays(today, 1)) return { due:false, title:'Аренда заканчивается завтра', text:'Подготовьте ноутбук, зарядку и комплект. Выберите продление или оформление возврата заранее.' };
  return null;
}
const escape = (value) => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function pendingBooking() {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(PENDING_BOOKING_KEY) || 'null');
      if (saved?.laptopId) return saved;
    } catch { /* The return flow still works without a locally stored draft. */ }
  }
  return null;
}
function shouldResumeBooking() {
  return new URLSearchParams(window.location.search).get('return') === 'booking' && Boolean(pendingBooking()?.laptopId);
}
function syncBookingReturnLoginCopy() {
  const saved = shouldResumeBooking() ? pendingBooking() : null;
  if (!saved) {
    if (loginTitle) loginTitle.textContent = 'Войти по номеру';
    if (loginCopy) loginCopy.textContent = 'Мы отправим одноразовый код. Пароль не нужен.';
    return;
  }
  const count = Array.isArray(saved.laptopIds) ? saved.laptopIds.length : 1;
  const title = String(saved.laptopTitle || 'выбранный ноутбук').trim();
  if (loginTitle) loginTitle.textContent = 'Подтвердите номер';
  if (loginCopy) loginCopy.textContent = count > 1
    ? `Вы выбрали ${count} ноутбука. После SMS-кода продолжим оформление этого же заказа.`
    : `Вы выбрали «${title}». После SMS-кода продолжим оформление этой же заявки.`;
}
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
  syncBodyScrollLock();
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
  syncBodyScrollLock();
}

function openPaymentDialog(payment) {
  if (!paymentDialog || !paymentDialogQr || !payment) return;
  const rawImage = String(payment.qr_image || payment.qr_image_with_frame || '');
  const image = rawImage && !rawImage.startsWith('data:') && !rawImage.startsWith('http') ? `data:image/png;base64,${rawImage}` : rawImage;
  if (!image) return;
  const expires = dateTime(payment.expires_at, { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
  paymentDialogQr.src = image;
  paymentDialogAmount.textContent = `${Number(payment.amount || 0).toLocaleString('ru-RU')} сом`;
  paymentDialogExpiry.textContent = `Счёт действует до ${expires}`;
  if (paymentDialogLink) {
    paymentDialogLink.hidden = !payment.qr_link;
    if (payment.qr_link) paymentDialogLink.href = payment.qr_link;
  }
  paymentDialog.hidden = false;
  syncBodyScrollLock();
}

function closePaymentDialog() {
  if (!paymentDialog) return;
  paymentDialog.hidden = true;
  if (paymentDialogQr) paymentDialogQr.removeAttribute('src');
  if (paymentDialogLink) { paymentDialogLink.hidden = true; paymentDialogLink.removeAttribute('href'); }
  syncBodyScrollLock();
  activePaymentOrderId = '';
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  paymentPollingTimer = null;
}

function syncBodyScrollLock() {
  const hasOverlay = Boolean(document.querySelector('.cabinet-document-viewer:not([hidden]), .cabinet-payment-dialog:not([hidden]), .cabinet-celebration:not([hidden])'));
  document.documentElement.classList.toggle('cabinet-scroll-locked', hasOverlay);
  document.body.style.overflow = hasOverlay ? 'hidden' : '';
}

function hasOpenCabinetForm() {
  return Boolean(rentalsEl?.querySelector('.cabinet-request-panel:not([hidden]) form'));
}

function hasOpenOrderWorkspace() {
  return Boolean(rentalsEl?.querySelector('#cabinet-order-workspace:not([hidden])'));
}

function setWorkspaceMode(panel = null) {
  const open = Boolean(panel && !panel.hidden);
  document.documentElement.classList.toggle('cabinet-workspace-open', open);
  document.body.classList.toggle('cabinet-workspace-open', open);
  if (panel) panel.classList.toggle('cabinet-workspace', open);
}

function hasUnsavedDocumentDraft() {
  const form = rentalsEl?.querySelector('.cabinet-request-panel:not([hidden]) [data-document-upload]');
  if (!form) return false;
  if ([...form.querySelectorAll('input[type="file"]')].some(input => input.files?.length)) return true;
  return [...form.querySelectorAll('input:not([type="file"]), textarea, select')]
    .some(input => input.type === 'checkbox' ? input.checked : String(input.value || '').trim().length > 0);
}

function watchPayment(orderId) {
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  activePaymentOrderId = String(orderId);
  const epoch = sessionViewEpoch;
  const checkPayment = async () => {
    try {
      if (hasOpenCabinetForm()) return;
      const fresh = await request('GET');
      if (epoch === sessionViewEpoch && fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
    } catch { /* The customer can continue scanning; the next poll will retry. */ }
  };
  checkPayment();
  paymentPollingTimer = window.setInterval(checkPayment, 3000);
}
async function refreshAccountIfSafe() {
  // A form with selected files must never be redrawn. An opened read-only
  // application is safe: showRentals restores it and the exact scroll position.
  if (hasOpenCabinetForm() || orderRefreshInFlight) return;
  orderRefreshInFlight = true;
  const epoch = sessionViewEpoch;
  try {
    const fresh = await request('GET');
    if (epoch !== sessionViewEpoch) return;
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
    else showLogin();
  } catch {
    // A later cycle or the visible "Обновить заявки" button can retry.
  } finally {
    orderRefreshInFlight = false;
  }
}
function watchOrderUpdates(orders) {
  if (orderPollingTimer) window.clearInterval(orderPollingTimer);
  // Support replies and an extension QR can arrive while an аренда is active,
  // not only during handover. Keep every non-final rental in live sync.
  const needsLiveUpdates = orders.some(order => !['completed', 'cancelled', 'rejected'].includes(order.status));
  if (!needsLiveUpdates) return;
  const epoch = sessionViewEpoch;
  orderPollingTimer = window.setInterval(async () => {
    if (epoch === sessionViewEpoch) await refreshAccountIfSafe();
  }, 90000);
}

function requestLabel(request) {
  if (request.kind === 'extension') return `Продление: +${request.requested_days} дн. до ${date(request.proposed_return_date)}`;
  if (request.kind === 'replacement') return `Замена для продления: +${request.requested_days} дн. до ${date(request.proposed_return_date)}`;
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
    ? ['identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'benefit_proof', 'issue_video', 'return_video'].filter(kind => latest.has(kind))
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
      : document?.id
        ? `<span class="cabinet-doc-saved"><button type="button" class="cabinet-doc-chip" data-document-open="${escape(document.id)}" data-document-order="${escape(order.id)}" data-document-name="${escape(document.file_name || label)}" data-document-type="${escape(document.content_type || '')}">${text}</button>${remove}</span>`
      : `<span>${text}</span>`;
  };
  const rejectedKinds = [...latest.values()].filter(document => document.status === 'rejected').map(document => document.kind).filter(kind => ['identity_front', 'identity_back', 'selfie', 'supporting'].includes(kind));
  const reasons = [...latest.values()].filter(document => document.status === 'rejected' && document.reviewer_note).map(document => `<li><strong>${escape(({ identity:'Документ', identity_front:'Лицевая сторона', identity_back:'Обратная сторона', selfie:'Селфи', supporting:'Подтверждение', issue_video:'Видео до получения', return_video:'Видео возврата' }[document.kind] || 'Документ'))}:</strong> ${escape(document.reviewer_note)}</li>`).join('');
  const labels = { identity:'Документ', identity_front:'Лицевая сторона', identity_back:'Обратная сторона', selfie:'Селфи', supporting:'Подтверждение', benefit_proof:'Льготный документ', issue_video:'Видео до получения', return_video:'Видео возврата' };
  const summary = visibleKinds.length ? visibleKinds.map(kind => state(kind, labels[kind])).join('') : '<span>○ Документы ещё не загружены</span>';
  const replaceButton = rejectedKinds.length ? `<button class="cabinet-action danger cabinet-document-replace" type="button" data-panel="documents" data-document-mode="replacement" data-document-kinds="${escape(rejectedKinds.join(','))}" data-order="${escape(order.id)}">Заменить документ</button>` : '';
  const benefitDocument = latest.get('benefit_proof');
  const benefitNotice = !benefitDocument ? '' : benefitDocument.status === 'accepted'
    ? `<div class="cabinet-benefit-status is-approved"><strong>✓ Льгота подтверждена</strong><span>${Number(order.discount_percent || 0) > 10 ? `Применена более выгодная тарифная скидка ${Number(order.discount_percent || 0)}%.` : `В сумме заявки учтена социальная скидка ${Number(order.discount_percent || 0)}%.`}</span></div>`
    : benefitDocument.status === 'rejected'
      ? `<div class="cabinet-benefit-status is-rejected"><strong>Льготный документ не принят</strong><span>${escape(benefitDocument.reviewer_note || 'Уточните документ у менеджера.')}</span></div>`
      : '<div class="cabinet-benefit-status"><strong>Льготный документ на проверке</strong><span>Сумма обновится автоматически после одобрения, но до создания счёта.</span></div>';
  return `<div class="cabinet-doc-summary">${summary}</div>${benefitNotice}${reasons ? `<div class="cabinet-document-reasons"><strong>Нужно исправить</strong><ul>${reasons}</ul>${replaceButton}</div>` : ''}`;
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
  const cases = (order.supportCases || []).filter(item => item.customer_message || item.manager_reply);
  if (!cases.length) return '';
  return `<section class="cabinet-support-updates" aria-label="Переписка по заявке"><div class="cabinet-conversation-head"><strong>Переписка по заявке</strong><span>Rentop</span></div>${cases.map(item => `${item.customer_message ? `<div class="cabinet-message customer"><b>Вы</b><p>${escape(item.customer_message)}</p><time>${escape(dateTime(item.opened_at, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }))}</time></div>` : ''}${item.manager_reply ? `<div class="cabinet-message manager"><b>Rentop</b><p>${escape(item.manager_reply)}</p><time>${escape(dateTime(item.replied_at, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }))}</time></div>` : item.customer_message ? '<div class="cabinet-message pending"><span>Ожидаем ответ менеджера</span></div>' : ''}`).join('')}</section>`;
}
function paymentPayloadObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function paymentBreakdown(payment) {
  // PostgREST can return json/jsonb as either an object or a JSON string,
  // depending on the query path. Read both forms so a receipt never loses
  // its invoice lines after a bank confirmation.
  const payload = paymentPayloadObject(payment?.bank_payload);
  const breakdown = paymentPayloadObject(payload.breakdown);
  const rentalAndDeposit = Number(breakdown.rental_and_deposit_amount || 0);
  const deliveryFee = Number(breakdown.delivery_fee || 0);
  const rentalAmount = Number(breakdown.rental_amount);
  const depositAmount = Number(breakdown.deposit_amount);
  const hasSeparateRentalAndDeposit = Number.isFinite(rentalAmount) || Number.isFinite(depositAmount);
  const hasStoredBreakdown = hasSeparateRentalAndDeposit || rentalAndDeposit > 0 || deliveryFee > 0;
  return {
    rentalAndDeposit: Number.isFinite(rentalAndDeposit) ? rentalAndDeposit : 0,
    rentalAmount: Number.isFinite(rentalAmount) ? rentalAmount : 0,
    depositAmount: Number.isFinite(depositAmount) ? depositAmount : 0,
    hasSeparateRentalAndDeposit,
    hasStoredBreakdown,
    deliveryFee: Number.isFinite(deliveryFee) ? deliveryFee : 0,
    deliveryMode: breakdown.delivery_charge_mode || 'external'
  };
}
function paymentReceiptRows(payment, isExtension = false, order = null) {
  const breakdown = paymentBreakdown(payment);
  const items = Array.isArray(order?.group_items) ? order.group_items : [];
  const itemRows = !isExtension && items.length > 1
    ? items.map(item => `<span>${escape(item.title || 'Ноутбук')}: ${Number(item.total_amount || 0).toLocaleString('ru-RU')} сом</span>`).join('')
    : '';
  if (isExtension) return `<span>Доплата за продление: ${Number(payment?.amount || 0).toLocaleString('ru-RU')} сом</span>`;
  if (breakdown.hasSeparateRentalAndDeposit) return `${itemRows}<span>Аренда по счёту: ${breakdown.rentalAmount.toLocaleString('ru-RU')} сом</span><span>Возвратный залог: ${breakdown.depositAmount.toLocaleString('ru-RU')} сом</span>`;
  if (breakdown.hasStoredBreakdown) return `${itemRows}<span>Аренда и залог по счёту: ${breakdown.rentalAndDeposit.toLocaleString('ru-RU')} сом</span>`;
  return `${itemRows}<span>Платёж по счёту: ${Number(payment?.amount || 0).toLocaleString('ru-RU')} сом</span>`;
}
function paymentReceiptTotalRows(payment, isExtension = false) {
  const amount = Number(payment?.amount || 0).toLocaleString('ru-RU');
  const label = isExtension ? 'Итого доплата за продление' : 'Итого по счёту';
  return `<span>${label}: ${amount} сом</span><span>Оплачено: ${amount} сом</span>`;
}
function promoForOrder(order) {
  return customerPromos.find(promo => String(promo.redeemed_order_id || '') === String(order?.id || '')) || null;
}
function rentalPriceSummary(order) {
  const days = Number(order?.rental_days || 0);
  const dailyRate = Number(order?.daily_rate || 0);
  const listedAmount = days > 0 && dailyRate > 0 ? Math.round(days * dailyRate) : 0;
  const finalAmount = Number(order?.total_amount || 0);
  return { listedAmount, finalAmount, savedAmount: listedAmount > finalAmount ? listedAmount - finalAmount : 0 };
}
function rentalDiscountDetails(order) {
  const promo = promoForOrder(order);
  const pricing = rentalPriceSummary(order);
  const promoLine = promo ? `<small>Промокод: ${escape(promo.code)} · −${Number(promo.discount_percent || 0)}%</small>` : '';
  return {
    promo,
    pricing,
    card: `<div><span>Скидка</span><strong>−${Number(order?.discount_percent || 0)}%</strong>${promoLine}</div>`,
    receiptRows: `${pricing.listedAmount ? `<div class="row"><span>Аренда до скидки</span><b>${pricing.listedAmount.toLocaleString('ru-RU')} сом</b></div>` : ''}${promo ? `<div class="row"><span>Промокод</span><b>${escape(promo.code)} · −${Number(promo.discount_percent || 0)}%</b></div>` : ''}<div class="row"><span>Общая скидка</span><b>−${Number(order?.discount_percent || 0)}%${pricing.savedAmount ? ` · экономия ${pricing.savedAmount.toLocaleString('ru-RU')} сом` : ''}</b></div><div class="row"><span>Итого за аренду</span><b>${pricing.finalAmount.toLocaleString('ru-RU')} сом</b></div>`
  };
}
function deliveryReceiptDetails(order, breakdown) {
  if (order.delivery_type === 'arca_locker') {
    return {
      method: order.locker_address ? `ARCHA POINT 24/7 · ${order.locker_address}` : 'ARCHA POINT 24/7',
      charge: ''
    };
  }
  if (order.delivery_type === 'delivery') {
    return {
      method: 'Доставка курьером',
      charge: !breakdown.hasStoredBreakdown
        ? ''
        : breakdown.deliveryMode === 'rentop'
        ? `Доставка Rentop: ${breakdown.deliveryFee.toLocaleString('ru-RU')} сом`
        : 'Доставка оплачивается курьеру отдельно'
    };
  }
  return { method: 'Способ получения уточняется', charge: '' };
}
function paymentPanel(order) {
  const isExtension = Boolean(order.extensionPayment);
  const payment = order.extensionPayment || order.payment;
  const documentsApproved = documentMode(order).mode === 'approved';
  const documentNotice = !isExtension && documentsApproved ? `<div class="cabinet-payment-docs-success"><strong>✓ Документы проверены</strong><span>Можно переходить к оплате, как только появится защищённый QR-счёт.</span></div>` : '';
  if (payment?.status === 'paid') {
    const amount = Number(payment.amount || order.total_amount || 0).toLocaleString('ru-RU');
    const reference = payment.payment_reference || payment.provider_reference || payment.id || order.reference || String(order.id || '').slice(0, 8).toUpperCase();
    const paidAt = payment.paid_at || payment.updated_at || payment.created_at;
    const breakdown = paymentBreakdown(payment);
    const delivery = deliveryReceiptDetails(order, breakdown);
    const deliveryLines = `<span>Получение: ${escape(delivery.method)}</span>${delivery.charge ? `<span>${escape(delivery.charge)}</span>` : ''}`;
    const discount = rentalDiscountDetails(order);
  const groupTitle = Array.isArray(order.group_items) && order.group_items.length > 1 ? `Заказ из ${order.group_items.length} ноутбуков` : `Ноутбук: ${escape(order.laptop_title || '—')}`;
  return `<section class="cabinet-payment success cabinet-receipt"><div><strong>✓ ${isExtension ? 'Продление оплачено' : 'Оплата подтверждена'}</strong><span>${amount} сом · банк подтвердил платёж</span></div><p>${isExtension ? `Новый срок аренды: до ${date(order.rental_end_date)}.` : 'Мы готовим выбранный способ выдачи и сообщим о готовности.'}</p><div class="cabinet-receipt-details"><b>Квитанция Rentop</b><span>Заказчик: ${escape(order.customer_name || 'Клиент Rentop')}</span><span>Заявка: ${escape(order.reference || String(order.id || '').slice(0, 8).toUpperCase())}</span><span>${groupTitle}</span><span>Период: ${escape(date(order.rental_start_date))} — ${escape(date(order.rental_end_date))}</span>${deliveryLines}${paymentReceiptRows(payment, isExtension, order)}${paymentReceiptTotalRows(payment, isExtension)}${discount.promo ? `<span>Промокод: ${escape(discount.promo.code)} · −${Number(discount.promo.discount_percent || 0)}%</span>` : ''}<span>Общая скидка по тарифу: −${Number(order.discount_percent || 0)}%</span><span>Платёж: ${escape(reference)}</span><span>Подтверждён: ${escape(dateTime(paidAt, { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }))}</span></div><button class="cabinet-action secondary" type="button" data-print-receipt="${escape(order.id)}">Скачать квитанцию PDF</button><small class="cabinet-receipt-note">Данные заказчика указаны по этой заявке.</small></section>`;
  }
  if (!isExtension && order.status !== 'awaiting_payment') return '';
  if (!payment) return `<div class="cabinet-payment waiting"><strong>Готовим способ оплаты</strong><p>Менеджер формирует защищённый QR-счёт. Обновите страницу через несколько минут — платить по реквизитам в переписке не нужно.</p>${documentNotice}</div>`;
  if (['revoked', 'expired', 'failed'].includes(payment.status)) return `<div class="cabinet-payment waiting"><strong>Счёт обновляется</strong><p>Предыдущий QR больше не используйте. Менеджер подготовит новый защищённый счёт, если оплата ещё нужна.</p>${documentNotice}</div>`;
  const rawImage = String(payment.qr_image || payment.qr_image_with_frame || '');
  const image = rawImage && !rawImage.startsWith('data:') && !rawImage.startsWith('http') ? `data:image/png;base64,${rawImage}` : rawImage;
  const expires = dateTime(payment.expires_at, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  return `<section class="cabinet-payment"><div><strong>${isExtension ? 'Оплата продления' : 'Оплата аренды и залога'}</strong><span>${Number(payment.amount || 0).toLocaleString('ru-RU')} сом · до ${escape(expires)}</span></div><p>${image ? 'Нажмите «Оплатить по QR»: код откроется крупно на весь экран. Платёжная ссылка Банка доступна как дополнительный способ, но её поддержка зависит от приложения банка.' : 'Банк создал ссылку на QR. Откройте её в поддерживаемом банковском приложении или попросите менеджера перевыпустить счёт.'} Не переводите сумму вручную на другие реквизиты.</p>${documentNotice}${image ? `<button class="cabinet-action cabinet-payment-open" type="button" data-open-payment="${escape(order.id)}">Оплатить по QR</button>` : ''}${payment.qr_link ? `<a class="cabinet-action cabinet-payment-link secondary" href="${escape(payment.qr_link)}" target="_blank" rel="noopener">Открыть платёжную ссылку Банка</a>` : ''}</section>`;
}
function openReceiptPrintWindow(order) {
  if (!order) return;
  const isExtension = Boolean(order.extensionPayment);
  const payment = order.extensionPayment || order.payment;
  if (!payment || payment.status !== 'paid') return;
  const amount = Number(payment.amount || order.total_amount || 0).toLocaleString('ru-RU');
  const reference = payment.payment_reference || payment.provider_reference || payment.id || order.reference || String(order.id || '').slice(0, 8).toUpperCase();
  const breakdown = paymentBreakdown(payment);
  const delivery = deliveryReceiptDetails(order, breakdown);
  const groupItemRows = !isExtension && Array.isArray(order.group_items) && order.group_items.length > 1
    ? order.group_items.map(item => `<div class="row"><span>${escape(item.title || 'Ноутбук')}</span><b>${Number(item.total_amount || 0).toLocaleString('ru-RU')} сом</b></div>`).join('')
    : '';
  const paymentRows = isExtension
    ? `<div class="row"><span>Доплата за продление</span><b>${Number(payment.amount || 0).toLocaleString('ru-RU')} сом</b></div>`
    : breakdown.hasSeparateRentalAndDeposit
      ? `<div class="row"><span>Аренда по счёту</span><b>${breakdown.rentalAmount.toLocaleString('ru-RU')} сом</b></div><div class="row"><span>Возвратный залог</span><b>${breakdown.depositAmount.toLocaleString('ru-RU')} сом</b></div>`
      : breakdown.hasStoredBreakdown
        ? `<div class="row"><span>Аренда и залог по счёту</span><b>${breakdown.rentalAndDeposit.toLocaleString('ru-RU')} сом</b></div>`
        : `<div class="row"><span>Платёж по счёту</span><b>${Number(payment.amount || 0).toLocaleString('ru-RU')} сом</b></div>`;
  const deliveryReceiptRows = `${groupItemRows}${paymentRows}<div class="row"><span>Получение</span><b>${escape(delivery.method)}</b></div>${delivery.charge ? `<div class="row"><span>Доставка</span><b>${escape(delivery.charge)}</b></div>` : ''}<div class="row"><span>${isExtension ? 'Итого доплата за продление' : 'Итого по счёту'}</span><b>${amount} сом</b></div><div class="row"><span>Оплачено</span><b>${amount} сом</b></div>`;
  const stampUrl = `${window.location.origin}/assets/rentop-ip-stamp.png`;
  const popup = window.open('', '_blank', 'width=760,height=860');
  if (!popup) { message('Браузер заблокировал окно квитанции. Разрешите всплывающие окна для Rentop и повторите.', 'error'); return; }
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Квитанция Rentop</title><style>body{margin:0;background:#eef4f7;color:#102235;font:16px Arial,sans-serif}.receipt{box-sizing:border-box;width:min(100%,720px);min-height:760px;margin:32px auto;padding:48px;background:#fff;border:1px solid #c8d9e3;border-radius:18px}.brand{font-size:26px;font-weight:900;letter-spacing:.04em}.brand span{color:#16bdea}.subtitle{margin:5px 0 24px;color:#5d7388;font-size:13px}.rule{height:3px;background:#0695d0}.eyebrow{margin:28px 0 8px;color:#39718b;font-size:12px;font-weight:800;letter-spacing:.15em;text-transform:uppercase}h1{margin:0 0 22px;font-size:32px}.status{padding:12px 14px;border-radius:10px;background:#e4f8ef;color:#126740;font-weight:700}.supplier{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:20px 0;padding:16px;border:1px solid #d7e2e8;border-radius:12px;background:#fafcfd}.supplier b,.supplier span{display:block}.supplier b{color:#078dca;font-size:11px;letter-spacing:.07em;text-transform:uppercase}.supplier span{margin-top:7px;color:#3f566a;font-size:13px;line-height:1.45}.rows{margin:26px 0;border-top:1px solid #dce6eb}.row{display:flex;justify-content:space-between;gap:18px;padding:14px 0;border-bottom:1px solid #dce6eb}.row span{color:#587080}.total{margin-top:26px;padding:20px;border-radius:14px;background:#06243a;color:#fff}.total b{display:block;color:#8de9ff;font-size:31px;margin-top:6px}.seal{margin-top:28px;min-height:130px}.seal img{width:145px;height:145px;object-fit:contain;mix-blend-mode:multiply}.foot{margin-top:26px;padding-top:16px;border-top:1px solid #dce6eb;color:#60798a;font-size:12px;line-height:1.55}@media(max-width:580px){.receipt{margin:0;padding:28px 22px;border:0;border-radius:0}.supplier{grid-template-columns:1fr}.row{display:block}.row b{display:block;margin-top:4px}.seal img{width:118px;height:118px}}@media print{body{background:#fff}.receipt{margin:0;border:0;border-radius:0}}</style></head><body><main class="receipt"><div class="brand">RENTOP.<span>KG</span></div><p class="subtitle">Сервис аренды и шеринга техники · DS Ecosystem</p><div class="rule"></div><p class="eyebrow">Подтверждение оплаты</p><h1>${isExtension ? 'Квитанция по продлению' : 'Квитанция по аренде и залогу'}</h1><div class="status">✓ Платёж подтверждён банком</div><section class="supplier"><div><b>Исполнитель</b><span>ИП Арстанбеков Диас Эмильевич<br>ИНН 23108200550307<br>RENTOP.KG</span></div><div><b>Заказчик</b><span>${escape(order.customer_name || 'Клиент Rentop')}<br>Заявка ${escape(order.reference || String(order.id || '').slice(0, 8).toUpperCase())}</span></div></section><div class="rows"><div class="row"><span>Услуга</span><b>Аренда ноутбука: ${escape(order.laptop_title || '—')}</b></div><div class="row"><span>Период аренды</span><b>${escape(date(order.rental_start_date))} — ${escape(date(order.rental_end_date))}</b></div>${deliveryReceiptRows}<div class="row"><span>Идентификатор платежа</span><b>${escape(reference)}</b></div><div class="row"><span>Подтверждён</span><b>${escape(dateTime(payment.paid_at || payment.updated_at || payment.created_at, { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }))}</b></div></div><section class="total"><span>Оплачено</span><b>${amount} сом</b></section><div class="seal"><img src="${stampUrl}" alt="Печать ИП Rentop"></div><p class="foot">Квитанция сформирована в Rentop KG. Она подтверждает успешное принятие платежа и не заменяет фискальный кассовый чек, если его выдача требуется законом.</p></main><script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
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
function topikGuideContent(order) {
  return {
    pending_review: ['Топик: ждём документы', 'Загрузите четыре документа в заявке. После проверки менеджер подготовит защищённый QR-счёт.'],
    awaiting_payment: ['Топик: следующий шаг — оплата', 'Откройте QR-счёт только в личном кабинете Rentop. После подтверждения банка статус обновится здесь.'],
    payment_review: ['Топик: проверяем оплату', 'Банк передал информацию о платеже. Не оплачивайте счёт повторно — следующий статус появится здесь.'],
    confirmed: ['Топик: выдача готовится', order.delivery_type === 'delivery' ? 'Менеджер согласует точный интервал и стоимость доставки. Указанное вами время — ориентир.' : 'Rentop передаёт заявку в ARCHA POINT. Дождитесь статуса о готовности ячейки.'],
    awaiting_archa_reservation: ['Топик: резервируем ячейку', 'ARCHA POINT готовит ячейку. Пока не приезжайте к постамату — дождитесь следующего статуса.'],
    awaiting_locker_loading: ['Топик: закладываем ноутбук', 'Менеджер помещает ноутбук и комплект в постамат. После готовности придёт код доступа.'],
    awaiting_pickup: ['Топик: получите ноутбук и снимите видео', order.delivery_type === 'delivery' ? 'Подтверждайте получение только после передачи ноутбука. Сначала снимите короткое видео комплекта.' : 'Следуйте инструкции с кодом ARCHA POINT, снимите видео и только потом подтвердите получение.'],
    issued: ['Топик: подтвердите получение', 'Проверьте ноутбук и комплект, прикрепите короткое видео и подтвердите получение только после фактической передачи.'],
    in_use: ['Топик: аренда активна', 'Здесь можно продлить срок или оформить возврат. Перед возвратом заранее выберите удобный способ передачи.'],
    awaiting_return_reservation: ['Топик: готовим возврат', 'Следуйте выбранному способу возврата. Не передавайте ноутбук курьеру и не идите к постамату до инструкции Rentop.'],
    awaiting_return_dropoff: ['Топик: почти готово', 'Снимите видео состояния ноутбука и комплекта, затем завершите передачу выбранным способом.'],
    awaiting_return_collection: ['Топик: согласовываем приём', 'Дождитесь точного адреса и времени от Rentop перед отправкой иной курьерской службой.'],
    returned: ['Топик: возврат принят в обработку', 'Менеджер проверит ноутбук и видео. После итогового осмотра аренда будет завершена.'],
    completed: ['Топик: аренда завершена', 'Спасибо! Квитанция и история заявки остаются доступны в этом кабинете.']
  }[order.status] || ['Топик: статус заявки', 'Откройте следующий доступный шаг в заявке или напишите менеджеру, если нужна помощь.'];
}
function activeTopikOrder() {
  const activeId = activeWorkspaceOrderId();
  return cabinetOrders.find(order => String(order.id) === activeId)
    || cabinetOrders.find(order => !['completed', 'cancelled', 'rejected'].includes(String(order.status || '')))
    || cabinetOrders[0]
    || null;
}
function setCabinetTopikOpen(open) {
  if (!cabinetTopikPanel || !cabinetTopikToggle) return;
  cabinetTopikPanel.hidden = !open;
  cabinetTopikToggle.setAttribute('aria-expanded', String(open));
}
let cabinetTopikMoodTimer;
function setCabinetTopikMood(mood, duration = 1200) {
  if (!cabinetTopik) return;
  cabinetTopik.classList.remove('is-thinking', 'is-happy');
  if (mood) cabinetTopik.classList.add(`is-${mood}`);
  window.clearTimeout(cabinetTopikMoodTimer);
  if (mood && duration) cabinetTopikMoodTimer = window.setTimeout(() => cabinetTopik?.classList.remove(`is-${mood}`), duration);
}
function setCabinetTopikHidden(hidden) {
  cabinetTopik?.toggleAttribute('hidden', hidden);
  if (cabinetTopikRestore) cabinetTopikRestore.hidden = !hidden;
  try { localStorage.setItem(HIDDEN_CABINET_TOPIK_KEY, hidden ? '1' : '0'); } catch { /* Private browsing can block storage. */ }
}
function updateCabinetTopik() {
  const order = activeTopikOrder();
  if (!cabinetTopikMessage || !cabinetTopik) return;
  if (!order) {
    cabinetTopikMessage.textContent = 'Откройте заявку — я коротко покажу текущий этап и следующее действие.';
    cabinetTopik.classList.remove('is-farewell');
    if (cabinetTopikOpenOrder) cabinetTopikOpenOrder.hidden = true;
    return;
  }
  const guide = topikGuideContent(order);
  cabinetTopikMessage.textContent = `${guide[0]}. ${guide[1]}`;
  cabinetTopik.classList.toggle('is-farewell', order.status === 'completed');
  if (!cabinetTopikPanel?.hidden) setCabinetTopikMood(order.status === 'completed' ? 'happy' : 'thinking');
  if (cabinetTopikOpenOrder) {
    cabinetTopikOpenOrder.hidden = false;
    cabinetTopikOpenOrder.textContent = activeWorkspaceOrderId() ? 'Показать следующий шаг' : 'Открыть текущую заявку';
    cabinetTopikOpenOrder.dataset.orderId = String(order.id);
  }
  if (cabinetTopikSupport) cabinetTopikSupport.dataset.orderId = String(order.id);
}
function celebrateTopikMoment(order, moment, token = '') {
  if (!order || !cabinetTopikConfetti) return;
  // Keep the effect once per browser session rather than forever. A customer
  // returning to the cabinet after a slow bank update should still see it.
  const key = `rentop_topik_${moment}_shown_v2_${order.id}_${token || order.updated_at || 'event'}`;
  try {
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch { /* The celebration can still play when storage is unavailable. */ }
  cabinetTopikConfetti.replaceChildren(...Array.from({ length: 46 }, () => document.createElement('i')));
  cabinetTopikConfetti.hidden = false;
  cabinetTopikConfetti.classList.remove('is-running');
  window.requestAnimationFrame(() => cabinetTopikConfetti.classList.add('is-running'));
  window.setTimeout(() => { cabinetTopikConfetti.hidden = true; cabinetTopikConfetti.classList.remove('is-running'); }, 5200);
  showCabinetCelebration(moment);
}
function closeCabinetCelebration() {
  if (!cabinetCelebration) return;
  cabinetCelebration.hidden = true;
  syncBodyScrollLock();
}
function showCabinetCelebration(moment) {
  if (!cabinetCelebration || !cabinetCelebrationTitle || !cabinetCelebrationText) return;
  const completed = moment === 'completion';
  if (cabinetCelebrationEyebrow) cabinetCelebrationEyebrow.textContent = completed ? 'АРЕНДА ЗАВЕРШЕНА' : 'ОПЛАТА ПОДТВЕРЖДЕНА';
  cabinetCelebrationTitle.textContent = completed ? 'Спасибо, всё завершено!' : 'Оплата прошла успешно!';
  cabinetCelebrationText.textContent = completed
    ? 'Спасибо, что выбрали Rentop. Будем рады помочь вам снова.'
    : 'Платёж принят. Мы уже готовим ноутбук к выдаче и сообщим, когда всё будет готово.';
  cabinetCelebration.hidden = false;
  syncBodyScrollLock();
  window.setTimeout(closeCabinetCelebration, 6200);
}
function celebrateTopikPayment(order) {
  const payment = order?.extensionPayment || order?.payment;
  if (payment?.status === 'paid') celebrateTopikMoment(order, 'payment', payment.id || payment.payment_reference || 'paid');
}
function celebrateTopikCompletion(order) {
  if (order?.status === 'completed') celebrateTopikMoment(order, 'completion', order.returned_at || order.updated_at || 'completed');
}
function actionPanel(order) {
  const canAct = order.status === 'in_use';
  const deadline = rentalDeadline(order);
  const paidExtension = order.extensionPayment?.status === 'paid';
  const openExtension = paidExtension ? null : order.requests?.find(request => ['extension','replacement'].includes(request.kind) && ['open','in_progress'].includes(request.status));
  // A resolved paid extension/replacement must supersede any older rejected
  // request. Otherwise the customer keeps seeing a red refusal after payment.
  const rejectedExtension = (paidExtension || openExtension) ? null : order.requests?.find(request => ['extension','replacement'].includes(request.kind) && request.status === 'cancelled' && request.customer_message);
  const openReturn = order.requests?.find(request => request.kind === 'early_return' && ['open','in_progress'].includes(request.status));
  const docState = documentMode(order);
  const documentText = docState.mode === 'approved' ? 'Документы проверены' : docState.mode === 'replacement' ? 'Заменить документ' : 'Загрузить документы →';
  const documents = docState.mode === 'approved' || docState.mode === 'submitted' ? '' : `<button class="cabinet-action secondary cabinet-documents-open" data-panel="documents" data-document-mode="${docState.mode}" data-document-kinds="${docState.kinds.join(',')}" data-order="${order.id}">${documentText}</button>`;
  const documentsPending = docState.mode === 'submitted' ? '<section class="cabinet-documents-cta cabinet-documents-pending"><strong>Документы на проверке</strong><p>Все файлы получены. Менеджер сверит их и затем выставит защищённый счёт. Повторно загружать ничего не нужно.</p></section>' : '';
  const paymentStarted = ['awaiting_payment', 'paid', 'confirmed'].includes(String(order.payment?.status || ''));
  const managerReplacementOffer = ['draft', 'pending_review'].includes(String(order.status || '')) && !paymentStarted && order.prepayment_replacement_offer_laptop_id
    ? `<section class="cabinet-pickup-flow cabinet-manager-replacement-offer"><strong>Rentop предлагает заменить ноутбук</strong><p><b>${escape(order.prepayment_replacement_offer_title || 'Доступная модель')}</b> · новая сумма <b>${Number(order.prepayment_replacement_offer_total_amount || 0).toLocaleString('ru-RU')} сом</b>.</p><p>${escape(order.prepayment_replacement_offer_reason || 'Менеджер предложил доступную альтернативу на ваши даты.')}</p><p>Заявка не изменится без вашего решения. Перед подтверждением мы ещё раз проверим, свободна ли модель.</p><div class="cabinet-actions"><button class="cabinet-action" data-accept-prepayment-offer="${order.id}">Согласиться на замену</button><button class="cabinet-action secondary" data-decline-prepayment-offer="${order.id}">Не подходит</button></div></section>`
    : '';
  const modelChange = ['draft', 'pending_review'].includes(String(order.status || '')) && !paymentStarted
    ? `<section class="cabinet-model-change"><strong>Не подошла модель?</strong><p>До выставления и оплаты счёта можно выбрать другой свободный ноутбук. Ваша заявка, даты и документы сохранятся, сумма пересчитается автоматически.</p><button class="cabinet-action secondary" data-panel="prepayment-replacement" data-order="${order.id}">Изменить модель</button></section>`
    : '';
  const whatsapp = supportWhatsappUrl ? `<a class="cabinet-action ghost cabinet-whatsapp" href="${escape(supportWhatsappUrl)}?text=${encodeURIComponent(`Здравствуйте! Нужна помощь по заявке ${order.reference}.`)}" target="_blank" rel="noopener" aria-label="Написать в WhatsApp по заявке ${escape(order.reference)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A10.6 10.6 0 0 0 3.1 16.1L2 22l6-1.6A10.5 10.5 0 1 0 20.5 3.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.2 6.9c.3-.7.7-.7 1.1-.6l1.5 2c.3.4.2.8-.1 1.1l-.7.7c.9 1.8 2.3 3.2 4.1 4.1l.7-.7c.3-.3.7-.4 1.1-.1l2 1.5c.1.4.1.8-.6 1.1-.8.3-1.7.5-2.5.3-4.4-1.1-7.4-4.1-8.5-8.5-.2-.8 0-1.7.3-2.5Z" fill="currentColor"/></svg><span>Написать в WhatsApp</span></a>` : '';
  if (['requested', 'submitted'].includes(order.alternative_security_status)) {
    const submitted = order.alternative_security_status === 'submitted';
    return `<section class="cabinet-documents-cta ${submitted ? 'cabinet-documents-pending' : ''}"><strong>${submitted ? 'Дополнительная проверка отправлена' : 'Менеджер запросил дополнительную проверку'}</strong><p>${submitted ? 'Файлы получены. Менеджер примет индивидуальное решение по залогу и покажет следующий шаг.' : 'Это индивидуальная проверка вместо залога. Ответственность по аренде всё равно остаётся за вами.'}</p>${submitted ? '' : `<button class="cabinet-action" data-panel="alternative-security" data-order="${order.id}">Открыть проверку без залога</button>`}</section><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button>${whatsapp}</div>`;
  }
  if (docState.mode === 'upload') return `${managerReplacementOffer}${modelChange}<div class="cabinet-documents-cta"><strong>Следующий шаг — документы</strong><p>Четыре файла: ID с двух сторон, селфи с ID и подтверждающий документ.</p>${documents}</div><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button>${whatsapp}</div>`;
  if (order.status === 'pending_review' && docState.mode === 'approved') return `<section class="cabinet-documents-cta"><strong>Документы приняты</strong><p>Менеджер завершает сверку данных для договора. Защищённый счёт появится здесь только после этой проверки.</p></section>${managerReplacementOffer}${modelChange}<div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Уточнить статус</button>${whatsapp}</div>`;
  if (order.replacement_exchange_status === 'awaiting_exchange' && order.replacement_pending_laptop_id) return `${documents}<section class="cabinet-pickup-flow"><strong>Замена ноутбука согласована</strong><p>Оплата и срок аренды уже зафиксированы. Rentop согласует физическую передачу старого и нового ноутбуков; аренда продолжится без повторной подачи документов.</p><p>Не передавайте текущий ноутбук без согласованного способа и времени обмена.</p><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Уточнить передачу</button>${whatsapp}</div></section>`;
  if (order.delivery_type === 'delivery' && order.status === 'confirmed') return `${documents}<section class="cabinet-pickup-flow"><strong>Оплата подтверждена</strong><p>Менеджер согласует с вами точное время и отдельную стоимость платной доставки по адресу из заявки. Срок аренды ещё не начался.</p><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Уточнить доставку</button>${whatsapp}</div></section>`;
  if (order.status === 'awaiting_pickup') {
    if (order.delivery_type === 'delivery') {
      const issueVideo = (order.documents || []).find(document => document.kind === 'issue_video' && document.status !== 'rejected');
      const primary = issueVideo
        ? `<span class="cabinet-request-state is-success">✓ Видео получения отправлено. Проверьте ноутбук и комплект, затем подтвердите получение.</span><button class="cabinet-action" data-confirm-pickup="${order.id}">Видео отправлено — подтвердить получение</button>`
        : `<button class="cabinet-action" data-panel="issue-video" data-order="${order.id}">Прикрепить видео получения</button>`;
      const deliveryActor = order.delivery_dispatch_mode === 'third_party_courier' ? 'Ноутбук передан сторонней курьерской службе.' : 'Ноутбук передан курьеру Rentop.';
      return `${documents}<section class="cabinet-pickup-flow is-ready"><div><strong>Ноутбук в пути</strong><span>Срок аренды начнётся только после вашего подтверждения</span></div><p>${deliveryActor} Перед отправкой с вами свяжутся для уточнения, а примерно за 10 минут до приезда предупредят. Подтвердите получение только когда ноутбук действительно передан вам. Сначала снимите короткое видео ноутбука, экрана, зарядки и комплекта.</p><ol><li>Примите ноутбук.</li><li>Снимите видео комплекта и состояния устройства.</li><li>Прикрепите видео и нажмите «Ноутбук получил(а)».</li></ol><div class="cabinet-actions">${primary}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Уточнить доставку</button>${whatsapp}</div></section>`;
    }
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
      ? `<button class="cabinet-action" data-pickup-access-received="${order.id}">Код из SMS получен</button>`
      : issueVideo
        ? `<span class="cabinet-request-state is-success">✓ Видео получения отправлено. Проверьте ноутбук и комплект, затем подтвердите получение.</span><button class="cabinet-action" data-confirm-pickup="${order.id}">Видео отправлено — подтвердить получение</button>`
        : `<button class="cabinet-action" data-panel="issue-video" data-order="${order.id}">Прикрепить видео получения</button>`;
    return `<section class="cabinet-pickup-flow ${accessSent ? 'is-ready' : ''}"><div><strong>${accessSent ? '✓ ' : ''}${title}</strong><span>${escape(location)}${point ? ` · ${escape(point.hours)}` : ''}</span></div>${point ? `<a class="cabinet-map-link" href="${escape(point.map)}" target="_blank" rel="noopener">Маршрут в 2ГИС ↗</a>` : ''}<p>${lead}${issueVideo ? ' Видео получено — подтвердите получение.' : ''}</p>${steps}<div class="cabinet-actions">${primary}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Помощь</button></div></section>`;
  }
  const latestReturnVideo = latestDocuments(order).get('return_video');
  const returnVideo = latestReturnVideo?.status === 'rejected' ? null : latestReturnVideo;
  const returnMethod = openReturn?.return_method || order.return_method;
  if (order.status === 'awaiting_return_reservation') {
    const courierToLocker = returnMethod === 'arca_courier';
    const selectedLocker = escape(order.return_locker_address || order.locker_address || 'из вашей заявки');
    const personalInstructions = `<p>Вы выбрали постамат: <strong>${selectedLocker}</strong>. Rentop резервирует ячейку и направит вам SMS-код доступа.</p><ol><li>Дождитесь SMS-кода от ARCHA POINT.</li><li>До похода к постамату снимите короткое видео ноутбука, корпуса, экрана, зарядки и комплекта.</li><li>Придите к выбранному постамату, откройте ячейку по коду, положите ноутбук и весь комплект, затем закройте ячейку.</li><li>Подтвердите возврат в личном кабинете только после закрытия ячейки.</li></ol>`;
    const courierInstructions = `<p>Выбран возврат курьером ARCHA POINT в постамат <strong>${selectedLocker}</strong>. Менеджер согласует дальнейшие шаги и время передачи. До подтверждения Rentop не передавайте ноутбук курьеру.</p>`;
    return `${documents}<section class="cabinet-pickup-flow"><strong>Резервируем ячейку для возврата</strong>${courierToLocker ? courierInstructions : personalInstructions}<div class="cabinet-actions">${courierToLocker ? '<span class="cabinet-request-state is-info">Ожидаем подтверждение дальнейших шагов от Rentop.</span>' : `<button class="cabinet-action" data-return-access-received="${order.id}">SMS-код получен — перейти к видео</button>`}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Код не приходит / помощь</button>${whatsapp}</div></section>`;
  }
  if (order.status === 'awaiting_return_dropoff') {
    const returnVideoReady = Boolean(returnVideo && returnVideo.status !== 'rejected');
    const returnAction = returnVideoReady
      ? `<span class="cabinet-request-state is-success">✓ Видео возврата отправлено. Поместите ноутбук в ячейку и подтвердите закрытие. Менеджер проверит видео и технику после получения.</span><button class="cabinet-action" data-confirm-return-dropoff="${order.id}">Ноутбук помещён в ячейку</button>`
        : `<button class="cabinet-action secondary" data-panel="return-video" data-order="${order.id}">Прикрепить видео возврата</button>`;
    const courierToLocker = returnMethod === 'arca_courier';
    const courierNotice = courierToLocker ? 'Код направлен согласованному курьеру, а не отображается в кабинете. Сначала передайте ноутбук курьеру и дождитесь его подтверждения о помещении в ячейку.' : 'Только затем поместите устройство в ячейку по коду ARCHA POINT.';
    return `${documents}<section class="cabinet-pickup-flow is-ready"><strong>${courierToLocker ? 'Курьер везёт возврат в постамат' : 'Код возврата отправлен'}</strong><p>До помещения в ячейку снимите короткое видео ноутбука, корпуса, экрана, зарядки и комплекта. После отправки видео не нужно ждать ручной проверки: возвращайте устройство по коду.</p><ol><li>Снимите видео состояния и комплекта.</li><li>Прикрепите видео ниже.</li><li>${courierToLocker ? 'Передайте ноутбук назначенному курьеру.' : 'Поместите ноутбук в ячейку и закройте её.'}</li><li>Менеджер проверит видео и технику после фактического получения.</li></ol><div class="cabinet-actions">${courierToLocker ? (returnVideoReady ? '<span class="cabinet-request-state is-success">✓ Видео возврата отправлено. Ожидаем подтверждение помещения от курьера.</span>' : returnAction) : returnAction}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button></div></section>`;
  }
  if (order.status === 'returned') { const returnedText = returnMethod === 'arca_locker' ? 'Мы получили вашу отметку о помещении ноутбука. Менеджер заберёт устройство из ячейки, проверит видео и проведёт итоговый осмотр.' : 'Rentop отметил физическое получение ноутбука. Менеджер проверит видео и проведёт итоговый осмотр.'; return `${documents}<section class="cabinet-pickup-flow"><strong>Возврат подтверждён</strong><p>${returnedText} Аренда будет завершена только после этой проверки.</p><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button>${whatsapp}</div></section>`; }
  if (order.status === 'completed') {
    if (hiddenCompletionOrders.has(String(order.id))) return '';
    const feedbackActions = order.feedback
      ? '<div class="cabinet-request-state is-success">Спасибо — ваш отзыв уже получен.</div>'
      : `<div class="cabinet-actions"><button class="cabinet-action" data-panel="feedback" data-order="${order.id}">Оставить отзыв</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Предложить улучшение</button></div>`;
    return `${documents}<section class="cabinet-completion"><strong>Спасибо, что выбрали Rentop!</strong><p>Мы благодарим вас за аренду и будем рады помочь снова. Менеджер может выдать персональный промокод на следующую аренду — он появится в разделе «Скидки и промокоды».</p>${feedbackActions}<div class="cabinet-actions"><button class="cabinet-action ghost" data-close-completion="${order.id}">Скрыть</button></div></section>`;
  }
  if (order.status === 'awaiting_return_collection') {
    // A manager writes handoff details to both records. The request fallback
    // supports older active orders where only one row received the update.
    const handoffAddress = order.return_destination_address || openReturn?.return_destination_address || '';
    const handoffNote = order.return_destination_note || openReturn?.return_destination_note || '';
    const destination = handoffAddress
      ? `<section class="cabinet-return-address"><span>АДРЕС ДЛЯ ВОЗВРАТА</span><strong>${escape(handoffAddress)}</strong>${handoffNote ? `<p>${escape(handoffNote)}</p>` : ''}</section>`
      : 'Адрес приёма и дальнейшие инструкции сообщит менеджер после согласования.';
    const awaitingExactDetails = !handoffAddress && ['customer_courier','self_delivery'].includes(returnMethod);
    const methodText = returnMethod === 'rentop_courier' ? `Курьер Rentop: платная услуга для клиента. Адрес забора и желаемое время: ${escape(order.return_collection_address || 'уточняется')} · ${escape(order.return_preferred_time || 'по согласованию')}. Менеджер подтвердит стоимость и точный интервал до выезда.` : returnMethod === 'customer_courier' ? `Вызываете курьерскую службу сами и оплачиваете её напрямую.` : 'Самопривоз по согласованию.';
    const exactDetailsNotice = awaitingExactDetails ? '<div class="cabinet-request-state is-warning"><strong>Не вызывайте курьера пока</strong><p>Сначала дождитесь здесь точного адреса и времени приёма от Rentop. Только после этого оформляйте Яндекс или другую курьерскую службу.</p></div>' : '';
    const title = handoffAddress ? 'Адрес для возврата готов' : 'Возврат согласовывается';
    return `${documents}<section class="cabinet-pickup-flow"><strong>${title}</strong><p>${methodText}</p>${handoffAddress ? destination : ''}${exactDetailsNotice}<p>Видео не завершает аренду: Rentop должен физически получить и осмотреть ноутбук.</p><div class="cabinet-actions">${returnVideo ? '<span class="cabinet-request-state is-success">✓ Видео отправлено. Ожидайте согласования передачи и фактической приёмки.</span>' : `<button class="cabinet-action secondary" data-panel="return-video" data-order="${order.id}">Прикрепить видео возврата</button>`}<button class="cabinet-action ghost" data-refresh-order-workspace="${order.id}">Обновить статус возврата</button><button class="cabinet-action ghost" data-change-return-method="${order.id}">Изменить способ возврата</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Проблема с возвратом</button>${whatsapp}</div></section>`;
  }
  if (rejectedExtension) {
    return `${documents}<div class="cabinet-request-state is-error"><strong>Продление не согласовано</strong><p>${escape(rejectedExtension.customer_message || 'Ноутбук недоступен на запрошенные даты. Выберите другой вариант или свяжитесь с менеджером.')}</p></div><section class="cabinet-active-actions"><strong>Что сделать дальше</strong><p>Можно повторить запрос с другим сроком либо подобрать свободную модель. Документы и текущая аренда сохранятся.</p><div class="cabinet-actions"><button class="cabinet-action" data-panel="extend" data-order="${order.id}" data-extension-days="${Number(rejectedExtension.requested_days || 3)}">Подобрать замену / повторить</button><button class="cabinet-action secondary" data-panel="return" data-order="${order.id}">Оформить возврат</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Уточнить у менеджера</button>${whatsapp}</div></section>`;
  }
  if (openExtension || openReturn) {
    const pending = openExtension || openReturn;
    const cancelExtension = openExtension?.status === 'open' ? `<button class="cabinet-action secondary" data-panel="cancel-extension" data-order="${order.id}" data-request-id="${openExtension.id}">Отменить запрос продления</button>` : '';
    const isExtension = ['extension', 'replacement'].includes(pending.kind);
    return `${documents}<div class="cabinet-request-state ${isExtension ? 'is-info cabinet-extension-pending' : ''}"><strong>${isExtension ? '⌛ Продление на рассмотрении' : '⌛ Запрос на возврат на рассмотрении'}</strong><p>${escape(requestLabel(pending))}. Менеджер проверяет доступность и подготовит следующий шаг.</p></div><div class="cabinet-actions">${cancelExtension}<button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button>${whatsapp}</div>`;
  }
  if (order.status === 'incident') return `${documents}<section class="cabinet-pickup-flow"><strong>Rentop проверяет ситуацию с ноутбуком</strong><p>Аренда и залог не списываются дополнительно, пока менеджер не зафиксирует решение. При необходимости мы предложим доступную замену и согласуем способ передачи.</p><div class="cabinet-actions"><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Связаться с менеджером</button>${whatsapp}</div></section>`;
  if (!canAct) return `${documentsPending}${documents}${modelChange}<div class="cabinet-action-disabled">Продление и досрочный возврат станут доступны после выдачи ноутбука.</div><div class="cabinet-actions"><button class="cabinet-action secondary" data-panel="support" data-order="${order.id}">Помощь</button>${whatsapp}</div>`;
  const deadlineNotice = deadline ? `<div class="cabinet-request-state ${deadline.due ? 'is-warning' : ''}"><strong>${deadline.title}</strong><p>${deadline.text}</p></div>` : '';
  const returnLabel = 'Вернуть';
  const exactTerm = order.rental_ends_at ? `До ${moment(order.rental_ends_at)} (Бишкек).` : `До ${date(order.rental_end_date)}.`;
  return `${deadlineNotice}<div class="cabinet-active-actions"><strong>Управление арендой</strong><p>${exactTerm} Продление проверяется по доступности ноутбука, возврат — после выбора удобного способа.</p><div class="cabinet-actions"><button class="cabinet-action" data-panel="extend" data-order="${order.id}">Продлить аренду</button><button class="cabinet-action secondary" data-panel="return" data-order="${order.id}">${returnLabel}</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Помощь</button>${whatsapp}</div></div>`;
}
function requestForm(order) {
  return `<div class="cabinet-request-panel" id="panel-${order.id}" hidden></div>`;
}
function replacementChoicesMarkup(orderId, days, alternatives = []) {
  if (!alternatives.length) return `<div class="cabinet-request-state is-warning"><strong>Продлить эту модель нельзя</strong><p>На нужные даты свободной замены пока нет. Оформите возврат или напишите в поддержку — менеджер проверит другие варианты.</p></div>`;
  return `<form class="cabinet-inline-form" data-request="replacement_request" data-order="${escape(orderId)}"><input name="days" type="hidden" value="${Number(days)}"><label>Выберите замену на период продления</label><p>Документы и текущая заявка сохраняются. Менеджер подтвердит модель и откроет один счёт с перерасчётом.</p><div class="cabinet-replacement-options">${alternatives.map(item => `<label class="cabinet-replacement-option"><input type="radio" name="replacementLaptopId" value="${Number(item.id)}" required><span><b>${escape(item.title)}</b><small>${Number(item.daily_rate || 0).toLocaleString('ru-RU')} сом/день · скидка ${Number(item.discount_percent || 0)}%</small><em>За ${Number(days)} дн.: ${Number(item.estimated_amount || 0).toLocaleString('ru-RU')} сом · разница ${Number(item.difference || 0) >= 0 ? '+' : ''}${Number(item.difference || 0).toLocaleString('ru-RU')} сом</em></span></label>`).join('')}</div><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Выбрать замену</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}

function prepaymentReplacementChoicesMarkup(orderId, alternatives = []) {
  if (!alternatives.length) return `<div class="cabinet-request-state is-warning"><strong>Свободных моделей пока нет</strong><p>На эти даты другой свободной модели не найдено. Ваша текущая заявка сохранена — попробуйте позже или напишите в поддержку.</p></div>`;
  const shown = alternatives.slice(0, 12);
  const hiddenCount = Math.max(0, alternatives.length - shown.length);
  return `<form class="cabinet-inline-form cabinet-prepayment-picker" data-request="replace_draft_laptop" data-order="${escape(orderId)}"><strong>Выберите замену ноутбука</strong><p>Показаны ближайшие свободные варианты по цене. Даты, способ получения и документы останутся в этой заявке.</p><div class="cabinet-replacement-options">${shown.map(item => `<label class="cabinet-replacement-option"><input type="radio" name="replacementLaptopId" value="${Number(item.id)}" required><span><b>${escape(item.title)}</b><small class="cabinet-replacement-rate">Ставка: ${Number(item.daily_rate || 0).toLocaleString('ru-RU')} сом / день · скидка ${Number(item.discount_percent || 0)}%</small><em>Итого за аренду: ${Number(item.total_amount || 0).toLocaleString('ru-RU')} сом <i>${Number(item.difference || 0) >= 0 ? '+' : '−'}${Math.abs(Number(item.difference || 0)).toLocaleString('ru-RU')} сом</i></em></span></label>`).join('')}</div>${hiddenCount ? `<p class="cabinet-form-hint">Показаны первые 12 вариантов из ${alternatives.length}. Если ни один не подходит, обратитесь в поддержку — менеджер подберёт модель из каталога.</p>` : ''}<div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Выбрать эту модель</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}
function promoStatus(promo) {
  if (promo.status === 'redeemed') return 'Использован';
  if (promo.status === 'revoked') return 'Отозван';
  if (promo.status === 'expired' || new Date(promo.expires_at) <= new Date()) return 'Истёк';
  return 'Активен';
}
function loyaltyPanel(promos, benefits = [], orderId = '') {
  const benefitLabel = kind => BENEFIT_LABELS[kind] || kind;
  const benefitState = item => ({ pending_review:'на проверке', approved:'подтверждена', rejected:'нужен другой документ', expired:'истекла' }[item.status] || item.status);
  // A profile has one current social benefit. Old/rejected uploads are part
  // of the internal history, not a customer-facing list of simultaneous roles.
  const currentBenefit = benefits.find(item => item.status === 'approved') || benefits.find(item => item.status === 'pending_review') || null;
  const activeBenefit = currentBenefit?.status === 'approved' ? currentBenefit : null;
  const pendingBenefit = currentBenefit?.status === 'pending_review' ? currentBenefit : null;
  const benefitList = currentBenefit ? `<div class="cabinet-promo-list"><div class="cabinet-promo ${currentBenefit.status === 'rejected' ? 'is-rejected' : ''}"><b>Ваша льгота: ${escape(benefitLabel(currentBenefit.benefit_type))}</b><span>${currentBenefit.status === 'approved' ? '−10%' : benefitState(currentBenefit)}</span><small>${currentBenefit.reviewer_note ? escape(currentBenefit.reviewer_note) : currentBenefit.status === 'approved' ? 'Подтверждена и действует в новых заявках.' : 'Менеджер проверяет документ.'}</small></div></div>` : '';
  const benefitForm = orderId && !activeBenefit && !pendingBenefit ? `<details class="cabinet-benefit-disclosure"><summary><span><strong>Льгота · 10%</strong><small>По документу, необязательно</small></span><b>Оформить</b></summary><form class="cabinet-inline-form cabinet-benefit-form cabinet-documents-form" novalidate data-document-upload="true" data-document-replacement="1" data-benefit-type="student" data-required-kinds="benefit_proof" data-order="${escape(orderId)}"><div class="cabinet-benefit-heading"><strong>Проверка льготы</strong><span>Менеджером</span></div><p>Выберите категорию и один документ. После одобрения скидка применится к неоплаченной и будущим заявкам.</p><label class="cabinet-field-label" for="benefit-type-${escape(orderId)}">Категория льготы</label><select id="benefit-type-${escape(orderId)}" name="benefitType">${BENEFIT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>${fileControl('benefit_proof')}<div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить на проверку</button></div></form></details>` : activeBenefit ? '' : '<p class="cabinet-benefit-status">Льготный документ на проверке. Сумма текущей неоплаченной заявки обновится после одобрения.</p>';
  const promoList = promos.length ? `<div class="cabinet-promo-list">${promos.map(promo => `<div class="cabinet-promo"><b>${escape(promo.code)}</b><span>−${Number(promo.discount_percent || 0)}%</span><small>${escape(promoStatus(promo))} · до ${date(promo.expires_at)}</small></div>`).join('')}</div>` : '<p class="cabinet-form-hint">Пока нет персональных промокодов. Их выдаёт Rentop — код появится здесь.</p>';
  return `<section class="cabinet-loyalty"><div class="cabinet-loyalty-heading"><strong>Ваши скидки</strong><span>до 40%</span></div>${benefitList}${benefitForm}<div class="cabinet-discount-guide"><strong>Скидка по сроку аренды</strong><span>7–14 дней — 15% · 15+ дней — 30%</span></div><div class="cabinet-promo-heading"><strong>Персональные промокоды</strong><small>Введите код при оформлении новой заявки.</small></div>${promoList}<p class="cabinet-form-hint">Срок аренды, подтверждённая льгота и персональный код складываются. Максимальная скидка — 40%. Залог не уменьшается.</p></section>`;
}
function panelMarkup(kind, orderId, documentState = {}) {
  const order = cabinetOrders.find(item => String(item.id) === String(orderId)) || {};
  if (kind === 'delivery') {
    const isLocker = order.delivery_type === 'arca_locker';
    return `<form class="cabinet-inline-form cabinet-delivery-choice" data-request="save_delivery_preferences" data-order="${escape(orderId)}"><strong>Изменить способ получения</strong><p>Это можно сделать до выставления и оплаты счёта. После сохранения заявка останется той же.</p><label>Способ получения</label><select name="deliveryType" data-delivery-type><option value="delivery" ${isLocker ? '' : 'selected'}>Доставка курьером</option><option value="arca_locker" ${isLocker ? 'selected' : ''}>Через ARCHA POINT</option></select><div data-delivery-fields="delivery" ${isLocker ? 'hidden' : ''}><label>Адрес доставки</label><textarea name="deliveryAddress" ${isLocker ? 'disabled' : 'required'} minlength="8" maxlength="500" placeholder="Город, район, улица, дом, квартира">${escape(order.delivery_address || '')}</textarea><label>Предпочтительный интервал</label><input name="deliveryPreferredTime" ${isLocker ? 'disabled' : 'required'} minlength="3" maxlength="300" value="${escape(order.delivery_preferred_time || '')}" placeholder="Например: после 20:00"></div><div data-delivery-fields="arca_locker" ${isLocker ? '' : 'hidden'}><label>Точка ARCHA POINT</label><select name="lockerAddress" ${isLocker ? 'required' : 'disabled'}><option value="">Выберите точку</option>${ARCHA_LOCATIONS.map(location => `<option value="${escape(location.value)}" ${order.locker_address === location.value ? 'selected' : ''}>${escape(location.value)} · ${escape(location.hours)}</option>`).join('')}</select></div><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Сохранить способ получения</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  }
  if (kind === 'documents') {
    if (documentState.mode === 'approved') return `<div class="cabinet-document-wait is-approved"><strong>Документы проверены</strong><p>Спасибо. Заявка перешла к оплате или подготовке выдачи — следующий шаг показан выше.</p></div>`;
    if (documentState.mode === 'submitted') return `<div class="cabinet-document-wait"><strong>Документы отправлены</strong><p>Ваша заявка обрабатывается. Ожидайте ответа менеджера — повторная отправка заблокирована.</p><button class="cabinet-action ghost" type="button" data-document-correction="${orderId}">Я отправил(а) неверный документ</button></div>`;
    const replacement = documentState.mode === 'replacement';
    const kinds = replacement ? String(documentState.kinds || '').split(',').filter(Boolean) : ['identity_front', 'identity_back', 'selfie', 'supporting'];
    const requiredKinds = replacement ? kinds : ['identity_front', 'identity_back', 'selfie', 'supporting'];
    const smsConsent = !replacement && offerSmsConsentRequired && !documentState.offerSmsVerified ? `<div class="cabinet-offer-sms"><p>3. Подтвердите согласие кодом из SMS. Код придёт только на номер, с которым вы вошли в Rentop: <strong>${escape(documentState.phone || 'ваш подтверждённый номер')}</strong>.</p><button class="cabinet-action secondary" type="button" data-request-offer-sms="${orderId}">Получить код по SMS</button><p class="cabinet-offer-sms-status" data-offer-sms-status aria-live="polite"></p><div class="cabinet-inline-row" data-offer-sms-verify hidden><input inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 цифр из SMS" aria-label="Код подтверждения оферты"><button class="cabinet-action" type="button" data-verify-offer-sms="${orderId}">Подтвердить код</button></div></div>` : '<p class="cabinet-offer-confirmed">✓ Согласие с офертой уже подтверждено кодом.</p>';
    const offer = replacement ? '' : `<section class="cabinet-offer-flow"><strong>Договор-оферта и подтверждение</strong><p>Всё оформляется здесь, в одном шаге — без перехода в другие разделы.</p><button class="cabinet-action secondary" type="button" data-open-offer="true">1. Открыть договор-оферту</button><label class="cabinet-document-consent"><input name="offerConsent" type="checkbox" required><span>2. Я прочитал(а) договор-оферту и принимаю его условия.</span></label>${smsConsent}</section>`;
    const warnings = replacement ? '' : `<details class="cabinet-safety-notice"><summary>Важно о документах и технике</summary><p>Подделка, использование чужих или заведомо недостоверных документов может повлечь ответственность по законодательству Кыргызской Республики. Rentop проверяет документы до выдачи.</p><p>На выдаваемом оборудовании установлены средства контроля местонахождения и целостности, включая GPS-трекеры и гарантийные пломбы. Несанкционированное вскрытие, нарушение пломб или попытка отключить средства контроля считаются нарушением правил эксплуатации и могут повлечь штраф, возмещение ущерба и обращение в уполномоченные органы.</p></details>`;
    const residence = replacement ? '' : `<label>Полный адрес проживания <span>обязательно</span></label><textarea name="residenceAddress" required minlength="15" maxlength="500" autocomplete="street-address" placeholder="г. Бишкек, район, ул. Пример, д. 12, кв. 34"></textarea><p class="cabinet-form-hint">Укажите город, район, улицу, номер дома и квартиру. Адрес фиксируется в защищённой заявке и сверяется с подтверждающим документом.</p>`;
    const isLockerDelivery = documentState.deliveryType === 'arca_locker';
    const delivery = replacement ? '' : `<section class="cabinet-delivery-inline cabinet-delivery-choice"><strong>Способ получения</strong><p>До отправки документов и создания QR-счёта его можно поменять. Выберите удобный вариант для этой заявки.</p><label>Как получить ноутбук <span>обязательно</span></label><select name="deliveryType" data-delivery-type><option value="delivery" ${isLockerDelivery ? '' : 'selected'}>Доставка курьером</option><option value="arca_locker" ${isLockerDelivery ? 'selected' : ''}>Через ARCHA POINT</option></select><div data-delivery-fields="delivery" ${isLockerDelivery ? 'hidden' : ''}><p class="cabinet-delivery-subtitle">Доставка курьером</p><p>Укажите адрес и удобный интервал. Точную стоимость и время менеджер подтвердит до выдачи.</p><label>Адрес доставки <span>обязательно</span></label><textarea name="deliveryAddress" ${isLockerDelivery ? 'disabled' : 'required'} minlength="8" maxlength="500" placeholder="Город, район, улица, дом, квартира (если есть)">${escape(documentState.deliveryAddress || '')}</textarea><label>Предпочтительный интервал доставки <span>обязательно</span></label><input name="deliveryPreferredTime" ${isLockerDelivery ? 'disabled' : 'required'} minlength="3" maxlength="300" value="${escape(documentState.deliveryPreferredTime || '')}" placeholder="Например: после 20:00, по согласованию"></div><div data-delivery-fields="arca_locker" ${isLockerDelivery ? '' : 'hidden'}><p class="cabinet-delivery-subtitle">Получение через ARCHA POINT</p><p>Выберите удобную точку. Получение из ячейки включено в тариф аренды.</p><label>Точка ARCHA POINT <span>обязательно</span></label><select name="lockerAddress" ${isLockerDelivery ? 'required' : 'disabled'}><option value="">Выберите точку</option>${ARCHA_LOCATIONS.map(location => `<option value="${escape(location.value)}" ${documentState.lockerAddress === location.value ? 'selected' : ''}>${escape(location.value)} · ${escape(location.hours)}</option>`).join('')}</select></div></section>`;
    const orderComment = replacement ? '' : `<label>Комментарий к заявке <span>необязательно</span></label><textarea name="orderComment" maxlength="1000" placeholder="Например: цель аренды, пожелания по комплектации или вопрос менеджеру"></textarea>`;
    const profileField = replacement || isValidFullName(customerProfile?.full_name) ? '' : `<label>ФИО для договора <span>заполняется один раз</span></label><input name="fullName" autocomplete="name" placeholder="Фамилия Имя Отчество">`;
    const requestedBenefit = BENEFIT_OPTIONS.some(([value]) => value === documentState.benefitRequested) ? documentState.benefitRequested : '';
    const profileBenefit = customerBenefits.find(item => ['approved', 'pending_review'].includes(item.status));
    const benefit = replacement ? '' : profileBenefit ? `<section class="cabinet-benefit-inline"><strong>${profileBenefit.status === 'approved' ? '✓ Льгота профиля подтверждена' : 'Льгота профиля на проверке'}</strong><p>${profileBenefit.status === 'approved' ? `«${escape(BENEFIT_LABELS[profileBenefit.benefit_type] || profileBenefit.benefit_type)}» автоматически учитывается в расчёте новых заявок. Повторно загружать документ не нужно.` : 'После решения менеджера льгота будет действовать для следующих заявок этого профиля.'}</p></section>` : `<section class="cabinet-benefit-inline"><strong>Льгота для профиля 10% <span>необязательно</span></strong><p>Загрузите подтверждение один раз — после одобрения скидка будет сохранена за вашим номером телефона и применяться в следующих заявках автоматически.</p><select name="benefitType" data-benefit-type><option value="">Не использовать социальную скидку</option>${BENEFIT_OPTIONS.map(([value, label]) => `<option value="${value}" ${requestedBenefit === value ? 'selected' : ''}>${label}</option>`).join('')}</select><div data-benefit-proof ${requestedBenefit ? '' : 'hidden'}>${fileControl('benefit_proof')}</div></section>`;
    return `<form class="cabinet-inline-form cabinet-documents-form" novalidate data-document-upload="true" data-document-replacement="${replacement ? '1' : ''}" data-offer-sms-verified="${documentState.offerSmsVerified ? '1' : '0'}" data-required-kinds="${requiredKinds.join(',')}" data-order="${orderId}"><label>${replacement ? 'Прикрепите исправленный документ' : 'Подтвердите данные для заявки'}</label><p>${replacement ? 'Менеджер открыл замену для отмеченного файла. После повторной загрузки заявка снова уйдёт на проверку.' : 'Документы увидит только команда Rentop для проверки заявки. Допустимы JPG, PNG или PDF до 8 МБ.'}</p>${profileField}${delivery}${residence}${kinds.map(fileControl).join('')}${benefit}${orderComment}${offer}${warnings}<label class="cabinet-document-consent"><input name="documentConsent" type="checkbox"><span>Согласен(на) на передачу документов команде Rentop исключительно для проверки заявки и оформления договора.</span></label><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">${replacement ? 'Отправить замену' : 'Загрузить документы'}</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>После отправки повторная загрузка будет заблокирована до решения менеджера.</p></form>`;
  }
  if (kind === 'alternative-security') {
    const requirements = Array.isArray(order.alternative_security_requirements) ? order.alternative_security_requirements.filter(item => ALTERNATIVE_SECURITY_LABELS[item]) : [];
    if (!requirements.length) return `<div class="cabinet-document-wait"><strong>Проверка недоступна</strong><p>Менеджер ещё не выбрал список документов. Обновите заявку или напишите в поддержку.</p></div>`;
    const expires = order.alternative_security_expires_at ? `до ${moment(order.alternative_security_expires_at)}` : 'в согласованный менеджером срок';
    const fields = requirements.map(kind => kind === 'alternative_security_video' ? videoControl(kind) : fileControl(kind)).join('');
    return `<form class="cabinet-inline-form cabinet-documents-form" novalidate data-document-upload="true" data-alternative-security-upload="true" data-required-kinds="${requirements.join(',')}" data-order="${orderId}"><label>Проверка без денежного залога</label><p>${escape(order.alternative_security_note || 'Менеджер запросил дополнительное подтверждение по этой заявке.')} Отправьте материалы ${escape(expires)}.</p><section class="cabinet-safety-notice"><strong>Что важно</strong><p>В видео назовите ФИО, номер заявки, модель, даты аренды и город использования. Не называйте номер паспорта, PIN-коды или данные банковских карт.</p><p>Контакт близкого родственника нужен только для экстренной связи. Он не становится поручителем и не отвечает по вашему договору.</p></section><label>Город использования ноутбука <span>обязательно</span></label><input name="operationCity" required maxlength="120" value="${escape(order.operation_city || '')}" placeholder="Например: Бишкек или Кара-Балта"><label>ФИО близкого родственника <span>для экстренной связи</span></label><input name="emergencyContactName" required maxlength="160" placeholder="Фамилия Имя Отчество"><label>Кем приходится</label><select name="emergencyContactRelationship" required><option value="">Выберите</option><option value="mother">Мать</option><option value="father">Отец</option><option value="spouse">Супруг / супруга</option><option value="sibling">Брат / сестра</option><option value="relative">Другой близкий родственник</option></select><label>Телефон родственника</label><input name="emergencyContactPhone" required inputmode="tel" maxlength="20" placeholder="+996 555 123 456"><p class="cabinet-form-hint">Указывайте контакт только с его разрешения. Не загружайте паспорта или ID родственников.</p>${fields}<label class="cabinet-document-consent"><input name="emergencyContactConsent" type="checkbox" required><span>Подтверждаю, что родственник согласен на передачу его контакта Rentop только для экстренной связи по этой заявке.</span></label><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить на проверку</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  }
  if (kind === 'issue-video' || kind === 'return-video') {
    const documentKind = kind === 'issue-video' ? 'issue_video' : 'return_video';
    const title = kind === 'issue-video' ? 'Видео до получения' : 'Видео возврата';
    return `<form class="cabinet-inline-form cabinet-evidence-form" data-document-upload="true" data-evidence-upload="true" data-required-kinds="${documentKind}" data-order="${orderId}"><label>${title}</label><p>Снимите одно непрерывное видео до 30 секунд. Допустимы MP4 или MOV до 50 МБ; для iPhone выберите 720p или 1080p/30 fps. До отправки видео можно открыть, удалить и снять заново.</p>${videoControl(documentKind)}<div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить видео</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  }
  if (kind === 'extend') return `<form class="cabinet-inline-form" data-request="extension_request" data-order="${orderId}"><label>На сколько дней продлить?</label><div class="cabinet-inline-row"><input name="days" type="number" min="1" max="30" value="${Math.min(30, Math.max(1, Number(documentState.days || 3)))}" required><button class="cabinet-action" type="submit">Проверить доступность</button></div><p>Если текущая модель занята, сайт сразу покажет доступные замены с разницей в цене.</p></form>`;
  if (kind === 'cancel-extension') return `<form class="cabinet-inline-form" data-request="cancel_extension_request" data-order="${orderId}"><input name="requestId" type="hidden" value="${escape(documentState.requestId || '')}"><label>Отменить запрос продления?</label><p>Это отменит только ещё не оплаченный запрос. После отмены можно сразу оформить возврат ноутбука.</p><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Отменить продление</button><button class="cabinet-cancel-panel" type="button">Назад</button></div></form>`;
  if (kind === 'return') return `<form class="cabinet-inline-form" data-request="early_return_request" data-order="${orderId}"><label>Как вам удобнее вернуть ноутбук?</label><select name="returnMethod" required><option value="">Выберите способ</option><option value="arca_locker">ARCHA POINT — вы возвращаете лично</option><option value="arca_courier">Курьер ARCHA POINT → постамат</option><option value="rentop_courier">Курьер Rentop — заберём по вашему адресу, платно</option><option value="customer_courier">Иная курьерская служба (Яндекс и др.) — платно</option><option value="self_delivery">Самопривоз по согласованию</option></select><section class="cabinet-return-important cabinet-return-rentop-notice" hidden><strong>Курьер Rentop заберёт ноутбук по вашему адресу</strong><p>Это платная услуга для клиента. Менеджер заранее согласует стоимость и точный интервал приезда. Адрес Rentop ждать не нужно — курьер приедет по указанному вами адресу.</p></section><section class="cabinet-return-important cabinet-return-customer-notice" hidden><strong>Сначала дождитесь адреса Rentop</strong><p>Менеджер Rentop сообщит в личном кабинете точный адрес и время приёма. Только после этого вызывайте Яндекс или другую курьерскую службу и передавайте ей эти данные.</p><p>Иную курьерскую службу клиент заказывает и оплачивает напрямую.</p></section><div class="cabinet-return-locker" hidden><label>Выберите постамат возврата</label><select name="returnLockerAddress"><option value="">Выберите постамат</option>${ARCHA_LOCATIONS.map(location => `<option value="${escape(location.value)}">${escape(location.value)} · ${escape(location.hours)}</option>`).join('')}</select></div><div class="cabinet-return-collection" hidden><label>Адрес, откуда забрать ноутбук</label><textarea name="returnCollectionAddress" maxlength="500" placeholder="Адрес, куда должен приехать курьер Rentop">${escape(documentState.address || '')}</textarea></div><div class="cabinet-return-contact" hidden><label>Контактное лицо</label><input name="returnContactName" maxlength="160" value="${escape(documentState.name || '')}"><label>Телефон для связи</label><input name="returnContactPhone" inputmode="tel" maxlength="40" value="${escape(documentState.phone || '')}"><label>Желаемое время</label><input name="returnPreferredTime" maxlength="300" placeholder="Например: после 20:00, по согласованию"></div><div class="cabinet-return-customer-courier" hidden><p>Курьер ARCHA POINT заберёт ноутбук и передаст его в постамат. Выберите точку и укажите контакт с удобным временем; Rentop согласует дальнейшие шаги. До подтверждения Rentop не передавайте ноутбук курьеру.</p></div><div class="cabinet-return-delivery-confirmation" hidden><label class="cabinet-document-consent"><input name="returnDeliveryConfirmed" type="checkbox"><span>Принимаю условия: сначала дождусь точного адреса и времени от Rentop, затем сам(а) вызову и оплачу иную курьерскую службу.</span></label></div><div class="cabinet-return-self" hidden><label>Желаемое время самопривоза</label><input name="returnPreferredTimeSelf" maxlength="300" placeholder="Например: после 20:00"><p>Адрес приёма сообщит менеджер после согласования.</p></div><label>Коротко опишите причину (необязательно)</label><textarea name="message" maxlength="500" placeholder="Например: изменились планы, хочу вернуть сегодня"></textarea><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Запросить возврат</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Видео фиксирует состояние, но не завершает аренду. Rentop завершит её только после физического получения и осмотра.</p></form>`;
  if (kind === 'comment') return `<form class="cabinet-inline-form cabinet-comment-form" data-request="save_order_comment" data-order="${orderId}"><label>Комментарий к заявке</label><textarea name="message" minlength="3" maxlength="1000" placeholder="Например: цель аренды, важные пожелания по комплектации или вопрос менеджеру"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Сохранить комментарий</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Комментарий увидит менеджер ещё до проверки документов.</p></form>`;
  if (kind === 'feedback') return `<form class="cabinet-inline-form" data-request="submit_feedback" data-order="${orderId}"><label>Спасибо, что выбрали Rentop</label><select name="rating"><option value="">Оценка — по желанию</option><option value="5">5 — отлично</option><option value="4">4 — хорошо</option><option value="3">3 — нормально</option><option value="2">2 — есть проблемы</option><option value="1">1 — плохо</option></select><label>Ваш отзыв</label><textarea name="review" maxlength="1500" placeholder="Что вам понравилось?"></textarea><label>Предложение по улучшению</label><textarea name="suggestion" maxlength="1500" placeholder="Что сделать удобнее?"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить отзыв</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
  const paymentAccepted = order.payment?.status === 'paid';
  const deliveryTopics = `<option value="delivery_status">Когда приедет доставка?</option><option value="delivery_change">Перенести время доставки</option><option value="address_change">Изменить адрес доставки</option>`;
  const archaTopics = `<option value="archa_code_missing">Не пришёл код ARCHA POINT</option><option value="archa_locker_issue">Постамат не открывается или не выдаёт ноутбук</option><option value="archa">Другая проблема с ARCHA POINT</option>`;
  const topics = order.delivery_type === 'arca_locker' ? archaTopics : deliveryTopics;
  const cancellation = paymentAccepted ? `<option value="rental_issue">Нужен возврат / заморозка аренды</option>` : `<option value="order_cancel">Отменить заявку</option>`;
  return `<form class="cabinet-inline-form cabinet-support-form" data-request="support_request" data-order="${orderId}"><strong>Поддержка Rentop</strong><p>${paymentAccepted ? 'Оплата уже принята: отмена больше не освобождает заявку автоматически. Для возврата или заморозки оставьте обращение — менеджер согласует решение.' : 'Выберите понятную тему — обращение сразу появится в рабочей панели менеджера и придёт в Telegram.'}</p><label>Что нужно уточнить?</label><select name="kind">${topics}${cancellation}<option value="rentop">Другой вопрос к Rentop</option>${paymentAccepted ? '' : '<option value="rental_issue">Проблема с ноутбуком или комплектностью</option>'}</select><label>Комментарий</label><textarea name="message" minlength="3" maxlength="1000" placeholder="Например: прошу доставить после 20:00 или изменить адрес"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить обращение</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}
function fileControl(kind) {
  const [title, hint] = ({ identity_front:['Паспорт или ID-карта — лицевая сторона', 'обязательно'], identity_back:['Паспорт или ID-карта — обратная сторона', 'обязательно'], selfie:['Селфи с документом', 'обязательно: откроется фронтальная камера'], supporting:['Официальное подтверждение', 'обязательно: выберите тип документа ниже'], benefit_proof:['Подтверждающий документ', 'студенческий билет, справка или удостоверение'], alternative_security_address:['Подтверждение адреса', 'справка о проживании или официальный документ'], alternative_security_work:['Справка с места работы', 'если её запросил менеджер'], alternative_security_study:['Справка с места учёбы', 'если её запросил менеджер'] }[kind] || ['Документ', '']);
  const typeChoice = kind === 'supporting' ? `<select name="supportingType" class="cabinet-document-type"><option value="">Выберите документ</option><option value="Справка с места жительства">Справка с места жительства</option><option value="Справка с места работы">Справка с места работы</option><option value="Справка с места учёбы">Справка с места учёбы</option><option value="Тундук">Документ / скрин из Тундук</option><option value="Иной официальный документ">Иной официальный документ</option></select>` : '';
  const selfie = kind === 'selfie';
  return `<div class="cabinet-file-control"><label for="document-${kind}">${title} <span>${hint}</span></label>${typeChoice}<input class="cabinet-native-file-input" id="document-${kind}" name="${kind}" type="file" accept="${selfie ? 'image/jpeg,image/png' : 'image/jpeg,image/png,application/pdf'}" ${selfie ? 'capture="user"' : ''}><div><label class="cabinet-file-choose" for="document-${kind}">${selfie ? 'Снять селфи камерой' : 'Выбрать из галереи / файлов'}</label><button class="cabinet-file-preview" type="button" data-file-preview="${kind}" disabled>Файл не выбран</button><button class="cabinet-file-remove" type="button" data-file-remove="${kind}" hidden>Удалить</button></div></div>`;
}
function videoControl(kind) {
  return `<div class="cabinet-file-control"><input class="cabinet-native-file-input" id="document-${kind}" name="${kind}" type="file" accept="video/mp4,video/quicktime,video/webm,video/*"><div><label class="cabinet-file-choose" for="document-${kind}">Снять или выбрать видео</label><button class="cabinet-file-preview" type="button" data-file-preview="${kind}" disabled>Видео не выбрано</button><button class="cabinet-file-remove" type="button" data-file-remove="${kind}" hidden>Удалить</button></div><p class="cabinet-video-hint" data-video-hint="${kind}"><strong>Для лучшего качества:</strong> сначала снимите ролик обычной камерой телефона, затем выберите его из галереи. Rentop не сжимает видео при загрузке, но встроенная камера браузера иногда показывает менее чёткий предпросмотр.</p></div>`;
}

function orderDetailsMarkup(order) {
  const baseState = statusInfo(order.status);
  const state = order.delivery_type === 'delivery' && order.status === 'awaiting_pickup'
    ? { ...baseState, title:'Ноутбук в пути', text:order.delivery_dispatch_mode === 'third_party_courier' ? 'Ноутбук передан сторонней курьерской службе. Перед отправкой с вами свяжутся для уточнения, а примерно за 10 минут до приезда предупредят. Подтвердите получение только после фактической передачи ноутбука.' : 'Ноутбук передан курьеру Rentop. Перед отправкой с вами свяжутся для уточнения, а примерно за 10 минут до приезда предупредят. Подтвердите получение только после фактической передачи ноутбука.' }
    : baseState;
  const rentalTerm = order.rental_started_at && order.rental_ends_at ? `${moment(order.rental_started_at)} — ${moment(order.rental_ends_at)} (Бишкек)` : `${date(order.rental_start_date)} — ${date(order.rental_end_date)}`;
  const laptopImage = String(order.laptop_image || '').trim();
  const visual = laptopImage ? `<img class="cabinet-rental-image" src="${escape(laptopImage)}" alt="${escape(order.laptop_title || 'Ноутбук Rentop')}">` : '<span class="cabinet-rental-image cabinet-rental-image-placeholder" aria-hidden="true">▱</span>';
  const isCompleted = order.status === 'completed';
  const journey = isCompleted ? ['Заявка', 'Оплата', 'Получение', 'Завершено'] : ['Заявка', 'Оплата', 'Подготовка', order.delivery_type === 'arca_locker' ? 'Выдача' : 'Доставка'];
  const activeJourneyStep = isCompleted ? 4 : Math.max(1, Math.min(4, state.step || 1));
  let journeyMarkup = `<div class="cabinet-stage-progress" aria-label="Текущий этап: ${escape(state.title)}">${journey.map((label, index) => { const done = isCompleted || index + 1 < activeJourneyStep; return `<div class="${done ? 'is-done' : index + 1 === activeJourneyStep ? 'is-active' : ''}"><i>${done ? '✓' : index + 1}</i><span>${label}</span></div>`; }).join('')}</div>`;
  if (isCompleted) {
    const lastPayment = order.extensionPayment?.status === 'paid' ? order.extensionPayment : order.payment?.status === 'paid' ? order.payment : null;
    const paidAmount = lastPayment ? Number(lastPayment.amount || 0).toLocaleString('ru-RU') : '';
    const feedbackActions = order.feedback
      ? '<div class="cabinet-request-state is-success">✓ Спасибо — ваш отзыв уже получен.</div>'
      : `<div class="cabinet-actions"><button class="cabinet-action" data-panel="feedback" data-order="${order.id}">Оставить отзыв</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Связаться с Rentop</button></div>`;
    const receipt = lastPayment ? `<section class="cabinet-terminal-receipt"><div><span>Последний подтверждённый платёж</span><strong>${paidAmount} сом</strong></div><button class="cabinet-action secondary" type="button" data-print-receipt="${escape(order.id)}">Квитанция PDF</button></section>` : '';
    const settlementLabels = { freeze_days:'Неиспользованные дни заморожены', partial_refund:'Согласован частичный возврат', no_compensation:'Компенсация не предоставляется' };
    const settlement = order.early_return_settlement_type ? `<section class="cabinet-pickup-flow"><strong>${escape(settlementLabels[order.early_return_settlement_type] || 'Итог возврата')}</strong><p>${order.early_return_settlement_amount != null ? `Сумма: <strong>${Number(order.early_return_settlement_amount).toLocaleString('ru-RU')} сом</strong>. ` : ''}${escape(order.early_return_settlement_note || 'Решение зафиксировано менеджером.')}</p></section>` : '';
    return `<div class="cabinet-order-workspace-head"><button class="cabinet-workspace-close" type="button" data-close-order-workspace aria-label="Вернуться к списку заявок">← <span>Все заявки</span></button><div class="cabinet-order-workspace-head-actions"><button class="cabinet-workspace-refresh" type="button" data-refresh-order-workspace="${escape(order.id)}">Обновить</button><span class="cabinet-badge">${escape(state.title)}</span><button class="cabinet-order-archive" type="button" data-archive-order="${escape(order.id)}">В архив</button></div></div><div class="cabinet-order-hero"><div class="cabinet-order-visual">${visual}</div><div><p class="cabinet-eyebrow">ЗАЯВКА ${escape(order.reference || String(order.id || '').slice(0, 8).toUpperCase())}</p><h2>${escape(order.laptop_title || 'Ноутбук Rentop')}</h2><p>Спасибо, что выбрали Rentop. Аренда и возврат завершены.</p></div></div>${journeyMarkup}<section class="cabinet-terminal-summary"><span aria-hidden="true">✓</span><div><strong>Аренда завершена</strong><p>Ноутбук принят Rentop. Все действия по заявке сохранены в истории.</p></div></section>${settlement}${receipt}<section class="cabinet-completion"><strong>Спасибо, что выбрали Rentop!</strong><p>Будем рады помочь снова. Персональный промокод на следующую аренду появится в разделе «Скидки и промокоды».</p>${feedbackActions}</section><details class="cabinet-order-history"><summary>История заявки, документы и платежи</summary><div>${documentSummary(order)}${supportUpdates(order)}${paymentPanel(order)}</div></details>${requestForm(order)}`;
  }
  const discount = rentalDiscountDetails(order);
  const groupSummary = Array.isArray(order.group_items) && order.group_items.length > 1
    ? `<section class="cabinet-order-group"><strong>В одном заказе ${order.group_items.length} ноутбука</strong>${order.group_items.map(item => `<span>${escape(item.title || 'Ноутбук')}<b>${Number(item.total_amount || 0).toLocaleString('ru-RU')} сом</b></span>`).join('')}<small>Один комплект документов и один общий QR-счёт. Выдача и возврат фиксируются отдельно по каждому устройству.</small></section>`
    : '';
  return `<div class="cabinet-order-workspace-head"><button class="cabinet-workspace-close" type="button" data-close-order-workspace aria-label="Вернуться к списку заявок">← <span>Все заявки</span></button><div class="cabinet-order-workspace-head-actions"><button class="cabinet-workspace-refresh" type="button" data-refresh-order-workspace="${escape(order.id)}">Обновить</button><span class="cabinet-badge">${escape(state.title)}</span></div></div><div class="cabinet-order-hero"><div class="cabinet-order-visual">${visual}</div><div><p class="cabinet-eyebrow">ЗАЯВКА ${escape(order.reference || String(order.id || '').slice(0, 8).toUpperCase())}</p><h2>${escape(order.laptop_title || 'Ноутбук Rentop')}</h2><p>${escape(state.text)}</p></div></div>${journeyMarkup}<section class="cabinet-order-summary"><div><span>Срок аренды</span><strong>${rentalTerm}</strong></div><div><span>Получение</span><strong>${escape(order.delivery_label)}</strong></div><div><span>Итого аренда</span><strong>${discount.pricing.finalAmount.toLocaleString('ru-RU')} сом</strong></div>${discount.card}</section>${groupSummary}${actionPanel(order)}${documentSummary(order)}${supportUpdates(order)}${pickupInstruction(order)}${paymentPanel(order)}${requestForm(order)}`;
}

function openOrderWorkspace(orderId) {
  const order = cabinetOrders.find(item => String(item.id) === String(orderId));
  if (!order || !rentalsEl) return;
  document.getElementById('cabinet-order-workspace')?.remove();
  const workspace = document.createElement('section');
  workspace.id = 'cabinet-order-workspace';
  workspace.className = 'cabinet-request-panel cabinet-workspace cabinet-order-workspace';
  workspace.dataset.orderWorkspace = String(order.id);
  workspace.innerHTML = orderDetailsMarkup(order);
  rentalsEl.append(workspace);
  setWorkspaceMode(workspace);
  updateCabinetTopik();
}

function showRentals(orders, phone, profile = null, whatsappUrl = '', smsRequired = false, promos = [], benefits = []) {
  // Rendering from a background refresh must not eject a customer from the
  // order they are currently working in. Native mobile file pickers can
  // briefly change page visibility, so this is especially important for video.
  const workspaceOrderId = activeWorkspaceOrderId();
  const pageScrollTop = window.scrollY;
  // On mobile the opened application is its own scrollable fixed panel.
  // Saving only window.scrollY always restores 0 and used to throw a reader
  // back to the top every time background sync re-rendered the workspace.
  const workspaceScrollTop = rentalsEl?.querySelector('#cabinet-order-workspace')?.scrollTop || 0;
  setWorkspaceMode();
  if (cabinetHero) cabinetHero.hidden = true;
  customerProfile = profile;
  offerSmsConsentRequired = Boolean(smsRequired);
  customerPromos = Array.isArray(promos) ? promos : [];
  customerBenefits = Array.isArray(benefits) ? benefits : [];
  cabinetOrders = Array.isArray(orders) ? orders : [];
  supportWhatsappUrl = whatsappUrl || '';
  paymentByOrder = new Map(cabinetOrders.filter(order => order.payment || order.extensionPayment).map(order => [String(order.id), order.extensionPayment || order.payment]));
  updateCabinetTopik();
  cabinetOrders.filter(order => (order.extensionPayment || order.payment)?.status === 'paid').slice(0, 1).forEach(celebrateTopikPayment);
  cabinetOrders.filter(order => order.status === 'completed').slice(0, 1).forEach(celebrateTopikCompletion);
  if (activePaymentOrderId) {
    const activePayment = paymentByOrder.get(activePaymentOrderId);
    if (!activePayment || activePayment.status !== 'awaiting_payment') {
      closePaymentDialog();
      message('Оплата подтверждена. Счёт закрыт, следующий шаг уже показан в заявке.', 'success');
    }
  }
  loading.hidden = true; login.hidden = true; dashboard.hidden = false;
  const fullName = String(profile?.full_name || '').trim();
  const hasValidProfileName = isValidFullName(fullName);
  const returningToBooking = shouldResumeBooking();
  const selectedBooking = returningToBooking ? pendingBooking() : null;
  const selectedLaptopTitle = String(selectedBooking?.laptopTitle || 'выбранному ноутбуку').trim();
  document.getElementById('cabinet-greeting').textContent = fullName ? `Здравствуйте, ${fullName.split(' ')[1] || fullName}!` : 'Здравствуйте!';
  profileEl.innerHTML = hasValidProfileName
    ? `<div class="cabinet-profile-name"><span class="cabinet-profile-avatar" aria-hidden="true">${escape(fullName.split(' ').filter(Boolean).slice(0,2).map(part => part[0]).join('').toUpperCase() || 'R')}</span><p><strong>${escape(fullName)}</strong><span>Номер подтверждён · ${escape(phone)}</span></p></div>`
    : `<form class="cabinet-profile-form" id="profile-form"><label for="profile-full-name">${returningToBooking ? `Последний шаг для ${escape(selectedLaptopTitle)}` : 'Заполните ФИО для договора'}</label><div><input id="profile-full-name" name="fullName" autocomplete="name" placeholder="Фамилия Имя Отчество" required><button class="cabinet-action" type="submit">${returningToBooking ? 'Продолжить к заявке' : 'Сохранить'}</button></div><p>${returningToBooking ? 'Номер уже подтверждён по SMS. Укажите ФИО как в документе — и сразу вернём вас к выбранному ноутбуку.' : 'Указывайте данные так же, как в документе. Номер уже подтверждён по SMS.'}</p></form>`;
  const accountParams = new URLSearchParams(window.location.search);
  const created = accountParams.get('created');
  const autoOpenDocuments = accountParams.get('open') === 'documents';
  dashboardNotice.hidden = !created;
  if (created) {
    const createdOrder = cabinetOrders.find(order => String(order.id) === String(created));
    dashboardNotice.textContent = createdOrder?.delivery_type === 'delivery'
      ? 'Заявка создана. Откройте «Загрузить документы»: там укажете адрес и удобное время доставки, затем при необходимости добавите льготу.'
      : 'Заявка создана и уже появилась в кабинете. Следующий шаг покажем здесь.';
  }
  const codeSent = cabinetOrders.find(order => order.status === 'awaiting_pickup' && order.locker_status === 'access_sent');
  if (codeSent) { dashboardNotice.hidden = false; dashboardNotice.textContent = 'Код доступа ARCHA POINT отмечен как отправленный. Откройте заявку и пройдите получение.'; }
  if (loyaltyPanelEl) loyaltyPanelEl.innerHTML = loyaltyPanel(customerPromos, customerBenefits, cabinetOrders[0]?.id || '');
  const archivedOrders = cabinetOrders.filter(order => canArchiveOrder(order) && hiddenCompletionOrders.has(String(order.id)));
  const displayedOrders = showingArchivedOrders
    ? archivedOrders
    : cabinetOrders.filter(order => !hiddenCompletionOrders.has(String(order.id)));
  if (archiveToggle) {
    archiveToggle.hidden = archivedOrders.length === 0 && !showingArchivedOrders;
    archiveToggle.textContent = showingArchivedOrders ? '← К заявкам' : `Архив (${archivedOrders.length})`;
    archiveToggle.setAttribute('aria-pressed', String(showingArchivedOrders));
  }
  rentalsEl.innerHTML = `<div class="cabinet-rentals-heading"><div><span>${showingArchivedOrders ? 'АРХИВ ЗАЯВОК' : 'МОИ ЗАЯВКИ'}</span><strong>${displayedOrders.length}</strong></div><small>${showingArchivedOrders ? 'Завершённые заявки скрыты только на этом устройстве. Их можно вернуть в общий список.' : 'Статус, оплата, доставка и возврат — откройте нужную заявку.'}</small></div>` + displayedOrders.map(order => {
    const baseState = statusInfo(order.status);
    const state = order.delivery_type === 'delivery' && order.status === 'awaiting_pickup'
      ? { ...baseState, title:'Ноутбук в пути', text:order.delivery_dispatch_mode === 'third_party_courier' ? 'Ноутбук передан сторонней курьерской службе. Перед отправкой с вами свяжутся для уточнения, а примерно за 10 минут до приезда предупредят. Подтвердите получение только после фактической передачи ноутбука.' : 'Ноутбук передан курьеру Rentop. Перед отправкой с вами свяжутся для уточнения, а примерно за 10 минут до приезда предупредят. Подтвердите получение только после фактической передачи ноутбука.' }
      : baseState;
    const rentalTerm = order.rental_started_at && order.rental_ends_at ? `${moment(order.rental_started_at)} — ${moment(order.rental_ends_at)} (Бишкек)` : `${date(order.rental_start_date)} — ${date(order.rental_end_date)}`;
    const laptopImage = String(order.laptop_image || '').trim();
    const visual = laptopImage ? `<img class="cabinet-rental-image" src="${escape(laptopImage)}" alt="${escape(order.laptop_title || 'Ноутбук Rentop')}">` : '<span class="cabinet-rental-image cabinet-rental-image-placeholder" aria-hidden="true">▱</span>';
    const journey = ['Заявка', 'Оплата', 'Подготовка', order.delivery_type === 'arca_locker' ? 'Выдача' : 'Доставка'];
    const activeJourneyStep = Math.max(1, Math.min(4, state.step || 1));
    const journeyMarkup = `<div class="cabinet-stage-progress" aria-label="Текущий этап: ${escape(state.title)}">${journey.map((label, index) => `<div class="${index + 1 < activeJourneyStep ? 'is-done' : index + 1 === activeJourneyStep ? 'is-active' : ''}"><i>${index + 1 < activeJourneyStep ? '✓' : index + 1}</i><span>${label}</span></div>`).join('')}</div>`;
    const archiveAction = canArchiveOrder(order) ? `<button class="cabinet-rental-archive" type="button" data-archive-order="${escape(order.id)}">В архив</button>` : '';
    const discount = rentalDiscountDetails(order);
    return `<article class="cabinet-rental cabinet-rental-summary" data-rental="${order.id}"><div class="cabinet-rental-top">${visual}<div class="cabinet-rental-title"><h3>${escape(order.laptop_title || 'Ноутбук Rentop')}</h3><p class="cabinet-rental-ref">Заявка ${escape(order.reference)}</p></div><div class="cabinet-rental-actions"><span class="cabinet-badge">${escape(state.title)}</span>${archiveAction}</div></div>${journeyMarkup}<p class="cabinet-next-step">${escape(state.text)}</p><div class="cabinet-rental-grid"><div>Срок<strong>${rentalTerm}</strong></div><div>Получение<strong>${escape(order.delivery_label)}</strong></div><div>Итого аренда<strong>${discount.pricing.finalAmount.toLocaleString('ru-RU')} сом</strong></div>${discount.card}</div><button class="cabinet-action cabinet-order-open" type="button" data-open-order="${escape(order.id)}">Открыть заявку <span aria-hidden="true">→</span></button></article>`;
  }).join('');
  emptyEl.hidden = displayedOrders.length !== 0;
  if (showingArchivedOrders && !displayedOrders.length) emptyEl.innerHTML = '<h3>Архив пока пуст</h3><p>Завершённую заявку можно скрыть из её экрана после окончания аренды.</p>';
  else if (!showingArchivedOrders) emptyEl.innerHTML = '<h3>Аренд пока нет</h3><p>Когда вы оформите заявку с этим номером, она появится здесь.</p><a class="cabinet-primary cabinet-link" href="/#catalog">Выбрать ноутбук</a>';
  watchOrderUpdates(cabinetOrders);
  if (workspaceOrderId && displayedOrders.some(order => String(order.id) === workspaceOrderId)) {
    openOrderWorkspace(workspaceOrderId);
    const restoredWorkspace = document.getElementById('cabinet-order-workspace');
    if (restoredWorkspace) restoredWorkspace.scrollTop = workspaceScrollTop;
  }
  else if (created && autoOpenDocuments && displayedOrders.some(order => String(order.id) === String(created))) {
    // A fresh booking must land directly on the next real task. Leaving a
    // customer on a card list caused unfinished document steps and repeats.
    openOrderWorkspace(created);
    // `created` is a one-time route instruction, not a permanent cabinet
    // state. Remove it before background refreshes so «Все заявки» remains
    // a real exit from the application workspace.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('created');
    cleanUrl.searchParams.delete('open');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    window.requestAnimationFrame(() => document.querySelector(`#cabinet-order-workspace [data-panel="documents"][data-order="${CSS.escape(String(created))}"]`)?.click());
  }
  // A live update may replace the workspace markup. Restore the exact page
  // position so a customer recording or uploading evidence is never thrown
  // back to the beginning of the application.
  window.requestAnimationFrame(() => {
    window.scrollTo({ top:pageScrollTop, behavior:'auto' });
    const restoredWorkspace = document.getElementById('cabinet-order-workspace');
    if (restoredWorkspace) restoredWorkspace.scrollTop = workspaceScrollTop;
  });
  if (returningToBooking && hasValidProfileName) {
    window.setTimeout(() => window.location.assign('/?resume_booking=1'), 120);
  }
}
function showLogin() {
  sessionViewEpoch += 1;
  if (orderPollingTimer) window.clearInterval(orderPollingTimer);
  if (paymentPollingTimer) window.clearInterval(paymentPollingTimer);
  orderPollingTimer = null; paymentPollingTimer = null;
  dashboard.hidden = true;
  if (cabinetHero) cabinetHero.hidden = false;
  loading.hidden = true;
  login.hidden = false;
  syncBookingReturnLoginCopy();
}
async function loadSession() {
  const epoch = ++sessionViewEpoch;
  // The account and the login screen must never be visible together.
  dashboard.hidden = true;
  login.hidden = true;
  loading.hidden = false;
  try {
    // Do not leave the person under a permanent "checking" indicator. Two
    // short attempts cover a cold start, then the visible login screen gives
    // a clear retry path instead of looking like an unexplained logout.
    let data;
    try {
      data = await request('GET', undefined, 8000);
    } catch (firstError) {
      await new Promise(resolve => window.setTimeout(resolve, 350));
      data = await request('GET', undefined, 8000);
    }
    if (epoch !== sessionViewEpoch) return;
    data = await stabilizeAccountSnapshot(data);
    if (data.authenticated) { showRentals(data.orders || [], data.phone, data.profile, data.whatsappUrl, data.offerSmsConsentRequired, data.promos, data.benefits); return; }
    showLogin();
  } catch (error) {
    if (epoch !== sessionViewEpoch) return;
    showLogin();
    // Preserve the actionable server reason. A generic "fast load" message
    // made real account/data errors impossible to diagnose on one device.
    message(error?.message || 'Не удалось загрузить кабинет. Проверьте интернет и попробуйте ещё раз.', 'error');
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
      showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
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
document.getElementById('cabinet-session-retry')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Проверяем сессию…';
  await loadSession();
  button.disabled = false;
  button.textContent = original;
});

phoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = formatPhone(phoneInput.value); if (!phone) return message('Введите номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = phoneForm.querySelector('button'); button.disabled = true; message('Отправляем код…'); try { await request('POST', { action:'request_code', phone }); pendingPhone = phone; phoneForm.hidden = true; codeForm.hidden = false; codeInput.focus(); message('Код отправлен. Введите 6 цифр из сообщения.', 'success'); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
codeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = codeInput.value.replace(/\D/g, ''); if (code.length !== 6) return message('Введите все 6 цифр кода.', 'error'); const button = codeForm.querySelector('button'); button.disabled = true; message('Проверяем код…'); try { const remember = document.getElementById('cabinet-remember')?.checked !== false; let data = await request('POST', { action:'verify_code', phone:pendingPhone, code, remember }); data = await stabilizeAccountSnapshot(data); sessionViewEpoch += 1; showRentals(data.orders || [], data.phone, data.profile, data.whatsappUrl, data.offerSmsConsentRequired, data.promos, data.benefits); message(''); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('change-phone')?.addEventListener('click', () => { codeForm.hidden = true; phoneForm.hidden = false; codeInput.value = ''; message(''); phoneInput.focus(); });
document.getElementById('cabinet-logout')?.addEventListener('click', async () => { await request('POST', { action:'logout' }).catch(() => {}); showLogin(); phoneForm.hidden = false; codeForm.hidden = true; phoneInput.value = ''; codeInput.value = ''; pendingPhone = ''; message('Вы вышли из кабинета.'); });
document.addEventListener('click', event => {
  const openOrder = event.target.closest('[data-open-order]');
  if (openOrder) {
    openOrderWorkspace(openOrder.dataset.openOrder);
    return;
  }
  const closeOrderWorkspace = event.target.closest('[data-close-order-workspace]');
  if (closeOrderWorkspace) {
    const workspace = closeOrderWorkspace.closest('#cabinet-order-workspace');
    if (hasUnsavedDocumentDraft() && !window.confirm('Выбранные фото, видео и заполненные данные будут удалены. Вернуться к списку заявок?')) return;
    workspace?.remove();
    setWorkspaceMode();
    updateCabinetTopik();
    return;
  }
  const closeCompletion = event.target.closest('[data-close-completion]');
  if (closeCompletion) {
    hiddenCompletionOrders.add(String(closeCompletion.dataset.closeCompletion));
    persistHiddenCompletions();
    closeCompletion.closest('.cabinet-completion')?.setAttribute('hidden', '');
    return;
  }
  const archiveOrder = event.target.closest('[data-archive-order]');
  if (archiveOrder) {
    const order = cabinetOrders.find(item => String(item.id) === String(archiveOrder.dataset.archiveOrder));
    if (!canArchiveOrder(order)) return;
    hiddenCompletionOrders.add(String(order.id));
    persistHiddenCompletions();
    document.getElementById('cabinet-order-workspace')?.remove();
    setWorkspaceMode();
    showRentals(cabinetOrders, '', customerProfile, supportWhatsappUrl, offerSmsConsentRequired, customerPromos, customerBenefits);
    message('Заявка перемещена в архив на этом устройстве.', 'success');
    return;
  }
  const paymentButton = event.target.closest('[data-open-payment]');
  if (paymentButton) {
    openPaymentDialog(paymentByOrder.get(String(paymentButton.dataset.openPayment)));
    watchPayment(paymentButton.dataset.openPayment);
    return;
  }
  const receiptButton = event.target.closest('[data-print-receipt]');
  if (receiptButton) {
    openReceiptPrintWindow(cabinetOrders.find(order => String(order.id) === String(receiptButton.dataset.printReceipt)));
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
    const offerSms = requestOfferSms.closest('.cabinet-offer-sms');
    const status = offerSms?.querySelector('[data-offer-sms-status]');
    const originalText = requestOfferSms.textContent;
    requestOfferSms.disabled = true;
    requestOfferSms.textContent = 'Отправляем код…';
    if (status) status.textContent = 'Отправляем SMS на подтверждённый номер…';
    request('POST', { action:'accept_offer', orderId:requestOfferSms.dataset.requestOfferSms })
      .then(() => request('POST', { action:'request_offer_sms_consent', orderId:requestOfferSms.dataset.requestOfferSms }))
      .then(() => {
        const verify = requestOfferSms.closest('.cabinet-offer-flow')?.querySelector('[data-offer-sms-verify]');
        if (verify) verify.hidden = false;
        if (status) status.textContent = 'SMS отправлено. Введите код из сообщения.';
        let secondsLeft = 60;
        requestOfferSms.textContent = `Повторить через ${secondsLeft} сек.`;
        const retryTimer = window.setInterval(() => {
          secondsLeft -= 1;
          if (secondsLeft > 0) {
            requestOfferSms.textContent = `Повторить через ${secondsLeft} сек.`;
            return;
          }
          window.clearInterval(retryTimer);
          requestOfferSms.disabled = false;
          requestOfferSms.textContent = 'Отправить код повторно';
        }, 1000);
        message('Код согласия отправлен.', 'success');
      })
      .catch(error => { requestOfferSms.disabled = false; requestOfferSms.textContent = originalText || 'Отправить код повторно'; if (status) status.textContent = `Не удалось отправить код: ${error.message}`; message(error.message, 'error'); });
    return;
  }
  const verifyOfferSms = event.target.closest('[data-verify-offer-sms]');
  if (verifyOfferSms) {
    const code = verifyOfferSms.closest('.cabinet-offer-flow')?.querySelector('[data-offer-sms-verify] input')?.value?.replace(/\D/g, '');
    if (!/^\d{6}$/.test(code || '')) return message('Введите 6 цифр из сообщения.', 'error');
    const originalText = verifyOfferSms.textContent;
    const status = verifyOfferSms.closest('.cabinet-offer-sms')?.querySelector('[data-offer-sms-status]');
    verifyOfferSms.disabled = true;
    verifyOfferSms.textContent = 'Проверяем код…';
    if (status) status.textContent = 'Проверяем код…';
    request('POST', { action:'verify_offer_sms_consent', orderId:verifyOfferSms.dataset.verifyOfferSms, code })
      .then(() => {
        // Do not redraw the whole rental card here. Browsers deliberately do
        // not allow restoring selected Files after a redraw, which used to
        // make passport photos disappear right after the OTP was accepted.
        const form = verifyOfferSms.closest('form');
        if (form) form.dataset.offerSmsVerified = '1';
        const box = verifyOfferSms.closest('.cabinet-offer-sms');
        if (box) box.innerHTML = '<p class="cabinet-offer-confirmed">✓ Оферта подтверждена по SMS. Выбранные документы остались в форме — теперь отправьте их на проверку.</p>';
        message('Согласие с офертой подтверждено и зафиксировано.', 'success');
      })
      .catch(error => { verifyOfferSms.disabled = false; verifyOfferSms.textContent = originalText || 'Подтвердить код'; if (status) status.textContent = error.message.includes('истёк') ? 'Срок действия кода закончился. Нажмите «Отправить код повторно».' : error.message; message(error.message, 'error'); });
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
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); deleteSavedDocument.disabled = false; });
    return;
  }
  const savedDocument = event.target.closest('[data-document-view]');
  if (savedDocument) {
    openDocumentViewer(savedDocument.dataset.documentView, savedDocument.dataset.documentName, savedDocument.dataset.documentType);
    return;
  }
  const documentToOpen = event.target.closest('[data-document-open]');
  if (documentToOpen) {
    documentToOpen.disabled = true;
    const initialText = documentToOpen.textContent;
    documentToOpen.textContent = 'Открываем…';
    request('POST', { action:'create_document_download', orderId:documentToOpen.dataset.documentOrder, documentId:documentToOpen.dataset.documentOpen })
      .then(result => openDocumentViewer(result.url, documentToOpen.dataset.documentName, documentToOpen.dataset.documentType))
      .catch(error => message(error.message, 'error'))
      .finally(() => { documentToOpen.disabled = false; documentToOpen.textContent = initialText; });
    return;
  }
  const replacementOffer = event.target.closest('[data-accept-prepayment-offer], [data-decline-prepayment-offer]');
  if (replacementOffer) {
    const accepting = Boolean(replacementOffer.dataset.acceptPrepaymentOffer);
    if (!window.confirm(accepting ? 'Подтвердить замену модели? Сумма аренды будет пересчитана автоматически.' : 'Отклонить это предложение? Текущая заявка сохранится, а другую модель можно выбрать самостоятельно.')) return;
    const originalText = replacementOffer.textContent;
    replacementOffer.disabled = true;
    replacementOffer.textContent = accepting ? 'Проверяем модель…' : 'Сохраняем решение…';
    const orderId = replacementOffer.dataset.acceptPrepaymentOffer || replacementOffer.dataset.declinePrepaymentOffer;
    request('POST', { action:accepting ? 'accept_prepayment_replacement_offer' : 'decline_prepayment_replacement_offer', orderId })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); replacementOffer.disabled = false; replacementOffer.textContent = originalText; });
    return;
  }
  const pickupConfirm = event.target.closest('[data-confirm-pickup]');
  if (pickupConfirm) {
    const pickupOrder = cabinetOrders.find(order => String(order.id) === String(pickupConfirm.dataset.confirmPickup));
    const confirmationText = pickupOrder?.delivery_type === 'delivery'
      ? 'Подтвердите только после того, как курьер фактически передал вам ноутбук, а вы проверили комплектность.'
      : 'Подтвердите только после того, как вы забрали ноутбук из ячейки и проверили комплектность.';
    if (!window.confirm(confirmationText)) return;
    const originalText = pickupConfirm.textContent;
    pickupConfirm.disabled = true;
    pickupConfirm.textContent = 'Подтверждаем получение…';
    request('POST', { action:'confirm_pickup', orderId:pickupConfirm.dataset.confirmPickup })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); pickupConfirm.disabled = false; pickupConfirm.textContent = originalText; });
    return;
  }
  const pickupAccessReceived = event.target.closest('[data-pickup-access-received]');
  if (pickupAccessReceived) {
    if (!window.confirm('Нажимайте только если ARCHA POINT действительно прислал SMS с кодом выдачи. После этого откроется загрузка видео получения.')) return;
    const originalText = pickupAccessReceived.textContent;
    pickupAccessReceived.disabled = true;
    pickupAccessReceived.textContent = 'Открываем загрузку видео…';
    request('POST', { action:'confirm_pickup_access_received', orderId:pickupAccessReceived.dataset.pickupAccessReceived })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); pickupAccessReceived.disabled = false; pickupAccessReceived.textContent = originalText; });
    return;
  }
  const returnDropoffConfirm = event.target.closest('[data-confirm-return-dropoff]');
  if (returnDropoffConfirm) {
    if (!window.confirm('Подтвердите только после того, как ноутбук, зарядка и комплект действительно помещены в ячейку ARCHA POINT и ячейка закрылась.')) return;
    const originalText = returnDropoffConfirm.textContent;
    returnDropoffConfirm.disabled = true;
    returnDropoffConfirm.textContent = 'Подтверждаем возврат…';
    request('POST', { action:'confirm_return_dropoff', orderId:returnDropoffConfirm.dataset.confirmReturnDropoff })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); returnDropoffConfirm.disabled = false; returnDropoffConfirm.textContent = originalText; });
    return;
  }
  const returnAccessReceived = event.target.closest('[data-return-access-received]');
  if (returnAccessReceived) {
    if (!window.confirm('Нажимайте только если ARCHA POINT действительно прислал SMS с кодом возврата. После этого откроется загрузка видео.')) return;
    const originalText = returnAccessReceived.textContent;
    returnAccessReceived.disabled = true;
    returnAccessReceived.textContent = 'Открываем загрузку видео…';
    request('POST', { action:'confirm_return_access_received', orderId:returnAccessReceived.dataset.returnAccessReceived })
      .then(async result => { message(result.message, 'success'); const fresh = await request('GET'); if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits); })
      .catch(error => { message(error.message, 'error'); returnAccessReceived.disabled = false; returnAccessReceived.textContent = originalText; });
    return;
  }
  const changeReturnMethod = event.target.closest('[data-change-return-method]');
  if (changeReturnMethod) {
    if (!window.confirm('Изменить способ возврата? Предыдущие инструкции будут отменены. Нажимайте, только пока ноутбук ещё не передан курьеру или Rentop.')) return;
    const originalText = changeReturnMethod.textContent;
    changeReturnMethod.disabled = true;
    changeReturnMethod.textContent = 'Открываем выбор…';
    request('POST', { action:'change_return_method', orderId:changeReturnMethod.dataset.changeReturnMethod })
      .then(async result => {
        message(result.message, 'success');
        const fresh = await request('GET');
        if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
      })
      .catch(error => { message(error.message, 'error'); changeReturnMethod.disabled = false; changeReturnMethod.textContent = originalText; });
    return;
  }
  const refreshWorkspace = event.target.closest('[data-refresh-order-workspace]');
  if (refreshWorkspace) {
    const originalText = refreshWorkspace.textContent;
    refreshWorkspace.disabled = true;
    refreshWorkspace.textContent = 'Обновляем…';
    request('GET')
      .then(fresh => {
        if (!fresh.authenticated) throw new Error('Сессия истекла. Войдите в личный кабинет снова.');
        showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
        message('Статус заявки обновлён.', 'success');
      })
      .catch(error => { message(error.message, 'error'); refreshWorkspace.disabled = false; refreshWorkspace.textContent = originalText; });
    return;
  }
  const button = event.target.closest('[data-panel]');
  if (button) {
    const panel = document.getElementById(`panel-${button.dataset.order}`);
    if (!panel) return;
    if (!panel.hidden && hasUnsavedDocumentDraft()) {
      // A second tap on "Documents" or a tap on support must not silently
      // close the document form and discard local files.
      message('Черновик документов открыт. Сначала загрузите его или нажмите «Отмена», если действительно хотите удалить выбранные файлы.', 'error');
      return;
    }
    if (!panel.hidden) {
      // The model picker is the only compact chooser that is intentionally
      // toggleable: a second tap returns to the application immediately.
      if (button.dataset.panel === 'prepayment-replacement') {
        panel.hidden = true;
        panel.innerHTML = '';
        panel.classList.remove('is-document-result');
        setWorkspaceMode(null);
        return;
      }
      // A form can already be open below the fold (for example after a
      // delivery-status update). A repeated tap must take the customer to it,
      // not look like a broken button.
      window.requestAnimationFrame(() => panel.scrollIntoView({ behavior:'smooth', block:'start' }));
      return;
    }
    button.disabled = true;
    button.textContent = 'Открываем…';
    panel.hidden = false;
    panel.classList.toggle('is-document-result', button.dataset.panel === 'documents' && ['submitted', 'approved'].includes(button.dataset.documentMode || ''));
    const sourceOrder = cabinetOrders.find(order => String(order.id) === String(button.dataset.order));
    panel.innerHTML = button.dataset.panel === 'prepayment-replacement'
      ? `<button class="cabinet-workspace-close" type="button" data-close-workspace aria-label="Закрыть выбор модели">× <span>К заявке</span></button><div class="cabinet-loading"><span></span>Проверяем свободные модели…</div>`
      : `<button class="cabinet-workspace-close" type="button" data-close-workspace aria-label="Закрыть форму">× <span>К заявке</span></button>${panelMarkup(button.dataset.panel, button.dataset.order, { mode:button.dataset.documentMode, kinds:button.dataset.documentKinds, requestId:button.dataset.requestId, days:button.dataset.extensionDays, offerSmsVerified:Boolean(sourceOrder?.offer_otp_verified_at), benefitRequested:sourceOrder?.benefit_requested_type || '', deliveryType:sourceOrder?.delivery_type || '', deliveryAddress:sourceOrder?.delivery_address || '', deliveryPreferredTime:sourceOrder?.delivery_preferred_time || '', lockerAddress:sourceOrder?.locker_address || '', address:sourceOrder?.return_collection_address || sourceOrder?.residence_address || '', name:sourceOrder?.return_contact_name || sourceOrder?.customer_name || '', phone:sourceOrder?.return_contact_phone || sourceOrder?.customer_phone || '' })}`;
    if (button.dataset.panel === 'prepayment-replacement') {
      request('POST', { action:'prepayment_replacement_options', orderId:button.dataset.order })
        .then((result) => {
          panel.innerHTML = `<button class="cabinet-workspace-close" type="button" data-close-workspace aria-label="Закрыть форму">× <span>К заявке</span></button>${prepaymentReplacementChoicesMarkup(button.dataset.order, result.alternatives || [])}`;
        })
        .catch((error) => {
          panel.innerHTML = `<button class="cabinet-workspace-close" type="button" data-close-workspace aria-label="Закрыть форму">× <span>К заявке</span></button><div class="cabinet-request-state is-error"><strong>Модель пока нельзя заменить</strong><p>${escape(error.message)}</p></div>`;
        });
    }
    setWorkspaceMode(panel.hidden ? null : panel);
    // Action forms are rendered after the order details. On a phone they can
    // open below the viewport, which looks like a failed tap, so always show
    // the newly opened step immediately (documents, videos, return and help).
    window.requestAnimationFrame(() => panel.scrollIntoView({ behavior:'smooth', block:'start' }));
    // Do not autofocus here: iOS Safari can scroll and zoom the page when a
    // workspace opens even though the customer only tapped a button.
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
    if (hasUnsavedDocumentDraft() && !window.confirm('Выбранные фото, видео и заполненные данные будут удалены. Закрыть форму?')) return;
    panel.hidden = true; panel.innerHTML = ''; setWorkspaceMode(panel.closest('#cabinet-order-workspace'));
    return;
  }
  if (event.target.closest('[data-close-workspace]')) {
    const panel = event.target.closest('.cabinet-request-panel');
    if (hasUnsavedDocumentDraft() && !window.confirm('Выбранные фото, видео и заполненные данные будут удалены. Закрыть форму?')) return;
    panel.hidden = true; panel.innerHTML = ''; setWorkspaceMode(panel.closest('#cabinet-order-workspace'));
  }
});
document.getElementById('cabinet-document-viewer-close')?.addEventListener('click', closeDocumentViewer);
documentViewer?.addEventListener('click', event => { if (event.target === documentViewer) closeDocumentViewer(); });
document.getElementById('cabinet-payment-dialog-close')?.addEventListener('click', closePaymentDialog);
paymentDialog?.addEventListener('click', event => { if (event.target === paymentDialog) closePaymentDialog(); });
document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!documentViewer?.hidden) closeDocumentViewer(); if (!paymentDialog?.hidden) closePaymentDialog(); });
window.addEventListener('beforeunload', event => {
  if (!hasUnsavedDocumentDraft()) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('visibilitychange', () => {
  // Mobile browsers can throttle timers in the background. As soon as the
  // customer returns to the cabinet, fetch the current status immediately.
  if (document.visibilityState === 'visible' && !dashboard.hidden) refreshAccountIfSafe();
});
document.addEventListener('change', event => {
  const benefitType = event.target.closest('select[data-benefit-type]');
  if (benefitType) {
    const proof = benefitType.closest('form')?.querySelector('[data-benefit-proof]');
    if (proof) proof.hidden = !benefitType.value;
    return;
  }
  const returnMethod = event.target.closest('select[name="returnMethod"]');
  if (returnMethod) {
    const locker = returnMethod.closest('form')?.querySelector('.cabinet-return-locker');
    if (locker) locker.hidden = !['arca_locker','arca_courier'].includes(returnMethod.value);
    const form = returnMethod.closest('form');
    const collection = form?.querySelector('.cabinet-return-collection');
    if (collection) collection.hidden = returnMethod.value !== 'rentop_courier';
    const contact = form?.querySelector('.cabinet-return-contact');
    if (contact) contact.hidden = !['rentop_courier','customer_courier','arca_courier'].includes(returnMethod.value);
    const customerCourier = form?.querySelector('.cabinet-return-customer-courier');
    if (customerCourier) customerCourier.hidden = returnMethod.value !== 'arca_courier';
    const rentopCourierNotice = form?.querySelector('.cabinet-return-rentop-notice');
    if (rentopCourierNotice) rentopCourierNotice.hidden = returnMethod.value !== 'rentop_courier';
    const customerCourierNotice = form?.querySelector('.cabinet-return-customer-notice');
    if (customerCourierNotice) customerCourierNotice.hidden = returnMethod.value !== 'customer_courier';
    const deliveryConfirmation = form?.querySelector('.cabinet-return-delivery-confirmation');
    if (deliveryConfirmation) {
      const needsConfirmation = returnMethod.value === 'customer_courier';
      deliveryConfirmation.hidden = !needsConfirmation;
      const confirmationInput = deliveryConfirmation.querySelector('input[name="returnDeliveryConfirmed"]');
      if (confirmationInput) { confirmationInput.required = needsConfirmation; if (!needsConfirmation) confirmationInput.checked = false; }
    }
    const self = returnMethod.closest('form')?.querySelector('.cabinet-return-self');
    if (self) self.hidden = returnMethod.value !== 'self_delivery';
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
document.addEventListener('click', event => {
  const targetButton = event.target.closest('[data-form-error-target]');
  if (!targetButton) return;
  event.preventDefault();
  focusDocumentFormTarget(targetButton.closest('[data-document-upload]'), targetButton.dataset.formErrorTarget);
});
function clearDocumentFormError(form, field) {
  if (!form || !field) return;
  field.removeAttribute('aria-invalid');
  field.classList.remove('is-invalid');
  // Any corrected field is a new attempt. Do not leave a scary stale upload
  // error on screen while the customer has already changed the file or input.
  form.querySelector('.cabinet-form-error')?.remove();
}
document.addEventListener('input', event => {
  const field = event.target;
  clearDocumentFormError(field.closest?.('[data-document-upload]'), field);
});
document.addEventListener('change', event => {
  clearDocumentFormError(event.target.closest?.('[data-document-upload]'), event.target);
  const picker = event.target.closest('[data-delivery-type]');
  if (!picker) return;
  const section = picker.closest('.cabinet-delivery-choice');
  if (!section) return;
  const selectedType = picker.value === 'arca_locker' ? 'arca_locker' : 'delivery';
  section.querySelectorAll('[data-delivery-fields]').forEach(group => {
    const active = group.dataset.deliveryFields === selectedType;
    group.hidden = !active;
    group.querySelectorAll('input, textarea, select').forEach(field => {
      field.disabled = !active;
      field.required = active;
    });
  });
});
document.addEventListener('submit', async event => {
  const documentForm = event.target.closest('[data-document-upload]');
  if (documentForm) {
    event.preventDefault();
    const button = documentForm.querySelector('[type="submit"]');
    const requiredKinds = String(documentForm.dataset.requiredKinds || '').split(',').filter(Boolean);
    const files = ['identity_front', 'identity_back', 'selfie', 'supporting', 'benefit_proof', 'issue_video', 'return_video', 'alternative_security_video', 'alternative_security_address', 'alternative_security_work', 'alternative_security_study'].map(kind => ({ kind, file:documentForm.elements[kind]?.files?.[0] })).filter(item => item.file);
    const isReplacement = documentForm.dataset.documentReplacement === '1';
    const isEvidence = documentForm.dataset.evidenceUpload === 'true';
    const isAlternativeSecurity = documentForm.dataset.alternativeSecurityUpload === 'true';
    const formError = (text, fieldNames = []) => {
      documentForm.querySelectorAll('[aria-invalid="true"]').forEach(field => { field.removeAttribute('aria-invalid'); field.classList.remove('is-invalid'); });
      const output = documentForm.querySelector('.cabinet-form-error') || document.createElement('p');
      const targets = (Array.isArray(fieldNames) ? fieldNames : [fieldNames]).filter(Boolean);
      output.className = 'cabinet-form-error';
      output.innerHTML = `<span>${escape(text)}</span>${targets.length ? `<span class="cabinet-form-error-actions">${targets.map(name => `<button type="button" data-form-error-target="${escape(name)}">Перейти: ${escape(FORM_TARGET_LABELS[name] || 'к полю')}</button>`).join('')}</span>` : ''}`;
      if (!output.parentElement) documentForm.append(output);
      const field = targets[0] ? documentForm.elements[targets[0]] : null;
      if (field) { field.setAttribute('aria-invalid', 'true'); field.classList.add('is-invalid'); }
      output.scrollIntoView({ behavior:'auto', block:'nearest' });
    };
    const titles = { identity_front:'лицевую сторону паспорта / ID', identity_back:'обратную сторону паспорта / ID', selfie:'селфи с документом', supporting:'официальное подтверждение', benefit_proof:'подтверждение льготы', issue_video:'видео получения', return_video:'видео возврата', ...ALTERNATIVE_SECURITY_LABELS };
    const missingKinds = requiredKinds.filter(kind => !files.some(item => item.kind === kind));
    if (missingKinds.length) return formError(`Выберите: ${missingKinds.map(kind => titles[kind] || kind).join(', ')}. Нажмите нужную кнопку ниже — покажем место загрузки.`, missingKinds);
    if (!isEvidence && !isAlternativeSecurity && !documentForm.elements.documentConsent?.checked) return formError('Отметьте согласие на передачу документов Rentop.', 'documentConsent');
    if (!isEvidence && !isReplacement && !documentForm.elements.offerConsent?.checked) return formError('Отметьте согласие с публичной офертой.', 'offerConsent');
    if (!isEvidence && !isReplacement && offerSmsConsentRequired && documentForm.dataset.offerSmsVerified !== '1') return formError('Подтвердите оферту кодом из SMS — нажмите «Получить код согласия» и введите 6 цифр.', 'offerSms');
    const supporting = files.find(item => item.kind === 'supporting');
    if (supporting && !documentForm.elements.supportingType?.value) return formError('Выберите тип официального подтверждающего документа.', 'supportingType');
    const benefitProof = files.find(item => item.kind === 'benefit_proof');
    if (!isEvidence && !isReplacement && documentForm.elements.benefitType?.value && !benefitProof) return formError('Для социальной скидки приложите подтверждающий документ или выберите «Не использовать социальную скидку».', 'benefit_proof');
    const deliveryAddress = String(documentForm.elements.deliveryAddress?.value || '').trim();
    const deliveryPreferredTime = String(documentForm.elements.deliveryPreferredTime?.value || '').trim();
    const lockerAddress = String(documentForm.elements.lockerAddress?.value || '').trim();
    const deliveryType = documentForm.elements.deliveryType?.value === 'arca_locker' ? 'arca_locker' : 'delivery';
    if (!isEvidence && !isReplacement && deliveryType === 'delivery' && deliveryAddress.length < 8) return formError('Укажите полный адрес доставки: город, улицу и номер дома.', 'deliveryAddress');
    if (!isEvidence && !isReplacement && deliveryType === 'delivery' && deliveryPreferredTime.length < 3) return formError('Укажите удобное время доставки.', 'deliveryPreferredTime');
    if (!isEvidence && !isReplacement && deliveryType === 'arca_locker' && lockerAddress.length < 8) return formError('Выберите точку ARCHA POINT.', 'lockerAddress');
    const residenceAddress = String(documentForm.elements.residenceAddress?.value || '').trim();
    if (!isEvidence && !isReplacement && (residenceAddress.length < 15 || !/\d/.test(residenceAddress))) return formError('Укажите полный адрес проживания: город, район, улицу, номер дома и квартиру.', 'residenceAddress');
    const fullName = String(documentForm.elements.fullName?.value || '').trim();
    if (!isEvidence && !isReplacement && !isValidFullName(customerProfile?.full_name) && !isValidFullName(fullName)) return formError('Укажите фамилию, имя и отчество — как в документе.', 'fullName');
    const operationCity = String(documentForm.elements.operationCity?.value || '').trim();
    const emergencyContactName = String(documentForm.elements.emergencyContactName?.value || '').trim();
    const emergencyContactRelationship = String(documentForm.elements.emergencyContactRelationship?.value || '').trim();
    const emergencyContactPhone = String(documentForm.elements.emergencyContactPhone?.value || '').trim();
    if (isAlternativeSecurity && operationCity.length < 2) return formError('Укажите город, где будет использоваться ноутбук.', 'operationCity');
    if (isAlternativeSecurity && emergencyContactName.length < 3) return formError('Укажите ФИО близкого родственника для экстренной связи.', 'emergencyContactName');
    if (isAlternativeSecurity && !emergencyContactRelationship) return formError('Выберите родство контакта.', 'emergencyContactRelationship');
    if (isAlternativeSecurity && emergencyContactPhone.replace(/\D/g, '').length < 10) return formError('Укажите корректный номер близкого родственника.', 'emergencyContactPhone');
    if (isAlternativeSecurity && !documentForm.elements.emergencyContactConsent?.checked) return formError('Подтвердите согласие близкого родственника на передачу контакта.', 'emergencyContactConsent');
    const unsupported = files.find(({ file }) => !['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime'].includes(contentTypeForFile(file)));
    if (unsupported) return formError(`Файл «${unsupported.file.name}» имеет неподдерживаемый формат. Нужен JPG, PNG или PDF.`);
    button.disabled = true;
    button.textContent = 'Подготавливаем загрузку…';
    try {
      if (!isEvidence && !isReplacement && !isValidFullName(customerProfile?.full_name)) {
        const saved = await request('POST', { action:'save_profile', fullName });
        customerProfile = saved.profile || { full_name:fullName };
      }
      if (!isEvidence && !isReplacement && documentForm.elements.deliveryType) await request('POST', { action:'save_delivery_preferences', orderId:documentForm.dataset.order, deliveryType, deliveryAddress, deliveryPreferredTime, lockerAddress });
      if (!isEvidence && !isReplacement) await request('POST', { action:'save_residence_address', orderId:documentForm.dataset.order, residenceAddress, supportingDocumentType:documentForm.elements.supportingType?.value || '' });
      const orderComment = String(documentForm.elements.orderComment?.value || '').trim();
      if (!isEvidence && orderComment.length >= 3) await request('POST', { action:'save_order_comment', orderId:documentForm.dataset.order, message:orderComment });
      if (!isEvidence && !isReplacement) await request('POST', { action:'accept_offer', orderId:documentForm.dataset.order });
      if (isAlternativeSecurity) await request('POST', { action:'save_alternative_security_contact', orderId:documentForm.dataset.order, operationCity, name:emergencyContactName, relationship:emergencyContactRelationship, phone:emergencyContactPhone, contactConsent:true });
      let completedUploads = 0;
      const totalUploadBytes = files.reduce((sum, item) => sum + Number(item.file?.size || 0), 0);
      const uploadedBytes = new Map();
      const showUploadProgress = () => {
        const current = [...uploadedBytes.values()].reduce((sum, value) => sum + value, 0);
        const percent = totalUploadBytes ? Math.min(99, Math.round((current / totalUploadBytes) * 100)) : 0;
        button.textContent = `Загружаем файлы: ${percent}% · готово ${completedUploads}/${files.length}`;
      };
      const uploadOne = async ({ kind, file }) => {
        const input = documentForm.elements[kind];
        if (['issue_video', 'return_video', 'alternative_security_video'].includes(kind) && input?.dataset.videoTooLong === '1') throw new Error('Снимите видео короче 30 секунд и выберите его заново.');
        const selectedType = kind === 'supporting' ? documentForm.elements.supportingType.value : '';
        const fileName = selectedType ? `${selectedType} — ${file.name}` : file.name;
        const contentType = contentTypeForFile(file);
        const isVideo = ['video/mp4', 'video/quicktime'].includes(contentType);
        if (file.size > (isVideo ? 50 : 8) * 1024 * 1024) throw new Error(`${isVideo ? 'Видео' : 'Фото или документ'} «${file.name}» больше ${isVideo ? 50 : 8} МБ. Уменьшите размер и выберите файл заново.`);
        const ticket = await request('POST', { action:'create_document_upload', orderId:documentForm.dataset.order, kind, fileName, contentType, byteSize:file.size });
        try {
          await uploadDocumentFile(ticket.uploadUrl, ticket.token, contentType, file, (loaded) => {
            uploadedBytes.set(kind, loaded);
            showUploadProgress();
          });
        } catch (firstError) {
          button.textContent = `Повторяем загрузку файлов (${completedUploads}/${files.length})…`;
          await uploadDocumentFile(ticket.uploadUrl, ticket.token, contentType, file, (loaded) => {
            uploadedBytes.set(kind, loaded);
            showUploadProgress();
          });
        }
        uploadedBytes.set(kind, file.size);
        showUploadProgress();
        const registerPayload = { action:'register_document', orderId:documentForm.dataset.order, kind, path:ticket.path, fileName, contentType, byteSize:file.size, benefitType:documentForm.elements.benefitType?.value || documentForm.dataset.benefitType || '' };
        try {
          await request('POST', registerPayload);
        } catch (error) {
          // Retry once with the same storage path. The API treats an exact
          // retry as success, so an interrupted response cannot duplicate or
          // lose a document that has already reached the protected storage.
          button.textContent = `Проверяем сохранение файлов (${completedUploads}/${files.length})…`;
          await request('POST', registerPayload);
        }
        completedUploads += 1;
        button.textContent = completedUploads === files.length ? 'Файлы сохранены. Открываем заявку…' : `Загружено ${completedUploads}/${files.length}…`;
      };
      // Two parallel files shorten a five-document mobile upload without a
      // burst of five signed-storage operations at once.
      for (let index = 0; index < files.length; index += 2) await Promise.all(files.slice(index, index + 2).map(uploadOne));
      const successText = documentForm.dataset.requiredKinds === 'benefit_proof' ? 'Льготный документ отправлен. Ожидайте проверки менеджером.' : isAlternativeSecurity ? 'Дополнительная проверка отправлена. Менеджер примет решение по залогу.' : isEvidence ? 'Видео загружено. Выполните следующий шаг в заявке.' : 'Документы отправлены. Заявка передана менеджеру на проверку.';
      const order = cabinetOrders.find(item => String(item.id) === String(documentForm.dataset.order));
      if (order && isEvidence) {
        // The upload is already registered safely. Mirror it locally before
        // the background read completes, so the next action is immediately
        // clear even on a slow mobile connection.
        order.documents = [...(order.documents || []).filter(document => document.kind !== files[0]?.kind), ...files.map(({ kind, file }) => ({ kind, file_name:file.name, status:'pending_review' }))];
      }
      if (order && !isEvidence && !isReplacement && !isAlternativeSecurity) {
        order.status = 'pending_review';
        order.documents = [...(order.documents || []), ...files.map(({ kind, file }) => ({ kind, file_name:file.name, status:'pending_review' }))];
      }
      // Do not make the customer wait for a full history refresh after the
      // final file is safely registered. Refresh in the background instead.
      showRentals(cabinetOrders, order?.customer_phone || '', customerProfile, supportWhatsappUrl, offerSmsConsentRequired, customerPromos, customerBenefits);
      message(successText, 'success');
      if (!isEvidence && !isReplacement) {
        // Documents are safely registered. Take the customer to the updated
        // application summary instead of leaving them below a now-closed form.
        window.requestAnimationFrame(() => document.getElementById('cabinet-order-workspace')?.scrollIntoView({ behavior:'smooth', block:'start' }));
      }
      request('GET').then(fresh => {
        if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
      }).catch(() => {});
    } catch (error) {
      const output = documentForm.querySelector('.cabinet-form-error') || document.createElement('p');
      output.className = 'cabinet-form-error'; output.textContent = error.message; documentForm.append(output);
      button.disabled = false; button.textContent = isEvidence ? 'Отправить видео' : 'Загрузить документы';
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
    const result = await request('POST', { action:form.dataset.request, orderId:form.dataset.order, requestId:data.get('requestId'), days:data.get('days'), replacementLaptopId:data.get('replacementLaptopId'), deliveryType:data.get('deliveryType'), deliveryAddress:data.get('deliveryAddress'), deliveryPreferredTime:data.get('deliveryPreferredTime'), lockerAddress:data.get('lockerAddress'), kind:data.get('kind'), message:data.get('message'), returnMethod:data.get('returnMethod'), returnLockerAddress:data.get('returnLockerAddress'), returnCollectionAddress:data.get('returnCollectionAddress'), returnContactName:data.get('returnContactName'), returnContactPhone:data.get('returnContactPhone'), returnPreferredTime:data.get('returnPreferredTime') || data.get('returnPreferredTimeSelf'), returnDeliveryConfirmed:data.get('returnDeliveryConfirmed') === 'on', rating:data.get('rating'), review:data.get('review'), suggestion:data.get('suggestion') });
    message(result.message || 'Запрос отправлен.', 'success');
    if (result.request) {
      const order = cabinetOrders.find(item => String(item.id) === String(form.dataset.order));
      if (order) order.requests = [result.request, ...(order.requests || []).filter(item => item.id !== result.request.id)];
      showRentals(cabinetOrders, '', customerProfile, supportWhatsappUrl, offerSmsConsentRequired, customerPromos, customerBenefits);
    }
    request('GET').then(fresh => {
      if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
    }).catch(() => {});
  } catch (error) {
    if (form.dataset.request === 'extension_request' && error.data?.code === 'LAPTOP_UNAVAILABLE') {
      form.outerHTML = replacementChoicesMarkup(form.dataset.order, error.data.days || data.get('days'), error.data.alternatives || []);
      return;
    }
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
    if (shouldResumeBooking()) {
      button.textContent = 'Возвращаемся к заявке…';
      window.location.assign('/?resume_booking=1');
      return;
    }
    const fresh = await request('GET');
    if (fresh.authenticated) {
      showRentals(fresh.orders || [], fresh.phone, fresh.profile, fresh.whatsappUrl, fresh.offerSmsConsentRequired, fresh.promos, fresh.benefits);
    }
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
archiveToggle?.addEventListener('click', () => {
  showingArchivedOrders = !showingArchivedOrders;
  document.getElementById('cabinet-order-workspace')?.remove();
  setWorkspaceMode();
  showRentals(cabinetOrders, '', customerProfile, supportWhatsappUrl, offerSmsConsentRequired, customerPromos, customerBenefits);
});
cabinetTopikToggle?.addEventListener('click', () => {
  if (cabinetTopikToggle.dataset.dragged === '1') { cabinetTopikToggle.dataset.dragged = ''; return; }
  const opening = cabinetTopikPanel?.hidden !== false;
  updateCabinetTopik();
  setCabinetTopikOpen(opening);
  setCabinetTopikMood('happy', 1300);
});
cabinetCelebrationClose?.addEventListener('click', closeCabinetCelebration);
cabinetCelebrationContinue?.addEventListener('click', closeCabinetCelebration);
cabinetCelebration?.addEventListener('click', event => { if (event.target === cabinetCelebration) closeCabinetCelebration(); });
cabinetTopikClose?.addEventListener('click', () => setCabinetTopikOpen(false));
if (localStorage.getItem(HIDDEN_CABINET_TOPIK_KEY) === '1') setCabinetTopikHidden(true);
cabinetTopikHide?.addEventListener('click', () => setCabinetTopikHidden(true));
cabinetTopikRestore?.addEventListener('click', () => {
  setCabinetTopikHidden(false);
  updateCabinetTopik();
  setCabinetTopikOpen(true);
});
let cabinetTopikDrag = null;
function setCabinetTopikPosition(left, top, persist = false) {
  if (!cabinetTopik) return;
  const width = cabinetTopik.offsetWidth || 84;
  const height = cabinetTopik.offsetHeight || 84;
  const nextLeft = Math.max(8, Math.min(window.innerWidth - width - 8, left));
  const nextTop = Math.max(70, Math.min(window.innerHeight - height - 8, top));
  cabinetTopik.style.left = `${Math.round(nextLeft)}px`;
  cabinetTopik.style.top = `${Math.round(nextTop)}px`;
  cabinetTopik.style.right = 'auto';
  cabinetTopik.style.bottom = 'auto';
  if (persist) {
    try { localStorage.setItem(CABINET_TOPIK_POSITION_KEY, JSON.stringify({ left:nextLeft, top:nextTop })); } catch { /* Position remains usable for this visit. */ }
  }
}
try {
  const savedTopikPosition = JSON.parse(localStorage.getItem(CABINET_TOPIK_POSITION_KEY) || 'null');
  if (Number.isFinite(savedTopikPosition?.left) && Number.isFinite(savedTopikPosition?.top)) setCabinetTopikPosition(savedTopikPosition.left, savedTopikPosition.top);
} catch { localStorage.removeItem(CABINET_TOPIK_POSITION_KEY); }
cabinetTopikToggle?.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !cabinetTopik) return;
  const rect = cabinetTopik.getBoundingClientRect();
  cabinetTopikDrag = { pointerId:event.pointerId, startX:event.clientX, startY:event.clientY, left:rect.left, top:rect.top, moved:false };
  try { cabinetTopik.setPointerCapture(event.pointerId); } catch { /* Window events finish dragging if capture is rejected. */ }
});
const moveCabinetTopik = event => {
  if (!cabinetTopikDrag || event.pointerId !== cabinetTopikDrag.pointerId) return;
  const dx = event.clientX - cabinetTopikDrag.startX;
  const dy = event.clientY - cabinetTopikDrag.startY;
  if (Math.abs(dx) + Math.abs(dy) < 4) return;
  // A drag belongs to Topik, not the document behind it. This prevents the
  // vertical gesture from becoming Safari's pull-to-refresh gesture.
  event.preventDefault();
  cabinetTopikDrag.moved = true;
  setCabinetTopikOpen(false);
  setCabinetTopikPosition(cabinetTopikDrag.left + dx, cabinetTopikDrag.top + dy, true);
};
window.addEventListener('pointermove', moveCabinetTopik, { passive:false });
const endCabinetTopikDrag = event => {
  if (!cabinetTopikDrag || event.pointerId !== cabinetTopikDrag.pointerId) return;
  if (cabinetTopikDrag.moved && cabinetTopikToggle) cabinetTopikToggle.dataset.dragged = '1';
  if (cabinetTopik?.hasPointerCapture(event.pointerId)) cabinetTopik.releasePointerCapture(event.pointerId);
  cabinetTopikDrag = null;
};
cabinetTopik?.addEventListener('pointerup', endCabinetTopikDrag);
cabinetTopik?.addEventListener('pointercancel', endCabinetTopikDrag);
window.addEventListener('pointerup', endCabinetTopikDrag);
window.addEventListener('pointercancel', endCabinetTopikDrag);
cabinetTopikOpenOrder?.addEventListener('click', () => {
  const orderId = cabinetTopikOpenOrder.dataset.orderId;
  if (!orderId) return;
  openOrderWorkspace(orderId);
  document.getElementById('cabinet-order-workspace')?.scrollIntoView({ behavior:'smooth', block:'start' });
  updateCabinetTopik();
});
cabinetTopikSupport?.addEventListener('click', () => {
  const orderId = cabinetTopikSupport.dataset.orderId;
  if (!orderId) return;
  openOrderWorkspace(orderId);
  window.requestAnimationFrame(() => {
    const supportButton = [...document.querySelectorAll('#cabinet-order-workspace [data-panel="support"]')]
      .find((button) => button.dataset.order === orderId);
    supportButton?.click();
  });
});
bindPhoneMask(phoneInput);
loadSession();
