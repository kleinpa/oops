<script setup>
import { ref, onMounted, nextTick } from 'vue';

// --- Reactive State ---
const worker = ref(null);
const userInput = ref('');
const messages = ref([]);
const chatWindow = ref(null);
const isLoading = ref(true); // Now tracks both loading and generating
const loadingStatus = ref('Initializing worker...');
const progress = ref(0); // For the progress bar

// --- Lifecycle Hook ---
onMounted(() => {
  // Create the Web Worker
  worker.value = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  });

  // Listen for messages from the worker
  worker.value.onmessage = handleWorkerMessage;

  // Tell the worker to start loading the model
  worker.value.postMessage({ type: 'load' });
});

// --- Worker Communication ---
function handleWorkerMessage(event) {
  const { type, payload } = event.data;

  switch (type) {
    case 'load_start':
      isLoading.value = true;
      loadingStatus.value = 'Loading model...';
      break;
    case 'load_progress':
      progress.value = Math.round(payload.progress);
      loadingStatus.value = `${payload.status} (${progress.value}%)`;
      break;
    case 'load_complete':
      isLoading.value = false;
      loadingStatus.value = 'Model loaded. Ready to chat!';
      messages.value.push({
        author: 'bot',
        text: "I'm Phi-3, running in the background. How can I help?",
      });
      break;
    case 'generation_stream':
      // Append the streamed token to the last bot message
      const lastMessage = messages.value[messages.value.length - 1];
      lastMessage.text = (lastMessage.text === '...') ? payload : lastMessage.text + payload;
      scrollToBottom();
      break;
    case 'generation_complete':
      isLoading.value = false;
      loadingStatus.value = 'Ready to chat!';
      break;
  }
}

// --- UI Logic ---
const sendMessage = () => {
  if (!userInput.value.trim() || isLoading.value) return;

  const userMessage = userInput.value;
  messages.value.push({ author: 'user', text: userMessage });
  userInput.value = '';
  messages.value.push({ author: 'bot', text: '...' });
  scrollToBottom();

  isLoading.value = true;
  loadingStatus.value = 'Generating response...';

  // Prepare messages and send to the worker
  const formattedMessages = messages.value.slice(0, -1).map(msg => ({
    role: msg.author === 'user' ? 'user' : 'assistant',
    content: msg.text,
  }));
  worker.value.postMessage({ type: 'generate', payload: { messages: formattedMessages } });
};

const stopGeneration = () => {
  if (worker.value) {
    worker.value.postMessage({ type: 'stop' });
  }
};

const scrollToBottom = () => {
  nextTick(() => {
    chatWindow.value.scrollTop = chatWindow.value.scrollHeight;
  });
};
</script>

<template>
  <div id="chatbot-container">
    <div class="header">
      <h2>Non-Blocking Phi-3 Chatbot 🚀</h2>
      <p>Powered by Vue.js & Web Workers</p>
    </div>

    <div class="chat-window" ref="chatWindow">
      <div v-for="(message, index) in messages" :key="index" :class="['message', message.author]">
        <p v-html="message.text.replace(/\n/g, '<br>')"></p>
      </div>
    </div>

    <div class="status-bar" v-if="isLoading">
      <p>{{ loadingStatus }}</p>
      <div v-if="loadingStatus.includes('Loading')" class="progress-bar-container">
        <div class="progress-bar" :style="{ width: progress + '%' }"></div>
      </div>
      <button v-if="loadingStatus.includes('Generating')" @click="stopGeneration" class="stop-button">
        Stop
      </button>
    </div>

    <div class="input-area">
      <input v-model="userInput" @keyup.enter="sendMessage" placeholder="Type your message..." :disabled="isLoading" />
      <button @click="sendMessage" :disabled="isLoading">Send</button>
    </div>
  </div>
</template>

<style>
/* Existing styles are fine, just add styles for the progress bar and stop button */
.progress-bar-container {
  width: 80%;
  height: 10px;
  background-color: #555;
  border-radius: 5px;
  margin: 0.5rem auto 0;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background-color: var(--accent-color);
  transition: width 0.2s ease-in-out;
}

.stop-button {
  margin-top: 0.5rem;
  padding: 0.3rem 0.8rem;
  border: none;
  background-color: #d9534f;
  color: white;
  border-radius: 15px;
  cursor: pointer;
}

.stop-button:hover {
  background-color: #c9302c;
}

/* All other styles remain the same */
:root {
  --primary-bg: #1e1e1e;
  --secondary-bg: #2d2d2d;
  --text-color: #e0e0e0;
  --accent-color: #4CAF50;
  --user-msg-bg: #005A9C;
  --bot-msg-bg: #3a3a3a;
}

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--primary-bg);
  color: var(--text-color);
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
}

#chatbot-container {
  width: 90%;
  max-width: 600px;
  height: 90vh;
  max-height: 800px;
  background-color: var(--secondary-bg);
  border-radius: 12px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  padding: 1rem;
  background-color: #333;
  text-align: center;
  border-bottom: 1px solid #444;
}

.header h2 {
  margin: 0;
  font-size: 1.2rem;
}

.header p {
  margin: 0;
  font-size: 0.8rem;
  color: #aaa;
}

.chat-window {
  flex-grow: 1;
  padding: 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  padding: 0.75rem 1rem;
  border-radius: 18px;
  max-width: 80%;
  word-wrap: break-word;
  line-height: 1.5;
}

.message.user {
  background-color: var(--user-msg-bg);
  color: white;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}

.message.bot {
  background-color: var(--bot-msg-bg);
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}

.message p {
  margin: 0;
}

.status-bar {
  padding: 0.5rem 1rem;
  text-align: center;
  font-size: 0.9rem;
  color: #ccc;
  background-color: rgba(0, 0, 0, 0.2);
}

.input-area {
  display: flex;
  padding: 1rem;
  border-top: 1px solid #444;
}

.input-area input {
  flex-grow: 1;
  padding: 0.75rem;
  border: 1px solid #555;
  border-radius: 20px;
  background-color: #444;
  color: var(--text-color);
  font-size: 1rem;
  margin-right: 0.5rem;
}

.input-area input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.input-area button {
  padding: 0.75rem 1.5rem;
  border: none;
  background-color: var(--accent-color);
  color: white;
  border-radius: 20px;
  cursor: pointer;
  font-size: 1rem;
  transition: background-color 0.2s;
}

.input-area button:hover {
  background-color: #45a049;
}

.input-area button:disabled {
  background-color: #555;
  cursor: not-allowed;
}
</style>
