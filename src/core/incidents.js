const STATUSES = new Set(['open', 'investigating', 'contained', 'resolved', 'closed']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

export class IncidentManager {
  constructor(db, events, audit, logger = console) {
    this.db = db; this.events = events; this.audit = audit; this.logger = logger;
  }
  create(guildId, data = {}, actorId = null) {
    const severity = SEVERITIES.has(String(data.severity || 'medium').toLowerCase()) ? String(data.severity || 'medium').toLowerCase() : 'medium';
    const incident = this.db.createIncident(guildId, { ...data, severity });
    this.#timeline(guildId, incident.id, 'created', actorId, `Incident erstellt: ${incident.title}`);
    this.audit?.recordCore(guildId, 'incident.created', actorId, incident);
    this.events?.publish('incident.created', incident, { source: 'incident', communityId: guildId });
    return incident;
  }
  get(guildId, id) { return this.db.getIncident(guildId, id); }
  timeline(guildId, id) { return this.db.getIncidentTimeline(guildId, id); }
  list(guildId) { return this.db.listIncidents(guildId); }
  update(guildId, id, data = {}, actorId = null) {
    const before = this.get(guildId, id); if (!before) throw new Error('Incident nicht gefunden.');
    if (data.status && !STATUSES.has(data.status)) throw new Error('Ungültiger Incident-Status.');
    if (data.severity && !SEVERITIES.has(data.severity)) throw new Error('Ungültige Incident-Severity.');
    const after = this.db.updateIncident(guildId, id, data);
    const changes = Object.fromEntries(Object.keys(data).filter(k => k !== 'payload_json').map(k => [k, { before: before[k], after: after[k] }]));
    this.#timeline(guildId, id, data.status ? 'status' : 'updated', actorId, data.status ? `Status: ${before.status} → ${after.status}` : 'Incident aktualisiert', changes);
    this.audit?.recordCore(guildId, 'incident.updated', actorId, { id: Number(id), changes });
    this.events?.publish('incident.updated', after, { source: 'incident', communityId: guildId });
    return after;
  }
  assign(guildId, id, userId, actorId = null) {
    if (!userId) throw new Error('Ein Verantwortlicher ist erforderlich.');
    const incident = this.update(guildId, id, { assigned_to: String(userId), status: 'investigating' }, actorId);
    this.#timeline(guildId, id, 'assignment', actorId, `Verantwortlicher gesetzt: ${userId}`, { userId });
    this.audit?.recordCore(guildId, 'incident.assigned', actorId, { incidentId: Number(id), userId: String(userId) });
    this.events?.publish('incident.assigned', { incidentId: Number(id), userId: String(userId) }, { source: 'incident', communityId: guildId });
    return incident;
  }
  resolve(guildId, id, actorId = null, resolution = '') {
    const incident = this.get(guildId, id); if (!incident) throw new Error('Incident nicht gefunden.');
    const resolvedAt = new Date().toISOString();
    const after = this.update(guildId, id, { status: 'resolved', resolved_at: resolvedAt, resolved_by: actorId || null, summary: resolution || incident.summary }, actorId);
    this.#timeline(guildId, id, 'resolution', actorId, resolution || 'Incident gelöst.', { resolvedAt });
    this.audit?.recordCore(guildId, 'incident.resolved', actorId, { incidentId: Number(id), resolution });
    this.events?.publish('incident.resolved', after, { source: 'incident', communityId: guildId });
    return after;
  }
  close(guildId, id, actorId = null) {
    const after = this.update(guildId, id, { status: 'closed' }, actorId);
    this.#timeline(guildId, id, 'closed', actorId, 'Incident geschlossen.');
    this.audit?.recordCore(guildId, 'incident.closed', actorId, { incidentId: Number(id) });
    this.events?.publish('incident.closed', after, { source: 'incident', communityId: guildId });
    return after;
  }
  addNote(guildId, id, actorId, message, kind = 'note', payload = {}) {
    if (!this.get(guildId, id)) throw new Error('Incident nicht gefunden.');
    const item = this.#timeline(guildId, id, kind, actorId, message, payload);
    this.audit?.recordCore(guildId, 'incident.timeline.added', actorId, { incidentId: Number(id), kind });
    this.events?.publish('incident.timeline.added', item, { source: 'incident', communityId: guildId });
    return item;
  }
  #timeline(guildId, id, kind, actorId, message, payload = {}) {
    const item = this.db.addIncidentTimeline(guildId, id, { kind, actorId, message, payload });
    this.events?.publish('incident.timeline.added', item, { source: 'incident', communityId: guildId });
    return item;
  }
}
