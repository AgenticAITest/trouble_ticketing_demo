import React, { useState, useEffect } from 'react';
import { ticketApi } from '../services/api';
import StatusBadge from '../components/shared/StatusBadge';
import './ITSupport.css';

// Canned responses for quick replies
const CANNED_RESPONSES = [
  {
    id: 'gps_fix',
    label: 'GPS Permission Fix',
    text: 'Please try these steps:\n1. Go to Settings → Apps → Attendance\n2. Tap Permissions → Location\n3. Select "Allow all the time"\n4. Restart the app and try again'
  },
  {
    id: 'clear_cache',
    label: 'Clear Cache',
    text: 'Please clear the app cache:\n1. Go to Settings → Apps → [App Name]\n2. Tap Storage\n3. Tap "Clear Cache" (not Clear Data)\n4. Restart the app'
  },
  {
    id: 'vpn_reconnect',
    label: 'VPN Reconnect',
    text: 'Please try reconnecting to VPN:\n1. Disconnect from the current VPN session\n2. Wait 10 seconds\n3. Reconnect to the corporate VPN\n4. Try the app again once connected'
  }
];

const ITSupport = () => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filter, setFilter] = useState('open');
  const [clarificationText, setClarificationText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  useEffect(() => {
    loadTickets();
    const interval = setInterval(loadTickets, 15000);
    return () => clearInterval(interval);
  }, [filter]);

  const loadTickets = async () => {
    try {
      const data = await ticketApi.getTickets(filter === 'all' ? null : filter);
      setTickets(data);
    } catch (error) {
      console.error('Failed to load tickets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTicketSelect = async (ticket) => {
    try {
      setAnalysis(null); // Clear previous analysis
      const fullTicket = await ticketApi.getTicket(ticket.ticket_id);
      setSelectedTicket(fullTicket);
    } catch (error) {
      console.error('Failed to load ticket details:', error);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedTicket) return;

    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const result = await ticketApi.analyzeTicket(selectedTicket.ticket_id);
      setAnalysis(result);
    } catch (error) {
      console.error('Failed to analyze ticket:', error);
      setAnalysis({ error: 'Failed to analyze ticket. Please try again.' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStatusChange = async (ticketId, newStatus) => {
    try {
      await ticketApi.updateTicket(ticketId, { status: newStatus });
      loadTickets();
      if (selectedTicket?.ticket_id === ticketId) {
        setSelectedTicket({ ...selectedTicket, status: newStatus });
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleAskClarification = async () => {
    if (!clarificationText.trim() || !selectedTicket) return;

    setIsSending(true);
    try {
      await ticketApi.askClarification(selectedTicket.ticket_id, clarificationText);
      setClarificationText('');
      loadTickets();
      const fullTicket = await ticketApi.getTicket(selectedTicket.ticket_id);
      setSelectedTicket(fullTicket);
    } catch (error) {
      console.error('Failed to send clarification:', error);
    } finally {
      setIsSending(false);
    }
  };

  const insertCannedResponse = (text) => {
    setClarificationText(prev => prev + (prev ? '\n\n' : '') + text);
  };

  return (
    <div className="it-support-container">
      <aside className="ticket-sidebar">
        <h2>Support Tickets</h2>

        <div className="filter-tabs">
          {['open', 'waiting_clarification', 'waiting_confirmation', 'closed', 'all'].map(status => (
            <button
              key={status}
              className={filter === status ? 'active' : ''}
              onClick={() => setFilter(status)}
            >
              {status === 'all' ? 'All' :
               status === 'open' ? 'Open' :
               status === 'waiting_clarification' ? 'Waiting' :
               status === 'waiting_confirmation' ? 'Pending' : 'Closed'}
            </button>
          ))}
        </div>

        <div className="ticket-list">
          {isLoading ? (
            <div className="loading">Loading tickets...</div>
          ) : tickets.length === 0 ? (
            <div className="empty">No tickets found</div>
          ) : (
            tickets.map(ticket => (
              <div
                key={ticket.ticket_id}
                className={`ticket-item ${selectedTicket?.ticket_id === ticket.ticket_id ? 'selected' : ''}`}
                onClick={() => handleTicketSelect(ticket)}
              >
                <div className="ticket-header">
                  <span className="ticket-id">{ticket.ticket_id}</span>
                  <StatusBadge status={ticket.status} />
                </div>
                <div className="ticket-app">{ticket.application}</div>
                <div className="ticket-summary">{ticket.problem_summary}</div>
                <div className="ticket-time">
                  {new Date(ticket.reported_at).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      <main className="ticket-detail-area">
        {selectedTicket ? (
          <div className="ticket-detail">
            <div className="detail-header">
              <h2>{selectedTicket.ticket_id}</h2>
              <StatusBadge status={selectedTicket.status} />
            </div>

            <div className="detail-section">
              <h3>Application</h3>
              <p>{selectedTicket.application}</p>
            </div>

            <div className="detail-section">
              <h3>Problem Summary</h3>
              <p>{selectedTicket.problem_summary}</p>
            </div>

            <div className="detail-section">
              <h3>Problem Details</h3>
              <p className="problem-details">{selectedTicket.problem_details}</p>
            </div>

            {selectedTicket.reported_by && (
              <div className="detail-section">
                <h3>Reported By</h3>
                <p>{selectedTicket.reported_by}</p>
              </div>
            )}

            <div className="detail-section log-section">
              <div className="section-header">
                <h3>System Logs & Analysis</h3>
                <button
                  className="btn-analyze"
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? 'Analyzing...' : '🤖 Analyze with AI'}
                </button>
              </div>

              {selectedTicket.mockLog ? (
                <>
                  <div className="log-header">
                    <span className="log-id">Log ID: {selectedTicket.mockLog.log_id}</span>
                    <span className="log-pattern">Pattern: {selectedTicket.mockLog.error_pattern}</span>
                  </div>
                  <pre className="log-content">{selectedTicket.mockLog.log_content}</pre>
                  <div className="suggested-fix">
                    <h4>Knowledge Base Suggestion</h4>
                    <p>{selectedTicket.mockLog.suggested_fix}</p>
                  </div>
                </>
              ) : (
                <div className="no-logs">
                  <p>No matching logs found in the system.</p>
                  <p className="hint">Click "Analyze with AI" to get insights based on the problem description.</p>
                </div>
              )}

              {analysis && (
                <div className={`ai-analysis ${analysis.error ? 'error' : ''}`}>
                  <h4>🤖 AI Analysis</h4>
                  {analysis.error ? (
                    <p className="error-text">{analysis.error}</p>
                  ) : (
                    <div className="analysis-content">
                      <pre>{analysis.analysis}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedTicket.messages && selectedTicket.messages.length > 0 && (
              <div className="detail-section">
                <h3>Conversation History</h3>
                <div className="conversation-history">
                  {selectedTicket.messages.slice(-10).map((msg, index) => (
                    <div key={index} className={`history-msg ${msg.sender}`}>
                      <span className="sender">
                        {msg.sender === 'user' ? 'User' : msg.sender === 'ai' ? 'AI' : 'IT Support'}:
                      </span>
                      <span className="content">{msg.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="detail-section">
              <h3>Actions</h3>
              <div className="action-buttons">
                <button
                  className="btn-secondary"
                  onClick={() => handleStatusChange(selectedTicket.ticket_id, 'waiting_confirmation')}
                  disabled={selectedTicket.status === 'closed'}
                >
                  Request Confirmation
                </button>
                <button
                  className="btn-primary"
                  onClick={() => handleStatusChange(selectedTicket.ticket_id, 'closed')}
                  disabled={selectedTicket.status === 'closed'}
                >
                  Close Ticket
                </button>
              </div>
            </div>

            <div className="detail-section">
              <h3>Ask Clarification</h3>
              <div className="canned-responses">
                {CANNED_RESPONSES.map(response => (
                  <button
                    key={response.id}
                    className="canned-btn"
                    onClick={() => insertCannedResponse(response.text)}
                  >
                    + {response.label}
                  </button>
                ))}
              </div>
              <textarea
                value={clarificationText}
                onChange={(e) => setClarificationText(e.target.value)}
                placeholder="Type your question for the user..."
                rows={4}
              />
              <button
                className="btn-primary"
                onClick={handleAskClarification}
                disabled={!clarificationText.trim() || isSending}
              >
                {isSending ? 'Sending...' : 'Send to User'}
              </button>
            </div>
          </div>
        ) : (
          <div className="no-selection">
            <p>Select a ticket to view details</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ITSupport;
