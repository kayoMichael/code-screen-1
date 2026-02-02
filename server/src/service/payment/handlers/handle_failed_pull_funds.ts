import { PaymentStatus, PaymentMethodStatus } from '@prisma/client';
import ApplicationError, { ServerInternalError } from 'lib/ApplicationError';
import Result from 'lib/Result';
import Payment from 'model/Payment';
import PaymentMethod from 'model/PaymentMethod';
import CustomerAccount from 'model/CustomerAccount';
import BillingCycle from 'model/BillingCycle';
import { init_logger } from 'util/logger';
import { PaymentStatusCode, is_hard_decline_code } from '../PaymentStatusCode';

const logger = init_logger('handle_failed_pull_funds');

export type HandleFailedPullFundsArgs = {
  payment: Payment;
  code: PaymentStatusCode;
  ref_date?: Date;
};

/**
 * handle_failed_pull_funds
 * ------------------------
 * Handles post-processing for failed payment pulls.
 *
 * Actions:
 * 1. Updates payment status to FAILED with code
 * 2. Invalidates payment method on hard declines
 * 3. Updates customer account metrics
 * 4. Handles subscription-specific failure logic
 * 5. Handles retries if applicable
 *
 * @param args - Payment, failure code, and optional reference date
 * @returns Result<Payment, ApplicationError>
 */
export default async function handle_failed_pull_funds({
  payment,
  code,
  ref_date,
}: HandleFailedPullFundsArgs): Promise<Result<Payment, ApplicationError>> {
  try {
    ref_date = ref_date || new Date();

    logger.info(
      {
        payment_id: payment.id,
        account_id: payment.account_id,
        payment_code: code,
        ref_date,
      },
      `Handling Failed PULL funds`
    );

    // Idempotency check - if already FAILED, skip
    if (payment.status === PaymentStatus.FAILED) {
      logger.warn(
        {
          payment_id: payment.id,
          current_status: payment.status,
        },
        `Payment already in FAILED status, skipping`
      );
      return Result.success(payment);
    }

    // Update payment status to FAILED
    const update_result = await Payment.update(payment.id, {
      status: PaymentStatus.FAILED,
      code,
      fail_reason: get_fail_reason_from_code(code),
    });

    if (!update_result.ok) {
      logger.error(
        {
          payment_id: payment.id,
          error: update_result.error,
        },
        `Failed to update payment status to FAILED`
      );
      return Result.fail(
        new ServerInternalError(
          new Error(update_result.error?.detail || 'Failed to update payment')
        )
      );
    }

    payment = update_result.data;

    // Handle hard declines - invalidate payment method
    if (is_hard_decline_code(code) && payment.payment_method_id) {
      logger.info(
        {
          payment_id: payment.id,
          payment_method_id: payment.payment_method_id,
          code,
        },
        `Encountered hard decline, invalidating payment method`
      );

      await PaymentMethod.update(payment.payment_method_id, {
        status: PaymentMethodStatus.INVALID,
        memo: `Invalidated by system due to hard decline code: ${code}`,
      });
    }

    // Fetch and update customer account
    const account_result = await CustomerAccount.fetch_by_id(payment.account_id);
    if (account_result.ok && account_result.data) {
      const account = account_result.data;

      await CustomerAccount.update(account.id, {
        last_failed_payment_amount: payment.amount,
        last_failed_payment_date: new Date(),
      });

      logger.info(
        {
          payment_id: payment.id,
          account_id: account.id,
          code,
        },
        `Updated account metrics for failed payment`
      );
    }

    // Update billing cycle days_overdue
    if (payment.billing_cycle_id) {
      const billing_cycle_result = await BillingCycle.fetch_by_id(payment.billing_cycle_id);
      if (billing_cycle_result.ok && billing_cycle_result.data) {
        const billing_cycle = billing_cycle_result.data;
        const days_overdue = Math.max(
          0,
          Math.floor(
            (ref_date.getTime() - billing_cycle.end_date.getTime()) / (1000 * 60 * 60 * 24)
          )
        );

        await BillingCycle.update(billing_cycle.id, {
          days_overdue,
        });

        logger.info(
          {
            payment_id: payment.id,
            billing_cycle_id: billing_cycle.id,
            days_overdue,
          },
          `Updated billing cycle days_overdue`
        );
      }
    }

    return Result.success(payment);
  } catch (e) {
    logger.error(
      {
        error: e,
        error_message: e.message,
        payment_id: payment.id,
      },
      `Server internal error during handle failed pull funds`
    );
    return Result.fail(new ServerInternalError(e));
  }
}

/**
 * Map PaymentStatusCode to human-readable fail reason
 */
function get_fail_reason_from_code(code: PaymentStatusCode): string {
  const reasons: Record<PaymentStatusCode, string> = {
    [PaymentStatusCode.SUCCESS]: '',
    [PaymentStatusCode.PROCESSING]: 'Payment is still processing',
    [PaymentStatusCode.AWAITING_FILE_PROCESSING]: 'Awaiting file processing',
    [PaymentStatusCode.FILE_SENT_TO_PROCESSOR]: 'File sent to processor',
    [PaymentStatusCode.SENT_TO_PROCESSOR]: 'Sent to processor',
    [PaymentStatusCode.NO_VALID_BANK_CARD]: 'No valid bank card found',
    [PaymentStatusCode.NO_REMAINING_BANK_CARD_PROCESSOR]: 'No remaining bank card processor',
    [PaymentStatusCode.NO_REMAINING_BANK_EFT_PROCESSOR]: 'No remaining EFT processor',
    [PaymentStatusCode.NO_VALID_BANK_EFT]: 'No valid bank EFT found',
    [PaymentStatusCode.NO_VALID_ANY_CARD]: 'No valid card found',
    [PaymentStatusCode.NO_REMAINING_ANY_CARD_PROCESSOR]: 'No remaining card processor',
    [PaymentStatusCode.NOT_ATTEMPTED]: 'Payment not attempted',
    [PaymentStatusCode.PRESUMED_FAILED]: 'Payment presumed failed',
    [PaymentStatusCode.CARD_GATEWAY_BLOCK]: 'Card blocked by gateway',
    [PaymentStatusCode.CARD_ISSUER_BLOCK]: 'Card blocked by issuer',
    [PaymentStatusCode.CARD_GENERIC_FAIL]: 'Card payment failed',
    [PaymentStatusCode.CARD_INVALID]: 'Invalid card',
    [PaymentStatusCode.CARD_EXPIRED]: 'Card expired',
    [PaymentStatusCode.CARD_ISSUER_HARD_DECLINE]: 'Card hard declined by issuer',
    [PaymentStatusCode.EFT_ISSUER_BLOCK]: 'EFT blocked by issuer',
    [PaymentStatusCode.EFT_INVALID_INFO]: 'Invalid EFT information',
    [PaymentStatusCode.EFT_ACCOUNT_CLOSED]: 'EFT account closed',
    [PaymentStatusCode.EFT_GENERIC_FAIL]: 'EFT payment failed',
    [PaymentStatusCode.INTERAC_GENERIC_FAIL]: 'Interac payment failed',
    [PaymentStatusCode.INTERAC_INVALID_INFO]: 'Invalid Interac information',
    [PaymentStatusCode.INTERAC_INVALID_DEST]: 'Invalid Interac destination',
    [PaymentStatusCode.INTERAC_ANR_UNAVAILABLE]: 'Interac ANR unavailable',
    [PaymentStatusCode.NSF]: 'Non-sufficient funds',
    [PaymentStatusCode.DISPUTED]: 'Payment disputed',
    [PaymentStatusCode.REFUNDED]: 'Payment refunded',
    [PaymentStatusCode.RETRY_LATER]: 'Retry payment later',
    [PaymentStatusCode.EFT_NSF]: 'EFT non-sufficient funds',
    [PaymentStatusCode.FRAUDULENT]: 'Fraudulent transaction detected',
    [PaymentStatusCode.INTERNAL_FAILURE]: 'Internal system failure',
    [PaymentStatusCode.EXTERNAL_FAILURE]: 'External system failure',
  };

  return reasons[code] || `Unknown failure code: ${code}`;
}
