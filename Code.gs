/**
 * Our Little Nest — Quick Add Endpoint
 *
 * Deploy as: Web App → Execute as: Me → Who has access: Anyone
 * Paste the resulting URL into the app's config.
 */

const SHEET_NAME = 'Database'; // <-- changed to match your tab name
const SAVINGS_SHEET_NAME = 'Savings'; // <-- savings tab name

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, status: 'alive' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'savings') return handleSavingsPost(data);

    const amount = parseFloat(data.amount);
    const description = String(data.description || 'Manual entry');
    const category = String(data.category || 'Other');

    if (!amount || amount <= 0) {
      throw new Error('Invalid amount');
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found');

    const timestamp = new Date();
    sheet.appendRow([timestamp, amount, description, category]);

    return respond({ ok: true, amount, description, category });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function handleSavingsPost(data) {
  const bank = String(data.bank || '');
  const potId = String(data.potId || '');
  const potName = String(data.potName || '');
  const amount = parseFloat(data.amount);
  const note = String(data.note || '');

  if (isNaN(amount) || amount === 0) throw new Error('Invalid savings amount');
  if (!potName) throw new Error('Missing pot name');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SAVINGS_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SAVINGS_SHEET_NAME + '" not found');

  sheet.appendRow([bank, potId, potName, new Date(), amount, note]);

  return respond({ ok: true, bank, potName, amount, note });
}

function respond(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
