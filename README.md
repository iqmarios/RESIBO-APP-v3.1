# Resibo App — v3.2.0

Privacy-first receipt capture and review. Everything runs **locally in your browser**:
- **Capture**: upload images/PDFs or use the **built-in camera**
- **Enhance**: OpenCV preprocessing (basic & handwriting/strong)
- **OCR**: Tesseract.js on-device text recognition
- **Review**: Large inline, zoomable viewer with form **right beneath**
- **Export**: CSV (2 files) and ZIP (images + CSV + JSON)
- **Access Control**: Verify via issued codes CSV (Google Sheets publish → CSV)

Live: _(your Vercel URL)_

---

## What’s new in v3.2.0

- Added **Vatable Sales** field (between **Gross Amount** and **VAT Amount**)
- Included **Vatable Sales** in saved records and **Receipts.csv**
- Kept v3.1.9 features: camera (Start/Switch/Capture/Stop) + inline zoomable viewer

---

## Project Structure

RESIBO-APP-v3.1/
├─ index.html
├─ app.js
├─ style.css
├─ manifest.json
├─ sw.js
├─ README.md
├─ icons/
│ ├─ icon-192.png
│ └─ icon-512.png
└─ libs/
├─ jszip.min.js
├─ FileSaver.min.js
├─ pdf.min.js
├─ pdf.worker.min.js
├─ tesseract.min.js
└─ opencv.js

yaml
Copy code

> No separate `opencv.wasm` is required for this build.

---

## Quick Start (Local)

1. **Files**: Ensure the structure above is in place.
2. **Open** `index.html` via a local server (recommended) so the service worker can work:
   - Quick way: `python3 -m http.server 8080` and open `http://localhost:8080/`
3. First run:
   - Go to **Settings** → paste your **CSV URL** (published Google Sheet → CSV) → **Save** → **Test CSV**.

---

## Deploy to Vercel

1. Push this folder to a GitHub repo (public or private).
2. In Vercel, **New Project** → import the repo.
3. Framework preset: **Other** (static).
4. Build settings: none (static site). Output is the repo root.
5. Deploy.

> After each update, bump versions in:
> - `index.html` query strings `?v=3.2.0`
> - `app.js` internal `APP_VERSION`
> - `sw.js` `CACHE_VERSION = 'resibo-cache-v3.2.0'`

Then **Clear site data** in the browser (DevTools → Application → Clear storage → _Clear site data_) and reload.

---

## Access Verification (Step 1)

- Settings → paste your **Issued Codes CSV URL** (Google Sheets → File → Share → Publish to web → **CSV**).
- Required headers in the sheet (lowercase):
code, name, tin, gmail, status, expiry_date

markdown
Copy code
- App matches **code + gmail** (case-insensitive). `status` must be `ACTIVE`. `expiry_date` must be ≥ today.
- If valid: session stored locally for 7 days.

---

## Capture & OCR (Step 2)

- **Upload** images/PDFs (PDF pages are auto-rendered to images).
- Or use the **Camera**:
- **Start Camera** → (optional) **Switch Camera** → **Capture** → **Stop**.
- **Preprocess**
- **Basic**: grayscale + Otsu threshold.
- **Strong (Handwriting)**: histogram equalization, CLAHE, denoise, **auto-deskew**, adaptive threshold.
- **Run OCR**: performs Tesseract OCR on the processed (or original) image(s).

> Tip: toggle **Show “Before” image** to switch between original/processed previews.

---

## Manual Review & Edit (Step 3)

Inline **large viewer** (no modal) sits above the form:
- **Zoom controls**: Fit / 1:1 / − / Slider / + / Rotate
- **Image controls**: Brightness, Contrast
- **Pan**: drag the image; **pinch** to zoom on mobile

Click **Apply OCR → Fields** to auto-suggest:
- **Receipt Date**, **Document Type/No.**, **Total Amount Due**
- (We can extend this to attempt **Vatable Sales** detection on request.)

### Canonical Fields

- Receipt Date (YYYY-MM-DD)
- Seller Name / TIN / Address
- Buyer Name / TIN / Address
- Document Type / Number
- Role (BUYER/PAYOR or SELLER/ISSUER)
- Transaction Type (Cash Sales, Charge Sales, Collections, Payment to Suppliers, Disbursements, Cash Purchase, Charge Purchase)
- Payment Method
- **Gross Amount**
- **Vatable Sales** ← **NEW in v3.2.0**
- **VAT Amount**
- Discount
- Total Amount Due (= Gross + VAT − Discount)
- Withholding Tax (optional)
- Notes, ID Number, Terms
- Line Items: Item | Quantity | Unit Price | Line Amount

Click **Save Record** to store locally.

---

## Export (Step 4)

- **Export CSV** → downloads:
- `Receipts.csv` (includes **VatableSales** column)
- `LineItems.csv`
- **Export ZIP** → downloads:
- `images/` (original + processed if available)
- `Receipts.csv`, `LineItems.csv`
- `manifest.json` (export metadata)

---

## Service Worker (Offline)

- Pre-caches the app shell and libs.
- **Network-first** for the verification **CSV** (so you always see the latest).
- **Cache-first** for images/PDFs/libs.
- Version key: `resibo-cache-v3.2.0`.

If the UI seems stuck on an old version:
- Open DevTools → **Application** → **Clear storage** → **Clear site data** → Reload.

---

## Troubleshooting

- **CSV URL missing / not fetching**: Paste the exact **Publish to web → CSV** link and click **Test CSV**.
- **Camera doesn’t start**: Browser may need permission. On iOS Safari, ensure HTTPS and camera permission allowed in Settings.
- **OCR empty / poor**: Try **Strong Preprocess (Handwriting)**, rotate to upright, increase Contrast slightly.
- **Form not filled after OCR**: Click **Apply OCR → Fields** in Step 3, then review/edit.
- **Icons/self-test**: Use **Self-Test** button to confirm libraries are loaded.

---

## Versioning Discipline

- Bump `?v=` in `index.html` and `CACHE_VERSION` in `sw.js` every release.
- Keep `APP_VERSION` in `app.js` in sync.
- After deploy, **Clear site data** and reload.

---

## License

Internal use for your organization. All processing is local in the browser; no user data is sent to a server unless you explicitly add your own endpoint.
