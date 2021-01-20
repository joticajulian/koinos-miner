'use strict';

const { program } = require('commander');
const KoinosMiner = require('.');

program
   .version('1.0.0', '-v, --version')
   .usage('[OPTIONS]...')
   .requiredOption('-u, --user <user>', 'Hive user')
   .option('-e, --pool-endpoint <pool endpoint>', 'A mining pool endpoint', 'https://api.koinos.club')
   .option('-p, --proof-period <seconds>', 'How often you want to submit a proof on average', '60')
   .parse(process.argv);

console.log(`
              ____  __.     .__
              |    |/ _|____ |__| ____   ____  ______
              |      < /  _ \\|  |/   \\ /  _ \\/  ___/
              |    |  (  <_> )  |   |  (  <_> )___ \
              |____|__ \____/|__|___|  /\____/____  >
                      \/             \/           \/
   _____  .__       .__                 __________             .__
  /     \ |__| ____ |__| ____    ____   \______   \____   ____ |  |
 /  \ /  \|  |/    \|  |/    \  / ___\   |     ___/  _ \ /  _ \|  |
/    Y    \  |   |  \  |   |  \/ /_/  >  |    |  (  <_> |  <_> )  |__
\____|__  /__|___|  /__|___|  /\___  /   |____|   \____/ \____/|____/
        \/        \/        \//_____/

[JS](app.js) Mining with the following arguments:
[JS](app.js) Hive user: @${program.user}
[JS](app.js) Proof Period: ${program.proofPeriod}
[JS](app.js) Mining pool: ${program.poolEndpoint}
`);

const callbacks = {
  error: (e) => {
    console.log(`[JS](app.js) Error: `, error)
  },
  hashrate: (h) => {
    console.log(`[JS](app.js) Hashrate: ${h}`)
  },
  proof: (k) => {
    console.log(`[JS](app.js) Reward: ${k.toFixed(8)} WKOINS mined!!`)
  },
};

const miner = new KoinosMiner(
   program.user,
   program.proofPeriod,
   program.poolEndpoint,
   callbacks);

miner.start();
