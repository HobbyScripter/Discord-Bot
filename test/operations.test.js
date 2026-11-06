import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationsManager } from '../src/core/operations.js';

function makeDb() {
  return {
    securitySnapshot: () => ({ score: 12, level: 'watch', signals: [], metrics: {} }),
    listIncidents: () => [{ status: 'open', severity: 'high' }, { status: 'closed', severity: 'critical' }],
    listStaffStatus: () => [{ user_id: 'u1', status: 'available' }, { user_id: 'u2', status: 'busy' }, { user_id: 'u3', status: 'dnd' }],
    listToolConfirmations: () => [{ expires_at: new Date(Date.now() + 60000).toISOString() }],
    listSecurityActionConfirmations: () => [{ expires_at: new Date(Date.now() + 60000).toISOString() }],
    listTickets: () => [{ assigned_to: 'u2', status: 'open' }, { assigned_to: 'u2', status: 'closed' }],
    activitySummary: () => ({ summary: { messages: 5, uniqueUsers: 2 } }),
    activityTrend: () => ({ windowMinutes: 1440, bucketMinutes: 60, buckets: [] }),
    activityLeaderboard: () => [],
    supportMetrics: () => ({ open: 2, resolved: 1, firstResponseBreaches: 0, resolutionBreaches: 1 }),
    automationStats: () => ({ total: 7, success: 6, failed: 1 }),
    operationsTimeline: () => [{ id: 'audit:1', type: 'ticket.created', source: 'audit', actorId: 'u1', timestamp: new Date().toISOString(), payload: {} }],
    operationsSearch: () => [{ kind: 'ticket', id: '1', title: 'Test Ticket', subtitle: 'open · normal' }],
  };
}

function makeManager(db = makeDb()) {
  return new OperationsManager({
    db,
    events: { subscribe: () => () => {}, publish: () => {} },
    security: { snapshot: () => ({ score: 12, level: 'watch', signals: [], metrics: {} }) },
    tickets: {
      queue: () => ({ open: 2, waitingStaff: 1, inProgress: 3, escalated: 1 }),
      staff: () => [{ status: 'available' }, { status: 'busy' }],
    },
    incidents: { list: () => [{ status: 'open', severity: 'high' }, { status: 'resolved', severity: 'critical' }] },
  });
}

test('operations snapshot aggregates core state safely', () => {
  const manager = makeManager();
  const snapshot = manager.snapshot('guild-1');
  assert.equal(snapshot.communityId, 'guild-1');
  assert.equal(snapshot.tickets.escalated, 1);
  assert.equal(snapshot.incidents.highRisk, 1);
  assert.equal(snapshot.staff.available, 1);
  assert.equal(snapshot.confirmations.pending, 1);
  assert.ok(snapshot.analytics.trend);
  manager.close();
});

test('operations center combines support, automation, confirmations and staff workload', () => {
  const manager = makeManager();
  const center = manager.commandCenter('guild-1');
  assert.equal(center.support.open, 2);
  assert.equal(center.automation.total, 7);
  assert.equal(center.confirmations.pending, 2);
  assert.equal(center.staffWorkload.find(x => x.user_id === 'u2').openTickets, 1);
  assert.equal(center.timeline[0].type, 'ticket.created');
  manager.close();
});

test('operations search delegates through stable boundary', () => {
  const manager = makeManager();
  assert.equal(manager.search('guild-1', 'test')[0].kind, 'ticket');
  manager.close();
});
