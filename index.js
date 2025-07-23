import fetch from 'node-fetch';

const ACCOUNTS_URL = 'https://raw.githubusercontent.com/palacejs/deneme/refs/heads/main/ws2.txt';
const TOKEN_POST_URL = 'https://msp2lol.onrender.com/save-token';
const LOGIN_URL = "https://msp2.pages.dev/api/tool-login?q=eu";

const MAX_PARALLEL = 2;
const DELAY_BETWEEN_BATCHES = 5000; // 5 saniye

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAccounts() {
  try {
    const res = await fetch(ACCOUNTS_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const text = await res.text();
    return text.split('\n').map(l => l.trim()).filter(Boolean);
  } catch (e) {
    console.error('❌ Error fetching accounts:', e.message);
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
      password,
      acr_values: 'gameId:j68d'
    });

    const loginRes = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const loginData = await loginRes.json();

    if (loginData.error) throw new Error(`Login failed: ${loginData.error}`);

    const { access_token, refresh_token } = loginData;
    if (!access_token) throw new Error('No access token received');

    const [, payloadB64] = access_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
    const sub = payload.sub;
    if (!sub) throw new Error('Invalid token payload');

    const profilesRes = await fetch(`https://eu.mspapis.com/profileidentity/v1/logins/${sub}/profiles?filter=region:${countryCode}`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    if (!profilesRes.ok) throw new Error(`Profiles fetch failed: ${profilesRes.status}`);

    const profiles = await profilesRes.json();
    if (!profiles.length) throw new Error('No profiles found');

    const profileId = profiles[0].id;

    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
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
    if (finalData.error) throw new Error('Token refresh failed');
    return finalData.access_token;
  } catch (e) {
    console.error(`❌ Login error for ${username}: ${e.message}`);
    return null;
  }
}

async function sendToken(token) {
  try {
    const res = await fetch(TOKEN_POST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jwt: token })
    });
    if (!res.ok) throw new Error(`Failed to send token: ${res.statusText}`);
    console.log('✅ Token sent successfully');
  } catch (e) {
    console.error('❌ Token submission error:', e.message);
  }
}

async function processAccount(line, idx) {
  const [username, password, countryCode] = line.split(':');
  if (!username || !password || !countryCode) {
    console.error(`⚠️ Invalid account format at line ${idx + 1}`);
    return;
  }
  console.log(`🔐 [${idx + 1}] Logging in: ${username}`);
  const token = await login(username, password, countryCode);
  if (token) await sendToken(token);
}

async function run() {
  const accounts = await fetchAccounts();
  if (!accounts.length) {
    console.error('⚠️ No accounts found');
    return;
  }
  console.log(`🚀 Total accounts: ${accounts.length}`);

  for (let i = 0; i < accounts.length; i += MAX_PARALLEL) {
    const batch = accounts.slice(i, i + MAX_PARALLEL);
    const batchNumber = Math.floor(i / MAX_PARALLEL) + 1;

    console.log(`⚙️ Starting batch ${batchNumber} with ${batch.length} accounts...`);
    await Promise.all(batch.map((line, idx) => processAccount(line, i + idx)));

    console.log(`✅ Batch ${batchNumber} done. Waiting ${DELAY_BETWEEN_BATCHES / 1000}s...`);
    if (i + MAX_PARALLEL < accounts.length) await delay(DELAY_BETWEEN_BATCHES);
  }

  console.log('🏁 All accounts processed.');
}

async function loop() {
  while (true) {
    console.log('🔄 Starting new run...');
    await run();
    console.log('⏳ Waiting 4 hours...');
    await delay(4 * 60 * 60 * 1000);
  }
}

loop();
