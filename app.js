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
              88  dP  dP"Yb  88 88b 88  dP"Yb  .dP"Y8
              88odP  dP   Yb 88 88Yb88 dP   Yb 'Ybo."
              88"Yb  Yb   dP 88 88 Y88 Yb   dP o.'Y8b
              88  Yb  YbodP  88 88  Y8  YbodP  8bodP'

8b    d8 88 88b 88 88 88b 88  dP""b8     88""Yb  dP"Yb   dP"Yb  88
88b  d88 88 88Yb88 88 88Yb88 dP   '"     88__dP dP   Yb dP   Yb 88
88YbdP88 88 88 Y88 88 88 Y88 Yb  "88     88"""  Yb   dP Yb   dP 88  .o
88 YY 88 88 88  Y8 88 88  Y8  YboodP     88      YbodP   YbodP  88ood8


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
  proof: (k, totalToday) => {
     console.log(`
[JS](app.js) ***************************************************
             CONGRATULATIONS @${program.user}!
             You earned ${k.toFixed(8)} WKOINS

             Total earned in the last 24h: ${totalToday.toFixed(8)} WKOINS
             ***************************************************
`)
  },
};

const miner = new KoinosMiner(
   program.user,
   program.proofPeriod,
   program.poolEndpoint,
   callbacks);

miner.start();
