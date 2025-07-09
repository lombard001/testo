import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const FILE_PATH = path.join(__dirname, 'tokens.json');
const TOKEN_EXPIRATION_HOURS = 3.5;
const ACCOUNTS_URL = 'https://cdn.jsdelivr.net/gh/palacejs/deneme@refs/heads/main/ws.txt';
const TOKEN_POST_URL = `http://localhost:${PORT}/save-token`;
const MAX_PARALLEL = 50;
const BATCH_DELAY = 2000;

let writeQueue = Promise.resolve();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanExpiredTokens(data) {
  const now = new Date();
  const validTokens = data.tokens.filter(entry => new Date(entry.expiresAt) > now);
  return {
    count: validTokens.length,
    tokens: validTokens
  };
}

app.post('/save-token', (req, res) => {
  const { jwt } = req.body;
  if (!jwt) return res.status(400).json({ error: 'JWT missing' });

  writeQueue = writeQueue.then(() => {
    return new Promise(resolve => {
      fs.readFile(FILE_PATH, 'utf8', (err, data) => {
        let tokenData = { count: 0, tokens: [] };

        if (!err && data) {
          try {
            tokenData = JSON.parse(data);
          } catch (e) {
            console.error('⚠️ JSON parse error:', e.message);
            const safeStart = data.indexOf('{');
            const safeEnd = data.lastIndexOf('}');
            if (safeStart !== -1 && safeEnd !== -1) {
              try {
                const fixed = data.slice(safeStart, safeEnd + 1);
                tokenData = JSON.parse(fixed);
                const backupPath = path.join(__dirname, `tokens_backup_${Date.now()}.json`);
                fs.writeFileSync(backupPath, data, 'utf8');
                console.warn(`🛡️ Bozuk dosya yedeklendi: ${backupPath}`);
              } catch (_) {
                console.warn('❌ Hâlâ kurtarılamadı. Boş JSON ile devam.');
              }
            }
          }
        }

        tokenData = cleanExpiredTokens(tokenData);

        const exists = tokenData.tokens.find(entry => entry.token === jwt);
        if (exists) {
          res.json({ message: 'Token already exists' });
          return resolve();
        }

        const now = new Date();
        const expires = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

        tokenData.tokens.push({
          token: jwt,
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString()
        });

        tokenData.count = tokenData.tokens.length;

        fs.writeFile(FILE_PATH, JSON.stringify(tokenData, null, 2), err => {
          if (err) {
            console.error('❌ Write error:', err);
            res.status(500).json({ error: 'Failed to save token' });
          } else {
            console.log('✅ Token saved');
            res.json({ message: 'Token saved successfully' });
          }
          resolve();
        });
      });
    });
  }).catch(e => {
    console.error('🔁 Queue error:', e);
    res.status(500).json({ error: 'Internal error' });
  });
});

app.get('/tokens', (req, res) => {
  fs.readFile(FILE_PATH, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Failed to read tokens' });

    try {
      let tokenData = JSON.parse(data);
      tokenData = cleanExpiredTokens(tokenData);
      res.json(tokenData);
    } catch (e) {
      res.status(500).json({ error: 'Invalid token file' });
    }
  });
});

app.get('/', (req, res) => {
  res.send('✅ Token server is running');
});

setInterval(() => {
  fs.readFile(FILE_PATH, 'utf8', (err, data) => {
    if (err || !data) return;
    try {
      const parsed = JSON.parse(data);
      const cleaned = cleanExpiredTokens(parsed);
      if (cleaned.tokens.length !== parsed.tokens.length) {
        fs.writeFile(FILE_PATH, JSON.stringify(cleaned, null, 2), err => {
          if (err) console.error('🧹 Temizleme sırasında yazma hatası:', err);
          else console.log('🧹 Süresi dolmuş tokenlar temizlendi (otomatik)');
        });
      }
    } catch (e) {
      console.error('🧹 Temizleme JSON parse hatası:', e.message);
    }
  });
}, 15 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ──────────────────────────────
// TOKEN ÇEKME VE GÖNDERME DÖNGÜSÜ
// ──────────────────────────────

async function login(username, password, countryCode) {
  try {
    const params = new URLSearchParams({
      client_id: 'unity.client',
      client_secret: 'secret',
      grant_type: 'password',
      scope: 'openid nebula offline_access',
      username: `${countryCode}|${username}`,
      password,
      acr_values: 'gameId:j68d'
    });

    const loginResponse = await fetch('https://msp2.pages.dev/api/tool-login?q=eu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    }).then(res => res.json());

    if (loginResponse.error) throw new Error('Login failed: ' + loginResponse.error);

    const { access_token, refresh_token } = loginResponse;
    if (!access_token) throw new Error('No access token received');

    const [, payloadBase64] = access_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
    const sub = payload?.sub;
    if (!sub) throw new Error('Invalid token payload');

    const profilesResponse = await fetch(`https://eu.mspapis.com/profileidentity/v1/logins/${sub}/profiles?filter=region:${countryCode}`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    const profiles = await profilesResponse.json();
    if (!profiles.length) throw new Error('No profiles found');

    const profileId = profiles[0].id;

    const finalTokenResponse = await fetch('https://eu-secure.mspapis.com/loginidentity/connect/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic dW5pdHkuY2xpZW50OnNlY3JldA==',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token,
        acr_values: `gameId:j68d profileId:${profileId}`
      })
    }).then(res => res.json());

    if (finalTokenResponse.error) throw new Error('Token refresh failed');
    return finalTokenResponse.access_token;
  } catch (error) {
    if (error.message.includes('429')) {
      console.warn(`⏳ Rate limit detected. Waiting...`);
      await delay(5000);
    }
    console.error(`Login error for ${username}:`, error.message);
    return null;
  }
}

async function sendToken(token) {
  try {
    const response = await fetch(TOKEN_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: token })
    });
    if (!response.ok) throw new Error(`Failed to send token: ${response.statusText}`);
    console.log('✅ Token sent successfully');
  } catch (error) {
    console.error('❌ Token submission error:', error.message);
  }
}

async function processAccount(line, index) {
  const [username, password, countryCode] = line.split(':');
  if (!username || !password || !countryCode) {
    console.error(`⚠️ Invalid account format at line ${index + 1}`);
    return;
  }

  console.log(`🔐 Logging in [${index + 1}]: ${username}`);
  const token = await login(username, password, countryCode);
  if (token) await sendToken(token);
}

async function run() {
  const accounts = await fetchAccounts();
  if (accounts.length === 0) {
    console.error('⚠️ No accounts available');
    return;
  }

  console.log(`🚀 Total accounts: ${accounts.length}`);
  let index = 0;

  while (index < accounts.length) {
    const batch = accounts.slice(index, index + MAX_PARALLEL);
    console.log(`🔄 Starting batch ${Math.floor(index / MAX_PARALLEL) + 1}...`);

    await Promise.all(batch.map((line, i) => processAccount(line, index + i)));
    index += MAX_PARALLEL;
    console.log(`✅ Batch ${Math.floor(index / MAX_PARALLEL)} completed.`);
    await delay(BATCH_DELAY);
  }

  console.log('🏁 All accounts processed.');
}

async function mainLoop() {
  while (true) {
    console.log("🕒 Yeni döngü başladı:", new Date().toLocaleTimeString());
    await run();
    console.log("⏳ 5 dakika bekleniyor...\n");
    await delay(5 * 60 * 1000);
  }
}

mainLoop();
