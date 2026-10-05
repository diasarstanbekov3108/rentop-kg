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
const documentViewer = document.getElementById('cabinet-document-viewer');
const documentViewerContent = document.getElementById('cabinet-document-viewer-content');
let pendingPhone = '';
let currentPreviewUrl = '';

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
  awaiting_payment:{ title:'Ожидает оплаты', text:'После подтверждения оплаты менеджер подготовит выдачу.', step:1 },
  payment_review:{ title:'Проверяем оплату', text:'Менеджер проверяет поступление оплаты.', step:2 },
  confirmed:{ title:'Заявка подтверждена', text:'Ноутбук готовится к выдаче.', step:2 },
  awaiting_pickup:{ title:'Готовится к выдаче', text:'Мы подготовим PIN/QR и покажем его здесь.', step:3 },
  issued:{ title:'Ноутбук выдан', text:'Подтвердите получение, если ещё не сделали этого.', step:4 },
  in_use:{ title:'Аренда активна', text:'Здесь можно продлить аренду или начать возврат.', step:4 },
  return_requested:{ title:'Возврат оформляется', text:'Менеджер подготовит дальнейшие инструкции и доступ к ячейке.', step:5 },
  returned:{ title:'Возврат на проверке', text:'Мы проверяем технику и сообщим о завершении.', step:5 },
  completed:{ title:'Аренда завершена', text:'Спасибо, что выбрали Rentop.', step:5 },
  cancelled:{ title:'Заявка отменена', text:'Эти даты снова доступны для бронирования.', step:0 },
  rejected:{ title:'Заявка не подтверждена', text:'Свяжитесь с поддержкой, если остались вопросы.', step:0 }
}[status] || { title:'Заявка обрабатывается', text:'Мы сообщим, когда потребуется действие.', step:1 });
const date = (value) => value ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`)) : '—';
const escape = (value) => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

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
  documentViewerContent.innerHTML = isFrame
    ? `<iframe src="${escape(url)}" title="${escape(name)}"></iframe>`
    : `<img src="${escape(url)}" alt="${escape(name)}">`;
  documentViewer.hidden = false;
  document.body.style.overflow = 'hidden';
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
  const state = (kind, label) => {
    const document = latest.get(kind);
    const text = `${document ? (document.status === 'rejected' ? '↺' : '✓') : '○'} ${label}`;
    return document?.view_url
      ? `<button type="button" class="cabinet-doc-chip" data-document-view="${escape(document.view_url)}" data-document-name="${escape(document.file_name || label)}" data-document-type="${escape(document.content_type || '')}">${text}</button>`
      : `<span>${text}</span>`;
  };
  const reasons = [...latest.values()].filter(document => document.status === 'rejected' && document.reviewer_note).map(document => `<li><strong>${escape(({ identity:'Документ', selfie:'Селфи', supporting:'Подтверждение' }[document.kind] || 'Документ'))}:</strong> ${escape(document.reviewer_note)}</li>`).join('');
  return `<div class="cabinet-doc-summary">${state('identity', 'Документ')}${state('selfie', 'Селфи')}${state('supporting', 'Подтверждение')}</div>${reasons ? `<div class="cabinet-document-reasons"><strong>Нужно исправить</strong><ul>${reasons}</ul></div>` : ''}`;
}
function documentMode(order) {
  const latest = latestDocuments(order);
  const required = ['identity', 'selfie'];
  const missing = required.filter(kind => !latest.has(kind));
  const rejected = required.filter(kind => latest.get(kind)?.status === 'rejected');
  if (rejected.length) return { mode:'replacement', kinds:rejected };
  if (missing.length) return { mode:'upload', kinds:missing };
  return { mode:'submitted', kinds:[] };
}
function actionPanel(order) {
  const canAct = ['issued', 'in_use'].includes(order.status);
  const openExtension = order.requests?.find(request => request.kind === 'extension' && ['open','in_progress'].includes(request.status));
  const openReturn = order.requests?.find(request => request.kind === 'early_return' && ['open','in_progress'].includes(request.status));
  const docState = documentMode(order);
  const documentText = docState.mode === 'submitted' ? 'Документы на проверке' : docState.mode === 'replacement' ? 'Заменить документ' : 'Документы и договор';
  const documents = `<button class="cabinet-action secondary" data-panel="documents" data-document-mode="${docState.mode}" data-document-kinds="${docState.kinds.join(',')}" data-order="${order.id}">${documentText}</button>`;
  if (openExtension || openReturn) return `${documents}<div class="cabinet-request-state">⌛ ${escape(requestLabel(openExtension || openReturn))}: ожидает решения менеджера</div>`;
  if (!canAct) return `${documents}<div class="cabinet-action-disabled">Продление и досрочный возврат станут доступны после выдачи ноутбука.</div><button class="cabinet-action secondary" data-panel="support" data-order="${order.id}">Нужна помощь</button>`;
  return `<div class="cabinet-actions">${documents}<button class="cabinet-action" data-panel="extend" data-order="${order.id}">Продлить аренду</button><button class="cabinet-action secondary" data-panel="return" data-order="${order.id}">Вернуть раньше</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button></div>`;
}
function requestForm(order) {
  return `<div class="cabinet-request-panel" id="panel-${order.id}" hidden></div>`;
}
function panelMarkup(kind, orderId, documentState = {}) {
  if (kind === 'documents') {
    if (documentState.mode === 'submitted') return `<div class="cabinet-document-wait"><strong>Документы отправлены</strong><p>Ваша заявка обрабатывается. Ожидайте ответа менеджера — повторная отправка заблокирована.</p><button class="cabinet-action ghost" type="button" data-document-correction="${orderId}">Я отправил(а) неверный документ</button></div>`;
    const replacement = documentState.mode === 'replacement';
    const kinds = replacement ? String(documentState.kinds || '').split(',').filter(Boolean) : ['identity', 'selfie', 'supporting'];
    const requiredKinds = replacement ? kinds : ['identity', 'selfie'];
    const offer = replacement ? '' : `<div class="cabinet-offer-box"><strong>Публичная оферта Rentop KG</strong><p>До отправки документов прочитайте условия аренды, выдачи и возврата.</p><button class="cabinet-action secondary" type="button" data-open-offer="true">Открыть договор-оферту</button><label class="cabinet-document-consent"><input name="offerConsent" type="checkbox" required><span>Я ознакомился(лась) с публичной офертой и принимаю её условия.</span></label></div>`;
    const warnings = replacement ? '' : `<div class="cabinet-safety-notice"><strong>Важно о документах и технике</strong><p>Подделка, использование чужих или заведомо недостоверных документов может повлечь ответственность по законодательству Кыргызской Республики. Rentop проверяет документы до выдачи.</p><p>На выдаваемом оборудовании установлены средства контроля местонахождения и целостности, включая GPS-трекеры и гарантийные пломбы. Несанкционированное вскрытие, нарушение пломб или попытка отключить средства контроля считаются нарушением правил эксплуатации и могут повлечь штраф, возмещение ущерба и обращение в уполномоченные органы.</p></div>`;
    return `<form class="cabinet-inline-form cabinet-documents-form" data-document-upload="true" data-document-replacement="${replacement ? '1' : ''}" data-required-kinds="${requiredKinds.join(',')}" data-order="${orderId}"><label>${replacement ? 'Прикрепите исправленный документ' : 'Подтвердите данные для заявки'}</label><p>${replacement ? 'Менеджер открыл замену для отмеченного файла. После повторной загрузки заявка снова уйдёт на проверку.' : 'Документы увидит только команда Rentop для проверки заявки. Допустимы JPG, PNG или PDF до 8 МБ.'}</p>${kinds.map(fileControl).join('')}${offer}${warnings}<label class="cabinet-document-consent"><input name="documentConsent" type="checkbox" required><span>Согласен(на) на передачу документов команде Rentop исключительно для проверки заявки и оформления договора.</span></label><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">${replacement ? 'Отправить замену' : 'Отправить на проверку'}</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>После отправки повторная загрузка будет заблокирована до решения менеджера.</p></form>`;
  }
  if (kind === 'extend') return `<form class="cabinet-inline-form" data-request="extension_request" data-order="${orderId}"><label>На сколько дней продлить?</label><div class="cabinet-inline-row"><input name="days" type="number" min="1" max="30" value="3" required><button class="cabinet-action" type="submit">Отправить запрос</button></div><p>Менеджер проверит доступность и пришлёт сумму к оплате.</p></form>`;
  if (kind === 'return') return `<form class="cabinet-inline-form" data-request="early_return_request" data-order="${orderId}"><label>Коротко опишите причину (необязательно)</label><textarea name="message" maxlength="500" placeholder="Например: изменились планы, хочу вернуть сегодня"></textarea><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Запросить возврат</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Не кладите ноутбук в ячейку, пока не появится инструкция и новый PIN/QR.</p></form>`;
  return `<form class="cabinet-inline-form" data-request="support_request" data-order="${orderId}"><label>Чем помочь?</label><select name="kind"><option value="rentop">Вопрос к Rentop</option><option value="archa">Проблема с ARCHA POINT</option></select><textarea name="message" minlength="3" maxlength="1000" placeholder="Опишите ситуацию — менеджер увидит сообщение"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить обращение</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}
function fileControl(kind) {
  const [title, hint] = ({ identity:['Паспорт или ID-карта', 'обязательно'], selfie:['Селфи с документом', 'обязательно'], supporting:['Официальное подтверждение', 'необязательно: выберите тип документа ниже'] }[kind] || ['Документ', '']);
  const typeChoice = kind === 'supporting' ? `<select name="supportingType" class="cabinet-document-type"><option value="">Выберите документ</option><option value="Справка с места работы">Справка с места работы</option><option value="Справка с места жительства">Справка с места жительства</option><option value="Тундук">Документ / скрин из Тундук</option><option value="Иной официальный документ">Иной официальный документ</option></select>` : '';
  return `<div class="cabinet-file-control"><label for="document-${kind}">${title} <span>${hint}</span></label>${typeChoice}<input id="document-${kind}" name="${kind}" type="file" accept="image/jpeg,image/png,application/pdf" hidden><div><button class="cabinet-file-choose" type="button" data-file-trigger="${kind}">Выберите файл</button><button class="cabinet-file-preview" type="button" data-file-preview="${kind}" disabled>Файл не выбран</button></div></div>`;
}

function showRentals(orders, phone, profile = null) {
  login.hidden = true; dashboard.hidden = false;
  const fullName = String(profile?.full_name || '').trim();
  document.getElementById('cabinet-greeting').textContent = fullName ? `Здравствуйте, ${fullName.split(' ')[1] || fullName}!` : 'Здравствуйте!';
  profileEl.innerHTML = fullName
    ? `<p class="cabinet-profile-name">Личный кабинет · ${escape(fullName)} · ${phone}</p>`
    : `<form class="cabinet-profile-form" id="profile-form"><label for="profile-full-name">Заполните ФИО для договора</label><div><input id="profile-full-name" name="fullName" autocomplete="name" placeholder="Фамилия Имя Отчество" required><button class="cabinet-action" type="submit">Сохранить</button></div><p>Указывайте данные так же, как в документе.</p></form>`;
  const created = new URLSearchParams(window.location.search).get('created');
  dashboardNotice.hidden = !created;
  if (created) dashboardNotice.textContent = 'Заявка создана и уже появилась в кабинете. Следующий шаг покажем здесь.';
  rentalsEl.innerHTML = orders.map(order => {
    const state = statusInfo(order.status);
    return `<article class="cabinet-rental" data-rental="${order.id}"><div class="cabinet-rental-top"><div><h3>${escape(order.laptop_title || 'Ноутбук Rentop')}</h3><p class="cabinet-rental-ref">Заявка ${escape(order.reference)}</p></div><span class="cabinet-badge">${escape(state.title)}</span></div><div class="cabinet-progress" aria-label="Этап ${state.step} из 5"><span class="is-done"></span><span class="${state.step >= 2 ? 'is-done' : ''}"></span><span class="${state.step >= 3 ? 'is-done' : ''}"></span><span class="${state.step >= 4 ? 'is-done' : ''}"></span><span class="${state.step >= 5 ? 'is-done' : ''}"></span></div><p class="cabinet-next-step">${escape(state.text)}</p>${documentSummary(order)}<div class="cabinet-rental-grid"><div>Срок<strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div>Получение<strong>${escape(order.delivery_label)}</strong></div><div>Сумма<strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div></div>${actionPanel(order)}${requestForm(order)}</article>`;
  }).join('');
  emptyEl.hidden = orders.length !== 0;
  if (new URLSearchParams(window.location.search).get('return') === 'booking') {
    window.setTimeout(() => window.location.assign('/?resume_booking=1'), 250);
  }
}
async function loadSession() {
  try {
    const data = await request('GET');
    loading.hidden = true;
    if (data.authenticated) { showRentals(data.orders || [], data.phone, data.profile); return; }
    login.hidden = false;
  } catch {
    loading.hidden = true;
    login.hidden = false;
  }
}

phoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = formatPhone(phoneInput.value); if (!phone) return message('Введите номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = phoneForm.querySelector('button'); button.disabled = true; message('Отправляем код…'); try { await request('POST', { action:'request_code', phone }); pendingPhone = phone; phoneForm.hidden = true; codeForm.hidden = false; codeInput.focus(); message('Код отправлен. Введите 6 цифр из SMS.', 'success'); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
codeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = codeInput.value.replace(/\D/g, ''); if (code.length !== 6) return message('Введите все 6 цифр кода.', 'error'); const button = codeForm.querySelector('button'); button.disabled = true; message('Проверяем код…'); try { const remember = document.getElementById('cabinet-remember')?.checked !== false; const data = await request('POST', { action:'verify_code', phone:pendingPhone, code, remember }); showRentals(data.orders || [], data.phone, data.profile); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('change-phone')?.addEventListener('click', () => { codeForm.hidden = true; phoneForm.hidden = false; codeInput.value = ''; message(''); phoneInput.focus(); });
document.getElementById('cabinet-logout')?.addEventListener('click', async () => { await request('POST', { action:'logout' }).catch(() => {}); dashboard.hidden = true; login.hidden = false; phoneForm.hidden = false; codeForm.hidden = true; phoneInput.value = ''; codeInput.value = ''; pendingPhone = ''; message('Вы вышли из кабинета.'); });
rentalsEl?.addEventListener('click', event => {
  const offerButton = event.target.closest('[data-open-offer]');
  if (offerButton) {
    openDocumentViewer('/offer', 'Публичная оферта Rentop KG', 'text/html');
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
  const savedDocument = event.target.closest('[data-document-view]');
  if (savedDocument) {
    openDocumentViewer(savedDocument.dataset.documentView, savedDocument.dataset.documentName, savedDocument.dataset.documentType);
    return;
  }
  const button = event.target.closest('[data-panel]');
  if (button) {
    const panel = document.getElementById(`panel-${button.dataset.order}`);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    panel.innerHTML = panel.hidden ? '' : panelMarkup(button.dataset.panel, button.dataset.order, { mode:button.dataset.documentMode, kinds:button.dataset.documentKinds });
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
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !documentViewer?.hidden) closeDocumentViewer(); });
rentalsEl?.addEventListener('change', event => {
  const input = event.target.closest('input[type="file"]');
  if (!input) return;
  const preview = input.closest('.cabinet-file-control')?.querySelector('[data-file-preview]');
  if (!preview) return;
  const file = input.files?.[0];
  preview.disabled = !file;
  preview.textContent = file ? `Открыть: ${file.name}` : 'Файл не выбран';
});
rentalsEl?.addEventListener('submit', async event => {
  const documentForm = event.target.closest('[data-document-upload]');
  if (documentForm) {
    event.preventDefault();
    const button = documentForm.querySelector('[type="submit"]');
    const requiredKinds = String(documentForm.dataset.requiredKinds || '').split(',').filter(Boolean);
    const files = ['identity', 'selfie', 'supporting'].map(kind => ({ kind, file:documentForm.elements[kind]?.files?.[0] })).filter(item => item.file);
    const isReplacement = documentForm.dataset.documentReplacement === '1';
    if (!requiredKinds.every(kind => files.some(item => item.kind === kind)) || !documentForm.elements.documentConsent?.checked || (!isReplacement && !documentForm.elements.offerConsent?.checked)) return;
    const supporting = files.find(item => item.kind === 'supporting');
    if (supporting && !documentForm.elements.supportingType?.value) return message('Выберите, какой официальный документ вы прикрепляете.', 'error');
    button.disabled = true;
    try {
      if (!isReplacement) await request('POST', { action:'accept_offer', orderId:documentForm.dataset.order });
      for (let index = 0; index < files.length; index += 1) {
        const { kind, file } = files[index];
        const selectedType = kind === 'supporting' ? documentForm.elements.supportingType.value : '';
        const fileName = selectedType ? `${selectedType} — ${file.name}` : file.name;
        button.textContent = `Загружаем ${index + 1}/${files.length}…`;
        if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Допустимы JPG, PNG или PDF размером до 8 МБ.');
        const ticket = await request('POST', { action:'create_document_upload', orderId:documentForm.dataset.order, kind, fileName, contentType:file.type, byteSize:file.size });
        const upload = await fetch(ticket.uploadUrl, { method:'PUT', headers:{ Authorization:`Bearer ${ticket.token}`, 'x-upsert':'false', 'content-type':file.type }, body:file });
        if (!upload.ok) throw new Error('Не удалось загрузить файл. Проверьте соединение и попробуйте снова.');
        await request('POST', { action:'register_document', orderId:documentForm.dataset.order, kind, path:ticket.path, fileName, contentType:file.type, byteSize:file.size });
      }
      message('Документы загружены. Менеджер проверит их и сообщит следующий шаг.', 'success');
      const fresh = await request('GET');
      if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile);
    } catch (error) {
      const output = documentForm.querySelector('.cabinet-form-error') || document.createElement('p');
      output.className = 'cabinet-form-error'; output.textContent = error.message; documentForm.append(output);
      button.disabled = false; button.textContent = 'Загрузить документы';
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
    const result = await request('POST', { action:form.dataset.request, orderId:form.dataset.order, days:data.get('days'), kind:data.get('kind'), message:data.get('message') });
    message(result.message || 'Запрос отправлен.', 'success');
    const fresh = await request('GET');
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile);
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
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone, fresh.profile);
  } catch (error) {
    const output = document.createElement('p'); output.className = 'cabinet-form-error'; output.textContent = error.message; form.append(output); button.disabled = false;
  }
});
bindPhoneMask(phoneInput);
loadSession();
