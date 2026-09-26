export function createSupabaseApi(config) {
  async function request(path, options = {}) {
    const isLegacyJwtKey = config.supabaseServerKey.startsWith('eyJ');
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.supabaseServerKey,
        ...(isLegacyJwtKey ? { Authorization: `Bearer ${config.supabaseServerKey}` } : {}),
        'content-type': 'application/json',
        Prefer: 'return=representation',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase request failed (${response.status})`);
    return body;
  }

  async function getOne(path) {
    const rows = await request(path);
    return rows?.[0] || null;
  }

  return {
    getLaptop: (id) => getOne(`laptops?id=eq.${encodeURIComponent(id)}&select=*`),
    createOrder: (order) => request('rental_orders', { method: 'POST', body: JSON.stringify(order) }).then((rows) => rows?.[0] || null),
    getOrderByToken: (token) => getOne(`rental_orders?client_token=eq.${encodeURIComponent(token)}&select=*`),
    getOrder: (id) => getOne(`rental_orders?id=eq.${encodeURIComponent(id)}&select=*`),
    updateOrder: (id, patch) => request(`rental_orders?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch)
    }).then((rows) => rows?.[0] || null),
    getSession: (orderId) => getOne(`rental_order_bot_sessions?order_id=eq.${encodeURIComponent(orderId)}&select=*`),
    getSessionByUser: (userId) => getOne(`rental_order_bot_sessions?telegram_user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc`),
    saveSession: (session) => request('rental_order_bot_sessions?on_conflict=order_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(session)
    }).then((rows) => rows?.[0] || null),
    setAdminAction: (action) => request('rental_order_admin_actions?on_conflict=order_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(action)
    }).then((rows) => rows?.[0] || null),
    getAdminAction: (orderId) => getOne(`rental_order_admin_actions?order_id=eq.${encodeURIComponent(orderId)}&select=*`),
    clearAdminAction: (orderId) => request(`rental_order_admin_actions?order_id=eq.${encodeURIComponent(orderId)}`, { method: 'DELETE' }),
    listRecentOrders: (limit = 12, statuses = []) => {
      const allowedStatuses = Array.isArray(statuses) ? statuses.filter(Boolean) : [];
      const statusFilter = allowedStatuses.length ? `&status=in.(${allowedStatuses.map(encodeURIComponent).join(',')})` : '';
      return request(
        `rental_orders?select=id,laptop_id,customer_name,customer_phone,rental_start_date,rental_end_date,status,total_amount,deposit_amount,delivery_type,locker_address,created_at,updated_at&order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 12, 1), 30)}${statusFilter}`
      );
    },
    findOverlappingBlockingOrder: (orderId, laptopId, startDate, endDate) => request(
      `rental_orders?select=id,status,rental_start_date,rental_end_date&laptop_id=eq.${encodeURIComponent(laptopId)}` +
      `&id=neq.${encodeURIComponent(orderId)}&rental_start_date=lt.${encodeURIComponent(endDate)}` +
      `&rental_end_date=gt.${encodeURIComponent(startDate)}` +
      '&status=in.(confirmed,awaiting_payment,awaiting_pickup,issued,in_use)&limit=1'
    ).then((rows) => rows?.[0] || null),
    claimWebhookUpdate: (updateId) => request('telegram_webhook_updates?on_conflict=update_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ update_id: updateId })
    }).then((rows) => Boolean(rows?.length)),
    releaseWebhookUpdate: (updateId) => request(`telegram_webhook_updates?update_id=eq.${encodeURIComponent(updateId)}`, { method: 'DELETE' }),
    openSupportCase: (supportCase) => request('rental_order_support_cases?on_conflict=order_id,kind', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(supportCase)
    }).then((rows) => rows?.[0] || null),
    resolveSupportCase: (orderId, kind, resolvedBy) => request(
      `rental_order_support_cases?order_id=eq.${encodeURIComponent(orderId)}&kind=eq.${encodeURIComponent(kind)}`,
      { method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: String(resolvedBy) }) }
    ).then((rows) => rows?.[0] || null),
    listOpenSupportCases: (limit = 12) => request(
      `rental_order_support_cases?select=*&status=eq.open&order=opened_at.desc&limit=${Math.min(Math.max(Number(limit) || 12, 1), 30)}`
    ),
    getAdminActionByUser: (userId) => getOne(`rental_order_admin_actions?admin_user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`),
    createEvent: (event) => request('rental_order_events', {
      method: 'POST', body: JSON.stringify(event)
    }).then((rows) => rows?.[0] || null)
  };
}
