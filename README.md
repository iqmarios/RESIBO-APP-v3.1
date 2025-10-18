# Resibo App v3.6.2 — Codex-Enhanced (Optional OpenCV)

**Offline-first** receipt capture with advanced preprocessing and OCR.  
OpenCV is **optional**. If `libs/opencv.js` (and its wasm) are present, the app uses it; otherwise it automatically falls back to a high-quality **Canvas** pipeline tuned for *tiny printed words and handwriting*.

## Features
- Step 1: **CSV Verify** (`code,name,tin,gmail,status,expiry_date`)
- Step 2: Upload/PDF/Camera + Preprocess
  - **Basic / Strong / Ultra** + “Boost Small Print”
  - Uses OpenCV if available; otherwise Canvas fallback
- Tesseract OCR (client-side), robust mapper (includes **Vatable Sales**)
- Visual Overlay grid (click boxes focus item fields)
- CSV + ZIP export (with images & manifest)
- PWA (offline support) + Self-Test

## Folder layout
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
├─ tesseract.min.js
└─ opencv.js ← optional (you may delete this file)

markdown
Copy code

## Usage
1. Paste your **Google Sheet published CSV URL** in **Settings** → `Save` → `Test CSV` (should show “CSV fetched (N rows)”).
2. Fill **Access Code, Name, TIN, Gmail** → **Verify** (green success pill).
3. Upload receipt (or **PDF**) or use the **Camera**.
4. Click **Preprocess** (try **Ultra** + **Boost Small Print** for tiny text).
5. **Run OCR**, then **Apply OCR to Fields**. Review/edit.
6. Add line items (or use **Parse Line Items (Layout)** just for overlay helpers).
7. **Save** (local), **Export CSV** or **Export ZIP**.

## Notes
- If a previous version seems cached, open **DevTools → Application → Service Workers → Unregister**, then press **Ctrl+F5**.
- OpenCV path adds CLAHE + median + adaptive threshold + quick deskew; Canvas pat