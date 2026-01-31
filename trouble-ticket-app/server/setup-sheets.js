/**
 * Setup script to initialize Google Sheets with headers and sample data
 * Run with: node setup-sheets.js
 */
require('dotenv').config();

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Sheet configurations with headers
const SHEETS_CONFIG = {
  tickets: [
    'ticket_id',
    'session_id',
    'status',
    'application',
    'problem_summary',
    'problem_details',
    'reported_by',
    'reported_at',
    'updated_at',
    'assigned_log',
    'suggested_fix',
    'it_notes',
    'resolved_at'
  ],
  message: [
    'message_id',
    'session_id',
    'ticket_id',
    'sender',
    'content',
    'timestamp',
    'read'
  ],
  mock_logs: [
    'log_id',
    'application',
    'error_pattern',
    'log_content',
    'suggested_fix'
  ],
  knowledge_base: [
    'doc_id',
    'application',
    'title',
    'content',
    'keywords'
  ],
  settings: [
    'setting_key',
    'setting_value',
    'updated_at'
  ]
};

// Sample mock logs data
const MOCK_LOGS_DATA = [
  {
    log_id: 'log_01',
    application: 'Attendance',
    error_pattern: 'gps, location, coordinates',
    log_content: '[2024-01-15 09:23:11] ERROR: GPS_LOCATION_FAILED\n[2024-01-15 09:23:11] DEBUG: LocationManager.getLastKnownLocation returned null\n[2024-01-15 09:23:12] WARN: Fallback to network location failed\n[2024-01-15 09:23:12] ERROR: Unable to determine user coordinates',
    suggested_fix: 'GPS permission issue. Guide user to: Settings → Apps → Attendance → Permissions → Enable "Location" with "Always Allow" option. If issue persists, clear app cache.'
  },
  {
    log_id: 'log_02',
    application: 'Attendance',
    error_pattern: 'login, auth, timeout, ldap',
    log_content: '[2024-01-15 10:45:22] INFO: Login attempt for user_id=3847\n[2024-01-15 10:45:22] DEBUG: Connecting to LDAP server\n[2024-01-15 10:45:52] ERROR: LDAP_CONNECTION_TIMEOUT after 30000ms\n[2024-01-15 10:45:52] ERROR: AUTH_FAILED: Unable to verify creds',
    suggested_fix: 'LDAP authentication timeout. Check if user is connected to corporate network (VPN if remote). If on VPN, try disconnecting and reconnecting. Escalate to IT if persists.'
  },
  {
    log_id: 'log_03',
    application: 'Delivery',
    error_pattern: 'sync, update, status, refresh',
    log_content: '[2024-01-15 14:22:33] INFO: Sync initiated for order_id=ORD-98234\n[2024-01-15 14:22:33] WARN: Backend response delayed >5000ms\n[2024-01-15 14:22:38] ERROR: SYNC_TIMEOUT: Status update failed\n[2024-01-15 14:22:38] INFO: Queued for retry in 15 minutes',
    suggested_fix: 'Backend sync delay. The delivery status sync runs every 15 minutes. User should pull-to-refresh. If status unchanged after 30 minutes, check with warehouse team for physical confirmation of dispatch.'
  },
  {
    log_id: 'log_04',
    application: 'Delivery',
    error_pattern: 'crash, photo, upload, memory',
    log_content: '[2024-01-15 16:05:11] INFO: Camera intent launched\n[2024-01-15 16:05:15] DEBUG: Photo captured, size: 4.2MB\n[2024-01-15 16:05:16] ERROR: OutOfMemoryError during image compress\n[2024-01-15 16:05:16] FATAL: Application crashed - heap exhausted',
    suggested_fix: 'Memory issue when processing large photos. User should: 1) Close other apps before uploading 2) Reduce camera resolution in phone settings 3) Clear app cache.'
  },
  {
    log_id: 'log_05',
    application: 'Inventory',
    error_pattern: 'barcode, scan, camera, read',
    log_content: '[2024-01-15 11:30:45] INFO: Barcode scan initiated\n[2024-01-15 11:30:46] WARN: AutoFocus failed, retrying...\n[2024-01-15 11:30:48] ERROR: BARCODE_READ_FAILED after 3 attempts\n[2024-01-15 11:30:48] DEBUG: Camera focus distance: infinity',
    suggested_fix: 'Camera focus issue for barcode scanning. User should: 1) Clean camera lens 2) Ensure adequate lighting 3) Hold phone 6-8 inches from barcode 4) Try manual entry if scan continues to fail.'
  }
];

// Sample knowledge base data
const KNOWLEDGE_BASE_DATA = [
  {
    doc_id: 'kb_01',
    application: 'Attendance',
    title: 'GPS/Location Troubleshooting',
    content: `# GPS/Location Issues

## Problem: "GPS coordinates not found"
**Solution Steps:**
1. Open phone Settings → Apps → Attendance App
2. Tap Permissions → Location
3. Select "Allow all the time"
4. Enable "Use precise location" if available
5. Restart the Attendance app
6. If indoors, move near a window

## Problem: Check-in location shows wrong address
**Solution Steps:**
1. Close the Attendance app completely
2. Open Google Maps, wait for blue dot to stabilize
3. Walk around briefly to refresh GPS
4. Return to Attendance app and try again`,
    keywords: 'gps, location, coordinates, check-in, map, position'
  },
  {
    doc_id: 'kb_02',
    application: 'Attendance',
    title: 'Login Issues',
    content: `# Login Issues

## Problem: "Invalid credentials" error
**Solution Steps:**
1. Verify Caps Lock is off
2. Try logging into the web portal to confirm password works
3. If password was recently changed, use the new password
4. After 5 failed attempts, account locks for 15 minutes

## Problem: "Session expired" keeps appearing
**Solution Steps:**
1. Disable battery optimization for Attendance app
2. Settings → Apps → Attendance → Battery → Don't optimize
3. Ensure stable internet connection`,
    keywords: 'login, password, credentials, session, expired, auth'
  },
  {
    doc_id: 'kb_03',
    application: 'Delivery',
    title: 'Order Tracking FAQ',
    content: `# Order Tracking FAQ

## Why hasn't my delivery status updated?
The delivery status syncs every 15 minutes. If not updated:
1. Pull down to refresh the tracking screen
2. Wait at least 30 minutes before reporting
3. During peak hours, updates may be delayed up to 1 hour

## What do the delivery statuses mean?
- **Order Placed:** We received your order
- **Processing:** Warehouse is preparing items
- **Dispatched:** Driver has picked up package
- **Out for Delivery:** Driver is en route
- **Delivered:** Package was dropped off`,
    keywords: 'delivery, tracking, status, order, update, refresh'
  }
];

// Initial settings
const SETTINGS_DATA = [
  { setting_key: 'api_provider', setting_value: 'anthropic', updated_at: new Date().toISOString() },
  { setting_key: 'api_key', setting_value: '', updated_at: new Date().toISOString() },
  { setting_key: 'api_model', setting_value: 'claude-sonnet-4-20250514', updated_at: new Date().toISOString() },
  { setting_key: 'it_support_password_hash', setting_value: '5e884898da28047d91ef76adafd3a4e8979cb1b1e739f2a2e7a48df8d1c7fd9d', updated_at: new Date().toISOString() }, // "password"
  { setting_key: 'admin_password_hash', setting_value: '5e884898da28047d91ef76adafd3a4e8979cb1b1e739f2a2e7a48df8d1c7fd9d', updated_at: new Date().toISOString() } // "password"
];

async function setup() {
  console.log('🚀 Starting Google Sheets setup...\n');

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

    // Setup each sheet
    for (const [sheetName, headers] of Object.entries(SHEETS_CONFIG)) {
      console.log(`Setting up "${sheetName}" sheet...`);

      const sheet = doc.sheetsByTitle[sheetName];
      if (!sheet) {
        console.error(`  ❌ Sheet "${sheetName}" not found! Please create it first.`);
        continue;
      }

      // Set headers
      await sheet.setHeaderRow(headers);
      console.log(`  ✅ Headers set: ${headers.join(', ')}`);

      // Add sample data based on sheet type
      if (sheetName === 'mock_logs') {
        await sheet.addRows(MOCK_LOGS_DATA);
        console.log(`  ✅ Added ${MOCK_LOGS_DATA.length} sample mock logs`);
      } else if (sheetName === 'knowledge_base') {
        await sheet.addRows(KNOWLEDGE_BASE_DATA);
        console.log(`  ✅ Added ${KNOWLEDGE_BASE_DATA.length} sample KB documents`);
      } else if (sheetName === 'settings') {
        await sheet.addRows(SETTINGS_DATA);
        console.log(`  ✅ Added initial settings (default password: "password")`);
      }

      console.log('');
    }

    console.log('✨ Setup complete!\n');
    console.log('📝 Default login credentials:');
    console.log('   IT Support: password');
    console.log('   Admin: password');
    console.log('\n⚠️  Change these passwords in the settings sheet before production use!');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }
}

setup();
