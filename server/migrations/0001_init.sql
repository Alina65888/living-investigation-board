-- Living Project HQ team server: people, sessions, shared workspace and the team workflow.
CREATE TABLE users (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  active      INTEGER NOT NULL DEFAULT 1,
  pw_hash     TEXT,
  pw_salt     TEXT,
  must_change INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  last_login  TEXT
);
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,            -- SHA-256 of the cookie token
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions(email);
CREATE TABLE login_attempts (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE workspace (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  data     TEXT NOT NULL,
  revision INTEGER NOT NULL
);
CREATE TABLE problems (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  task_id    TEXT,
  author     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  response   TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  task_id    TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX notifications_email ON notifications(email, created_at);
CREATE TABLE thread (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  request_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX thread_task ON thread(task_id, created_at);
CREATE TABLE files (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  author     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX files_task ON files(task_id);
