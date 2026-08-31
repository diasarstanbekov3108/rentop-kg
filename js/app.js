import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from './config.js';
import { fetchLaptops } from './supabase.js';

let laptops = [];
let filteredLaptops = [];
let currentLaptop = null;

// Настройки пагинации
const ITEMS_PER_PAGE = 6;
let currentPage = 1;

// DOM Элементы
const catalogGrid = document.getElementById('catalog-grid');
const filterButtons = document.querySelectorAll('.filter-btn');
const btnLoadMore = document.getElementById('btn-load-more');

const modal = document.getElementById('order-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalLaptopTitle = document.getElementById('modal-laptop-title');
const orderForm = document.getElementById('order-form');
const calcBox = document.getElementById('calc-box');
const daysSlider = document.getElementById('days-slider');
const daysCount = document.getElementById('days-count');
const totalPriceEl = document.getElementById('total-price');

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

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
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
  const activeBtn = document.querySelector('.filter-btn.active');
  const activeFilter = activeBtn ? activeBtn.dataset.filter : 'all';

  filteredLaptops = laptops.filter(laptop => {
    return activeFilter === 'all' || laptop.category === activeFilter;
  });

  updateCatalogView(true);
}

// ========== MODAL + CALCULATOR ==========
function openOrderModal(id) {
  currentLaptop = laptops.find(item => item.id === id);
  if (!currentLaptop) return;

  modalLaptopTitle.textContent = `${currentLaptop.category === 'rent' ? 'Аренда:' : 'Покупка:'} ${currentLaptop.title}`;

  if (currentLaptop.category === 'rent') {
    calcBox.style.display = 'block';
    daysSlider.value = 2;
    updateCalculator();
  } else {
    calcBox.style.display = 'none';
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function updateCalculator() {
  if (!currentLaptop || !daysSlider) return;

  const days = parseInt(daysSlider.value);
  daysCount.textContent = days;

  let discount = 1;
  if (days >= 4 && days <= 14) discount = 0.85;
  else if (days > 14) discount = 0.70;

  const total = Math.round(days * (currentLaptop.dailyRate || 0) * discount);
  totalPriceEl.textContent = total.toLocaleString('ru-RU');
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
  }
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  // Загрузка ноутбуков из Supabase
  laptops = await fetchLaptops();
  filteredLaptops = [...laptops];
  updateCatalogView(true);

  // Кнопка "Показать ещё"
  btnLoadMore?.addEventListener('click', loadMoreLaptops);

  // Фильтры
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterAndSearch();
    });
  });

  // Калькулятор
  if (daysSlider) {
    daysSlider.addEventListener('input', updateCalculator);
  }

  // Закрытие модалки заказа
  closeModalBtn?.addEventListener('click', closeModal);

  function closeModal() {
    modal?.classList.remove('active');
    document.body.style.overflow = '';
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

  // Отправка заявки (Telegram Bot + перенаправление в WhatsApp)
  orderForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('user-name')?.value.trim() || '';
    const phone = document.getElementById('user-phone')?.value.trim() || '';
    const promo = document.getElementById('user-promo')?.value.trim() || '';
    const days = daysSlider ? daysSlider.value : 2;
    const total = totalPriceEl ? totalPriceEl.textContent : '0';

    const clean = (str) => str.replace(/[_*`\[\]()]/g, '');

    // 1. Формируем сообщение для Telegram
    let tgText = `🚀 *Новая заявка с сайта BAN Digital / RENTOP*\n\n`;
    tgText += `💻 *Устройство:* ${clean(currentLaptop?.title || 'Ноутбук')}\n`;
    tgText += `👤 *Имя:* ${clean(name)}\n`;
    tgText += `📞 *Телефон:* ${clean(phone)}\n`;

    if (promo) {
      tgText += `🎁 *Промокод:* ${clean(promo)}\n`;
    }

    if (currentLaptop?.category === 'rent') {
      tgText += `⏱ *Срок:* ${days} дн.\n`;
      tgText += `💰 *Сумма:* ${total} сом\n`;
    } else {
      tgText += `🏷 *Тип:* Покупка / Предзаказ\n`;
    }

    // 2. Отправляем в Telegram
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

    // 3. Формируем текст и открываем WhatsApp у клиента
    let waMsg = `Здравствуйте! Я оставил(а) заявку на сайте:\n`;
    waMsg += `💻 Ноутбук: ${currentLaptop?.title || 'Ноутбук'}\n`;
    waMsg += `👤 Имя: ${name}\n`;
    waMsg += `📞 Телефон: ${phone}\n`;
    if (promo) waMsg += `🎁 Промокод: ${promo}\n`;
    if (currentLaptop?.category === 'rent') {
      waMsg += `⏱ Срок аренды: ${days} дн.\n`;
      waMsg += `💰 Итоговая сумма: ${total} сом`;
    }

    const waUrl = `https://wa.me/996707880857?text=${encodeURIComponent(waMsg)}`;
    
    orderForm.reset();
    closeInfoModal(modal);

    // Открываем чат WhatsApp
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