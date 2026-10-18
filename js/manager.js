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
let orders = [];
let filter = 'all';
let pendingManagerPhone = '';
let isChiefAdmin = false;
const transientOrderMessages = new Map();
let openOrderDetails = new Set();

const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const date = value => value ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const statusLabel = status => ({ draft:'Новая заявка', pending_review:'Проверка документов', awaiting_payment:'Ожидает оплаты', payment_review:'Проверка оплаты', confirmed:'Оплата подтверждена', awaiting_archa_reservation:'Резервируем ячейку', awaiting_locker_loading:'Ожидает закладки', awaiting_pickup:'Готово к получению', issued:'Ожидаем подтверждение', in_use:'Активна', return_requested:'Возврат', awaiting_return_reservation:'Резервируем возврат', awaiting_return_dropoff:'Ожидаем возврат в ячейку', returned:'Проверка возврата', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена', incident:'Инцидент — требуется решение' }[status] || status || 'Новая');
const docLabel = kind => ({ identity:'Документ', identity_front:'Документ — лицевая сторона', identity_back:'Документ — обратная сторона', selfie:'Селфи', supporting:'Подтверждение', issue_video:'Видео до получения', return_video:'Видео возврата' }[kind] || 'Документ');
const canDelete = order => ['draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup', 'cancelled', 'rejected'].includes(order.status);
const deliveryLabel = order => order.delivery_type === 'arca_locker' ? 'ARCHA POINT 24/7' : order.delivery_type === 'delivery' ? 'Доставка' : order.delivery_type === 'pickup' ? 'Самовывоз' : 'Уточняется';
const nextAction = order => {
  if (order.status === 'pending_review') return { next:'awaiting_payment', label:'Перевести к оплате' };
  return null;
};

function closeDocumentViewer() { if (!documentViewer) return; documentViewer.hidden = true; if (documentViewerContent) documentViewerContent.innerHTML = ''; document.body.style.overflow = ''; }
function openDocumentViewer(url, name = 'Документ', contentType = '') { if (!documentViewer || !documentViewerContent || !url) return; const isPdf = contentType === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(name); const isVideo = contentType.startsWith('video/') || /\.(?:mp4|mov)(?:[?#]|$)/i.test(name); documentViewerContent.innerHTML = isVideo ? `<video controls preload="metadata" src="${escape(url)}">Ваш браузер не поддерживает просмотр видео.</video>` : isPdf ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>` : `<img src="${escape(url)}" alt="${escape(name)}">`; documentViewer.hidden = false; document.body.style.overflow = 'hidden'; }
async function api(method = 'GET', payload) { const response = await fetch('/api/manager', { method, credentials:'same-origin', cache:'no-store', headers:payload ? { 'content-type':'application/json' } : {}, body:payload ? JSON.stringify(payload) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(data.error || 'Не удалось загрузить панель.'); error.status = response.status; throw error; } return data; }
async function accountApi(payload) { const response = await fetch('/api/account', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Не удалось выполнить вход.'); return data; }
function phoneDigits(value) { let digits = String(value || '').replace(/\D/g, ''); if (digits.startsWith('996')) digits = digits.slice(3); if (digits.startsWith('0')) digits = digits.slice(1); return digits.slice(0, 9); }
function normalizePhone(value) { const digits = phoneDigits(value); return digits.length === 9 ? `+996${digits}` : ''; }
function formatPhone(value) { const digits = phoneDigits(value); return `+996${digits ? ` (${digits.slice(0, 3)}${digits.length > 3 ? ')' : ''}${digits.length > 3 ? ` ${digits.slice(3, 5)}` : ''}${digits.length > 5 ? `-${digits.slice(5, 7)}` : ''}${digits.length > 7 ? `-${digits.slice(7, 9)}` : ''}` : ' '}`; }
function loginMessage(text = '', type = '') { if (!managerLoginStatus) return; managerLoginStatus.textContent = text; managerLoginStatus.className = `cabinet-status${type ? ` is-${type}` : ''}`; }
function bakaiMessage(text = '', type = '') { if (!bakaiCheck) return; bakaiCheck.textContent = text; bakaiCheck.className = `manager-bakai-check${type ? ` is-${type}` : ''}`; bakaiCheck.hidden = !text; }

function visibleOrders() {
  const query = String(searchInput?.value || '').trim().toLowerCase();
  return orders.filter(order => {
    if (query && !`${order.id} ${order.customer_name} ${order.customer_phone} ${order.laptop_title}`.toLowerCase().includes(query)) return false;
    if (filter === 'new') return ['draft','pending_review','awaiting_payment','payment_review','confirmed','awaiting_archa_reservation','awaiting_locker_loading','awaiting_pickup'].includes(order.status);
    if (filter === 'documents') return order.documents.some(document => document.status === 'pending_review');
    if (filter === 'active') return ['in_use','incident'].includes(order.status);
    if (filter === 'returns') return ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','returned'].includes(order.status);
    if (filter === 'completed') return order.status === 'completed';
    if (filter === 'closed') return ['cancelled','rejected'].includes(order.status);
    return true;
  });
}

function documentCard(document) {
  const documentType = document.kind === 'supporting' && document.file_name ? ` · ${escape(document.file_name)}` : '';
  const reviewNote = document.reviewer_note ? ` · ${escape(document.reviewer_note)}` : '';
  return `<div class="manager-doc"><span>${docLabel(document.kind)}${documentType} · ${document.status === 'pending_review' ? 'на проверке' : document.status}${reviewNote}</span>${document.view_url ? `<button class="manager-doc-view" type="button" data-document-view="${escape(document.view_url)}" data-document-name="${escape(document.file_name || docLabel(document.kind))}" data-document-type="${escape(document.content_type || '')}">Открыть</button>` : ''}${document.status === 'pending_review' ? `<button class="accept" data-document="${document.id}" data-status="accepted">Принять</button><button class="reject" data-document="${document.id}" data-status="rejected">Отклонить</button>` : ''}</div>`;
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
    ? `<div class="manager-request">✓ SMS-код отмечен как отправленный клиенту. В кабинете клиента открыт этап видео и подтверждения получения.</div><div class="manager-actions"><button class="secondary" data-manual-pickup-code="${order.id}">Повторно отправить код вручную</button></div>`
    : `<div class="manager-actions"><button class="secondary" data-archa-sms-sent="${order.id}">Подтвердить: ARCHA уже отправил SMS</button><button class="secondary" data-manual-pickup-code="${order.id}">Отправить код клиенту вручную</button></div>`;
  if (order.status === 'awaiting_return_reservation') return order.returnHandoffPrepared
    ? `<div class="manager-request">Сообщение передано ARCHA POINT. Код возврата они отправляют напрямую клиенту. Когда клиент нажмёт «Код из SMS получен», заявка обновится здесь автоматически.</div>`
    : `<div class="manager-actions"><button class="secondary" data-prepare-archa-return="${order.id}">Подготовить сообщение о возврате</button></div>`;
  if (order.status === 'awaiting_return_dropoff') return `<div class="manager-request">${order.locker_status === 'return_access_received' ? 'Клиент подтвердил получение SMS-кода.' : 'Код возврата отмечен как отправленный.'} Ожидаем, пока клиент прикрепит видео, поместит ноутбук в ячейку и сам подтвердит закрытие. После этого заявка перейдёт в «Проверка возврата».</div>`;
  return '';
}

function render() {
  openOrderDetails = new Set([...ordersEl.querySelectorAll('.manager-order-details[open]')].map(item => item.closest('[data-manager-order]')?.dataset.managerOrder).filter(Boolean));
  const list = visibleOrders();
  const pendingDocs = orders.reduce((total, order) => total + order.documents.filter(document => document.status === 'pending_review').length, 0);
  const active = orders.filter(order => ['in_use','incident'].includes(order.status)).length;
  const returns = orders.filter(order => ['return_requested','awaiting_return_reservation','awaiting_return_dropoff','returned'].includes(order.status));
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
    const action = nextAction(order);
    const pending = order.documents.filter(document => document.status === 'pending_review').length;
    const paymentAmount = Number(order.total_amount || 0) + Number(order.deposit_amount || 0);
    const hasActivePayment = order.payment?.status === 'awaiting_payment' && new Date(order.payment.expires_at) > new Date();
    const paymentAction = order.status === 'awaiting_payment' && !hasActivePayment ? `<div class="manager-payment-create"><label>Сумма к оплате, сом<input data-payment-amount type="number" min="1" max="1000000" step="1" value="${paymentAmount}"></label><small>Расчёт сайта: ${paymentAmount.toLocaleString('ru-RU')} сом${Number(order.deposit_amount || 0) ? `, включая залог ${Number(order.deposit_amount).toLocaleString('ru-RU')} сом` : ''}.</small><button class="secondary" data-create-payment="${order.id}">Создать настоящий QR-счёт</button></div>` : '';
    const paymentMismatch = ['confirmed','awaiting_pickup','issued','in_use'].includes(order.status) && order.payment?.status === 'awaiting_payment' ? '<p class="manager-payment-warning">Банк ещё не подтвердил этот QR. Не выдавайте ноутбук: статус заявки был изменён вручную, а оплата не зафиксирована webhook-ом.</p>' : '';
    const manualPaymentAction = hasActivePayment ? `<button class="secondary manager-payment-manual" data-manual-payment="${order.id}">Подтвердить оплату вручную</button>` : '';
    const paymentState = order.payment ? `<section class="manager-section"><h3>Оплата Bakai</h3><div class="manager-request">${escape(order.payment.status)} · ${Number(order.payment.amount || 0).toLocaleString('ru-RU')} сом · ${escape(order.payment.operation_id || '')}${hasActivePayment ? `<button class="danger manager-payment-revoke" data-revoke-payment="${order.id}">Отозвать QR</button>` : ''}</div>${hasActivePayment ? '<p class="manager-payment-warning">Используйте ручное подтверждение только после проверки поступления в Bakai Business. Отзыв уберёт QR из кабинета Rentop, но не отменяет его в Банке.</p>' : ''}${paymentMismatch}</section>` : '';
    const extensionRequest = order.requests.find(request => request.kind === 'extension' && ['open','in_progress'].includes(request.status));
    const extensionPayment = (order.payments || []).find(payment => payment.purpose === 'extension' && extensionRequest && payment.request_id === extensionRequest.id && ['awaiting_payment','paid'].includes(payment.status));
    const extensionAction = extensionRequest ? `<section class="manager-section"><h3>Продление аренды</h3><div class="manager-request">+${Number(extensionRequest.requested_days || 0)} дн. · до ${date(extensionRequest.proposed_return_date)} · ${Number(extensionRequest.estimated_amount || 0).toLocaleString('ru-RU')} сом</div>${extensionPayment ? `<p>${extensionPayment.status === 'paid' ? '✓ Продление оплачено — дата обновлена.' : 'QR продления уже показан клиенту.'}</p>` : `<div class="manager-payment-create"><label>Доплата за продление, сом<input data-extension-payment-amount type="number" min="1" max="1000000" step="1" value="${Number(extensionRequest.estimated_amount || 0)}"></label><button class="secondary" data-create-extension-payment="${order.id}" data-request-id="${extensionRequest.id}">Создать QR продления</button></div>`}</section>` : '';
    const customerNote = order.customer_note ? `<section class="manager-section"><h3>Комментарий клиента</h3><div class="manager-request">${escape(order.customer_note)}</div></section>` : '';
    const supportCases = (order.supportCases || []).filter(item => item.status === 'open');
    const supportPanel = supportCases.length ? `<section class="manager-section"><h3>Открытые обращения клиента</h3><p>Клиент: <strong>${escape(order.customer_phone || 'номер не указан')}</strong> — можно связаться вручную или отправить ответ в кабинет ниже.</p><div class="manager-requests">${supportCases.map(item => `<div class="manager-request"><strong>${escape(({ rentop:'Вопрос к Rentop', archa:'Проблема с ARCHA POINT', archa_code_missing:'Не пришёл код ARCHA POINT', archa_locker_issue:'Постамат не выдаёт / не открывается', rental_issue:'Проблема с ноутбуком' }[item.kind] || item.kind))}</strong><br>${escape(item.customer_message || 'Сообщение не указано')}<br><small>${date(item.opened_at)}</small>${item.manager_reply ? `<p><strong>Ответ менеджера:</strong> ${escape(item.manager_reply)}</p>` : ''}<textarea data-support-reply="${escape(item.kind)}" maxlength="1500" placeholder="Напишите ответ клиенту — он появится в личном кабинете"></textarea><div class="manager-actions"><button class="secondary" data-reply-support="${order.id}" data-support-kind="${escape(item.kind)}">Отправить ответ</button><button class="secondary" data-resolve-support="${order.id}" data-support-kind="${escape(item.kind)}">Отметить решённым</button></div></div>`).join('')}</div></section>` : '';
    const offerEvidence = order.offer_accepted_at ? `<section class="manager-section"><h3>Оферта и согласия</h3><div class="manager-request">Оферта ${escape(order.offer_version || '—')} · принята ${date(order.offer_accepted_at)} · SMS ${order.offer_otp_verified_at ? `подтверждён ${date(order.offer_otp_verified_at)}` : 'ещё не подтверждён'}</div></section>` : '';
    const registry = `<section class="manager-section"><h3>Внутренний реестр аренды</h3><div class="manager-registry-form"><label>Цель аренды / задачи клиента<textarea data-registry-purpose maxlength="600" placeholder="Например: монтаж видео, учёба, офисная работа">${escape(order.rental_purpose || '')}</textarea></label><label>Заметка менеджера<textarea data-registry-note maxlength="2000" placeholder="Договорённости, комплектация, важные детали">${escape(order.manager_note || '')}</textarea></label><label>Состояние при возврате<textarea data-registry-return maxlength="2000" placeholder="Заполняется после осмотра: корпус, зарядка, комплектность, замечания">${escape(order.return_condition_note || '')}</textarea></label><button class="secondary" data-save-registry="${order.id}">Сохранить реестр</button></div><p>В реестре: модель ${escape(order.laptop_title || '—')}, S/N ${escape(order.laptop_serial_number || 'не указан')}, инв. код ${escape(order.laptop_inventory_code || 'не указан')}.</p></section>`;
    const loyaltyAction = order.status === 'completed' ? `<section class="manager-section"><h3>Лояльность клиента</h3><div class="manager-actions"><button class="secondary" data-issue-promo="${order.id}">Выдать персональный промокод</button></div><p>Промокод привязывается к номеру клиента и будет виден только в его личном кабинете.</p></section>` : '';
    const assetTools = isChiefAdmin ? `<section class="manager-section"><h3>Учёт устройства</h3><div class="manager-payment-create"><label>Заводской S/N<input data-asset-serial type="text" maxlength="160" value="${escape(order.laptop_serial_number || '')}" placeholder="Например: C02ABC123XYZ"></label><label>Инвентарный код Rentop<input data-asset-inventory type="text" maxlength="100" value="${escape(order.laptop_inventory_code || '')}" placeholder="Например: RT-0001"></label><button class="secondary" data-save-asset="${order.laptop_id}">Сохранить идентификаторы</button></div></section>` : '';
    const incidentTools = order.status === 'incident' ? `<button class="secondary" data-admin-resolve-incident="${order.id}">Разрешить инцидент</button>` : '';
    const adminTools = isChiefAdmin ? `<section class="manager-section"><h3>Контроль главного администратора</h3><div class="manager-actions"><a class="cabinet-action secondary" href="/api/manager/dossier?order=${encodeURIComponent(order.id)}">Скачать защищённое досье</a>${['in_use','return_requested','awaiting_return_reservation','awaiting_return_dropoff','returned'].includes(order.status) ? `<button class="secondary" data-admin-close="${order.id}">Досрочно завершить после возврата</button>` : ''}${incidentTools}${!['completed','cancelled','rejected','incident'].includes(order.status) ? `<button class="danger" data-admin-incident="${order.id}">Открыть инцидент</button>` : ''}</div></section>` : '';
    const handoffMessage = transientOrderMessages.get(order.id);
    const handoffPanel = handoffMessage ? `<section class="manager-section"><h3>Сообщение для рабочей группы ARCHA POINT</h3><textarea class="manager-handoff-copy" readonly>${escape(handoffMessage)}</textarea><p>Текст уже скопирован в буфер, но его также можно выделить и скопировать вручную. Не добавляйте в группу паспортные данные и файлы клиента.</p></section>` : '';
    const documentsPanel = `<section class="manager-section"><h3>Документы</h3><div class="manager-docs">${order.documents.length ? order.documents.map(documentCard).join('') : '<span class="manager-empty">Документы ещё не загружены</span>'}</div></section>`;
    const requestsPanel = order.requests.length ? `<section class="manager-section"><h3>Запросы клиента</h3><div class="manager-requests">${order.requests.map(request => `<div class="manager-request">${escape(request.kind)} · ${escape(request.status)}${request.return_method ? ` · ${escape(request.return_method)}` : ''}${request.return_locker_address ? ` · ${escape(request.return_locker_address)}` : ''}${request.customer_message ? ` · ${escape(request.customer_message)}` : ''}</div>`).join('')}</div></section>` : '';
    const directDocuments = pending ? documentsPanel : '';
    const details = `${pending ? '' : documentsPanel}${offerEvidence}${customerNote}${registry}${paymentState}${lockerInstruction(order)}${handoffPanel}${assetTools}${loyaltyAction}${adminTools}${requestsPanel}`;
    const acceptedReturnVideo = order.documents.some(document => document.kind === 'return_video' && document.status === 'accepted');
    const returnAcceptance = ['return_requested','returned'].includes(order.status)
      ? (acceptedReturnVideo
        ? `<button data-complete-return="${order.id}">Подтвердить приём и сформировать акт</button>`
        : `<span class="manager-action-note">Ожидаем видео возврата от клиента. После его проверки появится подтверждение приёма и акт.</span>`)
      : '';
    const workflowActions = `${pending ? `<button class="secondary" data-reject-all="${order.id}">Отклонить все с причиной</button>` : ''}${extensionAction}${paymentAction}${manualPaymentAction}${archaControls(order)}${returnAcceptance}${action ? `<button data-order-action="advance" data-order="${order.id}" data-next-status="${action.next}">${action.label}</button>` : ''}${canDelete(order) ? `<button class="danger" data-delete-order="${order.id}">Удалить тестовую заявку</button>` : ''}`;
    return `<article class="manager-order" data-manager-order="${order.id}"><div class="manager-order-top"><div><h2>${escape(order.laptop_title)}</h2><p>Заявка ${escape(String(order.id).slice(0,8).toUpperCase())} · ${escape(order.customer_name || 'Клиент не указал имя')}</p></div><span class="manager-status-pill ${escape(order.status)}">${escape(statusLabel(order.status))}</span></div><div class="manager-order-grid"><div><span>Клиент</span><strong>${escape(order.customer_phone || '—')}</strong></div><div><span>Аренда</span><strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div><span>Получение</span><strong>${escape(deliveryLabel(order))}${order.locker_address ? `<br><small>${escape(order.locker_address)}</small>` : ''}</strong></div><div><span>Сумма аренды</span><strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div><div><span>Залог / скидка</span><strong>${Number(order.deposit_amount || 0).toLocaleString('ru-RU')} сом · ${Number(order.discount_percent || 0)}%</strong></div></div>${directDocuments}${supportPanel}<div class="manager-actions manager-workflow-actions">${workflowActions || '<span class="manager-action-note">Следующее действие появится после обновления статуса.</span>'}</div><p class="manager-order-feedback" data-order-feedback="${order.id}" hidden></p><details class="manager-order-details" ${openOrderDetails.has(String(order.id)) ? 'open' : ''}><summary>Детали заявки, реестр и служебные данные</summary>${details}</details></article>`;
  }).join('') : '<div class="manager-empty">По этому фильтру заявок нет.</div>';
}

async function load(silent = false) { if (!silent) statusEl.textContent = 'Загружаем заявки…'; try { const data = await api(); orders = data.orders || []; isChiefAdmin = Boolean(data.isChiefAdmin); gate.hidden = true; dashboard.hidden = false; if (!silent) statusEl.textContent = `Обновлено: ${new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`; render(); } catch (error) { dashboard.hidden = true; gate.hidden = error.status !== 401; statusEl.textContent = error.status === 401 ? '' : error.message; } }
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
clearTestsButton?.addEventListener('click', async () => {
  const count = orders.filter(canDelete).length;
  if (!count) { statusEl.textContent = 'Безопасных тестовых заявок для удаления нет.'; return; }
  if (!window.confirm(`Удалить ${count} тестовых заявок и их прикреплённые документы? Активные, выданные и завершённые аренды останутся.`)) return;
  clearTestsButton.disabled = true;
  const original = clearTestsButton.textContent;
  clearTestsButton.textContent = 'Очищаем…';
  try {
    const result = await api('POST', { action:'clear_test_orders' });
    const removed = new Set(result.deletedOrderIds || []);
    orders = orders.filter(order => !removed.has(order.id));
    statusEl.textContent = `Удалено тестовых заявок: ${removed.size}. Сохранено активных/завершённых: ${result.preserved}.`;
    render();
  } catch (error) { statusEl.textContent = error.message; } finally { clearTestsButton.disabled = false; clearTestsButton.textContent = original; }
});
document.querySelector('.manager-filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
statsEl.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
returnAlert?.addEventListener('click', () => { setFilter('returns'); document.querySelector('.manager-toolbar')?.scrollIntoView({ behavior:'smooth', block:'start' }); });
searchInput?.addEventListener('input', render);
ordersEl.addEventListener('click', async event => {
  const preview = event.target.closest('[data-document-view]');
  if (preview) return openDocumentViewer(preview.dataset.documentView, preview.dataset.documentName, preview.dataset.documentType);
  const rejectAll = event.target.closest('[data-reject-all]');
  const deleteOrder = event.target.closest('[data-delete-order]');
  const createPayment = event.target.closest('[data-create-payment]');
  const createExtensionPayment = event.target.closest('[data-create-extension-payment]');
  const revokePayment = event.target.closest('[data-revoke-payment]');
  const manualPayment = event.target.closest('[data-manual-payment]');
  const prepareArcha = event.target.closest('[data-prepare-archa]');
  const recordArchaReservation = event.target.closest('[data-record-archa-reservation]');
  const markLockerLoaded = event.target.closest('[data-mark-locker-loaded]');
  const archaSmsSent = event.target.closest('[data-archa-sms-sent]');
  const manualPickupCode = event.target.closest('[data-manual-pickup-code]');
  const prepareArchaReturn = event.target.closest('[data-prepare-archa-return]');
  const completeReturn = event.target.closest('[data-complete-return]');
  const adminClose = event.target.closest('[data-admin-close]');
  const adminIncident = event.target.closest('[data-admin-incident]');
  const adminResolveIncident = event.target.closest('[data-admin-resolve-incident]');
  const saveAsset = event.target.closest('[data-save-asset]');
  const saveRegistry = event.target.closest('[data-save-registry]');
  const issuePromo = event.target.closest('[data-issue-promo]');
  const resolveSupport = event.target.closest('[data-resolve-support]');
  const replySupport = event.target.closest('[data-reply-support]');
  const button = event.target.closest('[data-document], [data-order-action]');
  if (!rejectAll && !deleteOrder && !createPayment && !createExtensionPayment && !revokePayment && !manualPayment && !prepareArcha && !recordArchaReservation && !markLockerLoaded && !archaSmsSent && !manualPickupCode && !prepareArchaReturn && !completeReturn && !adminClose && !adminIncident && !adminResolveIncident && !saveAsset && !saveRegistry && !issuePromo && !resolveSupport && !replySupport && !button) return;
  const target = rejectAll || deleteOrder || createPayment || createExtensionPayment || revokePayment || manualPayment || prepareArcha || recordArchaReservation || markLockerLoaded || archaSmsSent || manualPickupCode || prepareArchaReturn || completeReturn || adminClose || adminIncident || adminResolveIncident || saveAsset || saveRegistry || issuePromo || resolveSupport || replySupport || button;
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
  } else if (deleteOrder) {
    if (!window.confirm('Удалить эту тестовую заявку вместе с её документами? Действие нельзя отменить.')) return;
    payload = { action:'delete_test_order', orderId:deleteOrder.dataset.deleteOrder };
    successMessage = 'Тестовая заявка удалена.';
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
  } else if (archaSmsSent) {
    payload = { action:'mark_archa_access_sent', orderId:archaSmsSent.dataset.archaSmsSent };
    successMessage = 'Зафиксировано: ARCHA POINT сообщил, что отправил SMS. Rentop не отправлял код этой кнопкой.';
  } else if (manualPickupCode) {
    const code = window.prompt('Введите код получения, подтверждённый у ARCHA POINT. Он будет отправлен клиенту по SMS через Rentop:');
    if (!code?.trim()) return;
    if (!window.confirm('Отправить этот код клиенту по SMS? Убедитесь, что он получен у ARCHA POINT и относится к этой заявке.')) return;
    payload = { action:'send_manual_pickup_code', orderId:manualPickupCode.dataset.manualPickupCode, code:code.trim() };
    successMessage = 'Код отправлен клиенту по SMS и зафиксирован в журнале.';
  } else if (prepareArchaReturn) {
    payload = { action:'prepare_archa_return_handoff', orderId:prepareArchaReturn.dataset.prepareArchaReturn };
    successMessage = 'Сообщение о возврате для ARCHA POINT подготовлено.';
  } else if (completeReturn) {
    const card = completeReturn.closest('.manager-order');
    const returnConditionNote = card?.querySelector('[data-registry-return]')?.value?.trim() || '';
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
    payload = { action:'save_order_registry', orderId:saveRegistry.dataset.saveRegistry, rentalPurpose:card?.querySelector('[data-registry-purpose]')?.value || '', managerNote:card?.querySelector('[data-registry-note]')?.value || '', returnConditionNote:card?.querySelector('[data-registry-return]')?.value || '' };
    successMessage = 'Внутренний реестр аренды сохранён.';
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
    if (payload.action === 'delete_test_order') orders = orders.filter(order => order.id !== payload.orderId);
    if (payload.action === 'reject_all_documents') orders.forEach(order => { if (order.id === payload.orderId) order.documents.forEach(document => { if (document.status === 'pending_review') { document.status = 'rejected'; document.reviewer_note = payload.note; } }); });
    if (payload.action === 'review_document') orders.forEach(order => order.documents.forEach(document => { if (document.id === payload.documentId) { document.status = result.document?.status || payload.status; document.reviewer_note = payload.note || document.reviewer_note; if (result.order?.status) order.status = result.order.status; } }));
    if (payload.action === 'advance_order') { const order = orders.find(item => item.id === payload.orderId); if (order) order.status = result.order?.status || payload.nextStatus; }
    if (payload.action === 'complete_return_acceptance') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'create_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'revoke_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    if (payload.action === 'confirm_bakai_payment_manually') { const order = orders.find(item => item.id === payload.orderId); if (order) { order.payment = result.payment; if (result.order) Object.assign(order, result.order); } }
    if (payload.action === 'create_extension_bakai_payment') await load();
    if (['admin_close_rental_early','admin_open_incident'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'admin_resolve_incident') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'admin_update_laptop_asset') { orders.forEach(order => { if (order.laptop_id === payload.laptopId) { order.laptop_serial_number = result.laptop?.serial_number || ''; order.laptop_inventory_code = result.laptop?.inventory_code || ''; } }); }
    if (payload.action === 'save_order_registry') { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
    if (payload.action === 'resolve_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, status:'resolved' } : item); }
    if (payload.action === 'reply_support_case') { const order = orders.find(item => item.id === payload.orderId); if (order && result.supportCase) order.supportCases = (order.supportCases || []).map(item => item.kind === payload.kind ? { ...item, ...result.supportCase } : item); }
    if (['prepare_archa_handoff','record_archa_reservation','mark_locker_loaded','mark_archa_access_sent','send_manual_pickup_code'].includes(payload.action)) { const order = orders.find(item => item.id === payload.orderId); if (order && result.order) Object.assign(order, result.order); }
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
load();
