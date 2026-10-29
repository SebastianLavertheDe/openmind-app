export function readWithDeadline<T>(request: Promise<T>, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), 10_000);
    request.then(value => { window.clearTimeout(timer); resolve(value); }, cause => { window.clearTimeout(timer); reject(cause); });
  });
}
