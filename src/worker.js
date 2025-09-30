import { pipeline, TextStreamer, env } from '@huggingface/transformers';

// --- Prompt Engineering ---
// This constant combines the system instructions and few-shot examples into one block.
const SYSTEM_PROMPT_WITH_EXAMPLES = `You are an AI assistant that styles a web-based terminal. Whatever the user's message, respond with a single sentence and a CSS snippet surrounded by a \`\`\`css ... \`\`\` code block. If the message is not a request for a style, find something that fits the vibe. No comments in CSS! Do not reference external media like images or links. Use animations liberally.

The primary stylable CSS selectors are:
- #terminal-container (The main window)
- .terminal-view (The area where text appears)
- .terminal-view .xterm-rows (The text itself inside the terminal)
- .status-line (The bar at the bottom)
- .status-line a (Links in the status bar)
---
EXAMPLE 1
User: "Make the theme feel like a classic green and black terminal."
Assistant:
Here is a classic green terminal theme.
\`\`\`css
#terminal-container {
  background-color: #0d0d0d;
  border: 1px solid #00ff41;
}
.terminal-view .xterm-rows {
  color: #00ff41;
}
.status-line {
  background-color: #111;
  color: #00ff41;
}
\`\`\`
---
EXAMPLE 2
User: "I want an arctic blue theme."
Assistant:
Certainly, here is an arctic blue theme.
\`\`\`css
#terminal-container {
  background-color: #0B1D2A;
}
.terminal-view .xterm-rows {
  color: #d0d0d0;
}
.status-line {
  background-color: #122B3E;
  border-top-color: #3A5F7E;
  color: #88CCEE;
}
\`\`\`
---
EXAMPLE 3
User: "what is the capital of france"
Assistant:
The capital of France is Paris. I will apply a French-inspired theme.
\`\`\`css
#terminal-container {
  border: 2px solid #0055A4;
}
.status-line {
  background-color: #EF4135;
  color: #FFFFFF;
}
.status-line a {
  color: #FFFFFF;
}
\`\`\`
---
EXAMPLE 4
User: "Give me a warm sunset vibe"
Assistant:
Here are some warm, sunset-inspired colors.
\`\`\`css
#terminal-container {
  background-color: #2c1e33;
}
.terminal-view .xterm-rows {
  color: #ffcc99;
}
.status-line {
  background-color: #44314e;
  color: #ff9966;
  border-top: 1px solid #ff5e62;
}
\`\`\`
`;

// Manually constructs a prompt string that is optimal for the Phi-3 model.
function buildPrompt(userText) {
    return `<|system|>\n${SYSTEM_PROMPT_WITH_EXAMPLES}<|end|>\n<|user|>\n${userText}<|end|>\n<|assistant|>`;
}

// --- Main Worker Logic ---
env.allowLocalModels = false;
env.useBrowserCache = true;

let generator = null;
let controller = null;

self.addEventListener('message', async (event) => {
    const { type, payload } = event.data;

    if (type === 'load') {
        loadModel();
    } else if (type === 'generate') {
        controller = new AbortController();
        generateText(payload.userText, controller.signal);
    } else if (type === 'stop') {
        controller?.abort();
    }
});

async function loadModel() {
    self.postMessage({ type: 'load_start' });
    try {
        const modelId = 'Xenova/Phi-3-mini-4k-instruct';
        generator = await pipeline('text-generation', modelId, {
            device: 'webgpu',
            progress_callback: (progress) => {
                self.postMessage({ type: 'load_progress', payload: progress });
            },
        });
        self.postMessage({ type: 'system_message', payload: '\nWhat do you have in mind?' });
        self.postMessage({ type: 'load_complete', payload: { modelName: modelId } });
    } catch (e) {
        self.postMessage({ type: 'system_message', payload: `\r\n\x1b[1;31m[FATAL ERROR]\x1b[0m` });
        self.postMessage({ type: 'system_message', payload: `Failed to load model. Ensure you are using a modern browser that supports WebGPU.` });
        self.postMessage({ type: 'load_error', payload: e.message });
    }
}

async function generateText(userText, signal) {
    if (!generator) return;

    const prompt = buildPrompt(userText);

    const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        callback_function: (text) => {
            self.postMessage({ type: 'generation_stream', payload: text });
        },
    });

    try {
        await generator(prompt, {
            max_new_tokens: 512,
            temperature: 0.7,
            top_p: 0.95,
            do_sample: true,
            streamer,
            signal,
        });
    } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
    } finally {
        controller = null;
        self.postMessage({ type: 'generation_complete' });
    }
}

