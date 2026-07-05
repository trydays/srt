/**
 * config-loader.js 测试
 *
 * 运行: node --test tests\config-loader.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { loadConfig, parseCliArgs, parseEnvVars, parseConfigFile, parseEnvFile, parseClaudeCredentials } = require('../config-loader');

test('loadConfig 从 CLI --ai-key + --ai-provider 读取配置', () => {
  var argv = ['node', 'main.js', '--ai-key', 'sk-test123', '--ai-provider', 'openai'];
  var result = loadConfig(argv, {}, __dirname);
  assert.ok(result, '应有配置');
  assert.strictEqual(result.key, 'sk-test123');
  assert.strictEqual(result.provider, 'openai');
});

test('loadConfig 从环境变量 SRT_AI_KEY + SRT_AI_PROVIDER 读取', () => {
  var env = { SRT_AI_KEY: 'sk-env456', SRT_AI_PROVIDER: 'deepseek' };
  var result = loadConfig([], env, __dirname);
  assert.ok(result);
  assert.strictEqual(result.key, 'sk-env456');
  assert.strictEqual(result.provider, 'deepseek');
});

test('CLI 参数覆盖环境变量', () => {
  var argv = ['node', 'main.js', '--ai-key', 'sk-cli'];
  var env = { SRT_AI_KEY: 'sk-env', SRT_AI_PROVIDER: 'deepseek' };
  var result = loadConfig(argv, env, __dirname);
  assert.strictEqual(result.key, 'sk-cli');
  assert.strictEqual(result.provider, 'deepseek');
});

test('parseConfigFile 正确解析 JSON 配置文件', () => {
  var tmpDir = os.tmpdir();
  var fp = path.join(tmpDir, '.srt.config.json');
  fs.writeFileSync(fp, JSON.stringify({ ai: { key: 'sk-cfg', provider: 'openai' } }), 'utf-8');
  var result = parseConfigFile(tmpDir);
  assert.strictEqual(result.key, 'sk-cfg');
  assert.strictEqual(result.provider, 'openai');
  fs.unlinkSync(fp);
});

test('parseConfigFile 文件不存在时返回空对象', () => {
  var result = parseConfigFile('/nonexistent/path');
  assert.deepStrictEqual(result, {});
});

test('parseEnvFile 正确解析 .env 文件', () => {
  var tmpDir = os.tmpdir();
  var fp = path.join(tmpDir, '.env');
  fs.writeFileSync(fp, 'SRT_AI_KEY=sk-dotenv\nSRT_AI_PROVIDER=deepseek\n', 'utf-8');
  var result = parseEnvFile(tmpDir);
  assert.strictEqual(result.key, 'sk-dotenv');
  assert.strictEqual(result.provider, 'deepseek');
  fs.unlinkSync(fp);
});

test('loadConfig 无配置时返回 null', () => {
  var result = loadConfig([], {}, __dirname);
  assert.strictEqual(result, null);
});

test('loadConfig 只有 key 时自动补全 provider/endpoint/model', () => {
  var argv = ['node', 'main.js', '--ai-key', 'sk-test'];
  var result = loadConfig(argv, {}, __dirname);
  assert.ok(result);
  assert.strictEqual(result.provider, 'deepseek');
  assert.ok(result.endpoint.includes('deepseek'));
  assert.ok(result.model);
});

test('parseEnvFile 自动去掉值两端的引号', () => {
  var tmpDir = os.tmpdir();
  var fp = path.join(tmpDir, '.env');
  fs.writeFileSync(fp, 'SRT_AI_KEY="sk-quoted"\nSRT_AI_PROVIDER=\'deepseek\'\n', 'utf-8');
  var result = parseEnvFile(tmpDir);
  assert.strictEqual(result.key, 'sk-quoted');
  assert.strictEqual(result.provider, 'deepseek');
  fs.unlinkSync(fp);
});

test('parseClaudeCredentials 文件不存在时返回空对象', () => {
  var result = parseClaudeCredentials('/nonexistent');
  assert.deepStrictEqual(result, {});
});

test('parseClaudeCredentials 无 accessToken 字段时返回空对象', () => {
  var tmpDir = os.tmpdir();
  var claudeDir = path.join(tmpDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  var fp = path.join(claudeDir, 'credentials.json');
  fs.writeFileSync(fp, JSON.stringify({ otherField: 'test' }), 'utf-8');
  var result = parseClaudeCredentials(tmpDir);
  assert.deepStrictEqual(result, {});
  fs.unlinkSync(fp);
  fs.rmdirSync(claudeDir);
});

test('parseClaudeCredentials 正确读取 ~/.claude/credentials.json', () => {
  var tmpDir = os.tmpdir();
  var claudeDir = path.join(tmpDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  var fp = path.join(claudeDir, 'credentials.json');
  fs.writeFileSync(fp, JSON.stringify({ accessToken: 'test-token-123' }), 'utf-8');
  var result = parseClaudeCredentials(tmpDir);
  assert.strictEqual(result.key, 'test-token-123');
  assert.strictEqual(result.provider, 'anthropic');
  fs.unlinkSync(fp);
  fs.rmdirSync(claudeDir);
});
