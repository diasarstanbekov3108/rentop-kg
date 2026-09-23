const BISHKEK_TIME_ZONE = 'Asia/Bishkek';

export function todayIso(now = new Date(), timeZone = BISHKEK_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startDate, endDate) {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const end = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.round((end - start) / 86400000);
}

export function discountPercentForDays(days) {
  if (days >= 15) return 30;
  if (days >= 4) return 15;
  return 0;
}

export function quoteRental(days, dailyRate) {
  const discountPercent = discountPercentForDays(days);
  const rate = Number(dailyRate) || 0;
  const total = Math.round((days * rate * (100 - discountPercent)) / 100);
  return {
    days,
    dailyRate: rate,
    discountPercent,
    total
  };
}

export function rangesOverlap(startDate, endDate, otherStart, otherEnd) {
  return startDate < otherEnd && endDate > otherStart;
}

export function isBlockingRental(order, now = new Date()) {
  if (!order) return false;
  if (order.status === 'confirmed' || order.status === 'issued') return true;
  if (order.status !== 'awaiting_payment' || !order.hold_expires_at) return false;
  return new Date(order.hold_expires_at).getTime() > now.getTime();
}

export function validateRentalPeriod(startDate, endDate, today) {
  if (!startDate || !endDate) {
    return 'Укажите дату начала и дату окончания аренды.';
  }
  if (startDate < today || endDate < today) {
    return 'Нельзя выбрать прошедшую дату.';
  }
  if (endDate < startDate) {
    return 'Дата окончания не может быть раньше даты начала.';
  }
  if (endDate === startDate || daysBetween(startDate, endDate) < 2) {
    return 'Минимальный срок аренды — 2 дня. День возврата не входит в срок аренды.';
  }
  return '';
}

export function hasDateConflict(orders, laptopId, startDate, endDate, now = new Date()) {
  return orders.some((order) => (
    String(order.laptop_id) === String(laptopId)
    && isBlockingRental(order, now)
    && rangesOverlap(startDate, endDate, order.rental_start_date, order.rental_end_date)
  ));
}

export function formatRuDate(isoDate, today = '') {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const sameYear = !today || today.slice(0, 4) === isoDate.slice(0, 4);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function contiguousFreeFrom(blocks, today) {
  let freeFrom = null;

  blocks.forEach((block) => {
    if (block.start <= today && today < block.end && (freeFrom === null || block.end > freeFrom)) {
      freeFrom = block.end;
    }
  });

  if (!freeFrom) return null;

  let extended = true;
  let guard = 0;
  while (extended && guard <= blocks.length) {
    extended = false;
    guard += 1;
    blocks.forEach((block) => {
      if (block.start <= freeFrom && block.end > freeFrom) {
        freeFrom = block.end;
        extended = true;
      }
    });
  }

  return freeFrom;
}

export function cardAvailability(orders, laptopId, today, now = new Date()) {
  const blocks = orders
    .filter((order) => String(order.laptop_id) === String(laptopId) && isBlockingRental(order, now))
    .map((order) => ({
      start: order.rental_start_date,
      end: order.rental_end_date,
      status: order.status
    }));

  const freeFrom = contiguousFreeFrom(blocks, today);
  if (!freeFrom) {
    return { state: 'available', label: 'Доступен сейчас', freeFrom: today };
  }

  const issuedInSpan = blocks.some((block) => (
    block.status === 'issued' && block.start < freeFrom && block.end > today
  ));

  if (issuedInSpan) {
    return {
      state: 'busy',
      label: `Занят до ${formatRuDate(freeFrom, today)}`,
      freeFrom
    };
  }

  return {
    state: 'soon',
    label: `Доступен с ${formatRuDate(freeFrom, today)}`,
    freeFrom
  };
}

export const ARCHA_LOCATIONS = [
  'Bishkek Park — Киевская улица, 148, этаж B2',
  'Гипермаркет «Азия» — ул. Максима Горького, 1/2а',
  'ТЦ DK — ул. Нуркамала Жетикашкаевой, 29',
  'ТРЦ Tommi Mall — ул. Аалы Токомбаева, 17/2',
  'Супермаркет «Азия» — ул. Садырбаева, 107'
];

export function deliveryLabel(deliveryType) {
  if (deliveryType === 'pickup') return 'Самовывоз';
  if (deliveryType === 'delivery') return 'Доставка';
  if (deliveryType === 'arca_locker') return 'ARCHA POINT — получение 24/7';
  return 'Не указан';
}

export function rentalErrorText(error) {
  const details = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  if (details.includes('LAPTOP_UNAVAILABLE')) {
    return 'Этот ноутбук уже занят на выбранные даты. Выберите другой период.';
  }
  if (details.includes('PAST_DATE')) {
    return 'Нельзя выбрать прошедшую дату.';
  }
  if (details.includes('INVALID_RENTAL_TERMS')) {
    return 'Не удалось рассчитать стоимость аренды. Обновите страницу и выберите даты ещё раз.';
  }
  return 'Не удалось сохранить заявку. Бронь не создана. Проверьте даты и попробуйте ещё раз.';
}
