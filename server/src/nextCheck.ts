// When to ask Blizzard again. Snapshots come hourly, within a minute of the
// same time, until a server restart moves them to a new minute.

const SNAPSHOT_INTERVAL = 60 * 60;
const AFTER_UPDATE = 90; // the snapshot is out within seconds, and can run 20s late
const QUIET_CHECK = 10 * 60; // also catches an update that moved earlier, and runs the name lookups
const LATE_CHECK = 2 * 60; // finds the new minute soon after a restart

// All in seconds. `lastTakenAt` = the newest stored snapshot, if any.
export function secondsUntilNextCheck(now: number, lastTakenAt: number | null, lastRunOk: boolean): number {
  if (!lastRunOk || lastTakenAt === null) return QUIET_CHECK;
  const wait = lastTakenAt + SNAPSHOT_INTERVAL + AFTER_UPDATE - now;
  return wait > 0 ? Math.min(wait, QUIET_CHECK) : LATE_CHECK;
}
