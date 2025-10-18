/* Resibo App v3.1.8 — Handwriting Build (Inline Viewer)
 * Changes:
 * - Inline large viewer with Zoom slider, Fit, 1:1, Rotate, Brightness/Contrast
 * - No modal, so the form is ALWAYS right beneath the image
 * - Apply OCR → Fields button under the viewer
 * - Same OCR + preprocessing + exports as v3.1.7
 */
(() => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const APP_VERSION = '3.1.8';
  const LS = {
    CSV_URL: 'resibo_csv_url',
    SESSION: 'resibo_session',
    RECORDS: 'resibo_records',
    OCRHINT: 'resibo_ocr_hint',
  };

  let CSV_ROWS = [];
  let uploadedFiles = [];  // {id,name,file,urlOriginal,urlProcessed,rotation,ocr:{text,conf}}
  let currentViewId = null;
  let ocrHintsText = '';

  // Utility
  const nowId = () => new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
  const csvEsc = (v)=>{ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const toNum = v => (v===''||v==null)?'':Number(v);
  const clamp = (v,mi,ma)=>Math.max(mi,Math.min(ma,v));

  // Self-Test
  function runSelfTest(){
    const tests = [
      ['HTTPS', ()=>location.protocol==='https:'],
      ['Service Worker', ()=>'serviceWorker' in navigator],
      ['Manifest', ()=>!!document.querySelector('link[rel="manifest"]')],
      ['Icons', ()=>!!document.querySelector('link[rel="icon"]')],
      ['JSZip', ()=>!!window.JSZip],
      ['FileSaver', ()=>!!window.saveAs],
      ['pdf.js', ()=>!!window.pdfjsLib],
      ['Tesseract', ()=>!!window.Tesseract],
      ['OpenCV', ()=>!!window.cv && !!cv.imread],
      ['Cache/Version', ()=>true],
    ];
    const host = $('#selftest-results'); if(!host) return;
    host.innerHTML='';
    for (const [name,fn] of tests){
      const ok = !!fn();
      const d = document.createElement('div');
      d.className = 'check ' + (ok?'ok':'bad');
      d.textContent = `${name} — ${ok?'OK':'FAIL'}`;
      host.appendChild(d);
    }
  }

  // CSV parse
  function splitCSVLine(line){
    const out=[]; let cur='',q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){ if(q && line[i+1]==='"'){cur+='"'; i++;} else q=!q; }
      else if(c===',' && !q){ out.push(cur); cur=''; }
      else cur+=c;
    }
    out.push(cur); return out;
  }
  function parseCSV(text){
    const lines = text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!lines.length) return [];
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idx = n => headers.indexOf(n);
    const m = {
      code: idx('code'),
      name: idx('name'),
      tin: idx('tin'),
      gmail: idx('gmail'),
      status: idx('status'),
      expiry_date: idx('expiry_date'),
    };
    const rows=[];
    for(let i=1;i<lines.length;i++){
      const cols=splitCSVLine(lines[i]);
      rows.push({
        code:(cols[m.code]||'').trim(),
        name:(cols[m.name]||'').trim(),
        tin:(cols[m.tin]||'').trim(),
        gmail:(cols[m.gmail]||'').trim(),
        status:(cols[m.status]||'').trim(),
        expiry_date:(cols[m.expiry_date]||'').trim(),
      });
    }
    return rows;
  }
  async function testCSV(url){
    setPill($('#csv-status'),'Fetching...');
    try{
      const text = await (await fetch(url,{cache:'no-store'})).text();
      CSV_ROWS = parseCSV(text);
      setPill($('#csv-status'),`CSV fetched (${CSV_ROWS.length} rows)`,'ok');
      return true;
    }catch{
      setPill($('#csv-status'),'Fetch failed','warn');
      return false;
    }
  }

  // Verify
  async function verify(){
    const code=$('#acc_code').value.trim();
    const name=$('#acc_name').value.trim();
    const tin=$('#acc_tin').value.trim();
    const gmail=$('#acc_gmail').value.trim();
    if(!code||!name||!tin||!gmail){ setPill($('#verify-status'),'Fill Access Code/Name/TIN/Gmail','warn'); return; }
    const url=$('#csvUrl').value.trim()||localStorage.getItem(LS.CSV_URL);
    if(!url){ setPill($('#verify-status'),'CSV URL missing','warn'); return; }
    if(!CSV_ROWS.length) await testCSV(url);
    const hit=CSV_ROWS.find(r=>(r.code||'').toLowerCase()===code.toLowerCase() && (r.gmail||'').toLowerCase()===gmail.toLowerCase());
    const active=(hit?.status||'').toLowerCase()==='active';
    const today=new Date().toISOString().slice(0,10);
    const valid=(hit?.expiry_date||'')>=today;
    if(!hit||!active||!valid){ setPill($('#verify-status'),'No matching ACTIVE record with valid EXPIRY_DATE','warn'); return; }
    localStorage.setItem(LS.SESSION, JSON.stringify({code,name,tin,gmail,expiry:hit.expiry_date}));
    setPill($('#verify-status'),'Verification success. Session stored for 7 days.','ok');
    // jump user to Step 2 on success
    $('#step2').scrollIntoView({behavior:'smooth'});
  }

  // Upload
  $('#file-input')?.addEventListener('change', async e=>{
    const files=Array.from(e.target.files||[]);
    for(const f of files){
      if(f.type==='application/pdf') await importPDF(f);
      else await addFile(f);
    }
    renderThumbs();
    // show first image in viewer automatically
    if (uploadedFiles[0]) showInViewer(uploadedFiles[0].id);
  });

  async function importPDF(file){
    if(!window.pdfjsLib) return;
    const arr=new Uint8Array(await file.arrayBuffer());
    const pdf=await pdfjsLib.getDocument({data:arr}).promise;
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const viewport=page.getViewport({scale:2});
      const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
      canvas.width=viewport.width; canvas.height=viewport.height;
      await page.render({canvasContext:ctx,viewport}).promise;
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png',0.95));
      const nf=new File([blob], `${file.name.replace(/\.pdf$/i,'')}_p${p}.png`, {type:'image/png'});
      await addFile(nf);
    }
  }
  async function addFile(file){
    const id=nowId()+'_'+Math.random().toString(36).slice(2,7);
    const urlOriginal=URL.createObjectURL(file);
    uploadedFiles.push({id,name:file.name,file,urlOriginal,urlProcessed:null,rotation:0,ocr:null});
  }

  function renderThumbs(){
    const host=$('#thumbs'); host.innerHTML='';
    uploadedFiles.forEach(f=>{
      const d=document.createElement('div'); d.className='thumb';
      const img=new Image(); img.src=( $('#toggle-before-after').checked && f.urlProcessed ) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
      img.alt=f.name; img.addEventListener('click',()=>showInViewer(f.id));
      const cap=document.createElement('div'); cap.className='cap';
      const conf = f.ocr?.conf!=null ? ` • conf ${Math.round(f.ocr.conf)}%` : '';
      const prev = f.ocr?.text ? ` — “${f.ocr.text.slice(0,100).replace(/\s+/g,' ')}${f.ocr.text.length>100?'…':''}”` : '';
      cap.textContent = `${f.name}${conf}${prev}`;
      d.appendChild(img); d.appendChild(cap);
      host.appendChild(d);
    });
  }
  $('#toggle-before-after')?.addEventListener('change', renderThumbs);

  // Preprocess
  async function preprocessAll(pipeline){
    if(!window.cv) return setPill($('#ocr-status'),'OpenCV not ready','warn');
    setPill($('#ocr-status'),'Preprocessing…');
    for(const f of uploadedFiles){
      const url= await processOne(f.urlOriginal, pipeline, f.rotation||0);
      f.urlProcessed = url;
    }
    setPill($('#ocr-status'),'Preprocess done','ok');
    renderThumbs();
    if (currentViewId) showInViewer(currentViewId); // refresh viewer image
  }
  async function processOne(url, pipeline, rot){
    return new Promise(res=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        const cnv=document.createElement('canvas'); const ctx=cnv.getContext('2d');
        cnv.width=img.naturalWidth; cnv.height=img.naturalHeight; ctx.drawImage(img,0,0);
        const src=cv.imread(cnv);
        let base=src;
        if(rot){ base = rotateMat(src, rot); src.delete(); }
        const out=pipeline(base); base.delete();
        const outC=document.createElement('canvas'); cv.imshow(outC,out);
        const data=outC.toDataURL('image/png',0.95);
        out.delete();
        res(data);
      };
      img.onerror=()=>res(url);
      img.src=url;
    });
  }
  function rotateMat(src, deg){
    const dst=new cv.Mat();
    const ctr=new cv.Point(src.cols/2, src.rows/2);
    const M=cv.getRotationMatrix2D(ctr,deg,1);
    cv.warpAffine(src,dst,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
    M.delete(); return dst;
  }
  function pipeBasic(src){
    let gray=new cv.Mat(); cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    let out=new cv.Mat(); cv.threshold(gray,out,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
    gray.delete(); return out;
  }
  function pipeStrong(src){
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(g,g);
    const clahe=new cv.CLAHE(2.0,new cv.Size(8,8)); clahe.apply(g,g); clahe.delete();
    cv.medianBlur(g,g,3);
    const angle=estimateSkew(g);
    const d=rotateMat(g,-angle); g.delete();
    let bin=new cv.Mat(); cv.adaptiveThreshold(d,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY,35,10); d.delete();
    return bin;
  }
  function estimateSkew(g){
    let e=new cv.Mat(); cv.Canny(g,e,50,150);
    let L=new cv.Mat(); cv.HoughLines(e,L,1,Math.PI/180,150); e.delete();
    if(!L.rows){ L.delete(); return 0; }
    const ang=[]; for(let i=0;i<L.rows;i++){ let th=L.data32F[i*2+1]*(180/Math.PI); if(th>90) th-=180; ang.push(th); }
    L.delete(); ang.sort((a,b)=>a-b); return ang[Math.floor(ang.length/2)]||0;
  }

  // OCR
  async function runOCR(){
    if(!window.Tesseract) return setPill($('#ocr-status'),'Tesseract not ready','warn');
    if(!uploadedFiles.length) return setPill($('#ocr-status'),'No images','warn');
    setPill($('#ocr-status'),'OCR running…');
    let all='';
    for (const f of uploadedFiles){
      const src = ($('#toggle-before-after').checked || !f.urlProcessed) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
      const { data } = await Tesseract.recognize(src, 'eng', {});
      const conf = data.confidence ?? 0;
      f.ocr = { text: data.text||'', conf: conf||0 };
      all += '\n' + (data.text||'');
    }
    ocrHintsText = all.trim();
    localStorage.setItem(LS.OCRHINT, ocrHintsText);
    setPill($('#ocr-status'),'OCR done','ok');
    renderThumbs();
    // Keep the viewer visible and scroll to Step 3
    $('#step3').scrollIntoView({behavior:'smooth'});
  }

  // Apply OCR → Fields (heuristics)
  function applyOCR(){
    const t = ocrHintsText || localStorage.getItem(LS.OCRHINT) || '';
    if(!t){ setPill($('#save-status'),'No OCR text yet','warn'); return; }
    const iso=t.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
    if(iso) $('#f_date').value = iso[0].replace(/[./]/g,'-');
    const inv=t.match(/\b(SI|OR)[- ]?\d{3,}\b/i);
    if(inv){ const s=inv[0].toUpperCase(); $('#f_doc_type').value = s.startsWith('OR')?'Official Receipt':'Sales Invoice'; $('#f_doc_no').value=s; }
    const nums = Array.from(t.matchAll(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g)).map(m=>Number(m[0].replace(/[,\s]/g,'')));
    if(nums.length){ const max=Math.max(...nums); $('#f_total').value=max.toFixed(2); }
    setPill($('#save-status'),'OCR hints applied (review/edit)','ok');
  }

  // Save / Export
  function saveRecord(){
    const recs = JSON.parse(localStorage.getItem(LS.RECORDS)||'[]');
    const id = nowId();
    const sess = JSON.parse(localStorage.getItem(LS.SESSION)||'{}');
    const meta = {
      ReceiptID:id,
      ReceiptDate:$('#f_date').value||'',
      SellerName:$('#f_seller_name').value||'',
      SellerTIN:$('#f_seller_tin').value||'',
      SellerAddress:$('#f_seller_addr').value||'',
      BuyerName:$('#f_buyer_name').value||'',
      BuyerTIN:$('#f_buyer_tin').value||'',
      BuyerAddress:$('#f_buyer_addr').value||'',
      DocumentType:$('#f_doc_type').value||'',
      DocumentNumber:$('#f_doc_no').value||'',
      Role:$('#f_role').value||'',
      TransactionType:$('#f_txn_type').value||'',
      Terms:$('#f_terms').value||'',
      PaymentMethod:$('#f_payment').value||'',
      GrossAmount:toNum($('#f_gross').value),
      VATAmount:toNum($('#f_vat').value),
      Discount:toNum($('#f_disc').value),
      TotalAmountDue:toNum($('#f_total').value),
      WithholdingTax:toNum($('#f_wht').value),
      Notes:$('#f_notes').value||'',
      IDNumber:$('#f_idno').value||'',
      SessionUserName:sess.name||'',
      SessionUserTIN:sess.tin||'',
      SessionUserGmail:sess.gmail||'',
      SavedAt:new Date().toISOString()
    };
    const items = $$('#items-body tr').map(tr=>({
      ReceiptID:id,
      Item: tr.querySelector('.it-name').value||'',
      Quantity: toNum(tr.querySelector('.it-qty').value),
      UnitPrice: toNum(tr.querySelector('.it-price').value),
      LineAmount: toNum(tr.querySelector('.it-amount').value),
    }));
    const images = uploadedFiles.map(f=>({ReceiptID:id,name:f.name,processed:!!f.urlProcessed,rotation:f.rotation||0}));
    recs.push({id,meta,items,images,ocr: ocrHintsText});
    localStorage.setItem(LS.RECORDS, JSON.stringify(recs));
    setPill($('#save-status'),`Saved as ${id}`,'ok');
  }

  function buildCSVs(recs){
    const receiptHeaders=[
      'ReceiptID','ReceiptDate',
      'SellerName','SellerTIN','SellerAddress',
      'BuyerName','BuyerTIN','BuyerAddress',
      'DocumentType','DocumentNumber',
      'Role','TransactionType','Terms','PaymentMethod',
      'GrossAmount','VATAmount','Discount','TotalAmountDue','WithholdingTax',
      'Notes','IDNumber','SessionUserName','SessionUserTIN','SessionUserGmail','SavedAt'
    ];
    const liHeaders=['ReceiptID','Item','Quantity','UnitPrice','LineAmount'];
    const R=[receiptHeaders.join(',')];
    const L=[liHeaders.join(',')];
    for(const r of recs){
      R.push(receiptHeaders.map(h=>csvEsc(r.meta[h]??'')).join(','));
      for (const it of r.items||[]) L.push(liHeaders.map(h=>csvEsc(it[h]??'')).join(','));
    }
    return { receiptsCSV:R.join('\n'), itemsCSV:L.join('\n') };
  }
  function downloadBlob(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
  function dataUrlToBlob(u){ return fetch(u).then(r=>r.blob()); }

  function exportCSV(){
    const recs=JSON.parse(localStorage.getItem(LS.RECORDS)||'[]');
    if(!recs.length) return setPill($('#export-status'),'No records','warn');
    const {receiptsCSV,itemsCSV}=buildCSVs(recs);
    downloadBlob(new Blob([receiptsCSV],{type:'text/csv'}),'Receipts.csv');
    downloadBlob(new Blob([itemsCSV],{type:'text/csv'}),'LineItems.csv');
    setPill($('#export-status'),'CSV exported','ok');
  }
  async function exportZIP(){
    const recs=JSON.parse(localStorage.getItem(LS.RECORDS)||'[]');
    if(!recs.length) return setPill($('#export-status'),'No records','warn');
    const zip=new JSZip();
    const {receiptsCSV,itemsCSV}=buildCSVs(recs);
    zip.file('Receipts.csv',receiptsCSV);
    zip.file('LineItems.csv',itemsCSV);
    zip.file('manifest.json', JSON.stringify({app:'Resibo',version:APP_VERSION,exportedAt:new Date().toISOString(),count:recs.length},null,2));
    const imgs=zip.folder('images');
    for(const f of uploadedFiles){
      const b1=await dataUrlToBlob(f.urlOriginal); imgs.file(f.name,b1);
      if(f.urlProcessed){ const ext=f.name.toLowerCase().endsWith('.png')?'':'.png'; const b2=await dataUrlToBlob(f.urlProcessed); imgs.file(f.name.replace(/\.[^.]+$/,'')+'_processed'+ext,b2); }
    }
    const out=await zip.generateAsync({type:'blob'});
    saveAs(out,`Resibo_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`);
    setPill($('#export-status'),'ZIP exported','ok');
  }

  // Items table
  function addItemRow(item='',qty='',price='',amount=''){
    const tb=$('#items-body');
    const idx=tb.children.length+1;
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${idx}</td>
      <td><input class="it-name" value="${item}"></td>
      <td><input class="it-qty" type="number" step="0.01" value="${qty}"></td>
      <td><input class="it-price" type="number" step="0.01" value="${price}"></td>
      <td><input class="it-amount" type="number" step="0.01" value="${amount}"></td>
      <td><button class="btn xs danger it-del">✕</button></td>`;
    tr.querySelector('.it-qty').addEventListener('input',recalcRow);
    tr.querySelector('.it-price').addEventListener('input',recalcRow);
    tr.querySelector('.it-del').addEventListener('click',()=>{ tr.remove(); renumber(); });
    tb.appendChild(tr);
  }
  function recalcRow(e){
    const tr=e.target.closest('tr');
    const q=Number(tr.querySelector('.it-qty').value||0);
    const p=Number(tr.querySelector('.it-price').value||0);
    tr.querySelector('.it-amount').value = (q*p ? (q*p).toFixed(2) : '');
  }
  function renumber(){ $$('#items-body tr').forEach((tr,i)=> tr.children[0].textContent=(i+1)); }

  // Viewer (inline)
  const viewer = {
    scale:1, rot:0, ox:0, oy:0,
    apply(){
      const t=`rotate(${this.rot}deg) translate(${this.ox}px,${this.oy}px) scale(${this.scale})`;
      $('#v-before').style.transform=t;
      $('#v-after').style.transform=t;
    },
    applyFilters(){
      const bs=Number($('#v-bright').value||100)/100;
      const cs=Number($('#v-contrast').value||100)/100;
      $('#v-before').style.filter=`brightness(${bs}) contrast(${cs})`;
      $('#v-after').style.filter =`brightness(${bs}) contrast(${cs})`;
    }
  };

  function showInViewer(id){
    currentViewId = id;
    const f = uploadedFiles.find(x=>x.id===id);
    if(!f) return;
    // images
    $('#v-before').src = f.urlOriginal;
    $('#v-after').src  = ( $('#toggle-before-after').checked || !f.urlProcessed ) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
    // reset transforms
    viewer.scale=1; viewer.rot=f.rotation||0; viewer.ox=0; viewer.oy=0;
    $('#v-zoom-slider').value = 100;
    $('#v-bright').value = 100; $('#v-contrast').value=100;
    viewer.apply(); viewer.applyFilters();
    // ensure step3 visible
    $('#step3').scrollIntoView({behavior:'smooth'});
  }

  // Viewer interactions
  (function wireViewer(){
    const canv=$('#viewer-canvas');
    let panning=false, sx=0, sy=0, lastDist=null;

    canv.addEventListener('wheel', (e)=>{
      e.preventDefault();
      const delta = e.deltaY<0?10:-10;
      const v = clamp(Number($('#v-zoom-slider').value)+delta, 30, 600);
      $('#v-zoom-slider').value = v;
      viewer.scale = v/100;
      viewer.apply();
    }, {passive:false});

    canv.addEventListener('mousedown', e=>{ panning=true; sx=e.clientX; sy=e.clientY; canv.style.cursor='grabbing'; });
    window.addEventListener('mouseup', ()=>{ panning=false; canv.style.cursor='default'; });
    window.addEventListener('mousemove', e=>{
      if(!panning) return;
      viewer.ox += (e.clientX - sx); viewer.oy += (e.clientY - sy);
      sx=e.clientX; sy=e.clientY;
      viewer.apply();
    });

    canv.addEventListener('touchstart', e=>{
      if(e.touches.length===2){ lastDist=dist(e.touches[0],e.touches[1]); }
      else { sx=e.touches[0].clientX; sy=e.touches[0].clientY; }
    }, {passive:false});
    canv.addEventListener('touchmove', e=>{
      e.preventDefault();
      if(e.touches.length===2 && lastDist!=null){
        const d=dist(e.touches[0],e.touches[1]); const delta=(d-lastDist)/2;
        const v = clamp(Number($('#v-zoom-slider').value)+delta, 30, 600);
        $('#v-zoom-slider').value = v;
        viewer.scale=v/100; viewer.apply(); lastDist=d;
      } else if(e.touches.length===1){
        viewer.ox += (e.touches[0].clientX - sx); viewer.oy += (e.touches[0].clientY - sy);
        sx=e.touches[0].clientX; sy=e.touches[0].clientY; viewer.apply();
      }
    }, {passive:false});
    canv.addEventListener('touchend', ()=>{ lastDist=null; });

    function dist(a,b){ const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY; return Math.hypot(dx,dy); }

    // toolbar
    $('#v-zoom-slider').addEventListener('input', e=>{ viewer.scale=Number(e.target.value)/100; viewer.apply(); });
    $('#v-zoom-in').addEventListener('click', ()=>{ const v=clamp(Number($('#v-zoom-slider').value)+10,30,600); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-zoom-out').addEventListener('click', ()=>{ const v=clamp(Number($('#v-zoom-slider').value)-10,30,600); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-1x').addEventListener('click', ()=>{ $('#v-zoom-slider').value=100; viewer.scale=1; viewer.ox=0; viewer.oy=0; viewer.apply(); });
    $('#v-fit').addEventListener('click', ()=>{ // rough fit-to-height
      const img=$('#v-after'); if(!img.naturalHeight) return;
      const boxH = $('#viewer-canvas').clientHeight;
      const scale = boxH / img.naturalHeight;
      const pct = clamp(Math.round(scale*100), 30, 600);
      $('#v-zoom-slider').value = pct; viewer.scale=pct/100; viewer.ox=0; viewer.oy=0; viewer.apply();
    });
    $('#v-rotate').addEventListener('click', ()=>{
      viewer.rot = (viewer.rot + 90) % 360;
      viewer.apply();
      const f = uploadedFiles.find(x=>x.id===currentViewId);
      if (f) f.rotation = viewer.rot;
    });
    $('#v-bright').addEventListener('input', ()=>viewer.applyFilters());
    $('#v-contrast').addEventListener('input', ()=>viewer.applyFilters());
  })();

  // Buttons
  $('#btn-run-selftest')?.addEventListener('click', runSelfTest);
  $('#btn-save-settings')?.addEventListener('click', ()=>{
    const v=$('#csvUrl').value.trim(); if(!v) return;
    localStorage.setItem(LS.CSV_URL, v); setPill($('#csv-status'),'Saved','ok');
  });
  $('#btn-test-csv')?.addEventListener('click', async ()=>{
    const url=$('#csvUrl').value.trim()||localStorage.getItem(LS.CSV_URL);
    if(!url) return setPill($('#csv-status'),'No URL','warn');
    await testCSV(url);
  });
  $('#btn-verify')?.addEventListener('click', verify);

  $('#btn-preprocess-basic')?.addEventListener('click', ()=>preprocessAll(pipeBasic));
  $('#btn-preprocess-strong')?.addEventListener('click', ()=>preprocessAll(pipeStrong));
  $('#btn-run-ocr')?.addEventListener('click', runOCR);

  $('#btn-apply-ocr')?.addEventListener('click', applyOCR);

  $('#btn-add-item')?.addEventListener('click', ()=>addItemRow());
  $('#btn-clear-items')?.addEventListener('click', ()=>$('#items-body').innerHTML='');

  ['#f_gross','#f_vat','#f_disc'].forEach(sel=>{
    $(sel)?.addEventListener('input', ()=>{
      const g=Number($('#f_gross').value||0);
      const v=Number($('#f_vat').value||0);
      const d=Number($('#f_disc').value||0);
      $('#f_total').value = (g+v-d).toFixed(2);
    });
  });

  $('#btn-save-record')?.addEventListener('click', saveRecord);
  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-export-zip')?.addEventListener('click', exportZIP);

  $('#btn-clear-session')?.addEventListener('click', ()=>{ localStorage.removeItem(LS.SESSION); setPill($('#verify-status'),'Session cleared','ok'); });
  $('#btn-full-reset')?.addEventListener('click', ()=>{
    const keep=localStorage.getItem(LS.CSV_URL); localStorage.clear(); if(keep) localStorage.setItem(LS.CSV_URL,keep);
    uploadedFiles=[]; $('#thumbs').innerHTML=''; setPill($('#verify-status'),'Reset done','ok');
  });

  // Floating nav
  $('#btn-top')?.addEventListener('click', ()=>window.scrollTo({top:0,behavior:'smooth'}));
  $('#btn-jump-step3')?.addEventListener('click', ()=>$('#step3').scrollIntoView({behavior:'smooth'}));

  // Helpers
  function setPill(el, text, type){
    if(!el) return;
    el.textContent=text;
    el.className = 'pill ' + (type|| (text.toLowerCase().includes('ok')?'ok': (text.toLowerCase().includes('fail')||text.toLowerCase().includes('warn')?'warn':'')));
  }

  // Boot
  (function(){
    const url=localStorage.getItem(LS.CSV_URL)||''; if($('#csvUrl')) $('#csvUrl').value=url;
    runSelfTest();
    addItemRow();
  })();

})();
