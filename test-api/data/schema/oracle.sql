begin
execute immediate 'drop table "accounts" purge';
exception when others then null;
end;

CREATE TABLE "accounts" (
  "id" NUMBER(10),
  "email_address" VARCHAR(150),
  "first_name" VARCHAR(255),
  "last_name" VARCHAR(255),
  "num_legs" NUMBER(10) DEFAULT 2,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

ALTER TABLE "accounts" ADD (
  CONSTRAINT accounts_pk PRIMARY KEY ("id"))

begin
execute immediate 'drop table "comments" purge';
exception when others then null;
end;

CREATE TABLE "comments" (
  "id" NUMBER ,
  "body" VARCHAR2(4000) NOT NULL,
  "post_id" NUMBER NOT NULL,
  "author_id" NUMBER NOT NULL,
  "archived" NUMBER(1) DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

ALTER TABLE "comments" ADD (
  CONSTRAINT comments_pk PRIMARY KEY ("id"))

begin
execute immediate 'drop table "posts" purge';
exception when others then null;
end;

CREATE TABLE "posts" (
  "id" NUMBER ,
  "body" VARCHAR2(4000) NOT NULL,
  "author_id" NUMBER NOT NULL,
  "archived" NUMBER(1) DEFAULT 0,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

ALTER TABLE "posts" ADD (
  CONSTRAINT posts_pk PRIMARY KEY ("id"))

begin
execute immediate 'drop table "relationships" purge';
exception when others then null;
end;

CREATE TABLE "relationships" (
  "follower_id" NUMBER NOT NULL,
  "followee_id" NUMBER NOT NULL,
  "closeness" VARCHAR(255),
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("follower_id", "followee_id")
)

begin
execute immediate 'drop table "likes" purge';
exception when others then null;
end;

CREATE TABLE "likes" (
  "account_id" NUMBER NOT NULL,
  "comment_id" NUMBER NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("account_id", "comment_id")
)

begin
execute immediate 'drop table "sponsors" purge';
exception when others then null;
end;

CREATE TABLE "sponsors" (
  "generation" NUMBER NOT NULL,
  "first_name" VARCHAR(255),
  "last_name" VARCHAR(255),
  "num_legs" NUMBER DEFAULT 2,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)


begin
execute immediate 'drop table "tags" purge';
exception when others then null;
end;

CREATE TABLE "tags" (
  "id" NUMBER ,
  "post_id" NUMBER DEFAULT ,
  "tag" VARCHAR(255),
  "tag_order" NUMBER DEFAULT ,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
