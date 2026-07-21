const levels = [
  ['Rápido', 'Respostas diretas para tarefas simples.'],
  ['Equilibrado', 'Rápido, mas pensa antes de agir.'],
  ['Profundo', 'Analisa alternativas e antecipa riscos.'],
  ['Máximo', 'Pensa a longo prazo, sem atalhos.']
];

const range = document.querySelector('#reasoning');
const dial = document.querySelector('#dial i');
const label = document.querySelector('#reasoningLabel');
const hint = document.querySelector('#reasoningHint');
const number = document.querySelector('#reasoningNumber');
const backdrop = document.querySelector('#sheetBackdrop');
const input = document.querySelector('#commandInput');
const toast = document.querySelector('#toast');
const filePicker = document.querySelector('#filePicker');
const repositoryPicker = document.querySelector('#repositoryPicker');
const attachButton = document.querySelector('#attachButton');
const repositoryButton = document.querySelector('#repositoryButton');
const selectionList = document.querySelector('#selectionList');
const sendButton = document.querySelector('#sendCommand');
const agentResponse = document.querySelector('#agentResponse');
const responseStatus = document.querySelector('#responseStatus');
const responseText = document.querySelector('#responseText');
const cancelRun = document.querySelector('#cancelRun');
const authScreen = document.querySelector('#authScreen');
const authForm = document.querySelector('#authForm');
const authEmail = document.querySelector('#authEmail');
const authPassword = document.querySelector('#authPassword');
const authMessage = document.querySelector('#authMessage');
const signUpButton = document.querySelector('#signUpButton');
const profileButton = document.querySelector('#profileButton');
const branchBackdrop = document.querySelector('#branchBackdrop');
const branchList = document.querySelector('#branchList');
const voiceButton = document.querySelector('#voiceAction');
const branchButton = document.querySelector('#branchAction');
const stopButton = document.querySelector('#stopAction');
const secondaryView = document.querySelector('#secondaryView');
const navButtons = [...document.querySelectorAll('.bottom-nav button[data-view]')];
const commandSections = ['.hero', '.reasoning-card', '.section-head', '#threads', '.quick-actions', '#commandBar'].map(selector => document.querySelector(selector));
let attachments = [];
let repository = null;
let activeThreadId = null;
let activeRequest = null;
let supabaseClient = null;
let currentSession = null;
let branchContext = '';
let speechRecognition = null;
let mediaRecorder = null;
let microphoneStream = null;

async function deleteThread(thread) {
  if (!window.confirm(`Apagar o thread “${thread.title}”? Esta ação não pode ser anulada.`)) return false;
  const response = await apiFetch(`/api/threads/${thread.id}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    notify(body.error || 'Não foi possível apagar o thread');
    return false;
  }
  if (activeThreadId === thread.id) {
    activeThreadId = null;
    closeSheet();
  }
  notify('Thread apagado');
  await loadThreads();
  return true;
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (currentSession?.access_token) headers.set('Authorization', `Bearer ${currentSession.access_token}`);
  return fetch(url, { ...options, headers });
}

function setView(name) {
  navButtons.forEach(button => button.classList.toggle('selected', button.dataset.view === name));
  const commandVisible = name === 'command';
  commandSections.forEach(section => { section.hidden = !commandVisible; });
  secondaryView.hidden = commandVisible;
  if (name === 'activity') renderActivity();
  if (name === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function getThreads() {
  const response = await apiFetch('/api/threads');
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Não foi possível carregar os threads.');
  return response.json();
}

async function renderActivity() {
  secondaryView.innerHTML = '<p class="eyebrow">HISTÓRICO</p><h1 class="view-title">Atividade</h1><p class="view-subtitle">Pesquisa, filtra e reabre todas as execuções.</p><div class="activity-tools"><input id="activitySearch" type="search" placeholder="Pesquisar threads…"><select id="activityFilter"><option value="all">Todos</option><option value="running">A executar</option><option value="completed">Concluídos</option><option value="failed">Erros</option><option value="cancelled">Cancelados</option></select></div><div class="activity-list" id="activityList"><p class="empty-threads">A carregar…</p></div>';
  try {
    const threads = await getThreads();
    const list = secondaryView.querySelector('#activityList');
    const search = secondaryView.querySelector('#activitySearch');
    const filter = secondaryView.querySelector('#activityFilter');
    const paint = () => {
      const query = search.value.trim().toLowerCase();
      const visible = threads.filter(thread => (filter.value === 'all' || thread.status === filter.value) && `${thread.title} ${thread.prompt} ${thread.output}`.toLowerCase().includes(query));
      list.replaceChildren();
      if (!visible.length) return list.innerHTML = '<p class="empty-threads">Nenhum thread encontrado.</p>';
      visible.forEach(thread => {
        const item = document.createElement('article');
        item.className = 'activity-item';
        item.innerHTML = '<header><span class="activity-status"></span><span class="activity-actions"><time></time><button class="delete-thread" aria-label="Apagar thread">⌫</button></span></header><h3></h3><p></p>';
        item.querySelector('.activity-status').textContent = thread.status.toUpperCase();
        item.querySelector('time').textContent = new Date(thread.createdAt).toLocaleDateString('pt-PT');
        item.querySelector('h3').textContent = thread.title;
        item.querySelector('p').textContent = thread.output || thread.error || 'Em processamento…';
        item.querySelector('.delete-thread').addEventListener('click', async event => {
          event.stopPropagation();
          if (await deleteThread(thread)) renderActivity();
        });
        item.addEventListener('click', () => createThreadCard(thread, 0).click());
        list.append(item);
      });
    };
    search.addEventListener('input', paint);
    filter.addEventListener('change', paint);
    paint();
  } catch (error) { secondaryView.querySelector('#activityList').textContent = error.message; }
}

function renderSettings() {
  const email = currentSession?.user?.email || '';
  const defaultReasoning = localStorage.getItem('codex-reasoning') || range.value;
  secondaryView.innerHTML = `<p class="eyebrow">PREFERÊNCIAS</p><h1 class="view-title">Definições</h1><p class="view-subtitle">Conta, comportamento e capacidades do Pocket.</p><section class="settings-group"><p>CONTA</p><div class="setting-row"><div><strong>Sessão</strong><small></small></div><span>✓</span></div></section><section class="settings-group"><p>AGENTES</p><div class="setting-row"><div><strong>Raciocínio predefinido</strong><small>Aplicado aos novos comandos</small></div><select id="defaultReasoning"><option value="1">Rápido</option><option value="2">Equilibrado</option><option value="3">Profundo</option><option value="4">Máximo</option></select></div><div class="setting-row"><div><strong>Notificações</strong><small>Avisar quando uma tarefa terminar</small></div><button id="notificationSetting">Ativar</button></div></section><section class="settings-group"><p>CAPACIDADES</p><div class="capability-grid"><div class="capability ready"><i></i><strong>OpenAI</strong><small>Operacional</small></div><div class="capability ready"><i></i><strong>Supabase</strong><small>Operacional</small></div><div class="capability"><i></i><strong>GitHub</strong><small>Por configurar</small></div><div class="capability"><i></i><strong>Worker</strong><small>Por configurar</small></div></div></section><button class="danger-button" id="settingsSignOut">Terminar sessão</button>`;
  secondaryView.querySelector('.setting-row small').textContent = email;
  const select = secondaryView.querySelector('#defaultReasoning');
  select.value = defaultReasoning;
  select.addEventListener('change', () => { localStorage.setItem('codex-reasoning', select.value); range.value = select.value; updateReasoning(); notify('Raciocínio predefinido guardado'); });
  secondaryView.querySelector('#notificationSetting').addEventListener('click', async () => {
    if (!('Notification' in window)) return notify('Notificações não suportadas neste browser');
    const permission = await Notification.requestPermission();
    notify(permission === 'granted' ? 'Notificações autorizadas' : 'Notificações não autorizadas');
  });
  secondaryView.querySelector('#settingsSignOut').addEventListener('click', () => profileButton.click());
}

function showUser(session) {
  currentSession = session;
  authScreen.hidden = Boolean(session);
  if (!session) return;
  const email = session.user.email || 'user';
  profileButton.textContent = email.slice(0, 2).toUpperCase();
  document.querySelector('.hero h1 em').textContent = email.split('@')[0];
  loadThreads();
}

async function initAuth() {
  try {
    const configResponse = await fetch('/api/config');
    if (!configResponse.ok) throw new Error('O backend não está atualizado. Reinicia o servidor e tenta novamente.');
    const contentType = configResponse.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('A aplicação recebeu uma resposta inválida do backend.');
    const config = await configResponse.json();
    if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Supabase não configurado no .env.');
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    const { data } = await supabaseClient.auth.getSession();
    showUser(data.session);
    supabaseClient.auth.onAuthStateChange((_event, session) => showUser(session));
  } catch (error) {
    authMessage.textContent = error.message;
  }
}

function createThreadCard(thread, index) {
  const card = document.createElement('article');
  const state = thread.status === 'completed' ? 'complete' : thread.status === 'running' ? 'running' : 'attention';
  const stateLabel = { completed: 'CONCLUÍDO', running: 'A EXECUTAR', cancelled: 'CANCELADO', failed: 'ERRO' }[thread.status] || thread.status.toUpperCase();
  card.className = `thread-card ${thread.status === 'running' ? 'active' : thread.status === 'failed' ? 'review' : 'done'}`;
  card.tabIndex = 0;
  card.innerHTML = `<div class="thread-index">${String(index + 1).padStart(2, '0')}</div><div class="thread-main"><div class="thread-meta"><span class="status ${state}"><i></i> <b></b></span><span></span></div><h3></h3><p></p></div><div class="thread-actions"><button class="arrow" aria-label="Abrir thread">↗</button><button class="delete-thread" aria-label="Apagar thread">⌫</button></div>`;
  card.querySelector('.status b').textContent = stateLabel;
  card.querySelector('.thread-meta>span:last-child').textContent = new Date(thread.createdAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  card.querySelector('h3').textContent = thread.title;
  card.querySelector('p').textContent = thread.output || thread.error || 'A preparar resposta…';
  card.querySelector('.delete-thread').addEventListener('click', async event => {
    event.stopPropagation();
    await deleteThread(thread);
  });
  card.addEventListener('click', () => {
    openSheet();
    agentResponse.hidden = false;
    responseStatus.textContent = stateLabel;
    responseText.textContent = thread.output || thread.error || 'Execução em curso…';
    cancelRun.hidden = thread.status !== 'running';
    activeThreadId = thread.id;
  });
  return card;
}

async function loadThreads() {
  try {
    const response = await apiFetch('/api/threads');
    if (!response.ok) return;
    const savedThreads = await response.json();
    const container = document.querySelector('#threads');
    if (!savedThreads.length) {
      container.innerHTML = '<p class="empty-threads">Ainda não existem threads.<br>Cria o primeiro comando no botão +</p>';
      return;
    }
    container.replaceChildren(...savedThreads.slice(0, 6).map(createThreadCard));
    document.querySelector('.pulse').lastChild.textContent = ` ${savedThreads.filter(thread => thread.status === 'running').length} agentes estão a trabalhar`;
  } catch { /* A interface continua utilizável sem histórico. */ }
}

function updateReasoning() {
  const value = Number(range.value);
  label.textContent = levels[value - 1][0];
  hint.textContent = levels[value - 1][1];
  number.textContent = String(value).padStart(2, '0');
  dial.style.transform = `rotate(${-60 + value * 30}deg)`;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function openSheet() {
  backdrop.hidden = false;
  window.setTimeout(() => input.focus(), 100);
}

function closeSheet() { backdrop.hidden = true; }

async function openBranchPicker() {
  branchBackdrop.hidden = false;
  branchList.innerHTML = '<p class="empty-threads">A carregar threads…</p>';
  try {
    const threads = await getThreads();
    const available = threads.filter(thread => thread.output).slice(0, 20);
    branchList.replaceChildren();
    if (!available.length) {
      branchList.innerHTML = '<p class="empty-threads">Cria primeiro um thread concluído.</p>';
      return;
    }
    available.forEach(thread => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'branch-option';
      option.innerHTML = '<strong></strong><small></small>';
      option.querySelector('strong').textContent = thread.title;
      option.querySelector('small').textContent = `${new Date(thread.createdAt).toLocaleDateString('pt-PT')} · ${thread.effort}`;
      option.addEventListener('click', () => {
        branchContext = `Thread original: ${thread.prompt}\n\nResposta anterior: ${thread.output}`;
        branchBackdrop.hidden = true;
        openSheet();
        input.value = `Explora uma abordagem alternativa para: ${thread.prompt}`;
        input.focus();
        notify('Ramificação preparada — edita e envia o comando');
      });
      branchList.append(option);
    });
  } catch (error) { branchList.textContent = error.message; }
}

async function startRecordedDictation() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return notify('Gravação de voz não suportada neste browser');
  try {
    openSheet();
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    mediaRecorder = new MediaRecorder(microphoneStream);
    mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    mediaRecorder.onstart = () => {
      voiceButton.classList.add('listening');
      voiceButton.querySelector('small').textContent = 'PARAR';
      notify('A gravar — toca novamente para transcrever');
    };
    mediaRecorder.onstop = async () => {
      voiceButton.classList.remove('listening');
      voiceButton.querySelector('small').textContent = 'A PROCESSAR';
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      microphoneStream?.getTracks().forEach(track => track.stop());
      microphoneStream = null;
      mediaRecorder = null;
      try {
        const form = new FormData();
        form.append('audio', blob, 'dictation.webm');
        const response = await apiFetch('/api/transcribe', { method: 'POST', body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Falha na transcrição');
        input.value = `${input.value.trim()}${input.value.trim() && body.text ? ' ' : ''}${body.text || ''}`;
        input.focus();
        notify('Ditado transcrito');
      } catch (error) { notify(error.message); }
      finally { voiceButton.querySelector('small').textContent = 'DITAR'; }
    };
    mediaRecorder.start();
  } catch (error) {
    microphoneStream?.getTracks().forEach(track => track.stop());
    microphoneStream = null;
    mediaRecorder = null;
    notify(error.name === 'NotAllowedError' ? 'Autoriza o acesso ao microfone' : 'Não foi possível iniciar o microfone');
  }
}

function toggleVoiceDictation() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    startRecordedDictation();
    return;
  }
  if (speechRecognition) {
    speechRecognition.stop();
    return;
  }
  openSheet();
  const recognition = new Recognition();
  speechRecognition = recognition;
  recognition.lang = 'pt-PT';
  recognition.continuous = true;
  recognition.interimResults = true;
  const original = input.value.trim();
  let dictatedText = '';
  recognition.onstart = () => {
    voiceButton.classList.add('listening');
    voiceButton.querySelector('small').textContent = 'A OUVIR';
    notify('A ouvir — toca novamente para terminar');
  };
  recognition.onresult = event => {
    dictatedText = '';
    for (let index = 0; index < event.results.length; index += 1) dictatedText += event.results[index][0].transcript;
    input.value = `${original}${original && dictatedText ? ' ' : ''}${dictatedText}`.trim();
  };
  recognition.onerror = event => notify(event.error === 'not-allowed' ? 'Autoriza o acesso ao microfone' : `Erro no ditado: ${event.error}`);
  recognition.onend = () => {
    speechRecognition = null;
    voiceButton.classList.remove('listening');
    voiceButton.querySelector('small').textContent = 'DITAR';
  };
  recognition.start();
}

async function stopAllRuns() {
  stopButton.disabled = true;
  try {
    const response = await apiFetch('/api/runs/cancel-all', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Não foi possível parar as execuções');
    activeRequest?.abort();
    notify(body.cancelled ? `${body.cancelled} execução${body.cancelled > 1 ? 'ões' : ''} cancelada${body.cancelled > 1 ? 's' : ''}` : 'Não existem execuções ativas');
    await loadThreads();
  } catch (error) { notify(error.message); }
  finally { stopButton.disabled = false; }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function renderSelections() {
  selectionList.replaceChildren();
  attachments.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'selection-item';
    item.innerHTML = `<span>▣</span><span><strong></strong><small>${formatBytes(file.size)}</small></span><button type="button" aria-label="Remover ficheiro">×</button>`;
    item.querySelector('strong').textContent = file.name;
    item.querySelector('button').addEventListener('click', () => {
      attachments.splice(index, 1);
      renderSelections();
    });
    selectionList.append(item);
  });

  if (repository) {
    const item = document.createElement('div');
    item.className = 'selection-item';
    item.innerHTML = `<span>⌁</span><span><strong></strong><small>${repository.count} ficheiros no repositório</small></span><button type="button" aria-label="Remover repositório">×</button>`;
    item.querySelector('strong').textContent = repository.name;
    item.querySelector('button').addEventListener('click', () => {
      repository = null;
      repositoryPicker.value = '';
      renderSelections();
    });
    selectionList.append(item);
  }

  attachButton.classList.toggle('has-selection', attachments.length > 0);
  attachButton.querySelector('span').textContent = attachments.length ? `Anexar · ${attachments.length}` : 'Anexar';
  repositoryButton.classList.toggle('has-selection', Boolean(repository));
  repositoryButton.querySelector('span').textContent = repository ? repository.name : 'Repositório';
}

range.addEventListener('input', updateReasoning);
navButtons.forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  authMessage.textContent = 'A entrar…';
  const { error } = await supabaseClient.auth.signInWithPassword({ email: authEmail.value.trim(), password: authPassword.value });
  authMessage.textContent = error ? error.message : '';
});
signUpButton.addEventListener('click', async () => {
  if (!authEmail.reportValidity() || !authPassword.reportValidity()) return;
  authMessage.textContent = 'A criar conta…';
  const { data, error } = await supabaseClient.auth.signUp({
    email: authEmail.value.trim(), password: authPassword.value,
    options: { emailRedirectTo: window.location.origin }
  });
  if (error) authMessage.textContent = error.message;
  else if (!data.session) authMessage.textContent = 'Confirma o endereço através do email que enviámos.';
  else authMessage.textContent = '';
});
profileButton.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  document.querySelector('#threads').innerHTML = '<p class="empty-threads">Inicia sessão para ver os teus threads.</p>';
});
document.querySelector('#commandBar').addEventListener('click', () => { branchContext = ''; openSheet(); });
document.querySelector('#addThread').addEventListener('click', () => { branchContext = ''; openSheet(); });
document.querySelector('#sheetClose').addEventListener('click', closeSheet);
backdrop.addEventListener('click', event => { if (event.target === backdrop) closeSheet(); });
attachButton.addEventListener('click', () => filePicker.click());
repositoryButton.addEventListener('click', () => repositoryPicker.click());
filePicker.addEventListener('change', () => {
  const selected = Array.from(filePicker.files || []);
  const existing = new Set(attachments.map(file => `${file.name}-${file.size}-${file.lastModified}`));
  attachments.push(...selected.filter(file => !existing.has(`${file.name}-${file.size}-${file.lastModified}`)));
  renderSelections();
});
repositoryPicker.addEventListener('change', () => {
  const files = Array.from(repositoryPicker.files || []);
  if (!files.length) return;
  const relativePath = files[0].webkitRelativePath || files[0].name;
  repository = { name: relativePath.split('/')[0], count: files.length, files };
  renderSelections();
});
sendButton.addEventListener('click', async () => {
  if (!input.value.trim()) return input.focus();
  const form = new FormData();
  form.append('prompt', input.value.trim());
  form.append('reasoning', range.value);
  if (branchContext) form.append('branchContext', branchContext);
  const files = [...attachments, ...(repository?.files || [])].slice(0, 40);
  files.forEach(file => form.append('files', file, file.webkitRelativePath || file.name));

  agentResponse.hidden = false;
  cancelRun.hidden = false;
  responseText.textContent = '';
  responseStatus.textContent = 'A iniciar agente…';
  sendButton.disabled = true;
  activeRequest = new AbortController();
  try {
    const response = await apiFetch('/api/run', { method: 'POST', body: form, signal: activeRequest.signal });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Erro HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.forEach(block => {
        const type = block.match(/^event: (.+)$/m)?.[1];
        const raw = block.match(/^data: (.+)$/m)?.[1];
        if (!type || !raw) return;
        const data = JSON.parse(raw);
        if (type === 'thread') {
          activeThreadId = data.id;
          responseStatus.textContent = 'AGENTE A TRABALHAR';
        } else if (type === 'delta') {
          responseText.textContent += data.delta;
          agentResponse.scrollTop = agentResponse.scrollHeight;
        } else if (type === 'done') {
          responseStatus.textContent = 'CONCLUÍDO';
          cancelRun.hidden = true;
          notify('Agente concluiu a tarefa');
          loadThreads();
        } else if (type === 'error') {
          responseStatus.textContent = data.status === 'cancelled' ? 'CANCELADO' : 'ERRO';
          responseText.textContent += `\n${data.error}`;
        }
      });
    }
    input.value = '';
    attachments = [];
    repository = null;
    filePicker.value = '';
    repositoryPicker.value = '';
    branchContext = '';
    renderSelections();
  } catch (error) {
    responseStatus.textContent = 'ERRO';
    responseText.textContent = error.name === 'AbortError' ? 'Pedido interrompido.' : error.message;
  } finally {
    sendButton.disabled = false;
    activeRequest = null;
  }
});
cancelRun.addEventListener('click', async () => {
  if (activeThreadId) await apiFetch(`/api/threads/${activeThreadId}/cancel`, { method: 'POST' }).catch(() => {});
  activeRequest?.abort();
  responseStatus.textContent = 'CANCELADO';
  cancelRun.hidden = true;
});
voiceButton.addEventListener('click', toggleVoiceDictation);
branchButton.addEventListener('click', openBranchPicker);
stopButton.addEventListener('click', stopAllRuns);
document.querySelector('#branchClose').addEventListener('click', () => { branchBackdrop.hidden = true; });
branchBackdrop.addEventListener('click', event => { if (event.target === branchBackdrop) branchBackdrop.hidden = true; });
document.querySelectorAll('.pause').forEach(button => button.addEventListener('click', event => {
  event.stopPropagation();
  button.textContent = button.textContent === 'Ⅱ' ? '▶' : 'Ⅱ';
  notify(button.textContent === '▶' ? 'Agente pausado' : 'Agente retomado');
}));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSheet(); }
  if (event.key === 'Escape') { closeSheet(); branchBackdrop.hidden = true; }
});
updateReasoning();
initAuth();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
