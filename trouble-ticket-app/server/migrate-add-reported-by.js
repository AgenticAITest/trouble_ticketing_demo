/**
 * Migration script to add reported_by column to tickets sheet
 * Run with: node migrate-add-reported-by.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// New headers for tickets sheet (with reported_by added)
const NEW_TICKETS_HEADERS = [
  'ticket_id',
  'session_id',
  'status',
  'application',
  'problem_summary',
  'problem_details',
  'reported_by',      // NEW COLUMN
  'reported_at',
  'updated_at',
  'assigned_log',
  'suggested_fix',
  'it_notes',
  'resolved_at'
];

async function migrate() {
  console.log('🔄 Starting migration: Add reported_by column to tickets...\n');

  if (!SPREADSHEET_ID) {
    console.error('❌ GOOGLE_SPREADSHEET_ID not set in .env');
    process.exit(1);
  }

  // Initialize auth
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

  try {
    await doc.loadInfo();
    console.log(`📊 Connected to: ${doc.title}\n`);

    const sheet = doc.sheetsByTitle['tickets'];
    if (!sheet) {
      console.error('❌ Sheet "tickets" not found!');
      process.exit(1);
    }

    // Load existing rows
    const rows = await sheet.getRows();
    console.log(`📋 Found ${rows.length} existing tickets`);

    // Backup existing data
    const existingData = rows.map(row => ({
      ticket_id: row.get('ticket_id') || '',
      session_id: row.get('session_id') || '',
      status: row.get('status') || '',
      application: row.get('application') || '',
      problem_summary: row.get('problem_summary') || '',
      problem_details: row.get('problem_details') || '',
      reported_by: '',  // New column - empty for existing tickets
      reported_at: row.get('reported_at') || '',
      updated_at: row.get('updated_at') || '',
      assigned_log: row.get('assigned_log') || '',
      suggested_fix: row.get('suggested_fix') || '',
      it_notes: row.get('it_notes') || '',
      resolved_at: row.get('resolved_at') || ''
    }));

    // Clear sheet and set new headers
    await sheet.clear();
    console.log('🧹 Cleared sheet');

    await sheet.setHeaderRow(NEW_TICKETS_HEADERS);
    console.log('✅ Set new headers with reported_by column');

    // Re-add data if there was any
    if (existingData.length > 0) {
      await sheet.addRows(existingData);
      console.log(`✅ Restored ${existingData.length} tickets with new column`);
    }

    console.log('\n✨ Migration complete!');
    console.log('   New column "reported_by" added after "problem_details"');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
