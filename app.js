/* Resibo App v3.6.1 — Tiny print OCR + clickable overlay */
(() => {
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  const APP_VERSION = '3.6.1';
  const LS = { CSV_URL:'resibo_csv_url', SESSION:'resibo_session', RECORDS:'resibo_records', OCRHINT:'resibo_ocr_hint' };

  let CSV_ROWS = [];
  let uploadedFiles = []; // {id,name,file?,urlOriginal,urlProcessed,rotation,ocr}
  let currentViewId = null;
  let ocrHintsText = '';

  // Overlay state
  const OVERLAY = { shapes: [], enabled: true, imgW: 0, imgH: 0 };

  // Camera
  let camStream = null;
  let camFacing = 'environment';

  const setPill = (el, text, kind) => { if(!el) return; el.textContent=text; el.className='pill ' + (kind||''); };

  // ---------------- Self-test
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
    for (const [n,fn] of tests){
      const ok = !!fn();
      const d = document.createElement('div');
      d.className = 'check ' + (ok?'ok':'bad');
      d.textContent = `${n} — ${ok?'OK':'FAIL'}`;
      host.appendChild(d);
    }
  }

  // ---------------- CSV parsing / verification
  function splitCSVLine(line){
    const out=[]; let cur='',q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'){ if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; }
      else if(c===',' && !q){ out.push(cur); cur=''; }
      else cur+=c;
    }
    out.push(cur); return out;
  }
  function parseCSV(text){
    const lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length) return [];
    const headers=lines[0].split(',').map(h=>h.trim().toLowerCase());
    const idx=h=>headers.indexOf(h);
    const rows=[];
    for(let i=1;i<lines.length;i++){
      const cols=splitCSVLine(lines[i]);
      rows.push({
        code:(cols[idx('code')]||'').trim(),
        name:(cols[idx('name')]||'').trim(),
        tin:(cols[idx('tin')]||'').trim(),
        gmail:(cols[idx('gmail')]||'').trim(),
        status:(cols[idx('status')]||'').trim(),
        expiry_date:(cols[idx('expiry_date')]||'').trim(),
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
      setPill($('#csv-status'),'Fetch failed','warn'); return false;
    }
  }
  async function verify(){
    const code=$('#acc_code').value.trim();
    const name=$('#acc_name').value.trim();
    const tin=$('#acc_tin').value.trim();
    const gmail=$('#acc_gmail').value.trim();
    const url=$('#csvUrl').value.trim()||localStorage.getItem(LS.CSV_URL);
    if(!url){ setPill($('#verify-status'),'CSV URL missing','warn'); return; }
    localStorage.setItem(LS.CSV_URL,url);
    if(!CSV_ROWS.length) await testCSV(url);
    const hit=CSV_ROWS.find(r=>(r.code||'').toLowerCase()===code.toLowerCase() && (r.gmail||'').toLowerCase()===gmail.toLowerCase());
    const active=(hit?.status||'').toLowerCase()==='active';
    const today=new Date().toISOString().slice(0,10);
    const valid=(hit?.expiry_date||'')>=today;
    if(!hit||!active||!valid){ setPill($('#verify-status'),'No matching ACTIVE record with valid EXPIRY_DATE','warn'); return; }
    localStorage.setItem(LS.SESSION, JSON.stringify({code,name,tin,gmail,expiry:hit.expiry_date}));
    setPill($('#verify-status'),'Verification success. Session stored for 7 days.','ok');
    $('#step2').scrollIntoView({behavior:'smooth'});
  }

  // ---------------- Upload / PDF
  $('#file-input')?.addEventListener('change', async e=>{
    const files=Array.from(e.target.files||[]);
    for(const f of files){
      if(f.type==='application/pdf') await importPDF(f);
      else await addFile(f);
    }
    renderThumbs();
    if(uploadedFiles[0]) showInViewer(uploadedFiles[0].id);
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
    const id=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    const urlOriginal=URL.createObjectURL(file);
    uploadedFiles.push({id,name:file.name,file,urlOriginal,urlProcessed:null,rotation:0,ocr:null});
  }
  function renderThumbs(){
    const host=$('#thumbs'); host.innerHTML='';
    uploadedFiles.forEach(f=>{
      const d=document.createElement('div'); d.className='thumb';
      const img=new Image();
      img.src=( $('#toggle-before-after').checked && f.urlProcessed ) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
      img.alt=f.name; img.addEventListener('click',()=>showInViewer(f.id));
      const cap=document.createElement('div'); cap.className='cap';
      const conf = f.ocr?.conf!=null ? ` • conf ${Math.round(f.ocr.conf)}%` : '';
      const prev = f.ocr?.text ? ` — “${f.ocr.text.slice(0,100).replace(/\s+/g,' ')}${f.ocr.text.length>100?'…':''}”` : '';
      cap.textContent = `${f.name}${conf}${prev}`;
      d.appendChild(img); d.appendChild(cap);
      host.appendChild(d);
    });
  }
  $('#toggle-before-after')?.addEventListener('change', ()=>{ renderThumbs(); if(currentViewId) showInViewer(currentViewId); });

  // ---------------- OpenCV pipelines (tiny print tuned)
  async function preprocessAll(pipeline){
    if(!window.cv) return setPill($('#ocr-status'),'OpenCV not ready','warn');
    setPill($('#ocr-status'),'Preprocessing…');
    const boostSmall = $('#chk-smallprint')?.checked;
    for(const f of uploadedFiles){
      const url = await processOne(f.urlOriginal, (m)=>pipeline(m, boostSmall), f.rotation||0);
      f.urlProcessed = url;
    }
    setPill($('#ocr-status'),'Preprocess done','ok');
    renderThumbs(); if(currentViewId) showInViewer(currentViewId);
  }
  async function processOne(url, pipeline, rot){
    return new Promise(res=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        const c=document.createElement('canvas'); const ctx=c.getContext('2d');
        c.width=img.naturalWidth; c.height=img.naturalHeight; ctx.drawImage(img,0,0);
        const src=cv.imread(c);
        let base=src; if(rot){ base=rotateMat(src,rot); src.delete(); }
        const out=pipeline(base); base.delete();
        const c2=document.createElement('canvas'); cv.imshow(c2,out);
        const data=c2.toDataURL('image/png',0.95);
        out.delete(); res(data);
      };
      img.onerror=()=>res(url);
      img.src=url;
    });
  }
  function rotateMat(src,deg){
    const dst=new cv.Mat(); const ctr=new cv.Point(src.cols/2, src.rows/2);
    const M=cv.getRotationMatrix2D(ctr,deg,1); cv.warpAffine(src,dst,M,new cv.Size(src.cols,src.rows),cv.INTER_LINEAR,cv.BORDER_REPLICATE); M.delete(); return dst;
  }
  function pipeBasic(src){ let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY); let o=new cv.Mat(); cv.threshold(g,o,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU); g.delete(); return o; }
  function pipeStrong(src, small=false){
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);
    if(small){ let up=new cv.Mat(); cv.resize(g,up,new cv.Size(0,0),1.6,1.6,cv.INTER_CUBIC); g.delete(); g=up; }
    cv.equalizeHist(g,g); const cla=new cv.CLAHE(2.0,new cv.Size(8,8)); cla.apply(g,g); cla.delete();
    cv.medianBlur(g,g,3); const ang=estimateSkew(g); const d=rotateMat(g,-ang); g.delete();
    let sharp=new cv.Mat(); let blur=new cv.Mat(); cv.GaussianBlur(d,blur,new cv.Size(0,0),2,2); cv.addWeighted(d,1.5,blur,-0.5,0,sharp); d.delete(); blur.delete();
    let bin=new cv.Mat(); cv.adaptiveThreshold(sharp,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY,35,10); sharp.delete(); return bin;
  }
  function pipeUltra(src, small=false){
    // Designed for tiny printed text + cursive
    let g=new cv.Mat(); cv.cvtColor(src,g,cv.COLOR_RGBA2GRAY);

    // Strong upscale for micro-fonts
    let up=new cv.Mat(); cv.resize(g,up,new cv.Size(0,0), small?2.0:1.6, small?2.0:1.6, cv.INTER_CUBIC); g.delete();

    // Illumination normalization
    let kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(31,31));
    let bg=new cv.Mat(); cv.morphologyEx(up,bg,cv.MORPH_OPEN,kernel);
    let normIllum=new cv.Mat(); cv.subtract(up,bg,normIllum); bg.delete(); kernel.delete();

    // Local contrast for tiny strokes
    const cla=new cv.CLAHE(2.5,new cv.Size(8,8)); cla.apply(normIllum,normIllum); cla.delete();

    // De-noise but preserve edges
    cv.medianBlur(normIllum,normIllum,3);

    // Slight unsharp
    let blur=new cv.Mat(); cv.GaussianBlur(normIllum,blur,new cv.Size(0,0),3,3);
    let sharp=new cv.Mat(); cv.addWeighted(normIllum,1.7,blur,-0.7,0,sharp); blur.delete(); normIllum.delete();

    // Deskew
    const ang=estimateSkew(sharp); let desk=rotateMat(sharp,-ang); sharp.delete();

    // Adaptive binarization tuned for small glyphs
    let bin=new cv.Mat(); cv.adaptiveThreshold(desk,bin,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,31,7); desk.delete();

    // Optional thin line removal (tables) to help OCR
    try {
      let edges=new cv.Mat(); cv.Canny(bin,edges,50,150);
      let lines=new cv.Mat(); cv.HoughLinesP(edges,lines,1,Math.PI/180,120,bin.cols/6,10);
      if(lines.rows){
        let mask=cv.Mat.zeros(bin.rows,bin.cols,cv.CV_8UC1);
        for(let i=0;i<lines.rows;i++){
          const x1=lines.data32S[i*4], y1=lines.data32S[i*4+1], x2=lines.data32S[i*4+2], y2=lines.data32S[i*4+3];
          cv.line(mask,new cv.Point(x1,y1),new cv.Point(x2,y2),new cv.Scalar(255,255,255,255),2);
        }
        let inv=new cv.Mat(); cv.bitwise_not(bin,inv);
        let cleared=new cv.Mat(); cv.bitwise_and(inv,cv.bitwise_not(mask),cleared);
        cv.bitwise_not(cleared,cleared);
        bin.delete(); bin=cleared;
        mask.delete(); inv.delete();
      }
      edges.delete(); lines.delete();
    } catch(e){}
    up.delete();
    return bin;
  }
  function estimateSkew(g){ let e=new cv.Mat(); cv.Canny(g,e,50,150); let L=new cv.Mat(); cv.HoughLines(e,L,1,Math.PI/180,150); e.delete(); if(!L.rows){L.delete();return 0;}
    const a=[]; for(let i=0;i<L.rows;i++){ let th=L.data32F[i*2+1]*(180/Math.PI); if(th>90) th-=180; a.push(th); } L.delete(); a.sort((x,y)=>x-y); return a[Math.floor(a.length/2)]||0; }

  // ---------------- OCR
  async function runOCR(){
    if(!window.Tesseract) return setPill($('#ocr-status'),'Tesseract not ready','warn');
    if(!uploadedFiles.length) return setPill($('#ocr-status'),'No images','warn');
    setPill($('#ocr-status'),'OCR running…');

    // Tesseract tuned for small print
    const opts = {
      tessedit_pageseg_mode: 6,  // Assume a block of text
      preserve_interword_spaces: 1
    };

    let all='';
    for(const f of uploadedFiles){
      const src = ($('#toggle-before-after').checked || !f.urlProcessed) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);
      const { data } = await Tesseract.recognize(src,'eng',opts);
      const conf = data.confidence ?? 0;
      f.ocr = { text:data.text||'', conf:conf||0 };
      all += '\n' + (data.text||'');
    }
    ocrHintsText = all.trim();
    localStorage.setItem(LS.OCRHINT, ocrHintsText);
    setPill($('#ocr-status'),'OCR done','ok');
    renderThumbs();
    $('#step3').scrollIntoView({behavior:'smooth'});
  }

  // ---------------- Smart mapping helpers
  const norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
  function levenshtein(a,b){
    a=a||''; b=b||'';
    const m=a.length, n=b.length;
    const dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
    for(let i=0;i<=m;i++) dp[i][0]=i;
    for(let j=0;j<=n;j++) dp[0][j]=j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        const cost = a[i-1]===b[j-1]?0:1;
        dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      }
    }
    return dp[m][n];
  }
  function fuzzyIncludes(text, label, maxDist=2){
    text=norm(text); label=norm(label);
    if(text.includes(label)) return true;
    const words=text.split(/\s+/); const L=label.split(/\s+/);
    for(let i=0;i<=words.length-L.length;i++){
      const window=words.slice(i,i+L.length).join(' ');
      if(levenshtein(window,label)<=maxDist) return true;
    }
    return false;
  }
  function pickValueByType(text,type){
    const t=text.trim();
    if(type==='number'){
      const m=t.match(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/);
      if(m) return Number(m[0].replace(/[,\s]/g,''));
      return null;
    }
    if(type==='amount'){
      const m=t.match(/(?:₱|\$)?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?/);
      if(m) return Number(m[0].replace(/[₱$\s,]/g,''));
      return null;
    }
    if(type==='date'){
      const m=t.match(/\b(20\d{2}[-/.](0[1-9]|1[0-2])[-/.]([0-2]\d|3[01])|([01]?\d)[-/.]([0-2]?\d|3[01])[-/.](20\d{2}|19\d{2})|([A-Za-z]{3,9})\s+([0-3]?\d),\s*(20\d{2}|19\d{2}))\b/);
      if(m) return m[0].replace(/[.]/g,'-').replace(/\//g,'-');
      return null;
    }
    if(type==='tin'){
      const m=t.match(/\b\d{3}[- ]?\d{3}[- ]?\d{3}[- ]?\d{3}\b|\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/);
      if(m) return m[0].replace(/\s/g,'');
      return null;
    }
    return pickValueByType(t,'amount') ?? pickValueByType(t,'date') ?? t;
  }
  function findLabelValue(lines, labels, {valueType='auto', window=1}={}){
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(labels.some(l=>fuzzyIncludes(line,l))){
        const candidates=[];
        const same = line.split(/[:\-–]/).slice(1).join(':').trim();
        if(same) candidates.push(same);
        for(let k=1;k<=window && (i+k)<lines.length;k++) candidates.push(lines[i+k].trim());
        for(const cand of candidates){
          const v = pickValueByType(cand, valueType);
          if(v!=null) return v;
        }
      }
    }
    return null;
  }
  function pickLargestAmount(lines){
    const nums = Array.from(lines.join(' ').matchAll(/\b(?:₱|\$)?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?\b/g)).map(m=>Number(m[0].replace(/[₱$\s,]/g,'')));
    if(!nums.length) return null;
    return Math.max(...nums);
  }
  function extractLineItemsHeuristic(lines){
    const out=[];
    for(const ln of lines){
      const clean = ln.replace(/[|]/g,' ').replace(/\s{2,}/g,' ').trim();
      const nums = Array.from(clean.matchAll(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\b/g)).map(m=>m[0].replace(/[,\s]/g,''));
      if(nums.length>=2){
        const qty = Number(nums[0]);
        const price = Number(nums[1]||'');
        const amount = Number(nums[2]|| (qty&&price? (qty*price).toFixed(2) : ''));
        const itemName = clean.replace(/\b\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\b/g,'').replace(/[×x*@=:]/g,' ').replace(/\s{2,}/g,' ').trim();
        if(itemName && (qty||price||amount)){
          out.push({Item:itemName, Quantity:qty||'', UnitPrice:price||'', LineAmount:amount||''});
        }
      }
    }
    return out.slice(0,20);
  }
  function mapOCRToFields(raw){
    const t = (raw||'').replace(/\r/g,'');
    const lines = t.split('\n').map(x=>x.trim()).filter(Boolean);

    const date = findLabelValue(lines, ['date','transaction date','issued on','invoice date','receipt date'], {valueType:'date',window:2})
               || pickValueByType(lines.join(' '),'date');

    let docType=''; let docNo='';
    for(const ln of lines){
      const m = ln.match(/\b(OR|O\.R\.|SI|S\.I\.)[- ]?[:#]?\s*([A-Z]*\d[\d\-\/]*)\b/i);
      if(m){ docType = m[1].toUpperCase().includes('OR')?'Official Receipt':'Sales Invoice'; docNo = m[2]; break; }
    }
    if(!docNo){
      const m = lines.join(' ').match(/\b(No\.?|Number)[:#]?\s*([A-Z]*\d[\d\-\/]*)\b/i);
      if(m){ docNo = m[2]; }
    }
    if(!docType){
      const hasOR  = lines.some(l=>fuzzyIncludes(l,'official receipt') || /\bOR\b/.test(l));
      const hasSI  = lines.some(l=>fuzzyIncludes(l,'sales invoice') || /\bSI\b/.test(l));
      docType = hasOR?'Official Receipt':(hasSI?'Sales Invoice':(docNo?'Receipt':''));
    }

    const sellerName  = findLabelValue(lines, ['seller','merchant','store','supplier'], {window:2}) || null;
    const buyerName   = findLabelValue(lines, ['buyer','customer','client','payor'], {window:2}) || null;
    const sellerTIN   = findLabelValue(lines, ['seller tin','tin','tax id','tax identification number'], {valueType:'tin',window:2});
    const buyerTIN    = findLabelValue(lines, ['buyer tin','tin','tax id','tax identification number'], {valueType:'tin',window:2});

    const sellerAddr  = findLabelValue(lines, ['seller address','address','business address'], {window:2});
    const buyerAddr   = findLabelValue(lines, ['buyer address','address','billing address'], {window:2});

    const gross = findLabelValue(lines, ['gross amount','amount','subtotal','total sales (gross)','total gross'], {valueType:'amount',window:2});
    const vatable = findLabelValue(lines, ['vatable sales','vat-able sales','vatable','vatable sale','vatable amount','vatable sales amount'], {valueType:'amount',window:2});
    const vatAmt = findLabelValue(lines, ['vat amount','vat','12% vat','value added tax'], {valueType:'amount',window:2});
    const disc   = findLabelValue(lines, ['discount','disc.','less: discount'], {valueType:'amount',window:2});
    const total  = findLabelValue(lines, ['total amount due','total due','amount due','total'], {valueType:'amount',window:2})
                || pickLargestAmount(lines);

    const payMeth= findLabelValue(lines, ['payment method','payment','mode of payment','paid via'], {window:1});

    const items = extractLineItemsHeuristic(lines);

    return {
      date, docType, docNo,
      sellerName, sellerTIN, sellerAddr,
      buyerName,  buyerTIN,  buyerAddr,
      gross, vatable, vatAmt, disc, total, payMeth,
      items
    };
  }

  // ---------------- Layout-based table parser + overlay (clickable)
  async function parseTableFromCurrent(){
    const f = uploadedFiles.find(x=>x.id===currentViewId) || uploadedFiles[0];
    if(!f) return setPill($('#save-status'),'No image','warn');
    const srcUrl = (f.urlProcessed||f.urlOriginal);

    const mat = await loadImageToMat(srcUrl);
    if(!mat) return setPill($('#save-status'),'OpenCV image load failed','warn');

    // Prep
    let g=new cv.Mat(); cv.cvtColor(mat,g,cv.COLOR_RGBA2GRAY);
    let g2=new cv.Mat(); cv.resize(g,g2,new cv.Size(0,0),1.3,1.3,cv.INTER_CUBIC); g.delete();
    let bin=new cv.Mat(); cv.adaptiveThreshold(g2,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,35,10); g2.delete();

    const scaleW = Math.max(30, Math.floor(bin.cols/30));
    const scaleH = Math.max(15, Math.floor(bin.rows/60));

    let horizK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(scaleW,1));
    let vertK  = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1,scaleH));

    let horiz=new cv.Mat(); cv.erode(bin,horiz,horizK); cv.dilate(horiz,horiz,horizK);
    let vert =new cv.Mat(); cv.erode(bin,vert,vertK);  cv.dilate(vert,vert,vertK);

    let grid=new cv.Mat(); cv.addWeighted(horiz,0.5,vert,0.5,0,grid);

    let contours=new cv.MatVector(), hierarchy=new cv.Mat();
    cv.findContours(grid, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const boxes=[];
    for(let i=0;i<contours.size();i++){
      const r=cv.boundingRect(contours.get(i));
      if(r.width>Math.max(180, bin.cols*0.25) && r.height>15){ boxes.push(r); }
    }
    boxes.sort((a,b)=> (a.y===b.y ? a.x-b.x : a.y-b.y));

    if(!boxes.length){
      clean([mat,bin,horiz,vert,grid,contours,hierarchy,horizK,vertK]);
      return setPill($('#save-status'),'No table grid detected','warn');
    }

    const table = boxes[0];
    const roi = mat.roi(new cv.Rect(table.x,table.y,table.width,table.height));
    let rg=new cv.Mat(); cv.cvtColor(roi,rg,cv.COLOR_RGBA2GRAY);
    let rbin=new cv.Mat(); cv.adaptiveThreshold(rg,rbin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,33,8);

    let rh=new cv.Mat(), rv=new cv.Mat();
    let hk=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(Math.max(30,Math.floor(roi.cols/25)),1));
    let vk=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(1,Math.max(18,Math.floor(roi.rows/35))));
    cv.erode(rbin,rh,hk); cv.dilate(rh,rh,hk);
    cv.erode(rbin,rv,vk); cv.dilate(rv,rv,vk);

    const cols = projectPeaks(rv, 'vertical').sort((a,b)=>a-b);
    const rows = projectPeaks(rh, 'horizontal').sort((a,b)=>a-b);

    if(cols.length<3 || rows.length<2){
      clean([mat,bin,horiz,vert,grid,contours,hierarchy,horizK,vertK, roi,rg,rbin,rh,rv,hk,vk]);
      return setPill($('#save-status'),'Table too faint','warn');
    }

    const colEdges = unique(cols);
    const rowEdges = unique(rows);

    const toAbs = (x,y,w,h)=>({x:table.x+x, y:table.y+y, w, h});

    const items=[];
    const overlayShapes=[];
    for(let r=0; r<rowEdges.length-1; r++){
      const y1=rowEdges[r], y2=rowEdges[r+1]; const height=y2-y1; if(height<18) continue;

      const last3 = colEdges.slice(-3);
      const qtyCol    = last3[0];
      const priceCol  = last3[1] ?? last3[0];
      const amtCol    = last3[2] ?? last3[1];
      const itemRight = qtyCol;

      const regions = [
        { key:'Item',       x1:0,          x2:itemRight-2, color:'#1e3a8a' },
        { key:'Quantity',   x1:qtyCol+2,   x2:priceCol-2,  color:'#065f46' },
        { key:'UnitPrice',  x1:priceCol+2, x2:amtCol-2,    color:'#854d0e' },
        { key:'LineAmount', x1:amtCol+2,   x2:roi.cols-2,  color:'#7f1d1d' },
      ];

      const obj={Item:'',Quantity:'',UnitPrice:'',LineAmount:''};
      for(const reg of regions){
        const rect = { x:reg.x1, y:y1+2, w:Math.max(4, reg.x2-reg.x1), h:Math.max(12, height-4) };
        if(rect.w<10 || rect.h<12) continue;
        // OCR cell
        const cell = roi.roi(new cv.Rect(rect.x, rect.y, rect.w, rect.h));
        const txt = await ocrMat(cell);
        cell.delete();
        if(reg.key==='Quantity' || reg.key==='UnitPrice' || reg.key==='LineAmount'){
          const v = (txt||'').match(/\d+(?:\.\d+)?/);
          obj[reg.key] = v ? Number(v[0]).toString() : '';
        } else {
          obj[reg.key] = (txt||'').replace(/\s+/g,' ').trim();
        }
        // overlay rect
        const abs = toAbs(rect.x, rect.y, rect.w, rect.h);
        overlayShapes.push({ ...abs, type: reg.key.toLowerCase(), color: reg.color, rowIndex: items.length });
      }
      if(obj.Item || obj.Quantity || obj.UnitPrice || obj.LineAmount){
        items.push(obj);
      }
    }

    // Render rows
    $('#items-body').innerHTML='';
    items.slice(0,40).forEach(it=> addItemRow(it.Item,it.Quantity,it.UnitPrice,it.LineAmount));
    const rowsEls = $$('#items-body tr');
    OVERLAY.shapes = overlayShapes.map(s=>({ ...s, rowIndex: Math.max(0, Math.min(s.rowIndex, rowsEls.length-1)) }));

    const img = ($('#toggle-before-after').checked ? $('#v-before') : $('#v-after'));
    OVERLAY.imgW = img.naturalWidth || OVERLAY.imgW;
    OVERLAY.imgH = img.naturalHeight || OVERLAY.imgH;
    drawOverlay();

    setPill($('#save-status'),`Parsed ${items.length} line item(s) via layout grid`,'ok');

    clean([mat,bin,horiz,vert,grid,contours,hierarchy,horizK,vertK, roi,rg,rbin,rh,rv,hk,vk]);

    function unique(a){ return Array.from(new Set(a)).sort((x,y)=>x-y); }
    function projectPeaks(mask, dir){
      const peaks=[];
      if(dir==='vertical'){
        for(let x=0;x<mask.cols;x++){
          let s=0; for(let y=0;y<mask.rows;y++) s += mask.ucharPtr(y,x)[0];
          if(s> mask.rows*255*0.15) peaks.push(x);
        }
      } else {
        for(let y=0;y<mask.rows;y++){
          let s=0; for(let x=0;x<mask.cols;x++) s += mask.ucharPtr(y,x)[0];
          if(s> mask.cols*255*0.12) peaks.push(y);
        }
      }
      return peaks;
    }
    function clean(arr){ try{ arr.forEach(m=>{ if(m && m.delete) m.delete(); }); }catch(e){} }
  }

  async function loadImageToMat(url){
    return new Promise(res=>{
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{
        const c=document.createElement('canvas'); c.width=img.naturalWidth; c.height=img.naturalHeight;
        c.getContext('2d').drawImage(img,0,0);
        try{ const m=cv.imread(c); res(m); } catch { res(null); }
      };
      img.onerror=()=>res(null);
      img.src=url;
    });
  }
  async function ocrMat(mat){
    const c=document.createElement('canvas'); cv.imshow(c,mat);
    const url=c.toDataURL('image/png',0.95);
    try{
      const { data } = await Tesseract.recognize(url,'eng',{ tessedit_pageseg_mode: 6, preserve_interword_spaces: 1 });
      return data.text||'';
    }catch{ return ''; }
  }

  // ---------------- Overlay drawing + clicking
  function drawOverlay(){
    const canvas = $('#v-overlay');
    const show = $('#chk-overlay')?.checked;
    OVERLAY.enabled = !!show;
    if(!show){ canvas.width=1; canvas.height=1; canvas.style.display='none'; return; }

    const img = ($('#toggle-before-after').checked ? $('#v-before') : $('#v-after'));
    const w = img.naturalWidth || OVERLAY.imgW || 0;
    const h = img.naturalHeight || OVERLAY.imgH || 0;
    if(!w || !h){ canvas.style.display='none'; return; }

    canvas.width = w; canvas.height = h;
    canvas.style.display='block';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,w,h);
    for(const s of OVERLAY.shapes){
      ctx.strokeStyle = s.color || '#2563eb';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.95;
      ctx.strokeRect(s.x, s.y, s.w, s.h);

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = s.color || '#2563eb';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.globalAlpha = 1.0;
    }
  }
  function clearOverlay(){ OVERLAY.shapes=[]; drawOverlay(); setPill($('#save-status'),'Overlay cleared','ok'); }

  // click → focus corresponding input
  $('#v-overlay')?.addEventListener('click', e=>{
    if(!OVERLAY.enabled || !OVERLAY.shapes.length) return;
    const canvas = $('#v-overlay');
    const rect = canvas.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;

    const scaleX = (OVERLAY.imgW || canvas.width) / rect.width;
    const scaleY = (OVERLAY.imgH || canvas.height) / rect.height;
    let x = rx * scaleX, y = ry * scaleY;

    const rot = (viewer.rot||0) % 360;
    if(rot===90){ const ox=x, oy=y; x=oy; y=(OVERLAY.imgH)-ox; }
    else if(rot===180){ x=(OVERLAY.imgW)-x; y=(OVERLAY.imgH)-y; }
    else if(rot===270){ const ox=x, oy=y; x=(OVERLAY.imgW)-oy; y=ox; }

    const hit = OVERLAY.shapes.find(s => x>=s.x && x<=s.x+s.w && y>=s.y && y<=s.y+s.h);
    if(!hit) return;

    const rows = $$('#items-body tr');
    const row = rows[hit.rowIndex] || rows[0];
    if(!row) return;

    let selector = '.it-name';
    if(hit.type==='quantity') selector = '.it-qty';
    else if(hit.type==='unitprice') selector = '.it-price';
    else if(hit.type==='lineamount') selector = '.it-amount';

    const input = row.querySelector(selector);
    if(input){
      input.scrollIntoView({behavior:'smooth', block:'center'});
      input.focus({preventScroll:true});
      input.classList.add('flash','flash-anim');
      setTimeout(()=>input.classList.remove('flash','flash-anim'), 1200);
    }
  });

  // ---------------- Apply OCR → Fields
  function applyOCR(){
    const raw = ocrHintsText || localStorage.getItem(LS.OCRHINT) || '';
    if(!raw){ setPill($('#save-status'),'No OCR text yet','warn'); return; }
    const M = mapOCRToFields(raw);

    if(M.date)       $('#f_date').value = M.date;
    if(M.docType)    $('#f_doc_type').value = M.docType;
    if(M.docNo)      $('#f_doc_no').value = M.docNo;

    if(M.sellerName) $('#f_seller_name').value = M.sellerName;
    if(M.sellerTIN)  $('#f_seller_tin').value = M.sellerTIN;
    if(M.sellerAddr) $('#f_seller_addr').value = M.sellerAddr;

    if(M.buyerName)  $('#f_buyer_name').value = M.buyerName;
    if(M.buyerTIN)   $('#f_buyer_tin').value = M.buyerTIN;
    if(M.buyerAddr)  $('#f_buyer_addr').value = M.buyerAddr;

    if(M.gross!=null)    $('#f_gross').value   = Number(M.gross).toFixed(2);
    if(M.vatable!=null)  $('#f_vatable').value = Number(M.vatable).toFixed(2);
    if(M.vatAmt!=null)   $('#f_vat').value     = Number(M.vatAmt).toFixed(2);
    if(M.disc!=null)     $('#f_disc').value    = Number(M.disc).toFixed(2);
    if(M.total!=null)    $('#f_total').value   = Number(M.total).toFixed(2);

    if(M.payMeth)        $('#f_payment').value = M.payMeth;

    if((M.items||[]).length){
      $('#items-body').innerHTML='';
      M.items.forEach(it=> addItemRow(it.Item,it.Quantity,it.UnitPrice,it.LineAmount));
    }

    const sess = JSON.parse(localStorage.getItem(LS.SESSION)||'{}');
    const user = norm(sess.name||''); const seller = norm(M.sellerName||'');
    $('#f_role').value = (user && seller && user.includes(seller)) ? 'SELLER/ISSUER' : 'BUYER/PAYOR';

    setPill($('#save-status'),'OCR mapping applied (review/edit)','ok');
  }

  // ---------------- Save / Export
  const csvEsc = v => { const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const toNum = v => (v===''||v==null)?'':Number(v);
  function buildCSVs(recs){
    const RH=[
      'ReceiptID','ReceiptDate',
      'SellerName','SellerTIN','SellerAddress',
      'BuyerName','BuyerTIN','BuyerAddress',
      'DocumentType','DocumentNumber',
      'Role','TransactionType','Terms','PaymentMethod',
      'GrossAmount','VatableSales','VATAmount','Discount','TotalAmountDue','WithholdingTax',
      'Notes','IDNumber','SessionUserName','SessionUserTIN','SessionUserGmail','SavedAt'
    ];
    const IH=['ReceiptID','Item','Quantity','UnitPrice','LineAmount'];
    const R=[RH.join(',')], I=[IH.join(',')];
    for(const r of recs){
      R.push(RH.map(h=>csvEsc(r.meta[h]??'')).join(','));
      for(const it of r.items||[]) I.push(IH.map(h=>csvEsc(it[h]??'')).join(','));
    }
    return { receiptsCSV:R.join('\n'), itemsCSV:I.join('\n') };
  }
  function downloadBlob(b,n){ const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=n; a.click(); URL.revokeObjectURL(a.href); }
  function dataUrlToBlob(u){ return fetch(u).then(r=>r.blob()); }

  function saveRecord(){
    const recs=JSON.parse(localStorage.getItem(LS.RECORDS)||'[]');
    const id=Date.now().toString(36);
    const sess=JSON.parse(localStorage.getItem(LS.SESSION)||'{}');
    const m={
      ReceiptID:id, ReceiptDate:$('#f_date').value||'',
      SellerName:$('#f_seller_name').value||'', SellerTIN:$('#f_seller_tin').value||'', SellerAddress:$('#f_seller_addr').value||'',
      BuyerName:$('#f_buyer_name').value||'', BuyerTIN:$('#f_buyer_tin').value||'', BuyerAddress:$('#f_buyer_addr').value||'',
      DocumentType:$('#f_doc_type').value||'', DocumentNumber:$('#f_doc_no').value||'',
      Role:$('#f_role').value||'', TransactionType:$('#f_txn_type').value||'', Terms:$('#f_terms').value||'',
      PaymentMethod:$('#f_payment').value||'',
      GrossAmount:toNum($('#f_gross').value),
      VatableSales:toNum($('#f_vatable').value),
      VATAmount:toNum($('#f_vat').value),
      Discount:toNum($('#f_disc').value),
      TotalAmountDue:toNum($('#f_total').value),
      WithholdingTax:toNum($('#f_wht').value),
      Notes:$('#f_notes').value||'', IDNumber:$('#f_idno').value||'',
      SessionUserName:sess.name||'', SessionUserTIN:sess.tin||'', SessionUserGmail:sess.gmail||'',
      SavedAt:new Date().toISOString()
    };
    const items=$$('#items-body tr').map(tr=>({
      ReceiptID:id,
      Item:tr.querySelector('.it-name').value||'',
      Quantity:toNum(tr.querySelector('.it-qty').value),
      UnitPrice:toNum(tr.querySelector('.it-price').value),
      LineAmount:toNum(tr.querySelector('.it-amount').value)
    }));
    const images=uploadedFiles.map(f=>({ReceiptID:id,name:f.name,processed:!!f.urlProcessed,rotation:f.rotation||0}));
    recs.push({id,meta:m,items,images,ocr: ocrHintsText});
    localStorage.setItem(LS.RECORDS, JSON.stringify(recs));
    setPill($('#save-status'),`Saved as ${id}`,'ok');
  }

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
    const out=await zip.generateAsync({type:'blob'}); saveAs(out,`Resibo_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.zip`);
    setPill($('#export-status'),'ZIP exported','ok');
  }

  // ---------------- Items table
  function addItemRow(item='',qty='',price='',amount=''){
    const tb=$('#items-body'); const idx=tb.children.length+1;
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${idx}</td>
      <td><input class="it-name" value="${item}"></td>
      <td><input class="it-qty" type="number" step="0.01" value="${qty}"></td>
      <td><input class="it-price" type="number" step="0.01" value="${price}"></td>
      <td><input class="it-amount" type="number" step="0.01" value="${amount}"></td>
      <td><button class="btn xs danger it-del">✕</button></td>`;
    tr.querySelector('.it-qty').addEventListener('input', recalcRow);
    tr.querySelector('.it-price').addEventListener('input', recalcRow);
    tr.querySelector('.it-del').addEventListener('click', ()=>{ tr.remove(); renumber(); });
    tb.appendChild(tr);
  }
  function recalcRow(e){ const tr=e.target.closest('tr'); const q=Number(tr.querySelector('.it-qty').value||0); const p=Number(tr.querySelector('.it-price').value||0); tr.querySelector('.it-amount').value=(q*p?(q*p).toFixed(2):''); }
  function renumber(){ $$('#items-body tr').forEach((tr,i)=> tr.children[0].textContent=(i+1)); }

  // ---------------- Viewer & overlay transforms
  const viewer={ scale:1, rot:0, ox:0, oy:0,
    apply(){ 
      const t=`rotate(${this.rot}deg) translate(${this.ox}px,${this.oy}px) scale(${this.scale})`;
      $('#v-before').style.transform=t; $('#v-after').style.transform=t; 
      $('#v-overlay').style.transform=t;
    },
    filters(){ const bs=Number($('#v-bright').value||100)/100; const cs=Number($('#v-contrast').value||100)/100; $('#v-before').style.filter=`brightness(${bs}) contrast(${cs})`; $('#v-after').style.filter=`brightness(${bs}) contrast(${cs})`; }
  };
  function showInViewer(id){
    currentViewId=id; const f=uploadedFiles.find(x=>x.id===id); if(!f) return;
    const before=$('#v-before'), after=$('#v-after'), overlay=$('#v-overlay');
    before.src=f.urlOriginal;
    after.src=( $('#toggle-before-after').checked || !f.urlProcessed ) ? f.urlOriginal : (f.urlProcessed||f.urlOriginal);

    const img = ($('#toggle-before-after').checked || !f.urlProcessed) ? before : after;
    img.onload = () => {
      OVERLAY.imgW = img.naturalWidth; OVERLAY.imgH = img.naturalHeight;
      overlay.width = OVERLAY.imgW; overlay.height = OVERLAY.imgH;
      drawOverlay();
    };

    viewer.scale=1; viewer.rot=f.rotation||0; viewer.ox=0; viewer.oy=0; 
    $('#v-zoom-slider').value=100; $('#v-bright').value=100; $('#v-contrast').value=100; 
    viewer.apply(); viewer.filters();
    $('#step3').scrollIntoView({behavior:'smooth'});
  }
  (function wireViewer(){
    const canv=$('#viewer-canvas'); let panning=false,sx=0,sy=0,last=null;
    canv.addEventListener('wheel',e=>{e.preventDefault(); const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)+(e.deltaY<0?10:-10))); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply();},{passive:false});
    canv.addEventListener('mousedown',e=>{panning=true;sx=e.clientX;sy=e.clientY;canv.style.cursor='grabbing';});
    window.addEventListener('mouseup',()=>{panning=false;canv.style.cursor='default';});
    window.addEventListener('mousemove',e=>{ if(!panning)return; viewer.ox+=(e.clientX-sx); viewer.oy+=(e.clientY-sy); sx=e.clientX; sy=e.clientY; viewer.apply(); });
    canv.addEventListener('touchstart',e=>{ if(e.touches.length===2){ last=dist(e.touches[0],e.touches[1]); } else { sx=e.touches[0].clientX; sy=e.touches[0].clientY; } },{passive:false});
    canv.addEventListener('touchmove',e=>{ e.preventDefault(); if(e.touches.length===2&&last!=null){ const d=dist(e.touches[0],e.touches[1]); const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)+(d-last)/2)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); last=d; } else if(e.touches.length===1){ viewer.ox+=(e.touches[0].clientX-sx); viewer.oy+=(e.touches[0].clientY-sy); sx=e.touches[0].clientX; sy=e.touches[0].clientY; viewer.apply(); } },{passive:false});
    canv.addEventListener('touchend',()=>{ last=null; });
    function dist(a,b){ const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY; return Math.hypot(dx,dy); }

    $('#v-zoom-slider').addEventListener('input',e=>{ viewer.scale=Number(e.target.value)/100; viewer.apply(); });
    $('#v-zoom-in').addEventListener('click',()=>{ const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)+10)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-zoom-out').addEventListener('click',()=>{ const v=Math.max(30,Math.min(600,Number($('#v-zoom-slider').value)-10)); $('#v-zoom-slider').value=v; viewer.scale=v/100; viewer.apply(); });
    $('#v-1x').addEventListener('click',()=>{ $('#v-zoom-slider').value=100; viewer.scale=1; viewer.ox=0; viewer.oy=0; viewer.apply(); });
    $('#v-fit').addEventListener('click',()=>{ const img=$('#v-after'); if(!img.naturalHeight) return; const boxH=$('#viewer-canvas').clientHeight; const pct=Math.max(30,Math.min(600,Math.round((boxH/img.naturalHeight)*100))); $('#v-zoom-slider').value=pct; viewer.scale=pct/100; viewer.ox=0; viewer.oy=0; viewer.apply(); });
    $('#v-rotate').addEventListener('click',()=>{ viewer.rot=(viewer.rot+90)%360; viewer.apply(); const f=uploadedFiles.find(x=>x.id===currentViewId); if(f) f.rotation=viewer.rot; drawOverlay(); });
    $('#v-bright').addEventListener('input',()=>viewer.filters());
    $('#v-contrast').addEventListener('input',()=>viewer.filters());

    $('#chk-overlay')?.addEventListener('change', drawOverlay);
    $('#btn-clear-overlay')?.addEventListener('click', clearOverlay);
  })();

  // ---------------- Camera
  async function startCamera(){
    try{
      camStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: camFacing }, audio:false });
      $('#cam').srcObject = camStream;
      setPill($('#cam-status'],'Camera ready','ok');
    } catch {
      setPill($('#cam-status'),'Camera error (permissions?)','warn');
    }
  }
  async function switchCamera(){ camFacing=(camFacing==='environment'?'user':'environment'); await stopCamera(); await startCamera(); }
  async function stopCamera(){ if(camStream){ camStream.getTracks().forEach(t=>t.stop()); camStream=null; $('#cam').srcObject=null; setPill($('#cam-status'),'Camera stopped','ok'); } }
  async function captureFrame(){
    if(!camStream) return setPill($('#cam-status'],'Start camera first','warn');
    const video=$('#cam'); const c=document.createElement('canvas');
    const maxW=2200; const scale=Math.min(1,maxW/(video.videoWidth||maxW));
    c.width=Math.round((video.videoWidth||1280)*scale); c.height=Math.round((video.videoHeight||720)*scale);
    c.getContext('2d').drawImage(video,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.92));
    const file=new File([blob],`capture_${Date.now()}.jpg`,{type:'image/jpeg'});
    await addFile(file); renderThumbs(); showInViewer(uploadedFiles[uploadedFiles.length-1].id); setPill($('#cam-status'),'Captured','ok');
  }

  // ---------------- Buttons
  $('#btn-run-selftest')?.addEventListener('click', runSelfTest);
  $('#btn-save-settings')?.addEventListener('click', ()=>{ const v=$('#csvUrl').value.trim(); if(!v) return; localStorage.setItem(LS.CSV_URL,v); setPill($('#csv-status'),'Saved','ok'); });
  $('#btn-test-csv')?.addEventListener('click', async ()=>{ const url=$('#csvUrl').value.trim()||localStorage.getItem(LS.CSV_URL); if(!url) return setPill($('#csv-status'),'No URL','warn'); await testCSV(url); });
  $('#btn-verify')?.addEventListener('click', verify);

  $('#btn-preprocess-basic')?.addEventListener('click', ()=>preprocessAll(pipeBasic));
  $('#btn-preprocess-strong')?.addEventListener('click', ()=>preprocessAll(pipeStrong));
  $('#btn-preprocess-ultra')?.addEventListener('click', ()=>preprocessAll(pipeUltra));

  $('#btn-run-ocr')?.addEventListener('click', runOCR);
  $('#btn-apply-ocr')?.addEventListener('click', applyOCR);
  $('#btn-parse-table')?.addEventListener('click', parseTableFromCurrent);

  $('#btn-add-item')?.addEventListener('click', ()=>addItemRow());
  $('#btn-clear-items')?.addEventListener('click', ()=>$('#items-body').innerHTML='');

  ['#f_gross','#f_vat','#f_disc'].forEach(sel=>{
    $(sel)?.addEventListener('input', ()=>{
      const g=Number($('#f_gross').value||0), v=Number($('#f_vat').value||0), d=Number($('#f_disc').value||0);
      $('#f_total').value = (g+v-d).toFixed(2);
    });
  });

  $('#btn-save-record')?.addEventListener('click', saveRecord);
  $('#btn-export-csv')?.addEventListener('click', exportCSV);
  $('#btn-export-zip')?.addEventListener('click', exportZIP);

  $('#btn-top')?.addEventListener('click', ()=>window.scrollTo({top:0,behavior:'smooth'}));
  $('#btn-jump-step3')?.addEventListener('click', ()=>$('#step3').scrollIntoView({behavior:'smooth'}));

  $('#cam-start')?.addEventListener('click', startCamera);
  $('#cam-switch')?.addEventListener('click', switchCamera);
  $('#cam-stop')?.addEventListener('click', stopCamera);
  $('#cam-capture')?.addEventListener('click', captureFrame);

  $('#btn-clear-session')?.addEventListener('click', ()=>{ localStorage.removeItem(LS.SESSION); setPill($('#verify-status'),'Session cleared','ok'); });
  $('#btn-full-reset')?.addEventListener('click', ()=>{ const keep=localStorage.getItem(LS.CSV_URL); localStorage.clear(); if(keep) localStorage.setItem(LS.CSV_URL,keep); uploadedFiles=[]; $('#thumbs').innerHTML=''; OVERLAY.shapes=[]; drawOverlay(); setPill($('#verify-status'),'Reset done','ok'); });

  // ---------------- Boot
  (function(){
    const url=localStorage.getItem(LS.CSV_URL)||''; if($('#csvUrl')) $('#csvUrl').value=url;
    runSelfTest();
    // Prepare one empty row to start
    const tb=$('#items-body'); if(tb && !tb.children.length){ const tr=document.createElement('tr'); tr.innerHTML='<td>1</td><td><input class="it-name"></td><td><input class="it-qty" type="number" step="0.01"></td><td><input class="it-price" type="number" step="0.01"></td><td><input class="it-amount" type="number" step="0.01"></td><td></td>'; tb.appendChild(tr); }
  })();
})();
