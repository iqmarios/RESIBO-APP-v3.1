# Resibo App v3.6.1 — Visual Overlay + Tiny-Print OCR

**Privacy-first** receipt & invoice capture. Everything runs locally in the browser:
- Tiny-print OCR boost (upscale + CLAHE + deskew + adaptive binarization)
- Handwriting-friendly preprocessing
- Clickable **Visual Overlay** for line-items (click a box → focus the matching field)
- Zoom/pan/rotate; overlay follows precisely
- Structured export (Receipts.csv + LineItems.csv)
- PWA offline via Service Worker

## Live
Deployed at: `https://<your-vercel-app>.vercel.app`

## Files
index.html
app.js
style.css
manifest.json
sw.js
icons/icon-192.png
icons/icon-512.png
libs/
jszip.min.js
FileSaver.min.js
pdf.min.js
pdf.worker.min.js
tesseract.min.js
opencv.js
## Step 0 — Versioning
- Bump versions in:
  - `index.html` query strings (`?v=3.6.1`)
  - `sw.js` `CACHE_VERSION`
  - `manifest.json` `start_url`
- Hard reload after deploy (DevTools → Application → Service Workers → **Unregister**, then refresh).

## Step 1 — Access Verification
1. Paste **Issued Codes CSV URL** (Google Sheet “Publish to Web” → `output=csv`).
2. Click **Save**, then **Test CSV** (should show “CSV fetched”).
3. Enter **Access Code / Name / TIN / Gmail** and click **Verify** → “Verification success”.

CSV headers (lowercase, exact):
