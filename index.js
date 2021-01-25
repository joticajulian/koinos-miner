'use strict';

const os = require('os');
const MiningPool = require("./MiningPool.js");

let minerPath = __dirname + '/bin/koinos_miner';
if ( process.platform === "win32" ) minerPath += '.exe';

function hashString( number ) {
   let numberStr = number.toString(16);
   numberStr = "0x" + "0".repeat(64 - numberStr.length) + numberStr;
   return numberStr;
}

function getNonceValue(s) {
   const str = s.toString();
   const id = str.indexOf("N:");
   const value = str.substring(id + 2, str.lastIndexOf(";"));
   return "0x" + "0".repeat(64 - value.length) + value;
}

function getHashReportValue(s) {
   const str = s.toString();
   const id = str.indexOf("H:");
   const report = str.substring(id + 2, str.lastIndexOf(";"));
   return Number(report.split(" ")[1]);
}

function formatHashrate(h) {
   const pad0 = (x) => ("0".repeat(3 - x.toString().length) + x);
   switch( Math.trunc(Math.log10(h) / 3) ) {
      case 0:
         return h + " H/s"
      case 1:
         return Math.trunc(h/ 1000) + "." + pad0(Math.trunc(h % 1000)) + " KH/s"
      case 2:
         return Math.trunc(h/ 1000000) + "." + pad0(Math.trunc((h / 1000) % 1000)) + " MH/s"
      default:
         return Math.trunc(h/ 1000000000) + "." + pad0(Math.trunc((h / 1000000) % 1000)) + " GH/s"
   }
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
      this.reqStream.write(
         req.seed + " " +
         req.securedHash + " " +
         req.partialTarget + " " +
         req.iniNonce + " " +
         req.threadIterations + " " +
         req.hashLimit + ";\n");
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
   difficultyStr = "0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
   endTime = Date.now();
   lastProof = Date.now();
   hashes = 0;
   hashRate = 0;
   recentMinedHistory = [];
   recentMined = 0;
   child = null;

   constructor(user, proofPeriod, poolEndpoint, callbacks ) {
      let self = this;

      this.proofPeriod = Number(proofPeriod);
      this.miningQueue = null;
      this.miningPool = new MiningPool(poolEndpoint, user);

      if(callbacks) {
        if(typeof callbacks.hashrate === "function")
          this.hashrateCallback = callbacks.hashrate;
        if(typeof callbacks.proof === "function")
          this.proofCallback = callbacks.proof;
        if(typeof callbacks.error === "function")
          this.errorCallback = callbacks.error;
      }

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
         if (self.errorCallback) self.errorCallback(error);
      });
   }

   adjustDifficulty() {
      const maxHash = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"); // 2^256 - 1
      this.hashRate = Math.max(this.hashRate, 1);
      const hashesPerPeriod = this.hashRate * this.proofPeriod;
      const difficulty = maxHash / BigInt(Math.trunc(hashesPerPeriod));
      this.difficultyStr = hashString(difficulty);
      this.threadIterations = Math.max(this.hashRate / (2 * os.cpus().length), 1); // Per thread hash rate, sync twice a second
      this.hashLimit = this.hashRate * 60 * 1; // Hashes for 1 minute
   }

   updateRecentMinedKoins(wkoins) {
      this.recentMinedHistory.push([Date.now(), wkoins]);
      const yesterday = Date.now() - 24 * 60 * 60 * 1000;
      const index = this.recentMinedHistory.findIndex(r => r[0] > yesterday);
      this.recentMinedHistory.splice(0, index);
      this.recentMined = this.recentMinedHistory.reduce((total, m) => (total + m[1]), 0);
   }

   async onRespFinished() {
      console.log("[JS] Finished without nonce");
      this.endTime = Date.now();

      this.adjustDifficulty();
      const respTask = await this.miningPool.requestTask(this.difficultyStr);
      this.sendMiningRequest(respTask);
   }

   async onRespNonce(req, nonce) {
      console.log( "[JS] Nonce: " + nonce );
      this.endTime = Date.now();
      const seconds = (this.endTime - this.lastProof) / 1000;
      console.log( "[JS] Time to find proof: " + seconds.toFixed(2) + " seconds" );
      this.lastProof = this.endTime;

      this.adjustDifficulty();
      const respTask = await this.miningPool.sendProof(nonce, this.difficultyStr);
      if(respTask.wkoins) {
         this.updateRecentMinedKoins(respTask.wkoins);
         if(this.proofCallback) this.proofCallback(respTask.wkoins, this.recentMined);
      }
      this.sendMiningRequest(respTask);
   }

   async onRespHashReport(newHashes) {
      const now = Date.now();
      const d_hashes = newHashes - this.hashes;
      const d_time = now - this.endTime + 1;

      if ( this.hashRate > 0 ) {
         this.hashRate += Math.trunc((d_hashes * 1000) / d_time);
         this.hashRate /= 2;
      }
      else {
         this.hashRate = Math.trunc((d_hashes * 1000) / d_time);
      }

      const hashRateStr = formatHashrate(this.hashRate);
      if (this.hashrateCallback) this.hashrateCallback(hashRateStr);

      this.hashes = newHashes;
      this.endTime = now;
   }

   async sendMiningRequest(req) {
      console.log(`[JS] New task received. Task Id: ${req.iniNonce.slice(46, 52)}`);
      this.hashes = 0;
      this.miningQueue.sendRequest({
         ...req,
         threadIterations : Math.trunc(this.threadIterations),
         hashLimit : Math.trunc(this.hashLimit),
      });
   }

   async runMiner() {
      var self = this;

      var spawn = require('child_process').spawn;
      this.child = spawn( minerPath );
      this.child.stdin.setEncoding('utf-8');
      this.child.stderr.pipe(process.stdout);
      this.miningQueue = new MiningRequestQueue(this.child.stdin);
      this.child.stdout.on('data', async function (data) {
         const dataStr = data.toString();
         if ( dataStr.includes("F:") ) {
            // Finished without nonce
            await self.onRespFinished(self.miningQueue.popHead());
         }
         else if ( dataStr.includes("N:") ) {
            // Finished with nonce
            const nonce = getNonceValue(data);
            await self.onRespNonce(self.miningQueue.popHead(), nonce);
         }
         else if ( dataStr.includes("H:") ) {
            // Hash report
            const newHashes = getHashReportValue(data);
            await self.onRespHashReport(newHashes);
         }
         else {
            let error = {
               kMessage: `Unrecognized response from the C mining application: ${dataStr}`
            };
            if (self.errorCallback) self.errorCallback(error);
         }
      });

      const respTask = await this.miningPool.requestTask(this.difficultyStr);
      this.sendMiningRequest(respTask);
   }

   start() {
      if (this.child !== null) {
         console.log("[JS] Miner has already started");
         return;
      }
      this.runMiner();
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
   }
}
