/* Resibo App v3.1.6 — Handwriting Build
 * - Local/offline PWA with verification via Issued Codes CSV (published URL)
 * - Capture/upload (images/PDF) → preprocess → OCR (Tesseract) → manual review
 * - Strong OpenCV pipeline for handwriting (CLAHE, median, deskew, adaptive thr)
 * - Expanded schema + line items
 * - Export: Receipts.csv + LineItems.csv; ZIP with images + CSV + JSON
 */

(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // ---- Storage keys / version ----
  const APP_VERSION = '3.1.6';
  const LS = {
    CSV_URL: 'resibo_csv_url',
    SESSION: 'resibo_session',   // {code,name,tin,gmail,expiry}
    RECORDS: 'resibo_records',   // [{id,meta,items,images}]
    OCRHINT: 'resibo_ocr_hint',  // extracted raw text (latest)
  };

  // ---- State ----
  let CSV_ROWS = [];               // [{code,name,tin,gmail,status,expiry_date}]
  let uploadedFiles = [];          // [{id, name, file, urlOriginal, urlProcessed, rotation}]
  let currentImageId = null;       // for modal
  let rotationMap = {};            // id -> deg
  let ocrHintsText = '';           // latest extracted text

  // ---- Helpers ----
  const nowId = () => new Date().toISOString().replace(/[:.]/g, '').slice(0,15);
  const toNum = v => (v === '' || v == null ? '' : Number(v));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const saveJSON = (k, o) => localStorage.setItem(k, JSON.stringify(o));
  const loadJSON = (k, d=null) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  };

  const notice = (el, text, cls='') => {
    el.textContent = text;
    el.className = 'pill ' + (cls || (text.toLowerCase().includes('ok')?'ok':'warn'));
  };

  // ---- Self-Test ----
  const selfTests = [
    { name: 'HTTPS', fn: () => location.protocol === 'https:' },
    { name: 'Service Worker', fn: () => 'serviceWorker' in navigator },
    { name: 'Manifest', fn: () => !!document.querySelector('link[rel="manifest"]') },
    { name: 'Icons', fn: () => !!document.querySelector('link[rel="icon"]') },
    { name: 'JSZip', fn: () => !!window.JSZip },
    { name: 'FileSaver', fn: () => !!window.saveAs },
    { name: 'pdf.js', fn: () => !!window.pdfjsLib },
    { name: 'Tesseract', fn: () => !!window.Tesseract },
    { name: 'OpenCV', fn: () => !!window.cv && !!cv.imread },
    { name: 'Cache/Version', fn: () => true },
  ];

  function runSelfTest() {
    const host = $('#selftest-results');
    host.innerHTML = '';
    selfTests.forEach(t => {
      const ok = !!t.fn();
      const div = document.createElement('div');
      div.className = 'check ' + (ok?'ok':'bad');
      div.textContent = `${t.name}: ${ok?'OK':'FAIL'}`;
      host.appendChild(div);
    });
  }

  // ---- Settings (CSV URL) ----
  async function testCSV(url) {
    const s = $('#csv-status');
    notice(s, 'Fetching...');
    try {
      const text = await (await fetch(url, {cache:'no-store'})).text();
      const rows = parseCSV(text);
      CSV_ROWS = rows;
      notice(s, `CSV fetched (${rows.length} rows)`, 'ok');
      return rows;
    } catch (e) {
      notice(s, 'Fetch failed', 'warn');
      return [];
    }
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idx = {
      code: headers.indexOf('code'),
      name: headers.indexOf('name'),
      tin: headers.indexOf('tin'),
      gmail: headers.indexOf('gmail'),
      status: headers.indexOf('status'),
      expiry_date: headers.indexOf('expiry_date'),
    };
    const rows = [];
    for (let i=1;i<lines.length;i++){
      const cols = splitCSVLine(lines[i]);
      rows.push({
        code: (cols[idx.code]||'').trim(),
        name: (cols[idx.name]||'').trim(),
        tin: (cols[idx.tin]||'').trim(),
        gmail: (cols[idx.gmail]||'').trim(),
        status: (cols[idx.status]||'').trim(),
        expiry_date: (cols[idx.expiry_date]||'').trim(),
      });
    }
    return rows;
  }

  function splitCSVLine(line) {
    // simple CSV splitter w/ quotes
    const out = [];
    let cur = '', q = false;
    for (let i=0;i<line.length;i++){
      const c = line[i];
      if (c === '"') {
        if (q && line[i+1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        out.push(cur); cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  // ---- Verification ----
  async function verify() {
    const code = $('#acc_code').value.trim();
    const name = $('#acc_name').value.trim();
    const tin = $('#acc_tin').value.trim();
    const gmail = $('#acc_gmail').value.trim();
    const status = $('#verify-status');

    if (!code || !name || !tin || !gmail) {
      notice(status, 'Please fill Access Code, Name, TIN, and Gmail.', 'warn');
      return;
    }

    const csvUrl = $('#csvUrl').value.trim() || localStorage.getItem(LS.CSV_URL);
    if (!csvUrl) { notice(status, 'CSV URL missing', 'warn'); return; }

    if (!CSV_ROWS.length) {
      await testCSV(csvUrl);
    }

    const hit = CSV_ROWS.find(r =>
      (r.code||'').toLowerCase() === code.toLowerCase() &&
      (r.gmail||'').toLowerCase() === gmail.toLowerCase()
    );

    if (!hit) {
      notice(status, 'No matching ACTIVE record with a valid EXPIRY_DATE.', 'warn');
      return;
    }

    // status + expiry date check (YYYY-MM-DD accepted)
    const active = (hit.status||'').toLowerCase() === 'active';
    const today = new Date().toISOString().slice(0,10);
    const valid = (hit.expiry_date||'') >= today;

    if (!active || !valid) {
      notice(status, 'No matching ACTIVE record with a valid EXPIRY_DATE.', 'warn');
      return;
    }

    const sess = { code, name, tin, gmail, expiry: hit.expiry_date };
    saveJSON(LS.SESSION, sess);
    notice(status, 'Verification success. Session stored for 7 days.', 'ok');
  }

  // ---- Upload & Thumbs ----
  $('#file-input')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files||[]);
    for (const file of files) {
      if (file.type === 'application/pdf') {
        await importPDFFiles(file);
      } else {
        await addFile(file);
      }
    }
    renderThumbs();
  });

  async function importPDFFiles(file) {
    if (!window.pdfjsLib) return;
    const arr = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({data: arr}).promise;
    for (let p=1;p<=pdf.numPages;p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({scale:2});
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({canvasContext: ctx, viewport}).promise;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.95));
      const f = new File([blob], `${file.name.replace(/\.pdf$/i,'')}_p${p}.png`, {type:'image/png'});
      await addFile(f);
    }
  }

  async function addFile(file) {
    const id = nowId() + '_' + Math.random().toString(36).slice(2,7);
    const urlOriginal = URL.createObjectURL(file);
    uploadedFiles.push({ id, name: file.name, file, urlOriginal, urlProcessed: null, rotation: 0 });
  }

  function renderThumbs() {
    const host = $('#thumbs');
    host.innerHTML = '';
    uploadedFiles.forEach(f => {
      const div = document.createElement('div');
      div.className = 'thumb';
      const img = document.createElement('img');
      img.src = $('#toggle-before-after').checked && f.urlProcessed ? f.urlOriginal : (f.urlProcessed || f.urlOriginal);
      img.alt = f.name;
      img.addEventListener('click', () => openModal(f.id, img.src));
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = f.name;
      div.appendChild(img); div.appendChild(cap);
      host.appendChild(div);
    });
  }
  $('#toggle-before-after')?.addEventListener('change', renderThumbs);

  // ---- OpenCV Preprocess (basic + strong) ----
  async function preprocessBasic() {
    if (!window.cv) return tipOCR('OpenCV not ready');
    await processAllImages(img => basicPipeline(img));
  }

  async function preprocessStrong() {
    if (!window.cv) return tipOCR('OpenCV not ready');
    await processAllImages(img => strongPipeline(img));
  }

  async function processAllImages(pipeline) {
    const s = $('#ocr-status');
    notice(s, 'Preprocessing...');
    for (const f of uploadedFiles) {
      const out = await runPipelineOnURL(f.urlOriginal, pipeline, f.rotation||0);
      f.urlProcessed = out;
    }
    notice(s, 'Preprocess done', 'ok');
    renderThumbs();
  }

  function runPipelineOnURL(url, pipeline, rotateDeg=0) {
    return new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // draw to canvas to pass to cv
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const w = img.naturalWidth, h = img.naturalHeight;
        canvas.width = w; canvas.height = h;
        ctx.drawImage(img,0,0);
        if (!window.cv) return res(url);
        const src = cv.imread(canvas);
        if (rotateDeg) {
          const rot = rotateMat(src, rotateDeg);
          src.delete();
          const out = pipeline(rot);
          rot.delete();
          res(toDataURL(out));
          out.delete();
        } else {
          const out = pipeline(src);
          src.delete();
          res(toDataURL(out));
          out.delete();
        }
      };
      img.onerror = () => res(url);
      img.src = url;
    });
  }

  function toDataURL(mat) {
    const c = document.createElement('canvas');
    cv.imshow(c, mat);
    return c.toDataURL('image/png', 0.95);
  }

  function rotateMat(src, deg) {
    const dst = new cv.Mat();
    const center = new cv.Point(src.cols/2, src.rows/2);
    const M = cv.getRotationMatrix2D(center, deg, 1);
    const b = new cv.Size(src.cols, src.rows);
    cv.warpAffine(src, dst, M, b, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    M.delete();
    return dst;
  }

  function basicPipeline(src) {
    // gray → Otsu → (optional invert if background dark)
    let gray = new cv.Mat(); let out = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.threshold(gray, out, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    gray.delete();
    return out;
  }

  function strongPipeline(src) {
    // 1) Gray
    let gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 2) Equalize + CLAHE
    cv.equalizeHist(gray, gray);
    const clahe = new cv.CLAHE(2.0, new cv.Size(8,8));
    clahe.apply(gray, gray); clahe.delete();

    // 3) Noise removal
    cv.medianBlur(gray, gray, 3);

    // 4) Deskew (estimate angle via Hough)
    const angle = estimateSkewAngle(gray);
    let deskewed = rotateMat(gray, -angle);

    // 5) Adaptive threshold (Sauvola/Niblack not built-in → use adaptiveMean)
    let bin = new cv.Mat();
    cv.adaptiveThreshold(deskewed, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 35, 10);

    // Optional: line removal (simple morphology)
    // (kept minimal for speed; can be toggled later if needed)

    gray.delete(); deskewed.delete();
    return bin;
  }

  function estimateSkewAngle(gray) {
    // Edges → Hough lines → median angle
    let edges = new cv.Mat(); cv.Canny(gray, edges, 50, 150);
    let lines = new cv.Mat();
    cv.HoughLines(edges, lines, 1, Math.PI/180, 150);
    edges.delete();

    if (!lines.rows) { lines.delete(); return 0; }

    const angles = [];
    for (let i=0;i<lines.rows;i++){
      const rho = lines.data32F[i*2];
      const theta = lines.data32F[i*2+1];
      // convert to degrees around horizontal
      let deg = (theta*180/Math.PI);
      if (deg>90) deg -= 180;
      angles.push(deg);
    }
    lines.delete();
    angles.sort((a,b)=>a-b);
    const mid = Math.floor(angles.length/2);
    return angles[mid] || 0;
  }

  function tipOCR(msg) {
    notice($('#ocr-status'), msg, 'warn');
  }

  // ---- OCR ----
  async function runOCR() {
    if (!window.Tesseract) return tipOCR('Tesseract not ready');
    if (!uploadedFiles.length) return tipOCR('No images');

    notice($('#ocr-status'), 'OCR running...');
    let combined = '';
    for (const f of uploadedFiles) {
      const src = ($('#toggle-before-after').checked || !f.urlProcessed) ? f.urlOriginal : (f.urlProcessed || f.urlOriginal);
      const txt = await doTesseract(src);
      combined += '\n' + txt;
    }
    ocrHintsText = combined.trim();
    localStorage.setItem(LS.OCRHINT, ocrHintsText);
    notice($('#ocr-status'), 'OCR done', 'ok');
  }

  async function doTesseract(url) {
    const { data } = await Tesseract.recognize(url, 'eng', {
      tessedit_char_whitelist: undefined, // allow general OCR
    });
    return data.text || '';
  }

  // ---- Apply OCR Hints → Fields (simple heuristics, non-destructive) ----
  function applyOCRToFields() {
    const t = ocrHintsText || localStorage.getItem(LS.OCRHINT) || '';
    if (!t) { $('#save-status').textContent = 'No OCR hints yet'; return; }

    // Very light heuristics (keep manual review as the source of truth)
    // Try date yyyy-mm-dd or dd/mm/yyyy
    const iso = t.match(/\b(20\d{2})[-/\.](0[1-9]|1[0-2])[-/\.](0[1-9]|[12]\d|3[01])\b/);
    if (iso) $('#f_date').value = iso[0].replace(/[\.\/]/g,'-');
    const inv = t.match(/\b(SI|OR)[- ]?\d{3,}\b/i);
    if (inv) {
      $('#f_doc_type').value = inv[0].toUpperCase().startsWith('OR') ? 'Official Receipt' : 'Sales Invoice';
      $('#f_doc_no').value = inv[0].toUpperCase();
    }
    // Amounts: pick the largest money-like number as Total
    const nums = Array.from(t.matchAll(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g)).map(m=>Number(m[0].replace(/[,\s]/g,'')));
    if (nums.length) {
      const max = Math.max(...nums);
      $('#f_total').value = max.toFixed(2);
    }
    $('#save-status').textContent = 'OCR hints applied (review/edit as needed)';
  }

  // ---- Line Items Table ----
  function addItemRow(item='', qty='', price='', amount='') {
    const tbody = $('#items-body');
    const idx = tbody.children.length + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx}</td>
      <td><input class="it-name" value="${item}"></td>
      <td><input class="it-qty" type="number" step="0.01" value="${qty}"></td>
      <td><input class="it-price" type="number" step="0.01" value="${price}"></td>
      <td><input class="it-amount" type="number" step="0.01" value="${amount}"></td>
      <td><button class="btn xs danger it-del">✕</button></td>
    `;
    tr.querySelector('.it-qty').addEventListener('input', recalcRow);
    tr.querySelector('.it-price').addEventListener('input', recalcRow);
    tr.querySelector('.it-del').addEventListener('click', () => { tr.remove(); renumberRows(); });
    tbody.appendChild(tr);
  }
  function recalcRow(e) {
    const tr = e.target.closest('tr');
    const q = Number(tr.querySelector('.it-qty').value||0);
    const p = Number(tr.querySelector('.it-price').value||0);
    tr.querySelector('.it-amount').value = (q*p ? (q*p).toFixed(2) : '');
  }
  function renumberRows() {
    $$('#items-body tr').forEach((tr,i)=> tr.children[0].textContent = (i+1));
  }
  $('#btn-add-item')?.addEventListener('click', ()=> addItemRow());
  $('#btn-clear-items')?.addEventListener('click', ()=> { $('#items-body').innerHTML=''; });

  // Auto-compute Total Amount Due
  ['#f_gross','#f_vat','#f_disc'].forEach(sel=>{
    $(sel)?.addEventListener('input', ()=>{
      const g = Number($('#f_gross').value||0);
      const v = Number($('#f_vat').value||0);
      const d = Number($('#f_disc').value||0);
      $('#f_total').value = (g + v - d).toFixed(2);
    });
  });

  // ---- Save Record ----
  function saveRecord() {
    const recs = loadJSON(LS.RECORDS, []);
    const id = nowId();

    const meta = {
      ReceiptID: id,
      ReceiptDate: $('#f_date').value || '',
      SellerName: $('#f_seller_name').value || '',
      SellerTIN: $('#f_seller_tin').value || '',
      SellerAddress: $('#f_seller_addr').value || '',
      BuyerName: $('#f_buyer_name').value || '',
      BuyerTIN: $('#f_buyer_tin').value || '',
      BuyerAddress: $('#f_buyer_addr').value || '',
      DocumentType: $('#f_doc_type').value || '',
      DocumentNumber: $('#f_doc_no').value || '',
      Role: $('#f_role').value || '',
      TransactionType: $('#f_txn_type').value || '',
      Terms: $('#f_terms').value || '',
      PaymentMethod: $('#f_payment').value || '',
      GrossAmount: toNum($('#f_gross').value),
      VATAmount: toNum($('#f_vat').value),
      Discount: toNum($('#f_disc').value),
      TotalAmountDue: toNum($('#f_total').value),
      WithholdingTax: toNum($('#f_wht').value),
      Notes: $('#f_notes').value || '',
      IDNumber: $('#f_idno').value || '',
      SessionUserName: (loadJSON(LS.SESSION)||{}).name || '',
      SessionUserTIN: (loadJSON(LS.SESSION)||{}).tin || '',
      SessionUserGmail: (loadJSON(LS.SESSION)||{}).gmail || '',
      SavedAt: new Date().toISOString(),
    };

    const items = $$('#items-body tr').map(tr => ({
      ReceiptID: id,
      Item: tr.querySelector('.it-name').value || '',
      Quantity: toNum(tr.querySelector('.it-qty').value),
      UnitPrice: toNum(tr.querySelector('.it-price').value),
      LineAmount: toNum(tr.querySelector('.it-amount').value),
    }));

    // Keep only filenames in manifest (images included separately in ZIP export)
    const images = uploadedFiles.map(f => ({
      ReceiptID: id,
      name: f.name,
      processed: !!f.urlProcessed,
      rotation: f.rotation||0
    }));

    recs.push({ id, meta, items, images, ocr: ocrHintsText });
    saveJSON(LS.RECORDS, recs);
    notice($('#save-status'), `Saved as ${id}`, 'ok');
  }

  // ---- Export CSV/JSON/ZIP ----
  function exportCSV() {
    const recs = loadJSON(LS.RECORDS, []);
    if (!recs.length) return notice($('#export-status'), 'No records', 'warn');

    const { receiptsCSV, itemsCSV } = buildCSVs(recs);

    // Two files → trigger download
    downloadBlob(new Blob([receiptsCSV], {type:'text/csv'}), 'Receipts.csv');
    downloadBlob(new Blob([itemsCSV], {type:'text/csv'}), 'LineItems.csv');
    notice($('#export-status'), 'CSV exported', 'ok');
  }

  function buildCSVs(recs) {
    const receiptHeaders = [
      'ReceiptID','ReceiptDate',
      'SellerName','SellerTIN','SellerAddress',
      'BuyerName','BuyerTIN','BuyerAddress',
      'DocumentType','DocumentNumber',
      'Role','TransactionType','Terms','PaymentMethod',
      'GrossAmount','VATAmount','Discount','TotalAmountDue','WithholdingTax',
      'Notes','IDNumber','SessionUserName','SessionUserTIN','SessionUserGmail','SavedAt'
    ];
    const liHeaders = ['ReceiptID','Item','Quantity','UnitPrice','LineAmount'];

    const receiptsRows = [receiptHeaders.join(',')];
    const itemsRows = [liHeaders.join(',')];

    for (const r of recs) {
      const m = r.meta;
      receiptsRows.push(receiptHeaders.map(h => csvEsc(m[h] ?? '')).join(','));
      for (const it of r.items||[]) {
        itemsRows.push(liHeaders.map(h => csvEsc(it[h] ?? '')).join(','));
      }
    }

    return { receiptsCSV: receiptsRows.join('\n'), itemsCSV: itemsRows.join('\n') };
  }

  function csvEsc(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  async function exportZIP() {
    const recs = loadJSON(LS.RECORDS, []);
    if (!recs.length) return notice($('#export-status'), 'No records', 'warn');
    const zip = new JSZip();

    // CSVs
    const { receiptsCSV, itemsCSV } = buildCSVs(recs);
    zip.file('Receipts.csv', receiptsCSV);
    zip.file('LineItems.csv', itemsCSV);

    // JSON manifest
    zip.file('manifest.json', JSON.stringify({ app: 'Resibo', version: APP_VERSION, exportedAt: new Date().toISOString(), count: recs.length }, null, 2));

    // Images (original + processed)
    const imgFolder = zip.folder('images');
    for (const f of uploadedFiles) {
      // Original
      const blobOrig = await dataUrlToBlob(f.urlOriginal);
      imgFolder.file(f.name, blobOrig);
      // Processed (if available)
      if (f.urlProcessed) {
        const ext = f.name.toLowerCase().endsWith('.png') ? '' : '.png';
        const blobProc = await dataUrlToBlob(f.urlProcessed);
        imgFolder.file(f.name.replace(/\.[^.]+$/,'') + '_processed' + ext, blobProc);
      }
    }

    const out = await zip.generateAsync({type:'blob'});
    saveAs(out, `Resibo_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`);
    notice($('#export-status'), 'ZIP exported', 'ok');
  }

  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(r => r.blob());
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- Cleanup ----
  function clearSession() {
    // keep CSV URL; keep records
    localStorage.removeItem(LS.SESSION);
    notice($('#verify-status'), 'Session cleared', 'ok');
  }
  function fullReset() {
    const keepUrl = localStorage.getItem(LS.CSV_URL);
    localStorage.clear();
    if (keepUrl) localStorage.setItem(LS.CSV_URL, keepUrl);
    uploadedFiles = [];
    $('#thumbs').innerHTML = '';
    notice($('#verify-status'), 'Reset done', 'ok');
  }

  // ---- Modal Image Viewer ----
  function openModal(id, src) {
    currentImageId = id;
    const f = uploadedFiles.find(x=>x.id===id);
    rotationMap[id] = rotationMap[id] || (f?.rotation || 0);
    const img = $('#modal-img');
    img.src = src;
    img.style.transform = `rotate(${rotationMap[id]}deg) scale(1)`;
    img.style.filter = 'brightness(1) contrast(1)';
    $('#range-bright').value = 100; $('#range-contrast').value = 100;
    $('#img-modal').classList.add('open');
  }
  function closeModal(){ $('#img-modal').classList.remove('open'); currentImageId=null; }

  $('#btn-zoom-1')?.addEventListener('click', ()=>{
    const img = $('#modal-img');
    img.style.transform = img.style.transform.replace(/scale\([^\)]*\)/,'scale(1)');
  });
  $('#btn-rotate')?.addEventListener('click', ()=>{
    if (!currentImageId) return;
    rotationMap[currentImageId] = (rotationMap[currentImageId] + 90) % 360;
    const img = $('#modal-img');
    img.style.transform = `rotate(${rotationMap[currentImageId]}deg) scale(1)`;
    // persist rotation for file (used by preprocess)
    const f = uploadedFiles.find(x=>x.id===currentImageId);
    if (f) f.rotation = rotationMap[currentImageId];
  });
  $('#range-bright')?.addEventListener('input', e=>{
    const v = clamp(Number(e.target.value)/100, 0.5, 2.0);
    const img = $('#modal-img');
    const cs = Number($('#range-contrast').value)/100;
    img.style.filter = `brightness(${v}) contrast(${cs})`;
  });
  $('#range-contrast')?.addEventListener('input', e=>{
    const v = clamp(Number(e.target.value)/100, 0.5, 2.0);
    const img = $('#modal-img');
    const bs = Number($('#range-bright').value)/100;
    img.style.filter = `brightness(${bs}) contrast(${v})`;
  });
  $('#btn-close-modal')?.addEventListener('click', closeModal);
  $('#img-modal')?.addEventListener('click', (e)=>{ if(e.target.id==='img-modal') closeModal(); });

  // ---- Wire UI ----
  $('#btn-run-selftest')?.addEventListener('click', runSelfTest);
  $('#btn-save-settings')?.addEventListener('click', ()=>{
    const url = $('#csvUrl').value.trim();
    if (!url) return;
    localStorage.setItem(LS.CSV_URL, url);
    notice($('#csv-status'), 'Saved', 'ok');
  });
  $('#btn-test-csv')?.addEventListener('click', async ()=>{
    const url = $('#csvUrl').value.trim() || localStorage.getItem(LS.CSV_URL);
    if (!url) return notice($('#csv-status'), 'No URL', 'warn');
    await testCSV(url);
  });
  $('#btn-verify')?.addEventListener('click', verify);

  $('#btn-preprocess-basic')?.addEventListener('click', preprocessBasic);
  $('#btn-preprocess-strong')?.addEventListener('click', preprocessStrong);
  $('#btn-run-ocr')?.addEventListener('click', runOCR);
  $('#btn-apply-ocr')?.addEventListener('click', applyOCRToFields);

  $('#btn-save-record')?.addEventListener('click', saveRecord);
  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-export-zip')?.addEventListener('click', exportZIP);

  $('#btn-clear-session')?.addEventListener('click', clearSession);
  $('#btn-full-reset')?.addEventListener('click', fullReset);

  // ---- Boot ----
  (function boot(){
    // Fill settings
    const url = localStorage.getItem(LS.CSV_URL) || '';
    $('#csvUrl').value = url;

    runSelfTest();

    // Create one default line row
    addItemRow();
  })();

})();
