/**
 * Ticket orchestration layer. Database owns persistence; this service owns
 * workflow rules and live events. It never executes destructive Discord actions.
 */
export class TicketManager {
  constructor(database, eventBus, logger = console) {
    this.db = database;
    this.events = eventBus;
    this.logger = logger;
  }

  list(guildId, status = null) {
    return this.db.listTickets(guildId, status);
  }

  staff(guildId) {
    const users = this.db.listUsers(guildId, 1000).filter((u) => u.staff);
    const status = new Map(this.db.listStaffStatus(guildId).map((s) => [s.user_id, s]));
    return users.map((u) => ({
      userId: u.user_id,
      username: u.username,
      displayName: u.display_name,
      status: status.get(u.user_id)?.status || 'offline',
      note: status.get(u.user_id)?.note || null,
      updatedAt: status.get(u.user_id)?.updated_at || null,
    }));
  }

  availableStaff(guildId) {
    return this.staff(guildId).filter((s) => s.status === 'available');
  }

  chooseAssignee(guildId) {
    const available = this.availableStaff(guildId);
    if (!available.length) return null;
    const open = this.list(guildId).filter((t) => ['open', 'in_progress', 'waiting_staff'].includes(t.status));
    const load = new Map(available.map((s) => [s.userId, 0]));
    for (const ticket of open) if (ticket.assigned_to && load.has(ticket.assigned_to)) load.set(ticket.assigned_to, load.get(ticket.assigned_to) + 1);
    return [...available].sort((a, b) => (load.get(a.userId) - load.get(b.userId)) || String(a.userId).localeCompare(String(b.userId)))[0] || null;
  }

  create(guildId, data = {}) {
    if (!data.userId) throw new Error('userId fehlt.');
    const supportMode = ['ai', 'staff', 'technical', 'security'].includes(data.supportMode) ? data.supportMode : 'ai';
    let assignedTo = data.assignedTo || null;
    let status = 'open';
    if (supportMode === 'staff' || supportMode === 'technical' || supportMode === 'security') {
      assignedTo ||= this.chooseAssignee(guildId)?.userId || null;
      status = assignedTo ? 'in_progress' : 'waiting_staff';
    }
    const id = this.db.createTicket(guildId, { ...data, supportMode, assignedTo, status });
    this.db.addTicketMessage(guildId, id, data.userId, 'system', `Ticket erstellt (${supportMode}).`);
    const ticket = this.list(guildId).find((t) => Number(t.id) === id) || { id };
    this.events?.publish?.('ticket.created', ticket, { source: 'tickets', communityId: guildId });
    return ticket;
  }

  update(guildId, id, data = {}, actorId = null) {
    const before = this.list(guildId).find((t) => Number(t.id) === Number(id));
    if (!before) throw new Error('Ticket nicht gefunden.');
    const allowed = ['status', 'support_mode', 'category', 'assigned_to', 'priority', 'subject', 'summary', 'channel_id'];
    const patch = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.includes(key)));
    if (patch.status && ['resolved','closed'].includes(patch.status) && !before.resolved_at) patch.resolved_at = new Date().toISOString();
    if (patch.status && !['resolved','closed'].includes(patch.status)) patch.resolved_at = null;
    if (patch.status && !['open', 'in_progress', 'waiting_user', 'waiting_staff', 'escalated', 'resolved', 'closed'].includes(patch.status)) throw new Error('Ungültiger Ticket-Status.');
    if (patch.assigned_to === '') patch.assigned_to = null;
    this.db.updateTicket(guildId, id, patch);
    const after = this.list(guildId).find((t) => Number(t.id) === Number(id));
    this.db.addAudit(guildId, 'ticket.updated', actorId, { ticketId: Number(id), changes: patch });
    this.events?.publish?.('ticket.updated', after, { source: 'tickets', communityId: guildId });
    return after;
  }

  addMessage(guildId, id, userId, role, content) {
    const ticket = this.list(guildId).find((t) => Number(t.id) === Number(id));
    if (!ticket) throw new Error('Ticket nicht gefunden.');
    this.db.addTicketMessage(guildId, id, userId, role, content);
    const result = this.db.listTicketMessages(guildId, id);
    this.events?.publish?.('ticket.message.added', { ticketId: Number(id), userId, role }, { source: 'tickets', communityId: guildId });
    return result;
  }

  queue(guildId) {
    const tickets = this.list(guildId);
    return {
      open: tickets.filter((t) => t.status === 'open').length,
      waitingStaff: tickets.filter((t) => t.status === 'waiting_staff').length,
      inProgress: tickets.filter((t) => t.status === 'in_progress').length,
      escalated: tickets.filter((t) => t.status === 'escalated').length,
      unresolved: tickets.filter((t) => !['resolved', 'closed'].includes(t.status)).length,
      availableStaff: this.availableStaff(guildId).length,
    };
  }
}
