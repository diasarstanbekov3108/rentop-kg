import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';
import { createTelegramApi } from '../server/src/telegram.js';

const clean = (value, max = 500) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
function phone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? `+996${digits}` : '';
}

function managerNotification(lead, fallback = false) {
  const profileLabel = { office:'офис и учёба', development:'разработка', design:'дизайн / монтаж', mixed:'разные задачи', other:'нужно обсудить' }[lead.deviceProfile];
  const deliveryLabel = { delivery:'доставка в офис', pickup:'самовывоз / выдача', undecided:'нужно обсудить' }[lead.deliveryPreference];
  return `${fallback ? '⚠️ ' : '🏢 '}Новая B2B-заявка${fallback ? ' (временно без записи в панель)' : ''}\n\nКомпания: ${lead.companyName}\nКонтакт: ${lead.contactName}\nТелефон: ${lead.contactPhone}${lead.email ? `\nE-mail: ${lead.email}` : ''}\nКоличество: ${lead.quantity} шт.\nСрок: ${lead.termMonths ? `${lead.termMonths} мес.` : 'обсудить'}\nЗадачи: ${profileLabel}\nПолучение: ${deliveryLabel}${lead.comment ? `\nКомментарий: ${lead.comment}` : ''}\n\n${fallback ? 'Свяжитесь с клиентом: форма передала заявку в WhatsApp. Как только база восстановится, новые заявки снова будут видны в панели.' : 'Откройте раздел B2B в панели Rentop и подготовьте персональное предложение.'}`;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'POST') return response.status(405).json({ error:'Method not allowed.' });
  let config;
  let leadPayload;
  try {
    config = loadConfig();
    const payload = request.body || {};
    // Invisible field: ordinary visitors never fill it, simple bots usually do.
    if (clean(payload.website, 100)) return response.status(200).json({ ok:true });
    const companyName = clean(payload.companyName, 160);
    const contactName = clean(payload.contactName, 160);
    const contactPhone = phone(payload.phone);
    const email = clean(payload.email, 160).toLowerCase();
    const quantity = Number(payload.quantity);
    const termMonths = payload.termMonths === '' || payload.termMonths === undefined ? null : Number(payload.termMonths);
    const deviceProfile = clean(payload.deviceProfile, 24);
    const deliveryPreference = clean(payload.deliveryPreference, 24);
    const comment = clean(payload.comment, 1500);
    if (companyName.length < 2 || contactName.length < 2 || !contactPhone) throw new Error('Укажите компанию, контактное лицо и номер Кыргызстана.');
    if (!Number.isInteger(quantity) || quantity < 3 || quantity > 500) throw new Error('Для корпоративной заявки укажите от 3 до 500 устройств.');
    if (termMonths !== null && ![1, 3, 6, 12].includes(termMonths)) throw new Error('Выберите срок: 1, 3, 6 или 12 месяцев.');
    if (!['office', 'development', 'design', 'mixed', 'other'].includes(deviceProfile)) throw new Error('Выберите задачи для техники.');
    if (!['delivery', 'pickup', 'undecided'].includes(deliveryPreference)) throw new Error('Выберите удобный способ получения.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Проверьте корпоративный e-mail.');
    leadPayload = {
      company_name:companyName, contact_name:contactName, phone:contactPhone, email:email || null,
      quantity, term_months:termMonths, device_profile:deviceProfile, delivery_preference:deliveryPreference,
      comment:comment || null
    };
    const database = createSupabaseApi(config);
    const lead = await database.createB2BLead(leadPayload);
    if (!lead) throw new Error('Не удалось сохранить корпоративную заявку.');
    const bot = createTelegramApi(config.telegramBotToken);
    await bot.sendMessage(config.adminChatId, managerNotification({
      companyName, contactName, contactPhone, email, quantity, termMonths, deviceProfile, deliveryPreference, comment
    })).catch(error => console.error('B2B Telegram notification failed:', error.message));
    return response.status(201).json({ ok:true, leadId:lead.id, message:'Заявка принята. Менеджер Rentop проверит наличие и подготовит персональное предложение.' });
  } catch (error) {
    console.error('B2B lead failed:', error.message);
    const technicalMessage = String(error?.message || '');
    const isSchemaRefreshing = /b2b_leads.*schema cache|schema cache.*b2b_leads/i.test(technicalMessage);
    if (isSchemaRefreshing && config && leadPayload) {
      await createTelegramApi(config.telegramBotToken).sendMessage(config.adminChatId, managerNotification({
        companyName:leadPayload.company_name, contactName:leadPayload.contact_name, contactPhone:leadPayload.phone,
        email:leadPayload.email, quantity:leadPayload.quantity, termMonths:leadPayload.term_months,
        deviceProfile:leadPayload.device_profile, deliveryPreference:leadPayload.delivery_preference, comment:leadPayload.comment
      }, true)).catch(notificationError => console.error('B2B fallback notification failed:', notificationError.message));
      return response.status(202).json({
        ok:true,
        deferred:true,
        message:'Заявка принята и передана менеджеру. Открываем WhatsApp…'
      });
    }
    return response.status(isSchemaRefreshing ? 503 : 400).json({
      error:isSchemaRefreshing
        ? 'Форма корпоративной аренды на короткое время обновляется. Попробуйте ещё раз через минуту или напишите нам в WhatsApp — менеджер примет заявку сразу.'
        : (technicalMessage || 'Не удалось отправить заявку. Попробуйте ещё раз или напишите нам в WhatsApp.')
    });
  }
}
