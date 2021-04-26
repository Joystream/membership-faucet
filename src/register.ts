import { JoyApi } from "./joyApi";
import { EventRecord } from '@polkadot/types/interfaces';
import { MemberId } from '@joystream/types/members';
import { decodeAddress } from '@polkadot/keyring'
import { log } from './debug';
import { DispatchError } from '@polkadot/types/interfaces/system'
import { TypeRegistry } from '@polkadot/types'

function memberIdFromEvent(events: EventRecord[]): MemberId | undefined {
  const record = events.find((record) => record.event.section === "members" && record.event.method === "MemberRegistered")
  if (record) {
    return record.event.data[0] as MemberId
  } else {
    return undefined
  }
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

  // validate handle
  const minHandleLength = await joy.api.query.members.minHandleLength()
  const maxHandleLength = await joy.api.query.members.maxHandleLength()

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

