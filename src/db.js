'use strict';

/**
 * 数据库连接与集合初始化。
 *
 * 这里刻意没有使用 Mongoose：集合结构、索引、校验器都直接写出来，
 * 一是减少一层抽象，二是让“数据库设计”在代码里一眼能看见。
 */
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connect({ uri, dbName }) {
  if (db) return db;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(dbName);
  return db;
}

function getDb() {
  if (!db) throw new Error('数据库尚未连接');
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * 集合的 JSON Schema 校验器。
 * 应用层已经做了业务校验，这里再兜一层类型约束，
 * 防止绕过接口直接写库时把结构写坏。
 */
const VALIDATORS = {
  users: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['username', 'usernameLower', 'passwordHash', 'passwordSalt', 'createdAt'],
      properties: {
        username: { bsonType: 'string', minLength: 3, maxLength: 32 },
        usernameLower: { bsonType: 'string', minLength: 3, maxLength: 32 },
        passwordHash: { bsonType: 'string' },
        passwordSalt: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
      },
    },
  },
  surveys: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerId', 'slug', 'title', 'status', 'questions', 'createdAt', 'updatedAt'],
      properties: {
        ownerId: { bsonType: 'objectId' },
        slug: { bsonType: 'string', minLength: 6, maxLength: 16 },
        title: { bsonType: 'string', maxLength: 120 },
        description: { bsonType: 'string', maxLength: 2000 },
        anonymous: { bsonType: 'bool' },
        allowMultiple: { bsonType: 'bool' },
        status: { enum: ['draft', 'published', 'closed'] },
        deadline: { bsonType: ['date', 'null'] },
        questions: { bsonType: 'array' },
        schemaVersion: { bsonType: 'int' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
  responses: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['surveyId', 'answers', 'submittedAt'],
      properties: {
        surveyId: { bsonType: 'objectId' },
        respondentId: { bsonType: ['objectId', 'null'] },
        anonymous: { bsonType: 'bool' },
        answers: { bsonType: 'array' },
        path: { bsonType: 'array' },
        submittedAt: { bsonType: 'date' },
      },
    },
  },
  sessions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'createdAt', 'expiresAt'],
      properties: {
        userId: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' },
        expiresAt: { bsonType: 'date' },
      },
    },
  },
  questions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['ownerId', 'title', 'type', 'currentVersion', 'createdAt', 'updatedAt'],
      properties: {
        ownerId: { bsonType: 'objectId' },
        title: { bsonType: 'string', maxLength: 200 },
        type: { enum: ['single', 'multiple', 'text', 'number'] },
        currentVersion: { bsonType: 'int' },
        inBank: { bsonType: 'bool' },
        sharedWith: { bsonType: 'array' },
        derivedFrom: { bsonType: ['object', 'null'] },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
      },
    },
  },
  question_versions: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['questionId', 'version', 'type', 'title', 'createdAt'],
      properties: {
        questionId: { bsonType: 'objectId' },
        version: { bsonType: 'int' },
        type: { enum: ['single', 'multiple', 'text', 'number'] },
        title: { bsonType: 'string', maxLength: 200 },
        options: { bsonType: 'array' },
        constraints: { bsonType: 'object' },
        createdBy: { bsonType: 'objectId' },
        createdAt: { bsonType: 'date' },
        note: { bsonType: 'string' },
        restoredFrom: { bsonType: ['int', 'null'] },
      },
    },
  },
};

async function ensureCollection(name, validator) {
  const exists = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (exists.length === 0) {
    await db.createCollection(name, validator ? { validator } : {});
  } else if (validator) {
    await db.command({ collMod: name, validator });
  }
}

/**
 * 建集合、建索引。重复执行是安全的（幂等）。
 */
async function ensureSchema() {
  for (const [name, validator] of Object.entries(VALIDATORS)) {
    await ensureCollection(name, validator);
  }

  // 用户名大小写不敏感地唯一
  await db.collection('users').createIndex({ usernameLower: 1 }, { unique: true });

  // 问卷：短链唯一；按创建者查列表；按状态过滤
  await db.collection('surveys').createIndex({ slug: 1 }, { unique: true });
  await db.collection('surveys').createIndex({ ownerId: 1, createdAt: -1 });
  await db.collection('surveys').createIndex({ status: 1 });

  // 答卷：按问卷查、按时间排序；用于“同一个人是否已填过”
  await db.collection('responses').createIndex({ surveyId: 1, submittedAt: -1 });
  await db.collection('responses').createIndex({ surveyId: 1, respondentId: 1 });

  // 会话：到期自动清理（TTL 索引）；按用户查
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('sessions').createIndex({ userId: 1 });

  // 题库：按所有者/共享人查；版本链唯一
  await db.collection('questions').createIndex({ ownerId: 1, updatedAt: -1 });
  await db.collection('questions').createIndex({ sharedWith: 1 });
  await db.collection('question_versions').createIndex({ questionId: 1, version: -1 }, { unique: true });

  // 题目被哪些问卷使用；题目跨问卷统计
  await db.collection('surveys').createIndex({ 'questions.questionId': 1 });
  await db.collection('responses').createIndex({ 'answers.questionId': 1 });
}

module.exports = { connect, getDb, close, ensureSchema };
