-- Выполняется после предыдущих миграций.
-- Разрешает только серверному ключу (service_role) вести заявки и бот-сессии.
-- anon/authenticated по-прежнему не получают доступ к персональным данным.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rental_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rental_order_bot_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rental_order_admin_actions TO service_role;

COMMIT;
