# Resibo App v3.6.1 (Canvas build)

Privacy-first receipt capture with offline preprocess + OCR.
This build **does not require OpenCV/WASM**. It uses a tuned Canvas pipeline for tiny-print and handwriting.

## What’s inside
- Step 1: CSV Verify (headers: `code,name,tin,gmail,status,expiry_date`)
- Step 2: Upload/PDF/Camera + Preprocess (Basic/Strong/Ultra + Boost Small Print)
- OCR via Tesseract (client-side)
- Manual Review (includes **Vatable Sales** field)
- Visual overlay + click boxes → focuses item inputs
- Export CSV/ZIP
- PWA offline support

## Quick start
1. Host on Vercel (root files).
2. Open the app → **Settings** → paste your **Google Sheet published CSV URL**.
3. Click **Test CSV** → should show `CSV fetched (N rows)`.
4. Fill **Access Code + Gmail + TIN + Name** and click **Verify**.
5. Upload an image (or PDF) → **Preprocess** (Ultra for tiny print) → **Run OCR**.
6. Click **Apply OCR to Fields**, review, edit line items.
7. **Save** (local) and **Export CSV/ZIP**.

## Files
/
├─ index.html
├─ app.js
├─ style.css
├─ manifest.json
├─ sw.js
├─ icons/
│ ├─ icon-192.png
│ └─ icon-512.png
└─ libs/
├─ jszip.min.js
├─ FileSaver.min.js
├─ pdf.min.js
├─ pdf.worker.min.js
└─ tesseract.min.js

pgsql
Copy code

## Notes
- If later you acquire **opencv_js.wasm**, you can switch to the OpenCV build (deskew, adaptive Binarization, etc.). For now this Canvas build is tuned to handle tiny printed words and messy receipts well.
- After any deploy, if something looks cached, open **DevTools → Application → Service Workers → Unregister**, then reload.
