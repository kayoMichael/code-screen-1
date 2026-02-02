import { PaymentStatus, PaymentType, PaymentDirectionType, PaymentTrack } from '@prisma/client';
import ApplicationError, { ServerInternalError } from 'lib/ApplicationError';
import Result from 'lib/Result';
import Payment from 'model/Payment';
import BillingCycle from 'model/BillingCycle';
import CustomerAccount from 'model/CustomerAccount';
import { init_logger } from 'util/logger';

const logger = init_logger('handle_retry');

/**
 * Arguments for the handle_retry function
 */
export interface HandleRetryArgs {
  /** The failed payment to retry */
  payment: Payment;
}

/**
 * Retry action types based on failure code and days overdue
 * - instant: Retry immediately on the same day
 * - scheduled_friday: Reschedule to next Friday or balance due date (whichever is first)
 * - scheduled_friday_eom: Reschedule to last Friday of month or balance due date (whichever is first)
 * - backoff: Do not reschedule
 * - not_possible: EFT failures that cannot be retried
 */
export type RetryAction =
  | 'instant'
  | 'scheduled_friday'
  | 'scheduled_friday_eom'
  | 'backoff'
  | 'not_possible';

/**
 * Time bucket classification based on days_overdue from billing cycle
 */
export type TimeBucket = '0-30D' | '31-60D' | '61-180D' | '181D+';

/** Current version of the retry logic for tracking */
const RETRY_LOGIC_VERSION = 1;

/**
 * EFT codes that are "Not Possible" - should never be retried
 * These represent terminal EFT failures where retry is not allowed
 */
const NOT_POSSIBLE_CODES = new Set<number>([442, 443, 444, 445, 613, 615, 616, 640, 710]);

const retryStrategy: Record<
  TimeBucket,
  Record<Exclude<RetryAction, 'not_possible'>, Set<number>>
> = {
  '0-30D': {
    instant: new Set<number>([904]),
    scheduled_friday: new Set<number>([441, 701, 706]),
    scheduled_friday_eom: new Set<number>([601]),
    backoff: new Set<number>([903, 440, 603, 604, 605, 606, 607, 777]),
  },
  '31-60D': {
    instant: new Set<number>([904]),
    scheduled_friday: new Set<number>([441, 701, 706]),
    scheduled_friday_eom: new Set<number>([601]),
    backoff: new Set<number>([903, 440, 603, 604, 605, 606, 607, 777]),
  },
  '61-180D': {
    instant: new Set<number>([904]),
    scheduled_friday: new Set<number>([]),
    scheduled_friday_eom: new Set<number>([441, 701, 706]),
    backoff: new Set<number>([903, 440, 601, 603, 604, 605, 606, 607, 777]),
  },
  '181D+': {
    instant: new Set<number>([]),
    scheduled_friday: new Set<number>([]),
    scheduled_friday_eom: new Set<number>([]),
    backoff: new Set<number>([904, 903, 440, 441, 601, 701, 706, 603, 604, 605, 606, 607, 777]),
  },
};

/**
 * getTimeBucket
 * -------------
 * Determines the time bucket classification based on days_overdue.
 *
 * @param days_overdue - Number of days the payment is overdue
 * @returns TimeBucket - One of '0-30D', '31-60D', '61-180D', '181D+'
 */
function getTimeBucket(days_overdue: number): TimeBucket {
  if (days_overdue <= 30) return '0-30D';
  if (days_overdue <= 60) return '31-60D';
  if (days_overdue <= 180) return '61-180D';
  return '181D+';
}

/**
 * getRetryAction
 * --------------
 * Determines the appropriate retry action based on failure code and time bucket.
 *
 * @param code - The payment failure code
 * @param timeBucket - The time bucket based on days overdue
 * @returns RetryAction | null - The action to take, or null if code is unknown
 */
function getRetryAction(code: number, timeBucket: TimeBucket): RetryAction | null {
  // Check "Not Possible" codes first - these should never be retried
  if (NOT_POSSIBLE_CODES.has(code)) {
    return 'not_possible';
  }

  const strategy = retryStrategy[timeBucket];

  if (strategy.instant.has(code)) return 'instant';
  if (strategy.scheduled_friday.has(code)) return 'scheduled_friday';
  if (strategy.scheduled_friday_eom.has(code)) return 'scheduled_friday_eom';
  if (strategy.backoff.has(code)) return 'backoff';

  return null;
}

/**
 * getNextFriday
 * -------------
 * Calculates the next Friday from a given date.
 * If the given date is a Friday, returns the following Friday.
 *
 * @param from - The starting date
 * @returns Date - The next Friday
 */
function getNextFriday(from: Date): Date {
  const date = new Date(from);
  const dayOfWeek = date.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  return date;
}

/**
 * getLastFridayOfMonthForDate
 * ---------------------------
 * Calculates the last Friday of a specific month and year.
 *
 * @param year - The year
 * @param month - The month (0-indexed, 0 = January)
 * @returns Date - The last Friday of the specified month
 */
function getLastFridayOfMonthForDate(year: number, month: number): Date {
  // Go to last day of the specified month
  const date = new Date(year, month + 1, 0);
  const dayOfWeek = date.getDay();
  const daysToSubtract = (dayOfWeek + 2) % 7;
  date.setDate(date.getDate() - daysToSubtract);
  return date;
}

/**
 * getLastFridayOfMonth
 * --------------------
 * Gets the last Friday of the current month. If the last Friday has already
 * passed, returns the last Friday of the next month instead.
 *
 * @param from - The reference date
 * @returns Date - The last Friday of the current or next month (always in the future)
 */
function getLastFridayOfMonth(from: Date): Date {
  const lastFridayThisMonth = getLastFridayOfMonthForDate(from.getFullYear(), from.getMonth());

  // If last Friday of this month is in the past, get next month's last Friday
  if (lastFridayThisMonth <= from) {
    const nextMonth = new Date(from);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    return getLastFridayOfMonthForDate(nextMonth.getFullYear(), nextMonth.getMonth());
  }

  return lastFridayThisMonth;
}

/**
 * getScheduledDate
 * ----------------
 * Calculates the scheduled retry date based on type and balance due date.
 * Returns whichever comes first: the Friday date or balance due date.
 * Ensures the returned date is always in the future.
 *
 * @param type - 'friday' for next Friday, 'friday_eom' for last Friday of month
 * @param balanceDueDate - The customer's balance due date (or null if not available)
 * @param from - The reference date (defaults to current date)
 * @returns Date - The scheduled retry date (always in the future)
 */
function getScheduledDate(
  type: 'friday' | 'friday_eom',
  balanceDueDate: Date | null,
  from: Date = new Date()
): Date {
  const fridayDate = type === 'friday' ? getNextFriday(from) : getLastFridayOfMonth(from);

  // If no balance due date, use Friday date
  if (!balanceDueDate) {
    return fridayDate;
  }

  // If balance due date is in the past, ignore it and use Friday date
  if (balanceDueDate <= from) {
    return fridayDate;
  }

  // Return whichever comes first (both are in the future)
  return fridayDate < balanceDueDate ? fridayDate : balanceDueDate;
}

/**
 * handle_retry
 * ------------
 * Handles retry logic for failed payment pulls based on failure code and days overdue.
 *
 * Actions:
 * 1. Determines time bucket from billing cycle days_overdue (0-30D, 31-60D, 61-180D, 181D+)
 * 2. Determines retry action based on failure code and time bucket
 * 3. For instant retries: Creates new payment scheduled for today
 * 4. For scheduled retries: Creates new payment scheduled for next Friday or balance due date
 * 5. For backoff: Returns original payment unchanged (no retry)
 * 6. For not_possible (EFT codes): Returns error
 *
 * Retry Strategy by Code:
 * - 904 (External Failure): Instant retry in 0-180D, backoff in 181D+
 * - 441, 701, 706: Friday schedule in 0-60D, Friday EOM in 61-180D, backoff in 181D+
 * - 601 (Soft Block): Friday EOM in 0-60D, backoff in 61D+
 * - 903, 440, 603-607, 777: Backoff (no retry)
 * - 442, 443, 444, 445, 613, 615, 616, 640, 710: Not possible (EFT failures)
 *
 * @param args - HandleRetryArgs containing the failed payment
 * @returns Result<Payment, ApplicationError> - The retry payment or original payment (for backoff)
 */
export default async function handle_retry({
  payment,
}: HandleRetryArgs): Promise<Result<Payment, ApplicationError>> {
  const code = payment.code;

  if (code === null) {
    return Result.fail(new ServerInternalError(new Error('Payment has no failure code')));
  }

  // Get billing cycle to determine days_overdue
  if (!payment.billing_cycle_id) {
    return Result.fail(new ServerInternalError(new Error('Payment has no billing cycle')));
  }

  const billingCycleResult = await BillingCycle.fetch_by_id(payment.billing_cycle_id);
  if (!billingCycleResult.ok || !billingCycleResult.data) {
    return Result.fail(new ServerInternalError(new Error('Could not fetch billing cycle')));
  }

  const billingCycle = billingCycleResult.data;
  const days_overdue = billingCycle.days_overdue ?? 0;

  // Determine time bucket and action
  const timeBucket = getTimeBucket(days_overdue);
  let action = getRetryAction(code, timeBucket);

  // Special Condition: 61-180D + retry_cnt > 12 for codes 441, 701, 706 → force Backoff
  const CODES_WITH_RETRY_LIMIT_12 = new Set([441, 701, 706]);
  if (
    timeBucket === '61-180D' &&
    CODES_WITH_RETRY_LIMIT_12.has(code) &&
    payment.retry_sequence_nb > 12
  ) {
    action = 'backoff';
  }

  if (action === null) {
    return Result.fail(
      new ServerInternalError(
        new Error(`No retry strategy for code ${code} in bucket ${timeBucket}`)
      )
    );
  }

  // "Not Possible" codes - return error indicating retry is not possible
  if (action === 'not_possible') {
    logger.error(
      {
        payment_id: payment.id,
        payment_code: code,
        days_overdue,
        time_bucket: timeBucket,
      },
      'Retry not possible for this failure code'
    );
    return Result.fail(
      new ServerInternalError(
        new Error(
          `Retry not possible for code ${code} - this is an EFT failure that cannot be retried`
        )
      )
    );
  }

  if (action === 'backoff') {
    logger.warn(
      {
        payment_id: payment.id,
        payment_code: code,
        days_overdue,
        time_bucket: timeBucket,
      },
      'Backoff retry - no action taken'
    );
    return Result.success(payment);
  }

  // For scheduled retries, get the balance due date from customer account
  let balanceDueDate: Date | null = null;
  if (action === 'scheduled_friday' || action === 'scheduled_friday_eom') {
    const accountResult = await CustomerAccount.fetch_by_id(payment.account_id);
    if (accountResult.ok && accountResult.data) {
      balanceDueDate = accountResult.data.balance_due_date;
    }
  }

  // Determine the retry date based on action type
  let retryDate: Date;
  let retryReason: string;

  if (action === 'instant') {
    retryDate = new Date();
    retryReason = 'instant_retry';
  } else if (action === 'scheduled_friday') {
    retryDate = getScheduledDate('friday', balanceDueDate);
    retryReason = 'scheduled_friday_or_balance_due';
  } else {
    retryDate = getScheduledDate('friday_eom', balanceDueDate);
    retryReason = 'scheduled_friday_eom_or_balance_due';
  }

  const retryTrack = code === 904 ? PaymentTrack.ANY_CARD : PaymentTrack.BANK_CARD;
  const CODES_WITH_STRIPE_EXCLUSION = new Set([904, 441, 601, 701, 706]);
  let retryRoutingCtx = payment.retry_routing_ctx ?? [];
  if (
    timeBucket === '31-60D' &&
    CODES_WITH_STRIPE_EXCLUSION.has(code) &&
    payment.retry_sequence_nb > 8
  ) {
    retryRoutingCtx = [...retryRoutingCtx, 'exclude_stripe'];
  }

  // Create the retry payment
  try {
    const retryPayment = await Payment.create({
      account: {
        connect: { id: payment.account_id },
      },
      date: retryDate,
      amount: payment.amount,
      type: payment.type ?? PaymentType.SUBSCRIPTION,
      direction: payment.direction ?? PaymentDirectionType.ACCOUNT_RECEIVABLE,
      track: retryTrack,
      status: PaymentStatus.SCHEDULED,
      payment_method: payment.payment_method_id
        ? { connect: { id: payment.payment_method_id } }
        : undefined,
      payment_method_processor: payment.payment_method_processor_id
        ? { connect: { id: payment.payment_method_processor_id } }
        : undefined,
      subscription: payment.subscription_id
        ? { connect: { id: payment.subscription_id } }
        : undefined,
      billing_cycle: {
        connect: { id: payment.billing_cycle_id },
      },
      retry_prev_payment_id: payment.id,
      retry_sequence_nb: payment.retry_sequence_nb + 1,
      retry_routing_ctx: retryRoutingCtx,
      retry_annotation: `${action} retry of payment ${payment.id}`,
      retry_logic_version: RETRY_LOGIC_VERSION,
      retry_trace_data: {
        original_payment_id: payment.id,
        original_code: payment.code,
        retry_reason: retryReason,
        retry_timestamp: new Date().toISOString(),
        scheduled_date: retryDate.toISOString(),
        time_bucket: timeBucket,
        days_overdue,
      },
      memo: `Retry attempt #${payment.retry_sequence_nb + 1} for original payment`,
    });

    if (!retryPayment.ok) {
      return Result.fail(new ServerInternalError(new Error('Failed to create retry payment')));
    }

    return Result.success(retryPayment.data);
  } catch (error) {
    return Result.fail(new ServerInternalError(error as Error));
  }
}
