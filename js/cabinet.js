const login = document.getElementById('cabinet-login');
const dashboard = document.getElementById('cabinet-dashboard');
const phoneForm = document.getElementById('phone-form');
const codeForm = document.getElementById('code-form');
const phoneInput = document.getElementById('cabinet-phone');
const codeInput = document.getElementById('cabinet-code');
const statusEl = document.getElementById('cabinet-status');
const rentalsEl = document.getElementById('cabinet-rentals');
const emptyEl = document.getElementById('cabinet-empty');
let pendingPhone = '';

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
  const response = await fetch('/api/account', { method, credentials: 'same-origin', headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
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

function requestLabel(request) {
  if (request.kind === 'extension') return `Продление: +${request.requested_days} дн. до ${date(request.proposed_return_date)}`;
  return 'Досрочный возврат';
}
function actionPanel(order) {
  const canAct = ['issued', 'in_use'].includes(order.status);
  const openExtension = order.requests?.find(request => request.kind === 'extension' && ['open','in_progress'].includes(request.status));
  const openReturn = order.requests?.find(request => request.kind === 'early_return' && ['open','in_progress'].includes(request.status));
  if (openExtension || openReturn) return `<div class="cabinet-request-state">⌛ ${escape(requestLabel(openExtension || openReturn))}: ${openExtension || openReturn ? 'ожидает решения менеджера' : ''}</div>`;
  if (!canAct) return `<button class="cabinet-action secondary" data-panel="support" data-order="${order.id}">Нужна помощь</button>`;
  return `<div class="cabinet-actions"><button class="cabinet-action" data-panel="extend" data-order="${order.id}">Продлить аренду</button><button class="cabinet-action secondary" data-panel="return" data-order="${order.id}">Вернуть раньше</button><button class="cabinet-action ghost" data-panel="support" data-order="${order.id}">Нужна помощь</button></div>`;
}
function requestForm(order) {
  return `<div class="cabinet-request-panel" id="panel-${order.id}" hidden></div>`;
}
function panelMarkup(kind, orderId) {
  if (kind === 'extend') return `<form class="cabinet-inline-form" data-request="extension_request" data-order="${orderId}"><label>На сколько дней продлить?</label><div class="cabinet-inline-row"><input name="days" type="number" min="1" max="30" value="3" required><button class="cabinet-action" type="submit">Отправить запрос</button></div><p>Менеджер проверит доступность и пришлёт сумму к оплате.</p></form>`;
  if (kind === 'return') return `<form class="cabinet-inline-form" data-request="early_return_request" data-order="${orderId}"><label>Коротко опишите причину (необязательно)</label><textarea name="message" maxlength="500" placeholder="Например: изменились планы, хочу вернуть сегодня"></textarea><div class="cabinet-inline-row"><button class="cabinet-action danger" type="submit">Запросить возврат</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div><p>Не кладите ноутбук в ячейку, пока не появится инструкция и новый PIN/QR.</p></form>`;
  return `<form class="cabinet-inline-form" data-request="support_request" data-order="${orderId}"><label>Чем помочь?</label><select name="kind"><option value="rentop">Вопрос к Rentop</option><option value="archa">Проблема с ARCHA POINT</option></select><textarea name="message" minlength="3" maxlength="1000" placeholder="Опишите ситуацию — менеджер увидит сообщение"></textarea><div class="cabinet-inline-row"><button class="cabinet-action" type="submit">Отправить обращение</button><button class="cabinet-cancel-panel" type="button">Отмена</button></div></form>`;
}

function showRentals(orders, phone) {
  login.hidden = true; dashboard.hidden = false;
  document.getElementById('cabinet-greeting').textContent = `Здравствуйте, ${phone.replace('+996', '+996 ')}!`;
  rentalsEl.innerHTML = orders.map(order => {
    const state = statusInfo(order.status);
    return `<article class="cabinet-rental" data-rental="${order.id}"><div class="cabinet-rental-top"><div><h3>${escape(order.laptop_title || 'Ноутбук Rentop')}</h3><p class="cabinet-rental-ref">Заявка ${escape(order.reference)}</p></div><span class="cabinet-badge">${escape(state.title)}</span></div><div class="cabinet-progress" aria-label="Этап ${state.step} из 5"><span class="is-done"></span><span class="${state.step >= 2 ? 'is-done' : ''}"></span><span class="${state.step >= 3 ? 'is-done' : ''}"></span><span class="${state.step >= 4 ? 'is-done' : ''}"></span><span class="${state.step >= 5 ? 'is-done' : ''}"></span></div><p class="cabinet-next-step">${escape(state.text)}</p><div class="cabinet-rental-grid"><div>Срок<strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div>Получение<strong>${escape(order.delivery_label)}</strong></div><div>Сумма<strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div></div>${actionPanel(order)}${requestForm(order)}</article>`;
  }).join('');
  emptyEl.hidden = orders.length !== 0;
  if (new URLSearchParams(window.location.search).get('return') === 'booking') {
    window.setTimeout(() => window.location.assign('/?resume_booking=1'), 250);
  }
}
async function loadSession() { try { const data = await request('GET'); if (data.authenticated) showRentals(data.orders || [], data.phone); } catch { /* Silent for guests. */ } }

phoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = formatPhone(phoneInput.value); if (!phone) return message('Введите номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = phoneForm.querySelector('button'); button.disabled = true; message('Отправляем код…'); try { await request('POST', { action:'request_code', phone }); pendingPhone = phone; phoneForm.hidden = true; codeForm.hidden = false; codeInput.focus(); message('Код отправлен. Введите 6 цифр из SMS.', 'success'); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
codeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = codeInput.value.replace(/\D/g, ''); if (code.length !== 6) return message('Введите все 6 цифр кода.', 'error'); const button = codeForm.querySelector('button'); button.disabled = true; message('Проверяем код…'); try { const data = await request('POST', { action:'verify_code', phone:pendingPhone, code }); showRentals(data.orders || [], data.phone); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('change-phone')?.addEventListener('click', () => { codeForm.hidden = true; phoneForm.hidden = false; codeInput.value = ''; message(''); phoneInput.focus(); });
document.getElementById('cabinet-logout')?.addEventListener('click', async () => { await request('POST', { action:'logout' }).catch(() => {}); dashboard.hidden = true; login.hidden = false; phoneForm.hidden = false; codeForm.hidden = true; phoneInput.value = ''; codeInput.value = ''; pendingPhone = ''; message('Вы вышли из кабинета.'); });
rentalsEl?.addEventListener('click', event => {
  const button = event.target.closest('[data-panel]');
  if (button) {
    const panel = document.getElementById(`panel-${button.dataset.order}`);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    panel.innerHTML = panel.hidden ? '' : panelMarkup(button.dataset.panel, button.dataset.order);
    return;
  }
  if (event.target.closest('.cabinet-cancel-panel')) {
    const panel = event.target.closest('.cabinet-request-panel');
    panel.hidden = true; panel.innerHTML = '';
  }
});
rentalsEl?.addEventListener('submit', async event => {
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
    if (fresh.authenticated) showRentals(fresh.orders || [], fresh.phone);
  } catch (error) {
    const output = form.querySelector('.cabinet-form-error') || document.createElement('p');
    output.className = 'cabinet-form-error'; output.textContent = error.message; form.append(output);
    button.disabled = false; button.textContent = 'Попробовать снова';
  }
});
bindPhoneMask(phoneInput);
loadSession();
