/**
 * Stable internal event interface for Community Core.
 *
 * The bus is intentionally independent from Discord, HTTP and the dashboard.
 * Subscribers are isolated: one broken consumer can never break the publisher
 * or the other subscribers.
 */
export class CoreEventBus {
  constructor({ historySize = 250, logger = console } = {}) {
    this.historySize = Math.max(0, Number(historySize) || 250);
    this.logger = logger;
    this.sequence = 0;
    this.subscribers = new Set();
    this.historyBuffer = [];
  }

  publish(type, payload = {}, meta = {}) {
    const normalizedType = String(type || '').trim();
    if (!normalizedType) return null;
    const event = Object.freeze({
      version: 1,
      sequence: ++this.sequence,
      type: normalizedType,
      source: String(meta.source || 'core'),
      communityId: meta.communityId ? String(meta.communityId) : null,
      timestamp: new Date().toISOString(),
      payload: this.#safePayload(payload),
    });

    if (this.historySize > 0) {
      this.historyBuffer.push(event);
      while (this.historyBuffer.length > this.historySize) this.historyBuffer.shift();
    }

    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        try { this.logger.warn?.('⚠ Core Event Subscriber fehlgeschlagen:', error?.stack || error); } catch {}
      }
    }
    return event;
  }


  #safePayload(value) {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value && typeof value === 'object' ? value : { value }, (key, current) => {
        if (typeof current === 'bigint') return `${current}n`;
        if (typeof current === 'object' && current !== null) {
          if (seen.has(current)) return '[Circular]';
          seen.add(current);
        }
        return current;
      });
      const parsed = JSON.parse(json);
      const bytes = Buffer.byteLength(json, 'utf8');
      return bytes <= 256 * 1024 ? parsed : { truncated: true, bytes, message: 'Event-Payload wurde aus Sicherheitsgründen gekürzt.' };
    } catch {
      return { value: String(value) };
    }
  }

  subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('Event-Bus Subscriber muss eine Funktion sein.');
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  history({ after = 0, communityId = null, limit = 100 } = {}) {
    const max = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.historyBuffer
      .filter(event => event.sequence > Number(after || 0))
      .filter(event => !communityId || event.communityId === String(communityId) || event.communityId === null)
      .slice(-max);
  }

  get lastSequence() { return this.sequence; }
}
