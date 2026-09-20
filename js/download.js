/* ===== صفحة المتعامل (?open=UUID) — عبر دالة خادم Supabase ===== */
(function () {
  const D = (window.DownloadPage = {});

  let token = null;
  let tender = null;
  let signed = { url: '', expiresAt: 0 };
  let lastInfo = null;
  let expiryTimer = null;

  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value : '');
  const root = () => $('download-root');

  D.init = async function (t) {
    token = t;
    tender = null;
    lastInfo = null;
    renderLoading();
    try {
      // العرض العام: بدون مسار الملف
      const { data, error } = await DB.from('tenders_public').select('*').eq('id', t).maybeSingle();
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

  function shell(inner) {
    return (
      '<div class="text-center">' +
      '<div class="text-4xl mb-3">🏛️</div>' +
      '<h1 class="text-lg font-black text-slate-800">بوابة مكتب الصفقات</h1>' +
      '<p class="text-xs text-slate-400 mb-6">تحميل دفتر الشروط</p>' +
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-right">' + inner + '</div>' +
      '</div>'
    );
  }

  function renderLoading() {
    root().innerHTML = shell(
      '<div class="spinner my-8"></div><p class="text-sm text-slate-400 text-center">جارٍ التحقق...</p>'
    );
  }

  function renderNotFound() {
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      '<div class="text-5xl mb-4">🚫</div>' +
      '<h2 class="font-bold text-slate-800 mb-2">الاستشارة غير موجودة</h2>' +
      '<p class="text-sm text-slate-500 leading-relaxed">تأكد من مسح الرمز الصحيح، أو تواصل مع مكتب الصفقات.</p>' +
      '</div>'
    );
  }

  function renderClosed() {
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      '<div class="text-5xl mb-4">🔒</div>' +
      '<h2 class="font-black text-slate-800 mb-2">تم فتح الأظرفة</h2>' +
      '<p class="text-sm text-slate-500 leading-relaxed">انتهت فترة تحميل دفتر الشروط لهذه الاستشارة، وحُذف الملف من الخادم.</p>' +
      '</div>'
    );
  }

  function renderError(err, retryable) {
    let msg = (err && err.message) || String(err);
    if (msg.includes('get-download') || msg.includes('function')) {
      msg = 'خدمة التحميل غير مفعلة حاليًا — تواصل مع مكتب الصفقات.';
    }
    root().innerHTML = shell(
      '<div class="text-center py-6">' +
      '<div class="text-5xl mb-4">😕</div>' +
      '<h2 class="font-black text-slate-800 mb-2">حدث خطأ</h2>' +
      '<p class="text-sm text-slate-500 mb-4">' + esc(msg) + '</p>' +
      (retryable ? '<button id="retry-btn" class="btn-secondary">🔄 إعادة المحاولة</button>' : '') +
      '</div>'
    );
    const b = $('retry-btn');
    if (b) b.addEventListener('click', () => D.init(token));
  }

  function renderForm() {
    root().innerHTML = shell(
      '<div class="mb-5">' +
      '<div class="flex items-center justify-between gap-2 mb-1">' +
      '<span class="font-black text-slate-800">استشارة عدد: ' + esc(tender.reference) + '</span>' +
      '<span class="text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">منشورة</span>' +
      '</div>' +
      '<p class="text-sm text-slate-600">' + esc(tender.title) + '</p>' +
      (tender.duration ? '<p class="text-xs text-slate-400 mt-1">المدة: ' + esc(tender.duration) + '</p>' : '') +
      '<p class="text-xs text-slate-400 mt-1">فتح الأظرفة: ' + esc(fmtDate(tender.opening_date, true)) + '</p>' +
      '</div>' +
      '<form id="bidder-form" class="space-y-3">' +
      '<div><label class="lbl">اسم الشركة / المؤسسة *</label>' +
      '<input id="d-company" class="inp" type="text" required placeholder="مثال: شركة البناء الحديث ش.م.م"></div>' +
      '<div><label class="lbl">رقم الهاتف *</label>' +
      '<input id="d-phone" class="inp" type="tel" dir="ltr" required placeholder="0550 00 00 00"></div>' +
      '<div><label class="lbl">البريد الإلكتروني *</label>' +
      '<input id="d-email" class="inp" type="email" dir="ltr" required placeholder="you@example.com"></div>' +
      '<button type="submit" class="btn-primary w-full mt-2">📥 تحميل دفتر الشروط</button>' +
      '<p class="text-[11px] text-slate-400 leading-relaxed">تُسجَّل بيانات مؤسستك في سجل التحميلات. ' +
      'رابط التحميل مؤقت وصالح لمدة 10 دقائق فقط، ويُغلق نهائيًا بعد فتح الأظرفة.</p>' +
      '</form>'
    );
    $('bidder-form').addEventListener('submit', onFormSubmit);
  }

  function renderWorking(msg) {
    root().innerHTML = shell(
      '<div class="spinner my-8"></div>' +
      '<p class="text-sm text-slate-500 text-center mt-4">' + esc(msg) + '</p>'
    );
  }

  function renderDone() {
    root().innerHTML = shell(
      '<div class="text-center py-4">' +
      '<div class="text-5xl mb-3">✅</div>' +
      '<h2 class="font-black text-slate-800 mb-1">تم التحميل بنجاح</h2>' +
      '<p class="text-sm text-slate-500 mb-4">سُجِّلت بيانات <b>' + esc(lastInfo.company) + '</b> في سجل التحميلات.</p>' +
      '<div class="bg-slate-50 rounded-xl p-3 mb-4">' +
      '<div class="text-xs text-slate-400 mb-1">صلاحية الرابط المؤقت تنتهي خلال</div>' +
      '<div id="expiry-cd" class="text-xl font-black text-teal-700 tabular-nums"></div>' +
      '</div>' +
      '<button id="redownload-btn" class="btn-secondary w-full">⬇️ إعادة التحميل</button>' +
      '</div>'
    );
    $('redownload-btn').addEventListener('click', () => D.redownload());
    clearInterval(expiryTimer);
    expiryTimer = setInterval(() => {
      const el = $('expiry-cd');
      if (!el) return clearInterval(expiryTimer);
      const ms = signed.expiresAt - Date.now();
      if (ms <= 0) {
        el.textContent = 'انتهت الصلاحية';
        el.classList.add('text-red-600');
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
    if (!company || !phone || !email) return toast('أكمل جميع الحقول المطلوبة', 'error');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('البريد الإلكتروني غير صالح', 'error');
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
        throw new Error('خدمة التحميل غير مفعلة (get-download)');
      }
      throw error;
    }
    if (!data || !data.url) {
      if (data && data.error === 'unavailable') {
        throw new Error('الاستشارة لم تعد متاحة — ربما تم فتح الأظرفة');
      }
      throw new Error('تعذر تجهيز رابط التحميل');
    }
    return { url: data.url, expiresAt: Date.now() + (data.expires_in || 600) * 1000 };
  }

  async function startDownload(info) {
    lastInfo = info;
    renderWorking('جارٍ تسجيل بياناتك وتجهيز الملف...');
    try {
      signed = await fetchViaFunction(info);
      // التنزيل المباشر من الرابط المؤقت (يدعم الملفات الكبيرة)
      window.location.href = signed.url;
      renderDone();
    } catch (err) {
      console.error(err);
      renderError(err, false);
    }
  }

  D.redownload = async function () {
    if (!tender || !lastInfo) return;
    try {
      if (signed.url && Date.now() < signed.expiresAt - 30000) {
        window.location.href = signed.url;
        toast('جارٍ التنزيل (الرابط ما زال صالحًا)', 'success', 2500);
        return;
      }
      renderWorking('جارٍ توليد رابط جديد...');
      signed = await fetchViaFunction(lastInfo);
      window.location.href = signed.url;
      renderDone();
    } catch (err) {
      console.error(err);
      toast('تعذر التحميل: ' + ((err && err.message) || err), 'error', 6000);
      D.init(token);
    }
  };
})();
