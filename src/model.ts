import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

const REASONING_EFFORTS = ['none', 'low', 'high'];

// LLM_PROVIDER=nvidia uses NVIDIA's OpenAI-compatible endpoint; anything else uses Groq.
// Model parameters live here: change them and restart the server.
function createChatModel() {
  if (process.env.LLM_PROVIDER === 'nvidia') {
    if (!process.env.NVIDIA_API_KEY) throw new Error('Falta NVIDIA_API_KEY en .env');
    const reasoningEffort = process.env.NVIDIA_REASONING_EFFORT ?? 'none';
    if (!REASONING_EFFORTS.includes(reasoningEffort)) {
      throw new Error(`NVIDIA_REASONING_EFFORT debe ser uno de: ${REASONING_EFFORTS.join(', ')}`);
    }
    return new ChatOpenAI({
      model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      apiKey: process.env.NVIDIA_API_KEY,
      configuration: { baseURL: 'https://integrate.api.nvidia.com/v1' },
      temperature: 1, // NVIDIA's recommended value for text (0 = deterministic, higher = more creative)
      maxTokens: 2048, // max tokens the model can write per call (output + reasoning)
      // Parameters LangChain has no named option for go in modelKwargs and are sent as-is to the API.
      // reasoning_effort: 'none' = answers directly (faster, fewer tokens); 'low' | 'high' = thinks first.
      modelKwargs: { reasoning_effort: reasoningEffort },
    });
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY en .env');
  return new ChatGroq({
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    temperature: 0, // deterministic answers
  });
}

export const chatModel = createChatModel();

export type Usage = { inputTokens: number; outputTokens: number };

export function sumUsage(messages: BaseMessage[]): Usage {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const m of messages) {
    if (!AIMessage.isInstance(m)) continue;
    usage.inputTokens += m.usage_metadata?.input_tokens ?? 0;
    usage.outputTokens += m.usage_metadata?.output_tokens ?? 0;
  }
  return usage;
}
