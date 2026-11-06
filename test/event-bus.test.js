import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreEventBus } from '../src/core/event-bus.js';

test('event bus isolates subscriber failures and preserves order', () => {
  const bus = new CoreEventBus({ historySize: 10, logger: { warn() {} } });
  const received = [];
  bus.subscribe(() => { throw new Error('subscriber failure'); });
  bus.subscribe(event => received.push(event));
  const first = bus.publish('test.one', { ok: true }, { source: 'test', communityId: '1' });
  const second = bus.publish('test.two', { ok: true }, { source: 'test', communityId: '1' });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(received.map(event => event.type), ['test.one', 'test.two']);
  assert.equal(bus.history({ after: 1 }).length, 1);
});
