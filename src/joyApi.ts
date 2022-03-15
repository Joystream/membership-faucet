import { ApiPromise, WsProvider } from "@polkadot/api";
import { createType, types } from "@joystream/types";
import { Hash } from "@joystream/types/common";
import { Callback, ISubmittableResult } from "@polkadot/types/types";
import { Keyring } from "@polkadot/keyring";
import { config } from "dotenv";
import { blake2AsHex } from "@polkadot/util-crypto";
import { KeyringPair } from "@polkadot/keyring/types";
import { MembershipMetadata } from "@joystream/metadata-protobuf";

// Init .env config
config();

interface NewMember {
  account: string
  handle: string
  avatar?: string
  about?: string
  name?: string
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

  async addScreenedMember(memberData: NewMember, callback: Callback<ISubmittableResult>) {
    if(!this.signingPair) {
      throw new Error('Inviting Member Key Not Found In Keyring')
    }

    const invitingMemberId = process.env.INVITING_MEMBER_ID ?? '0'
    const {account, handle, about, name, avatar} = memberData

    return this.api.tx.members.inviteMember({
      inviting_member_id: invitingMemberId,
      root_account: account,
      controller_account: account,
      handle: handle,
        metadata: createType('Bytes', '0x' + Buffer.from(MembershipMetadata.encode({
          about: about ?? null,
          name: name ?? null,
          avatarUri: avatar,
        }).finish()).toString('hex')),
    }).signAndSend(
      this.signingPair,
      callback
    )
  }
}


