/**
 * The Stripe account DealerTech bills from.
 *
 * Its own account, separate from anything else under the same login — which is
 * why this constant exists rather than being assumed. A dashboard URL without
 * an account segment opens whichever account was last viewed, and during a
 * support call that is the wrong business's data on screen.
 *
 * Not a secret: an account id identifies, it does not authorise. The keys are
 * in the environment.
 */
export const STRIPE_ACCOUNT_ID = 'acct_1U57SyKD1OmZb0LX'
