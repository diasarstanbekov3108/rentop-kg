const gate = document.getElementById('manager-gate');
const dashboard = document.getElementById('manager-dashboard');
const ordersEl = document.getElementById('manager-orders');
const statsEl = document.getElementById('manager-stats');
const statusEl = document.getElementById('manager-status');
const searchInput = document.getElementById('manager-search');
const documentViewer = document.getElementById('manager-document-viewer');
const documentViewerContent = document.getElementById('manager-document-viewer-content');
const managerPhoneForm = document.getElementById('manager-phone-form');
const managerCodeForm = document.getElementById('manager-code-form');
const managerPhoneInput = document.getElementById('manager-phone');
const managerCodeInput = document.getElementById('manager-code');
const managerLoginStatus = document.getElementById('manager-login-status');
const clearTestsButton = document.getElementById('manager-clear-tests');
const testBakaiButton = document.getElementById('manager-test-bakai');
const testTelegramButton = document.getElementById('manager-test-telegram');
const bakaiCheck = document.getElementById('manager-bakai-check');
const returnAlert = document.getElementById('manager-return-alert');
const catalogOpenButton = document.getElementById('manager-catalog-open');
const sidebarCatalogButton = document.getElementById('manager-sidebar-catalog');
const catalogPanel = document.getElementById('manager-catalog-panel');
const catalogCloseButton = document.getElementById('manager-catalog-close');
const catalogForm = document.getElementById('manager-catalog-form');
const catalogList = document.getElementById('manager-catalog-list');
const catalogResetButton = document.getElementById('manager-catalog-reset');
const promoPanel = document.getElementById('manager-promo-panel');
const promoOpenButton = document.querySelector('[data-open-promos]');
const promoCloseButton = document.getElementById('manager-promo-close');
const promoForm = document.getElementById('manager-promo-form');
const promoList = document.getElementById('manager-promo-list');
const b2bPanel = document.getElementById('manager-b2b-panel');
const b2bOpenButton = document.querySelector('[data-open-b2b]');
const b2bCloseButton = document.getElementById('manager-b2b-close');
const helpPanel = document.getElementById('manager-help-panel');
const helpOpenButton = document.querySelector('[data-open-help]');
const helpCloseButton = document.getElementById('manager-help-close');
const mobileNavToggle = document.getElementById('manager-mobile-nav-toggle');
const mobileNavClose = document.getElementById('manager-mobile-nav-close');
const mobileNavBackdrop = document.getElementById('manager-mobile-nav-backdrop');
const managerSidebar = document.getElementById('manager-sidebar');
const replacementPicker = document.getElementById('manager-replacement-picker');
const replacementPickerSearch = document.getElementById('manager-replacement-picker-search');
const replacementPickerFilters = document.getElementById('manager-replacement-picker-filters');
const replacementPickerFilterSelect = document.getElementById('manager-replacement-picker-filter-select');
const replacementPickerList = document.getElementById('manager-replacement-picker-list');
const replacementPickerConfirm = document.getElementById('manager-replacement-picker-confirm');
const b2bList = document.getElementById('manager-b2b-list');
const refreshButton = document.getElementById('manager-refresh');
let orders = [];
let rentableLaptops = [];
let catalogLaptops = [];
let managerPromos = [];
let b2bLeads = [];
// The queue opens on work that still needs attention. Historical orders stay
// available through “Все”, “Завершённые аренды” and “Отменённые”.
let filter = 'new';
let pendingManagerPhone = '';
let isChiefAdmin = false;
let mobileNavScrollY = 0;
let mobileOrderScrollY = 0;
let activeLoad = null;
const transientOrderMessages = new Map();
let openOrderDetails = new Set();
let selectedOrderId = '';
const paymentDrafts = new Map();
const replacementSelections = new Map();
let replacementPickerState = { orderId:'', filter:'all', query:'', selectedId:'' };

const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const date = value => value ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const calendarDate = value => value ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric' }).format(new Date(String(value).includes('T') ? value : `${value}T00:00:00Z`)) : '—';
const statusLabel = status => ({ draft:'Черновик — ждём документы', pending_review:'Проверка документов', awaiting_payment:'Ожидает оплаты', payment_review:'Проверка оплаты', reserved:'Забронировано · ждём доплату', confirmed:'Оплата подтверждена', awaiting_archa_reservation:'Резервируем ячейку', awaiting_locker_loading:'Ожидает закладки', awaiting_pickup:'Готово к получению', issued:'Ожидаем подтверждение', in_use:'Активна', return_requested:'Возврат', awaiting_return_reservation:'Резервируем возврат', awaiting_return_dropoff:'Ожидаем возврат в ячейку', awaiting_return_collection:'Ожидаем физический возврат', returned:'Проверка возврата', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена', incident:'Инцидент — требуется решение' }[status] || status || 'Новая');
// A draft remains visually new until a manager starts processing it. Time
// must not silently make an unhandled customer request look less important.
const isFreshOrder = order => order?.status === 'pending_review';
const docLabel = kind => ({ identity:'Документ', identity_front:'Документ — лицевая сторона', identity_back:'Документ — обратная сторона', selfie:'Селфи', supporting:'Подтверждение', issue_video:'Видео до получения', return_video:'Видео возврата', benefit_proof:'Льготный документ' }[kind] || 'Документ');
const benefitLabel = kind => ({ student:'Студент', pensioner:'Пенсионер', disability:'Инвалидность / ОВЗ' }[kind] || kind);
const deliveryLabel = order => order.delivery_type === 'arca_locker' ? 'ARCHA POINT 24/7' : order.delivery_type === 'delivery' ? 'Доставка курьером' : order.delivery_type === 'pickup' ? 'Архивный способ получения' : 'Уточняется';
const nextAction = order => {
  if (order.status === 'pending_review') return { next:'awaiting_payment', label:'Подтвердить сверку и перейти к выставлению оплаты' };
  return null;
};

function isCompactManagerViewport() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function setMobileOrderView(open) {
  if (!isCompactManagerViewport() && open) return;
  const body = document.body;
  if (open) {
    if (body.classList.contains('manager-mobile-order-open')) return;
    mobileOrderScrollY = window.scrollY || window.pageYOffset || 0;
    body.classList.add('manager-mobile-order-open');
    body.style.position = 'fixed';
    body.style.top = `-${mobileOrderScrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return;
  }
  if (!body.classList.contains('manager-mobile-order-open')) return;
  body.classList.remove('manager-mobile-order-open');
  body.style.position = '';
  body.style.top = '';
  body.style.width = '';
  body.style.overflow = '';
  window.scrollTo({ top:mobileOrderScrollY, behavior:'auto' });
}

window.addEventListener('resize', () => {
  if (!isCompactManagerViewport()) setMobileOrderView(false);
}, { passive:true });

function closeDocumentViewer() { if (!documentViewer) return; documentViewer.hidden = true; if (documentViewerContent) documentViewerContent.innerHTML = ''; document.body.style.overflow = ''; }
function openDocumentViewer(url, name = 'Документ', contentType = '') { if (!documentViewer || !documentViewerContent || !url) return; const isPdf = contentType === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(name); const isVideo = contentType.startsWith('video/') || /\.(?:mp4|mov)(?:[?#]|$)/i.test(name); documentViewerContent.innerHTML = isVideo ? `<video controls preload="metadata" src="${escape(url)}">Ваш браузер не поддерживает просмотр видео.</video>` : isPdf ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>` : `<img src="${escape(url)}" alt="${escape(name)}">`; documentViewer.hidden = false; document.body.style.overflow = 'hidden'; }
async function api(method = 'GET', payload, include = '') {
  // A CDN or a just-woken function can very occasionally return a successful
  // response before the full dashboard payload is ready. Never treat that as
  // a real empty queue: make one fresh request before changing the screen.
  const attempts = method === 'GET' ? 2 : 1;
  let incompleteResponse = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const extra = include ? `&include=${encodeURIComponent(include)}` : '';
    const url = method === 'GET' ? `/api/manager?refresh=${Date.now()}&snapshot=${attempt + 1}${extra}` : '/api/manager';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18_000);
    try {
      const response = await fetch(url, { method, credentials:'same-origin', cache:'no-store', signal:controller.signal, headers:payload ? { 'content-type':'application/json' } : {}, body:payload ? JSON.stringify(payload) : undefined });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(data?.error || 'Не удалось загрузить панель.');
        error.status = response.status;
        throw error;
      }
      if (method !== 'GET' || Array.isArray(data?.orders)) return data;
      incompleteResponse = true;
      if (attempt + 1 < attempts) await new Promise(resolve => window.setTimeout(resolve, 350));
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Панель не ответила за 18 секунд. Очередь сохранена на экране — повторите обновление позже.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  if (incompleteResponse) throw new Error('Сервер вернул ответ без очереди дважды. Ничего не удалено — попробуйте ещё раз через несколько секунд.');
  throw new Error('Не удалось загрузить панель.');
}
async function accountApi(payload) { const response = await fetch('/api/account', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Не удалось выполнить вход.'); return data; }
async function catalogApi(method = 'GET', payload) {
  const response = await fetch(method === 'GET' ? `/api/manager?catalog=1&refresh=${Date.now()}` : '/api/manager', {
    method, credentials:'same-origin', cache:'no-store', headers:payload ? { 'content-type':'application/json' } : {}, body:payload ? JSON.stringify(payload) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось обновить каталог.');
  return data;
}
function phoneDigits(value) { let digits = String(value || '').replace(/\D/g, ''); if (digits.startsWith('996')) digits = digits.slice(3); if (digits.startsWith('0')) digits = digits.slice(1); return digits.slice(0, 9); }
function normalizePhone(value) { const digits = phoneDigits(value); return digits.length === 9 ? `+996${digits}` : ''; }
function formatPhone(value) { const digits = phoneDigits(value); return `+996${digits ? ` (${digits.slice(0, 3)}${digits.length > 3 ? ')' : ''}${digits.length > 3 ? ` ${digits.slice(3, 5)}` : ''}${digits.length > 5 ? `-${digits.slice(5, 7)}` : ''}${digits.length > 7 ? `-${digits.slice(7, 9)}` : ''}` : ' '}`; }
function loginMessage(text = '', type = '') { if (!managerLoginStatus) return; managerLoginStatus.textContent = text; managerLoginStatus.className = `cabinet-status${type ? ` is-${type}` : ''}`; }
function bakaiMessage(text = '', type = '') { if (!bakaiCheck) return; bakaiCheck.textContent = text; bakaiCheck.className = `manager-bakai-check${type ? ` is-${type}` : ''}`; bakaiCheck.hidden = !text; }

const b2bStatusLabel = status => ({ new:'Новая', contacted:'Связались', proposal_sent:'Предложение отправлено', contract:'Договор / подготовка', closed:'Сделка завершена', lost:'Не состоялась' }[status] || status);
const b2bProfileLabel = profile => ({ office:'Офис и обучение', development:'Разработка', design:'Дизайн / монтаж', mixed:'Разные задачи', other:'Нужна консультация' }[profile] || '—');
function renderB2BManager() {
  if (!b2bList) return;
  if (!b2bLeads.length) { b2bList.innerHTML = '<p class="manager-empty">Корпоративных заявок пока нет.</p>'; return; }
  b2bList.innerHTML = b2bLeads.map(lead => `<article class="manager-b2b-lead"><div class="manager-b2b-top"><div><span>${escape(b2bStatusLabel(lead.status))}</span><h3>${escape(lead.company_name)}</h3><p>${escape(lead.contact_name)} · <a href="https://wa.me/${escape(String(lead.phone || '').replace(/\D/g, ''))}" target="_blank" rel="noopener">${escape(lead.phone)}</a>${lead.email ? ` · ${escape(lead.email)}` : ''}</p></div><strong>${Number(lead.quantity || 0)} шт.</strong></div><div class="manager-b2b-meta"><span>Срок: ${lead.term_months ? `${Number(lead.term_months)} мес.` : 'обсудить'}</span><span>Задачи: ${escape(b2bProfileLabel(lead.device_profile))}</span><span>Получение: ${lead.delivery_preference === 'delivery' ? 'доставка в офис' : lead.delivery_preference === 'pickup' ? 'самовывоз / выдача' : 'обсудить'}</span></div>${lead.comment ? `<p class="manager-b2b-comment">${escape(lead.comment)}</p>` : ''}<label>Статус<select data-b2b-status="${escape(lead.id)}">${['new','contacted','proposal_sent','contract','closed','lost'].map(status => `<option value="${status}" ${lead.status === status ? 'selected' : ''}>${escape(b2bStatusLabel(status))}</option>`).join('')}</select></label><label>Заметка менеджера<textarea data-b2b-note="${escape(lead.id)}" maxlength="2000" placeholder="Цена, наличие, договорённости, дата передачи">${escape(lead.manager_note || '')}</textarea></label><button class="secondary" type="button" data-save-b2b="${escape(lead.id)}">Сохранить B2B-заявку</button><small>Поступила ${escape(date(lead.created_at))}</small></article>`).join('');
}

function catalogField(laptop, ...keys) { for (const key of keys) if (laptop?.[key] !== undefined && laptop?.[key] !== null) return laptop[key]; return ''; }
function catalogPrice(laptop) { return catalogField(laptop, 'price_text', 'priceText') || (laptop.category === 'rent' ? `От ${Number(catalogField(laptop, 'daily_rate', 'dailyRate') || 0).toLocaleString('ru-RU')} сом / день` : 'Цена уточняется'); }
function resetCatalogForm() {
  if (!catalogForm) return;
  catalogForm.reset();
  catalogForm.elements.laptopId.value = '';
  catalogForm.elements.category.value = 'rent';
  catalogForm.elements.badge.value = 'АРЕНДА';
  catalogForm.elements.isVisible.checked = true;
  catalogForm.elements.sortOrder.value = '0';
}
function renderCatalogManager() {
  if (!catalogList) return;
  if (!catalogLaptops.length) { catalogList.innerHTML = '<p class="manager-empty">В каталоге пока нет моделей.</p>'; return; }
  catalogList.innerHTML = catalogLaptops.map(laptop => {
    const visible = laptop.is_visible !== false;
    const image = catalogField(laptop, 'image_url', 'image') || '/assets/catalog-placeholder.svg';
    return `<article class="manager-catalog-item ${visible ? '' : 'is-hidden'}"><img src="${escape(image)}" alt="${escape(laptop.title || 'Ноутбук')}"><div><span>${escape(laptop.category === 'sale' ? 'ПРОДАЖА' : 'АРЕНДА')} · ${visible ? 'видна на сайте' : 'скрыта'}</span><h3>${escape(laptop.title || 'Без названия')}</h3><p>${escape(catalogPrice(laptop))} · ${escape(catalogField(laptop, 'cpu') || '—')} · ${escape(catalogField(laptop, 'ram') || '—')}</p></div><div class="manager-catalog-item-actions"><button type="button" class="secondary" data-catalog-edit="${escape(laptop.id)}">Изменить</button><button type="button" class="${visible ? 'danger' : 'secondary'}" data-catalog-visibility="${escape(laptop.id)}" data-visible="${visible ? '0' : '1'}">${visible ? 'Скрыть' : 'Показать'}</button></div></article>`;
  }).join('');
}
async function loadCatalogManager() {
  const data = await catalogApi();
  catalogLaptops = data.catalog || [];
  renderCatalogManager();
}
function editCatalogLaptop(id) {
  const laptop = catalogLaptops.find(item => String(item.id) === String(id));
  if (!laptop || !catalogForm) return;
  catalogForm.elements.laptopId.value = laptop.id;
  catalogForm.elements.title.value = laptop.title || '';
  catalogForm.elements.category.value = laptop.category || 'rent';
  catalogForm.elements.badge.value = laptop.badge || (laptop.category === 'sale' ? 'ПРОДАЖА' : 'АРЕНДА');
  catalogForm.elements.cpu.value = laptop.cpu || '';
  catalogForm.elements.ram.value = laptop.ram || '';
  catalogForm.elements.storage.value = laptop.storage || '';
  catalogForm.elements.dailyRate.value = catalogField(laptop, 'daily_rate', 'dailyRate') || '';
  catalogForm.elements.priceText.value = catalogField(laptop, 'price_text', 'priceText') || '';
  catalogForm.elements.sortOrder.value = laptop.sort_order || 0;
  catalogForm.elements.description.value = laptop.description || '';
  catalogForm.elements.useCases.value = laptop.use_cases || '';
  catalogForm.elements.isVisible.checked = laptop.is_visible !== false;
  catalogForm.scrollIntoView({ behavior:'smooth', block:'start' });
}

function promoState(promo) {
  if (promo.status === 'redeemed') return 'использован';
  if (promo.status === 'revoked') return 'отозван';
  if (promo.status === 'expired' || new Date(promo.expires_at).getTime() <= Date.now()) return 'истёк';
  return 'активен';
}
function renderPromoManager() {
  if (!promoList) return;
  if (!managerPromos.length) { promoList.innerHTML = '<p class="manager-empty">Пока нет выданных промокодов.</p>'; return; }
  promoList.innerHTML = managerPromos.map(promo => {
    const usable = promo.status === 'issued' && new Date(promo.expires_at).getTime() > Date.now();
    return `<article class="manager-promo-item"><div><strong>${escape(promo.code)}</strong><p>−${Number(promo.discount_percent || 0)}% · ${escape(promo.recipient_phone || 'номер не указан')} · <small>${escape(promoState(promo))}</small></p><p>Выдан ${date(promo.created_at)} · действует до ${date(promo.expires_at)}${promo.redeemed_at ? ` · использован ${date(promo.redeemed_at)}` : ''}</p></div>${usable ? `<button type="button" data-revoke-promo="${escape(promo.id)}">Отозвать</button>` : ''}</article>`;
  }).join('');
}

function visibleOrders() {
  const query = String(searchInput?.value || '').trim().toLowerCase();
  const filtered = orders.filter(order => {
    if (query && !`${order.id} ${order.customer_name} ${order.customer_phone} ${order.laptop_title}`.toLowerCase().includes(query)) return false;
    if (filter === 'new') return ['pending_review','awaiting_payment','payment_review','reserved','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status);
    if (filter === 'drafts') return order.status === 'draft';
    if (filter === 'documents') return order.documents.some(document => document.status === 'pending_review');
    if (filter === 'loyalty') return order.status === 'completed' || order.documents.some(document => document.kind === 'benefit_proof' && document.status === 'pending_review') || order.benefits?.some(benefit => benefit.status === 'pending_review');
    if (filter === 'active') return ['in_use','incident'].includes(order.status);
    if (filter === 'returns') return ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status);
    if (filter === 'completed') return order.status === 'completed';
    if (filter === 'closed') return ['cancelled','rejected'].includes(order.status);
    return true;
  });
  const priority = (order) => {
    if (['pending_review','awaiting_payment','payment_review','reserved','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status)) return 0;
    if (order.status === 'draft') return 3;
    if (['in_use','incident','return_requested','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status)) return 1;
    if (order.status === 'completed') return 2;
    if (['cancelled','rejected'].includes(order.status)) return 3;
    return 1;
  };
  return filtered.sort((a, b) => priority(a) - priority(b) || new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function documentCard(document, orderId) {
  const documentType = document.kind === 'supporting' && document.file_name ? ` · ${escape(document.file_name)}` : '';
  const reviewNote = document.reviewer_note ? ` · ${escape(document.reviewer_note)}` : '';
  const acceptLabel = document.kind === 'benefit_proof' ? 'Подтвердить льготу — 10%' : 'Принять';
  return `<div class="manager-doc"><span>${docLabel(document.kind)}${documentType} · ${document.status === 'pending_review' ? 'на проверке' : document.status}${reviewNote}</span><button class="manager-doc-view" type="button" data-document-view="${document.id}" data-order="${escape(orderId)}" data-document-name="${escape(document.file_name || docLabel(document.kind))}" data-document-type="${escape(document.content_type || '')}">Открыть</button>${document.status === 'pending_review' ? `<button class="accept" data-document="${document.id}" data-status="accepted">${acceptLabel}</button><button class="reject" data-document="${document.id}" data-status="rejected">Отклонить</button>` : ''}</div>`;
}
function lockerInstruction(order) {
  if (order.delivery_type !== 'arca_locker') return '';
  const location = order.locker_address || 'локация не выбрана';
  return `<section class="manager-section manager-locker-instruction"><h3>Инструкция выдачи через ARCHA POINT</h3><p><strong>Точка клиента:</strong> ${escape(location)}</p><ol><li>После статуса «Оплата подтверждена» проверьте ноутбук, зарядку и комплектность.</li><li>Передайте ARCHA POINT только ФИО, телефон, модель, даты и выбранную точку — документы клиента не передаются.</li><li>Дождитесь номера ячейки и PIN/QR от ARCHA POINT. До этого не обещайте клиенту немедленную выдачу.</li><li>Только после подготовки ячейки переведите заявку в «Готовится к выдаче» и отправьте клиенту инструкцию.</li></ol></section>`;
}
function archaControls(order) {
  const isArchaIssue = order.delivery_type === 'arca_locker';
  const isArchaReturn = ['arca_locker','arca_courier'].includes(order.return_method);
  if (isArchaIssue && order.status === 'confirmed') return `<button class="secondary" data-prepare-archa="${order.id}">Подготовить сообщение для ARCHA POINT</button>`;
  if (isArchaIssue && order.status === 'awaiting_archa_reservation') return `<div class="manager-payment-create"><label>Код закладки ARCHA POINT<input data-archa-loading-code type="text" maxlength="200" placeholder="Код для менеджера"></label><label>Номер ячейки / комментарий<input data-archa-reference type="text" maxlength="200" placeholder="Необязательно"></label><button class="secondary" data-record-archa-reservation="${order.id}">Сохранить резерв ячейки</button></div>`;
  if (isArchaIssue && order.status === 'awaiting_locker_loading') return `<button class="secondary" data-mark-locker-loaded="${order.id}">Ноутбук помещён в ячейку</button>`;
  if (isArchaIssue && order.status === 'awaiting_pickup') return order.locker_status === 'access_sent'
    ? `<div class="manager-request">✓ Клиент сам подтвердил в кабинете получение SMS-кода ARCHA POINT. Теперь он проходит видео и подтверждение получения.</div><div class="manager-actions"><button class="secondary" data-manual-pickup-code="${order.id}">Повторно отправить код вручную</button></div>`
    : `<div class="manager-request">Ноутбук помещён в ячейку. ARCHA POINT отправляет код напрямую клиенту; в кабинете клиента уже есть самостоятельная кнопка «Код из SMS получен». Менеджер не подтверждает получение SMS за клиента.</div><div class="manager-actions"><button class="secondary" data-manual-pickup-code="${order.id}">Отправить код вручную при сбое</button></div>`;
  if (isArchaReturn && order.status === 'awaiting_return_reservation') return order.returnHandoffPrepared
    ? `<div class="manager-request">Текст для ARCHA POINT подготовлен. Отправьте его в рабочую группу и дождитесь кода возврата. ${order.return_method === 'arca_courier' ? 'После согласования номера курьера отправьте код только этому курьеру: он не должен отображаться клиенту.' : 'Если их SMS не пришло, получите подтверждённый код у ARCHA POINT и отправьте его клиенту через защищённый резервный путь Rentop.'}</div><div class="manager-actions"><button class="secondary" data-prepare-archa-return="${order.id}">Показать и скопировать сообщение</button><button class="secondary" data-manual-return-code="${order.id}">${order.return_method === 'arca_courier' ? 'Отправить код назначенному курьеру' : 'Отправить резервный код возврата'}</button></div>`
    : `<div class="manager-actions"><button class="secondary" data-prepare-archa-return="${order.id}">Подготовить сообщение о возврате</button></div>`;
  if (isArchaReturn && order.status === 'awaiting_return_dropoff') {
    const videoUploaded = order.documents?.some(document => document.kind === 'return_video' && document.status !== 'rejected');
    if (order.return_method === 'arca_courier') return `<div class="manager-request">Код возврата направлен назначенному курьеру. ${videoUploaded ? 'Видео возврата загружено. После подтверждения курьера, что ноутбук помещён в ячейку, отметьте это ниже; итоговую проверку проведите после получения техники.' : 'Ожидаем видео состояния от клиента; физический возврат ещё не произошёл.'}</div><div class="manager-actions"><button class="secondary" data-confirm-courier-return-dropoff="${order.id}" ${videoUploaded ? '' : 'disabled'}>Курьер подтвердил помещение в ячейку</button></div>`;
    return `<div class="manager-request">${order.locker_status === 'return_access_received' ? 'Клиент подтвердил получение SMS-кода.' : 'Код возврата отмечен как отправленный.'} Ожидаем, пока клиент прикрепит видео, поместит ноутбук в ячейку и сам подтвердит закрытие. После этого заявка перейдёт в «Проверка возврата».</div>`;
  }
  if (order.status === 'awaiting_return_collection') { const videoAccepted = order.documents?.some(document => document.kind === 'return_video' && document.status === 'accepted'); const needsDestination = ['customer_courier','self_delivery'].includes(order.return_method); const destinationReady = !needsDestination || String(order.return_destination_address || '').trim().length >= 8; const method = ({ rentop_courier:'Курьер Rentop — платно', customer_courier:'Курьерская служба клиента — платно', self_delivery:'Самопривоз по согласованию' })[order.return_method] || '—'; const details = order.return_method === 'rentop_courier' ? `Адрес забора: ${escape(order.return_collection_address || '—')}<br>Контакт: ${escape(order.return_contact_name || '—')} · ${escape(order.return_contact_phone || '—')}<br>Время: ${escape(order.return_preferred_time || 'по согласованию')}` : `Контакт: ${escape(order.return_contact_name || '—')} · ${escape(order.return_contact_phone || '—')}<br>Время: ${escape(order.return_preferred_time || 'по согласованию')}`; const destinationForm = needsDestination ? `<div class="manager-handoff-destination"><label>Адрес приёма для клиента</label><textarea data-return-destination-address maxlength="500" placeholder="Адрес Rentop или согласованной точки приёма">${escape(order.return_destination_address || '')}</textarea><label>Инструкции (необязательно)</label><textarea data-return-destination-note maxlength="1000" placeholder="Контакт, ориентир, согласованное время">${escape(order.return_destination_note || '')}</textarea><button class="secondary" data-save-return-handoff="${order.id}">Сообщить адрес клиенту</button></div>` : ''; const readiness = !destinationReady ? 'Сначала сообщите клиенту адрес приёма.' : videoAccepted ? 'Видео принято. После фактической передачи нажмите кнопку ниже.' : 'Сначала откройте и примите видео возврата — кнопка физической приёмки недоступна.'; return `<div class="manager-request"><strong>Возврат вне постамата</strong><br>Способ: ${escape(method)}.<br>${details}<br><br>${needsDestination ? (order.return_destination_address ? `Адрес приёма сообщён: ${escape(order.return_destination_address)}` : 'Сначала укажите и сообщите клиенту адрес приёма.') : 'Согласуйте стоимость и время выезда курьера Rentop.'}<br><br>${readiness}</div>${destinationForm}<div class="manager-actions"><button class="secondary" data-confirm-return-collected="${order.id}" ${videoAccepted && destinationReady ? '' : 'disabled'}>Ноутбук получен физически</button></div>`; }
  return '';
}
function deliveryControls(order) {
  if (order.delivery_type !== 'delivery') return '';
  if (order.status === 'confirmed') return `<section class="manager-section manager-locker-instruction"><h3>Доставка клиенту</h3><p><strong>Адрес:</strong> ${escape(order.delivery_address || 'не указан')}<br><strong>Желаемое время:</strong> ${escape(order.delivery_preferred_time || 'не указано')}<br><strong>Контакт:</strong> ${escape(order.delivery_contact_name || order.customer_name || '—')} · ${escape(order.delivery_contact_phone || order.customer_phone || '—')}</p><p>Перед отправкой подтвердите с клиентом детали. Курьер или менеджер звонит для уточнения, а примерно за 10 минут до приезда предупреждает клиента.</p><label>Способ доставки<select data-delivery-dispatch-mode><option value="rentop_courier">Курьер Rentop</option><option value="third_party_courier">Сторонний курьер (Яндекс и др.)</option></select></label><div class="manager-actions"><button class="secondary" data-mark-delivery-dispatched="${order.id}">Ноутбук в пути к клиенту</button></div><div class="manager-request manager-delivery-message"><strong>Сообщение клиенту о доставке</strong><p>Оно появится прямо в личном кабинете клиента в переписке по заявке.</p><textarea data-delivery-client-message maxlength="1500" placeholder="Например: Сегодня доставка Rentop недоступна — свободных окон нет. Можем отправить сторонним курьером. Напишите, пожалуйста, удобно ли вам."></textarea><div class="manager-actions"><button class="secondary" data-send-delivery-message="${order.id}">Отправить клиенту</button></div></div></section>`;
  if (order.status === 'awaiting_pickup' && order.locker_status === 'delivery_dispatched') { const courier = order.delivery_dispatch_mode === 'third_party_courier' ? 'Ноутбук передан сторонней курьерской службе.' : 'Ноутбук передан курьеру Rentop.'; return `<div class="manager-request"><strong>Ноутбук в пути</strong><br>${courier}<br>Перед отправкой клиенту звонят для уточнения, а примерно за 10 минут до приезда предупреждают о прибытии.<br>После физической передачи клиент снимет видео и нажмёт «Ноутбук получил(а) — начать аренду». До его подтверждения срок аренды не начинается.</div>`; }
  return '';
}

function archaIssueHandoffPanel(order) {
  const preparedReturnText = transientOrderMessages.get(order.id);
  if (order.status === 'awaiting_return_reservation' && preparedReturnText) return `<section class="manager-section manager-handoff-primary"><h3>Сообщение о возврате для ARCHA POINT</h3><p>Это только подготовленный текст: отправьте его в рабочую группу вручную. Сайт не может подтвердить, что сообщение доставлено ARCHA POINT.</p><textarea class="manager-handoff-copy" data-handoff-text="${order.id}" readonly>${escape(preparedReturnText)}</textarea><div class="manager-actions"><button class="secondary" type="button" data-copy-handoff="${order.id}">Скопировать текст для ARCHA POINT</button></div></section>`;
  if (order.delivery_type !== 'arca_locker' || !['confirmed', 'awaiting_archa_reservation'].includes(order.status)) return '';
  const reference = String(order.id || '').slice(0, 8).toUpperCase();
  const asset = [order.laptop_title || '—', order.laptop_serial_number ? `S/N ${order.laptop_serial_number}` : '', order.laptop_inventory_code ? `Инв. ${order.laptop_inventory_code}` : ''].filter(Boolean).join(' · ');
  const text = `ВЫДАЧА RENTOP.KG\nЗаявка: ${reference}\nФИО: ${order.customer_name || '—'}\nТелефон: ${order.customer_phone || '—'}\nПостамат: ${order.locker_address || '—'}\nНоутбук: ${asset}\nСрок аренды: ${order.rental_start_date || '—'} — ${order.rental_end_date || '—'}\nПросим зарезервировать ячейку и направить данные для закладки устройства.`;
  const title = order.status === 'confirmed' ? 'Следующий обязательный шаг — передача в ARCHA POINT' : 'Сообщение для рабочей группы ARCHA POINT';
  const hint = order.status === 'confirmed'
    ? 'Проверьте комплект, скопируйте текст и отправьте его в рабочую группу. Кнопка ниже только переводит заявку к резервированию — сама она сообщение не отправляет.'
    : 'Сообщение подготовлено. Скопируйте и отправьте его в рабочую группу ARCHA POINT, затем внесите их код закладки ниже.';
  return `<section class="manager-section manager-handoff-primary"><h3>${title}</h3><p>${hint}</p><textarea class="manager-handoff-copy" data-handoff-text="${order.id}" readonly>${escape(text)}</textarea><div class="manager-actions"><button class="secondary" type="button" data-copy-handoff="${order.id}">Скопировать текст для ARCHA POINT</button></div></section>`;
}

function replacementGroup(laptop) {
  const tags = String(laptop.use_cases || laptop.useCases || laptop.description || '').toLowerCase();
  if (/(игр|3d|vfx|blender|гейм)/.test(tags)) return 'Игры и 3D';
  if (/(монтаж|график|дизайн|video|видео)/.test(tags)) return 'Монтаж и графика';
  if (/(офис|уч[её]б|word|excel|экзамен|toefl|ielts|браузер)/.test(tags)) return 'Офис и учёба';
  return 'Универсальные';
}

function replacementOptions(laptops) {
  const groups = new Map([['Офис и учёба', []], ['Монтаж и графика', []], ['Игры и 3D', []], ['Универсальные', []], ['Ставка не задана', []]]);
  laptops.forEach(laptop => {
    const rate = Number(laptop.daily_rate || laptop.dailyRate || 0);
    const label = `${laptop.title} · ${rate > 0 ? `${rate.toLocaleString('ru-RU')} сом/день` : 'ставка не задана'}`;
    groups.get(rate > 0 ? replacementGroup(laptop) : 'Ставка не задана').push({ laptop, label, rate });
  });
  return [...groups.entries()].filter(([, items]) => items.length).map(([group, items]) => `<optgroup label="${escape(group)}">${items.map(({ laptop, label, rate }) => `<option value="${Number(laptop.id)}" ${rate > 0 ? '' : 'disabled'}>${escape(label)}</option>`).join('')}</optgroup>`).join('');
}

function replacementPickerCategory(laptop) {
  const group = replacementGroup(laptop);
  return group === 'Офис и учёба' ? 'office' : group === 'Монтаж и графика' ? 'creative' : group === 'Игры и 3D' ? 'gaming' : 'all';
}

function closeReplacementPicker() {
  if (!replacementPicker) return;
  replacementPicker.hidden = true;
  document.body.style.overflow = document.body.classList.contains('manager-mobile-order-open') ? 'hidden' : '';
}

function renderReplacementPicker() {
  if (!replacementPickerList) return;
  const order = orders.find(item => String(item.id) === String(replacementPickerState.orderId));
  const query = replacementPickerState.query.trim().toLowerCase();
  const originalRate = Number(order?.daily_rate || 0);
  const originalCategory = replacementPickerCategory(rentableLaptops.find(item => String(item.id) === String(order?.laptop_id)) || {});
  const items = rentableLaptops
    .filter(laptop => String(laptop.id) !== String(order?.laptop_id))
    .filter(laptop => Number(laptop.daily_rate || laptop.dailyRate || 0) > 0)
    .filter(laptop => replacementPickerState.filter === 'all' || replacementPickerCategory(laptop) === replacementPickerState.filter)
    .filter(laptop => !query || `${laptop.title || ''} ${laptop.cpu || ''} ${laptop.use_cases || laptop.useCases || ''} ${laptop.description || ''}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftSamePurpose = replacementPickerCategory(left) === originalCategory ? 0 : 1;
      const rightSamePurpose = replacementPickerCategory(right) === originalCategory ? 0 : 1;
      return leftSamePurpose - rightSamePurpose || Math.abs(Number(left.daily_rate || 0) - originalRate) - Math.abs(Number(right.daily_rate || 0) - originalRate) || Number(left.daily_rate || 0) - Number(right.daily_rate || 0);
    });
  replacementPickerList.innerHTML = items.length ? items.map(laptop => {
    const rate = Number(laptop.daily_rate || laptop.dailyRate || 0);
    const group = replacementGroup(laptop);
    const selected = String(laptop.id) === String(replacementPickerState.selectedId);
    const specs = [laptop.cpu, laptop.ram, laptop.storage].filter(Boolean).join(' · ');
    return `<button type="button" class="manager-replacement-option ${selected ? 'is-selected' : ''}" data-replacement-option="${Number(laptop.id)}"><span class="manager-replacement-option-top"><strong>${escape(laptop.title)}</strong><b>${rate.toLocaleString('ru-RU')} сом/день</b></span><span>${escape(group)}${specs ? ` · ${escape(specs)}` : ''}</span></button>`;
  }).join('') : '<p class="manager-replacement-empty">Подходящих моделей не найдено. Измените поиск или категорию.</p>';
  replacementPickerFilters?.querySelectorAll('[data-replacement-filter]').forEach(button => button.classList.toggle('is-active', button.dataset.replacementFilter === replacementPickerState.filter));
  if (replacementPickerFilterSelect) replacementPickerFilterSelect.value = replacementPickerState.filter;
  if (replacementPickerConfirm) replacementPickerConfirm.disabled = !replacementPickerState.selectedId;
}

function openReplacementPicker(orderId) {
  const current = replacementSelections.get(String(orderId));
  const order = orders.find(item => String(item.id) === String(orderId));
  const original = rentableLaptops.find(item => String(item.id) === String(order?.laptop_id));
  const suggestedFilter = replacementPickerCategory(original || {});
  replacementPickerState = { orderId:String(orderId), filter:suggestedFilter, query:'', selectedId:current ? String(current) : '' };
  if (replacementPickerSearch) replacementPickerSearch.value = '';
  renderReplacementPicker();
  if (!replacementPicker) return;
  replacementPicker.hidden = false;
  document.body.style.overflow = 'hidden';
  window.setTimeout(() => replacementPickerSearch?.focus(), 0);
}

function render() {
  // Refreshing a queue must not throw the manager to the beginning of a long
  // card while they review a return or a document.
  const scrollPosition = window.scrollY;
  const selectedOrderBeforeRender = String(selectedOrderId || '');
  const selectedOrderScrollTop = ordersEl.querySelector('.manager-order.is-selected')?.scrollTop || 0;
  openOrderDetails = new Set([...ordersEl.querySelectorAll('.manager-order-details[open]')].map(item => item.closest('[data-manager-order]')?.dataset.managerOrder).filter(Boolean));
  const list = visibleOrders();
  const compactMobileQueue = window.matchMedia('(max-width: 760px)').matches;
  if (!list.some(order => String(order.id) === String(selectedOrderId))) selectedOrderId = compactMobileQueue ? '' : (list[0]?.id || '');
  if (compactMobileQueue && selectedOrderId) setMobileOrderView(true);
  else setMobileOrderView(false);
  const pendingDocs = orders.reduce((total, order) => total + order.documents.filter(document => document.status === 'pending_review').length, 0);
  const active = orders.filter(order => ['in_use','incident'].includes(order.status)).length;
  const returns = orders.filter(order => ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status));
  const fresh = orders.filter(order => ['pending_review','awaiting_payment','payment_review','reserved','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status)).length;
  // Test applications can deliberately go through a payment scenario, but
  // that is not income. Keep them visible to the founder for cleanup while
  // excluding them from the financial KPI immediately after marking.
  const paidOrders = orders.filter(order => order.payment?.status === 'paid' && ['rental','balance'].includes(order.payment?.purpose || 'rental') && !order.is_test);
  const revenue = paidOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const deposits = paidOrders.reduce((sum, order) => sum + Number(order.deposit_amount || 0), 0);
  statsEl.innerHTML = [[orders.length,'Всего заявок','all'],[fresh,'В работе','new'],[pendingDocs,'Документы на проверке','documents'],[active,'Активные аренды','active'],[`${revenue.toLocaleString('ru-RU')} сом`,'Выручка (месяц)','all']].map(([value,label,key]) => `<button class="manager-stat ${filter === key ? 'is-active' : ''}" type="button" data-filter="${key}"><span>${label}</span><strong>${value}</strong></button>`).join('');
  if (returnAlert) {
    const newest = returns[0];
    returnAlert.hidden = !newest;
    returnAlert.innerHTML = newest ? `<strong>↩ ${returns.length} возврат${returns.length === 1 ? '' : returns.length < 5 ? 'а' : 'ов'} требует действий</strong><span>Заявка ${escape(String(newest.id).slice(0,8).toUpperCase())} · ${escape(newest.customer_name || 'Клиент')} · ${escape(statusLabel(newest.status))}. Открыть возвраты →</span>` : '';
  }
  ordersEl.innerHTML = list.length ? list.map(order => {
    const latestDocuments = new Map();
    order.documents.forEach(document => { if (!latestDocuments.has(document.kind)) latestDocuments.set(document.kind, document); });
    const identityAccepted = latestDocuments.get('identity_front')?.status === 'accepted' || latestDocuments.get('identity')?.status === 'accepted';
    const documentsReadyForPayment = identityAccepted && ['identity_back','selfie','supporting'].every(kind => latestDocuments.get(kind)?.status === 'accepted');
    const benefitPendingForPayment = latestDocuments.get('benefit_proof')?.status === 'pending_review';
    const registryReadyForPayment = String(order.residence_address || '').trim().length >= 8
      && String(order.supporting_document_type || '').trim().length >= 3
      && String(order.identity_document_number || '').trim().length >= 3
      && String(order.identity_document_issuer || '').trim().length >= 3
      && Boolean(order.identity_verified_at);
    const action = documentsReadyForPayment && registryReadyForPayment && !benefitPendingForPayment ? nextAction(order) : null;
    const paymentReadiness = order.status === 'pending_review' && !action
      ? `<p class="manager-action-note">${!documentsReadyForPayment ? 'Сначала примите все четыре обязательных документа.' : benefitPendingForPayment ? 'Клиент запросил социальную скидку: примите или отклоните льготный документ, чтобы зафиксировать итоговую сумму до счёта.' : 'Документы приняты: сверьте ID, заполните реестр и сохраните проверку — затем появится действие «Перевести к оплате» и можно будет выставить защищённый QR-счёт.'}</p>`
      : '';
    const pending = order.documents.filter(document => document.status === 'pending_review').length;
    const invoiceGroup = order.order_group_id ? orders.filter(item => String(item.order_group_id || '') === String(order.order_group_id)) : [order];
    const isInvoiceGroupMaster = !order.order_group_id || String(invoiceGroup[0]?.id) === String(order.id);
    const defaultRentalAmount = invoiceGroup.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const defaultDepositAmount = invoiceGroup.reduce((sum, item) => sum + Number(item.deposit_amount || 0), 0);
    const savedPaymentDraft = paymentDrafts.get(String(order.id)) || {};
    const paymentDraft = {
      rentalAmount:Number(savedPaymentDraft.rentalAmount ?? savedPaymentDraft.amount ?? defaultRentalAmount),
      depositAmount:Number(savedPaymentDraft.depositAmount ?? defaultDepositAmount),
      deliveryFee:Number(savedPaymentDraft.deliveryFee || 0),
      deliveryMode:savedPaymentDraft.deliveryMode || 'external'
    };
    const sharedInvoice = invoiceGroup.map(item => item.payment).find(payment => payment?.purpose !== 'extension') || null;
    const hasActivePayment = sharedInvoice?.status === 'awaiting_payment' && new Date(sharedInvoice.expires_at) > new Date();
    const deliveryCharge = order.delivery_type === 'delivery' ? `<label>Как оплачивается доставка<select data-delivery-charge-mode><option value="external" ${paymentDraft.deliveryMode === 'external' ? 'selected' : ''}>Клиент оплачивает курьера при встрече</option><option value="rentop" ${paymentDraft.deliveryMode === 'rentop' ? 'selected' : ''}>Включить доставку Rentop в QR-счёт</option></select></label><label class="manager-delivery-fee">Доставка Rentop, сом<input data-delivery-fee type="number" min="0" max="100000" step="1" value="${Number(paymentDraft.deliveryFee || 0)}" ${paymentDraft.deliveryMode === 'rentop' ? '' : 'disabled'}></label>` : '';
    const reservationDefault = invoiceGroup.reduce((sum, item) => sum + Number(item.daily_rate || 0), 0);
    const standardRentalAmount = invoiceGroup.reduce((sum, item) => sum + Math.round(Number(item.daily_rate || 0) * Number(item.rental_days || 0) * (100 - Number(item.discount_percent || 0)) / 100), 0);
    const agreedRentalAmount = invoiceGroup.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const canSetAgreedPrice = ['draft','pending_review','awaiting_payment'].includes(order.status) && !hasActivePayment;
    const agreedPriceAction = canSetAgreedPrice && isInvoiceGroupMaster
      ? `<section class="manager-section manager-agreed-price"><h3>Индивидуальная цена аренды</h3><p>Стандартно по ставке: <b>${standardRentalAmount.toLocaleString('ru-RU')} сом</b>. Эта цена сохранится в заявке и станет основой для полного QR, брони и остатка.</p><div class="manager-payment-create"><label>Согласованная сумма за весь срок, сом<input data-agreed-rental-amount type="number" min="1" max="1000000" step="1" value="${agreedRentalAmount}"></label><label>Причина договорённости<input data-agreed-rental-note type="text" maxlength="500" placeholder="Например: месяц аренды по договорённости"></label><button class="secondary" data-save-agreed-rental-price="${order.id}">Сохранить цену</button></div></section>`
      : '';
    const paymentAction = order.status === 'awaiting_payment' && !hasActivePayment
      ? (isInvoiceGroupMaster
        ? `<div class="manager-payment-create" data-payment-draft="${order.id}"><h4>Как принять оплату?</h4><p class="manager-action-note">Выберите один сценарий. Полный QR и QR предоплаты не создаются одновременно.</p>${invoiceGroup.length > 1 ? `<p class="manager-action-note">Один общий QR для ${invoiceGroup.length} ноутбуков: ${invoiceGroup.map(item => escape(item.laptop_title || 'Ноутбук')).join(' · ')}.</p>` : ''}<label>Аренда, сом<input data-payment-rental type="number" min="0" max="1000000" step="1" value="${paymentDraft.rentalAmount}"></label><label>Возвратный залог, сом<input data-payment-deposit type="number" min="0" max="1000000" step="1" value="${paymentDraft.depositAmount}"></label>${deliveryCharge}<small data-payment-summary>Полный QR: ${(paymentDraft.rentalAmount + paymentDraft.depositAmount + (paymentDraft.deliveryMode === 'rentop' ? paymentDraft.deliveryFee : 0)).toLocaleString('ru-RU')} сом.</small><button class="secondary" data-create-payment="${order.id}">Выставить полный QR-счёт сейчас</button><hr><strong>Или бронь на дату</strong><label>Предоплата для брони, сом<input data-reservation-amount type="number" min="1" max="${paymentDraft.rentalAmount}" step="1" value="${Math.min(paymentDraft.rentalAmount, reservationDefault || paymentDraft.rentalAmount)}"></label><small>После оплаты ноутбук закрепится за клиентом на выбранные даты. Остаток аренды и возвратный залог выставляются отдельным QR только перед выдачей.</small><button class="secondary" data-create-reservation-payment="${order.id}">Выставить QR предоплаты для брони</button></div>`
        : `<p class="manager-action-note">Эта позиция входит в общий заказ. QR создаётся в первой позиции заказа и будет содержать все ноутбуки.</p>`)
      : order.status === 'reserved' && isInvoiceGroupMaster
        ? `<section class="manager-section"><h3>Оплаченная бронь</h3><p>Предоплата: <b>${Number(order.reservationPayment?.amount || order.reservation_amount || 0).toLocaleString('ru-RU')} сом</b>. Ноутбук уже закрыт на даты клиента.</p>${order.balancePayment?.status === 'awaiting_payment' ? '<p>QR доплаты уже показан клиенту.</p>' : `<button class="secondary" data-create-balance-payment="${order.id}">Выставить QR доплаты перед выдачей</button>`}</section>`
        : '';
    const paymentMismatch = ['confirmed','awaiting_pickup','issued','in_use'].includes(order.status) && order.payment?.status === 'awaiting_payment' ? '<p class="manager-payment-warning">Банк ещё не подтвердил этот QR. Не выдавайте ноутбук: статус заявки был изменён вручную, а оплата не зафиксирована webhook-ом.</p>' : '';
    const manualPaymentAction = hasActivePayment ? `<button class="secondary manager-payment-manual" data-manual-payment="${order.id}">Подтвердить оплату вручную</button>` : '';
    const paymentState = order.payment ? `<section class="manager-section"><h3>Оплата Bakai</h3><div class="manager-request">${escape(order.payment.status)} · ${Number(order.payment.amount || 0).toLocaleString('ru-RU')} сом · ${escape(order.payment.operation_id || '')}${hasActivePayment ? `<button class="danger manager-payment-revoke" data-revoke-payment="${order.id}">Отозвать QR</button>` : ''}</div>${hasActivePayment ? '<p class="manager-payment-warning">Используйте ручное подтверждение только после проверки поступления в Bakai Business. Отзыв уберёт QR из кабинета Rentop, но не отменяет его в Банке.</p>' : ''}${paymentMismatch}</section>` : '';
    const extensionRequest = order.requests.find(request => ['extension','replacement'].includes(request.kind) && ['open','in_progress'].includes(request.status));
    const extensionPayment = (order.payments || []).find(payment => payment.purpose === 'extension' && extensionRequest && payment.request_id === extensionRequest.id && ['awaiting_payment','paid'].includes(payment.status));
    const replacementInfo = extensionRequest?.kind === 'replacement' ? `<br><strong>Замена:</strong> ${escape(extensionRequest.replacement_note || 'выбранная клиентом модель')} · разница ${Number(extensionRequest.replacement_difference || 0) >= 0 ? '+' : ''}${Number(extensionRequest.replacement_difference || 0).toLocaleString('ru-RU')} сом` : '';
    const isFreeExtension = Number(extensionRequest?.estimated_amount || 0) <= 0;
    const extensionAction = extensionRequest ? `<section class="manager-section"><h3>${extensionRequest.kind === 'replacement' ? 'Замена для продления' : 'Продление аренды'}</h3><div class="manager-request">+${Number(extensionRequest.requested_days || 0)} дн. · до ${date(extensionRequest.proposed_return_date)} · ${Number(extensionRequest.estimated_amount || 0).toLocaleString('ru-RU')} сом${replacementInfo}</div>${extensionPayment ? `<p>${extensionPayment.status === 'paid' ? extensionRequest.kind === 'replacement' ? '✓ Оплачено — ожидается физическая передача устройств.' : '✓ Оплачено — дата аренды обновлена.' : 'QR доплаты уже показан клиенту.'}</p>` : isFreeExtension ? `<div class="manager-actions"><button class="secondary" data-approve-free-extension="${order.id}" data-request-id="${extensionRequest.id}">Подтвердить без доплаты</button><button class="danger" data-reject-extension="${order.id}" data-request-id="${extensionRequest.id}">Отклонить запрос</button></div>` : `<div class="manager-payment-create"><label>Доплата за продление, сом<input data-extension-payment-amount type="number" min="1" max="1000000" step="1" value="${Number(extensionRequest.estimated_amount || 0)}"></label><button class="secondary" data-create-extension-payment="${order.id}" data-request-id="${extensionRequest.id}">Создать QR доплаты</button><button class="danger" data-reject-extension="${order.id}" data-request-id="${extensionRequest.id}">Отклонить запрос</button></div>`}</section>` : '';
    const exchangeAction = order.replacement_exchange_status === 'awaiting_exchange' && order.replacement_pending_laptop_id ? `<section class="manager-section"><h3>Физическая замена ноутбука</h3><p>Доплата и срок уже зафиксированы. Не меняйте устройство в заявке до фактической передачи обоих ноутбуков.</p><label>Способ передачи<select data-replacement-exchange-method><option value="arca_locker">ARCHA POINT</option><option value="rentop_courier">Курьер Rentop</option><option value="customer_courier">Курьерская служба клиента</option><option value="self_delivery">Самопривоз</option></select></label><label>Примечание к передаче<textarea data-replacement-exchange-note maxlength="1000" placeholder="Например: старый ноутбук и зарядка приняты, новый передан клиенту"></textarea></label><button class="secondary" data-confirm-replacement-exchange="${order.id}">Подтвердить физическую замену</button></section>` : '';
    const customerNote = order.customer_note ? `<section class="manager-section"><h3>Комментарий клиента</h3><div class="manager-request">${escape(order.customer_note)}</div></section>` : '';
    const supportCases = (order.supportCases || []).filter(item => item.status === 'open');
    const supportPanel = supportCases.length ? `<section class="manager-section"><h3>Открытые обращения клиента</h3><p>Клиент: <strong>${escape(order.customer_phone || 'номер не указан')}</strong> — можно связаться вручную или отправить ответ в кабинет ниже.</p><div class="manager-requests">${supportCases.map(item => `<div class="manager-request"><strong>${escape(({ rentop:'Вопрос к Rentop', archa:'Проблема с ARCHA POINT', archa_code_missing:'Не пришёл код ARCHA POINT', archa_locker_issue:'Постамат не выдаёт / не открывается', rental_issue:'Проблема с ноутбуком', delivery_status:'Статус доставки', delivery_change:'Перенос времени доставки', address_change:'Изменение адреса доставки', order_cancel:'Отмена заявки' }[item.kind] || item.kind))}</strong><br>${escape(item.customer_message || 'Сообщение не указано')}<br><small>${date(item.opened_at)}</small>${item.manager_reply ? `<p><strong>Ответ менеджера:</strong> ${escape(item.manager_reply)}</p>` : ''}<textarea data-support-reply="${escape(item.kind)}" maxlength="1500" placeholder="Напишите ответ клиенту — он появится в личном кабинете"></textarea><div class="manager-actions"><button class="secondary" data-reply-support="${order.id}" data-support-kind="${escape(item.kind)}">Отправить ответ</button><button class="secondary" data-resolve-support="${order.id}" data-support-kind="${escape(item.kind)}">Отметить решённым</button></div></div>`).join('')}</div></section>` : '';
    const altRequirements = Array.isArray(order.alternative_security_requirements) ? order.alternative_security_requirements : [];
    const altLabels = { alternative_security_video:'Видеообращение арендатора', alternative_security_address:'Подтверждение адреса', alternative_security_work:'Справка с работы', alternative_security_study:'Справка с учёбы' };
    const alternativeSecurityPanel = ['draft', 'pending_review'].includes(order.status) ? (() => {
      if (['requested', 'submitted'].includes(order.alternative_security_status)) {
        const pendingRequired = altRequirements.filter(kind => !latestDocuments.get(kind) || latestDocuments.get(kind)?.status === 'pending_review');
        const rejectedRequired = altRequirements.filter(kind => latestDocuments.get(kind)?.status === 'rejected');
        const contact = order.emergency_contact_name ? `<p>Экстренный контакт: ${escape(order.emergency_contact_name)} · ${escape(order.emergency_contact_relationship || 'родственник')} · ${escape(order.emergency_contact_phone || '—')}. Это не поручитель.</p>` : '';
        return `<section class="manager-section"><h3>Индивидуальное решение по залогу</h3><p>${escape(order.alternative_security_note || 'Запрошена дополнительная проверка вместо денежного залога.')} ${order.alternative_security_expires_at ? `Срок: ${date(order.alternative_security_expires_at)}.` : ''}</p>${contact}<p>Запрошено: ${altRequirements.map(kind => escape(altLabels[kind] || kind)).join(' · ') || '—'}.</p>${rejectedRequired.length ? `<p class="manager-payment-warning">Отклонены: ${rejectedRequired.map(kind => escape(altLabels[kind] || kind)).join(', ')}. Запросите новые файлы или откажите.</p>` : pendingRequired.length ? `<p>Ожидаем / проверяем: ${pendingRequired.map(kind => escape(altLabels[kind] || kind)).join(', ')}.</p>` : '<p>Все запрошенные файлы загружены. Откройте их выше и примите или отклоните каждый файл.</p>'}<label>Решение / причина<textarea data-alternative-security-note maxlength="700" placeholder="Например: видео и справка приняты; залог 0 сом по индивидуальному решению"></textarea></label><div class="manager-actions"><button class="secondary" data-decide-alternative-security="${order.id}" data-alternative-security-decision="approved" ${pendingRequired.length || rejectedRequired.length ? 'disabled' : ''}>Одобрить без залога</button><button class="danger" data-decide-alternative-security="${order.id}" data-alternative-security-decision="rejected">Отказать</button></div></section>`;
      }
      if (order.alternative_security_status === 'approved') return `<section class="manager-section"><h3>Индивидуальное решение по залогу</h3><p class="manager-request">✓ Дополнительная проверка одобрена ${order.alternative_security_decided_at ? date(order.alternative_security_decided_at) : ''}. Денежный залог установлен в 0 сом; ответственность арендатора по договору сохранена.</p></section>`;
      return `<details class="manager-section manager-alternative-security"><summary><span>Проверка без денежного залога</span><small>По решению менеджера</small></summary><p>Индивидуальная мера до выставления счёта. Видеообращение запрашивается всегда; ниже выберите только дополнительные документы. Контакт родственника — только для экстренной связи, не поручительство.</p><div class="manager-alternative-security-options"><label><input type="checkbox" data-alternative-security-requirement value="alternative_security_address"><span>Подтверждение адреса</span></label><label><input type="checkbox" data-alternative-security-requirement value="alternative_security_work"><span>Справка с места работы</span></label><label><input type="checkbox" data-alternative-security-requirement value="alternative_security_study"><span>Справка с места учёбы</span></label></div><label class="manager-alternative-security-note"><span>Пояснение клиенту</span><textarea data-alternative-security-note maxlength="700" placeholder="Например: можем рассмотреть выдачу без залога после дополнительной проверки"></textarea></label><div class="manager-actions"><button class="secondary" data-offer-alternative-security="${order.id}">Открыть проверку без залога</button></div></details>`;
    })() : '';
    const offerEvidence = order.offer_accepted_at ? `<section class="manager-section"><h3>Оферта и согласия</h3><div class="manager-request">Оферта ${escape(order.offer_version || '—')} · принята ${date(order.offer_accepted_at)} · SMS ${order.offer_otp_verified_at ? `подтверждён ${date(order.offer_otp_verified_at)}` : 'ещё не подтверждён'}</div></section>` : '';
    const identityRegistry = order.documents.some(document => ['identity','identity_front'].includes(document.kind)) ? `<label>Номер паспорта / ID <span>перепишите после визуальной сверки</span><input data-registry-identity-number maxlength="80" value="${escape(order.identity_document_number || '')}" placeholder="Только по загруженному документу"></label><label>Кем выдан документ <input data-registry-identity-issuer maxlength="240" value="${escape(order.identity_document_issuer || '')}" placeholder="Строго как указано в документе"></label>` : '<div class="manager-registry-missing-id">Паспорт или ID клиента ещё не загружен — поля сверки личности появятся после загрузки документа.</div>';
    const identitySummary = order.identity_verified_at ? `Паспорт/ID сверены ${date(order.identity_verified_at)}${order.identity_verified_by ? ` · ${escape(order.identity_verified_by)}` : ''}.` : 'Паспорт/ID ещё не сверены менеджером.';
    const legacyRegistryNote = !order.residence_address || !order.supporting_document_type ? '<p class="manager-registry-legacy">Это заявка старого формата: адрес и тип подтверждающего документа тогда не собирались. Это не ошибка и не означает, что документ отклонён. Сверьте только файлы, которые показаны выше.</p>' : '';
    const registryNextStep = registryReadyForPayment
      ? 'Сверка личности сохранена. Все данные реестра готовы — можно подтвердить сверку и перейти к выставлению оплаты.'
      : 'После сверки документов заполните номер ID и кем выдан документ, затем сохраните. Когда обязательные файлы приняты, появится действие перехода к выставлению оплаты.';
    const registry = `<section class="manager-section manager-registry"><div class="manager-registry-heading"><div><p>ШАГ ПОСЛЕ ПРИЁМА ФАЙЛОВ</p><h3>Сверка документов и внутренний реестр</h3></div><span>${registryReadyForPayment ? 'Готово к оплате' : 'Нужна сверка'}</span></div><ol class="manager-registry-steps"><li>Откройте документы выше и примите или отклоните каждый файл.</li><li>Сверьте паспорт/ID и внесите данные строго по документу.</li><li>Сохраните реестр — затем подтвердите сверку и перейдите к выставлению QR-счёта.</li></ol>${legacyRegistryNote}<div class="manager-registry-source"><div><span>Устройство</span><strong>${escape(order.laptop_title || '—')}</strong><small>S/N: ${escape(order.laptop_serial_number || 'не указан')} · инв. код: ${escape(order.laptop_inventory_code || 'не указан')}</small></div></div><div class="manager-registry-form"><h4>Данные для внутреннего реестра</h4><label class="manager-registry-wide">Адрес проживания клиента <span>${order.residence_address ? 'передан клиентом — исправьте только после уточнения' : 'старая заявка: уточните у клиента по телефону и внесите полный адрес'}</span><textarea data-registry-residence maxlength="500" placeholder="г. Бишкек, район, улица, дом, квартира">${escape(order.residence_address || '')}</textarea></label><label>Подтверждающий документ <span>выберите тип файла, который сверяете</span><select data-registry-supporting-type><option value="">Выберите документ</option>${['Справка с места жительства','Справка с места работы','Справка с места учёбы','Документ / скрин из Тундук','Иной официальный документ'].map(type => `<option value="${type}" ${order.supporting_document_type === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label>${identityRegistry}<label>Цель аренды / задачи клиента<textarea data-registry-purpose maxlength="600" placeholder="Например: монтаж видео, учёба, офисная работа">${escape(order.rental_purpose || '')}</textarea></label><label>Заметка менеджера<textarea data-registry-note maxlength="2000" placeholder="Договорённости, комплектация, важные детали">${escape(order.manager_note || '')}</textarea></label><label>Состояние при возврате <span>заполняется только после возврата</span><textarea data-registry-return maxlength="2000" placeholder="После осмотра: корпус, зарядка, комплектность, замечания">${escape(order.return_condition_note || '')}</textarea></label><button class="secondary" data-save-registry="${order.id}">Сохранить сверку и реестр</button></div><p class="manager-registry-status"><strong>${identitySummary}</strong> ${registryNextStep}</p></section>`;
    const benefits = (order.benefits || []).filter(item => item.status !== 'expired');
    const currentBenefit = benefits.find(item => item.status === 'approved') || benefits.find(item => item.status === 'pending_review') || null;
    const benefitPanel = currentBenefit ? `<section class="manager-section"><h3>Текущая льгота профиля</h3><div class="manager-request"><strong>${escape(benefitLabel(currentBenefit.benefit_type))}</strong> · ${escape(currentBenefit.status)}${currentBenefit.reviewer_note ? `<br>${escape(currentBenefit.reviewer_note)}` : ''}<br><small>Подано ${date(currentBenefit.created_at)}${currentBenefit.approved_at ? ` · принято ${date(currentBenefit.approved_at)}` : ''}</small></div><p>Срок аренды, одобренная льгота и персональный промокод складываются. Общая скидка ограничена 40%.</p></section>` : '';
    const loyaltyAction = order.status === 'completed' ? `<section class="manager-section"><h3>Лояльность клиента</h3><div class="manager-actions"><button class="secondary" data-issue-promo="${order.id}">Выдать персональный промокод</button></div><p>Промокод привязывается к номеру клиента и будет виден только в его личном кабинете.</p></section>` : '';
    const earlySettlement = order.status === 'completed' ? `<section class="manager-section"><h3>Итог досрочного возврата</h3>${order.early_return_settlement_type ? `<div class="manager-request">${escape(({ freeze_days:'Неиспользованные дни заморожены', partial_refund:'Частичный возврат согласован', no_compensation:'Компенсация не предоставляется' })[order.early_return_settlement_type] || order.early_return_settlement_type)}${order.early_return_settlement_amount != null ? ` · ${Number(order.early_return_settlement_amount).toLocaleString('ru-RU')} сом` : ''}${order.early_return_settlement_note ? `<br>${escape(order.early_return_settlement_note)}` : ''}</div>` : `<p>Выберите решение после физической приёмки. Возврат денег выполняется отдельно вручную; эта запись фиксирует договорённость и не проводит платёж сама.</p><label>Решение<select data-early-settlement-type><option value="freeze_days">Заморозить неиспользованные дни</option><option value="partial_refund">Частично вернуть сумму</option><option value="no_compensation">Компенсация не предоставляется</option></select></label><label>Сумма, сом (если применимо)<input data-early-settlement-amount type="number" min="0" max="1000000" step="1" value="0"></label><label>Пояснение клиенту<textarea data-early-settlement-note maxlength="1000" placeholder="Например: по решению Rentop возвращаем 500 сом после осмотра"></textarea></label><button class="secondary" data-settle-early-return="${order.id}">Зафиксировать решение</button>`}</section>` : '';
    const assetTools = isChiefAdmin ? `<section class="manager-section"><h3>Учёт устройства</h3><div class="manager-payment-create"><label>Заводской S/N<input data-asset-serial type="text" maxlength="160" value="${escape(order.laptop_serial_number || '')}" placeholder="Например: C02ABC123XYZ"></label><label>Инвентарный код Rentop<input data-asset-inventory type="text" maxlength="100" value="${escape(order.laptop_inventory_code || '')}" placeholder="Например: RT-0001"></label><button class="secondary" data-save-asset="${order.laptop_id}">Сохранить идентификаторы</button></div></section>` : '';
    const incidentCandidates = rentableLaptops.filter(laptop => String(laptop.id) !== String(order.laptop_id) && Number(laptop.daily_rate || 0) >= Number(order.daily_rate || 0));
    const incidentTools = order.status === 'incident' ? `${order.replacement_exchange_status === 'awaiting_exchange' ? '<p class="manager-request">Замена уже согласуется. Сначала подтвердите физическую передачу выше, затем закройте инцидент.</p>' : `<div class="manager-payment-create"><label>Равная или более дорогая модель<select data-incident-replacement-laptop><option value="">Выберите модель</option>${incidentCandidates.map(laptop => `<option value="${Number(laptop.id)}">${escape(laptop.title)} · ${Number(laptop.daily_rate || 0).toLocaleString('ru-RU')} сом/день</option>`).join('')}</select></label><label>Ответственность<select data-incident-fault-party><option value="rentop">Вина Rentop — замена без доплаты</option><option value="customer">Вина клиента — условия согласует менеджер</option></select></label><label>Передача<select data-incident-method><option value="rentop_courier">Курьер Rentop</option><option value="arca_locker">ARCHA POINT</option><option value="customer_courier">Курьерская служба клиента</option><option value="self_delivery">Самопривоз</option></select></label><button class="secondary" data-admin-offer-incident-replacement="${order.id}">Предложить замену</button></div>`}<button class="secondary" data-admin-resolve-incident="${order.id}">Разрешить инцидент</button>` : '';
    const testTools = order.is_test
      ? `<button class="danger" data-delete-test-order="${order.id}" data-order-reference="${escape(String(order.id).slice(0, 8).toUpperCase())}">Удалить тестовую заявку</button><p class="manager-action-note">Тестовая заявка: удаление потребует повторно ввести её номер.</p>`
      : `<button class="secondary" data-mark-test-order="${order.id}">Пометить как тестовую</button><p class="manager-action-note">Только для тренировочных заявок. Заявки с выданным ноутбуком пометить нельзя.</p>`;
    const mayReplaceBeforePayment = ['draft','pending_review'].includes(order.status);
    const replacementLaptops = rentableLaptops.filter(laptop => String(laptop.id) !== String(order.laptop_id));
    const pricedReplacementLaptops = replacementLaptops.filter(laptop => Number(laptop.daily_rate || laptop.dailyRate || 0) > 0);
    const selectedReplacement = rentableLaptops.find(laptop => String(laptop.id) === String(replacementSelections.get(String(order.id))));
    const replacementBeforePayment = mayReplaceBeforePayment ? `<div class="manager-prepayment-replacement"><input type="hidden" data-prepayment-replacement-laptop value="${escape(replacementSelections.get(String(order.id)) || '')}"><button class="manager-replacement-open" type="button" data-open-replacement-picker="${order.id}"><span>${selectedReplacement ? escape(selectedReplacement.title) : 'Выбрать новую модель для замены'}</span><small>${selectedReplacement ? `${Number(selectedReplacement.daily_rate || selectedReplacement.dailyRate || 0).toLocaleString('ru-RU')} сом/день · изменить` : 'Поиск по модели, назначению и ставке'}</small></button><label class="manager-replacement-reason"><span>Причина для клиента</span><textarea data-prepayment-replacement-reason maxlength="700" placeholder="Например: выбранная модель занята на ваши даты; предлагаем равноценную альтернативу."></textarea></label><div class="manager-actions"><button class="secondary" data-replace-prepayment-laptop="${order.id}" ${selectedReplacement && pricedReplacementLaptops.length ? '' : 'disabled'}>Заменить сразу и пересчитать</button><button class="secondary" data-offer-prepayment-replacement="${order.id}" ${selectedReplacement && pricedReplacementLaptops.length ? '' : 'disabled'}>Предложить клиенту</button></div><small>${pricedReplacementLaptops.length ? 'Каталог показывает модели по назначению и ставке. «Предложить клиенту» ничего не меняет до его согласия.' : 'Нет другой модели с заполненной ставкой аренды. Укажите ставку в каталоге — тогда она появится здесь.'}</small></div>` : '';
    const mayCancelUnissued = ['draft','pending_review','awaiting_payment','payment_review','reserved','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status);
    const adminTools = isChiefAdmin ? `<details class="manager-section manager-chief-tools"><summary><span>Служебные действия</span><small>Открыть</small></summary>${replacementBeforePayment ? `<div class="manager-chief-replacement"><strong>Заменить ноутбук в этой заявке</strong><span>Доступно до создания QR-счёта</span>${replacementBeforePayment}</div>` : ''}<details class="manager-dossier-tools"><summary>Досье и экспорт</summary><div class="manager-admin-links"><a class="cabinet-action secondary" href="/api/manager/dossier?order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Открыть досье</a><a class="cabinet-action ghost" href="/api/manager/dossier?order=${encodeURIComponent(order.id)}&format=json">Скачать JSON</a></div></details>${order.status === 'returned' ? `<div class="manager-chief-group"><button class="secondary" data-admin-close="${order.id}">Завершить после физического осмотра</button></div>` : ''}<details class="manager-chief-critical"><summary>Инцидент или отмена</summary><p>Используйте только для исключительных случаев. Все действия фиксируются в истории заявки.</p><div class="manager-actions">${incidentTools}${mayCancelUnissued ? `<button class="danger" data-cancel-unissued-order="${order.id}">Отменить до начала аренды</button>` : ''}${!['completed','cancelled','rejected','incident'].includes(order.status) ? `<button class="danger" data-admin-incident="${order.id}">Открыть инцидент</button>` : ''}${testTools}</div></details></details>` : '';
    const handoffPanel = archaIssueHandoffPanel(order);
    const documentsPanel = `<section class="manager-section"><h3>Документы</h3><div class="manager-docs">${order.documents.length ? order.documents.map(document => documentCard(document, order.id)).join('') : '<span class="manager-empty">Документы ещё не загружены</span>'}</div></section>`;
    const requestsPanel = order.requests.length ? `<section class="manager-section"><h3>Запросы клиента</h3><div class="manager-requests">${order.requests.map(request => `<div class="manager-request">${escape(request.kind)} · ${escape(request.status)}${request.return_method ? ` · ${escape(request.return_method)}` : ''}${request.return_locker_address ? ` · ${escape(request.return_locker_address)}` : ''}${request.customer_message ? ` · ${escape(request.customer_message)}` : ''}</div>`).join('')}</div></section>` : '';
    const directDocuments = pending ? (compactMobileQueue
      ? `<details class="manager-mobile-stage"><summary>Документы <small>${pending} на проверке</small></summary>${documentsPanel}</details>`
      : documentsPanel) : '';
    const details = `${pending ? '' : documentsPanel}${offerEvidence}${customerNote}${registry}${agreedPriceAction}${paymentState}${lockerInstruction(order)}${assetTools}${benefitPanel}${loyaltyAction}${earlySettlement}${adminTools}${requestsPanel}`;
    const acceptedReturnVideo = order.documents.some(document => document.kind === 'return_video' && document.status === 'accepted');
    const returnAcceptance = order.status === 'returned'
      ? (acceptedReturnVideo
        ? `<section class="manager-return-acceptance"><h3>Приёмка возврата и акт</h3><label for="return-condition-${order.id}">Состояние после физического осмотра <span>обязательно</span></label><textarea id="return-condition-${order.id}" data-return-acceptance-condition maxlength="2000" placeholder="Например: корпус и экран без повреждений, зарядка и комплект на месте.">${escape(order.return_condition_note || '')}</textarea><p>Проверьте ноутбук физически и видео возврата. После подтверждения это описание войдёт в акт приёма‑передачи, а аренда будет завершена.</p><button data-complete-return="${order.id}">Подтвердить приём и сформировать акт</button></section>`
        : `<section class="manager-return-acceptance"><h3>Приёмка возврата</h3><p>Сначала откройте и примите видео возврата клиента. После этого здесь появится поле осмотра и кнопка формирования акта.</p></section>`)
      : '';
    const archiveDraftAction = order.status === 'draft' ? `<section class="manager-section"><p>Документы ещё не присланы. Черновик не попадает в «В работе» и вернётся туда автоматически после загрузки файлов.</p>${order.draft_archived_at ? '<small>Отложено до документов.</small>' : `<button class="secondary" data-archive-draft="${order.id}">Отложить до документов</button>`}</section>` : '';
    const workflowActions = `${pending ? `<button class="secondary" data-reject-all="${order.id}">Отклонить все с причиной</button>` : ''}${archiveDraftAction}${extensionAction}${exchangeAction}${paymentAction}${manualPaymentAction}${archaControls(order)}${deliveryControls(order)}${paymentReadiness}${action ? `<button data-order-action="advance" data-order="${order.id}" data-next-status="${action.next}">${action.label}</button>` : ''}`;
    const deliveryDetails = order.delivery_type === 'delivery' && (order.delivery_address || order.delivery_preferred_time) ? `<br><small>${escape(order.delivery_address || 'Адрес уточняется')} · ${escape(order.delivery_preferred_time || 'время уточняется')}</small>` : order.locker_address ? `<br><small>${escape(order.locker_address)}</small>` : '';
    const orderIndex = list.findIndex(item => String(item.id) === String(order.id));
    const isSelected = String(order.id) === String(selectedOrderId);
    const previous = list[orderIndex - 1];
    const next = list[orderIndex + 1];
    const isMobileDetail = compactMobileQueue && isSelected;
    const mobileOrderHeader = isMobileDetail ? `<div class="manager-mobile-order-header"><button type="button" data-close-manager-order aria-label="Вернуться к очереди">← <span>Очередь</span></button><strong>Заявка ${escape(String(order.id).slice(0,8).toUpperCase())}</strong><button type="button" data-close-manager-order aria-label="Закрыть заявку">×</button></div>` : '';
    const queueNavigation = isSelected ? `<div class="manager-order-queue-nav" aria-label="Навигация по рабочей очереди"><span>${list.length > 1 ? `В очереди: ${orderIndex + 1} из ${list.length}` : 'Открыта заявка'}</span><div>${!isMobileDetail ? '<button class="manager-order-close" type="button" data-close-manager-order aria-label="Свернуть заявку">×</button>' : ''}${list.length > 1 ? `<button type="button" data-select-order="${escape(previous?.id || '')}" ${previous ? '' : 'disabled'} aria-label="Предыдущая заявка">←</button><button type="button" data-select-order="${escape(next?.id || '')}" ${next ? '' : 'disabled'} aria-label="Следующая заявка">→</button>` : ''}</div></div>` : '';
    const fresh = isFreshOrder(order);
    const detailsOpen = openOrderDetails.has(String(order.id)) || (!compactMobileQueue && (isSelected || (order.status === 'pending_review' && documentsReadyForPayment)));
    return `<article class="manager-order ${isSelected ? 'is-selected' : 'is-queued'}${isMobileDetail ? ' is-mobile-detail' : ''}${fresh ? ' is-new' : ''}" data-manager-order="${order.id}" data-manager-return-method="${escape(order.return_method || '')}">${mobileOrderHeader}<div class="manager-order-top"><div><h2>${escape(order.laptop_title)}</h2><p>Заявка ${escape(String(order.id).slice(0,8).toUpperCase())} · ${escape(order.customer_name || 'Клиент не указал имя')}</p><p class="manager-order-created">Поступила: ${escape(date(order.created_at))}</p></div><span class="manager-status-pill ${escape(order.status)}">${fresh ? '● НОВАЯ' : escape(statusLabel(order.status))}</span></div>${!isSelected ? `<button class="manager-order-open" type="button" data-open-manager-order="${escape(order.id)}">Открыть заявку <span>→</span></button>` : ''}${queueNavigation}<div class="manager-order-grid"><div><span>Клиент</span><strong>${escape(order.customer_phone || '—')}</strong></div><div><span>Аренда / возврат</span><strong>${calendarDate(order.rental_start_date)} → ${calendarDate(order.rental_end_date)}</strong></div><div><span>Получение</span><strong>${escape(deliveryLabel(order))}${deliveryDetails}</strong></div><div><span>Сумма аренды</span><strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div><div><span>Залог / скидка</span><strong>${Number(order.deposit_amount || 0).toLocaleString('ru-RU')} сом · ${Number(order.discount_percent || 0)}%</strong></div></div>${directDocuments}${alternativeSecurityPanel}${supportPanel}${returnAcceptance}${handoffPanel}${workflowActions ? `<div class="manager-actions manager-workflow-actions">${workflowActions}</div>` : ''}<p class="manager-order-feedback" data-order-feedback="${order.id}" hidden></p><details class="manager-order-details" ${detailsOpen ? 'open' : ''}><summary>Детали заявки, реестр и служебные данные</summary>${details}</details></article>`;
  }).join('') : '<div class="manager-empty">По этому фильтру заявок нет.</div>';
  if (compactMobileQueue) compactMobileOrderSections();
  window.requestAnimationFrame(() => {
    window.scrollTo({ top:scrollPosition, behavior:'auto' });
    if (String(selectedOrderId || '') !== selectedOrderBeforeRender) return;
    const selectedOrder = ordersEl.querySelector('.manager-order.is-selected');
    if (selectedOrder) selectedOrder.scrollTop = selectedOrderScrollTop;
  });
}

function compactMobileOrderSections() {
  ordersEl.querySelectorAll('.manager-order.is-selected .manager-order-details > section.manager-section').forEach(section => {
    const heading = section.querySelector(':scope > h3');
    if (!heading) return;
    const disclosure = document.createElement('details');
    disclosure.className = 'manager-mobile-stage';
    const summary = document.createElement('summary');
    summary.textContent = heading.textContent.trim();
    disclosure.append(summary);
    [...section.childNodes].forEach(node => { if (node !== heading) disclosure.append(node); });
    section.replaceWith(disclosure);
  });
}

function hasManagerDraft() {
  // Saved registry values must not pause live sync forever. Pause only while
  // a manager is actively typing or selecting a value.
  return Boolean(document.activeElement?.matches('.manager-order textarea, .manager-order input, .manager-order select'));
}
async function load(silent = false, include = '') { if (activeLoad) return activeLoad; const refreshLabel = refreshButton?.textContent; if (!silent) { statusEl.textContent = 'Обновляем заявки и статусы оплаты…'; if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = 'Обновляем…'; } } activeLoad = (async () => { try { const data = await api('GET', undefined, include); const incomingOrders = Array.isArray(data.orders) ? data.orders : null; if (!incomingOrders) throw new Error('Панель вернула неполные данные. Текущая очередь оставлена на экране.'); const keepVisibleQueue = orders.length > 0 && incomingOrders.length === 0; if (!keepVisibleQueue) orders = incomingOrders; rentableLaptops = Array.isArray(data.rentableLaptops) ? data.rentableLaptops : rentableLaptops; managerPromos = Array.isArray(data.promos) ? data.promos : managerPromos; b2bLeads = Array.isArray(data.b2bLeads) ? data.b2bLeads : b2bLeads; isChiefAdmin = Boolean(data.isChiefAdmin); if (catalogOpenButton) catalogOpenButton.hidden = !isChiefAdmin; if (sidebarCatalogButton) sidebarCatalogButton.hidden = !isChiefAdmin; gate.hidden = true; if (!catalogPanel.hidden || !promoPanel?.hidden) { renderPromoManager(); } else if (!b2bPanel?.hidden) { renderB2BManager(); } else if (helpPanel?.hidden) dashboard.hidden = false; const stamp = new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date()); statusEl.textContent = keepVisibleQueue ? `Связь с базой нестабильна: пустой ответ не применён. Показана последняя очередь · ${stamp}` : `${silent ? 'Синхронизировано' : 'Обновлено'}: ${stamp}`; render(); } catch (error) { if (error.status === 401) { dashboard.hidden = true; if (catalogOpenButton) catalogOpenButton.hidden = true; if (sidebarCatalogButton) sidebarCatalogButton.hidden = true; gate.hidden = false; statusEl.textContent = ''; return; } if (orders.length) { dashboard.hidden = false; gate.hidden = true; statusEl.textContent = `Не удалось обновить данные. Показана последняя очередь: ${error.message}`; return; } dashboard.hidden = true; gate.hidden = true; statusEl.textContent = error.message; } finally { if (!silent && refreshButton) { refreshButton.disabled = false; refreshButton.textContent = refreshLabel || 'Обновить'; } activeLoad = null; } })(); return activeLoad; }
function setMobileNav(open) {
  const wasOpen = document.body.classList.contains('manager-mobile-nav-open');
  if (open && !wasOpen) {
    mobileNavScrollY = window.scrollY;
    document.body.style.top = `-${mobileNavScrollY}px`;
  }
  managerSidebar?.classList.toggle('is-mobile-open', open);
  mobileNavBackdrop.hidden = !open;
  mobileNavToggle?.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('manager-mobile-nav-open', open);
  if (!open && wasOpen) {
    document.body.style.top = '';
    window.scrollTo({ top:mobileNavScrollY, behavior:'auto' });
  }
}
function setFilter(nextFilter) { if (!catalogPanel.hidden) catalogPanel.hidden = true; if (promoPanel && !promoPanel.hidden) promoPanel.hidden = true; if (b2bPanel && !b2bPanel.hidden) b2bPanel.hidden = true; if (helpPanel && !helpPanel.hidden) helpPanel.hidden = true; dashboard.hidden = false; filter = nextFilter; setMobileNav(false); document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item.dataset.filter === filter)); render(); }

refreshButton?.addEventListener('click', () => load(false));
window.setInterval(() => {
  // The manual refresh remains instant. Background refresh is deliberately
  // slow, and is entirely skipped while a manager edits a selected order.
  if (dashboard.hidden || hasManagerDraft()) return;
  load(true);
}, 60000);
testBakaiButton?.addEventListener('click', async () => {
  testBakaiButton.disabled = true;
  const original = testBakaiButton.textContent;
  testBakaiButton.textContent = 'Проверяем…';
  bakaiMessage('Запрашиваем токен Bakai. QR и платёж не создаются.');
  try {
    const result = await api('POST', { action:'check_bakai_connection' });
    bakaiMessage(result.message || 'Авторизация Bakai успешна.', 'success');
  } catch (error) {
    bakaiMessage(error.message, 'error');
  } finally {
    testBakaiButton.disabled = false;
    testBakaiButton.textContent = original;
  }
});
testTelegramButton?.addEventListener('click', async () => {
  testTelegramButton.disabled = true;
  const original = testTelegramButton.textContent;
  testTelegramButton.textContent = 'Отправляем…';
  bakaiMessage('Отправляем тест в Telegram…');
  try {
    const result = await api('POST', { action:'test_manager_notification' });
    bakaiMessage(result.message || 'Тест отправлен в Telegram.', 'success');
  } catch (error) {
    bakaiMessage(error.message, 'error');
  } finally {
    testTelegramButton.disabled = false;
    testTelegramButton.textContent = original;
  }
});
if (clearTestsButton) clearTestsButton.hidden = true;
document.querySelector('.manager-filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
mobileNavToggle?.addEventListener('click', () => setMobileNav(!managerSidebar?.classList.contains('is-mobile-open')));
mobileNavClose?.addEventListener('click', () => setMobileNav(false));
mobileNavBackdrop?.addEventListener('click', () => setMobileNav(false));
document.getElementById('manager-replacement-picker-close')?.addEventListener('click', closeReplacementPicker);
document.getElementById('manager-replacement-picker-cancel')?.addEventListener('click', closeReplacementPicker);
replacementPicker?.addEventListener('click', event => { if (event.target === replacementPicker) closeReplacementPicker(); });
replacementPickerSearch?.addEventListener('input', () => { replacementPickerState.query = replacementPickerSearch.value; renderReplacementPicker(); });
replacementPickerFilters?.addEventListener('click', event => { const button = event.target.closest('[data-replacement-filter]'); if (!button) return; replacementPickerState.filter = button.dataset.replacementFilter; renderReplacementPicker(); });
replacementPickerFilterSelect?.addEventListener('change', () => { replacementPickerState.filter = replacementPickerFilterSelect.value; renderReplacementPicker(); });
replacementPickerList?.addEventListener('click', event => { const option = event.target.closest('[data-replacement-option]'); if (!option) return; replacementPickerState.selectedId = option.dataset.replacementOption; renderReplacementPicker(); });
replacementPickerConfirm?.addEventListener('click', () => {
  if (!replacementPickerState.orderId || !replacementPickerState.selectedId) return;
  const orderId = String(replacementPickerState.orderId);
  const laptopId = String(replacementPickerState.selectedId);
  const laptop = rentableLaptops.find(item => String(item.id) === laptopId);
  replacementSelections.set(orderId, laptopId);
  const card = ordersEl.querySelector(`[data-manager-order="${orderId}"]`);
  const input = card?.querySelector('[data-prepayment-replacement-laptop]');
  const opener = card?.querySelector('[data-open-replacement-picker]');
  const recalculate = card?.querySelector('[data-replace-prepayment-laptop]');
  if (input) input.value = laptopId;
  if (opener && laptop) {
    const title = opener.querySelector('span');
    const detail = opener.querySelector('small');
    if (title) title.textContent = laptop.title;
    if (detail) detail.textContent = `${Number(laptop.daily_rate || laptop.dailyRate || 0).toLocaleString('ru-RU')} сом/день · изменить`;
  }
  if (recalculate) recalculate.disabled = false;
  closeReplacementPicker();
});
document.addEventListener('touchmove', event => {
  if (document.body.classList.contains('manager-mobile-nav-open') && !managerSidebar?.contains(event.target)) event.preventDefault();
}, { passive:false });
document.querySelector('.manager-sidebar-nav')?.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); const dashboardButton = event.target.closest('[data-open-dashboard]'); if (dashboardButton) setFilter('all'); });
statsEl.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
returnAlert?.addEventListener('click', () => { setFilter('returns'); document.querySelector('.manager-toolbar')?.scrollIntoView({ behavior:'smooth', block:'start' }); });
searchInput?.addEventListener('input', render);
function updatePaymentDraft(form) {
  if (!form) return;
  const orderId = String(form.dataset.paymentDraft || '');
  if (!orderId) return;
  const rentalAmount = Math.max(0, Number(form.querySelector('[data-payment-rental]')?.value || 0));
  const depositAmount = Math.max(0, Number(form.querySelector('[data-payment-deposit]')?.value || 0));
  const deliveryMode = form.querySelector('[data-delivery-charge-mode]')?.value || 'external';
  const deliveryFee = deliveryMode === 'rentop' ? Math.max(0, Number(form.querySelector('[data-delivery-fee]')?.value || 0)) : 0;
  paymentDrafts.set(orderId, { rentalAmount, depositAmount, deliveryFee, deliveryMode });
  const feeInput = form.querySelector('[data-delivery-fee]');
  if (feeInput) feeInput.disabled = deliveryMode !== 'rentop';
  const summary = form.querySelector('[data-payment-summary]');
  if (summary) summary.textContent = `QR-счёт: ${(rentalAmount + depositAmount + deliveryFee).toLocaleString('ru-RU')} сом · аренда ${rentalAmount.toLocaleString('ru-RU')} + залог ${depositAmount.toLocaleString('ru-RU')}${deliveryMode === 'rentop' && deliveryFee ? ` + доставка ${deliveryFee.toLocaleString('ru-RU')}` : deliveryMode === 'external' && form.querySelector('[data-delivery-charge-mode]') ? ' · доставка оплачивается курьеру отдельно' : ''}.`;
}
ordersEl?.addEventListener('input', event => {
  const field = event.target.closest('[data-payment-rental], [data-payment-deposit], [data-delivery-fee]');
  if (field) updatePaymentDraft(field.closest('[data-payment-draft]'));
});
ordersEl?.addEventListener('change', event => {
  const field = event.target.closest('[data-delivery-charge-mode]');
  if (field) updatePaymentDraft(field.closest('[data-payment-draft]'));
});
ordersEl.addEventListener('click', async event => {
  const closeOrder = event.target.closest('[data-close-manager-order]');
  if (closeOrder) { setMobileOrderView(false); selectedOrderId = ''; render(); return; }
  const explicitOpen = event.target.closest('[data-open-manager-order]');
  if (explicitOpen?.dataset.openManagerOrder) { selectedOrderId = explicitOpen.dataset.openManagerOrder; setMobileOrderView(true); render(); return; }
  const replacementOpen = event.target.closest('[data-open-replacement-picker]');
  if (replacementOpen?.dataset.openReplacementPicker) { openReplacementPicker(replacementOpen.dataset.openReplacementPicker); return; }
  const queueSelection = event.target.closest('[data-select-order]');
  if (queueSelection && !queueSelection.disabled && queueSelection.dataset.selectOrder) {
    selectedOrderId = queueSelection.dataset.selectOrder;
    render();
    return;
  }
  const orderCard = event.target.closest('.manager-order');
  const isControl = event.target.closest('button, a, input, textarea, select, summary, label');
  // Compact queue cards are a single selection target. Let a tap anywhere on
  // an unselected card open it, even if the tap lands on its status label.
  if (!window.matchMedia('(max-width: 760px)').matches && orderCard && (!isControl || !orderCard.classList.contains('is-selected'))) {
    selectedOrderId = orderCard.dataset.managerOrder;
    render();
    return;
  }
  const preview = event.target.closest('[data-document-view]');
  if (preview) {
    const original = preview.textContent;
    preview.disabled = true;
    preview.textContent = 'Открываем…';
    try {
      const result = await api('POST', { action:'create_document_download', orderId:preview.dataset.order, documentId:preview.dataset.documentView });
      openDocumentViewer(result.viewUrl, result.fileName || preview.dataset.documentName, result.contentType || preview.dataset.documentType);
    } catch (error) {
      statusEl.textContent = error.message;
    } finally {
      preview.disabled = false;
      preview.textContent = original;
    }
    return;
  }
  const copyHandoff = event.target.closest('[data-copy-handoff]');
  if (copyHandoff) {
    const field = copyHandoff.closest('.manager-handoff-primary')?.querySelector('[data-handoff-text]');
    const text = field?.value || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyHandoff.textContent = 'Скопировано';
      window.setTimeout(() => { copyHandoff.textContent = 'Скопировать текст для ARCHA POINT'; }, 1800);
    } catch {
      field?.focus(); field?.select();
      window.alert('Не удалось скопировать автоматически. Текст выделен — скопируйте его вручную.');
    }
    return;
  }
  const rejectAll = event.target.closest('[data-reject-all]');
  const createPayment = event.target.closest('[data-create-payment]');
  const createReservationPayment = event.target.closest('[data-create-reservation-payment]');
  const createBalancePayment = event.target.closest('[data-create-balance-payment]');
  const createExtensionPayment = event.target.closest('[data-create-extension-payment]');
  const approveFreeExtension = event.target.closest('[data-approve-free-extension]');
  const confirmReturnCollected = event.target.closest('[data-confirm-return-collected]');
  const saveReturnHandoff = event.target.closest('[data-save-return-handoff]');
  const confirmReplacementExchange = event.target.closest('[data-confirm-replacement-exchange]');
  const rejectExtension = event.target.closest('[data-reject-extension]');
  const revokePayment = event.target.closest('[data-revoke-payment]');
  const manualPayment = event.target.closest('[data-manual-payment]');
  const prepareArcha = event.target.closest('[data-prepare-archa]');
  const recordArchaReservation = event.target.closest('[data-record-archa-reservation]');
  const markLockerLoaded = event.target.closest('[data-mark-locker-loaded]');
  const markDeliveryDispatched = event.target.closest('[data-mark-delivery-dispatched]');
  const sendDeliveryMessage = event.target.closest('[data-send-delivery-message]');
  const archaSmsSent = event.target.closest('[data-archa-sms-sent]');
  const manualPickupCode = event.target.closest('[data-manual-pickup-code]');
  const manualReturnCode = event.target.closest('[data-manual-return-code]');
  const confirmCourierReturnDropoff = event.target.closest('[data-confirm-courier-return-dropoff]');
  const prepareArchaReturn = event.target.closest('[data-prepare-archa-return]');
  const completeReturn = event.target.closest('[data-complete-return]');
  const adminClose = event.target.closest('[data-admin-close]');
  const cancelUnissuedOrder = event.target.closest('[data-cancel-unissued-order]');
  const replacePrepaymentLaptop = event.target.closest('[data-replace-prepayment-laptop]');
  const offerPrepaymentReplacement = event.target.closest('[data-offer-prepayment-replacement]');
  const adminIncident = event.target.closest('[data-admin-incident]');
  const adminResolveIncident = event.target.closest('[data-admin-resolve-incident]');
  const adminOfferIncidentReplacement = event.target.closest('[data-admin-offer-incident-replacement]');
  const markTestOrder = event.target.closest('[data-mark-test-order]');
  const deleteTestOrder = event.target.closest('[data-delete-test-order]');
  const saveAsset = event.target.closest('[data-save-asset]');
  const saveRegistry = event.target.closest('[data-save-registry]');
  const saveAgreedRentalPrice = event.target.closest('[data-save-agreed-rental-price]');
  const issuePromo = event.target.closest('[data-issue-promo]');
  const resolveSupport = event.target.closest('[data-resolve-support]');
  const replySupport = event.target.closest('[data-reply-support]');
  const offerAlternativeSecurity = event.target.closest('[data-offer-alternative-security]');
  const decideAlternativeSecurity = event.target.closest('[data-decide-alternative-security]');
  const settleEarlyReturn = event.target.closest('[data-settle-early-return]');
  const archiveDraft = event.target.closest('[data-archive-draft]');
  const button = event.target.closest('[data-document], [data-order-action]');
  if (!rejectAll && !createPayment && !createReservationPayment && !createBalancePayment && !createExtensionPayment && !approveFreeExtension && !confirmReturnCollected && !saveReturnHandoff && !confirmReplacementExchange && !rejectExtension && !revokePayment && !manualPayment && !prepareArcha && !recordArchaReservation && !markLockerLoaded && !markDeliveryDispatched && !sendDeliveryMessage && !archaSmsSent && !manualPickupCode && !manualReturnCode && !confirmCourierReturnDropoff && !prepareArchaReturn && !completeReturn && !adminClose && !cancelUnissuedOrder && !replacePrepaymentLaptop && !offerPrepaymentReplacement && !adminIncident && !adminResolveIncident && !adminOfferIncidentReplacement && !markTestOrder && !deleteTestOrder && !saveAsset && !saveRegistry && !saveAgreedRentalPrice && !issuePromo && !resolveSupport && !replySupport && !offerAlternativeSecurity && !decideAlternativeSecurity && !settleEarlyReturn && !archiveDraft && !button) return;
  const target = rejectAll || createPayment || createReservationPayment || createBalancePayment || createExtensionPayment || approveFreeExtension || confirmReturnCollected || saveReturnHandoff || confirmReplacementExchange || rejectExtension || revokePayment || manualPayment || prepareArcha || recordArchaReservation || markLockerLoaded || markDeliveryDispatched || sendDeliveryMessage || archaSmsSent || manualPickupCode || manualReturnCode || confirmCourierReturnDropoff || prepareArchaReturn || completeReturn || adminClose || cancelUnissuedOrder || replacePrepaymentLaptop || offerPrepaymentReplacement || adminIncident || adminResolveIncident || adminOfferIncidentReplacement || markTestOrder || deleteTestOrder || saveAsset || saveRegistry || saveAgreedRentalPrice || issuePromo || resolveSupport || replySupport || offerAlternativeSecurity || decideAlternativeSecurity || settleEarlyReturn || archiveDraft || button;
  if (target.disabled) return;
  const feedback = target.closest('.manager-order')?.querySelector('[data-order-feedback]');
  const showFeedback = (text, type = '') => { if (!feedback) return; feedback.textContent = text; feedback.className = `manager-order-feedback${type ? ` is-${type}` : ''}`; feedback.hidden = !text; };
  let payload;
  let successMessage;
  if (rejectAll) {
    const note = window.prompt('Напишите причину отклонения. Она будет показана клиенту:');
    if (!note?.trim()) return;
    payload = { action:'reject_all_documents', orderId:rejectAll.dataset.rejectAll, note:note.trim() };
    successMessage = 'Документы отклонены, причина отправлена клиенту.';
  } else if (saveAgreedRentalPrice) {
    const card = saveAgreedRentalPrice.closest('.manager-order');
    const agreedAmount = Number(card?.querySelector('[data-agreed-rental-amount]')?.value);
    const note = card?.querySelector('[data-agreed-rental-note]')?.value?.trim() || '';
    if (!Number.isFinite(agreedAmount) || agreedAmount <= 0) { showFeedback('Укажите согласованную сумму аренды.', 'error'); return; }
    if (note.length < 3) { showFeedback('Укажите короткую причину договорённости по цене.', 'error'); return; }
    if (!window.confirm(`Сохранить согласованную цену аренды ${agreedAmount.toLocaleString('ru-RU')} сом? Эту сумму будут использовать полный QR, бронь и доплата.`)) return;
    payload = { action:'set_agreed_rental_price', orderId:saveAgreedRentalPrice.dataset.saveAgreedRentalPrice, agreedAmount, note };
    successMessage = 'Согласованная цена сохранена в заявке.';
  } else if (offerAlternativeSecurity) {
    const card = offerAlternativeSecurity.closest('.manager-order');
    const requirements = [...(card?.querySelectorAll('[data-alternative-security-requirement]:checked') || [])].map(item => item.value);
    const note = card?.querySelector('[data-alternative-security-note]')?.value?.trim() || '';
    if (!window.confirm('Открыть клиенту отдельный защищённый шаг дополнительной проверки? Видеообращение будет обязательным.')) return;
    payload = { action:'offer_alternative_security', orderId:offerAlternativeSecurity.dataset.offerAlternativeSecurity, requirements, note };
    successMessage = 'Клиенту открыт шаг дополнительной проверки без залога.';
  } else if (decideAlternativeSecurity) {
    const card = decideAlternativeSecurity.closest('.manager-order');
    const decision = decideAlternativeSecurity.dataset.alternativeSecurityDecision;
    const note = card?.querySelector('[data-alternative-security-note]')?.value?.trim() || '';
    if (decision === 'approved' && !window.confirm('Одобрить выдачу без денежного залога? Это не отменяет ответственность арендатора.')) return;
    if (decision === 'rejected' && note.length < 3) { showFeedback('Укажите короткую причину отказа для клиента.', 'error'); return; }
    payload = { action:'decide_alternative_security', orderId:decideAlternativeSecurity.dataset.decideAlternativeSecurity, decision, note };
    successMessage = decision === 'approved' ? 'Дополнительная проверка одобрена: залог установлен в 0 сом.' : 'Отказ сохранён и показан клиенту.';
  } else if (settleEarlyReturn) {
    const card = settleEarlyReturn.closest('.manager-order');
    const settlementType = card?.querySelector('[data-early-settlement-type]')?.value || '';
    const amount = Number(card?.querySelector('[data-early-settlement-amount]')?.value || 0);
    const note = card?.querySelector('[data-early-settlement-note]')?.value?.trim() || '';
    if (settlementType === 'partial_refund' && (!Number.isFinite(amount) || amount <= 0)) { showFeedback('Для частичного возврата укажите сумму больше 0.', 'error'); return; }
    if (note.length < 3) { showFeedback('Кратко зафиксируйте договорённость с клиентом.', 'error'); return; }
    if (!window.confirm('Зафиксировать решение по досрочному возврату? Это не совершает банковский перевод автоматически.')) return;
    payload = { action:'settle_early_return', orderId:settleEarlyReturn.dataset.settleEarlyReturn, settlementType, amount, note };
    successMessage = 'Решение по досрочному возврату записано в историю заявки.';
  } else if (createPayment) {
    const form = createPayment.closest('[data-payment-draft]');
    updatePaymentDraft(form);
    const draft = paymentDrafts.get(String(createPayment.dataset.createPayment)) || {};
    const rentalAmount = Number(draft.rentalAmount);
    const depositAmount = Number(draft.depositAmount);
    const deliveryFee = Number(draft.deliveryMode === 'rentop' ? draft.deliveryFee : 0);
    if (!Number.isFinite(rentalAmount) || rentalAmount < 0 || !Number.isFinite(depositAmount) || depositAmount < 0 || rentalAmount + depositAmount <= 0) { statusEl.textContent = 'Укажите сумму аренды или возвратного залога.'; return; }
    if (!Number.isFinite(deliveryFee) || deliveryFee < 0) { statusEl.textContent = 'Проверьте стоимость доставки.'; return; }
    const total = rentalAmount + depositAmount + deliveryFee;
    if (!window.confirm(`Создать настоящий QR-счёт Bakai на ${total.toLocaleString('ru-RU')} сом? Деньги не спишутся сейчас, но QR можно будет оплатить.`)) return;
    payload = { action:'create_bakai_payment', orderId:createPayment.dataset.createPayment, rentalAmount, depositAmount, deliveryFee, deliveryChargeMode:draft.deliveryMode || 'external' };
    successMessage = 'QR-счёт Bakai создан и показан клиенту в личном кабинете.';
  } else if (createReservationPayment) {
    const form = createReservationPayment.closest('[data-payment-draft]');
    const amount = Number(form?.querySelector('[data-reservation-amount]')?.value);
    if (!Number.isFinite(amount) || amount <= 0) { showFeedback('Введите корректную сумму предоплаты.', 'error'); return; }
    if (!window.confirm(`Выставить QR предоплаты на ${amount.toLocaleString('ru-RU')} сом? После оплаты ноутбук будет забронирован на даты клиента.`)) return;
    payload = { action:'create_reservation_bakai_payment', orderId:createReservationPayment.dataset.createReservationPayment, amount };
    successMessage = 'QR предоплаты создан. После оплаты заявка станет забронированной.';
  } else if (createBalancePayment) {
    if (!window.confirm('Выставить клиенту QR на остаток аренды и залог перед выдачей?')) return;
    payload = { action:'create_balance_bakai_payment', orderId:createBalancePayment.dataset.createBalancePayment };
    successMessage = 'QR доплаты создан и показан клиенту.';
  } else if (archiveDraft) {
    if (!window.confirm('Отложить эту заявку до загрузки документов? После загрузки она автоматически вернётся в рабочую очередь.')) return;
    payload = { action:'archive_draft_order', orderId:archiveDraft.dataset.archiveDraft };
    successMessage = 'Черновик отложен до документов.';
  } else if (createExtensionPayment) {
    const amount = Number(createExtensionPayment.closest('.manager-order')?.querySelector('[data-extension-payment-amount]')?.value);
    if (!Number.isFinite(amount) || amount <= 0) { showFeedback('Введите корректную доплату за продление.', 'error'); return; }
    if (!window.confirm(`Создать отдельный QR продления на ${amount.toLocaleString('ru-RU')} сом? Залог повторно не взимается.`)) return;
    payload = { action:'create_extension_bakai_payment', orderId:createExtensionPayment.dataset.createExtensionPayment, requestId:createExtensionPayment.dataset.requestId, amount };
    successMessage = 'QR продления создан и показан клиенту.';
  } else if (approveFreeExtension) {
    if (!window.confirm('Подтвердить продление без доплаты? Срок аренды обновится, а действие будет записано в журнале.')) return;
    payload = { action:'approve_free_extension', orderId:approveFreeExtension.dataset.approveFreeExtension, requestId:approveFreeExtension.dataset.requestId };
    successMessage = 'Продление без доплаты подтверждено.';
  } else if (confirmReturnCollected) {
    if (!window.confirm('Подтвердить, что ноутбук физически получен? После этого останется итоговый осмотр и акт.')) return;
    payload = { action:'confirm_return_collected', orderId:confirmReturnCollected.dataset.confirmReturnCollected };
    successMessage = 'Физическое получение отмечено. Проведите итоговый осмотр.';
  } else if (saveReturnHandoff) {
    const card = saveReturnHandoff.closest('.manager-order');
    const destinationAddress = card?.querySelector('[data-return-destination-address]')?.value?.trim() || '';
    const destinationNote = card?.querySelector('[data-return-destination-note]')?.value?.trim() || '';
    if (destinationAddress.length < 8) { showFeedback('Укажите полный адрес приёма для клиента.', 'error'); return; }
    payload = { action:'save_return_handoff', orderId:saveReturnHandoff.dataset.saveReturnHandoff, destinationAddress, destinationNote };
    successMessage = 'Адрес приёма сохранён — клиент увидит его в личном кабинете.';
  } else if (confirmReplacementExchange) {
    const card = confirmReplacementExchange.closest('.manager-order');
    const method = card?.querySelector('[data-replacement-exchange-method]')?.value;
    const note = card?.querySelector('[data-replacement-exchange-note]')?.value?.trim();
    if (!window.confirm('Подтвердить только после фактического получения старого и передачи нового ноутбука?')) return;
    payload = { action:'confirm_replacement_exchange', orderId:confirmReplacementExchange.dataset.confirmReplacementExchange, method, note };
    successMessage = 'Физическая замена подтверждена, в аренде отражена новая модель.';
  } else if (rejectExtension) {
    const reason = window.prompt('Причина отказа. Клиент увидит её сразу и сможет повторить запрос или подобрать замену:', 'Продление не согласовано: ноутбук уже забронирован на последующие даты. Нажмите «Подобрать замену / повторить», чтобы сайт показал свободные модели.');
    if (!reason?.trim()) return;
    if (!window.confirm('Отклонить запрос с этой причиной? Клиент сразу увидит объяснение и действия для новой попытки.')) return;
    payload = { action:'reject_extension_request', orderId:rejectExtension.dataset.rejectExtension, requestId:rejectExtension.dataset.requestId, reason };
    successMessage = 'Продление отклонено: клиент увидит вашу причину и сможет повторить запрос или выбрать замену.';
  } else if (revokePayment) {
    if (!window.confirm('Отозвать QR из кабинета клиента? Bakai не отменяет уже созданный QR, поэтому поздняя оплата не подтвердит заявку автоматически.')) return;
    payload = { action:'revoke_bakai_payment', orderId:revokePayment.dataset.revokePayment };
    successMessage = 'QR отозван из кабинета клиента. При необходимости можно создать новый счёт.';
  } else if (manualPayment) {
    const reference = window.prompt('Проверьте поступление в Bakai Business. Введите ID банковской операции или служебную пометку для журнала:');
    if (!reference?.trim()) return;
    if (!window.confirm('Подтвердить оплату вручную? QR исчезнет у клиента, а заявка перейдёт к подготовке выдачи.')) return;
    payload = { action:'confirm_bakai_payment_manually', orderId:manualPayment.dataset.manualPayment, reference:reference.trim() };
    successMessage = 'Оплата подтверждена вручную и зафиксирована в журнале.';
  } else if (prepareArcha) {
    payload = { action:'prepare_archa_handoff', orderId:prepareArcha.dataset.prepareArcha };
    successMessage = 'Сообщение для ARCHA POINT подготовлено.';
  } else if (recordArchaReservation) {
    const card = recordArchaReservation.closest('.manager-order');
    const loadingCode = card?.querySelector('[data-archa-loading-code]')?.value?.trim();
    const reference = card?.querySelector('[data-archa-reference]')?.value?.trim();
    if (!loadingCode) { showFeedback('Введите код закладки, который прислал ARCHA POINT.', 'error'); return; }
    payload = { action:'record_archa_reservation', orderId:recordArchaReservation.dataset.recordArchaReservation, loadingCode, reference };
    successMessage = 'Резерв ячейки сохранён. Можно закладывать ноутбук.';
  } else if (markLockerLoaded) {
    if (!window.confirm('Подтвердите только после фактической закладки ноутбука, зарядки и комплекта в ячейку.')) return;
    payload = { action:'mark_locker_loaded', orderId:markLockerLoaded.dataset.markLockerLoaded };
    successMessage = 'Закладка зафиксирована. Ожидаем SMS-код клиенту от ARCHA POINT.';
  } else if (markDeliveryDispatched) {
    const dispatchMode = markDeliveryDispatched.closest('.manager-order')?.querySelector('[data-delivery-dispatch-mode]')?.value || '';
    if (!window.confirm('Подтвердите только после согласования времени и стоимости, когда ноутбук действительно вышел к клиенту. Срок аренды начнётся лишь после подтверждения клиента.')) return;
    payload = { action:'mark_delivery_dispatched', orderId:markDeliveryDispatched.dataset.markDeliveryDispatched, dispatchMode };
    successMessage = dispatchMode === 'third_party_courier' ? 'Передача стороннему курьеру отмечена. Клиент увидит статус «Ноутбук в пути».' : 'Передача курьеру Rentop отмечена. Клиент увидит статус «Ноутбук в пути».';
  } else if (sendDeliveryMessage) {
    const card = sendDeliveryMessage.closest('.manager-order');
    const message = card?.querySelector('[data-delivery-client-message]')?.value?.trim() || '';
    if (message.length < 3) { showFeedback('Напишите клиенту сообщение хотя бы несколькими словами.', 'error'); return; }
    payload = { action:'send_delivery_message', orderId:sendDeliveryMessage.dataset.sendDeliveryMessage, message };
    successMessage = 'Сообщение отправлено в личный кабинет клиента.';
  } else if (manualPickupCode) {
    const code = window.prompt('Введите код получения, подтверждённый у ARCHA POINT. Он будет отправлен клиенту по SMS через Rentop:');
    if (!code?.trim()) return;
    if (!window.confirm('Отправить этот код клиенту по SMS? Убедитесь, что он получен у ARCHA POINT и относится к этой заявке.')) return;
    payload = { action:'send_manual_pickup_code', orderId:manualPickupCode.dataset.manualPickupCode, code:code.trim() };
    successMessage = 'Код отправлен клиенту по SMS и зафиксирован в журнале.';
  } else if (manualReturnCode) {
    const card = manualReturnCode.closest('.manager-order');
    const courierReturn = card?.dataset.managerReturnMethod === 'arca_courier';
    const code = window.prompt(courierReturn ? 'Введите код возврата, подтверждённый у ARCHA POINT. Он будет отправлен согласованному курьеру по SMS через Rentop:' : 'Введите код возврата, подтверждённый у ARCHA POINT. Он будет отправлен клиенту по SMS через Rentop:');
    if (!code?.trim()) return;
    const courierPhone = courierReturn ? window.prompt('Введите номер фактически назначенного курьера. Код отправится только на него:') : '';
    if (courierReturn && !courierPhone?.trim()) return;
    if (!window.confirm(courierReturn ? 'Отправить код возврата назначенному курьеру по SMS? Убедитесь, что он относится к возвратной ячейке этой заявки.' : 'Отправить резервный код возврата клиенту по SMS? Убедитесь, что код относится именно к возвратной ячейке этой заявки.')) return;
    payload = { action:'send_manual_return_code', orderId:manualReturnCode.dataset.manualReturnCode, code:code.trim(), courierPhone:courierPhone?.trim() };
    successMessage = courierReturn ? 'Код возврата отправлен назначенному курьеру и зафиксирован в журнале.' : 'Резервный код возврата отправлен клиенту по SMS и зафиксирован в журнале.';
  } else if (confirmCourierReturnDropoff) {
    if (!window.confirm('Подтвердите только после сообщения курьера, что ноутбук помещён именно в возвратную ячейку ARCHA POINT. После этого остаётся физически забрать ноутбук и провести акт.')) return;
    payload = { action:'confirm_archa_courier_return_dropoff', orderId:confirmCourierReturnDropoff.dataset.confirmCourierReturnDropoff };
    successMessage = 'Помещение в ячейку отмечено. Заберите ноутбук из постамата и проведите итоговый осмотр.';
  } else if (prepareArchaReturn) {
    payload = { action:'prepare_archa_return_handoff', orderId:prepareArchaReturn.dataset.prepareArchaReturn };
    successMessage = 'Сообщение о возврате для ARCHA POINT подготовлено.';
  } else if (completeReturn) {
    const card = completeReturn.closest('.manager-order');
    const returnConditionNote = card?.querySelector('[data-return-acceptance-condition]')?.value?.trim() || card?.querySelector('[data-registry-return]')?.value?.trim() || '';
    if (returnConditionNote.length < 3) { showFeedback('После осмотра заполните «Состояние при возврате» — корпус, экран, зарядка и комплектность.', 'error'); return; }
    if (!window.confirm('Подтвердите: ноутбук физически получен, видео принято и состояние описано. Будет создан акт приёма-передачи и аренда завершится.')) return;
    payload = { action:'complete_return_acceptance', orderId:completeReturn.dataset.completeReturn, returnConditionNote };
    successMessage = 'Приём ноутбука и акт зафиксированы. Аренда завершена.';
  } else if (adminClose) {
    const reason = window.prompt('Причина досрочного завершения. Подтвердите, что ноутбук физически возвращён и видео принято:');
    if (!reason?.trim()) return;
    if (!window.confirm('Завершить аренду досрочно? Действие будет записано в журнале главного администратора.')) return;
    payload = { action:'admin_close_rental_early', orderId:adminClose.dataset.adminClose, reason:reason.trim() };
    successMessage = 'Аренда досрочно завершена и зафиксирована в журнале.';
  } else if (cancelUnissuedOrder) {
    const reason = window.prompt('Почему заявка отменяется? Эта причина сохранится в истории и будет видна клиенту в кабинете:');
    if (!reason?.trim()) return;
    if (!window.confirm('Отменить эту заявку до начала аренды? Она останется в истории, но больше не будет числиться готовой к выдаче.')) return;
    payload = { action:'admin_cancel_unissued_order', orderId:cancelUnissuedOrder.dataset.cancelUnissuedOrder, reason:reason.trim() };
    successMessage = 'Заявка отменена и сохранена в истории.';
  } else if (replacePrepaymentLaptop) {
    const card = replacePrepaymentLaptop.closest('.manager-order');
    const laptopId = Number(card?.querySelector('[data-prepayment-replacement-laptop]')?.value);
    if (!Number.isInteger(laptopId)) { showFeedback('Выберите новую модель из списка.', 'error'); return; }
    const reason = window.prompt('Коротко укажите причину замены модели для журнала:', 'По согласованию с клиентом');
    if (!reason?.trim()) return;
    if (!window.confirm('Заменить модель до выставления счёта? Система проверит занятость и пересчитает сумму аренды.')) return;
    payload = { action:'admin_replace_pre_payment_laptop', orderId:replacePrepaymentLaptop.dataset.replacePrepaymentLaptop, laptopId, reason:reason.trim() };
    successMessage = 'Модель заменена, доступность и сумма аренды пересчитаны.';
  } else if (offerPrepaymentReplacement) {
    const card = offerPrepaymentReplacement.closest('.manager-order');
    const laptopId = Number(card?.querySelector('[data-prepayment-replacement-laptop]')?.value);
    if (!Number.isInteger(laptopId)) { showFeedback('Выберите модель, которую нужно предложить клиенту.', 'error'); return; }
    const reason = String(card?.querySelector('[data-prepayment-replacement-reason]')?.value || '').trim();
    if (!reason) { showFeedback('Напишите понятную клиенту причину предложения.', 'error'); return; }
    if (!window.confirm('Отправить клиенту предложение замены? Заявка и сумма изменятся только после его согласия.')) return;
    payload = { action:'admin_offer_pre_payment_replacement', orderId:offerPrepaymentReplacement.dataset.offerPrepaymentReplacement, laptopId, reason };
    successMessage = 'Предложение отправлено клиенту. Ожидаем его согласия — модель в заявке пока не менялась.';
  } else if (adminIncident) {
    const reason = window.prompt('Опишите инцидент. Ноутбук останется заблокированным в учёте до решения:');
    if (!reason?.trim()) return;
    if (!window.confirm('Открыть инцидент по этой заявке?')) return;
    payload = { action:'admin_open_incident', orderId:adminIncident.dataset.adminIncident, reason:reason.trim() };
    successMessage = 'Инцидент открыт. Заявка требует решения главного администратора.';
  } else if (adminOfferIncidentReplacement) {
    const card = adminOfferIncidentReplacement.closest('.manager-order');
    const replacementLaptopId = Number(card?.querySelector('[data-incident-replacement-laptop]')?.value);
    const faultParty = card?.querySelector('[data-incident-fault-party]')?.value;
    const method = card?.querySelector('[data-incident-method]')?.value;
    if (!Number.isInteger(replacementLaptopId)) { showFeedback('Выберите модель для замены.', 'error'); return; }
    if (!window.confirm('Предложить эту замену? Модель будет зарезервирована, но аренда не переключится до физической передачи.')) return;
    payload = { action:'admin_offer_incident_replacement', orderId:adminOfferIncidentReplacement.dataset.adminOfferIncidentReplacement, replacementLaptopId, faultParty, method, reason:'Замена по открытому инциденту' };
    successMessage = 'Модель зарезервирована для инцидента. Подтвердите физическую передачу после обмена.';
  } else if (markTestOrder) {
    if (!window.confirm('Пометить эту заявку как тестовую? После этого её можно будет удалить. Не используйте для реального клиента.')) return;
    payload = { action:'mark_test_order', orderId:markTestOrder.dataset.markTestOrder };
    successMessage = 'Заявка помечена как тестовая.';
  } else if (deleteTestOrder) {
    const reference = String(deleteTestOrder.dataset.orderReference || '').toUpperCase();
    const confirmation = window.prompt(`Это окончательно удалит тестовую заявку и её загруженные файлы. Введите номер заявки ${reference}, чтобы подтвердить:`);
    if (String(confirmation || '').trim().toUpperCase() !== reference) { showFeedback('Удаление отменено: номер заявки не совпал.', 'error'); return; }
    payload = { action:'delete_test_order', orderId:deleteTestOrder.dataset.deleteTestOrder, confirmation:reference };
    successMessage = 'Тестовая заявка удалена.';
  } else if (adminResolveIncident) {
    const selection = window.prompt('Как разрешить инцидент?\n1 — вернуть аренду в активное состояние\n2 — подтвердить возврат на проверку\n3 — отменить до выдачи', '1');
    const outcome = ({ '1':'in_use', '2':'returned', '3':'cancelled' })[String(selection || '').trim()];
    if (!outcome) return;
    const reason = window.prompt('Укажите причину и фактическое решение по инциденту:');
    if (!reason?.trim()) return;
    if (!window.confirm('Разрешить инцидент? Решение и причина останутся в журнале.')) return;
    payload = { action:'admin_resolve_incident', orderId:adminResolveIncident.dataset.adminResolveIncident, outcome, reason:reason.trim() };
    successMessage = 'Инцидент разрешён, решение зафиксировано.';
  } else if (saveAsset) {
    const card = saveAsset.closest('.manager-order');
    const serialNumber = card?.querySelector('[data-asset-serial]')?.value?.trim() || '';
    const inventoryCode = card?.querySelector('[data-asset-inventory]')?.value?.trim() || '';
    if (!serialNumber && !inventoryCode) { showFeedback('Укажите хотя бы один идентификатор устройства.', 'error'); return; }
    payload = { action:'admin_update_laptop_asset', laptopId:saveAsset.dataset.saveAsset, serialNumber, inventoryCode };
    successMessage = 'Идентификаторы устройства сохранены.';
  } else if (saveRegistry) {
    const card = saveRegistry.closest('.manager-order');
    payload = { action:'save_order_registry', orderId:saveRegistry.dataset.saveRegistry, residenceAddress:card?.querySelector('[data-registry-residence]')?.value || '', supportingDocumentType:card?.querySelector('[data-registry-supporting-type]')?.value || '', rentalPurpose:card?.querySelector('[data-registry-purpose]')?.value || '', managerNote:card?.querySelector('[data-registry-note]')?.value || '', returnConditionNote:card?.querySelector('[data-registry-return]')?.value || '', identityDocumentNumber:card?.querySelector('[data-registry-identity-number]')?.value || '', identityDocumentIssuer:card?.querySelector('[data-registry-identity-issuer]')?.value || '' };
    successMessage = 'Сверка документов и внутренний реестр сохранены. Если все обязательные файлы приняты, подтвердите сверку и перейдите к выставлению оплаты.';
  } else if (issuePromo) {
    const discountPercent = Number(window.prompt('Выберите персональную скидку: 5, 10, 15 или 20 процентов.', '10'));
    if (![5, 10, 15, 20].includes(discountPercent)) { showFeedback('Допустимы скидки: 5%, 10%, 15% или 20%.', 'error'); return; }
    if (!window.confirm(`Выдать этому клиенту персональный промокод на ${discountPercent}%?`)) return;
    payload = { action:'issue_loyalty_promo', orderId:issuePromo.dataset.issuePromo, discountPercent };
    successMessage = 'Персональный промокод создан и появится у клиента в личном кабинете.';
  } else if (resolveSupport) {
    if (!window.confirm('Отметить это обращение как решённое?')) return;
    payload = { action:'resolve_support_case', orderId:resolveSupport.dataset.resolveSupport, kind:resolveSupport.dataset.supportKind };
    successMessage = 'Обращение отмечено как решённое.';
  } else if (replySupport) {
    const card = replySupport.closest('.manager-request');
    const message = card?.querySelector(`[data-support-reply="${replySupport.dataset.supportKind}"]`)?.value?.trim();
    if (!message || message.length < 3) { showFeedback('Напишите клиенту ответ хотя бы несколькими словами.', 'error'); return; }
    payload = { action:'reply_support_case', orderId:replySupport.dataset.replySupport, kind:replySupport.dataset.supportKind, message };
    successMessage = 'Ответ сохранён — клиент увидит его в личном кабинете.';
  } else if (button.dataset.document) {
    const note = button.dataset.status === 'rejected' ? window.prompt('Напишите причину отклонения. Она будет показана клиенту:') : '';
    if (button.dataset.status === 'rejected' && !note?.trim()) return;
    payload = { action:'review_document', documentId:button.dataset.document, status:button.dataset.status, note:note?.trim() || '' };
    successMessage = button.dataset.status === 'accepted' ? 'Документ принят.' : 'Документ отклонён, причина отправлена клиенту.';
  } else {
    payload = { action:'advance_order', orderId:button.dataset.order, nextStatus:button.dataset.nextStatus };
    successMessage = 'Статус заявки обновлён.';
  }
  target.disabled = true;
  const original = target.textContent;
  target.textContent = createPayment || createReservationPayment || createBalancePayment || createExtensionPayment ? 'Создаём QR…' : 'Сохраняем…';
  if (createPayment || createReservationPayment || createBalancePayment || createExtensionPayment) showFeedback('Отправляем запрос в Bakai…');
  try {
    const result = await api('POST', payload);
    if (payload.action === 'reject_all_documents') orders.forEach(order => { if (order.id === payload.orderId) order.documents.forEach(document => { if (document.status === 'pending_review') { document.status = 'rejected'; document.reviewer_note = payload.note; } }); });
    if (payload.action === 'review_document') orders.forEach(order => order.documents.forEach(document => { if (document.id === payload.documentId) { document.status = result.document?.status || payload.status; document.reviewer_note = payload.note || document.reviewer_note; if (result.order?.status) order.status = result.order.status; } }));
    if (payload.action === 'advance_order') { const order = orders.find(item => item.id === payload.orderId); if (order) order.status = result.order?.status || payload.nextStatus; }
    if (payload.action === 'complete_return_acceptance') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'create_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'create_reservation_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) { order.reservationPayment = result.payment; order.payment = result.payment; } }
    if (payload.action === 'create_balance_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) { order.balancePayment = result.payment; order.payment = result.payment; } }
    if (payload.action === 'archive_draft_order') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'revoke_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'confirm_bakai_payment_manually') { const order = orders.find(item => item.id === payload.orderId); if (order) { order.payment = result.payment; if (result.order) Object.assign(order, result.order); } }
    if (['create_extension_bakai_payment','approve_free_extension'].includes(payload.action)) await load();
    if (payload.action === 'reject_extension_request') { const order = orders.find(item => item.id === payload.orderId); if (order && result.request) order.requests = (order.requests || []).map(item => item.id === payload.requestId ? { ...item, ...result.request } : item); }
    if (['admin_close_rental_early','admin_open_incident'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'admin_resolve_incident') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'mark_test_order') { const order = orders.find(item => item.id === payload.orderId); if (order) order.is_test = true; }
    if (payload.action === 'delete_test_order') { orders = orders.filter(order => order.id !== payload.orderId); if (String(selectedOrderId) === String(payload.orderId)) selectedOrderId = ''; }
    if (payload.action === 'admin_update_laptop_asset') { orders.forEach(order => { if (order.laptop_id === payload.laptopId) { order.laptop_serial_number = result.laptop?.serial_number || ''; order.laptop_inventory_code = result.laptop?.inventory_code || ''; } }); }
    if (payload.action === 'save_order_registry') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'set_agreed_rental_price') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'resolve_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, status:'resolved' } : item); }
    if (payload.action === 'reply_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order && result.supportCase) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, ...result.supportCase } : item); }
    if (['prepare_archa_handoff','record_archa_reservation','mark_locker_loaded','mark_delivery_dispatched','send_manual_pickup_code','send_manual_return_code','confirm_archa_courier_return_dropoff'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'prepare_archa_return_handoff') { const order = orders.find(item => item.id === payload.orderId); if (order) order.returnHandoffPrepared = true; }
    if (['prepare_archa_handoff','prepare_archa_return_handoff'].includes(payload.action) && result.message) {
      transientOrderMessages.set(payload.orderId, result.message);
      navigator.clipboard?.writeText(result.message).catch(() => {});
      showFeedback(`${successMessage} Текст скопирован — вставьте его в рабочую Telegram-группу ARCHA POINT.\n\n${result.message}`, 'success');
    }
    statusEl.textContent = successMessage;
    showFeedback(successMessage, 'success');
    // Payment readiness depends on the server-side document and ID registry
    // checks. Reload them immediately so the action cannot be shown from a
    // stale local card after the manager just accepted a file or saved ID data.
    if (['review_document', 'save_order_registry', 'set_agreed_rental_price'].includes(payload.action)) { await load(true); statusEl.textContent = successMessage; }
    else { render(); window.setTimeout(load, 900); }
  } catch (error) { statusEl.textContent = error.message; showFeedback(error.message, 'error'); target.disabled = false; target.textContent = original; }
});
ordersEl.addEventListener('toggle', event => {
  const details = event.target.closest('.manager-order-details');
  if (!details) return;
  const id = details.closest('[data-manager-order]')?.dataset.managerOrder;
  if (!id) return;
  if (details.open) openOrderDetails.add(id); else openOrderDetails.delete(id);
}, true);
document.getElementById('manager-document-viewer-close')?.addEventListener('click', closeDocumentViewer);
documentViewer?.addEventListener('click', event => { if (event.target === documentViewer) closeDocumentViewer(); });
document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!replacementPicker?.hidden) closeReplacementPicker(); else if (!documentViewer?.hidden) closeDocumentViewer(); });
managerPhoneInput?.addEventListener('input', () => { managerPhoneInput.value = formatPhone(managerPhoneInput.value); });
managerPhoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = normalizePhone(managerPhoneInput.value); if (!phone) return loginMessage('Введите рабочий номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = managerPhoneForm.querySelector('button'); button.disabled = true; loginMessage('Отправляем код…'); try { await accountApi({ action:'request_code', phone }); pendingManagerPhone = phone; managerPhoneForm.hidden = true; managerCodeForm.hidden = false; managerCodeInput.focus(); loginMessage('Код отправлен. Введите 6 цифр из сообщения.', 'success'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
managerCodeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = managerCodeInput.value.replace(/\D/g, ''); if (code.length !== 6) return loginMessage('Введите все 6 цифр кода.', 'error'); const button = managerCodeForm.querySelector('button'); button.disabled = true; loginMessage('Проверяем доступ…'); try { await accountApi({ action:'verify_code', phone:pendingManagerPhone, code, remember:true }); await load(); if (!dashboard.hidden) loginMessage(''); else loginMessage('Этот номер не имеет доступа к панели менеджера.', 'error'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('manager-change-phone')?.addEventListener('click', () => { managerCodeForm.hidden = true; managerPhoneForm.hidden = false; managerCodeInput.value = ''; loginMessage(''); managerPhoneInput.focus(); });
function closeCatalogPanel() {
  catalogPanel.hidden = true;
  dashboard.hidden = false;
  render();
}
catalogOpenButton?.addEventListener('click', async () => {
  if (!catalogPanel.hidden) { closeCatalogPanel(); return; }
  setMobileNav(false);
  dashboard.hidden = true;
  catalogPanel.hidden = false;
  statusEl.textContent = 'Загружаем каталог…';
  try { await loadCatalogManager(); statusEl.textContent = 'Каталог загружен.'; } catch (error) { statusEl.textContent = error.message; }
});
sidebarCatalogButton?.addEventListener('click', () => catalogOpenButton?.click());
catalogCloseButton?.addEventListener('click', closeCatalogPanel);
promoOpenButton?.addEventListener('click', async () => {
  setMobileNav(false);
  dashboard.hidden = true;
  if (catalogPanel) catalogPanel.hidden = true;
  if (promoPanel) promoPanel.hidden = false;
  statusEl.textContent = 'Загружаем промокоды…';
  await load(false, 'promos');
  renderPromoManager();
});
promoCloseButton?.addEventListener('click', () => { if (promoPanel) promoPanel.hidden = true; dashboard.hidden = false; render(); });
b2bOpenButton?.addEventListener('click', async () => {
  setMobileNav(false);
  dashboard.hidden = true;
  if (catalogPanel) catalogPanel.hidden = true;
  if (promoPanel) promoPanel.hidden = true;
  if (b2bPanel) b2bPanel.hidden = false;
  statusEl.textContent = 'Загружаем корпоративные заявки…';
  await load(false, 'b2b');
  renderB2BManager();
});
b2bCloseButton?.addEventListener('click', () => { if (b2bPanel) b2bPanel.hidden = true; dashboard.hidden = false; render(); });
helpOpenButton?.addEventListener('click', () => {
  setMobileNav(false);
  dashboard.hidden = true;
  if (catalogPanel) catalogPanel.hidden = true;
  if (promoPanel) promoPanel.hidden = true;
  if (b2bPanel) b2bPanel.hidden = true;
  if (helpPanel) helpPanel.hidden = false;
  statusEl.textContent = 'Открыта памятка менеджера.';
});
helpCloseButton?.addEventListener('click', () => { if (helpPanel) helpPanel.hidden = true; dashboard.hidden = false; render(); });
b2bList?.addEventListener('click', async event => {
  const button = event.target.closest('[data-save-b2b]');
  if (!button) return;
  const card = button.closest('.manager-b2b-lead');
  const leadId = button.dataset.saveB2b;
  const status = card?.querySelector(`[data-b2b-status="${leadId}"]`)?.value || '';
  const managerNote = card?.querySelector(`[data-b2b-note="${leadId}"]`)?.value || '';
  button.disabled = true; button.textContent = 'Сохраняем…';
  try {
    const result = await api('POST', { action:'update_b2b_lead', leadId, status, managerNote });
    const index = b2bLeads.findIndex(lead => String(lead.id) === String(leadId));
    if (index >= 0) b2bLeads[index] = { ...b2bLeads[index], ...result.lead };
    renderB2BManager();
    statusEl.textContent = result.message;
  } catch (error) { statusEl.textContent = error.message; button.disabled = false; button.textContent = 'Сохранить B2B-заявку'; }
});
promoForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = promoForm.querySelector('[type="submit"]');
  const data = new FormData(promoForm);
  const phone = normalizePhone(data.get('phone'));
  const discountPercent = Number(data.get('discountPercent'));
  if (!phone) { statusEl.textContent = 'Введите номер клиента в формате +996XXXXXXXXX.'; return; }
  if (![5, 10, 15, 20].includes(discountPercent)) { statusEl.textContent = 'Выберите размер скидки 5%, 10%, 15% или 20%.'; return; }
  if (!window.confirm(`Выдать персональный промокод ${phone} на ${discountPercent}% сроком на 30 дней?`)) return;
  button.disabled = true; button.textContent = 'Выдаём…';
  try {
    const result = await api('POST', { action:'issue_personal_promo', phone, discountPercent });
    statusEl.textContent = `${result.message} Код: ${result.promo?.code || 'создан'}.`;
    promoForm.reset();
    await load(true);
    renderPromoManager();
  } catch (error) { statusEl.textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Выдать промокод'; }
});
promoList?.addEventListener('click', async event => {
  const revoke = event.target.closest('[data-revoke-promo]');
  if (!revoke) return;
  if (!window.confirm('Отозвать этот неиспользованный промокод? В новой заявке он больше не сработает.')) return;
  revoke.disabled = true; revoke.textContent = 'Отзываем…';
  try { const result = await api('POST', { action:'revoke_personal_promo', promoId:revoke.dataset.revokePromo }); statusEl.textContent = result.message; await load(true); renderPromoManager(); }
  catch (error) { statusEl.textContent = error.message; revoke.disabled = false; revoke.textContent = 'Отозвать'; }
});
catalogResetButton?.addEventListener('click', resetCatalogForm);
catalogList?.addEventListener('click', async event => {
  const edit = event.target.closest('[data-catalog-edit]');
  if (edit) return editCatalogLaptop(edit.dataset.catalogEdit);
  const visibility = event.target.closest('[data-catalog-visibility]');
  if (!visibility) return;
  const isVisible = visibility.dataset.visible === '1';
  if (!window.confirm(isVisible ? 'Показать эту модель на сайте?' : 'Скрыть модель из витрины? Старые заявки сохранятся.')) return;
  visibility.disabled = true;
  try {
    const result = await catalogApi('POST', { action:'set_catalog_visibility', laptopId:visibility.dataset.catalogVisibility, isVisible });
    const index = catalogLaptops.findIndex(item => String(item.id) === String(visibility.dataset.catalogVisibility));
    if (index >= 0) catalogLaptops[index] = { ...catalogLaptops[index], ...result.laptop };
    renderCatalogManager(); statusEl.textContent = result.message;
  } catch (error) { visibility.disabled = false; statusEl.textContent = error.message; }
});
catalogForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = catalogForm.querySelector('[type="submit"]');
  const data = new FormData(catalogForm);
  const file = data.get('imageFile');
  button.disabled = true; button.textContent = 'Сохраняем…';
  try {
    let imageUrl = '';
    if (file instanceof File && file.size) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Загрузите JPG, PNG или WEBP до 8 МБ.');
      button.textContent = 'Загружаем фото…';
      const ticket = await catalogApi('POST', { action:'create_catalog_image_upload', contentType:file.type, byteSize:file.size });
      const upload = await fetch(ticket.uploadUrl, { method:'PUT', headers:{ Authorization:`Bearer ${ticket.token}`, 'x-upsert':'false', 'content-type':file.type }, body:file });
      if (!upload.ok) throw new Error('Не удалось загрузить фото. Проверьте соединение и попробуйте снова.');
      imageUrl = ticket.publicUrl;
    }
    const existing = catalogLaptops.find(item => String(item.id) === String(data.get('laptopId')));
    const payload = { action:'save_catalog_laptop', laptopId:data.get('laptopId'), title:data.get('title'), category:data.get('category'), badge:data.get('badge'), cpu:data.get('cpu'), ram:data.get('ram'), storage:data.get('storage'), dailyRate:data.get('dailyRate'), priceText:data.get('priceText'), sortOrder:data.get('sortOrder'), description:data.get('description'), useCases:data.get('useCases'), isVisible:data.get('isVisible') === 'on', imageUrl:imageUrl || catalogField(existing, 'image_url', 'image') || '' };
    const result = await catalogApi('POST', payload);
    const index = catalogLaptops.findIndex(item => String(item.id) === String(result.laptop.id));
    if (index >= 0) catalogLaptops[index] = result.laptop; else catalogLaptops.push(result.laptop);
    catalogLaptops.sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0) || Number(left.id || 0) - Number(right.id || 0));
    renderCatalogManager(); resetCatalogForm(); statusEl.textContent = result.message;
  } catch (error) { statusEl.textContent = error.message; } finally { button.disabled = false; button.textContent = 'Сохранить модель'; }
});
load();
