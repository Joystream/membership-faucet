import { JoyApi } from "./joyApi";
import { EventRecord } from '@polkadot/types/interfaces';
import { decodeAddress } from '@polkadot/keyring'
import { log } from './debug';
import { DispatchError } from '@polkadot/types/interfaces/system'
import { TypeRegistry } from '@polkadot/types'
import BN from 'bn.js'
import { MemberId } from '@joystream/types/common'
import {AugmentedEvent, AugmentedEvents} from '@polkadot/api/types'

// TODO: Move data from a library
export type ExtractTuple<P> = P extends AugmentedEvent<'rxjs', infer T> ? T : never

export const getDataFromEvent = <
    Module extends keyof AugmentedEvents<'rxjs'>,
    Event extends keyof AugmentedEvents<'rxjs'>[Module],
    Tuple extends ExtractTuple<AugmentedEvents<'rxjs'>[Module][Event]>,
    Index extends keyof Tuple
    >(
    events: EventRecord[],
    module: Module,
    eventName: Event,
    index: Index = 0 as Index
): Tuple[Index] | undefined => {
  const eventRecord = events.find((event) => event.event.method === eventName)

  if (!eventRecord) {
    return
  }

  const data = eventRecord.event.data as unknown as Tuple

  return data[index]
}


function memberIdFromEvent(events: EventRecord[]): MemberId | undefined {
  return getDataFromEvent(events, 'members', 'MemberInvited', 0)
}

export type RegisterCallback = (result: any, statusCode: number) => void

export async function register(joy: JoyApi, account: string, handle: string, avatar: string, about: string, callback: RegisterCallback) {
  await joy.init
  const { api } = joy

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

  // validate handle @todo
  const minHandleLength = new BN(3) // await joy.api.query.members.minHandleLength()
  const maxHandleLength = new BN(20) // await joy.api.query.members.maxHandleLength()

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

  try {
    const unsubscribe = await joy.addScreenedMember(account, handle, avatar, about, (result) => {
      if (!result.isCompleted) {
        return
      }

      unsubscribe()

      if (result.isError) {
        log('Failed to register:', result)
        const { isDropped, isFinalityTimeout, isInvalid, isUsurped } = result.status
        callback({
          error: 'TransactionError',
          reason: {
            isDropped,
            isFinalityTimeout,
            isInvalid,
            isUsurped,
          },
        }, 400)
        return
      }

      const success = result.findRecord('system', 'ExtrinsicSuccess')
      const failed = result.findRecord('system', 'ExtrinsicFailed')

      if(success) {
        let memberId = memberIdFromEvent(result.events)
        log('Created New member id:', memberId?.toNumber(), 'handle:', handle)

        const blockHash = result.status.asInBlock
        joy.blockHeightFromHash(blockHash)
          .then((blockNumber) => {
            callback({
              memberId,
              block: blockNumber,
              blockHash
            }, 200)
          })
          .catch((reason) => {
            log('Failed to get extrinsic block number', reason)
            callback({
              memberId,
              block: null,
            }, 200)
          })
      } else {
        let errMessage = 'UnknownError'
        const record = failed as EventRecord
        const {
          event: { data },
        } = record
        const err = data[0] as DispatchError
        if (err.isModule) {
          const { name } = (api.registry as TypeRegistry).findMetaError(err.asModule)
          errMessage = name
        }
        log('Failed to register:', errMessage)
        callback({
          error: errMessage,
        }, 400)
      }
    })
  } catch (err) {
    log(err)
    callback({
      error: 'InternalServerError'
    }, 500)
  }
}

