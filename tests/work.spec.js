const { spawn } = require("child_process");
const { work, getSecuredHash } = require("./utils");

let minerPath = __dirname + '../bin/koinos_miner';
if ( process.platform === "win32" ) minerPath += '.exe';

const child = spawn( minerPath );
child.stdin.setEncoding('utf-8');
child.stderr.pipe(process.stdout);

describe("Test worker", () => {
   it("should compute the proof of work", async () => {
      expect.assertions(2);

      const input = {
         recipients: [
            "0x1337Cafe411a2b5820eC2f0E258C051C1598c138",
            "0x15C477E9373712bADAf0fe667b958fDa02A7fAD4",
         ],
         splitPercents: [10000, 0],
         blockNumber: 11694289,
         blockHash: "0x" + BigInt("102570442055327265818067237879408986958048431327408536592275359923884480294913").toString(16),
         target: "0x" + BigInt("6427752177035961102167848369364650410088811975131171341205503").toString(16),
         powHeight: 2,
         nonce: "0x" + BigInt("102570442055327265818067237879408986958330300447946682461504928944622467106681").toString(16),
      };

      const expectedResult = work(input);
      const validProof = BigInt(expectedResult) < BigInt(input.target);
      expect(validProof).toBe(true);

      const securedHash = getSecuredHash(input);

      const inputString =
         input.blockHash + " " +
         securedHash + " " +
         input.target + " " +
         input.nonce + " 1 60;\n";

      const result = await new Promise((resolve, reject) => {
         child.stdin.write(inputString);
         child.stdout.on("data", async function (data) {
           const str = data.toString();
           const result = str.substring(0, str.indexOf(";"));
           resolve(`0x${"0".repeat(64 - result.length)}${result}`);
         });
      });
      child.kill('SIGINT');

      expect(result).toBe(expectedResult);
   });
});
