import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from './config.js';
import { fetchLaptops, fetchBlockingRentals, createRentalOrder } from './supabase.js';
import {
  todayIso,
  addDays,
  daysBetween,
  quoteRental,
  validateRentalPeriod,
  hasDateConflict,
  cardAvailability,
  deliveryLabel,
  rentalErrorText,
  ARCHA_LOCATIONS
} from './availability.js';

let laptops = [];
let filteredLaptops = [];
let blockingRentals = [];
let availabilityLoaded = false;
let currentLaptop = null;
let activeCategoryFilter = 'all';
let activeUseFilter = 'all';
let savedLaptopIds = new Set();
let submitInFlight = false;

// Настройки пагинации
const ITEMS_PER_PAGE = 6;
let currentPage = 1;

// DOM Элементы
const catalogGrid = document.getElementById('catalog-grid');
const categoryFilterButtons = document.querySelectorAll('.filter-btn[data-filter]');
const useFilterButtons = document.querySelectorAll('.use-filter-btn');
const btnLoadMore = document.getElementById('btn-load-more');

const modal = document.getElementById('order-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalLaptopTitle = document.getElementById('modal-laptop-title');
const orderForm = document.getElementById('order-form');
const calcBox = document.getElementById('calc-box');
const daysSlider = document.getElementById('days-slider');
const daysCount = document.getElementById('days-count');
const totalPriceEl = document.getElementById('total-price');
const calcDiscountEl = document.getElementById('calc-discount');
const rentalStartInput = document.getElementById('rental-start-date');
const rentalEndInput = document.getElementById('rental-end-date');
const deliveryTypeInput = document.getElementById('delivery-type');
const archaLockerNote = document.getElementById('archa-locker-note');
const archaLocationField = document.getElementById('archa-location-field');
const archaLocationInput = document.getElementById('archa-location');
const rentalAvailabilityMessage = document.getElementById('rental-availability-message');
const submitBtn = document.getElementById('submitBtn');
const archaOrderBtn = document.getElementById('open-archa-order');

// Burger
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');

// Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCaption = document.getElementById('lightbox-caption');
const lightboxClose = document.getElementById('lightbox-close');

// Интерактивные модальные окна (Условия + Программа лояльности)
const condDocsBtn = document.getElementById('btn-cond-docs');
const condReadyBtn = document.getElementById('btn-cond-ready');
const condDeliveryBtn = document.getElementById('btn-cond-delivery');
const loyaltyBtn = document.getElementById('btn-open-loyalty');

const modalDocs = document.getElementById('modal-docs');
const modalReady = document.getElementById('modal-ready');
const modalDelivery = document.getElementById('modal-delivery');
const modalLoyalty = document.getElementById('modal-loyalty');

function getLaptopUse(laptop) {
  if (laptop.use_case === 'gaming' || laptop.use_case === 'work') return laptop.use_case;

  const gamingKeywords = /rog|razer|legion|tuf|gaming|игр|cyberpunk|gta|blender|3d|vfx|katana|gf\d|g15/i;
  return gamingKeywords.test(`${laptop.title || ''} ${laptop.badge || ''}`) ? 'gaming' : 'work';
}

function loadSavedLaptops() {
  try {
    const saved = JSON.parse(localStorage.getItem('rentop-saved-laptops') || '[]');
    savedLaptopIds = new Set(saved.map(String));
  } catch {
    savedLaptopIds = new Set();
  }
}

function saveSavedLaptops() {
  localStorage.setItem('rentop-saved-laptops', JSON.stringify([...savedLaptopIds]));
}

// ========== RENDER CATALOG ==========
function renderLaptops(items, append = false) {
  if (!catalogGrid) return;

  if (!append) {
    catalogGrid.innerHTML = '';
  }

  if (items.length === 0 && !append) {
    catalogGrid.innerHTML = `
      <p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px 0;">
        Ничего не найдено
      </p>`;
    if (btnLoadMore) btnLoadMore.style.display = 'none';
    return;
  }

  items.forEach(laptop => {
    const isRent = laptop.category === 'rent';
    const badge = laptop.badge || (isRent ? 'Аренда' : 'Продажа');
    const availability = cardAvailability(blockingRentals, laptop.id, todayIso());
    const isSaved = savedLaptopIds.has(String(laptop.id));
    const statusClass = availability.state === 'busy'
      ? 'is-busy'
      : availability.state === 'soon'
        ? 'is-soon'
        : '';

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-topline">
        <span class="availability-status ${statusClass}">
          ${availability.label}
        </span>
        <button class="save-laptop ${isSaved ? 'is-saved' : ''}" data-id="${laptop.id}" type="button" aria-label="${isSaved ? 'Убрать из избранного' : 'Сохранить ноутбук'}" aria-pressed="${isSaved}">
          ${isSaved ? '♥' : '♡'}
        </button>
      </div>
      <img 
        src="${laptop.image}" 
        alt="${laptop.title}" 
        class="card-img"
        loading="lazy"
        data-title="${laptop.title}"
      >
      <div>
        <span class="card-tag">${badge}</span>
        <h3>${laptop.title}</h3>
        <ul class="specs-list">
          <li>💻 ${laptop.cpu || '—'}</li>
          <li>⚡ ${laptop.ram || '—'}</li>
          <li>💾 ${laptop.storage || '—'}</li>
        </ul>
      </div>
      <div>
        <div class="price-block">
          <div class="price-main">${laptop.priceText || '—'}</div>
          <div class="price-sub">${isRent ? 'при аренде от 3-х дней' : 'в наличии / под заказ'}</div>
        </div>
        <button class="btn-card" data-id="${laptop.id}">
          ${isRent ? 'Забронировать' : 'Купить / Предзаказ'}
        </button>
      </div>
    `;

    catalogGrid.appendChild(card);
  });

  // Навешивание событий на новые кнопки бронирования
  document.querySelectorAll('.btn-card').forEach(btn => {
    btn.onclick = (e) => {
      const id = Number(e.currentTarget.dataset.id);
      openOrderModal(id);
    };
  });

  document.querySelectorAll('.save-laptop').forEach(btn => {
    btn.onclick = (e) => {
      const id = String(e.currentTarget.dataset.id);
      if (savedLaptopIds.has(id)) {
        savedLaptopIds.delete(id);
      } else {
        savedLaptopIds.add(id);
      }
      saveSavedLaptops();
      updateCatalogView(false);
    };
  });

  // Клик по картинке → лайтбокс
  document.querySelectorAll('.card-img').forEach(img => {
    img.onclick = () => {
      lightboxImg.src = img.src;
      lightboxCaption.textContent = img.dataset.title || '';
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    };
  });
}

// ========== PAGINATION & RENDER CONTROLLER ==========
function updateCatalogView(resetPagination = true) {
  if (resetPagination) {
    currentPage = 1;
  }

  const startIndex = 0;
  const endIndex = currentPage * ITEMS_PER_PAGE;
  const visibleItems = filteredLaptops.slice(startIndex, endIndex);

  renderLaptops(visibleItems, false);

  if (btnLoadMore) {
    if (endIndex < filteredLaptops.length) {
      btnLoadMore.style.display = 'inline-block';
    } else {
      btnLoadMore.style.display = 'none';
    }
  }
}

function loadMoreLaptops() {
  const startIndex = currentPage * ITEMS_PER_PAGE;
  currentPage++;
  const endIndex = currentPage * ITEMS_PER_PAGE;
  const nextChunk = filteredLaptops.slice(startIndex, endIndex);

  renderLaptops(nextChunk, true);

  if (endIndex >= filteredLaptops.length && btnLoadMore) {
    btnLoadMore.style.display = 'none';
  }
}

// ========== FILTER ==========
function filterAndSearch() {
  filteredLaptops = laptops.filter(laptop => {
    const categoryMatches = activeCategoryFilter === 'all' || laptop.category === activeCategoryFilter;
    const useMatches = activeUseFilter === 'all' || getLaptopUse(laptop) === activeUseFilter;
    return categoryMatches && useMatches;
  });

  updateCatalogView(true);
}

function getDailyRate(laptop) {
  const rate = Number(laptop?.dailyRate ?? laptop?.daily_rate ?? 0);
  return Number.isFinite(rate) ? rate : 0;
}

function createOrderId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

function resetOrderSubmit() {
  submitInFlight = false;
  if (deliveryTypeInput) deliveryTypeInput.value = 'delivery';
  if (archaLocationInput) archaLocationInput.value = '';
  updateDeliveryNote();
  if (!submitBtn) return;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Отправить заявку в WhatsApp';
}

function updateDeliveryNote() {
  const isLocker = deliveryTypeInput?.value === 'arca_locker';
  if (archaLockerNote) archaLockerNote.hidden = !isLocker;
  if (archaLocationField) archaLocationField.hidden = !isLocker;
}

function selectedArchaLocation() {
  const location = archaLocationInput?.value || '';
  return ARCHA_LOCATIONS.includes(location) ? location : '';
}

function showRentalMessage(text, tone = 'neutral') {
  if (!rentalAvailabilityMessage) return;
  rentalAvailabilityMessage.textContent = text || '';
  rentalAvailabilityMessage.classList.toggle('is-error', tone === 'error');
  rentalAvailabilityMessage.classList.toggle('is-ok', tone === 'ok');
}

function clampRentalDates() {
  const today = todayIso();
  if (rentalStartInput) rentalStartInput.min = today;
  if (rentalStartInput?.value && rentalStartInput.value < today) {
    rentalStartInput.value = today;
  }

  const earliestEnd = rentalStartInput?.value && rentalStartInput.value > today
    ? rentalStartInput.value
    : today;
  if (rentalEndInput) rentalEndInput.min = earliestEnd;
  if (rentalEndInput?.value && rentalEndInput.value < today) {
    rentalEndInput.value = today;
  }
}

function currentRentalDraft(today = todayIso()) {
  const startDate = rentalStartInput?.value || '';
  const endDate = rentalEndInput?.value || '';
  const validationError = validateRentalPeriod(startDate, endDate, today);
  const days = validationError ? 0 : daysBetween(startDate, endDate);
  const quote = quoteRental(days, getDailyRate(currentLaptop));
  let availabilityError = '';

  if (!validationError && currentLaptop && availabilityLoaded) {
    if (hasDateConflict(blockingRentals, currentLaptop.id, startDate, endDate)) {
      availabilityError = 'Этот ноутбук уже занят на выбранные даты. Выберите другой период.';
    }
  }

  return { startDate, endDate, today, validationError, availabilityError, quote };
}

// ========== MODAL + CALCULATOR ==========
function openOrderModal(id) {
  currentLaptop = laptops.find(item => item.id === id);
  if (!currentLaptop) return;

  modalLaptopTitle.textContent = `${currentLaptop.category === 'rent' ? 'Аренда:' : 'Покупка:'} ${currentLaptop.title}`;

  if (currentLaptop.category === 'rent') {
    calcBox.style.display = 'block';
    const today = todayIso();
    if (rentalStartInput) rentalStartInput.value = today;
    if (rentalEndInput) rentalEndInput.value = addDays(today, 2);
    if (daysSlider) {
      daysSlider.min = '1';
      daysSlider.max = '30';
      daysSlider.value = '2';
    }
    updateDeliveryNote();
    updateCalculator();
  } else {
    calcBox.style.display = 'none';
    showRentalMessage('');
    if (submitBtn && !submitInFlight) submitBtn.disabled = false;
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function openArchaOrder() {
  const availableRental = laptops.find((laptop) => (
    laptop.category === 'rent' && cardAvailability(blockingRentals, laptop.id, todayIso()).state !== 'busy'
  )) || laptops.find((laptop) => laptop.category === 'rent');

  if (!availableRental) {
    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  openOrderModal(availableRental.id);
  if (deliveryTypeInput) deliveryTypeInput.value = 'arca_locker';
  updateDeliveryNote();
  updateCalculator();
}

archaOrderBtn?.addEventListener('click', openArchaOrder);

function updateCalculator(forcedMessage) {
  if (!currentLaptop || currentLaptop.category !== 'rent') return;

  clampRentalDates();
  const draft = currentRentalDraft();

  if (daysCount) daysCount.textContent = String(draft.quote.days);
  if (totalPriceEl) totalPriceEl.textContent = draft.quote.total.toLocaleString('ru-RU');
  if (daysSlider && draft.quote.days >= 1) {
    daysSlider.max = String(Math.max(30, draft.quote.days));
    daysSlider.value = String(draft.quote.days);
  }
  if (calcDiscountEl) {
    if (!draft.quote.days) calcDiscountEl.textContent = 'Укажите корректные даты';
    else if (draft.quote.discountPercent === 15) calcDiscountEl.textContent = 'Ваша скидка: 15%';
    else if (draft.quote.discountPercent === 30) calcDiscountEl.textContent = 'Ваша скидка: 30%';
    else calcDiscountEl.textContent = 'Без скидки';
  }

  if (forcedMessage) {
    showRentalMessage(forcedMessage.text, forcedMessage.isError ? 'error' : 'ok');
  } else if (draft.validationError || draft.availabilityError) {
    showRentalMessage(draft.validationError || draft.availabilityError, 'error');
  } else if (availabilityLoaded) {
    showRentalMessage('На выбранные даты ноутбук свободен.', 'ok');
  } else {
    showRentalMessage('Занятость подтвердится при сохранении заявки.', 'neutral');
  }

  if (submitBtn && !submitInFlight) {
    submitBtn.disabled = Boolean(draft.validationError || draft.availabilityError);
  }
}

function syncEndDateFromSlider() {
  const today = todayIso();
  const startDate = rentalStartInput?.value && rentalStartInput.value >= today
    ? rentalStartInput.value
    : today;
  if (rentalStartInput) rentalStartInput.value = startDate;
  const days = Math.max(1, parseInt(daysSlider?.value, 10) || 1);
  if (rentalEndInput) rentalEndInput.value = addDays(startDate, days);
  updateCalculator();
}

// Управление информационными модальными окнами
function openInfoModal(m) {
  if (m) {
    m.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeInfoModal(m) {
  if (m) {
    m.classList.remove('active');
    document.body.style.overflow = '';
    if (m.id === 'order-modal') resetOrderSubmit();
  }
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  loadSavedLaptops();
  // Загрузка ноутбуков из Supabase
  laptops = await fetchLaptops();
  const availability = await fetchBlockingRentals();
  blockingRentals = availability.rows;
  availabilityLoaded = availability.ok;
  filteredLaptops = [...laptops];
  updateCatalogView(true);

  // Кнопка "Показать ещё"
  btnLoadMore?.addEventListener('click', loadMoreLaptops);

  // Фильтры
  categoryFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      categoryFilterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategoryFilter = btn.dataset.filter || 'all';
      filterAndSearch();
    });
  });

  useFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      useFilterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeUseFilter = btn.dataset.use || 'all';
      filterAndSearch();
    });
  });

  // Калькулятор и даты аренды
  daysSlider?.addEventListener('input', syncEndDateFromSlider);
  rentalStartInput?.addEventListener('input', () => updateCalculator());
  rentalStartInput?.addEventListener('change', () => updateCalculator());
  rentalEndInput?.addEventListener('input', () => updateCalculator());
  rentalEndInput?.addEventListener('change', () => updateCalculator());
  deliveryTypeInput?.addEventListener('change', updateDeliveryNote);
  updateDeliveryNote();

  // Закрытие модалки заказа
  closeModalBtn?.addEventListener('click', closeModal);

  function closeModal() {
    modal?.classList.remove('active');
    document.body.style.overflow = '';
    resetOrderSubmit();
  }

  // FAQ Accordion
  document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
      const item = question.parentElement;
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // Burger menu
  burger?.addEventListener('click', () => {
    burger.classList.toggle('active');
    nav.classList.toggle('active');
  });

  // Закрытие меню при клике на ссылку
  nav?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('active');
      nav.classList.remove('active');
    });
  });

  // Lightbox
  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  // Интерактивные модальные окна (Условия + Программа лояльности)
  condDocsBtn?.addEventListener('click', () => openInfoModal(modalDocs));
  condReadyBtn?.addEventListener('click', () => openInfoModal(modalReady));
  condDeliveryBtn?.addEventListener('click', () => openInfoModal(modalDelivery));
  loyaltyBtn?.addEventListener('click', () => openInfoModal(modalLoyalty));

  // Закрытие всех модальных окон при клике на оверлей или кнопки закрытия
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (
        e.target === overlay || 
        e.target.classList.contains('modal-close') || 
        e.target.classList.contains('close-info-modal') || 
        e.target.classList.contains('close-info-btn')
      ) {
        closeInfoModal(overlay);
      }
    });
  });

  // Отправка заявки: для аренды сначала запись в Supabase, затем уведомление
  orderForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLaptop || submitInFlight) return;

    const name = document.getElementById('user-name')?.value.trim() || '';
    const phone = document.getElementById('user-phone')?.value.trim() || '';
    const promo = document.getElementById('user-promo')?.value.trim() || '';
    const isRent = currentLaptop.category === 'rent';
    const clean = (str) => str.replace(/[_*`\[\]()]/g, '');
    let rental = null;

    if (isRent) {
      clampRentalDates();
      const draft = currentRentalDraft();
      if (draft.validationError || draft.availabilityError) {
        updateCalculator();
        return;
      }
      if (name.length < 2 || phone.replace(/\D/g, '').length < 12) {
        showRentalMessage('Укажите имя и полный номер телефона, чтобы сохранить заявку.', 'error');
        return;
      }

      const selectedDelivery = deliveryTypeInput?.value;
      const deliveryType = ['pickup', 'arca_locker'].includes(selectedDelivery) ? selectedDelivery : 'delivery';
      const archaLocation = deliveryType === 'arca_locker' ? selectedArchaLocation() : '';
      if (deliveryType === 'arca_locker' && !archaLocation) {
        showRentalMessage('Выберите локацию ARCHA POINT.', 'error');
        return;
      }
      submitInFlight = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Сохраняем заявку...';
      }

      const freshAvailability = await fetchBlockingRentals();
      if (freshAvailability.ok) {
        blockingRentals = freshAvailability.rows;
        availabilityLoaded = true;
        if (hasDateConflict(blockingRentals, currentLaptop.id, draft.startDate, draft.endDate)) {
          updateCatalogView(false);
          submitInFlight = false;
          if (submitBtn) submitBtn.textContent = 'Отправить заявку в WhatsApp';
          updateCalculator();
          return;
        }
      }

      const holdExpiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      const { order, error } = await createRentalOrder({
        id: createOrderId(),
        laptop_id: currentLaptop.id,
        customer_name: name,
        customer_phone: phone,
        rental_start_date: draft.startDate,
        rental_end_date: draft.endDate,
        rental_days: draft.quote.days,
        daily_rate: draft.quote.dailyRate,
        discount_percent: draft.quote.discountPercent,
        total_amount: draft.quote.total,
        status: 'awaiting_payment',
        delivery_type: deliveryType,
        ...(archaLocation ? { locker_address: archaLocation } : {}),
        hold_expires_at: holdExpiresAt
      });

      if (error || !order?.id) {
        submitInFlight = false;
        if (submitBtn) submitBtn.textContent = 'Отправить заявку в WhatsApp';
        updateCalculator({ text: rentalErrorText(error), isError: true });
        return;
      }

      rental = {
        id: order.id,
        startDate: draft.startDate,
        endDate: draft.endDate,
        days: draft.quote.days,
        total: draft.quote.total,
        discountPercent: draft.quote.discountPercent,
        deliveryType,
        archaLocation
      };
      blockingRentals.push({
        laptop_id: currentLaptop.id,
        rental_start_date: draft.startDate,
        rental_end_date: draft.endDate,
        status: 'awaiting_payment',
        hold_expires_at: holdExpiresAt
      });
      updateCatalogView(false);
    }

    const totalText = rental
      ? rental.total.toLocaleString('ru-RU')
      : (totalPriceEl ? totalPriceEl.textContent : '0');

    let tgText = `🚀 *Новая заявка с сайта BAN Digital / RENTOP*\n\n`;
    tgText += `💻 *Устройство:* ${clean(currentLaptop.title || 'Ноутбук')}\n`;
    tgText += `👤 *Имя:* ${clean(name)}\n`;
    tgText += `📞 *Телефон:* ${clean(phone)}\n`;

    if (promo) {
      tgText += `🎁 *Промокод:* ${clean(promo)}\n`;
    }

    if (isRent && rental) {
      tgText += `🧾 *Номер заказа:* ${rental.id}\n`;
      tgText += `📅 *Даты аренды:* ${rental.startDate} — ${rental.endDate}\n`;
      tgText += `⏱ *Срок:* ${rental.days} дн.\n`;
      tgText += `💸 *Скидка:* ${rental.discountPercent}%\n`;
      tgText += `💰 *Сумма:* ${totalText} сом\n`;
      tgText += `🚚 *Способ получения:* ${clean(deliveryLabel(rental.deliveryType))}\n`;
      if (rental.archaLocation) tgText += `📍 *Локация ARCHA POINT:* ${clean(rental.archaLocation)}\n`;
      tgText += `⏳ Резерв на 20 минут, оплата на сайте не списывается\n`;
    } else {
      tgText += `🏷 *Тип:* Покупка / Предзаказ\n`;
    }

    try {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: tgText,
          parse_mode: 'Markdown'
        })
      });
    } catch (err) {
      console.error('Ошибка отправки в Telegram:', err);
    }

    let waMsg = `Здравствуйте! Я оставил(а) заявку на сайте:\n`;
    waMsg += `💻 Ноутбук: ${currentLaptop.title || 'Ноутбук'}\n`;
    waMsg += `👤 Имя: ${name}\n`;
    waMsg += `📞 Телефон: ${phone}\n`;
    if (promo) waMsg += `🎁 Промокод: ${promo}\n`;
    if (isRent && rental) {
      waMsg += `🧾 Номер заказа: ${rental.id}\n`;
      waMsg += `📅 Даты аренды: ${rental.startDate} — ${rental.endDate}\n`;
      waMsg += `⏱ Срок аренды: ${rental.days} дн.\n`;
      waMsg += `💸 Скидка: ${rental.discountPercent}%\n`;
      waMsg += `💰 Итоговая сумма: ${totalText} сом\n`;
      waMsg += `🚚 Способ получения: ${deliveryLabel(rental.deliveryType)}\n`;
      if (rental.archaLocation) waMsg += `📍 Локация ARCHA POINT: ${rental.archaLocation}\n`;
      waMsg += `Ноутбук зарезервирован на 20 минут. Оплата на сайте не списывается.`;
    }

    const waUrl = `https://wa.me/996707880857?text=${encodeURIComponent(waMsg)}`;

    orderForm.reset();
    closeModal();
    window.open(waUrl, '_blank');
  });

  // Маска телефона
  const phoneInput = document.getElementById('user-phone');
  if (phoneInput) {
    phoneInput.addEventListener('focus', () => {
      if (!phoneInput.value) phoneInput.value = '+996 ';
    });

    phoneInput.addEventListener('input', (e) => {
      let matrix = '+996 (___) __-__-__';
      let i = 0;
      let def = matrix.replace(/\D/g, '');
      let val = e.target.value.replace(/\D/g, '');

      if (def.length >= val.length) val = def;

      e.target.value = matrix.replace(/./g, function (a) {
        return /[_\d]/.test(a) && i < val.length ? val.charAt(i++) : i >= val.length ? '' : a;
      });
    });
  }
});

// Логика юридических модальных окон
// Логика открытия модальных окон (Оферта и Политика)
document.addEventListener('DOMContentLoaded', () => {
  const offerBtn = document.getElementById('open-offer');
  const privacyBtn = document.getElementById('open-privacy');
  const modalOffer = document.getElementById('modal-offer');
  const modalPrivacy = document.getElementById('modal-privacy');
  const closeBtns = document.querySelectorAll('.close-legal');

  if (offerBtn) {
    offerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modalOffer.style.display = 'flex';
    });
  }

  if (privacyBtn) {
    privacyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      modalPrivacy.style.display = 'flex';
    });
  }

  closeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modalOffer.style.display = 'none';
      modalPrivacy.style.display = 'none';
    });
  });

  // Закрытие по клику вне модалки
  window.addEventListener('click', (e) => {
    if (e.target === modalOffer) modalOffer.style.display = 'none';
    if (e.target === modalPrivacy) modalPrivacy.style.display = 'none';
  });
});
