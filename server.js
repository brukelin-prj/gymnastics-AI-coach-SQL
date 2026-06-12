const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON Request parsing
app.use(express.json());

// Basic Authentication Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).send('Authentication required');
  }
  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];
  if (user === 'admin' && pass === 'admin888') {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).send('Authentication failed');
  }
};

// Route to protect admin.html
app.get('/admin.html', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

console.log(`Database engine loaded. Engine: ${db.getEngine()}. JSON Fallback: ${db.isUsingFallback()}`);

// --- API ENDPOINTS ---

// 1. Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create new user profile
app.post('/api/users', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    const newUser = await db.createUser(username);
    res.status(201).json(newUser);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Get user's workout logs
app.get('/api/workouts', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }
    const workouts = await db.getWorkouts(user_id);
    res.json(workouts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Save workout log with section details
app.post('/api/workouts', async (req, res) => {
  try {
    const { user_id, mode, reps, avg_score, duration_seconds, section_details } = req.body;
    if (!user_id || !mode || reps === undefined || avg_score === undefined || duration_seconds === undefined) {
      return res.status(400).json({ error: 'Missing required workout parameters' });
    }
    const newWorkout = await db.saveWorkout({ user_id, mode, reps, avg_score, duration_seconds, section_details });
    res.status(201).json(newWorkout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete workout session log
app.delete('/api/workouts/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.deleteWorkout(id);
    if (deleted) {
      res.json({ success: true, message: 'Workout log deleted' });
    } else {
      res.status(404).json({ error: 'Workout log not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get stats dashboard info
app.get('/api/stats', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }
    const stats = await db.getUserStats(user_id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Get admin panel summary stats
app.get('/api/admin/summary', authMiddleware, async (req, res) => {
  try {
    const summary = await db.getAdminSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback index.html mapping for single-page client app route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`📻 復古國民健康操 AI Coach 後端伺服器啟動成功！`);
  console.log(`👉 後端 API / 前端伺服入口: http://localhost:${PORT}/`);
  console.log(`=======================================================`);
});
