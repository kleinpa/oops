<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watchEffect, nextTick, reactive } from 'vue';
import { Terminal } from '@xterm/xterm';
import type { ChatMessage, ModelStatus, WorkerLog } from './worker';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { marked } from 'marked';



const modelInstructions: ChatMessage[] = [
  {
    role: 'system', content: `You are a create AI assistant that generates css styles for a web app. Your response must follow these rules:
- You must respond with a single sentence followed by a single CSS snippet. Nothing else.
- The CSS snippet must be in a \`\`\`css ... \`\`\` code block.
- If the message is not a style request, create a theme that fits the vibe.
- No comments in CSS.
- No urls or links.
- Use animations liberally.

The primary stylable CSS selectors are:
- \`body\`: The main page with background color set.
- \`#terminal-container\`: The main terminal window.
- \`#first-half\`: The container for the main "oops" title.
- \`#first-half h1\`: The "oops" title text itself.` },
  // EXAMPLE 1
  { role: 'user', content: 'Make the theme feel like a classic green and black terminal.' },
  {
    role: 'assistant',
    content: `Here is a classic green terminal theme.

\`\`\`css
body {
  background: #0d0d0d;
}
.terminal-container {
  background-color: #111;
  color: #00ff41;
}
#first-half h1 {
  color: #00ff41;
  text-shadow: 0 0 10px #00ff41;
}
\`\`\``
  },
  // EXAMPLE 2
  { role: 'user', content: 'what is the capital of france' },
  {
    role: 'assistant',
    content: `The capital of France is Paris. I will apply a French-inspired theme.

\`\`\`css
body {
  background: linear-gradient(45deg, #0055A4, #FFFFFF, #EF4135);
}
.first-half {
  background-color: #EF4135;
  color: #FFFFFF;
}
#first-half h1 {
  color: #0055A4;
}
\`\`\``
  },
];

// --- Xterm.js and State ---
const terminalEl = ref<HTMLElement | null>(null);
let term: Terminal;
let statusTerm: Terminal;
let fitAddon: FitAddon;
const statusTerminalEl = ref<HTMLElement | null>(null);
let statusFitAddon: FitAddon;
let currentLine = '';

const currentBotResponse = ref<string>('');
const worker = ref<Worker | null>(null);
const messages = ref<ChatMessage[]>([]); // This will now only hold user and completed assistant messages
const splitDirection = ref<'row' | 'column'>('column');
const modelStatus = reactive<ModelStatus>({
  model_name: '',
  status: 'INITIALIZING',
  ready: false,
  interruptable: false,
});

// --- Lifecycle Hooks for Xterm.js ---
let isFirstLoad = true;
onMounted(() => {

  if (!terminalEl.value || !statusTerminalEl.value) return;

  const commonTerminalConfig = {
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
    convertEol: true,
    theme: {
      background: '#0d0d0d',
    },
  };

  // Main terminal
  term = new Terminal({
    ...commonTerminalConfig,
    cursorBlink: true,
    fontSize: 16,
    theme: {
      ...commonTerminalConfig.theme,
      foreground: '#e0e0e0',
      cursor: '#00ff41',
    },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminalEl.value);
  fitAddon.fit();

  // Status terminal
  statusTerm = new Terminal({
    ...commonTerminalConfig,
    cursorStyle: 'block',
    cursorBlink: false,
    fontSize: 14,
    theme: {
      ...commonTerminalConfig.theme,
      foreground: '#888',
      cursor: 'transparent',
    },
    rows: 1,
    scrollback: 0,
  });
  statusFitAddon = new FitAddon();
  statusTerm.loadAddon(statusFitAddon);
  statusTerm.open(statusTerminalEl.value);
  statusFitAddon.fit();
  updateStatusLine();

  const resizeHandler = async () => {
    if (window.innerWidth < window.innerHeight * 1.3) {
      splitDirection.value = 'column';
    } else {
      splitDirection.value = 'row';
    }
    await nextTick();
    fitAddon.fit();
    statusFitAddon.fit();
    updateStatusLine();
  };
  resizeHandler();
  window.addEventListener('resize', resizeHandler);

  onBeforeUnmount(() => {
    window.removeEventListener('resize', resizeHandler);
    term?.dispose();
    statusTerm?.dispose();
    worker.value?.terminate();
  });


  term.onKey(({ key, domEvent }) => {
    if (domEvent.ctrlKey && domEvent.key === 'c') {
      if (modelStatus.interruptable) {
        domEvent.preventDefault();
        stopGeneration();
        term.write('^C');
        writePrompt();
      }
      return;
    }
    if (!modelStatus.ready) return;
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

  worker.value = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.value.onmessage = handleWorkerMessage;
  worker.value.postMessage({ type: 'load' });
});

// --- Status Line Update ---
function updateStatusLine() {
  if (!statusTerm) return;

  const modelPart = modelStatus.model_name;
  const statusString = modelStatus.status;
  const statusDisplay =
    statusString === 'READY'
      ? `\x1b[32m${statusString}\x1b[39m` // Green for READY
      : `\x1b[37m${statusString}\x1b[39m`; // White for others

  const left = `${modelPart} ${statusDisplay}`;
  const visibleLeftLength = ` ${modelPart} ${statusString}`.length;

  const linkText = 'kleinpa/oops';
  const link = createOSC8Link(linkText, 'https://github.com/kleinpa/oops');
  const stop = modelStatus.interruptable ? '[stop]' : '';
  const visibleRightLength = `${linkText}  ${stop} `.length;

  const padding = ' '.repeat(Math.max(0, statusTerm.cols - visibleLeftLength - visibleRightLength));

  // The link text is colored, but the OSC8 link itself is not.
  statusTerm.write(`\x1b[G\x1b[K${left}${padding}\x1b[37m${link}\x1b[39m  \x1b[31m${stop}\x1b[39m `);
}

watchEffect(updateStatusLine);

function createOSC8Link(text: string, url: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

const writePrompt = () => {
  currentLine = '';
  term.write('\r\n\x1b[1;32m> \x1b[0m');
};

// --- Worker & Message Handling ---
function handleWorkerMessage(event: MessageEvent): void {
  const writeLogMessage = (log: WorkerLog) => {
    const { level, message } = log;
    let colorCode = '\x1b[90m'; // Default: grey for info
    if (level === 'warn') {
      colorCode = '\x1b[1;33m'; // Yellow
    } else if (level === 'error') {
      colorCode = '\x1b[1;31m'; // Red
    }
    term.writeln(`${colorCode}${message.replace(/\n/g, '\r\n')}\x1b[0m`);
  };

  const writeBotMessage = (text: string) => {
    term.write(text.replace(/\n/g, '\r\n'));
  };

  const { type, payload } = event.data;

  switch (type) {
    case 'worker_log':
      writeLogMessage(payload as WorkerLog);
      break;
    case 'model_status':
      Object.assign(modelStatus, payload as ModelStatus);
      if (modelStatus.status === 'READY' && isFirstLoad) {
        // First time ready, clear terminal and show prompt
        isFirstLoad = false;
        term.clear();
        writePrompt();
        term.focus();
      }
      break;
    case 'generation_stream':
      const token = payload as string;
      writeBotMessage(token);
      currentBotResponse.value += token;
      applyGeneratedCss([...messages.value.filter(m => m.role === 'assistant').map(m => m.content), currentBotResponse.value]);
      break;
    case 'generation_complete':
      messages.value.push({ role: 'assistant', content: currentBotResponse.value });
      // Now that the new message is in `messages`, we can derive the completed responses from it.
      applyGeneratedCss(messages.value.filter(m => m.role === 'assistant').map(m => m.content));
      writePrompt();
      break;
  }
  updateStatusLine();
}

// --- CSS Application (now operates on an array of responses) ---
function applyGeneratedCss(responses: string[]): void {
  let allCss = '';

  for (const responseText of responses.reverse()) {
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
  if (!modelStatus.ready) return;
  messages.value.push({ role: 'user', content: text });
  currentBotResponse.value = '';

  // For now send each message individually without history to avoid focus issues.
  worker.value?.postMessage({
    type: 'generate',
    payload: { messages: [...modelInstructions, { role: 'user', content: text }] }
  });
};

const stopGeneration = (): void => {
  if (worker.value) {
    worker.value.postMessage({ type: 'stop' });
    applyGeneratedCss(messages.value.filter(m => m.role === 'assistant').map(m => m.content));
  }
};
</script>

<template>
  <div id="app-container" :class="splitDirection">
    <div class="half" id="first-half">
      <h1>oops</h1>
    </div>
    <div id="terminal-container" class="half">
      <div ref="terminalEl" class="terminal-view"></div>
      <div ref="statusTerminalEl" class="status-terminal"></div>
    </div>
  </div>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  background: linear-gradient(45deg,
      hsl(0, 50%, 30%),
      hsl(30, 50%, 30%),
      hsl(60, 50%, 30%),
      hsl(120, 50%, 30%),
      hsl(240, 50%, 30%),
      hsl(270, 50%, 30%),
      hsl(300, 50%, 30%));
}

#app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  box-sizing: border-box;
}

#app-container.column {
  flex-direction: column;
}

#app-container.row {
  flex-direction: row;
}

.half {
  flex: 1;
  overflow: hidden;
}

#first-half {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.8);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  text-shadow: 0 0 15px rgba(255, 255, 255, 0.3);
}

#first-half h1 {
  font-size: 12vw;
  margin: 0;
}

#terminal-container {
  display: flex;
  flex-direction: column;
  padding: 10px;
  box-sizing: border-box;
}

.terminal-view {
  flex-grow: 1;
  overflow: hidden;
}

.terminal-view .xterm {
  width: 100%;
  height: 100%;
}

.status-terminal {
  flex-shrink: 0;
  height: 22px;
  background-color: #0d0d0d;
}

.status-terminal .xterm-viewport {
  overflow-y: hidden !important;
}

.terminal-view .xterm-viewport {
  scrollbar-color: #555555 #0d0d0d;
  scrollbar-width: thin;
}

.terminal-view .xterm-viewport::-webkit-scrollbar {
  background-color: #0d0d0d;
  width: 10px;
}

.terminal-view .xterm-viewport::-webkit-scrollbar-thumb {
  background: #555555;
  border-radius: 4px;
}

.terminal-view .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: #777777;
}
</style>
