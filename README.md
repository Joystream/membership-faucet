# Membership Faucet

Membership on-boarding service for Joystream network.

## Install

Clone the repo, then run:

```
$ npm install
```

to install dependencies.

## Run
Add your config variables to `env.example` and rename it to `.env` and then run:

```
$ npm run build
$ npm run start
```

Will build and start the server.

## API

### `POST -H Authorization: Bearer {CAPTCHA_BYPASS_KEY} /register`
Send a JSON in the request body with an optional Bearer Authentication (if request wants to bypass captcha verification):

```
{
    "account": "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw",
    "handle": "myhandle",
    "avatar": "https://example.com/avatar.png"
}
```

On success expect a JSON response:

```
{
    "memberId": 21,
    "block": 1337,
    "blockHash": "0xb3f394043b4a0dde625a630486f6e64388f124aa9ba4f7f23d54d4fc5a94ea82"
}
```

On error expect a JSON response:
```
{
    "error": "ErrorType"
}
```

### `GET /status`

Send a GET request to the /status endpoint to get an overview of the readiness of the service.
- If the joystream-node used by the service is fully synced
- If the balance of the inviting/gifting account has sufficient balance for atleast one member.


## Configuration

The faucet service is configurable through various environment variables (either in the shell environment or in an `.env` file)


| Variable | Default if not specified | Description | Required |
|---------|------|---------|----| 
| INVITER_KEY | //Alice | The Substrate URI (SURI) representation of the private key corresponding to the account that will gift new membership. The should have sufficient funds at all times or registration will fail. | yes |
| PORT | 3002 | The web service will bind to `localhost:PORT` | no |
| PROVIDER |  | Websocket Url to a joystream-node eg. `ws://localhost:9944/` It is recommended to use fully qualified url to your host if the joystream-node is not a docker service in the same docker-compose network. | yes |
| BALANCE_CREDIT | 0 | The amount of funds to credit gifted member in base units | no |
| BALANCE_LOCKED | 0 | The portion of the credited funds that are locked in base units | no |
| SENDGRID_API_KEY | | The API key for [SendGrid](sendgrid.com) account used to send alert emails | no |
ALERT_FROM_EMAIL | | email address the alert emails will be be sent from | yes if SENDGRID_API_KEY is configured |
ALERT_TO_EMAIL | | comma separated list of destination email addresses to send alerts to | yes if SENDGRID_API_KEY is configured |
| ENABLE_API_THROTTLING | false | If API rate limit will be applied | no |
| GLOBAL_API_LIMIT_INTERVAL_HOURS | 1 | Interval in hours for which limit is applied | no |
| GLOBAL_API_LIMIT_MAX_IN_INTERVAL| 10 | The max number of registration allowed in the interval defined | no |
| PER_IP_API_LIMIT_INTERVAL_HOURS | 48 | The interval in hours for which limit is applied to a specific IP address | no |
| PER_IP_API_LIMIT_MAX_IN_INTERVAL | 1 | The max number of registration allowed from IP address in the defined interval | no|
HCAPTCHA_SECRET | | The [hCaptcha](https://www.hcaptcha.com/) secret to use for the deployed service | no but recommended |


## Running with docker

### Docker build

```
docker build . --tag joystream/faucet
```

### Docker-compose

copy the `env.example` to `.env` and configure the variables.
To see what the final configuration will look like:

```
docker compose convert
```

If you are satisfied, star the service with:

```
docker compose up -d
```

### Setup Reverse proxy
The webserice will be listening on localhost on the port you configured in your .env file.
To make the service available publicly you will need to setup a reverse proxy with an ssl certificate.
Nginx and caddy are good options. Example usage of caddy with [docker/docker-compose stack](https://hub.docker.com/_/caddy)