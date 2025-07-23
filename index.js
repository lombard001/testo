const fetch = require('node-fetch');

const ACCOUNTS_URL = 'https://raw.githubusercontent.com/palacejs/deneme/refs/heads/main/ws2.txt';
const TOKEN_POST_URL = 'https://msp2lol.onrender.com/save-token';
const LOGIN_URL = 'https://msp2.pages.dev/api/tool-login?q=eu';

const MAX_PARALLEL = 2;
const DELAY_BETWEEN_BATCHES = 5000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAccounts() {
  try {
    const response = await fetch(ACCOUNTS_URL);
    const text = await response.text();
    return text.split('\n').map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error("❌ Error fetching accounts:", err.message);
    return [];
  }
}

async function login(username, password, countryCode) {
  try {
    const params = new URLSearchParams({
      client_id: 'unity.client',
      client_secret: 'secret',
      grant_type: 'password',
      scope: 'openid nebula offline_access',
      username: `${countryCode}|${username}`,
      password: password,
      acr_values: 'gameId:j68d'
    });

    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    const loginData = await loginRes.json();
    if (!loginData.access_token) throw new Error(loginData.error || 'Login failed');

    const [, payload] = loginData.access_token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    const sub = decoded.sub;

    // countryCode filtresini kaldırıp deneyebilirsin:
const profilesResponse = await fetch(`https://eu.mspapis.com/profileidentity/v1/logins/${sub}/profiles`, {
  headers: { 'Authorization': `Bearer ${access_token}` }
});


    if (!profileRes.ok) {
      console.error(`❌ Profile fetch error: HTTP ${profileRes.status} for user ${username}`);
      return null;
    }

    let profiles = [];
    try {
      const text = await profileRes.text();
      profiles = JSON.parse(text);
    } catch (err) {
      console.error(`⚠️ profiles response is not JSON for user ${username}:`, err.message);
      console.error('🔍 Response content:', await profileRes.text());
      return null;
    }

    if (!profiles.length) {
      console.error(`❌ No profiles found for user ${username}`);
      return null;
    }

    const profileId = profiles[0].id;
    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: loginData.refresh_token,
      acr_values: `gameId:j68d profileId:${profileId}`
    });

    const finalRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic dW5pdHkuY2xpZW50OnNlY3JldA==',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: refreshParams
    });

    const finalData = await finalRes.json();
    return finalData.access_token || null;

  } catch (err) {
    console.error(`❌ Login failed for ${username}: ${err.message}`);
    return null;
  }
}

async function sendToken(token) {
  try {
    await fetch(TOKEN_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: token })
    });
    console.log("✅ Token sent successfully");
  } catch (err) {
    console.error("❌ Error sending token:", err.message);
  }
}

async function processAccount(line, index) {
  const [username, password, countryCode] = line.split(':');
  if (!username || !password || !countryCode) {
    console.error(`⚠️ Invalid account format at line ${index + 1}`);
    return;
  }

  console.log(`🔐 [${index + 1}] Logging in: ${username}`);
  const token = await login(username, password, countryCode);
  if (token) await sendToken(token);
}

async function run() {
  const accounts = await fetchAccounts();
  if (!accounts.length) {
    console.error('⚠️ No accounts found');
    return;
  }

  for (let i = 0; i < accounts.length; i += MAX_PARALLEL) {
    const batch = accounts.slice(i, i + MAX_PARALLEL);
    await Promise.all(batch.map((line, idx) => processAccount(line, i + idx)));
    if (i + MAX_PARALLEL < accounts.length) await delay(DELAY_BETWEEN_BATCHES);
  }

  console.log("🏁 All accounts processed.");
}

// Döngü ile sürekli 4 saatte bir çalıştırma örneği:
async function loop() {
  while (true) {
    console.log("🚀 Yeni çalışma başlıyor...");
    await run();
    console.log("⏱ 4 saat bekleniyor...");
    await delay(4 * 60 * 60 * 1000);
  }
}

loop();
