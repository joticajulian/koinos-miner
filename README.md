![Koinos Miner](assets/images/koinos-pool-cli-miner-banner.png)

[![GitHub Issues](https://img.shields.io/github/issues/open-orchard/koinos-miner.svg)](https://github.com/joticajulian/koinos-miner/issues)
[![GitHub License](https://img.shields.io/badge/license-GPLv3-blue.svg)](https://github.com/joticajulian/koinos-miner/blob/master/LICENSE.md)

## Table of Contents
  - [Dependencies](#dependencies)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
  - [Example Run](#example-run)
  - [FAQ](#FAQ)

## Dependencies

Prior to installation, you'll need to install the necessary dependencies.

### Linux (Debian based)

```
sudo apt-get install git cmake build-essential libssl-dev
```

### macOS

On macOS, installing `gcc` is required to support OpenMP parallelization. Using the `brew` package manager, install OpenSSL and gcc.
```
brew install openssl gcc cmake
```

### Windows

On Windows, ensure that you are using the `MingW` compiler and you have installed `CMake`. Using the cholocately package manager, install OpenSSL.

```
choco install openssl
```

## Installation

For both Windows and Linux, you should be able to simply invoke the standard `npm` installer.

```
npm install
```

For macOS, you will need to specify the C compiler as `gcc`.

```
CC=gcc-10 npm install
```

## Getting started

You can view the CLI miner arguments by using `npm` like so:

```
npm start -- --help
```

And get the following output:

```
❯ npm start -- --help

> koinos-miner@1.0.0 start /path/to/koinos-miner
> node app.js "--help"

Usage: app [OPTIONS]...

Options:
  -v, --version                        output the version number
  -a, --addr <addr>                    An ethereum address
  -e, --endpoint <endpoint>            An ethereum endpoint (default: "http://mining.koinos.io")
  -e, --pool-endpoint <pool endpoint>  A mining pool endpoint (default: "https://api.koinos.club")
  -t, --tip <percent>                  The percentage of mined coins to tip the developers (default: "5")
  -p, --proof-period <seconds>         How often you want to submit a proof on average (default: "86400")
  -k, --key-file <file>                AES encrypted file containing private key
  -m, --gas-multiplier <multiplier>    The multiplier to apply to the recommended gas price (default: "1")
  -l, --gas-price-limit <limit>        The maximum amount of gas to be spent on a proof submission (default: "1000000000000")
  --import                             Import a private key
  --export                             Export a private key
  --no-pool                            Not use a mining pool
  -h, --help                           display help for command
```

**Recipient Address**: The `--addr` argument specifies the recipient address, this is where KOIN will be rewarded.

**Ethereum Endpoint**: The `--endpoint` argument specifies the Ethereum node to be used when querying contract information. This endpoint is also used to submit proofs when "no-pool" option is present.

**Pool Endpoint**: The `--pool-endpoint` argument specifies the url to connect with the mining pool api.

**Developer Tip**: The `--tip` argument specifies the percentage of rewarded KOIN to donate to the Koinos Development Team. Possible values are 0% or 5%.

**Proof Period**: The `--proof-period` argument specifies the number of seconds on average the miner will attempt to mine and submit proofs. Consult the active miners on https://koinos.club and consider to use one the proof periods listed there in order to be inserted in a group and reduce transaction fees.

**Gas Multiplier**: (Not applicable if using mining pool) The `--gas-multiplier` argument specifies a multiplier to apply to the calculated gas price. This can be used to get your proofs submitted when the Ethereum network gas fees are spiking or are unpredictable.

**Gas Price Limit**: (Not applicable if using mining pool) The `--gas-price-limit` argument specifies a cap in the acceptable gas price for a proof submission.

A more detailed explanation of the different miner configurations can be found in the [Koinos GUI Miner](https://github.com/open-orchard/koinos-gui-miner) `README.md`.

## Key Management

(Not applicable if using mining pool)

The CLI miner provides the arguments `--import`, `--export`, and `--key-file`. These are used in handling the private key of the funding address. The user may import a private key and optionally store it in a key file in which case exporting the key is now possible.

## Example Run

A simple example of running the miner:

```
❯ npm start -- --addr 0x98047645bf61644caa0c24daabd118cc1d640f62
```

## Docker

You can run the miner using docker. Image size optimized to 250 MB:

```
docker run koinclub/miner:latest
```

# FAQ

## Should I enter my private key in the miner?

No. You just need to provide the address where you want to receive the mined koins. The mining pool will take care of submitting the proofs to the blockchain.

## How can I mine using the mining pool?

Send a minimum amount of 0.02 ETH to 0x5c3365898a31a8b0bf90d84ef93245e56570eef9 to add it to your balance in the pool (check your balance at https://koinos.club). Then start the miner.

## How the mining pool can reduce the transaction fees?
All miners are divided in groups of 5, and each group is working on a specific target. When a proof is found only 1 transaction is submitted and it includes the 5 miners are benefiaries. Then the transaction fees, plus a fee for the pool, are shared between. Each miner can reduce up to 60% in transaction fees with this model.

## How I know if I'm in a group of 5 miners?
Check the logs of your miner and look for a list of miners. For instance, in this example there are 3 miners in a group:
```
...
[C] Buffer: 3 0xbbd1f77c6759a17752105e9af7d10f38ebbb3ab9 0x8c09525132adbb9bacdd62eb26970b400eb8f493 0x6487c30a3a148acc85fc31250cd53e55ed92c802 0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 4391 3472 2137 0 0 0xe64ea68f85f992efad6806652d0ebb39a198bcfdfce1d7d2d96faccc5f4edb58 11270144 0x0000000036cfebde5da992b610b10f4fbff79767579aa30b8d23855b77febbb6 0x000001355d281789015ca71bc5fe2ca3ee68c1f443494418d9ce0bb0db19cdbf 1 115693 55532886 0xe64ea68f85f992efad6806652d0ebb39a198bcfdfce20006487ce900010b23b5;
[C] Miners:
      0xbbd1f77c6759a17752105e9af7d10f38ebbb3ab9 percent 4391
      0x8c09525132adbb9bacdd62eb26970b400eb8f493 percent 3472
      0x6487c30a3a148acc85fc31250cd53e55ed92c802 percent 2137
[C] Ethereum Block Hash: 0xe64ea68f85f992efad6806652d0ebb39a198bcfdfce1d7d2d96faccc5f4edb58
[C] Ethereum Block Number: 11270144
[C] Difficulty Target:         0x0000000036cfebde5da992b610b10f4fbff79767579aa30b8d23855b77febbb6
[C] Partial Difficulty Target: 0x000001355d281789015ca71bc5fe2ca3ee68c1f443494418d9ce0bb0db19cdbf
[C] PoW Height: 1
[C] Thread Iterations: 115693
[C] Hash Limit: 55532886
[C] Start Nonce: 0xe64ea68f85f992efad6806652d0ebb39a198bcfdfce20006487ce900010b23b5
...
```
## Can I use several miners with the same address?
Yes. You can set several miners. The mining pool will take care of assigning different tasks to each one in order to optimize the resources. All the hashing power is added to a group of miners in order to receive 1 single payment when submitting proofs.

## I have this error: Insufficient funds to operate in the pool
You need a minimum of 0.02 ether to operate in the pool. Send eth to 0x5c3365898a31a8b0bf90d84ef93245e56570eef9, wait for 4 or 5 confirmations. If you are still receiving this error go to https://koinos.club and send the transaction id to add it to your balance.

## License

Copyright 2020 Open Orchard, Inc.

Koinos Miner is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

Koinos Miner is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with Koinos Miner.  If not, see <https://www.gnu.org/licenses/>.
