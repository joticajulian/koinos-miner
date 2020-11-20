const jose = require("jose");
const axios = require("axios");
const Retry = require("./retry.js");

module.exports = class MiningPool {
   constructor(endpoint, miner, proofPeriod, tip) {
      this.miner = miner;
      this.proofPeriod = proofPeriod;
      this.tip = tip;
      
      this.token = null; 
      
      this.axios = axios.create({
         baseURL: endpoint
      });
   }
   
   isTokenExpired() {
     return !this.token || this.token.issuedAt + this.token.expiresIn < Math.trunc(Date.now()/1000);
   }

   async call(method, params = [], useToken = true) {
      let opts = {};
      if(useToken) {
        if(this.isTokenExpired()) {
          await this.login();
        }
        opts = { headers: { authentication: `Bearer ${this.token.accessToken}`} };
      }
      
      const id = Math.trunc(10000*Math.random());
      const response = await this.axios.post("/jsonrpc", {
         jsonrpc: "2.0",
         method,
         params,
         id,
      }, opts);

      if (!response.data)
         throw new Error(`Invalid response when calling '${method}': No data present in the response`);
      if (response.data.id !== id)
         throw new Error(`Invalid response when calling '${method}': Expected id ${id}. Received id ${response.data.id}`);
      return response.data.result;
   }

   async login() {
     this.token = await this.call("login", [this.miner, this.proofPeriod, this.tip], false);
     const payload = jose.JWT.decode(this.token.accessToken);
     this.machine = payload.machine;
     console.log(`Logged in: ${JSON.stringify(payload)}`);
     
     this.miningParams = await this.call("getParams", [], false);
   }

   async update(partialTarget) {
     const self = this;
     const result = await Retry("request work from the pool", async (tries, e) => {
       if(tries === 0) return self.call("requestTask", [partialTarget]);
       if(e && e.error && e.error.message) {
         if(e.error.message.includes("signature verification failed") || e.error.message.includes("Invalid nonce format")) {
           console.log("Forcing a login");
           self.token = null;
           return self.call("requestTask", [partialTarget]);
         }
       }
       return self.call("requestTask", [partialTarget]);
     }, "[Pool]");
     return result;
   }

   async sendProof(mineArgs) {
     const self = this;
     const result = await Retry("send proof to the pool", async (tries, e) => {
       if(tries === 0) return self.call("mine", mineArgs);
       if(e && e.error && e.error.message) {
         if(e.error.message.includes("Insuficient funds to operate in the pool") || e.error.message.includes("Proof received too early. Please send proofs each")) {
           // continue trying to send a proof
           return self.call("mine", mineArgs);
         } else if(e.error.message.includes("signature verification failed") || e.error.message.includes("Invalid nonce format")) {
           console.log("Forcing a login and then request task");
           self.token = null;
           const partialTarget = mineArgs[mineArgs.length - 1];
           return self.call("requestTask", [partialTarget]);
         }
       }
       console.log("Requesting a new task");
       const partialTarget = mineArgs[mineArgs.length - 1];
       return self.call("requestTask", [partialTarget]);
     }, "[Pool]");
     return result;
   }
}
