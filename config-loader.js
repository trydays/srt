/**
 * 多来源 AI 配置加载器
 *
 * 优先级（高→低）：
 *   1. CLI 参数 (--ai-key, --ai-provider, --ai-endpoint, --ai-model)
 *   2. 环境变量 (SRT_AI_KEY, SRT_AI_PROVIDER, SRT_AI_ENDPOINT, SRT_AI_MODEL)
 *   3. .srt.config.json 文件（应用同目录）
 *   4. .env 文件（应用同目录）
 *
 * 所有 parse* 函数是可单独导出的纯函数，易于测试。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseCliArgs(argv) {
  var config = {};
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === '--ai-key' && argv[i + 1]) { config.key = argv[i + 1]; i++; }
    else if (argv[i] === '--ai-provider' && argv[i + 1]) { config.provider = argv[i + 1]; i++; }
    else if (argv[i] === '--ai-endpoint' && argv[i + 1]) { config.endpoint = argv[i + 1]; i++; }
    else if (argv[i] === '--ai-model' && argv[i + 1]) { config.model = argv[i + 1]; i++; }
  }
  return config;
}

function parseEnvVars(env) {
  var config = {};
  if (!env) return config;
  if (env.SRT_AI_KEY) config.key = env.SRT_AI_KEY;
  if (env.SRT_AI_PROVIDER) config.provider = env.SRT_AI_PROVIDER;
  if (env.SRT_AI_ENDPOINT) config.endpoint = env.SRT_AI_ENDPOINT;
  if (env.SRT_AI_MODEL) config.model = env.SRT_AI_MODEL;
  return config;
}

function parseConfigFile(dir) {
  if (!dir) return {};
  var fp = path.join(dir, '.srt.config.json');
  try {
    if (fs.existsSync(fp)) {
      var raw = fs.readFileSync(fp, 'utf-8');
      var parsed = JSON.parse(raw);
      if (parsed && parsed.ai) return parsed.ai;
    }
  } catch (e) {
    console.error('[config-loader] 解析 .srt.config.json 失败:', e.message);
  }
  return {};
}

function parseEnvFile(dir) {
  if (!dir) return {};
  var fp = path.join(dir, '.env');
  var config = {};
  try {
    if (fs.existsSync(fp)) {
      var lines = fs.readFileSync(fp, 'utf-8').split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        var eq = line.indexOf('=');
        if (eq === -1) continue;
        var k = line.slice(0, eq).trim();
        var v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k === 'SRT_AI_KEY') config.key = v;
        else if (k === 'SRT_AI_PROVIDER') config.provider = v;
        else if (k === 'SRT_AI_ENDPOINT') config.endpoint = v;
        else if (k === 'SRT_AI_MODEL') config.model = v;
      }
    }
  } catch (e) {
    console.error('[config-loader] 解析 .env 失败:', e.message);
  }
  return config;
}

function parseClaudeCredentials(homeDir) {
  var hd = homeDir || os.homedir();
  var fp = path.join(hd, '.claude', 'credentials.json');
  try {
    if (fs.existsSync(fp)) {
      var raw = fs.readFileSync(fp, 'utf-8');
      var creds = JSON.parse(raw);
      if (creds && creds.accessToken) {
        return {
          key: creds.accessToken,
          provider: 'anthropic',
          endpoint: 'https://api.anthropic.com/v1/messages',
          model: 'claude-sonnet-4-6'
        };
      }
    }
  } catch (e) {
    console.error('[config-loader] 解析 Claude credentials 失败:', e.message);
  }
  return {};
}

function loadConfig(argv, envDict, appDir) {
  var env = envDict || process.env;
  var dir = appDir || __dirname;

  var dotenv = parseEnvFile(dir);
  var claude = parseClaudeCredentials();
  var file = parseConfigFile(dir);
  var envV = parseEnvVars(env);
  var cli = parseCliArgs(argv || []);

  var merged = Object.assign({}, dotenv, claude, file, envV, cli);

  if (!merged.key) return null;

  if (!merged.provider) merged.provider = 'deepseek';
  if (!merged.endpoint) {
    if (merged.provider === 'deepseek') merged.endpoint = 'https://api.deepseek.com/v1/chat/completions';
    else if (merged.provider === 'openai') merged.endpoint = 'https://api.openai.com/v1/chat/completions';
  }
  if (!merged.model) {
    if (merged.provider === 'deepseek') merged.model = 'deepseek-chat';
    else if (merged.provider === 'openai') merged.model = 'gpt-3.5-turbo';
  }

  return merged;
}

module.exports = { loadConfig, parseCliArgs, parseEnvVars, parseConfigFile, parseEnvFile, parseClaudeCredentials };
