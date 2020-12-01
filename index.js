'use strict';

var Web3 = require('web3');
var Tx = require('ethereumjs-tx').Transaction;
const os = require('os');
const abi = require('./abi.js');
const crypto = require('crypto');
const {Looper} = require("./looper.js");
const Retry = require("./retry.js");
const MiningPool = require("./MiningPool.js");

function hashString( number ) {
   let numberStr = number.toString(16);
   numberStr = "0x" + "0".repeat(64 - numberStr.length) + numberStr;
   return numberStr;
}

function addressToBytes( addr ) {
   // Convert a string address to bytes
   let ADDRESS_LENGTH = 42;
   if( addr.startsWith("0x") )
      addr = addr.substring(2);
   addr = "0".repeat(ADDRESS_LENGTH - addr.length) + addr;
   return Buffer.from(addr, "hex");
}

/**
 * A simple queue class for request/response processing.
 *
 * Keep track of the information that was used in a request, so we can use it in response processing.
 */
class MiningRequestQueue {
   constructor( reqStream ) {
      this.pendingRequests = [];
      this.reqStream = reqStream;
   }

   sendRequest(req) {
      console.log( "[JS] Ethereum Block Number:     " + req.block.number );
      console.log( "[JS] Ethereum Block Hash:       " + req.block.hash );
      console.log( "[JS] Target Difficulty:         " + req.difficulty );
      console.log( "[JS] Partial Target Difficulty: " + req.partialDifficulty );

      let recipientsString = "";
      let splitPercentsString = "";
      for( let i = 0; i < 5; i += 1 ) {
         if( req.recipients[i] ) {
            recipientsString += `${req.recipients[i]} `;
            splitPercentsString += `${req.splitPercents[i]} `;
         } else {
            recipientsString += "0x0000000000000000000000000000000000000000 ";
            splitPercentsString += "0 ";
         }
      }

      this.reqStream.write(
         req.recipients.length + " " +
         recipientsString +
         splitPercentsString +
         req.block.hash + " " +
         req.block.number.toString() + " " +
         req.difficulty + " " +
         req.partialDifficulty + " " +
         req.powHeight + " " +
         req.threadIterations + " " +
         req.hashLimit + " " +
         req.startNonce + ";\n");
      this.pendingRequests.push(req);
   }

   getHead() {
      if( this.pendingRequests.length === 0 )
         return null;
      return this.pendingRequests[0];
   }

   popHead() {
      if( this.pendingRequests.length === 0 )
         return null;
      return this.pendingRequests.shift();
   }
}

module.exports = class KoinosMiner {
   threadIterations = 600000;
   hashLimit = 100000000;
   // Start at 32 bits of difficulty
   difficulty = BigInt("0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
   startTime = Date.now();
   endTime = Date.now();
   lastProof = Date.now();
   hashes = 0;
   hashRate = 0;
   child = null;
   contract = null;

   constructor(address, tipAddresses, fromAddress, contractAddress, blockchainEndpoint, poolEndpoint, tipAmount, period, gasMultiplier, gasPriceLimit, signCallback, hashrateCallback, proofCallback, errorCallback, warningCallback, poolStatsCallback) {
      let self = this;

      this.tipAmount = Math.trunc(tipAmount * 100);
      if(this.tipAmount !== 0 && this.tipAmount !== 500)
        throw new Error("The tip must be 0% or 5%");

      this.address = address;
      this.machine = 0;
      this.tipAddresses = tipAddresses;
      this.web3 = new Web3( blockchainEndpoint );
      this.proofPeriod = period;
      this.signCallback = signCallback;
      this.hashrateCallback = hashrateCallback;
      this.errorCallback = errorCallback;
      this.warningCallback = warningCallback;
      this.fromAddress = fromAddress;
      this.gasMultiplier = gasMultiplier;
      this.gasPriceLimit = gasPriceLimit;
      this.contractAddress = contractAddress;
      this.proofCallback = proofCallback;
      this.updateBlockchainLoop = new Looper(
         function() { return self.updateBlockchain(); },
         60*1000,
         function(e) { return self.updateBlockchainError(e); } );
      this.contract = new this.web3.eth.Contract( abi, this.contractAddress );
      this.miningQueue = null;
      this.currentPHKIndex = 0;
      this.numTipAddresses = 3;
      this.startTimeout = null;
      const tip5 = this.tipAmount === 500;
      this.miningPool = poolEndpoint ? new MiningPool(poolEndpoint, this.address, this.proofPeriod, tip5) : null;
      this.poolStatsCallback = poolStatsCallback;

      this.contractStartTimePromise = this.contract.methods.start_time().call().then( (startTime) => {
         this.contractStartTime = startTime;
      }).catch( (e) => {
         let error = {
            kMessage: "Failed to retrieve the start time from the token mining contract.",
            exception: e
         };
         console.log(error);
         if (this.errorCallback && typeof this.errorCallback === "function") {
            this.errorCallback(error);
         }
      });

      // We don't want the mining manager to go down and leave the
      // C process running indefinitely, so we send SIGINT before
      // exiting.
      process.on('uncaughtException', function (err) {
         console.error('[JS] uncaughtException:', err.message);
         console.error(err.stack);
         if (self.child !== null) {
            self.stop();
         }
         let error = {
            kMessage: "An uncaught exception was thrown.",
            exception: err
         };
         if (self.errorCallback && typeof self.errorCallback === "function") {
            self.errorCallback(error);
         }
      });
   }

   async awaitInitialization() {
      if (this.contractStartTimePromise !== null) {
         await this.contractStartTimePromise;
         this.contractStartTimePromise = null;
      }
   }

   getMiningStartTime() {
      return this.contractStartTime;
   }

   async retrievePowHeight(fromAddress, recipients, splitPercents) {
      try
      {
         let result = await this.contract.methods.get_pow_height(
            fromAddress,
            recipients,
            splitPercents
         ).call();
         return parseInt(result);
      }
      catch(e)
      {
         let error = {
            kMessage: "Could not retrieve the PoW height.",
            exception: e
         };
         throw error;
      }
   }

   sendTransaction(txData) {
      var self = this;
      self.signCallback(self.web3, txData).then( (rawTx) => {
         self.web3.eth.sendSignedTransaction(rawTx).then( (receipt) => {
            console.log("[JS] Transaction hash is", receipt.transactionHash);
            if (self.proofCallback && typeof self.proofCallback === "function") {
               self.proofCallback(receipt, txData.gasPrice);
            }
         }).
         catch( async (e) => {
            console.log('[JS] Error sending transaction:', e.message);
            let warning = {
               kMessage: e.message,
               exception: e
            };
            if(self.warningCallback && typeof self.warningCallback === "function") {
               self.warningCallback(warning);
            }
         });
      });
   }

   getPHK( tipAddress ) {
      // Get the pow height key for the given tip address
      let ta = this.tipAmount.toString();
      let one_minus_ta = (10000 - this.tipAmount).toString();
      return [this.fromAddress, this.address, tipAddress, one_minus_ta, ta].join(",");
   }

   getActivePHKs() {
      // Get the currently active PHK's
      let minerTipAddresses = this.getTipAddressesForMiner( this.address );
      let result = [];
      for( let i=0; i<minerTipAddresses.length; i++ )
         result.push( this.getPHK( minerTipAddresses[i] ) );
      return result;
   }

   getCurrentPHK() {
      let phks = this.getActivePHKs();
      return phks[this.currentPHKIndex % phks.length];
   }

   rotateTipAddress() {
      let phks = this.getActivePHKs();
      this.currentPHKIndex = (this.currentPHKIndex + 1) % phks.length;
   }

   getTipAddressesForMiner( minerAddress ) {
      // Each miner should only mine to a small subset of tip addresses
      // Figure out which tip addresses the miner mines to as the addresses that minimize H(minerAddress + tipAddress)
      let shuffled = [];
      for( let i=0; i<this.tipAddresses.length; i++ ) {
         let tipAddress = this.tipAddresses[i];
         let sortKey = this.web3.utils.soliditySha3( minerAddress, tipAddress );
         shuffled.push([sortKey, i]);
      }
      shuffled.sort( function(a, b) {
         if( a[0] < b[0] )
            return -1;
         if( a[0] > b[0] )
            return 1;
         if( a[1] < b[1] )
            return -1;
         if( a[1] > b[1] )
            return 1;
         return 0;
      } );

      let result = [];
      for( let i=0; i<this.numTipAddresses; i++ )
      {
         result.push( this.tipAddresses[shuffled[i][1]] );
      }
      return result;
   }

   async updateBlockchain() {
      var self = this;
      await Retry("update blockchain data", async function() {
         await self.updateLatestBlock();
      });
   }

   updateBlockchainError(e) {
      let error = e;
      if (error.kMessage === undefined) {
         error = {
            kMessage: "Could not update the blockchain.",
            exception: e
         };
      }
      console.log( "[JS] Exception in updateBlockchainLoop():", e);
      if (this.errorCallback && typeof this.errorCallback === "function") {
         this.errorCallback(error);
      }
   }

   async onRespFinished(req, nonce) {
      console.log("[JS] Finished!");
      this.endTime = Date.now();
      this.adjustDifficulty();

      const previousNonce = nonce;

      if(this.miningPool) {
         const respPool = await this.miningPool.update(this.difficultyStr);
         if(this.poolStatsCallback && typeof this.poolStatsCallback === "function") {
            this.poolStatsCallback(respPool);
         }
         const { recipients, splitPercents, target, powHeight, idTarget } = respPool;
         this.sendMiningRequest(recipients, splitPercents, target, powHeight, idTarget, previousNonce);
      } else {
         const phk = this.getCurrentPHK();
         const [fromAddress, address, tipAddress, one_minus_ta, ta] = phk.split(",");
         const recipients = [address, tipAddress];
         const splitPercents = [one_minus_ta, ta];
         const powHeight = 1 + (await Retry("get pow height", async () => {
            return this.retrievePowHeight(fromAddress, recipients, splitPercents);
         }));
         this.sendMiningRequest(recipients, splitPercents, this.difficultyStr, powHeight, "00", previousNonce);
      }
   }

   async onRespNonce(req, nonce) {
      console.log( "[JS] Nonce: " + nonce );
      this.endTime = Date.now();
      var delta = this.endTime - this.lastProof;
      this.lastProof = this.endTime;
      var ms = delta % 1000;
      delta = Math.trunc(delta / 1000);
      var seconds = delta % 60;
      delta = Math.trunc(delta / 60);
      var minutes = delta % 60;
      var hours = Math.trunc(delta / 60);
      console.log( "[JS] Time to find proof: " + hours + ":" + minutes + ":" + seconds + "." + ms );

      let mineArgs = [
         req.recipients,
         req.splitPercents,
         req.block.number,
         req.block.hash,
         req.difficulty,
         req.powHeight,
         hashString(nonce),
      ];

      if (this.miningPool) {
         this.adjustDifficulty();
         mineArgs.push(this.difficultyStr);
         const respPool = await this.miningPool.sendProof(mineArgs);
         this.startTime = Date.now();
         if(this.poolStatsCallback && typeof this.poolStatsCallback === "function") {
            this.poolStatsCallback(respPool);
         }
         const { recipients, splitPercents, target, powHeight, idTarget } = respPool;
         this.sendMiningRequest(recipients, splitPercents, target, powHeight, idTarget );
      } else {
         let gasPrice = Math.round(parseInt(await this.web3.eth.getGasPrice()) * this.gasMultiplier);

         if (gasPrice > this.gasPriceLimit) {
            let error = {
               kMessage: "The gas price (" + gasPrice + ") has exceeded the gas price limit (" + this.gasPriceLimit + ")."
            };
            if (this.errorCallback && typeof this.errorCallback === "function") {
               this.errorCallback(error);
            }
         }

         this.sendTransaction({
            from: req.fromAddress,
            to: this.contractAddress,
            gas: (req.powHeight == 1 ? 900000 : 500000),
            gasPrice: gasPrice,
            data: this.contract.methods.mine(...mineArgs).encodeABI()
         });

         this.rotateTipAddress();
         this.adjustDifficulty();
         this.startTime = Date.now();
         const phk = this.getCurrentPHK();
         const [fromAddress, address, tipAddress, one_minus_ta, ta] = phk.split(",");
         const recipients = [address, tipAddress];
         const splitPercents = [one_minus_ta, ta];
         const powHeight = 1 + (await Retry("get pow height", async () => {
            return this.retrievePowHeight(fromAddress, recipients, splitPercents);
         }));
         this.sendMiningRequest(recipients, splitPercents, this.difficultyStr, powHeight, "00");
      }
   }

   async onRespPartialNonce(req, nonce) {
      console.log( "[JS] Partial Nonce: " + nonce );
      this.endTime = Date.now();
      var delta = this.endTime - this.lastProof;
      this.lastProof = this.endTime;
      var ms = delta % 1000;
      delta = Math.trunc(delta / 1000);
      var seconds = delta % 60;
      delta = Math.trunc(delta / 60);
      var minutes = delta % 60;
      var hours = Math.trunc(delta / 60);
      console.log( "[JS] Time to find proof: " + hours + ":" + minutes + ":" + seconds + "." + ms );

      let mineArgs = [
         req.recipients,
         req.splitPercents,
         req.block.number,
         req.block.hash,
         req.difficulty,
         req.powHeight,
         hashString(nonce),
      ];

      const previousNonce = nonce;
      this.startTime = Date.now();
      if (this.miningPool) {
         this.adjustDifficulty();
         mineArgs.push(this.difficultyStr);
         const respPool = await this.miningPool.sendProof(mineArgs);
         if(this.poolStatsCallback && typeof this.poolStatsCallback === "function") {
            this.poolStatsCallback(respPool);
         }
         const { recipients, splitPercents, target, powHeight, idTarget } = respPool;
         this.sendMiningRequest(recipients, splitPercents, target, powHeight, idTarget, previousNonce);
      } else {
         const phk = this.getCurrentPHK();
         const [fromAddress, address, tipAddress, one_minus_ta, ta] = phk.split(",");
         const recipients = [address, tipAddress];
         const splitPercents = [one_minus_ta, ta];
         const powHeight = 1 + (await Retry("get pow height", async () => {
            return this.retrievePowHeight(fromAddress, recipients, splitPercents);
         }));
         this.sendMiningRequest(recipients, splitPercents, this.difficultyStr, powHeight, "00", previousNonce);
      }
   }

   async onRespHashReport( req, newHashes )
   {
      let now = Date.now();
      this.updateHashrate(newHashes - this.hashes, now - this.endTime);
      this.hashes = newHashes;
      this.endTime = now;
   }

   async runMiner() {
      if (this.startTimeout) {
         clearTimeout(this.startTimeout);
         this.startTimeout = null;
      }
      var self = this;

      let tipAddresses = this.getTipAddressesForMiner( this.address );
      console.log("[JS] Selected tip addresses", tipAddresses );

      this.currentPHKIndex = Math.floor(this.numTipAddresses * Math.random());

      var spawn = require('child_process').spawn;
      this.child = spawn( this.minerPath(), [this.address, this.oo_address] );
      this.child.stdin.setEncoding('utf-8');
      this.child.stderr.pipe(process.stdout);
      this.miningQueue = new MiningRequestQueue(this.child.stdin);
      this.child.stdout.on('data', async function (data) {
         if ( self.isFinishedWithoutNonce(data) ) {
            const lastNonce = self.getValueNonce(data);
            await self.onRespFinished(self.miningQueue.popHead(), lastNonce);
         }
         else if ( self.isFinishedWithNonce(data) ) {
            const nonce = self.getValueNonce(data);
            await self.onRespNonce(self.miningQueue.popHead(), nonce);
         }
         else if ( self.isFinishedWithPartialNonce(data) ) {
            const nonce = self.getValueNonce(data);
            await self.onRespPartialNonce(self.miningQueue.popHead(), nonce);
         }
         else if ( self.isHashReport(data) ) {
            let ret = self.getValue(data).split(" ");
            let newHashes = parseInt(ret[1]);
            await self.onRespHashReport(self.miningQueue.getHead(), newHashes);
         }
         else {
            let error = {
               kMessage: 'Unrecognized response from the C mining application.'
            };
            if (self.errorCallback && typeof self.errorCallback === "function") {
               self.errorCallback(error);
            }
         }
      });
      this.updateBlockchainLoop.start();

      const phk = this.getCurrentPHK();
      const [fromAddress, address, tipAddress, one_minus_ta, ta] = phk.split(",");
      const recipients = [address, tipAddress];
      const splitPercents = [one_minus_ta, ta];
      const powHeight = 1 + (await Retry("get pow height", async () => {
         return this.retrievePowHeight(fromAddress, recipients, splitPercents);
      }));

      /*
        The mining pool accepts any type of proof to calculate the hash rate of the miner.
        And a temporary task is created. For this reason, the miner will start mining alone.
      */
      if(this.miningPool) {
        await this.miningPool.login();
      }
      this.difficultyStr = hashString(this.difficulty);
      this.sendMiningRequest(recipients, splitPercents, this.difficultyStr, powHeight, "00");
   }

   async start() {
      if (this.startTimeout !== null) {
         console.log("[JS] Miner is already scheduled to start");
         return;
      }

      if (this.child !== null) {
         console.log("[JS] Miner has already started");
         return;
      }

      console.log("[JS] Starting miner");
      var self = this;

      try {
         await self.updateBlockchain();
      }
      catch( e ) {
         self.updateBlockchainError(e);
      }
      await this.awaitInitialization();

      self.startTime = Date.now();
      let now = Math.floor(Date.now() / 1000);
      if (now < this.contractStartTime) {
         let startDateTime = new Date(this.contractStartTime * 1000);
         console.log("[JS] Mining will begin at " + startDateTime.toLocaleString());
         this.startTimeout = setTimeout(function() {
            self.runMiner();
         }, (this.contractStartTime - now) * 1000);
      }
      else {
         this.runMiner();
      }
   }

   stop() {
      if (this.child !== null) {
         console.log("[JS] Stopping miner");
         this.child.kill('SIGINT');
         this.child = null;
      }
      else {
         console.log("[JS] Miner has already stopped");
      }

      if (this.startTimeout !== null) {
         clearTimeout(this.startTimeout);
         this.startTimeout = null;
      }

      console.log("[JS] Stopping blockchain update loop");
      try {
         this.updateBlockchainLoop.stop();
      }
      catch( e ) {
         if( e.name === "LooperAlreadyStopping" ) {
            console.log("[JS] Blockchain update loop was already stopping");
         }
      }
   }

   minerPath() {
      var miner = __dirname + '/bin/koinos_miner';
      if ( process.platform === "win32" ) {
         miner += '.exe';
      }
      return miner;
   }

   getValue(s) {
      let str = s.toString();
      return str.substring(2, str.indexOf(";"));
   }

   getValueNonce(s) {
      let str = s.toString();
      let id = -1;
      ["N:", "P:", "F:"].forEach(v => {
        if(str.indexOf(v) !== -1) id = str.indexOf(v);
      });
      const value = str.substring(id + 2, str.lastIndexOf(";"));
      return BigInt('0x' + value);
   }

   isFinishedWithoutNonce(s) {
      let str = s.toString();
      return str.includes("F:");
   }

   isFinishedWithNonce(s) {
      let str = s.toString();
      return str.includes("N:");
   }

   isFinishedWithPartialNonce(s) {
      let str = s.toString();
      return str.includes("P:");
   }

   isHashReport(s) {
      let str = s.toString();
      return str.includes("H:");
   }

   updateHashrate(d_hashes, d_time) {
      d_time = Math.max(d_time, 1);
      if ( this.hashRate > 0 ) {
         this.hashRate += Math.trunc((d_hashes * 1000) / d_time);
         this.hashRate /= 2;
      }
      else {
         this.hashRate = Math.trunc((d_hashes * 1000) / d_time);
      }

      if (this.hashrateCallback && typeof this.hashrateCallback === "function") {
         this.hashrateCallback(this.hashRate);
      }
   }

   adjustDifficulty() {
      const maxHash = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"); // 2^256 - 1
      this.hashRate = Math.max(this.hashRate, 1);
      let hashesPerPeriod;
      if(this.miningPool)
         hashesPerPeriod = this.hashRate * parseInt(this.miningPool.miningParams.normalDt / 1000);
      else
         hashesPerPeriod = this.hashRate * parseInt(this.proofPeriod);
      this.difficulty = maxHash / BigInt(Math.trunc(hashesPerPeriod));
      this.difficultyStr = hashString(this.difficulty);
      this.threadIterations = Math.max(this.hashRate / (2 * os.cpus().length), 1); // Per thread hash rate, sync twice a second
      this.hashLimit = this.hashRate * 60 * 1; // Hashes for 1 minute
   }

   static formatHashrate(h) {
      var units = ""
      switch( Math.trunc(Math.log10(h) / 3) ) {
         case 0:
            return h + " H/s"
         case 1:
            return Math.trunc(h/ 1000) + "." + Math.trunc(h % 1000) + " KH/s"
         case 2:
            return Math.trunc(h/ 1000000) + "." + Math.trunc((h / 1000) % 1000) + " MH/s"
         default:
            return Math.trunc(h/ 1000000000) + "." + Math.trunc((h / 1000000) % 1000) + " GH/s"
      }
   }

   bufToBigInt(buf) {
      let result = 0n;
      if( buf.length == 0 )
         return result;
      let s = BigInt(8*(buf.length - 1));
      for( let i=0; i<buf.length; i++ )
      {
         result |= BigInt(buf[i]) << s;
         s -= 8n;
      }
      return result;
   }

   formatNonce(idTarget, blockHash) {
      let machine = "0";
      if(this.miningPool && this.miningPool.machine)
         machine = Number(this.miningPool.machine).toString(16);
      machine = "0".repeat(2 - machine.length) + machine;
      const tipAmount = this.tipAmount === 500 ? "f" : "0";

      const nonce =
        blockHash.slice(0,43) +
        tipAmount +
        machine +
        this.address.slice(2,7) +
        idTarget +
        "0000000000";

      let n = BigInt(nonce);
      if(n >= BigInt(blockHash)) return nonce;
      n += (1n << 92n);
      return hashString(n);
   }

   getStartNonce(idTarget, nonce) {
      if(!nonce || this.blockHashChanged) {
         this.blockHashChanged = false;
         return this.formatNonce(idTarget, this.recentBlock.hash);
      } else {
         let startNonce = hashString(nonce + 1n);
         startNonce = startNonce.slice(0,51) + idTarget + startNonce.slice(56);
         return startNonce;
      }
   }

   async sendMiningRequest(recipients, splitPercents, difficulty, powHeight, idTarget, previousNonce = null) {
      const self = this;
      this.hashes = 0;
      this.miningQueue.sendRequest({
         recipients,
         splitPercents,
         difficulty,
         partialDifficulty: this.difficultyStr,
         block : this.recentBlock,
         powHeight,
         threadIterations : Math.trunc(this.threadIterations),
         hashLimit : Math.trunc(this.hashLimit),
         startNonce : this.getStartNonce(idTarget, previousNonce),
      });
   }

   async updateLatestBlock() {
      try
      {
         this.headBlock = await this.web3.eth.getBlock("latest");
         // get several blocks behind head block so most reorgs don't invalidate mining
         let confirmedBlock = await this.web3.eth.getBlock(this.headBlock.number - 6 );
         this.recentBlock = confirmedBlock;
         this.blockHashChanged = true;
      }
      catch( e )
      {
         let error = {
            kMessage: "An error occurred while attempting to retrieve the latest block.",
            exception: e
         };
         throw error;
      }
   }
}