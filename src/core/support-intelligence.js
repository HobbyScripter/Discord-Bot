/**
 * Cross-domain Support Intelligence boundary.
 * Connects Ticket -> AI -> Knowledge -> Incident without allowing AI to execute
 * destructive Discord actions. Every write remains auditable and RBAC-gated.
 */
export class SupportIntelligence {
  constructor({ db, tickets, incidents, supportWorkflow, aiAgent, rbac, events, audit, logger = console } = {}) {
    this.db = db;
    this.tickets = tickets;
    this.incidents = incidents;
    this.supportWorkflow = supportWorkflow;
    this.aiAgent = aiAgent;
    this.rbac = rbac;
    this.events = events;
    this.audit = audit;
    this.logger = logger;
  }

  linkTicketIncident(guildId, ticketId, incidentId, actorId = null) {
    if (actorId && !this.rbac.can(guildId, actorId, 'tickets.manage')) throw new Error('Keine Berechtigung für Ticket-Incident-Verknüpfung.');
    const result = this.db.linkTicketIncident(guildId, Number(ticketId), Number(incidentId), actorId);
    this.audit?.recordCore(guildId, 'support.ticket.incident.linked', actorId, { ticketId: Number(ticketId), incidentId: Number(incidentId) });
    this.events?.publish('support.ticket.incident.linked', result, { source: 'support', communityId: guildId });
    return result;
  }

  async triageAndRoute(guildId, userId, ticketId) {
    if (!this.rbac.can(guildId, userId, 'ai.use')) throw new Error('Keine Berechtigung für AI-Triage.');
    const triage = await this.supportWorkflow.triage(guildId, userId, ticketId);
    const recommendation = triage.recommendation;
    const shouldIncident = recommendation.mode === 'security' && ['high', 'urgent'].includes(String(recommendation.priority).toLowerCase());
    let incident = null;
    if (shouldIncident) {
      const ticket = this.tickets.list(guildId).find(t => Number(t.id) === Number(ticketId));
      incident = this.incidents.create(guildId, {
        title: `Support Security Escalation #${ticketId}`,
        severity: recommendation.priority === 'urgent' ? 'critical' : 'high',
        type: 'security',
        summary: `ticket:${ticketId} · ${ticket?.subject || ticket?.summary || 'Security-Support-Ticket'}`,
        payload: { ticketId: Number(ticketId), recommendation }
      }, userId);
      this.linkTicketIncident(guildId, ticketId, incident.id, userId);
      this.tickets.update(guildId, ticketId, { support_mode: 'security', status: 'escalated', priority: recommendation.priority }, userId);
    }
    const result = { ...triage, routed: Boolean(incident), incident: incident ? { id: incident.id, severity: incident.severity, type: incident.type } : null };
    this.events?.publish('support.triage.routed', result, { source: 'support', communityId: guildId });
    return result;
  }

  evaluateSLA(guildId) {
    const now = Date.now();
    const sla = new Map(this.db.supportSLA(guildId).filter(x => x.enabled !== false).map(x => [x.priority, x]));
    const tickets = this.tickets.list(guildId).filter(t => !['resolved', 'closed'].includes(t.status));
    const breaches = [];
    for (const ticket of tickets) {
      const policy = sla.get(ticket.priority) || sla.get('normal');
      if (!policy) continue;
      const created = Date.parse(ticket.created_at || '') || now;
      const updated = Date.parse(ticket.updated_at || '') || created;
      const ageMinutes = Math.max(0, Math.floor((now - created) / 60000));
      const firstResponseDue = created + Number(policy.first_response_minutes || 0) * 60000;
      const resolutionDue = created + Number(policy.resolution_minutes || 0) * 60000;
      const hasStaffResponse = this.db.listTicketMessages(guildId, Number(ticket.id)).some(m => ['staff', 'agent', 'assistant'].includes(String(m.role).toLowerCase()) && String(m.user_id || '') !== String(ticket.user_id || ''));
      const firstResponseBreached = !hasStaffResponse && now > firstResponseDue;
      const resolutionBreached = now > resolutionDue;
      if (!firstResponseBreached && !resolutionBreached) continue;
      const breach = { ticketId: Number(ticket.id), priority: ticket.priority, ageMinutes, firstResponseBreached, resolutionBreached, firstResponseDue: new Date(firstResponseDue).toISOString(), resolutionDue: new Date(resolutionDue).toISOString(), updatedAt: new Date(updated).toISOString() };
      breaches.push(breach);
      this.events?.publish('support.sla.breached', breach, { source: 'support', communityId: guildId });
    }
    return { checked: tickets.length, breaches, evaluatedAt: new Date(now).toISOString() };
  }

  caseOverview(guildId, ticketId) {
    const ticket = this.tickets.list(guildId).find(t => Number(t.id) === Number(ticketId));
    if (!ticket) return null;
    const links = this.db.listTicketIncidents(guildId, Number(ticketId));
    const analyses = this.db.listTicketAIAnalyses(guildId, Number(ticketId));
    const messages = this.db.listTicketMessages(guildId, Number(ticketId));
    const knowledge = this.db.searchKnowledgeRanked(guildId, `${ticket.subject || ''} ${ticket.summary || ''}`.trim(), 8);
    return { ticket, messages, incidents: links, analyses, knowledge, generatedAt: new Date().toISOString() };
  }
}
