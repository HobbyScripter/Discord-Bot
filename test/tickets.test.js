import test from 'node:test';
import assert from 'node:assert/strict';
import { TicketManager } from '../src/core/tickets.js';

test('TicketManager chooses available staff with lowest queue load', () => {
  const calls = [];
  const db = {
    listUsers: () => [
      { user_id: '1', staff: true, username: 'A' },
      { user_id: '2', staff: true, username: 'B' },
    ],
    listStaffStatus: () => [
      { user_id: '1', status: 'available' },
      { user_id: '2', status: 'available' },
    ],
    listTickets: () => [
      { id: 1, status: 'in_progress', assigned_to: '1' },
      { id: 2, status: 'in_progress', assigned_to: '1' },
      { id: 3, status: 'in_progress', assigned_to: '2' },
    ],
  };
  const manager = new TicketManager(db, { publish: (...args) => calls.push(args) });
  assert.equal(manager.chooseAssignee('g').userId, '2');
  assert.equal(calls.length, 0);
});

test('TicketManager validates ticket status', () => {
  const db = {
    listTickets: () => [{ id: 1, status: 'open' }],
    updateTicket: () => {},
    addAudit: () => {},
  };
  const manager = new TicketManager(db, { publish() {} });
  assert.throws(() => manager.update('g', 1, { status: 'destroy' }), /Ungültiger Ticket-Status/);
});
