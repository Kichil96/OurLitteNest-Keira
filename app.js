'use strict';

(function () {

/* ============================================================
   Our Little Nest — Family Budget Tracker
   ============================================================ */

/* ---- Config ---- */
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQNFbJjjGDrZb4lrKTxM_VSXCaJG-g20AV41NqdjWpZD-rpA0QNX9SbfvqI-y1gncXu1xTl-sg0KZdM/pub?gid=91853040&single=true&output=csv';

const MAX_SILENT_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const STORAGE_KEY = 'ournest_transactions';
const BUDGET_KEY = 'ournest_budget';

/* ---- Palette ---- */
const PALETTE_BASE = ['#5B5FEF','#8B5CF6','#D946A8','#F5A524','#14B8A6','#FF6F59','#3B82F6','#84CC16','#EC4899','#06B6D4','#F97316','#A855F7','#10B981','#6366F1'];

function colorFor(idx) {
  if (idx < PALETTE_BASE.length) return PALETTE_BASE[idx];
  const hue = (idx * 137.508) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

const CAT_ICONS = {
  'groceries':'🛒','utilities & subscription':'💡','utilities':'💡','food':'🍔','transport':'🚗',
  'gift & donation':'🎁','child care':'🧸','loan':'🏦','entertainment':'🎬','health':'💊',
  'medical':'💊','shopping':'🛍️','education':'📚','travel':'✈️','rent':'🏠','insurance':'🛡️'
};

function iconFor(name) { return CAT_ICONS[String(name).toLowerCase().trim()] || '🏷️'; }

/* ---- State ---- */
let rawTransactions = [];
let currentBudget = 3360;
let monthlyChartInst = null;
let categoryChartInst = null;
let activeCategory = null;
let isFetching = false;
let debugPanelOpen = false;
let prevTxnHashes = null;
let filterDebounceTimer = null;
let showAllTxns = false;

/* ---- DOM refs ---- */
const $ = {};

function cacheDom() {
  const ids = [
    'refreshBtn','syncRow','syncLabel','debugToggleBtn','debugPanel','budgetModal',
    'budgetInput','startDate','endDate','statusBadge','statusLabel','statusValueCard',
    'statusSub','gaugeFill','totalSpentCard','txnCount','catCount','topCategoryLabel',
    'categoryChart','monthlyChart','legendGrid','categoryList','transactionList',
    'sheetBackdrop','categorySheet','sheetIcon','sheetCatName','sheetCatMeta',
    'sheetCatTotal','sheetBody','dbgFetchedAt','dbgHttpStatus','dbgRawRows',
    'dbgParsedRows','dbgSkippedRows','dbgRawSample','dbgNewestDate','dbgOldestDate',
    'dbgFilterWindow','dbgInWindow','dbgDiff','budgetSaveBtn','budgetDoneBtn',
    'budgetEditBtn','sheetCloseBtn','dateWarningArea'
  ];
  ids.forEach(id => { $[id] = document.getElementById(id); });
}

/* ---- Utility ---- */
function fmtMoney(n) {
  return `RM ${n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
}

function formatSyncTime(d) {
  return d.toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', second:'2-digit' });
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getCategorySums(data) {
  const sums = {};
  data.forEach(t => { sums[t.category] = (sums[t.category] || 0) + t.amount; });
  return sums;
}

function getTotalSpent(data) {
  return data.reduce((s, t) => s + t.amount, 0);
}

function sortedCategories(sums) {
  return Object.entries(sums).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- CSV parsing ---- */

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  result.push(cur);
  return result.map(v => v.trim());
}

function parseCsv(text) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    }
    if (ch === '\n' && !inQuotes) {
      rows.push(cur);
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.trim().length) rows.push(cur);
  return rows.map(parseCsvLine);
}

/* ---- Date parsing ---- */

function parseFlexibleDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d)) return d;
  }
  try {
    const parts = dateStr.trim().split(' ');
    const dateParts = parts[0].split(/[-/]/);
    if (dateParts.length === 3) {
      let day, month, year;
      if (dateParts[0].length === 4) {
        year = parseInt(dateParts[0], 10); month = parseInt(dateParts[1], 10) - 1; day = parseInt(dateParts[2], 10);
      } else {
        day = parseInt(dateParts[0], 10); month = parseInt(dateParts[1], 10) - 1; year = parseInt(dateParts[2], 10);
      }
      let hour = 0, minute = 0, second = 0;
      if (parts[1]) {
        const tp = parts[1].split(':');
        hour = parseInt(tp[0], 10) || 0; minute = parseInt(tp[1], 10) || 0; second = parseInt(tp[2], 10) || 0;
      }
      const finalDate = new Date(year, month, day, hour, minute, second);
      if (!isNaN(finalDate)) return finalDate;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/* ---- Debug info ---- */
const debugInfo = {
  fetchedAt: null, httpStatus: null, rawRowCount: null,
  parsedRowCount: null, skippedRowCount: null, rawSample: null
};

function renderDebugPanel() {
  const fmt = (v) => v ?? '—';
  $.dbgFetchedAt.innerText = debugInfo.fetchedAt ? debugInfo.fetchedAt.toLocaleString('en-MY') : '—';
  $.dbgHttpStatus.innerText = fmt(debugInfo.httpStatus);
  $.dbgRawRows.innerText = fmt(debugInfo.rawRowCount);
  $.dbgParsedRows.innerText = fmt(debugInfo.parsedRowCount);
  $.dbgSkippedRows.innerText = fmt(debugInfo.skippedRowCount);
  $.dbgRawSample.innerText = debugInfo.rawSample || 'No data fetched yet';

  if (rawTransactions.length > 0) {
    const newest = rawTransactions[0].date;
    const oldest = rawTransactions[rawTransactions.length - 1].date;
    $.dbgNewestDate.innerText = newest.toLocaleString('en-MY');
    $.dbgOldestDate.innerText = oldest.toLocaleString('en-MY');
  } else {
    $.dbgNewestDate.innerText = '—';
    $.dbgOldestDate.innerText = '—';
  }

  $.dbgFilterWindow.innerText = `${$.startDate.value} → ${$.endDate.value}`;
  const inWindowCount = getFilteredData().length;
  $.dbgInWindow.innerText = `${inWindowCount} of ${rawTransactions.length}`;

  if ($.dbgDiff) {
    $.dbgDiff.innerText = prevTxnHashes
      ? `${prevTxnHashes.size} previously seen`
      : 'First fetch — no baseline yet';
  }
}

/* ---- Sync UI ---- */
function setSyncLabel(text, stale) {
  $.syncLabel.innerText = text;
  $.syncRow.classList.toggle('stale', !!stale);
}

function toggleDebugPanel() {
  debugPanelOpen = !debugPanelOpen;
  $.debugPanel.classList.toggle('open', debugPanelOpen);
  $.debugToggleBtn.innerText = debugPanelOpen ? 'Hide sync details' : 'Show sync details';
  $.debugToggleBtn.setAttribute('aria-expanded', String(debugPanelOpen));
  if (debugPanelOpen) renderDebugPanel();
}

/* ---- Budget ---- */
function loadBudget() {
  try {
    const saved = localStorage.getItem(BUDGET_KEY);
    if (saved) { currentBudget = parseFloat(saved); $.budgetInput.value = currentBudget; }
  } catch (_) { /* ignore */ }
}

function saveBudget() {
  try { localStorage.setItem(BUDGET_KEY, String(currentBudget)); } catch (_) { /* ignore */ }
}

function updateBudget() {
  const val = $.budgetInput.valueAsNumber;
  if (val && val > 0) {
    currentBudget = val;
    saveBudget();
    filterData();
    toggleBudgetModal();
  }
}

function toggleBudgetModal() {
  $.budgetModal.classList.toggle('open');
}

/* ---- Data fetching ---- */

async function attemptFetchOnce() {
  const bustedUrl = CSV_URL + '&_=' + Date.now();
  const response = await fetch(bustedUrl, { cache: 'no-store' });
  const httpStatus = response.status;
  if (!response.ok) throw new Error(`HTTP ${httpStatus}`);
  const text = await response.text();
  const rows = parseCsv(text);
  const parsed = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) { skipped++; continue; }
    if (row.every(cell => cell === '')) { skipped++; continue; }
    const timestampStr = row[0];
    const amount = parseFloat(String(row[1]).replace(/RM/gi, '').replace(/,/g, '').trim()) || 0;
    const description = row[2] || 'Unspecified';
    const category = row[3] || 'Other';
    const parsedDate = parseFlexibleDate(timestampStr);
    if (parsedDate) {
      parsed.push({ date: parsedDate, amount, description, category });
    } else {
      skipped++;
    }
  }

  return {
    parsed, httpStatus, rawRowCount: rows.length - 1, skipped,
    rawSample: rows.slice(-3).map(r => r.join(' | ')).join('\n')
  };
}

function computeDiff(newTxns) {
  const currentHashes = new Set(newTxns.map(t =>
    `${t.date.toISOString()}|${t.amount}|${t.description}|${t.category}`
  ));
  const newItems = prevTxnHashes
    ? newTxns.filter(t => {
        const h = `${t.date.toISOString()}|${t.amount}|${t.description}|${t.category}`;
        return !prevTxnHashes.has(h);
      })
    : [];
  prevTxnHashes = currentHashes;
  return newItems;
}

function cacheTransactions(txns) {
  try {
    const serializable = txns.map(t => ({
      date: t.date.toISOString(), amount: t.amount,
      description: t.description, category: t.category
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (_) { /* ignore */ }
}

function loadCachedTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return data.map(t => ({ ...t, date: new Date(t.date) }));
  } catch (_) { return []; }
}

async function fetchData() {
  isFetching = true;
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_SILENT_RETRIES; attempt++) {
    try {
      const result = await attemptFetchOnce();
      const newTxns = result.parsed.sort((a, b) => b.date - a.date);

      debugInfo.fetchedAt = new Date();
      debugInfo.httpStatus = result.httpStatus;
      debugInfo.rawRowCount = result.rawRowCount;
      debugInfo.parsedRowCount = result.parsed.length;
      debugInfo.skippedRowCount = result.skipped;
      debugInfo.rawSample = result.rawSample;

      computeDiff(newTxns);
      rawTransactions = newTxns;
      cacheTransactions(rawTransactions);

      filterData();
      setSyncLabel(`Updated ${formatSyncTime(new Date())}`, false);
      if (debugPanelOpen) renderDebugPanel();
      isFetching = false;
      return;
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt + 1} failed:`, error);
      debugInfo.httpStatus = error.message || 'network error';
      debugInfo.fetchedAt = new Date();
      debugInfo.rawRowCount = null;
      debugInfo.parsedRowCount = null;
      debugInfo.skippedRowCount = null;
      debugInfo.rawSample = null;
      if (attempt < MAX_SILENT_RETRIES) {
        setSyncLabel('Syncing…', false);
        await wait(RETRY_DELAY_MS);
      }
    }
  }

  console.error('All fetch attempts failed:', lastError);
  if (rawTransactions.length === 0) {
    const cached = loadCachedTransactions();
    if (cached.length > 0) {
      rawTransactions = cached;
      filterData();
      setSyncLabel('Offline — showing cached data', true);
    } else {
      $.transactionList.innerHTML = '<p class="empty-state">Couldn\'t reach the ledger. Check your connection and reload.</p>';
      setSyncLabel('Can\'t reach the ledger — tap to retry', true);
    }
  } else {
    setSyncLabel('Can\'t refresh — showing previous data', true);
  }
  if (debugPanelOpen) renderDebugPanel();
  isFetching = false;
}

async function manualRefresh() {
  if (isFetching) return;
  $.refreshBtn.classList.add('spinning');
  $.refreshBtn.disabled = true;
  setSyncLabel('Refreshing…');
  await fetchData();
  $.refreshBtn.classList.remove('spinning');
  $.refreshBtn.disabled = false;
}

/* ---- Date filtering ---- */

function validateDates() {
  const startVal = $.startDate.value;
  const endVal = $.endDate.value;
  if (startVal && endVal && startVal > endVal) {
    if ($.dateWarningArea) {
      $.dateWarningArea.textContent = '⚠ Start date is after end date';
      $.dateWarningArea.style.display = 'block';
    }
    return false;
  }
  if ($.dateWarningArea) {
    $.dateWarningArea.style.display = 'none';
  }
  return true;
}

function debouncedFilter() {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(() => filterData(), 150);
}

function filterData() {
  validateDates();
  const startStr = $.startDate.value;
  const endStr = $.endDate.value;
  const start = startStr ? new Date(startStr + 'T00:00:00') : null;
  const end = endStr ? new Date(endStr + 'T23:59:59') : null;

  const filtered = rawTransactions.filter(t => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    return true;
  });
  updateDashboard(filtered);
  if (debugPanelOpen) renderDebugPanel();
}

function getFilteredData() {
  const startStr = $.startDate.value;
  const endStr = $.endDate.value;
  const start = startStr ? new Date(startStr + 'T00:00:00') : null;
  const end = endStr ? new Date(endStr + 'T23:59:59') : null;
  return rawTransactions.filter(t => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    return true;
  });
}

/* ---- Dashboard rendering ---- */

function updateDashboard(data) {
  showAllTxns = false;
  $.transactionList.classList.remove('expanded');
  const totalSpent = getTotalSpent(data);
  const categorySums = getCategorySums(data);

  $.totalSpentCard.innerText = fmtMoney(totalSpent);
  $.txnCount.innerText = data.length;

  const pctUsed = currentBudget > 0 ? Math.min((totalSpent / currentBudget) * 100, 100) : 0;
  $.gaugeFill.style.width = pctUsed + '%';

  if (totalSpent > currentBudget) {
    $.statusLabel.innerText = 'Budget Status';
    $.statusValueCard.innerText = '⚠ Budget Burst';
    $.statusValueCard.classList.add('burst');
    $.statusValueCard.classList.remove('safe');
    $.gaugeFill.classList.add('burst');
    $.statusBadge.innerText = 'Over budget';
    $.statusBadge.classList.add('burst');
    $.statusSub.innerText = `${fmtMoney(totalSpent - currentBudget)} over the ${fmtMoney(currentBudget)} budget`;
  } else {
    $.statusLabel.innerText = 'Remaining Balance';
    const remainder = currentBudget - totalSpent;
    $.statusValueCard.innerText = fmtMoney(remainder);
    $.statusValueCard.classList.add('safe');
    $.statusValueCard.classList.remove('burst');
    $.gaugeFill.classList.remove('burst');
    $.statusBadge.innerText = 'On track';
    $.statusBadge.classList.remove('burst');
    $.statusSub.innerText = `of ${fmtMoney(currentBudget)} budgeted`;
  }

  renderDonut(categorySums, totalSpent);
  renderLegend(categorySums, totalSpent);
  renderCategoryList(categorySums, totalSpent);
  renderMonthlyChart(data);
  renderTransactionFeed(data);
}

/* ---- Donut chart ---- */

function renderDonut(categoryData, totalSpent, labels) {
  const ctx = $.categoryChart.getContext('2d');
  const entries = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);
  const cats = entries.map(e => e[0]);
  const values = entries.map(e => e[1]);
  const colors = cats.map((_, i) => colorFor(i));

  $.topCategoryLabel.innerText = cats.length ? cats[0] : '—';

  if (categoryChartInst) categoryChartInst.destroy();
  if (cats.length === 0) { ctx.clearRect(0, 0, 200, 200); return; }

  try {
    categoryChartInst = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: cats,
        datasets: [{
          data: values, backgroundColor: colors, borderWidth: 3,
          borderColor: '#FFFFFF', hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161B33', padding: 10, cornerRadius: 10,
            bodyFont: { family: 'Inter', weight: '600' },
            titleFont: { family: 'Inter', weight: '700' },
            callbacks: { label: (c) => fmtMoney(c.parsed) }
          }
        },
        onClick: (evt, elements) => {
          if (elements.length) {
            const idx = elements[0].index;
            setActiveCategory(cats[idx]);
            openSheet(cats[idx]);
          }
        }
      }
    });
  } catch (e) {
    console.error('Chart.js error:', e);
  }
}

/* ---- Legend ---- */

function renderLegend(categoryData, totalSpent) {
  const entries = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);
  $.catCount.innerText = entries.length ? `${entries.length} categories` : '';

  if (entries.length === 0) {
    $.legendGrid.innerHTML = '';
    return;
  }

  $.legendGrid.innerHTML = entries.map(([name, val], idx) => {
    const pct = totalSpent > 0 ? (val / totalSpent * 100) : 0;
    const c = colorFor(idx);
    const isActive = activeCategory === name;
    return `
      <div class="legend-chip${isActive ? ' active' : ''}" style="color:${c}" data-category="${escHtml(name)}">
        <span class="dot" style="background:${c}"></span>
        <span class="name" style="color:var(--ink)">${escHtml(name)}</span>
        <span class="pct">${pct.toFixed(0)}%</span>
      </div>`;
  }).join('');
}

/* ---- Active category ---- */

function setActiveCategory(name) {
  activeCategory = (activeCategory === name) ? null : name;
  const data = getFilteredData();
  const totalSpent = getTotalSpent(data);
  const categorySums = getCategorySums(data);
  renderLegend(categorySums, totalSpent);
  renderCategoryList(categorySums, totalSpent);
  renderTransactionFeed(data);
}

/* ---- Category Sheet ---- */

function openSheet(name) {
  const data = getFilteredData();
  const items = data.filter(t => t.category === name).sort((a, b) => b.date - a.date);
  const total = items.reduce((s, t) => s + t.amount, 0);
  const categorySums = getCategorySums(data);
  const sortedCats = sortedCategories(categorySums);
  const catIdx = sortedCats.indexOf(name);
  const color = colorFor(catIdx >= 0 ? catIdx : 0);

  $.sheetIcon.innerText = iconFor(name);
  $.sheetIcon.style.background = color + '22';
  $.sheetCatName.innerText = name;
  $.sheetCatMeta.innerText = `${items.length} transaction${items.length !== 1 ? 's' : ''}`;
  $.sheetCatTotal.innerText = fmtMoney(total);
  $.sheetCatTotal.style.color = color;

  if (items.length === 0) {
    $.sheetBody.innerHTML = '<p class="empty-state">No transactions for this category.</p>';
  } else {
    $.sheetBody.innerHTML = items.map((item, i) => `
      <div class="sheet-txn">
        <div class="left">
          <span class="idx">${i + 1}</span>
          <div class="info">
            <span class="desc">${escHtml(item.description)}</span>
            <span class="date">
              <time datetime="${item.date.toISOString().slice(0, 10)}">
                ${item.date.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </time>
            </span>
          </div>
        </div>
        <span class="amt nums">${fmtMoney(item.amount)}</span>
      </div>`).join('');
  }

  document.body.style.overflow = 'hidden';
  $.sheetBackdrop.classList.add('open');
  $.categorySheet.classList.add('open');
}

function closeSheet() {
  document.body.style.overflow = '';
  $.sheetBackdrop.classList.remove('open');
  $.categorySheet.classList.remove('open');
}

/* ---- Category List ---- */

function renderCategoryList(categoryData, totalSpent) {
  const entries = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    $.categoryList.innerHTML = '<p class="empty-state">No spending yet in this range.</p>';
    return;
  }

  const maxVal = entries[0][1];

  $.categoryList.innerHTML = entries.map(([name, val], idx) => {
    const barPct = maxVal > 0 ? (val / maxVal * 100) : 0;
    const c = colorFor(idx);
    return `
      <div class="cat-row" data-category="${escHtml(name)}">
        <span class="swatch" style="background:${c}"></span>
        <span class="name">${escHtml(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${barPct}%; background:${c}"></span></span>
        <span class="amt nums">${fmtMoney(val)}</span>
      </div>`;
  }).join('');
}

/* ---- Monthly Chart ---- */

function renderMonthlyChart(allData) {
  const ctx = $.monthlyChart.getContext('2d');

  const monthlyTotals = {};
  allData.forEach(t => {
    const monthLabel = t.date.toLocaleString('default', { month: 'short', year: '2-digit' });
    monthlyTotals[monthLabel] = (monthlyTotals[monthLabel] || 0) + t.amount;
  });

  const labels = Object.keys(monthlyTotals).reverse().slice(-6);
  const dataValues = labels.map(lbl => monthlyTotals[lbl]);

  if (monthlyChartInst) monthlyChartInst.destroy();

  const gradientColors = ['#5B5FEF', '#8B5CF6', '#D946A8', '#F5A524', '#14B8A6', '#FF6F59'];

  try {
    monthlyChartInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: dataValues,
          backgroundColor: labels.map((_, i) => gradientColors[i % gradientColors.length]),
          borderRadius: 8,
          barThickness: 22
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161B33', padding: 10, cornerRadius: 10,
            bodyFont: { family: 'Inter', weight: '600' },
            callbacks: { label: (c) => fmtMoney(c.parsed.y) }
          }
        },
        scales: {
          y: {
            display: true,
            grid: { color: '#ECEEF6' },
            border: { display: false },
            ticks: {
              font: { size: 10, family: 'Inter', weight: '600' },
              color: '#767C9B',
              callback: (v) => 'RM' + Number(v).toLocaleString('en-US')
            }
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 11, family: 'Inter', weight: '600' }, color: '#767C9B' }
          }
        }
      }
    });
  } catch (e) {
    console.error('Chart.js error:', e);
  }
}

/* ---- Transaction Feed ---- */

function renderTransactionFeed(items) {
  const visibleItems = activeCategory ? items.filter(i => i.category === activeCategory) : items;

  if (items.length === 0) {
    $.transactionList.innerHTML = '<p class="empty-state">No transactions logged for this range.</p>';
    return;
  }
  if (visibleItems.length === 0) {
    $.transactionList.innerHTML = `<p class="empty-state">No "${escHtml(activeCategory)}" transactions in this range.</p>`;
    return;
  }

  const categorySums = getCategorySums(getFilteredData());
  const sortedCats = sortedCategories(categorySums);

  const displayItems = showAllTxns ? visibleItems : visibleItems.slice(0, 50);
  const totalCount = visibleItems.length;

  const listHtml = displayItems.map(item => {
    const dimmed = activeCategory && activeCategory !== item.category;
    const catIdx = sortedCats.indexOf(item.category);
    const c = colorFor(catIdx >= 0 ? catIdx : 0);
    return `
      <div class="txn${dimmed ? ' dimmed' : ''}">
        <div class="left">
          <div class="cat-dot" style="background:${c}22">${iconFor(item.category)}</div>
          <div class="info">
            <span class="desc">${escHtml(item.description)}</span>
            <div class="meta">
              <span class="pill">${escHtml(item.category)}</span>
              <span class="date">
                <time datetime="${item.date.toISOString().slice(0, 10)}">
                  ${item.date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })}
                </time>
              </span>
            </div>
          </div>
        </div>
        <span class="amt nums">${fmtMoney(item.amount)}</span>
      </div>`;
  }).join('');

  let buttonHtml = '';
  if (totalCount > 50 && !showAllTxns) {
    buttonHtml = `<div class="show-all-wrap"><button class="show-all-btn" id="showAllBtn">Show all ${totalCount} transactions</button></div>`;
  }

  $.transactionList.innerHTML = listHtml + buttonHtml;

  const showAllBtn = document.getElementById('showAllBtn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      showAllTxns = true;
      $.transactionList.classList.add('expanded');
      renderTransactionFeed(items);
    });
  }
}

/* ---- Event setup (delegation) ---- */

function setupEvents() {
  $.syncRow.addEventListener('click', manualRefresh);
  $.debugToggleBtn.addEventListener('click', toggleDebugPanel);
  $.sheetBackdrop.addEventListener('click', closeSheet);
  if ($.sheetCloseBtn) $.sheetCloseBtn.addEventListener('click', closeSheet);
  if ($.budgetSaveBtn) $.budgetSaveBtn.addEventListener('click', updateBudget);
  if ($.budgetDoneBtn) $.budgetDoneBtn.addEventListener('click', toggleBudgetModal);
  if ($.budgetEditBtn) $.budgetEditBtn.addEventListener('click', toggleBudgetModal);
  $.startDate.addEventListener('change', debouncedFilter);
  $.endDate.addEventListener('change', debouncedFilter);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  $.legendGrid.addEventListener('click', e => {
    const chip = e.target.closest('.legend-chip');
    if (chip && chip.dataset.category) {
      const name = chip.dataset.category;
      setActiveCategory(name);
      openSheet(name);
    }
  });

  $.categoryList.addEventListener('click', e => {
    const row = e.target.closest('.cat-row');
    if (row && row.dataset.category) {
      const name = row.dataset.category;
      setActiveCategory(name);
      openSheet(name);
    }
  });
}

/* ---- Init ---- */

function init() {
  cacheDom();
  loadBudget();

  const cached = loadCachedTransactions();
  if (cached.length > 0) {
    rawTransactions = cached;
    setSyncLabel('Loading…', false);
  }

  const now = new Date();
  let startYear = now.getFullYear();
  let startMonth = now.getMonth();

  if (now.getDate() < 25) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  const cycleStart = new Date(startYear, startMonth, 25);
  const cycleEnd = new Date(startYear, startMonth + 1, 24);

  const fmtInputDate = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  $.startDate.value = fmtInputDate(cycleStart);
  $.endDate.value = fmtInputDate(cycleEnd);

  setupEvents();

  if (cached.length > 0) {
    filterData();
    setSyncLabel('Loaded from cache — refreshing…', false);
  }

  fetchData();
}

document.addEventListener('DOMContentLoaded', init);

})();
