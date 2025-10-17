# Resibo App v3.1.3

Privacy-first, offline-capable PWA for receipt recording and reporting.  
All OCR and processing happens locally in the browser.

## Files
- `index.html` — UI and wiring
- `style.css` — dark theme styles
- `app.js` — verification, OCR, review, export, cleanup, self-test
- `sw.js` — service worker with cache `resibo-cache-v3.1.3`
- `manifest.json` — PWA manifest
- `libs/` — required libraries (local):
  - `jszip.min.js`, `FileSaver.min.js`, `pdf.min.js`, `tesseract.min.js`
- `icons/` — app icons:
  - `icon-192.png`, `icon-512.png`

## Important
- Service worker and self-test **won’t pass** when opened as `file://D:\...index.html`.  
  Serve over **HTTPS** (GitHub Pages or Vercel) or a local dev server.

## Quick Host (GitHub Pages)
Settings → Pages → Source: *Deploy from a branch* → `main` / (root).  
Open the generated URL and run **Self-Test**.

## Post-Deploy Validation (5 Steps)
1. Open app → **Self-Test** → all checks **OK**.
2. Verify with CSV (URL or paste) → session stored 7 days.
3. Upload PDF/image → **Preprocess** → **Run OCR** → review fields.
4. Set “Have you corrected all receipt data?” = **Yes** → ZIP export.
5. Privacy → **Delete Local Data** to clear IndexedDB & localStorage.

## Changelog (3.1.3)
- Version sync to **3.1.3** across all files.
- Self-Test now targets `manifest.json` (not `.webmanifest`).
- Added warning when running via `file://` so local checks don’t confuse you.
- Paths consolidated to `style.css` single stylesheet.
