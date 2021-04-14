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
    "memberId": 21
}
```

On error expect a JSON response:
```
{
    "error": "ErrorType"
}
```