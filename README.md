# Membership Faucet

Membership on-boarding service for Joystream network.

## Install

Clone the repo, then run:

```
$ yarn install
```

to install. 

## Run
Add your config variables to `env.example` and rename it to `.env` and then run:

```
$ yarn build
$ yarn start
```

Will build and start the server.

## API

### `POST /register`
Send a JSON in the request body:

```
{
    "account": "5HGjWAeFDfFCWPsjFQdVV2Msvz2XtMktvgocEZcCj68kUMaw",
    "handle": "myhandle"
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
