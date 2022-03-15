FROM node:14 AS build

WORKDIR /faucet

COPY . .
RUN npm install --frozen-lockfile
RUN npm run build

FROM node:14

WORKDIR /faucet

COPY package.json .
COPY package-lock.json .
COPY --from=build /faucet/lib/ /faucet/lib/
RUN npm install --frozen-lockfile --production

CMD ["npm", "run", "start"]
