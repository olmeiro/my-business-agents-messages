// Agente como grafo de LangGraph:
//
//   START ──► [llm] ──¿pidió una herramienta?── no ──► END
//               ▲            │ sí
//               └──────── [tools]

import { HumanMessage, trimMessages } from '@langchain/core/messages';
import { StateGraph, StateSchema, MessagesValue, START, MemorySaver } from '@langchain/langgraph';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { chatModel, sumUsage, type Usage } from './model.ts';
import { loadChatPrompt } from './prompts.ts';
import { weatherTool } from './weather.ts';
import { log, msSince } from './log.ts';

const tools = [weatherTool];

const prompt = loadChatPrompt('whatsapp-agent.md', ['assistant_name', 'today']);

// bindTools solo le describe las herramientas al modelo; quien las ejecuta es el nodo "tools".
const promptAndModel = prompt.pipe(chatModel.bindTools(tools));

const ASSISTANT_NAME = process.env.ASSISTANT_NAME ?? 'Nimbo';

// Al modelo solo le llegan los últimos mensajes: cada llamada reenvía el historial,
// así que sin límite el costo crece con cada mensaje y acaba superando el contexto.
export const MAX_HISTORY_MESSAGES = 20;
const trimHistory = trimMessages({
  maxTokens: MAX_HISTORY_MESSAGES,
  tokenCounter: (messages) => messages.length, // cuenta mensajes, no tokens
  strategy: 'last',
  // Empezar en un mensaje del usuario evita cortar entre una llamada a herramienta y su resultado.
  startOn: 'human',
});

// MessagesValue agrega los mensajes nuevos a la lista en vez de reemplazarla.
const State = new StateSchema({ messages: MessagesValue });

const graph = new StateGraph(State)
  .addNode('llm', async (state) => {
    const start = performance.now();
    const response = await promptAndModel.invoke({
      assistant_name: ASSISTANT_NAME,
      // El modelo no sabe qué día es si no se lo decimos.
      today: new Intl.DateTimeFormat('es', { dateStyle: 'full' }).format(new Date()),
      messages: await trimHistory.invoke(state.messages),
    });
    const toolCalls = response.tool_calls?.map((t) => t.name).join(',') || 'none';
    log('INFO', 'llm', { ms: msSince(start), toolCalls, ...sumUsage([response]) });
    return { messages: [response] };
  })
  // Si una herramienta falla, ToolNode le pasa el error al modelo como mensaje (no lanza excepción).
  .addNode('tools', new ToolNode(tools))
  .addEdge(START, 'llm')
  .addConditionalEdges('llm', toolsCondition, ['tools', '__end__'])
  .addEdge('tools', 'llm')
  // shortcut: (atajo) MemorySaver vive en RAM: se pierde al reiniciar y guarda el historial
  // completo aunque al modelo solo le enviemos los últimos mensajes.
  // Fuera de local, usa un checkpointer persistente (SQLite, Postgres).
  .compile({ checkpointer: new MemorySaver() });

// Mismo threadId = misma conversación: el checkpointer recupera el historial de ese hilo.
export async function runAgent(
  userMessage: string,
  threadId: string,
): Promise<{ reply: string; usage: Usage }> {
  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    {
      // Corta si el modelo pide herramientas en bucle (~5 idas y vueltas por mensaje).
      recursionLimit: 10,
      configurable: { thread_id: threadId },
    },
  );

  // Solo los mensajes de este turno, para no sumar los tokens de turnos anteriores.
  const turn = result.messages.slice(
    result.messages.findLastIndex((m) => HumanMessage.isInstance(m)) + 1,
  );
  const usage = sumUsage(turn);
  log('INFO', 'agent done', { threadId, historyMessages: result.messages.length, ...usage });
  return { reply: result.messages.at(-1)?.text ?? '', usage };
}
