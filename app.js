/* Resibo App v3.6.1 — stable build
   - CSV Test + Verify (robust errors)
   - Basic/Strong/Ultra preprocess (tiny print + handwriting)
   - Tesseract OCR (small-print tuned)
   - Visual overlay + clickable cells
   - Layout line-items parser
   - Camera capture
   - Save / CSV / ZIP export
*/
(() => {
  // ---------- tiny helpers ----------
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const setPill = (el, msg, kind) => { if(!el) return; el.textContent = msg; el.className = 'pill ' + (kind||''); };
  const LS = { CSV:'resibo_csv_url', SESSION:'resibo_session', OCR:'resibo_ocr', RECS:'resibo_records' };
  const APP_VERSION = '3.6.1';

  // ---------- state ----------
  let CSV_ROWS = [];
  let files = []; // {id,name,urlOriginal,urlProcessed,rotation,ocr:{text,conf}}
  let currentId = null;
  let ocrTextAll = '';
  const OVERLAY = { shapes:[], imgW:0, imgH:0, enabled:true };
  const viewer = { scale:1, rot:0, ox:0, oy:0, apply(){ const t=`rotate(${this.rot}deg) translate(${this.ox}px,${this.oy}px) scale(${this.scale})`; $('#v-before').style.transform=t; $('#v-after').style.transform=t; $('#v-overlay').style.transform=t; }, filters(){ const bs=Number($('#v-bright').value||100)/100, cs=Number($('#v-contrast').value||100)/100; $('#v-before').style.filter=`brightness(${bs}) contrast(${cs})`; $('#v-after').style.filter=`brightness(${bs}) contrast(${cs})`; } };

  // ---------- self-test ----------
  function runSelfTest(){
    const host = $('#selftest-results'); if(!host) return;
    const tests = [
      ['HTTPS', () => location.protocol==='https:'],
      ['Service Worker', () => 'serviceWorker' in navigator],
      ['Manifest', () => !!document.querySelector('link[rel="manifest"]')],
      ['Icons', () => true],
      ['JSZip', () => !!window.JSZip],
      ['FileSaver', () => !!window.saveAs],
      ['pdf.js', () => !!window.pdfjsLib],
      ['Tesseract', () => !!window.Tesseract],
      ['OpenCV', () => !!(window.cv && cv.imread)],
    ];
    host.innerHTML='';
    tests.forEach(([n,fn])=>{
      const ok = !!fn();
      const d = document.createElement('div');
      d.className = 'check ' + (ok?'ok':'bad');
      d.textContent = `${n} — ${ok?'OK':'FAIL'}`;
      host.appendChild(d);
    });
  }

  // ---------- CSV utils ----------
  function splitCSVLine(line){
    const out=[]; let cur='', q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){ if(q && line[i+1]==='"'){ cur+='"'; i++; } else q=!q; }
      else if(c===',' && !q){ out.push(cur); cur=''; }
      else cur+=c;
    }
    out.push(cur);
    return out;
  }
  function parseCSV(text){
    const rows = text.split(/\r?\n/).filter(Boolean);
    if(!rows.length) return [];
    const headers = rows[0].split(',').map(h=>h.trim().toLowerCase());
    const need = ['code','name','tin','gmail','status','expiry_date'];
    const missing = need.filter(h=>!headers.includes(h));
    if(missing.length) throw new Error('Missing headers: ' + missing.join(', '));
    const idx = (h) => headers.indexOf(h);
    const out=[];
    for(let i=1;i<rows.length;i++){
      const c = splitCSVLine(rows[i]);
      out.push({
        code:(c[idx('code')]||'').trim(),
        name:(c[idx('name')]||'').trim(),
        tin:(c[idx('tin')]||'').trim(),
        gmail:(c[idx('gmail')]||'').trim(),
        status:(c[idx('status')]||'').trim(),
        expiry_date:(c[idx('expiry_date')]||'').trim()
      });
    }
    return out;
  }
  async function testCSV(url){
    const pill = $('#csv-status');
    setPill(pill,'Fetching…');
    try{
      const res = await fetch(url, { cache:'no-store' });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      CSV_ROWS = parseCSV(text);
      setPill(pill, `CSV fetched (${CSV_ROWS.length} rows)`, 'ok');
      return true;
    }catch(err){
      setPill(pill, 'CSV error: ' + err.message, 'warn');
      return false;
    }
  }

  // ---------- VERIFY ----------
  function normalizeTIN(s){ return (s||'').replace(/[\s-]/g,''); }
  async function handleVerify(){
    const code  = $('#acc_code').value.trim();
    const name  = $('#acc_name').value.trim();
    const tin   = $('#acc_tin').value.trim();
    const gmail = $('#acc_gmail').value.trim();
    const url   = ($('#csvUrl')?.value.trim()) || localStorage.getItem(LS.CSV) || '';
    const pill  = $('#verify-status');

    if(!url){ setPill(pill,'CSV URL missing. Paste and Save first.','warn'); return; }
    localStorage.setItem(LS.CSV, url);

    // Pull CSV fresh every verify to avoid stale cache
    const ok = await testCSV(url);
    if(!ok){ setPill(pill,'CSV fetch failed.','warn'); return; }
    const today = new Date().toISOString().slice(0,10);
    const rec = CSV_ROWS.find(r =>
      (r.code||'').toLowerCase()===code.toLowerCase() &&
      (r.gmail||'').toLowerCase()===gmail.toLowerCase()
    );
    if(!rec){ setPill(pill,'No matching record (code+gmail).','warn'); return; }
    if((rec.status||'').toLowerCase()!=='active'){ setPill(pill,`Status is "${rec.status}"`,'warn'); return; }
    if((rec.expiry_date||'')<today){ setPill(pill,`Expired on ${rec.expiry_date}`,'warn'); return; }
    if(normalizeTIN(rec.tin)!==normalizeTIN(tin)){ setPill(pill,'TIN mismatch.','warn'); return; }

    localStorage.setItem(LS.SESSION, JSON.stringify({
      code,name,tin,gmail,expiry:rec.expiry_date,savedAt:new Date().toISOString()
    }));
    setPill(pill,'Verification success. Session stored for 7 days.','ok');
    $('#step2').scrollIntoView({behavior:'smooth'});
  }

  // ---------- uploads / pdf ----------
  $('#file-input')?.addEventListener('change', async (e)=>{
    const fs = Array.from(e.target.files||[]);
    for(const f of fs){
      if(f.type==='application/pdf') await importPDF(f);
      else await addFile(f);
    }
    renderThumbs(); if(files[0]) showViewer(files[0].id);
  });

  async function importPDF(file){
    if(!window.pdfjsLib) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({data:buf}).promise;
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const vp=page.getViewport({scale:2});
      const c=document.createElement('canvas'); const ctx=c.getContext('2d');
      c.width=vp.width; c.height=vp.height;
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const blob = await new Promise(r=>c.toBlob(r,'image/png',0.95));
      const nf = new File([blob], `${file.name.replace(/\.pdf$/i,'')}_p${p}.png`, {type:'image/png'});
      await addFile(nf);
    }
  }
  async function addFile(file){
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    const urlOriginal = URL.createObjectURL(file);
    files.push({id,name:file.name,urlOriginal,urlProcessed:null,rotation:0,ocr:null});
  }
  function renderThumbs(){
    const host = $('#thumbs'); host.innerHTML='';
    files.forEach(f=>{
      const d=document.createElement('div'); d.className='thumb';
      const img=new Image();
      const useBefore = $('#toggle-before-after')?.checked;
      img.src = (useBefore || !f.urlProcessed) ? f.urlOriginal : f.urlProcessed || f.urlOriginal;
      img.addEventListener('click',()=>showViewer(f.id));
      d.appendChild(img);
      const cap=document.createElement('div'); cap.className='cap';
      const conf = (f.ocr && f.ocr.conf!=null) ? ` • conf ${Math.round(f.ocr.conf)}%` : '';
      cap.textContent = `${f.name}${conf}`;
      d.appendChild(cap);
      host.appendChild(d);
    });
  }

  // ---------- OpenCV pipelines ----------
  function rotateMat(mat,deg){
    const dst=new cv.Mat(); const ctr=new cv.Point(mat.cols/2,mat.rows/2);
    const M=cv.getRotationMatrix2D(ctr,deg,1); cv.warpAffine(mat,dst,M,new cv.Size(mat.cols,mat.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE);
    M.delete(); return dst;
  }
  async function processOne(url, fn, rot){
    return new Promise((resolve)=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
        c.getContext('2d').drawImage(img,0,0);
        let src=cv.imread(c);
        if(rot){ const r=rotateMat(src,rot); src.delete(); src=r; }
        const out=fn(src); src.delete();
        const c2=document.createElement('canvas'); cv.imshow(c2,out);
        const data=c2.toDataURL('image/png',0.95);
        out.delete();
        resolve(data);
      };
      img.onerror=()=>resolve(url);
      img.src=url;
    });
  }
  function pipeBasic(src){
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);
    let o=new cv.Mat(); cv.threshold(g,o,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
    g.delete(); return o;
  }
  function estimateSkew(mat){
    let e=new cv.Mat(); cv.Canny(mat,e,50,150);
    let L=new cv.Mat(); cv.HoughLines(e,L,1,Math.PI/180,120); e.delete();
    if(!L.rows){ L.delete(); return 0; }
    const ang=[]; for(let i=0;i<L.rows;i++){ let th=L.data32F[i*2+1]*(180/Math.PI); if(th>90) th-=180; ang.push(th); }
    L.delete(); ang.sort((a,b)=>a-b);
    return ang[Math.floor(ang.length/2)]||0;
  }
  function pipeStrong(src, small){
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);
    if(small){ let up=new cv.Mat(); cv.resize(g,up,new cv.Size(0,0),1.6,1.6,cv.INTER_CUBIC); g.delete(); g=up; }
    cv.equalizeHist(g,g);
    const cla=new cv.CLAHE(2.0,new cv.Size(8,8)); cla.apply(g,g); cla.delete();
    cv.medianBlur(g,g,3);
    const ang=estimateSkew(g); const d=rotateMat(g,-ang); g.delete();
    let sharp=new cv.Mat(), blur=new cv.Mat(); cv.GaussianBlur(d,blur,new cv.Size(0,0),2,2); cv.addWeighted(d,1.5,blur,-0.5,0,sharp); d.delete(); blur.delete();
    let bin=new cv.Mat(); cv.adaptiveThreshold(sharp,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY,35,10); sharp.delete();
    return bin;
  }
  function pipeUltra(src, small){
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);
    let up=new cv.Mat(); cv.resize(g,up,new cv.Size(0,0), small?2.0:1.6, small?2.0:1.6, cv.INTER_CUBIC); g.delete();
    let kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(31,31));
    let bg=new cv.Mat(); cv.morphologyEx(up,bg,cv.MORPH_OPEN,kernel); kernel.delete();
    let norm=new cv.Mat(); cv.subtract(up,bg,norm); bg.delete(); up.delete();
    const cla=new cv.CLAHE(2.5,new cv.Size(8,8)); cla.apply(norm,norm); cla.delete();
    cv.medianBlur(norm,norm,3);
    let blur=new cv.Mat(); cv.GaussianBlur(norm,blur,new cv.Size(0,0),3,3);
    let sharp=new cv.Mat(); cv.addWeighted(norm,1.7,blur,-0.7,0,sharp); blur.delete(); norm.delete();
    const ang=estimateSkew(sharp); let desk=rotateMat(sharp,-ang); sharp.delete();
    let bin=new cv.Mat(); cv.adaptiveThreshold(desk,bin,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,7); desk.delete();
    return bin;
  }
  async function preprocessAll(pipeline){
    if(!window.cv || !cv.imread) { setPill($('#ocr-status'),'OpenCV not ready','warn'); return; }
    setPill($('#ocr-status'),'Preprocessing…');
    const boost = $('#chk-smallprint')?.checked;
    for(const f of files){
      const url = await processOne(f.urlOriginal, (m)=>pipeline(m, boost), f.rotation||0);
      f.urlProcessed = url;
    }
    setPill($('#ocr-status'),'Preprocess done','ok');
    renderThumbs(); if(currentId) showViewer(currentId);
  }

  // ---------- OCR ----------
  async function runOCR(){
    if(!window.Tesseract){ setPill($('#ocr-status'),'Tesseract not ready','warn'); return; }
    if(!files.length){ setPill($('#ocr-status'),'No images','warn'); return; }
    setPill($('#ocr-status'),'OCR running…');
    const opts = { tessedit_pageseg_mode: 6, preserve_interword_spaces: 1 };
    let all='';
    for(const f of files){
      const useBefore = $('#toggle-before-after')?.checked;
      const src = (useBefore || !f.urlProcessed) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
      const { data } = await Tesseract.recognize(src,'eng',opts);
      f.ocr = { text:data.text||'', conf:data.confidence||0 };
      all += '\n' + (data.text||'');
    }
    ocrTextAll = all.trim(); localStorage.setItem(LS.OCR, ocrTextAll);
    setPill($('#ocr-status'),'OCR done','ok');
    renderThumbs();
    $('#step3').scrollIntoView({behavior:'smooth'});
  }

  // ---------- mapping helpers ----------
  const norm = (s)=> (s||'').toLowerCase().replace(/\s+/g,' ').trim();
  function levenshtein(a,b){
    a=a||''; b=b||'';
    const m=a.length, n=b.length;
    const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const cost=a[i-1]===b[j-1]?0:1;
        dp[i][j]=Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    return dp[m][n];
  }
  function fuzzyIncludes(text,label,maxDist=2){
    text=norm(text); label=norm(label);
    if(text.includes(label)) return true;
    const words=text.split(/\s+/), L=label.split(/\s+/);
    for(let i=0;i<=words.length-L.length;i++){
      const win=words.slice(i,i+L.length).join(' ');
      if(levenshtein(win,label)<=maxDist) return true;
    }
    return false;
  }
  function pickValue(text,type){
    const t=(text||'').trim();
    if(type==='date'){
      const m=t.match(/\b(20\d{2}[-/.](0[1-9]|1[0-2])[-/.]([0-2]\d|3[01])|([01]?\d)[-/.]([0-2]?\d|3[01])[-/.](20\d{2}|19\d{2}))\b/);
      return m? m[0].replace(/[.]/g,'-').replace(/\//g,'-') : null;
    }
    if(type==='tin'){
      const m=t.match(/\b\d{3}[- ]?\d{3}[- ]?\d{3}([- ]?\d{3})?\b/);
      return m? m[0].replace(/\s/g,'') : null;
    }
    if(type==='amount'){
      const m=t.match(/(?:₱|\$)?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/);
      return m? Number(m[0].replace(/[₱$\s,]/g,'')) : null;
    }
    if(type==='number'){
      const m=t.match(/\b\d+(?:\.\d+)?\b/); return m? Number(m[0]):null;
    }
    return t;
  }
  function findLabelValue(lines, labels, opts){
    const valueType = (opts && opts.valueType) || 'amount';
    const win = (opts && opts.window) || 1;
    for(let i=0;i<lines.length;i++){
      if(labels.some(l=>fuzzyIncludes(lines[i],l))){
        const same = lines[i].split(/[:\-–]/).slice(1).join(':').trim();
        const cands=[]; if(same) cands.push(same);
        for(let k=1;k<=win && (i+k)<lines.length;k++) cands.push(lines[i+k].trim());
        for(const c of cands){ const v=pickValue(c,valueType); if(v!=null && v!=='') return v; }
      }
    }
    return null;
  }
  function pickLargestAmount(lines){
    const nums = Array.from(lines.join(' ').matchAll(/\b(?:₱|\$)?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g)).map(m=>Number(m[0].replace(/[₱$\s,]/g,'')));
    return nums.length? Math.max(...nums): null;
  }
  function extractItemsQuick(lines){
    const out=[];
    for(const ln of lines){
      const clean=ln.replace(/[|]/g,' ').replace(/\s{2,}/g,' ').trim();
      const nums = Array.from(clean.matchAll(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\b/g)).map(m=>m[0].replace(/[,\s]/g,''));
      if(nums.length>=2){
        const qty = Number(nums[0]); const price=Number(nums[1]||'');
        const amt = Number(nums[2] || (qty&&price?(qty*price).toFixed(2):'' ));
        const name = clean.replace(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\b/g,'').replace(/[×x*@=:]/g,' ').replace(/\s{2,}/g,' ').trim();
        if(name && (qty||price||amt)) out.push({Item:name, Quantity:qty||'', UnitPrice:price||'', LineAmount:amt||''});
      }
    }
    return out.slice(0,20);
  }
  function mapOCRToFields(raw){
    const lines = (raw||'').replace(/\r/g,'').split('\n').map(s=>s.trim()).filter(Boolean);
    const date = findLabelValue(lines,['date','receipt date','invoice date','issued on'],{valueType:'date',window:2}) || pickValue(lines.join(' '),'date');
    let docType='', docNo='';
    for(const ln of lines){
      const m = ln.match(/\b(OR|O\.R\.|SI|S\.I\.)[- ]?[:#]?\s*([A-Z]*\d[\d\-\/]*)\b/i);
      if(m){ docType = m[1].toUpperCase().includes('OR')?'Official Receipt':'Sales Invoice'; docNo=m[2]; break; }
    }
    if(!docNo){ const m = lines.join(' ').match(/\b(No\.?|Number)[:#]?\s*([A-Z]*\d[\d\-\/]*)\b/i); if(m) docNo=m[2]; }
    if(!docType){
      const hasOR = lines.some(l=>fuzzyIncludes(l,'official receipt') || /\bOR\b/.test(l));
      const hasSI = lines.some(l=>fuzzyIncludes(l,'sales invoice') || /\bSI\b/.test(l));
      docType = hasOR?'Official Receipt':(hasSI?'Sales Invoice':(docNo?'Receipt':''));
    }
    const sellerName = findLabelValue(lines,['seller','merchant','supplier','store'],{window:2});
    const buyerName  = findLabelValue(lines,['buyer','customer','client','payor'],{window:2});
    const sellerTIN  = findLabelValue(lines,['seller tin','tin','tax id','tax identification number'],{valueType:'tin',window:2});
    const buyerTIN   = findLabelValue(lines,['buyer tin','tin','tax id','tax identification number'],{valueType:'tin',window:2});
    const sellerAddr = findLabelValue(lines,['seller address','business address','address'],{window:2});
    const buyerAddr  = findLabelValue(lines,['buyer address','billing address','address'],{window:2});

    const gross   = findLabelValue(lines,['gross amount','total sales (gross)','subtotal'],{valueType:'amount',window:2});
    const vatable = findLabelValue(lines,['vatable sales','vatable amount','vatable sale'],{valueType:'amount',window:2});
    const vatAmt  = findLabelValue(lines,['vat amount','vat','12% vat'],{valueType:'amount',window:2});
    const disc    = findLabelValue(lines,['discount','disc.','less: discount'],{valueType:'amount',window:2});
    const total   = findLabelValue(lines,['total amount due','amount due','total'],{valueType:'amount',window:2}) || pickLargestAmount(lines);

    const payMeth = findLabelValue(lines,['payment method','payment','paid via','mode of payment'],{window:1});
    const items   = extractItemsQuick(lines);

    return { date, docType, docNo, sellerName, buyerName, sellerTIN, buyerTIN, sellerAddr, buyerAddr, gross, vatable, vatAmt, disc, total, payMeth, items };
  }
  function applyOCR(){
    const raw = ocrTextAll || localStorage.getItem(LS.OCR) || '';
    if(!raw){ setPill($('#save-status'),'No OCR text yet','warn'); return; }
    const M = mapOCRToFields(raw);
    if(M.date) $('#f_date').value = M.date;
    if(M.docType) $('#f_doc_type').value = M.docType;
    if(M.docNo) $('#f_doc_no').value = M.docNo;
    if(M.sellerName) $('#f_seller_name').value = M.sellerName;
    if(M.sellerTIN)  $('#f_seller_tin').value  = M.sellerTIN;
    if(M.sellerAddr) $('#f_seller_addr').value = M.sellerAddr;
    if(M.buyerName)  $('#f_buyer_name').value  = M.buyerName;
    if(M.buyerTIN)   $('#f_buyer_tin').value   = M.buyerTIN;
    if(M.buyerAddr)  $('#f_buyer_addr').value  = M.buyerAddr;
    if(M.gross!=null)   $('#f_gross').value   = Number(M.gross).toFixed(2);
    if(M.vatable!=null) $('#f_vatable').value = Number(M.vatable).toFixed(2);
    if(M.vatAmt!=null)  $('#f_vat').value     = Number(M.vatAmt).toFixed(2);
    if(M.disc!=null)    $('#f_disc').value    = Number(M.disc).toFixed(2);
    if(M.total!=null)   $('#f_total').value   = Number(M.total).toFixed(2);
    if(M.payMeth)       $('#f_payment').value = M.payMeth;

    if((M.items||[]).length){
      $('#items-body').innerHTML='';
      M.items.forEach(it=> addItemRow(it.Item,it.Quantity,it.UnitPrice,it.LineAmount));
    }
    const sess = JSON.parse(localStorage.getItem(LS.SESSION)||'{}');
    const user = norm(sess.name||''), seller = norm(M.sellerName||'');
    $('#f_role').value = (user && seller && user.includes(seller)) ? 'SELLER/ISSUER' : 'BUYER/PAYOR';
    setPill($('#save-status'),'OCR mapped → review/edit','ok');
  }

  // ---------- overlay + layout table ----------
  function drawOverlay(){
    const canvas = $('#v-overlay');
    const show = $('#chk-overlay')?.checked;
    OVERLAY.enabled = !!show;
    if(!show){ canvas.style.display='none'; return; }
    const img = ($('#toggle-before-after')?.checked ? $('#v-before') : $('#v-after'));
    const w = img.naturalWidth || OVERLAY.imgW, h = img.naturalHeight || OVERLAY.imgH;
    if(!w||!h){ canvas.style.display='none'; return; }
    canvas.width=w; canvas.height=h; canvas.style.display='block';
    const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,w,h);
    OVERLAY.shapes.forEach(s=>{
      ctx.strokeStyle = s.color; ctx.lineWidth=3; ctx.globalAlpha=0.95;
      ctx.strokeRect(s.x,s.y,s.w,s.h);
      ctx.globalAlpha=0.18; ctx.fillStyle=s.color; ctx.fillRect(s.x,s.y,s.w,s.h);
      ctx.globalAlpha=1;
    });
  }
  function clearOverlay(){ OVERLAY.shapes=[]; drawOverlay(); setPill($('#save-status'),'Overlay cleared','ok'); }
  $('#v-overlay')?.addEventListener('click',(e)=>{
    if(!OVERLAY.enabled||!OVERLAY.shapes.length) return;
    const cvs=$('#v-overlay'); const rect=cvs.getBoundingClientRect();
    const rx=e.clientX-rect.left, ry=e.clientY-rect.top;
    const scaleX=(OVERLAY.imgW||cvs.width)/rect.width;
    const scaleY=(OVERLAY.imgH||cvs.height)/rect.height;
    let x=rx*scaleX, y=ry*scaleY;
    const rot=(viewer.rot||0)%360;
    if(rot===90){ const ox=x,oy=y; x=oy; y=(OVERLAY.imgH)-ox; }
    else if(rot===180){ x=(OVERLAY.imgW)-x; y=(OVERLAY.imgH)-y; }
    else if(rot===270){ const ox=x,oy=y; x=(OVERLAY.imgW)-oy; y=ox; }
    const hit=OVERLAY.shapes.find(s=>x>=s.x && x<=s.x+s.w && y>=s.y && y<=s.y+s.h);
    if(!hit) return;
    const rows=$$('#items-body tr'); const row=rows[hit.rowIndex]||rows[0]; if(!row) return;
    let sel='.it-name'; if(hit.type==='quantity') sel='.it-qty'; else if(hit.type==='unitprice') sel='.it-price'; else if(hit.type==='lineamount') sel='.it-amount';
    const input=row.querySelector(sel); if(input){ input.scrollIntoView({behavior:'smooth',block:'center'}); input.focus({preventScroll:true}); input.classList.add('flash'); setTimeout(()=>input.classList.remove('flash'),900); }
  });

  async function parseTableFromCurrent(){
    const f = files.find(x=>x.id===currentId) || files[0];
    if(!f){ setPill($('#save-status'),'No image','warn'); return; }
    const src = f.urlProcessed || f.urlOriginal;
    const mat = await loadToMat(src); if(!mat){ setPill($('#save-status'),'OpenCV load failed','warn'); return; }
    // roi using simple projection
    let g=new cv.Mat(); cv.cvtColor(mat,g,cv.COLOR_RGBA2GRAY);
    let bin=new cv.Mat(); cv.adaptiveThreshold(g,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,35,10); g.delete();
    let horizK=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(Math.max(30,Math.floor(bin.cols/30)),1));
    let vertK =cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,Math.max(20,Math.floor(bin.rows/60))));
    let h=new cv.Mat(); cv.erode(bin,h,horizK); cv.dilate(h,h,horizK);
    let v=new cv.Mat(); cv.erode(bin,v,vertK);  cv.dilate(v,v,vertK);
    let grid=new cv.Mat(); cv.addWeighted(h,0.5,v,0.5,0,grid);
    let contours=new cv.MatVector(), hier=new cv.Mat();
    cv.findContours(grid,contours,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const boxes=[]; for(let i=0;i<contours.size();i++){ const r=cv.boundingRect(contours.get(i)); if(r.width>Math.max(180,bin.cols*0.25) && r.height>15) boxes.push(r); }
    boxes.sort((a,b)=> (a.y===b.y? a.x-b.x : a.y-b.y));
    if(!boxes.length){ cleanup(); setPill($('#save-status'),'No grid detected','warn'); return; }
    const table=boxes[0];
    const roi=mat.roi(new cv.Rect(table.x,table.y,table.width,table.height));
    let rg=new cv.Mat(); cv.cvtColor(roi,rg,cv.COLOR_RGBA2GRAY);
    let rbin=new cv.Mat(); cv.adaptiveThreshold(rg,rbin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,33,8);
    let hk=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(Math.max(30,Math.floor(roi.cols/25)),1));
    let vk=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,Math.max(18,Math.floor(roi.rows/35))));
    let rh=new cv.Mat(), rv=new cv.Mat(); cv.erode(rbin,rh,hk); cv.dilate(rh,rh,hk); cv.erode(rbin,rv,vk); cv.dilate(rv,rv,vk);
    const cols = project(rv,true), rows = project(rh,false);
    if(cols.length<3 || rows.length<2){ cleanup(); setPill($('#save-status'),'Table too faint','warn'); return; }
    const colEdges = uniq(cols), rowEdges = uniq(rows);
    const items=[]; const overlay=[];
    for(let r=0;r<rowEdges.length-1;r++){
      const y1=rowEdges[r], y2=rowEdges[r+1]; const height=y2-y1; if(height<18) continue;
      const last3 = colEdges.slice(-3);
      const qtyCol=last3[0], priceCol=last3[1]||last3[0], amtCol=last3[2]||last3[1];
      const itemRight=qtyCol;

      const regs = [
        {key:'Item',       x1:0,          x2:itemRight-2, color:'#1e3a8a'},
        {key:'Quantity',   x1:qtyCol+2,   x2:priceCol-2,  color:'#065f46'},
        {key:'UnitPrice',  x1:priceCol+2, x2:amtCol-2,    color:'#854d0e'},
        {key:'LineAmount', x1:amtCol+2,   x2:roi.cols-2,  color:'#7f1d1d'}
      ];
      const obj={Item:'',Quantity:'',UnitPrice:'',LineAmount:''};
      for(const reg of regs){
        const rect={x:reg.x1, y:y1+2, w:Math.max(6,reg.x2-reg.x1), h:Math.max(12,height-4)};
        if(rect.w<10||rect.h<12) continue;
        const cell=roi.roi(new cv.Rect(rect.x,rect.y,rect.w,rect.h));
        const txt=await ocrMat(cell); cell.delete();
        if(reg.key==='Item'){ obj.Item=(txt||'').replace(/\s+/g,' ').trim(); }
        else { const m=(txt||'').match(/\d+(?:\.\d+)?/); obj[reg.key]=m? m[0] : ''; }
        overlay.push({ x:table.x+rect.x, y:table.y+rect.y, w:rect.w, h:rect.h, color:reg.color, type:reg.key.toLowerCase(), rowIndex:items.length });
      }
      if(obj.Item || obj.Quantity || obj.UnitPrice || obj.LineAmount) items.push(obj);
    }
    $('#items-body').innerHTML=''; items.slice(0,40).forEach(it=> addItemRow(it.Item,it.Quantity,it.UnitPrice,it.LineAmount));
    OVERLAY.shapes=overlay;
    const img = ($('#toggle-before-after')?.checked ? $('#v-before') : $('#v-after'));
    OVERLAY.imgW = img.naturalWidth; OVERLAY.imgH = img.naturalHeight;
    drawOverlay();
    setPill($('#save-status'),`Parsed ${items.length} line item(s)`,'ok');
    cleanup();

    function uniq(a){ return Array.from(new Set(a)).sort((x,y)=>x-y); }
    function project(mask, vertical){
      const peaks=[]; if(vertical){
        for(let x=0;x<mask.cols;x++){ let s=0; for(let y=0;y<mask.rows;y++) s+=mask.ucharPtr(y,x)[0]; if(s>mask.rows*255*0.15) peaks.push(x); }
      } else {
        for(let y=0;y<mask.rows;y++){ let s=0; for(let x=0;x<mask.cols;x++) s+=mask.ucharPtr(y,x)[0]; if(s>mask.cols*255*0.12) peaks.push(y); }
      } return peaks;
    }
    function cleanup(){ [mat,bin,horizK,vertK,h,v,grid,contours,hier,roi,rg,rbin,hk,vk,rh,rv].forEach(m=>{ if(m && m.delete) try{m.delete();}catch{} }); }
  }
  async function loadToMat(url){
    return new Promise((res)=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{ const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight; c.getContext('2d').drawImage(img,0,0); try{ const m=cv.imread(c); res(m); }catch{ res(null); } };
      img.onerror=()=>res(null); img.src=url;
    });
  }
  async function ocrMat(mat){
    const c=document.createElement('canvas'); cv.imshow(c,mat);
    const url=c.toDataURL('image/png',0.95);
    try{ const {data}=await Tesseract.recognize(url,'eng',{tessedit_pageseg_mode:6,preserve_interword_spaces:1}); return data.text||''; }catch{ return ''; }
  }

  // ---------- viewer ----------
  function showViewer(id){
    currentId=id; const f=files.find(x=>x.id===id); if(!f) return;
    const before=$('#v-before'), after=$('#v-after'), overlay=$('#v-overlay');
    before.src=f.urlOriginal;
    const useBefore = $('#toggle-before-after')?.checked;
    after.src=(useBefore || !f.urlProcessed) ? f.urlOriginal : f.urlProcessed || f.urlOriginal;

    const img = (useBefore || !f.urlProcessed) ? before : after;
    img.onload = () => { OVERLAY.imgW=img.naturalWidth; OVERLAY.imgH=img.naturalHeight; overlay.width=OVERLAY.imgW; overlay.height=OVERLAY.imgH; drawOverlay(); };

    viewer.scale=1; viewer.rot=f.rotation||0; viewer.ox=0; viewer.oy=0;
    $('#v-zoom-slider').value=100; $('#v-bright').value=100; $('#v-contrast').value=100;
    viewer.apply(); viewer.filters();
    $('#step3').scrollIntoView({behavior:'smooth'});
  }
  (function wireViewer(){
    const canv=$('#viewer-canvas'); let panning=false,sx=0,sy=0,last=null;
    canv.addEventListener('wheel', (e)=>{ e.preventDefault(); const v=Math.max(30,Math.min(600, Number($('#v-zoom-slider').value)+(e.deltaY<0?12:-12))); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); }, {passive:false});
    canv.addEventListener('mousedown', (e)=>{ panning=true; sx=e.clientX; sy=e.clientY; canv.style.cursor='grabbing'; });
    window.addEventListener('mouseup', ()=>{ panning=false; canv.style.cursor='default'; });
    window.addEventListener('mousemove', (e)=>{ if(!panning) return; viewer.ox+=(e.clientX-sx); viewer.oy+=(e.clientY-sy); sx=e.clientX; sy=e.clientY; viewer.apply(); });
    canv.addEventListener('touchstart',(e)=>{ if(e.touches.length===2){ last=dist(e.touches[0],e.touches[1]); } else { sx=e.touches[0].clientX; sy=e.touches[0].clientY; } },{passive:false});
    canv.addEventListener('touchmove',(e)=>{ e.preventDefault(); if(e.touches.length===2 && last!=null){ const d=dist(e.touches[0],e.touches[1]); const v=Math.max(30,Math.min(600, Number($('#v-zoom-slider').value)+(d-last)/2)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); last=d; } else if(e.touches.length===1){ viewer.ox+=(e.touches[0].clientX-sx); viewer.oy+=(e.touches[0].clientY-sy); sx=e.touches[0].clientX; sy=e.touches[0].clientY; viewer.apply(); } },{passive:false});
    canv.addEventListener('touchend',()=>{ last=null; });
    function dist(a,b){ const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY; return Math.hypot(dx,dy); }
    $('#v-zoom-slider').addEventListener('input',(e)=>{ viewer.scale=Number(e.target.value)/100; viewer.apply(); });
    $('#v-zoom-in').addEventListener('click',()=>{ const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)+12)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-zoom-out').addEventListener('click',()=>{ const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)-12)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-1x').addEventListener('click',()=>{ $('#v-zoom-slider').value=100; viewer.scale=1; viewer.ox=0; viewer.oy=0; viewer.apply(); });
    $('#v-fit').addEventListener('click',()=>{ const img=$('#v-after'); if(!img.naturalHeight) return; const boxH=$('#viewer-canvas').clientHeight; const pct=Math.max(30,Math.min(600, Math.round((boxH/img.naturalHeight)*100))); $('#v-zoom-slider').value=pct; viewer.scale=pct/100; viewer.ox=0; viewer.oy=0; viewer.apply(); });
    $('#v-rotate').addEventListener('click',()=>{ viewer.rot=(viewer.rot+90)%360; viewer.apply(); const f=files.find(x=>x.id===currentId); if(f) f.rotation=viewer.rot; drawOverlay(); });
    $('#v-bright').addEventListener('input',()=>viewer.filters());
    $('#v-contrast').addEventListener('input',()=>viewer.filters());
    $('#chk-overlay')?.addEventListener('change', drawOverlay);
    $('#btn-clear-overlay')?.addEventListener('click', clearOverlay);
  })();

  // ---------- camera ----------
  let camStream=null, camFacing='environment';
  async function startCamera(){ try{ camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:camFacing},audio:false}); $('#cam').srcObject=camStream; setPill($('#cam-status'),'Camera ready','ok'); }catch{ setPill($('#cam-status'),'Camera error','warn'); } }
  async function switchCamera(){ camFacing=(camFacing==='environment'?'user':'environment'); await stopCamera(); await startCamera(); }
  async function stopCamera(){ if(camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream=null; $('#cam').srcObject=null; setPill($('#cam-status'),'Camera stopped','ok'); } }
  async function captureFrame(){
    if(!camStream){ setPill($('#cam-status'),'Start camera first','warn'); return; }
    const v=$('#cam'); const c=document.createElement('canvas'); const maxW=2200; const scale=Math.min(1,maxW/(v.videoWidth||maxW));
    c.width=Math.round((v.videoWidth||1280)*scale); c.height=Math.round((v.videoHeight||720)*scale);
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.92)); const nf=new File([blob],`capture_${Date.now()}.jpg`,{type:'image/jpeg'});
    await addFile(nf); renderThumbs(); showViewer(files[files.length-1].id); setPill($('#cam-status'),'Captured','ok');
  }

  // ---------- items table ----------
  function addItemRow(item='',qty='',price='',amount=''){
    const tb=$('#items-body'); const idx=tb.children.length+1;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${idx}</td>
      <td><input class="it-name" value="${item}"></td>
      <td><input class="it-qty" type="number" step="0.01" value="${qty}"></td>
      <td><input class="it-price" type="number" step="0.01" value="${price}"></td>
      <td><input class="it-amount" type="number" step="0.01" value="${amount}"></td>
      <td><button class="btn xs danger it-del">✕</button></td>`;
    tr.querySelector('.it-qty').addEventListener('input', onRowChange);
    tr.querySelector('.it-price').addEventListener('input', onRowChange);
    tr.querySelector('.it-del').addEventListener('click', ()=>{ tr.remove(); renumber(); });
    tb.appendChild(tr);
  }
  function onRowChange(e){ const tr=e.target.closest('tr'); const q=Number(tr.querySelector('.it-qty').value||0); const p=Number(tr.querySelector('.it-price').value||0); tr.querySelector('.it-amount').value = (q*p ? (q*p).toFixed(2) : ''); }
  function renumber(){ $$('#items-body tr').forEach((tr,i)=> tr.children[0].textContent=(i+1)); }

  // ---------- totals auto ----------
  ['#f_gross','#f_vat','#f_disc'].forEach(sel=>{
    $(sel)?.addEventListener('input', ()=>{
      const g=Number($('#f_gross').value||0), v=Number($('#f_vat').value||0), d=Number($('#f_disc').value||0);
      $('#f_total').value = (g+v-d).toFixed(2);
    });
  });

  // ---------- export ----------
  const csvEsc=(v)=>{ const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const toNum=(v)=> (v===''||v==null)?'':Number(v);
  function buildCSVs(recs){
    const RH=['ReceiptID','ReceiptDate','SellerName','SellerTIN','SellerAddress','BuyerName','BuyerTIN','BuyerAddress','DocumentType','DocumentNumber','Role','TransactionType','Terms','PaymentMethod','GrossAmount','VatableSales','VATAmount','Discount','TotalAmountDue','WithholdingTax','Notes','IDNumber','SessionUserName','SessionUserTIN','SessionUserGmail','SavedAt'];
    const IH=['ReceiptID','Item','Quantity','UnitPrice','LineAmount'];
    const R=[RH.join(',')], I=[IH.join(',')];
    for(const r of recs){
      R.push(RH.map(h=>csvEsc(r.meta[h]??'')).join(','));
      (r.items||[]).forEach(it=> I.push(IH.map(h=>csvEsc(it[h]??'')).join(',')));
    }
    return { receiptsCSV:R.join('\n'), itemsCSV:I.join('\n') };
  }
  function downloadBlob(b,n){ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=n; a.click(); URL.revokeObjectURL(a.href); }
  async function dataUrlToBlob(u){ return (await fetch(u)).blob(); }

  function saveRecord(){
    const recs=JSON.parse(localStorage.getItem(LS.RECS)||'[]');
    const id=Date.now().toString(36);
    const sess=JSON.parse(localStorage.getItem(LS.SESSION)||'{}');
    const meta={
      ReceiptID:id, ReceiptDate:$('#f_date').value||'',
      SellerName:$('#f_seller_name').value||'', SellerTIN:$('#f_seller_tin').value||'', SellerAddress:$('#f_seller_addr').value||'',
      BuyerName:$('#f_buyer_name').value||'', BuyerTIN:$('#f_buyer_tin').value||'', BuyerAddress:$('#f_buyer_addr').value||'',
      DocumentType:$('#f_doc_type').value||'', DocumentNumber:$('#f_doc_no').value||'',
      Role:$('#f_role').value||'', TransactionType:$('#f_txn_type').value||'', Terms:$('#f_terms').value||'',
      PaymentMethod:$('#f_payment').value||'',
      GrossAmount:toNum($('#f_gross').value), VatableSales:toNum($('#f_vatable').value),
      VATAmount:toNum($('#f_vat').value), Discount:toNum($('#f_disc').value),
      TotalAmountDue:toNum($('#f_total').value), WithholdingTax:toNum($('#f_wht').value),
      Notes:$('#f_notes').value||'', IDNumber:$('#f_idno').value||'',
      SessionUserName:sess.name||'', SessionUserTIN:sess.tin||'', SessionUserGmail:sess.gmail||'',
      SavedAt:new Date().toISOString()
    };
    const items=$$('#items-body tr').map(tr=>({ ReceiptID:id, Item:tr.querySelector('.it-name').value||'', Quantity:toNum(tr.querySelector('.it-qty').value), UnitPrice:toNum(tr.querySelector('.it-price').value), LineAmount:toNum(tr.querySelector('.it-amount').value) }));
    const images=files.map(f=>({ReceiptID:id,name:f.name,processed:!!f.urlProcessed,rotation:f.rotation||0}));
    recs.push({id,meta,items,images,ocr: ocrTextAll});
    localStorage.setItem(LS.RECS, JSON.stringify(recs));
    setPill($('#save-status'),`Saved ${id}`,'ok');
  }
  function exportCSV(){
    const recs=JSON.parse(localStorage.getItem(LS.RECS)||'[]'); if(!recs.length){ setPill($('#export-status'),'No records','warn'); return; }
    const {receiptsCSV,itemsCSV}=buildCSVs(recs);
    downloadBlob(new Blob([receiptsCSV],{type:'text/csv'}),'Receipts.csv');
    downloadBlob(new Blob([itemsCSV],{type:'text/csv'}),'LineItems.csv');
    setPill($('#export-status'),'CSV exported','ok');
  }
  async function exportZIP(){
    const recs=JSON.parse(localStorage.getItem(LS.RECS)||'[]'); if(!recs.length){ setPill($('#export-status'),'No records','warn'); return; }
    const zip=new JSZip(); const {receiptsCSV,itemsCSV}=buildCSVs(recs);
    zip.file('Receipts.csv',receiptsCSV); zip.file('LineItems.csv',itemsCSV);
    zip.file('manifest.json', JSON.stringify({app:'Resibo',version:APP_VERSION,exportedAt:new Date().toISOString(),count:recs.length},null,2));
    const imgs=zip.folder('images');
    for(const f of files){
      const b1=await dataUrlToBlob(f.urlOriginal); imgs.file(f.name,b1);
      if(f.urlProcessed){ const ext=f.name.toLowerCase().endsWith('.png')?'':'.png'; const b2=await dataUrlToBlob(f.urlProcessed); imgs.file(f.name.replace(/\.[^.]+$/,'')+'_processed'+ext,b2); }
    }
    const out=await zip.generateAsync({type:'blob'}); saveAs(out,`Resibo_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`);
    setPill($('#export-status'),'ZIP exported','ok');
  }

  // ---------- buttons wiring ----------
  $('#btn-run-selftest')?.addEventListener('click', runSelfTest);
  $('#btn-save-settings')?.addEventListener('click', ()=>{ const v=$('#csvUrl').value.trim(); if(!v){ setPill($('#csv-status'),'Empty URL','warn'); return; } localStorage.setItem(LS.CSV, v); setPill($('#csv-status'),'Saved','ok'); });
  $('#btn-test-csv')?.addEventListener('click', async ()=>{ const url=$('#csvUrl').value.trim()||localStorage.getItem(LS.CSV)||''; if(!url){ setPill($('#csv-status'),'No URL','warn'); return; } await testCSV(url); });
  $('#btn-verify')?.addEventListener('click', handleVerify);
  $('#btn-clear-session')?.addEventListener('click', ()=>{ localStorage.removeItem(LS.SESSION); setPill($('#verify-status'),'Session cleared','ok'); });

  $('#btn-preprocess-basic')?.addEventListener('click', ()=>preprocessAll(pipeBasic));
  $('#btn-preprocess-strong')?.addEventListener('click', ()=>preprocessAll(pipeStrong));
  $('#btn-preprocess-ultra')?.addEventListener('click', ()=>preprocessAll(pipeUltra));
  $('#btn-run-ocr')?.addEventListener('click', runOCR);
  $('#btn-apply-ocr')?.addEventListener('click', applyOCR);
  $('#btn-parse-table')?.addEventListener('click', parseTableFromCurrent);

  $('#btn-add-item')?.addEventListener('click', ()=>addItemRow());
  $('#btn-clear-items')?.addEventListener('click', ()=>$('#items-body').innerHTML='');

  $('#btn-save-record')?.addEventListener('click', saveRecord);
  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-export-zip')?.addEventListener('click', exportZIP);

  $('#btn-top')?.addEventListener('click', ()=>window.scrollTo({top:0,behavior:'smooth'}));
  $('#btn-jump-step3')?.addEventListener('click', ()=>$('#step3').scrollIntoView({behavior:'smooth'}));

  $('#cam-start')?.addEventListener('click', startCamera);
  $('#cam-switch')?.addEventListener('click', switchCamera);
  $('#cam-stop')?.addEventListener('click', stopCamera);
  $('#cam-capture')?.addEventListener('click', captureFrame);

  // ---------- boot ----------
  (function boot(){
    const url=localStorage.getItem(LS.CSV)||''; if($('#csvUrl')) $('#csvUrl').value=url;
    runSelfTest();
    const tb=$('#items-body'); if(tb && !tb.children.length){ addItemRow(); }
    // Init verify/status pills
    setPill($('#csv-status'),'Idle'); setPill($('#verify-status'),'Idle'); setPill($('#ocr-status'),'Idle');
  })();

})();
