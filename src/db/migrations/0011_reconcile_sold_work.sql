-- Retire declined work and follow-ups for jobs that were already sold.
--
-- Closing a repair order now settles the work it performed, but every RO closed
-- before that shipped left its declines open and its follow-ups pending. A
-- customer who bought a coolant flush in August still has a task telling the BDC
-- to ring them in September and offer it again.
--
-- This is the one-time repair of that history. The rules match the runtime path
-- in closeRepairOrder exactly — same vehicle, same component group, only lines
-- that were actually performed — with one condition the runtime does not need:
-- the RO must have closed AFTER the decline was recorded. Selling a battery in
-- 2025 does not settle a battery declined in 2026.
--
-- Idempotent. Applied with `npm run db:apply` — see src/db/README.md.

UPDATE declined_services d
SET resolved_at = sold.closed_at,
    resolved_by_ro_id = sold.ro_id
FROM (
  SELECT DISTINCT ON (d2.id)
         d2.id AS decline_id, r.id AS ro_id, r.closed_at
  FROM declined_services d2
  JOIN repair_orders r
    ON r.vehicle_id = d2.vehicle_id
   AND r.status = 'CLOSED'
   AND r.closed_at > d2.declined_at
  JOIN ro_lines l
    ON l.repair_order_id = r.id
   AND l.status IN ('APPROVED', 'COMPLETE')
   AND l.component_group_key = d2.component_group_key
  WHERE d2.resolved_at IS NULL
    AND d2.component_group_key IS NOT NULL
  -- The earliest visit that settled it, not the latest. That is the one that
  -- actually did the work; anything after it was a repeat service.
  ORDER BY d2.id, r.closed_at ASC
) sold
WHERE d.id = sold.decline_id;

UPDATE cadence_tasks t
SET status = 'COMPLETED',
    completed_at = sold.closed_at,
    outcome_notes = 'Work performed on RO ' || sold.ro_number || '.',
    updated_at = now()
FROM (
  SELECT DISTINCT ON (t2.id)
         t2.id AS task_id, r.ro_number, r.closed_at
  FROM cadence_tasks t2
  JOIN repair_orders r
    ON r.vehicle_id = t2.vehicle_id
   AND r.status = 'CLOSED'
   -- The task has to predate the visit. A task raised after the work was done
   -- is about the next interval, not the one just serviced.
   AND r.closed_at > t2.created_at
  JOIN ro_lines l
    ON l.repair_order_id = r.id
   AND l.status IN ('APPROVED', 'COMPLETE')
   AND l.component_group_key = t2.component_group_key
  WHERE t2.status = 'PENDING'
    AND t2.component_group_key IS NOT NULL
    AND t2.vehicle_id IS NOT NULL
  ORDER BY t2.id, r.closed_at ASC
) sold
WHERE t.id = sold.task_id;
