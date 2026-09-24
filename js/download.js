/* ===== صفحة المتعامل (?open=UUID أو ?c=رمز قصير) — تصميم رسمي أنيق ثنائي اللغة ===== */
(function () {
  const D = (window.DownloadPage = {});
  const t = (k, v) => I18N.t(k, v);
  const kindName = (k) => (k === 'tender' ? t('kind_tender_s') : t('kind_consultation_s'));

  let token = null;
  let tender = null;
  let signed = { url: '', expiresAt: 0, updated: false };
  let lastInfo = null;
  let expiryTimer = null;
  let openingCdTimer = null;
  let currentView = null;
  let lastErr = null;
  let lastErrRetry = false;
  let langBound = false;

  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value : '');
  const root = () => $('download-root') || $('public-root');

  function applyDir() {
    document.documentElement.lang = I18N.lang;
    document.documentElement.dir = I18N.lang === 'ar' ? 'rtl' : 'ltr';
  }

  function otherLabel() {
    return I18N.lang === 'ar' ? '🇫🇷 Français' : '🇩🇿 العربية';
  }

  function stopTimers() {
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    if (openingCdTimer) { clearInterval(openingCdTimer); openingCdTimer = null; }
  }

  /* ---------- الهيكل: رأس متدرج أنيق + بطاقة بيضاء متداخلة ---------- */

  function shell(inner) {
    return (
      '<div>' +
      '<div class="bg-gradient-to-b from-primary-800 via-primary-700 to-primary-800 text-white px-5 pt-4 pb-12 rounded-b-3xl shadow-md relative z-10 overflow-hidden">' +
      '<div class="absolute -top-12 -left-12 w-44 h-44 rounded-full bg-white/5 pointer-events-none"></div>' +
      '<div class="absolute -bottom-24 -right-12 w-64 h-64 rounded-full bg-white/5 pointer-events-none"></div>' +
      '<div class="relative flex items-center justify-between mb-5">' +
      '<span class="text-[11px] font-bold bg-white/15 rounded-full px-3 py-1">' + t('office') + '</span>' +
      '<button id="p-lang-btn" type="button" class="text-[11px] font-bold bg-white/15 hover:bg-white/25 rounded-full px-3 py-1 transition">' + otherLabel() + '</button>' +
      '</div>' +
      '<div class="relative flex flex-col items-center text-center">' +
      '<img src="img/logo.png" alt="" class="h-16 w-16 object-contain mb-3 bg-white rounded-2xl p-2 shadow-lg">' +
      '<h1 class="text-base sm:text-lg font-black leading-snug">' + t('univ') + '</h1>' +
      '<p class="text-[11px] text-teal-100 mt-1.5 font-semibold">' + t('p_download_sub') + '</p>' +
      '</div>' +
      '</div>' +
      '<div class="bg-white rounded-2xl shadow-lg border border-slate-200 px-4 sm:px-5 pt-5 pb-5 text-start -mt-7 relative z-20">' + inner + '</div>' +
      '</div>'
    );
  }

  function stepBlock(n, label) {
    return '<div class="flex items-center gap-2.5">' +
      '<span class="w-7 h-7 rounded-full bg-primary-700 text-white text-[13px] font-black flex items-center justify-center shrink-0 shadow">' + n + '</span>' +
      '<span class="font-bold text-slate-800 text-sm">' + label + '</span>' +
      '</div>';
  }

  function stepLine() {
    return '<div class="w-0.5 h-6 bg-slate-200 ms-3.5 my-2.5 rounded-full"></div>';
  }

  function iconCircle(emoji, cls) {
    return '<div class="w-16 h-16 mx-auto mb-3 rounded-full ' + (cls || 'bg-slate-100') + ' flex items-center justify-center text-3xl">' + emoji + '</div>';
  }

  /* ---------- عدّاد "كم يومًا متبقّي لفتح الأظرفة" ---------- */

  function daysText(n) {
    if (n === 1) return t('cd_1');
    if (n === 2) return t('cd_2');
    if (n >= 3 && n <= 10) return t('cd_few', { d: n });
    return t('cd_many', { d: n });
  }

  function openingCountdownHtml() {
    if (!tender || !tender.opening_date) return '';
    const ms = new Date(tender.opening_date).getTime() - Date.now();
    if (ms <= 0) {
      return '<div class="rounded-2xl bg-slate-100 text-slate-500 p-4 mb-4 flex items-center gap-4">' +
        '<div class="text-3xl">⏰</div>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="text-[11px] font-bold opacity-80">' + t('cd_left_title') + '</div>' +
        '<div class="text-base font-black">' + t('cd_passed') + '</div>' +
        '</div></div>';
    }
    if (ms < 86400000) {
      return '<div class="rounded-2xl bg-amber-50 border-2 border-amber-300 p-4 mb-4 flex items-center gap-4">' +
        '<div class="text-3xl">⏳</div>' +
        '<div class="min-w-0 flex-1">' +
        '<div class="text-[11px] font-bold text-amber-700">' + t('cd_less24') + '</div>' +
        '<div class="text-2xl font-black tabular-nums text-amber-800" id="cd-opening" dir="ltr"></div>' +
        '</div></div>';
    }
    const n = Math.floor(ms / 86400000);
    return '<div class="rounded-2xl bg-gradient-to-l from-primary-800 to-primary-600 text-white p-4 mb-4 flex items-center gap-4 shadow-md">' +
      '<div class="text-3xl">🗓️</div>' +
      '<div class="min-w-0 flex-1">' +
      '<div class="text-[11px] font-bold text-teal-100">' + t('cd_left_title') + '</div>' +
      '<div class="text-2xl font-black leading-tight">' + daysText(n) + '</div>' +
      '<div class="text-[11px] text-teal-100/90 mt-1" dir="auto">' + fmtDate(tender.opening_date, true) + '</div>' +
      '</div></div>';
  }

  function startOpeningCd() {
    if (openingCdTimer) clearInterval(openingCdTimer);
    openingCdTimer = null;
    const el = $('cd-opening');
    if (!el || !tender) return;
    const tick = () => {
      const ms = new Date(tender.opening_date).getTime() - Date.now();
      el.textContent = ms > 0 ? fmtCountdown(ms) : '00:00:00';
    };
    tick();
    openingCdTimer = setInterval(tick, 30000);
  }

  function bindLangToggle() {
    if (langBound) return;
    langBound = true;
    const r = root();
    r.addEventListener('click', (e) => {
      if (e.target.closest('#p-lang-btn')) {
        I18N.setLang(I18N.other());
        rerender();
      }
    });
  }

  function rerender() {
    applyDir();
    I18N.applyStatic();
    switch (currentView) {
      case 'loading': renderLoading(); break;
      case 'notfound': renderNotFound(); break;
      case 'closed': renderClosed(); break;
      case 'error': renderError(lastErr, lastErrRetry); break;
      case 'form': renderForm(); break;
      case 'working': renderWorking(); break;
      case 'done': renderDone(); break;
    }
  }

  D.init = async function (tt) {
    token = tt;
    tender = null;
    lastInfo = null;
    stopTimers();
    applyDir();
    bindLangToggle();
    renderLoading();
    try {
      const { data, error } = await DB.from('tenders_public').select('*').eq('id', tt).maybeSingle();
      if (error) throw error;
      if (!data) return renderNotFound();
      tender = data;
      if (tender.status !== 'published') return renderClosed();
      renderForm();
    } catch (err) {
      console.error(err);
      renderError(err, true);
    }
  };

  /* ---------- حالات العرض ---------- */

  function renderLoading() {
    currentView = 'loading';
    stopTimers();
    root().innerHTML = shell(
      '<div class="text-center py-10">' +
      '<div class="spinner my-4"></div>' +
      '<p class="text-sm text-slate-400">' + t('loading') + '</p>' +
      '</div>'
    );
  }

  function renderNotFound() {
    currentView = 'notfound';
    stopTimers();
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      iconCircle('🚫') +
      '<h2 class="font-black text-slate-800 mb-2">' + t('notfound_t') + '</h2>' +
      '<p class="text-sm text-slate-500 leading-relaxed">' + t('notfound_s') + '</p>' +
      '</div>'
    );
  }

  function renderClosed() {
    currentView = 'closed';
    stopTimers();
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      iconCircle('🔒', 'bg-amber-50') +
      '<h2 class="font-black text-slate-800 mb-2">' + t('closed_t') + '</h2>' +
      '<p class="text-sm text-slate-500 leading-relaxed">' + t('closed_s') + '</p>' +
      '</div>'
    );
  }

  function renderError(err, retryable) {
    currentView = 'error';
    lastErr = err;
    lastErrRetry = !!retryable;
    stopTimers();
    let msg = (err && err.message) || String(err);
    if (msg.includes('get-download') || msg.includes('function')) {
      msg = t('err_func');
    }
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      iconCircle('😕', 'bg-red-50') +
      '<h2 class="font-black text-slate-800 mb-2">' + t('err_t') + '</h2>' +
      '<p class="text-sm text-slate-500 mb-4">' + esc(msg) + '</p>' +
      (retryable ? '<button id="retry-btn" type="button" class="btn-secondary">' + t('retry') + '</button>' : '') +
      '</div>'
    );
    const b = $('retry-btn');
    if (b) b.addEventListener('click', () => D.init(token));
  }

  function renderForm() {
    currentView = 'form';
    stopTimers();
    const openingLabel = t('f_opening').replace(' *', '').replace(' *', '');
    root().innerHTML = shell(
      stepBlock(1, t('step1')) +
      '<div class="mt-3">' +
      '<div class="flex items-center gap-2 flex-wrap">' +
      '<span class="font-black text-slate-900 text-lg" dir="auto">' + esc(tender.reference) + '</span>' +
      '<span class="text-[10px] font-bold px-2 py-0.5 rounded ' + (tender.kind === 'tender' ? 'bg-indigo-50 text-indigo-700' : 'bg-primary-50 text-primary-700') + '">' + kindName(tender.kind) + '</span>' +
      '<span class="text-[10px] font-bold text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-2 py-0.5">' + t('p_published') + '</span>' +
      '</div>' +
      '<p class="text-sm text-slate-600 leading-relaxed mt-1">' + esc(tender.title) + '</p>' +
      '</div>' +
      openingCountdownHtml() +
      '<div class="grid grid-cols-2 gap-2 mb-4 text-xs">' +
      '<div class="bg-slate-50 rounded-xl px-3 py-2.5"><div class="text-slate-400 text-[10px] mb-1">' + t('f_duration').replace(' *', '') + '</div><div class="text-slate-700 font-semibold">' + esc(tender.duration || '—') + '</div></div>' +
      '<div class="bg-slate-50 rounded-xl px-3 py-2.5"><div class="text-slate-400 text-[10px] mb-1">' + openingLabel + '</div><div class="text-slate-700 font-semibold" dir="auto">' + fmtDate(tender.opening_date, true) + '</div></div>' +
      '</div>' +
      '<form id="bidder-form" class="space-y-3">' +
      stepBlock(2, t('step2')) +
      stepLine() +
      '<div><label class="lbl">🏢 ' + t('f_company') + '</label>' +
      '<input id="d-company" class="inp" type="text" required placeholder="' + esc(t('f_company_ph')) + '"></div>' +
      '<div><label class="lbl">📞 ' + t('f_phone') + '</label>' +
      '<input id="d-phone" class="inp" type="tel" dir="ltr" required placeholder="0550 00 00 00"></div>' +
      '<div><label class="lbl">✉️ ' + t('f_email') + '</label>' +
      '<input id="d-email" class="inp" type="email" dir="ltr" required placeholder="you@example.com"></div>' +
      stepLine() +
      stepBlock(3, t('step3')) +
      '<button type="submit" class="w-full mt-2 bg-gradient-to-l from-primary-700 to-primary-900 text-white font-black rounded-xl py-3 text-sm shadow-md hover:from-primary-800 hover:to-primary-900 active:scale-[.99] transition">' + t('btn_download') + '</button>' +
      '<p class="text-[11px] text-slate-400 leading-relaxed">' + t('form_note') + '</p>' +
      '</form>'
    );
    $('bidder-form').addEventListener('submit', onFormSubmit);
    startOpeningCd();
  }

  function renderWorking(msg) {
    currentView = 'working';
    stopTimers();
    root().innerHTML = shell(
      '<div class="text-center py-10">' +
      '<div class="spinner my-4"></div>' +
      '<p class="text-sm text-slate-500">' + esc(msg || t('working')) + '</p>' +
      '</div>'
    );
  }

  function renderDone() {
    currentView = 'done';
    stopTimers();
    root().innerHTML = shell(
      '<div class="text-center py-4">' +
      iconCircle('✅', 'bg-primary-50') +
      '<h2 class="font-black text-slate-800 mb-2">' + t('done_title') + '</h2>' +
      '<p class="text-sm text-slate-500 mb-4 leading-relaxed">' +
      (signed.updated
        ? t('done_upd', { c: esc(lastInfo.company) })
        : t('done_new', { c: esc(lastInfo.company) })) +
      '</p>' +
      '<div class="bg-gradient-to-l from-primary-800 to-primary-600 text-white rounded-2xl p-4 mb-4 shadow-md">' +
      '<div class="text-[11px] text-teal-100 mb-1 font-bold">' + t('expiry_l') + '</div>' +
      '<div id="expiry-cd" class="text-2xl font-black tabular-nums" dir="ltr"></div>' +
      '</div>' +
      '<button id="redownload-btn" type="button" class="btn-secondary w-full">' + t('redownload') + '</button>' +
      '</div>'
    );
    $('redownload-btn').addEventListener('click', () => D.redownload());
    expiryTimer = setInterval(() => {
      const el = $('expiry-cd');
      if (!el) return clearInterval(expiryTimer);
      const ms = signed.expiresAt - Date.now();
      if (ms <= 0) {
        el.textContent = t('cd_expire_in');
        el.classList.add('text-red-300');
        return;
      }
      el.textContent = fmtCountdown(ms);
    }, 1000);
  }

  /* ---------- منطق التحميل (عبر دالة الخادم) ---------- */

  function onFormSubmit(e) {
    e.preventDefault();
    const company = val('d-company').trim();
    const phone = val('d-phone').trim();
    const email = val('d-email').trim();
    if (!company || !phone || !email) return toast(t('t_pub_fill'), 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast(t('t_pub_bademail'), 'error');
    startDownload({ company, phone, email });
  }

  async function fetchViaFunction(info) {
    const { data, error } = await DB.functions.invoke('get-download', {
      body: {
        tender_id: tender.id,
        company: info.company,
        phone: info.phone,
        email: info.email,
      },
    });
    if (error) {
      if (String(error.message || error).includes('get-download')) {
        throw new Error(t('err_func'));
      }
      throw error;
    }
    if (!data || !data.url) {
      if (data && data.error === 'unavailable') {
        throw new Error(t('err_unavailable'));
      }
      throw new Error(t('err_link'));
    }
    return { url: data.url, expiresAt: Date.now() + (data.expires_in || 600) * 1000, updated: !!data.updated };
  }

  function startDownload(info) {
    lastInfo = info;
    renderWorking(t('working'));
    fetchViaFunction(info).then((r) => {
      signed = r;
      window.location.href = signed.url;
      renderDone();
    }).catch((err) => {
      console.error(err);
      renderError(err, false);
    });
  }

  D.redownload = async function () {
    if (!tender || !lastInfo) return;
    try {
      if (signed.url && Date.now() < signed.expiresAt - 30000) {
        window.location.href = signed.url;
        toast(t('toast_dl_working'), 'success', 2500);
        return;
      }
      renderWorking(t('redrawing'));
      signed = await fetchViaFunction(lastInfo);
      window.location.href = signed.url;
      renderDone();
    } catch (err) {
      console.error(err);
      toast(t('toast_dl_fail', { msg: (err && err.message) || err }), 'error', 6000);
      D.init(token);
    }
  };

  D.onLangChange = function () {
    if (currentView) rerender();
  };
  Object.defineProperty(D, 'view', { get: () => currentView });
})();
