/* ===== Config ===== */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzE2ELVEpqzz4UK7TbB6eycU_IjsxDLD1fWHC3MhlR2p_SGDHJrFLcjJbzBKpcNJzWXcg/exec';
const SAVINGS_CSV_URL = 'https://docs.google.com/spreadsheets/d/19ALF3-sbVAmT3u9yfoKS3Znabe8DD1fftFg-fU7Li2k/gviz/tq?tqx=out:csv&sheet=Savings';
const GATE_TTL_DAYS = 3;
const APP_PASSWORDS = ['5527', '5448'];

const BANK_KEY = 'ournest_savings_banks';
const POT_KEY = 'ournest_savings_pots';
const ENTRY_KEY = 'ournest_savings_entries';

const PALETTE = ['#E93C88', '#1A73E8', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#14B8A6', '#6366F1', '#F97316', '#84CC16'];

let banks = [];
let pots = [];
let entries = [];
let chartInst = null;
let editingBankId = null;
let editingPotId = null;
let moneyPotId = null;
let selectedColor = PALETTE[0];
let _hasRendered = false;

const $ = {};

function cacheDom() {
  const ids = [
    'themeBtn','themeIcon','syncBtn','totalSaved','savingsMeta','syncRow','syncLabel',
    'chartScope','growthChart','chartEmpty','banksWrap','addBankBtn',
    'historyScope','historyList','fabBtn',
    'moneyBackdrop','moneySheet','moneyCloseBtn','moneyTitle','moneySub',
    'moneyAmount','moneyNote','moneyDepositBtn','moneyWithdrawBtn','moneyFootnote',
    'bankBackdrop','bankSheet','bankCloseBtn','bankTitle','bankName','bankSwatches',
    'bankSaveBtn','bankDeleteBtn','bankFootnote',
    'potBackdrop','potSheet','potCloseBtn','potTitle','potBank','potName','potTarget',
    'potSaveBtn','potDeleteBtn','potFootnote',
    'passwordGate'
  ];
  ids.forEach(id => { $[id] = document.getElementById(id); });
}

function uid(p) {
  return p + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function fmtMoney(n) {
  return 'RM ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ===== Persistence ===== */
function loadState() {
  try { banks = JSON.parse(localStorage.getItem(BANK_KEY)) || []; } catch (_) { banks = []; }
  try { pots = JSON.parse(localStorage.getItem(POT_KEY)) || []; } catch (_) { pots = []; }
  try { entries = JSON.parse(localStorage.getItem(ENTRY_KEY)) || []; } catch (_) { entries = []; }
  entries.forEach(e => { if (typeof e.date === 'string') e.date = new Date(e.date); });
}

function saveState() {
  try {
    localStorage.setItem(BANK_KEY, JSON.stringify(banks));
    localStorage.setItem(POT_KEY, JSON.stringify(pots));
    localStorage.setItem(ENTRY_KEY, JSON.stringify(entries.map(e => ({
      ...e,
      date: e.date instanceof Date ? e.date.toISOString() : e.date
    }))));
  } catch (_) { /* ignore */ }
}

/* ===== Lookups ===== */
function getBank(id) { return banks.find(b => b.id === id); }
function getPot(id) { return pots.find(p => p.id === id); }
function bankPots(bankId) { return pots.filter(p => p.bankId === bankId); }
function potEntries(potId) { return entries.filter(e => e.potId === potId); }
function potBalance(potId) {
  return potEntries(potId).reduce((s, e) => s + Number(e.amount || 0), 0);
}
function bankBalance(bankId) {
  return bankPots(bankId).reduce((s, p) => s + potBalance(p.id), 0);
}
function totalSaved() {
  return banks.reduce((s, b) => s + bankBalance(b.id), 0);
}
function potColor(potId) {
  const p = getPot(potId);
  const b = p ? getBank(p.bankId) : null;
  return (b && b.color) || PALETTE[0];
}
function scopeEntries(scope) {
  if (!scope || scope === 'all') return entries;
  if (scope.indexOf('bank_') === 0) {
    const bid = scope.slice(5);
    return entries.filter(e => { const p = getPot(e.potId); return p && p.bankId === bid; });
  }
  if (scope.indexOf('pot_') === 0) {
    const pid = scope.slice(4);
    return entries.filter(e => e.potId === pid);
  }
  return entries;
}

/* ===== Loading ===== */
function hideLoading() {
  if (!_hasRendered) {
    _hasRendered = true;
    const ls = document.getElementById('loadingScreen');
    if (ls) ls.classList.add('hidden');
  }
}

/* ===== Render ===== */
function renderAll() {
  renderHero();
  renderChartScopeOptions();
  renderBanks();
  renderHistoryScopeOptions();
  renderChart();
  renderHistory();
  hideLoading();
}

function renderHero() {
  const total = totalSaved();
  $.totalSaved.innerText = fmtMoney(total);
  const potCount = pots.length;
  const bankCount = banks.length;
  $.savingsMeta.innerText = bankCount === 0
    ? 'No banks yet'
    : `${potCount} pot${potCount === 1 ? '' : 's'} across ${bankCount} bank${bankCount === 1 ? '' : 's'}`;
}

function renderBanks() {
  if (banks.length === 0) {
    $.banksWrap.innerHTML = '<p class="empty-state">No savings yet. Tap the button below to create a bank.</p>';
    return;
  }
  $.banksWrap.innerHTML = banks.map(bank => {
    const color = bank.color || PALETTE[0];
    const potsHtml = bankPots(bank.id).map(pot => potCardHtml(pot, color)).join('');
    return `
      <div class="bank-section">
        <div class="bank-header">
          <span class="bank-dot" style="background:${color}"></span>
          <span class="bank-name">${escHtml(bank.name)}</span>
          <span class="bank-total nums">${fmtMoney(bankBalance(bank.id))}</span>
          <div class="bank-actions">
            <button class="bank-btn" data-action="add-pot" data-bank="${bank.id}" aria-label="Add pot">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="bank-btn" data-action="edit-bank" data-bank="${bank.id}" aria-label="Edit bank">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.8" fill="currentColor" stroke="none"/></svg>
            </button>
          </div>
        </div>
        <div class="pot-list">${potsHtml || '<p class="empty-state" style="padding:16px 0;">No pots yet in this bank.</p>'}</div>
      </div>`;
  }).join('');
}

function potCardHtml(pot, color) {
  const balance = potBalance(pot.id);
  const target = Number(pot.target || 0);
  const pct = target > 0 ? Math.min((balance / target) * 100, 100) : 0;
  return `
    <div class="pot-card" style="--pot:${color}">
      <div class="pot-top">
        <span class="pot-name">${escHtml(pot.name)}</span>
        <button class="pot-menu" data-action="edit-pot" data-pot="${pot.id}" aria-label="Edit pot">⋯</button>
      </div>
      <div class="pot-balance nums">${fmtMoney(balance)}</div>
      ${target > 0 ? `<div class="pot-progress-track"><div class="pot-progress-fill" style="width:${pct}%"></div></div>` : ''}
      ${target > 0 ? `<div class="pot-target">${pct.toFixed(0)}% of ${fmtMoney(target)} goal</div>` : ''}
      <div class="pot-actions">
        <button class="pot-action deposit" data-action="deposit" data-pot="${pot.id}">＋ Add</button>
        <button class="pot-action withdraw" data-action="withdraw" data-pot="${pot.id}">− Withdraw</button>
      </div>
    </div>`;
}

function renderChartScopeOptions() {
  let html = '<option value="all">All Banks</option>';
  banks.forEach(b => { html += `<option value="bank_${b.id}">${escHtml(b.name)}</option>`; });
  pots.forEach(p => {
    const b = getBank(p.bankId);
    const label = b ? `${b.name} · ${p.name}` : p.name;
    html += `<option value="pot_${p.id}">${escHtml(label)}</option>`;
  });
  const cur = $.chartScope.value;
  $.chartScope.innerHTML = html;
  if (cur && Array.prototype.some.call($.chartScope.options, o => o.value === cur)) {
    $.chartScope.value = cur;
  }
}

function renderHistoryScopeOptions() {
  let html = '<option value="all">All Pots</option>';
  pots.forEach(p => {
    const b = getBank(p.bankId);
    const label = b ? `${b.name} · ${p.name}` : p.name;
    html += `<option value="pot_${p.id}">${escHtml(label)}</option>`;
  });
  const cur = $.historyScope.value;
  $.historyScope.innerHTML = html;
  if (cur && Array.prototype.some.call($.historyScope.options, o => o.value === cur)) {
    $.historyScope.value = cur;
  }
}

function renderChart() {
  const scope = $.chartScope.value || 'all';
  const items = scopeEntries(scope).slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (items.length === 0) {
    if (chartInst) { chartInst.destroy(); chartInst = null; }
    $.chartEmpty.style.display = 'flex';
    return;
  }
  $.chartEmpty.style.display = 'none';

  let lineColor = '#10B981';
  if (scope.indexOf('pot_') === 0) lineColor = potColor(scope.slice(4));
  else if (scope.indexOf('bank_') === 0) {
    const b = getBank(scope.slice(5));
    lineColor = (b && b.color) || lineColor;
  }

  const labels = [];
  const data = [];
  let running = 0;
  items.forEach(e => {
    running += Number(e.amount || 0);
    const d = new Date(e.date);
    labels.push(isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }));
    data.push(running);
  });

  try {
    if (chartInst) chartInst.destroy();
    chartInst = new Chart($.growthChart.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: lineColor,
          backgroundColor: lineColor + '22',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          spanGaps: true
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
            grid: { color: '#1F2430' },
            border: { display: false },
            ticks: {
              font: { size: 10, family: 'Inter', weight: '600' },
              color: '#6B7280',
              callback: (v) => 'RM' + Number(v).toLocaleString('en-US')
            }
          },
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 10, family: 'Inter', weight: '600' }, color: '#6B7280', maxTicksLimit: 6 }
          }
        }
      }
    });
  } catch (_) { /* chart.js unavailable */ }
}

function renderHistory() {
  const scope = $.historyScope.value || 'all';
  const items = scopeEntries(scope).slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (items.length === 0) {
    $.historyList.innerHTML = '<p class="empty-state">No entries yet.</p>';
    return;
  }

  $.historyList.innerHTML = items.slice(0, 80).map(e => {
    const pot = getPot(e.potId);
    const color = potColor(e.potId);
    const isDeposit = Number(e.amount) >= 0;
    const d = new Date(e.date);
    const dateStr = isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="history-item">
        <div class="left">
          <span class="dot" style="background:${color}"></span>
          <div class="info">
            <span class="desc">${escHtml(e.note || (pot ? pot.name : 'Savings'))}</span>
            <span class="meta">${escHtml(pot ? pot.name : '')}${dateStr ? ' · ' + dateStr : ''}</span>
          </div>
        </div>
        <span class="amt ${isDeposit ? 'deposit' : 'withdraw'} nums">${isDeposit ? '+' : '−'}${fmtMoney(Math.abs(Number(e.amount || 0)))}</span>
      </div>`;
  }).join('');
}

/* ===== Sheets ===== */
function openSheet(backdrop, sheet) {
  document.body.style.overflow = 'hidden';
  backdrop.classList.add('open');
  sheet.classList.add('open');
}

function closeSheet(backdrop, sheet) {
  document.body.style.overflow = '';
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
}

/* ===== Money ===== */
function openMoneySheet(potId) {
  const pot = getPot(potId);
  if (!pot) return;
  moneyPotId = potId;
  $.moneyTitle.innerText = pot.name;
  $.moneySub.innerText = `Current balance ${fmtMoney(potBalance(pot.id))}`;
  $.moneyAmount.value = '';
  $.moneyNote.value = '';
  $.moneyFootnote.innerText = 'Also submits to your Google Sheet';
  $.moneyFootnote.style.color = '';
  openSheet($.moneyBackdrop, $.moneySheet);
  setTimeout(() => $.moneyAmount.focus(), 400);
}

async function addMoney(kind) {
  const amount = parseFloat($.moneyAmount.value);
  const note = $.moneyNote.value.trim() || '';
  if (!amount || amount <= 0) {
    $.moneyAmount.focus();
    return;
  }
  const pot = getPot(moneyPotId);
  if (!pot) return;
  const bank = getBank(pot.bankId);
  const signed = kind === 'withdraw' ? -amount : amount;

  entries.push({ id: uid('e'), potId: pot.id, date: new Date(), amount: signed, note });
  saveState();
  renderAll();
  closeSheet($.moneyBackdrop, $.moneySheet);
  pushToSheet(bank, pot, signed, note);
}

async function pushToSheet(bank, pot, signedAmount, note) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify({
        action: 'savings',
        bank: bank ? bank.name : '',
        potId: pot.id,
        potName: pot.name,
        amount: signedAmount,
        note
      })
    });
    const text = await res.text();
    let result = null;
    try { result = JSON.parse(text); } catch (_) { result = null; }
    if (res.ok && result && result.ok) {
      setSyncLabel('Synced to Google Sheet ✓', true);
    } else {
      const err = (result && result.error) || ('HTTP ' + res.status);
      setSyncLabel('⚠ ' + err, false);
      console.error('Savings sync failed:', err);
    }
  } catch (err) {
    setSyncLabel('Saved locally (offline) ✓', true);
    console.error('Savings sync offline:', err);
  }
}

/* ===== Bank ===== */
function buildSwatches(selected) {
  $.bankSwatches.innerHTML = PALETTE.map(c =>
    `<div class="swatch ${c === selected ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
  ).join('');
}

function openBankSheet(bankId) {
  editingBankId = bankId || null;
  const bank = bankId ? getBank(bankId) : null;
  $.bankTitle.innerText = bank ? 'Edit Bank' : 'New Bank';
  $.bankName.value = bank ? bank.name : '';
  selectedColor = bank ? bank.color : PALETTE[0];
  buildSwatches(selectedColor);
  $.bankDeleteBtn.style.display = bank ? 'block' : 'none';
  $.bankFootnote.innerText = '';
  openSheet($.bankBackdrop, $.bankSheet);
  setTimeout(() => $.bankName.focus(), 400);
}

function saveBank() {
  const name = $.bankName.value.trim();
  if (!name) { $.bankName.focus(); return; }
  if (editingBankId) {
    const bank = getBank(editingBankId);
    if (bank) { bank.name = name; bank.color = selectedColor; }
  } else {
    banks.push({ id: uid('b'), name, color: selectedColor });
  }
  saveState();
  renderAll();
  closeSheet($.bankBackdrop, $.bankSheet);
}

function deleteBank() {
  const bank = getBank(editingBankId);
  if (!bank) return;
  if (!confirm(`Delete bank "${bank.name}" and all its pots and entries?`)) return;
  const potIds = new Set(bankPots(bank.id).map(p => p.id));
  pots = pots.filter(p => p.bankId !== bank.id);
  entries = entries.filter(e => !potIds.has(e.potId));
  banks = banks.filter(b => b.id !== bank.id);
  saveState();
  renderAll();
  closeSheet($.bankBackdrop, $.bankSheet);
}

/* ===== Pot ===== */
function openPotSheet(bankId, potId) {
  editingPotId = potId || null;
  const pot = potId ? getPot(potId) : null;

  $.potBank.innerHTML = banks.map(b =>
    `<option value="${b.id}">${escHtml(b.name)}</option>`
  ).join('');

  if (pot) {
    $.potBank.value = pot.bankId;
    $.potName.value = pot.name;
    $.potTarget.value = pot.target || '';
  } else {
    $.potBank.value = bankId && getBank(bankId) ? bankId : (banks[0] ? banks[0].id : '');
    $.potName.value = '';
    $.potTarget.value = '';
  }

  $.potTitle.innerText = pot ? 'Edit Pot' : 'New Pot';
  $.potDeleteBtn.style.display = pot ? 'block' : 'none';
  $.potFootnote.innerText = '';
  openSheet($.potBackdrop, $.potSheet);
  setTimeout(() => $.potName.focus(), 400);
}

function savePot() {
  if (banks.length === 0) { $.potFootnote.innerText = 'Create a bank first.'; return; }
  const bankId = $.potBank.value;
  const name = $.potName.value.trim();
  if (!name) { $.potName.focus(); return; }
  const targetRaw = parseFloat($.potTarget.value);
  const target = (!isNaN(targetRaw) && targetRaw > 0) ? targetRaw : null;

  if (editingPotId) {
    const pot = getPot(editingPotId);
    if (pot) { pot.bankId = bankId; pot.name = name; pot.target = target; }
  } else {
    pots.push({ id: uid('p'), bankId, name, target });
  }
  saveState();
  renderAll();
  closeSheet($.potBackdrop, $.potSheet);
}

function deletePot() {
  const pot = getPot(editingPotId);
  if (!pot) return;
  if (!confirm(`Delete pot "${pot.name}" and all its entries?`)) return;
  entries = entries.filter(e => e.potId !== pot.id);
  pots = pots.filter(p => p.id !== pot.id);
  saveState();
  renderAll();
  closeSheet($.potBackdrop, $.potSheet);
}

/* ===== Sync ===== */
function setSyncLabel(text, transient) {
  $.syncLabel.textContent = text;
  if (transient) {
    setTimeout(() => { $.syncLabel.textContent = 'Synced'; }, 4000);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

async function fetchSavings() {
  setSyncLabel('Syncing…', false);
  try {
    const busted = SAVINGS_CSV_URL + '&_=' + Date.now();
    const res = await fetch(busted, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('No data');

    const header = rows[0].map(h => String(h || '').trim().toLowerCase());
    const idxBank = header.indexOf('bank');
    const idxPotId = header.indexOf('pot id') >= 0 ? header.indexOf('pot id') : header.indexOf('potid');
    const idxPotName = header.indexOf('pot name');
    const idxDate = header.indexOf('date');
    const idxAmount = header.indexOf('amount');
    const idxNote = header.indexOf('note');

    if (idxPotName < 0 || idxAmount < 0) throw new Error('Bad header');

    let added = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const bankName = idxBank >= 0 ? String(r[idxBank] || '').trim() : '';
      const potId = idxPotId >= 0 ? String(r[idxPotId] || '').trim() : '';
      const potName = String(r[idxPotName] || '').trim();
      const amount = parseFloat(r[idxAmount]);
      const note = idxNote >= 0 ? String(r[idxNote] || '').trim() : '';
      const dateRaw = idxDate >= 0 ? r[idxDate] : '';
      if (isNaN(amount) || !potName) continue;

      let bank = bankName
        ? banks.find(b => b.name.toLowerCase() === bankName.toLowerCase())
        : null;
      if (!bank && bankName) {
        bank = { id: uid('b'), name: bankName, color: PALETTE[banks.length % PALETTE.length] };
        banks.push(bank);
      }

      let pot = potId ? pots.find(p => p.id === potId) : null;
      if (!pot) {
        pot = pots.find(p =>
          p.name.toLowerCase() === potName.toLowerCase() &&
          p.bankId === (bank ? bank.id : p.bankId)
        );
      }
      if (!pot && bank) {
        pot = { id: potId || uid('p'), bankId: bank.id, name: potName, target: null };
        pots.push(pot);
      }
      if (!pot) continue;

      const exists = entries.some(en =>
        en.potId === pot.id &&
        Number(en.amount) === amount &&
        String(en.note || '') === note
      );
      if (exists) continue;

      const d = new Date(dateRaw);
      entries.push({
        id: uid('e'),
        potId: pot.id,
        date: isNaN(d.getTime()) ? new Date() : d,
        amount,
        note
      });
      added++;
    }

    if (added > 0) {
      saveState();
      setSyncLabel(`Synced · ${added} new`, true);
    } else {
      setSyncLabel('Up to date', true);
    }
  } catch (_) {
    setSyncLabel('Offline — using local data', true);
  }
  renderAll();
}

/* ===== Theme ===== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.innerHTML = theme === 'dark'
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke-linecap="round"/>';
  }
  localStorage.setItem('ournest_theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('ournest_theme');
  if (saved) { applyTheme(saved); return; }
  const h = new Date().getHours();
  applyTheme(h >= 6 && h < 18 ? 'light' : 'dark');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ===== Events ===== */
function setupEvents() {
  if ($.themeBtn) $.themeBtn.addEventListener('click', toggleTheme);
  $.syncBtn.addEventListener('click', fetchSavings);

  $.chartScope.addEventListener('change', renderChart);
  $.historyScope.addEventListener('change', renderHistory);

  $.addBankBtn.addEventListener('click', () => openBankSheet(null));

  $.fabBtn.addEventListener('click', () => {
    if (banks.length === 0) { openBankSheet(null); return; }
    if (pots.length === 0) { openPotSheet(banks[0].id, null); return; }
    openMoneySheet(pots[0].id);
  });

  $.banksWrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'deposit' || action === 'withdraw') openMoneySheet(btn.dataset.pot);
    else if (action === 'add-pot') openPotSheet(btn.dataset.bank, null);
    else if (action === 'edit-bank') openBankSheet(btn.dataset.bank);
    else if (action === 'edit-pot') openPotSheet(null, btn.dataset.pot);
  });

  $.moneyBackdrop.addEventListener('click', () => closeSheet($.moneyBackdrop, $.moneySheet));
  $.moneyCloseBtn.addEventListener('click', () => closeSheet($.moneyBackdrop, $.moneySheet));
  $.moneyDepositBtn.addEventListener('click', () => addMoney('deposit'));
  $.moneyWithdrawBtn.addEventListener('click', () => addMoney('withdraw'));
  $.moneyAmount.addEventListener('keydown', e => { if (e.key === 'Enter') $.moneyNote.focus(); });

  $.bankBackdrop.addEventListener('click', () => closeSheet($.bankBackdrop, $.bankSheet));
  $.bankCloseBtn.addEventListener('click', () => closeSheet($.bankBackdrop, $.bankSheet));
  $.bankSaveBtn.addEventListener('click', saveBank);
  $.bankDeleteBtn.addEventListener('click', deleteBank);
  $.bankSwatches.addEventListener('click', e => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    selectedColor = sw.dataset.color;
    buildSwatches(selectedColor);
  });

  $.potBackdrop.addEventListener('click', () => closeSheet($.potBackdrop, $.potSheet));
  $.potCloseBtn.addEventListener('click', () => closeSheet($.potBackdrop, $.potSheet));
  $.potSaveBtn.addEventListener('click', savePot);
  $.potDeleteBtn.addEventListener('click', deletePot);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSheet($.moneyBackdrop, $.moneySheet);
      closeSheet($.bankBackdrop, $.bankSheet);
      closeSheet($.potBackdrop, $.potSheet);
    }
  });
}

/* ===== Init ===== */
function init() {
  cacheDom();
  initTheme();
  loadState();
  renderAll();
  setupEvents();
  fetchSavings();
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  initTheme();
  const unlockedAt = localStorage.getItem('ournest_unlocked_at');
  if (unlockedAt && Date.now() - Number(unlockedAt) <= GATE_TTL_DAYS * 86400000) {
    $.passwordGate.classList.add('hidden');
    init();
  }
});
