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

const formatPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^996\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+996${digits.slice(1)}`;
  return '';
};
const message = (text = '', kind = '') => { statusEl.textContent = text; statusEl.className = `cabinet-status${kind ? ` is-${kind}` : ''}`; };
const request = async (method, payload) => {
  const response = await fetch('/api/account', { method, credentials: 'same-origin', headers: payload ? { 'content-type': 'application/json' } : {}, body: payload ? JSON.stringify(payload) : undefined });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Не удалось выполнить запрос.');
  return body;
};
const statusName = (status) => ({ awaiting_payment:'Ожидает оплаты', payment_review:'Проверяем оплату', confirmed:'Подтверждена', awaiting_pickup:'Готовится к выдаче', issued:'Выдана', in_use:'Аренда активна', return_requested:'Оформляется возврат', returned:'Возвращена', completed:'Завершена', cancelled:'Отменена', rejected:'Отклонена' }[status] || 'Заявка обрабатывается');
const date = (value) => value ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`)) : '—';
const escape = (value) => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

function showRentals(orders, phone) {
  login.hidden = true; dashboard.hidden = false;
  document.getElementById('cabinet-greeting').textContent = `Здравствуйте, ${phone.replace('+996', '+996 ')}!`;
  rentalsEl.innerHTML = orders.map(order => `<article class="cabinet-rental"><div class="cabinet-rental-top"><div><h3>${escape(order.laptop_title || 'Ноутбук Rentop')}</h3><p class="cabinet-rental-ref">Заявка ${escape(order.reference)}</p></div><span class="cabinet-badge">${escape(statusName(order.status))}</span></div><div class="cabinet-rental-grid"><div>Срок<strong>${date(order.rental_start_date)} — ${date(order.rental_end_date)}</strong></div><div>Получение<strong>${escape(order.delivery_label)}</strong></div><div>Сумма<strong>${Number(order.total_amount || 0).toLocaleString('ru-RU')} сом</strong></div></div></article>`).join('');
  emptyEl.hidden = orders.length !== 0;
}
async function loadSession() { try { const data = await request('GET'); if (data.authenticated) showRentals(data.orders || [], data.phone); } catch { /* Silent for guests. */ } }

phoneForm?.addEventListener('submit', async event => { event.preventDefault(); const phone = formatPhone(phoneInput.value); if (!phone) return message('Введите номер Кыргызстана: +996XXXXXXXXX.', 'error'); const button = phoneForm.querySelector('button'); button.disabled = true; message('Отправляем код…'); try { await request('POST', { action:'request_code', phone }); pendingPhone = phone; phoneForm.hidden = true; codeForm.hidden = false; codeInput.focus(); message('Код отправлен. Введите 6 цифр из SMS.', 'success'); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
codeForm?.addEventListener('submit', async event => { event.preventDefault(); const code = codeInput.value.replace(/\D/g, ''); if (code.length !== 6) return message('Введите все 6 цифр кода.', 'error'); const button = codeForm.querySelector('button'); button.disabled = true; message('Проверяем код…'); try { const data = await request('POST', { action:'verify_code', phone:pendingPhone, code }); showRentals(data.orders || [], data.phone); } catch (error) { message(error.message, 'error'); } finally { button.disabled = false; } });
document.getElementById('change-phone')?.addEventListener('click', () => { codeForm.hidden = true; phoneForm.hidden = false; codeInput.value = ''; message(''); phoneInput.focus(); });
document.getElementById('cabinet-logout')?.addEventListener('click', async () => { await request('POST', { action:'logout' }).catch(() => {}); dashboard.hidden = true; login.hidden = false; phoneForm.hidden = false; codeForm.hidden = true; phoneInput.value = ''; codeInput.value = ''; pendingPhone = ''; message('Вы вышли из кабинета.'); });
loadSession();
