import { pipeline, TextStreamer, env } from '@huggingface/transformers';

// Set environment variables for the worker
env.allowLocalModels = false; // By default, it cannot access local files
env.useBrowserCache = true;  // Use the browser's cache

// --- State for the worker ---
let generator = null;
let isGenerating = false; // Flag to track generation status

// --- Message Listener ---
// Listens for messages from the main UI thread
self.addEventListener('message', async (event) => {
    const { type, payload } = event.data;

    if (type === 'load') {
        // Load the model
        loadModel();
    } else if (type === 'generate') {
        // Generate text
        isGenerating = true;
        generateText(payload.messages);
    } else if (type === 'stop') {
        // Stop the generation
        isGenerating = false;
    }
});

// --- Functions ---
// 1. Loads the model and sends progress updates
async function loadModel() {
    self.postMessage({ type: 'load_start' });

    generator = await pipeline('text-generation', 'Xenova/Phi-3-mini-4k-instruct', {
        // This callback sends progress back to the UI
        progress_callback: (progress) => {
            self.postMessage({ type: 'load_progress', payload: progress });
        },
    });

    self.postMessage({ type: 'load_complete' });
}

// 2. Generates text and streams it back to the UI
async function generateText(messages) {
    if (!generator) return;

    const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        callback_function: (text) => {
            // If the 'stop' flag has been set, we don't send any more tokens
            if (!isGenerating) return;
            self.postMessage({ type: 'generation_stream', payload: text });
        },
    });

    try {
        await generator(messages, {
            max_new_tokens: 512,
            do_sample: true,
            temperature: 0.7,
            top_k: 50,
            streamer,
        });
    } catch (e) {
        // Catch errors, like if the user stops it mid-generation
        console.error(e);
    } finally {
        // Always signal completion, whether it finished or was stopped
        isGenerating = false;
        self.postMessage({ type: 'generation_complete' });
    }
}
