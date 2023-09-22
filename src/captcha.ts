import { log, error } from './debug'
import { HCAPTCHA_ENDPOINT, HCAPTCHA_SECRET } from './config'
import fetch from 'node-fetch'

export type CaptchaResponse = {
  success: boolean // is the passcode valid, and does it meet security criteria you specified, e.g. sitekey?
  challenge_ts: string // timestamp of the challenge (ISO format yyyy-MM-dd'T'HH:mm:ssZZ)
  hostname: string // the hostname of the site where the challenge was solved
  credit?: boolean // optional: whether the response will be credited
  'error-codes'?: string[] // optional: any error codes
}

const observedTokens = new Set()

export async function verifyCaptcha(
  token: string
): Promise<true | undefined | string[]> {
  if (!HCAPTCHA_SECRET) {
    return true
  }

  log('Verifying Captcha token:', token)
  if (observedTokens.has(token)) {
    log('Captcha token already used')
    return ['token-already-used']
  } else {
    observedTokens.add(token)
  }

  const formData = new URLSearchParams()
  formData.append('secret', HCAPTCHA_SECRET)
  formData.append('response', token)

  try {
    const response = await fetch(HCAPTCHA_ENDPOINT, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const data = (await response.json()) as CaptchaResponse
    if (data.success) {
      log('Captcha valid:', data.hostname, data.challenge_ts)
      return true
    } else {
      log('Captcha invalid:', data['error-codes'])
      return data['error-codes']
    }
  } catch (e) {
    error('Captcha verification error:', e)
    return ['unexpected-error']
  }
}
