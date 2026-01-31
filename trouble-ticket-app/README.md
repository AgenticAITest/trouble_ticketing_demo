# Trouble Ticketing AI Assistant

An AI-powered IT support chatbot that helps employees troubleshoot issues with company applications, automatically creates support tickets, and provides an IT support dashboard.

## Features

- **AI Chat Interface**: Users can describe issues and get solutions from the knowledge base
- **Automatic Ticket Creation**: When issues can't be resolved, tickets are created automatically
- **IT Support Dashboard**: View, manage, and respond to tickets
- **Admin Settings**: Configure AI provider (Anthropic, OpenAI, OpenRouter) and manage knowledge base
- **Notification System**: Bell notifications for IT responses
- **Analytics Dashboard**: Track ticket statistics

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Database**: Google Sheets
- **AI**: Multi-provider support (Anthropic Claude, OpenAI GPT, OpenRouter)

## Prerequisites

- Node.js 18+
- Google Cloud account with Sheets API enabled
- AI provider API key (Anthropic, OpenAI, or OpenRouter)

## Setup

### 1. Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable the Google Sheets API
4. Create a service account and download the JSON key
5. Create a new Google Spreadsheet with these sheets (tabs):
   - `tickets`
   - `messages`
   - `mock_logs`
   - `knowledge_base`
   - `settings`
6. Share the spreadsheet with the service account email

#### Sheet Headers

**tickets:**
```
ticket_id | session_id | status | application | problem_summary | problem_details | reported_at | updated_at | assigned_log | suggested_fix | it_notes | resolved_at
```

**messages:**
```
message_id | session_id | ticket_id | sender | content | timestamp | read
```

**mock_logs:**
```
log_id | application | error_pattern | log_content | suggested_fix
```

**knowledge_base:**
```
doc_id | application | title | content | keywords
```

**settings:**
```
setting_key | setting_value | updated_at
```

#### Initial Settings Rows

Add these rows to the `settings` sheet:

| setting_key | setting_value | updated_at |
|-------------|---------------|------------|
| api_provider | anthropic | (current date) |
| api_key | | |
| api_model | claude-sonnet-4-20250514 | |
| it_support_password_hash | (see below) | |
| admin_password_hash | (see below) | |

Generate password hashes:
```bash
node -e "console.log(require('crypto').createHash('sha256').update('your-password').digest('hex'))"
```

### 2. Backend Setup

```bash
cd server
cp .env.example .env
# Edit .env with your credentials
npm install
```

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 3. Frontend Setup

```bash
cd client
npm install
```

### 4. Environment Variables

Edit `server/.env`:

```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

GOOGLE_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

ENCRYPTION_KEY=your-32-character-key-here
```

## Running the Application

### Development

Terminal 1 (Backend):
```bash
cd server
npm run dev
```

Terminal 2 (Frontend):
```bash
cd client
npm run dev
```

Access the app at http://localhost:5173

### API Endpoints

- `GET /api/health` - Health check
- `POST /api/chat/message` - Send chat message
- `GET /api/chat/session/:id` - Get session messages
- `GET /api/tickets` - List tickets (requires auth)
- `GET /api/tickets/analytics` - Get statistics (requires auth)
- `GET /api/settings` - Get settings (requires admin auth)

## User Roles

- **User**: Access to chat interface
- **IT Support**: Access to ticket dashboard
- **Admin**: Access to settings and knowledge base management

## Project Structure

```
trouble-ticket-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Page components
│   │   ├── context/        # React context providers
│   │   └── services/       # API service layer
│   └── package.json
├── server/                 # Node.js backend
│   ├── routes/             # API routes
│   ├── services/           # Business logic
│   ├── middleware/         # Express middleware
│   └── package.json
├── knowledge-docs/         # Sample KB documents
└── README.md
```

## Next Steps (Phase 2+)

- [ ] Implement full LLM integration
- [ ] Add real-time updates with WebSockets
- [ ] Enhance ticket workflow
- [ ] Add email notifications

## License

MIT
