import { getPool } from "../db";

export async function runIdempotencyCleanupOnce(options?: {
  retentionDays?: number;
  pendingHours?: number;
}) {
  const retentionDays = options?.retentionDays ?? 2;
  const pendingHours = options?.pendingHours ?? 1;
  const pool = getPool();

  // Delete completed/failed older than retention
  await pool.query(
    `DELETE FROM idempotency_keys
      WHERE status IN ('COMPLETED','FAILED')
        AND created_at < now() - ($1 || ' days')::interval`,
    [retentionDays]
  );

  // Delete lingering pending older than threshold
  await pool.query(
    `DELETE FROM idempotency_keys
      WHERE status = 'PENDING'
        AND created_at < now() - ($1 || ' hours')::interval`,
    [pendingHours]
  );
}

export function startIdempotencyCleanupJob(options?: {
  intervalMinutes?: number;
  retentionDays?: number;
  pendingHours?: number;
}) {
  const intervalMinutes = options?.intervalMinutes ?? 360; // every 6 hours
  const retentionDays = options?.retentionDays ?? 2;
  const pendingHours = options?.pendingHours ?? 1;

  // fire-and-forget; log errors if any
  const run = () => runIdempotencyCleanupOnce({ retentionDays, pendingHours }).catch(() => {});

  // initial delayed run to avoid contention on boot
  setTimeout(run, 30_000);
  return setInterval(run, intervalMinutes * 60_000);
}
