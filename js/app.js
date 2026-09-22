/* ===== الموقع العام: صفحة تحميل المتعامل فقط ===== */
(function () {
  const $ = (id) => document.getElementById(id);
  const t = (k, v) => I18N.t(k, v);

  function applyDir() {
    document.documentElement.lang = I18N.lang;
    document.documentElement.dir = I18N.lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('univ') + ' — ' + t('p_download_sub');
  }

  function neutralHeader() {
    return (
      '<div class="flex items-center justify-between mb-3">' +
      '<span class="text-[11px] font-bold bg-white/15 rounded-full px-3 py-1">' + t('office') + '</span>' +
      '<button id="p-lang-btn" type="button" class="text-[11px] font-bold bg-white/15 hover:bg-white/25 rounded-full px-3 py-1 transition">' +
      (I18N.lang === 'ar' ? '🇫🇷 Français' : '🇩🇿 العربية') + '</button>' +
      '</div>'
    );
  }

  function neutral(inner) {
    return (
      '<div>' +
      '<div class="bg-gradient-to-b from-primary-700 to-primary-900 text-white px-5 pt-4 pb-8 rounded-b-3xl shadow-md relative z-10">' +
      neutralHeader() +
      '<img src="img/logo.png" alt="" class="mx-auto h-16 w-16 object-contain mb-2 bg-white rounded-2xl p-1.5 shadow">' +
      '<h1 class="text-base font-black leading-snug">' + t('univ') + '</h1>' +
      '<p class="text-[11px] text-teal-100 mt-1 font-semibold">' + t('p_download_sub') + '</p>' +
      '</div>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-start -mt-4 relative z-20">' + inner + '</div>' +
      '</div>'
    );
  }

  function renderNeutralNoQR() {
    $('public-root').innerHTML = neutral(
      '<div class="text-center py-4">' +
      '<div class="text-5xl mb-3">📄</div>' +
      '<p class="text-sm text-slate-500 leading-relaxed">' + t('neutral_noqr') + '</p>' +
      '<p class="text-xs text-slate-400 mt-2 leading-relaxed">' + t('neutral_noqr_s') + '</p>' +
      '</div>'
    );
  }

  function renderNeutralNoDB() {
    $('public-root').innerHTML = neutral(
      '<div class="text-center py-4">' +
      '<div class="text-5xl mb-3">⚙️</div>' +
      '<p class="text-sm text-slate-500">' + t('neutral_nodb') + '</p>' +
      '</div>'
    );
  }

  // رمز قصير (?c=012026) → إيجاد الاستشارة من أرقام مرجعها في العرض العام
  function resolveByCode(code) {
    const root = $('public-root');
    root.innerHTML = neutral('<div class="text-center py-6"><div class="spinner my-4"></div></div>');
    DB.from('tenders_public')
      .select('id, reference, opening_date')
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          root.innerHTML = neutral(
            '<div class="text-center py-4"><div class="text-5xl mb-3">⚙️</div>' +
            '<p class="text-sm text-slate-500">' + t('neutral_nodb') + '</p></div>'
          );
          return;
        }
        const matches = (data || []).filter((r) => (r.reference || '').replace(/\D/g, '') === code);
        if (!matches.length) {
          window.DownloadPage.init('__invalid__');
          return;
        }
        matches.sort((a, b) => String(b.opening_date || '').localeCompare(String(a.opening_date || '')));
        window.DownloadPage.init(matches[0].id);
      });
  }

  function bindLangToggle() {
    $('public-root').addEventListener('click', (e) => {
      if (!e.target.closest('#p-lang-btn')) return;
      I18N.setLang(I18N.other());
      applyDir();
      if (window.DownloadPage && window.DownloadPage.view) {
        window.DownloadPage.onLangChange();
      } else {
        neutralRefresh();
      }
    });
  }

  let neutralMode = null;
  function neutralRefresh() {
    if (neutralMode === 'noqr') renderNeutralNoQR();
    else if (neutralMode === 'nodb') renderNeutralNoDB();
  }

  function boot() {
    I18N.init();
    applyDir();

    let db = null;
    try {
      db = initSupabase();
    } catch (e) {
      console.error(e);
    }

    if (!db) {
      neutralMode = 'nodb';
      renderNeutralNoDB();
      bindLangToggle();
      return;
    }

    bindLangToggle();

    const params = new URLSearchParams(location.search);
    const token = params.get('open');
    const code = params.get('c');

    if (token) {
      window.DownloadPage.init(token);
    } else if (code) {
      resolveByCode(code);
    } else {
      neutralMode = 'noqr';
      renderNeutralNoQR();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
