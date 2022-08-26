function readEnvInt<T>(key: string, defaultValue: T): number | T {
  const value = process.env[key]
  if (value) {
    return parseInt(value)
  } else {
    return defaultValue
  }
}

export const PORT = parseInt(process.env.PORT || '3002')
export const WS_PROVIDER = process.env.PROVIDER
export const SCREENING_AUTHORITY_SEED = process.env.INVITER_KEY || '//Alice'

export const BALANCE_CREDIT = readEnvInt('BALANCE_CREDIT', null)
export const BALANCE_LOCKED = readEnvInt('BALANCE_LOCKED', null)

export const GLOBAL_API_LIMIT_INTERVAL_HOURS = readEnvInt(
  'GLOBAL_API_LIMIT_INTERVAL_HOURS',
  1
)
export const GLOBAL_API_LIMIT_MAX_IN_INTERVAL = readEnvInt(
  'GLOBAL_API_LIMIT_MAX_IN_INTERVAL',
  10
)
export const PER_IP_API_LIMIT_INTERVAL_HOURS = readEnvInt(
  'PER_IP_API_LIMIT_INTERVAL_HOURS',
  48
)
export const PER_IP_API_LIMIT_MAX_IN_INTERVAL = readEnvInt(
  'PER_IP_API_LIMIT_MAX_IN_INTERVAL',
  1
)

export const ENABLE_API_THROTTLING = (() => {
  const enable = process.env.ENABLE_API_THROTTLING
  return (
    enable && ['true', 'yes', 'y', '1', 'on'].includes(enable.toLowerCase())
  )
})()

export const MIN_HANDLE_LENGTH = 1
export const MAX_HANDLE_LENGTH = 100

export const EMAIL_ALERTS_LIMIT_INTERVAL_HOURS = readEnvInt(
  'EMAIL_ALERTS_LIMIT_INTERVAL_HOURS',
  1
)
export const EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL = readEnvInt(
  'EMAIL_ALERTS_LIMIT_MAX_IN_INTERVAL',
  5
)
// When API key is not set console logs a warning: API key does not start with "SG.".
// Send can still be attempted but we will most likely fail with 401 error response not authorized
// unless ip address based authentication is configured.
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
// Validated sender address
export const ALERT_FROM_EMAIL = process.env.ALERT_FROM_EMAIL || ''
// For multiple emails messages use a comma separated list. It is preferable
// to use a single address of a distribution list to send alerts to multiple users if possible.
export const ALERT_TO_EMAIL = process.env.ALERT_TO_EMAIL
