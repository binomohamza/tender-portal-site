/* ===== الموقع العام: صفحة تحميل المتعامل فقط ===== */
(function () {
  const $ = (id) => document.getElementById(id);

  function neutral(inner) {
    return (
      '<div class="text-center">' +
      '<img src="img/logo.png" alt="" class="mx-auto h-16 w-16 object-contain mb-2">' +
      '<h1 class="text-lg font-black text-slate-800 leading-snug">جامعة عين تموشنت بلحاج بوشعيب</h1>' +
      '<p class="text-xs text-slate-400 mb-6">مكتب الصفقات — تحميل دفتر الشروط</p>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-right">' + inner + '</div>' +
      '</div>'
    );
  }

  // رمز قصير (?c=012026) → إيجاد الاستشارة من أرقام مرجعها في العرض العام
  function resolveByCode(code) {
    const root = $('public-root');
    root.innerHTML = neutral(
      '<div class="spinner my-8"></div><p class="text-sm text-slate-400 text-center">جارٍ التحقق...</p>'
    );
    DB.from('tenders_public')
      .select('id, reference, opening_date')
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          root.innerHTML = neutral(
            '<div class="text-center py-4"><div class="text-5xl mb-3">⚙️</div>' +
            '<p class="text-sm text-slate-500">تعذّر التحقق من الرمز — حاول مجددًا بعد قليل.</p></div>'
          );
          return;
        }
        const matches = (data || []).filter((r) => (r.reference || '').replace(/\D/g, '') === code);
        if (!matches.length) {
          root.innerHTML = neutral(
            '<div class="text-center py-4">' +
            '<div class="text-5xl mb-3">🚫</div>' +
            '<p class="text-sm text-slate-500 leading-relaxed">الاستشارة غير موجودة أو لم تُنشر بعد.</p>' +
            '<p class="text-xs text-slate-400 mt-2">تواصل مع مكتب الصفقات.</p>' +
            '</div>'
          );
          return;
        }
        // إن تكرّر المرجع: الأحدث موعدًا للفتح
        matches.sort((a, b) => String(b.opening_date || '').localeCompare(String(a.opening_date || '')));
        window.DownloadPage.init(matches[0].id);
      });
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
    const code = params.get('c');

    if (token) {
      window.DownloadPage.init(token);
    } else if (code) {
      resolveByCode(code);
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
