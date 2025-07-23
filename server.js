const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const FILE_PATH = path.join(__dirname, 'tokens.json');
const TOKEN_EXPIRATION_HOURS = 3.5;

let writeQueue = Promise.resolve(); // ✅ Dosya işlemlerini sıraya almak için

function cleanExpiredTokens(data) {
  const now = new Date();
  const validTokens = data.tokens.filter(entry => new Date(entry.expiresAt) > now);
  return {
    count: validTokens.length,
    tokens: validTokens
  };
}

// 📥 Token kaydetme endpointi
app.post('/save-token', (req, res) => {
  const { jwt } = req.body;
  if (!jwt) return res.status(400).json({ error: 'JWT missing' });

  // 📌 Tüm işlemi sıraya al
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

                // Yedeğe al
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
          return resolve(); // sırayı ilerlet
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
          resolve(); // sırayı ilerlet
        });
      });
    });
  }).catch(e => {
    console.error('🔁 Queue error:', e);
    res.status(500).json({ error: 'Internal error' });
  });
});

// 📤 Tokenları listele
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
