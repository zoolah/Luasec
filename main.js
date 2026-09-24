require('dotenv').config({ silent: true });
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord');
const path = require('path');
const helmet = require('helmet');
const { Client, GatewayIntentBits } = require('discord.js');
const rateLimit = require('express-rate-limit');
const { initializeBot } = require('./bot');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const cors = require('cors');
const nodeCrypto = require('crypto');
const http = require('http');

const disablePayments = false; 

const fs = require("fs");
const util = require("util");
const logFile = fs.createWriteStream("./logs.txt", { flags: "a" });

["log", "warn", "error", "debug"].forEach((method) => {
    const orig = console[method];
    console[method] = (...args) => {
        const argsStr = util.format(...args);
        if (argsStr.includes('circular dependency') || argsStr.includes('Accessing non-existent property') || argsStr.includes('dotenv') || argsStr.includes('ephemeral')) return;
        const message = `[${method.toUpperCase()}] ${argsStr}\n`;
        logFile.write(message);
        orig.apply(console, args);
    };
});

const REQUIRED_ENVS = ['MONGO_URI', 'SECRET', 'CLIENT_ID', 'CLIENT_SECRET', 'BASE_URL', 'TOKEN'];
const missing = REQUIRED_ENVS.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
app.disable('x-powered-by');

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));

app.use(rateLimit({
  windowMs: 10 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.'
}));

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('Mongo connected'))
  .catch(err => { console.error('Mongo connection error:', err.message); process.exit(1); });

const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI, collectionName: 'sessions' }),
  cookie: {
    secure: isProd, 
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 
  }
}));
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  if (req.session && !req.session.encKey) {
    req.session.encKey = nodeCrypto.randomBytes(32).toString('hex');
  }
  if (req.session) res.locals.encKey = req.session.encKey;
  next();
});

app.use((req, res, next) => {
  if (req.headers['x-enc'] === '1' && req.body && req.body._enc && req.session && req.session.encKey) {
    try {
      const key = Buffer.from(req.session.encKey, 'hex');
      const raw = Buffer.from(req.body._enc, 'base64');
      const iv = raw.slice(0, 12);
      const tag = raw.slice(raw.length - 16);
      const ct = raw.slice(12, raw.length - 16);
      const dec = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
      dec.setAuthTag(tag);
      let plain = dec.update(ct, null, 'utf8');
      plain += dec.final('utf8');
      req.body = JSON.parse(plain);
    } catch (e) {
      return res.status(400).json({ error: 'Bad request' });
    }
  }
  next();
});

app.use((req, res, next) => {
  const baseHostname = new URL(process.env.BASE_URL || 'https://app.yourdomain.com').hostname;
  if (req.session && req.session.encKey && req.hostname === baseHostname) {
    const _origJson = res.json.bind(res);
    res.json = function (data) {
      try {
        const key = Buffer.from(req.session.encKey, 'hex');
        const iv = nodeCrypto.randomBytes(12);
        const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
        let ct = cipher.update(JSON.stringify(data), 'utf8');
        ct = Buffer.concat([ct, cipher.final()]);
        const tag = cipher.getAuthTag();
        const result = Buffer.concat([iv, ct, tag]).toString('base64');
        return _origJson({ _enc: result });
      } catch (e) {
        return _origJson(data);
      }
    };
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'frontend'));


function setupPassport() {
  passport.use(new Strategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/redirect`,
    scope: ['identify', 'guilds']
  }, (accessToken, refreshToken, profile, done) => {
    profile.accessToken = accessToken;
    done(null, profile);
  }));
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));
}
setupPassport();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });
initializeBot(client);


const createMainRouter = require('./routes/mainRouter');
const createAuthRouter = require('./routes/authRouter');
const createApiRouter = require('./routes/apiRouter');
const createDocsRouter = require('./routes/docsRouter');
const createCdnRouter = require('./routes/cdnRouter');


const mainRouter = createMainRouter({ client, disablePayments });
const authRouter = createAuthRouter({ client });

const { lootlabsCache } = require('./bot');
const apiRouter = createApiRouter({ lootlabsCache });
const docsRouter = createDocsRouter();
const cdnRouter = createCdnRouter();

const hostRouterMap = new Map([
  ['app.yourdomain.com', mainRouter],
  ['auth.yourdomain.com', authRouter],
  ['api.yourdomain.com', apiRouter],
  ['docs.yourdomain.com', docsRouter],
  ['cdn.yourdomain.com', cdnRouter]
]);

app.use((req, res, next) => {
  if (req.hostname === 'localhost') {
    return res.status(400).send('Server is up!');
  }
  const r = hostRouterMap.get(req.hostname);
  return r ? r(req, res, next) : next();
});

app.get('/healthz', (req, res) => {
  const mongoState = mongoose.connection.readyState; 
  res.json({ status: 'ok', mongo: mongoState === 1 ? 'connected' : 'disconnected' });
});



process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

let server;
function start() {
  const PORT = process.env.PORT || 3000;
  server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  if (server) {
    server.close(() => {
      mongoose.connection.close(false).then(() => process.exit(0));
    });
  } else {
    process.exit(0);
  }
}
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => gracefulShutdown(sig)));

app.use((req, res, next) => {
  if (req.hostname === 'localhost') {
    return res.status(400).send('Server is up!');
  }
  const isApi = req.hostname.includes('api.');
  if (isApi) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('error', {
    title: 'Page Not Found',
    code: 404,
    message: 'The page you are looking for does not exist or has been moved.',
    routes: {}
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const isApi = req.hostname && req.hostname.includes('api.');
  if (isApi) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).render('error', {
    title: 'Server Error',
    code: 500,
    message: 'An unexpected error occurred. Our team has been notified.',
    details: process.env.NODE_ENV === 'production' ? undefined : err.message,
    routes: {}
  });
});

start();
