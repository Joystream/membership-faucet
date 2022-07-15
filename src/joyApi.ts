import { ApiPromise, WsProvider } from "@polkadot/api";
import { createType, types } from "@joystream/types";
import { Hash } from "@joystream/types/common";
import { Callback, ISubmittableResult } from "@polkadot/types/types";
import { Keyring } from "@polkadot/keyring";
import { config } from "dotenv";
import { blake2AsHex } from "@polkadot/util-crypto";
import { KeyringPair } from "@polkadot/keyring/types";
import { MembershipMetadata } from "@joystream/metadata-protobuf";
import { SubmittableExtrinsic } from "@polkadot/api/types";
import { DispatchError } from "@polkadot/types/interfaces/system";
import { error } from "./debug";
import IExternalResource = MembershipMetadata.IExternalResource;

// Init .env config
config();

export const BALANCE_TOP_UP_AMOUNT = parseInt(process.env.BALANCE_TOP_UP_AMOUNT || '')

export class ErrorWithData extends Error {
  code: number = 400;
  additionalData: Record<string, unknown> = {}

  get data() {
    return {
      error: this.message,
      ...this.additionalData
    }
  }
}

export class TransactionError extends ErrorWithData {
  constructor(data: Record<string, unknown>) {
    super('TransactionError')
    this.additionalData = data
  }
}

export class TransactionProcessingError extends ErrorWithData {}

interface NewMember {
  account: string
  handle: string
  avatar?: string
  about?: string
  name?: string
  externalResources?: IExternalResource[]
}

export class JoyApi {
  endpoint: string;
  isReady: Promise<ApiPromise>;
  api!: ApiPromise;
  keyring: Keyring;
  signingPair?: KeyringPair;

  constructor(endpoint?: string) {
    this.keyring = new Keyring()
    const wsEndpoint =
      endpoint || process.env.PROVIDER || "ws://127.0.0.1:9944";
    this.endpoint = wsEndpoint;
    this.isReady = (async () => {
      const api = await new ApiPromise({ provider: new WsProvider(wsEndpoint), types })
        .isReady;
      return api;
    })();
  }
  get init(): Promise<JoyApi> {
    return this.isReady.then((instance) => {
      this.api = instance;
      const screeningAuthoritySeed = process.env.SCREENING_AUTHORITY_SEED || '//Alice'
      // Fails unless we do this after api is ready
      this.signingPair = this.keyring.addFromUri(screeningAuthoritySeed, undefined, 'sr25519');
      return this;
    });
  }

  async systemData() {
    const [chain, nodeName, nodeVersion, peers] = await Promise.all([
      this.api.rpc.system.chain(),
      this.api.rpc.system.name(),
      this.api.rpc.system.version(),
      this.api.rpc.system.peers(),
    ]);

    return {
      chain: chain.toString(),
      nodeName: nodeName.toString(),
      nodeVersion: nodeVersion.toString(),
      peerCount: peers.length,
    };
  }

  async finalizedHash() {
    return this.api.rpc.chain.getFinalizedHead();
  }

  async finalizedBlockHeight() {
    const finalizedHash = await this.finalizedHash();
    const { number } = await this.api.rpc.chain.getHeader(`${finalizedHash}`);
    return number.toNumber();
  }

  async runtimeData() {
    const runtimeVersion = await this.api.rpc.state.getRuntimeVersion(
      `${await this.finalizedHash()}`
    );
    return {
      spec_name: runtimeVersion.specName,
      impl_name: runtimeVersion.implName,
      spec_version: runtimeVersion.specVersion,
    };
  }

  async handleIsAlreadyRegistered(handle: string): Promise<boolean> {
    const handleHash = blake2AsHex(handle)
    const storageSize = await this.api.query.members.memberIdByHandleHash.size(handleHash)
    return !storageSize.eq(0)
  }

  async isFreshAccount(address: string): Promise<boolean> {
    const nonce = await this.api.rpc.system.accountNextIndex(address)
    const balance = (await this.api.derive.balances.all(address)).freeBalance
    return nonce.eq(0) && balance.eqn(0)
  }

  async blockHeightFromHash(blockHash: Hash): Promise<number> {
    const blockHeader = await this.api.rpc.chain.getHeader(blockHash)
    return blockHeader.number.toNumber()
  }

  async addScreenedMember(memberData: NewMember) {
    const invitingMemberId = process.env.INVITING_MEMBER_ID ?? '0'
    const {account, handle, about, name, avatar, externalResources} = memberData

    return this.sendAndProcessTx(this.api.tx.members.inviteMember({
      inviting_member_id: invitingMemberId,
      root_account: account,
      controller_account: account,
      handle: handle,
        metadata: createType('Bytes', '0x' + Buffer.from(MembershipMetadata.encode({
          about: about ?? null,
          name: name ?? null,
          avatarUri: avatar,
          externalResources
        }).finish()).toString('hex')),
    }))
  }

  async topUpBalance(address: string) {
    return this.sendAndProcessTx(this.api.tx.balances.transferKeepAlive(address, BALANCE_TOP_UP_AMOUNT))
  }

  async sendAndProcessTx(tx: SubmittableExtrinsic<'promise'>): Promise<ISubmittableResult> {
    const signingPair = this.signingPair

    if(!signingPair) {
      throw new Error('Inviting Member Key Not Found In Keyring')
    }

    return new Promise(async (resolve, reject) => {
      const callback: Callback<ISubmittableResult> = (result) => {
        if (!result.isCompleted) {
          return
        }

        unsubscribe()

        if (result.isError) {
          error('Transaction failed:', result)
          const { isDropped, isFinalityTimeout, isInvalid, isUsurped } = result.status
          return reject(new TransactionError({
            reason: {
              isDropped,
              isFinalityTimeout,
              isInvalid,
              isUsurped,
            }
          }))
        }

        const success = result.findRecord('system', 'ExtrinsicSuccess')
        const failed = result.findRecord('system', 'ExtrinsicFailed')

        if (success) {
          resolve(result)
        } else if (failed) {
          let errMessage = 'UnknownError'
          const record = failed
          const {
            event: { data },
          } = record
          const err = data[0] as DispatchError
          if (err.isModule) {
            const { name } = this.api.registry.findMetaError(err.asModule)
            errMessage = name
          }
          error('Transaction processing failed:', errMessage)
          reject(new TransactionProcessingError(errMessage))
        } else {
          error('Unexpected extrinsic result:', result);
          reject(new Error('Unexpected extrinsic result'));
        }
      }
      const unsubscribe = await tx.signAndSend(signingPair, callback)
    })
  }

  async invitingMemberHasInvites(): Promise<boolean> {
    const member = await this.api.query.members.membershipById(process.env.INVITING_MEMBER_ID ?? 0)
    return member.invites.toNumber() > 0
  }

  async invitingMemberHasTopUpBalance(): Promise<boolean> {
    const balance = await this.api.derive.balances.all(this.signingPair!.address)
    return balance.freeBalance.toNumber() > BALANCE_TOP_UP_AMOUNT
  }

  async workingGroupHasBudget(): Promise<boolean> {
    const budget = await this.api.query.membershipWorkingGroup.budget()
    return budget.gte(this.api.consts.members.defaultInitialInvitationBalance)
  }
}


