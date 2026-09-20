import { ClassStatus } from '../classes/schemas/class.schema';

/**
 * Shapes returned by `GET /api/v1/dashboard/summary`.
 *
 * Every field here is backed by a collection something in this codebase
 * actually writes. Deliberately absent, because the data behind them does not
 * exist: course progress, grades, attendance, certificates, ratings, review
 * counts, and any money sourced from `Order` or `MaterialPurchase.amountPaid`.
 * See docs/superpowers/specs/2026-09-20-role-dashboards-design.md.
 */

/** A class as the dashboard's "next up" list renders it — no populated roster. */
export interface DashboardNextClassBase {
  _id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  status: ClassStatus;
  /** `liveSession.status` ('idle' | 'live' | 'ended'), or null when unset. */
  liveStatus: string | null;
}

export interface StudentNextClass extends DashboardNextClassBase {
  tutor: { _id: string; firstName: string; lastName: string } | null;
}

export interface TutorNextClass extends DashboardNextClassBase {
  enrolled: number;
  maxStudents: number | null;
}

export interface UnreadCounts {
  notifications: number;
  messages: number;
}

export interface StudentDashboardSummary {
  role: 'student';
  classes: {
    liveNow: number;
    upcoming: number;
    pendingApproval: number;
    completed: number;
    cancelled: number;
  };
  /** Soonest first, at most 3. */
  nextClasses: StudentNextClass[];
  /**
   * Total scheduled length of COMPLETED classes, in minutes.
   *
   * Not "hours learned" — there is no per-student attendance flag anywhere in
   * this product, so actual participation is unknowable.
   */
  scheduledMinutes: number;
  unread: UnreadCounts;
  /** Count of paid `MaterialPurchase` rows. Never a money total. */
  materialsOwned: number;
  profileCompletenessPercent: number;
}

export interface TutorDashboardSummary {
  role: 'tutor';
  classes: {
    liveNow: number;
    upcoming: number;
    pendingRequests: number;
    completed: number;
    missed: number;
  };
  /** Soonest first, at most 3. */
  nextClasses: TutorNextClass[];
  /** Group classes only — a private class has no seats to sell. */
  seats: { sold: number; capacity: number };
  students: { distinctTotal: number };
  earnings: {
    grossMinor: number;
    commissionMinor: number;
    netMinor: number;
    owedMinor: number;
    paymentCount: number;
    currency: string;
  };
  /** Exactly 6 buckets, oldest → newest, zero-filled. */
  activityByMonth: MonthlyActivity[];
  unread: UnreadCounts;
  materialsPublished: number;
  onboarding: {
    step: string;
    status: string;
    strikes: { missed: number; limit: number };
  };
  profileCompletenessPercent: number;
}

export interface MonthlyActivity {
  /** 'YYYY-MM', UTC. */
  month: string;
  completed: number;
}

export type DashboardSummary = StudentDashboardSummary | TutorDashboardSummary;

/** How many months `activityByMonth` covers, including the current one. */
export const ACTIVITY_MONTHS = 6;

/** How many upcoming classes the dashboard hero and list need. */
export const NEXT_CLASSES_LIMIT = 3;

/**
 * One scored slot in the profile-completeness percentage.
 *
 * `sources` exists because this codebase stores the same value under more than
 * one `kycData` key depending on which screen wrote it — tutor onboarding
 * writes `photoUrl` / `pricePerHour` / `aboutMe`, the profile editor writes
 * `avatar` / `hourlyRate` / `bio`. A slot counts as filled if ANY of its
 * sources holds a value, so a complete profile does not read as half-empty
 * just because it was filled in from the other screen.
 */
export interface ProfileField {
  /** Stable name for the slot — what a frontend checklist would label it. */
  key: string;
  /** `kycData` keys that can satisfy this slot. */
  sources: string[];
}

/**
 * The student profile slots, scored equally.
 *
 * Every one lives in `kycData` (see `UsersService.updateProfile`). `firstName`
 * and `lastName` are deliberately excluded: they are required at signup, so
 * including them would hand every account free percentage points.
 */
export const STUDENT_PROFILE_FIELDS: ProfileField[] = [
  { key: 'avatar', sources: ['avatar', 'photoUrl'] },
  { key: 'phone', sources: ['phone'] },
  { key: 'bio', sources: ['bio', 'aboutMe'] },
  { key: 'dob', sources: ['dob'] },
  { key: 'country', sources: ['country'] },
];

/**
 * The tutor profile slots, scored equally.
 *
 * `bio` and `aboutMe` are one slot, not two: `updateProfile` writes both from
 * the same input, so scoring them separately would double-count a single
 * field.
 */
export const TUTOR_PROFILE_FIELDS: ProfileField[] = [
  { key: 'title', sources: ['title'] },
  { key: 'bio', sources: ['bio', 'aboutMe'] },
  { key: 'avatar', sources: ['avatar', 'photoUrl'] },
  { key: 'hourlyRate', sources: ['hourlyRate', 'pricePerHour'] },
  { key: 'specialties', sources: ['specialties'] },
  { key: 'education', sources: ['education'] },
  { key: 'experience', sources: ['experience'] },
];
