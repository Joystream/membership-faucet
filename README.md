# Membership Faucet

Membership on-boarding service for Joystream network.

## How to Install

Clone the repo, then run:

```
$ yarn
```

to install. Add your config variables to `env.example` and rename it to `.env` and then run:

```
$ yarn start
```

to start and build the server.

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