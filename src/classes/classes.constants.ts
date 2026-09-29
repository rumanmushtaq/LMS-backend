/**
 * Class-policy thresholds.
 *
 * These live apart from `ClassesService` so anything that needs to *show* a
 * limit — the tutor dashboard's strike warning, for one — can read the same
 * number the sweep enforces without importing the service and, with it, the
 * live-streaming, chat-gateway and notification graph behind it.
 */

/**
 * A tutor cancelling on the same student this many times triggers an
 * automatic suspension and an admin alert. Counted over all time — a tutor
 * who repeatedly strands the same student is a trust problem, not a
 * scheduling accident.
 */
export const TUTOR_CANCELLATIONS_PER_STUDENT_LIMIT = 3;

/**
 * A tutor who lets this many scheduled classes pass without ever starting
 * them (no-shows) is auto-suspended. Unlike cancellations this is not
 * per-student — a serial no-show harms whoever was enrolled.
 */
export const TUTOR_MISSED_CLASSES_LIMIT = 3;
