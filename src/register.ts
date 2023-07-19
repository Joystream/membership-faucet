import { ErrorWithData, JoyApi } from './joyApi'
import { EventRecord } from '@polkadot/types/interfaces'
import { decodeAddress } from '@polkadot/keyring'
import { log, error } from './debug'
import BN from 'bn.js'
import { MemberId } from '@joystream/types/primitives'
import type { Hash } from '@polkadot/types/interfaces/runtime'
import { getDataFromEvent } from './utils'
import { sendEmailAlert } from './emailAlert'
import { InMemoryRateLimiter } from 'rolling-rate-limiter'
import { MembershipMetadata } from '@joystream/metadata-protobuf'
import IExternalResource = MembershipMetadata.IExternalResource
import {
  ENABLE_API_THROTTLING,
  CAPTCHA_BYPASS_KEY,
  GLOBAL_API_LIMIT_INTERVAL_HOURS,
  GLOBAL_API_LIMIT_MAX_IN_INTERVAL,
  HCAPTCHA_ENABLED,
  MAX_HANDLE_LENGTH,
  MIN_HANDLE_LENGTH,
  PER_IP_API_LIMIT_INTERVAL_HOURS,
  PER_IP_API_LIMIT_MAX_IN_INTERVAL,
} from './config'
import { verifyCaptcha } from './captcha'

// global rate limit
const globalLimiter = new InMemoryRateLimiter({
  interval: GLOBAL_API_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: GLOBAL_API_LIMIT_MAX_IN_INTERVAL,
})

// per ip rate limit to apply after input validation checks
const ipLimiter = new InMemoryRateLimiter({
  interval: PER_IP_API_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: PER_IP_API_LIMIT_MAX_IN_INTERVAL,
})

// very aggressive ip limit for failed authentication
const authLimiter = new InMemoryRateLimiter({
  interval: 1 * 60 * 60 * 1000, // milliseconds
  maxInInterval: 3,
})

function memberIdFromEvent(events: EventRecord[]): MemberId | undefined {
  return getDataFromEvent(events, 'members', 'MembershipGifted', 0)
}

export type RegisterCallback = (result: any, statusCode: number) => void

export type RegisterBlockData =
  | { block: null }
  | { block: number; blockHash: Hash }
export type RegisterResult = {
  memberId?: number
} & RegisterBlockData

export async function register(
  ip: string,
  joy: JoyApi,
  account: string,
  handle: string,
  name: string | undefined,
  avatar: string | undefined,
  about: string,
  externalResources: IExternalResource[],
  captchaToken: string | undefined,
  captchaBypassKey: string | undefined,
  callback: RegisterCallback
) {

  let canBypass = false
  // Check if request is authorized to bypass captcha verification and ip rate limits
  if ((HCAPTCHA_ENABLED || ENABLE_API_THROTTLING) && captchaBypassKey && CAPTCHA_BYPASS_KEY) {
    const wasBlockedIp = await authLimiter.limit(`${ip}-auth`)
    if((captchaBypassKey !== CAPTCHA_BYPASS_KEY) || wasBlockedIp) {
      callback(
        {
          error: 'Unauthorized', // keep it general, no need to reveal if throttle or bad key
        },
        403
      )
      log(`Too many failed auth attempts from ${ip}`)
      return
    } else {
      authLimiter.clear(`${ip}-auth`)
      canBypass = true
    }
  }

  // verify captcha if enabled
  if (HCAPTCHA_ENABLED && !canBypass) {
    if (!captchaToken) {
      callback(
        {
          error: 'MissingCaptchaToken',
        },
        400
      )
      return
    } else {
      const captchaResult = await verifyCaptcha(captchaToken)
      if (captchaResult !== true) {
        log('captcha verification failed')
        callback(
          {
            error: 'InvalidCaptchaToken',
            errorCodes: captchaResult,
          },
          400
        )
        return
      }
    }
  }

  await joy.init

  // Validate address
  try {
    decodeAddress(account)
  } catch (err) {
    log('invalid address supplied')
    callback(
      {
        error: 'InvalidAddress',
      },
      400
    )
    return
  }

  // Ensure nonce = 0 and balance = 0 for account
  if (!(await joy.isFreshAccount(account))) {
    callback(
      {
        error: 'OnlyNewAccountsCanBeUsedForScreenedMembers',
      },
      400
    )
    return
  }

  const minHandleLength = new BN(MIN_HANDLE_LENGTH)
  const maxHandleLength = new BN(MAX_HANDLE_LENGTH)

  if (maxHandleLength.ltn(handle.length)) {
    callback(
      {
        error: 'HandleTooLong',
      },
      400
    )
    return
  }

  if (minHandleLength.gtn(handle.length)) {
    callback(
      {
        error: 'HandleTooShort',
      },
      400
    )
    return
  }

  // Ensure handle is unique
  if (await joy.handleIsAlreadyRegistered(handle)) {
    log('handle already registered')
    callback(
      {
        error: 'HandleAlreadyRegistered',
      },
      400
    )
    return
  }

  const handleRegisterError = (err: unknown) => {
    error(err)
    if (err instanceof ErrorWithData) {
      callback(err.data, err.code)
    } else {
      callback(
        {
          error: 'InternalServerError',
        },
        500
      )
    }
  }

  const giftMembershipTx = joy.makeGiftMembershipTx({
    account,
    handle,
    avatar,
    name,
    about,
    externalResources,
  })

  // Check inviting key has balance to gift new member
  const canInviteMember = await joy.invitingAccountHasFundsToGift(
    giftMembershipTx
  )

  if (!canInviteMember) {
    // log faucet exhausted
    log('Faucet exhausted')

    // send email alert faucet is exhausted
    sendEmailAlert('Faucet is exhausted')

    return callback('FaucetExhausted', 400)
  }

  // Do throttling after all input validation checks to avoid DoS attack by someone repeatedly
  // trying to register with most likely outcome being unsuccsessful.
  if (ENABLE_API_THROTTLING && !canBypass) {
    // apply limit per ip address
    const wasBlockedIp = await ipLimiter.limit(`${ip}-register`)
    if (wasBlockedIp) {
      log(`${ip} was throttled`)
      return callback({ error: 'TooManyRequestsPerIp' }, 429)
    }

    // apply global api call limit
    const wasBlockedGlobal = await globalLimiter.limit('global-register')
    if (wasBlockedGlobal) {
      log('global throttled')
      return callback({ error: 'TooManyRequests' }, 429)
    }
  }

  let memberId: MemberId | undefined
  let registeredAtBlock: RegisterBlockData

  try {
    const result = await joy.sendAndProcessTx(giftMembershipTx)
    memberId = memberIdFromEvent(result.events)
    log('Created New member id:', memberId?.toNumber(), 'handle:', handle)

    // Try to include block information
    const blockHash = result.status.asInBlock
    try {
      const blockNumber = await joy.blockHeightFromHash(blockHash)
      registeredAtBlock = { block: blockNumber, blockHash }
    } catch (reason) {
      error('Failed to get extrinsic block number', reason)
      registeredAtBlock = { block: null }
    }
  } catch (err) {
    handleRegisterError(err)
    sendEmailAlert(`Failed to register new member. ${err}`)
    return
  }

  let result: RegisterResult = {
    memberId: memberId?.toNumber(),
    ...registeredAtBlock,
  }
  callback(result, 200)
}
