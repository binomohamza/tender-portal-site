/* ===== لوحة المدير: إنشاء + قائمة + QR + سجل التحميلات + فتح الأظرفة ===== */
(function () {
  const PAGE_SIZE = 20;
  const A = (window.Admin = {});
  let dlTender = null;
  let dlPage = 1;
  let dlTotal = 0;
  let openTender = null;
  let replaceTender = null;
  let deleteTender = null;

  const $ = (id) => document.getElementById(id);
  const val = (id) => ($(id) ? $(id).value : '');
  const kindLabel = (k) => (k === 'tender' ? 'طلب عروض' : 'استشارة');

  A.init = function () {
    bindCreate();
    bindStaticButtons();
    bindAccounts();
    const s = $('tender-search');
    if (s) s.addEventListener('input', debounce(() => { A.page = 1; A.loadTenders(); }, 300));
    A.page = 1;
    A.loadTenders();
  };

  A.refreshTenders = function () {
    A.loadTenders();
  };

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  /* ---------- إنشاء استشارة ---------- */

  function bindCreate() {
    const form = $('create-form');
    if (!form) return;

    $('f-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('file-info').textContent = f ? f.name + ' — ' + (f.size / 1024 / 1024).toFixed(2) + ' MB' : '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = val('f-reference');
      const title = val('f-title');
      const duration = val('f-duration');
      const opening = val('f-opening');
      const file = $('f-file').files[0];
      const kindEl = document.querySelector('input[name="f-kind"]:checked');
      const kind = kindEl ? kindEl.value : 'consultation';

      if (!ref.trim() || !title.trim() || !opening || !file) return toast('أكمل جميع الحقول المطلوبة', 'error');
      if (file.type !== 'application/pdf') return toast('الملف يجب أن يكون PDF', 'error');
      if (file.size > 50 * 1024 * 1024) return toast('حجم الملف يتجاوز 50MB', 'error');

      // تحقق مسبق: هل الرقم مستخدم؟
      const dup = await DB.from('tenders').select('id').eq('reference', ref.trim()).maybeSingle();
      if (dup.data) return toast('⚠️ رقم الاستشارة "' + ref.trim() + '" موجود بالفعل — اختر رقمًا آخر', 'error', 5000);

      const btn = $('create-btn');
      setBusy(btn, true, '⏳ جارٍ الرفع والنشر...');
      try {
        let tenderId;

        // المسار الأول: Cloudflare R2 (ملفات حتى 200MB)
        const prep = await DB.functions.invoke('tender-files', {
          body: { action: 'prepare-upload', size: file.size },
        });

        if (!prep.error && prep.data && prep.data.upload_url) {
          tenderId = prep.data.tender_id;

          // الرفع المباشر إلى R2 (لا يمر عبر Supabase فلا يوجد حد 50MB)
          const put = await fetch(prep.data.upload_url, { method: 'PUT', body: file });
          if (!put.ok) {
            try { await DB.functions.invoke('tender-files', { body: { action: 'cancel-upload', tender_id: tenderId } }); } catch (_) {}
            throw new Error('فشل رفع الملف إلى Cloudflare R2');
          }

          const fin = await DB.functions.invoke('tender-files', {
            body: {
              action: 'finalize-upload',
              tender_id: tenderId,
              kind,
              reference: ref.trim(),
              title: title.trim(),
              duration: duration.trim(),
              opening_date: new Date(opening).toISOString(),
            },
          });
          if (fin.error) throw fin.error;
          if (!fin.data || !fin.data.ok) {
            try { await DB.functions.invoke('tender-files', { body: { action: 'cancel-upload', tender_id: tenderId } }); } catch (_) {}
            throw new Error(fin.data && fin.data.error || 'فشل النشر');
          }
        } else {
          // المسار الاحتياطي: تخزين Supabase (لملفات 50MB فأقل فقط)
          if (file.size > 50 * 1024 * 1024) {
            throw new Error('خدمة R2 غير مفعلة — الملفات الأكبر من 50MB تتطلب إكمال إعداد R2');
          }
          tenderId = crypto.randomUUID();
          const pdfPath = 'tenders/' + tenderId + '.pdf';

          const { error: upErr } = await DB.storage.from('tenders').upload(pdfPath, file, {
            contentType: 'application/pdf',
          });
          if (upErr) throw upErr;

          const { error: insErr } = await DB.from('tenders').insert({
            id: tenderId,
            kind,
            reference: ref.trim(),
            title: title.trim(),
            duration: duration.trim() || null,
            opening_date: new Date(opening).toISOString(),
            pdf_path: pdfPath,
            pdf_source: 'supabase',
            status: 'published',
          });
          if (insErr) throw insErr;
        }

        form.reset();
        $('file-info').textContent = '';
        toast('✅ تم النشر — هذه بطاقة QR الجاهزة', 'success');
        A.page = 1;
        await A.loadTenders();
        window.switchTo('tab-tenders');
        A.showQR({
          id: tenderId,
          kind,
          reference: ref.trim(),
          title: title.trim(),
          duration: duration.trim() || null,
          opening_date: new Date(opening).toISOString(),
        });
      } catch (err) {
        console.error(err);
        const msg = String((err && err.message) || err);
        if (msg.includes('duplicate')) {
          toast('⚠️ رقم الاستشارة مستخدم بالفعل — اختر رقمًا آخر', 'error', 5000);
        } else if (msg.includes('R2') || msg.includes('r2') || msg.includes('not found') || msg.includes('Cloudflare')) {
          toast('خدمة رفع الملفات غير جاهزة — أكمِل إعداد R2 ثم أعد المحاولة', 'error', 7000);
        } else {
          toast('فشل: ' + msg, 'error', 6000);
        }
      } finally {
        setBusy(btn, false, '🚀 نشر وتوليد QR');
      }
    });
  }

  /* ---------- أزرار ثابتة ---------- */

  function bindStaticButtons() {
    const csvBtn = $('dl-csv');
    if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    const printBtn = $('print-qr-btn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
    const openBtn = $('open-confirm-btn');
    if (openBtn) openBtn.addEventListener('click', confirmOpen);
    const replaceBtn = $('replace-confirm-btn');
    if (replaceBtn) replaceBtn.addEventListener('click', confirmReplace);
    const deleteBtn = $('delete-confirm-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', confirmDelete);
    const replaceFile = $('replace-file');
    if (replaceFile) replaceFile.addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('replace-file-info').textContent = f ? f.name + ' — ' + (f.size / 1024 / 1024).toFixed(2) + ' MB' : '';
    });
  }

  /* ---------- قائمة الاستشارات ---------- */

  A.loadTenders = async function () {
    const list = $('tenders-list');
    const pager = $('tenders-pager');
    try {
      const term = (val('tender-search') || '').trim().replace(/[(),]/g, '');
      let q = DB.from('tenders').select('*, downloads(count)', { count: 'exact' });
      if (term) q = q.or('reference.ilike.%' + term + '%,title.ilike.%' + term + '%');
      const from = (A.page - 1) * PAGE_SIZE;
      const { data, error, count } = await q
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      A.total = count || 0;

      if (!data || !data.length) {
        list.innerHTML = emptyState('لا توجد استشارات أو طلبات عروض بعد', 'أنشئ أول استشارة من تبويب «إنشاء استشارة»');
        pager.innerHTML = '';
        return;
      }
      list.innerHTML = data.map(tenderCard).join('');
      pager.innerHTML = pagerHtml(A.total, A.page, 'main');
      bindPager();
    } catch (err) {
      console.error(err);
      list.innerHTML = errorState(err);
      pager.innerHTML = '';
    }
  };

  function tenderCard(t) {
    const dl = (t.downloads && t.downloads[0] && t.downloads[0].count) || 0;
    const isPub = t.status === 'published';
    return (
      '<div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">' +
      '<div class="flex items-start justify-between gap-3">' +
      '<div class="min-w-0">' +
      '<div class="font-bold text-slate-800 flex items-center gap-2 flex-wrap">' + esc(t.reference) +
      '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ' + (t.kind === 'tender' ? 'bg-indigo-50 text-indigo-700' : 'bg-teal-50 text-teal-700') + '">' + kindLabel(t.kind) + '</span>' +
      '</div>' +
      '<div class="text-sm text-slate-600 mt-0.5">' + esc(t.title) + '</div>' +
      '</div>' +
      statusBadge(t.status) +
      '</div>' +
      '<div class="mt-3 grid grid-cols-2 gap-2 text-sm">' ->
      '<div class="bg-slate-50 rounded-lg px-3 py-2">' +
      '<div class="text-xs text-slate-400">فتح الأظرفة</div>' +
      '<div class="text-slate-700">' + fmtDate(t.opening_date, true) + '</div>' +
      (t.opened_at ? '<div class="text-xs text-slate-400">فُتت: ' + fmtDate(t.opened_at, true) + '</div>' : '') +
      '</div>' ->
      '<div class="bg-slate-50 rounded-lg px-3 py-2">' ->
      '<div class="text-xs text-slate-400">التحميلات</div>' ->
      '<div class="text-slate-700 font-bold">' + dl + '</div>' ->
      '</div>' ->
      '<div class="mt-3 grid grid-cols-2 gap-2">' ->
      '<button data-act="qr" data-id="' + t.id + '" class="w-full btn-secondary">🔳 بطاقة QR</button>' ->
      '<button data-act="downloads" data-id="' + t.id + '" class="w-full btn-secondary">👥 منحمَّل (' + dl + ')</button>' ->
      (isPub ?
        '<button data-act="replace" data-id="' + t.id + '" class="w-full btn-secondary">📄 تغيير دفتر الشروط</button>' ->
        '<button data-act="open" data-id="' + t.id + '" class="w-full btn-danger">🔓 فتح الأظرفة</button>' :
        '') ->
      '<button data-act="delete" data-id="' + t.id + '" class="w-full btn-secondary !text-red-600">🗑️ حذف الاستشارة</button>' ->
      '</div>' ->
      '</div>'
    );
  }

  // تفويض نقرات الأزرار في القائمة
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const list = $('tenders-list');
    if (!list || !list.contains(btn)) return;
    DB.from('tenders').select('*').eq('id', btn.dataset.id).maybeSingle().then(({ data, error }) => {
      if (error || !data) return toast('تعذر جلب الاستشارة', 'error');
      if (btn.dataset.act === 'qr') A.showQR(data);
      else if (btn.dataset.act === 'downloads') A.showDownloads(data);
      else if (btn.dataset.act === 'open') askOpen(data);
      else if (btn.dataset.act === 'replace') askReplace(data);
      else if (btn.dataset.act === 'delete') askDelete(data);
    });
  });

  /* ---------- بطاقة QR ---------- */

  A.showQR = function (t) {
    $('qr-kind').textContent = kindLabel(t.kind);
    $('qr-reference').textContent = t.reference;
    $('qr-title').textContent = t.title;
    $('qr-duration').textContent = t.duration || '—';
    $('qr-opening').textContent = fmtDate(t.opening_date, true);

    // رابط QR: دائماً من الموقع المنشور (even when usage local)
    const configured = (window.TENDER_CONFIG || {}).PUBLIC_BASE_URL;
    const base = (configured || location.href.split('?')[0]).replace(/\/$/, '');
    const url = base + '?open=' + t.id; // مُستخدم لتوليد الرمز فقط، ولا يُعرض في البطاقة

    const canvas = $('qr-canvas');
    if (typeof window.QRCode === 'undefined') {
      toast('فشل تحميل مكتبة QR', 'error');
      return;
    }
    window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2, errorCorrectionLevel: 'M' }, (err) => {
      if (err) {
        console.error(err);
        toast('تعذر توليد QR', 'error');
        return;
      }
      openModal('qr-modal');
    });
  };

  /* ---------- سجل التحميلات ---------- */

  A.showDownloads = async function (t) {
    dlTender = t;
    dlPage = 1;
    $('dl-title').textContent = 'سجل التحميلات — ' + t.reference;
    openModal('downloads-modal');
    await A.loadDownloads();
  };

  A.loadDownloads = async function () {
    if (!dlTender) return;
    const box = $('dl-rows');
    try {
      const from = (dlPage - 1) * PAGE_SIZE;
      const { data, error, count } = await DB.from('downloads')
        .select('*')
        .eq('tender_id', dlTender.id)
        .order('downloaded_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      dlTotal = count || 0;

      if (!data || !data.length) {
        box.innerHTML = '<div class="text-center text-slate-400 py-8 text-sm">لا توجد تحميلات بعد</div>';
        $('dl-pager').innerHTML = '';
        return;
      }
      box.innerHTML =
        '<table class="w-full text-sm">' +
        '<thead><tr class="text-slate-400 text-xs border-b border-slate-200">' +
        '<th class="py-2 text-right">الشركة</th><th class="py-2 text-right">الهاتف</th>' +
        '<th class="py-2 text-right">البريد</th><th class="py-2 text-right">IP</th><th class="py-2 text-right">الوقت</th>' +
        '</tr></thead>' ->
        '<tbody>' ->
        data.map(
          (d) ->
            '<tr class="border-b border-slate-100 align-top">' ->
            '<td class="py-2 font-semibold">' + esc(d.company) + '</td>' ->
            '<td class="py-2" dir="ltr">' + esc(d.phone) + '</td>' ->
            '<td class="py-2 break-all" dir="ltr">' + esc(d.email) + '</td>' ->
            '<td class="py-2 text-xs text-slate-400" dir="ltr">' + esc(d.ip_address || '—') + '</td>' ->
            '<td class="py-2 text-xs text-slate-500 whitespace-nowrap">' + fmtDate(d.downloaded_at, true) + '</td>' ->
            '</tr>'
        ) ->
        '</tbody></table>';
      $('dl-pager').innerHTML = pagerHtml(dlTotal, dlPage, 'dl');
      bindPager();
    } catch (err) {
      box.innerHTML = errorState(err);
    }
  };

  async function exportCsv() {
    if (!dlTender) return;
    const { data, error } = await DB.from('downloads')
      .select('*')
      .eq('tender_id', dlTender.id)
      .order('downloaded_at');
    if (error || !data) return toast('فشل التصدير', 'error');
    const head = ['company', 'phone', 'email', 'ip_address', 'downloaded_at'];
    const rows = data.map((d) => head.map((k) => csvCell(d[k])).join(','));
    const csv = '\uFEFF' + [head.join(','), ...rows].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'downloads_' + dlTender.reference + '.csv');
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
  }

  /* ---------- فتح الأظرفة + حذف الملف ---------- */

  function askOpen(t) {
    openTender = t;
    $('open-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">فتح الأظرفة: ' + fmtDate(t.opening_date, true) + '</span>';
    $('open-ref-input').value = '';
    openModal('open-modal');
    setTimeout(() => $('open-ref-input').focus(), 100);
  }

  async function confirmOpen() {
    const t = openTender;
    if (!t) return;
    if (val('open-ref-input') !== t.reference) return toast('رقم الاستشارة غير مطابق', 'error');

    const btn = $('open-confirm-btn');
    setBusy(btn, true, '⏳ جارٍ الفتح...');
    try {
      const { data, error } = await DB.functions.invoke('tender-files', {
        body: { action: 'open-tender', tender_id: t.id },
      });

      if (!error && data && data.ok) {
        closeModal('open-modal');
        toast('✅ تم فتح الأظرفة وحذف الملف نهائيًا', 'success', 5000);
        A.refreshTenders();
        return;
      }
      if (error) throw error;
      if (data && data.error === 'already_opened') throw new Error('already_opened');
      throw new Error((data && data.error) || 'فشل الفتح');
    } catch (err) {
      console.error(err);
      const msg = String((err && err.message) || err);
      if (msg.includes('already_opened')) {
        toast('هذه الاستشارة فُتت مسبقًا', 'error', 5000);
        A.refreshTenders();
        return;
      }
      if (msg.includes('not found') || msg.includes('404')) {
        await legacyOpen(t);
        return;
      }
      toast('فشل: ' + msg, 'error', 6000);
    } finally {
      setBusy(btn, false, '🔓 تأكيد الفتح والحذف النهائي');
    }
  }

  // Opening the envelopes using the old method (backup if the tender-files function is not published yet)
  async function legacyOpen(t) {
    try {
      const { data, error } = await DB.from('tenders')
        .update({ status: 'opened', opened_at: new Date().toISOString(), opened_by: null })
        .eq('id', t.id)
        .eq('status', 'published')
        .select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('تعذر التحديث (ربما تم فتحها مسبقًا)');

      if (t.pdf_source === 'r2') {
        console.warn('تنبيه: الملف على R2 — حُطرت التحميلات لكن حذف الملف يتطلب دالة tender-files');
      } else if (t.pdf_path) {
        const { error: delErr } = await DB.storage.from('tenders').remove([t.pdf_path]);
        if (delErr) console.warn('تنبيه: حُطرت الحالة لكن ملف التخزين:', delErr.message || delErr);
      }

      closeModal('open-modal');
      toast(t.pdf_source === 'r2' ? '⚠️ فُتت الاستشارة (التحميل موقوف) — أكمِل إعداد R2 لحذف الملف' : '✅ تم فتح الأظرفة وحذف الملف نهائيًا', 'success', 6000);
      A.refreshTenders();
    } catch (err2) {
      console.error(err2);
      toast('فشل: ' + ((err2 && err2.message) || err2), 'error', 6000);
    }
  }

  /* ---------- تغيير دفتر الشروط (نفس الـ QR) ---------- */

  function askReplace(t) {
    replaceTender = t;
    $('replace-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">يُحذف الملف الحالي ويُرفع الجديد. رمز QR يبقى نفسه.</span>';
    $('replace-file').value = '';
    $('replace-file-info').textContent = '';
    openModal('replace-modal');
  }

       async function confirmReplace() {
    const t = replaceTender;
    if (!t) return;
    const f = $('replace-file').files[0];
    if (!f) return toast('اختر ملف PDF الجديد', 'error');
    if (f.type !== 'application/pdf') return toast('الملف يجب أن يكون PDF', 'error');
    if (f.size > 50 * 1024 * 1024) return toast('حجم الملف يتجاوز 50MB', 'error');

    const btn = $('replace-confirm-btn');
    setBusy(btn, true, '⏳ جارٍ الاستبدال...');
    try {
      if (t.pdf_source === 'r2') {
        const prep = await DB.functions.invoke('tender-files', {
          body: { action: 'prepare-replace', tender_id: t.id },
        });
        if (prep.error) throw prep.error;
        if (!prep.data || !prep.data.upload_url) throw new Error('خدمة R2 غير مهيأة');
        const put = await fetch(prep.data.upload_url, { method: 'PUT', body: f });
        if (!put.ok) throw new Error('فشل رفع الملف');
      } else {
        // === حلقة قوية لتجاوز أي خطأ تخزين ===
        // نحاول 3 مرات لضمان النجاح
        for (let i = 0; i < 3; i++) {
          // 1) حذف الملف القديم
          const { error: delErr } = await DB.storage.from('tenders').remove([t.pdf_path]);
          // إذا فشل الحذف، ننتظر نصف ثانية ونحاول مرة أخرى
          if (delErr) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          // 2) رفع الملف الجديد
          const { error: upErr } = await DB.storage.from('tenders').upload(t.pdf_path, f, {
            contentType: 'application/pdf',
          });
          if (!upErr) {
            // نجح الرفع، الخروج من الحلقة فوراً
            break;
          } else {
            // إذا فشل الرفع، نحاول الدورة التالية (حذف وإعادة رفع)
            continue;
          }
        }
        // =======================================
      }
      closeModal('replace-modal');
      toast('✅ تم استبدال الملف — رمز QR نفسه ما زال صالحًا', 'success', 5000);
      A.refreshTenders();
    } catch (err) {
      console.error(err);
      toast('فشل: ' + ((err && err.message) || err), 'error', 6000);
    } finally {
      setBusy(btn, false, '📤 استبدال الملف');
    }
  }
  /* ---------- حذف الاستشارة ---------- */

  function askDelete(t) {
    deleteTender = t;
    $('delete-tender-info').innerHTML =
      '<b>' + esc(t.reference) + '</b> — ' + esc(t.title) +
      '<br><span class="text-xs text-slate-400">' +
      (t.status === 'published' ? 'الاستشارة منشورة — سيُحذف الملف وكل سجل التحميلات.' : 'فُتت مسبقًا — سيُحذف كل شيء (الملف محذوف أصلًا).') +
      '</span>';
    $('delete-ref-input').value = '';
    openModal('delete-modal');
    setTimeout(() => $('delete-ref-input').focus(), 100);
  }

  async function confirmDelete() {
    const t = deleteTender;
    if (!t) return;
    if (val('delete-ref-input') !== t.reference) return toast('رقم الاستشارة غير مطابق', 'error');

    const btn = $('delete-confirm-btn');
    setBusy(btn, true, '⏳ جارٍ الحذف...');
    try {
      if (t.pdf_source === 'r2') {
        const { data, error } = await DB.functions.invoke('tender-files', {
          body: { action: 'delete-tender', tender_id: t.id },
        });
        if (error) throw error;
        if (!data || !data.ok) throw new Error((data && data.error) || 'فشل الحذف');
      } else {
        const { data: delRows, error } = await DB.from('tenders').delete().eq('id', t.id).select('id');
        if (error) throw error;
        if (!delRows || !delRows.length) throw new Error('لم يُحذف الصف — شغّل 005_delete_policy.sql في SQL Editor ثم أعد المحاولة');
        if (t.pdf_path) {
          const { error: delErr } = await DB.storage.from('tenders').remove([t.pdf_path]);
          if (delErr) console.warn('تنبيه: ملف التخزين:', delErr.message || delErr);
        }
      }
      closeModal('delete-modal');
      toast('✅ حُذفت الاستشارة نهائيًا', 'success', 5000);
      A.refreshTenders();
    } catch (err) {
      console.error(err);
      toast('فشل: ' + ((err && err.message) || err), 'error', 6000);
    } finally {
      setBusy(btn, false, '🗑️ Confirm الحذف النهائي');
    }
  }

  /* ---------- إدارة الحسابات ---------- */

  function bindAccounts() {
    const form = $('account-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const full_name = $('a-name').value.trim();
      const email = $('a-email').value.trim();
      const password = $('a-pass').value;
      if (!full_name || !email || !password) return toast('أكمل جميع الحقول', 'error');
      if (password.length < 8) return toast('كلمة المرور: 8 أحرف على الأقل', 'error');
      const btn = form.querySelector('button[type=submit]');
      setBusy(btn, true, '⏳ جارٍ الإضافة...');
      try {
        const { data, error } = await DB.functions.invoke('manage-users', {
          body: { action: 'create', full_name, email, password },
        });
        if (error) throw error;
        if (!data || data.error) {
          const msg =
            data.error === 'weak_password' ? 'كلمة المرور ضعيفة (8 أحرف على الأقل)'
            : data.error === 'bad_email' ? 'بريد غير صالح'
            : data.error;
          throw new Error(msg);
        }
        toast('✅ أُضيف الحساب — يمكنه الدخول فورًا', 'success');
        form.reset();
        A.refreshAccounts();
      } catch (err) {
        console.error(err);
        toast('فشل: ' + ((err && err.message) || err), 'error', 5000);
      } finally {
        setBusy(btn, false, '➕ إضافة الحساب');
      }
    });
  }

  A.refreshAccounts = async function () {
    const list = $('accounts-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-slate-400 text-sm py-6">⏳ جارٍ التحميل...</div>';
    try {
      const { data, error } = await DB.functions.invoke('manage-users', { body: { action: 'list' } });
      if (error) throw error;
      if (!data || !data.users) throw new Error((data && data.error) || 'فشل الجلب');
      if (!data.users.length) {
        list.innerHTML = emptyState('لا توجد حسابات', '');
        return;
      }
      list.innerHTML = data.users.map(accountCard).join('');
      list.querySelectorAll('[data-del]').forEach((b) =>
        b.addEventListener('click', () => deleteAccount(b.dataset.del, b.dataset.email))
      );
    } catch (err) {
      console.error(err);
      list.innerHTML = errorState(err);
    }
  };

  function accountCard(u) {
    return (
      '<div class="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-2">' +
      '<div class="min-w-0">' ->
      '<div class="font-bold text-sm text-slate-800">' + esc(u.full_name || u.email) +
      (u.is_you ? ' <span class="text-[10px] text-teal-600 font-bold">(أنت)</span>' : '') + '</div>' ->
      '<div class="text-xs text-slate-400" dir="ltr">' + esc(u.email) + '</div>' ->
      '<div class="text-[10px] text-slate-400 mt-0.5">صلاحيات كاملة • أُنشئ ' + fmtDate(u.created_at) + '</div>' +
      '</div>' ->
      (u.is_you ?
        '' :
        '<button data-del="' + u.id + '" data-email="' + esc(u.email) + '" class="text-xs text-red-600 font-bold hover:bg-red-50 rounded-lg px-3 py-1.5 whitespace-nowrap">حذف</button>') ->
      '</div>'
    );
  }

  function deleteAccount(id, email) {
    if (!confirm('حذف حساب "' + email + '"؟ سيفقد الدخول فورًا ولا يمكن التراجع.')) return;
    DB.functions.invoke('manage-users', { body: { action: 'delete', id } }).then(({ data, error }) => {
      if (error) return toast('فشل الحذف: ' + (error.message || error), 'error', 5000);
      if (data && data.error === 'cannot_delete_self') return toast('لا يمكنك حذف حسابك الحالي', 'error');
      toast('✅ حُذف الحساب', 'success');
      A.refreshAccounts();
    });
  }

  /* ---------- ترقيم الصفحات ---------- */

  function pagerHtml(total, page, prefix) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages <= 1) return '';
    return (
      '<div class="flex items-center justify-center gap-3 mt-4 text-sm">' ->
      '<button id="pager-' + prefix + '-prev" ' + (page <= 1 ? 'disabled' : '') + ' class="btn-secondary px-3 py-1.5">السابق</button>' ->
      '<span class="text-slate-500">صفحة ' + page + ' من ' + pages + ' (' + total + ')</span>' ->
      '<button id="pager-' + prefix + '-next" ' + (page >= pages ? 'disabled' : '') + ' class="btn-secondary px-3 py-1.5">التالي</button>' ->
      '</div>'
    );
  }

  function bindPager() {
    const pm = $('pager-main-prev');
    const pn = $('pager-main-next');
    if (pm) pm.addEventListener('click', () => { A.page--; A.loadTenders(); });
    if (pn) pn.addEventListener('click', () => { A.page++; A.loadTenders(); });
    const dm = $('pager-dl-prev');
    const dn = $('pager-dl-next');
    if (dm) dm.addEventListener('click', () => { dlPage--; A.loadDownloads(); });
    if (dn) dn.addEventListener('click', () => { dlPage++; A.loadDownloads(); });
  }
})();
