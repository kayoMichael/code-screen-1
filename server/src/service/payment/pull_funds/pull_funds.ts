import { PaymentStatus, PaymentTrack, PaymentProvider } from '@prisma/client';
import { InvarianceViolation } from 'common/errors';
import ApplicationError, { ServerInternalError } from 'lib/ApplicationError';
import Result from 'lib/Result';
import Payment from 'model/Payment';
import PaymentMethod from 'model/PaymentMethod';
import PaymentMethodProcessor from 'model/PaymentMethodProcessor';
import CustomerAccount from 'model/CustomerAccount';
import User from 'model/User';
import { init_logger } from 'util/logger';

import { PaymentStatusCode } from '../PaymentStatusCode';
import pull_funds_routing from './pull_funds_routing';
import pull_funds_provider_1_processor from './processors/pull_funds_provider_1_processor';
import pull_funds_provider_2_processor from './processors/pull_funds_provider_2_processor';
import pull_funds_provider_3_processor from './processors/pull_funds_provider_3_processor';
import pull_funds_provider_4_processor from './processors/pull_funds_provider_4_processor';
import handle_successful_pull_funds from '../handlers/handle_successful_pull_funds';
import handle_failed_pull_funds from '../handlers/handle_failed_pull_funds';
import handle_retry from '../handlers/handle_retry';

const logger = init_logger('pull_funds');

export type PullFundsArgs = {
  payment: Payment;
  user?: User;
  ref_date?: Date;
  auto_fail_retry_payments?: boolean;
};

/**
 * pull_funds
 * ----------
 * Main entry point for pulling funds from a customer's card payment method.
 *
 * Flow:
 * 1. Validate payment has a valid payment method and processor
 * 2. If not, route to find the best payment method/processor
 * 3. Execute the payment through the selected processor
 * 4. Handle success/failure outcomes
 *
 * @param args - PullFundsArgs containing payment and optional user/date
 * @returns Result<Payment, ApplicationError>
 */
export default async function pull_funds({
  payment,
  user,
  ref_date,
  auto_fail_retry_payments = false,
}: PullFundsArgs): Promise<Result<Payment, ApplicationError>> {
  try {
    let payment_status_code: PaymentStatusCode;
    let payment_method: PaymentMethod = payment.payment_method;
    let payment_method_processor: PaymentMethodProcessor = payment.payment_method_processor;

    logger.info(
      {
        payment_id: payment.id,
        ref_date,
        amount: (payment.amount / 100).toFixed(2),
        payment_method_id: payment_method ? payment_method.id : null,
        processor_id: payment_method_processor ? payment_method_processor.id : null,
        track: payment.track,
        ...(user && { user_id: user.id }),
      },
      `Pulling funds: $${(payment.amount / 100).toFixed(2)}`
    );

    // Determine track if not set - default to BANK_CARD
    let track = payment.track;
    if (!track) {
      logger.info(
        {
          payment_id: payment.id,
          payment_method_id: payment_method ? payment_method.id : null,
          ...(user && { user_id: user.id }),
        },
        `No track found, defaulting to bank card track`
      );

      await Payment.update(payment.id, { track: PaymentTrack.BANK_CARD });
      payment.track = PaymentTrack.BANK_CARD;
      track = payment.track;
    }

    // Route payment if no valid payment method or processor
    if (
      !payment_method ||
      !payment_method.id ||
      !payment_method_processor ||
      !payment_method_processor.id ||
      payment_method.status !== 'VALID'
    ) {
      // Get user if not provided
      if (!user || !user.id) {
        if (payment_method && payment_method.id) {
          const user_result = await User.fetch_by_id(payment_method.customer_id);
          user = user_result.ok ? user_result.data : null;
        } else if (payment.account_id) {
          const account_result = await CustomerAccount.fetch_by_id(payment.account_id);
          if (account_result.ok && account_result.data) {
            const user_result = await User.fetch_by_id(account_result.data.customer_id);
            user = user_result.ok ? user_result.data : null;
          }
        }

        if (!user || !user.id) {
          return Result.fail(
            new InvarianceViolation(
              null,
              `User object needed if payment record has no payment method`
            )
          );
        }
      }

      logger.info(
        {
          payment_id: payment.id,
          payment_method_id: payment_method ? payment_method.id : null,
          track: payment.track,
          ...(user && { user_id: user.id }),
        },
        `Pull funds with no pmd or processor, re-routing at charge time.`
      );

      const routing_result = await pull_funds_routing({
        user,
        payment,
        pull_funds_in_progress: true,
      });

      if (!routing_result.ok) {
        return routing_result;
      }

      payment = routing_result.unwrap();
      payment_method_processor = payment.payment_method_processor;
      payment_method = payment.payment_method;
    }

    // Determine status code based on payment method availability
    if (!payment_method || payment_method.status !== 'VALID') {
      if (track === PaymentTrack.BANK_CARD) {
        payment_status_code = PaymentStatusCode.NO_VALID_BANK_CARD;
      } else {
        payment_status_code = PaymentStatusCode.NO_VALID_ANY_CARD;
      }
    } else if (!payment_method_processor || !payment_method_processor.id) {
      // No processor available
      if (track === PaymentTrack.BANK_CARD) {
        payment_status_code = PaymentStatusCode.NO_REMAINING_BANK_CARD_PROCESSOR;
      } else {
        payment_status_code = PaymentStatusCode.NO_REMAINING_ANY_CARD_PROCESSOR;
      }
    } else {
      // Check for auto-fail retry scenarios
      if (
        auto_fail_retry_payments &&
        ['SUBSCRIPTION_RETRY', 'SUBSCRIPTION_RETRY_LATER'].includes(payment.type)
      ) {
        payment_status_code = PaymentStatusCode.NOT_ATTEMPTED;
      } else {
        // Execute payment through processor
        switch (payment_method_processor.provider_name) {
          case PaymentProvider.PROVIDER_1:
            payment_status_code = (
              await pull_funds_provider_1_processor({
                payment,
                payment_method,
                user,
                ref_date,
              })
            ).unwrap();
            break;

          case PaymentProvider.PROVIDER_2:
            payment_status_code = (
              await pull_funds_provider_2_processor({
                payment,
                payment_method,
                user,
              })
            ).unwrap();
            break;

          case PaymentProvider.PROVIDER_3:
            payment_status_code = (
              await pull_funds_provider_3_processor({
                payment,
                payment_method,
                user,
              })
            ).unwrap();
            break;

          case PaymentProvider.PROVIDER_4:
            payment_status_code = (
              await pull_funds_provider_4_processor({
                payment,
                payment_method,
                user,
              })
            ).unwrap();
            break;

          default:
            logger.error(
              {
                payment_id: payment.id,
                provider: payment_method_processor.provider_name,
              },
              `Unknown payment provider`
            );
            payment_status_code = PaymentStatusCode.INTERNAL_FAILURE;
        }
      }
    }

    // Handle outcome
    if (payment_status_code === PaymentStatusCode.SUCCESS) {
      logger.info(
        {
          payment_id: payment.id,
          processor_id: payment_method_processor?.id,
          ...(user && { user_id: user.id }),
        },
        `Pulling funds: $${(payment.amount / 100).toFixed(2)} successful`
      );

      const success_result = await handle_successful_pull_funds({
        payment,
      });
      payment = success_result.safe_unwrap() || payment;
    } else if (
      payment_status_code === PaymentStatusCode.PROCESSING ||
      payment_status_code === PaymentStatusCode.AWAITING_FILE_PROCESSING
    ) {
      logger.info(
        {
          payment_id: payment.id,
          processor_id: payment_method_processor?.id,
          payment_status_code,
          ...(user && { user_id: user.id }),
        },
        `Payment is processing asynchronously`
      );
      // Payment is async, will be handled via webhook
    } else {
      logger.info(
        {
          payment_id: payment.id,
          payment_method_id: payment_method ? payment_method.id : 'n/a',
          processor_id: payment_method_processor ? payment_method_processor.id : 'n/a',
          payment_status_code,
          ...(user && { user_id: user.id }),
        },
        `Pulling funds: $${(payment.amount / 100).toFixed(2)} failed on code ${payment_status_code}`
      );

      const fail_result = await handle_failed_pull_funds({
        payment,
        code: payment_status_code,
        ref_date: ref_date || new Date(),
      });
      payment = fail_result.safe_unwrap() || payment;
      const result = await handle_retry({ payment });
      if (result.ok) {
        payment = result.safe_unwrap();
      }
    }

    return Result.success(payment);
  } catch (e) {
    logger.error(
      {
        error_name: e.name,
        error_message: e.message,
        error_stack: e.stack,
        payment_id: payment.id,
        user_id: user ? user.id : 'na',
        ref_date,
      },
      `Server internal error encountered during pull funds, will return 903 code`
    );

    const fail_result = await handle_failed_pull_funds({
      payment,
      code: PaymentStatusCode.INTERNAL_FAILURE,
      ref_date: ref_date || new Date(),
    });
    payment = fail_result.safe_unwrap() || payment;

    return Result.fail(new ServerInternalError(e));
  }
}
