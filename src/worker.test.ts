import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the global 'self' for the worker environment
let messageHandler: (event: { data: any }) => Promise<void>;
const self = {
  postMessage: vi.fn(),
  addEventListener: vi.fn((event, handler) => {
    if (event === 'message') {
      messageHandler = handler;
    }
  }),
  removeEventListener: vi.fn(),
};
global.self = self as any;

// Mock the heavy transformers library
const mockPipeline = vi.fn();
const mockTextStreamer = vi.fn();
const mockInterruptableStoppingCriteria = vi.fn().mockImplementation(() => ({
  interrupt: vi.fn(),
  reset: vi.fn(),
}));
const mockStoppingCriteriaList = vi.fn().mockImplementation(() => ({
  push: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => {
  return {
    pipeline: mockPipeline,
    TextStreamer: mockTextStreamer,
    InterruptableStoppingCriteria: mockInterruptableStoppingCriteria,
    StoppingCriteriaList: mockStoppingCriteriaList,
  };
});


describe('Web Worker Logic', () => {

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules(); // This is the key change
    // Import the worker script to execute its top-level code and attach event listeners
    await import('./worker.ts');
  });

  it('should register a message event listener on startup', () => {
    expect(self.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should handle "load" message and post status updates', async () => {
    const event = { data: { type: 'load' } };

    const mockGenerator = {
      tokenizer: {
        apply_chat_template: vi.fn().mockReturnValue({ input_ids: [], attention_mask: [] }),
      },
      model: { generate: vi.fn() },
    };
    mockPipeline.mockResolvedValue(mockGenerator);

    await messageHandler(event);

    expect(self.postMessage).toHaveBeenCalledWith({ type: 'load_start' });
    expect(mockPipeline).toHaveBeenCalledWith('text-generation', 'Xenova/Phi-3-mini-4k-instruct', expect.any(Object));

    // Check for status updates
    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'model_status',
      payload: expect.objectContaining({ status: 'INITIALIZING' })
    }));
    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'model_status',
      payload: expect.objectContaining({ status: 'READY' })
    }));
  });

  it('should handle "generate" message after model is loaded', async () => {

    // 1. Simulate loading the model first
    const mockGenerator = {
      tokenizer: {
        apply_chat_template: vi.fn().mockReturnValue({ input_ids: [1, 2, 3], attention_mask: [1, 1, 1] }),
      },
      model: {
        generate: vi.fn().mockResolvedValue(undefined),
      },
    };
    mockPipeline.mockResolvedValue(mockGenerator);
    await messageHandler({ data: { type: 'load' } });

    // 2. Now, simulate the generate message
    const generatePayload = { messages: [{ role: 'user', content: 'Hello' }] };
    await messageHandler({ data: { type: 'generate', payload: generatePayload } });

    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'model_status',
        payload: expect.objectContaining({ status: 'GENERATING' })
    }));

    expect(mockGenerator.tokenizer.apply_chat_template).toHaveBeenCalled();
    expect(mockGenerator.model.generate).toHaveBeenCalled();
    expect(self.postMessage).toHaveBeenCalledWith({ type: 'generation_complete' });
  });

  it('should handle "stop" message', async () => {
    const event = { data: { type: 'stop' } };

    await messageHandler(event);

    const criteriaInstance = mockInterruptableStoppingCriteria.mock.results[0]?.value;
    // Add a check to ensure the instance exists before asserting against it.
    expect(criteriaInstance).toBeDefined();

    expect(criteriaInstance.interrupt).toHaveBeenCalled();
    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'model_status',
        payload: expect.objectContaining({ status: 'READY' })
    }));
  });
});