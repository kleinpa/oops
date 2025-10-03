import { pipeline, TextStreamer, TextGenerationPipeline, InterruptableStoppingCriteria, StoppingCriteriaList, Tensor, type TextGenerationConfig } from '@huggingface/transformers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelStatus {
  model_name: string;
  status: string;
  ready: boolean;
  interruptable: boolean;
}

export interface WorkerLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

let generator: TextGenerationPipeline | null = null;
const stoppingCriteria = new InterruptableStoppingCriteria();
const modelId = 'Xenova/Phi-3-mini-4k-instruct';

async function loadModel() {
  self.postMessage({ type: 'load_start' });
  const postStatus = (status: Omit<ModelStatus, 'model_name'>) => {
    self.postMessage({ type: 'model_status', payload: { ...status, model_name: modelId } });
  };

  postStatus({ status: 'INITIALIZING', ready: false, interruptable: false });

  try {
    generator = await pipeline<"text-generation">('text-generation', modelId, {
      device: 'webgpu',
      progress_callback: (progress: { status: string, progress?: number }) => {
        let statusText = progress.status.toUpperCase();
        if (typeof progress.progress === 'number') {
          statusText += ` ${Math.round(progress.progress)}%`;
        }
        postStatus({ status: statusText, ready: false, interruptable: false });
      },
    });
    postStatus({ status: 'READY', ready: true, interruptable: false });
  } catch (e) {
    self.postMessage({ type: 'system_message', payload: `\r\n\x1b[1;31m[FATAL ERROR]\x1b[0m` });
    self.postMessage({ type: 'system_message', payload: `Failed to load model. Ensure you are using a modern browser that supports WebGPU.` });
    postStatus({ status: 'ERROR', ready: false, interruptable: false });
  }
}

async function generate(messages: ChatMessage[]) {
  const postStatus = (status: Omit<ModelStatus, 'model_name'>) => {
    self.postMessage({ type: 'model_status', payload: { ...status, model_name: modelId } });
  };

  postStatus({ status: 'GENERATING', ready: false, interruptable: true });

  if (!generator) {
    console.error("Generator not initialized. Call loadModel() first.");
    return;
  }

  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    callback_function: (text) => {
      self.postMessage({ type: 'generation_stream', payload: text });
    },
  });

  try {
    // Define a new chat template that correctly handles system, user, and assistant roles.
    const chatTemplate = `{% for message in messages %}{% if message['role'] == 'system' %}{{'<|system|>\n' + message['content'] + '<|end|>\n'}}{% elif message['role'] == 'user' %}{{'<|user|>\n' + message['content'] + '<|end|>\n'}}{% elif message['role'] == 'assistant' %}{{'<|assistant|>\n' + message['content'] + '<|end|>\n'}}{% endif %}{% endfor %}{% if add_generation_prompt %}{{'<|assistant|>\n'}}{% endif %}`;

    const inputs = generator.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      chat_template: chatTemplate,
      return_dict: true,
    }) as {
      input_ids: Tensor | number[] | number[][];
      attention_mask: Tensor | number[] | number[][];
    };

    stoppingCriteria.reset();
    const stoppingCriteriaList = new StoppingCriteriaList();
    stoppingCriteriaList.push(stoppingCriteria);

    await generator.model.generate({
      ...inputs,
      generation_config: {
        max_new_tokens: 512,
        temperature: 0.7,
        top_p: 0.95,
        do_sample: true,
        return_dict_in_generate: true,
      } as TextGenerationConfig,
      streamer,
      stopping_criteria: stoppingCriteriaList,
    }) ;

    self.postMessage({ type: 'generation_complete' });
    postStatus({ status: 'READY', ready: true, interruptable: false });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.error(e);
    self.postMessage({ type: 'worker_log', payload: { level: 'error', message: (e as Error).message, timestamp: Date.now() } });
    self.postMessage({ type: 'generation_complete' }); // Send empty on error
    postStatus({ status: 'READY', ready: true, interruptable: false });
    return undefined;
  }
}

/**
 * Interrupts the generation process.
 *
 * This is useful for stopping the model from generating more text, for example
 * when the user wants to interrupt the current generation.
 */
function stop() {
  stoppingCriteria.interrupt();
  self.postMessage({ type: 'model_status', payload: { status: 'READY', ready: true, interruptable: false, model_name: modelId } });
}

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  if (type === 'load') {
    loadModel();
  } else if (type === 'generate') {
    generate(payload.messages);
  } else if (type === 'stop') {
    stop();
  }
});
