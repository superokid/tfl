/**
 * At most `max` tasks in flight (Workers allow 6 open connections per invocation). Each task starts its
 * own timeout when it actually runs, so a queued call can't time out unsent (ADR-006).
 */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) {
      active++;
      start();
    }
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
