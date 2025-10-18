# Resibo App v3.6.1

Offline-first receipt/OR/SI capture with local OCR (Tesseract + OpenCV).  
Includes: Ultra Preprocess (tiny print + handwriting), visual overlay for line-items, CSV/ZIP export.

## Live
Deployed on Vercel. After each deploy, force-update:
- DevTools → **Application → Service Workers → Unregister** → **Hard Reload**, or
- Run in Console:
  ```js
  navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));
  caches.keys().then(k=>k.forEach(caches.delete));
  location.reload();
CSV Access Control

Publish Google Sheet to web (CSV).

Required headers (lowercase):
code, name, tin, gmail, status, expiry_date

status = ACTIVE, expiry_date = YYYY-MM-DD.

Paste URL in Settings → Issued Codes CSV URL, click Save then Test CSV.
Verify with Access Code/Name/TIN/Gmail.

OCR Flow

Upload or capture.

Ultra Preprocess (Tiny Print + Handwriting) (small-font boost).

Run OCR → Apply OCR → Fields.

Parse Line Items (Layout) to draw overlay and populate row grid.

Review/edit → Save → Export CSV/ZIP.
---

## What to do now

1) Replace your files with the ones above (especially `index.html` and `sw.js`).  
2) Open the live site → **Unregister** the service worker → **Ctrl+F5**.  
3) **Paste the CSV URL → Save → Test CSV** (you should see **CSV fetched (N rows)**).  
4) Fill Access Code / Name / TIN / Gmail → **Verify** (you’ll get **Verification success**).  

If anything still doesn’t fire, tell me exactly which button you pressed and what (if any) pill message appears, and I’ll pinpoint it.
::contentReference[oaicite:0]{index=0}
