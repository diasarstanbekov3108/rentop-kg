import { RENTOP_BACKEND_URL } from './config.js';
import { fetchLaptops, fetchBlockingRentals } from './supabase.js';
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
} from './availability.js?v=20261124-booking-recovery-v1';

let laptops = [];
let filteredLaptops = [];
let blockingRentals = [];
let availabilityLoaded = false;
let currentLaptop = null;
// Главная витрина Rentop — аренда. Продажа остаётся отдельной понятной
// вкладкой, чтобы клиент случайно не смешивал два разных сценария.
let activeCategoryFilter = 'rent';
let activeUseFilter = 'all';
let savedLaptopIds = new Set();
let comparisonLaptopIds = new Set();
let bookingLaptopIds = new Set();
let savedOnly = false;
let submitInFlight = false;
let catalogReady = false;
let catalogRenderVersion = 0;
let pendingFilterFrame = null;
let catalogOpening = false;
let archaSelectionMode = false;
let cabinetSession = null;
const CABINET_BOOKING_KEY = 'rentop-pending-booking-v1';
const PREPAYMENT_REPLACEMENT_CATALOG_KEY = 'rentop-prepayment-replacement-v1';
let prepaymentReplacementContext = null;

// A new customer leaves the storefront briefly to confirm their phone. Keep
// the selected model in both session and local storage: some mobile browsers
// can discard one of them while handling an SMS or switching back to Safari.
function persistPendingBooking(booking) {
  const value = JSON.stringify(booking);
  [window.sessionStorage, window.localStorage].forEach((storage) => {
    try { storage.setItem(CABINET_BOOKING_KEY, value); } catch { /* Storage can be unavailable in private mode. */ }
  });
}
function readPendingBooking() {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(CABINET_BOOKING_KEY) || 'null');
      if (saved?.laptopId) return saved;
    } catch { /* Try the other storage before treating the draft as absent. */ }
  }
  return null;
}
function clearPendingBooking() {
  [window.sessionStorage, window.localStorage].forEach((storage) => {
    try { storage.removeItem(CABINET_BOOKING_KEY); } catch { /* no-op */ }
  });
}

function readPrepaymentReplacementContext() {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(PREPAYMENT_REPLACEMENT_CATALOG_KEY) || 'null');
      if (saved?.orderId) return saved;
    } catch { /* Try the other storage before giving up. */ }
  }
  return null;
}
function clearPrepaymentReplacementContext() {
  [window.sessionStorage, window.localStorage].forEach((storage) => {
    try { storage.removeItem(PREPAYMENT_REPLACEMENT_CATALOG_KEY); } catch { /* no-op */ }
  });
  prepaymentReplacementContext = null;
}
const isPrepaymentReplacementMode = () => Boolean(prepaymentReplacementContext?.orderId);

// Каталог показывает небольшой набор за раз: это избавляет мобильный экран
// от бесконечной ленты, но сохраняет доступ ко всем моделям.
// On phones the storefront is a swipeable three-model carousel: the central
// card is prominent while the next choices remain visible at the edges.
const MOBILE_ITEMS_PER_PAGE = 3;
let currentPage = 1;

// DOM Элементы
const catalogGrid = document.getElementById('catalog-grid');
const catalogPreviewGrid = document.getElementById('catalog-preview-grid');
const catalogBrowser = document.getElementById('catalog-browser');
const openFullCatalog = document.getElementById('open-full-catalog');
const closeFullCatalog = document.getElementById('close-full-catalog');
const closeFullCatalogBottom = document.getElementById('close-full-catalog-bottom');
const categoryFilterButtons = document.querySelectorAll('.filter-btn[data-filter]');
const useFilterButtons = document.querySelectorAll('.use-filter-btn');
const catalogPagePrev = document.getElementById('catalog-page-prev');
const catalogPageNext = document.getElementById('catalog-page-next');
const catalogPageStatus = document.getElementById('catalog-page-status');
const catalogShowcasePrev = document.getElementById('catalog-showcase-prev');
const catalogShowcaseNext = document.getElementById('catalog-showcase-next');
const comparisonPanel = document.getElementById('catalog-compare');
const comparisonContent = document.getElementById('catalog-compare-content');
const comparisonClear = document.getElementById('catalog-compare-clear');
const savedOnlyButton = document.getElementById('catalog-saved-only');
const savedCount = document.getElementById('catalog-saved-count');
const comparisonStatus = document.getElementById('catalog-compare-status');
const comparisonCount = document.getElementById('catalog-compare-count');
const comparisonDock = document.getElementById('catalog-compare-dock');
const catalogResultsCount = document.getElementById('catalog-results-count');

const modal = document.getElementById('order-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalLaptopTitle = document.getElementById('modal-laptop-title');
const modalOrderItems = document.getElementById('modal-order-items');
const orderForm = document.getElementById('order-form');
const calcBox = document.getElementById('calc-box');
const daysSlider = document.getElementById('days-slider');
const daysCount = document.getElementById('days-count');
const manualDurationInput = document.getElementById('days-manual');
const applyManualDurationButton = document.getElementById('apply-manual-duration');
const totalPriceEl = document.getElementById('total-price');
const calcDiscountEl = document.getElementById('calc-discount');
const calcBreakdownEl = document.getElementById('calc-breakdown');
const userPromoInput = document.getElementById('user-promo');
const rentalStartInput = document.getElementById('rental-start-date');
const rentalEndInput = document.getElementById('rental-end-date');
const deliveryTypeInput = document.getElementById('delivery-type');
const deliveryChoiceButtons = [...document.querySelectorAll('[data-delivery-option]')];
const rentalDurationButtons = [...document.querySelectorAll('[data-rental-duration]')];
const rentalAvailabilityMessage = document.getElementById('rental-availability-message');
const bookingAlternatives = document.getElementById('booking-alternatives');
const bookingAlternativesList = document.getElementById('booking-alternatives-list');
const submitBtn = document.getElementById('submitBtn');
const cabinetOrderPhone = document.getElementById('cabinet-order-phone');
const orderNameGroup = document.getElementById('order-name-group');
const orderPhoneGroup = document.getElementById('order-phone-group');
const orderPhoneLabel = document.getElementById('order-phone-label');
const archaOrderBtn = document.getElementById('open-archa-order');
const archaSelectionNotice = document.getElementById('archa-selection-notice');
const closeArchaSelectionBtn = document.getElementById('close-archa-selection');
const rentopMascot = document.getElementById('rentop-mascot');
const rentopMascotButton = document.querySelector('.rentop-mascot-button');
const rentopMascotPanel = document.getElementById('rentop-mascot-panel');
const rentopMascotClose = document.querySelector('.rentop-mascot-close');
const rentopMascotHide = document.getElementById('rentop-mascot-hide');
const rentopMascotRestore = document.getElementById('rentop-mascot-restore');

// Burger
const burger = document.getElementById('burger');
const nav = document.getElementById('nav');
const navAccountGuest = document.getElementById('nav-account-guest');
const navAccountAuth = document.getElementById('nav-account-auth');
const navAccountGreeting = document.getElementById('nav-account-greeting');
const navAccountLogout = document.getElementById('nav-account-logout');

// The mobile menu must work immediately.  It must not wait for the catalog,
// availability, or account-session requests below: on a slow mobile network
// that used to make the first several taps appear to do nothing.
function initMobileNavigation() {
  if (!burger || !nav || burger.dataset.navigationReady === '1') return;
  burger.dataset.navigationReady = '1';
  const header = document.querySelector('.header');
  const setOpen = (open) => {
    burger.classList.toggle('active', open);
    nav.classList.toggle('active', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (open && header) nav.style.setProperty('--mobile-menu-top', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
  };
  burger.addEventListener('click', (event) => {
    event.preventDefault();
    setOpen(!nav.classList.contains('active'));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setOpen(false)));
  window.addEventListener('resize', () => {
    if (nav.classList.contains('active') && header) nav.style.setProperty('--mobile-menu-top', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
  }, { passive:true });
}
initMobileNavigation();

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

function getLaptopTasks(laptop) {
  const details = `${laptop.title || ''} ${laptop.badge || ''} ${laptop.cpu || ''} ${laptop.ram || ''} ${laptop.storage || ''} ${laptop.description || ''} ${laptop.use_cases || ''}`.toLowerCase();
  const gaming = /rog|razer|legion|tuf|gaming|игр|cyberpunk|gta|blender|3d|vfx|katana|gf\d|g15|rtx|gtx/.test(details);
  const exam = /toefl|ielts|duolingo|csca|экзамен|тест/.test(details);
  const lightweight = /i3|8\s*gb|8gb|celeron|pentium/.test(details);
  const apple = /macbook|apple m/.test(details);
  const tasks = gaming ? ['gaming', 'creative', 'code'] : lightweight ? ['study', 'office'] : apple ? ['study', 'office', 'creative', 'code'] : ['study', 'office', 'code'];
  if (exam) tasks.push('exam');
  if (laptop.category === 'rent' && Number(laptop.daily_rate ?? laptop.dailyRate ?? 0) <= 650) tasks.push('budget');
  return tasks;
}

function getLaptopUse(laptop) {
  return getLaptopTasks(laptop).includes('gaming') ? 'gaming' : 'work';
}

function matchesTask(laptop, task) {
  return task === 'all' || getLaptopTasks(laptop).includes(task);
}

function getCatalogProfile(laptop) {
  const details = `${laptop.title || ''} ${laptop.cpu || ''} ${laptop.ram || ''}`.toLowerCase();

  if (/rog|razer|legion|tuf|gaming|msi|gf\d|g15/.test(details)) {
    return { label: 'Игры и графика', description: 'CS2, современные игры, монтаж и ресурсоёмкие задачи.' };
  }

  if (/macbook|apple m/.test(details)) {
    return { label: 'Работа в дороге', description: 'Учёба, созвоны, дизайн и повседневные рабочие задачи.' };
  }

  if (/i3|8 gb|8gb/.test(details)) {
    return { label: 'Учёба и офис', description: 'Документы, браузер, онлайн-встречи и учёба.' };
  }

  return { label: 'Работа и разработка', description: 'Офисные задачи, браузер, созвоны и рабочие программы.' };
}

function taskLabel(laptop) {
  const tasks = getLaptopTasks(laptop);
  if (tasks.includes('gaming')) return 'Игры / монтаж / 3D';
  if (tasks.includes('creative')) return 'Монтаж / дизайн';
  if (tasks.includes('code')) return 'Работа / разработка';
  if (tasks.includes('study')) return 'Учёба / офис';
  return 'Для повседневных задач';
}

function laptopUseTags(laptop) {
  const suppliedTags = String(laptop.use_cases || '').split(',').map(tag => tag.trim()).filter(Boolean);
  const tasks = getLaptopTasks(laptop);
  const automaticTags = tasks.includes('exam') ? ['Онлайн-экзамены', 'TOEFL / IELTS'] : tasks.includes('gaming') ? ['Игры', 'Монтаж / 3D'] : tasks.includes('creative') ? ['Монтаж', 'Дизайн'] : tasks.includes('study') ? ['Учёба', 'Офис'] : ['Офис', 'Работа'];
  const tags = (suppliedTags.length ? suppliedTags : automaticTags).slice(0, 6);
  return tags.length ? `<div class="laptop-use-tags" aria-label="Подходит для">${tags.map(tag => `<span>${tag}</span>`).join('')}</div>` : '';
}

function formatLaptopTitle(title = '') {
  const [brand, ...model] = title.trim().split(/\s+/);
  if (!brand) return 'Ноутбук';
  return `<span class="laptop-brand">${brand}</span>${model.length ? ` ${model.join(' ')}` : ''}`;
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

function updateCatalogUtilityButtons() {
  if (savedCount) savedCount.textContent = String(savedLaptopIds.size);
  if (savedOnlyButton) {
    savedOnlyButton.classList.toggle('is-active', savedOnly);
    savedOnlyButton.setAttribute('aria-pressed', String(savedOnly));
    const savedIcon = savedOnlyButton.querySelector('.catalog-utility-icon');
    if (savedIcon) savedIcon.textContent = savedOnly ? '♥' : '♡';
  }
  if (comparisonCount) comparisonCount.textContent = String(comparisonLaptopIds.size);
  if (comparisonDock) {
    const count = comparisonLaptopIds.size;
    comparisonDock.classList.toggle('is-ready', count >= 2);
    comparisonDock.querySelector('.catalog-utility-label').textContent = count >= 2 ? 'Сравнить' : 'Сравнение';
  }
}

function renderComparison() {
  updateCatalogUtilityButtons();
  if (!comparisonPanel || !comparisonContent) return;
  const selected = [...comparisonLaptopIds].map(id => laptops.find(laptop => String(laptop.id) === String(id))).filter(Boolean);
  comparisonPanel.hidden = selected.length === 0;
  if (!selected.length) { comparisonContent.innerHTML = ''; return; }
  if (selected.length === 1) {
    comparisonContent.innerHTML = `<p class="catalog-compare-hint"><strong>${selected[0].title}</strong> выбран. Добавьте ещё один ноутбук кнопкой «Сравнить».</p>`;
    return;
  }
  const rows = [
    ['Подходит для', selected.map(taskLabel)],
    ['Процессор', selected.map(item => item.cpu || '—')],
    ['Оперативная память', selected.map(item => item.ram || '—')],
    ['Накопитель', selected.map(item => item.storage || '—')],
    ['Цена', selected.map(item => item.priceText || '—')]
  ];
  comparisonContent.innerHTML = `<div class="catalog-compare-table"><div class="catalog-compare-row is-head" style="--compare-count:${selected.length}"><span>Характеристика</span>${selected.map(item => `<strong>${formatLaptopTitle(item.title)}</strong>`).join('')}</div>${rows.map(([label, values]) => `<div class="catalog-compare-row" style="--compare-count:${selected.length}"><span>${label}</span>${values.map(value => `<b>${value}</b>`).join('')}</div>`).join('')}</div><div class="catalog-compare-actions">${selected.map(item => `<button type="button" class="btn-card" data-id="${item.id}">Забронировать ${item.title}</button>`).join('')}</div>`;
  comparisonContent.querySelectorAll('.btn-card').forEach(button => button.addEventListener('click', () => {
    if (catalogBrowser && !catalogBrowser.hidden) setCatalogBrowser(false);
    openOrderModal(Number(button.dataset.id), { deliveryType: archaSelectionMode ? 'arca_locker' : 'delivery' });
  }));
}

function catalogItemsPerPage() {
  // The homepage is a three-model showroom on every desktop size.
  // The full catalog remains available through its own button.
  if (window.matchMedia('(min-width: 769px)').matches) return 3;
  return MOBILE_ITEMS_PER_PAGE;
}

function catalogPageCount() {
  return Math.max(1, Math.ceil(filteredLaptops.length / catalogItemsPerPage()));
}

function updateCatalogPager() {
  const count = catalogPageCount();
  if (currentPage > count) currentPage = count;
  const perPage = catalogItemsPerPage();
  const first = (currentPage - 1) * perPage + 1;
  const last = Math.min(currentPage * perPage, filteredLaptops.length);
  if (catalogPageStatus) catalogPageStatus.textContent = filteredLaptops.length
    ? (window.matchMedia('(max-width: 768px)').matches ? `Модели ${first}–${last} из ${filteredLaptops.length}` : `Модели ${first}–${last} из ${filteredLaptops.length}`)
    : 'Нет подходящих моделей';
  if (catalogPagePrev) catalogPagePrev.disabled = currentPage <= 1;
  if (catalogPageNext) catalogPageNext.disabled = currentPage >= count;
  if (catalogShowcasePrev) catalogShowcasePrev.disabled = currentPage <= 1;
  if (catalogShowcaseNext) catalogShowcaseNext.disabled = currentPage >= count;
}

// ========== RENDER CATALOG ==========
function renderLaptops(items, append = false, target = catalogGrid) {
  if (!target) return;
  const replacementMode = isPrepaymentReplacementMode();

  if (!append) {
    target.innerHTML = '';
  }

  if (items.length === 0 && !append) {
    target.innerHTML = `
      <p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 50px 0;">
        Ничего не найдено
      </p>`;
    updateCatalogPager();
    return;
  }

  items.forEach(laptop => {
    const isRent = laptop.category === 'rent';
    const badge = laptop.badge || (isRent ? 'Аренда' : 'Продажа');
    const profile = getCatalogProfile(laptop);
    const availability = cardAvailability(blockingRentals, laptop.id, todayIso());
    const isSaved = savedLaptopIds.has(String(laptop.id));
    const isCompared = comparisonLaptopIds.has(String(laptop.id));
    const statusClass = availability.state === 'busy'
      ? 'is-busy'
      : availability.state === 'soon'
        ? 'is-soon'
        : '';

    const card = document.createElement('div');
    card.className = `card${replacementMode ? ' replacement-catalog-card' : ''}`;
    card.dataset.laptopId = String(laptop.id);
    card.innerHTML = `
      <div class="card-topline">
        <span class="availability-status ${statusClass}">
          ${availability.label}
        </span>
        <div class="card-topline-actions" ${replacementMode ? 'hidden' : ''}>
          <button class="catalog-share-button" data-share-laptop="${laptop.id}" type="button" aria-label="Скопировать ссылку на ${laptop.title}" title="Скопировать ссылку">↗</button>
          <button class="save-laptop ${isSaved ? 'is-saved' : ''}" data-id="${laptop.id}" type="button" aria-label="${isSaved ? 'Убрать из избранного' : 'Сохранить ноутбук'}" aria-pressed="${isSaved}">
            ${isSaved ? '♥' : '♡'}
          </button>
        </div>
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
        <h3>${formatLaptopTitle(laptop.title)}</h3>
        <div class="laptop-fit">
          <span class="laptop-fit-label">${taskLabel(laptop)}</span>
          <p>${laptop.description || profile.description}</p>
        </div>
        ${laptopUseTags(laptop)}
        <ul class="specs-list">
          <li><span>Процессор</span>${laptop.cpu || '—'}</li>
          <li><span>Память</span>${laptop.ram || '—'}</li>
          <li><span>Накопитель</span>${laptop.storage || '—'}</li>
        </ul>
        <p class="rental-includes">${isRent ? 'В аренду входит: Word, офисные программы, подготовка, зарядка и сумка.' : 'Проверка устройства и консультация перед покупкой.'}</p>
      </div>
      <div>
        <div class="price-block">
          <div class="price-main">${laptop.priceText || '—'}</div>
          <div class="price-sub">${isRent ? 'при аренде от 2-х дней' : 'в наличии / под заказ'}</div>
        </div>
        <button class="btn-card" data-id="${laptop.id}" ${replacementMode && !isRent ? 'disabled' : ''}>
          ${replacementMode ? (isRent ? 'Выбрать для замены' : 'Недоступно для аренды') : (isRent ? (archaSelectionMode ? 'Выбрать для ARCHA POINT' : 'Забронировать') : 'Купить / Предзаказ')}
        </button>
        ${isRent && !replacementMode ? `<button class="catalog-compare-button ${bookingLaptopIds.has(laptop.id) ? 'is-selected' : ''}" data-add-to-order="${laptop.id}">${bookingLaptopIds.has(laptop.id) ? '✓ Добавлен в заказ' : 'Добавить в заказ'}</button>` : ''}
        ${replacementMode ? '' : `<button class="catalog-compare-button ${isCompared ? 'is-selected' : ''}" data-compare-laptop="${laptop.id}" type="button" aria-pressed="${isCompared}">
          ${isCompared ? '✓ В сравнении' : 'Сравнить'}
        </button>`}
      </div>
    `;

    target.appendChild(card);
  });

  // Навешивание событий на новые кнопки бронирования
  target.querySelectorAll('.btn-card').forEach(btn => {
    btn.onclick = (e) => {
      const id = Number(e.currentTarget.dataset.id);
      if (replacementMode) { choosePrepaymentReplacement(id, e.currentTarget); return; }
      if (catalogBrowser && !catalogBrowser.hidden) setCatalogBrowser(false);
      openOrderModal(id, { deliveryType: archaSelectionMode ? 'arca_locker' : 'delivery' });
    };
  });
  target.querySelectorAll('[data-add-to-order]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.addToOrder);
      if (bookingLaptopIds.has(id)) bookingLaptopIds.delete(id);
      else if (bookingLaptopIds.size < 12) bookingLaptopIds.add(id);
      else { alert('В корпоративную заявку можно добавить не более 12 ноутбуков.'); return; }
      btn.textContent = bookingLaptopIds.has(id) ? '✓ Добавлен в заказ' : 'Добавить в заказ';
      renderBookingCart();
    };
  });

  target.querySelectorAll('.save-laptop').forEach(btn => {
    btn.onclick = (e) => {
      const id = String(e.currentTarget.dataset.id);
      if (savedLaptopIds.has(id)) {
        savedLaptopIds.delete(id);
      } else {
        savedLaptopIds.add(id);
      }
      saveSavedLaptops();
      filterAndSearch();
    };
  });

  target.querySelectorAll('[data-share-laptop]').forEach(button => {
    button.onclick = async () => {
      const shareUrl = laptopShareUrl(button.dataset.shareLaptop);
      const initialText = button.textContent;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(shareUrl);
        button.textContent = '✓';
        button.setAttribute('aria-label', 'Ссылка скопирована');
      } catch {
        window.prompt('Скопируйте ссылку на эту модель:', shareUrl);
      }
      window.setTimeout(() => {
        button.textContent = initialText;
        button.setAttribute('aria-label', 'Скопировать ссылку на модель');
      }, 1800);
    };
  });

  target.querySelectorAll('[data-compare-laptop]').forEach(button => {
    button.onclick = () => {
      const id = String(button.dataset.compareLaptop);
      if (comparisonLaptopIds.has(id)) comparisonLaptopIds.delete(id);
      else if (comparisonLaptopIds.size >= 3) {
        window.alert('Для сравнения можно выбрать не более трёх ноутбуков.');
        return;
      } else comparisonLaptopIds.add(id);
      renderComparison();
      updateCatalogView(false);
    };
  });

  // Клик по картинке → лайтбокс
  target.querySelectorAll('.card-img').forEach(img => {
    img.onclick = () => {
      lightboxImg.src = img.src;
      lightboxCaption.textContent = img.dataset.title || '';
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    };
  });
}

function renderCatalogPreview(items) {
  if (!catalogPreviewGrid) return;
  if (!items.length) {
    catalogPreviewGrid.innerHTML = '<p class="catalog-preview-empty">Каталог пока недоступен. Проверьте подключение и обновите страницу.</p>';
    return;
  }
  catalogPreviewGrid.innerHTML = items.map(laptop => {
    return `<article class="catalog-preview-card" data-open-full data-laptop-id="${Number(laptop.id)}" role="button" tabindex="0" aria-label="Открыть полный каталог и посмотреть модель ${laptop.title}">
      <img src="${laptop.image}" alt="${laptop.title}" class="catalog-preview-image" loading="lazy">
      <div class="catalog-preview-copy">
        <h3>${formatLaptopTitle(laptop.title)}</h3>
        <span class="catalog-preview-meta">${laptop.showcaseLabel || taskLabel(laptop)}</span>
        <strong>${laptop.priceText || 'Цена уточняется'}</strong>
        <div class="catalog-preview-actions">
          <span class="catalog-preview-open" aria-hidden="true">Смотреть модель <span>→</span></span>
        </div>
      </div>
    </article>`;
  }).join('');
}

function getFeaturedShowcaseModels(limit = 6) {
  // The landing showcase is an editorial selection, not the result of the
  // currently selected catalog filter. This keeps a useful mix on every visit.
  const pool = laptops.filter(Boolean);
  const selected = [];
  const selectedIds = new Set();
  const take = (label, predicate) => {
    const laptop = pool.find((item) => !selectedIds.has(String(item.id)) && predicate(item));
    if (!laptop) return;
    selectedIds.add(String(laptop.id));
    selected.push({ ...laptop, showcaseLabel: label });
  };
  const isGaming = (item) => getLaptopTasks(item).includes('gaming');
  const isTestFriendly = (item) => getLaptopTasks(item).includes('exam')
    || /hp|thinkpad|lenovo|i3|n150|celeron|pentium|pavilion/i.test(`${item.title || ''} ${item.cpu || ''}`);

  take('Игры / монтаж / 3D', isGaming);
  take('Игры / монтаж / 3D', isGaming);
  take('Тесты / учёба', isTestFriendly);
  take('Офис / работа', (item) => getLaptopTasks(item).includes('office'));
  take('Универсальный вариант', (item) => !isGaming(item));

  for (const laptop of pool) {
    if (selected.length >= limit) break;
    if (selectedIds.has(String(laptop.id))) continue;
    selectedIds.add(String(laptop.id));
    selected.push({ ...laptop, showcaseLabel: taskLabel(laptop) });
  }
  return selected.slice(0, limit);
}

function syncCatalogShowcaseLayout() {
  // Some Android browsers render a page in "desktop site" mode.  The CSS
  // viewport then becomes wide although the physical screen is still narrow.
  // A coarse pointer is a reliable signal to keep this small homepage showcase
  // compact, while a normal desktop keeps the three-column presentation.
  const isCompact = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  document.documentElement.classList.toggle('catalog-showcase-compact', isCompact);
}

function setCatalogBrowser(open, { render = true } = {}) {
  if (!catalogBrowser) return;
  catalogBrowser.hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open && render) {
    renderLaptops(filteredLaptops, false, catalogGrid);
    catalogBrowser.querySelector('.catalog-browser-dialog')?.focus();
  }
}

function renderPrepaymentReplacementCatalogUi() {
  const active = isPrepaymentReplacementMode();
  document.documentElement.classList.toggle('prepayment-replacement-catalog', active);
  const title = document.getElementById('catalog-browser-title');
  const copy = document.querySelector('.catalog-browser-copy p');
  const utilityStrip = document.querySelector('.catalog-utility-strip');
  let notice = document.getElementById('prepayment-replacement-catalog-notice');
  if (!active) {
    title && (title.textContent = 'Каталог ноутбуков');
    copy && (copy.textContent = 'Выберите задачу, найдите подходящую модель и забронируйте онлайн.');
    notice?.remove();
    return;
  }
  title && (title.textContent = 'Выберите замену ноутбука');
  copy && (copy.textContent = 'Вы выбираете модель для уже созданной заявки. Даты, способ получения и документы сохранятся.');
  if (!notice && utilityStrip) {
    notice = document.createElement('div');
    notice.id = 'prepayment-replacement-catalog-notice';
    utilityStrip.before(notice);
  }
  if (notice) notice.innerHTML = `<strong>Заявка ${prepaymentReplacementContext.reference || ''}</strong><span>Выберите одну свободную модель. После нажатия «Выбрать для замены» сумма пересчитается автоматически.</span><button type="button" data-cancel-prepayment-replacement>Вернуться к заявке</button>`;
}

async function choosePrepaymentReplacement(laptopId, button) {
  if (!isPrepaymentReplacementMode()) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Проверяем…';
  try {
    const response = await fetch('/api/account', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type':'application/json' },
      body:JSON.stringify({ action:'replace_draft_laptop', orderId:prepaymentReplacementContext.orderId, replacementLaptopId:laptopId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось заменить модель.');
    const orderId = prepaymentReplacementContext.orderId;
    clearPrepaymentReplacementContext();
    window.location.assign(`/account?replacement_done=${encodeURIComponent(orderId)}`);
  } catch (error) {
    alert(error.message || 'Не удалось заменить модель. Попробуйте другую.');
    button.disabled = false;
    button.textContent = originalText;
  }
}

function exitPrepaymentReplacementCatalog() {
  if (!isPrepaymentReplacementMode()) return false;
  const orderId = prepaymentReplacementContext.orderId;
  clearPrepaymentReplacementContext();
  window.location.assign(`/account?replacement_cancelled=${encodeURIComponent(orderId)}`);
  return true;
}

function openCatalogWithLoading() {
  if (!catalogBrowser || catalogOpening) return;
  catalogOpening = true;
  setCatalogBrowser(true, { render:false });
  if (catalogGrid) {
    catalogGrid.innerHTML = '<p class="catalog-loading" role="status"><span aria-hidden="true"></span>Открываем каталог…</p>';
  }
  catalogBrowser.querySelector('.catalog-browser-dialog')?.focus();
  // Yield one frame so the spinner appears before a large catalogue is drawn.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    if (!catalogBrowser.hidden) renderLaptops(filteredLaptops, false, catalogGrid);
    catalogOpening = false;
  }));
}

function laptopShareUrl(laptopId) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('model', String(laptopId));
  url.hash = 'catalog';
  return url.toString();
}

function clearSharedModelFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('model')) return false;
  url.searchParams.delete('model');
  url.hash = 'catalog';
  window.history.replaceState({}, '', url);
  return true;
}

function openCatalogForLaptop(laptopId, { keepShareLink = true } = {}) {
  const selected = laptops.find(laptop => String(laptop.id) === String(laptopId));
  if (!selected) {
    openCatalogWithLoading();
    return;
  }

  // A click on a storefront model is a direct intent, not a request to keep
  // an old search/filter state. Resetting the filters guarantees the same
  // model is visible in the complete catalog on desktop and mobile.
  activeCategoryFilter = selected.category || 'rent';
  activeUseFilter = 'all';
  savedOnly = false;
  if (keepShareLink) window.history.replaceState({}, '', laptopShareUrl(selected.id));
  categoryFilterButtons.forEach(button => button.classList.toggle('active', button.dataset.filter === activeCategoryFilter));
  useFilterButtons.forEach(button => button.classList.toggle('active', button.dataset.use === 'all'));
  filterAndSearch();
  openCatalogWithLoading();

  let attempts = 0;
  const focusSelectedCard = () => {
    const card = [...(catalogGrid?.querySelectorAll('.card') || [])]
      .find(item => item.dataset.laptopId === String(selected.id));
    if (!card && attempts++ < 4) {
      window.requestAnimationFrame(focusSelectedCard);
      return;
    }
    if (!card) return;
    card.scrollIntoView({ behavior:'smooth', block:'center' });
    card.classList.add('catalog-card-target');
    window.setTimeout(() => card.classList.remove('catalog-card-target'), 2200);
  };
  window.setTimeout(() => window.requestAnimationFrame(focusSelectedCard), 40);
}

// ========== PAGINATION & RENDER CONTROLLER ==========
function updateCatalogView(resetPagination = true) {
  if (resetPagination) {
    currentPage = 1;
  }

  // The landing page is a fixed six-model showcase, not a second booking
  // catalog. All filtering and booking remain inside the complete browser.
  renderCatalogPreview(getFeaturedShowcaseModels(6));
  // The full catalog is expensive on a phone. Do not rebuild dozens of cards
  // and image nodes while its dialog is closed; render it only on demand.
  if (catalogBrowser && !catalogBrowser.hidden) renderLaptops(filteredLaptops, false, catalogGrid);
  updateCatalogPager();
  updateCatalogUtilityButtons();
  if (catalogResultsCount) catalogResultsCount.textContent = String(filteredLaptops.length);
}

function changeCatalogPage(direction) {
  const nextPage = Math.min(catalogPageCount(), Math.max(1, currentPage + direction));
  if (nextPage === currentPage) return;
  currentPage = nextPage;
  updateCatalogView(false);
  catalogPreviewGrid?.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ========== FILTER ==========
function filterAndSearch() {
  const version = ++catalogRenderVersion;
  if (pendingFilterFrame) cancelAnimationFrame(pendingFilterFrame);

  pendingFilterFrame = requestAnimationFrame(() => {
    if (!catalogReady || version !== catalogRenderVersion) return;

    const nextItems = laptops.filter(laptop => {
      const categoryMatches = activeCategoryFilter === 'all' || laptop.category === activeCategoryFilter;
      const useMatches = matchesTask(laptop, activeUseFilter);
      const savedMatches = !savedOnly || savedLaptopIds.has(String(laptop.id));
      return categoryMatches && useMatches && savedMatches;
    });

    if (version !== catalogRenderVersion) return;
    filteredLaptops = nextItems;
    updateCatalogView(true);
  });
}

function getDailyRate(laptop) {
  const rate = Number(laptop?.dailyRate ?? laptop?.daily_rate ?? 0);
  return Number.isFinite(rate) ? rate : 0;
}

function bookingItems() {
  return laptops.filter((laptop) => bookingLaptopIds.has(laptop.id) && laptop.category === 'rent');
}

function renderBookingCart() {
  let cart = document.getElementById('booking-cart');
  const items = bookingItems();
  if (!items.length) {
    cart?.remove();
    return;
  }
  if (!cart) {
    cart = document.createElement('aside');
    cart.id = 'booking-cart';
    cart.className = 'booking-cart';
    cart.setAttribute('aria-live', 'polite');
    document.body.append(cart);
  }
  const countLabel = items.length === 1 ? '1 ноутбук' : items.length < 5 ? `${items.length} ноутбука` : `${items.length} ноутбуков`;
  cart.innerHTML = `<div><span>ВАШ ЗАКАЗ</span><strong>${countLabel}</strong><small>${items.map(item => item.title).join(' · ')}</small></div><button type="button" data-open-booking-cart>Оформить <b>→</b></button><button class="booking-cart-clear" type="button" data-clear-booking-cart aria-label="Очистить заказ">×</button>`;
  cart.querySelector('[data-open-booking-cart]')?.addEventListener('click', () => {
    const first = bookingItems()[0];
    if (first) openOrderModal(first.id, { deliveryType: archaSelectionMode ? 'arca_locker' : 'delivery' });
  });
  cart.querySelector('[data-clear-booking-cart]')?.addEventListener('click', () => {
    bookingLaptopIds.clear();
    renderBookingCart();
    filterAndSearch();
  });
}

function renderBookingOrderItems() {
  if (!modalOrderItems) return;
  const items = bookingItems();
  if (items.length < 2) {
    modalOrderItems.replaceChildren();
    return;
  }
  modalOrderItems.innerHTML = items.map((item) => `
    <span><b>${item.title}</b><button type="button" data-remove-order-item="${item.id}" aria-label="Убрать ${item.title} из заказа">Убрать</button></span>
  `).join('');
  modalOrderItems.querySelectorAll('[data-remove-order-item]').forEach((button) => {
    button.addEventListener('click', () => {
      if (bookingLaptopIds.size <= 1) return;
      bookingLaptopIds.delete(Number(button.dataset.removeOrderItem));
      if (!bookingLaptopIds.has(currentLaptop?.id)) currentLaptop = bookingItems()[0] || null;
      const selected = bookingItems();
      if (modalLaptopTitle) modalLaptopTitle.textContent = selected.length > 1
        ? `В заказе ${selected.length} ${selected.length < 5 ? 'ноутбука' : 'ноутбуков'}`
        : `Вы выбрали: ${selected[0]?.title || 'ноутбук'}`;
      renderBookingOrderItems();
      renderBookingCart();
      updateCalculator();
    });
  });
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
  updateDeliveryNote();
  if (!submitBtn) return;
  submitBtn.disabled = false;
  submitBtn.textContent = 'Продолжить в Telegram';
}

function updateDeliveryNote() {
  const selected = deliveryTypeInput?.value || 'delivery';
  deliveryChoiceButtons.forEach((button) => {
    const active = button.dataset.deliveryOption === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  const note = document.querySelector('.delivery-note');
  if (note) {
    const multi = bookingItems().length > 1;
    note.textContent = selected === 'arca_locker'
      ? (multi
        ? 'Менеджер подберёт одну или две ячейки ARCHA POINT для всего заказа и сообщит коды после подготовки.'
        : 'Точку ARCHA POINT выберете следующим коротким шагом в личном кабинете.')
      : (multi
        ? 'Все ноутбуки передадим одной курьерской доставкой. Адрес и время укажете следующим шагом в кабинете.'
        : 'Адрес и время доставки укажете следующим коротким шагом в личном кабинете.');
  }
}

function selectedArchaLocation() {
  // The exact point is selected in the protected cabinet together with the
  // rest of the handover details, not in the quick booking popup.
  return '';
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

  const startDate = rentalStartInput?.value && rentalStartInput.value >= today
    ? rentalStartInput.value
    : today;
  const earliestEnd = addDays(startDate, 2);
  if (rentalEndInput) rentalEndInput.min = earliestEnd;
  if (rentalEndInput?.value && rentalEndInput.value < earliestEnd) {
    rentalEndInput.value = earliestEnd;
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

function alternativeScore(candidate, selected) {
  const selectedTasks = new Set(getLaptopTasks(selected));
  const sharedTasks = getLaptopTasks(candidate).filter(task => selectedTasks.has(task)).length;
  return (sharedTasks * 10000) - Math.abs(getDailyRate(candidate) - getDailyRate(selected));
}

function renderBookingAlternatives(draft) {
  if (!bookingAlternatives || !bookingAlternativesList) return;
  const unavailable = Boolean(draft?.availabilityError && currentLaptop && availabilityLoaded);
  if (!unavailable) {
    bookingAlternatives.hidden = true;
    bookingAlternativesList.replaceChildren();
    return;
  }
  const alternatives = laptops
    .filter(laptop => laptop.category === 'rent' && String(laptop.id) !== String(currentLaptop.id) && getDailyRate(laptop) > 0 && !hasDateConflict(blockingRentals, laptop.id, draft.startDate, draft.endDate))
    .sort((a, b) => alternativeScore(b, currentLaptop) - alternativeScore(a, currentLaptop))
    .slice(0, 3);
  if (!alternatives.length) {
    bookingAlternatives.hidden = true;
    bookingAlternativesList.replaceChildren();
    return;
  }
  const selectedRate = getDailyRate(currentLaptop);
  bookingAlternativesList.innerHTML = alternatives.map((laptop) => {
    const rate = getDailyRate(laptop);
    const difference = rate - selectedRate;
    const differenceLabel = difference === 0 ? 'Та же цена' : `${difference > 0 ? '+' : '−'}${Math.abs(difference).toLocaleString('ru-RU')} сом/день`;
    return `<button type="button" class="booking-alternative" data-booking-alternative="${String(laptop.id)}"><span class="booking-alternative-copy"><strong>${laptop.title || 'Ноутбук'}</strong><small>${taskLabel(laptop)} · ${differenceLabel}</small></span><span class="booking-alternative-rate">${rate.toLocaleString('ru-RU')}<small>сом/день</small></span><b aria-hidden="true">→</b></button>`;
  }).join('');
  bookingAlternatives.hidden = false;
}

function selectBookingAlternative(laptopId) {
  const nextLaptop = laptops.find(laptop => String(laptop.id) === String(laptopId));
  if (!nextLaptop || nextLaptop.category !== 'rent') return;
  const previousId = currentLaptop?.id;
  currentLaptop = nextLaptop;
  if (previousId) bookingLaptopIds.delete(previousId);
  bookingLaptopIds.add(nextLaptop.id);
  const selected = bookingItems();
  modalLaptopTitle.textContent = selected.length > 1 ? `В заказе ${selected.length} ${selected.length < 5 ? 'ноутбука' : 'ноутбуков'}` : `Вы выбрали: ${currentLaptop.title}`;
  renderBookingOrderItems();
  updateCalculator({ text: 'Модель заменена. Этот ноутбук свободен на выбранные даты.', isError: false });
}

async function getCabinetSession() {
  try {
    const response = await fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    cabinetSession = response.ok && data.authenticated ? data : null;
  } catch {
    cabinetSession = null;
  }
  updateSiteAccountUi();
  return cabinetSession;
}

function updateSiteAccountUi() {
  const signedIn = Boolean(cabinetSession?.authenticated);
  if (navAccountGuest) navAccountGuest.hidden = signedIn;
  if (navAccountAuth) navAccountAuth.hidden = !signedIn;
  if (!navAccountGreeting) return;
  const name = String(cabinetSession?.profile?.full_name || '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = parts.length > 1 ? parts[1] : parts[0];
  navAccountGreeting.textContent = firstName ? `Здравствуйте, ${firstName}!` : 'Личный кабинет';
}

function updateOrderAuthUi() {
  updateSiteAccountUi();
  const signedIn = Boolean(cabinetSession?.authenticated);
  const rentalBooking = currentLaptop?.category === 'rent';
  const nameInput = document.getElementById('user-name');
  const verifiedName = String(cabinetSession?.profile?.full_name || '').trim();
  if (nameInput) {
    if (signedIn && verifiedName) nameInput.value = verifiedName;
    nameInput.readOnly = Boolean(signedIn && verifiedName);
    // A first booking is created only after the cabinet profile has been
    // saved.  Do not leave a required, hidden field in the form for a new
    // signed-in customer: it caused browsers to block the next step.
    nameInput.required = !signedIn && !rentalBooking;
    nameInput.title = signedIn && verifiedName
      ? 'ФИО берётся из личного кабинета. Для исправления откройте личный кабинет.'
      : '';
  }
  // Rental customers always enter their personal data in the protected
  // cabinet. The booking popup only asks for the rental details.
  if (orderNameGroup) orderNameGroup.hidden = signedIn || rentalBooking;
  const phoneInput = document.getElementById('user-phone');
  if (phoneInput) {
    phoneInput.hidden = signedIn || rentalBooking;
    phoneInput.required = !signedIn && !rentalBooking;
  }
  if (orderPhoneGroup) orderPhoneGroup.classList.toggle('is-session-known', signedIn);
  if (orderPhoneLabel) orderPhoneLabel.textContent = rentalBooking ? 'Профиль Rentop' : (signedIn ? 'Вы оформляете заявку с профиля' : 'Номер телефона / WhatsApp');
  if (cabinetOrderPhone) {
    cabinetOrderPhone.hidden = !rentalBooking;
    cabinetOrderPhone.textContent = signedIn
      ? `${verifiedName || 'Сначала заполните профиль в личном кабинете'} · ${cabinetSession.phone}`
      : 'Для аренды сначала подтвердите номер в личном кабинете.';
  }
  if (submitBtn && !submitInFlight) submitBtn.textContent = signedIn
    ? (verifiedName ? 'Продолжить оформление' : 'Заполнить профиль и продолжить')
    : 'Войти и продолжить';
  updateDeliveryNote();
}

navAccountLogout?.addEventListener('click', async () => {
  navAccountLogout.disabled = true;
  try {
    await fetch('/api/account', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout' })
    });
  } finally {
    cabinetSession = null;
    updateOrderAuthUi();
    window.location.assign('/');
  }
});

function savePendingBooking() {
  if (!currentLaptop) return;
  const draft = currentLaptop.category === 'rent' ? currentRentalDraft() : {};
  persistPendingBooking({
    laptopId: currentLaptop.id,
    laptopIds: [...bookingLaptopIds],
    laptopTitle: currentLaptop.title || '',
    deliveryType: deliveryTypeInput?.value || 'delivery',
    lockerAddress: selectedArchaLocation(),
    startDate: draft.startDate || '',
    endDate: draft.endDate || ''
  });
}

function redirectToCabinet() {
  savePendingBooking();
  window.location.assign('/account?return=booking');
}

let orderModalPageScrollY = 0;
function setOrderModalScrollLock(open) {
  if (!modal) return;
  const body = document.body;
  const root = document.documentElement;
  if (open) {
    orderModalPageScrollY = window.scrollY || window.pageYOffset || 0;
    root.classList.add('order-modal-open');
    body.classList.add('order-modal-open');
    body.style.position = 'fixed';
    body.style.top = `-${orderModalPageScrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return;
  }
  root.classList.remove('order-modal-open');
  body.classList.remove('order-modal-open');
  body.style.position = '';
  body.style.top = '';
  body.style.width = '';
  body.style.overflow = '';
  window.scrollTo({ top:orderModalPageScrollY, behavior:'auto' });
}

// ========== MODAL + CALCULATOR ==========
async function openOrderModal(id, { deliveryType = 'delivery' } = {}) {
  const selectedLaptop = laptops.find(item => item.id === id);
  if (!selectedLaptop) return;

  // Let a new customer see the exact model, dates, delivery method and price
  // first. The verified-phone step happens only when they press Continue;
  // redirectToCabinet() then preserves this completed draft.
  currentLaptop = selectedLaptop;
  bookingLaptopIds.add(selectedLaptop.id);
  renderBookingCart();
  const selectedItems = bookingItems();

  modalLaptopTitle.textContent = selectedItems.length > 1 ? `В заказе ${selectedItems.length} ${selectedItems.length < 5 ? 'ноутбука' : 'ноутбуков'}` : `Вы выбрали: ${currentLaptop.title}`;
  renderBookingOrderItems();

  if (currentLaptop.category === 'rent') {
    calcBox.style.display = 'block';
    const today = todayIso();
    if (rentalStartInput) rentalStartInput.value = today;
    if (rentalEndInput) rentalEndInput.value = addDays(today, 2);
    if (daysSlider) {
      daysSlider.min = '2';
      daysSlider.max = '15';
      daysSlider.value = '2';
    }
    if (manualDurationInput) manualDurationInput.value = '';
    if (deliveryTypeInput) deliveryTypeInput.value = deliveryType;
    updateDeliveryNote();
    updateCalculator();
  } else {
    calcBox.style.display = 'none';
    showRentalMessage('');
    if (submitBtn && !submitInFlight) submitBtn.disabled = false;
  }

  modal.classList.add('active');
  setOrderModalScrollLock(true);
  modal.scrollTop = 0;
  const card = modal.querySelector('.modal-card');
  if (card) card.scrollTop = 0;
  updateOrderAuthUi();
}

function openArchaOrder() {
  archaSelectionMode = true;
  activeCategoryFilter = 'rent';
  activeUseFilter = 'all';
  categoryFilterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === 'rent'));
  useFilterButtons.forEach((button) => button.classList.toggle('active', button.dataset.use === 'all'));
  if (archaSelectionNotice) archaSelectionNotice.hidden = false;
  filterAndSearch();
  document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

archaOrderBtn?.addEventListener('click', openArchaOrder);
closeArchaSelectionBtn?.addEventListener('click', () => {
  archaSelectionMode = false;
  if (archaSelectionNotice) archaSelectionNotice.hidden = true;
  filterAndSearch();
});

bookingAlternativesList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-booking-alternative]');
  if (button) selectBookingAlternative(button.dataset.bookingAlternative);
});

function updateCalculator(forcedMessage) {
  if (!currentLaptop || currentLaptop.category !== 'rent') return;

  clampRentalDates();
  const draft = currentRentalDraft();
  const selectedItems = bookingItems();
  const groupAvailabilityError = !draft.validationError && availabilityLoaded
    && selectedItems.some((laptop) => hasDateConflict(blockingRentals, laptop.id, draft.startDate, draft.endDate))
    ? 'Один из выбранных ноутбуков уже занят на эти даты. Уберите его из заказа или выберите другой период.'
    : '';
  const now = Date.now();
  const tariffDiscount = Number(draft.quote.discountPercent || 0);
  const benefitDiscount = Array.isArray(cabinetSession?.benefits) && cabinetSession.benefits.some((benefit) => (
    benefit.status === 'approved' && (!benefit.expires_at || new Date(benefit.expires_at).getTime() > now)
  )) ? 10 : 0;
  const promoCode = String(userPromoInput?.value || '').trim().toUpperCase().replace(/\s+/g, '');
  const activePromo = promoCode && Array.isArray(cabinetSession?.promos)
    ? cabinetSession.promos.find((promo) => promo.code === promoCode && promo.status === 'issued' && !promo.redeemed_at && (!promo.expires_at || new Date(promo.expires_at).getTime() > now))
    : null;
  // One code is currently tied to one payment record. Do not show a discount
  // that the secure backend cannot yet redeem for a combined order.
  const promoDiscount = selectedItems.length === 1 ? Number(activePromo?.discount_percent || 0) : 0;
  const discount = Math.min(40, tariffDiscount + benefitDiscount + promoDiscount);
  const regularTotal = selectedItems.reduce((sum, laptop) => sum + (draft.quote.days * getDailyRate(laptop)), 0);
  const total = Math.round(regularTotal * (100 - discount) / 100);
  const discountParts = [
    tariffDiscount ? `срок ${tariffDiscount}%` : '',
    benefitDiscount ? 'льгота 10%' : '',
    promoDiscount ? `промокод ${promoDiscount}%` : ''
  ].filter(Boolean);

  if (daysCount) daysCount.textContent = String(draft.quote.days);
  if (totalPriceEl) totalPriceEl.textContent = total.toLocaleString('ru-RU');
  const totalLabel = document.querySelector('.calc-total-text');
  if (totalLabel) totalLabel.textContent = selectedItems.length > 1
    ? `За весь срок · ${selectedItems.length} ноутбука:`
    : 'За весь срок:';
  if (daysSlider && draft.quote.days >= 2) {
    // The slider is a quick picker, not an invitation to jump to a costly
    // 30-day total. Longer rentals are still available through the return
    // date field and retain the 30% tariff discount.
    daysSlider.max = '15';
    daysSlider.value = String(Math.min(15, draft.quote.days));
  }
  if (manualDurationInput && draft.quote.days >= 2 && document.activeElement !== manualDurationInput) {
    manualDurationInput.value = String(draft.quote.days);
  }
  rentalDurationButtons.forEach((button) => {
    const threshold = Number(button.dataset.rentalDuration || 0);
    button.classList.toggle('active', threshold > 0 && draft.quote.days >= threshold
      && !rentalDurationButtons.some((other) => Number(other.dataset.rentalDuration || 0) > threshold && draft.quote.days >= Number(other.dataset.rentalDuration || 0)));
  });
  if (calcDiscountEl) {
    if (!draft.quote.days) calcDiscountEl.textContent = 'Укажите корректные даты';
    else if (discount) calcDiscountEl.textContent = `Ваша скидка: ${discount}%${discountParts.length ? ` (${discountParts.join(' + ')})` : ''}${discount === 40 && tariffDiscount + benefitDiscount + promoDiscount > 40 ? ' · максимум 40%' : ''}`;
    else calcDiscountEl.textContent = 'Без скидки';
  }
  if (calcBreakdownEl) {
    const perDay = draft.quote.days ? Math.round(total / draft.quote.days) : 0;
    const saving = Math.max(0, regularTotal - total);
    calcBreakdownEl.textContent = draft.quote.days
      ? `≈ ${perDay.toLocaleString('ru-RU')} сом в день${saving ? ` · экономия ${saving.toLocaleString('ru-RU')} сом` : ''}`
      : '';
  }
  const promoGroup = document.getElementById('order-promo-group');
  if (promoGroup) promoGroup.hidden = selectedItems.length > 1;
  if (selectedItems.length > 1 && userPromoInput) userPromoInput.value = '';

  if (forcedMessage) {
    showRentalMessage(forcedMessage.text, forcedMessage.isError ? 'error' : 'ok');
  } else if (draft.validationError || draft.availabilityError || groupAvailabilityError) {
    showRentalMessage(draft.validationError || draft.availabilityError || groupAvailabilityError, 'error');
  } else if (availabilityLoaded) {
    showRentalMessage(selectedItems.length > 1 ? 'Все выбранные ноутбуки свободны на эти даты.' : 'На выбранные даты ноутбук свободен.', 'ok');
  } else {
    showRentalMessage('Занятость подтвердится при сохранении заявки.', 'neutral');
  }

  if (submitBtn && !submitInFlight) {
    submitBtn.disabled = Boolean(draft.validationError || draft.availabilityError || groupAvailabilityError);
  }
  renderBookingAlternatives(draft);
}

function syncEndDateFromDuration(rawDays) {
  const today = todayIso();
  const startDate = rentalStartInput?.value && rentalStartInput.value >= today
    ? rentalStartInput.value
    : today;
  if (rentalStartInput) rentalStartInput.value = startDate;
  const days = Math.min(365, Math.max(2, parseInt(rawDays, 10) || 2));
  if (rentalEndInput) rentalEndInput.value = addDays(startDate, days);
  if (manualDurationInput) manualDurationInput.value = String(days);
  updateCalculator();
}

function syncEndDateFromSlider() {
  syncEndDateFromDuration(daysSlider?.value);
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
  syncCatalogShowcaseLayout();
  const mascotStops = ['.hero h1', '#catalog .section-title', '#archa-point h2', '#b2b h2', '#faq .section-title'];
  let mascotFrame;
  let mascotMoveTimer;
  let mascotDrag;
  let mascotDidDrag = false;
  let mascotTapHandled = false;
  let mascotMoodTimer;
  let mascotWalkTimer;
  let mascotBeforeOrder;
  const mascotStorageKey = () => window.matchMedia('(max-width: 760px)').matches
    ? 'rentop_mascot_position_v2_mobile'
    : 'rentop_mascot_position_v2_desktop';
  const mascotMoodClasses = ['is-looking', 'is-waving', 'is-thinking', 'is-happy'];
  const mascotAnswer = document.getElementById('rentop-mascot-answer');
  const mascotWhatsapp = document.getElementById('rentop-mascot-whatsapp');
  const mascotStage = document.getElementById('rentop-mascot-stage');
  const mascotViews = [...document.querySelectorAll('[data-mascot-view]')];
  const mascotTaskLabels = { study: 'учёбы', office: 'офисной работы', exam: 'онлайн-экзамена', gaming: 'игр, монтажа или 3D' };

  const setMascotOpen = (open) => {
    if (!rentopMascot || !rentopMascotButton || !rentopMascotPanel) return;
    rentopMascot.classList.toggle('is-open', open);
    rentopMascotPanel.hidden = !open;
    rentopMascotButton.setAttribute('aria-expanded', String(open));
  };

  const setMascotView = (view) => {
    mascotViews.forEach((menu) => { menu.hidden = menu.dataset.mascotView !== view; });
  };

  const mascotStageText = () => {
    if (modal?.classList.contains('active')) {
      if (!rentalStartInput?.value) return 'Оформление: выберите дату начала аренды.';
      if (!rentalEndInput?.value) return 'Оформление: выберите дату возврата. Этот день не входит в оплачиваемый срок.';
      const delivery = deliveryTypeInput?.value === 'arca_locker'
        ? 'Оформление: выбрано получение через ARCHA POINT. Далее укажите удобную точку в личном кабинете.'
        : 'Оформление: выбрана доставка Rentop. Указанное время — ориентир, точный интервал подтвердит менеджер.';
      return `${delivery} Проверьте срок и контактные данные перед продолжением.`;
    }
    if (catalogBrowser && !catalogBrowser.hidden) return 'Каталог: выберите модель, затем нажмите «Забронировать» и укажите даты.';
    return 'Начало пути: выберите задачу, а Топик покажет подходящие модели.';
  };

  const refreshMascotStage = () => {
    const text = mascotStageText();
    if (mascotStage) mascotStage.textContent = text;
    return text;
  };

  const showMascotLaptopAdvice = (laptop) => {
    if (!laptop || !mascotAnswer) return;
    const tasks = getLaptopTasks(laptop);
    const title = String(laptop.title || 'Эта модель');
    let advice = 'Подойдёт для Word, Excel, браузера, документов и обычной работы.';
    if (tasks.includes('exam')) advice = 'Подготовлен для онлайн-экзаменов: TOEFL, IELTS, Duolingo, CSCA и видеосвязи.';
    else if (tasks.includes('gaming')) advice = 'Хороший выбор для игр, 3D, Blender, монтажа и других тяжёлых задач.';
    else if (tasks.includes('creative')) advice = 'Подойдёт для монтажа, графики, дизайна и творческих проектов.';
    else if (tasks.includes('code')) advice = 'Подходит для программирования, браузера, рабочих программ и многозадачности.';
    else if (tasks.includes('budget')) advice = 'Бюджетный вариант для документов, Word, Excel, учёбы и интернета.';
    mascotAnswer.textContent = `${title}: ${advice}`;
    setMascotView('home');
    setMascotOpen(true);
    setMascotMood('happy', 1600);
  };

  const setMascotWhatsapp = (text) => {
    if (mascotWhatsapp) mascotWhatsapp.href = `https://wa.me/996707880857?text=${encodeURIComponent(text)}`;
  };
  const selectMascotTask = (task) => {
    const label = mascotTaskLabels[task] || 'вашей задачи';
    activeCategoryFilter = 'rent';
    activeUseFilter = task;
    savedOnly = false;
    categoryFilterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === 'rent'));
    useFilterButtons.forEach((button) => button.classList.toggle('active', button.dataset.use === task));
    filterAndSearch();
    setMascotWhatsapp(`Здравствуйте! Топик помог подобрать ноутбук для ${label}. Хочу уточнить подходящую модель.`);
    if (mascotAnswer) mascotAnswer.textContent = `Показываю модели для ${label}. В каталоге можно сравнить характеристики и выбрать удобные даты.`;
    setMascotMood('happy', 1600);
    setMascotOpen(false);
    setCatalogBrowser(true);
  };
  const guideMascotNextStep = () => {
    if (modal?.classList.contains('active')) {
      const nextField = !rentalStartInput?.value ? rentalStartInput : !rentalEndInput?.value ? rentalEndInput : !deliveryTypeInput?.value ? deliveryChoiceButtons[0] : null;
      if (nextField) {
        if (mascotAnswer) mascotAnswer.textContent = !rentalStartInput?.value ? 'Следующий шаг — выберите дату начала аренды.' : !rentalEndInput?.value ? 'Теперь выберите дату возврата: этот день не входит в оплачиваемый срок.' : 'Выберите удобный способ получения ноутбука.';
        nextField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => nextField.focus?.(), 360);
      } else if (mascotAnswer) mascotAnswer.textContent = 'Проверьте срок, способ получения и контактные данные — затем можно продолжить оформление.';
      setMascotMood('thinking', 1500);
      return;
    }
    if (catalogBrowser && !catalogBrowser.hidden) {
      if (mascotAnswer) mascotAnswer.textContent = 'Выберите подходящую модель, затем нажмите «Забронировать» и укажите даты.';
      return;
    }
    if (mascotAnswer) mascotAnswer.textContent = 'Начнём с задачи: выберите учёбу, офис, экзамен или игры — я открою подходящие модели.';
    setMascotView('tasks');
    setMascotOpen(true);
  };

  rentopMascotButton?.addEventListener('click', (event) => {
    // Pointer/touch taps are handled on pointerup below. Leave this path for
    // keyboard activation, where no pointer event exists.
    if (mascotTapHandled) {
      mascotTapHandled = false;
      event.preventDefault();
      return;
    }
    if (mascotDidDrag) {
      event.preventDefault();
      mascotDidDrag = false;
      return;
    }
    setMascotMood('happy', 1050);
    const opening = !rentopMascot.classList.contains('is-open');
    if (opening) { refreshMascotStage(); setMascotView('home'); }
    setMascotOpen(opening);
  });
  rentopMascotClose?.addEventListener('click', () => setMascotOpen(false));
  const mascotHiddenStorageKey = 'rentop_mascot_hidden_v1';
  const setMascotHidden = (hidden) => {
    rentopMascot?.toggleAttribute('hidden', hidden);
    if (rentopMascotRestore) rentopMascotRestore.hidden = !hidden;
    localStorage.setItem(mascotHiddenStorageKey, hidden ? '1' : '0');
  };
  if (localStorage.getItem(mascotHiddenStorageKey) === '1') setMascotHidden(true);
  rentopMascotHide?.addEventListener('click', () => setMascotHidden(true));
  rentopMascotRestore?.addEventListener('click', () => {
    setMascotHidden(false);
    refreshMascotStage();
    setMascotView('home');
    setMascotOpen(true);
  });
  rentopMascotPanel?.querySelectorAll('[data-mascot-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.mascotNav || 'home';
      if (view === 'stage') refreshMascotStage();
      setMascotView(view);
    });
  });
  rentopMascotPanel?.querySelectorAll('[data-mascot-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.mascotAction;
      if (action === 'next') { guideMascotNextStep(); return; }
      setMascotOpen(false);
      document.querySelector('#faq')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  rentopMascotPanel?.querySelectorAll('[data-mascot-task]').forEach((button) => {
    button.addEventListener('click', () => selectMascotTask(button.dataset.mascotTask || 'all'));
  });
  catalogGrid?.addEventListener('click', (event) => {
    if (event.target.closest('button, a, .card-img')) return;
    const card = event.target.closest('.card');
    const laptopId = Number(card?.querySelector('[data-id]')?.dataset.id);
    const laptop = laptops.find((item) => Number(item.id) === laptopId);
    showMascotLaptopAdvice(laptop);
  });

  const mascotSize = () => window.matchMedia('(max-width: 760px)').matches
    ? { width: 84, height: 84, inset: 8 }
    : { width: 132, height: 132, inset: 18 };

  const setMascotMood = (mood, duration = 1800) => {
    if (!rentopMascot) return;
    rentopMascot.classList.remove(...mascotMoodClasses);
    if (mood) rentopMascot.classList.add(`is-${mood}`);
    window.clearTimeout(mascotMoodTimer);
    if (mood && duration) mascotMoodTimer = window.setTimeout(() => rentopMascot?.classList.remove(`is-${mood}`), duration);
  };

  const setMascotPosition = (x, y, persist = false) => {
    if (!rentopMascot) return;
    const { width, height, inset } = mascotSize();
    const left = Math.max(inset, Math.min(window.innerWidth - width - inset, x));
    const top = Math.max(74, Math.min(window.innerHeight - height - inset, y));
    rentopMascot.style.setProperty('--mascot-x', `${Math.round(left)}px`);
    rentopMascot.style.setProperty('--mascot-y', `${Math.round(top)}px`);
    rentopMascot.classList.toggle('is-panel-left', left > window.innerWidth - 350);
    if (persist) {
      rentopMascot.classList.add('is-pinned');
      localStorage.setItem(mascotStorageKey(), JSON.stringify({ x: left, y: top }));
    }
  };

  try {
    const savedMascotPosition = JSON.parse(localStorage.getItem(mascotStorageKey()) || 'null');
    if (savedMascotPosition && Number.isFinite(savedMascotPosition.x) && Number.isFinite(savedMascotPosition.y)) {
      setMascotPosition(savedMascotPosition.x, savedMascotPosition.y, true);
    }
  } catch {
    localStorage.removeItem(mascotStorageKey());
  }

  const beginMascotDrag = ({ pointerId, startX, startY, input }) => {
    if (!rentopMascot) return;
    const rect = rentopMascot.getBoundingClientRect();
    mascotDrag = { pointerId, startX, startY, left: rect.left, top: rect.top, input };
    mascotDidDrag = false;
    rentopMascot.classList.add('is-walking');
  };

  const moveMascotDrag = (clientX, clientY) => {
    if (!mascotDrag || !rentopMascot) return;
    const dx = clientX - mascotDrag.startX;
    const dy = clientY - mascotDrag.startY;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    mascotDidDrag = true;
    setMascotOpen(false);
    rentopMascot.classList.toggle('is-facing-left', dx < 0);
    setMascotPosition(mascotDrag.left + dx, mascotDrag.top + dy, true);
  };

  // One Pointer Events flow for touch, pen and mouse. The previous mixed
  // pointer + mousedown implementation could suppress a normal tap on mobile.
  // Window listeners remain as a safe fallback when the finger leaves the icon.
  rentopMascotButton?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !rentopMascot) return;
    // Safari may otherwise hand a vertical finger movement back to page
    // scrolling before the button receives its first pointermove.
    event.preventDefault();
    beginMascotDrag({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, input: 'pointer' });
    try {
      rentopMascot.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers reject capture during a fast tap. Window events
      // below still complete both the tap and the drag safely.
    }
  });

  const onMascotPointerMove = (event) => {
    if (!mascotDrag || mascotDrag.input !== 'pointer' || mascotDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    moveMascotDrag(event.clientX, event.clientY);
  };
  rentopMascotButton?.addEventListener('pointermove', onMascotPointerMove);
  window.addEventListener('pointermove', onMascotPointerMove, { passive: false });

  const endMascotDrag = (event) => {
    if (!mascotDrag || (mascotDrag.input === 'pointer' && mascotDrag.pointerId !== event.pointerId)) return;
    const didDrag = mascotDidDrag;
    if (mascotDrag.input === 'pointer' && rentopMascot?.hasPointerCapture(mascotDrag.pointerId)) {
      rentopMascot.releasePointerCapture(mascotDrag.pointerId);
    }
    mascotDrag = undefined;
    window.clearTimeout(mascotWalkTimer);
    mascotWalkTimer = window.setTimeout(() => rentopMascot?.classList.remove('is-walking'), 260);
    if (!didDrag && event.type === 'pointerup') {
      mascotTapHandled = true;
      setMascotMood('happy', 1050);
      const opening = !rentopMascot?.classList.contains('is-open');
      if (opening) { refreshMascotStage(); setMascotView('home'); }
      setMascotOpen(opening);
    }
  };

  rentopMascotButton?.addEventListener('pointerup', endMascotDrag);
  rentopMascotButton?.addEventListener('pointercancel', endMascotDrag);
  window.addEventListener('pointerup', endMascotDrag);
  window.addEventListener('pointercancel', endMascotDrag);
  rentopMascotButton?.addEventListener('dblclick', () => {
    localStorage.removeItem(mascotStorageKey());
    rentopMascot?.classList.remove('is-pinned');
    scheduleMascotPosition();
  });

  window.setInterval(() => {
    const moods = ['looking', 'looking', 'thinking', 'waving'];
    setMascotMood(moods[Math.floor(Math.random() * moods.length)]);
  }, 4600);

  rentopMascotButton?.addEventListener('mouseenter', () => setMascotMood('waving', 1100));

  const updateMascotPosition = () => {
    mascotFrame = undefined;
    if (!rentopMascot) return;
    if (rentopMascot.classList.contains('is-pinned')) {
      rentopMascot.classList.add('is-ready');
      return;
    }

    const stops = mascotStops
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);
    if (!stops.length) return;

    const guideLine = window.innerHeight * 0.34;
    const stop = stops.reduce((closest, candidate) => {
      const closestDistance = Math.abs(closest.getBoundingClientRect().top - guideLine);
      const candidateDistance = Math.abs(candidate.getBoundingClientRect().top - guideLine);
      return candidateDistance < closestDistance ? candidate : closest;
    });
    const rect = stop.getBoundingClientRect();
    const compact = window.matchMedia('(max-width: 760px)').matches;
    if (compact) {
      // На телефоне помощник не закрывает заголовок и остаётся доступным над нижними кнопками.
      const { width, height } = mascotSize();
      setMascotPosition(window.innerWidth - width - 12, window.innerHeight - height - 104);
    } else {
      setMascotPosition(rect.left - 24, rect.top - 135);
    }
    rentopMascot.classList.add('is-ready', 'is-moving');
    window.clearTimeout(mascotMoveTimer);
    mascotMoveTimer = window.setTimeout(() => rentopMascot.classList.remove('is-moving'), 620);
  };

  const scheduleMascotPosition = () => {
    if (mascotFrame) return;
    mascotFrame = window.requestAnimationFrame(updateMascotPosition);
  };

  window.addEventListener('scroll', scheduleMascotPosition, { passive: true });
  window.addEventListener('resize', scheduleMascotPosition);
  scheduleMascotPosition();

  if (modal) {
    new MutationObserver(() => {
      const orderOpen = modal.classList.contains('active');
      if (orderOpen && !mascotBeforeOrder && rentopMascot) {
        mascotBeforeOrder = {
          x: rentopMascot.style.getPropertyValue('--mascot-x'),
          y: rentopMascot.style.getPropertyValue('--mascot-y'),
          pinned: rentopMascot.classList.contains('is-pinned')
        };
        const { width, height } = mascotSize();
        const compact = window.matchMedia('(max-width: 760px)').matches;
        // На телефоне не перекрываем дату и поля в форме: помощник остаётся у нижнего края.
        setMascotPosition(
          compact ? window.innerWidth - width - 12 : window.innerWidth - width - 18,
          compact ? window.innerHeight - height - 104 : 86
        );
        rentopMascot.classList.add('is-order-help');
        setMascotMood('thinking', 2800);
      }
      if (!orderOpen && mascotBeforeOrder && rentopMascot) {
        rentopMascot.style.setProperty('--mascot-x', mascotBeforeOrder.x);
        rentopMascot.style.setProperty('--mascot-y', mascotBeforeOrder.y);
        rentopMascot.classList.toggle('is-pinned', mascotBeforeOrder.pinned);
        rentopMascot.classList.remove('is-order-help');
        mascotBeforeOrder = undefined;
        scheduleMascotPosition();
      }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  loadSavedLaptops();
  // The storefront renders only real catalog records. Until Supabase responds,
  // the static loading state stays visible instead of substituting demo items.
  laptops = await fetchLaptops();
  filteredLaptops = [...laptops];
  catalogReady = true;
  renderComparison();
  filterAndSearch();

  // Availability is used by the full catalog and booking flow. It must not
  // rebuild the homepage showcase after its images have already rendered.
  const availability = await fetchBlockingRentals();
  blockingRentals = availability.rows;
  availabilityLoaded = availability.ok;
  await getCabinetSession();
  updateOrderAuthUi();
  prepaymentReplacementContext = readPrepaymentReplacementContext();
  if (isPrepaymentReplacementMode()) {
    const order = cabinetSession?.orders?.find(item => String(item.id) === String(prepaymentReplacementContext.orderId));
    const paymentStarted = ['awaiting_payment', 'paid', 'confirmed'].includes(String(order?.payment?.status || ''));
    if (!cabinetSession || !order || !['draft', 'pending_review'].includes(String(order.status || '')) || paymentStarted) {
      clearPrepaymentReplacementContext();
      window.location.replace('/account');
      return;
    }
    activeCategoryFilter = 'rent';
    activeUseFilter = 'all';
    savedOnly = false;
    categoryFilterButtons.forEach(button => button.classList.toggle('active', button.dataset.filter === 'rent'));
    useFilterButtons.forEach(button => button.classList.toggle('active', button.dataset.use === 'all'));
    renderPrepaymentReplacementCatalogUi();
    filterAndSearch();
    openCatalogWithLoading();
  }
  const linkedLaptopId = new URLSearchParams(window.location.search).get('model');
  if (linkedLaptopId && laptops.some(laptop => String(laptop.id) === String(linkedLaptopId))) {
    // A shared link is for viewing and comparing a model. Opening a booking
    // form immediately felt like an accidental purchase on mobile.
    openCatalogForLaptop(Number(linkedLaptopId));
  }
  const returnToBooking = new URLSearchParams(window.location.search).get('resume_booking') === '1';
  if (returnToBooking && cabinetSession) {
    try {
      const saved = readPendingBooking();
      if (saved?.laptopId) {
        bookingLaptopIds = new Set((Array.isArray(saved.laptopIds) ? saved.laptopIds : [saved.laptopId])
          .map(Number)
          .filter((id) => laptops.some((laptop) => laptop.id === id)));
        openOrderModal(Number(saved.laptopId), { deliveryType: saved.deliveryType });
        if (rentalStartInput && saved.startDate) rentalStartInput.value = saved.startDate;
        if (rentalEndInput && saved.endDate) rentalEndInput.value = saved.endDate;
        updateDeliveryNote();
        updateCalculator();
      }
    } catch {
      clearPendingBooking();
    }
    window.history.replaceState({}, '', window.location.pathname);
  }

  catalogPagePrev?.addEventListener('click', () => changeCatalogPage(-1));
  catalogPageNext?.addEventListener('click', () => changeCatalogPage(1));
  catalogShowcasePrev?.addEventListener('click', () => changeCatalogPage(-1));
  catalogShowcaseNext?.addEventListener('click', () => changeCatalogPage(1));
  openFullCatalog?.addEventListener('click', () => openCatalogWithLoading());
  // Preview cards are rendered repeatedly after every filter change. Delegation
  // keeps the “Подробнее” action reliable for every current and future card.
  catalogPreviewGrid?.addEventListener('click', (event) => {
    const previewCard = event.target.closest('[data-open-full]');
    if (!previewCard) return;
    event.preventDefault();
    openCatalogForLaptop(previewCard.dataset.laptopId);
  });
  catalogPreviewGrid?.addEventListener('keydown', (event) => {
    const previewCard = event.target.closest('[data-open-full]');
    if ((event.key === 'Enter' || event.key === ' ') && previewCard) {
      event.preventDefault();
      openCatalogForLaptop(previewCard.dataset.laptopId);
    }
  });
  closeFullCatalog?.addEventListener('click', () => { if (!exitPrepaymentReplacementCatalog()) setCatalogBrowser(false); });
  closeFullCatalogBottom?.addEventListener('click', () => { if (!exitPrepaymentReplacementCatalog()) setCatalogBrowser(false); });
  savedOnlyButton?.addEventListener('click', () => {
    savedOnly = !savedOnly;
    filterAndSearch();
  });
  comparisonStatus?.addEventListener('click', () => {
    if (comparisonLaptopIds.size) comparisonPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  catalogBrowser?.addEventListener('click', (event) => {
    if (event.target.closest('[data-cancel-prepayment-replacement]')) { exitPrepaymentReplacementCatalog(); return; }
    if (event.target === catalogBrowser) { if (!exitPrepaymentReplacementCatalog()) setCatalogBrowser(false); }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !catalogBrowser?.hidden) { if (!exitPrepaymentReplacementCatalog()) setCatalogBrowser(false); }
  });
  window.addEventListener('resize', () => {
    syncCatalogShowcaseLayout();
    const pageCount = catalogPageCount();
    if (currentPage > pageCount) currentPage = pageCount;
    updateCatalogView(false);
  }, { passive:true });
  window.visualViewport?.addEventListener('resize', syncCatalogShowcaseLayout, { passive:true });

  // Фильтры
  categoryFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter || 'all';
      categoryFilterButtons.forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
      activeCategoryFilter = filter;
      filterAndSearch();
    });
  });

  useFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const use = btn.dataset.use || 'all';
      useFilterButtons.forEach(b => b.classList.toggle('active', b.dataset.use === use));
      activeUseFilter = use;
      filterAndSearch();
    });
  });

  comparisonClear?.addEventListener('click', () => {
    comparisonLaptopIds.clear();
    renderComparison();
    updateCatalogView(false);
  });
  comparisonDock?.addEventListener('click', () => {
    comparisonPanel?.scrollIntoView({ behavior:'smooth', block:'start' });
  });

  // Калькулятор и даты аренды
  daysSlider?.addEventListener('input', syncEndDateFromSlider);
  rentalDurationButtons.forEach((button) => button.addEventListener('click', () => {
    if (daysSlider) daysSlider.value = button.dataset.rentalDuration || '2';
    syncEndDateFromSlider();
  }));
  applyManualDurationButton?.addEventListener('click', () => syncEndDateFromDuration(manualDurationInput?.value));
  manualDurationInput?.addEventListener('change', () => syncEndDateFromDuration(manualDurationInput.value));
  manualDurationInput?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    syncEndDateFromDuration(manualDurationInput.value);
  });
  rentalStartInput?.addEventListener('input', () => { updateCalculator(); refreshMascotStage(); });
  rentalStartInput?.addEventListener('change', () => { updateCalculator(); refreshMascotStage(); });
  rentalEndInput?.addEventListener('input', () => { updateCalculator(); refreshMascotStage(); });
  rentalEndInput?.addEventListener('change', () => { updateCalculator(); refreshMascotStage(); });
  userPromoInput?.addEventListener('input', () => updateCalculator());
  deliveryChoiceButtons.forEach((button) => button.addEventListener('click', () => {
    if (deliveryTypeInput) deliveryTypeInput.value = button.dataset.deliveryOption || 'delivery';
    updateDeliveryNote();
    refreshMascotStage();
  }));
  updateDeliveryNote();

  // Закрытие модалки заказа
  closeModalBtn?.addEventListener('click', closeModal);

  function closeModal() {
    modal?.classList.remove('active');
    setOrderModalScrollLock(false);
    resetOrderSubmit();
    if (clearSharedModelFromUrl()) document.getElementById('catalog')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  // Safari can restore the page from its back/forward cache after a customer
  // leaves an unregistered deep link for the SMS screen. That snapshot used to
  // retain the `model` URL but an empty catalogue. Return to a normal catalogue
  // instead: close the old form, clear the direct-booking trigger and rehydrate
  // the live list before the customer chooses another model.
  window.addEventListener('pageshow', async (event) => {
    if (!event.persisted || !new URLSearchParams(window.location.search).has('model')) return;
    closeModal();
    if (catalogPreviewGrid) catalogPreviewGrid.innerHTML = '<p class="catalog-loading" role="status"><span aria-hidden="true"></span>Возвращаем каталог…</p>';
    try {
      const freshLaptops = await fetchLaptops();
      if (freshLaptops.length) {
        laptops = freshLaptops;
        filteredLaptops = [...freshLaptops];
        catalogReady = true;
        filterAndSearch();
      } else {
        renderCatalogPreview([]);
      }
    } catch {
      renderCatalogPreview([]);
    }
    document.getElementById('catalog')?.scrollIntoView({ behavior:'auto', block:'start' });
  });

  // FAQ Accordion
  document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
      const item = question.parentElement;
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // Lightbox
  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  function closeLightbox() {
    lightbox.classList.remove('active');
    // Фото может открываться поверх полного каталога. В таком случае
    // закрываем только изображение и не «выбрасываем» человека из каталога.
    document.body.style.overflow = catalogBrowser && !catalogBrowser.hidden ? 'hidden' : '';
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

  // Отправка заявки: для аренды сначала запись в Supabase, затем уведомление.
  // This listener uses the current modal state, so it must be bound once only.
  if (orderForm && orderForm.dataset.bookingBound !== '1') {
    orderForm.dataset.bookingBound = '1';
    orderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentLaptop || submitInFlight) return;

    let name = document.getElementById('user-name')?.value.trim() || '';
    const phone = document.getElementById('user-phone')?.value.trim() || '';
    const promo = document.getElementById('user-promo')?.value.trim() || '';
    const isRent = currentLaptop.category === 'rent';
    const clean = (str) => str.replace(/[_*`\[\]()]/g, '');
    let rental = null;

    if (isRent) {
      if (!cabinetSession) {
        await getCabinetSession();
        updateOrderAuthUi();
      }
      if (!cabinetSession) {
        redirectToCabinet();
        return;
      }
      const profileName = String(cabinetSession.profile?.full_name || '').trim();
      if (profileName.split(/\s+/).filter(Boolean).length < 3) {
        // New customers complete their profile in the cabinet before an order
        // exists. This binds the order to the verified phone in one flow.
        redirectToCabinet();
        return;
      }
      name = profileName;
      clampRentalDates();
      const draft = currentRentalDraft();
      if (draft.validationError || draft.availabilityError) {
        updateCalculator();
        return;
      }
      const selectedDelivery = deliveryTypeInput?.value;
      const deliveryType = selectedDelivery === 'arca_locker' ? 'arca_locker' : 'delivery';
      submitInFlight = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Сохраняем заявку...';
      }

      const freshAvailability = await fetchBlockingRentals();
      if (freshAvailability.ok) {
        blockingRentals = freshAvailability.rows;
        availabilityLoaded = true;
        if (laptops.filter(item => bookingLaptopIds.has(item.id)).some(item => hasDateConflict(blockingRentals, item.id, draft.startDate, draft.endDate))) {
          updateCatalogView(false);
          submitInFlight = false;
          if (submitBtn) submitBtn.textContent = 'Продолжить оформление';
          updateCalculator();
          return;
        }
      }

      try {
        const backendUrl = RENTOP_BACKEND_URL || window.location.origin;
        const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/bookings`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            laptopId: currentLaptop.id,
            laptopIds:[...bookingLaptopIds],
            businessOrder: bookingLaptopIds.size > 3,
            customerName: name,
            customerPhone: cabinetSession.phone,
            startDate: draft.startDate,
            endDate: draft.endDate,
            deliveryType,
            lockerAddress: '',
            promoCode: promo
          })
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 401 && result.code === 'AUTH_REQUIRED') {
          cabinetSession = null;
          redirectToCabinet();
          return;
        }
        if (!response.ok || !result.accountUrl) throw new Error(result.error || 'Не удалось создать заявку.');
        clearPendingBooking();
        window.location.assign(`${result.accountUrl}${result.accountUrl.includes('?') ? '&' : '?'}open=documents`);
        return;
      } catch (error) {
        submitInFlight = false;
        if (submitBtn) submitBtn.textContent = 'Продолжить оформление';
        updateCalculator({ text: rentalErrorText(error), isError: true });
        return;
      }
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
  }

  // Маска телефона
  const phoneInput = document.getElementById('user-phone');
  if (phoneInput) {
    const updatePhoneMask = () => {
      let digits = phoneInput.value.replace(/\D/g, '');
      if (digits.startsWith('996')) digits = digits.slice(3);
      if (digits.startsWith('0')) digits = digits.slice(1);
      digits = digits.slice(0, 9);
      const first = digits.slice(0, 3); const second = digits.slice(3, 5); const third = digits.slice(5, 7); const fourth = digits.slice(7, 9);
      phoneInput.value = `+996${first ? ` (${first}${second ? `) ${second}` : ''}${third ? `-${third}` : ''}${fourth ? `-${fourth}` : ''}` : ' '}`;
    };
    phoneInput.addEventListener('focus', updatePhoneMask);
    phoneInput.addEventListener('input', updatePhoneMask);
    phoneInput.addEventListener('keydown', (event) => {
      if (phoneInput.selectionStart <= 4 && ['Backspace', 'Delete'].includes(event.key)) event.preventDefault();
    });
    updatePhoneMask();
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

// B2B stays a guided request: the form captures the brief, while the manager
// confirms stock and a profitable quote before anything is promised.
const b2bForm = document.getElementById('b2b-form');
const openB2bForm = document.getElementById('open-b2b-form');
const b2bModal = document.getElementById('b2b-modal');
const closeB2bForm = document.getElementById('close-b2b-form');
const b2bFormStatus = document.getElementById('b2b-form-status');
const B2B_WHATSAPP_PHONE = '996707880857';
const b2bLabels = {
  termMonths:{ '1':'1 месяц', '3':'3 месяца', '6':'6 месяцев', '12':'12 месяцев и дольше' },
  deviceProfile:{ office:'офис и обучение', development:'разработка', design:'дизайн / монтаж', mixed:'разные задачи', other:'нужна консультация' },
  deliveryPreference:{ delivery:'доставка в офис', pickup:'самовывоз / выдача', undecided:'нужно обсудить' }
};
function b2bCountryCode(values) {
  const raw = values.phoneCountry === 'other' ? values.phoneCountryOther : (values.phoneCountry || '996');
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 3);
  return digits ? `+${digits}` : '';
}
function b2bFormattedPhone(values) {
  const local = String(values.phone || '').replace(/\D/g, '');
  const code = b2bCountryCode(values);
  return code && local ? `${code} ${local}` : (values.phone || '—');
}
function b2bWhatsappMessage(values) {
  return [
    'Здравствуйте! Отправляю копию корпоративной заявки Rentop.', '',
    `Компания: ${values.companyName || '—'}`,
    `Контакт: ${values.contactName || '—'}`,
    `Телефон: ${b2bFormattedPhone(values)}`,
    values.email ? `E-mail: ${values.email}` : '',
    `Количество устройств: ${values.quantity || '—'}`,
    `Срок: ${b2bLabels.termMonths[values.termMonths] || 'обсудить'}`,
    `Задачи: ${b2bLabels.deviceProfile[values.deviceProfile] || '—'}`,
    `Получение: ${b2bLabels.deliveryPreference[values.deliveryPreference] || '—'}`,
    values.comment ? `Комментарий: ${values.comment}` : ''
  ].filter(Boolean).join('\n');
}
const b2bCountrySelect = b2bForm?.elements.phoneCountry;
const b2bOtherCountryInput = b2bForm?.elements.phoneCountryOther;
function syncB2bCountryCode() {
  if (!b2bCountrySelect || !b2bOtherCountryInput) return;
  const isOther = b2bCountrySelect.value === 'other';
  b2bOtherCountryInput.hidden = !isOther;
  b2bOtherCountryInput.required = isOther;
  if (!isOther) b2bOtherCountryInput.value = '';
}
b2bCountrySelect?.addEventListener('change', syncB2bCountryCode);
syncB2bCountryCode();
openB2bForm?.addEventListener('click', () => {
  if (!b2bModal || !b2bForm) return;
  b2bModal.hidden = false;
  b2bModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('b2b-modal-open');
  // Focusing an input makes mobile Safari scroll the modal into the middle,
  // hiding the close button under its browser UI. Start every visit at top.
  const dialog = b2bModal.querySelector('.b2b-modal-dialog');
  b2bModal.scrollTop = 0;
  dialog?.scrollTo({ top:0, behavior:'auto' });
  requestAnimationFrame(() => {
    b2bModal.scrollTop = 0;
    dialog?.scrollTo({ top:0, behavior:'auto' });
  });
});
function closeB2bModal() {
  if (!b2bModal) return;
  b2bModal.hidden = true;
  b2bModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('b2b-modal-open');
  openB2bForm?.focus({ preventScroll:true });
}
closeB2bForm?.addEventListener('click', closeB2bModal);
b2bModal?.addEventListener('click', event => { if (event.target === b2bModal) closeB2bModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && b2bModal && !b2bModal.hidden) closeB2bModal(); });
b2bForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const button = b2bForm.querySelector('[type="submit"]');
  const values = Object.fromEntries(new FormData(b2bForm).entries());
  const phoneDigits = String(values.phone || '').replace(/\D/g, '');
  if (!b2bCountryCode(values) || phoneDigits.length < 5) {
    if (b2bFormStatus) { b2bFormStatus.textContent = 'Укажите код страны и номер WhatsApp.'; b2bFormStatus.className = 'b2b-form-status is-error'; }
    return;
  }
  if (b2bFormStatus) { b2bFormStatus.textContent = 'Отправляем запрос…'; b2bFormStatus.className = 'b2b-form-status'; }
  button.disabled = true;
  try {
    const response = await fetch('/api/b2b', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify(values) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось отправить заявку.');
    if (b2bFormStatus) { b2bFormStatus.textContent = 'Заявка принята. Открываем WhatsApp…'; b2bFormStatus.className = 'b2b-form-status is-success'; }
    window.location.assign(`https://wa.me/${B2B_WHATSAPP_PHONE}?text=${encodeURIComponent(b2bWhatsappMessage(values))}`);
  } catch (error) {
    if (b2bFormStatus) { b2bFormStatus.textContent = error.message; b2bFormStatus.className = 'b2b-form-status is-error'; }
  } finally { button.disabled = false; }
});
