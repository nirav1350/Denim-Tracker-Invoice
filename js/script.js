/* ==========================================================================
   Denim Tracker — Invoice Generator
   script.js — rows, calculations, image replacement, persistence, printing
   --------------------------------------------------------------------------
   Sections:
     1. Constants & element references
     2. Row management (create / add / delete)
     3. Calculations & formatting
     4. Image replacement (click any .changeable image)
     5. Persistence (localStorage auto-save / load)
     6. Toolbar actions & event wiring
     7. Init
   ========================================================================== */

(function () {
  'use strict';

  /* ---------- 1. Constants & element references ---------- */

  var STORAGE_KEY = 'denim-tracker-invoice-v1';
  var MIN_ROWS = 14;            // blank rows rendered so the sheet looks like the paper original
  var SAVE_DELAY_MS = 300;      // debounce for auto-save

  var itemsBody = document.getElementById('itemsBody');
  var imageInput = document.getElementById('imageInput');

  var totalBeforeTaxEl = document.getElementById('totalBeforeTax');
  var sgstAmountEl = document.getElementById('sgstAmount');
  var cgstAmountEl = document.getElementById('cgstAmount');
  var totalAfterTaxEl = document.getElementById('totalAfterTax');

  var saveTimer = null;
  var imageTarget = null;       // the <img> that will receive the next uploaded file

  /* ---------- 2. Row management ---------- */

  /**
   * Create one item row. All cells except NO and Amount hold a transparent
   * <input> so the sheet still looks like the printed original.
   * @param {{particulars?: string, qty?: string, rate?: string}} [data]
   * @returns {HTMLTableRowElement}
   */
  function createRow(data) {
    data = data || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="col-no"></td>' +
      '<td class="col-part"><input class="row-input" data-col="particulars" type="text" autocomplete="off"></td>' +
      '<td class="col-qty"><input class="row-input num" data-col="qty" type="text" inputmode="decimal" autocomplete="off"></td>' +
      '<td class="col-rate"><input class="row-input num" data-col="rate" type="text" inputmode="decimal" autocomplete="off"></td>' +
      '<td class="col-amount"><span class="amount"></span>' +
      '<button class="row-delete no-print" type="button" title="Remove this row" tabindex="-1">&times;</button></td>';

    tr.querySelector('[data-col="particulars"]').value = data.particulars || '';
    tr.querySelector('[data-col="qty"]').value = data.qty || '';
    tr.querySelector('[data-col="rate"]').value = data.rate || '';
    return tr;
  }

  /** Append a new empty row and return it. */
  function addRow() {
    var tr = createRow();
    itemsBody.appendChild(tr);
    return tr;
  }

  /**
   * Build the table body from saved row data, padding with blank rows
   * up to MIN_ROWS so the sheet keeps its full-page look.
   * @param {Array<Object>} rows
   */
  function buildRows(rows) {
    itemsBody.innerHTML = '';
    var count = Math.max(MIN_ROWS, rows.length);
    for (var i = 0; i < count; i++) {
      itemsBody.appendChild(createRow(rows[i]));
    }
  }

  /* ---------- 3. Calculations & formatting ---------- */

  /**
   * Parse a user-typed number. Commas and spaces are tolerated
   * ("2,000" -> 2000). Anything non-numeric yields 0.
   * @param {string} text
   * @returns {number}
   */
  function toNumber(text) {
    var n = parseFloat(String(text).replace(/[,\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /**
   * Format a number in Indian digit grouping (e.g. 130000 -> "1,30,000").
   * Paise shown only when the value is not a whole rupee.
   * @param {number} n
   * @returns {string}
   */
  function formatINR(n) {
    return n.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  /** Read a tax-rate percentage from its contenteditable span. */
  function getRate(field) {
    var el = document.querySelector('[data-field="' + field + '"]');
    return el ? toNumber(el.textContent) : 0;
  }

  /**
   * Recalculate everything: each row's amount (qty x rate), the running
   * serial numbers, and the tax totals. Called on every input event.
   */
  function recalc() {
    var totalBeforeTax = 0;
    var serial = 0;

    Array.prototype.forEach.call(itemsBody.rows, function (tr) {
      var particulars = tr.querySelector('[data-col="particulars"]').value;
      var qty = toNumber(tr.querySelector('[data-col="qty"]').value);
      var rate = toNumber(tr.querySelector('[data-col="rate"]').value);
      var amountCell = tr.querySelector('.amount');
      var noCell = tr.querySelector('.col-no');

      var hasData = particulars.trim() !== '' || qty !== 0 || rate !== 0;
      noCell.textContent = hasData ? ++serial : '';

      var amount = qty * rate;
      amountCell.textContent = amount !== 0 ? formatINR(amount) : '';
      totalBeforeTax += amount;
    });

    var sgst = totalBeforeTax * getRate('sgstRate') / 100;
    var cgst = totalBeforeTax * getRate('cgstRate') / 100;

    totalBeforeTaxEl.textContent = formatINR(totalBeforeTax);
    sgstAmountEl.textContent = formatINR(sgst);
    cgstAmountEl.textContent = formatINR(cgst);
    totalAfterTaxEl.textContent = formatINR(totalBeforeTax + sgst + cgst);
  }

  /* ---------- 4. Image replacement ---------- */

  /**
   * Swap every changeable image's file src for its embedded data-URL copy
   * (js/default-images.js). Without this, opening index.html via file://
   * taints the export canvas and the Download PDF button fails.
   */
  function applyDefaultImages() {
    if (typeof DEFAULT_IMAGES === 'undefined') return;
    Array.prototype.forEach.call(
      document.querySelectorAll('img.changeable'),
      function (img) {
        var key = img.dataset.image;
        if (DEFAULT_IMAGES[key] && img.src.indexOf('data:') !== 0) {
          img.src = DEFAULT_IMAGES[key];
        }
      }
    );
  }

  /**
   * Any <img class="changeable"> can be replaced: clicking it opens the
   * hidden file input; the chosen file is read as a data URL and swapped in.
   * Data URLs persist through localStorage, so the choice survives reloads.
   */
  function wireImages() {
    Array.prototype.forEach.call(
      document.querySelectorAll('img.changeable'),
      function (img) {
        img.addEventListener('click', function () {
          imageTarget = img;
          imageInput.value = '';      // allow re-selecting the same file
          imageInput.click();
        });
      }
    );

    imageInput.addEventListener('change', function () {
      var file = imageInput.files && imageInput.files[0];
      if (!file || !imageTarget) return;
      var reader = new FileReader();
      reader.onload = function () {
        imageTarget.src = reader.result;
        imageTarget.dataset.userSet = '1';   // persist this one (see collectState)
        scheduleSave();
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- 5. Persistence ---------- */

  /** Snapshot every editable field, all rows, and replaced images. */
  function collectState() {
    var state = { fields: {}, rows: [], images: {} };

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-field]'),
      function (el) {
        state.fields[el.dataset.field] = el.innerText;
      }
    );

    Array.prototype.forEach.call(itemsBody.rows, function (tr) {
      state.rows.push({
        particulars: tr.querySelector('[data-col="particulars"]').value,
        qty: tr.querySelector('[data-col="qty"]').value,
        rate: tr.querySelector('[data-col="rate"]').value
      });
    });

    // Only store images the user replaced via upload — defaults are data
    // URLs too (js/default-images.js), so a src check alone isn't enough.
    Array.prototype.forEach.call(
      document.querySelectorAll('img.changeable'),
      function (img) {
        if (img.dataset.userSet === '1' && img.src.indexOf('data:') === 0) {
          state.images[img.dataset.image] = img.src;
        }
      }
    );

    return state;
  }

  /** Write the current state to localStorage. */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectState()));
    } catch (e) {
      // Most likely the quota was exceeded by a very large uploaded image.
      console.warn('Could not save invoice data:', e);
    }
  }

  /** Debounced save — one write shortly after the user stops typing. */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }

  /**
   * Restore a saved state into the DOM.
   * @param {{fields: Object, rows: Array, images: Object}} state
   */
  function applyState(state) {
    Object.keys(state.fields || {}).forEach(function (key) {
      var el = document.querySelector('[data-field="' + key + '"]');
      if (el) el.innerText = state.fields[key];
    });

    buildRows(state.rows || []);

    Object.keys(state.images || {}).forEach(function (key) {
      var img = document.querySelector('img.changeable[data-image="' + key + '"]');
      if (img) {
        img.src = state.images[key];
        img.dataset.userSet = '1';
      }
    });
  }

  /** Load saved state; returns true if something was restored. */
  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      applyState(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn('Saved invoice data was unreadable, starting fresh:', e);
      return false;
    }
  }

  /* ---------- 6. Toolbar actions & event wiring ---------- */

  /**
   * Generate and download the invoice as a PDF file using the locally
   * bundled html2pdf.js (assets/vendor/). The file is named after the
   * bill number, e.g. "Invoice-01.pdf".
   */
  function downloadPdf() {
    if (typeof html2pdf === 'undefined') {
      alert('PDF library not found (assets/vendor/html2pdf.bundle.min.js). ' +
            'Use the Print button and choose "Save as PDF" instead.');
      return;
    }

    var billNoEl = document.querySelector('[data-field="billNo"]');
    var billNo = billNoEl ? billNoEl.innerText.trim().replace(/[^\w-]+/g, '') : '';
    var filename = 'Invoice' + (billNo ? '-' + billNo : '') + '.pdf';

    var A4_W = 210, A4_H = 297, MARGIN = 8;                     // mm

    // exporting-pdf hides screen-only bits (row delete buttons) during capture
    document.body.classList.add('exporting-pdf');

    // html2pdf's own paginator splits by CSS pixel height, which would cut
    // the tall sheet onto a second page. Instead, take the rendered canvas
    // and place it on ONE A4 page ourselves, scaled to fit the margins.
    var canvasRef = null;

    html2pdf()
      .set({
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      })
      .from(document.getElementById('invoice'))
      .toCanvas()
      .get('canvas')
      .then(function (canvas) { canvasRef = canvas; })
      .toPdf()
      .get('pdf')
      .then(function (pdf) {
        // Throw away html2pdf's auto-paginated pages, keep one blank page.
        pdf.addPage();
        while (pdf.internal.getNumberOfPages() > 1) pdf.deletePage(1);

        var maxW = A4_W - 2 * MARGIN;
        var maxH = A4_H - 2 * MARGIN;
        var scale = Math.min(maxW / canvasRef.width, maxH / canvasRef.height);
        var w = canvasRef.width * scale;
        var h = canvasRef.height * scale;
        pdf.addImage(canvasRef.toDataURL('image/jpeg', 0.98), 'JPEG',
                     (A4_W - w) / 2, MARGIN, w, h);
        pdf.save(filename);
        document.body.classList.remove('exporting-pdf');
      })
      .catch(function (err) {
        document.body.classList.remove('exporting-pdf');
        console.error('PDF export failed:', err);
        alert('PDF export failed (' + (err && err.message ? err.message : err) + '). ' +
              'Use the Print button and choose "Save as PDF" instead.');
      });
  }

  /**
   * Scale the sheet so the browser's Print dialog always outputs ONE A4
   * page. Usable area with the 8 mm @page margins at CSS 96 dpi is about
   * 733 x 1062 px; zoom the sheet down to fit. Fires for the Print button
   * and Ctrl+P alike via the beforeprint/afterprint events.
   */
  function fitSheetForPrint() {
    var invoice = document.getElementById('invoice');
    var PX_PER_MM = 96 / 25.4;
    var maxW = (210 - 16) * PX_PER_MM;
    var maxH = (297 - 16) * PX_PER_MM;
    var scale = Math.min(maxW / invoice.offsetWidth,
                         maxH / invoice.offsetHeight, 1);
    invoice.style.zoom = scale;
  }

  function resetSheetAfterPrint() {
    document.getElementById('invoice').style.zoom = '';
  }

  /** Today as dd-mm-yyyy, matching the reference invoice's date format. */
  function todayString() {
    var d = new Date();
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '-' + mm + '-' + d.getFullYear();
  }

  function wireEvents() {
    // One delegated listener covers every row input and contenteditable field.
    document.addEventListener('input', function () {
      recalc();
      scheduleSave();
    });

    // Row deletion (delegated). Always keep at least one row.
    itemsBody.addEventListener('click', function (e) {
      if (!e.target.classList.contains('row-delete')) return;
      if (itemsBody.rows.length > 1) {
        e.target.closest('tr').remove();
      }
      recalc();
      scheduleSave();
    });

    document.getElementById('addRowBtn').addEventListener('click', function () {
      addRow().querySelector('[data-col="particulars"]').focus();
      scheduleSave();
    });

    document.getElementById('printBtn').addEventListener('click', function () {
      window.print();
    });

    // Fit-to-one-page for every print path (button, Ctrl+P, browser menu)
    window.addEventListener('beforeprint', fitSheetForPrint);
    window.addEventListener('afterprint', resetSheetAfterPrint);

    document.getElementById('downloadPdfBtn').addEventListener('click', downloadPdf);

    document.getElementById('resetBtn').addEventListener('click', function () {
      var ok = confirm('Reset the invoice? All entered data and replaced images will be cleared.');
      if (!ok) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  /* ---------- 7. Init ---------- */

  function init() {
    applyDefaultImages();            // data-URL images before anything else
    var restored = load();           // saved user uploads override defaults
    if (!restored) {
      buildRows([]);
      var dateEl = document.querySelector('[data-field="date"]');
      if (dateEl && dateEl.innerText.trim() === '') {
        dateEl.innerText = todayString();
      }
    }
    wireImages();
    wireEvents();
    recalc();
  }

  init();
})();
