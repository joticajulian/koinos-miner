const { ethers } = require("ethers");

function uint256ToString(i) {
   let iStr = i.toString(16);
   return `0x${"0".repeat(64 - iStr.length)}${iStr}`;
 }

const coprimes = [
  BigInt("0x0000fffd"),
  BigInt("0x0000fffb"),
  BigInt("0x0000fff7"),
  BigInt("0x0000fff1"),
  BigInt("0x0000ffef"),
  BigInt("0x0000ffe5"),
  BigInt("0x0000ffdf"),
  BigInt("0x0000ffd9"),
  BigInt("0x0000ffd3"),
  BigInt("0x0000ffd1"),
];

const bufLength = BigInt("0x0000ffff");

function getSecuredHash(input) {
   const {recipients, splitPercents, blockNumber, blockHash, target, powHeight} = input;
   const types = ["address[]", "uint256[]", "uint256", "uint256", "uint256", "uint256"];
   const values = [recipients, splitPercents, blockNumber, blockHash, target, powHeight];
   const securedHash = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(types, values));
   return securedHash;
}

function work(input){
   const { blockHash, nonce} = input;
   const securedHash = BigInt(getSecuredHash(input));
   const nonceInt = BigInt(nonce);

   let w = 0n;
   let x = 0n;
   let y = 0n;
   let result = securedHash;
   const words = [];

   const coeff_0 = (nonceInt % coprimes[0])+1n;
   const coeff_1 = (nonceInt % coprimes[1])+1n;
   const coeff_2 = (nonceInt % coprimes[2])+1n;
   const coeff_3 = (nonceInt % coprimes[3])+1n;
   const coeff_4 = (nonceInt % coprimes[4])+1n;

   coprimes.forEach(coprime => {
     x = securedHash % coprime;
     y = coeff_4;
     y *= x;
     y += coeff_3;
     y *= x;
     y += coeff_2;
     y *= x;
     y += coeff_1;
     y *= x;
     y += coeff_0;
     y %= bufLength;
     w = BigInt(ethers.utils.keccak256( ethers.utils.defaultAbiCoder.encode( ["uint256", "uint256"], [blockHash, uint256ToString(y)] ) ) );
     words.push(uint256ToString(w));
     result ^= w;
   });

   const findDuplicates = words.filter((item, index) => words.indexOf(item) !== index);
   if(findDuplicates.length > 0) throw new Error("Non-unique work components");

   result = uint256ToString(result);
   return result;
 }

 module.exports = {
   uint256ToString,
   getSecuredHash,
   work,
 };
