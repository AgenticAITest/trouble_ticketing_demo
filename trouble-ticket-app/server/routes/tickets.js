/**
 * Ticket API routes
 * Handles IT support ticket operations
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireRole } = require('../middleware/auth');
const { ticketUpdateRules, clarificationRules, validateRequest } = require('../middleware/validate');
const googleSheets = require('../services/googleSheets');
const llmService = require('../services/llmService');
const { getITSupportPrompt } = require('../prompts/systemPrompt');

// Apply auth to all ticket routes
router.use(requireRole('it_support'));

/**
 * GET /api/tickets
 * Get all tickets (optionally filtered by status)
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const tickets = status
      ? await googleSheets.getTicketsByStatus(status)
      : await googleSheets.getAllTickets();
    res.json(tickets);
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

/**
 * GET /api/tickets/analytics
 * Get ticket statistics for dashboard
 */
router.get('/analytics', async (req, res) => {
  try {
    const tickets = await googleSheets.getAllTickets();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Tickets created today
    const ticketsToday = tickets.filter(t =>
      new Date(t.reported_at) >= today
    ).length;

    // Open tickets
    const ticketsOpen = tickets.filter(t =>
      ['open', 'waiting_clarification', 'waiting_confirmation'].includes(t.status)
    ).length;

    // Average resolution time (for closed tickets)
    const closedTickets = tickets.filter(t => t.status === 'closed' && t.resolved_at);
    let avgResolutionHours = 0;
    if (closedTickets.length > 0) {
      const totalHours = closedTickets.reduce((sum, t) => {
        const reported = new Date(t.reported_at);
        const resolved = new Date(t.resolved_at);
        return sum + (resolved - reported) / (1000 * 60 * 60);
      }, 0);
      avgResolutionHours = totalHours / closedTickets.length;
    }

    // Most common application
    const appCounts = {};
    tickets.forEach(t => {
      if (t.application) {
        appCounts[t.application] = (appCounts[t.application] || 0) + 1;
      }
    });
    const topApp = Object.entries(appCounts)
      .sort((a, b) => b[1] - a[1])[0];
    const topApplication = topApp
      ? { name: topApp[0], percentage: Math.round((topApp[1] / tickets.length) * 100) }
      : { name: 'N/A', percentage: 0 };

    res.json({
      ticketsToday,
      ticketsOpen,
      avgResolutionHours,
      topApplication,
      totalTickets: tickets.length,
      closedTickets: closedTickets.length
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/tickets/:id
 * Get a single ticket by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const ticket = await googleSheets.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Fetch the associated mock log if assigned
    let mockLog = null;
    if (ticket.assigned_log) {
      mockLog = await googleSheets.getMockLog(ticket.assigned_log);
    }

    // If no log assigned, try to find a matching one based on application and problem details
    if (!mockLog && ticket.application) {
      // Extract keywords from problem summary and details
      const keywords = `${ticket.problem_summary} ${ticket.problem_details}`.toLowerCase();
      mockLog = await googleSheets.findMatchingMockLog(ticket.application, keywords);

      // If found, update the ticket with the assigned log for future reference
      if (mockLog) {
        await googleSheets.updateTicket(ticket.ticket_id, {
          assigned_log: mockLog.log_id,
          updated_at: new Date().toISOString()
        });
      }
    }

    // Fetch conversation history
    const messages = await googleSheets.getMessagesBySession(ticket.session_id);

    res.json({
      ...ticket,
      mockLog,
      messages
    });
  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

/**
 * PATCH /api/tickets/:id
 * Update a ticket
 */
router.patch('/:id', ticketUpdateRules, validateRequest, async (req, res) => {
  try {
    const { status, it_notes } = req.body;
    const updates = {
      updated_at: new Date().toISOString()
    };

    if (status) updates.status = status;
    if (it_notes !== undefined) updates.it_notes = it_notes;
    if (status === 'closed') updates.resolved_at = new Date().toISOString();

    const updated = await googleSheets.updateTicket(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Update ticket error:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

/**
 * POST /api/tickets/:id/clarify
 * Send a clarification question to the user
 */
router.post('/:id/clarify', clarificationRules, validateRequest, async (req, res) => {
  try {
    const { question } = req.body;
    const ticket = await googleSheets.getTicketById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Add IT support message to the session
    await googleSheets.addMessage({
      message_id: uuidv4(),
      session_id: ticket.session_id,
      ticket_id: ticket.ticket_id,
      sender: 'it_support',
      content: question,
      timestamp: new Date().toISOString(),
      read: 'FALSE'  // Will trigger notification bell
    });

    // Update ticket status
    await googleSheets.updateTicket(ticket.ticket_id, {
      status: 'waiting_clarification',
      updated_at: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Clarify error:', error);
    res.status(500).json({ error: 'Failed to send clarification' });
  }
});

/**
 * POST /api/tickets/:id/analyze
 * Get AI analysis of ticket and associated logs
 */
router.post('/:id/analyze', async (req, res) => {
  try {
    const ticket = await googleSheets.getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Get the associated log
    let mockLog = null;
    if (ticket.assigned_log) {
      mockLog = await googleSheets.getMockLog(ticket.assigned_log);
    }

    // If no log assigned, try to find one
    if (!mockLog && ticket.application) {
      const keywords = `${ticket.problem_summary} ${ticket.problem_details}`.toLowerCase();
      mockLog = await googleSheets.findMatchingMockLog(ticket.application, keywords);
    }

    // Build analysis prompt
    const analysisPrompt = `You are an IT support analyst. Analyze this support ticket and provide actionable insights.

## Ticket Information
- **Ticket ID:** ${ticket.ticket_id}
- **Application:** ${ticket.application}
- **Reported By:** ${ticket.reported_by || 'Unknown'}
- **Reported At:** ${ticket.reported_at}
- **Problem Summary:** ${ticket.problem_summary}
- **Problem Details:** ${ticket.problem_details}

## System Logs
${mockLog ? mockLog.log_content : 'No matching logs found for this issue.'}

## Your Analysis Task
Provide a structured analysis with:

1. **Root Cause Analysis:** What is likely causing this issue based on the logs and problem description?

2. **Severity Assessment:** Is this Critical / High / Medium / Low? Why?

3. **Recommended Solution:** Step-by-step fix for IT support to apply or communicate to user.

4. **Prevention:** How can this issue be prevented in the future?

${mockLog?.suggested_fix ? `\n**Reference Fix from Knowledge Base:** ${mockLog.suggested_fix}` : ''}

Be concise and actionable. Focus on practical steps.`;

    // Get AI analysis
    const analysis = await llmService.sendMessage(
      analysisPrompt,
      [], // No conversation history needed
      [], // No KB needed - we included relevant info in prompt
      'You are an expert IT support analyst. Provide clear, actionable analysis.'
    );

    res.json({
      success: true,
      analysis,
      hasLogs: !!mockLog,
      logId: mockLog?.log_id || null
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze ticket', details: error.message });
  }
});

module.exports = router;
