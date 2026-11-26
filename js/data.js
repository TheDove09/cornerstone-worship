// Picks the real online database (Supabase) or the offline demo.
import { CONFIG } from './config.js';

export const DEMO = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

export const api = DEMO
  ? (await import('./demo-backend.js')).createDemoApi()
  : (await import('./supabase-backend.js')).createSupabaseApi(CONFIG);
