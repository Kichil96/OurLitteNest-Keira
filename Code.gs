/**
 * Our Little Nest — Quick Add Endpoint
 *
 * Deploy as: Web App → Execute as: Me → Who has access: Anyone
 * Paste the resulting URL into the app's config.
 */

const SHEET_NAME = 'Database'; // <-- changed to match your tab name

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, status: 'alive' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
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

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, amount, description, category }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
