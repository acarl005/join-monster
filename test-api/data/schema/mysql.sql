DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email_address VARCHAR(150),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  num_legs INT DEFAULT 2,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

DROP TABLE IF EXISTS comments;
CREATE TABLE comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  body TEXT NOT NULL,
  post_id INT NOT NULL,
  author_id INT NOT NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

DROP TABLE IF EXISTS posts;
CREATE TABLE posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  body TEXT NOT NULL,
  author_id INT NOT NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);

DROP TABLE IF EXISTS relationships;
CREATE TABLE relationships (
  follower_id INT NOT NULL,
  followee_id INT NOT NULL,
  closeness VARCHAR(255),
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (follower_id, followee_id)
);

DROP TABLE IF EXISTS likes;
CREATE TABLE likes (
  account_id INTEGER NOT NULL,
  comment_id INTEGER NOT NULL,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (account_id, comment_id)
);

DROP TABLE IF EXISTS sponsors;
CREATE TABLE sponsors (
  generation INT NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  num_legs INT DEFAULT 2,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);


DROP TABLE IF EXISTS tags;
CREATE TABLE tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INTEGER NOT NULL,
  tag VARCHAR(255),
  tag_order INTEGER DEFAULT 1,
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
);