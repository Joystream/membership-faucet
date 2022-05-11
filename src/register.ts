import { BALANCE_TOP_UP_AMOUNT, ErrorWithData, JoyApi } from "./joyApi";
import { EventRecord } from "@polkadot/types/interfaces";
import { decodeAddress } from "@polkadot/keyring";
import { log, error } from "./debug";
import BN from "bn.js";
import { Hash, MemberId} from "@joystream/types/common";
import { getDataFromEvent } from "./utils";
import { formatBalance } from "@polkadot/util";
import { sendEmailAlert } from "./emailAlert";
import { InMemoryRateLimiter } from "rolling-rate-limiter";

// global rate limit
const rollingLimiter = new InMemoryRateLimiter({
  interval: 1 * 60 * 60 * 1000, // milliseconds
  maxInInterval: 10,
});

const MIN_HANDLE_LENGTH = 1;
const MAX_HANDLE_LENGTH = 100;

function memberIdFromEvent(events: EventRecord[]): MemberId | undefined {
  return getDataFromEvent(events, 'members', 'MemberInvited', 0)
}

export type RegisterCallback = (result: any, statusCode: number) => void

export type RegisterBlockData = { block: null } | { block: number, blockHash: Hash }
export type RegisterResult = {
  memberId?: MemberId,
  topUpSuccessful: boolean
} & RegisterBlockData

export async function register(joy: JoyApi, account: string, handle: string, name: string | undefined, avatar: string | undefined, about: string, callback: RegisterCallback) {
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

  // Check inviting members has invites
  const hasInvites = await joy.invitingMemberHasInvites()
  // Check inviting member has balance to top up new member account
  const hasBalance = await joy.invitingMemberHasTopUpBalance()
  // Check membership working group has budget
  const workingGroupHasBudget = await joy.workingGroupHasBudget()

  const canInviteMember = hasInvites && hasBalance && workingGroupHasBudget

  if(!canInviteMember) {
    // send email alert faucet is exhausted
    sendEmailAlert(`Faucet is exhausted
Inviting member has enough invites: ${hasInvites}
Inviting member has enough topup balance: ${hasBalance}
Members Working group has sufficient budget: ${workingGroupHasBudget}
    `)

    return callback('FaucetExhausted', 400)
  }

  // apply limit for global api call
  const wasBlocked = await rollingLimiter.limit('register')
  if (wasBlocked) {
      return callback("TooManyRequests", 429);
  }

  let memberId: MemberId | undefined
  let registeredAtBlock: RegisterBlockData
  let topUpSuccessful: boolean = false

  try {
    const result = await joy.addScreenedMember({account, handle, name, avatar, about})
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

  if (BALANCE_TOP_UP_AMOUNT) {
    try {
      await joy.topUpBalance(account)
      log('Balance of account :', account, 'topped up with:', formatBalance(BALANCE_TOP_UP_AMOUNT))
      topUpSuccessful = true
    } catch (err) {
      topUpSuccessful = false
      error('Failed to top up balance of account:', account, 'Error:', err)
      sendEmailAlert(`Failed to top up balance for new account ${account}. ${err}`)
    }
  }

  let result: RegisterResult = { memberId, ...registeredAtBlock, topUpSuccessful };
  callback(result, 200)
}

