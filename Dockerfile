FROM node:12-buster as base
RUN apt-get update
RUN apt-get -y install git make build-essential libssl-dev cmake
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN npm install
RUN npm run postinstall

FROM node:12-buster-slim as release
WORKDIR /app
RUN apt-get update && apt-get -y install libgomp1
COPY --from=base /app/package.json /app/package.json
COPY --from=base /app/app.js /app/app.js
COPY --from=base /app/index.js /app/index.js
COPY --from=base /app/abi.js /app/abi.js
COPY --from=base /app/looper.js /app/looper.js
COPY --from=base /app/MiningPool.js /app/MiningPool.js
COPY --from=base /app/retry.js /app/retry.js
COPY --from=base /app/node_modules /app/node_modules 
COPY --from=base /app/bin /app/bin
COPY --from=base /app/assets /app/assets
RUN chown -R node:node /app
USER node
ENTRYPOINT [ "npm", "start", "--" ]
