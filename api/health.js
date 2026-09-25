import { loadConfig } from '../server/src/config.js';
import { createSupabaseApi } from '../server/src/supabase.js';

export default async function handler(_request, response) {
  try {
    const database = createSupabaseApi(loadConfig());
    await database.listRecentOrders(1);
    return response.status(200).json({ ok: true, database: 'reachable' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    return response.status(503).json({ ok: false });
  }
}
