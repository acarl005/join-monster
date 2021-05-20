DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  email_address VARCHAR(150),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  num_legs INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS posts;
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  author_id INTEGER NOT NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS relationships;
CREATE TABLE relationships (
  follower_id INTEGER NOT NULL,
  followee_id INTEGER NOT NULL,
  closeness VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (follower_id, followee_id)
);

DROP TABLE IF EXISTS likes;
CREATE TABLE likes (
  account_id INTEGER NOT NULL,
  comment_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, comment_id)
);

DROP TABLE IF EXISTS sponsors;
CREATE TABLE sponsors (
  generation INTEGER NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  num_legs INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TABLE IF EXISTS tags;
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL,
  tag VARCHAR(255),
  tag_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
