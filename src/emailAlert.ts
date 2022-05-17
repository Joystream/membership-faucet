import sendgrid from '@sendgrid/mail'
import { error, log } from './debug'
import { InMemoryRateLimiter } from "rolling-rate-limiter";

const EMAIL_ALERTS_LIMIT_INTERVAL_HOURS = parseInt(process.env.EMAIL_ALERTS_LIMIT_INTERVAL_HOURS || '') || 1
const EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL = parseInt(process.env.EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL || '') || 5

// email rate limit
const rollingLimiter = new InMemoryRateLimiter({
  interval: EMAIL_ALERTS_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL,
});

// Reference https://docs.sendgrid.com/for-developers/sending-email/quickstart-nodejs

// When API key is not set console logs a warning: API key does not start with "SG.".
// Send can still be attempted but we will most likely fail with 401 error response not authorized
// unless ip address based authentication is configured.
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
// Validated sender address
const ALERT_FROM_EMAIL = process.env.ALERT_FROM_EMAIL
// For multiple emails messages use a comma separated list. It is preferable
// to use a single address of a distribution list to send alerts to multiple users if possible.
const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL

sendgrid.setApiKey(SENDGRID_API_KEY || '')

export const sendEmailAlert = async (message: string) => {
    if (!(SENDGRID_API_KEY && ALERT_FROM_EMAIL && ALERT_TO_EMAIL)) {
        log('Email alert not sent - not configured')
        return
    }

    const wasBlocked = await rollingLimiter.limit('email')
    if (wasBlocked) {
        return log('Email alert not sent - throttling');
    }

    const emails = ALERT_TO_EMAIL.split(',')

    const messages = emails.map((to) => {
        return {
            to,
            from: ALERT_FROM_EMAIL,
            subject: 'Member Faucet Alert',
            text: message,
            html: `<span>${message}</span>`,
        }
    })

    const isMultiple = messages.length > 1

    sendgrid.send(messages, isMultiple)
        .then(() => {
            log('Sent email alert.')
        })
        .catch((err: any) => {
            error('Failed sending email alert:', err)
        })
}
