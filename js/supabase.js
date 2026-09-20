/* ===== تهيئة عميل Supabase ===== */
(function () {
  window.DB = null;

  window.isConfigured = function () {
    const c = window.TENDER_CONFIG || {};
    return Boolean(c.SUPABASE_URL && c.SUPABASE_ANON_KEY);
  };

  window.initSupabase = function () {
    if (window.DB) return window.DB;
    if (!window.isConfigured()) return null;
    if (typeof window.supabase === 'undefined') {
      throw new Error('فشل تحميل مكتبة supabase من CDN');
    }
    const c = window.TENDER_CONFIG;
    window.DB = window.supabase.createClient(c.SUPABASE_URL, c.SUPABASE_ANON_KEY);
    return window.DB;
  };
})();
