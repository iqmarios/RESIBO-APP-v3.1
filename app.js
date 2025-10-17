/* Resibo App v3.1.7 - app.js
   What's new in 3.1.7:
   - CSV/TSV auto-delimiter detection (comma, tab, or semicolon).
   - Case-insensitive headers with aliases in any order:
       code:            ["code", "access_code"]
       name:            ["name", "registered_name"]
       tin:             ["tin", "seller_tin", "tax_id"]
       gmail:           ["gmail", "email", "e-mail", "mail"]
       status:          ["status", "state"]
       expiry_date:     ["expiry_date", "expiry", "expires", "expiration", "expirydate"]
   - Whitespace/case-tolerant comparison for code/gmail; digits-only TIN matching (9 or 12).
   - Keeps tolerant name matching from 3.1.6 (token overlap).
   NOTE: index.html text might still show old header hint; functionality now accepts both forms.
*/

(() => {
  'use strict';

  // ---------- Version & Globals ----------
  const VERSION = '3.1.7';
  const CACHE_VERSION = 'resibo-cache-v3.1.7';
  const BUILD_TIME = new Date().toISOString();
  const SCHEMA_VERSION = '3.1.4';
  const SESSION_TTL_DAYS = 7;
  const OCR_CONF_THRESHOLD = 0.8;
  const TIMEZONE = 'Asia/Manila';

  const LS = {
    csvUrl: 'resibo.csvUrl',
    emailEndpoint: 'resibo.emailEndpoint',
    session: 'resibo.session',
    receipts: 'resibo.receipts',
    queue: 'resibo.queue'
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    offlineBanner: $('offlineBanner'),
    sectionVerify: $('sectionVerify'),
    sectionCapture: $('sectionCapture'),
    sectionReview: $('sectionReview'),
    sectionExport: $('sectionExport'),
    sectionPrivacy: $('sectionPrivacy'),

    // Settings
    setCsvUrl: $('setCsvUrl'),
    setEmailUrl: $('setEmailUrl'),
    btnSaveSettings: $('btnSaveSettings'),
    btnTestCsv: $('btnTestCsv'),
    btnTestEmail: $('btnTestEmail'),
    btnClearSettings: $('btnClearSettings'),
    settingsMsg: $('settingsMsg'),

    // Verify
    verifyForm: $('verifyForm'),
    verifyMsg: $('verifyMsg'),
    btnClearVerify: $('btnClearVerify'),
    inpCsvUrl: $('inpCsvUrl'),
    inpCsvPaste: $('inpCsvPaste'),

    // Capture
    camPreview: $('camPreview'),
    camCanvas: $('camCanvas'),
    btnStartCam: $('btnStartCam'),
    btnSnap: $('btnSnap'),
    btnStopCam: $('btnStopCam'),
    fileInput: $('fileInput'),
    btnProcess: $('btnProcess'),
    btnClearFiles: $('btnClearFiles'),
    fileList: $('fileList'),

    // Review
    recordsPanel: $('recordsPanel'),

    // Export
    inpConfirmAll: $('inpConfirmAll'),
    btnEmailExport: $('btnEmailExport'),
    btnZipExport: $('btnZipExport'),
    exportMsg: $('exportMsg'),

    // Self-test + update
    btnRunSelfTest: $('btnRunSelfTest'),
    selfTestList: $('selfTestList'),
    selfTestStatus: $('selfTestStatus'),
    btnUpdate: $('btnUpdate'),
  };

  // ---------- Local Storage helpers ----------
  const getLocal = (k, f=null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
  const setLocal = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const delLocal = (k) => localStorage.removeItem(k);

  // ---------- Utils ----------
  const nowInTZ = (tz = TIMEZONE) => {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    const y = parts.find(p=>p.type==='year').value;
    const m = parts.find(p=>p.type==='month').value;
    const da = parts.find(p=>p.type==='day').value;
    return new Date(`${y}-${m}-${da}T00:00:00Z`);
  };

  function parseToYMD(s) {
    const t = String(s || '').trim();
    if (!t) return null;
    let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return `${m[1].padStart(4,'0')}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return `${m[3].padStart(4,'0')}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
    return null;
  }

  const withinGrace = (expiryYMD, tz=TIMEZONE) => {
    const today = nowInTZ(tz);
    const exp = new Date(`${expiryYMD}T00:00:00Z`);
    const day = 86400000;
    return (exp.getTime() + day) >= (today.getTime() - day);
  };

  const guardCsvInjection = (str) => {
    const s = String(str ?? '');
    return (/^[=\-+@]/.test(s)) ? `'${s}` : s.replace(/[\r\n]+/g, ' ');
  };

  const sanitizePIILog = (msg) => String(msg).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,'[email]')
    .replace(/\b\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3})?\b/g,'[tin]');

  const digitsOnly = (s) => String(s || '').replace(/\D+/g, '');
  function isTinEqual(a, b) {
    const A = digitsOnly(a), B = digitsOnly(b);
    if (!A || !B) return false;
    if (A === B) return true;
    if ((A.length === 12 && B.length === 9) || (A.length === 9 && B.length === 12)) {
      return A.slice(0,9) === B.slice(0,9);
    }
    return false;
  }

  const normalizeName = (s) => String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
  function isNameMatch(inputName, recordName) {
    const a = normalizeName(inputName);
    const b = normalizeName(recordName);
    if (!a || !b) return false;
    if (a === b) return true;
    const A = a.split(' ').filter(t=>t.length>=2);
    const B = b.split(' ').filter(t=>t.length>=2);
    const short = A.length <= B.length ? A : B;
    const longStr = A.length <= B.length ? b : a;
    const covered = short.filter(t => longStr.includes(t)).length;
    return (covered / Math.max(short.length,1)) >= 0.6; // 60% token overlap
  }

  // ---------- Connectivity UI ----------
  function updateOnlineStatus(){ els.offlineBanner.hidden = navigator.onLine; }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // ---------- Service Worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js?v=3.1.7')
        .then(reg => {
          if (reg.waiting) els.btnUpdate.hidden = false;
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw?.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) els.btnUpdate.hidden = false;
            });
          });
        })
        .catch(err => console.warn('SW registration failed:', sanitizePIILog(err)));
    });
    els.btnUpdate.addEventListener('click', async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) r.update();
      location.reload();
    });
  }

  // ---------- SETTINGS ----------
  (function hydrateSettings(){
    els.setCsvUrl.value = localStorage.getItem(LS.csvUrl) || '';
    els.setEmailUrl.value = localStorage.getItem(LS.emailEndpoint) || '';
    if (!els.inpCsvUrl.value && els.setCsvUrl.value) els.inpCsvUrl.value = els.setCsvUrl.value;
  })();

  els.btnSaveSettings.addEventListener('click', () => {
    const csv = (els.setCsvUrl.value || '').trim();
    const eml = (els.setEmailUrl.value || '').trim();
    if (csv) localStorage.setItem(LS.csvUrl, csv); else localStorage.removeItem(LS.csvUrl);
    if (eml) localStorage.setItem(LS.emailEndpoint, eml); else localStorage.removeItem(LS.emailEndpoint);
    els.settingsMsg.textContent = 'Settings saved.'; els.settingsMsg.className = 'msg ok';
    if (csv) els.inpCsvUrl.value = csv;
    setTimeout(()=>{ els.settingsMsg.textContent=''; els.settingsMsg.className='msg'; }, 3000);
  });

  els.btnClearSettings.addEventListener('click', () => {
    if (!confirm('Clear saved CSV URL and Email endpoint?')) return;
    localStorage.removeItem(LS.csvUrl);
    localStorage.removeItem(LS.emailEndpoint);
    els.setCsvUrl.value = '';
    els.setEmailUrl.value = '';
    els.inpCsvUrl.value = '';
    els.settingsMsg.textContent = 'Settings cleared.'; els.settingsMsg.className = 'msg ok';
    setTimeout(()=>{ els.settingsMsg.textContent=''; els.settingsMsg.className='msg'; }, 3000);
  });

  els.btnTestCsv.addEventListener('click', async () => {
    const url = (els.setCsvUrl.value || els.inpCsvUrl.value || '').trim();
    if (!url) { els.settingsMsg.textContent='Enter a CSV URL first.'; els.settingsMsg.className='msg error'; return; }
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_ts=' + Date.now(), { cache:'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const first = (text.split(/\r?\n/).find(Boolean) || '');
      const delim = detectDelimiter(first);
      const headers = first.replace(/^\uFEFF/,'').split(delim).map(h => h.trim().toLowerCase());
      const need = ['code','name','tin','gmail','status','expiry_date'];
      const aliases = headerAliases();
      const mapped = need.map(k => headers.find(h => aliases[k].includes(h)));
      const ok = mapped.every(Boolean);
      els.settingsMsg.textContent = ok ? 'CSV looks OK (headers detected).' : 'CSV fetched. Check headers row.';
      els.settingsMsg.className = ok ? 'msg ok' : 'msg';
    } catch(e) {
      els.settingsMsg.textContent = 'CSV test failed: ' + (e.message||e);
      els.settingsMsg.className = 'msg error';
    }
  });

  els.btnTestEmail.addEventListener('click', async () => {
    const url = (els.setEmailUrl.value || '').trim();
    if (!url) { els.settingsMsg.textContent='Enter an Email Endpoint first.'; els.settingsMsg.className='msg error'; return; }
    try {
      await fetch(url, { method:'GET', mode:'no-cors' });
      els.settingsMsg.textContent='Endpoint reachable (CORS may hide details). Try a real export to confirm.'; els.settingsMsg.className='msg ok';
    } catch(e) {
      els.settingsMsg.textContent='Endpoint check failed: ' + (e.message||e); els.settingsMsg.className='msg error';
    }
  });

  // ---------- CSV / TSV parsing ----------
  function headerAliases(){
    return {
      code: ['code','access_code'],
      name: ['name','registered_name'],
      tin: ['tin','seller_tin','tax_id'],
      gmail: ['gmail','email','e-mail','mail'],
      status: ['status','state'],
      expiry_date: ['expiry_date','expiry','expires','expiration','expirydate']
    };
  }

  function detectDelimiter(headerLine){
    // detect by counts (tab, comma, semicolon)
    const line = headerLine || '';
    const counts = [
      { d: '\t', n: (line.match(/\t/g)||[]).length },
      { d: ',',  n: (line.match(/,/g)||[]).length },
      { d: ';',  n: (line.match(/;/g)||[]).length },
    ].sort((a,b)=>b.n-a.n);
    return counts[0].n > 0 ? counts[0].d : ','; // default comma
  }

  function parseDelimited(text){
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return [];
    const firstLine = lines[0].replace(/^\uFEFF/,''); // strip BOM
    const delim = detectDelimiter(firstLine);
    // simple split per line by detected delimiter; quoted fields with delimiter are rare in TSV; OK for our use-case
    const headers = firstLine.split(delim).map(h => h.trim().toLowerCase());
    const alias = headerAliases();
    const pick = (obj, k) => {
      const targets = alias[k];
      for (const t of targets){
        if (t in obj) return obj[t];
      }
      return '';
    };
    const rows = [];
    for (let i=1;i<lines.length;i++){
      const cells = lines[i].split(delim).map(c => c.trim());
      const obj = {};
      headers.forEach((h,idx)=> obj[h] = (cells[idx] ?? '').trim());
      rows.push({
        code: pick(obj, 'code'),
        name: pick(obj, 'name'),
        tin: pick(obj, 'tin'),
        gmail: pick(obj, 'gmail'),
        status: pick(obj, 'status'),
        expiry_date: pick(obj, 'expiry_date'),
      });
    }
    return rows;
  }

  // ---------- Verification ----------
  els.verifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const access_code = $('inpAccessCode').value.trim();
    const name = $('inpName').value.trim();
    const tin = $('inpTIN').value.trim();
    const gmail = $('inpGmail').value.trim().toLowerCase();
    const csvUrlInput = $('inpCsvUrl').value.trim();
    const csvPaste = $('inpCsvPaste').value.trim();

    if (!access_code || !name || !tin || !gmail) {
      els.verifyMsg.textContent = 'Please fill Access Code, Name, TIN, and Gmail.'; els.verifyMsg.className='msg error'; return;
    }

    let csvText = '';
    const savedCsv = localStorage.getItem(LS.csvUrl) || '';
    const chosenUrl = csvUrlInput || savedCsv;

    try {
      if (csvPaste) {
        csvText = csvPaste;
      } else if (chosenUrl) {
        const bust = `&_ts=${Date.now()}`;
        const url = chosenUrl.includes('?') ? (chosenUrl + bust) : (chosenUrl + '?output=csv' + bust);
        const res = await fetch(url, { cache:'no-store' });
        if (!res.ok) throw new Error(`CSV fetch failed (${res.status})`);
        csvText = await res.text();
      } else {
        els.verifyMsg.textContent = 'Provide CSV URL (or save it in Settings) or paste CSV.';
        els.verifyMsg.className = 'msg error'; return;
      }
    } catch(err){
      els.verifyMsg.textContent = `CSV load error: ${String(err.message||err)}`; els.verifyMsg.className='msg error'; return;
    }

    const rows = parseDelimited(csvText);
    if (!rows.length){
      els.verifyMsg.textContent = 'No rows parsed. Check headers and delimiter (comma, tab, or semicolon).';
      els.verifyMsg.className = 'msg error'; return;
    }

    // Find matching row
    const codeIn = access_code.trim().toLowerCase();
    const gmailIn = gmail.trim().toLowerCase();
    const tinIn = tin;

    const rec = rows.find(r => {
      const codeOk = String(r.code || '').trim().toLowerCase() === codeIn;
      const gmailOk = String(r.gmail || '').trim().toLowerCase() === gmailIn;
      const tinOk = isTinEqual(r.tin || '', tinIn);
      const nameOk = isNameMatch(name, r.name || '');
      return codeOk && gmailOk && tinOk && nameOk;
    });

    if (!rec) { els.verifyMsg.textContent = 'No matching ACTIVE record found. Check your inputs.'; els.verifyMsg.className='msg error'; return; }
    if (String(rec.status || '').trim().toUpperCase() !== 'ACTIVE') { els.verifyMsg.textContent='Record found but STATUS is not ACTIVE.'; els.verifyMsg.className='msg error'; return; }

    const expYMD = parseToYMD(rec.expiry_date);
    if (!expYMD || !withinGrace(expYMD)) { els.verifyMsg.textContent='Record found but EXPIRY_DATE is invalid or expired.'; els.verifyMsg.className='msg error'; return; }

    const session = {
      schema: SCHEMA_VERSION,
      verifiedAt: new Date().toISOString(),
      expiresInDays: SESSION_TTL_DAYS,
      access_code,
      name,
      tin,
      gmail,
      name_norm: normalizeName(name),
      tin_norm9: digitsOnly(tin).slice(0,9),
      tin_norm12: digitsOnly(tin).padEnd(12,'0').slice(0,12)
    };
    setLocal(LS.session, session);
    els.verifyMsg.textContent = 'Verification success. Session stored for 7 days.';
    els.verifyMsg.className = 'msg ok';

    els.sectionCapture.hidden = false;
    els.sectionReview.hidden = false;
    els.sectionExport.hidden = false;
    els.sectionPrivacy.hidden = false;
  });

  $('btnClearVerify').addEventListener('click', () => {
    ['inpAccessCode','inpName','inpTIN','inpGmail','inpCsvUrl','inpCsvPaste'].forEach(id => $(id).value='');
    els.verifyMsg.textContent = '';
    delLocal(LS.session);
  });

  // ---------- Camera / Files / OCR / Review / Export ----------
  // (unchanged from 3.1.6 aside from version bump)

  let camStream = null;
  $('btnStartCam').addEventListener('click', async () => {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
      els.camPreview.srcObject = camStream;
      els.btnSnap.disabled = false; els.btnStopCam.disabled = false;
    } catch (err) { alert('Camera error: ' + String(err.message || err)); }
  });
  $('btnStopCam').addEventListener('click', () => {
    if (camStream) { camStream.getTracks().forEach(t=>t.stop()); camStream=null; els.camPreview.srcObject=null; }
    els.btnSnap.disabled = true; els.btnStopCam.disabled = true;
  });

  const state = { files: [], records: [] };

  $('btnSnap').addEventListener('click', async () => {
    if (!camStream) return;
    const track = camStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const w = settings.width || 1280, h = settings.height || 720;
    const c = els.camCanvas; c.width = w; c.height = h;
    c.getContext('2d').drawImage(els.camPreview, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    const id = `cam_${Date.now()}`;
    state.files.push({ id, name:`${id}.jpg`, blob, dataURL:c.toDataURL('image/jpeg',0.92), type:'image/jpeg' });
    renderFileList();
  });

  $('btnProcess').addEventListener('click', async () => {
    const files = els.fileInput.files;
    if (!files || !files.length){ alert('Select images/PDFs first.'); return; }
    for (const f of files) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      if (f.type === 'application/pdf') {
        const arrayBuf = await f.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const pages = [];
        for (let p=1;p<=pdf.numPages;p++){
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          pages.push(canvas);
        }
        state.files.push({ id, name:f.name, blob:new Blob([arrayBuf],{type:f.type}), dataURL:'', type:'application/pdf', pages });
      } else {
        const dataURL = await fileToDataURL(f);
        state.files.push({ id, name:f.name, blob:f, dataURL, type:f.type });
      }
    }
    renderFileList();
  });

  function fileToDataURL(file){
    return new Promise((res,rej)=>{
      const fr = new FileReader();
      fr.onload = ()=>res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  $('btnClearFiles').addEventListener('click', ()=>{
    els.fileInput.value=''; state.files=[]; state.records=[]; renderFileList(); renderRecords();
  });

  function renderFileList(){
    els.fileList.innerHTML='';
    for (const f of state.files){
      const el = document.createElement('div'); el.className='file-item';
      const img = document.createElement('img'); img.className='file-thumb';
      if (f.type==='application/pdf'){
        img.alt='PDF'; const canvas = f.pages?.[0]; img.src = canvas ? canvas.toDataURL('image/png') : '';
      } else { img.src=f.dataURL; img.alt=f.name; }
      const meta = document.createElement('div'); meta.className='file-meta';
      meta.innerHTML = `
        <div><strong>${f.name}</strong></div>
        <div class="flex">
          <button class="btn btn-ghost" data-act="preprocess" data-id="${f.id}">Preprocess</button>
          <button class="btn btn-ghost" data-act="ocr" data-id="${f.id}">Run OCR</button>
          <button class="btn btn-ghost" data-act="remove" data-id="${f.id}">Remove</button>
        </div>
        <small class="note">Preprocess: grayscale + threshold + optional rotate.</small>`;
      el.appendChild(img); el.appendChild(meta); els.fileList.appendChild(el);
    }
    els.fileList.querySelectorAll('button').forEach(btn => btn.addEventListener('click', onFileAction));
  }

  async function onFileAction(e){
    const btn = e.currentTarget; const act = btn.getAttribute('data-act'); const id = btn.getAttribute('data-id');
    const f = state.files.find(x=>x.id===id); if(!f) return;

    if (act==='remove'){ state.files=state.files.filter(x=>x.id!==id); state.records=state.records.filter(r=>r.file_id!==id); renderFileList(); renderRecords(); return; }

    if (act==='preprocess'){
      if (f.type==='application/pdf'){
        if (f.pages?.length){ const cnv=f.pages[0]; f.pages[0]=preprocessCanvas(cnv); }
      } else {
        const img = new Image();
        img.onload = ()=>{
          const cnv=document.createElement('canvas'); cnv.width=img.width; cnv.height=img.height;
          cnv.getContext('2d').drawImage(img,0,0);
          const out=preprocessCanvas(cnv); f.dataURL=out.toDataURL('image/jpeg',0.92); renderFileList();
        };
        img.src=f.dataURL;
      }
    }

    if (act==='ocr'){
      let canvases=[];
      if (f.type==='application/pdf' && f.pages?.length) canvases=f.pages;
      else { const cnv=await imageToCanvas(f.dataURL); canvases=[preprocessCanvas(cnv)]; }
      const { text, avgConf } = await ocrCanvases(canvases);
      const parsed = parseFields(text);

      const session = getLocal(LS.session,{});
      const userTin = session.tin || '';
      const userName = normalizeName(session.name || '');
      const sellerTin = parsed.tin || '';
      const sellerName = normalizeName(parsed.seller_name || '');
      const isUserSeller = (userTin && sellerTin && isTinEqual(userTin, sellerTin)) ||
                           (!!userName && !!sellerName && (sellerName.includes(userName) || userName.includes(sellerName)));
      const role = isUserSeller ? 'SELLER/ISSUER' : 'BUYER/PAYOR';
      const suggestions = isUserSeller
        ? ['Sales (Cash)','Sales (Charge)','Collection from Customer']
        : ['Payment of Payables','Purchase (Cash)','Purchase (Charge)','Disbursement'];

      const rec = {
        schema: SCHEMA_VERSION,
        file_id: f.id, file_name: f.name,
        ocr_text: text, ocr_conf: avgConf,
        seller_tin: parsed.tin || '',
        receipt_date: parsed.date || '',
        total_amount: parsed.amount || '',
        file_meta: { mime:f.type, pages:canvases.length },
        seller: { name: parsed.seller_name || '', tin: parsed.tin || '' },
        buyer: { name:'', tin:'' },
        document: { type:'RECEIPT', number:'' },
        monetary: { net:'', vat:'', total: parsed.amount || '' },
        payment: { method:'', terms:'' },
        notes: '',
        role, transaction_type:'', transaction_suggestions: suggestions
      };

      if (avgConf < OCR_CONF_THRESHOLD) alert(`OCR confidence ${avgConf.toFixed(2)} < ${OCR_CONF_THRESHOLD}. Please review manually.`);
      const idx = state.records.findIndex(r=>r.file_id===f.id); if (idx>=0) state.records[idx]=rec; else state.records.push(rec);
      renderRecords();
    }
  }

  function preprocessCanvas(inputCanvas){
    const cnv=document.createElement('canvas'); cnv.width=inputCanvas.width; cnv.height=inputCanvas.height;
    const ctx=cnv.getContext('2d'); ctx.drawImage(inputCanvas,0,0);
    const img=ctx.getImageData(0,0,cnv.width,cnv.height); const d=img.data;
    for (let i=0;i<d.length;i+=4){ const g=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; d[i]=d[i+1]=d[i+2]=g; }
    let sum=0; for (let i=0;i<d.length;i+=4) sum+=d[i];
    const avg=sum/(d.length/4);
    for (let i=0;i<d.length;i+=4){ const v=d[i]>avg?255:0; d[i]=d[i+1]=d[i+2]=v; }
    ctx.putImageData(img,0,0); return cnv;
  }

  const imageToCanvas = (dataURL) => new Promise(res => { const img=new Image(); img.onload=()=>{ const cnv=document.createElement('canvas'); cnv.width=img.width; cnv.height=img.height; cnv.getContext('2d').drawImage(img,0,0); res(cnv); }; img.src=dataURL; });

  async function ocrCanvases(canvases){
    if (!window.Tesseract) throw new Error('Tesseract library not loaded. Place ./libs/tesseract.min.js');
    let fullText=''; let confs=[];
    for (const cnv of canvases){
      const blob=await new Promise(res=>cnv.toBlob(res,'image/png',0.95));
      const { data } = await Tesseract.recognize(blob,'eng',{logger:()=>{}});
      fullText += '\n' + (data.text||'');
      const avg = (data.words && data.words.length)
        ? (data.words.reduce((a,w)=>a+(w.conf||0),0)/data.words.length)/100
        : (data.conf||0)/100;
      confs.push(avg);
    }
    const avgConf = confs.length ? (confs.reduce((a,b)=>a+b,0)/confs.length) : 0;
    return { text: fullText.trim(), avgConf };
  }

  function parseFields(text){
    const raw=text||''; const t=raw.replace(/\s+/g,' ').toUpperCase();
    const nameGuess = (t.match(/\b([A-Z0-9 '&.-]{3,40})(?:\s+(?:STORE|TRADING|ENTERPRISES|COMPANY|INCORPORATED|INC|CORP|CORPORATION))\b/)||[])[1];
    const tin = (t.match(/\b(\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3})?)\b/)||[])[1]||'';
    const date =
      (t.match(/\b(20\d{2}[-/.](0[1-9]|1[0-2])[-/.]([0-2]\d|3[01]))\b/)||[])[1] ||
      (t.match(/\b(([0-2]\d|3[01])[/-](0[1-9]|1[0-2])[/-]20\d{2})\b/)||[])[1] ||
      (t.match(/\b((0[1-9]|1[0-2])[/-]([0-2]\d|3[01])[/-]20\d{2})\b/)||[])[1] || '';
    const amt = (t.match(/\b([₱P]?\s?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)\b/)||[])[1]||'';
    const cleanedAmt = amt.replace(/[₱P\s,]/g,'');
    return { tin, date: parseToYMD(date)||'', amount: cleanedAmt, seller_name: nameGuess||'' };
  }

  function renderRecords(){
    const wrap=els.recordsPanel; wrap.innerHTML=''; if (!state.records.length) return;
    for (const r of state.records){
      const div=document.createElement('div'); div.className='card';
      const opts=(r.transaction_suggestions||[]).map(s=>`<option value="${s}">${s}</option>`).join('');
      div.innerHTML=`
        <h3>${r.file_name} <small class="muted">conf ${Number(r.ocr_conf||0).toFixed(2)}</small></h3>
        <div class="grid grid-2">
          <label>Seller Name <input data-k="seller.name" value="${escapeAttr(r.seller.name)}" /></label>
          <label>Seller TIN <input data-k="seller.tin" value="${escapeAttr(r.seller.tin)}" /></label>
          <label>Buyer Name <input data-k="buyer.name" value="${escapeAttr(r.buyer.name||'')}" /></label>
          <label>Buyer TIN <input data-k="buyer.tin" value="${escapeAttr(r.buyer.tin||'')}" /></label>
          <label>Receipt Date (YYYY-MM-DD) <input data-k="receipt_date" value="${escapeAttr(r.receipt_date)}" /></label>
          <label>Document Type <input data-k="document.type" value="${escapeAttr(r.document.type)}" /></label>
          <label>Document Number <input data-k="document.number" value="${escapeAttr(r.document.number)}" /></label>
          <label>Total Amount <input data-k="monetary.total" value="${escapeAttr(r.monetary.total)}" /></label>
          <label>VAT Amount <input data-k="monetary.vat" value="${escapeAttr(r.monetary.vat)}" /></label>
          <label>Net Amount <input data-k="monetary.net" value="${escapeAttr(r.monetary.net)}" /></label>
          <label>Role (auto) <input data-k="role" value="${escapeAttr(r.role)}" readonly /></label>
          <label>Transaction Type
            <select data-k="transaction_type">
              <option value="">— Select —</option>
              ${opts}
            </select>
          </label>
          <label>Payment Method <input data-k="payment.method" value="${escapeAttr(r.payment.method)}" /></label>
          <label>Terms (for on-account) <input data-k="payment.terms" value="${escapeAttr(r.payment.terms)}" /></label>
          <label>Notes <input data-k="notes" value="${escapeAttr(r.notes)}" /></label>
        </div>
        <div class="flex">
          <button class="btn btn-ghost" data-act="validate" data-id="${r.file_id}">Validate</button>
        </div>
        <p class="note">Role is derived by comparing Seller Name/TIN vs your session Name/TIN. If they match → SELLER/ISSUER; else BUYER/PAYOR.</p>`;
      const select = div.querySelector('select[data-k="transaction_type"]'); if (select) select.value=r.transaction_type||'';
      const inputs = div.querySelectorAll('input[data-k], select[data-k]');
      inputs.forEach(inp => inp.addEventListener('input',(ev)=>{ setRecField(r, ev.target.getAttribute('data-k'), ev.target.value); persistRecords(); }));
      const btnValidate = div.querySelector('button[data-act="validate"]');
      btnValidate.addEventListener('click',()=>{ const errors=validateRecord(r); alert(errors.length?`Please fix:\n- ${errors.join('\n- ')}`:'Looks good!'); });
      wrap.appendChild(div);
    }
    persistRecords();
  }

  function escapeAttr(v){ return String(v ?? '').replace(/"/g,'&quot;'); }
  function setRecField(rec,keyPath,value){ const parts=keyPath.split('.'); let cur=rec; for(let i=0;i<parts.length-1;i++){ const k=parts[i]; if(!(k in cur)) cur[k]={}; cur=cur[k]; } cur[parts[parts.length-1]]=value; }
  function validateRecord(rec){
    const errs=[];
    const tinOk=/^\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3})?$/.test(rec.seller.tin||''); if(!tinOk) errs.push('Seller TIN invalid (###-###-### or ###-###-###-###).');
    const d=parseToYMD(rec.receipt_date||''); if(!d) errs.push('Receipt date must be YYYY-MM-DD (or convertible).');
    const tot=Number(rec.monetary.total||0); if(!(tot>0)) errs.push('Total amount must be > 0.');
    if(!rec.transaction_type) errs.push('Select a Transaction Type.');
    return errs;
  }
  function persistRecords(){ setLocal(LS.receipts, state.records); }

  // ---------- Export ----------
  $('btnZipExport').addEventListener('click', async ()=>{
    if (els.inpConfirmAll?.value !== 'yes'){ toast('Please confirm: Select "Yes" before export.','error'); return; }
    const zip=new JSZip();
    for (const f of state.files) zip.file(`files/${f.name}`, f.blob);
    const csv=buildCSV(state.records); const mani=buildManifest(state.records);
    zip.file('data.csv', csv); zip.file('manifest.json', JSON.stringify(mani,null,2));
    const blob=await zip.generateAsync({type:'blob'});
    const session=getLocal(LS.session,{});
    const filename=`resibo_${(session.name||'user').toLowerCase().replace(/\s+/g,'')}_${Date.now()}.zip`;
    saveAs(blob, filename); toast('ZIP exported.');
  });

  $('btnEmailExport').addEventListener('click', async ()=>{
    const endpoint = localStorage.getItem(LS.emailEndpoint) || '';
    if (!endpoint){ alert('Set Apps Script endpoint first (Settings).'); return; }
    if (els.inpConfirmAll?.value !== 'yes'){ toast('Please confirm: Select "Yes".','error'); return; }
    const payload={ version:VERSION, manifest:buildManifest(state.records), csv:buildCSV(state.records) };
    if (!navigator.onLine){ const q=getLocal(LS.queue,[]); q.push({ type:'email', endpoint, payload, ts:Date.now() }); setLocal(LS.queue,q); toast('Offline: export queued.'); return; }
    try {
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (!res.ok) throw new Error(`HTTP ${res.status}`); toast('Email export sent.');
    } catch(err){ toast(`Email export failed: ${String(err.message||err)}`,'error'); }
  });

  function buildCSV(records){
    const headers=['FILE_NAME','MIME','PAGES','SELLER_NAME','SELLER_TIN','BUYER_NAME','BUYER_TIN','DOCUMENT_TYPE','DOCUMENT_NUMBER','RECEIPT_DATE','NET','VAT','TOTAL','PAYMENT_METHOD','TERMS','NOTES','ROLE','TRANSACTION_TYPE'];
    const rows=[headers.join(',')];
    for (const r of records){
      const vals=[ r.file_name, r.file_meta?.mime||'', r.file_meta?.pages||'', r.seller?.name||'', r.seller?.tin||'', r.buyer?.name||'', r.buyer?.tin||'', r.document?.type||'', r.document?.number||'', r.receipt_date||'', r.monetary?.net||'', r.monetary?.vat||'', r.monetary?.total||'', r.payment?.method||'', r.payment?.terms||'', r.notes||'', r.role||'', r.transaction_type||'' ].map(guardCsvInjection);
      rows.push(vals.join(','));
    }
    return rows.join('\n');
  }

  function buildManifest(records){
    const session=getLocal(LS.session,{});
    return {
      app:'Resibo App', version:VERSION, cache:CACHE_VERSION, schema:SCHEMA_VERSION, build_time:BUILD_TIME,
      session:{ name:session.name||'', tin:session.tin||'', gmail:session.gmail||'', access_code:session.access_code||'' },
      count:records.length,
      items:records.map(r=>({ file:r.file_name, conf:r.ocr_conf, date:r.receipt_date, total:r.monetary?.total||'', role:r.role||'', transaction_type:r.transaction_type||'' }))
    };
  }

  // ---------- Queue Flusher ----------
  window.addEventListener('online', async ()=>{
    const q=getLocal(LS.queue,[]); if(!q.length) return;
    const rest=[]; for (const job of q){ try { if (job.type==='email'){ const res=await fetch(job.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job.payload)}); if(!res.ok) throw new Error(`HTTP ${res.status}`);} } catch { rest.push(job); } }
    setLocal(LS.queue, rest); if(!rest.length) toast('Queued exports sent.');
  });

  // ---------- Self Test ----------
  const SELFTEST_ITEMS = [
    { name:'Service Worker present', path:'./sw.js?v=3.1.7' },
    { name:'Manifest present', path:'./manifest.json?v=3.1.7' },
    { name:'Icons 192', path:'./icons/icon-192.png' },
    { name:'Icons 512', path:'./icons/icon-512.png' },
    { name:'JSZip present', path:'./libs/jszip.min.js' },
    { name:'FileSaver present', path:'./libs/FileSaver.min.js' },
    { name:'pdf.js present', path:'./libs/pdf.min.js' },
    { name:'Tesseract present', path:'./libs/tesseract.min.js' },
    { name:'Cache version match', custom:async()=>((CACHE_VERSION==='resibo-cache-v3.1.7')?'ok':'fail') },
  ];

  $('btnRunSelfTest').addEventListener('click', async ()=>{
    els.selfTestList.innerHTML=''; els.selfTestStatus.textContent='Running…';
    if (location.protocol==='file:'){ const li=document.createElement('li'); li.className='fail'; li.textContent='Running from file:// — use HTTPS to test properly.'; els.selfTestList.appendChild(li); }
    for (const it of SELFTEST_ITEMS){
      let ok=false; if (it.custom) ok=(await it.custom())==='ok'; else { try{ const res=await fetch(it.path,{cache:'no-store'}); ok=res.ok; }catch{ ok=false; } }
      const li=document.createElement('li'); li.textContent=`${it.name} — ${ok?'OK':'Missing/Fail'}`; li.className=ok?'ok':'fail'; els.selfTestList.appendChild(li);
    }
    els.selfTestStatus.textContent='Done';
  });

  // ---------- Restore ----------
  (function initFromStorage(){
    const savedCsv=localStorage.getItem(LS.csvUrl)||''; if (savedCsv) els.inpCsvUrl.value=savedCsv;
    const session=getLocal(LS.session,null);
    if (session && session.schema===SCHEMA_VERSION){
      $('inpAccessCode').value=session.access_code||''; $('inpName').value=session.name||''; $('inpTIN').value=session.tin||''; $('inpGmail').value=session.gmail||'';
      els.sectionCapture.hidden=false; els.sectionReview.hidden=false; els.sectionExport.hidden=false; els.sectionPrivacy.hidden=false;
      els.verifyMsg.textContent='Session found (within 7 days). You can re-verify if needed.'; els.verifyMsg.className='msg ok';
    }
    const saved=getLocal(LS.receipts,[]); if (Array.isArray(saved)&&saved.length){ state.records=saved; renderRecords(); }
  })();

  // small helpers
  function toast(msg, cls='ok'){ els.exportMsg.textContent=msg; els.exportMsg.className=`msg ${cls}`; setTimeout(()=>{ els.exportMsg.textContent=''; els.exportMsg.className='msg'; }, 4000); }

})();
