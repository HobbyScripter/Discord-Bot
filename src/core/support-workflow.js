/**
 * Safe support workflow boundary.
 * AI may recommend a route; only explicit staff actions change ticket state.
 */
export class SupportWorkflow {
  constructor({ db, tickets, aiAgent, rbac, audit, events, logger = console } = {}) {
    this.db = db;
    this.tickets = tickets;
    this.aiAgent = aiAgent;
    this.rbac = rbac;
    this.audit = audit;
    this.events = events;
    this.logger = logger;
  }

  async triage(guildId, userId, ticketId) {
    if (!this.rbac.can(guildId, userId, 'ai.use')) throw new Error('Keine Berechtigung für AI-Triage.');
    const result = await this.aiAgent.analyzeTicket(guildId, userId, ticketId);
    const ticket = this.tickets.list(guildId).find(t => Number(t.id) === Number(ticketId));
    const recommendation = this.#recommend(ticket, result.content);
    const output = { ticketId: Number(ticketId), recommendation, analysis: result };
    this.audit?.recordCore(guildId, 'support.triage.completed', userId, {
      ticketId: Number(ticketId), recommendation
    });
    this.events?.publish('support.triage.completed', {
      ticketId: Number(ticketId), userId, recommendation
    }, { source: 'support', communityId: guildId });
    return output;
  }

  createFromConversation(guildId, userId, { subject = 'Support-Anfrage', content = '', supportMode = 'ai', category = 'general', priority = 'normal' } = {}) {
    if (!String(content).trim()) throw new Error('Nachrichteninhalt fehlt.');
    const ticket = this.tickets.create(guildId, {
      userId, supportMode, category, priority,
      subject: String(subject).slice(0, 200),
      summary: String(content).slice(0, 2000)
    });
    this.tickets.addMessage(guildId, ticket.id, userId, 'user', String(content).slice(0, 8000));
    this.audit?.recordCore(guildId, 'support.conversation.ticket.created', userId, { ticketId: Number(ticket.id) });
    this.events?.publish('support.conversation.ticket.created', { ticketId: Number(ticket.id), userId }, { source: 'support', communityId: guildId });
    return this.tickets.list(guildId).find(t => Number(t.id) === Number(ticket.id)) || ticket;
  }

  handoff(guildId, actorId, ticketId, { mode = 'staff', priority, reason = '' } = {}) {
    if (!this.rbac.can(guildId, actorId, 'tickets.manage')) throw new Error('Keine Berechtigung für Ticket-Handoff.');
    const allowed = new Set(['staff', 'technical', 'security']);
    const supportMode = allowed.has(String(mode)) ? String(mode) : 'staff';
    const patch = {
      support_mode: supportMode,
      status: 'waiting_staff',
      ...(priority ? { priority: String(priority) } : {})
    };
    const ticket = this.tickets.update(guildId, ticketId, patch, actorId);
    this.tickets.addMessage(guildId, ticketId, actorId, 'system', `Handoff → ${supportMode}${reason ? `: ${String(reason).slice(0, 1000)}` : ''}`);
    const result = { ticketId: Number(ticketId), supportMode, status: ticket.status, priority: ticket.priority };
    this.audit?.recordCore(guildId, 'support.handoff.completed', actorId, { ...result, reason: String(reason).slice(0, 1000) });
    this.events?.publish('support.handoff.completed', { ...result, actorId }, { source: 'support', communityId: guildId });
    return this.tickets.list(guildId).find(t => Number(t.id) === Number(ticketId)) || ticket;
  }

  #recommend(ticket, analysis = '') {
    const text = String(analysis).toLowerCase();
    if (ticket?.category === 'security' || /security|raid|hijack|permission|phishing|abuse/.test(text)) return { mode: 'security', priority: /critical|urgent|immediately/.test(text) ? 'urgent' : 'high', confidence: 'rule-assisted' };
    if (ticket?.category === 'technical' || /bug|error|stack trace|exception|crash|code/.test(text)) return { mode: 'technical', priority: ticket?.priority === 'urgent' ? 'urgent' : 'high', confidence: 'rule-assisted' };
    if (/staff|human|agent|mitarbeiter/.test(text)) return { mode: 'staff', priority: ticket?.priority || 'normal', confidence: 'rule-assisted' };
    return { mode: ticket?.support_mode || 'ai', priority: ticket?.priority || 'normal', confidence: 'default' };
  }
}
