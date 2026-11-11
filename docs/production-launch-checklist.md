# Rentop KG — запуск рабочей среды

## Перед переключением на Production

1. Убедиться, что применены **все** файлы из `supabase/migrations/` по имени (в хронологическом порядке). Для текущего сценария критичны также: `20261108090000_add_benefit_verification_and_replacement_requests.sql`, `20261108130000_add_safe_return_collection_workflow.sql`, `20261108150000_add_physical_replacement_exchange.sql`, `20261108170000_add_booking_delivery_preferences.sql`, `20261109130000_harden_replacement_availability.sql`, `20261109140000_allow_social_discount.sql`, `20261109150000_add_return_handoff_destination.sql`.
2. В Production не запускать одновременно старый polling-процесс `server/src/index.js` и Telegram webhook Vercel: рабочим источником обновлений должен быть только webhook `/api/telegram`, иначе один Telegram update может быть обработан дважды.
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
