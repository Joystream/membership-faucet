import sendgrid from '@sendgrid/mail'
import { error, log } from './debug'
import { InMemoryRateLimiter } from 'rolling-rate-limiter'
import {
  ALERT_FROM_EMAIL,
  ALERT_TO_EMAIL,
  EMAIL_ALERTS_LIMIT_INTERVAL_HOURS,
  EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL,
  SENDGRID_API_KEY,
} from './config'

// email rate limit
const rollingLimiter = new InMemoryRateLimiter({
  interval: EMAIL_ALERTS_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL,
})

// Reference https://docs.sendgrid.com/for-developers/sending-email/quickstart-nodejs

sendgrid.setApiKey(SENDGRID_API_KEY || '')

export const sendEmailAlert = async (message: string) => {
  if (!(SENDGRID_API_KEY && ALERT_FROM_EMAIL && ALERT_TO_EMAIL)) {
    log('Email alert not sent - not configured')
    return
  }

  const wasBlocked = await rollingLimiter.limit('email')
  if (wasBlocked) {
    return log('Email alert not sent - throttling')
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

  sendgrid
    .send(messages, isMultiple)
    .then(() => {
      log('Sent email alert.')
    })
    .catch((err: any) => {
      error('Failed sending email alert:', err)
    })
}
