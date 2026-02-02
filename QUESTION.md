## Your task

We have a subscription billing/payment system where customers pay monthly. Sometimes payments fail - the card gets declined, there's insufficient funds, or network issues occur. We want you to implement a **payment retry system**.
When a payment fails, the system should be able to retry it. You should already have a good understanding of the codebase & structure, you may ask clarifying questions, and you should implement your solution.

Time is of the essence, do not be shy to leverage your AI agent to help you. If you are unable to finish, try to do as much as you can.

## Requirements

Implement a one or multiple functions that will retry immediately or on a different day a new payment when the `handle_failed_pull_funds` is called.

The retry/reschedule function should behave in the following way:

### Reschedule Actions

- **Immediate retry**: Retry the payment on the same day
- **Reschedule to Next Friday or Balance Due Date**: Reschedule to whichever comes first - the next Friday or the next credit line balance due date
- **Reschedule to Next Friday EOM or Balance Due Date**: Reschedule to whichever comes first - the next Friday at end of month, or the next credit line balance due date
- **Alert & backoff**: Send an alert notification, do not reschedule
- **Backoff**: Do not reschedule, no alert

### Payment Method Fallback

When retrying, the system should attempt with a specific payment method:

- **card**: Use customer's card on file
- **bank card**: Try bank account first, fall back to card
- **null**: No payment method change (terminal state)

### Retry Rules by Fail Code

#### General Fail Codes

| Code | Description                  | 0-30D                 | 31-60D                | 61-180D               | 181D+         |
| ---- | ---------------------------- | --------------------- | --------------------- | --------------------- | ------------- |
| 904  | External (processor) Failure | Immediate retry, card | Immediate retry, card | Immediate retry, card | Backoff, null |
| 903  | Internal Failure             | Alert & backoff, null | Alert & backoff, null | Backoff, null         | Backoff, null |

#### Card Fail Codes

| Code         | Description                        | 0-30D                                        | 31-60D                                       | 61-180D                                      | 181D+         |
| ------------ | ---------------------------------- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------- |
| 440          | No more valid debit card           | Alert & backoff, null                        | Alert & backoff, null                        | Backoff, null                                | Backoff, null |
| 441          | No remaining debit card processors | Reschedule Friday/Balance Due, bank card     | Reschedule Friday/Balance Due, bank card     | Reschedule Friday EOM/Balance Due, bank card | Backoff, null |
| 444          | No more valid any card             | Not Possible                                 | Not Possible                                 | Not Possible                                 | Not Possible  |
| 445          | No remaining any card processors   | Not Possible                                 | Not Possible                                 | Not Possible                                 | Not Possible  |
| 601          | Soft block                         | Reschedule Friday EOM/Balance Due, bank card | Reschedule Friday EOM/Balance Due, bank card | Backoff, null                                | Backoff, null |
| 603-607, 777 | Hard block                         | Alert & backoff, null                        | Alert & backoff, null                        | Backoff, null                                | Backoff, null |
| 701          | NSF (Insufficient Funds)           | Reschedule Friday/Balance Due, bank card     | Reschedule Friday/Balance Due, bank card     | Reschedule Friday EOM/Balance Due, bank card | Backoff, null |
| 706          | Retry Later                        | Reschedule Friday/Balance Due, bank card     | Reschedule Friday/Balance Due, bank card     | Reschedule Friday EOM/Balance Due, bank card | Backoff, null |

#### EFT Fail Codes

| Code          | Description                | 0-30D        | 31-60D       | 61-180D      | 181D+        |
| ------------- | -------------------------- | ------------ | ------------ | ------------ | ------------ |
| 442           | No more EFT processor      | Not Possible | Not Possible | Not Possible | Not Possible |
| 443           | No more EFT payment method | Not Possible | Not Possible | Not Possible | Not Possible |
| 613, 615, 616 | EFT Hard Block             | Not Possible | Not Possible | Not Possible | Not Possible |
| 640           | EFT Generic Fail           | Not Possible | Not Possible | Not Possible | Not Possible |
| 710           | EFT NSF                    | Not Possible | Not Possible | Not Possible | Not Possible |

### Special Conditions

1. For codes 904, 441, 601, 701, 706 in the 31-60D range: If `total_retry_cnt > 8`, exclude Stripe as a processor option
2. For codes 441, 701, 706 in the 61-180D range: If `total_retry_cnt > 12`, change behavior to Backoff with no retry

### "Not Possible" Handling

When the retry action is "Not Possible", the function should raise an exception or return an error indicating that no retry is possible for this failure type.

## Starting Point

Look at the existing codebase to understand:

- How subscriptions are structured
- How payment failures are currently handled
- The `handle_failed_pull_funds` function signature

## Evaluation Criteria

1. **Correctness**: Does your implementation match the retry table logic?
2. **Code Quality**: Is the code readable, maintainable, and well-structured?
3. **Edge Cases**: How do you handle invalid inputs, missing data, or boundary conditions?
4. **Testing**: Can you explain how you would test this implementation?

## Questions to Consider

- How would you structure the retry rules to make them easy to modify?
- What happens if a subscription doesn't have a valid payment method?
- How would you log or monitor retry attempts for debugging?
