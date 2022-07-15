import express from "express";
import cors from "cors";
import { log } from './debug';
import { JoyApi } from "./joyApi";
import { register } from './register'
import { AnyJson } from "@polkadot/types/types";
import bodyParser from 'body-parser';
import locks from "locks";

const app = express();
const port = parseInt(process.env.PORT || '3002');
const joy = new JoyApi();
app.use(bodyParser.json())

const processingRequest = locks.createMutex();

app.use(cors());

// Configure number of hops behind reverse proxy
app.set('trust proxy', 1)

// ip endpoint to show request ip address for debugging
app.get('/ip', (request, response) => response.send(request.ip))

app.get("/status", async (req, res) => {
  await joy.init
  const { isSyncing } = await joy.api.rpc.system.health()
  if (isSyncing.isTrue) {
    res.setHeader("Content-Type", "application/json");
    res.send({
      ready: false,
      message: 'Chain is still syncing',
    });
    return
  } else {
    res.setHeader("Content-Type", "application/json");
    res.send({
      ready: true,
      message: 'All Systems Go!',
    });
  }
});

app.post("/register", async (req, res) => {
  log(`register request for ${req.body.handle} from ${req.ip}`)

  await joy.init

  // if node is still syncing .. don't process request
  const { isSyncing } = await joy.api.rpc.system.health()
  if (isSyncing.isTrue) {
    res.setHeader("Content-Type", "application/json");
    res.status(500).send({
      error: 'NodeNotReady'
    });
    return
  }

  const callback = (result: AnyJson, statusCode: number) => {
    processingRequest.unlock();
    res.setHeader("Content-Type", "application/json");
    res.status(statusCode).send(result);
  }

  const { account, handle, avatar, about, name, externalResources } = req.body

  processingRequest.lock(async () => {
    try {
      await register(req.ip, joy, account, handle, name, avatar, about, externalResources, callback);
    } catch (err) {
      processingRequest.unlock();
      log(err)
      res.status(500).end()
    }
  })
});

app.listen(port, () => {
  log(`server started at http://localhost:${port}`);
});
