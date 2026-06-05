require('dotenv').config();
const fs = require('fs');
const path = require('path');

let sqliteDb = null;
let useJsonFallback = false;
let dbEngine = 'sqlite';

const JSON_DB_PATH = path.join(__dirname, 'gymnastics_db.json');

// Helper to load/save JSON database if fallback is active
function readJsonDb() {
  if (!fs.existsSync(JSON_DB_PATH)) {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify({ users: [], workouts: [], section_details: [] }, null, 2), 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(JSON_DB_PATH, 'utf8'));
  } catch (err) {
    return { users: [], workouts: [], section_details: [] };
  }
}

function writeJsonDb(data) {
  fs.writeFileSync(JSON_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Initialize database
function initDb() {
  dbEngine = process.env.DB_ENGINE || 'sqlite';
  if (dbEngine === 'sqlite') {
    try {
      const sqlite3 = require('sqlite3').verbose();
      const dbPath = path.join(__dirname, 'gymnastics.db');
      sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('DATABASE: Failed to connect to SQLite. Using JSON fallback.', err.message);
          useJsonFallback = true;
          dbEngine = 'json';
        } else {
          console.log('DATABASE: Connected to SQLite database.');
          // Initialize tables
          sqliteDb.serialize(() => {
            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `);
            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                mode TEXT NOT NULL,
                reps INTEGER NOT NULL,
                avg_score REAL NOT NULL,
                duration_seconds INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
              )
            `);
            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS section_details (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workout_id INTEGER NOT NULL,
                section_index INTEGER NOT NULL,
                reps INTEGER NOT NULL,
                score REAL NOT NULL,
                FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE
              )
            `);
          });
        }
      });
    } catch (err) {
      console.warn('DATABASE: sqlite3 module not found. Falling back to local JSON file database.', err.message);
      useJsonFallback = true;
      dbEngine = 'json';
    }
  } else {
    useJsonFallback = true;
    dbEngine = 'json';
    console.log('DATABASE: Configured to use JSON database.');
  }
}

initDb();

const db = {
  getEngine: () => dbEngine,
  isUsingFallback: () => useJsonFallback,

  // --- Users Operations ---
  getUsers: () => {
    return new Promise((resolve, reject) => {
      if (dbEngine === 'sqlite' && sqliteDb) {
        sqliteDb.all('SELECT * FROM users ORDER BY username ASC', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        const data = readJsonDb();
        resolve(data.users);
      }
    });
  },

  createUser: (username) => {
    return new Promise((resolve, reject) => {
      const cleanUsername = username.trim();
      if (!cleanUsername) return reject(new Error('Username cannot be empty'));

      if (dbEngine === 'sqlite' && sqliteDb) {
        sqliteDb.run('INSERT INTO users (username) VALUES (?)', [cleanUsername], function(err) {
          if (err) {
            if (err.message.includes('UNIQUE')) {
              reject(new Error('Username already exists'));
            } else {
              reject(err);
            }
          } else {
            resolve({ id: this.lastID, username: cleanUsername, created_at: new Date().toISOString() });
          }
        });
      } else {
        const data = readJsonDb();
        const exists = data.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
        if (exists) {
          return reject(new Error('Username already exists'));
        }
        const newUser = {
          id: data.users.length > 0 ? Math.max(...data.users.map(u => u.id)) + 1 : 1,
          username: cleanUsername,
          created_at: new Date().toISOString()
        };
        data.users.push(newUser);
        writeJsonDb(data);
        resolve(newUser);
      }
    });
  },

  // --- Workouts Operations ---
  getWorkouts: (userId) => {
    return new Promise((resolve, reject) => {
      const uId = parseInt(userId);
      if (dbEngine === 'sqlite' && sqliteDb) {
        sqliteDb.all('SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC', [uId], (err, rows) => {
          if (err) {
            return reject(err);
          }
          if (rows.length === 0) {
            return resolve([]);
          }
          // Fetch section details for each workout
          const workoutIds = rows.map(r => r.id);
          const placeholders = workoutIds.map(() => '?').join(',');
          sqliteDb.all(`SELECT * FROM section_details WHERE workout_id IN (${placeholders})`, workoutIds, (detailsErr, detailsRows) => {
            if (detailsErr) return reject(detailsErr);
            const workoutsWithDetails = rows.map(w => {
              w.section_details = detailsRows.filter(d => d.workout_id === w.id);
              return w;
            });
            resolve(workoutsWithDetails);
          });
        });
      } else {
        const data = readJsonDb();
        const userWorkouts = data.workouts
          .filter(w => w.user_id === uId)
          .map(w => {
            const details = data.section_details.filter(d => d.workout_id === w.id);
            return { ...w, section_details: details };
          })
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        resolve(userWorkouts);
      }
    });
  },

  saveWorkout: (workout) => {
    return new Promise((resolve, reject) => {
      const { user_id, mode, reps, avg_score, duration_seconds, section_details } = workout;
      const uId = parseInt(user_id);

      if (dbEngine === 'sqlite' && sqliteDb) {
        sqliteDb.serialize(() => {
          sqliteDb.run('BEGIN TRANSACTION');
          sqliteDb.run(
            'INSERT INTO workouts (user_id, mode, reps, avg_score, duration_seconds) VALUES (?, ?, ?, ?, ?)',
            [uId, mode, reps, avg_score, duration_seconds],
            function(err) {
              if (err) {
                sqliteDb.run('ROLLBACK');
                return reject(err);
              }
              const workoutId = this.lastID;
              
              if (section_details && Array.isArray(section_details) && section_details.length > 0) {
                const stmt = sqliteDb.prepare('INSERT INTO section_details (workout_id, section_index, reps, score) VALUES (?, ?, ?, ?)');
                for (const d of section_details) {
                  stmt.run([workoutId, d.section_index, d.reps, d.score]);
                }
                stmt.finalize((finalizeErr) => {
                  if (finalizeErr) {
                    sqliteDb.run('ROLLBACK');
                    return reject(finalizeErr);
                  }
                  sqliteDb.run('COMMIT', (commitErr) => {
                    if (commitErr) return reject(commitErr);
                    resolve({
                      id: workoutId,
                      user_id: uId,
                      mode,
                      reps,
                      avg_score,
                      duration_seconds,
                      section_details,
                      created_at: new Date().toISOString()
                    });
                  });
                });
              } else {
                sqliteDb.run('COMMIT', (commitErr) => {
                  if (commitErr) return reject(commitErr);
                  resolve({
                    id: workoutId,
                    user_id: uId,
                    mode,
                    reps,
                    avg_score,
                    duration_seconds,
                    section_details: [],
                    created_at: new Date().toISOString()
                  });
                });
              }
            }
          );
        });
      } else {
        const data = readJsonDb();
        const userExists = data.users.some(u => u.id === uId);
        if (!userExists) return reject(new Error('User does not exist'));

        const workoutId = data.workouts.length > 0 ? Math.max(...data.workouts.map(w => w.id)) + 1 : 1;
        const newWorkout = {
          id: workoutId,
          user_id: uId,
          mode,
          reps: parseInt(reps),
          avg_score: parseFloat(avg_score),
          duration_seconds: parseInt(duration_seconds),
          created_at: new Date().toISOString()
        };
        data.workouts.push(newWorkout);

        const newDetails = [];
        if (section_details && Array.isArray(section_details)) {
          section_details.forEach(d => {
            const detailId = data.section_details.length > 0 ? Math.max(...data.section_details.map(sd => sd.id)) + 1 : 1;
            const newDetail = {
              id: detailId,
              workout_id: workoutId,
              section_index: parseInt(d.section_index),
              reps: parseInt(d.reps),
              score: parseFloat(d.score)
            };
            data.section_details.push(newDetail);
            newDetails.push(newDetail);
          });
        }

        writeJsonDb(data);
        resolve({ ...newWorkout, section_details: newDetails });
      }
    });
  },

  deleteWorkout: (id) => {
    return new Promise((resolve, reject) => {
      const wId = parseInt(id);
      if (dbEngine === 'sqlite' && sqliteDb) {
        sqliteDb.run('DELETE FROM workouts WHERE id = ?', [wId], function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        });
      } else {
        const data = readJsonDb();
        const index = data.workouts.findIndex(w => w.id === wId);
        if (index !== -1) {
          data.workouts.splice(index, 1);
          data.section_details = data.section_details.filter(d => d.workout_id !== wId);
          writeJsonDb(data);
          resolve(true);
        } else {
          resolve(false);
        }
      }
    });
  },

  // --- Stats Aggregations ---
  getUserStats: (userId) => {
    return new Promise((resolve, reject) => {
      const uId = parseInt(userId);
      if (dbEngine === 'sqlite' && sqliteDb) {
        const stats = {
          total_reps: 0,
          avg_score: 0,
          total_workouts: 0,
          by_section: {},
          recent: []
        };

        sqliteDb.get(
          `SELECT SUM(reps) as total_reps, AVG(avg_score) as avg_score, COUNT(*) as total_workouts 
           FROM workouts WHERE user_id = ?`,
          [uId],
          (err, overall) => {
            if (err) return reject(err);

            if (overall && overall.total_workouts > 0) {
              stats.total_reps = overall.total_reps || 0;
              stats.avg_score = parseFloat((overall.avg_score || 0).toFixed(1));
              stats.total_workouts = overall.total_workouts || 0;
            }

            // Get average score & total reps by section index
            sqliteDb.all(
              `SELECT sd.section_index, SUM(sd.reps) as reps, AVG(sd.score) as avg_score 
               FROM section_details sd
               JOIN workouts w ON sd.workout_id = w.id
               WHERE w.user_id = ?
               GROUP BY sd.section_index`,
              [uId],
              (err, sectionRows) => {
                if (err) return reject(err);

                sectionRows.forEach(row => {
                  stats.by_section[row.section_index] = {
                    reps: row.reps || 0,
                    avg_score: parseFloat((row.avg_score || 0).toFixed(1))
                  };
                });

                // Get last 10 workouts
                sqliteDb.all(
                  `SELECT * FROM (
                    SELECT * FROM workouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
                  ) ORDER BY created_at ASC`,
                  [uId],
                  (err, recentRows) => {
                    if (err) return reject(err);
                    stats.recent = recentRows;
                    resolve(stats);
                  }
                );
              }
            );
          }
        );
      } else {
        const data = readJsonDb();
        const userWorkouts = data.workouts.filter(w => w.user_id === uId);
        const workoutIds = userWorkouts.map(w => w.id);
        const allDetails = data.section_details.filter(d => workoutIds.includes(d.workout_id));
        
        const summary = {
          total_reps: userWorkouts.reduce((sum, w) => sum + w.reps, 0),
          avg_score: userWorkouts.length > 0 
            ? parseFloat((userWorkouts.reduce((sum, w) => sum + w.avg_score, 0) / userWorkouts.length).toFixed(1)) 
            : 0,
          total_workouts: userWorkouts.length,
          by_section: {},
          recent: userWorkouts
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .slice(-10)
        };

        // Group details by section
        const sectionGroups = {};
        allDetails.forEach(d => {
          if (!sectionGroups[d.section_index]) {
            sectionGroups[d.section_index] = { reps: 0, scores: [] };
          }
          sectionGroups[d.section_index].reps += d.reps;
          sectionGroups[d.section_index].scores.push(d.score);
        });

        Object.keys(sectionGroups).forEach(sectionIdx => {
          const group = sectionGroups[sectionIdx];
          const avg = group.scores.length > 0
            ? parseFloat((group.scores.reduce((a, b) => a + b, 0) / group.scores.length).toFixed(1))
            : 0;
          summary.by_section[sectionIdx] = {
            reps: group.reps,
            avg_score: avg
          };
        });

        resolve(summary);
      }
    });
  }
};

module.exports = db;
