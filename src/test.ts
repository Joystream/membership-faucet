
import { blake2AsHex } from '@polkadot/util-crypto'

console.log(blake2AsHex('0xfeed'))
// console.log(blake2AsHex(Buffer.from('0xfeed'))) // what user intended
console.log(blake2AsHex('0xada5'))
// console.log(blake2AsHex(Buffer.from('0xada5'))) // what user intended

console.log(Buffer.from([254, 237]).toString('utf16le'))
console.log(Buffer.from([254, 237]).toString('utf-8'))


console.log(Buffer.from([173, 165]).toString('utf16le'))


let str = Buffer.from('A', 'utf16le').toString('utf16le')
console.log(blake2AsHex(str))
console.log(blake2AsHex('A'))