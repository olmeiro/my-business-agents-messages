// ============================================================================
// model.ts — Qué modelo de IA usamos y con qué parámetros.
//
// Aquí se elige el proveedor (NVIDIA o Groq) según LLM_PROVIDER en el archivo .env.
// Para cambiar un parámetro (temperatura, tokens...), edítalo aquí y reinicia el servidor.
// ============================================================================

import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';

// Valores permitidos para el razonamiento de Nemotron.
const REASONING_EFFORTS = ['none', 'low', 'high'];

function createChatModel() {
  if (process.env.LLM_PROVIDER === 'nvidia') {
    if (!process.env.NVIDIA_API_KEY) throw new Error('Falta NVIDIA_API_KEY en .env');
    const reasoningEffort = process.env.NVIDIA_REASONING_EFFORT ?? 'none';
    // Validamos al arrancar: mejor un error claro ahora que uno raro en la primera petición.
    if (!REASONING_EFFORTS.includes(reasoningEffort)) {
      throw new Error(`NVIDIA_REASONING_EFFORT debe ser uno de: ${REASONING_EFFORTS.join(', ')}`);
    }
    // NVIDIA ofrece una API compatible con la de OpenAI, por eso usamos ChatOpenAI
    // y solo cambiamos la dirección (baseURL) a la de NVIDIA.
    return new ChatOpenAI({
      model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      apiKey: process.env.NVIDIA_API_KEY,
      configuration: { baseURL: 'https://integrate.api.nvidia.com/v1' },
      // Temperatura: 0 = responde casi siempre igual; más alto = respuestas más variadas.
      // 1 es el valor que NVIDIA recomienda para texto.
      temperature: 1,
      // Máximo de tokens que el modelo puede escribir en cada llamada (incluye el razonamiento).
      maxTokens: 2048,
      // modelKwargs sirve para mandar parámetros que LangChain no conoce: se envían tal cual a la API.
      // reasoning_effort: 'none' = responde directo (más rápido y barato); 'low' | 'high' = piensa antes.
      modelKwargs: { reasoning_effort: reasoningEffort },
    });
  }
  if (!process.env.GROQ_API_KEY) throw new Error('Falta GROQ_API_KEY en .env');
  // ChatGroq lee la clave GROQ_API_KEY del .env automáticamente.
  return new ChatGroq({
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
    temperature: 0, // 0 = respuestas lo más estables posible
  });
}

// Se crea una sola vez al arrancar y lo comparten el agente (/chat) y el informe (/report).
export const chatModel = createChatModel();

export type Usage = { inputTokens: number; outputTokens: number };

// Suma los tokens de las respuestas del modelo (AIMessage) de una lista de mensajes.
// Tokens de entrada = lo que le enviamos al modelo. Tokens de salida = lo que escribió.
export function sumUsage(messages: BaseMessage[]): Usage {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const m of messages) {
    if (!AIMessage.isInstance(m)) continue; // solo las respuestas del modelo traen tokens
    usage.inputTokens += m.usage_metadata?.input_tokens ?? 0;
    usage.outputTokens += m.usage_metadata?.output_tokens ?? 0;
  }
  return usage;
}
