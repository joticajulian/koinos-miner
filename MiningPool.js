const axios = require("axios");
const Retry = require("./retry.js");

module.exports = class MiningPool {
   constructor(endpoint) {
      this.poolAddress = "0x292B59941aE124acFca9a759892Ae5Ce246eaAD2";
      this.endpoint = endpoint;
      this.axios = axios.create({
         baseURL: endpoint
      });
   }

   async call(method, params = []) {
      const id = Math.trunc(10000*Math.random());
      const response = await this.axiosAuth.post("/jsonrpc", {
         jsonrpc: "2.0",
         method,
         params,
         id,
      });

      if (!response.data)
         throw new Error(`Invalid response when calling '${method}': No data present in the response`);
      if (response.data.id !== id)
         throw new Error(`Invalid response when calling '${method}': Expected id ${id}. Received id ${response.data.id}`);
      return response.data.result;
   }

   async createSession() {

   }

   async update() {
      return {
         poolAddress: this.poolAddress,
         recipients: [
            "0x292B59941aE124acFca9a759892Ae5Ce246eaAD2",
            "0xbf3C8Ffc87Ba300f43B2fDaa805CcA5DcB4bC984",
            "0x407A73626697fd22b1717d294E6B39437531013d",
            "0x69486fda786D82dBb61C78847A815d5F615C2B15",
            "0x434eAbB24c0051280D1CC0AF6E12bF59b5F932e9",
         ],
         splitPercents: [
            2000, 2000, 3000, 1000, 2000
         ],
      };

      /* const self = this;
      const result = await Retry("request work from the pool", async () => {
         return self.call("requestWork");
      }, "[Pool]");
      return result; */
   }

   async sendProof(mineArgs) {
      return this.update();
   }
}
