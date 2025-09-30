<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { marked } from 'marked';

// --- Type Definitions ---
interface WorkerProgress {
  status: string;
  progress: number;
}

// --- Xterm.js and State ---
const terminalEl = ref<HTMLElement | null>(null);
let term: Terminal;
let fitAddon: FitAddon;
let currentLine = '';
let lastShownProgress = 0;

const currentBotResponse = ref<string>('');
const completedBotResponses = ref<string[]>([]); // Stores full text of completed bot responses
const worker = ref<Worker | null>(null);
const isLoading = ref<boolean>(true);
const isModelLoading = ref<boolean>(true);
const loadingStatus = ref<string>('Initializing...');
const progress = ref<number>(0);
const modelName = ref<string>(''); // To store the model name

// --- Lifecycle Hooks for Xterm.js ---
onMounted(() => {
  if (!terminalEl.value) return;

  term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
    fontSize: 16,
    theme: {
      background: '#0d0d0d',
      foreground: '#e0e0e0',
      cursor: '#00ff41',
    },
    convertEol: true,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(terminalEl.value);
  fitAddon.fit();
  window.addEventListener('resize', () => fitAddon.fit());

  term.onKey(({ key, domEvent }) => {
    if (domEvent.ctrlKey && domEvent.key === 'c') {
      if (isLoading.value && !isModelLoading.value) {
        domEvent.preventDefault();
        stopGeneration();
        term.write('^C');
        writePrompt();
      }
      return;
    }
    if (isLoading.value) return;
    const printable = !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

    if (domEvent.key === 'Enter') {
      if (currentLine) {
        term.write('\r\n');
        sendMessage(currentLine);
        currentLine = '';
      }
    } else if (domEvent.key === 'Backspace') {
      if (currentLine.length > 0) {
        term.write('\b \b');
        currentLine = currentLine.slice(0, -1);
      }
    } else if (printable) {
      term.write(key);
      currentLine += key;
    }
  });

  worker.value = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.value.onmessage = handleWorkerMessage;
  worker.value.postMessage({ type: 'load' });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', () => fitAddon.fit());
  term?.dispose();
});

// --- Terminal Writing Functions ---
const PROMPT = '\r\n\x1b[1;32m> \x1b[0m';
const writeSystemMessage = (text: string) => {
  term.writeln(`\x1b[90m${text}\x1b[0m`);
};
const writeBotMessage = (text: string) => {
  term.write(text.replace(/\n/g, '\r\n'));
};
const writePrompt = () => {
  currentLine = '';
  term.write(PROMPT);
};

// --- Worker & Message Handling ---
function handleWorkerMessage(event: MessageEvent): void {
  const { type, payload } = event.data;

  switch (type) {
    case 'system_message':
      writeSystemMessage(payload as string);
      break;
    case 'load_start':
      isLoading.value = true;
      isModelLoading.value = true;
      loadingStatus.value = 'DOWNLOADING';
      break;
    case 'load_progress':
      const p = payload as WorkerProgress;
      const newProgress = Math.round(p.progress);

      if (newProgress > lastShownProgress) {
        progress.value = newProgress;
        lastShownProgress = newProgress;
      }
      loadingStatus.value = p.status.toUpperCase();
      break;
    case 'load_complete':
      const { modelName: loadedModelName } = payload as { modelName: string };
      modelName.value = loadedModelName;
      progress.value = 100;
      isLoading.value = false;
      isModelLoading.value = false;
      loadingStatus.value = 'READY';
      writePrompt();
      break;
    case 'load_error':
      isLoading.value = false;
      isModelLoading.value = false;
      loadingStatus.value = 'ERROR';
      writeSystemMessage(`Error details: ${payload}`);
      break;
    case 'generation_stream':
      const token = payload as string;
      writeBotMessage(token);
      currentBotResponse.value += token;
      applyGeneratedCss([...completedBotResponses.value, currentBotResponse.value]);
      break;
    case 'generation_complete':
      completedBotResponses.value.push(currentBotResponse.value);
      applyGeneratedCss(completedBotResponses.value);
      isLoading.value = false;
      loadingStatus.value = 'READY';
      writePrompt();
      break;
  }
}

// --- CSS Application (now operates on an array of responses) ---
function applyGeneratedCss(responses: string[]): void {
  let allCss = '';

  for (const responseText of responses) {
    const tokens = marked.lexer(responseText);
    for (const token of tokens) {
      if (token.type === 'code' && token.lang === 'css') {
        allCss += token.text + '\n';
      }
    }
  }

  const styleId = 'chatbot-generated-styles';
  let styleElement = document.getElementById(styleId) as HTMLStyleElement;
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = styleId;
    document.head.appendChild(styleElement);
  }
  styleElement.innerHTML = allCss;
}

const sendMessage = (text: string): void => {
  if (isLoading.value) return;
  currentBotResponse.value = '';
  isLoading.value = true;
  loadingStatus.value = 'GENERATING';

  worker.value?.postMessage({
    type: 'generate',
    payload: { userText: text }
  });
};

const stopGeneration = (): void => {
  if (worker.value) {
    worker.value.postMessage({ type: 'stop' });
    completedBotResponses.value.push(currentBotResponse.value);
    applyGeneratedCss(completedBotResponses.value);
    isLoading.value = false;
    loadingStatus.value = 'READY';
  }
};
</script>

<template>
  <div id="terminal-container">
    <div ref="terminalEl" class="terminal-view"></div>
    <div class="status-line">
      <span class="status-left">
        STATUS: {{ loadingStatus }}
        <span v-if="isModelLoading">({{ progress }}%)</span>
        <span v-else-if="modelName">| {{ modelName }}</span>
      </span>
      <span class="status-right">
        <a href="https://github.com/kleinpa/oops" target="_blank" rel="noopener noreferrer" class="github-link">
          kleinpa/oops
        </a>
        <a href="#" @click.prevent="stopGeneration" v-if="isLoading && !isModelLoading">[stop]</a>
      </span>
    </div>
  </div>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  background-color: #0d0d0d;
}

#terminal-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.terminal-view {
  flex-grow: 1;
  padding: 10px;
  overflow: hidden;
}

.terminal-view .xterm {
  width: 100%;
  height: 100%;
}

.status-line {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  background-color: #1a1a1a;
  border-top: 1px solid #333;
  color: #888;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 0.9em;
}

.status-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.status-line a {
  color: #ff4757;
  text-decoration: none;
}

.status-line a.github-link {
  color: #888;
  text-decoration: none;
}

.status-line a.github-link:hover {
  color: #bbb;
  text-decoration: underline;
}
</style>
