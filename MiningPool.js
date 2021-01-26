const axios = require("axios");
const Retry = require("./retry.js");

module.exports = class MiningPool {
   constructor(endpoint, user) {
      this.user = user.trim();
      this.axios = axios.create({
         baseURL: endpoint
      });
   }

   async call(method, params = []) {
      let opts = {};

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

   async requestTask(target) {
     const self = this;
     const result = await Retry("request work from the pool", async () => {
       return self.call("requestTask2", [this.user, target]);
     }, "[Pool]");
     return result;
   }

   async sendProof(nonce, newTarget) {
     const self = this;
     const result = await Retry("send proof to the pool", async (tries, e) => {
       if(tries < 3)
          return self.call("mine2", [nonce, newTarget]);

       console.log("Aborting... requesting a new task");
       return self.call("requestTask2", [this.user, newTarget]);
     }, "[Pool]");
     return result;
   }
}
