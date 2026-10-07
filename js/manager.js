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
let orders = [];
let filter = 'all';
let pendingManagerPhone = '';

const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
const date = value => value ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const statusLabel = status => ({ draft:'Новая заявка', pending_review:'Проверка документов', awaiting_payment:'Ожидает оплаты', payment_review:'Проверка оплаты', confirmed:'Оплата подтверждена', awaiting_pickup:'Готовится к выдаче', issued:'Выдана', in_use:'Активна', return_requested:'Возврат', returned:'Проверка возврата', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена' }[status] || status || 'Новая');
const docLabel = kind => ({ identity:'Документ', selfie:'Селфи', supporting:'Подтверждение' }[kind] || 'Документ');
const canDelete = order => ['draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed', 'awaiting_pickup', 'cancelled', 'rejected'].includes(order.status);
const nextAction = status => ({ pending_review:{ next:'awaiting_payment', label:'Перевести к оплате' }, awaiting_payment:{ next:'confirmed', label:'Оплата проверена' }, confirmed:{ next:'awaiting_pickup', label:'Ноутбук подготовлен' }, awaiting_pickup:{ next:'issued', label:'Отметить выдачу' }, issued:{ next:'in_use', label:'Подтвердить получение' }, return_requested:{ next:'returned', label:'Техника получена' }, returned:{ next:'completed', label:'Завершить аренду' } })[status] || null;

function closeDocumentViewer() { if (!documentViewer) return; documentViewer.hidden = true; if (documentViewerContent) documentViewerContent.innerHTML = ''; document.body.style.overflow = ''; }
function openDocumentViewer(url, name = 'Документ', contentType = '') { if (!documentViewer || !documentViewerContent || !url) return; const isPdf = contentType === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(name); documentViewerContent.innerHTML = isPdf ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>` : `<img src="${escape(url)}" alt="${escape(name)}">`; documentViewer.hidden = false; document.body.style.overflow = 'hidden'; }
async function api(method = 'GET', payload) { const response = await fetch('/api/manager', { method, credentials:'same-origin', cache:'no-store', headers:payload ? { 'content-type':'application/json' } : {}, body:payload ? JSON.stringify(payload) : undefined }); const data = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(data.error || 'Не удалось загрузить панель.'); error.status = response.status; throw error; } return data; }
async function accountApi(payload) { const response = await fetch('/api/account', { method:'POST', credentials:'same-origin', headers:{ 'content-type':'application/json' }, body:JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Не удалось выполнить вход.'); return data; }
function phoneDigits(value) { let digits = String(value || '').replace(/\D/g, ''); if (digits.startsWith('996')) digits = digits.slice(3); if (digits.startsWith('0')) digits = digits.slice(1); return digits.slice(0, 9); }
function normalizePhone(value) { const digits = phoneDigits(value); return digits.length === 9 ? `+996${digits}` : ''; }
function formatPhone(value) { const digits = phoneDigits(value); return `+996${digits ? ` (${digits.slice(0, 3)}${digits.length > 3 ? ')' : ''}${digits.length > 3 ? ` ${digits.slice(3, 5)}` : ''}${digits.length > 5 ? `-${digits.slice(5, 7)}` : ''}${digits.length > 7 ? `-${digits.slice(7, 9)}` : ''}` : ' '}`; }
function loginMessage(text = '', type = '') { if (!managerLoginStatus) return; managerLoginStatus.textContent = text; managerLoginStatus.className = `cabinet-status${type ? ` is-${type}` : ''}`; }

function visibleOrders() {
  const query = String(searchInput?.value || '').trim().toLowerCase();
  return orders.filter(order => {
    if (query && !`${order.id} ${order.customer_name} ${order.customer_phone} ${order.laptop_title}`.toLowerCase().includes(query)) return false;
    if (filter === 'new') return ['draft','pending_review','awaiting_payment','payment_review','confirmed','awaiting_pickup'].includes(order.status);
    if (filter === 'documents') return order.documents.some(document => document.status === 'pending_review');
    if (filter === 'active') return ['issued','in_use','return_requested','returned'].includes(order.status);
    if (filter === 'closed') return ['completed','cancelled','rejected'].includes(order.status);
    return true;
  });
}

function documentCard(document) {
  const documentType = document.kind === 'supporting' && document.file_name ? ` · ${escape(document.file_name)}` : '';
  const reviewNote = document.reviewer_note ? ` · ${escape(document.reviewer_note)}` : '';
  return `<div class="manager-doc"><span>${docLabel(document.kind)}${documentType} · ${document.status === 'pending_review' ? 'на проверке' : document.status}${reviewNote}</span>${document.view_url ? `<button class="manager-doc-view" type="button" data-document-view="${escape(document.view_url)}" data-document-name="${escape(document.file_name || docLabel(document.kind))}" data-document-type="${escape(document.content_type || '')}">Открыть</button>` : ''}${document.status === 'pending_review' ? `<button class="accept" data-document="${document.id}" data-status="accepted">Принять</button><button class="reject" data-document="${document.id}" data-status="rejected">Отклонить</button>` : ''}</div>`;
}

function render() {
  const list = visibleOrders();
  const pendingDocs = orders.reduce((total, order) => total + order.documents.filter(document => document.status === 'pending_review').length, 0);
  const active = orders.filter(order => ['issued','in_use','return_requested','returned'].includes(order.status)).length;
  const fresh = orders.filter(order => ['draft','pending_review','awaiting_payment','payment_review','confirmed','awaiting_pickup'].includes(order.status)).length;
  statsEl.innerHTML = [[orders.length,'Всего заявок','all'],[fresh,'В работе','new'],[pendingDocs,'Документы на проверке','documents'],[active,'Активные аренды','active']].map(([value,label,key]) => `<button class="manager-stat ${filter === key ? 'is-active' : ''}" type="button" data-filter="${key}"><span>${label}</span><strong>${value}</strong></button>`).join('');
  ordersEl.innerHTML = list.length ? list.map(order => {
    const action = nextAction(order.status);
    const pending = order.documents.filter(document => document.status === 'pending_review').length;
    const paymentAmount = Number(order.total_amount || 0) + Number(order.deposit_amount || 0);
    const paymentAction = order.status === 'awaiting_payment' && !order.payment ? `<button class="secondary" data-create-payment="${order.id}" data-payment-amount="${paymentAmount}">Создать QR на ${paymentAmount.toLocaleString('ru-RU')} сом</button>` : '';
    const paymentState = order.payment ? `<section class="manager-section"><h3>Оплата Bakai</h3><div class="manager-request">${escape(order.payment.status)} · ${Number(order.payment.amount || 0).toLocaleString('ru-RU')} сом · ${escape(order.payment.operation_id || '')}</div></section>` : '';
    return `<article class="manager-order"><div class="manager-order-top"><div><h2>${escape(order.laptop_title)}</h2><p>Заявка ${escape(String(order.id).slice(0,8).toUpperCase())} · ${escape(order.customer_name || 'Клиент не указал имя')}</p></div><span class="manager-status-pill">${escape(statusLabel(order.status))}</span></div><div class="manager-order-grid"><div><span>Клиент</span><strong>${escape(order.customer_phone || '—')}</strong></div><div><span>Аренда</span><strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div><span>Получение</span><strong>${escape(order.delivery_type || '—')}</strong></div><div><span>Сумма<strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></span></div></div><section class="manager-section"><h3>Документы</h3><div class="manager-docs">${order.documents.length ? order.documents.map(documentCard).join('') : '<span class="manager-empty">Документы ещё не загружены</span>'}</div></section>${paymentState}<div class="manager-actions">${pending ? `<button class="secondary" data-reject-all="${order.id}">Отклонить все с причиной</button>` : ''}${paymentAction}${action ? `<button data-order-action="advance" data-order="${order.id}" data-next-status="${action.next}">${action.label}</button>` : ''}${canDelete(order) ? `<button class="danger" data-delete-order="${order.id}">Удалить тестовую заявку</button>` : ''}</div>${order.requests.length ? `<section class="manager-section"><h3>Запросы клиента</h3><div class="manager-requests">${order.requests.map(request => `<div class="manager-request">${escape(request.kind)} · ${escape(request.status)}${request.customer_message ? ` · ${escape(request.customer_message)}` : ''}</div>`).join('')}</div></section>` : ''}</article>`;
  }).join('') : '<div class="manager-empty">По этому фильтру заявок нет.</div>';
}

async function load() { statusEl.textContent = 'Загружаем заявки…'; try { const data = await api(); orders = data.orders || []; gate.hidden = true; dashboard.hidden = false; statusEl.textContent = `Обновлено: ${new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`; render(); } catch (error) { dashboard.hidden = true; gate.hidden = error.status !== 401; statusEl.textContent = error.status === 401 ? '' : error.message; } }
function setFilter(nextFilter) { filter = nextFilter; document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item.dataset.filter === filter)); render(); }

document.getElementById('manager-refresh').addEventListener('click', load);
document.querySelector('.manager-filters').addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
statsEl.addEventListener('click', event => { const button = event.target.closest('[data-filter]'); if (button) setFilter(button.dataset.filter); });
searchInput?.addEventListener('input', render);
ordersEl.addEventListener('click', async event => {
  const preview = event.target.closest('[data-document-view]');
  if (preview) return openDocumentViewer(preview.dataset.documentView, preview.dataset.documentName, preview.dataset.documentType);
  const rejectAll = event.target.closest('[data-reject-all]');
  const deleteOrder = event.target.closest('[data-delete-order]');
  const createPayment = event.target.closest('[data-create-payment]');
  const button = event.target.closest('[data-document], [data-order-action]');
  if (!rejectAll && !deleteOrder && !createPayment && !button) return;
  const target = rejectAll || deleteOrder || createPayment || button;
  if (target.disabled) return;
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
    payload = { action:'create_bakai_payment', orderId:createPayment.dataset.createPayment, amount:Number(createPayment.dataset.paymentAmount) };
    successMessage = 'QR-счёт Bakai создан и показан клиенту в личном кабинете.';
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
  target.textContent = 'Сохраняем…';
  try {
    const result = await api('POST', payload);
    if (payload.action === 'delete_test_order') orders = orders.filter(order => order.id !== payload.orderId);
    if (payload.action === 'reject_all_documents') orders.forEach(order => { if (order.id === payload.orderId) order.documents.forEach(document => { if (document.status === 'pending_review') { document.status = 'rejected'; document.reviewer_note = payload.note; } }); });
    if (payload.action === 'review_document') orders.forEach(order => order.documents.forEach(document => { if (document.id === payload.documentId) { document.status = result.document?.status || payload.status; document.reviewer_note = payload.note || document.reviewer_note; if (result.order?.status) order.status = result.order.status; } }));
    if (payload.action === 'advance_order') { const order = orders.find(item => item.id === payload.orderId); if (order) order.status = result.order?.status || payload.nextStatus; }
    if (payload.action === 'create_bakai_payment') { const order = orders.find(item => item.id === payload.orderId); if (order) order.payment = result.payment; }
    statusEl.textContent = successMessage;
    render();
    window.setTimeout(load, 900);
  } catch (error) { statusEl.textContent = error.message; target.disabled = false; target.textContent = original; }
});
document.getElementById('manager-document-viewer-close')?.addEventListener('click', closeDocumentViewer);
documentViewer?.addEventListener('click', event => { if (event.target === documentViewer) closeDocumentViewer(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !documentViewer?.hidden) closeDocumentViewer(); });
managerPhoneInput?.addEventListener('input', () => { managerPhoneInput.value = formatPhone(managerPhoneInput.value); });
managerPhoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = normalizePhone(managerPhoneInput.value); if (!phone) return loginMessage('Введите рабочий номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = managerPhoneForm.querySelector('button'); button.disabled = true; loginMessage('Отправляем код…'); try { await accountApi({ action:'request_code', phone }); pendingManagerPhone = phone; managerPhoneForm.hidden = true; managerCodeForm.hidden = false; managerCodeInput.focus(); loginMessage('Код отправлен. Введите 6 цифр из SMS.', 'success'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
managerCodeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = managerCodeInput.value.replace(/\D/g, ''); if (code.length !== 6) return loginMessage('Введите все 6 цифр кода.', 'error'); const button = managerCodeForm.querySelector('button'); button.disabled = true; loginMessage('Проверяем доступ…'); try { await accountApi({ action:'verify_code', phone:pendingManagerPhone, code, remember:true }); await load(); if (!dashboard.hidden) loginMessage(''); else loginMessage('Этот номер не имеет доступа к панели менеджера.', 'error'); } catch (error) { loginMessage(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('manager-change-phone')?.addEventListener('click', () => { managerCodeForm.hidden = true; managerPhoneForm.hidden = false; managerCodeInput.value = ''; loginMessage(''); managerPhoneInput.focus(); });
load();
