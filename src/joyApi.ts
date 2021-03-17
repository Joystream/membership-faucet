import { WsProvider, ApiPromise } from "@polkadot/api";
import { types } from "@joystream/types";
import { Callback, ISubmittableResult } from '@polkadot/types/types'
import { Keyring } from "@polkadot/keyring";
import { config } from "dotenv";
import BN from "bn.js";

// Init .env config
config();

const endowment = process.env.ENDOWMENT || ''
const ENDOWMENT = new BN(parseInt(endowment))

export class JoyApi {
  endpoint: string;
  isReady: Promise<ApiPromise>;
  api!: ApiPromise;
  keyring: Keyring;

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
      this.keyring.addFromUri(screeningAuthoritySeed, undefined, 'sr25519');
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
    const storageSize = await this.api.query.members.memberIdByHandle.size(handle)
    return !storageSize.eq(0)
  }

  async isFreshAccount(address: string): Promise<boolean> {
    const nonce = await this.api.rpc.system.accountNextIndex(address)
    const balance = (await this.api.derive.balances.all(address)).freeBalance
    return nonce.eq(0) && balance.eqn(0)
  }

  async addScreenedMember(account: string, handle: string, callback: Callback<ISubmittableResult>) {
    const authAccountId = await this.api.query.members.screeningAuthority()
    const addr = this.keyring.encodeAddress(authAccountId)
    let keyPair
    try {
      keyPair = this.keyring.getPair(addr)
    } catch (err) {
      throw new Error('Screening Authority Key Not Found In Keyring')
    }

    await this.api.tx.members.addScreenedMember(account, handle, null, null, ENDOWMENT).signAndSend(
      keyPair,
      callback
    )
  }
}
