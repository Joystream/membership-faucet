import express from 'express'
import cors from 'cors'
import { log } from './debug'
import { JoyApi } from './joyApi'
import { register, getGlobalRemainingRegistrations } from './register'
import { AnyJson } from '@polkadot/types/types'
import bodyParser from 'body-parser'
import locks from 'locks'
import { HCAPTCHA_ENABLED, PORT, PROMETHEUS_PORT } from './config'
import prom from 'prom-client'

export const metrics = {
  register_success: new prom.Counter({
    name: 'register_success',
    help: 'Total successful registrations.',
    labelNames: ['code'],
  }),
  register_failure_user: new prom.Counter({
    name: 'register_failure_user',
    help: 'Failure due user input.',
    labelNames: ['code', 'reason'],
  }),
  register_failure_server: new prom.Counter({
    name: 'register_failure_server',
    help: 'Failure due to internal server error.',
    labelNames: ['code', 'reason'],
  }),
  register_attempt: new prom.Counter({
    name: 'register_attempt',
    help: 'Total registration attempts.',
  }),
  response_time: new prom.Histogram({
    name: 'register_response',
    help: 'response time',
  }),
}

const app = express()

const joy = new JoyApi()
app.use(bodyParser.json())

const processingRequest = locks.createMutex()

app.use(cors())

// Configure number of hops behind reverse proxy
app.set('trust proxy', 1)

// ip endpoint to show request ip address for debugging
app.get('/ip', (request, response) => response.send(request.ip))

app.get('/status', async (req, res) => {
  await joy.init
  const { isSyncing } = await joy.api.rpc.system.health()
  const isReady = !isSyncing.isTrue
  const limit = await getGlobalRemainingRegistrations()

  res.setHeader('Content-Type', 'application/json')
  if (!isReady) {
    res.status(503).send({
      isSynced: false,
      hasEnoughFunds: null,
      message: 'Chain is still syncing',
      limit,
    })
    return
  }

  const exampleGiftMembershipTx = joy.makeGiftMembershipTx({
    account: '5Dbstm8wPgrKAwHeMe8xxqxDXyFmP3jyzYdmsiiwTdCdt9iU', // just a random account
    handle: 'new_member',
    avatar: 'https://example.com/avatar.png',
  })
  const hasEnoughFunds = await joy.invitingAccountHasFundsToGift(
    exampleGiftMembershipTx,
    5
  )

  if (!hasEnoughFunds) {
    res.status(503).send({
      isSynced: true,
      hasEnoughFunds: false,
      message: 'Inviting account has limited funds for at most 5 new members.',
      limit,
    })
    return
  }

  res.status(200).send({
    isSynced: true,
    hasEnoughFunds: true,
    message: 'All Systems Go!',
    limit,
  })
})

app.post('/register', async (req, res) => {
  log(`Register request from=${req.ip} handle=${req.body.handle} captchaToken=${req.body.captchaToken}`)
  metrics.register_attempt.inc(1)

  await joy.init

  // if node is still syncing .. don't process request
  const { isSyncing } = await joy.api.rpc.system.health()
  if (isSyncing.isTrue) {
    res.setHeader('Content-Type', 'application/json')
    res.status(500).send({
      error: 'NodeNotReady',
    })
    metrics.register_failure_server.inc(
      { code: 500, reason: 'still_syncing' },
      1
    )
    return
  }

  const callback = (result: AnyJson, statusCode: number) => {
    res.setHeader('Content-Type', 'application/json')
    res.status(statusCode).send(result)
    const { error } = result as any
    if (statusCode >= 500) {
      metrics.register_failure_server.inc(
        { code: statusCode, reason: error },
        1
      )
    } else if (statusCode >= 400) {
      metrics.register_failure_user.inc({ code: statusCode, reason: error }, 1)
    } else {
      metrics.register_success.inc({ code: statusCode }, 1)
    }
  }

  const {
    account,
    handle,
    avatar,
    about,
    name,
    externalResources,
    captchaToken,
  } = req.body

  const captchaBypassKey = (req: express.Request) => {
    const authHeader = req.headers['authorization']
    return authHeader && authHeader.split(' ')[1]
  }

  processingRequest.lock(async () => {
    const stopTimer = metrics.response_time.startTimer()
    try {
      await register(
        req.ip,
        joy,
        account,
        handle,
        name,
        avatar,
        about,
        externalResources,
        captchaToken,
        captchaBypassKey(req),
        callback
      )
    } catch (err) {
      log(err)
      res.status(500).end()
      metrics.register_failure_server.inc(
        { code: 500, reason: 'internal_error' },
        1
      )
    } finally {
      processingRequest.unlock()
      stopTimer()
      log('request handled')
    }
  })
})

app.listen(PORT, () => {
  log(`server started at http://localhost:${PORT}`)
  log(`captcha ${HCAPTCHA_ENABLED ? 'enabled' : 'disabled'}`)
})

const prometheus = express()
prometheus.get('/metrics', async (request, response) => {
  response.set('Content-Type', prom.register.contentType)
  response.send(await prom.register.metrics())
})

prometheus.listen(PROMETHEUS_PORT, () => {
  log(`prometheus metrics at http://localhost:${PROMETHEUS_PORT}/metrics`)
})
