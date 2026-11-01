-- Клиент самостоятельно подтверждает, что получил SMS-код возврата ARCHA POINT.
-- Этот промежуточный статус открывает загрузку видео возврата и не завершает аренду.

BEGIN;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_locker_status_allowed;

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_locker_status_allowed CHECK (
    locker_status IN (
      'none', 'pending', 'reservation_requested', 'reserved', 'loaded', 'access_sent',
      'client_picked_up', 'return_pending', 'return_reserved', 'return_access_sent',
      'return_access_received', 'returned', 'failed'
    )
  );

COMMIT;
