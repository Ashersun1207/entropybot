export function testManualRunLocks(): LockManager {
  const queues = new Map<string, (() => Promise<void>)[]>();
  const request = (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => new Promise((resolve, reject) => {
    const queue = queues.get(name) ?? [];
    queues.set(name, queue);
    const perform = async () => {
      try {
        if (options.signal?.aborted) throw options.signal.reason;
        resolve(await callback({ name, mode: "exclusive" } as Lock));
      } catch (error) { reject(error); }
      finally { queue.shift(); if (queue.length) void queue[0](); else queues.delete(name); }
    };
    queue.push(perform);
    if (queue.length === 1) void perform();
  });
  return { request: request as LockManager["request"], query: async () => ({ held: [], pending: [] }) };
}
