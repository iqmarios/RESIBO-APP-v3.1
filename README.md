What’s in this release (v3.1.6)

Handwriting OCR power-up using OpenCV: CLAHE contrast, median denoise, deskew, adaptive threshold.

Expanded Review Form (Step 3) with canonical fields + Line Items table.

Image Viewer Modal (zoom 1:1, rotate 90°, brightness/contrast sliders).

Two-sheet CSV export: Receipts.csv and LineItems.csv (normalized by ReceiptID).

ZIP export bundles images (original + processed), CSVs, and a small JSON manifest.

Self-Test panel to quickly verify libs and PWA setup.

📁 Project Structure
RESIBO-APP-v3.1/
├─ index.html
├─ app.js
├─ style.css
├─ manifest.json
├─ sw.js
├─ README.md   ← (this file)
├─ icons/
│  ├─ icon-192.png
│  └─ icon-512.png
└─ libs/
   ├─ jszip.min.js
   ├─ FileSaver.min.js
   ├─ pdf.min.js
   ├─ pdf.worker.min.js
   ├─ tesseract.min.js
   └─ opencv.js      ← single-file WASM-enabled build (no separate .wasm needed)


Note: opencv.js used here is a single-file WASM-enabled build. You do not need opencv.wasm for this setup.

🚀 Quick Start (Non-coder friendly)

Upload these files 1:1 to your hosting (Vercel/GitHub Pages/any HTTPS).

Open your site → Self-Test must show all green (HTTPS, SW, Manifest, Icons, JSZip, FileSaver, pdf.js, Tesseract, OpenCV, Cache/Version).

Go to Settings → paste your Issued Codes CSV URL → Save → Test CSV should say “CSV fetched”.

Step 1: Fill Access Code, Name, TIN, Gmail → Verify. It should say “Verification success. Session stored for 7 days.”

Step 2: Upload images or PDFs → click Strong Preprocess (Handwriting) → Run OCR.

Step 3: Review/complete fields, add Line Items (use “Apply OCR Hints → Fields” if helpful).

Step 4: Export CSV (two files) or ZIP (images + CSV + JSON).

Everything is local. You can reset anytime in Step 5.

🔐 Access Control (Issued Codes CSV)

The app validates users from your Google Sheet that’s published as CSV.

A. Sheet headers (must match exactly, lower-case):
code, name, tin, gmail, status, expiry_date

B. Sample rows
RES-TEST-001, Maria Santos, 123-456-789-000, maria.santos@gmail.com, ACTIVE, 2030-12-31
RES-EXPIRE-01, Juan Cruz,   111-222-333-444, juan.cruz@gmail.com,   ACTIVE, 2024-01-01
RES-BLOCK-01,  Foo Bar,     555-666-777-888, foo@bar.com,           INACTIVE, 2030-12-31


The app checks:

status must be ACTIVE

expiry_date must be today or later (format YYYY-MM-DD)

C. How to publish the CSV (Google Sheets)

Open your sheet → File → Share → Publish to web.

Choose Sheet = your “Issued Codes” tab and Format = Comma-separated values (.csv).

Click Publish and copy the link ending with output=csv.

Paste that link into Settings → Issued Codes CSV URL.

✅ If your link ends with /pubhtml?... it’s wrong for this app. Use Publish to web → CSV so the URL ends with output=csv.

🧠 Workflow Overview
Step 1 — Verify

Enter Access Code, Name, TIN, Gmail.

App fetches the CSV, finds a case-insensitive match by code + gmail, and checks ACTIVE + valid expiry.

On success, a 7-day local session is stored (no server).

Step 2 — Capture & OCR

Upload images or PDFs (PDF pages are auto-converted to images locally).

Preprocess (Basic) or Strong Preprocess (Handwriting):

CLAHE contrast, denoise (median), deskew (Hough), adaptive threshold.

Run OCR (Tesseract). You can toggle Before/After thumbnails.

Step 3 — Manual Review & Edit

Fields (become your CSV columns):

Receipt Date (YYYY-MM-DD)

Seller Name / TIN / Address

Buyer Name / TIN / Address

Document Type / Document Number

Role (BUYER / SELLER) – auto suggestion based on session user vs. fields

Transaction Type (dropdown):

Cash Sales • Charge Sales • Collections • Payment to Suppliers • Disbursements • Cash Purchase • Charge Purchase

Terms (for on-account)

Payment Method (Cash, Bank Transfer, Card, eWallet, Check, Others)

Gross Amount • VAT Amount • Discount • Total Amount Due (auto = Gross + VAT − Discount)

Withholding Tax (optional)

Notes (exempt/0%/senior/pwd/solo-parent/other)

ID Number

Line Items (table):

Item • Quantity • Unit Price • Line Amount

Add/Clear rows as needed.

Helpers:

Apply OCR Hints → Fields tries to fill date/doc no./largest amount. You still review and correct.

Step 4 — Export

Receipts.csv (top-level fields)

LineItems.csv (normalized by ReceiptID)

ZIP export includes:

Receipts.csv, LineItems.csv

manifest.json (small export summary)

images/ (original + _processed images, if any)

Step 5 — Cleanup

Clear Session (keeps CSV URL and saved records)

Full Reset (keeps only your CSV URL; clears everything else)

📄 CSV Schemas
Receipts.csv
ReceiptID,ReceiptDate,
SellerName,SellerTIN,SellerAddress,
BuyerName,BuyerTIN,BuyerAddress,
DocumentType,DocumentNumber,
Role,TransactionType,Terms,PaymentMethod,
GrossAmount,VATAmount,Discount,TotalAmountDue,WithholdingTax,
Notes,IDNumber,SessionUserName,SessionUserTIN,SessionUserGmail,SavedAt

LineItems.csv
ReceiptID,Item,Quantity,UnitPrice,LineAmount


ReceiptID is an auto-generated timestamp (unique per saved record).

Values are CSV-escaped (commas/quotes handled automatically).

🧪 Self-Test Panel (should be green)

HTTPS

Service Worker

Manifest

Icons

JSZip

FileSaver

pdf.js

Tesseract

OpenCV

Cache/Version

If anything is red, see Troubleshooting below.

🛠️ Troubleshooting (Common Issues)
Symptom	Likely Cause	Fix
SW registration 404 in console	sw.js path/version mismatch	Ensure the file exists at site root and index.html registers sw.js?v=3.1.6. Re-deploy. Hard refresh.
Icons FAIL in Self-Test or 404 on /icons/icon-192.png	Missing icons	Add icons/icon-192.png and icons/icon-512.png (any PNGs are fine).
CSV fetched: failed	Wrong link (pubhtml or gid) or unpublished	Publish to web as CSV; link must end with output=csv. Paste in Settings, click Test CSV.
No matching ACTIVE record…	status not ACTIVE or expiry_date is past	Fix the row in the sheet; ensure expiry_date format YYYY-MM-DD (and not expired).
OpenCV not ready	opencv.js missing	Put libs/opencv.js in place; confirm it loads over HTTPS.
OCR very weak	Image too dark or skewed	Use Strong Preprocess (Handwriting) → rotate in the Image Modal, adjust brightness/contrast, then OCR again.
ZIP missing processed images	You didn’t run preprocessing	Run Preprocess first; processed images are saved as *_processed.png in the ZIP.

Tip: After deployment, do a hard refresh (Ctrl+F5) or Clear Site Data to update the service worker cache.

🌐 Deployment Notes

Works best on HTTPS (PWA requirement).

Vercel: just import the repo and deploy (no special settings).

GitHub Pages: enable Pages on the repo; ensure all files are at the root (or correct paths if using a subfolder).

Service Worker caches files listed in sw.js → bump all ?v=3.1.6 strings and CACHE_VERSION whenever you change files.

🔒 Privacy & Security

100% client-side processing.

No data leaves your device unless you export and share the files yourself.

Verification uses your published CSV read-only endpoint.

No accounting computations are performed — the app records exactly what appears on the documents.

🧩 Tech Bits (for reference)

OCR: Tesseract.js

Image processing: OpenCV.js (single file, WASM-enabled)

PDF rasterization: pdf.js (local worker)

Packaging: JSZip + FileSaver

PWA: manifest.json + sw.js cache

Strong Preprocess (high level):
Gray → Equalize + CLAHE → Median denoise → Hough deskew → Adaptive threshold

🧭 Versioning & Cache Discipline

App version: v3.1.6

In every updated release:

Bump ?v=... in: index.html, app.js, style.css, manifest.json, and SW registration line.

Update CACHE_VERSION in sw.js.

Update the Self-Test title/version label in index.html.

🗺️ Roadmap (approved next steps)

Toggle for line removal (tabular receipts).

Per-field OCR boxes (guided extraction).

Optional Google Apps Script webhook (email delivery of ZIP).

Stronger heuristics for dates/amounts/vendor names.

🧾 Changelog
v3.1.6

Added strong OpenCV preprocessing pipeline for handwriting.

Expanded Step-3 canonical schema + dynamic line items.

Image modal (zoom/rotate/brightness/contrast).

Two-sheet CSV export + ZIP bundling.

Self-Test updated for new libs, version bump.

🙋 FAQ

Q: Can I use on a laptop without a camera?
Yes. Upload scanned images or PDFs. The app converts PDF pages to images locally.

Q: Do I need opencv.wasm?
No. The opencv.js here is a single-file WASM-enabled build.

Q: The date/amounts from OCR are wrong.
Use Strong Preprocess, rotate if skewed, and still manually review. The app is designed so you remain the source of truth.

📬 Support

If you get stuck, copy the exact error text (or screenshot) and we’ll troubleshoot.
Key checks: Self-Test, Console (F12), and CSV link (must be output=csv).