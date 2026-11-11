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
const bakaiCheck = document.getElementById('manager-bakai-check');
const returnAlert = document.getElementById('manager-return-alert');
const catalogOpenButton = document.getElementById('manager-catalog-open');
const catalogPanel = document.getElementById('manager-catalog-panel');
const catalogCloseButton = document.getElementById('manager-catalog-close');
const catalogForm = document.getElementById('manager-catalog-form');
const catalogList = document.getElementById('manager-catalog-list');
const catalogResetButton = document.getElementById('manager-catalog-reset');
let orders = [];
let rentableLaptops = [];
let catalogLaptops = [];
let filter = 'all';
let pendingManagerPhone = '';
let isChiefAdmin = false;
let activeLoad = null;
const transientOrderMessages = new Map();
let openOrderDetails = new Set();

const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const date = value => value ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const statusLabel = status => ({ draft:'Новая заявка', pending_review:'Проверка документов', awaiting_payment:'Ожидает оплаты', payment_review:'Проверка оплаты', confirmed:'Оплата подтверждена', awaiting_archa_reservation:'Резервируем ячейку', awaiting_locker_loading:'Ожидает закладки', awaiting_pickup:'Готово к получению', issued:'Ожидаем подтверждение', in_use:'Активна', return_requested:'Возврат', awaiting_return_reservation:'Резервируем возврат', awaiting_return_dropoff:'Ожидаем возврат в ячейку', awaiting_return_collection:'Ожидаем физический возврат', returned:'Проверка возврата', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена', incident:'Инцидент — требуется решение' }[status] || status || 'Новая');
const docLabel = kind => ({ identity:'Документ', identity_front:'Документ — лицевая сторона', identity_back:'Документ — обратная сторона', selfie:'Селфи', supporting:'Подтверждение', issue_video:'Видео до получения', return_video:'Видео возврата', benefit_proof:'Льготный документ' }[kind] || 'Документ');
const benefitLabel = kind => ({ student:'Студент', pensioner:'Пенсионер', disability:'Инвалидность / ОВЗ' }[kind] || kind);
const deliveryLabel = order => order.delivery_type === 'arca_locker' ? 'ARCHA POINT 24/7' : order.delivery_type === 'delivery' ? 'Доставка курьером' : order.delivery_type === 'pickup' ? 'Архивный способ получения' : 'Уточняется';
const nextAction = order => {
  if (order.status === 'pending_review') return { next:'awaiting_payment', label:'Подтвердить проверку и перейти к оплате' };
  return null;
};

function closeDocumentViewer() { if (!documentViewer) return; documentViewer.hidden = true; if (documentViewerContent) documentViewerContent.innerHTML = ''; document.body.style.overflow = ''; }
function openDocumentViewer(url, name = 'Документ', contentType = '') { if (!documentViewer || !documentViewerContent || !url) return; const isPdf = contentType === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(name); const isVideo = contentType.startsWith('video/') || /\.(?:mp4|mov)(?:[?#]|$)/i.test(name); documentViewerContent.innerHTML = isVideo ? `<video controls preload="metadata" src="${escape(url)}">Ваш браузер не поддерживает просмотр видео.</video>` : isPdf ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>` : `<img src="${escape(url)}" alt="${escape(name)}">`; documentViewer.hidden = false; document.body.style.overflow = 'hidden'; }
async function api(method = 'GET', payload) { const url = method === 'GET' ? `/api/manager?refresh=${Date.now()}` : '/api/manager'; const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 30_000); try { const response = await fetch(url, { method, credentials:'same-origin', cache:'no-store', signal:controller.signal, headers:payload ? { 'content-type':'application/json' } : {}, body:payload ? JSON.stringify(payload) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(data.error || 'Не удалось загрузить панель.'); error.status = response.status; throw error; } return data; } catch (error) { if (error.name === 'AbortError') throw new Error('Панель не ответила за 30 секунд. Нажмите «Обновить» — предыдущий запрос уже остановлен.'); throw error; } finally { window.clearTimeout(timeout); } }
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

function visibleOrders() {
  const query = String(searchInput?.value || '').trim().toLowerCase();
  return orders.filter(order => {
    if (query && !`${order.id} ${order.customer_name} ${order.customer_phone} ${order.laptop_title}`.toLowerCase().includes(query)) return false;
    if (filter === 'new') return ['draft','pending_review','awaiting_payment','payment_review','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status);
    if (filter === 'documents') return order.documents.some(document => document.status === 'pending_review');
    if (filter === 'active') return ['in_use','incident'].includes(order.status);
    if (filter === 'returns') return ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status);
    if (filter === 'completed') return order.status === 'completed';
    if (filter === 'closed') return ['cancelled','rejected'].includes(order.status);
    return true;
  });
}

function documentCard(document, orderId) {
  const documentType = document.kind === 'supporting' && document.file_name ? ` · ${escape(document.file_name)}` : '';
  const reviewNote = document.reviewer_note ? ` · ${escape(document.reviewer_note)}` : '';
  return `<div class="manager-doc"><span>${docLabel(document.kind)}${documentType} · ${document.status === 'pending_review' ? 'на проверке' : document.status}${reviewNote}</span><button class="manager-doc-view" type="button" data-document-view="${document.id}" data-order="${escape(orderId)}" data-document-name="${escape(document.file_name || docLabel(document.kind))}" data-document-type="${escape(document.content_type || '')}">Открыть</button>${document.status === 'pending_review' ? `<button class="accept" data-document="${document.id}" data-status="accepted">Принять</button><button class="reject" data-document="${document.id}" data-status="rejected">Отклонить</button>` : ''}</div>`;
}
function lockerInstruction(order) {
  if (order.delivery_type !== 'arca_locker') return '';
  const location = order.locker_address || 'локация не выбрана';
  return `<section class="manager-section manager-locker-instruction"><h3>Инструкция выдачи через ARCHA POINT</h3><p><strong>Точка клиента:</strong> ${escape(location)}</p><ol><li>После статуса «Оплата подтверждена» проверьте ноутбук, зарядку и комплектность.</li><li>Передайте ARCHA POINT только ФИО, телефон, модель, даты и выбранную точку — документы клиента не передаются.</li><li>Дождитесь номера ячейки и PIN/QR от ARCHA POINT. До этого не обещайте клиенту немедленную выдачу.</li><li>Только после подготовки ячейки переведите заявку в «Готовится к выдаче» и отправьте клиенту инструкцию.</li></ol></section>`;
}
function archaControls(order) {
  if (order.delivery_type === 'arca_locker' && order.status === 'confirmed') return `<button class="secondary" data-prepare-archa="${order.id}">Подготовить сообщение для ARCHA POINT</button>`;
  if (order.status === 'awaiting_archa_reservation') return `<div class="manager-payment-create"><label>Код закладки ARCHA POINT<input data-archa-loading-code type="text" maxlength="200" placeholder="Код для менеджера"></label><label>Номер ячейки / комментарий<input data-archa-reference type="text" maxlength="200" placeholder="Необязательно"></label><button class="secondary" data-record-archa-reservation="${order.id}">Сохранить резерв ячейки</button></div>`;
  if (order.status === 'awaiting_locker_loading') return `<button class="secondary" data-mark-locker-loaded="${order.id}">Ноутбук помещён в ячейку</button>`;
  if (order.status === 'awaiting_pickup') return order.locker_status === 'access_sent'
    ? `<div class="manager-request">✓ Клиент сам подтвердил в кабинете получение SMS-кода ARCHA POINT. Теперь он проходит видео и подтверждение получения.</div><div class="manager-actions"><button class="secondary" data-manual-pickup-code="${order.id}">Повторно отправить код вручную</button></div>`
    : `<div class="manager-request">Ноутбук помещён в ячейку. ARCHA POINT отправляет код напрямую клиенту; в кабинете клиента уже есть самостоятельная кнопка «Код из SMS получен». Менеджер не подтверждает получение SMS за клиента.</div><div class="manager-actions"><button class="secondary" data-manual-pickup-code="${order.id}">Отправить код вручную при сбое</button></div>`;
  if (order.status === 'awaiting_return_reservation') return order.returnHandoffPrepared
    ? `<div class="manager-request">Текст для ARCHA POINT подготовлен. Отправьте его в рабочую группу и дождитесь кода возврата. Если их SMS не пришло, получите подтверждённый код у ARCHA POINT и отправьте его клиенту через защищённый резервный путь Rentop.</div><div class="manager-actions"><button class="secondary" data-prepare-archa-return="${order.id}">Показать и скопировать сообщение</button><button class="secondary" data-manual-return-code="${order.id}">Отправить резервный код возврата</button></div>`
    : `<div class="manager-actions"><button class="secondary" data-prepare-archa-return="${order.id}">Подготовить сообщение о возврате</button></div>`;
  if (order.status === 'awaiting_return_dropoff') return `<div class="manager-request">${order.locker_status === 'return_access_received' ? 'Клиент подтвердил получение SMS-кода.' : 'Код возврата отмечен как отправленный.'} Ожидаем, пока клиент прикрепит видео, поместит ноутбук в ячейку и сам подтвердит закрытие. После этого заявка перейдёт в «Проверка возврата».</div>`;
  if (order.status === 'awaiting_return_collection') { const videoAccepted = order.documents?.some(document => document.kind === 'return_video' && document.status === 'accepted'); const needsDestination = ['customer_courier','self_delivery'].includes(order.return_method); const destinationReady = !needsDestination || String(order.return_destination_address || '').trim().length >= 8; const method = ({ rentop_courier:'Курьер Rentop — платно', customer_courier:'Курьерская служба клиента — платно', self_delivery:'Самопривоз по согласованию' })[order.return_method] || '—'; const details = order.return_method === 'rentop_courier' ? `Адрес забора: ${escape(order.return_collection_address || '—')}<br>Контакт: ${escape(order.return_contact_name || '—')} · ${escape(order.return_contact_phone || '—')}<br>Время: ${escape(order.return_preferred_time || 'по согласованию')}` : `Контакт: ${escape(order.return_contact_name || '—')} · ${escape(order.return_contact_phone || '—')}<br>Время: ${escape(order.return_preferred_time || 'по согласованию')}`; const destinationForm = needsDestination ? `<div class="manager-handoff-destination"><label>Адрес приёма для клиента</label><textarea data-return-destination-address maxlength="500" placeholder="Адрес Rentop или согласованной точки приёма">${escape(order.return_destination_address || '')}</textarea><label>Инструкции (необязательно)</label><textarea data-return-destination-note maxlength="1000" placeholder="Контакт, ориентир, согласованное время">${escape(order.return_destination_note || '')}</textarea><button class="secondary" data-save-return-handoff="${order.id}">Сообщить адрес клиенту</button></div>` : ''; const readiness = !destinationReady ? 'Сначала сообщите клиенту адрес приёма.' : videoAccepted ? 'Видео принято. После фактической передачи нажмите кнопку ниже.' : 'Сначала откройте и примите видео возврата — кнопка физической приёмки недоступна.'; return `<div class="manager-request"><strong>Возврат вне постамата</strong><br>Способ: ${escape(method)}.<br>${details}<br><br>${needsDestination ? (order.return_destination_address ? `Адрес приёма сообщён: ${escape(order.return_destination_address)}` : 'Сначала укажите и сообщите клиенту адрес приёма.') : 'Согласуйте стоимость и время выезда курьера Rentop.'}<br><br>${readiness}</div>${destinationForm}<div class="manager-actions"><button class="secondary" data-confirm-return-collected="${order.id}" ${videoAccepted && destinationReady ? '' : 'disabled'}>Ноутбук получен физически</button></div>`; }
  return '';
}
function deliveryControls(order) {
  if (order.delivery_type !== 'delivery') return '';
  if (order.status === 'confirmed') return `<section class="manager-section manager-locker-instruction"><h3>Доставка курьером</h3><p><strong>Адрес:</strong> ${escape(order.delivery_address || 'не указан')}<br><strong>Желаемое время:</strong> ${escape(order.delivery_preferred_time || 'не указано')}<br><strong>Контакт:</strong> ${escape(order.delivery_contact_name || order.customer_name || '—')} · ${escape(order.delivery_contact_phone || order.customer_phone || '—')}</p><p>Сначала согласуйте точное время и отдельную стоимость доставки с клиентом. Нажимайте кнопку только после фактической передачи ноутбука курьеру.</p><div class="manager-actions"><button class="secondary" data-mark-delivery-dispatched="${order.id}">Ноутбук передан курьеру</button></div></section>`;
  if (order.status === 'awaiting_pickup' && order.locker_status === 'delivery_dispatched') return `<div class="manager-request">Ноутбук передан курьеру. Клиент должен снять видео и подтвердить фактическое получение в личном кабинете. До его подтверждения срок аренды не начинается.</div>`;
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

function render() {
  openOrderDetails = new Set([...ordersEl.querySelectorAll('.manager-order-details[open]')].map(item => item.closest('[data-manager-order]')?.dataset.managerOrder).filter(Boolean));
  const list = visibleOrders();
  const pendingDocs = orders.reduce((total, order) => total + order.documents.filter(document => document.status === 'pending_review').length, 0);
  const active = orders.filter(order => ['in_use','incident'].includes(order.status)).length;
  const returns = orders.filter(order => ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','awaiting_return_collection','returned'].includes(order.status));
  const fresh = orders.filter(order => ['draft','pending_review','awaiting_payment','payment_review','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status)).length;
  const paidOrders = orders.filter(order => order.payment?.status === 'paid');
  const revenue = paidOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  const deposits = paidOrders.reduce((sum, order) => sum + Number(order.deposit_amount || 0), 0);
  statsEl.innerHTML = [[orders.length,'Всего заявок','all'],[fresh,'В работе','new'],[pendingDocs,'Документы на проверке','documents'],[active,'Активные аренды','active'],[returns.length,'Возвраты требуют действий','returns'],[`${revenue.toLocaleString('ru-RU')} сом`,'Выручка в реестре','all'],[`${deposits.toLocaleString('ru-RU')} сом`,'Залоги в учёте','all']].map(([value,label,key]) => `<button class="manager-stat ${filter === key ? 'is-active' : ''}" type="button" data-filter="${key}"><span>${label}</span><strong>${value}</strong></button>`).join('');
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
      ? `<p class="manager-action-note">${!documentsReadyForPayment ? 'Сначала примите все четыре обязательных документа.' : benefitPendingForPayment ? 'Клиент запросил социальную скидку: примите или отклоните льготный документ, чтобы зафиксировать итоговую сумму до счёта.' : 'Сверьте ID, заполните и сохраните реестр — после этого появится переход к оплате.'}</p>`
      : '';
    const pending = order.documents.filter(document => document.status === 'pending_review').length;
    const paymentAmount = Number(order.total_amount || 0) + Number(order.deposit_amount || 0);
    const hasActivePayment = order.payment?.status === 'awaiting_payment' && new Date(order.payment.expires_at) > new Date();
    const paymentAction = order.status === 'awaiting_payment' && !hasActivePayment ? `<div class="manager-payment-create"><label>Сумма к оплате, сом<input data-payment-amount type="number" min="1" max="1000000" step="1" value="${paymentAmount}"></label><small>Расчёт сайта: ${paymentAmount.toLocaleString('ru-RU')} сом${Number(order.deposit_amount || 0) ? `, включая залог ${Number(order.deposit_amount).toLocaleString('ru-RU')} сом` : ''}.</small><button class="secondary" data-create-payment="${order.id}">Создать настоящий QR-счёт</button></div>` : '';
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
    const offerEvidence = order.offer_accepted_at ? `<section class="manager-section"><h3>Оферта и согласия</h3><div class="manager-request">Оферта ${escape(order.offer_version || '—')} · принята ${date(order.offer_accepted_at)} · SMS ${order.offer_otp_verified_at ? `подтверждён ${date(order.offer_otp_verified_at)}` : 'ещё не подтверждён'}</div></section>` : '';
    const identityRegistry = order.documents.some(document => ['identity','identity_front'].includes(document.kind)) ? `<label>Номер паспорта / ID <span>сверьте по загруженному документу</span><input data-registry-identity-number maxlength="80" value="${escape(order.identity_document_number || '')}" placeholder="Внесите только после визуальной проверки"></label><label>Кем выдан документ <input data-registry-identity-issuer maxlength="240" value="${escape(order.identity_document_issuer || '')}" placeholder="Строго как в документе"></label>` : '';
    const identitySummary = order.identity_verified_at ? `Паспорт/ID сверены ${date(order.identity_verified_at)}${order.identity_verified_by ? ` · ${escape(order.identity_verified_by)}` : ''}.` : 'Паспорт/ID ещё не сверены менеджером.';
    const registry = `<section class="manager-section"><h3>Внутренний реестр аренды</h3><div class="manager-registry-form"><label>Адрес проживания клиента<textarea readonly>${escape(order.residence_address || 'Не указан (старая заявка)')}</textarea></label><label>Подтверждающий документ<input readonly value="${escape(order.supporting_document_type || 'Не указан (старая заявка)')}"></label>${identityRegistry}<label>Цель аренды / задачи клиента<textarea data-registry-purpose maxlength="600" placeholder="Например: монтаж видео, учёба, офисная работа">${escape(order.rental_purpose || '')}</textarea></label><label>Заметка менеджера<textarea data-registry-note maxlength="2000" placeholder="Договорённости, комплектация, важные детали">${escape(order.manager_note || '')}</textarea></label><label>Состояние при возврате<textarea data-registry-return maxlength="2000" placeholder="Заполняется после осмотра: корпус, зарядка, комплектность, замечания">${escape(order.return_condition_note || '')}</textarea></label><button class="secondary" data-save-registry="${order.id}">Сохранить реестр и проверку</button></div><p>${identitySummary} В реестре: модель ${escape(order.laptop_title || '—')}, S/N ${escape(order.laptop_serial_number || 'не указан')}, инв. код ${escape(order.laptop_inventory_code || 'не указан')}.</p></section>`;
    const benefits = (order.benefits || []).filter(item => item.status !== 'expired');
    const benefitPanel = benefits.length ? `<section class="manager-section"><h3>Социальная скидка</h3><div class="manager-requests">${benefits.map(item => `<div class="manager-request"><strong>${escape(benefitLabel(item.benefit_type))}</strong> · ${escape(item.status)}${item.reviewer_note ? `<br>${escape(item.reviewer_note)}` : ''}<br><small>Подано ${date(item.created_at)}${item.approved_at ? ` · принято ${date(item.approved_at)}` : ''}</small></div>`).join('')}</div><p>Подтверждённая льгота — 10%. Она не складывается с тарифной скидкой: для расчёта используется наибольшая из доступных скидок.</p></section>` : '';
    const loyaltyAction = order.status === 'completed' ? `<section class="manager-section"><h3>Лояльность клиента</h3><div class="manager-actions"><button class="secondary" data-issue-promo="${order.id}">Выдать персональный промокод</button></div><p>Промокод привязывается к номеру клиента и будет виден только в его личном кабинете.</p></section>` : '';
    const assetTools = isChiefAdmin ? `<section class="manager-section"><h3>Учёт устройства</h3><div class="manager-payment-create"><label>Заводской S/N<input data-asset-serial type="text" maxlength="160" value="${escape(order.laptop_serial_number || '')}" placeholder="Например: C02ABC123XYZ"></label><label>Инвентарный код Rentop<input data-asset-inventory type="text" maxlength="100" value="${escape(order.laptop_inventory_code || '')}" placeholder="Например: RT-0001"></label><button class="secondary" data-save-asset="${order.laptop_id}">Сохранить идентификаторы</button></div></section>` : '';
    const incidentCandidates = rentableLaptops.filter(laptop => String(laptop.id) !== String(order.laptop_id) && Number(laptop.daily_rate || 0) >= Number(order.daily_rate || 0));
    const incidentTools = order.status === 'incident' ? `${order.replacement_exchange_status === 'awaiting_exchange' ? '<p class="manager-request">Замена уже согласуется. Сначала подтвердите физическую передачу выше, затем закройте инцидент.</p>' : `<div class="manager-payment-create"><label>Равная или более дорогая модель<select data-incident-replacement-laptop><option value="">Выберите модель</option>${incidentCandidates.map(laptop => `<option value="${Number(laptop.id)}">${escape(laptop.title)} · ${Number(laptop.daily_rate || 0).toLocaleString('ru-RU')} сом/день</option>`).join('')}</select></label><label>Ответственность<select data-incident-fault-party><option value="rentop">Вина Rentop — замена без доплаты</option><option value="customer">Вина клиента — условия согласует менеджер</option></select></label><label>Передача<select data-incident-method><option value="rentop_courier">Курьер Rentop</option><option value="arca_locker">ARCHA POINT</option><option value="customer_courier">Курьерская служба клиента</option><option value="self_delivery">Самопривоз</option></select></label><button class="secondary" data-admin-offer-incident-replacement="${order.id}">Предложить замену</button></div>`}<button class="secondary" data-admin-resolve-incident="${order.id}">Разрешить инцидент</button>` : '';
    const adminTools = isChiefAdmin ? `<section class="manager-section"><h3>Контроль главного администратора</h3><div class="manager-actions"><a class="cabinet-action secondary" href="/api/manager/dossier?order=${encodeURIComponent(order.id)}" target="_blank" rel="noopener">Открыть защищённое досье</a><a class="cabinet-action ghost" href="/api/manager/dossier?order=${encodeURIComponent(order.id)}&format=json">Скачать технический JSON</a>${order.status === 'returned' ? `<button class="secondary" data-admin-close="${order.id}">Завершить после физического осмотра</button>` : ''}${incidentTools}${!['completed','cancelled','rejected','incident'].includes(order.status) ? `<button class="danger" data-admin-incident="${order.id}">Открыть инцидент</button>` : ''}</div></section>` : '';
    const handoffPanel = archaIssueHandoffPanel(order);
    const documentsPanel = `<section class="manager-section"><h3>Документы</h3><div class="manager-docs">${order.documents.length ? order.documents.map(document => documentCard(document, order.id)).join('') : '<span class="manager-empty">Документы ещё не загружены</span>'}</div></section>`;
    const requestsPanel = order.requests.length ? `<section class="manager-section"><h3>Запросы клиента</h3><div class="manager-requests">${order.requests.map(request => `<div class="manager-request">${escape(request.kind)} · ${escape(request.status)}${request.return_method ? ` · ${escape(request.return_method)}` : ''}${request.return_locker_address ? ` · ${escape(request.return_locker_address)}` : ''}${request.customer_message ? ` · ${escape(request.customer_message)}` : ''}</div>`).join('')}</div></section>` : '';
    const directDocuments = pending ? documentsPanel : '';
    const details = `${pending ? '' : documentsPanel}${offerEvidence}${customerNote}${registry}${paymentState}${lockerInstruction(order)}${assetTools}${benefitPanel}${loyaltyAction}${adminTools}${requestsPanel}`;
    const acceptedReturnVideo = order.documents.some(document => document.kind === 'return_video' && document.status === 'accepted');
    const returnAcceptance = order.status === 'returned'
      ? (acceptedReturnVideo
        ? `<section class="manager-return-acceptance"><h3>Приёмка возврата и акт</h3><label for="return-condition-${order.id}">Состояние после физического осмотра <span>обязательно</span></label><textarea id="return-condition-${order.id}" data-return-acceptance-condition maxlength="2000" placeholder="Например: корпус и экран без повреждений, зарядка и комплект на месте.">${escape(order.return_condition_note || '')}</textarea><p>Проверьте ноутбук физически и видео возврата. После подтверждения это описание войдёт в акт приёма‑передачи, а аренда будет завершена.</p><button data-complete-return="${order.id}">Подтвердить приём и сформировать акт</button></section>`
        : `<section class="manager-return-acceptance"><h3>Приёмка возврата</h3><p>Сначала откройте и примите видео возврата клиента. После этого здесь появится поле осмотра и кнопка формирования акта.</p></section>`)
      : '';
    const workflowActions = `${pending ? `<button class="secondary" data-reject-all="${order.id}">Отклонить все с причиной</button>` : ''}${extensionAction}${exchangeAction}${paymentAction}${manualPaymentAction}${archaControls(order)}${deliveryControls(order)}${paymentReadiness}${action ? `<button data-order-action="advance" data-order="${order.id}" data-next-status="${action.next}">${action.label}</button>` : ''}`;
    const deliveryDetails = order.delivery_type === 'delivery' && (order.delivery_address || order.delivery_preferred_time) ? `<br><small>${escape(order.delivery_address || 'Адрес уточняется')} · ${escape(order.delivery_preferred_time || 'время уточняется')}</small>` : order.locker_address ? `<br><small>${escape(order.locker_address)}</small>` : '';
    return `<article class="manager-order" data-manager-order="${order.id}"><div class="manager-order-top"><div><h2>${escape(order.laptop_title)}</h2><p>Заявка ${escape(String(order.id).slice(0,8).toUpperCase())} · ${escape(order.customer_name || 'Клиент не указал имя')}</p></div><span class="manager-status-pill ${escape(order.status)}">${escape(statusLabel(order.status))}</span></div><div class="manager-order-grid"><div><span>Клиент</span><strong>${escape(order.customer_phone || '—')}</strong></div><div><span>Аренда</span><strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div><span>Получение</span><strong>${escape(deliveryLabel(order))}${deliveryDetails}</strong></div><div><span>Сумма аренды</span><strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div><div><span>Залог / скидка</span><strong>${Number(order.deposit_amount || 0).toLocaleString('ru-RU')} сом · ${Number(order.discount_percent || 0)}%</strong></div></div>${directDocuments}${supportPanel}${returnAcceptance}${handoffPanel}<div class="manager-actions manager-workflow-actions">${workflowActions || '<span class="manager-action-note">Следующее действие появится после обновления статуса.</span>'}</div><p class="manager-order-feedback" data-order-feedback="${order.id}" hidden></p><details class="manager-order-details" ${openOrderDetails.has(String(order.id)) || (order.status === 'pending_review' && documentsReadyForPayment) ? 'open' : ''}><summary>Детали заявки, реестр и служебные данные</summary>${details}</details></article>`;
  }).join('') : '<div class="manager-empty">По этому фильтру заявок нет.</div>';
}

async function load(silent = false) { if (activeLoad) return activeLoad; if (!silent) statusEl.textContent = 'Загружаем заявки…'; activeLoad = (async () => { try { const data = await api(); orders = data.orders || []; rentableLaptops = data.rentableLaptops || []; isChiefAdmin = Boolean(data.isChiefAdmin); if (catalogOpenButton) catalogOpenButton.hidden = !isChiefAdmin; gate.hidden = true; dashboard.hidden = false; if (!silent) statusEl.textContent = `Обновлено: ${new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`; render(); } catch (error) { dashboard.hidden = true; if (catalogOpenButton) catalogOpenButton.hidden = true; gate.hidden = error.status !== 401; statusEl.textContent = error.status === 401 ? '' : error.message; } finally { activeLoad = null; } })(); return activeLoad; }
function setFilter(nextFilter) { filter = nextFilter; document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item.dataset.filter === filter)); render(); }

document.getElementById('manager-refresh').addEventListener('click', load);
window.setInterval(() => {
  // Do not erase a manager's unsaved reply, registry note, or an expanded
  // working card. The next automatic cycle will refresh when it is closed.
  if (dashboard.hidden || document.querySelector('.manager-order-details[open], .manager-order textarea:focus, .manager-order input:focus, .manager-order select:focus')) return;
  load(true);
}, 15000);
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
if (clearTestsButton) clearTestsButton.hidden = true;
document.querySelector('.manager-filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
statsEl.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
returnAlert?.addEventListener('click', () => { setFilter('returns'); document.querySelector('.manager-toolbar')?.scrollIntoView({ behavior:'smooth', block:'start' }); });
searchInput?.addEventListener('input', render);
ordersEl.addEventListener('click', async event => {
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
  const archaSmsSent = event.target.closest('[data-archa-sms-sent]');
  const manualPickupCode = event.target.closest('[data-manual-pickup-code]');
  const manualReturnCode = event.target.closest('[data-manual-return-code]');
  const prepareArchaReturn = event.target.closest('[data-prepare-archa-return]');
  const completeReturn = event.target.closest('[data-complete-return]');
  const adminClose = event.target.closest('[data-admin-close]');
  const adminIncident = event.target.closest('[data-admin-incident]');
  const adminResolveIncident = event.target.closest('[data-admin-resolve-incident]');
  const adminOfferIncidentReplacement = event.target.closest('[data-admin-offer-incident-replacement]');
  const saveAsset = event.target.closest('[data-save-asset]');
  const saveRegistry = event.target.closest('[data-save-registry]');
  const issuePromo = event.target.closest('[data-issue-promo]');
  const resolveSupport = event.target.closest('[data-resolve-support]');
  const replySupport = event.target.closest('[data-reply-support]');
  const button = event.target.closest('[data-document], [data-order-action]');
  if (!rejectAll && !createPayment && !createExtensionPayment && !approveFreeExtension && !confirmReturnCollected && !saveReturnHandoff && !confirmReplacementExchange && !rejectExtension && !revokePayment && !manualPayment && !prepareArcha && !recordArchaReservation && !markLockerLoaded && !markDeliveryDispatched && !archaSmsSent && !manualPickupCode && !manualReturnCode && !prepareArchaReturn && !completeReturn && !adminClose && !adminIncident && !adminResolveIncident && !adminOfferIncidentReplacement && !saveAsset && !saveRegistry && !issuePromo && !resolveSupport && !replySupport && !button) return;
  const target = rejectAll || createPayment || createExtensionPayment || approveFreeExtension || confirmReturnCollected || saveReturnHandoff || confirmReplacementExchange || rejectExtension || revokePayment || manualPayment || prepareArcha || recordArchaReservation || markLockerLoaded || markDeliveryDispatched || archaSmsSent || manualPickupCode || manualReturnCode || prepareArchaReturn || completeReturn || adminClose || adminIncident || adminResolveIncident || adminOfferIncidentReplacement || saveAsset || saveRegistry || issuePromo || resolveSupport || replySupport || button;
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
  } else if (createPayment) {
    const amount = Number(createPayment.closest('.manager-order')?.querySelector('[data-payment-amount]')?.value);
    if (!Number.isFinite(amount) || amount <= 0) { statusEl.textContent = 'Введите корректную сумму в сомах.'; return; }
    if (!window.confirm(`Создать настоящий QR-счёт Bakai на ${amount.toLocaleString('ru-RU')} сом? Деньги не спишутся сейчас, но QR можно будет оплатить.`)) return;
    payload = { action:'create_bakai_payment', orderId:createPayment.dataset.createPayment, amount };
    successMessage = 'QR-счёт Bakai создан и показан клиенту в личном кабинете.';
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
    if (!window.confirm('Подтвердите только после согласования времени и стоимости, а также фактической передачи ноутбука курьеру. Срок аренды начнётся лишь после подтверждения клиента.')) return;
    payload = { action:'mark_delivery_dispatched', orderId:markDeliveryDispatched.dataset.markDeliveryDispatched };
    successMessage = 'Передача курьеру отмечена. Клиенту доступна видеофиксация и подтверждение получения.';
  } else if (manualPickupCode) {
    const code = window.prompt('Введите код получения, подтверждённый у ARCHA POINT. Он будет отправлен клиенту по SMS через Rentop:');
    if (!code?.trim()) return;
    if (!window.confirm('Отправить этот код клиенту по SMS? Убедитесь, что он получен у ARCHA POINT и относится к этой заявке.')) return;
    payload = { action:'send_manual_pickup_code', orderId:manualPickupCode.dataset.manualPickupCode, code:code.trim() };
    successMessage = 'Код отправлен клиенту по SMS и зафиксирован в журнале.';
  } else if (manualReturnCode) {
    const code = window.prompt('Введите код возврата, подтверждённый у ARCHA POINT. Он будет отправлен клиенту по SMS через Rentop:');
    if (!code?.trim()) return;
    if (!window.confirm('Отправить резервный код возврата клиенту по SMS? Убедитесь, что код относится именно к возвратной ячейке этой заявки.')) return;
    payload = { action:'send_manual_return_code', orderId:manualReturnCode.dataset.manualReturnCode, code:code.trim() };
    successMessage = 'Резервный код возврата отправлен клиенту по SMS и зафиксирован в журнале.';
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
    payload = { action:'save_order_registry', orderId:saveRegistry.dataset.saveRegistry, rentalPurpose:card?.querySelector('[data-registry-purpose]')?.value || '', managerNote:card?.querySelector('[data-registry-note]')?.value || '', returnConditionNote:card?.querySelector('[data-registry-return]')?.value || '', identityDocumentNumber:card?.querySelector('[data-registry-identity-number]')?.value || '', identityDocumentIssuer:card?.querySelector('[data-registry-identity-issuer]')?.value || '' };
    successMessage = 'Внутренний реестр и проверка личности сохранены.';
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
  target.textContent = createPayment || createExtensionPayment ? 'Создаём QR…' : 'Сохраняем…';
  if (createPayment || createExtensionPayment) showFeedback('Отправляем запрос в Bakai…');
  try {
    const result = await api('POST', payload);
    if (payload.action === 'reject_all_documents') orders.forEach(order => { if (order.id === payload.orderId) order.documents.forEach(document => { if (document.status === 'pending_review') { document.status = 'rejected'; document.reviewer_note = payload.note; } }); });
    if (payload.action === 'review_document') orders.forEach(order => order.documents.forEach(document => { if (document.id === payload.documentId) { document.status = result.document?.status || payload.status; document.reviewer_note = payload.note || document.reviewer_note; if (result.order?.status) order.status = result.order.status; } }));
    if (payload.action === 'advance_order') { const order = orders.find(item => item.id === payload.orderId); if (order) order.status = result.order?.status || payload.nextStatus; }
    if (payload.action === 'complete_return_acceptance') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'create_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'revoke_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'confirm_bakai_payment_manually') { const order = orders.find(item => item.id === payload.orderId); if (order) { order.payment = result.payment; if (result.order) Object.assign(order, result.order); } }
    if (['create_extension_bakai_payment','approve_free_extension'].includes(payload.action)) await load();
    if (payload.action === 'reject_extension_request') { const order = orders.find(item => item.id === payload.orderId); if (order && result.request) order.requests = (order.requests || []).map(item => item.id === payload.requestId ? { ...item, ...result.request } : item); }
    if (['admin_close_rental_early','admin_open_incident'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'admin_resolve_incident') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'admin_update_laptop_asset') { orders.forEach(order => { if (order.laptop_id === payload.laptopId) { order.laptop_serial_number = result.laptop?.serial_number || ''; order.laptop_inventory_code = result.laptop?.inventory_code || ''; } }); }
    if (payload.action === 'save_order_registry') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'resolve_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, status:'resolved' } : item); }
    if (payload.action === 'reply_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order && result.supportCase) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, ...result.supportCase } : item); }
    if (['prepare_archa_handoff','record_archa_reservation','mark_locker_loaded','mark_delivery_dispatched','send_manual_pickup_code','send_manual_return_code'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'prepare_archa_return_handoff') { const order = orders.find(item => item.id === payload.orderId); if (order) order.returnHandoffPrepared = true; }
    if (['prepare_archa_handoff','prepare_archa_return_handoff'].includes(payload.action) && result.message) {
      transientOrderMessages.set(payload.orderId, result.message);
      navigator.clipboard?.writeText(result.message).catch(() => {});
      showFeedback(`${successMessage} Текст скопирован — вставьте его в рабочую Telegram-группу ARCHA POINT.\n\n${result.message}`, 'success');
    }
    statusEl.textContent = successMessage;
    showFeedback(successMessage, 'success');
    render();
    window.setTimeout(load, 900);
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
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !documentViewer?.hidden) closeDocumentViewer(); });
managerPhoneInput?.addEventListener('input', () => { managerPhoneInput.value = formatPhone(managerPhoneInput.value); });
managerPhoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = normalizePhone(managerPhoneInput.value); if (!phone) return loginMessage('Введите рабочий номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = managerPhoneForm.querySelector('button'); button.disabled = true; loginMessage('Отправляем код…'); try { await accountApi({ action:'request_code', phone }); pendingManagerPhone = phone; managerPhoneForm.hidden = true; managerCodeForm.hidden = false; managerCodeInput.focus(); loginMessage('Код отправлен. Введите 6 цифр из сообщения.', 'success'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
managerCodeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = managerCodeInput.value.replace(/\D/g, ''); if (code.length !== 6) return loginMessage('Введите все 6 цифр кода.', 'error'); const button = managerCodeForm.querySelector('button'); button.disabled = true; loginMessage('Проверяем доступ…'); try { await accountApi({ action:'verify_code', phone:pendingManagerPhone, code, remember:true }); await load(); if (!dashboard.hidden) loginMessage(''); else loginMessage('Этот номер не имеет доступа к панели менеджера.', 'error'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('manager-change-phone')?.addEventListener('click', () => { managerCodeForm.hidden = true; managerPhoneForm.hidden = false; managerCodeInput.value = ''; loginMessage(''); managerPhoneInput.focus(); });
catalogOpenButton?.addEventListener('click', async () => {
  dashboard.hidden = true;
  catalogPanel.hidden = false;
  statusEl.textContent = 'Загружаем каталог…';
  try { await loadCatalogManager(); statusEl.textContent = 'Каталог загружен.'; } catch (error) { statusEl.textContent = error.message; }
});
catalogCloseButton?.addEventListener('click', () => { catalogPanel.hidden = true; dashboard.hidden = false; });
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
