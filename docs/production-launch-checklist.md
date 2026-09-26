# Rentop KG — запуск рабочей среды

## Перед переключением на Production

1. В Supabase SQL Editor один раз выполнить новые миграции по порядку: `20260926120000_add_telegram_webhook_idempotency.sql`, `20260926130000_add_archa_handoff_audit.sql`, `20260926140000_add_rental_support_cases.sql`.
2. Убедиться, что ранее применены базовая миграция заказов и миграции ПЭП/документов.
3. В Vercel Production заполнить те же приватные переменные, что проверены в Preview: Telegram, Supabase, реквизиты банков, OTP/Nikita и URL оферты. Значения секретов не копировать в Git.
4. В `PUBLIC_APP_URL`, `OFFER_URL` и `MBANK_QR_IMAGE_URL` указать основной HTTPS-домен, а не случайный Preview-домен. QR: `https://<домен>/assets/brand/mbank-qr.jpg`.
5. В Vercel Production открыть `/api/health`: ожидается `{"ok":true,"database":"reachable"}`.
6. Настроить Telegram webhook на Production URL: `npm run telegram:webhook -- https://<домен>` из папки `server`.
7. Запустить `npm run telegram:manager-menu` из папки `server`, если создана новая рабочая Telegram-группа и обновлен её ID.

## После ответа Nikita KG

1. Подтвердить согласование Sender ID и снятие тестового ограничения API.
2. Указать согласованный Sender ID в `NIKITA_SMS_SENDER` в Vercel Production.
3. Сделать ровно один OTP-тест на разрешённый номер, затем проверить в группе аудит заявки.

## Первый рабочий сценарий

Пройти одну реальную заявку целиком: сайт → Telegram → документы → оферта/OTP → одобрение → залог → чек → выдача → продление или возврат.

Не публикуйте рабочий запуск, пока оферту и правила обработки персональных данных не проверит юрист Кыргызской Республики.
