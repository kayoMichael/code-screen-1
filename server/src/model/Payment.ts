import { Field, ID, Int, ObjectType, registerEnumType } from 'type-graphql';
import {
  Payment as PrismaPayment,
  PaymentStatus,
  PaymentType,
  PaymentTrack,
  PaymentDirectionType,
  PaymentAsyncProcessingStatus,
  Prisma,
} from '@prisma/client';
import db from 'util/db';
import Result from 'lib/Result';
import ApplicationError, { DatabaseError } from 'lib/ApplicationError';
import Response from 'endpoint/response/Response';
import PaymentMethod from './PaymentMethod';
import PaymentMethodProcessor from './PaymentMethodProcessor';

// Register enums with type-graphql
registerEnumType(PaymentStatus, { name: 'PaymentStatus' });
registerEnumType(PaymentType, { name: 'PaymentType' });
registerEnumType(PaymentTrack, { name: 'PaymentTrack' });
registerEnumType(PaymentDirectionType, { name: 'PaymentDirectionType' });
registerEnumType(PaymentAsyncProcessingStatus, { name: 'PaymentAsyncProcessingStatus' });

export interface CreatePaymentInput {
  account_id: string;
  date: Date;
  amount: number;
  status: PaymentStatus;
  type?: PaymentType;
  direction?: PaymentDirectionType;
  track?: PaymentTrack;
  payment_method_id?: string;
  payment_method_processor_id?: string;
  subscription_id?: string;
  billing_cycle_id?: string;
  memo?: string;
}

export interface UpdatePaymentInput {
  status?: PaymentStatus;
  code?: number;
  transaction_id?: string;
  processed_at?: Date;
  fail_reason?: string;
  memo?: string;
  track?: PaymentTrack;
  payment_method_id?: string;
  payment_method_processor_id?: string;
  retry_routing_ctx?: string[];
  retry_sequence_nb?: number;
  retry_prev_payment_id?: string;
  retry_annotation?: string;
  retry_trace_data?: Prisma.JsonValue;
  retry_logic_version?: number;
  async_processing_status?: PaymentAsyncProcessingStatus;
  async_processing_reference_id?: string;
  gateway_context_data?: Prisma.JsonValue;
}

@ObjectType()
export default class Payment implements PrismaPayment {
  @Field((type) => ID)
  id: string;

  @Field((type) => PaymentStatus)
  status: PaymentStatus;

  @Field((type) => Int, { nullable: true })
  code: number | null;

  @Field((type) => PaymentDirectionType, { nullable: true })
  direction: PaymentDirectionType | null;

  @Field((type) => PaymentTrack, { nullable: true })
  track: PaymentTrack | null;

  @Field((type) => PaymentType)
  type: PaymentType;

  @Field()
  date: Date;

  @Field((type) => Int)
  amount: number;

  @Field({ nullable: true })
  transaction_id: string | null;

  @Field()
  account_id: string;

  @Field({ nullable: true })
  payment_method_id: string | null;

  @Field({ nullable: true })
  payment_method_processor_id: string | null;

  @Field({ nullable: true })
  subscription_id: string | null;

  @Field({ nullable: true })
  billing_cycle_id: string | null;

  @Field((type) => [String])
  retry_routing_ctx: string[];

  @Field((type) => Int)
  retry_sequence_nb: number;

  @Field({ nullable: true })
  retry_prev_payment_id: string | null;

  @Field({ nullable: true })
  retry_annotation: string | null;

  retry_trace_data: Prisma.JsonValue;

  @Field((type) => Int, { nullable: true })
  retry_logic_version: number | null;

  @Field({ nullable: true })
  memo: string | null;

  @Field({ nullable: true })
  fail_reason: string | null;

  @Field((type) => Int, { nullable: true })
  processing_split_key: number | null;

  @Field((type) => PaymentAsyncProcessingStatus, { nullable: true })
  async_processing_status: PaymentAsyncProcessingStatus | null;

  @Field({ nullable: true })
  async_processing_reference_id: string | null;

  @Field({ nullable: true })
  async_processing_input_file_id: string | null;

  @Field({ nullable: true })
  async_processing_output_file_id: string | null;

  gateway_context_data: Prisma.JsonValue;

  @Field()
  created_at: Date;

  @Field({ nullable: true })
  processed_at: Date | null;

  @Field()
  updated_at: Date;

  // Relations
  @Field((type) => PaymentMethod, { nullable: true })
  payment_method?: PaymentMethod;

  @Field((type) => PaymentMethodProcessor, { nullable: true })
  payment_method_processor?: PaymentMethodProcessor;

  constructor(payment: PrismaPayment | any) {
    Object.assign(this, payment);
  }

  static async create(
    input: Prisma.PaymentCreateInput
  ): Promise<Result<Payment, ApplicationError>> {
    try {
      const payment = await db.payment.create({
        data: input,
      });

      return Result.success(new Payment(payment));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to create payment'));
    }
  }

  static async fetch_by_id(id: string): Promise<Result<Payment | null, ApplicationError>> {
    try {
      const payment = await db.payment.findUnique({
        where: { id },
        include: {
          payment_method: true,
          payment_method_processor: true,
          billing_cycle: true,
        },
      });

      return Result.success(payment ? new Payment(payment) : null);
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to fetch payment'));
    }
  }

  static async fetch_by_account_id(
    account_id: string
  ): Promise<Result<Payment[], ApplicationError>> {
    try {
      const payments = await db.payment.findMany({
        where: { account_id },
        include: {
          payment_method: true,
          payment_method_processor: true,
        },
        orderBy: { date: 'desc' },
      });

      return Result.success(payments.map((p) => new Payment(p)));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to fetch payments'));
    }
  }

  static async fetch_by_subscription_id(
    subscription_id: string
  ): Promise<Result<Payment[], ApplicationError>> {
    try {
      const payments = await db.payment.findMany({
        where: { subscription_id },
        include: {
          payment_method: true,
          payment_method_processor: true,
        },
        orderBy: { date: 'desc' },
      });

      return Result.success(payments.map((p) => new Payment(p)));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to fetch payments'));
    }
  }

  static async fetch_by_billing_cycle_id(
    billing_cycle_id: string
  ): Promise<Result<Payment[], ApplicationError>> {
    try {
      const payments = await db.payment.findMany({
        where: { billing_cycle_id },
        include: {
          payment_method: true,
          payment_method_processor: true,
        },
        orderBy: { date: 'desc' },
      });

      return Result.success(payments.map((p) => new Payment(p)));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to fetch payments'));
    }
  }

  static async fetch_scheduled(date_before?: Date): Promise<Result<Payment[], ApplicationError>> {
    try {
      const payments = await db.payment.findMany({
        where: {
          status: PaymentStatus.SCHEDULED,
          date: date_before ? { lte: date_before } : undefined,
        },
        include: {
          payment_method: true,
          payment_method_processor: true,
        },
        orderBy: { date: 'asc' },
      });

      return Result.success(payments.map((p) => new Payment(p)));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to fetch scheduled payments'));
    }
  }

  static async update(
    id: string,
    input: UpdatePaymentInput
  ): Promise<Result<Payment, ApplicationError>> {
    try {
      const payment = await db.payment.update({
        where: { id },
        data: input,
      });

      return Result.success(new Payment(payment));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to update payment'));
    }
  }

  static async delete(id: string): Promise<Result<Payment, ApplicationError>> {
    try {
      const payment = await db.payment.delete({
        where: { id },
      });

      return Result.success(new Payment(payment));
    } catch (error) {
      return Result.fail(new DatabaseError(error, 'Failed to delete payment'));
    }
  }
}

@ObjectType()
export class PaymentResponse extends Response(Payment) {}
