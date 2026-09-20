/* ===== الموقع العام: صفحة تحميل المتعامل فقط ===== */
(function () {
  const $ = (id) => document.getElementById(id);

  function neutral(inner) {
    return (
      '<div class="text-center">' +
      '<div class="text-4xl mb-3">🏛️</div>' +
      '<h1 class="text-lg font-black text-slate-800">بوابة مكتب الصفقات</h1>' +
      '<p class="text-xs text-slate-400 mb-6">تحميل دفتر الشروط</p>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-right">' + inner + '</div>' +
      '</div>'
    );
  }

  function boot() {
    let db = null;
    try {
      db = initSupabase();
    } catch (e) {
      console.error(e);
    }

    const root = $('public-root');
    if (!db) {
      root.innerHTML = neutral(
        '<div class="text-center py-4"><div class="text-5xl mb-3">⚙️</div>' +
        '<p class="text-sm text-slate-500">الخدمة غير متاحة حاليًا — تواصل مع مكتب الصفقات.</p></div>'
      );
      return;
    }

    const params = new URLSearchParams(location.search);
    const token = params.get('open');

    if (token) {
      window.DownloadPage.init(token);
    } else {
      // بدون رمز استشارة: صفحة محايدة (لا تكشف عن أي واجهة إدارية)
      root.innerHTML = neutral(
        '<div class="text-center py-4">' +
        '<div class="text-5xl mb-3">📄</div>' +
        '<p class="text-sm text-slate-500 leading-relaxed">هذه الصفحة مخصصة لتحميل دفاتر الشروط عبر رمز الاستشارة (QR).</p>' +
        '<p class="text-xs text-slate-400 mt-2">للحصول على رمز الاستشارة الخاص بك، توجه إلى مكتب الصفقات بعد سداد المستحقات.</p>' +
        '</div>'
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
