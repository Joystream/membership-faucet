import express from 'express'
import cors from 'cors'
import { log } from './debug'
import { JoyApi } from './joyApi'
import { register } from './register'
import { AnyJson } from '@polkadot/types/types'
import bodyParser from 'body-parser'
import locks from 'locks'
import { HCAPTCHA_ENABLED, PORT } from './config'

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

  res.setHeader('Content-Type', 'application/json')
  if (!isReady) {
    res.status(503).send({
      isSynced: false,
      hasEnoughFunds: null,
      message: 'Chain is still syncing',
    })
    return
  }

  const exampleGiftMembershipTx = joy.makeGiftMembershipTx({
    account: '5Dbstm8wPgrKAwHeMe8xxqxDXyFmP3jyzYdmsiiwTdCdt9iU', // just a random account
    handle: 'new_member',
    avatar: 'https://example.com/avatar.png',
  })
  const hasEnoughFunds = await joy.invitingAccountHasFundsToGift(
    exampleGiftMembershipTx
  )

  if (!hasEnoughFunds) {
    res.status(503).send({
      isSynced: true,
      hasEnoughFunds: false,
      message: 'Inviting account does not have enough funds to gift membership',
    })
    return
  }

  res.status(200).send({
    isSynced: true,
    hasEnoughFunds: true,
    message: 'All Systems Go!',
  })
})

app.post('/register', async (req, res) => {
  log(`register request for ${req.body.handle} from ${req.ip}`)

  await joy.init

  // if node is still syncing .. don't process request
  const { isSyncing } = await joy.api.rpc.system.health()
  if (isSyncing.isTrue) {
    res.setHeader('Content-Type', 'application/json')
    res.status(500).send({
      error: 'NodeNotReady',
    })
    return
  }

  const callback = (result: AnyJson, statusCode: number) => {
    processingRequest.unlock()
    res.setHeader('Content-Type', 'application/json')
    res.status(statusCode).send(result)
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
      processingRequest.unlock()
      log(err)
      res.status(500).end()
    }
  })
})

app.listen(PORT, () => {
  log(`server started at http://localhost:${PORT}`)
  log(`captcha ${HCAPTCHA_ENABLED ? 'enabled' : 'disabled'}`)
})
