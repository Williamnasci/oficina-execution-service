export function startWorkers(broker, service, { intervalMs = 250, log = console.error } = {}) {
  let expiring = false;
  const relay = setInterval(() => broker.flush().catch(error => log(JSON.stringify({ level: 'error', component: 'outbox', message: error.message }))), intervalMs);
  const deadlines = service.expire ? setInterval(async () => {
    if (expiring) return;
    expiring = true;
    try { await service.expire(); } catch (error) { log(JSON.stringify({ level: 'error', component: 'deadline', message: error.message })); }
    finally { expiring = false; }
  }, Math.max(intervalMs, 1000)) : null;
  return () => { clearInterval(relay); if (deadlines) clearInterval(deadlines); };
}
