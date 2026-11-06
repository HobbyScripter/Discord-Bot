/**
 * Cross-module orchestration boundary.
 * Keeps Security -> Incident -> Ticket -> AI workflows out of individual modules.
 * Only non-destructive workflow actions are automated here.
 */
export class CoreOrchestrator {
  constructor({ events, incidents, tickets, audit, logger = console } = {}) {
    this.events = events;
    this.incidents = incidents;
    this.tickets = tickets;
    this.audit = audit;
    this.logger = logger;
    this.unsubscribe = events?.subscribe((event) => this.#handle(event));
  }

  close() { this.unsubscribe?.(); this.unsubscribe = null; }

  async #handle(event) {
    try {
      if (event.type === 'incident.created' && event.payload?.type === 'security') {
        await this.#securityIncidentTicket(event);
      }
      if (event.type === 'ticket.updated' && ['escalated'].includes(event.payload?.status)) {
        await this.#ticketEscalatedIncident(event);
      }
    } catch (error) {
      this.logger.warn?.('⚠ Core-Orchestrator fehlgeschlagen:', error?.stack || error);
      try {
        this.audit?.recordCore(event.communityId, 'orchestration.failed', null, {
          eventType: event.type, error: error?.message || String(error)
        });
      } catch {}
    }
  }

  async #securityIncidentTicket(event) {
    const incident = event.payload || {};
    if (!['high', 'critical'].includes(String(incident.severity).toLowerCase())) return;
    const guildId = event.communityId;
    const existing = this.tickets.list(guildId).find((ticket) =>
      ticket.category === 'security' &&
      ['open', 'in_progress', 'waiting_staff', 'escalated'].includes(ticket.status) &&
      String(ticket.summary || '').includes(`incident:${incident.id}`)
    );
    if (existing) return;
    this.tickets.create(guildId, {
      userId: 'system',
      supportMode: 'security',
      category: 'security',
      priority: String(incident.severity).toLowerCase() === 'critical' ? 'urgent' : 'high',
      subject: `Security Incident #${incident.id}`,
      summary: `incident:${incident.id} · ${incident.summary || incident.title}`
    });
    this.audit?.recordCore(guildId, 'security.incident.ticket.created', null, { incidentId: incident.id });
  }

  async #ticketEscalatedIncident(event) {
    const ticket = event.payload || {};
    const guildId = event.communityId;
    const existing = this.incidents.list(guildId).find((incident) =>
      incident.type === 'support' &&
      ['open', 'investigating'].includes(incident.status) &&
      String(incident.summary || '').includes(`ticket:${ticket.id}`)
    );
    if (existing) return;
    this.incidents.create(guildId, {
      title: `Ticket #${ticket.id} eskaliert`,
      severity: ticket.priority === 'urgent' ? 'high' : 'medium',
      type: 'support',
      summary: `ticket:${ticket.id} · ${ticket.subject || 'Support-Ticket benötigt weitere Bearbeitung'}`,
      payload: { ticketId: ticket.id, assignedTo: ticket.assigned_to || null }
    });
  }
}
