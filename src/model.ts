import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

const REASONING_EFFORTS = ['none', 'low', 'high'];

function createChatModel() {
  if (process.env.LLM_PROVIDER === 'nvidia') {
    if (!process.env.NVIDIA_API_KEY) throw new Error('Falta NVIDIA_API_KEY en .env');
    const reasoningEffort = process.env.NVIDIA_REASONING_EFFORT ?? 'none';
    if (!REASONING_EFFORTS.includes(reasoningEffort)) {
      throw new Error(`NVIDIA_REASONING_EFFORT debe ser uno de: ${REASONING_EFFORTS.join(', ')}`);
    }
    // NVIDIA expone una API compatible con OpenAI: basta con cambiar la baseURL.
    return new ChatOpenAI({
      model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      apiKey: process.env.NVIDIA_API_KEY,
      configuration: { baseURL: 'https://integrate.api.nvidia.com/v1' },
      temperature: 1, // valor recomendado por NVIDIA para texto
      maxTokens: 2048, // incluye los tokens de razonamiento
      // modelKwargs envía tal cual los parámetros que LangChain no conoce.
      modelKwargs: { reasoning_effort: reasoningEffort },
    });
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY en .env');
  // ChatGroq lee GROQ_API_KEY del entorno por su cuenta.
  return new ChatGroq({
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    temperature: 0,
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
