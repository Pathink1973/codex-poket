import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const model = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const authClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 40, fileSize: 512 * 1024, fieldSize: 2 * 1024 * 1024 }
});
const running = new Map();

const allowedExtensions = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.html', '.css', '.scss',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php', '.sh', '.sql',
  '.yaml', '.yml', '.toml', '.xml', '.csv', '.env.example'
]);
const blockedParts = ['node_modules/', '.git/', 'dist/', 'build/', '.next/', '.env'];

function bearerToken(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function requireUser(req, res, next) {
  if (!authClient) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  req.user = data.user;
  req.accessToken = token;
  req.supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  next();
}

function toClientThread(row) {
  return {
    id: row.id, title: row.title, prompt: row.prompt, output: row.output || '',
    error: row.error, status: row.status, effort: row.reasoning_effort,
    fileCount: row.file_count, createdAt: row.created_at, completedAt: row.completed_at
  };
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function safeFiles(files) {
  let total = 0;
  return files.filter(file => {
    const name = (file.originalname || '').replaceAll('\\', '/');
    const lower = name.toLowerCase();
    if (blockedParts.some(part => lower.includes(part))) return false;
    if (!allowedExtensions.has(extname(lower)) && !lower.endsWith('.env.example')) return false;
    total += file.size;
    return total <= 1_500_000;
  }).slice(0, 30);
}

app.use(express.json());
app.use(express.static(root, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: Boolean(process.env.OPENAI_API_KEY && authClient), model });
});

app.get('/api/config', (_req, res) => res.json({ supabaseUrl, supabasePublishableKey: supabaseKey }));

app.get('/api/threads', requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from('threads').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(toClientThread));
});

app.delete('/api/threads/:id', requireUser, async (req, res) => {
  const { data, error } = await req.supabase.from('threads').delete().eq('id', req.params.id).select('id').maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Thread não encontrado.' });
  const controller = running.get(req.params.id);
  if (controller) controller.abort();
  res.json({ ok: true, id: data.id });
});

app.post('/api/run', requireUser, upload.array('files', 40), async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  const effortMap = { '1': 'low', '2': 'medium', '3': 'high', '4': 'xhigh' };
  const effort = effortMap[String(req.body.reasoning)] || 'medium';
  if (!prompt) return res.status(400).json({ error: 'O comando é obrigatório.' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY não configurada.' });

  const files = safeFiles(req.files || []);
  const context = files.map(file => `\n--- FICHEIRO: ${file.originalname} ---\n${file.buffer.toString('utf8')}`).join('\n');
  const id = randomUUID();
  const thread = { id, title: prompt.slice(0, 55), prompt, status: 'running', output: '', createdAt: new Date().toISOString(), effort, fileCount: files.length };
  const { error: insertError } = await req.supabase.from('threads').insert({
    id, user_id: req.user.id, title: thread.title, prompt, status: 'running',
    output: '', reasoning_effort: effort, file_count: files.length
  });
  if (insertError) return res.status(500).json({ error: insertError.message });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sendEvent(res, 'thread', thread);

  const controller = new AbortController();
  running.set(id, controller);
  let output = '';
  try {
    const stream = await openai.responses.create({
      model,
      reasoning: { effort },
      instructions: 'És um agente de programação cuidadoso. Responde em português europeu. Analisa apenas os ficheiros fornecidos. Não afirmes que alteraste ficheiros: propõe mudanças concretas e inclui código quando necessário.',
      input: `${prompt}${context ? `\n\nCONTEXTO DO PROJETO:${context}` : ''}`,
      stream: true
    }, { signal: controller.signal });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        output += event.delta;
        sendEvent(res, 'delta', { id, delta: event.delta });
      }
    }
    thread.status = 'completed';
    thread.output = output;
    thread.completedAt = new Date().toISOString();
    sendEvent(res, 'done', thread);
  } catch (error) {
    thread.status = controller.signal.aborted ? 'cancelled' : 'failed';
    thread.output = output;
    thread.error = controller.signal.aborted ? 'Execução cancelada.' : (error?.message || 'Erro na OpenAI API.');
    sendEvent(res, 'error', { id, error: thread.error, status: thread.status });
  } finally {
    running.delete(id);
    await req.supabase.from('threads').update({
      status: thread.status, output: thread.output, error: thread.error || null,
      completed_at: thread.completedAt || new Date().toISOString()
    }).eq('id', id);
    res.end();
  }
});

app.post('/api/threads/:id/cancel', requireUser, async (req, res) => {
  const { data } = await req.supabase.from('threads').select('id').eq('id', req.params.id).maybeSingle();
  if (!data) return res.status(404).json({ error: 'Thread não encontrado.' });
  const controller = running.get(req.params.id);
  if (!controller) return res.status(404).json({ error: 'Execução ativa não encontrada.' });
  controller.abort();
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  const message = error instanceof multer.MulterError ? `Upload inválido: ${error.message}` : 'Erro interno do servidor.';
  res.status(400).json({ error: message });
});

app.listen(port, () => console.log(`Codex Pocket em http://localhost:${port}`));
