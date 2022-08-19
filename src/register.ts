import { ErrorWithData, JoyApi } from "./joyApi";
import { EventRecord } from "@polkadot/types/interfaces";
import { decodeAddress } from "@polkadot/keyring";
import { log, error } from "./debug";
import BN from "bn.js";
import { MemberId } from "@joystream/types/primitives";
import type { Hash } from '@polkadot/types/interfaces/runtime';
import { getDataFromEvent } from "./utils";
import { sendEmailAlert } from "./emailAlert";
import { InMemoryRateLimiter } from "rolling-rate-limiter";
import {MembershipMetadata} from "@joystream/metadata-protobuf";
import IExternalResource = MembershipMetadata.IExternalResource;



const GLOBAL_API_LIMIT_INTERVAL_HOURS = parseInt(process.env.GLOBAL_API_LIMIT_INTERVAL_HOURS || '') || 1
const GLOBAL_API_LIMIT_MAX_IN_INTERVAL = parseInt(process.env.GLOBAL_API_LIMIT_MAX_IN_INTERVAL || '') || 10

const PER_IP_API_LIMIT_INTERVAL_HOURS = parseInt(process.env.PER_IP_API_LIMIT_INTERVAL_HOURS || '') || 48
const PER_IP_API_LIMIT_MAX_IN_INTERVAL = parseInt(process.env.PER_IP_API_LIMIT_MAX_IN_INTERVAL || '') || 1

const ENABLE_API_THROTTLING = (() => {
  const enable = process.env.ENABLE_API_THROTTLING || ''
  return ['true', 'TRUE', 'yes', 'y', '1', 'on', 'ON'].indexOf(enable) !== -1
})()

// global rate limit
const globalLimiter = new InMemoryRateLimiter({
  interval: GLOBAL_API_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: GLOBAL_API_LIMIT_MAX_IN_INTERVAL,
});

// per ip rate limit
const ipLimiter = new InMemoryRateLimiter({
  interval: PER_IP_API_LIMIT_INTERVAL_HOURS * 60 * 60 * 1000, // milliseconds
  maxInInterval: PER_IP_API_LIMIT_MAX_IN_INTERVAL,
});

const MIN_HANDLE_LENGTH = 1;
const MAX_HANDLE_LENGTH = 100;

function memberIdFromEvent(events: EventRecord[]): MemberId | undefined {
  return getDataFromEvent(events, 'members', 'MembershipGifted', 0)
}

export type RegisterCallback = (result: any, statusCode: number) => void

export type RegisterBlockData = { block: null } | { block: number, blockHash: Hash }
export type RegisterResult = {
  memberId?: MemberId,
} & RegisterBlockData

export interface CaptchaResponse {
  success: boolean,         // is the passcode valid, and does it meet security criteria you specified, e.g. sitekey?
  challenge_ts: string,     // timestamp of the challenge (ISO format yyyy-MM-dd'T'HH:mm:ssZZ)
  hostname: string,         // the hostname of the site where the challenge was solved
  credit?: boolean,         // optional: whether the response will be credited
  'error-codes'?: string[]  // optional: any error codes
  // score: number,         // ENTERPRISE feature: a score denoting malicious activity.
  // score_reason: [...]    // ENTERPRISE feature: reason(s) for score.
}

export async function register(ip: string, joy: JoyApi, account: string, handle: string, name: string | undefined, avatar: string | undefined, about: string, externalResources: IExternalResource[], captchaToken: string, callback: RegisterCallback) {
  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: `response=${captchaToken}&secret=${process.env.CAPTCHA_SITE_KEY}`
    }).then(res => res.json()) as CaptchaResponse

    if(!response.success) {
      callback({
        error: 'InvalidCaptchaToken'
      }, 400)
      return
    }
  } catch (err) {
    log('failed on hcaptcha server request')
    callback({
      error: 'CaptchaServerError'
    }, 500)
  }

  await joy.init

  // Validate address
  try {
    decodeAddress(account)
  } catch (err) {
    log('invalid address supplied')
    callback({
      error: 'InvalidAddress',
    }, 400)
    return
  }

  // Ensure nonce = 0 and balance = 0 for account
  if (!(await joy.isFreshAccount(account))) {
    callback({
      error: 'OnlyNewAccountsCanBeUsedForScreenedMembers'
    }, 400)
    return
  }

  const minHandleLength = new BN(MIN_HANDLE_LENGTH)
  const maxHandleLength = new BN(MAX_HANDLE_LENGTH)

  if(maxHandleLength.ltn(handle.length)) {
    callback({
      error: 'HandleTooLong'
    }, 400)
    return
  }

  if(minHandleLength.gtn(handle.length)) {
    callback({
      error: 'HandleTooShort'
    }, 400)
    return
  }

  // Ensure handle is unique
  if (await joy.handleIsAlreadyRegistered(handle)) {
    log('handle already registered')
    callback({
      error: 'HandleAlreadyRegistered',
    }, 400)
    return
  }

  const handleRegisterError = (err: unknown) => {
    error(err)
    if (err instanceof ErrorWithData) {
      callback(err.data, err.code)
    } else {
      callback({
        error: 'InternalServerError'
      }, 500)
    }
  }

  const giftMembershipTx = joy.makeGiftMembershipTx({ account, handle, avatar, name, about, externalResources })

  // Check inviting key has balance to gift new member
  const canInviteMember = await joy.invitingAccountHasFundsToGift(giftMembershipTx)

  if(!canInviteMember) {
    // log faucet exhausted
    log('Faucet exhausted')

    // send email alert faucet is exhausted
    sendEmailAlert("Faucet is exhausted")

    return callback('FaucetExhausted', 400)
  }

  if (ENABLE_API_THROTTLING) {
    // apply limit per ip address
    const wasBlockedIp = await ipLimiter.limit(`${ip}-register`)
    if (wasBlockedIp) {
      log(`${ip} was throttled`)
      return callback("TooManyRequests", 429);
    }

    // apply global api call limit
    const wasBlockedGlobal = await globalLimiter.limit('global-register')
    if (wasBlockedGlobal) {
      log('global throttled')
      return callback("TooManyRequests", 429);
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

  let result: RegisterResult = { memberId, ...registeredAtBlock };
  callback(result, 200)
}

